import { StringEnum } from "@earendil-works/pi-ai";
import {
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	getAgentDir,
	withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { constants } from "node:fs";
import { access, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { createHash } from "node:crypto";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { Type } from "typebox";

const execFileAsync = promisify(execFile);
const STORE_VERSION = 1;
const SUMMARY_MAX = 240;
const MAX_TOOL_CHARS = 80_000;
const MAX_NOTIFY_CHARS = 24_000;
const MAX_SEARCH_RESULTS = 20;

const FORMATS = ["markdown", "org", "html"] as const;
type ResearchFormat = (typeof FORMATS)[number];
const ACTIONS = ["list", "search", "read", "create", "update", "remove", "path", "reindex"] as const;
type ResearchAction = (typeof ACTIONS)[number];

type RepoInfo = {
	key: string;
	path: string;
	name: string;
	dirName: string;
};

type ResearchMeta = {
	version: typeof STORE_VERSION;
	id: string;
	title: string;
	summary: string;
	format: ResearchFormat;
	fileName: string;
	tags: string[];
	files: string[];
	sources: string[];
	warnings: string[];
	repoKey: string;
	repoName: string;
	repoPath: string;
	createdAt: string;
	updatedAt: string;
	contentHash: string;
	missing?: boolean;
};

type Catalog = {
	version: typeof STORE_VERSION;
	repo: { key: string; name: string; path: string };
	updatedAt: string;
	notes: ResearchMeta[];
};

type SearchHit = {
	meta: ResearchMeta;
	score: number;
	snippet?: string;
};

type ToolDetails = {
	action: ResearchAction;
	repo: { key: string; name: string; path: string };
	note?: ResearchMeta;
	notes?: ResearchMeta[];
	hits?: Array<{ id: string; title: string; summary: string; score: number }>;
	path?: string;
	catalogPath?: string;
	changed?: boolean;
	removed?: boolean;
	error?: string;
};

const Params = Type.Object({
	action: StringEnum(ACTIONS),
	id: Type.Optional(Type.String({ description: "Note ID, unique ID prefix, or unique title for read/update/remove/path." })),
	query: Type.Optional(Type.String({ description: "Search query for metadata and note contents." })),
	title: Type.Optional(Type.String({ description: "Research note title for create, or replacement title for update." })),
	summary: Type.Optional(Type.String({ description: "One very concise sentence describing what future agents learn from this note." })),
	format: Type.Optional(StringEnum(FORMATS)),
	content: Type.Optional(Type.String({ description: "Complete note contents. Required for create; optional for update." })),
	tags: Type.Optional(Type.Array(Type.String(), { description: "Stable topic tags." })),
	files: Type.Optional(Type.Array(Type.String(), { description: "Relevant repository-relative file paths." })),
	sources: Type.Optional(Type.Array(Type.String(), { description: "Source URLs or bibliographic references." })),
});

function storeRoot() {
	return process.env.PI_RESEARCH_KB_DIR?.trim() || join(getAgentDir(), "research-kb");
}

function hash(text: string) {
	return createHash("sha256").update(text).digest("hex");
}

function slugify(input: string, fallback = "research") {
	const slug = input
		.trim()
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 72);
	return slug || fallback;
}

function uniqueStrings(values: unknown, max = 100) {
	if (!Array.isArray(values)) return [];
	const seen = new Set<string>();
	const result: string[] = [];
	for (const item of values) {
		if (typeof item !== "string") continue;
		const value = item.trim();
		if (!value || seen.has(value)) continue;
		seen.add(value);
		result.push(value);
		if (result.length >= max) break;
	}
	return result;
}

function conciseSummary(value: string) {
	const oneLine = value.replace(/\s+/g, " ").trim();
	if (!oneLine) throw new Error("A concise summary is required.");
	return oneLine.length <= SUMMARY_MAX ? oneLine : `${oneLine.slice(0, SUMMARY_MAX - 1).trimEnd()}…`;
}

function extensionFor(format: ResearchFormat) {
	return format === "markdown" ? ".md" : format === "org" ? ".org" : ".html";
}

function normalizeFormat(value: string | undefined): ResearchFormat {
	const normalized = value?.toLowerCase();
	if (!normalized || normalized === "md" || normalized === "markdown") return "markdown";
	if (normalized === "org") return "org";
	if (normalized === "html" || normalized === "htm") return "html";
	throw new Error(`Unsupported format: ${value}. Use markdown, org, or html.`);
}

function truncate(text: string, max = MAX_TOOL_CHARS) {
	return text.length <= max ? text : `${text.slice(0, max)}\n\n[truncated ${text.length - max} characters]`;
}

async function exists(path: string) {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function gitRoot(cwd: string) {
	try {
		const result = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 2_500, maxBuffer: 1024 * 1024 });
		return String(result.stdout).trim() || undefined;
	} catch {
		return undefined;
	}
}

