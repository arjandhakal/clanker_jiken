# Validation evidence

Implementation, confirmed usability redesign and approved browser-first results, 2026-10-23. Only generated synthetic session data was used; no operator session history or credential files were inspected for development. No paid inference or transcript upload occurred. The initial implementation did not install/change settings; later explicit requests registered this local package user-wide and committed/pushed the TUI version. The browser-first implementation/validation pass made no further settings changes; Git publication is a separate, explicitly operator-requested step.

## Verified environment

- `/opt/homebrew/bin/pi --version`: **1.2.0**.
- Resolved CLI: `/opt/homebrew/Cellar/pi-coding-agent/0.75.4/libexec/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js`.
- Installed package metadata and dynamic SDK exports agree with 1.2.0, despite stale Cellar directory name.
- Node **24.22.1**; macOS POSIX PTY smoke driven through Python 3.
- `SPEC.md` was created before implementation files. `RESEARCH.md` contains the bounded read-only child's evidence and main-session API correction.

## Automated tests

Command:

```sh
cd pi-context-lens
PI_SDK_PATH=/opt/homebrew/Cellar/pi-coding-agent/0.75.4/libexec/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js npm test
```

**24 tests passed; 0 failures; 0 skipped** (including three nested installed-runtime checks). Browser-pass coverage adds authenticated HTTP APIs and actual extension browser-command startup/clear; original deterministic/TUI checks remain passing. Cold SDK import/runtime startup varies substantially, so the commands were also run separately after a combined validation timeout. Coverage includes:

- Multi-project/default/flat-extra roots, canonical deduplication, symbolic-link directory avoidance, metadata-only sampling, incomplete name/model metadata, metadata search, traversal caps and cancellation.
- Readonly active-file prefix with a concurrent append, unchanged source evidence, incomplete final JSONL, no-final-newline, missing/oversized files, cancellation, corrupt interior records, duplicate IDs, unsupported versions/entry types, ancestor cycles/missing ancestors.
- Distinct branch/history inventory and stable provenance/categories; recorded reasoning/tool calls/file results/images; exclusion of opaque signatures/arbitrary details; role/type totals, comparison columns, cumulative growth, usage scope and no reasoning/cache subset double count.
- **Actual installed SDK projection**, not just a mock: compaction system checkpoint, summary/retained range, latest content replacement/omission, retain-none/repeated compaction, branch summary without abandoned-path concatenation, non-tip leaf, and projected exclusion of direct bash output marked `excludeFromContext`.
- Bounded/session-balanced semantic samples, Unicode byte budget, omissions/truncation, small-model refusal, exact sent IDs/text, explicit approval gate, single invocation, no tools, zero standard retries and separate usage.
- Invalid JSON/schema/labels/evidence/IDs, duplicate and missing classifications, withheld ungrounded answer references, provider exceptions/error/length/toolUse/deferred/aborted responses, timeout and cancellation signals. No hidden fallback/retry.
- **Installed Pi extension loading** through `DefaultResourceLoader`/`createAgentSession`, with no loader errors. Headless refusal, ephemeral-current local reports/details, filtered multiselection preserving choices, empty-filter state, focus propagation and narrow rendering. These use the real SDK and a synthetic test UI adapter.
- Declined AI approval yields zero calls. Approved AI uses the actual extension's registry adapter with a fully mocked provider and displays interpretation; actual progress-component Escape aborts a hanging mock. All leave the ephemeral Pi entry tree unchanged.
- Runtime-source boundary check allows only the approved loopback HTTP listener, fixed OS browser openers (`open`, `xdg-open`, `rundll32`) with generated URLs and the existing Pi registry model route. It rejects arbitrary external network/process/credential/session-open/conversation-append/file-write routes. Browser source forbids HTML injection/eval/raw-data persistent storage. This is not a packet capture or audit of arbitrary host extensions/providers.

A plain `npm test` without a resolvable SDK intentionally skips the two runtime tests. Do not equate that result with the full installed-runtime evidence above.

