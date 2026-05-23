# Spec: pi Code Context Viewer Extension

## Working name

`pi-code-viewer`

A standalone pi package that lets agents register compact references to files, ranges, symbols, and diffs while humans inspect the full code in a closable TUI overlay.

## Status

Draft MVP specification for a future pi package.

## Problem

Agents often paste source code or diffs into chat to explain what they read, changed, or traced. That is expensive and noisy:

- It increases model context/token usage.
- It makes conversations harder to scan.
- It forces the user to verify changes by comparing pasted snippets against files.
- It separates architecture explanations from the exact files/functions they refer to.
- It is especially weak for data-flow learning: trace/tap/REPL results point at functions, but the user cannot easily jump through the related code path.
- It can accidentally persist sensitive source/diff/runtime content in session history.

The agent should be able to say:

> I changed `src/foo/bar.clj:42-78` and `test/foo/bar_test.clj:10-30`. Open `/review` to inspect the exact diff.

It should also be able to say:

> I traced the request pipeline through `parse-order -> validate-order -> persist-order`. Open `/flow order-pipeline` for a guided tour of the code, call edges, and compact runtime observations.

The user should be able to open a closable, keyboard-navigable pi TUI overlay showing syntax-highlighted code, diffs, outlines, and data-flow tours, while the LLM sees only compact metadata.

## Goals

1. **Token-saving code references**
   - Tool results return compact refs, not file contents.
   - Full source/diff content is rendered only in the TUI for the human.

2. **Human-readable and command-openable refs**
   - Refs are visible as short IDs plus path/range metadata.
   - Users can open refs with `/code-view ref_12` or `/code-view path:line-line`.
   - Custom tool rendering can make refs visually clear; clickable actions are a Phase 2 enhancement unless pi exposes stable clickable regions.

3. **Closable code/diff viewer**
   - Overlay TUI with keyboard controls.
   - Syntax-highlighted code view.
   - Diff view for changed files.
   - Range-focused view for specific line spans.

4. **Agent-friendly APIs**
   - Tools for registering references after reading/editing files.
   - Tools for opening refs and creating review bundles.
   - Tools for registering guided code tours and data-flow paths discovered by language-specific tools.
   - Commands for user-driven browsing.

5. **Human-in-the-loop verification**
   - Make it easy to verify exact changes before continuing.
   - Support “pause, inspect, continue?” workflows.

6. **Codebase understanding and data-flow learning**
   - Help the user understand architecture, namespaces/modules, symbols, call chains, and runtime observations without flooding chat with code.
   - Support a “guided tour” view that steps through relevant refs in conceptual order.
   - Allow external tool extensions to attach runtime artifacts (e.g., REPL results, traces, test/lint output, debugger/profiler metadata) as metadata-linked refs.

## Non-goals

- Replace `read`, `edit`, `write`, or git tooling.
- Hide code from the agent when the agent actually needs code to reason.
- Build a full IDE/editor.
- Replace language-specific understanding tools such as LSP, nREPL, FlowStorm, Portal, or `pi-clojure-agent-toolkit`.
- Persist full file contents, full diffs, or large runtime values in session history.
- Provide perfect semantic symbol resolution in MVP.

## Pi APIs used

Based on pi extension and TUI docs:

- `pi.registerTool()` for agent-callable tools.
- `pi.registerCommand()` for commands like `/code-view`, `/review`, `/changed`, `/code-refs`.
- `ctx.ui.custom(componentFactory, { overlay: true, overlayOptions })` for closable TUI overlays.
- Custom tool `renderCall` / `renderResult` for compact, readable ref rendering.
- `pi.on("tool_result")` to detect built-in `edit` / `write` results and maintain a review cache.
- `pi.appendEntry()` for metadata-only session persistence.
- Node built-ins (`node:fs`, `node:path`, `node:child_process`) for safe file and git access.
- `@earendil-works/pi-tui` components and utilities such as `Text`, `Container`, `matchesKey`, `Key`, `truncateToWidth`, `wrapTextWithAnsi`.

