# Pi Context Lens — implementation specification

Status: original implementation contract, written before code (2026-10-23); evidence/API corrections recorded during validation below. **The approved [BROWSER_SPEC.md](BROWSER_SPEC.md) addendum now supersedes TUI-only/no-browser-listener assumptions and defines the default HTML interface.** The deterministic core and privacy/model constraints remain in force.

## 1. Scope and acceptance

Build a self-contained Pi extension, not an upstream CLI wrapper. All deliverables belong to `pi-context-lens/`; unrelated dirty files remain untouched. Target the actually installed Pi **1.2.0** (the installation directory is misleadingly named `0.75.4`). Ship no additional runtime dependencies, browser service, key reader, or model endpoint.

Goals:
- Select the current session or up to six past/current sessions across projects using a searchable, metadata-rich multi-picker.
- Inspect deterministic composition, provenance, largest contributors, cumulative recorded growth, and stable-category comparisons locally.
- Distinguish projected context, selected-branch transcript, and whole-file history. Respect compaction/context edits using Pi's own projection, without opening/resuming source sessions.
- Explicitly initiate a bounded, cancellable, single-request semantic investigation through the active Pi model registry.

Non-goals: exact request-time reconstruction, exact provider tokenization or billing estimation, history-wide semantic indexing, live monitoring, background inference, session mutations, automatic instruction editing, command execution, uploads, raw exports, persistent analysis caches, browser reports.

Acceptance evidence must cover metadata discovery across projects/overrides; lazy selection and active snapshots; concurrent/incomplete files; branches, compaction and edits; accounting labels; comparisons/growth; narrow/Unicode/control-safe UI; bounded mock inference, validation, cancellation and errors; installed extension loading and a synthetic real-terminal smoke test. Report paid inference as unverified unless explicitly exercised.

## 2. Operator journeys and commands

`/context-lens`: discover metadata with progress and Esc cancellation, then open picker. Filter by available name, ID, cwd/project, date, model, path and current marker. Arrow keys navigate, Tab toggles selection, Enter accepts, Esc exits. Display selected count, selected names and the six-session bound. Preserve selections when filtering; Ctrl+S reviews selected sessions independently of the search. Enter explicitly inspects selected sessions or the highlighted item when none are checked. No match is an empty state, not an error. Show metadata sampling limitations and unreadable-root warnings.

`/context-lens current`: select only the running session, including ephemeral sessions, without scanning disk history.

`/context-lens clear`: discard in-memory snapshots/results. Opening another selection replaces them. No automatic storage/export exists.

After selection, choose scope:
1. **Retained context** (default, internal `context`): canonical Pi projection on chosen leaf, including latest compaction and context edits. This is recorded material, not a replay of a historic provider request.
2. **Selected branch** (internal `branch`): raw entries on chosen leaf path, including summarized/omitted messages.
3. **All branches** (internal `history`): each entry once in file order, including abandoned branches; explicitly not a single conversation or active context.

For past files, infer leaf from last valid entry and label it as inferred: navigating a different running process without appending is not recoverable from JSONL. Offer an explicit alternate tree tip when inspecting a single session. For the current running session use its actual manager leaf (including a non-tip leaf). Source files are never opened through `SessionManager.open()` or migrated on disk.

Report tabs: overview, side-by-side comparison, growth by user turn, largest contributors, warnings/accounting and Details. Overview leads with totals/dominant nonzero categories; full source paths, selected entry IDs and role/type accounting move to Details. Arrows/PgUp/PgDn scroll, left/right or Tab cycle tabs, D selects a contributor and shows its provenance/local text detail, A starts the separate AI workflow, Esc closes. Preserve active tab and per-tab scroll offsets through evidence/analysis/cancellation, using page names rather than indexes. A compact current-page heading and wrapping action footer remain visible in narrow terminals. Keep raw transcript text out of default reports. Use Pi theme semantic colors consistently by category and visible-width utilities. Treat all displayed metadata/content/model output as untrusted terminal data; strip terminal control sequences.

Headless/RPC: refuse custom TUI with a clear notification, without discovery, loading or inference. Empty/missing current session shows a useful empty report. Missing/corrupt selected files yield per-file warnings while other selected reports survive. No model or unsupported projection API is a clear error, never a provider fallback.