## Real terminal smoke

Command: `npm run test:tui`.

**PASS regular** and **PASS fullscreen** against the installed `pi` executable, with an isolated package-local agent directory, synthetic session roots, `PI_OFFLINE=1`, no MCP, no unrelated extensions/skills/context files, and no model calls.

Observed terminal fallback interaction: `/context-lens tui` -> filter `Smoke` -> Tab select two past sessions from different projects -> Ctrl+S selected-only review -> retained-context scope -> summary-first overview -> comparison -> growth/page scrolling -> 42-column resize with visible current-page/action hints -> local evidence -> return to Growth without losing active tab -> `/context-lens tui current` -> ephemeral-current report -> close. Both processes were test-owned and terminated afterward; the operator's ongoing Herdr/Pi session was not closed.

Synthetic terminal artifacts from the post-implementation smoke:

- `.tmp/tui-regular-wly53kyx/terminal.txt` and `terminal.ansi`
- `.tmp/tui-fullscreen-435dwty7/terminal.txt` and `terminal.ansi`

These are ignored, local-only development artifacts; reruns create new directories. No raw operator transcript is present. The smoke drives keys and checks output markers; it is not a visual accessibility audit or exhaustive interactive QA.

## Confirmed usability redesign

The operator confirmed the six-item dry-run proposal with “fix it.” All six changes were applied inside the package:

| Fix | Before -> after | Evidence |
|---|---|---|
| Report return position | Recreated Overview -> remembered page plus per-page scroll offsets | Real terminal returns from evidence to Growth; installed-SDK regression recreates report and restores page/offsets. |
| Narrow navigation | Truncated tab strip/actions -> current-page heading and width-aware action footer | Regular/fullscreen PTY at 42 columns; host `visibleWidth` checks at 20/42/80 columns. |
| Overview scanning | Paths/caveats/zero rows -> totals and dominant nonzero categories; full accounting in Details | Pure report regression verifies ordering, suppressed zero categories, and retained source/accounting detail. |
| Scope language | Projected/branch transcript/whole history -> Retained context/Selected branch/All branches with explanations; user-turn labels | Rendered scope/report text in PTY; underlying scope/projection algorithms unchanged. |
| Selection visibility | Hidden checked items under filtering -> selected-name tray, explicit inspect action, Ctrl+S selected-only review | SDK adapter verifies selection tray/review across filters; real terminal exercises selected-only list. |
| AI preview cancellation | Esc advanced to approval -> Esc cancels; explicit Enter Continue opens the separate approval | Installed-SDK regression verifies zero confirmations/provider calls on preview Esc; readable sample plus exact payload remain available. |

Privacy gates, source snapshots, estimates, classification validation, inference bounds, model routing and no-persistence behavior are unchanged. AI remains mock-tested only; no real inference used. Source copies were recorded under ignored `.tmp/usability-before/` before editing; no write failure required restoration.

Sync record: repository/origin/main and dirty status checked. Stash/fetch/rebase were **skipped** to honor the operator's explicit prohibition against moving unrelated pre-existing changes; no Git worktree mutation or remote sync occurred. Human task-test/reader understanding remains unconfirmed; this is source plus synthetic-runtime verification, not a human usability score claim.

## Browser-first verification

Approved architecture/security details are in `BROWSER_SPEC.md` (written before browser implementation). Pi Durable v1.2.0 was researched, not installed: it provides durable tasks/state, not an HTML renderer. The active Pi model registry remains the only inference route.

**Local browser smoke passed** against `scripts/browser-fixture.mjs` with the installed SDK's canonical projection and an entirely mocked model. Reproducible Playwright function: `scripts/browser-smoke.js` (execute via browser_run_code after opening the fixture's private URL). Verified:

