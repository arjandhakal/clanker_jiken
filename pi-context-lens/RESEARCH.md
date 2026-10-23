# Code Context

Research performed in the 2026-10-23 implementation session (child initially supplied an incorrect date). Bounded inspection only; no real session history or credential files read, no inference, install scripts, uploads, or project implementation. Pre-existing dirty edits/deletions were left alone. No applicable ancestor or project AGENTS.md/CLAUDE.md found in inspected paths.

## Files Retrieved

Paths below use `SDK` = `/opt/homebrew/Cellar/pi-coding-agent/0.75.4/libexec/lib/node_modules/@earendil-works/pi-coding-agent` and `UP` = `pi-context-lens/research/upstream` (these prefixes are explicitly expanded here to keep citations readable).

1. `pi-context-lens/BRIEF.md` (entire file) — operator authority and product requirements; `README.md` (1–25) — repository conventions.
2. `pi-code-viewer/package.json` (1–15), `pi-code-viewer/README.md` (1–88), `pi-code-viewer/extensions/code-viewer.ts` (1–105), `pi-code-viewer/src/viewer.ts` (1–160) — manifest, direct launch, keyboard overlay, bounded file handling, branch-aware state. No test script in this package.
3. `pi-skill-lab/package.json` (1–14), `pi-skill-lab/README.md` (1–80), `pi-skill-lab/extensions/index.ts` (1–90), `pi-skill-lab/test/lab.test.mjs` (1–65), `pi-skill-lab/test/pi-integration.test.mjs` (1–110) — ESM/node:test convention, synthetic isolated SDK loading, no-model integration test pattern. These are existing dirty operator files, not templates to modify.
4. `SDK/docs/extensions.md` (1–277), `SDK/docs/tui.md` (1–125), `SDK/docs/sessions.md` (1–66), `SDK/docs/session-format.md` (1–293), `SDK/docs/sdk.md` (1–147), `SDK/docs/packages.md` (1–129), `SDK/docs/message-types.md` (1–279), `SDK/docs/compaction.md` (1–463) — read in full across bounded outputs; current integration contracts.
5. `SDK/package.json` (1–85), `SDK/dist/index.js` (1–45), `SDK/dist/core/extensions/types.d.ts` (selected context/API declarations), `SDK/dist/core/session-manager.d.ts` (130–215, relevant static methods 378–414), `SDK/dist/core/session-manager.js` (470–635, 650–750, 1460–1530), `SDK/dist/core/model-registry.js` (1–150), `SDK/dist/main.js` (545–570), `SDK/dist/config.js` (477–528) — actual exports, storage resolution, discovery and mutation hazards.
6. `SDK/examples/extensions/qna.ts` (entire file) — direct configured-model completion with cancellable loader. `SDK/node_modules/@earendil-works/pi-tui/dist/components/select-list.d.ts` and `scroll-view.d.ts` (entire files), `SDK/node_modules/@earendil-works/pi-ai/dist/types.d.ts` (35–130, model-limit declarations 647–665) — precise UI/request options.
7. `UP/LICENSE` (1–21), `UP/src/parser.ts` (1–133), `UP/src/parsers/index.ts` (1–30), `UP/src/add-token-counts.ts` (entire file), `UP/src/static-componentisation.ts` (1–85), `UP/src/aggregation.ts` (1–279), `UP/src/segmentation.ts` (1–225), `UP/src/componentisation.ts` (46–112, 157–267) — upstream algorithms and limitations.
8. `pi-context-lens/research/npm/package/package.json` (entire file), `pi-context-lens/research/npm/package/README.md` (entire file), `pi-context-lens/research/npm/package/dist/cli.js` (25889–25891, 33229–33238, 33600–33640, 33875–34045) — actual published behavior, not inferred from browser README.

## Runtime and documentation: important mismatch resolved

