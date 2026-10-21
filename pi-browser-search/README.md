# Pi Browser Search

A personal, localhost-only web search engine with **optional** AI summaries. Point your browser at:

```text
http://127.0.0.1:4317/search?q=%s
```

Radius/Parallel returns links and excerpts. **Ordinary searches never call an answer model or generate AI answers.** Click **Summarize with AI** only when you want a short, cited summary; the button explicitly warns that this uses model tokens. Pi Durable stores searches and optional summary jobs in SQLite so history and unfinished work survive restarts.

## Start

Requires **Node.js 22.19+**, npm, and a Radius account with web search enabled. An authenticated answer model is needed **only for optional AI summaries**.

```sh
cd pi-browser-search
npm ci --ignore-scripts
npm start
```

Open **http://127.0.0.1:4317**. Sign in to Radius with `/login` in your normal Pi CLI if necessary. No API keys are sent to the browser. This service uses the Radius HTTP search endpoint, not a running MCP/Pi conversation: it keeps working when your terminal agent exits.

By default it reads Radius credentials from `~/.pi/agent/auth.json`. Optional summaries use the default provider/model from `~/.pi/agent/settings.json`. A missing or invalid summary model does not prevent ordinary searches. The pinned Pi `ModelRuntime` handles credential locking and OAuth refresh; no credentials are copied into this repository. It does **not** load your Pi extensions, skills, instructions, or unrelated MCP servers. Custom `models.json` definitions are not loaded.

Optional configuration:

```sh
cp .env.example .env
# Edit .env; for example:
# SEARCH_PROVIDER=radius
# SEARCH_MODEL=balanced
```

Set **both** provider and model when overriding the pair. Other settings: `PORT` (default 4317), `DATA_DIR` (default `data/`), `PI_SEARCH_AGENT_DIR`, and `PI_RADIUS_GATEWAY`. A `RADIUS_API_KEY` can be used instead of a saved Radius login; as in Pi, an existing stored credential takes precedence over an environment key.

Your Radius organization's existing web-search policy, charges, and retention settings apply. This app does not change them. **No answer-model tokens are spent for ordinary searches.** Clicking the AI-summary button may incur separate model-provider costs; previously completed summaries are reused without generating again.

## Browser setup

**Chrome / Chromium / Brave / Edge:** Settings → Search engine → Manage search engines and site search → Add:

- Name: `Pi Search`
- Shortcut: `pi`
- URL: `http://127.0.0.1:4317/search?q=%s`

Then choose “Make default” if offered, or use `pi` + Space in the address bar. Some browsers first require activating a site-search entry.

**Firefox:** the homepage advertises `/opensearch.xml`. Use its Add Search Engine action (often right-click the address bar → Add Pi Search), then choose it in Search settings. UI availability varies by Firefox version.

**Safari:** Safari does not offer an arbitrary custom-engine URL field. Use a keyword-search extension, or a bookmark/homepage rather than replacing its built-in engine.

This is best tried as a keyword engine first. Results-only search avoids waiting for AI synthesis, but this is still imperfect for images, maps, shopping, and exact-site lookups; the result page includes a Google fallback.

## Background service

### macOS (launchd)

After checking `npm start`, stop that foreground process, then:

```sh
npm run service:install
```

This explicitly installs and starts `~/Library/LaunchAgents/dev.pi.browser-search.plist`, starts it at login, and restarts it on failure. It uses the current Node executable, the absolute project directory, and the project's `.env`. Update the installation after moving the project or replacing that Node installation.

```sh
curl http://127.0.0.1:4317/healthz
launchctl print gui/$(id -u)/dev.pi.browser-search
# Restart after changing configuration/code:
launchctl kickstart -k gui/$(id -u)/dev.pi.browser-search
# Remove auto-start; keeps your search data:
npm run service:uninstall
```

On this Mac, `start-search` in `~/.zshrc` checks the health endpoint and starts the service only if needed. Open a new terminal or run `source ~/.zshrc` to load the command.

Logs: `data/service.log` and `data/service-error.log` (not automatically rotated). Running `npm start` and the login service together is not supported. The data-directory lock rejects a second writer; after a hard crash its stale lock can take about 30 seconds to expire.

### Linux (systemd user service)

Create `~/.config/systemd/user/pi-search.service`, replacing the absolute paths:

```ini
[Unit]
Description=Pi Browser Search
[Service]
WorkingDirectory=/absolute/path/pi-browser-search
ExecStart=/absolute/path/node --env-file-if-exists=.env /absolute/path/pi-browser-search/src/server.mjs
Restart=on-failure
RestartSec=35
UMask=0077
[Install]
WantedBy=default.target
```

