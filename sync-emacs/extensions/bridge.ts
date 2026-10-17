import { randomUUID } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { isAbsolute, join } from "node:path";
import type { Row } from "./transcript.ts";

export const PROTOCOL = 1;
export const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_BACKLOG = 16 * 1024 * 1024;

export function runtimeDirectory(): string {
  return process.env.SYNC_EMACS_DIR ?? `/tmp/sync-emacs-${process.getuid!()}`;
}

export interface SessionInfo {
  sessionId: string;
  sessionFile?: string;
  name?: string;
  cwd: string;
  model?: string;
  busy: boolean;
}

interface Options {
  directory?: string;
  info: () => SessionInfo;
  rows: () => Iterable<Row>;
  prompt: (text: string, delivery: "followUp" | "steer") => void;
  abort: () => void;
  clientsChanged?: (count: number) => void;
}

interface Peer {
  socket: Socket;
  ready: boolean;
  snapshotting: boolean;
  snapshotRequested: boolean;
  pending: string[];
  pendingBytes: number;
}

function remove(path: string): void {
  try { unlinkSync(path); } catch (error: any) { if (error.code !== "ENOENT") throw error; }
}

export class Bridge {
  readonly instanceId = `${process.pid}-${randomUUID().slice(0, 12)}`;
  readonly directory: string;
  readonly socketPath: string;
  readonly registryPath: string;
  private startedAt = new Date().toISOString();
  private server?: Server;
  private peers = new Set<Peer>();
  private closed = false;
  private published = false;
  private options: Options;

  constructor(options: Options) {
    this.options = options;
    this.directory = options.directory ?? runtimeDirectory();
    this.socketPath = join(this.directory, `${this.instanceId}.sock`);
    this.registryPath = join(this.directory, `${this.instanceId}.json`);
  }

  get clientCount(): number { return [...this.peers].filter((peer) => peer.ready).length; }

  private descriptor() {
    return {
      protocol: PROTOCOL, instanceId: this.instanceId, pid: process.pid,
      socket: this.socketPath, startedAt: this.startedAt, ...this.options.info(),
    };
  }

  // Also remove discovery artifacts on a normal Node exit. SIGKILL can leave
  // stale files; clients ignore descriptors whose socket/PID no longer exists.
  private cleanup = () => {
    for (const path of [this.registryPath, `${this.registryPath}.tmp`, this.socketPath]) {
      try { remove(path); } catch { /* best effort at process exit */ }
    }
  };