- `pi --version` reports **1.2.0**. `/opt/homebrew/bin/pi` resolves to `SDK/dist/bundle/cli.js`; `SDK/package.json` also says **1.2.0**. Cellar directory name **0.75.4 is stale**, not a valid compatibility target. Local docs describe the newer runtime correctly.
- Safe offline dynamic imports verified actual `VERSION === 1.2.0` and function exports: `SessionManager`, `buildSessionProjection`, `buildSessionContext`, `parseSessionEntries`, `getAgentDir`, `getSelectListTheme`, `BorderedLoader`; TUI `Input`, `SelectList`, `ScrollView`, `Box`, `truncateToWidth`, `matchesKey` also exist.
- Public coding-agent package export is `.` (and `./rpc-entry`), not arbitrary internal subpaths. Import supported symbols from the package root. Host module mapping handles TypeScript extensions via jiti.
- Package manifest: `type: module`, `keywords: ["pi-package"]`, `pi.extensions: ["./extensions/index.ts"]`; host packages belong in peerDependencies `*`, never bundled runtime dependencies. Prefer pure `.mjs` core plus thin `.ts` integration for dependency-free node:test.

## Key Code / precise APIs

### Discovery: native API is NOT metadata-first

```ts
SessionManager.list(cwd, sessionDir?, onProgress?, signal?)
SessionManager.listAll(sessionDir?, onProgress?, signal?)
// SessionInfo: path,id,cwd,name?,created,modified,messageCount,
//              firstMessage,allMessagesText,parentSessionPath?
ctx.sessionManager.getSessionDir()
ctx.sessionManager.getSessionFile()
ctx.sessionManager.getEntries()
ctx.sessionManager.getLeafId()
ctx.sessionManager.getBranch()
```

`SDK/dist/core/session-manager.js:490–568` streams **every line of every discovered session**, collecting user/assistant text into `allMessagesText`. Concurrency is bounded (10 transcript readers, 64 discovery workers), but bytes/memory are not. Therefore simply discarding `allMessagesText` afterward does not satisfy metadata-first loading. Do not invoke this API against the operator's history during development.

Native directory semantics (`1460–1530`): no override => `getAgentDir()/sessions`, one level of encoded-project subdirectories; explicit `sessionDir` => JSONL files directly in that directory, **not recursive**, and no cwd filter in `listAll`. `list(cwd, customDir)` does filter cwd. Native all-project listing follows directory symlinks.

**MVP recommendation:** implement small read-only metadata discovery using the same directory semantics, async readdir/stat, capped concurrency, cancellable bounded header + tail reads. Header provides id/cwd/created; stat provides modified. A bounded tail can discover latest name/model when present; label these unknown if outside sampled bytes. Never imply exact message count from samples. Search name/project/path/date plus known model, not transcript text. State scan limits and skipped/unreadable counts; progressively publish metadata and permit refresh. Lazy full load only selected sessions, with explicit per-file/total byte limits.

Storage override precedence is CLI `--session-dir` > `PI_CODING_AGENT_SESSION_DIR` > merged `sessionDir` setting (`SDK/dist/main.js:550–554`). The effective current directory is available through `ctx.sessionManager.getSessionDir()`, including CLI-only overrides; do not re-read settings or auth to guess it. Discover both the standard all-project root derived from `getAgentDir()` and effective current session directory; deduplicate canonical file paths, mark source roots. This exposes defaults plus overrides explicitly rather than silently losing cross-project sessions. Standard current cwd directory will duplicate files, hence dedup required. Arbitrary other projects' configured custom roots are not globally discoverable; provide explicit extra-root input/flag and document that limitation. Do not infer arbitrary ancestors of a custom root or crawl home. Active ephemeral session must be a selectable synthetic metadata item even without a file.

### Read-only snapshots and branch/context handling

**Never `SessionManager.open(sourcePath)` just to inspect.** Constructor can mkdir; `_loadEntries` migrates old sessions and calls `_rewriteFile`; empty files can be initialized (`650–750`). Opening/resuming/forking violates the read-only requirement even if subsequent calls only read.

For the current session, clone in-memory `getEntries()` and capture `getLeafId()` together synchronously before yielding. This handles ephemeral and unsaved active leaf navigation. For selected files, open read-only, fstat once, enforce size cap, read only initial byte length, close; detect changes using post-stat and show snapshot timestamp/warning. Ignore only a malformed incomplete final JSONL line; report malformed interior lines, duplicates, missing parents, cycles and unsupported versions, rather than silently fabricating a tree. Never follow `parentSession` paths automatically. No source writes, migration rewrite, locks, watchers, or resumption.

