import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "typebox";
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT = 15 * 60 * 1000;
const INFO_TIMEOUT = 3 * 60 * 1000;

type ExecResult = { stdout?: string; stderr?: string; code?: number };

function expandPath(input: string, cwd: string) {
	if (!input) return cwd;
	const expanded = input.startsWith("~/") ? join(homedir(), input.slice(2)) : input;
	return resolve(cwd, expanded);
}

function truncate(text: string, max = 20_000) {
	return text.length <= max ? text : `${text.slice(0, max)}\n\n[truncated ${text.length - max} chars]`;
}

function parseVttOrSrt(raw: string) {
	const lines = raw
		.replace(/^WEBVTT.*$/m, "")
		.split(/\r?\n/)
		.map((line) =>
			line
				.replace(/<[^>]+>/g, "")
				.replace(/&amp;/g, "&")
				.replace(/&lt;/g, "<")
				.replace(/&gt;/g, ">")
				.replace(/&nbsp;/g, " ")
				.trim(),
		)
		.filter(Boolean)
		.filter((line) => !/^\d+$/.test(line))
		.filter((line) => !/-->/.test(line))
		.filter((line) => !/^NOTE\b/.test(line));

	const out: string[] = [];
	for (const line of lines) {
		if (out[out.length - 1] !== line) out.push(line);
	}
	return out.join("\n");
}