  async start(): Promise<void> {
    if (!isAbsolute(this.directory)) throw new Error("SYNC_EMACS_DIR must be an absolute path");
    if (Buffer.byteLength(this.socketPath) > 100) {
      throw new Error("Socket path is too long; set SYNC_EMACS_DIR to a short private directory");
    }
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const stat = lstatSync(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid!() || (stat.mode & 0o077)) {
      throw new Error(`Unsafe sync-emacs directory: ${this.directory} (must be owned by you, mode 0700, not a symlink)`);
    }
    this.server = createServer((socket) => this.accept(socket));
    try {
      await new Promise<void>((resolve, reject) => {
        this.server!.once("error", reject);
        this.server!.listen(this.socketPath, () => {
          this.server!.off("error", reject);
          resolve();
        });
      });
      // An unexpected listening-server error must not take down the Pi session.
      this.server.on("error", () => { void this.stop(); });
      this.server.unref();
      chmodSync(this.socketPath, 0o600);
      this.publish();
      process.on("exit", this.cleanup);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  publish(): void {
    if (this.closed) return;
    const temporary = `${this.registryPath}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(this.descriptor())}\n`, { mode: 0o600, flag: "wx" });
    renameSync(temporary, this.registryPath);
    this.published = true;
  }

  broadcast(frame: unknown): void {
    for (const peer of this.peers) if (peer.ready) this.send(peer, frame);
  }

  state(): void { this.broadcast({ type: "state", session: this.descriptor() }); }

  snapshot(): void {
    for (const peer of this.peers) if (peer.ready) this.sendSnapshot(peer);
  }

  private send(peer: Peer, frame: unknown): void {
    if (peer.socket.destroyed) return;
    const line = `${JSON.stringify(frame)}\n`;
    const bytes = Buffer.byteLength(line);
    if (peer.pendingBytes + peer.socket.writableLength + bytes > MAX_BACKLOG) {
      // Never wait for an editor inside a Pi stream event, or buffer indefinitely.
      peer.socket.destroy();
      return;
    }
    if (peer.snapshotting) {
      peer.pending.push(line);
      peer.pendingBytes += bytes;
    } else peer.socket.write(line);
  }

  private sendSnapshot(peer: Peer): void {
    if (peer.snapshotting) { peer.snapshotRequested = true; return; }
    peer.snapshotting = true;
    // Copy immutable row references at one boundary. Live events queue until
    // snapshot_end, preventing interleaved resets, missing rows, or duplicates.
    const session = this.descriptor();
    const rows = [...this.options.rows()];
    void this.streamSnapshot(peer, session, rows).catch(() => peer.socket.destroy());
  }

  private async streamSnapshot(peer: Peer, session: unknown, rows: Row[]): Promise<void> {
    const write = async (line: string) => {
      const socket = peer.socket;
      if (socket.destroyed) throw new Error("Disconnected");
      if (socket.write(line)) return;
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          socket.off("drain", drained);
          socket.off("close", closed);
        };
        const drained = () => { cleanup(); resolve(); };
        const closed = () => { cleanup(); reject(new Error("Disconnected")); };
        const timer = setTimeout(() => { socket.destroy(); closed(); }, 15000);
        timer.unref();
        socket.once("drain", drained);
        socket.once("close", closed);
      });
    };
    await write(`${JSON.stringify({ type: "snapshot_start", session })}\n`);
    for (const row of rows) await write(`${JSON.stringify({ type: "upsert", row })}\n`);
    await write('{"type":"snapshot_end"}\n');
    while (peer.pending.length) {
      const line = peer.pending.shift()!;
      peer.pendingBytes -= Buffer.byteLength(line);
      await write(line);
    }
    peer.snapshotting = false;
    if (peer.snapshotRequested) {
      peer.snapshotRequested = false;
      this.sendSnapshot(peer);
    }
  }

  private accept(socket: Socket): void {
    if (this.closed || this.peers.size >= 16) { socket.destroy(); return; }
    const peer: Peer = { socket, ready: false, snapshotting: false, snapshotRequested: false, pending: [], pendingBytes: 0 };
    this.peers.add(peer);
    socket.setEncoding("utf8");
    socket.unref();
    const handshakeTimer = setTimeout(() => { if (!peer.ready) socket.destroy(); }, 5000);
    handshakeTimer.unref();
    let input = "";
    socket.on("data", (chunk: string) => {
      input += chunk;
      let newline: number;
      while ((newline = input.indexOf("\n")) !== -1) {
        const line = input.slice(0, newline);
        input = input.slice(newline + 1);
        if (Buffer.byteLength(line) > MAX_REQUEST_BYTES) { socket.destroy(); return; }
        let request: any;
        try { request = JSON.parse(line); }
        catch { socket.destroy(); return; }
        this.request(peer, request);
        if (socket.destroyed) return;
      }
      if (Buffer.byteLength(input) > MAX_REQUEST_BYTES) socket.destroy();
    });
    socket.on("error", () => { socket.destroy(); });
    socket.on("close", () => {
      clearTimeout(handshakeTimer);
      this.peers.delete(peer);
      if (!this.closed) this.options.clientsChanged?.(this.clientCount);
    });
  }

  private request(peer: Peer, request: any): void {
    const id = typeof request?.id === "string" ? request.id.slice(0, 128) : null;
    try {
      if (!request || typeof request !== "object" || Array.isArray(request)) throw new Error("Expected an object");
      if (!peer.ready) {
        if (request.type !== "hello" || request.protocol !== PROTOCOL || request.instanceId !== this.instanceId) {
          throw new Error("Protocol/instance mismatch; reconnect using a fresh session listing");
        }
        peer.ready = true;
        this.send(peer, { type: "hello", protocol: PROTOCOL, session: this.descriptor() });
        this.sendSnapshot(peer);
        this.options.clientsChanged?.(this.clientCount);
        return;
      }
      if (!id) throw new Error("Request id is required");
      switch (request.type) {
        case "snapshot": this.sendSnapshot(peer); break;
        case "ping": break;
        case "prompt":
        case "abort": {
          if (request.sessionId !== this.options.info().sessionId) throw new Error("Session changed; reconnect before sending");
          if (request.type === "abort") { this.options.abort(); break; }
          if (typeof request.text !== "string" || !request.text.trim()) throw new Error("Message must not be empty");
          if (request.deliverAs !== "followUp" && request.deliverAs !== "steer") throw new Error("Invalid delivery mode");
          this.options.prompt(request.text, request.deliverAs);
          break;
        }
        default: throw new Error(`Unknown request: ${request.type}`);
      }
      // This acknowledges dispatch, not model completion. Pi's extension API
      // returns void; asynchronous runtime errors are still reported by Pi.
      this.send(peer, { type: "response", id, ok: true });
    } catch (error) {
      this.send(peer, { type: "response", id, ok: false, error: String(error instanceof Error ? error.message : error) });
      if (!peer.ready) peer.socket.end();
    }
  }

  async stop(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    process.off("exit", this.cleanup);
    for (const peer of this.peers) peer.socket.destroy();
    this.peers.clear();
    if (this.published) {
      try { remove(this.registryPath); } catch { /* continue closing even if permissions changed */ }
    }
    if (this.server?.listening) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    }
    this.cleanup();
  }
}