Exported pure helpers:

```ts
buildContextEntries(entries, leafId?, byId?)
buildSessionProjection(entries, leafId?, byId?)
// { entries: [{sourceEntry, messages}], messages, thinkingLevel, model }
buildSessionContext(entries, leafId?, byId?)
parseSessionEntries(content) // permissive parsing; add own warnings/validation
```

Validate supported v3 shapes before pure projection; handle legacy in memory only (or clearly unsupported MVP warning). Preserve raw immutable entries. Use projection sourceEntry for evidence IDs. Default view should distinguish **recorded selected branch history** from **projected current context**, plus optional whole-file history explicitly counting abandoned branches. Whole-file mode is not a model request reconstruction.

Historical files do not persist a separate navigation-only leaf pointer: manager `_buildIndex` picks the last entry id (`736–750`). Use last valid entry as a **recorded-tip approximation**, expose branch leaves and explicit selection. Do not assert it is another running process's currently navigated leaf. Current in-process leaf is authoritative.

New 1.2.0 schema matters:
- `context_edit` omits/replaces earlier model-visible content; latest edit on selected branch wins. Pure projection handles it. Main-session integration validation found a documentation mismatch: installed 1.2.0 source/declarations require non-null `replacement: { content: ... }`, not the bare string in the session-format documentation example. Implementation/tests follow actual source.
- Latest compaction substitutes summary plus kept range `firstKeptEntryId`; retain-none uses compaction's own id. `branch_summary` represents abandoned-path evidence without concatenating abandoned messages.
- New `system` messages persist prompt sections and tool deltas; compactions may store complete `systemMessage` checkpoints. Older logs lack them. Report recorded system/tool data when present, but **do not promise complete exact request-time context**: runtime hooks/provider transformations, missing old prompts, truncation, hidden image/reasoning accounting remain.
- Plain custom entries, labels and `usage` are not model context. `custom_message` is. Respect `bashExecution.excludeFromContext` in context views. Unknown roles/blocks remain visible as warnings/unknown contributions.

### Pi-native semantic execution, credentials, cancellation

```ts
const model = ctx.model; // fail visibly if undefined; capture selected model
const response = await ctx.modelRegistry.complete(
  model,
  { systemPrompt: analysisInstructions, messages: [
    { role: "user", content: [{type:"text", text: boundedEvidence}],
      timestamp: Date.now() }
  ] },
  { signal: controller.signal, maxTokens: outputCap,
    maxRetries: 0, timeoutMs: timeout, maxRetryDelayMs: 1000 }
);
// provider-neutral streaming alternative:
const stream = ctx.modelRegistry.streamSimple(model, context, options);
// consume events / await stream.result(); retain terminal usage and stopReason
```

`SDK/dist/core/model-registry.js:73–85` delegates directly to configured ModelRuntime, with **request-time provider authentication**. No need to read/get/print credentials or call raw pi-ai completion with a manually extracted key. This preserves provider config/OAuth/custom endpoint routing. `qna.ts` is the smallest checked direct-call example. Registry also exposes `getApiKeyAndHeaders(model)`, but avoid it: manually transferring key/headers risks losing environment/base URL/provider behavior and is unnecessary here.

Direct completion is not `session.prompt`, `sendMessage`, `sendUserMessage`, a tool result, or `appendEntry`; it does not append analysis inputs/results to the ongoing Pi session tree. Keep reports in custom UI/memory by default. This is distinct from provider retention/logging and any host/provider diagnostics. Do not make absolute promises about all host telemetry. Existing original Pi transcripts remain persisted independently.

Use dedicated AbortController for idle commands (`ctx.signal` is often undefined); combine optional ctx signal, loader Escape, timeout and shutdown/reload cleanup. `BorderedLoader(tui,theme,label)` supplies `signal` and `onAbort` as demonstrated in qna. Catch thrown errors AND inspect terminal `stopReason` (`error`, `aborted`, `length`, unexpected `toolUse`, `deferred`); no execution of returned tool calls and no hidden retry/fallback. maxRetries is honored by providers/SDKs that support it, not a universal guarantee for arbitrary custom adapters; disclose that boundary.

