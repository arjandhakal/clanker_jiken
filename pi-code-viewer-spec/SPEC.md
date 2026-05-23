# Spec: pi Code Context Viewer Extension

## Working name

`pi-code-viewer` / `pi-context-viewer`

A standalone pi package that lets agents reference files, ranges, symbols, and diffs as compact clickable references instead of pasting large code blocks into the conversation.

## Problem

Agents often paste source code or diffs into chat to explain what they read or changed. That is expensive and noisy:

- Increases model context/token usage.
- Makes conversations harder to scan.
- Forces the user to verify changes by mentally matching pasted snippets against files.
- Encourages over-printing code that is already on disk.

We want the agent to say things like:

> I changed `src/foo/bar.clj:42-78` and `test/foo/bar_test.clj:10-30`. Open the review panel to inspect the exact code and diff.

The user should be able to open a closable, keyboard-navigable pi TUI overlay showing syntax-highlighted code or a diff, while the LLM sees only compact metadata.

## Goals

1. **Token-saving code references**
   - Tool results should return short references, not file contents.
   - Full source/diff content should be rendered only in the TUI for the human.

2. **Clickable / selectable references in pi**
   - Render file/range references as interactive entries in tool results or custom messages.
   - Selecting a reference opens an overlay dialog/panel.

3. **Closable code/diff viewer**
   - TUI overlay with keyboard controls.
   - Syntax-highlighted file view.
   - Diff view for changed files.
   - Range-focused view for specific line spans.

4. **Agent-friendly APIs**
   - Tools for registering references after reads/edits/tests.
   - Tools for showing a review bundle of changed files.
   - Commands for user-driven browsing.

5. **Human-in-the-loop verification**
   - Make it easy for users to verify exactly what changed before continuing.
   - Good fit for “pause, inspect, continue?” workflows.

## Non-goals

- Replace `read`, `edit`, or git tooling.
- Hide code from the agent when the agent actually needs code to reason. The viewer is for human display, not model reasoning.
- Build a full IDE/editor.
- Store sensitive file contents in session history.

## Pi APIs likely used

Based on pi docs:

- `pi.registerTool()` for agent-callable reference/viewer tools.
- `pi.registerCommand()` for user commands like `/code-view`, `/review`, `/changed`.
- `ctx.ui.custom()` with `{ overlay: true }` for closable TUI dialogs.
- `renderResult` / custom rendering for compact clickable tool results if the extension API supports custom tool rendering.
- `pi.on("tool_result")` to detect `edit` / `write` / possibly `bash git diff` and update a review cache.
- Session persistence via `pi.appendEntry()` only for compact metadata, not full code.

Relevant docs:

- `docs/extensions.md`
- `docs/tui.md`

## Core concepts

### Code reference

A compact object representing code on disk:

```ts
type CodeRef = {
  id: string;              // stable within session, e.g. "ref_12"
  kind: "file" | "range" | "symbol" | "diff";
  path: string;            // repo-relative path
  startLine?: number;
  endLine?: number;
  symbol?: string;
  title?: string;
  note?: string;           // short human/agent note
  language?: string;       // inferred from extension
  createdByToolCallId?: string;
  timestamp: number;
};
```

### Review bundle

A grouped set of refs, usually after an edit/test cycle:

```ts
type ReviewBundle = {
  id: string;
  title: string;
  refs: CodeRef[];
  gitBase?: string;        // optional base ref for diffs
  summary?: string;        // short, model-visible summary only
  timestamp: number;
};
```

### Token policy

Tool output to the LLM should look like:

```text
Registered 3 code refs:
- ref_12 src/mount/core.cljc:166-194 defstate macro
- ref_13 src/mount/core.cljc:153-163 mount-it registration
- ref_14 src/mount/core.cljc:260-289 start/stop ordering

Use /code-view ref_12 or ask the user to open the review panel.
```

It should **not** include source code unless explicitly requested through normal `read`.

## Proposed tools

### `code_ref_register`

Register one or more file/range references for human viewing.

Parameters:

```ts
{
  refs: Array<{
    path: string;
    startLine?: number;
    endLine?: number;
    symbol?: string;
    title?: string;
    note?: string;
  }>;
  bundleTitle?: string;
  open?: boolean;          // default false; if true, open overlay immediately
}
```

Returns compact refs only.

### `code_ref_open`

Open one previously registered ref in a TUI overlay.

Parameters:

```ts
{
  id: string;
  mode?: "code" | "diff";
}
```

LLM output remains short:

```text
Opened ref_12 in code viewer.
```

### `code_review_changed`

Create a review bundle from current git changes.

Parameters:

```ts
{
  staged?: boolean;        // default false, use working tree
  base?: string;           // optional git base, e.g. HEAD
  open?: boolean;          // open overlay immediately
}
```

Behavior:

- Run `git diff --name-only` / `git diff --stat` / `git diff --unified=...` internally.
- Store diff text in memory for TUI rendering only.
- Return compact file list and stat summary to LLM.

### `code_ref_for_symbol`

Resolve a symbol/name to a file/range where possible.

Initial implementation can be heuristic:

- Clojure: scan top-level forms for `def`, `defn`, `defmacro`, `deftest`, etc.
- TypeScript/JS: regex for `function`, `class`, `export const`, etc.
- Later: integrate LSP.

Parameters:

```ts
{
  symbol: string;
  paths?: string[];
  open?: boolean;
}
```

### `code_context_summary`

Produce a compact, token-light inventory of registered refs/bundles.

Parameters:

```ts
{
  bundleId?: string;
}
```

Returns metadata only.

## Proposed commands

### `/code-view [ref-id | path[:line[-line]]]`

Open a viewer overlay for a ref or direct path/range.

Examples:

```text
/code-view ref_12
/code-view src/mount/core.cljc:166-194
```

### `/review`

Open latest review bundle, usually current git changes.

### `/changed`

Create/open a review bundle for current working tree changes.

### `/code-refs`

List registered refs/bundles.

## TUI viewer UX

Use `ctx.ui.custom(component, { overlay: true, overlayOptions: ... })`.

### Layout

Possible overlay:

```text
┌─ Code Viewer ──────────────────────────────────────────────┐
│ ref_12  src/mount/core.cljc:166-194  defstate macro        │
├────────────────────────────────────────────────────────────┤
│ 166  (defmacro defstate                                    │
│ 167    "defines a state..."                               │
│ ...                                                        │
├────────────────────────────────────────────────────────────┤
│ ↑/↓ scroll  PgUp/PgDn  d diff  c code  y copy path  q close│
└────────────────────────────────────────────────────────────┘
```

### Modes

- `code`: syntax-highlighted file/range view.
- `diff`: unified diff view with added/removed/context colors.
- `side-by-side` later, if terminal width allows.
- `outline`: list registered refs/files in a bundle.

### Keyboard controls

- `q` / `esc`: close
- `up/down`: scroll line
- `pgup/pgdn`: scroll page
- `home/end`: top/bottom
- `d`: toggle diff mode
- `c`: toggle code mode
- `o`: outline/list refs in current bundle
- `enter`: open selected ref from outline
- `/`: search within current file/diff
- `n` / `N`: next/previous search hit
- `y`: copy path/range command to clipboard, if feasible

## Syntax highlighting

Initial implementation options:

1. Simple extension-based highlighter:
   - comments
   - strings
   - keywords
   - numbers
   - parens/punctuation
   - diff additions/removals

2. Use existing pi TUI Markdown code block renderer if adequate.

3. Later: add Shiki or tree-sitter if package size/performance is acceptable.

Important: rendered TUI lines must fit `render(width)` constraints and avoid leaking into session text.

## Diff rendering

For changed files:

- Use `git diff --no-ext-diff --unified=80 -- path` for full enough context in the overlay.
- Store diff content in memory; do not return it to LLM.
- Color:
  - `+` additions using `theme.fg("toolDiffAdded", ...)`
  - `-` removals using `theme.fg("toolDiffRemoved", ...)`
  - context dim/muted
  - hunk headers accent

## Event integration

### Track edits automatically

Listen to `tool_result` for built-in `edit` and `write` results.

When a file is changed:

- Register a `CodeRef` for the file.
- Mark it dirty/changed.
- Add to latest review bundle.
- Optionally notify:

```text
Changed 2 files. Run /review to inspect diff.
```

### Avoid token bloat

Do not append code/diff contents to messages.

If persistent session entries are used, persist only:

```json
{
  "kind": "code-ref-index",
  "refs": [{"id":"ref_12","path":"...","startLine":1,"endLine":10}]
}
```

## Security and privacy

- Never expose file contents to the LLM unless a normal model-visible tool like `read` is explicitly called.
- TUI-rendered content is for the human only.
- Respect `.gitignore`/project ignore for auto-indexing where appropriate.
- Avoid opening binary files; show a metadata-only message.
- Enforce cwd sandbox: paths must resolve under `ctx.cwd` unless explicitly allowed.

## Agent workflow examples

### Explaining a codebase

Agent:

1. Uses `code_ref_register` for important files/ranges.
2. Says: “Open `ref_3` for the `defstate` macro and `ref_4` for start/stop ordering.”
3. User opens refs in TUI overlay.
4. Agent continues explanation without pasting code.

### After editing

Agent:

1. Edits files.
2. Extension auto-registers changed files.
3. Agent says: “I changed 3 files; run `/review` or open the review panel.”
4. User inspects diffs in TUI.
5. Agent asks: “Continue to tests?”

### Human-in-loop approval

Agent:

1. Creates review bundle.
2. Opens overlay.
3. Pauses: “Please review the diff; reply yes to run tests.”

## MVP scope

1. Standalone package `pi-code-viewer`.
2. Commands:
   - `/code-view`
   - `/review`
   - `/changed`
   - `/code-refs`
3. Tools:
   - `code_ref_register`
   - `code_ref_open`
   - `code_review_changed`
4. Overlay component:
   - code mode
   - diff mode
   - outline mode
   - close/scroll/search
5. Git diff integration.
6. Auto-track `edit`/`write` changed files.
7. README with screenshots/ASCII examples.

## Phase 2

- Symbol resolver per language.
- LSP integration for definitions/references.
- Side-by-side diff.
- Inline blame / last commit info.
- “Open in editor” integration.
- Multi-ref guided tour mode: next/previous ref with notes.
- Custom renderers for tool results to make refs look clickable/selectable.
- Session restore for ref metadata.

## Open questions

1. Does pi currently allow clickable regions in rendered tool output, or should interaction be command/keyboard driven first?
2. Can custom renderers attach actions to visible refs, or should refs be opened via `/code-view ref_id`?
3. Should full file contents be held only in memory, or read from disk on-demand each render?
   - Preferred: read on-demand so viewer always reflects disk.
4. Should diffs be cached at bundle creation or recomputed on open?
   - Preferred MVP: cache stat/ref metadata, recompute diff on open unless a frozen review is requested.
5. How should this interact with compaction?
   - Persist metadata only; discard cached contents.

## Acceptance criteria

- Agent can register a file/range without returning code to the model.
- User can open a closable overlay and inspect syntax-highlighted code.
- User can inspect current git diff in a closable overlay.
- After an `edit`/`write`, `/review` shows changed files/diffs.
- Tool results remain compact under normal use.
- Paths are safe and cwd-confined.
- Works as standalone pi package like `pi-clojure-agent-toolkit`.
