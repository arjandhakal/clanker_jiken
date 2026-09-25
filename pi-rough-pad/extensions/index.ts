import { StringEnum } from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	getAgentDir,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { constants } from "node:fs";
import { appendFile, access, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { Type } from "typebox";

const execFileAsync = promisify(execFile);
const SESSION_ENTRY = "rough-pad-session-state";
const MAX_MODEL_CHARS = 60_000;
const MAX_NOTIFY_CHARS = 20_000;
const PAD_NAME_MAX = 80;

const PAD_ACTIONS = ["read", "append", "note", "write", "replace", "clear", "delete", "path", "list", "use"] as const;
type PadAction = (typeof PAD_ACTIONS)[number];

type RepoInfo = {
	key: string;
	path: string;
	name: string;
	branch?: string;
	dirName: string;
};

type LoadedPad = {
	name: string;
	contentHash: string;
	loadedAt: number;
};

type SessionPadState = {
	repoKey: string;
	selectedPad: string;
	loaded?: LoadedPad;
	updatedAt: number;
};

type PadTarget = {
	repo: RepoInfo;
	name: string;
	path: string;
};

type RoughPadDetails = {
	action: PadAction;
	repo: { name: string; path: string; branch?: string; key: string };
	name?: string;
	path?: string;
	selectedPad?: string;
	loadedPad?: string;
	loadedState?: "current" | "stale" | "missing";
	pads?: string[];
	changed?: boolean;
	deleted?: boolean;
	error?: string;
};

const RoughPadParams = Type.Object({
	action: StringEnum(PAD_ACTIONS),
	name: Type.Optional(Type.String({ description: "Optional pad name. Defaults to this Pi session's selected pad." })),
	text: Type.Optional(Type.String({ description: "Text for append, note, write, or replace." })),
	oldText: Type.Optional(Type.String({ description: "Exact text to replace when action is replace. Must occur exactly once." })),
});

function storageRoot() {
	return process.env.PI_ROUGH_PAD_DIR?.trim() || join(getAgentDir(), "rough-pad");
}

function padsRoot() {
	return join(storageRoot(), "pads");
}

function hash(text: string) {
	return createHash("sha256").update(text).digest("hex");
}

function slugify(input: string | undefined, fallback = "default") {
	const value = (input ?? "").trim();
	const slug = value
		.replace(/[/\\:*?"<>|\x00-\x1f]/g, "-")
		.replace(/\s+/g, "-")
		.replace(/\.+/g, ".")
		.replace(/^-+|-+$/g, "")
		.replace(/^\.+/, "")
		.slice(0, PAD_NAME_MAX)
		.trim();
	return slug || fallback;
}

function defaultPadName(repo: RepoInfo) {
	const branch = repo.branch && repo.branch !== "HEAD" ? slugify(repo.branch) : "";
	return branch && branch !== "main" && branch !== "master" ? branch : "default";
}

function truncate(text: string, maxChars = MAX_MODEL_CHARS) {
	return text.length <= maxChars ? text : `${text.slice(0, maxChars)}\n\n[truncated ${text.length - maxChars} chars]`;
}

function shellQuote(text: string) {
	return `'${text.replace(/'/g, `'\\''`)}'`;
}

async function pathExists(path: string) {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function gitOutput(cwd: string, args: string[]) {
	try {
		const result = await execFileAsync("git", args, { cwd, timeout: 2_500, maxBuffer: 1024 * 1024 });
		return String(result.stdout).trim() || undefined;
	} catch {
		return undefined;
	}
}

async function getRepoInfo(cwd: string): Promise<RepoInfo> {
	const gitRoot = await gitOutput(cwd, ["rev-parse", "--show-toplevel"]);
	const root = await realpath(gitRoot || cwd).catch(() => gitRoot || cwd);
	const branch = gitRoot ? await gitOutput(root, ["rev-parse", "--abbrev-ref", "HEAD"]) : undefined;
	const key = hash(root).slice(0, 16);
	const name = basename(root) || "repo";
	return {
		key,
		path: root,
		name,
		branch: branch && branch !== "HEAD" ? branch : undefined,
		dirName: `${slugify(name, "repo")}-${key}`,
	};
}

async function legacyDefault(repo: RepoInfo) {
	try {
		const raw = await readFile(join(storageRoot(), "index.json"), "utf8");
		const parsed = JSON.parse(raw) as { repos?: Record<string, { activePad?: unknown }> };
		const active = parsed.repos?.[repo.key]?.activePad;
		return typeof active === "string" && active.trim() ? slugify(active) : undefined;
	} catch {
		return undefined;
	}
}

function padDirectory(repo: RepoInfo) {
	return join(padsRoot(), repo.dirName);
}

function padFilePath(repo: RepoInfo, name: string) {
	return join(padDirectory(repo), `${slugify(name)}.md`);
}

function padTemplate(repo: RepoInfo, name: string) {
	const now = new Date().toISOString();
	return `# Rough Pad: ${name}\n\nRepo: \`${repo.path}\`\nBranch: \`${repo.branch ?? "unknown"}\`\nCreated: ${now}\nUpdated: ${now}\nStorage: managed by pi-rough-pad outside the repository\n\n## Current Plan\n\n\n## Decisions\n\n\n## Open Questions\n\n\n## Notes\n`;
}

async function ensurePadFile(target: PadTarget) {
	await mkdir(dirname(target.path), { recursive: true });
	if (await pathExists(target.path)) return;
	await withFileMutationQueue(target.path, async () => {
		if (!(await pathExists(target.path))) await writeFile(target.path, padTemplate(target.repo, target.name), "utf8");
	});
}

async function listPads(repo: RepoInfo) {
	try {
		const entries = await readdir(padDirectory(repo), { withFileTypes: true });
		return entries
			.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
			.map((entry) => entry.name.slice(0, -3))
			.sort((a, b) => a.localeCompare(b));
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw err;
	}
}

async function readPad(target: PadTarget) {
	await ensurePadFile(target);
	return readFile(target.path, "utf8");
}

async function appendToPad(target: PadTarget, text: string) {
	await ensurePadFile(target);
	await withFileMutationQueue(target.path, async () => {
		const current = await readFile(target.path, "utf8");
		const prefix = current.endsWith("\n") ? "" : "\n";
		await appendFile(target.path, `${prefix}\n${text.trimEnd()}\n`, "utf8");
	});
}

async function writePad(target: PadTarget, text: string) {
	await mkdir(dirname(target.path), { recursive: true });
	await withFileMutationQueue(target.path, async () => {
		await writeFile(target.path, text.endsWith("\n") ? text : `${text}\n`, "utf8");
	});
}

async function replaceInPad(target: PadTarget, oldText: string, newText: string) {
	await ensurePadFile(target);
	return withFileMutationQueue(target.path, async () => {
		const content = await readFile(target.path, "utf8");
		const first = content.indexOf(oldText);
		if (first === -1) return { changed: false, error: "oldText was not found" };
		if (content.indexOf(oldText, first + oldText.length) !== -1) {
			return { changed: false, error: "oldText occurs more than once; provide unique exact text" };
		}
		await writeFile(target.path, content.slice(0, first) + newText + content.slice(first + oldText.length), "utf8");
		return { changed: true };
	});
}

function timestampedNote(text: string) {
	return `### ${new Date().toLocaleString()}\n\n${text.trimEnd()}`;
}

function repoDetails(repo: RepoInfo) {
	return { name: repo.name, path: repo.path, branch: repo.branch, key: repo.key };
}

async function loadedState(state: SessionPadState | undefined, repo: RepoInfo): Promise<"current" | "stale" | "missing" | undefined> {
	if (!state?.loaded) return undefined;
	const path = padFilePath(repo, state.loaded.name);
	try {
		const content = await readFile(path, "utf8");
		return hash(content) === state.loaded.contentHash ? "current" : "stale";
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return "missing";
		throw err;
	}
}

function splitCommand(args: string) {
	const trimmed = args.trim();
	if (!trimmed) return { command: "status", rest: "" };
	const match = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/);
	return { command: (match?.[1] ?? "status").toLowerCase(), rest: match?.[2]?.trim() ?? "" };
}

function helpText() {
	return [
		"Rough pad commands (selection is per Pi session):",
		"/pad                     Show selected/loaded status",
		"/pad list                List pads with selected and loaded markers",
		"/pad new <name>          Create and select a pad",
		"/pad switch [name]       Select a pad (picker when name is omitted)",
		"/pad load [name]         Select and send a pad to the agent",
		"/pad open [name]         Open a pad in your terminal editor",
		"/pad read [name]         Display a pad to you (does not load it for the agent)",
		"/pad path [name]         Show a pad's file path",
		"/pad append <text>       Append to the selected pad",
		"/pad note <text>         Append a timestamped note",
		"/pad write <text>        Replace the selected pad",
		"/pad clear [name]        Reset a pad to the template",
		"/pad delete [name]       Delete a pad",
		"",
		"Markers: ▶ selected by this session, ● loaded and current, ! loaded but stale/missing.",
	].join("\n");
}

function editorCommand() {
	const explicit = process.env.PI_ROUGH_PAD_EDITOR || process.env.VISUAL || process.env.EDITOR;
	if (explicit?.trim()) return explicit.trim();
	for (const editor of ["nvim", "vim", "vi", "nano"]) {
		const found = spawnSync("sh", ["-lc", `command -v ${shellQuote(editor)}`], { encoding: "utf8" });
		if (found.status === 0) return editor;
	}
	return "vi";
}

async function openPadInEditor(ctx: ExtensionCommandContext, target: PadTarget) {
	await ensurePadFile(target);
	const editor = editorCommand();
	if (ctx.mode !== "tui") {
		ctx.ui.notify(`Open this file in your editor:\n${target.path}`, "info");
		return;
	}
	const exitCode = await ctx.ui.custom<number | null>((tui, _theme, _kb, done) => {
		tui.stop();
		process.stdout.write("\x1b[2J\x1b[H");
		const shell = process.env.SHELL || "/bin/sh";
		const result = spawnSync(shell, ["-lc", `exec ${editor} \"$1\"`, "pi-rough-pad-editor", target.path], {
			stdio: "inherit",
			env: process.env,
		});
		tui.start();
		tui.requestRender(true);
		done(result.status);
		return { render: () => [], invalidate: () => {} };
	});
	if (exitCode === 0) ctx.ui.notify(`Closed rough pad ${target.name}`, "info");
	else ctx.ui.notify(`Editor exited with code ${exitCode ?? 1}. Path: ${target.path}`, "warning");
}

export default function roughPadExtension(pi: ExtensionAPI) {
	let sessionState: SessionPadState | undefined;

	async function reconstructState(ctx: ExtensionContext) {
		const repo = await getRepoInfo(ctx.cwd);
		sessionState = undefined;
		const branch = ctx.sessionManager.getBranch();
		for (let i = branch.length - 1; i >= 0; i--) {
			const entry = branch[i];
			if (entry.type !== "custom" || entry.customType !== SESSION_ENTRY) continue;
			const data = entry.data as SessionPadState | undefined;
			if (data?.repoKey === repo.key && typeof data.selectedPad === "string") {
				sessionState = data;
				break;
			}
		}
		if (!sessionState) {
			sessionState = {
				repoKey: repo.key,
				selectedPad: (await legacyDefault(repo)) ?? defaultPadName(repo),
				updatedAt: Date.now(),
			};
		}
		await refreshStatus(ctx, repo);
	}

	async function ensureState(ctx: ExtensionContext | ExtensionCommandContext, repo?: RepoInfo) {
		const currentRepo = repo ?? (await getRepoInfo(ctx.cwd));
		if (!sessionState || sessionState.repoKey !== currentRepo.key) await reconstructState(ctx);
		return sessionState as SessionPadState;
	}

	function persistState(next: SessionPadState) {
		sessionState = next;
		pi.appendEntry<SessionPadState>(SESSION_ENTRY, next);
	}

	async function selectPad(ctx: ExtensionContext | ExtensionCommandContext, repo: RepoInfo, name: string, create = true) {
		const normalized = slugify(name);
		const current = await ensureState(ctx, repo);
		persistState({ ...current, repoKey: repo.key, selectedPad: normalized, updatedAt: Date.now() });
		const target = { repo, name: normalized, path: padFilePath(repo, normalized) };
		if (create) await ensurePadFile(target);
		await refreshStatus(ctx, repo);
		return target;
	}

	async function targetFor(ctx: ExtensionContext | ExtensionCommandContext, maybeName?: string, create = true) {
		const repo = await getRepoInfo(ctx.cwd);
		const state = await ensureState(ctx, repo);
		const name = slugify(maybeName || state.selectedPad || defaultPadName(repo));
		const target = { repo, name, path: padFilePath(repo, name) };
		if (create) await ensurePadFile(target);
		return target;
	}

	async function markLoaded(ctx: ExtensionContext | ExtensionCommandContext, target: PadTarget, content: string) {
		const current = await ensureState(ctx, target.repo);
		persistState({
			...current,
			repoKey: target.repo.key,
			selectedPad: target.name,
			loaded: { name: target.name, contentHash: hash(content), loadedAt: Date.now() },
			updatedAt: Date.now(),
		});
		await refreshStatus(ctx, target.repo);
	}

	async function refreshStatus(ctx: ExtensionContext | ExtensionCommandContext, repo?: RepoInfo) {
		const currentRepo = repo ?? (await getRepoInfo(ctx.cwd));
		const state = sessionState?.repoKey === currentRepo.key ? sessionState : undefined;
		if (!state) {
			ctx.ui.setStatus("rough-pad", undefined);
			return;
		}
		const loaded = await loadedState(state, currentRepo);
		let text = `pad:${state.selectedPad}`;
		if (state.loaded) {
			const suffix = loaded === "current" ? "✓" : "!";
			text += state.loaded.name === state.selectedPad ? ` ${suffix}` : ` · loaded:${state.loaded.name}${suffix}`;
		}
		ctx.ui.setStatus("rough-pad", ctx.ui.theme.fg(loaded === "stale" || loaded === "missing" ? "warning" : "dim", text));
	}

	async function choosePad(ctx: ExtensionCommandContext, repo: RepoInfo) {
		const pads = await listPads(repo);
		if (!pads.length) return undefined;
		if (!ctx.hasUI) return undefined;
		const state = await ensureState(ctx, repo);
		const labels = pads.map((name) => (name === state.selectedPad ? `${name}  [selected]` : name));
		const choice = await ctx.ui.select("Select rough pad for this Pi session", labels);
		return choice?.replace(/\s+\[selected\]$/, "");
	}

	async function statusText(ctx: ExtensionCommandContext) {
		const repo = await getRepoInfo(ctx.cwd);
		const state = await ensureState(ctx, repo);
		const loadState = await loadedState(state, repo);
		const selectedPath = padFilePath(repo, state.selectedPad);
		return [
			`Selected for this Pi session: ${state.selectedPad}`,
			`Selected path: ${selectedPath}`,
			state.loaded
				? `Last loaded for agent: ${state.loaded.name} (${loadState}; ${new Date(state.loaded.loadedAt).toLocaleString()})`
				: "Last loaded for agent: none",
			`Repo: ${repo.path}`,
			"",
			"Use /pad list to discover pads, /pad switch to select one, or /pad load to give one to the agent.",
		].join("\n");
	}

	async function listText(ctx: ExtensionContext | ExtensionCommandContext, repo: RepoInfo) {
		const state = await ensureState(ctx, repo);
		const loadState = await loadedState(state, repo);
		const pads = await listPads(repo);
		if (!pads.length) return "No rough pads yet. Create one with /pad new <name>.";
		const lines = await Promise.all(
			pads.map(async (name) => {
				const selected = name === state.selectedPad ? "▶" : " ";
				const loaded = name === state.loaded?.name ? (loadState === "current" ? "●" : "!") : " ";
				const info = await stat(padFilePath(repo, name)).catch(() => undefined);
				const meta = info ? `${info.size} B · ${info.mtime.toLocaleString()}` : "missing";
				return `${selected}${loaded} ${name}  (${meta})`;
			}),
		);
		return `${lines.join("\n")}\n\n▶ selected by this session · ● loaded/current · ! loaded/stale or missing`;
	}

	async function afterMutation(ctx: ExtensionContext | ExtensionCommandContext, repo: RepoInfo) {
		await refreshStatus(ctx, repo);
	}

	pi.on("session_start", async (_event, ctx) => reconstructState(ctx));
	pi.on("session_tree", async (_event, ctx) => reconstructState(ctx));
	pi.on("session_shutdown", async (_event, ctx) => ctx.ui.setStatus("rough-pad", undefined));

	pi.registerCommand("pad", {
		description: "Manage session-selected repo rough pads. Usage: /pad help",
		getArgumentCompletions: async (prefix) => {
			const first = prefix.trimStart();
			if (first.includes(" ")) return null;
			const commands = ["help", "status", "list", "new", "switch", "use", "active", "load", "open", "read", "show", "path", "append", "note", "write", "clear", "delete"];
			return commands.filter((cmd) => cmd.startsWith(first.toLowerCase())).map((cmd) => ({ value: cmd, label: cmd }));
		},
		handler: async (args, ctx) => {
			const { command, rest } = splitCommand(args);
			try {
				switch (command) {
					case "status":
					case "active":
						ctx.ui.notify(await statusText(ctx), "info");
						return;
					case "help":
						ctx.ui.notify(helpText(), "info");
						return;
					case "list": {
						const repo = await getRepoInfo(ctx.cwd);
						ctx.ui.notify(await listText(ctx, repo), "info");
						return;
					}
					case "new": {
						let name = rest;
						if (!name && ctx.hasUI) name = (await ctx.ui.input("New rough pad name", "feature-name"))?.trim() ?? "";
						if (!name) return ctx.ui.notify("Usage: /pad new <name>", "warning");
						const repo = await getRepoInfo(ctx.cwd);
						const target = await selectPad(ctx, repo, name);
						ctx.ui.notify(`Created and selected ${target.name} for this Pi session.\n${target.path}`, "info");
						return;
					}
					case "switch":
					case "use": {
						const repo = await getRepoInfo(ctx.cwd);
						const name = rest || (await choosePad(ctx, repo));
						if (!name) return ctx.ui.notify("No pad selected. Use /pad new <name> or /pad switch <name>.", "warning");
						const target = await selectPad(ctx, repo, name);
						ctx.ui.notify(`Selected ${target.name} for this Pi session.\n${target.path}`, "info");
						return;
					}
					case "path": {
						const target = await targetFor(ctx, rest || undefined, false);
						ctx.ui.notify(target.path, "info");
						return;
					}
					case "open":
					case "edit": {
						const target = await targetFor(ctx, rest || undefined);
						await openPadInEditor(ctx, target);
						await afterMutation(ctx, target.repo);
						return;
					}
					case "read":
					case "show": {
						const target = await targetFor(ctx, rest || undefined);
						ctx.ui.notify(truncate(await readPad(target), MAX_NOTIFY_CHARS), "info");
						return;
					}
					case "load": {
						const repo = await getRepoInfo(ctx.cwd);
						let name = rest;
						if (!name && ctx.hasUI) name = (await choosePad(ctx, repo)) ?? (await ensureState(ctx, repo)).selectedPad;
						const target = await selectPad(ctx, repo, name || (await ensureState(ctx, repo)).selectedPad);
						const content = await readPad(target);
						await markLoaded(ctx, target, content);
						const message = `Rough pad \"${target.name}\" for ${repo.name} (${repo.path}):\n\n${truncate(content)}\n\nUse this as working context. When asked to update the rough pad, update this selected pad.`;
						if (ctx.isIdle()) pi.sendUserMessage(message);
						else pi.sendUserMessage(message, { deliverAs: "followUp" });
						ctx.ui.notify(`Selected and loaded ${target.name} for the agent.`, "info");
						return;
					}
					case "append":
					case "note":
					case "write": {
						if (!rest) return ctx.ui.notify(`Usage: /pad ${command} <text>`, "warning");
						const target = await targetFor(ctx);
						if (command === "append") await appendToPad(target, rest);
						else if (command === "note") await appendToPad(target, timestampedNote(rest));
						else await writePad(target, rest);
						await afterMutation(ctx, target.repo);
						ctx.ui.notify(`${command === "write" ? "Rewrote" : "Updated"} ${target.name}.`, "info");
						return;
					}
					case "clear": {
						const target = await targetFor(ctx, rest || undefined);
						if (ctx.hasUI && !(await ctx.ui.confirm("Clear rough pad?", `Reset ${target.name} to the default template?`))) return;
						await writePad(target, padTemplate(target.repo, target.name));
						await afterMutation(ctx, target.repo);
						ctx.ui.notify(`Cleared ${target.name}.`, "info");
						return;
					}
					case "delete": {
						const target = await targetFor(ctx, rest || undefined, false);
						if (ctx.hasUI && !(await ctx.ui.confirm("Delete rough pad?", `Delete ${target.name}?\n${target.path}`))) return;
						const existed = await pathExists(target.path);
						await rm(target.path, { force: true });
						await afterMutation(ctx, target.repo);
						ctx.ui.notify(existed ? `Deleted ${target.name}.` : `${target.name} did not exist.`, "info");
						return;
					}
					default:
						ctx.ui.notify(`Unknown /pad command: ${command}\n\n${helpText()}`, "warning");
				}
			} catch (err) {
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
			}
		},
	});

	pi.registerTool({
		name: "rough_pad",
		label: "Rough Pad",
		description: "Discover, select, read, or edit repo-scoped rough Markdown pads. Pad selection is private to the current Pi session, so parallel agents can use different pads safely.",
		promptSnippet: "Discover, select, read, or edit this Pi session's repo-scoped rough Markdown pad.",
		promptGuidelines: [
			"When the user mentions a rough pad without naming one, use this Pi session's selected pad.",
			"Use action=list when the intended pad is unclear. Use action=use with a name to select a pad for this session.",
			"Use action=read before relying on a pad. Reading a named pad also selects it and marks it loaded/current for this session.",
			"Use append or note for incremental decisions. Use replace only with unique exact oldText; use write/clear only on explicit request.",
		],
		parameters: RoughPadParams,
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			const action = params.action as PadAction;
			const repo = await getRepoInfo(ctx.cwd);
			const state = await ensureState(ctx, repo);

			if (action === "list") {
				const pads = await listPads(repo);
				const loadState = await loadedState(state, repo);
				return {
					content: [{ type: "text", text: await listText(ctx, repo) }],
					details: { action, repo: repoDetails(repo), pads, selectedPad: state.selectedPad, loadedPad: state.loaded?.name, loadedState: loadState } satisfies RoughPadDetails,
				};
			}

			if (action === "use") {
				if (!params.name?.trim()) {
					return { content: [{ type: "text", text: "name is required for action=use" }], details: { action, repo: repoDetails(repo), error: "name required", selectedPad: state.selectedPad } satisfies RoughPadDetails };
				}
				const target = await selectPad(ctx, repo, params.name);
				return {
					content: [{ type: "text", text: `Selected rough pad ${target.name} for this Pi session. Path: ${target.path}` }],
					details: { action, repo: repoDetails(repo), name: target.name, path: target.path, selectedPad: target.name, loadedPad: sessionState?.loaded?.name, changed: true } satisfies RoughPadDetails,
				};
			}

			let target = await targetFor(ctx, params.name, action !== "delete");
			if (action === "read" && params.name) target = await selectPad(ctx, repo, params.name);
			onUpdate?.({ content: [{ type: "text", text: `rough_pad ${action} ${target.name}` }], details: { action, repo: repoDetails(repo), name: target.name, path: target.path, selectedPad: sessionState?.selectedPad } satisfies RoughPadDetails });

			const details = (extra: Partial<RoughPadDetails> = {}) => ({
				action,
				repo: repoDetails(repo),
				name: target.name,
				path: target.path,
				selectedPad: sessionState?.selectedPad,
				loadedPad: sessionState?.loaded?.name,
				...extra,
			}) satisfies RoughPadDetails;

			switch (action) {
				case "path":
					return { content: [{ type: "text", text: target.path }], details: details() };
				case "read": {
					const content = await readPad(target);
					await markLoaded(ctx, target, content);
					return { content: [{ type: "text", text: truncate(content) }], details: details({ selectedPad: target.name, loadedPad: target.name, loadedState: "current" }) };
				}
				case "append":
				case "note":
				case "write": {
					if (params.text === undefined || (action !== "write" && !params.text.trim())) {
						return { content: [{ type: "text", text: `text is required for action=${action}` }], details: details({ error: "text required" }) };
					}
					if (action === "append") await appendToPad(target, params.text);
					else if (action === "note") await appendToPad(target, timestampedNote(params.text));
					else await writePad(target, params.text);
					await afterMutation(ctx, repo);
					return { content: [{ type: "text", text: `[rough-pad:${target.name}] Updated.` }], details: details({ changed: true, loadedState: await loadedState(sessionState, repo) }) };
				}
				case "replace": {
					if (!params.oldText) return { content: [{ type: "text", text: "oldText is required for action=replace" }], details: details({ error: "oldText required" }) };
					if (params.text === undefined) return { content: [{ type: "text", text: "text is required for action=replace" }], details: details({ error: "text required" }) };
					const result = await replaceInPad(target, params.oldText, params.text);
					await afterMutation(ctx, repo);
					return {
						content: [{ type: "text", text: result.changed ? `[rough-pad:${target.name}] Replaced exact text.` : `No replacement made: ${result.error}` }],
						details: details({ changed: result.changed, error: result.error, loadedState: await loadedState(sessionState, repo) }),
					};
				}
				case "clear":
					await writePad(target, padTemplate(repo, target.name));
					await afterMutation(ctx, repo);
					return { content: [{ type: "text", text: `[rough-pad:${target.name}] Reset to template.` }], details: details({ changed: true, loadedState: await loadedState(sessionState, repo) }) };
				case "delete": {
					const existed = await pathExists(target.path);
					await rm(target.path, { force: true });
					await afterMutation(ctx, repo);
					return { content: [{ type: "text", text: existed ? `[rough-pad:${target.name}] Deleted.` : `[rough-pad:${target.name}] Did not exist.` }], details: details({ deleted: existed, loadedState: await loadedState(sessionState, repo) }) };
				}
				default:
					return { content: [{ type: "text", text: `Unknown action: ${action}` }], details: details({ error: `Unknown action: ${action}` }) };
			}
		},
	});
}
