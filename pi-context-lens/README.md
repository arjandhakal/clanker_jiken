# Pi Context Lens

Inspect Pi session composition, growth and comparisons in a **local HTML dashboard opened from Pi**. Local inspection requires no model call, hosted viewer, API key or context-lens executable. Optional AI investigation uses your active Pi provider/model route only, after preview and explicit approval. The terminal interface remains available as a fallback.

Tested with **Pi 1.2.0 / Node 24.22.1**. The local Homebrew directory named `0.75.4` contains 1.2.0; version numbers were verified against the running CLI and installed exports. Other versions are unverified, especially older forks without `buildSessionProjection` or registry streaming.

## Try it without installation

From this repository, or any other project:

```sh
pi -e /Users/arjan.620/my-files/playground/clanker_jiken/pi-context-lens/extensions/index.ts
```

No settings changes or npm install are needed for the one-off command. To register it user-wide, run `pi install ./pi-context-lens`; it loads from this checkout. After source updates, use `/reload` in existing Pi sessions.

## Browser interaction

1. Run `/context-lens` to open the dashboard in your default browser. `/context-lens current` opens the running/ephemeral session directly, without scanning history.
2. Search by available name, project/cwd, ID/path, date or model. Check up to six sessions; the selected-session tray survives filtering and pagination. Choose **Retained context**, **Selected branch** or **All branches**, then **Inspect selected**.
3. Explore **Overview** composition bars, **Compare** side-by-side totals, **Growth** charts and **Evidence** contributor details. **Details** contains provenance, branch selection and accounting limits. Growth charts display up to 300 checkpoints per session; full contributions still determine totals. Evidence text is previewed locally, capped at 16,000 characters.
4. Optional **Ask Pi**: enter a question, choose a dimension, and **Prepare sample**. Nothing is sent yet. Review the readable snippets and expandable exact prompt. Acknowledge that the displayed provider is approved for every selected session's information class, then explicitly **Approve and analyze**. Cancel/close/Escape in the preview sends nothing.
5. Use **Cancel operation** during discovery, inspection or inference. A cancelled/failed investigation leaves the completed local report intact; previous interpretations retain their original question label. No tool execution or project changes can result.

**Clear report** aborts current work and drops inspection/preview/result data from server state and report DOM, while retaining catalog metadata for further selection. `/context-lens clear` additionally closes the listener and revokes all dashboard links. Closing the browser tab is **not** a guaranteed cancellation; cancel explicitly. Listener/data otherwise last until Pi shutdown/reload or clear. Headless/RPC commands refuse before reading sessions or starting a listener.

For a manual link instead of automatic browser opening:

```sh
pi -e ./pi-context-lens/extensions/index.ts --context-lens-no-open
```

Then `/context-lens`; keep the printed access link private. On SSH, the browser must be able to reach the loopback port on the Pi host (for example through an explicitly configured SSH forward); no public binding is offered.

### Terminal fallback

Run `/context-lens tui` or `/context-lens tui current`. **↑/↓** navigate, **Tab** toggles selection, **Ctrl+S** reviews selected sessions and **Enter** inspects. In reports, **←/→ or Tab** changes sections, **↑/↓/PgUp/PgDn/Home/End** scrolls, **D** opens evidence and **A** prepares AI analysis. Returning from detail preserves position. Preview **Enter Continue** opens separate transmission approval; **Esc Cancel** exits preparation.

## What the reports mean

- Stable categories include system/user/assistant, recorded reasoning, tool calls, file/shell/search/other tool results, summaries and extension messages. Role/type totals, largest parts, source IDs and dates are available.
- **Estimated recorded text units = sum of ceil(UTF-16 characters / 4)**, with UTF-8 bytes shown separately. These are not exact provider tokens, Claude tokens, billed spend, or context-window occupancy. Binary images are counted separately without token claims. Signatures, arbitrary tool details and extension state are excluded.
- **Growth** is cumulative selected recorded text by original user-message span. It is not a reconstruction of each historic API request. Compaction markers show recorded `tokensBefore` where available.
- **Provider-reported usage** is separate branch accounting (whole-file in history mode), grouped by recorded model/provider and operation: assistant, nested-tool, compaction, branch summary or standalone usage. It includes repeated requests and caching; it cannot be reconciled to unique transcript composition. Reasoning/cache subsets are not added twice.
- **Retained context** uses Pi's canonical projection, with compaction checkpoints/summaries, retained messages and context edits. **Selected branch** includes raw summarized/omitted entries on that path. **All branches** counts each entry once, including alternatives; it is not a conversation to replay.
- The current process's leaf is authoritative. Past/other-process leaf is inferred from the last persisted entry; unrecorded navigation elsewhere cannot be recovered. Old logs may lack system prompts/tool schemas. Runtime hooks, provider conversion, hidden reasoning and image accounting prevent exact request reconstruction even in newer logs.

## Discovery and bounds

Discovery reads only a 16 KiB header/tail sample per file, not every transcript. Names/models outside those windows may be unavailable. Search never indexes message bodies. Sessions are loaded lazily after selection.

