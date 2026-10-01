# pi-prompt-saver

Pi extension for saving the last prompt you sent to the agent under a reusable name.

## Install

From this repository:

```bash
pi install ./pi-prompt-saver
```

For one-off testing:

```bash
pi -e ./pi-prompt-saver/extensions/index.ts
```

## Interactive workflow

Run `/prompts` to open a searchable picker. Each result shows the saved name and a prompt preview. Selecting an item loads it into the editor.

Names are optional for interactive commands. `/save-prompt` asks for a name. `/load-prompt` and `/delete-prompt` open the same picker.

## Commands

- `/prompts` opens the saved-prompt picker and loads the selection.
- `/save-prompt [name]` saves the last non-command user prompt.
- `/saved-prompts [filter]` lists saved prompts.
- `/load-prompt [name]` loads a saved prompt into the editor.
- `/delete-prompt [name]` deletes a saved prompt.

Explicit names remain useful in non-interactive modes.

Prompt text is stored in `~/.pi/agent/prompt-saver/prompts.json` by default. Set `PI_PROMPT_SAVER_FILE` to use a different JSON file.

Only prompt text is persisted; attached images are counted in metadata but not saved.