`model.contextWindow` and `model.maxTokens` expose limits. Bound serialized input bytes/estimated tokens, number of sessions/segments/calls, output cap, timeout; reserve ample prompt/output margin and require user reduction on overflow. Estimates are not provider token admission guarantees. Use sequential or very low bounded concurrency, explicit progress and cancellation; never unbounded Promise.all over transcripts. Usage is in terminal AssistantMessage `usage`; report nested analysis usage separately from source session usage.

Confirmation must identify provider/model (including that a configured virtual model can route), selected sessions/branch/view, number of parts, byte estimate, truncations and question/dimensions before sending. If strict physical-model identity is required, reject virtual routes or explicitly disclose routing rather than silently treating the route as a physical provider promise. No paid call needed for development validation.

### TUI: custom searchable multiselect and scrollable report

`ctx.mode === "tui"` is required for custom screens; `ctx.hasUI` alone includes RPC which cannot render terminal components. Register `/context-lens`; return helpful headless/RPC error or deterministic textual summary only, never trigger inference from an unavailable dialog.

`ctx.ui.custom<T>((tui, theme, keybindings, done) => component)` handles lifetime; `done(result)` closes/resolves. Do not create another renderer or hide its overlay handle instead of calling done. Component contract: `render(width): string[]`, `handleInput(data)`, `invalidate()`; call `tui.requestRender()` after state changes.

`SelectList(items,maxVisible,getSelectListTheme(theme))` supports setFilter, selection callbacks and navigation but is **single-select**, not ready-made multiselect. Compose `Input` with list and own Set<canonicalPath>; provide visible checkboxes, selection count, Enter continue, Escape cancel, a toggle shortcut that does not prevent typing spaces into search. Preserve selections across filters. Rebuild labels without losing stable keys; intercept toggle/confirm before forwarding navigation/input. Propagate Focusable state to Input for IME. Picker metadata should show project/name/date/active/known model, with truncation not ambiguous basename-only rows.

`ScrollView(child,{follow:"none",overscroll:"contain"})` supports scrollBy, scrollToStart/End; viewport sizing is layout-dependent. Simpler MVP can use a custom bounded lines viewport like code-viewer, with arrows/PageUp/PageDown/Home/End, responsive rows and cache by width. Don't assume `ScrollView.render` alone supplies a height. Reports: stable category order/colors, totals/percentages, comparison columns, growth deltas, largest parts and evidence detail. Render terminal text safely: strip control sequences/OSC from untrusted names and transcript excerpts before theming, use truncateToWidth/wrapTextWithAnsi, cap per-frame rows, never dump huge transcripts into scrollback. Test narrow terminals and wide Unicode.

## Public upstream: pinned evidence, license and reuse decision

Fetched only public GitHub/npm metadata and archives under `pi-context-lens/research/`; no install or execution of downloaded code. GitHub main pinned to **d776680798bde244671498f6f58da003a30fe91a** (`research/upstream-commit.json`, archive `research/upstream.tgz`, extracted `research/upstream/`). This is a revision pin, not a claim that npm was built from that exact commit.

Registry latest is **@nilenso/context-lens 0.1.1** (`research/npm-metadata.json`); tarball URL `https://registry.npmjs.org/@nilenso/context-lens/-/context-lens-0.1.1.tgz`. Downloaded `research/npm.tgz` SHA1 **b2ac0ed1db52cb9318c5105de2ced8b3d4fca99d**, matching registry shasum. Registry integrity: `sha512-rZk6sH3JuUTtu54k+HTBdfYSxy5KkP1eh/70F91GLLzq04kk/zuXdZBvRnZc2VzBCkJy1CLHspQP6ji3/GIhlQ==` (SHA512 not separately verified). Tarball has only README/package metadata/bundled dist CLI; package declares MIT but omits a standalone LICENSE.

Actual browser-repo MIT notice in `research/upstream/LICENSE`:

> MIT License — Copyright (c) 2025 nilenso software llp