Roots include `getAgentDir()/sessions` (honoring `PI_CODING_AGENT_DIR`), Pi's effective current session directory (CLI/env/setting precedence already resolved by Pi), the session-directory environment override, and explicitly supplied extra roots. Root JSONL and one project-directory level are scanned; symbolic-link directories are skipped. Canonical file paths are deduplicated. Arbitrary custom roots configured for other projects are not globally discoverable; supply them explicitly:

```sh
pi -e ./pi-context-lens/extensions/index.ts \
  --context-lens-roots '/path/to/extra-sessions:/path/to/another-root'
```

The separator is the platform path delimiter (`:` on macOS/Linux). No home-directory crawl or parent-session-file traversal occurs.

Limits: 10,000 discovery candidates / 2,000 directories, six selected sessions, 32 MiB per snapshot / 64 MiB combined, 50,000 entries and 100,000 normalized parts per session. Source files are readonly prefix snapshots without locks or migration. Concurrent changes, incomplete final JSONL, corruption, unsupported entries and limit failures produce warnings/errors, not source rewrites. Tree formats v2/v3 only; v1 and future versions are rejected.

AI investigation is **sample-based**, not whole-transcript analysis: at most 24 session-balanced snippets, 1,000 characters each, 32 KiB total prompt text including instructions, further reduced for model context limits. Preview discloses selected IDs, scope, truncation and omissions. One request per approval, at most 2,048 output tokens (or model maximum), 90-second timeout, standard provider retries disabled. Overflow/provider failure requires a fresh approval; no automatic retry/fallback. Invalid/missing/duplicate classifications remain unclassified; invalid answer references cause the answer to be withheld. Sample label totals never imply whole-session totals.

## Privacy and provider policy

**Local inspection stays local. AI analysis sends the approved content/question to the configured Pi provider unless it is actually local inference.** The configured route is shown; virtual/custom routes may choose an underlying physical model and have adapter-specific behavior. No extra model endpoint, credential reader, telemetry, gist, upload, hosted asset or publishing route is added by this extension.

Running inside Pi does **not** establish Studist policy compliance. A configured provider must be approved for the information class of **every** selected session. Reading cross-project files is not permission to transmit them.

The dashboard adds authenticated **loopback HTTP** (`127.0.0.1`, random port), not an internet endpoint. All assets are bundled; APIs require an unguessable capability, exact local Host and appropriate same-origin checks. No CORS, cookies, arbitrary filesystem route or browser-held model credentials. The access token starts in the URL fragment, is removed from history and kept in same-tab sessionStorage for reloads; only token/mode are stored there, never transcripts/results. Browser session restoration may retain tab storage; clear/reload/shutdown revokes the old server/token. Same-user malware or a compromised browser is outside this boundary.

The extension does not append prompts/results to the ongoing Pi conversation or write duplicate transcripts/results. Selected material lives in Pi/browser memory until replaced/cleared/reload/exit. One dashboard inspection/job is shared by tabs connected to the same Pi listener; stale report/preview IDs and changed model routes are rejected. Original Pi transcripts, terminal scrollback, browser/host diagnostics and provider retention remain separate. Do not treat in-memory display as a guarantee against host logging or screenshots.

## Development and evidence

```sh
cd pi-context-lens
npm test
# Include installed-runtime projection/loader/UI orchestration tests:
PI_SDK_PATH=/opt/homebrew/Cellar/pi-coding-agent/0.75.4/libexec/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js npm test
# Isolated real terminal fallback checks; no inference or private sessions:
npm run test:tui
# Synthetic browser fixture (mock model only); prints its private local URL:
PI_SDK_PATH=/path/to/pi/dist/index.js npm run dev:browser
```

Tests create only synthetic data under ignored `.tmp/`, and remove unit-test directories afterward. PTY smoke artifacts are retained under `.tmp/tui-*` for inspection; delete those directories when no longer needed. Public upstream research downloads are ignored under `research/`; neither directory is distributed in the package. No install scripts or paid inference are required. Runtime tests skip explicitly when the SDK is unavailable; a default unit-only pass is not evidence of installed-runtime compatibility.

See [`VALIDATION.md`](VALIDATION.md) for actual results and unverified items, [`BROWSER_SPEC.md`](BROWSER_SPEC.md) for the approved browser/security contract, [`SPEC.md`](SPEC.md) for the original deterministic-core contract, and [`RESEARCH.md`](RESEARCH.md) for the initial research handoff. Pi Durable was investigated but is not required or installed: it supplies durable agent state, not an HTML renderer, and a second harness/store is unnecessary here. Installed source validation found one stale-doc example: 1.2.0 context-edit replacements use `{content: ...}`, not a bare string.

## Attribution

Inspired by [nilenso/context-viewer](https://github.com/nilenso/context-viewer), pinned research revision `d776680798bde244671498f6f58da003a30fe91a`, and independently inspected npm CLI `@nilenso/context-lens@0.1.1`. Original Pi-specific implementation; no upstream tokenizer/provider/sharing code is bundled. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the full upstream MIT notice and [`LICENSE`](LICENSE) for this package's MIT license.
