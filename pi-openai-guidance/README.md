# pi-openai-guidance

Automatically add model-aware OpenAI guidance to Pi's system prompt. Adapted from official OpenAI documentation, not a leaked, mandatory, or universally optimal system prompt.

## Install

From the repository root:

```sh
pi install ./pi-openai-guidance
```

Run `/reload` in an existing Pi session. This is a personal installation, active across projects. To install only for this trusted project, use `pi install --local ./pi-openai-guidance` instead. Do not install both ways unnecessarily.

Try without installing:

```sh
pi -e ./pi-openai-guidance/extensions/index.ts
```

Tested with **Pi 0.75.4**. Uses its structured `before_agent_start.systemPromptOptions.sections` API; older Pi releases without that API are not supported. No runtime dependencies, network calls, tools, or automatic changes to model settings.

## Behavior

| Selected model | Guidance |
| --- | --- |
| GPT-6.2 Astra / Sol, including dated IDs | Common guidance + GPT-6.2 adjustments |
| GPT-6 / GPT-6.1 | Common guidance + GPT-6 adjustments |
| Other identified OpenAI models | Common guidance only |
| Claude, Gemini, Qwen, etc. | No OpenAI guidance section |

Identity is recognized by an OpenAI provider (`openai`, `openai-codex`, `azure-openai`, `azure-openai-responses`), an `openai/` model namespace, or a canonical-looking bare GPT, o-series, ChatGPT, or Codex ID. This supports gateways such as OpenRouter and Copilot without treating every OpenAI-compatible API as an OpenAI model.

Opaque deployment names on known OpenAI providers get the common profile: the extension cannot infer their underlying model. Custom providers with opaque aliases are not recognized. IDs are trusted identifiers, not proof of which model a gateway actually runs. Undocumented future families get common guidance rather than speculative family-specific rules.

Guidance encourages:
- Completing authorized work instead of stopping at a plan or routine question.
- Reasonable reversible assumptions, with existing approval and delegation boundaries intact.
- Readable, narrowly scoped code and proportionate verification.
- Self-contained final answers, without over-compressing GPT-6.2's already concise output.

It does **not** authorize new actions, bypass approval, automatically delegate, change reasoning effort, replace repository rules, or promise better results on every workload.

## Commands

- `/openai-guidance` or `status`: show the selected profile and enabled state.
- `/openai-guidance show`: show only this extension's guidance, not your full system prompt.
- `/openai-guidance sources`: show official reference links.
- `/openai-guidance off` / `on`: disable or enable for this session branch.

The enabled state survives reload/resume and follows branch navigation; new sessions default to enabled. Model/profile and toggle changes affect the **next agent start**, not a request already in flight. The footer shows the selected profile when active. Prompt injection also works in print/JSON modes without UI output; inspection commands are intended for TUI/RPC.

## Prompt caching and interoperability

The extension owns one named section, `openai_model_guidance`. It leaves all other sections, tool declarations, and conversation messages alone. Repeated turns produce identical text. Pi can append section updates instead of rewriting earlier instructions; providers without incremental support may require a new prompt checkpoint.

The extension never rewrites provider payloads. Pi controls the actual system/developer role and transport. In particular, Pi's standard Responses converter can emit developer messages, while its Codex transport uses top-level `instructions` for the initial prompt. This extension does not change that Codex behavior or guarantee cache/reasoning preservation when switching models or compacting.

An extension returning an exact forced `systemPrompt` / `forceSystemPrompt` can override structured sections, including this one. The status indicator reports selection/enabled state, not proof of the final HTTP payload. A normal custom prompt prefix (`--system-prompt`) still supports the section.

## Research and validation

See [RESEARCH.md](./RESEARCH.md) for sources, model-specific findings, and deliberate adaptations.

```sh
npm test --prefix pi-openai-guidance
```

Requires Node 22.18+ for built-in TypeScript stripping. Tests cover identification, switching, idempotency, branch-scoped controls, headless execution, and Pi's real loader, prompt renderer, section diffs, and standard Responses serialization. The integration test uses the installed Pi, or `PI_PACKAGE_ROOT`, and skips explicitly if neither is available. No model calls or credentials are needed. These validate integration behavior, not model-quality improvements; compare representative tasks with guidance on/off to measure those.