The entire notice, permission grant, inclusion condition and warranty/liability disclaimer must accompany substantial copied/adapted material, not just the line above. Copy the exact 21-line upstream LICENSE into a third-party notices file if adapting source and attribute revision and specific files in README/NOTICE. Do not infer authorship/license of every bundled CLI dependency from this repo's MIT notice.

| Area | Evidence / behavior | MVP decision |
|---|---|---|
| Parsing | `src/parser.ts`, `src/parsers/index.ts`: first matching registry parser; standard Conversation/messages/parts with IDs. Native formats include Claude/Codex/OpenCode/SWE-agent and API formats; **no Pi parser**. | Adapt normalization concepts and provenance; implement Pi-native parser, not heuristic plain-text fallback. |
| Composition | `src/static-componentisation.ts:11–85`: stable `role.partType` mapping, no inference. | Adapt directly in spirit; implement small pure role/type/tool aggregation. Copying unnecessary. |
| Counting | `src/add-token-counts.ts`: reusable `encoding_for_model("gpt-4o")`; tool name + JSON args/output; images/files skipped. | Exclude tokenizer dependency for MVP; count characters/UTF-8 bytes and clearly labeled heuristic tokens. Never equate these with exact Claude/billing/context-window tokens. |
| Segmentation | `src/segmentation.ts:14–225`: >500-token text/reasoning parts sent to OpenAI; model returns regex split patterns; trims segments, creates child IDs; skips tool results. | Adapt idea, **exclude model-produced executable regex** (ReDoS/data-loss risk). Deterministic paragraph/line/length chunks with original offsets and IDs are safer and avoid a separate paid segmentation stage. Optional validated boundary offsets later. |
| Classification | `src/componentisation.ts:46–112,157–267`: model suggests components then maps batches of 20 parts; greedy JSON extraction, parallel Promise.all, permissive labels. | Use explicit user-chosen dimensions/classes and bounded Pi calls; strict schema, allow-listed labels/IDs, evidence refs; unclassified on invalid/missing output. Reject invented IDs and distinguish interpretation from facts. |
| Aggregation/growth | `src/aggregation.ts:53–279`: sum part token weights per class, cumulative snapshots, percentages, cross-dimension tuples, CSV. Timeline repeatedly scans parts and can be quadratic. | Adapt pure arithmetic; use one-pass prefix accumulation, sampled turn checkpoints for large files. Cumulative transcript growth is not live request context growth. Compare consistent units/categories across sessions. |
| Sharing/browser | hosted viewer/export data assumptions; npm README/help requests secret gist sharing as follow-up. | Exclude hosting, gist, telemetry, remote assets, external viewer and raw export by default. Secret gist is not private authorization. |

Published CLI is materially separate from browser implementation: bundle includes analyzer sources and supports spec dimensions/colors/segmentation, files, model/base URL/API mode overrides. Defaults are OpenAI `https://api.openai.com/v1`, `gpt-4o-mini`, Responses API (chat optional); reads separate `.context-lens/.env`/environment or key flag. Requires key before analysis. `dist/cli.js:33966–34045` writes full local viewer export `/tmp/context-lens-export-<hash>.json` with mode 384 (=0600), emits analytics/errors/warnings plus hosted URL template; stdout is not solely JSON because trailing prose is printed. **No automatic gist upload in main**; upload is an instruction to the invoking agent/user, not a behavior to reproduce. Do not wrap/install this CLI.

## Architecture / implementable handoff

Keep extension small and layered:
1. `extensions/index.ts`: command/mode guard, effective current metadata and leaf capture, UI orchestration, direct registry adapter, shutdown cancellation.
2. `lib/discovery.mjs`: metadata-first root enumeration/header-tail sampler, canonical dedup, cancellation/limits/warnings.
3. `lib/snapshot.mjs`: bounded read-only immutable JSONL snapshot, validator, branch selection and provenance; injected pure SDK projection from integration avoids hardcoded SDK paths in core tests.
4. `lib/normalize.mjs`, `lib/report.mjs`: content parts including text/thinking/tool args/results/system/summary; stable categories; byte/character estimates; separate transcript/projection/usage accounting; linear growth/comparisons.
5. `lib/analysis.mjs`: deterministic chunks, question and dimension presets, bounded plan/confirmation metadata, injected completion, strict response validation, usage/progress/partial results; no file writes or provider imports.
6. `ui/`: picker/report components; ephemeral in-memory state only. Optional export/cache deferred to avoid duplicating sensitive logs.

