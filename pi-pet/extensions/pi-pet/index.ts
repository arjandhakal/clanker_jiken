import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";

import { FRIEREN_PALETTE, FRIEREN_SPRITES } from "./frierenSpriteData";

type PetId = "frieren";
type Placement = "aboveEditor" | "belowEditor";
type TeleportSpot = {
    indent: number;
    placement: Placement;
};

const MOOD_SPRITES = {
    idle: "neutral",
    neutral: "neutral",
    thinking: "curious",
    curious: "curious",
    tool: "casting-staff",
    casting: "casting-magic",
    "casting-staff": "casting-staff",
    magic: "casting-magic",
    happy: "happy",
    sad: "sad",
    excited: "excited",
    "magic-excited": "magic-excited",
    "soft-excited": "soft-excited",
    error: "angry",
    angry: "angry",
    sleepy: "dozing",
    dozing: "dozing",
    blushing: "blushing",
    shy: "shy-blushing",
    "shy-blushing": "shy-blushing",
    reading: "reading-brown",
    "reading-brown": "reading-brown",
    "reading-blue": "reading-blue",
    "reading-green": "reading-green",
    confused: "confused",
    content: "content",
} as const;

type Mood = keyof typeof MOOD_SPRITES;

type PetState = {
    pet: PetId;
    visible: boolean;
    placement: Placement;
    mood: Mood;
};

const WIDGET_ID = "pi-pet";
const STATUS_ID = "pi-pet";
const STATE_ENTRY = "pi-pet-state";

const MOODS = Object.keys(MOOD_SPRITES) as Mood[];
const PETS: PetId[] = ["frieren"];
const MOOD_HELP = "idle, happy, sad, excited, angry, curious, blushing, dozing, reading, casting, confused, content";
const PET_RENDER_SIZE = 16;
const AMBIENT_ANIMATION_MS = 6400;
const AMBIENT_MOODS: Mood[] = ["idle", "curious", "reading", "content", "blushing", "happy", "confused", "dozing"];
const TELEPORT_SPOTS: TeleportSpot[] = [
    { indent: 0, placement: "belowEditor" },
    { indent: 5, placement: "belowEditor" },
    { indent: 10, placement: "belowEditor" },
    { indent: 4, placement: "aboveEditor" },
    { indent: 9, placement: "aboveEditor" },
];

const defaultState: PetState = {
    pet: "frieren",
    visible: true,
    placement: "belowEditor",
    mood: "idle",
};

const moodText: Partial<Record<Mood, string>> = {
    idle: "Frieren is quietly reading next to your editor.",
    neutral: "Frieren is keeping watch.",
    thinking: "Frieren is thinking very hard...",
    curious: "Frieren is curious about this one.",
    tool: "Frieren is inspecting your tools.",
    casting: "Frieren is casting a tiny spell.",
    "casting-staff": "Frieren is readying a spell.",
    magic: "Frieren is casting a tiny spell.",
    happy: "Frieren found a cute little victory.",
    sad: "Frieren is feeling a little distant.",
    excited: "Frieren spotted something interesting.",
    "magic-excited": "Frieren found something sparkly.",
    "soft-excited": "Frieren is quietly excited.",
    error: "Frieren noticed a cursed error.",
    angry: "Frieren is not amused.",
    sleepy: "Frieren is taking a tiny nap.",
    dozing: "Frieren is taking a tiny nap.",
    blushing: "Frieren is flustered.",
    shy: "Frieren is shyly cheering you on.",
    "shy-blushing": "Frieren is shyly cheering you on.",
    reading: "Frieren is reading beside you.",
    "reading-brown": "Frieren is reading beside you.",
    "reading-blue": "Frieren is studying quietly.",
    "reading-green": "Frieren is checking the old notes.",
    confused: "Frieren is puzzled.",
    content: "Frieren is content.",
};

const moodBubble: Partial<Record<Mood, string>> = {
    idle: "ꕤ ready",
    neutral: "ꕤ calm",
    thinking: "✦ hmm...",
    curious: "? curious",
    tool: "⌘ working",
    casting: "✦ cast",
    "casting-staff": "✦ staff",
    magic: "✦ magic",
    happy: "♪ nice!",
    sad: "… sad",
    excited: "! wow",
    "magic-excited": "✦ wow",
    "soft-excited": "♪ oh",
    error: "! uh-oh",
    angry: "! hmph",
    sleepy: "zZ nap",
    dozing: "zZ nap",
    blushing: "///",
    shy: "///",
    "shy-blushing": "///",
    reading: "book",
    "reading-brown": "book",
    "reading-blue": "book",
    "reading-green": "book",
    confused: "? hmm",
    content: "ꕤ ok",
};

