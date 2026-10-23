# Pi Context Lens — operator brief and implementation handoff

## Operator request

Build a Pi extension in this repository, inspired by the core of https://github.com/nilenso/context-viewer/tree/main and its @nilenso/context-lens CLI. The operator wants to select existing/current and past Pi sessions, inspect and compare context composition/growth, and ask Pi itself to analyze the selected material. No separate analysis service, standalone context-lens runtime dependency, API credential, or external viewer should be required.

This is a fresh interactive Pi session in a new Herdr tab. Work from `/Users/arjan.620/my-files/playground/clanker_jiken`, with all new deliverables confined to `pi-context-lens/`. First delegate a bounded research task to a subagent, then write a detailed SPEC, then implement and validate the extension. Do not stop at a plan if implementation is feasible.

## Authority and boundaries

- Read applicable ancestor/project AGENTS.md or CLAUDE.md instructions and inspect repository conventions first.
- This checkout is deliberately dirty: there are substantial pre-existing edits and deletions, including README.md and other extension packages. They are not yours to fix, restore, move, stage, or commit.
- Exclusive write boundary: the new `pi-context-lens/` directory. Do not edit root README/settings or sibling packages. Do not commit, push, publish, or install globally. Provide a one-off `pi -e ...` launch command for testing.
- User authorizes subagent research and implementation. Use one bounded research child first; inspect the available subagent guidance/roles and actual API. Keep editing ownership with the main session. Further delegation must earn its overhead and stay inside the same boundaries. No need for ceremonial broad fanout.
- Public upstream source can be fetched for research. Do not upload private source/session files. Do not execute upstream install scripts just to inspect source.
- Never read credential files, print keys, or copy credentials into the package. Existing Pi credential/provider resolution is the only model route.
- For development/testing, use synthetic session fixtures. Do not scan or send the contents of the operator's entire session history to a model as part of building the extension. Real transcript analysis is a runtime user-selected action.

## Stage 1 — bounded research subagent

Have a read-only research subagent inspect:

1. This repository's README and a small number of relevant existing Pi extensions, their packaging, tests, and UX conventions.
2. The installed Pi SDK, extension API, session/tree format and SessionManager, TUI components, model/provider execution API, cancellation, and usage reporting. Check `pi --version` and the actual installed exports; do not assume the documentation path's version is the running version. Main known local documentation root: `/opt/homebrew/Cellar/pi-coding-agent/0.75.4/libexec/lib/node_modules/@earendil-works/pi-coding-agent/`. Read appropriate docs fully and follow relevant cross-references (extensions, TUI, sessions/session schema, SDK, packages, examples). Resolve whether those docs match the installed runtime.
3. The public context-viewer project and @nilenso/context-lens implementation: parsing/normalization, deterministic role/type breakdown, segmentation/classification, aggregation, growth/comparison views, and exports. Identify what can be reused directly, what should be adapted, and what must not be copied (provider-specific calls, gist sharing, public hosted viewer assumptions). Preserve actual MIT notices for copied/adapted material; pin the upstream source revision in attribution. Verify the npm CLI source/metadata if code is not in the visible browser repo; do not assume README and npm implementation are identical.

Expected research output: a concise evidence-backed architecture recommendation, exact relevant APIs/source paths, limitations, and a handoff usable for SPEC.md. No writes outside the package and no implementation by the research child.

## Stage 2 — detailed SPEC before implementation

Write `pi-context-lens/SPEC.md` before code. It should be detailed enough to implement/test, not a speculative platform design. Include:

- Goals, non-goals, user journeys, slash commands, searchable multi-select session picker, progress/cancellation, and empty/error/headless behavior.
- Architecture, module ownership, data model, algorithms, exact Pi integration points, resource/scale handling, and acceptance criteria.
- Security/data-flow statement and provider behavior; distinguish local processing from configured-model inference and persistent analysis artifacts.
- Test plan, attribution/licensing, packaging, launch/install instructions, and remaining limitations.
- Resolve routine implementation decisions autonomously. Stop/ask only for a real authority/safety blocker or a product decision that cannot be reasonably bounded.

## Product requirements and useful direction

### Session discovery and selection

- Browse all discoverable Pi sessions across projects, not just this cwd; current/active sessions and past sessions must be supported. Respect configured Pi session roots/overrides instead of hardcoding one home path. Check native enumeration APIs first.
- Search/filter by sensible metadata (name, project/cwd, date, model when available), display enough metadata to select correctly, and support selecting one or several sessions for comparison. Keep discovery metadata-first and loading lazy/bounded.
- Read source sessions without modifying, resuming, compacting, forking, or locking out another active Pi process. Snapshot active files; tolerate an incomplete final JSONL line, concurrent appends, missing/unreadable sessions, and unsupported/corrupt entries with clear warnings.
- Preserve source provenance (session, entry/part IDs and turn/date as available). Handle the Pi session tree/branches intentionally: distinguish the active branch from whole-history analysis; do not blindly concatenate every branch or double count abandoned branches.

### Local deterministic core

