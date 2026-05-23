import type { ExtensionAPI, ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";

import { PET_IDS, PET_PALETTE, PET_SPRITES, type PetId, type SpriteAction } from "./petSpriteData";

type Placement = "aboveEditor" | "belowEditor";
declare const process: { env: Record<string, string | undefined> } | undefined;

type TeleportSpot = {
	indent: number;
	placement: Placement;
};

const MOOD_ACTIONS = {
	idle: "Idle",
	thinking: "Walk",
	curious: "Walk",
	tool: "Attack_1",
	casting: "Attack_2",
	magic: "Attack_3",
	happy: "Jump",
	sad: "Idle",
	excited: "Run",
	error: "Hurt",
	angry: "Attack_4",
	sleepy: "Dead",
	dozing: "Dead",
	reading: "Idle",
	confused: "Hurt",
	content: "Idle",
} as const satisfies Record<string, SpriteAction>;

type Mood = keyof typeof MOOD_ACTIONS;

type PetState = {
    pet: PetId;
    visible: boolean;
    placement: Placement;
    mood: Mood;
};

const WIDGET_ID = "pi-pet";
const STATUS_ID = "pi-pet";
const STATE_ENTRY = "pi-pet-state";
const IMAGE_WIDTH_CELLS = 8;
const FALLBACK_CELL_WIDTH_PX = 9;
const FALLBACK_CELL_HEIGHT_PX = 18;
const KITTY_IMAGE_ID = Math.floor(Math.random() * 0xfffffffe) + 1;

const MOODS = Object.keys(MOOD_ACTIONS) as Mood[];
const MOOD_HELP = "idle, happy, excited, angry, curious, dozing, reading, casting, confused, content";
const AMBIENT_ANIMATION_MS = 10000;
const AMBIENT_MOODS: Mood[] = ["idle", "curious", "reading", "content", "happy", "excited", "confused", "dozing"];
const TELEPORT_SPOTS: TeleportSpot[] = [
    { indent: 0, placement: "belowEditor" },
    { indent: 5, placement: "belowEditor" },
    { indent: 10, placement: "belowEditor" },
    { indent: 4, placement: "aboveEditor" },
    { indent: 9, placement: "aboveEditor" },
];

const defaultState: PetState = {
	pet: "enchantress",
	visible: true,
	placement: "belowEditor",
	mood: "idle",
};

const moodText: Partial<Record<Mood, string>> = {
	idle: "Your pet is keeping watch.",
	thinking: "Your pet is pacing through the problem.",
	curious: "Your pet is curious about this one.",
	tool: "Your pet is helping with tools.",
	casting: "Your pet is making a decisive move.",
	magic: "Your pet is making a decisive move.",
	happy: "Your pet is celebrating a little win.",
	sad: "Your pet is having a quiet moment.",
	excited: "Your pet spotted something interesting.",
	error: "Your pet took a hit from that error.",
	angry: "Your pet is not amused.",
	sleepy: "Your pet is taking a tiny nap.",
	dozing: "Your pet is taking a tiny nap.",
	reading: "Your pet is studying quietly.",
	confused: "Your pet is puzzled.",
	content: "Your pet is content.",
};

const moodBubble: Partial<Record<Mood, string>> = {
    idle: "ꕤ ready",
	thinking: "✦ hmm...",
	curious: "? curious",
	tool: "⌘ working",
	casting: "✦ cast",
	magic: "✦ magic",
	happy: "♪ nice!",
	sad: "… sad",
	excited: "! wow",
	error: "! uh-oh",
	angry: "! hmph",
	sleepy: "zZ nap",
	dozing: "zZ nap",
	reading: "book",
	confused: "? hmm",
	content: "ꕤ ok",
};

function u32(value: number): Uint8Array {
	return new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
}

function crc32(data: Uint8Array): number {
	let crc = 0xffffffff;
	for (const byte of data) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit++) {
			crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function ascii(text: string): Uint8Array {
	const bytes = new Uint8Array(text.length);
	for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 255;
	return bytes;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
	const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const output = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.length;
	}
	return output;
}

function adler32(data: Uint8Array): number {
	let a = 1;
	let b = 0;
	for (const byte of data) {
		a = (a + byte) % 65521;
		b = (b + a) % 65521;
	}
	return ((b << 16) | a) >>> 0;
}

function zlibStore(data: Uint8Array): Uint8Array {
	const chunks: Uint8Array[] = [new Uint8Array([0x78, 0x01])];
	for (let offset = 0; offset < data.length; offset += 65535) {
		const length = Math.min(65535, data.length - offset);
		const final = offset + length >= data.length ? 1 : 0;
		const header = new Uint8Array([final, length & 255, (length >>> 8) & 255, (~length) & 255, ((~length) >>> 8) & 255]);
		chunks.push(header, data.slice(offset, offset + length));
	}
	chunks.push(u32(adler32(data)));
	return concatBytes(chunks);
}

function base64Encode(data: Uint8Array): string {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	let output = "";
	for (let i = 0; i < data.length; i += 3) {
		const a = data[i];
		const b = data[i + 1] ?? 0;
		const c = data[i + 2] ?? 0;
		const triple = (a << 16) | (b << 8) | c;
		output += alphabet[(triple >>> 18) & 63];
		output += alphabet[(triple >>> 12) & 63];
		output += i + 1 < data.length ? alphabet[(triple >>> 6) & 63] : "=";
		output += i + 2 < data.length ? alphabet[triple & 63] : "=";
	}
	return output;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
	const typeBuffer = ascii(type);
	const body = concatBytes([typeBuffer, data]);
	return concatBytes([u32(data.length), body, u32(crc32(body))]);
}

const spritePngCache = new WeakMap<string[], string>();

function spriteToPngBase64(sprite: string[]): string {
	const cached = spritePngCache.get(sprite);
	if (cached) return cached;

	const width = sprite.reduce((max, row) => Math.max(max, row.length), 0);
	const height = sprite.length;
	const raw = new Uint8Array((width * 4 + 1) * height);
	let offset = 0;

	for (let y = 0; y < height; y++) {
		raw[offset++] = 0;
		for (let x = 0; x < width; x++) {
			const rgb = PET_PALETTE[sprite[y]?.[x] ?? "."];
			raw[offset++] = rgb?.[0] ?? 0;
			raw[offset++] = rgb?.[1] ?? 0;
			raw[offset++] = rgb?.[2] ?? 0;
			raw[offset++] = rgb ? 255 : 0;
		}
	}

	const ihdr = new Uint8Array(13);
	ihdr.set(u32(width), 0);
	ihdr.set(u32(height), 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	ihdr[10] = 0;
	ihdr[11] = 0;
	ihdr[12] = 0;

	const png = concatBytes([
		new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", zlibStore(raw)),
		pngChunk("IEND", new Uint8Array(0)),
	]);
	const base64 = base64Encode(png);
	spritePngCache.set(sprite, base64);
	return base64;
}

type ImageProtocol = "kitty" | "iterm2";

function getImageProtocol(): ImageProtocol | undefined {
	const env = typeof process === "undefined" ? {} : process.env;
	const termProgram = env.TERM_PROGRAM?.toLowerCase() || "";
	const term = env.TERM?.toLowerCase() || "";
	if (env.TMUX || term.startsWith("tmux") || term.startsWith("screen")) return undefined;
	if (env.KITTY_WINDOW_ID || termProgram === "kitty") return "kitty";
	if (termProgram === "ghostty" || term.includes("ghostty") || env.GHOSTTY_RESOURCES_DIR) return "kitty";
	if (env.WEZTERM_PANE || termProgram === "wezterm") return "kitty";
	if (env.ITERM_SESSION_ID || termProgram === "iterm.app") return "iterm2";
	return undefined;
}

function encodeKitty(base64: string, columns: number, rows: number): string {
	const chunkSize = 4096;
	const params = `a=T,f=100,q=2,C=1,i=${KITTY_IMAGE_ID},c=${columns},r=${rows}`;
	if (base64.length <= chunkSize) return `\x1b_G${params};${base64}\x1b\\`;

	const chunks: string[] = [];
	for (let offset = 0; offset < base64.length; offset += chunkSize) {
		const chunk = base64.slice(offset, offset + chunkSize);
		const first = offset === 0;
		const last = offset + chunkSize >= base64.length;
		if (first) chunks.push(`\x1b_G${params},m=1;${chunk}\x1b\\`);
		else chunks.push(`\x1b_Gm=${last ? 0 : 1};${chunk}\x1b\\`);
	}
	return chunks.join("");
}

function encodeITerm2(base64: string, columns: number): string {
	return `\x1b]1337;File=inline=1;width=${columns};height=auto;preserveAspectRatio=1:${base64}\x07`;
}

function imageRowsForSprite(sprite: string[], columns: number): number {
	const width = sprite.reduce((max, row) => Math.max(max, row.length), 1);
	const height = Math.max(1, sprite.length);
	const scaledHeightPx = (columns * FALLBACK_CELL_WIDTH_PX * height) / width;
	return Math.max(1, Math.ceil(scaledHeightPx / FALLBACK_CELL_HEIGHT_PX));
}

function textForMood(mood: Mood): string {
    return moodText[mood] ?? `Your pet is feeling ${mood.replace(/-/g, " ")}.`;
}

function bubbleForMood(mood: Mood): string {
    return moodBubble[mood] ?? mood.replace(/-/g, " ");
}

function getFrame(state: PetState, frame: number): string[] {
	const pet = PET_SPRITES[state.pet];
	const action = MOOD_ACTIONS[state.mood];
	const frames = pet.frames[action] ?? pet.frames.Idle;
	return frames[frame % frames.length] ?? frames[0];
}

function renderPetImage(theme: Theme, state: PetState, spot: TeleportSpot, frame: number, width: number): string[] {
	const protocol = getImageProtocol();
	if (!protocol) return [];

	const sprite = getFrame(state, frame);
	const prefix = " ".repeat(spot.indent);
	const availableWidth = Math.max(1, width - spot.indent - 2);
	const columns = Math.max(1, Math.min(IMAGE_WIDTH_CELLS, availableWidth));
	const rows = imageRowsForSprite(sprite, columns);
	const base64 = spriteToPngBase64(sprite);
	const sequence = protocol === "kitty" ? encodeKitty(base64, columns, rows) : encodeITerm2(base64, columns);
	return [`${prefix}${sequence}`, ...Array.from({ length: rows - 1 }, () => prefix)];
}

function createPetWidget(theme: Theme, state: PetState, spot: TeleportSpot, frame: number) {
	const snapshot = { ...state };
	return {
		render(width: number): string[] {
			return renderPetImage(theme, snapshot, spot, frame, width);
		},
		invalidate(): void {},
		dispose(): void {},
	};
}

function restoreState(ctx: ExtensionContext): PetState {
    let state = { ...defaultState };
    for (const entry of ctx.sessionManager.getEntries()) {
        if (entry.type !== "custom" || entry.customType !== STATE_ENTRY) continue;
        const data = entry.data as Partial<PetState> | undefined;
        if (!data) continue;
		state = {
			pet: data.pet && PET_IDS.includes(data.pet as PetId) ? (data.pet as PetId) : state.pet,
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
        (ctx.ui.setWidget as any)(WIDGET_ID, (_tui: unknown, theme: Theme) => createPetWidget(theme, state, spot, ambientFrame), { placement: spot.placement });
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
        description: "Control your pi pet: show, hide, mood <name>, place above|below, choose <pet>, pat.",
        handler: async (args, ctx) => {
            const [cmdRaw, valueRaw] = args.trim().split(/\s+/, 2);
            const cmd = (cmdRaw || "status").toLowerCase();
            const value = (valueRaw || "").toLowerCase();

            if (cmd === "status" || cmd === "help") {
                ctx.ui.notify(
                    `pi-pet: ${state.visible ? "shown" : "hidden"}, pet=${state.pet}, mood=${state.mood}, placement=${state.placement}. Commands: /pet show|hide|pat|mood <name>|place above|below|choose ${PET_IDS.join("|")}. Common moods: ${MOOD_HELP}.`,
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
                if (!PET_IDS.includes(value as PetId)) {
                    ctx.ui.notify(`Unknown pet. Available pets: ${PET_IDS.join(", ")}`, "error");
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
