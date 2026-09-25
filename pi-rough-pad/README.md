# pi-rough-pad

Repo-scoped Markdown rough pads for Pi. Use them for messy feature notes, decisions, plans, open questions, and reminders that should be easy for both you and the agent to update but should never be committed.

Pads are stored outside the repository by default:

```text
~/.pi/agent/rough-pad/
```

The extension keys pads by the current git repository root, so every Pi session in the same repo can find the same pad.

## Install

From this repository:

```bash
pi install ./pi-rough-pad
```

For one-off testing:

```bash
pi -e ./pi-rough-pad/extensions/index.ts
```

## Commands

```text
/pad                     Show active pad status and usage
/pad help                Show command help
/pad path [name]         Show the pad file path
/pad open [name]         Open the pad in $PI_ROUGH_PAD_EDITOR, $VISUAL, $EDITOR, nvim, vi, or nano
/pad read [name]         Display the pad contents
/pad show [name]         Alias for read
/pad load [name]         Send the pad contents to the agent as a user message
/pad use <name>          Switch the active pad for this repo, creating it if needed
/pad active              Show the active pad name
/pad list                List pads for this repo
/pad append <text>       Append text to the active pad
/pad note <text>         Append a timestamped note to the active pad
/pad write <text>        Replace the active pad body with text
/pad clear [name]        Reset a pad to the default template
/pad delete [name]       Delete a pad file
```

Pad names are optional for commands that read/open/delete. If omitted, the repo's active pad is used. The initial active pad defaults to the current git branch name, or `default` if no branch is available.

## Agent tool

The extension registers a model-callable `rough_pad` tool with actions:

- `read`
- `append`
- `note`
- `write`
- `replace`
- `clear`
- `delete`
- `path`
- `list`
- `use`

Example prompts:

```text
Read my rough pad and continue from the current plan.
Update the rough pad with the decision we just made.
Append the open questions to the rough pad.
Replace the stale implementation notes in the rough pad.
```

## Configuration

Environment variables:

- `PI_ROUGH_PAD_DIR` — override the storage directory.
- `PI_ROUGH_PAD_EDITOR` — preferred editor for `/pad open`.

## Safety

Rough pads are stored outside the repo by default, under `~/.pi/agent/rough-pad`, so they are not accidentally committed. If you set `PI_ROUGH_PAD_DIR` to a repo-local path, add that path to `.git/info/exclude` or `.gitignore` yourself.
