import type { ExtensionAPI, ExtensionCommandContext, InputSource } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const STORE_VERSION = 1;
const MAX_PREVIEW_CHARS = 160;

type LastPrompt = {
	text: string;
	timestamp: number;
	source: InputSource;
	streamingBehavior?: "steer" | "followUp";
	imageCount?: number;
};

type SavedPrompt = LastPrompt & {
	name: string;
	createdAt: number;
	updatedAt: number;
};

type PromptStore = {
	version: typeof STORE_VERSION;
	prompts: Record<string, SavedPrompt>;
};

function storePath() {
	return process.env.PI_PROMPT_SAVER_FILE ?? join(homedir(), ".pi", "agent", "prompt-saver", "prompts.json");
}

function emptyStore(): PromptStore {
	return { version: STORE_VERSION, prompts: {} };
}

async function readStore(): Promise<PromptStore> {
	const path = storePath();
	try {
		const raw = await readFile(path, "utf8");
		const parsed = JSON.parse(raw) as Partial<PromptStore>;
		return {
			version: STORE_VERSION,
			prompts: typeof parsed.prompts === "object" && parsed.prompts ? (parsed.prompts as Record<string, SavedPrompt>) : {},
		};
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
		throw new Error(`Could not read saved prompts from ${path}: ${err instanceof Error ? err.message : String(err)}`);
	}
}

async function writeStore(store: PromptStore) {
	const path = storePath();
	await mkdir(dirname(path), { recursive: true });
	const sorted: PromptStore = {
		version: STORE_VERSION,
		prompts: Object.fromEntries(Object.entries(store.prompts).sort(([a], [b]) => a.localeCompare(b))),
	};
	const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(tmp, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
	await rename(tmp, path);
}

function normalizeName(args: string) {
	return args.trim().replace(/\s+/g, " ");
}

function isSlashCommand(text: string) {
	return text.trimStart().startsWith("/");
}

function preview(text: string, maxChars = MAX_PREVIEW_CHARS) {
	const oneLine = text.replace(/\s+/g, " ").trim();
	return oneLine.length <= maxChars ? oneLine : `${oneLine.slice(0, maxChars - 1)}…`;
}

function textFromUserMessage(message: unknown): string | undefined {
	const msg = message as { role?: unknown; content?: unknown } | undefined;
	if (!msg || msg.role !== "user") return undefined;

	if (typeof msg.content === "string") return msg.content;
	if (!Array.isArray(msg.content)) return undefined;

	const parts = msg.content
		.filter((part): part is { type: "text"; text: string } => {
			return Boolean(part) && typeof part === "object" && (part as { type?: unknown }).type === "text" && typeof (part as { text?: unknown }).text === "string";
		})
		.map((part) => part.text);

	return parts.length ? parts.join("\n") : undefined;
}

function lastUserPromptFromBranch(ctx: ExtensionCommandContext): LastPrompt | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type !== "message") continue;
		const text = textFromUserMessage(entry.message);
		if (text?.trim()) {
			return {
				text,
				timestamp: Date.now(),
				source: "interactive",
			};
		}
	}
	return undefined;
}

function formatPromptList(prompts: SavedPrompt[]) {
	return prompts
		.map((prompt) => {
			const updated = new Date(prompt.updatedAt).toLocaleString();
			const images = prompt.imageCount ? ` +${prompt.imageCount} image(s)` : "";
			return `- ${prompt.name} (${updated}${images})\n  ${preview(prompt.text)}`;
		})
		.join("\n");
}

async function getPromptNameCompletions(prefix: string) {
	const store = await readStore();
	const needle = prefix.trim().toLowerCase();
	return Object.keys(store.prompts)
		.filter((name) => !needle || name.toLowerCase().startsWith(needle))
		.sort((a, b) => a.localeCompare(b))
		.slice(0, 50)
		.map((name) => ({ value: name, label: name }));
}

