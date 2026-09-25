import { StringEnum } from "@earendil-works/pi-ai";
import { type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext, getAgentDir, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { access, appendFile, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { Type } from "typebox";

const execFileAsync = promisify(execFile);

const STORE_VERSION = 1;
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

type RepoState = {
	repoKey: string;
	repoPath: string;
	repoName: string;
	activePad: string;
	createdAt: number;
	updatedAt: number;
};

type PadIndex = {
	version: typeof STORE_VERSION;
	repos: Record<string, RepoState>;
};

type RoughPadDetails = {
	action: PadAction;
	repo: { name: string; path: string; branch?: string; key: string };
	name?: string;
	path?: string;
	activePad?: string;
	pads?: string[];
	changed?: boolean;
	deleted?: boolean;
	error?: string;
};

type PadTarget = {
	repo: RepoInfo;
	name: string;
	path: string;
};

const RoughPadParams = Type.Object({
	action: StringEnum(PAD_ACTIONS),
	name: Type.Optional(Type.String({ description: "Optional pad name. Defaults to the active pad for the current repo." })),
	text: Type.Optional(Type.String({ description: "Text for append, note, write, or replace." })),
	oldText: Type.Optional(Type.String({ description: "Exact text to replace when action is replace. Must occur exactly once." })),
});

function storageRoot() {
	return process.env.PI_ROUGH_PAD_DIR?.trim() || join(getAgentDir(), "rough-pad");
}

function indexPath() {
	return join(storageRoot(), "index.json");
}

function padsRoot() {
	return join(storageRoot(), "pads");
}

function emptyIndex(): PadIndex {
	return { version: STORE_VERSION, repos: {} };
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

async function readIndex(): Promise<PadIndex> {
	try {
		const raw = await readFile(indexPath(), "utf8");
		const parsed = JSON.parse(raw) as Partial<PadIndex>;
		return {
			version: STORE_VERSION,
			repos: parsed.repos && typeof parsed.repos === "object" ? (parsed.repos as Record<string, RepoState>) : {},
		};
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyIndex();
		throw new Error(`Could not read rough-pad index at ${indexPath()}: ${err instanceof Error ? err.message : String(err)}`);
	}
}

async function writeIndex(index: PadIndex) {
	const path = indexPath();
	await mkdir(dirname(path), { recursive: true });
	await withFileMutationQueue(path, async () => {
		const sorted: PadIndex = {
			version: STORE_VERSION,
			repos: Object.fromEntries(Object.entries(index.repos).sort(([a], [b]) => a.localeCompare(b))),
		};
		const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
		await writeFile(tmp, `${JSON.stringify(sorted, null, 2)}\n`, "utf8");
		await rename(tmp, path);
	});
}

async function ensureRepoState(repo: RepoInfo) {
	const index = await readIndex();
	const existing = index.repos[repo.key];
	const now = Date.now();
	const state: RepoState = existing
		? {
				...existing,
				repoPath: repo.path,
				repoName: repo.name,
				updatedAt: now,
			}
		: {
				repoKey: repo.key,
				repoPath: repo.path,
				repoName: repo.name,
				activePad: defaultPadName(repo),
				createdAt: now,
				updatedAt: now,
			};
	index.repos[repo.key] = state;
	await writeIndex(index);
	return state;
}

async function setActivePad(repo: RepoInfo, name: string) {
	const normalized = slugify(name);
	const index = await readIndex();
	const existing = index.repos[repo.key];
	const now = Date.now();
	index.repos[repo.key] = {
		repoKey: repo.key,
		repoPath: repo.path,
		repoName: repo.name,
		activePad: normalized,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
	};
	await writeIndex(index);
	return normalized;
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

async function resolveTarget(ctx: ExtensionContext | ExtensionCommandContext, maybeName?: string, create = true): Promise<PadTarget> {
	const repo = await getRepoInfo(ctx.cwd);
	const state = await ensureRepoState(repo);
	const name = slugify(maybeName || state.activePad || defaultPadName(repo));
	const path = padFilePath(repo, name);
	if (create) await ensurePadFile({ repo, name, path });
	return { repo, name, path };
}

async function ensurePadFile(target: PadTarget) {
	await mkdir(dirname(target.path), { recursive: true });
	if (!(await pathExists(target.path))) {
		await withFileMutationQueue(target.path, async () => {
			if (!(await pathExists(target.path))) {
				await writeFile(target.path, padTemplate(target.repo, target.name), "utf8");
			}
		});
	}
}

async function listPads(repo: RepoInfo) {
	const dir = padDirectory(repo);
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		return entries
			.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
			.map((entry) => entry.name.slice(0, -3))
			.sort((a, b) => a.localeCompare(b));
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw err;
	}
}

async function padStats(path: string) {
	try {
		return await stat(path);
	} catch {
		return undefined;
	}
}

function repoDetails(repo: RepoInfo) {
	return { name: repo.name, path: repo.path, branch: repo.branch, key: repo.key };
}

function toolTextFor(action: PadAction, target: PadTarget | undefined, message: string) {
	const prefix = target ? `[rough-pad:${target.name}] ` : "[rough-pad] ";
	return `${prefix}${message}`;
}

async function readPad(target: PadTarget) {
	await ensurePadFile(target);
	return readFile(target.path, "utf8");
}

async function appendToPad(target: PadTarget, text: string) {
	await ensurePadFile(target);
	await withFileMutationQueue(target.path, async () => {
		const prefix = (await readFile(target.path, "utf8")).endsWith("\n") ? "" : "\n";
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
		const second = content.indexOf(oldText, first + oldText.length);
		if (second !== -1) return { changed: false, error: "oldText occurs more than once; provide a unique exact oldText" };
		await writeFile(target.path, content.slice(0, first) + newText + content.slice(first + oldText.length), "utf8");
		return { changed: true };
	});
}

async function clearPad(target: PadTarget) {
	await writePad(target, padTemplate(target.repo, target.name));
}

async function deletePad(target: PadTarget) {
	try {
		await rm(target.path, { force: true });
		return true;
	} catch {
		return false;
	}
}

function timestampedNote(text: string) {
	const stamp = new Date().toLocaleString();
	return `### ${stamp}\n\n${text.trimEnd()}`;
}

function helpText() {
	return [
		"Rough pad commands:",
		"/pad path [name]       Show pad path",
		"/pad open [name]       Open in PI_ROUGH_PAD_EDITOR, VISUAL, EDITOR, nvim, vi, or nano",
		"/pad read [name]       Display pad contents",
		"/pad load [name]       Send pad contents to the agent as context",
		"/pad use <name>        Switch active pad for this repo",
		"/pad active            Show active pad",
		"/pad list              List repo pads",
		"/pad append <text>     Append text to active pad",
		"/pad note <text>       Append timestamped note to active pad",
		"/pad write <text>      Replace active pad content",
		"/pad clear [name]      Reset pad template",
		"/pad delete [name]     Delete pad file",
	].join("\n");
}

function splitCommand(args: string) {
	const trimmed = args.trim();
	if (!trimmed) return { command: "status", rest: "" };
	const match = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/);
	return { command: (match?.[1] ?? "status").toLowerCase(), rest: match?.[2]?.trim() ?? "" };
}

async function showStatus(ctx: ExtensionCommandContext) {
	const target = await resolveTarget(ctx);
	const stats = await padStats(target.path);
	ctx.ui.notify(
		[
			`Active rough pad: ${target.name}`,
			`Path: ${target.path}`,
			`Repo: ${target.repo.path}`,
			stats ? `Size: ${stats.size} bytes` : "Size: not created yet",
			"",
			"Use /pad help for commands. Ask the agent to read or update the rough pad when useful.",
		].join("\n"),
		"info",
	);
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

async function getPadNameCompletions(prefix: string, ctx?: ExtensionCommandContext) {
	if (!ctx) return null;
	const repo = await getRepoInfo(ctx.cwd);
	const pads = await listPads(repo);
	const needle = prefix.trim().toLowerCase();
	return pads.filter((name) => !needle || name.toLowerCase().startsWith(needle)).slice(0, 50).map((name) => ({ value: name, label: name }));
}

export default function roughPadExtension(pi: ExtensionAPI) {
	pi.registerCommand("pad", {
		description: "Manage repo-scoped rough Markdown pads. Usage: /pad help",
		getArgumentCompletions: async (prefix) => {
			const first = prefix.trimStart();
			if (!first.includes(" ")) {
				const commands = ["help", "path", "open", "read", "show", "load", "use", "active", "list", "append", "note", "write", "clear", "delete"];
				return commands.filter((cmd) => cmd.startsWith(first.toLowerCase())).map((cmd) => ({ value: cmd, label: cmd }));
			}
			return null;
		},
		handler: async (args, ctx) => {
			const { command, rest } = splitCommand(args);

			try {
				switch (command) {
					case "status":
						await showStatus(ctx);
						return;
					case "help":
						ctx.ui.notify(helpText(), "info");
						return;
					case "path": {
						const target = await resolveTarget(ctx, rest || undefined);
						ctx.ui.notify(target.path, "info");
						return;
					}
					case "open":
					case "edit": {
						const target = await resolveTarget(ctx, rest || undefined);
						await openPadInEditor(ctx, target);
						return;
					}
					case "read":
					case "show": {
						const target = await resolveTarget(ctx, rest || undefined);
						ctx.ui.notify(truncate(await readPad(target), MAX_NOTIFY_CHARS), "info");
						return;
					}
					case "load": {
						const target = await resolveTarget(ctx, rest || undefined);
						const content = await readPad(target);
						const message = `Rough pad \"${target.name}\" for repo ${target.repo.name} (${target.repo.path}):\n\n${truncate(content)}\n\nPlease use this rough pad as working context for this session.`;
						if (ctx.isIdle()) pi.sendUserMessage(message);
						else pi.sendUserMessage(message, { deliverAs: "followUp" });
						ctx.ui.notify(`Loaded rough pad ${target.name} into the conversation.`, "info");
						return;
					}
					case "use": {
						if (!rest) {
							ctx.ui.notify("Usage: /pad use <name>", "warning");
							return;
						}
						const repo = await getRepoInfo(ctx.cwd);
						const name = await setActivePad(repo, rest);
						const target = await resolveTarget(ctx, name);
						ctx.ui.notify(`Active rough pad is now ${target.name}\n${target.path}`, "info");
						return;
					}
					case "active": {
						const target = await resolveTarget(ctx);
						ctx.ui.notify(target.name, "info");
						return;
					}
					case "list": {
						const repo = await getRepoInfo(ctx.cwd);
						await ensureRepoState(repo);
						const pads = await listPads(repo);
						ctx.ui.notify(pads.length ? pads.map((name) => `- ${name}`).join("\n") : "No rough pads yet for this repo.", "info");
						return;
					}
					case "append": {
						if (!rest) {
							ctx.ui.notify("Usage: /pad append <text>", "warning");
							return;
						}
						const target = await resolveTarget(ctx);
						await appendToPad(target, rest);
						ctx.ui.notify(`Appended to rough pad ${target.name}.`, "info");
						return;
					}
					case "note": {
						if (!rest) {
							ctx.ui.notify("Usage: /pad note <text>", "warning");
							return;
						}
						const target = await resolveTarget(ctx);
						await appendToPad(target, timestampedNote(rest));
						ctx.ui.notify(`Added note to rough pad ${target.name}.`, "info");
						return;
					}
					case "write": {
						if (!rest) {
							ctx.ui.notify("Usage: /pad write <text>", "warning");
							return;
						}
						const target = await resolveTarget(ctx);
						await writePad(target, rest);
						ctx.ui.notify(`Rewrote rough pad ${target.name}.`, "info");
						return;
					}
					case "clear": {
						const target = await resolveTarget(ctx, rest || undefined);
						if (ctx.hasUI && !(await ctx.ui.confirm("Clear rough pad?", `Reset ${target.name} to the default template?`))) {
							ctx.ui.notify("Clear cancelled", "info");
							return;
						}
						await clearPad(target);
						ctx.ui.notify(`Cleared rough pad ${target.name}.`, "info");
						return;
					}
					case "delete": {
						const target = await resolveTarget(ctx, rest || undefined, false);
						if (ctx.hasUI && !(await ctx.ui.confirm("Delete rough pad?", `Delete ${target.name}?\n${target.path}`))) {
							ctx.ui.notify("Delete cancelled", "info");
							return;
						}
						await deletePad(target);
						ctx.ui.notify(`Deleted rough pad ${target.name}.`, "info");
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
		description: "Read or edit the user's repo-scoped rough Markdown pad. Use this when the user mentions their rough pad, scratchpad, feature notes, or asks you to remember/update working notes outside git.",
		promptSnippet: "Read or edit the user's repo-scoped rough Markdown pad for working notes that should not be committed.",
		promptGuidelines: [
			"When the user asks to use, read, save, remember, or update the rough pad/scratchpad/feature notes, use rough_pad instead of creating repo files.",
			"Use rough_pad action=read before relying on the rough pad, and action=append or note for incremental decisions, plans, and open questions.",
			"Use action=replace only with exact oldText that occurs once. Use action=write or clear only when the user clearly wants to replace/reset the pad.",
		],
		parameters: RoughPadParams,
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			const action = params.action as PadAction;
			const repo = await getRepoInfo(ctx.cwd);
			await ensureRepoState(repo);

			if (action === "list") {
				const pads = await listPads(repo);
				return {
					content: [{ type: "text", text: pads.length ? pads.map((name) => `- ${name}`).join("\n") : "No rough pads yet for this repo." }],
					details: { action, repo: repoDetails(repo), pads } satisfies RoughPadDetails,
				};
			}

			if (action === "use") {
				if (!params.name?.trim()) {
					return { content: [{ type: "text", text: "name is required for action=use" }], details: { action, repo: repoDetails(repo), error: "name required" } satisfies RoughPadDetails };
				}
				const name = await setActivePad(repo, params.name);
				const target = await resolveTarget(ctx, name);
				return {
					content: [{ type: "text", text: toolTextFor(action, target, `Active pad is now ${name}. Path: ${target.path}`) }],
					details: { action, repo: repoDetails(repo), name, path: target.path, activePad: name, changed: true } satisfies RoughPadDetails,
				};
			}

			const target = await resolveTarget(ctx, params.name, action !== "delete");
			onUpdate?.({ content: [{ type: "text", text: `rough_pad ${action} ${target.name}` }], details: { action, repo: repoDetails(repo), name: target.name, path: target.path } satisfies RoughPadDetails });

			switch (action) {
				case "path":
					return {
						content: [{ type: "text", text: target.path }],
						details: { action, repo: repoDetails(repo), name: target.name, path: target.path } satisfies RoughPadDetails,
					};
				case "read": {
					const content = await readPad(target);
					return {
						content: [{ type: "text", text: truncate(content) }],
						details: { action, repo: repoDetails(repo), name: target.name, path: target.path } satisfies RoughPadDetails,
					};
				}
				case "append": {
					if (!params.text?.trim()) return { content: [{ type: "text", text: "text is required for action=append" }], details: { action, repo: repoDetails(repo), name: target.name, path: target.path, error: "text required" } satisfies RoughPadDetails };
					await appendToPad(target, params.text);
					return { content: [{ type: "text", text: toolTextFor(action, target, "Appended text.") }], details: { action, repo: repoDetails(repo), name: target.name, path: target.path, changed: true } satisfies RoughPadDetails };
				}
				case "note": {
					if (!params.text?.trim()) return { content: [{ type: "text", text: "text is required for action=note" }], details: { action, repo: repoDetails(repo), name: target.name, path: target.path, error: "text required" } satisfies RoughPadDetails };
					await appendToPad(target, timestampedNote(params.text));
					return { content: [{ type: "text", text: toolTextFor(action, target, "Added timestamped note.") }], details: { action, repo: repoDetails(repo), name: target.name, path: target.path, changed: true } satisfies RoughPadDetails };
				}
				case "write": {
					if (params.text === undefined) return { content: [{ type: "text", text: "text is required for action=write" }], details: { action, repo: repoDetails(repo), name: target.name, path: target.path, error: "text required" } satisfies RoughPadDetails };
					await writePad(target, params.text);
					return { content: [{ type: "text", text: toolTextFor(action, target, "Rewrote pad.") }], details: { action, repo: repoDetails(repo), name: target.name, path: target.path, changed: true } satisfies RoughPadDetails };
				}
				case "replace": {
					if (!params.oldText) return { content: [{ type: "text", text: "oldText is required for action=replace" }], details: { action, repo: repoDetails(repo), name: target.name, path: target.path, error: "oldText required" } satisfies RoughPadDetails };
					if (params.text === undefined) return { content: [{ type: "text", text: "text is required for action=replace" }], details: { action, repo: repoDetails(repo), name: target.name, path: target.path, error: "text required" } satisfies RoughPadDetails };
					const result = await replaceInPad(target, params.oldText, params.text);
					return {
						content: [{ type: "text", text: result.changed ? toolTextFor(action, target, "Replaced exact text.") : toolTextFor(action, target, `No replacement made: ${result.error}`) }],
						details: { action, repo: repoDetails(repo), name: target.name, path: target.path, changed: result.changed, error: result.error } satisfies RoughPadDetails,
					};
				}
				case "clear":
					await clearPad(target);
					return { content: [{ type: "text", text: toolTextFor(action, target, "Reset to default template.") }], details: { action, repo: repoDetails(repo), name: target.name, path: target.path, changed: true } satisfies RoughPadDetails };
				case "delete": {
					const deleted = await deletePad(target);
					return { content: [{ type: "text", text: toolTextFor(action, target, deleted ? "Deleted pad file." : "Pad file did not exist.") }], details: { action, repo: repoDetails(repo), name: target.name, path: target.path, deleted } satisfies RoughPadDetails };
				}
				default:
					return { content: [{ type: "text", text: `Unknown action: ${action}` }], details: { action, repo: repoDetails(repo), error: `Unknown action: ${action}` } satisfies RoughPadDetails };
			}
		},
	});
}