- Normalize recorded messages, text, tool calls/results, and recorded reasoning if available. Treat session text as untrusted data, never instructions to execute.
- Show composition by role/type and useful source/tool categories, token/size contribution, largest contributors, growth by turn, and side-by-side comparisons with stable categories/colors.
- Use provider-reported usage/caching where available and label its scope. If a tokenizer/heuristic is used for content composition, label it clearly as an estimate. Never equate GPT-4o tokenization, character estimates, or transcript totals with exact Claude tokens, billed spend, or the exact active context window.
- Compaction/branch handling and missing hidden system prompts/tool schemas must be explicit. Do not claim to reconstruct request-time context from incomplete logs. Identify unavailable/unaccounted information rather than fabricating it.
- Provide a useful Pi-native TUI MVP (picker, report/detail, comparison/growth). An offline browser report is optional only if it earns its complexity; if provided, all assets must be local/self-contained, no remote scripts/fonts/analytics.

### Semantic analysis through Pi

- Reuse the active Pi session's selected provider/model through supported Pi APIs and credential resolution. No hardcoded OpenAI/gpt-4o-mini, new key, private credential reading, context-lens executable dependency, or silent provider fallback.
- Allow the user to ask an investigation question and choose/use suitable analysis dimensions (e.g. context sources; useful task evidence vs repetition; workflow phases; recovery/retry overhead). Adapt context-lens's semantic segmentation/classification/aggregation ideas where appropriate, using Pi for model inference.
- Prefer a bounded, explicit user-selected analysis operation, not dumping every selected transcript unboundedly into the ongoing coding conversation. Research a clean Pi-native model execution approach; document if analyzed material/results become part of a persisted Pi conversation.
- Make provider/model and exactly which sessions/material will be sent visible before inference; require explicit user action to initiate that analysis. Show progress, cancel, handle context limits and errors, avoid hidden retries/unbounded cost, and preserve partial local work where appropriate.
- Include provenance/evidence references and distinguish deterministic facts from model interpretations. Validate structured classifications and handle unclassified/invalid results without silently inventing labels. Model suggestions must not automatically edit project instructions or execute transcript commands.

### Privacy and organizational-policy accuracy

- No telemetry, gist creation, public publishing, hosted-viewer upload, separate model endpoint, remote assets, or network activity in discovery/local analysis. Runtime semantic inference may only use the explicitly selected Pi model route.
- Running as a Pi extension does NOT by itself establish Studist policy compliance. The configured provider must be approved for the information class of each selected session; cross-project transcripts can contain data not authorized for that provider. Session file access is not evidence of transmission authorization.
- UI/docs must state: local inspection stays local; AI analysis sends selected content to the configured provider, unless it is actually local inference. Do not market this as fully offline by default or automatically compliant.
- No automatic raw transcript export/persistence. If analysis caching/exports are needed, make scope, local path, retention/deletion and sensitive-content behavior explicit, with restrictive permissions. Prefer aggregate/provenance metadata over duplicate raw logs. Do not persist raw transcript text in fixtures or committed artifacts. Mention existing Pi transcript persistence separately from extension storage.

## Prior investigation (verify, do not treat as a substitute for research)

- Context Viewer's browser app has no transcript-storage backend; deterministic parsing/token counting/static categorization runs before pausing for a missing API key.
- Upstream semantic segmentation/classification sends transcript content to a model. Browser code uses createOpenAI with its configured key. The npm CLI 0.1.1 defaults to `https://api.openai.com/v1`, `gpt-4o-mini`, and the Responses API, but accepts base URL/model overrides.
- CLI writes local exports under /tmp with mode 0600 and prints a hosted-viewer URL template. Its README/help instruct an agent to upload a secret gist for sharing. That upload is a separate step, not an automatic CLI upload, and must not be included here.
- Upstream uses GPT-4o tiktoken encoding; that is not an authoritative tokenizer for other providers. Images/files and hidden runtime context complicate accounting.
- Pi is not currently listed as a native parser, which is part of the value of this extension.

## Stage 3 — implement, test, and report

Implement the smallest coherent package satisfying the SPEC. Add README, package metadata, tests, and proper license/attribution files. Do not merely wrap the upstream CLI or introduce its provider/sharing behavior.

Acceptance evidence should cover discovery/selection, multi-project/multi-session input, active snapshots, branches/compaction, accounting limitations, comparisons, bounded/cancellable semantic analysis with mocked Pi model calls, invalid classifications/provider errors, and the no-new-network-route/no-upload boundaries. Use the project's actual test/tool conventions. Exercise extension loading against the installed Pi runtime and perform a real TUI smoke check where feasible, using synthetic sessions and without making a paid inference call without need/authorization. Clearly report anything unverified.

On completion, leave SPEC.md and working code in `pi-context-lens/`, report the actual files and test results, a precise launch command, the expected command/interaction flow, remaining limitations, and the provider/policy caveat. Keep this Herdr Pi session open so the operator can continue interactively. Do not claim the feature is complete based only on unit tests if extension loading/TUI was not verified.
