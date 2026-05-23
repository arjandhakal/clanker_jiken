# pi-pet

A tiny pet widget for the [pi coding agent](https://pi.dev). It adds compact pixel-art pets extracted from the Craftpix female sprite package you provided, with character selection and mood/action animation while you work.

Source/derived assets:
- `assets/female-sprites-pixel-art/` — source package with `Enchantress`, `Knight`, and `Musketeer` spritesheets.
- `assets/female-sprites-preview.png` — quick local preview of the selected character/action frames.
- `extensions/pi-pet/petSpriteData.ts` — generated terminal palette, characters, actions, and animation frames.

## What it does

- Shows a compact pixel-art pet near the editor.
- Changes mood automatically:
  - `thinking` when pi starts responding
  - `tool` while tools run, using an attack animation
  - `happy` when a turn finishes
  - `error` if a tool fails, using a hurt animation
  - `idle` after a short cooldown
- Provides slash commands for showing/hiding, petting, placement, character selection, and manual moods.
- Uses Braille-cell rendering, so each terminal character preserves a 2x4 block from the full 32x32 sprite and the whole body fits into a compact 16-column by 8-row terminal pet.
- Runs a small ambient animation every 10 seconds, cycling moods and teleporting between left/right offsets and above/below placement.
- Uses a generated character/action registry so more spritesheets can be added later.

## Install / run

From this repo:

```bash
pi -e ./pi-pet/extensions/pi-pet/index.ts
```

Or install it as a local pi package:

```bash
pi install -l ./pi-pet
# then /reload inside pi, or restart pi
```

## Commands

```text
/pet                         show current status/help
/pet show                    show the pet
/pet hide                    hide the pet
/pet pat                     make the pet happy
/pet mood idle               set a mood manually
/pet mood thinking
/pet mood tool
/pet mood happy
/pet mood error
/pet mood sleepy
/pet mood angry
/pet mood curious
/pet mood dozing
/pet mood reading
/pet mood casting
/pet mood confused
/pet mood content
/pet place above             render above the editor
/pet place below             render below the editor
/pet choose enchantress      choose the enchantress pet
/pet choose knight
/pet choose musketeer
/pet-pat                     shortcut command for /pet pat
```

## Adding another pet later

The extension currently supports three `PetId`s (`enchantress`, `knight`, and `musketeer`). To add another pet:

1. Add a source folder under `assets/female-sprites-pixel-art/` with the same action sheet names.
2. Regenerate `extensions/pi-pet/petSpriteData.ts` from the source sheets.
3. Add the new id to the generated `PET_IDS` list.

You can also move each pet into its own module if the registry grows.
