# sync-emacs protocol v1

UTF-8 JSON objects, one per newline, over a local Unix stream socket. Newlines inside strings are JSON-escaped. Transport chunks are not message boundaries. All messages and IDs below are strings unless indicated otherwise.

## Discovery and connection

Each interactive Pi extension runtime creates `<pid>-<random>.json` and a corresponding `.sock` in `/tmp/sync-emacs-<uid>` (or `SYNC_EMACS_DIR`). Records are atomically replaced when metadata changes:

```json
{
  "protocol": 1,
  "instanceId": "12345-abc123",
  "pid": 12345,
  "socket": "/tmp/sync-emacs-501/12345-abc123.sock",
  "startedAt": "2026-01-01T00:00:00.000Z",
  "sessionId": "session-id",
  "sessionFile": "/path/to/session.jsonl",
  "name": "my project",
  "cwd": "/path/to/project",
  "model": "provider/model-id",
  "busy": false
}
```

`name`, `model`, and `sessionFile` may be absent. The directory/socket permissions are the access boundary; the instance ID is **not a secret**. PID, instance ID, and session ID are distinct: multiple instances may run in one process, and a resumed session can have a new instance.

Client's first frame, within five seconds:

```json
{"type":"hello","protocol":1,"instanceId":"12345-abc123"}
```

Server replies with `{"type":"hello","protocol":1,"session":{...}}`, followed by a snapshot. A wrong version/instance or another first-frame type gets a failed response and disconnection. Clients should wait for the initial `snapshot_end` before accepting input.

## Server frames

| Type | Fields | Meaning |
|---|---|---|
| `hello` | `protocol`, `session` | Handshake succeeded |
| `snapshot_start` | `session` | Clear the old projection and begin this branch's snapshot |
| `upsert` | `row: {id, role, text}` | Replace this row in place, or append if new |
| `snapshot_end` | — | Snapshot complete |
| `state` | `session` | Updated session metadata, including busy/idle |
| `notice` | `text` | Transient integration notice, e.g. terminal UI needs input |
| `response` | `id`, `ok`, optional `error` | Request dispatch result |

`session` has the discovery-record shape. Rows are a text projection, not raw Pi messages or ANSI/TUI output. Role labels include `user`, `assistant`, `tool: <name>`, `shell`, `extension: <type>`, and summary labels. Clients must treat all text as inert data.

A snapshot is coherent at its start; newer live events queue behind its `snapshot_end`. If a new snapshot is requested during an existing one, requests coalesce into one subsequent fresh snapshot. IDs are opaque and unique within a projection, not necessarily persisted Pi entry IDs. They can change on canonical reconciliation. A reset replaces the view; never append snapshot rows to the previous branch. Assistant/tool streaming replaces cumulative row text, coalesced to roughly 50 ms.

## Client requests

After the handshake, requests need a nonempty `id` (keep it within 128 characters). Responses echo it. Request IDs correlate responses; they do **not** provide idempotency or replay protection.

### Submit a literal user message

```json
{"type":"prompt","id":"1","sessionId":"session-id","text":"Review this code","deliverAs":"followUp"}
```

`deliverAs` must be `followUp` or `steer`. Both start a turn when idle; while busy they use Pi's corresponding queues. `sessionId` must still match the active session. Text must be nonblank; original whitespace is preserved. No slash/template/shell dispatch is requested.

### Abort

```json
{"type":"abort","id":"2","sessionId":"session-id"}
```

Calls the current extension context's `abort()`. It does not quit Pi.

### Snapshot / ping

```json
{"type":"snapshot","id":"3"}
{"type":"ping","id":"4"}
```

A snapshot uses the bridge's current projection, including in-progress rows. Canonical branch reconciliation also happens automatically while idle. Both requests receive a response.

### Dispatch response

```json
{"type":"response","id":"1","ok":true}
{"type":"response","id":"2","ok":false,"error":"Session changed; reconnect before sending"}
```

A successful prompt response means `pi.sendUserMessage` was called, **not** that a model succeeded or even that asynchronous Pi processing has completed. Model/tool failures appear in conversation rows where available; other runtime errors remain in Pi's terminal. Invalid requests are rejected without invoking Pi. A response for a malformed request object can have `id: null`; invalid JSON/oversized frames close the socket instead.

Do not resend automatically after a disconnect: dispatch may have occurred before the acknowledgement was lost. There is no server-side request deduplication.

## Lifecycle and limits

A disconnect does not cancel work. Reconnect for a new snapshot. Reload/session replacement destroys the old bridge; rediscover the replacement rather than assuming an endpoint or context is still valid. No request can execute arbitrary JavaScript or Emacs Lisp, switch sessions, or write Pi session files directly.

Client frames are limited to 1 MiB before the newline. Displayed row text is bounded at 512 Ki UTF-16 code units and includes an explicit truncation marker. Snapshot writes respect socket backpressure (15-second stall timeout); live events are queued behind them with a 16 MiB per-client backlog cap. Slow clients are disconnected rather than blocking model streaming. The server accepts at most 16 simultaneous sockets.
