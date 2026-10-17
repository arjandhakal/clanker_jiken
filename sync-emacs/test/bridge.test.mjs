import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, chmodSync, symlinkSync, unlinkSync } from "node:fs";
import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { Bridge, MAX_REQUEST_BYTES } from "../extensions/bridge.ts";
import { Transcript, messageRow } from "../extensions/transcript.ts";
import extension from "../extensions/index.ts";

async function eventually(predicate, timeout = 3000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition");
    await delay(5);
  }
}

async function client(bridge, hello = true) {
  const socket = createConnection(bridge.socketPath);
  const frames = [];
  let input = "";
  socket.setEncoding("utf8");
  socket.on("data", (chunk) => {
    input += chunk;
    let end;
    while ((end = input.indexOf("\n")) >= 0) {
      frames.push(JSON.parse(input.slice(0, end)));
      input = input.slice(end + 1);
    }
  });
  socket.on("error", () => {});
  await once(socket, "connect");
  const send = (request) => socket.write(`${JSON.stringify(request)}\n`);
  if (hello) {
    send({ type: "hello", protocol: 1, instanceId: bridge.instanceId });
    await eventually(() => frames.some((frame) => frame.type === "snapshot_end"));
  }
  return {
    socket, frames, send,
    response: async (id) => {
      await eventually(() => frames.some((frame) => frame.id === id));
      return frames.find((frame) => frame.id === id);
    },
  };
}

async function fixture(t, overrides = {}) {
  const directory = mkdtempSync("/tmp/sync-emacs-test-");
  const calls = [];
  let session = { sessionId: "session-a", cwd: "/a/project", name: "Project A", busy: false };
  const rows = new Map([["one", { id: "one", role: "assistant", text: "Already here" }]]);
  const bridge = new Bridge({
    directory, info: () => session, rows: () => rows.values(),
    prompt: (...args) => calls.push(["prompt", ...args]), abort: () => calls.push(["abort"]),
    ...overrides,
  });
  t.after(async () => { await bridge.stop(); rmSync(directory, { force: true, recursive: true }); });
  await bridge.start();
  return { bridge, calls, rows, setSession: (value) => { session = value; } };
}

test("private discovery, concurrent viewers, prompts, abort, and cleanup", async (t) => {
  const { bridge, calls } = await fixture(t);
  const registry = JSON.parse(readFileSync(bridge.registryPath));
  assert.equal(registry.sessionId, "session-a");
  assert.equal(registry.pid, process.pid);
  assert.equal(statSync(bridge.directory).mode & 0o777, 0o700);
  assert.equal(statSync(bridge.registryPath).mode & 0o777, 0o600);
  assert.equal(statSync(bridge.socketPath).mode & 0o777, 0o600);
  const a = await client(bridge), b = await client(bridge);
  t.after(() => { a.socket.destroy(); b.socket.destroy(); });
  assert.equal(bridge.clientCount, 2);
  assert.equal(a.frames.find((f) => f.type === "upsert").row.text, "Already here");
  bridge.broadcast({ type: "upsert", row: { id: "two", role: "assistant", text: "Live" } });
  await eventually(() => b.frames.some((f) => f.row?.id === "two"));
  a.send({ type: "prompt", id: "p", sessionId: "session-a", text: "  hello\nPi  ", deliverAs: "followUp" });
  assert.equal((await a.response("p")).ok, true);
  assert.deepEqual(calls[0], ["prompt", "  hello\nPi  ", "followUp"]);
  b.send({ type: "prompt", id: "s", sessionId: "session-a", text: "steer", deliverAs: "steer" });
  assert.equal((await b.response("s")).ok, true);
  a.send({ type: "abort", id: "a", sessionId: "session-a" });
  assert.equal((await a.response("a")).ok, true);
  assert.deepEqual(calls.at(-1), ["abort"]);
  a.socket.destroy();
  await eventually(() => bridge.clientCount === 1);
  b.send({ type: "ping", id: "still-running" });
  assert.equal((await b.response("still-running")).ok, true);
  await bridge.stop();
  await bridge.stop();
  assert.deepEqual(readdirSync(bridge.directory), []);
});

test("framing tolerates split UTF-8 and coalesced requests", async (t) => {
  const { bridge, calls } = await fixture(t);
  const c = await client(bridge);
  t.after(() => c.socket.destroy());
  const wire = Buffer.from(JSON.stringify({ type: "prompt", id: "unicode", sessionId: "session-a", text: "日本語 🌸", deliverAs: "followUp" }) + "\n");
  const middle = wire.indexOf(Buffer.from("日")) + 1;
  c.socket.write(wire.subarray(0, middle));
  await delay(10);
  c.socket.write(Buffer.concat([wire.subarray(middle), Buffer.from('{"type":"ping","id":"ping"}\n')]));
  assert.equal((await c.response("unicode")).ok, true);
  assert.equal((await c.response("ping")).ok, true);
  assert.equal(calls[0][1], "日本語 🌸");
});

