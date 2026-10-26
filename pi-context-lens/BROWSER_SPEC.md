# Browser-first Context Lens — approved implementation addendum

This addendum supersedes the TUI-only/no-listener portions of SPEC.md. The operator approved the browser-first proposal after research into Pi Durable. All changes remain inside `pi-context-lens/`; existing unrelated dirty work is not stashed/rebased. No further installation, commit or push is implied.

## Decision and goals

`/context-lens` opens a local HTML dashboard; `/context-lens current` opens the same interface focused on the running/ephemeral session without scanning history. `/context-lens tui [current]` retains the tested terminal fallback. `/context-lens clear` closes the dashboard, revokes access and clears extension-held inspection data. Headless/RPC still refuse interactive commands before discovery/listener creation. A `--context-lens-no-open` flag prints the capability link rather than starting a browser, useful over SSH and in tests.

Pi Durable was checked at the matching `v1.2.0` source and npm metadata, plus upstream main (research revision `906e1302f94829ec7e228059199681c11faec0b0`, main package version 1.4.0). It is an experimental durable agent/task/document harness, not an HTML renderer. We do not install it or introduce a second harness, credential route, transcript store or model runner. Reuse existing deterministic core and active Pi registry directly. Future restart-safe jobs are out of scope.

## User experience

- Persistent header: Context Lens, local-only inspection state, active Pi provider/model, refresh and clear controls.
- Searchable session table: names/current marker, project, date/model, checkboxes; selected-session tray survives filtering/pagination; six-session cap and explicit Inspect selected button.
- Scope selector with plain descriptions: Retained context / Selected branch / All branches. Report-specific scope and snapshot labels remain visible even when the pending selection differs. Selected branch-tip dropdowns appear when supported; never invent another process's active leaf.
- Overview: summary cards, dominant-category bars with stable colors, meaningful empty state. Compare: stable-category side-by-side table with named sessions. Growth: locally rendered SVG per-session cumulative text chart and turn rows; clarify this is not historic active-context usage.
- Evidence: selectable largest contributors (top 30/session), local text/provenance drawer with 16,000-character cap. No transcript text in default report API/list views. Full metadata/accounting/warnings remain expandable.
- AI: question + fixed dimension -> Prepare sample (no inference) -> readable sample and expandable exact prompt -> acknowledgement that provider is authorized for all information classes -> explicit Approve and analyze. Model/provider, selected sessions/scope, sample/omission/truncation counts and limits visible before submission. Cancel/close preview sends nothing. Progress and Cancel during work; interpretations and evidence separate from deterministic report facts.
- Responsive desktop/mobile-width layout, ordinary buttons/forms, keyboard focus, visible disabled explanations and status/error region. No remote assets, fonts, analytics or scripts. No brand/framework dependencies.

## Modules and ownership

- `extensions/index.ts`: dispatch browser vs terminal commands, obtain current metadata/snapshot and model callbacks, open URL via supported `pi.exec` with fixed OS opener and generated URL only, close listener on shutdown/clear. Only the explicit browser-opening process invocation is added; transcript commands are never executed.
- `lib/web.mjs`: dependency-free Node loopback server and transient dashboard controller; imports existing discovery/core/analysis functions. Inject `project`, current metadata/snapshot, model getter and registry invocation for synthetic tests. Startup loads no sessions; discovery/loading are explicit dashboard operations.
- `public/index.html`, `public/style.css`, `public/app.js`: self-contained HTML/CSS/ES-module frontend, DOM textContent for all session/model text, CSS category palette and local SVG charts. No raw-data interpolation into HTML, inline handlers, eval or external requests.
- `test/web.test.mjs`, synthetic browser fixture script and installed-runtime tests: local API/auth/bounds/lifecycle and browser workflows. Fixtures/logs/screenshots stay under ignored `.tmp/`.

## Local protocol and scale

Bind only `127.0.0.1` on an OS-assigned port. Whitelist three static asset paths; never expose arbitrary filesystem paths. Generate 256-bit random capability per listener. Open `/` with capability in URL fragment (not HTTP query). Browser moves it into same-tab sessionStorage and removes the fragment from history; only this access token/mode may be stored, never transcript/results. Reload works while the Pi listener is alive; closing the tab clears its token storage, and closing/reloading Pi or `/context-lens clear` revokes the listener. Browser/OS session restoration may retain tab storage; revoked token remains unusable. Do not log access tokens/requests; fallback terminal link grants local inspection and the ability to explicitly approve bounded AI API requests while alive; keep it private.

