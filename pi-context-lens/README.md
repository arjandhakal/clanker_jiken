# Pi Context Lens

Inspect Pi session composition, growth and comparisons **inside Pi**. Local inspection requires no model call, external viewer, API key or context-lens executable. Optional AI investigation uses your active Pi provider/model route only, after preview and explicit approval.

Tested with **Pi 1.2.0 / Node 24.22.1**. The local Homebrew directory named `0.75.4` contains 1.2.0; version numbers were verified against the running CLI and installed exports. Other versions are unverified, especially older forks without `buildSessionProjection` or registry streaming.

## Try it without installation

From this repository, or any other project:

```sh
pi -e /Users/arjan.620/my-files/playground/clanker_jiken/pi-context-lens/extensions/index.ts
```

No settings changes or npm install are needed for the one-off command. To register it user-wide, run `pi install ./pi-context-lens`; it loads from this checkout. After source updates, use `/reload` in existing Pi sessions.

## Interaction

1. Run `/context-lens`, or `/context-lens current` to skip discovery and inspect the active/ephemeral session.
2. Search by available name, project/cwd, ID/path, date or model. **↑/↓** navigate, **Tab** toggles a checkbox, **Enter** inspects selected sessions (the highlighted item if none checked), **Esc** cancels. Selected names remain visible while filtering; **Ctrl+S** switches to a selected-only list for review/unchecking. Up to six sessions.
3. Choose **Retained context**, **Selected branch** or **All branches**; each option explains what it includes. For a single branched session, optionally choose another branch.
4. **←/→ or Tab** switches Overview / Compare / Growth / Contributors / Warnings / Details. Overview leads with size and dominant categories; Details holds full paths and accounting. **↑/↓, PgUp/PgDn, Home/End** scroll. **D** opens local evidence (top 30 contributors per session; preview capped at 16,000 chars). **Esc** returns to the same tab/scroll position. Current-page and action hints adapt to narrow terminals.
5. Optional **A**: enter a question and choose a dimension. Review the readable **AI sample** and, optionally, the **Exact send preview** tab. **Enter Continue** opens explicit transmission approval; **Esc Cancel** returns to the report without opening approval or sending anything. **Esc** during inference aborts. No tool execution or project changes can result. The Interpretation tab retains the in-memory result while the report is open.

`/context-lens clear` discards extension memory. Closing/reloading/exiting discards state eventually; no runtime cache or export is written. Opening a fresh report replaces the previous report/results. Commands requiring custom screens refuse headless/RPC mode without reading/sending sessions.

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

The extension does not append prompts/results to the ongoing Pi conversation or write duplicate transcripts/results. Selected text/results live in process memory until replaced/cleared/reload/exit. Original Pi transcripts, terminal scrollback, provider retention and host/provider diagnostics remain separate and are not controlled by this extension. Do not treat in-memory display as a guarantee against host logging or screenshots.

## Development and evidence

```sh
cd pi-context-lens
npm test
# Include installed-runtime projection/loader/UI orchestration tests:
PI_SDK_PATH=/opt/homebrew/Cellar/pi-coding-agent/0.75.4/libexec/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js npm test
# Isolated real terminal checks; no inference or private sessions:
npm run test:tui
```

Tests create only synthetic data under ignored `.tmp/`, and remove unit-test directories afterward. PTY smoke artifacts are retained under `.tmp/tui-*` for inspection; delete those directories when no longer needed. Public upstream research downloads are ignored under `research/`; neither directory is distributed in the package. No install scripts or paid inference are required. Runtime tests skip explicitly when the SDK is unavailable; a default unit-only pass is not evidence of installed-runtime compatibility.

See [`VALIDATION.md`](VALIDATION.md) for actual results and unverified items, [`SPEC.md`](SPEC.md) for the implementation contract, and [`RESEARCH.md`](RESEARCH.md) for the read-only research handoff. Installed source validation found one stale-doc example: 1.2.0 context-edit replacements use `{content: ...}`, not a bare string.

## Attribution

Inspired by [nilenso/context-viewer](https://github.com/nilenso/context-viewer), pinned research revision `d776680798bde244671498f6f58da003a30fe91a`, and independently inspected npm CLI `@nilenso/context-lens@0.1.1`. Original Pi-specific implementation; no upstream tokenizer/provider/sharing code is bundled. See [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for the full upstream MIT notice and [`LICENSE`](LICENSE) for this package's MIT license.