test("invalid, cross-session and pre-handshake requests never reach Pi", async (t) => {
  const { bridge, calls } = await fixture(t);
  const c = await client(bridge);
  t.after(() => c.socket.destroy());
  const invalid = [
    { type: "prompt", text: "", deliverAs: "followUp" },
    { type: "prompt", text: "x", deliverAs: "invalid" },
    { type: "prompt", text: "x", sessionId: "another-session", deliverAs: "followUp" },
    { type: "abort", sessionId: "another-session" },
    { type: "eval", text: "anything" },
  ];
  for (const [i, fields] of invalid.entries()) {
    const id = String(i);
    c.send({ sessionId: "session-a", ...fields, id });
    assert.equal((await c.response(id)).ok, false);
  }
  const raw = await client(bridge, false);
  const closed = once(raw.socket, "close");
  raw.send({ type: "prompt", id: "unauth", text: "not allowed" });
  await closed;
  assert.deepEqual(calls, []);
  assert.equal(raw.frames[0].ok, false);
});

test("malformed, oversized and slow clients cannot block the bridge", async (t) => {
  const { bridge } = await fixture(t);
  for (const wire of ["{not json}\n", "x".repeat(MAX_REQUEST_BYTES + 1)]) {
    const c = await client(bridge);
    const closed = once(c.socket, "close");
    c.socket.write(wire);
    await closed;
  }
  const slow = await client(bridge);
  slow.socket.pause();
  for (let i = 0; i < 40; i++) bridge.broadcast({ type: "notice", text: "x".repeat(1024 * 1024) });
  await eventually(() => bridge.clientCount === 0);
  slow.socket.destroy();
  const healthy = await client(bridge);
  t.after(() => healthy.socket.destroy());
  healthy.send({ type: "ping", id: "ok" });
  assert.equal((await healthy.response("ok")).ok, true);
});

test("large snapshots respect backpressure and order live events after snapshot_end", async (t) => {
  let bridge;
  const rows = Array.from({ length: 40 }, (_, i) => ({ id: `large:${i}`, role: "tool", text: "x".repeat(512 * 1024) }));
  ({ bridge } = await fixture(t, {
    rows: () => rows,
    clientsChanged: (count) => { if (count) bridge.broadcast({ type: "notice", text: "live during snapshot" }); },
  }));
  const c = await client(bridge);
  t.after(() => c.socket.destroy());
  await eventually(() => c.frames.some((frame) => frame.type === "notice"));
  assert.equal(c.frames.filter((frame) => frame.type === "upsert").length, 40);
  assert.ok(c.frames.findIndex((frame) => frame.type === "notice") > c.frames.findIndex((frame) => frame.type === "snapshot_end"));
  assert.equal(bridge.clientCount, 1);
});

test("reject unsafe directories and symlinks", async () => {
  const directory = mkdtempSync("/tmp/sync-emacs-unsafe-");
  const link = `${directory}-link`;
  const options = { info: () => ({}), rows: () => [], prompt() {}, abort() {} };
  try {
    chmodSync(directory, 0o755);
    await assert.rejects(new Bridge({ ...options, directory }).start(), /Unsafe/);
    chmodSync(directory, 0o700);
    symlinkSync(directory, link);
    await assert.rejects(new Bridge({ ...options, directory: link }).start(), /Unsafe/);
  } finally {
    unlinkSync(link);
    rmSync(directory, { recursive: true });
  }
});

test("transcript streams in place, coalesces tools, projects branch history", () => {
  const transcript = new Transcript();
  transcript.reset([
    { id: "a", type: "message", message: { role: "assistant", content: [{ type: "text", text: "history" }] } },
    { id: "b", type: "custom_message", display: false, content: "hidden" },
    { id: "c", type: "compaction", summary: "summary" },
  ]);
  assert.equal(transcript.rows.size, 2);
  const assistant = (text) => ({ role: "assistant", timestamp: 1, content: [{ type: "text", text }] });
  const start = transcript.message(assistant(""));
  assert.equal(transcript.message(assistant("one")).id, start.id);
  assert.equal(transcript.message(assistant("one two"), true).id, start.id);
  assert.equal(transcript.rows.get(start.id).text, "one two");
  assert.notEqual(transcript.message(assistant("next")).id, start.id);
  transcript.tool({ type: "tool_execution_start", toolCallId: "t", toolName: "bash", args: { command: "ls" } });
  transcript.tool({ type: "tool_execution_end", toolCallId: "t", toolName: "bash", result: { content: [{ type: "text", text: "done" }] } });
  transcript.message({ role: "toolResult", toolCallId: "t", toolName: "bash", content: [{ type: "text", text: "done" }] }, true);
  assert.equal([...transcript.rows.keys()].filter((key) => key === "tool:t").length, 1);
  assert.equal(transcript.rows.get("tool:t").text, "done");
  assert.equal(messageRow("id", { role: "system", content: "secret" }), undefined);
  assert.equal(messageRow("id", { role: "user", content: [{ type: "image", mimeType: "image/png", data: "SECRET" }] }).text, "[image: image/png]");
  assert.match(messageRow("id", { role: "assistant", content: "x", errorMessage: "failed" }).text, /failed/);
  assert.match(messageRow("id", { role: "toolResult", toolCallId: "large", content: "x".repeat(600000) }).text, /display truncated/);
});

