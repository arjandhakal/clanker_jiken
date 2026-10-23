# Validation evidence

Implementation and confirmed usability-redesign results, 2026-10-23. Only generated synthetic session data was used; no operator session history or credential files were inspected for development. No paid inference, commit, publication or upload was performed. The initial implementation did not install/change settings; a later explicit user request registered this local package user-wide through `pi install`. This usability pass made no further settings changes.

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

**17 tests passed; 0 failures; 0 skipped** (including two nested usability regression checks). Final run approximately 1.20 seconds (cold SDK import has also taken ~20 seconds). Coverage includes:

- Multi-project/default/flat-extra roots, canonical deduplication, symbolic-link directory avoidance, metadata-only sampling, incomplete name/model metadata, metadata search, traversal caps and cancellation.
- Readonly active-file prefix with a concurrent append, unchanged source evidence, incomplete final JSONL, no-final-newline, missing/oversized files, cancellation, corrupt interior records, duplicate IDs, unsupported versions/entry types, ancestor cycles/missing ancestors.
- Distinct branch/history inventory and stable provenance/categories; recorded reasoning/tool calls/file results/images; exclusion of opaque signatures/arbitrary details; role/type totals, comparison columns, cumulative growth, usage scope and no reasoning/cache subset double count.
- **Actual installed SDK projection**, not just a mock: compaction system checkpoint, summary/retained range, latest content replacement/omission, retain-none/repeated compaction, branch summary without abandoned-path concatenation, non-tip leaf, and projected exclusion of direct bash output marked `excludeFromContext`.
- Bounded/session-balanced semantic samples, Unicode byte budget, omissions/truncation, small-model refusal, exact sent IDs/text, explicit approval gate, single invocation, no tools, zero standard retries and separate usage.
- Invalid JSON/schema/labels/evidence/IDs, duplicate and missing classifications, withheld ungrounded answer references, provider exceptions/error/length/toolUse/deferred/aborted responses, timeout and cancellation signals. No hidden fallback/retry.
- **Installed Pi extension loading** through `DefaultResourceLoader`/`createAgentSession`, with no loader errors. Headless refusal, ephemeral-current local reports/details, filtered multiselection preserving choices, empty-filter state, focus propagation and narrow rendering. These use the real SDK and a synthetic test UI adapter.
- Declined AI approval yields zero calls. Approved AI uses the actual extension's registry adapter with a fully mocked provider and displays interpretation; actual progress-component Escape aborts a hanging mock. All leave the ephemeral Pi entry tree unchanged.
- Static runtime-source boundary check rejects network/process/credential/session-open/conversation-append/file-write routes; the only inference call is the configured Pi model registry adapter. This is not a network packet capture or audit of arbitrary host extensions/providers.

A plain `npm test` without a resolvable SDK intentionally skips the two runtime tests. Do not equate that result with the full installed-runtime evidence above.

## Real terminal smoke

Command: `npm run test:tui`.

**PASS regular** and **PASS fullscreen** against the installed `pi` executable, with an isolated package-local agent directory, synthetic session roots, `PI_OFFLINE=1`, no MCP, no unrelated extensions/skills/context files, and no model calls.

Observed interaction: `/context-lens` -> filter `Smoke` -> Tab select two past sessions from different projects -> Ctrl+S selected-only review -> retained-context scope -> summary-first overview -> comparison -> growth/page scrolling -> 42-column resize with visible current-page/action hints -> local evidence -> return to Growth without losing active tab -> `/context-lens current` -> ephemeral-current report -> close. Both processes were test-owned and terminated afterward; the operator's ongoing Herdr/Pi session was not closed.

Synthetic terminal artifacts from the post-implementation smoke:

- `.tmp/tui-regular-qdoaigdp/terminal.txt` and `terminal.ansi`
- `.tmp/tui-fullscreen-puddrl15/terminal.txt` and `terminal.ansi`

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

## Packaging and boundaries

`npm pack --dry-run --ignore-scripts` checks the explicit manifest without installing or publishing. Runtime package contains only extension/libraries/docs/license notices, no downloaded research tarballs/source, fixtures, PTY logs, credentials or bundled SDK dependencies. No runtime dependencies or install scripts are declared.

All manually authored/edited deliverables are under `pi-context-lens/`. Root README/settings and sibling packages were not edited; pre-existing tracked dirty diff remains 187 files, 667 insertions and 26,942 deletions as observed at initial inspection. No staging or commits performed.

## Important validation findings and limitations

- Installed 1.2.0 source uses `context_edit.replacement = { content: ... }`; a bare-string example in the installed format docs is stale. Tests/validator follow source/declarations.
- Pi projection preserves `bashExecution.excludeFromContext` until its later message-conversion layer. Context Lens excludes those payloads in projected accounting explicitly.
- Real paid/provider inference, OAuth refresh, local inference and virtual/custom route behavior **not exercised**. Only configured-route execution with mocks was tested. Custom adapters can have behavior outside standard retry controls.
- No TypeScript compiler was available on PATH; compatibility evidence is actual jiti extension loading and runtime workflows, not a separate static typecheck.
- No real production-scale 10,000-file history, multi-process append stress, Windows, mouse, IME composition or live theme-switch test was performed. Bounds/cancellation/concurrent append have synthetic tests. Regular/fullscreen narrow/Unicode resize were exercised.
- Past/other-process leaf remains inferred; unknown custom roots need an explicit flag; bounded metadata may omit names/models; v1/future sessions and oversized inputs are refused. Estimates and sampled interpretations do not reconstruct exact requests, tokenization, invoices or whole-session semantic truth.
- Local inspection adds no network route. Optional AI transmits approved snippets/question through the configured provider unless actually local inference. This does **not** establish Studist policy compliance; approve the provider for every selected session's information class independently. Original Pi persistence, provider retention and host diagnostics remain separate.