export default function promptSaverExtension(pi: ExtensionAPI) {
	let lastPrompt: LastPrompt | undefined;

	pi.on("input", async (event) => {
		if (event.source === "extension") return { action: "continue" };
		if (!event.text.trim()) return { action: "continue" };
		if (isSlashCommand(event.text)) return { action: "continue" };

		lastPrompt = {
			text: event.text,
			timestamp: Date.now(),
			source: event.source,
			streamingBehavior: event.streamingBehavior,
			imageCount: event.images?.length,
		};

		return { action: "continue" };
	});

	pi.registerCommand("save-prompt", {
		description: "Save the last user prompt under a name. Usage: /save-prompt <name>",
		handler: async (args, ctx) => {
			const name = normalizeName(args);
			if (!name) {
				ctx.ui.notify("Usage: /save-prompt <name>", "warning");
				return;
			}

			const prompt = lastPrompt ?? lastUserPromptFromBranch(ctx);
			if (!prompt?.text.trim()) {
				ctx.ui.notify("No previous user prompt found to save.", "warning");
				return;
			}

			try {
				const store = await readStore();
				const existing = store.prompts[name];
				if (existing && ctx.hasUI) {
					const ok = await ctx.ui.confirm("Overwrite saved prompt?", `A prompt named “${name}” already exists. Overwrite it?`);
					if (!ok) {
						ctx.ui.notify("Save cancelled", "info");
						return;
					}
				}

				const now = Date.now();
				store.prompts[name] = {
					...prompt,
					name,
					createdAt: existing?.createdAt ?? now,
					updatedAt: now,
				};
				await writeStore(store);

				const images = prompt.imageCount ? ` Note: ${prompt.imageCount} attached image(s) were not persisted, only the text was saved.` : "";
				ctx.ui.notify(`Saved prompt “${name}”.${images}\n${preview(prompt.text)}`, "info");
			} catch (err) {
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
			}
		},
	});

	pi.registerCommand("saved-prompts", {
		description: "List saved prompts. Usage: /saved-prompts [filter]",
		handler: async (args, ctx) => {
			try {
				const filter = args.trim().toLowerCase();
				const store = await readStore();
				const prompts = Object.values(store.prompts)
					.filter((prompt) => !filter || prompt.name.toLowerCase().includes(filter))
					.sort((a, b) => b.updatedAt - a.updatedAt);

				if (!prompts.length) {
					ctx.ui.notify(filter ? `No saved prompts matching “${args.trim()}”.` : "No saved prompts yet.", "info");
					return;
				}

				ctx.ui.notify(formatPromptList(prompts), "info");
			} catch (err) {
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
			}
		},
	});

	pi.registerCommand("load-prompt", {
		description: "Load a saved prompt into the editor. Usage: /load-prompt <name>",
		getArgumentCompletions: getPromptNameCompletions,
		handler: async (args, ctx) => {
			const name = normalizeName(args);
			if (!name) {
				ctx.ui.notify("Usage: /load-prompt <name>", "warning");
				return;
			}

			try {
				const store = await readStore();
				const prompt = store.prompts[name];
				if (!prompt) {
					ctx.ui.notify(`No saved prompt named “${name}”.`, "warning");
					return;
				}

				ctx.ui.setEditorText(prompt.text);
				ctx.ui.notify(`Loaded prompt “${name}” into the editor.`, "info");
			} catch (err) {
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
			}
		},
	});

	pi.registerCommand("delete-prompt", {
		description: "Delete a saved prompt. Usage: /delete-prompt <name>",
		getArgumentCompletions: getPromptNameCompletions,
		handler: async (args, ctx) => {
			const name = normalizeName(args);
			if (!name) {
				ctx.ui.notify("Usage: /delete-prompt <name>", "warning");
				return;
			}

			try {
				const store = await readStore();
				if (!store.prompts[name]) {
					ctx.ui.notify(`No saved prompt named “${name}”.`, "warning");
					return;
				}

				if (ctx.hasUI) {
					const ok = await ctx.ui.confirm("Delete saved prompt?", `Delete “${name}”?`);
					if (!ok) {
						ctx.ui.notify("Delete cancelled", "info");
						return;
					}
				}

				delete store.prompts[name];
				await writeStore(store);
				ctx.ui.notify(`Deleted saved prompt “${name}”.`, "info");
			} catch (err) {
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
			}
		},
	});
}
