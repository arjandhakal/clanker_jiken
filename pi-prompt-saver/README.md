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

## Commands

- `/save-prompt <name>` — save the last non-command user prompt.
- `/saved-prompts [filter]` — list saved prompts.
- `/load-prompt <name>` — load a saved prompt into the editor.
- `/delete-prompt <name>` — delete a saved prompt.

Prompt text is stored in `~/.pi/agent/prompt-saver/prompts.json` by default. Set `PI_PROMPT_SAVER_FILE` to use a different JSON file.

Only prompt text is persisted; attached images are counted in metadata but not saved.
