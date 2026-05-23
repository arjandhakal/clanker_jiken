# Clojure Agent Toolkit for pi

Standalone pi package that gives the pi coding agent a Clojure-aware REPL, debugger, test, lint, formatting, structural-edit, LSP, and dependency-audit toolkit.

Extension entrypoint: `extensions/index.ts`

## Use from a project

Add the package to `.pi/settings.json`:

```json
{
  "packages": [
    "../pi-clojure-agent-toolkit"
  ]
}
```

Then run `/reload` in pi or restart pi from that project directory.

## Recommended macOS setup

```bash
brew install clojure/tools/clojure
brew install borkdude/brew/clj-kondo
brew install clojure-lsp/brew/clojure-lsp-native
brew install borkdude/brew/babashka

# Optional formatter. Note: macOS /usr/bin/zprint is NOT Clojure zprint.
brew install zprint || true
# Optional alternative formatter
brew install cljfmt || true
```

Start an nREPL that writes `.nrepl-port`. Example deps.edn alias:

```clojure
{:aliases
 {:nrepl
  {:extra-deps {nrepl/nrepl {:mvn/version "1.3.1"}
                cider/cider-nrepl {:mvn/version "0.56.0"}}
   :main-opts ["-m" "nrepl.cmdline"
               "--middleware" "[cider.nrepl/cider-middleware]"]}}}
```

Run:

```bash
clojure -M:nrepl
```

For quick babashka projects:

```bash
bb nrepl-server 127.0.0.1:1667
# in another shell, if bb did not write it:
echo 1667 > .nrepl-port
```

## What the agent can do

### Live REPL evaluation

- `clj_repl_eval` — evaluate Clojure through nREPL and return values/stdout/stderr/errors.
- `clj_repl_op` — send raw nREPL ops, useful for cider-nrepl/refactor-nrepl operations.
- `clj_repl_require_reload` — `(require 'my.ns :reload)` or `:reload-all` after edits.

This lets the agent verify behavior in the same running app REPL instead of guessing.

### Data debugging and tracing

- `clj_repl_tap_collect` — temporarily installs `add-tap`, evaluates an expression, and returns every `tap>` value plus the final result.
- `clj_repl_trace` — temporarily wraps selected fully-qualified vars with `with-redefs`, evaluates an expression, and returns call/return/throw events with args and values.
- `clj_repl_inspect_var` — resolves a var and returns arglists, docstring, metadata, source file/line, value class, and a safe value preview.
- `clj_repl_macroexpand` — macroexpand one form in the target namespace.

Examples of things the agent can ask the REPL:

```clojure
;; collect tap> values while exercising a pipeline
(tap> {:stage :parsed :value parsed})

;; trace selected vars without editing source
my.app.parser/parse
my.app.rules/apply-rules
my.app.db/save!

;; inspect a var before changing it
my.app.core/process-order

;; macroexpand a DSL form
(-> order normalize validate persist!)
```

### Tests and quality loop

- `clj_repl_run_test` — run a focused test namespace or single test var inside the live REPL.
- `clj_run_tests` — run project test commands: `bin/kaocha`, `kaocha`, `bb test`, or `clojure -M:test`.
- `clj_lint` — run `clj-kondo`.
- `clj_format` — run Clojure zprint or cljfmt if installed. The extension deliberately ignores macOS `/usr/bin/zprint` because it is a kernel memory tool, not the Clojure formatter.
- `clj_lsp_diagnostics` — run `clojure-lsp` diagnostics when installed.
- `clj_deps_audit` — run `antq` and/or `clj-watson` when available.
- `clj_replace_top_level_form` — replace one complete top-level `def`, `defn`, `defmacro`, `deftest`, etc. more safely than raw text editing.

After raw `edit`/`write` to `.clj`, `.cljs`, `.cljc`, or `.edn`, the extension reminds the agent to lint/format/test.

### Optional debug/profiling ecosystem checks

- `clj_debug_toolkit_status` — checks whether optional libraries are present in the live REPL and prints install guidance when missing.

Useful optional libraries:

- **cider-nrepl** — richer nREPL info, stacktrace, completion, macroexpand, test ops.
- **refactor-nrepl** — refactor operations such as clean-ns and rename support.
- **FlowStorm** — serious time-travel debugger/tracer for Clojure/CLJS.
- **Portal** / **Reveal** — rich visual inspectors for `tap>` data.
- **clj-async-profiler** — CPU allocation profiling/flamegraphs. macOS: `brew install async-profiler graphviz` plus the Clojure dependency.
- **criterium** — reliable microbenchmarking.
- **debux**, **hashp**, **clojure.tools.trace** — lightweight expression and var tracing.

If the agent tries to use a missing optional dependency, the tool output includes the missing namespace/error and macOS-oriented install hints.

## Command

- `/clojure-doctor` — reminder command for the full quality loop: lint, LSP diagnostics, tests, dependency audit, and REPL checks.

## Suggested agent workflow

1. Read relevant files.
2. Use `clj_repl_inspect_var` and `clj_repl_macroexpand` to understand behavior.
3. Use `clj_repl_tap_collect` or `clj_repl_trace` to follow data through the running system.
4. Edit with `clj_replace_top_level_form` where possible.
5. Run `clj_repl_require_reload`.
6. Run focused `clj_repl_run_test`.
7. Run `clj_lint`, `clj_format`, and broader `clj_run_tests`.
