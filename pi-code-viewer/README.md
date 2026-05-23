# pi-code-viewer

A standalone pi extension that lets agents register compact references to files, ranges, symbols, and diffs while humans inspect the full code in a closable TUI overlay.

## Install

Copy or symlink into your project:

```sh
cp -r pi-code-viewer .pi/extensions/
```

Or for global use:

```sh
cp -r pi-code-viewer ~/.pi/agent/extensions/
```

For ad-hoc testing:

```sh
pi -e ./pi-code-viewer/extensions/code-viewer.ts
```

## Tools (agent-callable)

| Tool | Purpose |
|------|---------|
| `code_ref_register` | Register file/range/symbol refs — returns metadata only |
| `code_ref_open` | Open a ref in the TUI viewer overlay |
| `code_review_changed` | Create a review bundle from git changes |
| `code_context_summary` | List registered refs, bundles, tours, flows |
| `code_tour_register` | Register a guided multi-step code tour |
| `code_flow_register` | Register a data-flow map with edges and observations |
| `code_artifact_register` | Register a pointer to runtime/debugging output |

## Commands (user-invocable)

| Command | Usage |
|---------|-------|
| `/code-view` | `/code-view ref_1` or `/code-view src/foo.ts:10-30` |
| `/review` | Open latest review bundle (creates one from git if needed) |
| `/changed` | `/changed`, `/changed --staged`, `/changed --base main` |
| `/code-refs` | List all registered refs, bundles, tours, flows |
| `/tour` | `/tour tour_1` or `/tour` to select |
| `/flow` | `/flow flow_1` or `/flow` to select |

## Viewer keyboard controls

| Key | Action |
|-----|--------|
| `q` / `esc` | Close overlay |
| `↑` / `↓` | Scroll (or select in outline) |
| `PgUp` / `PgDn` | Page scroll |
| `Home` / `End` | Top / bottom |
| `d` | Switch to diff mode |
| `c` | Switch to code mode |
| `o` | Switch to outline mode |
| `t` | Switch to tour mode |
| `f` | Switch to flow mode |
| `[` / `]` | Previous / next tour step or flow node |
| `Enter` | Open selected item from outline |

## Token policy

Tool output returns compact metadata only — no source code or diff text goes to the model context. Full content is rendered exclusively in the TUI overlay for the human.

## Auto-tracking

When the agent uses `edit` or `write` tools, changed files are automatically tracked. Run `/review` to inspect accumulated diffs.

## Integration

External tool extensions can feed data into the viewer by calling the registered tools. The viewer is language-agnostic — any extension can register refs, tours, flows, and artifacts through the standard tool interface.

See [`SPEC.md`](./SPEC.md) for detailed specification.