test("extension lifecycle, streaming, idle reconciliation, branch reset and reload", async (t) => {
  const directory = mkdtempSync("/tmp/sync-emacs-ext-");
  const previous = process.env.SYNC_EMACS_DIR;
  process.env.SYNC_EMACS_DIR = directory;
  const handlers = new Map(), calls = [], notices = [];
  const pi = {
    on: (type, handler) => handlers.set(type, handler),
    registerCommand() {}, getSessionName: () => "Test", sendUserMessage: (...args) => calls.push(args),
  };
  let entries = [], leaf = null, idle = true;
  const context = {
    mode: "tui", cwd: "/project", ui: { setStatus() {}, notify: (text) => notices.push(text) },
    model: { provider: "test", id: "fake" }, isIdle: () => idle, abort: () => calls.push("abort"),
    sessionManager: {
      getSessionId: () => "s1", getSessionFile: () => "/session.jsonl",
      getBranch: () => entries, getLeafId: () => leaf,
    },
  };
  const emit = (type, event = {}, ctx = context) => handlers.get(type)({ type, ...event }, ctx);
  extension(pi);
  t.after(async () => {
    await emit("session_shutdown");
    if (previous === undefined) delete process.env.SYNC_EMACS_DIR; else process.env.SYNC_EMACS_DIR = previous;
    rmSync(directory, { recursive: true, force: true });
  });
  assert.deepEqual(readdirSync(directory), []);
  await emit("session_start", {}, { ...context, mode: "rpc" });
  assert.deepEqual(readdirSync(directory), []);
  await emit("session_start");
  assert.deepEqual(notices, []);
  const descriptor = () => JSON.parse(readFileSync(`${directory}/${readdirSync(directory).find((name) => name.endsWith(".json"))}`));
  const old = descriptor();
  const c = await client({ socketPath: old.socket, instanceId: old.instanceId });
  t.after(() => c.socket.destroy());
  c.send({ type: "prompt", id: "send", sessionId: "s1", text: "/literal", deliverAs: "followUp" });
  await c.response("send");
  assert.deepEqual(calls[0], ["/literal", { deliverAs: "followUp", expandPromptTemplates: false }]);
  idle = false;
  await emit("agent_start");
  const message = (text) => ({ role: "assistant", timestamp: 1, content: [{ type: "text", text }] });
  await emit("message_start", { message: message("") });
  await emit("message_update", { message: message("first") });
  await emit("message_update", { message: message("first second") });
  await eventually(() => c.frames.some((frame) => frame.row?.text === "first second"));
  const midstream = await client({ socketPath: old.socket, instanceId: old.instanceId });
  t.after(() => midstream.socket.destroy());
  assert.equal(midstream.frames.filter((frame) => frame.row?.text === "first second").length, 1);
  await emit("message_end", { message: message("done") });
  entries = [{ type: "message", id: "m1", message: message("canonical transformed message") }];
  leaf = "m1";
  idle = true;
  await emit("agent_end");
  await eventually(() => c.frames.some((frame) => frame.row?.text === "canonical transformed message"));
  // Directly persisted custom messages/shell output don't always emit events.
  entries.push({ type: "custom_message", id: "custom", display: true, customType: "notice", content: "extension output" });
  leaf = "custom";
  await eventually(() => c.frames.some((frame) => frame.row?.text === "extension output"));
  entries = [];
  leaf = null;
  await emit("session_tree");
  await eventually(() => c.frames.at(-1)?.type === "snapshot_end");
  const closed = once(c.socket, "close");
  await emit("session_shutdown");
  await closed;
  assert.deepEqual(readdirSync(directory), []);
  await emit("session_start");
  assert.notEqual(descriptor().instanceId, old.instanceId);
  assert.equal(readdirSync(directory).length, 2);
});