API requests require `Authorization: Bearer <capability>`, exact listener Host and same-origin Origin when provided. Mutating methods additionally require the exact Origin and JSON content type. No CORS headers, no cookies, no URL/query authentication. Validate Host to block DNS rebinding, Origin to block cross-site requests, and constant-time token comparison. The threat boundary does not protect against malware running as the same OS user or a browser with compromised access to this tab.

All responses: no-store, nosniff, no-referrer, frame denial, restrictive CSP (`default-src 'none'`, self-only script/style/connect, no forms/navigation destinations needed). Static shell contains no private data and can be fetched without a token; every metadata/report/evidence/analysis API requires authentication. Cache assets in server memory only. Bound request body to 16 KiB, query length/pagination, socket/request timeouts and connection count. Static file mappings prevent traversal.

- `GET /api/state`: current model identity, latest operation/progress/error, aggregate report and latest interpretation; no raw transcript parts/snapshots/model objects/credentials.
- `GET /api/sessions?q=&offset=`: metadata page (100 rows max), filtered count, discovery warnings and current marker. Browser submits opaque catalog keys, never filesystem paths.
- `POST /api/discover`: cancellable bounded metadata discovery; current always pinned. Respect existing root resolution and traversal/file limits. No selected transcript loading/inference.
- `POST /api/report`: opaque selected keys (1–6), scope, optional known branch-tip IDs; readonly snapshots with existing 32 MiB/file, 64 MiB total, 50k entries/100k normalized-part limits. Generate report ID; aggregates, sampled growth checkpoints (up to 300), branch choices (up to 200 with warning) and contributor metadata only reach default state. Preserve local report if operation fails. UI discloses display sampling without altering totals.
- `GET /api/evidence?reportId=&id=`: known part in current report only; capped local text/provenance preview. Refuse stale report IDs.
- `POST /api/prepare`: report ID, question, dimension; use existing bounded sampler and return preview with new opaque plan ID (five-minute expiry). No inference. Captured model remains private; expose provider/id and exact extension-supplied prompt only.
- `POST /api/analyze`: plan ID plus explicit `approved: true`; refuse expired/stale/consumed plans and model-route changes. Consume plan before invoking; no double-submit/replay or retry. One model operation, same registry route/output cap/timeout and classification validation as terminal mode.
- `POST /api/cancel`: abort current local/model operation, ignore late completion, keep completed local report.
- `POST /api/clear`: abort current operation and drop report/snapshot/preview/interpretation references; catalog metadata remains available. The Pi `/context-lens clear` command additionally closes listener/revokes capability.

One operation at a time, bounded latest-job state, no queues/background batches. Browser polls only while a job runs; disconnected jobs stay bounded by cancellation/90-second inference timeout. Closing the page is not an inference cancellation guarantee: provide an explicit Cancel button and Pi clear/shutdown cleanup. Ignore late results after cancel/clear using job identity/controller. Main UI remains usable during work. Source files stay readonly; callbacks never call session.prompt/sendMessage/appendEntry.

## Data flow and privacy

Previously no listener existed. This approved change adds **loopback HTTP**, not an internet endpoint: source sessions -> Pi process -> authenticated local browser. Browser networking stays same-origin. Optional inference still sends explicitly approved snippets/question through active Pi model registry only. All original source/privacy/accounting/policy caveats remain. No durable database, export, browser transcript storage, telemetry, hosted viewer, uploads or separate provider route. Original Pi persistence, host diagnostics/browser memory and provider retention remain separate. Running inside Pi or on localhost does not establish Studist policy compliance.

## Acceptance and evidence

- Existing unit tests/canonical projection/TUI suite remain passing after terminal command aliases update.
- API tests with generated fixtures cover loopback binding, token/Host/Origin/content-type/size validation, no traversal/arbitrary path reads, metadata pagination, session selection across projects/current snapshots, scope/tips/compaction, evidence cap/stale IDs, busy/cancel/clear/shutdown, preview zero calls, explicit single-use approval, model change/expiry/error/timeout and no retry/fallback.
- Browser verification via local synthetic fixture only: session search/check/compare, overview bars, growth SVG, evidence drawer, responsive narrow viewport, provider/sample preview, approval and cancellation/error using mocked model calls. Check console/network for remote requests and XSS execution; screenshot artifacts synthetic only. No real private sessions or paid inference.
- Extension loading against installed Pi plus real terminal fallback checks; exercise browser-command startup with no-open flag where feasible. Clearly report unverified environments and no human usability study.
