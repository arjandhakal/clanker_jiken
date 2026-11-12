# pi-markdown-reader

Read local Markdown in a scrollable Pi overlay without sending it to the model.
Uses only Node built-ins and Pi's host-provided Markdown renderer. No runtime dependencies, browser, Pandoc, or network requests.

## Load

From the repository root, install the local package globally:

```sh
pi install ./pi-markdown-reader
```

Then run `/reload` in Pi. To try it in a separate session without installing:

```sh
pi -e ./pi-markdown-reader/extensions/index.ts
```

## Read

Enter directly in Pi's editor:

```text
/md
/md skills/pstack/principle-laziness-protocol/SKILL.md
/md "docs/design notes.md"
/md ~/.agents/skills/essence/SKILL.md
```

No path defaults to `README.md`. Relative paths resolve against the session's working directory; absolute paths, `~/`, paths with spaces, and symlinks work. Files must be regular files of at most 2 MiB. The reader displays a snapshot; close and reopen to reread a changed file.

| Key | Action |
| --- | --- |
| ↑ / ↓ or k / j | Scroll one line |
| PgUp / PgDn | Scroll one page |
| Space | Next page |
| Home / End | Start / end |
| q / Esc | Close |

Headings, lists, tables and fenced code blocks use Pi's Markdown rendering and active theme. This is a text reader, not a browser: it does not execute code, fetch images, or render Mermaid diagrams. Works in interactive terminal mode only.

## Context policy

`/md` is a user command, not an agent tool. File contents live only in the overlay; the extension never sends messages, appends session entries, invokes the model, or modifies the editor. Ask the agent to read a file separately only when you want it in context.

## Tests

With Node.js 22.19+ and Pi installed:

```sh
cd pi-markdown-reader
npm test
```

Tests use the installed Pi renderer without downloading dependencies. Set `PI_PACKAGE_ROOT` to the Pi package directory if `pi` is not on `PATH`.
