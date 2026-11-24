# OpenAI prompt guidance research

Checked **2026-11-24**. Internet search located the official guides, then the relevant pages were fetched directly from `developers.openai.com` and read. Implementation was checked against installed Pi 0.75.4 documentation, examples, and provider code.

## Official sources

1. [Using GPT-6.2: Astra / Sol](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6.2-astra)
   - Sections: Prompting best practices; Writing style; Task completion; Coding style; Frontend design; What's new; Migration quickstart.
2. [Using GPT-6 / GPT-6.1](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra)
   - Sections: Initiative and follow-through; Instruction following; Personality and writing style; Subagent delegation; Testing and verification.
3. [Prompt engineering](https://developers.openai.com/api/docs/guides/prompt-engineering)
   - Clear responsibilities, precise constraints, model-specific prompting, and reusable instructions in the initial developer message.
4. [Reasoning best practices](https://developers.openai.com/api/docs/guides/reasoning-best-practices)
   - Simple/direct instructions, clear delimiters, explicit constraints; avoid unnecessary chain-of-thought prompting.

These are live documentation URLs and can change. The implementation is a reviewed local snapshot; it never downloads and executes new prompt text automatically.

## Findings

### No mandatory universal system prompt

OpenAI calls its GPT-6.2 examples a **starting point**, suggesting specific sections when their corresponding behavior appears in an application. A larger prompt is not automatically better. Evaluate on your actual tasks. The public documentation is not the model's private internal system prompt.

### GPT-6.2 differs from GPT-6

GPT-6.2 Astra is more concise and direct by default. OpenAI explicitly recommends revisiting existing “be concise” instructions. GPT-6 Astra's earlier guide instead describes detailed, formatted answers. Therefore the extension does not apply the older style advice indiscriminately to GPT-6.2.

Both guides address premature clarification or handoff: specify the intended outcome, permit reasonable reversible assumptions, and continue authorized work until completion. Ask when truly blocked or before actions needing approval.

For GPT-6.2 coding, OpenAI recommends reusing correct existing logic, preserving callers' behavior, readable code, and avoiding unnecessary abstractions. Its example says to skip new tests unless requested, required by the repository, or needed for a specific regression existing tests miss. The extension adapts this into proportionate verification; it does not prohibit meaningful regression tests or omit required checks.

### API correctness is separate from prompting

GPT-6.2's guide warns:
- Editing earlier conversation items, certain model changes, or user/organization changes can discard reasoning items.
- Top-level Responses `instructions` is appended after `input`; stable reusable instructions belong in the first developer input message for caching.
- Tool calling on GPT-6.2 Astra/Sol requires the Responses API.
- Unsupported parameters and reasoning effort need model-appropriate API settings.

A natural-language prompt cannot implement those API requirements. The extension does not alter temperature, reasoning effort, cache parameters, model registration, or transport. Pi must provide those correctly.

## Deliberate adaptations for Pi

| Documentation recommendation | Extension decision |
| --- | --- |
| Persist and act autonomously | Only within user-authorized scope; distinguish action requests from explanation/planning requests. |
| Delegate when parallel work helps (GPT-6 guide) | Do not copy the blanket delegation instruction. Existing Pi/user authorization remains necessary. |
| Explain conflicts with skill instructions | Preserve normal instruction priority; identify an actual blocking rule rather than silently changing course. |
| Match desired writing style | Self-contained, audience-appropriate answers; preserve user length/format preferences and required technical detail. |
| Favor particular imagery / image tools | Follow project direction and available tools; do not assume ImageGen, image search, or async question tools exist. |
| Reusable developer instructions and stable prefixes | Use a deterministic structured prompt section, with no per-turn timestamp or history rewriting; leave serialization to Pi. |
| “Think step by step” unnecessary | Do not add chain-of-thought elicitation. Ask for results, evidence, and verification instead. |

The common profile includes project-safe engineering defaults; it is an adaptation across the cited guides, not an assertion that every paragraph was prescribed for every older OpenAI model. Only documented GPT-6/6.1 and GPT-6.2 families receive their respective extra adjustments.

## Pi-specific evidence and limits

Local references:
- `docs/extensions.md`: structured `before_agent_start` sections are preferred over forced full-prompt replacement; Pi can append section patches.
- `examples/extensions/prompt-customizer.ts`: the supported section-mutation pattern.
- `docs/packages.md`: local package installation and resource manifest.
- `pi-ai/dist/api/openai-responses-shared.js`: standard Responses instruction-role conversion and incremental system updates.
- `pi-ai/dist/api/openai-codex-responses.js`: Codex excludes the initial system message from input and sends it through top-level `instructions`.

Thus the extension preserves Pi's normal transcript/update machinery, but does not claim that the Codex transport implements the guide's preferred cache placement. Rewriting Codex payloads would be a separate compatibility change requiring transport-specific investigation.

Ten automated tests pass on Pi 0.75.4, including actual extension discovery, rendering, section removal, and an append-only developer-message update in standard Responses conversion. No live-model A/B evaluation was performed, and no quality improvement is claimed as measured.
