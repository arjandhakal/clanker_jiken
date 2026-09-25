# pi-research-kb

A durable, repo-scoped research knowledge base for Pi. It lets agents investigate a codebase or external topic, save a polished note outside git, and reuse that understanding in future sessions.

Each repository gets:

- Markdown, Org, or self-contained HTML research notes
- structured metadata per note
- full-text and metadata search
- a compact generated catalog/TOC
- create, update, removal, open, and reindex workflows
- a bundled `research-kb` skill that tells agents how to research and verify before saving

## Install globally

From this repository:

```bash
pi install ./pi-research-kb
```

Then start a new Pi session or run:

```text
/reload
```

## Storage

The default location is outside every repository:

```text
~/.pi/agent/research-kb/repos/<repo-name>-<path-hash>/
├── CATALOG.md
├── catalog.json
└── notes/
    ├── authentication-flow.md
    └── authentication-flow.meta.json
```

Nothing is written into the code repository. Set `PI_RESEARCH_KB_DIR` to override the root.

Each metadata sidecar records:

- ID, title, and succinct catalog summary
- output format
- tags
- relevant repository files
- external sources
- creation/update times
- content hash and validation warnings

The generated `CATALOG.md` provides the short dictionary/TOC for humans. Agents use the same metadata through `research_kb list` and `search`.

## Research workflow

Natural language works:

```text
Research how authentication flows through this codebase and save it as an Org note.
Research the plugin architecture, make a self-contained HTML explanation, and save it in the research KB.
Check existing research before investigating how retries work.
Update the authentication-flow research against the current implementation.
Remove the obsolete deployment research note.
```

Or use commands:

```text
/research new org How authentication works
/research new html Visual explanation of the plugin architecture
/research update authentication-flow Verify it against the new OAuth implementation
```

The agent is instructed to inspect the catalog first, reuse prior knowledge, verify code and sources, synthesize a useful explanation, and only then save it.

## Commands

```text
/research                         Show status and recent notes
/research help                    Show command help
/research new [md|org|html] TOPIC Start research through the bundled skill
/research update ID [REQUEST]     Re-research and update a note
/research list [filter]            List concise catalog entries
/research search QUERY             Search metadata and full note text
/research read ID                  Display a note
/research open ID                  Open HTML in browser or text in your editor
/research path ID                  Show a note's path
/research catalog                  Show the generated catalog path
/research catalog open             Open the catalog in your editor
/research remove ID                Delete after confirmation
/research reindex                  Reconcile metadata after manual edits
```

IDs support unique prefixes and unique title matches.

## Formats

### Markdown

Default format. Missing H1 headings are added automatically.

### Org

Missing `#+TITLE:` metadata is added automatically.

### HTML

HTML notes must be complete, include UTF-8 metadata, and keep scripts/styles/images local and inline. Remote hyperlinks used as citations are allowed; external scripts, stylesheets, and images are rejected.

`/research open` brings HTML into a browser. On macOS it uses Google Chrome with activation when available, following the delivery principle of Charlie Hills' [`show-me`](https://github.com/charlie947/show-me) skill: visual work should actually be opened, not merely described or left at a path.

## Agent tool

The extension registers `research_kb` with these actions:

- `list`
- `search`
- `read`
- `create`
- `update`
- `remove`
- `path`
- `reindex`

The bundled skill encourages fast code discovery with `fffind`/`ffgrep` when available, followed by reading authoritative files, callers, tests, and configuration. Web research uses current search and primary pages where appropriate.

## Search and Jev

Version 0.1 keeps retrieval local and deterministic:

- the compact research catalog provides quick prior-knowledge lookup
- built-in full-text search finds research-note candidates
- Pi's `fffind` and `ffgrep` tools provide fast codebase path/content discovery

A future hybrid mode can use TypeSafe's Jev model as a fast semantic reranker: local search first gathers bounded candidates, then Jev judges each candidate's relevance to the research question and returns calibrated probabilities. Jev does not replace the local index because it only evaluates the state supplied in a request.

This first version deliberately does not make those API calls. It therefore works without a TypeSafe key, keeps note search local, and avoids coupling retrieval to `pi-jev-auto-mode`. That extension can continue using Jev independently for permission decisions.

## Environment variables

- `PI_RESEARCH_KB_DIR` — storage root
- `PI_RESEARCH_KB_FORMAT` — default format for `/research new`
- `PI_RESEARCH_EDITOR` — editor command, then `$VISUAL`, `$EDITOR`, or `nvim`
- `PI_RESEARCH_BROWSER` — custom browser command

## Acknowledgement

HTML delivery behavior is inspired by Charlie Hills' MIT-licensed [`show-me`](https://github.com/charlie947/show-me) skill. This package does not bundle or modify that skill; it applies its self-contained rendering and visible-delivery principles to durable research notes.