- Search, cross-filter multi-selection, selected tray, two-project inspection, overview bars, named comparison columns and two-series growth SVG.
- Local evidence modal/provenance and return to the same report section.
- Preview Escape yields zero analysis requests; authorization acknowledgement plus explicit button makes one request.
- Mocked cancellation aborts the provider; a subsequent mocked provider failure does not retry or erase deterministic reports. Retained interpretations carry their original question.
- Responsive 375px layout without page-wide horizontal overflow, page reload with capability/selection recovery, and explicit clear removes report/preview/result/evidence DOM.
- A synthetic session name containing an external image/onerror payload remains literal text, creates no image and executes no JavaScript. All observed browser requests were same-origin loopback; browser console/page errors were zero.
- Mock counters: three explicitly approved calls (one success, one cancelled, one intentional provider error), one abort. **No real provider was called.**

Browser artifacts: `.tmp/browser-overview.png`, `.tmp/browser-growth.png`, `.tmp/browser-mobile.png`, synthetic fixture/counter directories, and relocated browser-tool logs under `.tmp/playwright-browser-logs/`. These are ignored and not packaged. Development fixture process is shut down after verification; screenshots do not imply a still-running dashboard.

New API tests cover token/strict Bearer, Host/Origin/JSON/size checks, no-store/CSP, no CORS, fixed static mappings, unknown path rejection, metadata-only discovery/pagination, multi-project/ephemeral snapshots, branch choices, partial missing-file warnings, stale evidence/report/plan IDs, single-use approval, model-route changes, expiry, busy state, abort/clear/shutdown and provider errors without retry. Installed-runtime browser-command check uses `--context-lens-no-open` to avoid starting an actual desktop browser; `/context-lens clear` revokes its HTTP listener. Automatic OS browser launching is therefore source-checked, not exercised on the operator's desktop.

## Packaging and boundaries

`npm pack --dry-run --ignore-scripts` checks the explicit manifest without installing or publishing. Runtime package contains only extension/libraries/docs/license notices, no downloaded research tarballs/source, fixtures, PTY logs, credentials or bundled SDK dependencies. No runtime dependencies or install scripts are declared.

All manually authored/edited deliverables are under `pi-context-lens/`. Root README/settings and sibling packages were not edited in this pass; the unrelated tracked dirty diff remains 187 files, 667 insertions and 26,942 deletions as observed at initial inspection (excluding this package's new changes). No staging or commits performed during the browser-first pass.

## Important validation findings and limitations

- Installed 1.2.0 source uses `context_edit.replacement = { content: ... }`; a bare-string example in the installed format docs is stale. Tests/validator follow source/declarations.
- Pi projection preserves `bashExecution.excludeFromContext` until its later message-conversion layer. Context Lens excludes those payloads in projected accounting explicitly.
- Real paid/provider inference, OAuth refresh, local inference and virtual/custom route behavior **not exercised**. Only configured-route execution with mocks was tested. Custom adapters can have behavior outside standard retry controls.
- No TypeScript compiler was available on PATH; compatibility evidence is actual jiti extension loading and runtime workflows, not a separate static typecheck.
- No real production-scale 10,000-file history, multi-process append stress, Windows, mouse, IME composition or live theme-switch test was performed. Bounds/cancellation/concurrent append have synthetic tests. Regular/fullscreen narrow/Unicode resize were exercised.
- Past/other-process leaf remains inferred; unknown custom roots need an explicit flag; bounded metadata may omit names/models; v1/future sessions and oversized inputs are refused. Estimates and sampled interpretations do not reconstruct exact requests, tokenization, invoices or whole-session semantic truth.
- Browser inspection now adds an explicitly approved authenticated loopback HTTP route; it adds no internet endpoint. Only token/mode are kept in same-tab sessionStorage; no transcript/results are persisted there. Same-user malware/compromised browser and browser/OS session restoration remain outside the boundary. Optional AI transmits approved snippets/question through the configured provider unless actually local inference. This does **not** establish Studist policy compliance; approve the provider for every selected session's information class independently. Original Pi persistence, provider retention and host diagnostics remain separate.