Then `systemctl --user daemon-reload && systemctl --user enable --now pi-search`. This example is provided but has not been tested on Linux.

## Behavior and safety

- One Radius search (up to eight results) returns links and excerpts, **without any answer-model call**. There is no full-page crawling, iterative research, or local web index.
- Fresh identical successful searches are reused for 15 minutes; simultaneous duplicates share one job. At most three searches run concurrently.
- Only an explicit, same-origin POST from the **Summarize with AI** button starts a tool-free synthesis of saved excerpts. It does not repeat the web search. Concurrent clicks share one summary job; successful summaries are reused across reloads and restarts. Failed summaries can be retried with the button. At most three summaries run concurrently.
- Search jobs and their history entries are created atomically. Summary jobs are separate and persist their opt-in, selected model, and source snapshot. A child conversation and stable submission request ID avoid resubmitting a committed summary request during recovery. Previously requested, unfinished summaries may resume automatically after a service restart; ordinary searches never create these jobs.
- Old saved answers remain in the database but are hidden by default, and can be displayed with the summary button without spending new tokens.
- This is **not exactly-once billing**: a crash during an uncommitted HTTP search or model request can repeat it. Providers may charge for both attempts. Requests have timeouts and model retries are bounded.
- Recent-search links open saved results, even after the cache TTL. For a fresh attempt, submit the query through the form after the TTL.
- Only `127.0.0.1` is bound. Host validation, same-origin checks, a process-local POST token, CSP, and text-only DOM construction protect the local interface. No shell/file tools or administrative MCP tools are given to the answer model. Citations link only to numbered, HTTP(S) result URLs; citations are **not independently verified**.
- Queries go to Radius/Parallel. **Only when you request an AI summary** do the query and excerpts also go to your selected model provider. The external search backend is not guaranteed to be AI-free internally; this app simply makes no answer-model request for normal searches. Results, queries, and transcripts remain in `data/search.sqlite`; history displays the most recent 30 searches, its index keeps roughly 200, but **underlying transcripts are not automatically deleted**. Stop the service and remove `data/` to erase local history. OAuth credentials are stored separately by Pi.
- Do not expose the port through a proxy, LAN binding, or tunnel. This is a personal service, not a multi-user authenticated deployment.
- The browser search URL itself can trigger paid work when opened; ordinary GET requests alone do not run jobs, but the visible page submits one on load. Prerendered pages wait for activation.
- Pi Durable is experimental. Dependencies are pinned to **1.3.0**; back up the database before upgrading. SQLite WAL commits survive process crashes, not necessarily a sudden power failure. A failed storage harness requires a service restart.

## Tests

```sh
npm test
```

Tests use Pi's faux model provider and temporary SQLite databases. They explicitly assert **zero model calls for ordinary searches**, no summary request on page load (including old cached answers), opt-in-only synthesis, deduplication, persistence, interrupted-summary recovery, search without a configured answer model, provider failure/retry, authentication forwarding, URL filtering, and HTTP protections. No paid services are used in tests.

The original auto-answer version was checked with a real Radius search and model answer in Chrome. The current results-first flow is also browser-checked; optional AI is tested with a faux model to avoid unnecessary token spending.

## Research / design references

- [Pi Durable announcement](https://earendil.com/posts/pi-durable/)
- [Pi Durable README, pinned v1.3.0](https://github.com/earendil-works/pi/blob/v1.3.0/packages/durable/README.md): persistence, tasks, ownership, and storage guarantees.
- [Example 13: recovery](https://github.com/earendil-works/pi/blob/v1.3.0/packages/durable/test/examples/13-recovery.ts): close/reopen checkpointed tasks.
- [Example 16: real model](https://github.com/earendil-works/pi/blob/v1.3.0/packages/durable/test/examples/16-real-model.ts): persisted model answers.
- [Example 23: background work](https://github.com/earendil-works/pi/blob/v1.3.0/packages/durable/test/examples/23-subagent-background.ts): reference for durable background ownership; not needed for this bounded workflow.
- [pi-search-hub](https://pi.dev/packages/pi-search-hub): an existing Pi search package surfaced during research; this project instead provides a standalone browser-search HTTP service.

## Layout

`src/engine.mjs`: durable workflow and cache; `src/radius.mjs`: search transport; `src/server.mjs`: local HTTP and auth setup; `public/`: dependency-free UI; `scripts/service.mjs`: macOS installer.
