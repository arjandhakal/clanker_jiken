# pi-pet

A tiny pet widget for the [pi coding agent](https://pi.dev). It adds a cute Frieren pixel-art pet, extracted from the multi-expression sprite sheet you provided, with different moods while you work.

Source/derived assets:
- `assets/source/frieren-pixel-source.jpg` — downloaded from the user-provided pixel-art URL.
- `assets/frieren-pixel-32.png` — point-resized 32x32, 32-color terminal source.
- `assets/frieren-pixel.png` — enlarged nearest-neighbor preview.
- `assets/frieren-pixel-generated.txt` — palette and terminal rows used by the extension.
- `frieren_png_art.png` — multi-expression source sheet provided by the user.
- `assets/frieren-sprites/*.png` — extracted 32x32 transparent-ish sprite variants.
- `assets/frieren-sprites-preview.png` — quick local preview of the extracted set.
- `extensions/pi-pet/frierenSpriteData.ts` — generated terminal palette and sprite rows.

## What it does

- Shows a compact pixel-art pet near the editor.
- Changes mood automatically:
  - `thinking` when pi starts responding
  - `tool` while tools run, using the casting-staff sprite
  - `happy` when a turn finishes
  - `error` if a tool fails, using the angry sprite
  - `idle` after a short cooldown
- Provides slash commands for showing/hiding, petting, placement, and manual moods.
- Samples the full 32x32 source sprite down while rendering, so the whole body fits into a compact 16-column by 8-row terminal pet.
- Runs a small ambient animation every few seconds, cycling moods and teleporting between left/right offsets and above/below placement.
- Uses a small registry so more pets can be added later.

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
/pet pat                     make Frieren happy
/pet mood idle               set a mood manually
/pet mood thinking
/pet mood tool
/pet mood happy
/pet mood error
/pet mood sleepy
/pet mood angry
/pet mood curious
/pet mood blushing
/pet mood dozing
/pet mood reading
/pet mood casting
/pet mood confused
/pet mood content
/pet place above             render above the editor
/pet place below             render below the editor
/pet choose frieren          choose the Frieren-inspired pet
/pet-pat                     shortcut command for /pet pat
```

## Adding another pet later

The extension currently has one `PetId` (`frieren`) and one renderer. To add another pet:

1. Add the new id to `type PetId` and `PETS` in `extensions/pi-pet/index.ts`.
2. Add another art array and render function.
3. Dispatch based on `state.pet` in `render()`.

You can also move each pet into its own module if the registry grows.