async function getRepoInfo(cwd: string): Promise<RepoInfo> {
	const rootCandidate = (await gitRoot(cwd)) || cwd;
	const root = await realpath(rootCandidate).catch(() => rootCandidate);
	const key = hash(root).slice(0, 16);
	const name = basename(root) || "repo";
	return { key, path: root, name, dirName: `${slugify(name, "repo")}-${key}` };
}

function repoDirectory(repo: RepoInfo) {
	return join(storeRoot(), "repos", repo.dirName);
}

function notesDirectory(repo: RepoInfo) {
	return join(repoDirectory(repo), "notes");
}

function catalogJsonPath(repo: RepoInfo) {
	return join(repoDirectory(repo), "catalog.json");
}

function catalogMarkdownPath(repo: RepoInfo) {
	return join(repoDirectory(repo), "CATALOG.md");
}

function metaPath(repo: RepoInfo, id: string) {
	return join(notesDirectory(repo), `${id}.meta.json`);
}

function notePath(repo: RepoInfo, meta: ResearchMeta) {
	return join(notesDirectory(repo), meta.fileName);
}

async function atomicWrite(path: string, content: string) {
	await mkdir(dirname(path), { recursive: true });
	await withFileMutationQueue(path, async () => {
		const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
		await writeFile(temp, content, "utf8");
		await rename(temp, path);
	});
}

function validMeta(value: unknown, repo: RepoInfo): ResearchMeta | undefined {
	if (!value || typeof value !== "object") return undefined;
	const item = value as Partial<ResearchMeta>;
	if (item.repoKey !== repo.key || typeof item.id !== "string" || typeof item.title !== "string") return undefined;
	if (!FORMATS.includes(item.format as ResearchFormat) || typeof item.fileName !== "string") return undefined;
	return {
		version: STORE_VERSION,
		id: item.id,
		title: item.title,
		summary: typeof item.summary === "string" ? item.summary : "No summary available.",
		format: item.format as ResearchFormat,
		fileName: item.fileName,
		tags: uniqueStrings(item.tags),
		files: uniqueStrings(item.files),
		sources: uniqueStrings(item.sources),
		warnings: uniqueStrings(item.warnings),
		repoKey: repo.key,
		repoName: repo.name,
		repoPath: repo.path,
		createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date(0).toISOString(),
		updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : new Date(0).toISOString(),
		contentHash: typeof item.contentHash === "string" ? item.contentHash : "",
		missing: item.missing === true || undefined,
	};
}

async function scanMetadata(repo: RepoInfo) {
	let names: string[];
	try {
		names = await readdir(notesDirectory(repo));
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw err;
	}
	const notes: ResearchMeta[] = [];
	for (const name of names.filter((item) => item.endsWith(".meta.json")).sort()) {
		try {
			const parsed = JSON.parse(await readFile(join(notesDirectory(repo), name), "utf8"));
			const meta = validMeta(parsed, repo);
			if (meta) notes.push(meta);
		} catch {
			// A malformed sidecar is skipped; /research reindex reports only recoverable entries.
		}
	}
	return notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.title.localeCompare(b.title));
}