## Package shape

Recommended package layout:

```text
pi-code-viewer/
├── package.json
├── README.md
├── extensions/
│   └── code-viewer.ts
└── src/
    ├── model.ts
    ├── registry.ts
    ├── paths.ts
    ├── git.ts
    ├── symbols.ts
    ├── highlighter.ts
    ├── viewer-component.ts
    ├── tools.ts
    └── commands.ts
```

`package.json`:

```json
{
  "name": "pi-code-viewer",
  "version": "0.1.0",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"]
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*",
    "typebox": "*"
  }
}
```

## Core data model

### CodeRef

A compact object representing code on disk or a diff target:

```ts
type CodeRefKind = "file" | "range" | "symbol" | "diff" | "trace" | "runtime-artifact";

type CodeRef = {
  id: string;                 // stable within session, e.g. "ref_12"
  kind: CodeRefKind;
  path: string;               // repo/cwd-relative path
  startLine?: number;         // 1-indexed inclusive
  endLine?: number;           // 1-indexed inclusive
  symbol?: string;
  title?: string;
  note?: string;              // short model-visible note
  language?: string;          // inferred from extension
  bundleId?: string;
  createdByToolCallId?: string;
  source?: "manual" | "auto-edit" | "auto-write" | "git" | "symbol" | "trace" | "external-tool";
  timestamp: number;
};
```

### ReviewBundle

A grouped set of refs, usually after edits:

```ts
type ReviewBundle = {
  id: string;
  title: string;
  refs: CodeRef[];
  gitBase?: string;           // default HEAD
  staged?: boolean;
  summary?: string;           // compact model-visible summary only
  timestamp: number;
};
```

### CodeTour

A guided set of refs for understanding architecture or a feature area:

```ts
type CodeTour = {
  id: string;                 // e.g. "tour_2" or user title slug
  title: string;
  purpose?: string;           // compact learning goal, e.g. "order ingestion pipeline"
  steps: Array<{
    refId: string;
    label: string;
    note?: string;            // short model-visible explanation, no code
    role?: "entrypoint" | "transform" | "validation" | "io" | "test" | "config" | "other";
  }>;
  summary?: string;           // compact model-visible summary only
  timestamp: number;
};
```

### DataFlow

A compact representation of observed or hypothesized runtime flow. This is intentionally language-agnostic so Clojure, TypeScript, Python, etc. integrations can feed it.

```ts
type FlowEdgeKind = "calls" | "emits" | "reads" | "writes" | "tests" | "routes-to" | "depends-on";

type DataFlow = {
  id: string;                 // e.g. "flow_1"
  title: string;
  sourceTool?: string;        // e.g. "clj_repl_trace", "clj_repl_tap_collect", "clj_project_overview"
  entryRefId?: string;
  nodeRefs: string[];         // CodeRef ids in display order
  edges: Array<{
    fromRefId: string;
    toRefId: string;
    kind: FlowEdgeKind;
    label?: string;
  }>;
  observations?: Array<{
    refId?: string;
    label: string;            // e.g. "tap stage :parsed" or "arg shape"
    preview?: string;         // bounded, redacted, model-visible preview
    artifactId?: string;      // points to in-memory artifact if available
  }>;
  summary?: string;           // compact model-visible summary only
  timestamp: number;
};
```

### RuntimeArtifact

Small metadata pointers to values or external visual debugging sessions. Full runtime values must be bounded/redacted if model-visible and should not be persisted unless explicitly safe.

```ts
type RuntimeArtifact = {
  id: string;                 // e.g. "artifact_7"
  kind: "tap" | "trace" | "repl-result" | "portal" | "flowstorm" | "test" | "lint" | "profile";
  sourceTool?: string;
  title: string;
  refIds?: string[];
  preview?: string;           // bounded/redacted, model-visible
  externalUri?: string;       // optional Portal/FlowStorm/file URI if applicable
  inMemoryOnly?: boolean;     // true for large/sensitive runtime details
  timestamp: number;
};
```