## 3. Architecture and ownership

Main session is the sole implementation owner.

- `extensions/index.ts`: Pi command registration, session-root integration, current-manager capture, workflow orchestration, scope selection, confirmation, progress/cancellation, model route. No source mutations or Pi conversation append/send APIs.
- `lib/discovery.mjs`: dependency-free bounded file metadata enumeration and readonly file snapshots.
- `lib/core.mjs`: schema validation/tree traversal, normalized parts and provenance, stable deterministic categories, composition/usage/growth aggregates, report line builders.
- `lib/analysis.mjs`: bounded evidence selection, prompt construction, strict classification/evidence validation, one cancellable model operation injected for testing.
- `extensions/ui.ts`: searchable multi-picker, scrollable report/detail and progress components using host TUI input/width/theme utilities.
- `test/*.test.mjs`: Node built-in tests with generated synthetic fixtures; optional installed-runtime tests.
- `scripts/`: installed-runtime load/synthetic-terminal smoke verification only. Generated artifacts stay under ignored package-local directories.

Packaging follows nearby `pi-skill-lab`: ESM `.mjs` pure libraries, TypeScript extension, `node --test`, explicit `pi.extensions`, host packages declared only as peers. Pi loads TypeScript with its own loader; no build/install step for ordinary use.

## 4. Discovery and resource bounds

Native enumeration was inspected first: `SessionManager.listAll(sessionDir?, onProgress?, signal?)` exists, but `dist/core/session-manager.js:buildSessionInfo()` streams every message and builds `allMessagesText`. It is deliberately not used because discovery must be metadata-first and bounded.

Derive the ordinary cross-project root from exported `getAgentDir()` + `sessions`; this honors `PI_CODING_AGENT_DIR`. Include `ctx.sessionManager.getSessionDir()` (Pi already resolved CLI > environment > setting precedence) and current session path. Also include `PI_CODING_AGENT_SESSION_DIR` when supplied. Do not read credential/config files to discover roots. An optional command flag supplies additional explicitly known session roots; unknown custom directories cannot be magically discovered. Scan root JSONL plus one project-directory level, skip symbolic-link directories to avoid cycles/escaping roots, deduplicate canonical file paths. Current session is always pinned separately.

Read only bounded header and tail windows (16 KiB each) for metadata: header ID/cwd/date, recent name/model if present, filesystem date/size. Ignore transcript text in metadata. A name/model outside these windows is unavailable, not guessed. Cap traversal at 10,000 files and bounded directory visits; report truncation. All loops support cancellation and asynchronous filesystem access. No network or model call.

Load only selected paths, at most six, at most 32 MiB each and 64 MiB combined, at most 50,000 entries and 100,000 normalized parts per snapshot. Open readonly, capture initial file size, read exactly that prefix, close in `finally`, compare file identity/size/mtime and warn on concurrent change. Never lock, write, resume, compact or fork source files. Accept a valid final line without newline; ignore malformed trailing partial line with a warning. Interior malformed lines/duplicate IDs/missing parents/cycles/unsupported schemas are warned/skipped safely; never hang. Support tree session versions 2/3; legacy linear v1 is explicitly unsupported rather than silently mutated. Future versions are rejected until tested.

Capture the selected current session's manager entries/leaf/header in memory on explicit selection, bounded by the same limits; this handles ephemeral and not-yet-flushed state. Other running sessions use readonly file prefixes. In-memory snapshots last until clear/reselection/reload/process exit.

## 5. Normalization and algorithms

Snapshot: `{header, entries, leafId, sourcePath, capturedAt, warnings}`. Entries preserve original ID, parent ID, timestamp and file order. Walk ancestors iteratively with a seen set. Whole-history visits each unique entry once, never concatenates every root-to-tip path.