function ansi(rgb: [number, number, number], text: string): string {
    return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${text}\x1b[39m`;
}

function ansiPair(fg: [number, number, number], bg: [number, number, number], text: string): string {
    return `\x1b[38;2;${fg[0]};${fg[1]};${fg[2]}m\x1b[48;2;${bg[0]};${bg[1]};${bg[2]}m${text}\x1b[39m\x1b[49m`;
}

function textForMood(mood: Mood): string {
    return moodText[mood] ?? `Frieren is feeling ${mood.replace(/-/g, " ")}.`;
}

function bubbleForMood(mood: Mood): string {
    return moodBubble[mood] ?? mood.replace(/-/g, " ");
}

function halfBlock(top: string, bottom: string): string {
    const topColor = FRIEREN_PALETTE[top];
    const bottomColor = FRIEREN_PALETTE[bottom];
    if (topColor && bottomColor) return ansiPair(topColor, bottomColor, "▀");
    if (topColor) return ansi(topColor, "▀");
    if (bottomColor) return ansi(bottomColor, "▄");
    return " ";
}

function sampleSprite(sprite: string[], width: number, height: number): string[] {
    const sourceHeight = sprite.length;
    const sourceWidth = sprite.reduce((max, row) => Math.max(max, row.length), 0);
    const rows: string[] = [];

    for (let y = 0; y < height; y++) {
        const sourceY = Math.min(sourceHeight - 1, Math.floor(((y + 0.5) * sourceHeight) / height));
        let row = "";
        for (let x = 0; x < width; x++) {
            const sourceX = Math.min(sourceWidth - 1, Math.floor(((x + 0.5) * sourceWidth) / width));
            row += sprite[sourceY]?.[sourceX] ?? ".";
        }
        rows.push(row);
    }

    return rows;
}

function renderSprite(sprite: string[]): string[] {
    const sampled = sampleSprite(sprite, PET_RENDER_SIZE, PET_RENDER_SIZE);
    const lines: string[] = [];
    for (let y = 0; y < sampled.length; y += 2) {
        const top = sampled[y] ?? "";
        const bottom = sampled[y + 1] ?? "";
        let line = "";
        for (let x = 0; x < Math.max(top.length, bottom.length); x++) {
            line += halfBlock(top[x] ?? ".", bottom[x] ?? ".");
        }
        lines.push(line.trimEnd());
    }
    return lines;
}

function renderFrieren(theme: Theme, state: PetState, spot: TeleportSpot): string[] {
    const sprite = FRIEREN_SPRITES[MOOD_SPRITES[state.mood]];
    const prefix = " ".repeat(spot.indent);
    const lines = renderSprite(sprite).map((line) => `${prefix}${line}`);
    const name = theme.fg("accent", "pi-pet/frieren");
    const bubble = theme.fg(state.mood === "error" || state.mood === "angry" ? "error" : "muted", bubbleForMood(state.mood));
    const hint = theme.fg("dim", " /pet");
    return [`${prefix}${name} ${bubble}${hint}`, ...lines];
}

function restoreState(ctx: ExtensionContext): PetState {
    let state = { ...defaultState };
    for (const entry of ctx.sessionManager.getEntries()) {
        if (entry.type !== "custom" || entry.customType !== STATE_ENTRY) continue;
        const data = entry.data as Partial<PetState> | undefined;
        if (!data) continue;
        state = {
            pet: data.pet === "frieren" ? data.pet : state.pet,
            visible: typeof data.visible === "boolean" ? data.visible : state.visible,
            placement: data.placement === "aboveEditor" || data.placement === "belowEditor" ? data.placement : state.placement,
            mood: data.mood && MOODS.includes(data.mood) ? data.mood : state.mood,
        };
    }
    return state;
}

function makeExtension(pi: ExtensionAPI) {
    let state: PetState = { ...defaultState };
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let ambientTimer: ReturnType<typeof setInterval> | undefined;
    let ambientFrame = 0;
    let ambientMoodPausedUntil = 0;

    function persist() {
        pi.appendEntry(STATE_ENTRY, state);
    }

    function clearIdleTimer() {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = undefined;
    }

    function clearAmbientTimer() {
        if (ambientTimer) clearInterval(ambientTimer);
        ambientTimer = undefined;
    }

    function currentSpot(): TeleportSpot {
        return TELEPORT_SPOTS[ambientFrame % TELEPORT_SPOTS.length] ?? TELEPORT_SPOTS[0];
    }

    function syncAmbientFrameToPlacement() {
        const placementFrame = TELEPORT_SPOTS.findIndex((spot) => spot.placement === state.placement);
        ambientFrame = placementFrame >= 0 ? placementFrame : 0;
    }

    function render(ctx: ExtensionContext) {
        if (!ctx.hasUI) return;
        if (!state.visible) {
            ctx.ui.setWidget(WIDGET_ID, undefined);
            ctx.ui.setStatus(STATUS_ID, ctx.ui.theme.fg("dim", "pet hidden"));
            return;
        }

        const spot = currentSpot();
        const lines = renderFrieren(ctx.ui.theme, state, spot);
        ctx.ui.setWidget(WIDGET_ID, lines, { placement: spot.placement });
        ctx.ui.setStatus(STATUS_ID, `${ctx.ui.theme.fg("accent", "pet")} ${ctx.ui.theme.fg("dim", state.pet)} ${bubbleForMood(state.mood)} ${ctx.ui.theme.fg("dim", textForMood(state.mood))}`);
    }

    function setMood(ctx: ExtensionContext, mood: Mood, autoIdleMs?: number, ambientPauseMs = AMBIENT_ANIMATION_MS) {
        clearIdleTimer();
        state = { ...state, mood };
        ambientMoodPausedUntil = Date.now() + ambientPauseMs;
        render(ctx);
        if (autoIdleMs) {
            idleTimer = setTimeout(() => {
                state = { ...state, mood: "idle" };
                ambientMoodPausedUntil = 0;
                render(ctx);
            }, autoIdleMs);
        }
    }

    function startAmbientAnimation(ctx: ExtensionContext) {
        clearAmbientTimer();
        ambientTimer = setInterval(() => {
            ambientFrame += 1;
            if (state.visible && Date.now() >= ambientMoodPausedUntil) {
                state = { ...state, mood: AMBIENT_MOODS[ambientFrame % AMBIENT_MOODS.length] };
            }
            render(ctx);
        }, AMBIENT_ANIMATION_MS);
    }

    pi.on("session_start", async (_event, ctx) => {
        state = restoreState(ctx);
        syncAmbientFrameToPlacement();
        startAmbientAnimation(ctx);
        render(ctx);
    });

    pi.on("before_agent_start", async (_event, ctx) => setMood(ctx, "thinking", undefined, 8000));
    pi.on("tool_execution_start", async (_event, ctx) => setMood(ctx, "tool", undefined, 12000));
    pi.on("tool_execution_end", async (event, ctx) => setMood(ctx, event.isError ? "error" : "tool", event.isError ? 3500 : undefined, event.isError ? 7000 : 4500));
    pi.on("agent_end", async (_event, ctx) => setMood(ctx, "happy", 2500, 5000));
    pi.on("session_shutdown", async () => {
        clearIdleTimer();
        clearAmbientTimer();
    });

    pi.registerCommand("pet", {
        description: "Control your pi pet: show, hide, mood <name>, place above|below, choose frieren, pat.",
        handler: async (args, ctx) => {
            const [cmdRaw, valueRaw] = args.trim().split(/\s+/, 2);
            const cmd = (cmdRaw || "status").toLowerCase();
            const value = (valueRaw || "").toLowerCase();

            if (cmd === "status" || cmd === "help") {
                ctx.ui.notify(
                    `pi-pet: ${state.visible ? "shown" : "hidden"}, pet=${state.pet}, mood=${state.mood}, placement=${state.placement}. Commands: /pet show|hide|pat|mood <name>|place above|below|choose ${PETS.join("|")}. Common moods: ${MOOD_HELP}.`,
                    "info",
                );
                render(ctx);
                return;
            }

            if (cmd === "show" || cmd === "on") {
                state = { ...state, visible: true };
                persist();
                render(ctx);
                return;
            }

            if (cmd === "hide" || cmd === "off") {
                state = { ...state, visible: false };
                persist();
                render(ctx);
                return;
            }

            if (cmd === "pat") {
                state = { ...state, visible: true };
                setMood(ctx, "happy", 2500);
                return;
            }

            if (cmd === "mood") {
                if (!MOODS.includes(value as Mood)) {
                    ctx.ui.notify(`Unknown mood. Try: ${MOODS.join(", ")}`, "error");
                    return;
                }
                state = { ...state, visible: true, mood: value as Mood };
                ambientMoodPausedUntil = Date.now() + 8000;
                persist();
                render(ctx);
                return;
            }

            if (cmd === "place" || cmd === "placement") {
                if (value !== "above" && value !== "below") {
                    ctx.ui.notify("Usage: /pet place above|below", "error");
                    return;
                }
                state = { ...state, placement: value === "above" ? "aboveEditor" : "belowEditor" };
                syncAmbientFrameToPlacement();
                persist();
                render(ctx);
                return;
            }

            if (cmd === "choose" || cmd === "pet") {
                if (value !== "frieren") {
                    ctx.ui.notify(`Unknown pet. Available pets: ${PETS.join(", ")}`, "error");
                    return;
                }
                state = { ...state, pet: value as PetId, visible: true };
                persist();
                render(ctx);
                return;
            }

            ctx.ui.notify("Usage: /pet show|hide|pat|mood <mood>|place above|below|choose <pet>", "error");
        },
    });

    pi.registerCommand("pet-pat", {
        description: "Pat your pi pet.",
        handler: async (_args, ctx) => {
            state = { ...state, visible: true };
            setMood(ctx, "happy", 2500);
        },
    });
}

export default makeExtension;