### ViewerState

Internal, not persisted verbatim:

```ts
type ViewerMode = "code" | "diff" | "outline" | "tour" | "flow" | "artifact";

type ViewerState = {
  mode: ViewerMode;
  selectedRefId?: string;
  bundleId?: string;
  scroll: number;
  selectedIndex: number;
  searchQuery?: string;
  searchHits: number[];
  activeHit: number;
  tourId?: string;
  flowId?: string;
  selectedStepIndex?: number;
};
```

## Persistence policy

Persist only compact metadata with `pi.appendEntry()`:

```json
{
  "kind": "code-viewer-index",
  "refs": [
    { "id": "ref_12", "kind": "range", "path": "src/a.ts", "startLine": 10, "endLine": 25 }
  ],
  "bundles": [
    { "id": "bundle_3", "title": "Working tree changes", "refs": ["ref_12"] }
  ],
  "tours": [
    { "id": "tour_1", "title": "Order pipeline", "steps": [{ "refId": "ref_12", "label": "entrypoint" }] }
  ],
  "flows": [
    { "id": "flow_1", "title": "Order data flow", "nodeRefs": ["ref_12"], "edges": [] }
  ]
}
```

Do **not** persist:

- File contents.
- Diff contents.
- Full trace events, full `tap>` values, REPL stdout/stderr, stacktraces, or profiler output.
- Search result text.
- Rendered TUI output.

Runtime artifacts should default to `inMemoryOnly: true` unless they are already safe compact metadata. On restore, missing in-memory artifacts should show as unavailable with the original compact preview.

On session restore, refs are restored as pointers to files on disk. If a file no longer exists, the viewer shows a metadata-only missing-file message.

## Token policy

Tool output to the LLM should look like:

```text
Registered 3 code refs:
- ref_12 src/mount/core.cljc:166-194 defstate macro
- ref_13 src/mount/core.cljc:153-163 mount-it registration
- ref_14 src/mount/core.cljc:260-289 start/stop ordering

Open with /code-view ref_12 or /review.
```

For a data-flow tour it should look like:

```text
Registered data flow flow_1: Order ingestion pipeline
Steps: 4 refs, 3 edges, 2 runtime observations
- ref_21 src/orders/api.clj:41-66 entrypoint
- ref_22 src/orders/pipeline.clj:10-38 transform
- ref_23 src/orders/db.clj:80-112 write

Open with /flow flow_1 or /tour tour_1.
```

It must not include source code or diff text unless the agent explicitly uses a normal model-visible tool such as `read` or `bash`.

## Tools

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
  open?: boolean;             // default false
}
```

Behavior:

- Validate every path is under `ctx.cwd`.
- Normalize to cwd-relative POSIX-like paths for display.
- Infer `kind`: `range` if line bounds are present, otherwise `file`; `symbol` if `symbol` is provided.
- Create IDs like `ref_1`, `ref_2`.
- If `bundleTitle` is present, create or append a bundle.
- If `open`, show the first ref or bundle overlay.

Return:

```text
Registered 2 code refs:
- ref_1 src/foo.ts:10-20 parser setup
- ref_2 src/bar.ts file
```

### `code_ref_open`

Open one previously registered ref in a TUI overlay.

Parameters:

```ts
{
  id: string;
  mode?: "code" | "diff" | "outline";
}
```

Return:

```text
Opened ref_1 in code viewer.
```

If the UI is unavailable/non-interactive, return a compact error explaining the command alternative.

### `code_review_changed`

Create a review bundle from current git changes.

Parameters:

```ts
{
  staged?: boolean;           // default false
  base?: string;              // default HEAD
  open?: boolean;             // default false
}
```

Behavior:

- Use `git diff --name-only` and `git diff --stat`.
- Register one `diff` ref per changed file.
- Cache metadata only; recompute diff on open for MVP.
- If `open`, show bundle outline/diff overlay.

Return:

```text
Created review bundle bundle_4: Working tree changes
Files changed: 3
- ref_9 src/foo.ts diff
- ref_10 test/foo.test.ts diff
- ref_11 README.md diff