Source usage scopes: assistant usage, nested tool-result usage, compaction/branch-summary usage and standalone usage entries may all exist. Display separately and sum exactly once; reasoning is already included in output, cacheWrite1h is a subset of cacheWrite. Never sum request input totals and label the result unique transcript tokens, nor add cache totals blindly to already inclusive totalTokens. Historical recorded cost is provider-reported metadata, not a newly calculated invoice. Images/signatures get explicit unmeasured counts/bytes; encrypted signatures are opaque, not text evidence to send.

## Start Here

Open `SDK/examples/extensions/qna.ts` first for the correct 1.2.0 direct model route and loader; then `SDK/dist/core/session-manager.js:490–568,650–750,1460–1530` before writing discovery/snapshot code. Those reveal the two easiest contract violations: full-history native enumeration and read-open migration writes.

Recommended UX: `/context-lens` -> searchable metadata multiselect -> local report/comparison -> choose branch/view/detail -> optional Analyze -> question/dimensions + exact bounded send preview -> explicit confirm -> cancellable progress -> evidence-linked interpretation. No network during discovery/local reports. One-off launch: `pi -e ./pi-context-lens/extensions/index.ts` after implementation; do not edit root settings.

## Validation, security and residual risks

- Unit fixtures only: multiple projects/custom flat roots/current ephemeral session; missing permission/removed file; incomplete tail and concurrent append/truncate; corrupt interior line; unsupported version; cycles/duplicate IDs; multiple roots/abandoned branches; latest compaction/retain-none/repeated compaction; system checkpoints/context_edit; all content block/usage types; Unicode/control sequences; stable category sums/comparison and unknown accounting.
- Mock semantic adapter tests: provider/model capture, zero calls before confirmation, exact bounded payload/provenance, no credentials in payload/logs, cancellation during batch/timeout, provider throw and error stopReason, context rejection, invalid JSON/labels/IDs, no retry/fallback/tool execution, partial result preservation, separate usage. Spy on fs/network/process APIs to assert local reports never upload or spawn.
- Load tests: many small metadata files plus large/oversized selected fixtures; assert byte/concurrency/file-count caps, prompt bounds, bounded warnings and responsive event-loop yielding. Avoid O(turns × parts) growth and full transcript copies per screen.
- SDK integration should mirror `pi-skill-lab/test/pi-integration.test.mjs:13–75`: PI_OFFLINE=1, isolated agentDir/resources/settings, SessionManager.inMemory, explicit extension path; verify loader errors, command registration, print-mode safe handling, and no source mutation. SDK import test passed here, but **extension load/TUI feature tests cannot be performed until implementation exists**.
- Real TUI smoke after implementation: synthetic sessions, no paid inference; filter/toggle across filters, cancel empty picker, compare two projects, scroll/detail/resize/narrow/wide chars, theme changes, current ephemeral selection; Escape from progress should actually abort underlying task. Test both normal and fullscreen modes. Avoid loading unrelated private session roots in smoke.
- Local inspection stays local. AI analysis transmits selected material to the **configured provider** unless it is actually local inference. Reading a session does not authorize cross-project/provider transmission; configured provider must be approved for each information class. Running inside Pi does **not establish Studist policy compliance**. Warn on confirmation/docs; never advertise automatic compliance or fully offline inference.
- Extension should add no telemetry/network route and never read credentials directly. Configured host providers may refresh credentials, route virtual models, retain data or produce diagnostics; Pi integration cannot erase those provider/host policies. Do not promise otherwise.
- No real authority blocker found. Remaining limitations to resolve in SPEC: exact byte/file/input caps, whether expose whole-history mode in MVP, explicit extra-root UX, virtual-model disclosure/rejection, legacy support vs warning. Routine choices can be bounded autonomously; do not silently weaken metadata-first or read-only guarantees.

Research artifacts are public downloads only. No implementation/tests added; no project edits beyond this research report and the explicitly permitted research download tree.
