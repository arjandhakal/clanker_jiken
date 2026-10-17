import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Bridge, type SessionInfo } from "./bridge.ts";
import { Transcript, type Row } from "./transcript.ts";

export default function syncEmacs(pi: ExtensionAPI) {
  let ctx: ExtensionContext | undefined;
  let bridge: Bridge | undefined;
  const transcript = new Transcript();
  const dirty = new Map<string, Row>();
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let lastLeaf: string | null = null;
  let lastState = "";
  let waitingForUI = false;

  function info(): SessionInfo {
    if (!ctx) throw new Error("No active Pi session");
    return {
      sessionId: ctx.sessionManager.getSessionId(),
      sessionFile: ctx.sessionManager.getSessionFile(),
      name: pi.getSessionName(), cwd: ctx.cwd,
      model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
      busy: !ctx.isIdle(),
    };
  }

  function status() {
    ctx?.ui.setStatus("sync-emacs", bridge ? `Emacs: ${bridge.clientCount}` : undefined);
  }

  function flush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = undefined;
    for (const row of dirty.values()) bridge?.broadcast({ type: "upsert", row });
    dirty.clear();
  }

  function emit(row: Row | undefined, streaming = false) {
    if (!bridge || !row) return;
    if (streaming) {
      dirty.set(row.id, row);
      if (!flushTimer) {
        flushTimer = setTimeout(flush, 50);
        flushTimer.unref();
      }
    } else {
      flush();
      bridge.broadcast({ type: "upsert", row });
    }
  }

  function state() {
    if (!bridge) return;
    const value = JSON.stringify(info());
    if (value !== lastState) {
      lastState = value;
      bridge.publish();
      bridge.state();
    }
  }

  function reset() {
    if (!ctx || !bridge) return;
    flush();
    transcript.reset(ctx.sessionManager.getBranch());
    lastLeaf = ctx.sessionManager.getLeafId();
    bridge.snapshot();
    state();
  }

  async function stop() {
    clearInterval(pollTimer);
    pollTimer = undefined;
    clearTimeout(flushTimer);
    flushTimer = undefined;
    dirty.clear();
    const previous = bridge;
    bridge = undefined;
    await previous?.stop();
    status();
    ctx = undefined;
  }

  pi.on("session_start", async (_event, context) => {
    await stop();
    // Do not expose print runs, RPC processes, or background subagents.
    if (context.mode !== "tui") return;
    ctx = context;
    transcript.reset(context.sessionManager.getBranch());
    lastLeaf = context.sessionManager.getLeafId();
    lastState = "";
    waitingForUI = false;
    const candidate = new Bridge({
      info, rows: () => transcript.rows.values(),
      prompt: (text, delivery) => {
        // Always specify delivery, even if apparently idle: another client or
        // terminal input can start a turn before Pi finishes processing it.
        pi.sendUserMessage(text, { deliverAs: delivery, expandPromptTemplates: false });
      },
      abort: () => ctx?.abort(), clientsChanged: status,
    });
    try {
      await candidate.start();
      bridge = candidate;
      status();
      state();
      pollTimer = setInterval(() => {
        try {
          // Some persisted display messages (! shell output, custom messages)
          // bypass extension message events. Reconcile against the canonical
          // branch when idle, also picking up later message_end transforms.
          if (ctx?.isIdle() && ctx.sessionManager.getLeafId() !== lastLeaf) reset();
          state();
        } catch (error) {
          ctx?.ui.notify(`sync-emacs: ${error}`, "error");
          void stop();
        }
      }, 1000);
      pollTimer.unref();
    } catch (error) {
      await candidate.stop();
      bridge = undefined;
      context.ui.notify(`sync-emacs could not start: ${error}`, "error");
    }
  });
  pi.on("session_shutdown", stop);
  pi.on("session_tree", (_event, context) => { ctx = context; reset(); });
  pi.on("session_compact", (_event, context) => { ctx = context; reset(); });
  pi.on("session_info_changed", (_event, context) => { ctx = context; state(); });
  pi.on("model_select", (_event, context) => { ctx = context; state(); });
  pi.on("agent_start", (_event, context) => { ctx = context; state(); });
  pi.on("agent_end", (_event, context) => { ctx = context; flush(); state(); });
  pi.on("agent_settled", (_event, context) => { ctx = context; state(); });
  pi.on("message_start", (event, context) => {
    ctx = context;
    if (bridge) emit(transcript.message(event.message));
  });
  pi.on("message_update", (event, context) => {
    ctx = context;
    if (bridge) emit(transcript.message(event.message), true);
  });
  pi.on("message_end", (event, context) => {
    ctx = context;
    if (bridge) emit(transcript.message(event.message, true));
  });
  const toolEvent = (event: any, context: ExtensionContext) => {
    ctx = context;
    if (bridge) emit(transcript.tool(event), event.type === "tool_execution_update");
  };
  pi.on("tool_execution_start", toolEvent);
  pi.on("tool_execution_update", toolEvent);
  pi.on("tool_execution_end", toolEvent);
  pi.on("ui_prompt_start", (event) => {
    waitingForUI = true;
    bridge?.broadcast({ type: "notice", text: `Pi needs input in its terminal: ${event.title ?? event.kind}` });
  });
  pi.on("ui_prompt_end", () => {
    if (waitingForUI) bridge?.broadcast({ type: "notice", text: "Terminal dialog closed." });
    waitingForUI = false;
  });
  pi.registerCommand("sync-emacs", {
    description: "Show the Emacs bridge status and socket path",
    handler: async (_args, context) => {
      context.ui.notify(bridge
        ? `sync-emacs: ${bridge.clientCount} client(s)\n${bridge.socketPath}\nIn Emacs: M-x connect-pi`
        : "sync-emacs is not running (TUI sessions only). Check startup errors and /reload.", "info");
    },
  });
}
