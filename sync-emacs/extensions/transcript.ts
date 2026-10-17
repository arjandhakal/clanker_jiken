// A portable text projection, not Pi's TUI renderers. Never export model signatures,
// base64 image data, tool details, or hidden custom messages. Conversation text
// itself may contain secrets; the socket is accessible only to the same OS user.
export interface Row {
  id: string;
  role: string;
  text: string;
}

const MAX_TEXT = 512 * 1024;
export function bounded(text: string): string {
  return text.length > MAX_TEXT
    ? `${text.slice(0, MAX_TEXT)}\n[display truncated by sync-emacs; see Pi/session file for the full message]`
    : text;
}

function json(value: unknown): string {
  try { return JSON.stringify(value, null, 2) ?? ""; }
  catch { return "[unserializable value]"; }
}

export function contentText(content: any): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    switch (part.type) {
      case "text": return part.text ?? "";
      case "thinking": return part.thinking ? `[thinking]\n${part.thinking}` : "";
      case "toolCall": return `[tool call: ${part.name}]\n${json(part.arguments)}`;
      case "image": return `[image: ${part.mimeType ?? "unknown"}]`;
      default: return `[${part.type ?? "unsupported content"}]`;
    }
  }).filter(Boolean).join("\n\n");
}

export function messageRow(id: string, message: any): Row | undefined {
  if (message.role === "system" || (message.role === "custom" && !message.display)) return;
  let role = message.role;
  let text = contentText(message.content);
  if (role === "toolResult") {
    id = `tool:${message.toolCallId}`;
    role = `tool: ${message.toolName ?? "unknown"}${message.isError ? " (error)" : ""}`;
  } else if (role === "bashExecution") {
    role = "shell";
    text = `$ ${message.command}\n${message.output ?? ""}\n[exit: ${message.exitCode ?? "?"}${message.cancelled ? ", cancelled" : ""}]`;
    if (message.fullOutputPath) text += `\nFull output: ${message.fullOutputPath}`;
  } else if (role === "custom") {
    role = `extension: ${message.customType}`;
  } else if (role === "compactionSummary" || role === "branchSummary") {
    text = message.summary ?? "";
  }
  if (message.errorMessage) text += `\n[error: ${message.errorMessage}]`;
  else if (message.stopReason === "aborted") text += "\n[aborted]";
  return { id, role, text: bounded(text) };
}

export class Transcript {
  rows = new Map<string, Row>();
  private active = new Map<string, string>();
  private serial = 0;

  reset(entries: readonly any[]): void {
    this.rows.clear();
    this.active.clear();
    for (const entry of entries) {
      let row: Row | undefined;
      if (entry.type === "message") row = messageRow(`entry:${entry.id}`, entry.message);
      else if (entry.type === "custom_message") {
        row = messageRow(`entry:${entry.id}`, { ...entry, role: "custom" });
      } else if (entry.type === "compaction" || entry.type === "branch_summary") {
        row = { id: `entry:${entry.id}`, role: entry.type, text: bounded(entry.summary ?? "") };
      }
      if (row) this.rows.set(row.id, row);
    }
  }

  message(message: any, end = false): Row | undefined {
    // Only one assistant message streams at a time. User/tool messages can be
    // interleaved, so keep their identities separate from that stream.
    const key = message.role === "assistant" ? "assistant"
      : `${message.role}:${message.toolCallId ?? ""}:${message.timestamp ?? ""}`;
    let id = this.active.get(key);
    if (!id) {
      id = `live:${++this.serial}`;
      this.active.set(key, id);
    }
    const row = messageRow(id, message);
    if (row) this.rows.set(row.id, row);
    if (end) this.active.delete(key);
    return row;
  }

  tool(event: any): Row {
    const starting = event.type === "tool_execution_start";
    const result = event.result ?? event.partialResult;
    const text = starting ? `[running]\n${json(event.args)}` : contentText(result?.content);
    const row = {
      id: `tool:${event.toolCallId}`,
      role: `tool: ${event.toolName}${event.parentToolCallId ? " (nested)" : ""}${event.isError ? " (error)" : ""}`,
      text: bounded(text || (event.isError ? "[tool failed]" : "[no text output]")),
    };
    this.rows.set(row.id, row);
    return row;
  }
}