Canonical projected scope calls exported `buildSessionProjection(entries, leafId)` and retains `sourceEntry.id` for every produced message. Validate structural message/compaction/edit fields before passing to SDK. Installed 1.2.0 source/declarations require a non-null context-edit replacement shaped `{ content: string | blocks[] }`, unlike the stale examples in `docs/session-format.md` that show a bare string. Tests use the actual exported implementation contract. Explicitly exclude `bashExecution.excludeFromContext` in projected accounting (Pi's message-conversion layer handles this after projection). Branch transcript converts supported message/custom-message/summary entries; custom extension state is excluded. Whole history is a raw inventory, not a context reconstruction.

Normalized part: `{id, sessionId, entryId, partIndex, messageIndex, turn, timestamp, role, kind, category, toolName?, text, chars, bytes, estimatedTokens, attachmentBytes}`. Part IDs include session + entry + message + part ordinal. Text, recorded thinking, tool-call JSON arguments, tool-result text, system content/section deltas/tool declarations, summaries and direct bash execution are represented. Never decode images or send binary/signature payloads for analysis; track attachment count/decoded-size estimate separately. Unknown blocks are counted/warned as unavailable, not interpreted. Exclude arbitrary tool `details`/opaque signature fields and extension state from composition/inference.

Stable categories: system, user, assistant, reasoning, tool-call, tool-result:file, tool-result:shell, tool-result:search, tool-result:other, summary, extension, other. Source categories use recorded role/tool names, not semantic guesses. Stable ordering/colors apply across sessions. Role/type totals supplement categories.

Composition estimate = sum `ceil(part.text.length / 4)` (UTF-16 character heuristic), alongside UTF-8 byte/character counts. Label every view **estimated recorded text units, chars/4**, not exact Claude/GPT tokens. Images, hidden/redacted reasoning, missing system prompts/tool schemas, provider framing and runtime transformations are unaccounted. System section/tool changes are recorded payloads, not exact expanded request state. No spend calculation.

Reported usage is separate: collect assistant, nested-tool, compaction, branch-summary and standalone usage records once per raw entry in the selected branch/history; group by provider/model and operation scope. Show input/output/cacheRead/cacheWrite/total where supplied. Do not add reasoning (already in output) or cacheWrite1h (subset) again. Provider-reported usage includes repeated requests/caching and cannot be reconciled to unique composition. In projected scope, usage still refers to selected **branch accounting**, explicitly labeled, not only retained context.

Growth is cumulative normalized recorded contributions grouped by original user-message span (`turn`), not historic context-window occupancy. Show per-span delta/cumulative estimates and compaction markers/tokensBefore where recorded. Projected scope growth only describes retained contributions. Whole-history turn sequence follows file order across alternatives, labeled accordingly. Largest contributors sort normalized parts by estimate, deterministic tie-break by ID. Comparisons use identical category rows/columns and totals; never merge usage across incomparable models without labels.

## 6. Semantic investigation

Only A in the report starts preparation. Ask an investigation question (bounded length) and dimension: sources, usefulness/repetition, workflow phases, or retry/recovery overhead. Fixed allowed labels per dimension, including `unclassified`. Deterministic facts remain in local report; AI labels/answer are interpretations of the disclosed sample only.

Select deterministic, session-balanced evidence snippets from current normalized report parts, max 24 snippets, max 1,000 characters each, max 32 KiB serialized request text, further reduced against active model `contextWindow` with conservative UTF-8-byte budget plus output/framing reserve. Explicitly enumerate selected IDs, lengths, scope, omissions/truncation, and session coverage. Small models/empty text cause local refusal; no automatic chunk loops. User can inspect a readable **AI sample** and the **exact prompt/evidence locally before approval**. Preview Enter Continue advances to the separate transmission confirmation; Esc Cancel exits preparation without opening confirmation or invoking a provider. Include no images, opaque signatures, arbitrary details or full raw JSONL.

Before calling, show active provider/model ID, session names/IDs/cwds, scope, sample count, truncation/omissions, maximum output and one-call bound. Require explicit confirmation that transmission is authorized. Local inspection stays local; AI sends selected content through the configured provider (unless actually local inference). Cross-project access is not permission to transmit; running inside Pi does not establish Studist policy compliance. Configured provider must be approved for each session's information class.

Execute via `ctx.modelRegistry.streamSimple(capturedModel, context, options).result()`; registry owns authentication/provider routing. No separate endpoint/key, API key reading, provider fallback, tools, or ongoing coding-chat injection. Use system instructions to treat transcript/question as untrusted data and request JSON only. Set output cap (up to 2,048 tokens), `maxRetries: 0`, AbortSignal and timeout (90s). At most one request per explicit approval. Provider implementations may have their own operational behavior; no application retries. Disclose that virtual/custom routes can choose an underlying physical model; do not present the configured route as a guarantee of physical-model identity. Esc aborts immediately; ignore late completion. A provider error/overflow/invalid response preserves local reports; rerun requires a fresh explicit approval.

Validate JSON shape, allowed labels, unique known IDs, quote evidence present verbatim in the sent snippet and answer evidence IDs. Missing/duplicate/invalid classification becomes unclassified with warning; do not invent categories/evidence. Aggregate classification counts and estimated contributions of **sample snippets only**, not extrapolated transcript totals. Display answer and provenance with model/provider, request usage/cache if returned, sampling warnings and error/invalid classification details. Model output is never executed or automatically applied.

## 7. Data flow, storage and security

Discovery/local inspection: session files -> readonly bounded memory -> terminal. No network, telemetry, gist, uploads, hosted assets or exports. Inference: explicitly approved bounded snippets/question -> active Pi model registry -> configured provider -> transient terminal result. Model registry may perform its normal authentication/network operations on that route. No claim of fully offline inference or automatic organizational compliance.

The extension writes no runtime cache/results/raw exports and appends nothing to Pi's session. Results and selected snippets remain in memory only until clear/reload/exit. Existing original Pi transcripts, host extension logs and terminal scrollback/persistence are separate, outside this extension's control. Public upstream research downloads are development-only ignored files, never runtime dependencies. Synthetic fixtures contain only generated demonstration text. No real private session content is used in development tests.

## 8. Tests and validation

Unit: synthetic headers/tree fixtures in package-local temporary directories; metadata windows/search/extra roots/dedup/caps/cancel; files incomplete/corrupt/unreadable/disappeared/oversized/concurrent; current ephemeral capture; tree tip/missing parent/cycle/whole-history dedup; canonical projection and compaction/context-edit checks against actual installed SDK; normalization (system sections, thinking/tool/binary), usage scoping, stable comparisons/growth/provenance; prompt length/session fairness/truncation/small model; mocked inference authorization orchestration, single call, abort/timeout/provider error, invalid JSON/labels/evidence/missing records. Test network boundary by checking imports/call routes and exercising local flow with model/network stubs that fail if called.

Integration: load extension through installed SDK discovery/loader, assert command registration/no startup activity; run isolated `pi` with package-local synthetic session root/config, no MCP/extensions/context files beyond explicit extension; drive PTY through picker, comparison/report tabs, local detail and cancellation. No paid inference. Capture only synthetic terminal output under ignored package-local directories. Test UI width/control/Unicode and resize through real host TUI utilities. Clearly separate actual terminal evidence from unit-only coverage.

## 9. Attribution, delivery and limitations

Research report records exact upstream revision/npm version/source paths and original license: browser source `d776680798bde244671498f6f58da003a30fe91a`; separately verified npm CLI `0.1.1`, tarball SHA1 `b2ac0ed1db52cb9318c5105de2ced8b3d4fca99d`. No claim that npm was built from that browser revision. Adapt context-viewer's conceptual pipeline (normalize -> deterministic composition -> bounded semantic classification -> aggregate) without copying provider calls, sharing/export flows or GPT-4o tokenizer assumptions. Prefer an original implementation of Pi-specific parsing/UX; if code is copied/adapted, preserve upstream MIT notice verbatim and identify files/revision in `THIRD_PARTY_NOTICES.md`. Include own MIT `LICENSE`, package metadata and README.

Launch without installation/settings changes:

```sh
pi -e /Users/arjan.620/my-files/playground/clanker_jiken/pi-context-lens/extensions/index.ts
```

Then `/context-lens` (or `/context-lens current`) -> search/Tab/Enter -> scope -> report -> optional A -> question/dimension -> sample/exact-payload review -> Enter Continue -> authorization -> cancellable analysis. Optional installation documented but not performed: `pi install ./pi-context-lens`.

Remaining limitations are intentional and visible: metadata names/models can be missed by bounded windows; unknown custom roots need explicit flag; past leaf inferred; legacy/future formats unsupported; snapshots not live; transcript size bounds; no binary token accounting or exact context/billing reconstruction; sampling not whole-session semantic analysis; no persistent exports/cache; TUI-only UX; selected configured provider still requires independent policy approval.