Open with /review or /code-view ref_9.
```

### `code_ref_for_symbol` (Phase 2, optional MVP stub)

Resolve a symbol/name to a file/range where possible.

Parameters:

```ts
{
  symbol: string;
  paths?: string[];
  open?: boolean;
}
```

Initial heuristic support:

- Clojure: top-level `(def ...)`, `(defn ...)`, `(defmacro ...)`, `(deftest ...)`.
- TypeScript/JavaScript: `function`, `class`, `export const`, `export function`, `export class`.
- Markdown: headings.

Return compact refs only.

### `code_context_summary`

Produce a compact inventory of registered refs/bundles/tours/flows.

Parameters:

```ts
{
  bundleId?: string;
  tourId?: string;
  flowId?: string;
}
```

Return metadata only.

### `code_tour_register`

Register a guided tour that helps the user understand a feature, subsystem, namespace, or debugging path.

Parameters:

```ts
{
  title: string;
  purpose?: string;
  steps: Array<{
    refId?: string;           // existing ref, or path/range below to create one
    path?: string;
    startLine?: number;
    endLine?: number;
    symbol?: string;
    label: string;
    note?: string;
    role?: "entrypoint" | "transform" | "validation" | "io" | "test" | "config" | "other";
  }>;
  open?: boolean;
}
```

Behavior:

- Reuse existing refs when `refId` is supplied.
- Create refs from path/range/symbol fields when needed.
- Store only compact labels/notes, not code.
- If `open`, show tour mode at the first step.

Return:

```text
Registered tour tour_1: Order ingestion pipeline
Steps: 4
Open with /tour tour_1.
```

### `code_flow_register`

Register a compact data-flow map from static analysis, LSP, REPL tracing, tests, `tap>`, or debugger/profiler tools.

Parameters:

```ts
{
  title: string;
  sourceTool?: string;
  entryRefId?: string;
  nodeRefs: string[];
  edges?: Array<{
    fromRefId: string;
    toRefId: string;
    kind: "calls" | "emits" | "reads" | "writes" | "tests" | "routes-to" | "depends-on";
    label?: string;
  }>;
  observations?: Array<{
    refId?: string;
    label: string;
    preview?: string;
    artifactId?: string;
  }>;
  summary?: string;
  open?: boolean;
}
```

Behavior:

- Validate all `refId` values exist.
- Treat `preview` as bounded/redacted model-visible text.
- If `open`, show flow mode with nodes, edges, observations, and source refs.

Return compact metadata only.

### `code_artifact_register`

Register a compact pointer to runtime/debugging output produced by another tool.

Parameters:

```ts
{
  kind: "tap" | "trace" | "repl-result" | "portal" | "flowstorm" | "test" | "lint" | "profile";
  title: string;
  sourceTool?: string;
  refIds?: string[];
  preview?: string;
  externalUri?: string;
  inMemoryOnly?: boolean;
}
```

MVP can keep this as an optional stub unless another extension calls it. The important contract is that artifacts are metadata-first and can be linked from tours/flows.

## Commands

### `/code-view [ref-id | path[:line[-line]]]`

Open a viewer overlay for a registered ref or direct path/range.

Examples:

```text
/code-view ref_12
/code-view src/mount/core.cljc:166-194
/code-view README.md
```

### `/review`

Open the latest review bundle. If none exists, create one from current working tree changes.

### `/changed`

Create and open a review bundle for current working tree changes.

Options can be simple string flags in MVP:

```text
/changed --staged
/changed --base main
```

### `/code-refs`

List registered refs, bundles, tours, flows, and artifacts in a compact selector or text list. Pressing enter on an item opens it if using a selector overlay.

### `/tour [tour-id]`

Open a guided tour overlay. If no `tour-id` is supplied, show a selector of recent tours.

Examples:

```text
/tour tour_1
/tour
```

### `/flow [flow-id]`

Open a data-flow overlay. If no `flow-id` is supplied, show a selector of recent flows.

Examples:

```text
/flow flow_1
/flow order-pipeline
```

## TUI viewer UX

Use `ctx.ui.custom(factory, { overlay: true, overlayOptions })`.

Recommended overlay options:

```ts
{
  overlay: true,
  overlayOptions: {
    width: "90%",
    maxHeight: "85%",
    minWidth: 80,
    anchor: "center",
    margin: 1
  }
}
```

### Layout

```text
┌─ Code Viewer ──────────────────────────────────────────────┐
│ ref_12  src/mount/core.cljc:166-194  defstate macro        │
├────────────────────────────────────────────────────────────┤
│ 166  (defmacro defstate                                    │
│ 167    "defines a state..."                                │
│ ...                                                        │
├────────────────────────────────────────────────────────────┤
│ ↑/↓ scroll  PgUp/PgDn  d diff  c code  o outline  q close │
└────────────────────────────────────────────────────────────┘
```

### Modes

- `code`: syntax-highlighted file/range view.
- `diff`: unified diff view with added/removed/context colors.
- `outline`: list refs in current bundle/tour/flow.
- `tour`: guided step-by-step explanation view with current code ref and compact note.
- `flow`: data-flow graph/list view showing nodes, edges, and bounded observations linked to code refs.
- `artifact`: compact runtime artifact view, with external URI hints for Portal/FlowStorm/profile files when available.
- `side-by-side`: Phase 2, if terminal width allows.

### Keyboard controls

- `q` / `esc`: close.
- `up/down`: scroll one line or move selection in outline.
- `pgup/pgdn`: scroll page.
- `home/end`: top/bottom.
- `d`: switch to diff mode.
- `c`: switch to code mode.
- `o`: switch to outline mode.
- `enter`: open selected ref from outline/tour/flow.
- `[` / `]`: previous/next tour step or flow node.
- `f`: switch to flow mode if current ref belongs to a flow.
- `t`: switch to tour mode if current ref belongs to a tour.
- `/`: enter search mode.
- `n` / `N`: next/previous search hit.
- `y`: copy path/range command to clipboard if feasible; otherwise show the command in a notification.

### Rendering rules

- Every `render(width)` line must be truncated/wrapped so visible width never exceeds `width`.
- Recompute theme-dependent styled text in `render()` or `invalidate()`.
- Call `tui.requestRender()` after state changes in `handleInput()`.
- Show clear metadata-only messages for missing, binary, ignored, or unsafe files.

## Syntax highlighting

MVP highlighter should be simple and dependency-light:

- Extension-based language detection.
- Diff additions/removals/context/hunk headers.
- Comments, strings, keywords, numbers, parens/punctuation for common languages.
- Use pi theme colors:
  - `syntaxComment`
  - `syntaxKeyword`
  - `syntaxFunction`
  - `syntaxString`
  - `syntaxNumber`
  - `syntaxPunctuation`
  - `toolDiffAdded`
  - `toolDiffRemoved`
  - `toolDiffContext`

Phase 2 may add Shiki or tree-sitter if startup time and package size remain acceptable.

## Diff rendering

For changed files:

- Use `git diff --no-ext-diff --unified=80 -- path` for working-tree diffs.
- Use `git diff --cached --no-ext-diff --unified=80 -- path` for staged diffs.
- Use `git diff base --no-ext-diff --unified=80 -- path` when `base` is provided.
- Store only metadata in registry; recompute diff when opening in MVP.
- Render:
  - `+` additions with `toolDiffAdded`.
  - `-` removals with `toolDiffRemoved`.
  - hunk headers with `accent`.
  - context with `toolDiffContext` or `dim`.

## Automatic edit/write tracking

Listen to `tool_result` and inspect built-in tool results for changed files.

When a file is changed:

1. Register a `diff` ref for that file if not already present in the latest auto bundle.
2. Create/update a bundle named `Latest changes`.
3. Persist compact metadata.
4. Optionally notify:

```text
Changed 2 files. Run /review to inspect diffs.
```

Because built-in tool result shapes may evolve, detection should be defensive:

- Prefer structured `details.path`/`details.files` if available.
- Fall back to parsing known compact result text only as best effort.
- Never parse or persist source/diff content.

## Language/toolkit integration

`pi-code-viewer` should remain language-agnostic, but it should provide a simple metadata protocol that other pi packages can use.

### Integration pattern

When a user says “help me understand this codebase and data flow,” the agent may use language-specific tools and then register viewer metadata:

1. A project overview tool finds modules, functions, tests, internal dependency edges, and instrumentation points.
2. A symbol/var inspection tool finds source file/line metadata for important definitions.
3. A tracing tool observes calls/returns through selected functions.
4. A value capture tool collects staged values from instrumentation points.
5. External visual debugging tools may open browser-based or standalone inspectors.
6. The agent registers:
   - `CodeRef`s for relevant definitions/files/tests.
   - a `CodeTour` for the conceptual path.
   - a `DataFlow` for call/data edges and compact observations.
   - `RuntimeArtifact`s for trace/capture/test/lint/debugger metadata.

Example compact agent response:

```text
I mapped the request data flow using project_overview + trace tools.
Registered flow_3 “Order request pipeline” and tour_2 “How orders are processed”.
Open /flow flow_3 for the runtime path, or /tour tour_2 for a step-by-step code walkthrough.
```

The viewer should not replace external debugging tools. It should point to them and connect their observations back to source refs inside pi.

## Path safety

All path handling must go through a shared safe resolver:

1. Resolve candidate path against `ctx.cwd`.
2. Reject if resolved path is outside `ctx.cwd` unless an explicit future setting permits it.
3. Reject NUL bytes and suspicious control characters.
4. Prefer cwd-relative display paths.
5. Avoid following symlinks outside cwd when reading; use `realpath` checks where feasible.
6. Treat binary files as non-viewable; show metadata only.
7. Respect `.gitignore` for auto-discovery/indexing where practical, but direct explicit `/code-view path` may show tracked or unignored files under cwd.

## Error handling

Return compact, model-visible errors:

- Unknown ref ID.
- Path outside cwd.
- File missing.
- File too large for direct display.
- Not a git repository.
- No changed files.
- UI unavailable.

For large files, MVP should display only a bounded window around the requested range or a warning with file size.

## Configuration

Optional settings for Phase 1.1+:

```ts
type CodeViewerConfig = {
  maxFileBytes: number;       // default 1_000_000
  maxDiffBytes: number;       // default 2_000_000
  defaultContextLines: number;// default 80
  autoTrackEdits: boolean;    // default true
  persistMetadata: boolean;   // default true
  respectGitignore: boolean;  // default true
};
```

## MVP scope

1. Standalone package `pi-code-viewer`.
2. Commands:
   - `/code-view`
   - `/review`
   - `/changed`
   - `/code-refs`
   - `/tour`
   - `/flow`
3. Tools:
   - `code_ref_register`
   - `code_ref_open`
   - `code_review_changed`
   - `code_context_summary`
   - `code_tour_register`
   - `code_flow_register`
   - `code_artifact_register` (optional MVP stub)
4. Overlay component:
   - code mode
   - diff mode
   - outline mode
   - tour mode
   - flow mode
   - artifact metadata mode
   - close/scroll/search
5. Git diff integration.
6. Auto-track `edit`/`write` changed files.
7. Metadata-only persistence.
8. README with install instructions and ASCII screenshots.

## Phase 2

- `code_ref_for_symbol` with language heuristics.
- LSP integration for definitions/references.
- Side-by-side diff.
- Inline blame / last commit info.
- “Open in editor” integration.
- Richer multi-ref tour mode with diagrams and collapsible notes.
- Clickable/selectable refs in custom tool rendering if pi supports actions.
- Frozen review snapshots that keep diff text in memory for the current process only.
- Config UI via a pi settings command.

## Implementation plan

### Milestone 1: Registry and path safety

- Implement `CodeRef`, `ReviewBundle`, `CodeTour`, `DataFlow`, `RuntimeArtifact`, `Registry`.
- Implement safe path resolution and path/range parser.
- Implement metadata persistence/restore.
- Add unit tests for path normalization, range parsing, and ID allocation.

### Milestone 2: Basic commands/tools

- Implement `code_ref_register`, `code_ref_open`, `code_context_summary`.
- Implement `/code-view` and `/code-refs`.
- Implement `code_tour_register`, `code_flow_register`, and optional `code_artifact_register` metadata storage.
- Implement `/tour` and `/flow` selectors using the same overlay component.
- Return compact metadata only.

### Milestone 3: Viewer overlay

- Implement `CodeViewerComponent`.
- Support code rendering, range focus, scrolling, close keys.
- Add simple syntax highlighting and line numbers.
- Add tour/flow navigation (`[`/`]`, enter-to-open, observations panel).
- Enforce render width constraints.

### Milestone 4: Git review

- Implement git helpers.
- Implement `code_review_changed`, `/changed`, `/review`.
- Implement diff rendering.
- Handle non-git and no-change states.

### Milestone 5: Auto tracking

- Listen for `tool_result` for `edit` and `write`.
- Update latest review bundle.
- Notify user without bloating context.

### Milestone 6: Polish

- Search inside overlay.
- Better custom renderers for tool results.
- README screenshots/ASCII demos.
- Document integration patterns for language/toolkit extensions.
- Manual QA checklist.

## Manual QA checklist

- Register a file ref; LLM sees only metadata.
- Register a range ref; overlay opens focused on the requested lines.
- Open `/code-view path:line-line` without prior registration.
- Run `/changed` in a git repo with changes; diff overlay opens.
- Run `/changed` outside a git repo; compact error appears.
- Edit/write a file with pi tools; `/review` includes it.
- Register a tour; `/tour` steps through refs in order without putting source in chat.
- Register a flow with observations; `/flow` shows nodes, edges, and bounded runtime previews.
- Simulate a trace/tap artifact from an external tool extension; artifact metadata links back to source refs.
- Press `q` and `esc`; overlay closes cleanly.
- Narrow terminal; rendered lines do not exceed width.
- Try `../outside-file`; path is rejected.
- Try binary/large file; viewer refuses or bounds display.
- Resume/reload session; refs restore as metadata pointers only.

## Acceptance criteria

- Agent can register a file/range without returning code to the model.
- User can open a closable overlay and inspect syntax-highlighted code.
- User can inspect current git diff in a closable overlay.
- User can open a guided tour to understand a feature/subsystem through ordered refs and notes.
- User can open a data-flow view linking code refs to compact runtime observations from tools such as Clojure REPL trace/tap collection.
- After an `edit`/`write`, `/review` shows changed files/diffs.
- Tool results remain compact under normal use.
- Paths are safe and cwd-confined.
- Session persistence stores metadata only.
- Package works as a standalone pi package.

## Open questions

1. Does pi expose stable clickable regions/actions in rendered tool output, or should MVP remain command-driven?
Yes, include it
2. What structured details do built-in `edit` and `write` tool results currently expose for changed paths?
3. Should direct `/code-view path` respect `.gitignore`, or only auto-indexing?
Later
4. Should diff views be live by default, or should users be able to freeze a review snapshot?
Leter
5. Should `code_ref_open` be agent-callable by default, or should opening overlays be primarily user-command driven to avoid UI interruption?
Let user decide