function escapeMarkdownCell(value: string) {
	return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function catalogMarkdown(repo: RepoInfo, notes: ResearchMeta[]) {
	const lines = [
		`# Research catalog: ${repo.name}`,
		"",
		`Repository: \`${repo.path}\``,
		`Updated: ${new Date().toISOString()}`,
		"",
		"| ID | Format | Updated | What it contains |",
		"|---|---|---|---|",
	];
	for (const note of notes) {
		const missing = note.missing ? " ⚠ missing" : "";
		lines.push(`| \`${note.id}\` | ${note.format}${missing} | ${note.updatedAt.slice(0, 10)} | ${escapeMarkdownCell(note.summary)} |`);
	}
	if (!notes.length) lines.push("| — | — | — | No research notes yet. |");
	lines.push("", "This file is generated by pi-research-kb. Use note sidecars and the extension API as the source of truth.", "");
	return lines.join("\n");
}

async function refreshCatalog(repo: RepoInfo) {
	const notes = await scanMetadata(repo);
	const catalog: Catalog = {
		version: STORE_VERSION,
		repo: { key: repo.key, name: repo.name, path: repo.path },
		updatedAt: new Date().toISOString(),
		notes,
	};
	await atomicWrite(catalogJsonPath(repo), `${JSON.stringify(catalog, null, 2)}\n`);
	await atomicWrite(catalogMarkdownPath(repo), catalogMarkdown(repo, notes));
	return notes;
}

async function writeMetadata(repo: RepoInfo, meta: ResearchMeta) {
	await atomicWrite(metaPath(repo, meta.id), `${JSON.stringify(meta, null, 2)}\n`);
}

async function resolveNote(repo: RepoInfo, selector: string) {
	const value = selector.trim();
	if (!value) throw new Error("A research note ID or title is required.");
	const notes = await scanMetadata(repo);
	const lower = value.toLowerCase();
	const exact = notes.find((note) => note.id === value || note.title.toLowerCase() === lower);
	if (exact) return exact;
	const prefix = notes.filter((note) => note.id.startsWith(value));
	if (prefix.length === 1) return prefix[0];
	const titleMatches = notes.filter((note) => note.title.toLowerCase().includes(lower));
	if (titleMatches.length === 1) return titleMatches[0];
	const matches = prefix.length ? prefix : titleMatches;
	if (matches.length > 1) throw new Error(`Ambiguous note “${value}”: ${matches.map((note) => note.id).join(", ")}`);
	throw new Error(`Research note not found: ${value}`);
}

async function uniqueId(repo: RepoInfo, title: string) {
	const base = slugify(title);
	const notes = await scanMetadata(repo);
	const used = new Set(notes.map((note) => note.id));
	if (!used.has(base) && !(await exists(metaPath(repo, base)))) return base;
	for (let i = 2; i < 10_000; i++) {
		const candidate = `${base}-${i}`;
		if (!used.has(candidate) && !(await exists(metaPath(repo, candidate)))) return candidate;
	}
	return `${base}-${Date.now().toString(36)}`;
}

function validateAndNormalizeContent(format: ResearchFormat, title: string, content: string) {
	let normalized = content.trim();
	if (!normalized) throw new Error("Research note content is required.");
	const warnings: string[] = [];
	if (format === "markdown" && !/^#\s+/m.test(normalized)) normalized = `# ${title}\n\n${normalized}`;
	if (format === "org" && !/^#\+TITLE:/im.test(normalized)) normalized = `#+TITLE: ${title}\n\n${normalized}`;
	if (format === "html") {
		if (!/<(?:!doctype\s+html|html\b)/i.test(normalized)) throw new Error("HTML research must be a complete document with <!doctype html> or <html>.");
		if (!/<meta[^>]+charset\s*=\s*["']?utf-8/i.test(normalized)) throw new Error("HTML research must include <meta charset=\"utf-8\">.");
		const remoteAssets = [
			/<script\b[^>]*\bsrc\s*=\s*["']https?:\/\//i,
			/<img\b[^>]*\bsrc\s*=\s*["']https?:\/\//i,
			/<link\b[^>]*\bhref\s*=\s*["']https?:\/\//i,
		];
		if (remoteAssets.some((pattern) => pattern.test(normalized))) {
			throw new Error("HTML research must be self-contained: inline scripts, styles, and images instead of remote assets.");
		}
		if (!/prefers-color-scheme/i.test(normalized)) warnings.push("HTML does not declare a prefers-color-scheme style.");
	}
	return { content: `${normalized}\n`, warnings };
}

async function createNote(
	repo: RepoInfo,
	input: { title: string; summary: string; format: ResearchFormat; content: string; tags?: string[]; files?: string[]; sources?: string[] },
) {
	const title = input.title.replace(/\s+/g, " ").trim();
	if (!title) throw new Error("A title is required.");
	const id = await uniqueId(repo, title);
	const normalized = validateAndNormalizeContent(input.format, title, input.content);
	const now = new Date().toISOString();
	const fileName = `${id}${extensionFor(input.format)}`;
	const meta: ResearchMeta = {
		version: STORE_VERSION,
		id,
		title,
		summary: conciseSummary(input.summary),
		format: input.format,
		fileName,
		tags: uniqueStrings(input.tags),
		files: uniqueStrings(input.files),
		sources: uniqueStrings(input.sources),
		warnings: normalized.warnings,
		repoKey: repo.key,
		repoName: repo.name,
		repoPath: repo.path,
		createdAt: now,
		updatedAt: now,
		contentHash: hash(normalized.content),
	};
	await atomicWrite(join(notesDirectory(repo), fileName), normalized.content);
	await writeMetadata(repo, meta);
	await refreshCatalog(repo);
	return meta;
}

async function updateNote(
	repo: RepoInfo,
	existing: ResearchMeta,
	input: { title?: string; summary?: string; format?: ResearchFormat; content?: string; tags?: string[]; files?: string[]; sources?: string[] },
) {
	const title = input.title?.replace(/\s+/g, " ").trim() || existing.title;
	const format = input.format ?? existing.format;
	if (format !== existing.format && input.content === undefined) throw new Error("Changing note format requires complete replacement content.");
	const oldPath = notePath(repo, existing);
	const priorContent = input.content === undefined ? await readFile(oldPath, "utf8") : input.content;
	const normalized = validateAndNormalizeContent(format, title, priorContent);
	const fileName = `${existing.id}${extensionFor(format)}`;
	const updated: ResearchMeta = {
		...existing,
		title,
		summary: input.summary === undefined ? existing.summary : conciseSummary(input.summary),
		format,
		fileName,
		tags: input.tags === undefined ? existing.tags : uniqueStrings(input.tags),
		files: input.files === undefined ? existing.files : uniqueStrings(input.files),
		sources: input.sources === undefined ? existing.sources : uniqueStrings(input.sources),
		warnings: normalized.warnings,
		repoName: repo.name,
		repoPath: repo.path,
		updatedAt: new Date().toISOString(),
		contentHash: hash(normalized.content),
		missing: undefined,
	};
	const newPath = join(notesDirectory(repo), fileName);
	await atomicWrite(newPath, normalized.content);
	await writeMetadata(repo, updated);
	if (newPath !== oldPath) await rm(oldPath, { force: true });
	await refreshCatalog(repo);
	return updated;
}

async function removeNote(repo: RepoInfo, meta: ResearchMeta) {
	await rm(notePath(repo, meta), { force: true });
	await rm(metaPath(repo, meta.id), { force: true });
	await refreshCatalog(repo);
}

function tokens(query: string) {
	return [...new Set(query.toLowerCase().split(/[^a-z0-9_.:/-]+/).filter(Boolean))];
}

function snippetFor(content: string, terms: string[]) {
	const lower = content.toLowerCase();
	let index = -1;
	for (const term of terms) {
		const found = lower.indexOf(term);
		if (found !== -1 && (index === -1 || found < index)) index = found;
	}
	if (index === -1) return undefined;
	const start = Math.max(0, index - 90);
	const end = Math.min(content.length, index + 230);
	return `${start ? "…" : ""}${content.slice(start, end).replace(/\s+/g, " ").trim()}${end < content.length ? "…" : ""}`;
}

async function searchNotes(repo: RepoInfo, query: string) {
	const terms = tokens(query);
	if (!terms.length) throw new Error("A non-empty search query is required.");
	const notes = await scanMetadata(repo);
	const hits: SearchHit[] = [];
	for (const meta of notes) {
		const title = meta.title.toLowerCase();
		const summary = meta.summary.toLowerCase();
		const tags = meta.tags.join(" ").toLowerCase();
		const files = meta.files.join(" ").toLowerCase();
		let content = "";
		try {
			content = await readFile(notePath(repo, meta), "utf8");
		} catch {
			// Missing notes remain searchable by metadata.
		}
		const body = content.toLowerCase();
		let score = 0;
		for (const term of terms) {
			if (meta.id.includes(term)) score += 10;
			if (title.includes(term)) score += 8;
			if (summary.includes(term)) score += 5;
			if (tags.includes(term)) score += 4;
			if (files.includes(term)) score += 3;
			if (body.includes(term)) score += 1;
		}
		if (score) hits.push({ meta, score, snippet: snippetFor(content, terms) });
	}
	return hits.sort((a, b) => b.score - a.score || b.meta.updatedAt.localeCompare(a.meta.updatedAt)).slice(0, MAX_SEARCH_RESULTS);
}

async function reindex(repo: RepoInfo) {
	const notes = await scanMetadata(repo);
	for (const meta of notes) {
		const path = notePath(repo, meta);
		try {
			const [content, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
			const contentHash = hash(content);
			if (meta.missing || contentHash !== meta.contentHash) {
				await writeMetadata(repo, {
					...meta,
					contentHash,
					updatedAt: info.mtime.toISOString(),
					missing: undefined,
				});
			}
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "ENOENT" && !meta.missing) await writeMetadata(repo, { ...meta, missing: true });
		}
	}
	return refreshCatalog(repo);
}

function formatList(notes: ResearchMeta[]) {
	if (!notes.length) return "No research notes for this repository.";
	return notes
		.map((note) => {
			const tags = note.tags.length ? ` [${note.tags.join(", ")}]` : "";
			const missing = note.missing ? " ⚠ missing" : "";
			return `- ${note.id} (${note.format}${missing})${tags}\n  ${note.summary}`;
		})
		.join("\n");
}

function formatHits(hits: SearchHit[]) {
	if (!hits.length) return "No matching research notes.";
	return hits
		.map((hit) => `- ${hit.meta.id} — ${hit.meta.title} [score ${hit.score}]\n  ${hit.meta.summary}${hit.snippet ? `\n  Match: ${hit.snippet}` : ""}`)
		.join("\n");
}

function repoDetails(repo: RepoInfo) {
	return { key: repo.key, name: repo.name, path: repo.path };
}

function shellQuote(text: string) {
	return `'${text.replace(/'/g, `'\\''`)}'`;
}

function editorCommand() {
	const configured = process.env.PI_RESEARCH_EDITOR?.trim() || process.env.VISUAL?.trim() || process.env.EDITOR?.trim();
	if (configured) return configured;
	for (const editor of ["nvim", "vim", "vi", "nano"]) {
		if (spawnSync("sh", ["-lc", `command -v ${shellQuote(editor)}`], { stdio: "ignore" }).status === 0) return editor;
	}
	return "vi";
}

async function runTerminalCommand(ctx: ExtensionCommandContext, command: string, args: string[]) {
	if (ctx.mode !== "tui") return false;
	const exitCode = await ctx.ui.custom<number | null>((tui, _theme, _kb, done) => {
		tui.stop();
		process.stdout.write("\x1b[2J\x1b[H");
		const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
		tui.start();
		tui.requestRender(true);
		done(result.status);
		return { render: () => [], invalidate: () => {} };
	});
	return exitCode === 0;
}

async function openHtml(path: string) {
	const custom = process.env.PI_RESEARCH_BROWSER?.trim();
	if (custom) {
		const result = spawnSync(process.env.SHELL || "/bin/sh", ["-lc", `exec ${custom} \"$1\"`, "pi-research-browser", path], { stdio: "ignore", env: process.env });
		return result.status === 0;
	}
	if (process.platform === "darwin") {
		const chrome = "/Applications/Google Chrome.app";
		if (await exists(chrome)) {
			const url = pathToFileURL(path).href;
			const script = `tell application "Google Chrome"\nactivate\nif (count of windows) = 0 then make new window\nset w to front window\nmake new tab at end of tabs of w with properties {URL:${JSON.stringify(url)}}\nset active tab index of w to (count of tabs of w)\nend tell`;
			return spawnSync("osascript", ["-e", script], { stdio: "ignore" }).status === 0;
		}
		return spawnSync("open", [path], { stdio: "ignore" }).status === 0;
	}
	if (process.platform === "win32") return spawnSync("cmd", ["/c", "start", "", path], { stdio: "ignore" }).status === 0;
	return spawnSync("xdg-open", [path], { stdio: "ignore" }).status === 0;
}

function parseNewRequest(rest: string) {
	let value = rest.trim();
	let format: ResearchFormat = normalizeFormat(process.env.PI_RESEARCH_KB_FORMAT);
	const flag = value.match(/^--format(?:=|\s+)(markdown|md|org|html|htm)\s*/i);
	if (flag) {
		format = normalizeFormat(flag[1]);
		value = value.slice(flag[0].length).trim();
	} else {
		const leading = value.match(/^(markdown|md|org|html|htm)\s+(.+)$/is);
		if (leading) {
			format = normalizeFormat(leading[1]);
			value = leading[2].trim();
		}
	}
	return { format, topic: value };
}

function splitCommand(args: string) {
	const trimmed = args.trim();
	if (!trimmed) return { command: "status", rest: "" };
	const match = trimmed.match(/^(\S+)(?:\s+([\s\S]*))?$/);
	return { command: (match?.[1] ?? "status").toLowerCase(), rest: match?.[2]?.trim() ?? "" };
}

function commandHelp() {
	return [
		"Research knowledge-base commands:",
		"/research                         Show repo KB status and recent notes",
		"/research new [md|org|html] TOPIC Start agent research and save it",
		"/research update ID [REQUEST]     Research and update an existing note",
		"/research list [filter]            List concise catalog entries",
		"/research search QUERY             Search metadata and full note text",
		"/research read ID                  Display a note",
		"/research open ID                  Open HTML in browser; Markdown/Org in editor",
		"/research path ID                  Show note path",
		"/research catalog                  Show catalog path",
		"/research catalog open             Open generated catalog in editor",
		"/research remove ID                Delete a note after confirmation",
		"/research reindex                  Reconcile metadata after external edits",
	].join("\n");
}

export default function researchKnowledgeBase(pi: ExtensionAPI) {
	async function updateStatus(ctx: ExtensionContext | ExtensionCommandContext, repo?: RepoInfo) {
		const currentRepo = repo ?? (await getRepoInfo(ctx.cwd));
		const notes = await scanMetadata(currentRepo);
		ctx.ui.setStatus("research-kb", ctx.ui.theme.fg("dim", `kb:${notes.length}`));
	}

	pi.on("session_start", async (_event, ctx) => {
		const repo = await getRepoInfo(ctx.cwd);
		await refreshCatalog(repo);
		await updateStatus(ctx, repo);
	});
	pi.on("session_shutdown", async (_event, ctx) => ctx.ui.setStatus("research-kb", undefined));

	pi.registerCommand("research", {
		description: "Research into a repo-scoped local knowledge base. Usage: /research help",
		getArgumentCompletions: async (prefix) => {
			const first = prefix.trimStart();
			if (first.includes(" ")) return null;
			const commands = ["help", "new", "update", "list", "search", "read", "open", "path", "catalog", "remove", "reindex"];
			return commands.filter((command) => command.startsWith(first.toLowerCase())).map((command) => ({ value: command, label: command }));
		},
		handler: async (args, ctx) => {
			const { command, rest } = splitCommand(args);
			try {
				const repo = await getRepoInfo(ctx.cwd);
				switch (command) {
					case "status": {
						const notes = await refreshCatalog(repo);
						const recent = notes.slice(0, 5);
						ctx.ui.notify(
							[
								`Research KB: ${notes.length} note(s) for ${repo.name}`,
								`Catalog: ${catalogMarkdownPath(repo)}`,
								"Formats: Markdown, Org, self-contained HTML",
								"",
								recent.length ? `Recent:\n${formatList(recent)}` : "No notes yet. Use /research new [format] <topic>.",
							].join("\n"),
							"info",
						);
						await updateStatus(ctx, repo);
						return;
					}
					case "help":
						ctx.ui.notify(commandHelp(), "info");
						return;
					case "new": {
						const request = parseNewRequest(rest);
						if (!request.topic) return ctx.ui.notify("Usage: /research new [md|org|html] <topic>", "warning");
						const prompt = `/skill:research-kb Research this thoroughly and preserve the result in the repository knowledge base. Required format: ${request.format}. Topic: ${request.topic}`;
						pi.sendUserMessage(prompt, { deliverAs: ctx.isIdle() ? undefined : "followUp", expandPromptTemplates: true });
						return;
					}
					case "update": {
						const match = rest.match(/^(\S+)(?:\s+([\s\S]+))?$/);
						if (!match) return ctx.ui.notify("Usage: /research update <id> [what changed or what to investigate]", "warning");
						const note = await resolveNote(repo, match[1]);
						const request = match[2]?.trim() || "Re-verify this note against the current codebase and update stale or incomplete information.";
						const prompt = `/skill:research-kb Update research note ${note.id} (${note.title}). Read it first, investigate and verify the requested changes, then save through research_kb action=update. Request: ${request}`;
						pi.sendUserMessage(prompt, { deliverAs: ctx.isIdle() ? undefined : "followUp", expandPromptTemplates: true });
						return;
					}
					case "list": {
						const notes = await refreshCatalog(repo);
						const needle = rest.toLowerCase();
						const filtered = needle
							? notes.filter((note) => `${note.id} ${note.title} ${note.summary} ${note.tags.join(" ")} ${note.files.join(" ")}`.toLowerCase().includes(needle))
							: notes;
						ctx.ui.notify(formatList(filtered), "info");
						return;
					}
					case "search":
						if (!rest) return ctx.ui.notify("Usage: /research search <query>", "warning");
						ctx.ui.notify(formatHits(await searchNotes(repo, rest)), "info");
						return;
					case "read": {
						const note = await resolveNote(repo, rest);
						const content = await readFile(notePath(repo, note), "utf8");
						ctx.ui.notify(truncate(content, MAX_NOTIFY_CHARS), "info");
						return;
					}
					case "path": {
						const note = await resolveNote(repo, rest);
						ctx.ui.notify(notePath(repo, note), "info");
						return;
					}
					case "open": {
						const note = await resolveNote(repo, rest);
						const path = notePath(repo, note);
						if (note.format === "html") {
							const opened = await openHtml(path);
							ctx.ui.notify(opened ? `Opened ${note.title} in the browser.` : `Could not open browser. Path: ${path}`, opened ? "info" : "warning");
						} else {
							const opened = await runTerminalCommand(ctx, process.env.SHELL || "/bin/sh", ["-lc", `exec ${editorCommand()} \"$1\"`, "pi-research-editor", path]);
							if (!opened) ctx.ui.notify(`Open in your editor: ${path}`, "info");
						}
						return;
					}
					case "catalog": {
						await refreshCatalog(repo);
						const path = catalogMarkdownPath(repo);
						if (rest.toLowerCase() === "open") {
							const opened = await runTerminalCommand(ctx, process.env.SHELL || "/bin/sh", ["-lc", `exec ${editorCommand()} \"$1\"`, "pi-research-editor", path]);
							if (!opened) ctx.ui.notify(path, "info");
						} else ctx.ui.notify(path, "info");
						return;
					}
					case "remove": {
						const note = await resolveNote(repo, rest);
						if (ctx.hasUI && !(await ctx.ui.confirm("Remove research note?", `Delete ${note.id} — ${note.title}?\n${notePath(repo, note)}`))) return;
						await removeNote(repo, note);
						await updateStatus(ctx, repo);
						ctx.ui.notify(`Removed ${note.id}.`, "info");
						return;
					}
					case "reindex": {
						const notes = await reindex(repo);
						await updateStatus(ctx, repo);
						ctx.ui.notify(`Reindexed ${notes.length} research note(s).\n${catalogMarkdownPath(repo)}`, "info");
						return;
					}
					default:
						ctx.ui.notify(`Unknown /research command: ${command}\n\n${commandHelp()}`, "warning");
				}
			} catch (err) {
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
			}
		},
	});

	pi.registerTool({
		name: "research_kb",
		label: "Research KB",
		description: "Manage a durable repo-scoped research knowledge base outside git. List/search existing knowledge before researching; read, create, update, remove, or reindex Markdown, Org, and self-contained HTML notes.",
		promptSnippet: "Search and maintain the repo-scoped local research knowledge base in Markdown, Org, or self-contained HTML.",
		promptGuidelines: [
			"For substantial research or codebase explanation, inspect research_kb action=list/search first so existing knowledge is reused instead of duplicated.",
			"Research and verify with the appropriate code/web tools before create/update; never store raw unverified search output as a finished note.",
			"Give every note a very concise catalog summary plus relevant tags, repository files, and source URLs.",
			"Use complete self-contained HTML (inline assets, UTF-8) when HTML is requested; use Markdown by default or Org when requested.",
			"Only remove a research note when the user explicitly asks to remove it.",
		],
		parameters: Params,
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			const action = params.action as ResearchAction;
			const repo = await getRepoInfo(ctx.cwd);
			const baseDetails = { action, repo: repoDetails(repo), catalogPath: catalogMarkdownPath(repo) };
			onUpdate?.({ content: [{ type: "text", text: `research_kb ${action}${params.id ? ` ${params.id}` : ""}` }], details: baseDetails });
			try {
				switch (action) {
					case "list": {
						const notes = await refreshCatalog(repo);
						const query = params.query?.toLowerCase().trim();
						const filtered = query
							? notes.filter((note) => `${note.id} ${note.title} ${note.summary} ${note.tags.join(" ")} ${note.files.join(" ")}`.toLowerCase().includes(query))
							: notes;
						await updateStatus(ctx, repo);
						return { content: [{ type: "text", text: formatList(filtered) }], details: { ...baseDetails, notes: filtered } satisfies ToolDetails };
					}
					case "search": {
						if (!params.query?.trim()) throw new Error("query is required for action=search");
						const hits = await searchNotes(repo, params.query);
						return {
							content: [{ type: "text", text: formatHits(hits) }],
							details: { ...baseDetails, hits: hits.map((hit) => ({ id: hit.meta.id, title: hit.meta.title, summary: hit.meta.summary, score: hit.score })) } satisfies ToolDetails,
						};
					}
					case "read": {
						const note = await resolveNote(repo, params.id ?? "");
						const content = await readFile(notePath(repo, note), "utf8");
						return {
							content: [{ type: "text", text: `ID: ${note.id}\nTitle: ${note.title}\nSummary: ${note.summary}\nFormat: ${note.format}\nFiles: ${note.files.join(", ") || "—"}\nSources: ${note.sources.join(", ") || "—"}\nPath: ${notePath(repo, note)}\n\n${truncate(content)}` }],
							details: { ...baseDetails, note, path: notePath(repo, note) } satisfies ToolDetails,
						};
					}
					case "path": {
						const note = await resolveNote(repo, params.id ?? "");
						const path = notePath(repo, note);
						return { content: [{ type: "text", text: path }], details: { ...baseDetails, note, path } satisfies ToolDetails };
					}
					case "create": {
						if (!params.title?.trim()) throw new Error("title is required for action=create");
						if (!params.summary?.trim()) throw new Error("summary is required for action=create");
						if (!params.content?.trim()) throw new Error("content is required for action=create");
						const note = await createNote(repo, {
							title: params.title,
							summary: params.summary,
							format: normalizeFormat(params.format),
							content: params.content,
							tags: params.tags,
							files: params.files,
							sources: params.sources,
						});
						await updateStatus(ctx, repo);
						const path = notePath(repo, note);
						return {
							content: [{ type: "text", text: `Created research note ${note.id} (${note.format}).\nSummary: ${note.summary}\nPath: ${path}${note.warnings.length ? `\nWarnings: ${note.warnings.join("; ")}` : ""}` }],
							details: { ...baseDetails, note, path, changed: true } satisfies ToolDetails,
						};
					}
					case "update": {
						const existing = await resolveNote(repo, params.id ?? "");
						const note = await updateNote(repo, existing, {
							title: params.title,
							summary: params.summary,
							format: params.format ? normalizeFormat(params.format) : undefined,
							content: params.content,
							tags: params.tags,
							files: params.files,
							sources: params.sources,
						});
						await updateStatus(ctx, repo);
						const path = notePath(repo, note);
						return {
							content: [{ type: "text", text: `Updated research note ${note.id}.\nSummary: ${note.summary}\nPath: ${path}${note.warnings.length ? `\nWarnings: ${note.warnings.join("; ")}` : ""}` }],
							details: { ...baseDetails, note, path, changed: true } satisfies ToolDetails,
						};
					}
					case "remove": {
						const note = await resolveNote(repo, params.id ?? "");
						await removeNote(repo, note);
						await updateStatus(ctx, repo);
						return { content: [{ type: "text", text: `Removed research note ${note.id} — ${note.title}.` }], details: { ...baseDetails, note, removed: true, changed: true } satisfies ToolDetails };
					}
					case "reindex": {
						const notes = await reindex(repo);
						await updateStatus(ctx, repo);
						return { content: [{ type: "text", text: `Reindexed ${notes.length} research note(s).\nCatalog: ${catalogMarkdownPath(repo)}` }], details: { ...baseDetails, notes, changed: true } satisfies ToolDetails };
					}
					default:
						throw new Error(`Unknown action: ${action}`);
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return { content: [{ type: "text", text: `Research KB error: ${message}` }], details: { ...baseDetails, error: message } satisfies ToolDetails };
			}
		},
	});
}
