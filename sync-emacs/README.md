# sync-emacs

Attach Emacs to **an already-running Pi terminal session**, like connecting CIDER to an existing REPL. Pi still owns the conversation, tools, model, permissions, and session file. Emacs is another view and input surface—not a second agent.

## Install

Requires macOS/Linux, Emacs 27.1+ with JSON support, and Pi's `@earendil-works/pi-coding-agent` extension API (tested with Pi 1.0.4). No runtime npm or Emacs package dependencies.

### 1. Load the Pi extension

From this repository:

```sh
pi install ./sync-emacs
```

Run **`/reload` in each existing terminal Pi session** you want to attach to. New sessions load the installed package automatically. `/sync-emacs` in Pi shows the socket and connected-client count.

To try it for just one new terminal session instead:

```sh
pi -e ./sync-emacs/extensions/index.ts
```

### 2. Load the Emacs client

Add to your Emacs configuration, adjusting the path:

```elisp
(add-to-list 'load-path "/absolute/path/to/clanker-jiken/sync-emacs/emacs")
(require 'sync-emacs)

;; Optional source-buffer shortcuts:
(global-set-key (kbd "C-c p c") #'connect-pi)
(global-set-key (kbd "C-c p b") #'sync-emacs-send-buffer)
(global-set-key (kbd "C-c p r") #'sync-emacs-send-region)
```

Evaluate that configuration, then **`M-x connect-pi`**. Choose by session name, working directory, and PID. Naming sessions with Pi's `/name` makes a busy session list easier to navigate.

## Use

The read-only `*pi:…*` buffer shows branch history immediately, then live user messages, assistant text/thinking, tool calls, tool results, and streaming output. You can select and copy text normally. Markdown is displayed as text; images are placeholders.

| Where | Key / command | Action |
|---|---|---|
| Transcript | `i` / `sync-emacs-compose` | Open that session's multiline draft |
| Draft | `RET` | Insert a newline |
| Draft | `C-c C-c` | Send the draft; follow up if Pi is busy |
| Draft | `C-c C-s` | Send as steering instead |
| Transcript or draft | `C-c C-k` | Abort the session's current operation |
| Transcript | `g` | Request a fresh bridge snapshot |
| Transcript | `C-c C-d` | Disconnect Emacs, **not** Pi |
| Any source buffer | `M-x sync-emacs-send-region` | Send selected text, with an optional instruction |
| Any source buffer | `M-x sync-emacs-send-buffer` | Send accessible buffer text, with an optional instruction |
| Any source buffer | `M-x sync-emacs-associate-session` | Pin this buffer to a particular connection |

Buffer/region sends include a file/buffer name and line range. They send **unsaved edits**, respect narrowing, and do not save or modify the source file. With multiple connections you choose the destination, unless the source buffer is explicitly associated. A disconnected association never silently falls back to another session.

Messages sent from Emacs appear in the same Pi terminal conversation. Submitted terminal messages appear in Emacs too. Unsent drafts in the two editors are independent. Multiple Emacs clients can view the same session.

The default busy-session delivery is `"followUp"`. To default to steering:

```elisp
(setq sync-emacs-delivery "steer")
```

### Reconnection and delivery

- Killing the chat buffer or disconnecting does not stop Pi or abort its work.
- `connect-pi` can reconnect to the same live bridge and reload its history, including a currently streaming response.
- `/reload`, `/new`, `/resume`, `/fork`, and quitting tear down the old bridge. Reconnect to the replacement with `connect-pi`. Old transcripts/drafts are retained; copy an old draft to the new composer and reassociate source buffers explicitly.
- `/tree` navigation and compaction refresh the attached branch. Abandoned branches are not mixed into the transcript.
- A draft clears only after the bridge acknowledges dispatch, and only if you have not edited it since sending. This is **not** a model-completion acknowledgement: Pi's `sendUserMessage` API returns immediately and may report later failures in the terminal.
- After a lost connection, inspect the transcript before resending. The client never automatically retries a prompt, because the original may already have run.

## Scope of the first version

This is a **text conversation mirror**, not a terminal emulator or a complete replacement for Pi's TUI:

- Approval prompts, extension dialogs, selectors, notifications, custom widgets/renderers, and settings stay in the terminal. Live blocking extension prompts produce an Emacs notice telling you to return there.
- Slash commands, `!` shell commands, and `@file` expansion are not dispatched from Emacs. Submitted text is a literal user message. Use `send-buffer`/`send-region` for source context and the terminal for Pi commands.
- Hidden custom messages and system prompts are excluded. Custom entries with arbitrary terminal renderers cannot be reconstructed. Images show MIME-type placeholders, not image data.
- Directly persisted custom messages and terminal shell results are reconciled when Pi is idle (within about a second). Transient nested tool rows are live-only if Pi does not store them as standalone messages. Canonical history may replace live rows after a turn, including changes made by other extensions.
- Print/JSON/RPC sessions and background agents do not open bridges. Remote/SSH sessions and Windows are not supported yet.

## Local security and limits

Discovery files and Unix sockets live in **`/tmp/sync-emacs-<uid>/`**. The directory must be owned by you, mode `0700`, and not a symlink. Sockets and discovery records are mode `0600`. No TCP port, web server, shell evaluation, or extra provider credentials are involved.

**Any process running as your OS user can connect, read the mirrored conversation, submit prompts, or abort work.** Conversation/tool text may itself contain secrets. This is local-account access control, not authentication between applications. Do not share or forward this directory/socket to untrusted users. Normal Pi tool/permission policies still apply.

To override the directory, set `SYNC_EMACS_DIR` to the same short, absolute, private directory in Pi and Emacs, or set `sync-emacs-directory` on the Emacs side. Unix socket paths have a short OS limit (the extension allows up to 100 bytes). The default deliberately avoids long macOS temporary paths.

Shutdown cleans up its own files. After an unclean kill, Emacs ignores records with missing PIDs/sockets; an instance handshake prevents attaching to a different bridge by mistake. Stale records may be removed manually when their Pi process is gone.

Prompts have a 1 MiB JSON wire limit. Each displayed row is capped at 512 Ki UTF-16 code units with a visible truncation note; the underlying Pi transcript is unchanged. Snapshots stream with backpressure. Live-output backlogs are capped at 16 MiB per client, stalled snapshot writes time out after 15 seconds, and at most 16 clients may attach. A slow/malformed client disconnects without stopping Pi.

## Development

```sh
cd sync-emacs
npm test             # Node transport/lifecycle tests + real Emacs socket integration
npm run test:emacs   # ERT client tests
```

Tests make no model calls and need no credentials. Node 22.6+ with type stripping is required for the test runner; the Emacs socket test skips if Emacs is absent (`EMACS` can select its executable). The Pi runtime itself loads TypeScript using its extension loader.

See [PROTOCOL.md](./PROTOCOL.md) for the small JSON-lines protocol.
