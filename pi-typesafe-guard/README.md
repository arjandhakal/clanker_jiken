# pi-typesafe-guard

A conservative Pi approval extension with optional [TypeSafe](https://docs.typesafe.ai/concepts/use-case-map) risk signals. **Human approval—not an AI verdict—controls execution.**

## Install

Requires **Pi 0.85.1 or newer** (`@earendil-works` packages) and Node 22+; tested with Pi 0.85.1 and Node 24. Your Homebrew directory name may not reflect the installed Pi version.

From this repository:

```sh
cd pi-typesafe-guard
npm ci
pi install "$(pwd)"
```

Then run `/reload` in Pi. Or test without adding it to your settings:

```sh
pi -e ./src/index.ts
```

For safety across projects, install globally rather than only in a project's `.pi` directory. Review other installed extensions; later tool-call handlers can modify arguments after this gate.

## Configure your key

The extension announces `/typesafe-guard` when loaded. Run it **without arguments**:

1. **Add / replace API key** → **OS credential store** (recommended) or **Session memory only**.
2. Paste the key into the masked terminal UI. It is not rendered or appended to chat, session entries, or a config file.
3. **Test API key** sends a fixed, non-sensitive request after confirmation.
4. **Enable TypeSafe metadata checks** opts in to API calls for this session. They may incur charges.

Key storage uses `@napi-rs/keyring`: macOS Keychain, Windows Credential Manager, or Linux Secret Service. Linux explicitly requires Secret Service; there is no silent switch to a non-persistent kernel keyring or plaintext file. A locked/unavailable store does not disable approval gates. You can explicitly choose session memory instead.

**Remove API key** clears the session key, disables remote checks, and deletes the saved OS entry. Missing keys are handled idempotently. If OS deletion fails, the UI says the saved key may still exist; unlock and retry or remove service `pi-typesafe-guard`, account `typesafe-api-key` in the OS credential manager. Removal does **not** revoke the key at TypeSafe or clear keys already loaded into other Pi processes. For compromised keys, revoke them in the [TypeSafe dashboard](https://console.typesafe.ai/settings/keys).

Other options: **Load saved key**, **Status**, **Disable TypeSafe metadata checks**. Session-memory overrides do not overwrite an older saved key. Reload/new/resume resets remote consent and drops the session-only key; the TUI loads a saved key again. No environment variable is automatically imported or exported to shell tools.

Keys are never accepted in slash-command arguments. If you accidentally paste one into ordinary chat, shell history, or an RPC command, assume that location may have recorded it and rotate it. Secure entry is TUI-only; RPC has no masked-input contract. RPC users can explicitly load a previously saved key.

## Approval policy

| Action | Default |
| --- | --- |
| Built-in `read`, canonical path inside cwd, no protected-path/argument-secret indicator | Allow |
| All `write` / `edit` calls, even ordinary local edits | Ask |
| All shell calls, including `!` / `!!`, PowerShell tool calls and RPC user bash | Ask |
| GitHub operations, including same-repo operations | Ask |
| Custom/MCP/delegation/search/network tools | Ask |
| Credential/config paths, external targets, unresolved/dangling symlinks | Ask |
| Approval-required call without UI | Block |
| Internal gate failure, input >64,000 characters | Block |

This is intentionally **not** a shell allowlist. `rm`, Python filesystem calls, shell expansion, `eval`, aliases, scripts, installers, and commands this extension cannot parse all require approval. It avoids claiming that an innocent-looking command is safe. There is no “allow always”, remembered pattern approval, or model-controlled bypass.

Prompts show local risk reasons, optional TypeSafe probabilities, and redacted arguments. **Deny is first**. Long inputs are paginated; approval is offered on the last page, not on an incomplete preview. Escape, cancellation, timeout (two minutes total), invalid replies, or missing UI deny. Detected deletion, protected paths, secret arguments, and cross-repo GitHub actions also require typing `ALLOW`. Approvals apply to one exact call; changes to arguments or a resolved file target during review invalidate approval. Prompt interactions are serialized.

For GitHub, local `remote.origin.url` is read without network access. Explicit `-R`, `--repo`, and GitHub URL targets are compared when recognized. **This is a scope hint, not identity verification.** There is no automatic `gh auth` lookup or API fetch of PR/issue authorship. Author/authority remains unverified, so same-repo edits and edits to other people's work still require approval. Unknown targeting or command syntax never allows a call automatically.

Prefer trash/reversible operations and backups when reviewing deletion requests. The extension asks; it does not silently rewrite a command or move files to trash.

## What TypeSafe receives

The documented endpoint is `POST https://api.typesafe.ai/v1/systemone`, using `jev-latest` and five independent Noul questions in one request: destruction, unrelated GitHub mutation, other-author modification, secret exposure, and uncertainty.

**Only fixed metadata categories/flags are sent**, for example:

```json
{
  "kind": "shell",
  "operations": ["deletion", "github", "github-mutation"],
  "pathScope": "unknown",
  "protectedPath": false,
  "secretIndicator": false,
  "githubScope": "different",
  "githubAuthor": "unverified"
}
```

No raw command, arbitrary tool name, prompt, path, repo name, source code, issue body, file contents, or transcript is submitted. The API key is used only in the Authorization header. Endpoint overrides and redirects are not allowed.

**Trade-off:** metadata-only assessment cannot reason about the full command or user intent; local detection can miss or mislabel categories. TypeSafe is an advisory layer here, not a comprehensive semantic command analyzer. Signals >=20% are displayed as risk/uncertainty flags; this threshold is a conservative UI heuristic, not a calibrated security guarantee. Even zero risk signals never waive local approval.

Missing/invalid keys, HTTP 401/429/529, malformed/missing answers, timeouts, and network failures fall back to explicit human review—not automatic execution. There is a six-second HTTP deadline, a 32 KiB response cap, strict answer validation, and no automatic retries. Safe built-in reads do not make API calls. This extension does not persist TypeSafe requests, responses, or approval logs.

## Security boundaries and limitations

- **Not an OS sandbox or complete DLP system.** Extensions and tools run with your user permissions. Use a VM/container, restricted network egress, least-privilege GitHub credentials, and backups for real isolation.
- An approved shell/custom/delegation call can execute arbitrary nested code. This parent gate does not see each child process action or forward child approval requests. Load/enforce protection in child runtimes separately; headless children needing approval will block.
- Other extensions' direct `pi.exec`, filesystem/network calls, package installs, background processes, unhooked runtimes, and later argument rewrites are outside this gate. Trusted RPC clients supply approval responses; it cannot prove a human clicked them.
- Symlinks are resolved and rechecked for direct file targets, but there is still a race between preflight and execution. Directory contents and shell state can change after approval. There is no filesystem transaction or rollback.
- Secret detection/redaction is heuristic. It recognizes common credential paths, token formats, key assignments, private keys, and the active TypeSafe key. Unknown/custom/encoded secrets and images may evade detection. Ordinary local reads may contain private data.
- Recognized secrets are redacted in this extension's prompts and **finalized** tool-result text/details. Earlier streaming output, tool-call arguments already recorded by Pi, truncation files, images, provider messages, and logs from other extensions are **not** scrubbed. This is not a guarantee that secrets never reach the model, disk, terminal, or network.
- OS credentials protect storage at rest, not against arbitrary code already running as your user. JS strings cannot be reliably zeroized. No plaintext fallback exists; deleting an entry is not a guarantee of forensic erasure from OS backups. Let OS save/delete operations finish; interrupted native operations may have completed even if the UI did not report success.
- Startup is non-blocking with respect to setup: it announces the command rather than repeatedly opening a wizard. No saved key is accessed automatically during RPC/print/JSON startup. API consent is never persisted.

## Validation

```sh
npm run check
npm test
npm audit
```

Tests cover policy, canonical paths, external/dangling symlinks, secret redaction, GitHub hints, API validation/failure/timeout behavior, one-shot approval, pagination, cancellation, target changes, masked entry, key lifecycle, serialization, and actual Pi RPC extension loading with a denied bash call. Tests use fake keys and mocked credential storage/API responses; the RPC smoke test makes no model/API calls.

**Not verified with a real TypeSafe key or real OS credential save/delete.** After installation, use the menu to test your key and perform a save/reload/remove round trip in your OS. Test Linux/Windows behavior on those systems before relying on persistent storage there.

See [RESEARCH.md](./RESEARCH.md) for existing permission/question extensions and sources.