async function newestFiles(dir: string) {
	const names = await readdir(dir);
	const items = await Promise.all(
		names.map(async (name) => {
			const path = join(dir, name);
			const s = await stat(path);
			return { path, name, mtimeMs: s.mtimeMs, size: s.size };
		}),
	);
	return items.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

async function assertTool(pi: ExtensionAPI, bin: string) {
	const r = (await pi.exec(bin, ["--version"], { timeout: 10_000 }).catch((err: unknown) => ({
		code: 127,
		stderr: err instanceof Error ? err.message : String(err),
	}))) as ExecResult;
	if (r.code && r.code !== 0) throw new Error(`${bin} is not available. Install it first. stderr: ${r.stderr ?? ""}`);
	return (r.stdout ?? r.stderr ?? "").trim().split(/\r?\n/)[0] ?? "ok";
}

async function extractTranscript(pi: ExtensionAPI, url: string, langs: string, cwd: string, signal?: AbortSignal, maxChars = 40_000) {
	const temp = await mkdtemp(join(tmpdir(), "pi-yt-dlp-subs-"));
	const output = join(temp, "%(title).120B-%(id)s.%(ext)s");
	const args = [
		"--skip-download",
		"--write-subs",
		"--write-auto-subs",
		"--sub-langs",
		langs,
		"--sub-format",
		"vtt/srt/best",
		"--convert-subs",
		"srt",
		"--no-playlist",
		"-o",
		output,
		url,
	];
	const r = (await pi.exec("yt-dlp", args, { cwd, timeout: INFO_TIMEOUT, signal })) as ExecResult;
	const files = (await newestFiles(temp)).filter((f) => /\.(vtt|srt)$/i.test(f.name));
	const transcripts: Array<{ file: string; text: string }> = [];
	for (const f of files) {
		const raw = await readFile(f.path, "utf8");
		const text = truncate(parseVttOrSrt(raw), maxChars);
		if (text) transcripts.push({ file: f.path, text });
	}
	return { tempDir: temp, commandOutput: truncate(`${r.stdout ?? ""}${r.stderr ? `\n${r.stderr}` : ""}`, 4000), transcripts };
}

export default function piYtDlp(pi: ExtensionAPI) {
	pi.registerCommand("ytdlp-check", {
		description: "Check yt-dlp and ffmpeg availability",
		handler: async (_args, ctx) => {
			try {
				const ytdlp = await assertTool(pi, "yt-dlp");
				const ffmpeg = await assertTool(pi, "ffmpeg");
				ctx.ui.notify(`yt-dlp: ${ytdlp}\nffmpeg: ${ffmpeg}`, "success");
			} catch (err) {
				ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
			}
		},
	});

	pi.registerTool({
		name: "youtube_info",
		label: "YouTube Info",
		description: "Fetch YouTube video or playlist metadata with yt-dlp and optionally extract subtitles/transcript text for summarization or language study.",
		promptSnippet: "Fetch YouTube metadata and transcripts/subtitles using yt-dlp",
		promptGuidelines: [
			"Use youtube_info before summarizing, answering questions about, or studying a YouTube video.",
			"Use youtube_info with includeTranscript=true and subtitleLanguages like ja,en for Japanese video learning.",
		],
		parameters: Type.Object({
			url: Type.String({ description: "YouTube video or playlist URL" }),
			includeTranscript: Type.Optional(Type.Boolean({ description: "Download subtitles/auto subtitles and return plain transcript text" })),
			subtitleLanguages: Type.Optional(Type.String({ description: "yt-dlp subtitle language selector, e.g. ja,en,en.*,all", default: "en.*,en,ja" })),
			playlist: Type.Optional(Type.Boolean({ description: "Allow playlist metadata instead of forcing a single video" })),
			playlistItems: Type.Optional(Type.String({ description: "yt-dlp playlist item selector, e.g. 1:5 or 1,3,7" })),
			maxTranscriptChars: Type.Optional(Type.Number({ description: "Maximum transcript chars returned", default: 40000 })),
			transcriptOutputPath: Type.Optional(Type.String({ description: "Optional .txt path to save combined transcript. Supports ~/" })),
		}),
		async execute(_id, params, signal, onUpdate, ctx) {
			await assertTool(pi, "yt-dlp");
			onUpdate?.({ content: [{ type: "text", text: "Fetching YouTube metadata..." }], details: {} });
			const args = ["-J", "--no-warnings"];
			if (!params.playlist) args.push("--no-playlist");
			if (params.playlistItems) args.push("--playlist-items", params.playlistItems);
			args.push(params.url);
			const r = (await pi.exec("yt-dlp", args, { cwd: ctx.cwd, timeout: INFO_TIMEOUT, signal })) as ExecResult;
			if (r.code && r.code !== 0) throw new Error(r.stderr || "yt-dlp metadata failed");
			const meta = JSON.parse(r.stdout ?? "{}");
			const slim = {
				type: meta._type,
				id: meta.id,
				title: meta.title,
				uploader: meta.uploader ?? meta.channel,
				webpage_url: meta.webpage_url,
				duration: meta.duration,
				view_count: meta.view_count,
				description: truncate(meta.description ?? "", 6000),
				entries: Array.isArray(meta.entries)
					? meta.entries.slice(0, 50).map((e: any) => ({ id: e.id, title: e.title, url: e.webpage_url ?? e.url, duration: e.duration }))
					: undefined,
			};
			let transcriptResult: unknown = undefined;
			if (params.includeTranscript) {
				onUpdate?.({ content: [{ type: "text", text: "Extracting subtitles/transcript..." }], details: { title: meta.title } });
				transcriptResult = await extractTranscript(
					pi,
					params.url,
					params.subtitleLanguages ?? "en.*,en,ja",
					ctx.cwd,
					signal,
					params.maxTranscriptChars ?? 40_000,
				);
				if (params.transcriptOutputPath) {
					const outPath = expandPath(params.transcriptOutputPath, ctx.cwd);
					await mkdir(dirname(outPath), { recursive: true });
					const combined = (transcriptResult as any).transcripts?.map((t: any) => `# ${t.file}\n\n${t.text}`).join("\n\n---\n\n") ?? "";
					await writeFile(outPath, combined, "utf8");
					(transcriptResult as any).savedTranscript = outPath;
				}
			}
			return {
				content: [{ type: "text", text: JSON.stringify({ metadata: slim, transcript: transcriptResult }, null, 2) }],
				details: { metadata: slim, transcript: transcriptResult },
			};
		},
	});

	pi.registerTool({
		name: "youtube_download",
		label: "YouTube Download",
		description: "Download YouTube videos or playlists using yt-dlp. Can extract audio with ffmpeg to mp3/m4a/opus/etc. Can write subtitles.",
		promptSnippet: "Download YouTube videos/playlists or extract playlist audio using yt-dlp/ffmpeg",
		promptGuidelines: [
			"Use youtube_download for requests to save YouTube media locally, including playlists as MP3 audio.",
			"For music playlists, use youtube_download with mode=audio, audioFormat=mp3, and an explicit outputDir.",
		],
		parameters: Type.Object({
			url: Type.String(),
			outputDir: Type.String({ description: "Directory to save files. Supports ~/" }),
			mode: StringEnum(["video", "audio"] as const),
			audioFormat: Type.Optional(StringEnum(["mp3", "m4a", "opus", "flac", "wav", "aac", "vorbis"] as const)),
			quality: Type.Optional(Type.String({ description: "yt-dlp format selector. Defaults to bestvideo+bestaudio/best for video, bestaudio/best for audio." })),
			playlist: Type.Optional(Type.Boolean({ description: "Allow playlist download" })),
			playlistItems: Type.Optional(Type.String({ description: "yt-dlp playlist item selector" })),
			writeSubtitles: Type.Optional(Type.Boolean()),
			subtitleLanguages: Type.Optional(Type.String({ description: "e.g. ja,en,all", default: "en.*,en,ja" })),
			embedMetadata: Type.Optional(Type.Boolean()),
			fileNameTemplate: Type.Optional(Type.String({ description: "yt-dlp output template filename only" })),
		}),
		async execute(_id, params, signal, onUpdate, ctx) {
			await assertTool(pi, "yt-dlp");
			if (params.mode === "audio") await assertTool(pi, "ffmpeg");
			const outDir = expandPath(params.outputDir, ctx.cwd);
			await mkdir(outDir, { recursive: true });
			const template = params.fileNameTemplate ?? (params.playlist ? "%(playlist_index)03d - %(title).180B [%(id)s].%(ext)s" : "%(title).180B [%(id)s].%(ext)s");
			const args = ["--newline", "--no-warnings", "-o", join(outDir, template)];
			if (!params.playlist) args.push("--no-playlist");
			if (params.playlistItems) args.push("--playlist-items", params.playlistItems);
			if (params.mode === "audio") {
				args.push("-f", params.quality ?? "bestaudio/best", "--extract-audio", "--audio-format", params.audioFormat ?? "mp3");
			} else {
				args.push("-f", params.quality ?? "bv*+ba/best", "--merge-output-format", "mp4");
			}
			if (params.writeSubtitles) args.push("--write-subs", "--write-auto-subs", "--sub-langs", params.subtitleLanguages ?? "en.*,en,ja", "--sub-format", "srt/vtt/best");
			if (params.embedMetadata) args.push("--embed-metadata", "--embed-thumbnail");
			args.push(params.url);
			onUpdate?.({ content: [{ type: "text", text: `Downloading to ${outDir}...` }], details: { outputDir: outDir } });
			const r = (await pi.exec("yt-dlp", args, { cwd: ctx.cwd, timeout: DEFAULT_TIMEOUT, signal })) as ExecResult;
			if (r.code && r.code !== 0) throw new Error(r.stderr || "yt-dlp download failed");
			const files = await newestFiles(outDir).catch(() => []);
			return {
				content: [{ type: "text", text: `Downloaded to ${outDir}\n\nRecent files:\n${files.slice(0, 25).map((f) => `- ${f.path}`).join("\n")}` }],
				details: { outputDir: outDir, recentFiles: files.slice(0, 50), stdout: truncate(r.stdout ?? "", 8000), stderr: truncate(r.stderr ?? "", 4000) },
			};
		},
	});

	pi.registerTool({
		name: "youtube_play",
		label: "YouTube Play",
		description: "Play a local media file, or download a YouTube URL to a temporary directory with yt-dlp and open it in a system player.",
		promptSnippet: "Open/play a downloaded media file or YouTube URL",
		parameters: Type.Object({
			target: Type.String({ description: "Local path or YouTube URL" }),
			player: Type.Optional(Type.String({ description: "Player command. Defaults to macOS open, xdg-open, or available mpv/vlc." })),
			mode: Type.Optional(StringEnum(["video", "audio"] as const)),
		}),
		async execute(_id, params, signal, onUpdate, ctx) {
			let target = params.target;
			if (/^https?:\/\//.test(target)) {
				await assertTool(pi, "yt-dlp");
				const dir = await mkdtemp(join(tmpdir(), "pi-yt-dlp-play-"));
				onUpdate?.({ content: [{ type: "text", text: `Downloading temporary media to ${dir}...` }], details: {} });
				const args = ["--no-playlist", "-o", join(dir, "%(title).160B [%(id)s].%(ext)s")];
				if (params.mode === "audio") args.push("-f", "bestaudio/best", "--extract-audio", "--audio-format", "mp3");
				else args.push("-f", "bv*+ba/best", "--merge-output-format", "mp4");
				args.push(target);
				const r = (await pi.exec("yt-dlp", args, { cwd: ctx.cwd, timeout: DEFAULT_TIMEOUT, signal })) as ExecResult;
				if (r.code && r.code !== 0) throw new Error(r.stderr || "temporary download failed");
				const files = (await newestFiles(dir)).filter((f) => !/\.(part|ytdl)$/i.test(f.name));
				if (!files[0]) throw new Error("Download finished but no playable file was found");
				target = files[0].path;
			} else {
				target = expandPath(target, ctx.cwd);
				if (!existsSync(target)) throw new Error(`File does not exist: ${target}`);
			}
			const command = params.player ?? (process.platform === "darwin" ? "open" : "xdg-open");
			const child = spawn(command, [target], { detached: true, stdio: "ignore" });
			child.unref();
			return { content: [{ type: "text", text: `Opened ${target} with ${command}` }], details: { target, command } };
		},
	});
}
