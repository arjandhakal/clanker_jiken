# Research and design references

Inspected the official [Pi package catalog](https://pi.dev/packages), relevant GitHub READMEs, installed Pi documentation/examples, and TypeSafe's documentation. This is a feature comparison, **not** a third-party security audit. No marketplace extension was installed or executed for this research.

## Existing Pi extensions

| Resource | Relevant capabilities | Relation to this package |
| --- | --- | --- |
| [`@gotgenes/pi-permission-system`](https://pi.dev/packages/@gotgenes/pi-permission-system), [GitHub source/README](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system) | Deterministic allow/ask/deny, shell/path/MCP policies, external-path and symlink handling, session approvals, documented subagent prompt forwarding | Strong existing option for richer configurable permissions. Its README identifies it as a substantially diverged fork of `MasuRii/pi-permission-system`. Prefer evaluating it rather than expecting this initial package to match its coverage. |
| [`@juicesharp/rpiv-ask-user-question`](https://pi.dev/packages/@juicesharp/rpiv-ask-user-question), [GitHub monorepo](https://github.com/juicesharp/rpiv-mono) | Structured questionnaires the model can ask instead of guessing | Useful for agent clarification, but a voluntary question tool is not mandatory pre-execution enforcement. |
| [Pi official extension examples](https://github.com/earendil-works/pi/tree/main/packages/coding-agent/examples/extensions) | `permission-gate.ts`, `protected-paths.ts`, `question.ts`, `questionnaire.ts`, `timed-confirm.ts` | Native `tool_call` interception and `ctx.ui.select/input/custom` provide the approval UX without depending on a separately installed question tool. |
| [`cc-safety-net`](https://pi.dev/packages/cc-safety-net) | Catalog describes destructive-command and secret-file protection | Found in the catalog; not independently reviewed. |
| [`pi-interview`](https://pi.dev/packages/pi-interview) | Catalog describes an interactive interview form | Found as another question/options UX; not independently reviewed. |

A central design distinction: **asking the model to use a question tool is optional behavior; blocking the tool-call event enforces a gate.** This package uses the latter. Installing multiple permission extensions may cause repeated prompts; test the combination and review load order.

## TypeSafe integration

- [Use-case map](https://docs.typesafe.ai/concepts/use-case-map): verification, tool-call guardrails, sensitive-data checks, and harness engineering.
- [Quick start](https://docs.typesafe.ai/introduction/quickstart): endpoint, Bearer authentication, `jev-latest`, and request/answer shape.
- [HTTP API](https://docs.typesafe.ai/api): typed questions, response schema, 401/422/429/529 behavior.
- [Primitives](https://docs.typesafe.ai/primitives): independent atomic questions, batched in one call; code owns decision composition.
- [Noul](https://docs.typesafe.ai/primitives/noul): probability of a yes/no statement; no separate confidence field. Values near 0.5 indicate uncertainty, not medium severity.

The implementation batches five questions and validates every answer. It deliberately limits external state to fixed metadata, trading semantic detail for privacy. Local approval policy cannot be weakened by a model answer, missing credentials, or API failure.

## Credential storage

- [`@napi-rs/keyring`](https://github.com/Brooooooklyn/keyring-node): native credential-store binding. The installed 2.1.0 TypeScript API provides `AsyncEntry.getPassword`, `setPassword`, and `deletePassword`.
- Linux store selection is explicitly `secret-service`, avoiding the documented fallback to a kernel-memory keyring that may not persist across reboot.
- Pi's normal auth file is permission-protected storage, but this package intentionally uses the OS credential store or explicit memory-only mode instead of another plaintext config/auth file.

## Pi implementation references

Read the installed extension, TUI, package, RPC, environment-variable, and security documentation and the official permission, protected-path, and question examples. The installed Homebrew path was named `0.75.4`, but package metadata and the current npm package were **0.85.1**; development dependencies and the real RPC smoke test therefore target 0.85.1. In particular, the implementation relies on `ctx.mode`, `ctx.signal`, tool provenance, and the current UI cancellation contract.
