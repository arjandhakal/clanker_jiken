import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { getMarkdownTheme, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Markdown, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

const MAX_BYTES = 2 * 1024 * 1024;

export default function markdownReader(pi: ExtensionAPI) {
	// Command-only: no tools, messages, session entries, or model calls.
	pi.registerCommand("md", {
		description: "Read Markdown locally without adding it to AI context: /md [path]",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("/md requires Pi's interactive terminal UI.", "warning");
				return;
			}

			let path = args.trim() || "README.md";
			if (path.startsWith('"') || path.startsWith("'")) {
				if (path.length < 2 || !path.endsWith(path[0])) {
					ctx.ui.notify("/md: close the quote around the file path.", "error");
					return;
				}
				path = path.slice(1, -1);
			}
			if (path === "~") path = homedir();
			else if (path.startsWith("~/")) path = resolve(homedir(), path.slice(2));
			path = resolve(ctx.cwd, path);

			let content: string;
			try {
				const info = await stat(path);
				if (!info.isFile()) throw new Error("not a regular file");
				if (info.size > MAX_BYTES) throw new Error("file exceeds the 2 MiB reader limit");
				content = await readFile(path, "utf8");
				if (Buffer.byteLength(content) > MAX_BYTES) throw new Error("file exceeds the 2 MiB reader limit");
			} catch (error) {
				ctx.ui.notify(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`, "error");
				return;
			}

			await ctx.ui.custom<void>((tui, theme, _keys, done) => {
				let markdown = new Markdown(content || "*(Empty file)*", 1, 0, getMarkdownTheme());
				let offset = 0;
				let pageHeight = 1;
				let maxOffset = 0;

				return {
					// Explicit viewport slicing works in both regular and fullscreen overlays.
					render(width) {
						width = Math.max(1, width);
						const height = Math.max(1, Math.min(tui.terminal.rows - 2, Math.floor(tui.terminal.rows * 0.9)));
						const lines = markdown.render(width);
						pageHeight = Math.max(1, height - 3);
						maxOffset = Math.max(0, lines.length - pageHeight);
						offset = Math.min(offset, maxOffset);
						const body = lines.slice(offset, offset + pageHeight);
						const output = height < 4 ? body : [
							theme.fg("accent", theme.bold(` ${path}`)),
							theme.fg("border", "─".repeat(width)),
							...body,
							theme.fg("dim", ` ${offset + 1}–${Math.min(offset + pageHeight, lines.length)}/${lines.length} · ↑↓ scroll · PgUp/PgDn · Home/End · q/Esc close`),
						];
						return output.map((line) => truncateToWidth(line, width));
					},
					invalidate() {
						// Rebuild themed Markdown after a theme change, not just its render cache.
						markdown = new Markdown(content || "*(Empty file)*", 1, 0, getMarkdownTheme());
					},
					handleInput(data) {
						if (matchesKey(data, "escape") || matchesKey(data, "q")) {
							done();
							return;
						}
						if (matchesKey(data, "up") || matchesKey(data, "k")) offset--;
						else if (matchesKey(data, "down") || matchesKey(data, "j")) offset++;
						else if (matchesKey(data, "pageUp")) offset -= pageHeight;
						else if (matchesKey(data, "pageDown") || matchesKey(data, "space")) offset += pageHeight;
						else if (matchesKey(data, "home")) offset = 0;
						else if (matchesKey(data, "end")) offset = maxOffset;
						else return;
						offset = Math.max(0, Math.min(offset, maxOffset));
						tui.requestRender();
					},
				};
			}, {
				overlay: true,
				overlayOptions: { width: "90%", maxHeight: "90%", anchor: "center", margin: 1 },
			});
		},
	});
}
