# pi-rough-pad

Repo-scoped Markdown rough pads for Pi. A repository can have many pads, while every Pi session independently selects which pad its agent should use. Pads live outside git by default.

```text
~/.pi/agent/rough-pad/
```

## Install globally

From this repository:

```bash
pi install ./pi-rough-pad
```

The package is added to `~/.pi/agent/settings.json` and becomes available in every Pi project. Reload an already-running Pi session with `/reload` or start a new session after installation or upgrades.

For one-off testing:

```bash
pi -e ./pi-rough-pad/extensions/index.ts
```

## Mental model

- **Repository:** owns a collection of named pads.
- **Selected pad:** the default pad for commands and agent tool calls in one Pi session.
- **Loaded pad:** the last pad whose contents were supplied to that session's agent.
- **Current:** the loaded file has not changed since it was loaded.
- **Stale:** the file changed after loading; read or load it again.

Selection is stored in the Pi session transcript, not in a repo-global setting. Parallel agents in the same repository can therefore select different pads without changing each other's target.

The footer shows the current state:

```text
pad:auth-refactor ✓
pad:api-work · loaded:old-plan!
```

`✓` means the selected pad is loaded and current. `!` means the last-loaded content is stale or missing.

## Typical workflow

```text
/pad new auth-refactor
/pad open
/pad load
```

In another Pi session:

```text
/pad new billing-fix
/pad load
```

Each agent now has a different selected pad.

## Commands

```text
/pad                     Show selected and loaded status
/pad help                Show command help
/pad list                List pads with state markers
/pad new <name>          Create and select a pad for this session
/pad switch [name]       Select an existing pad; opens a picker when omitted
/pad use [name]          Alias for switch
/pad active              Show detailed status
/pad load [name]         Select and send a pad's contents to the agent
/pad open [name]         Open a pad in the terminal editor
/pad read [name]         Display a pad to you without loading it for the agent
/pad show [name]         Alias for read
/pad path [name]         Show the pad file path
/pad append <text>       Append text to the selected pad
/pad note <text>         Append a timestamped note
/pad write <text>        Replace the selected pad's contents
/pad clear [name]        Reset a pad to the default template
/pad delete [name]       Delete a pad
```

List markers:

- `▶` — selected by this Pi session
- `●` — loaded by the agent and unchanged
- `!` — loaded but changed or deleted since loading

Passing `[name]` accesses that named pad without silently changing the session selection, except `/pad load <name>`, which deliberately selects and loads it.

## Agent usage

The extension registers a model-callable `rough_pad` tool. The agent can:

- list available pads and see selected/loaded state
- select a pad for its current session
- read and load it
- append notes
- perform exact replacements
- rewrite, clear, or delete pads

Example requests:

```text
List my rough pads and ask which one I mean.
Use the auth-refactor pad for this session.
Read the selected rough pad and continue from its plan.
Add our decision to the selected rough pad.
Check whether the loaded pad is stale, then reread it if needed.
```

If you name a pad when asking the agent to read it, that pad becomes selected and loaded for that Pi session.

## Editor selection

`/pad open` uses the first available option:

1. `PI_ROUGH_PAD_EDITOR`
2. `VISUAL`
3. `EDITOR`
4. `nvim`
5. `vim`
6. `vi`
7. `nano`

## Configuration

- `PI_ROUGH_PAD_DIR` — override the storage directory.
- `PI_ROUGH_PAD_EDITOR` — override the terminal editor command.

## Safety

Pads are stored outside the repository under `~/.pi/agent/rough-pad` by default, so they cannot be accidentally committed. If `PI_ROUGH_PAD_DIR` points inside a repository, exclude that path with `.git/info/exclude` or `.gitignore`.
