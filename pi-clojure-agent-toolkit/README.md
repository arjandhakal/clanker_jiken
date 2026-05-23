# Clojure Agent Toolkit for pi

Standalone pi package for Clojure development tools.

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

## What it adds

Tools registered for the LLM:

- `clj_repl_eval` — evaluate code through nREPL; reads `.nrepl-port` by default.
- `clj_repl_op` — raw nREPL op for cider-nrepl/refactor-nrepl operations.
- `clj_lint` — run `clj-kondo`.
- `clj_format` — run `zprint` or `cljfmt`.
- `clj_run_tests` — run `bin/kaocha`, `kaocha`, `bb test`, or `clojure -M:test`.
- `clj_lsp_diagnostics` — run `clojure-lsp` diagnostics/analyze attempts.
- `clj_replace_top_level_form` — structural-ish replacement of a complete top-level Clojure def form.
- `clj_deps_audit` — run `antq` and/or `clj-watson` when available.

Command:

- `/clojure-doctor` — reminder command for the full quality loop.

Event behavior:

- After raw `edit`/`write` to `.clj`, `.cljs`, `.cljc`, or `.edn`, the tool result reminds the agent to run lint/format/tests.

## Recommended project setup

Install whichever tools you want the extension to use:

```bash
brew install borkdude/brew/clj-kondo
brew install clojure-lsp/brew/clojure-lsp-native
brew install borkdude/brew/babashka
brew install zprint
# optional
brew install cljfmt
```

For nREPL eval, start a REPL that writes `.nrepl-port`, for example from a deps.edn project:

```bash
clojure -M:nrepl
```

or however your project starts nREPL.
