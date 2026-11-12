import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { createRequire, registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, parse } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";

// Reuse Pi's real renderer rather than installing a duplicate SDK or mocking it.
let root = process.env.PI_PACKAGE_ROOT;
if (!root) {
	root = dirname(realpathSync(execFileSync("sh", ["-c", "command -v pi"], { encoding: "utf8" }).trim()));
	while (true) {
		const manifest = join(root, "package.json");
		if (existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).name === "@earendil-works/pi-coding-agent") break;
		if (root === parse(root).root) throw new Error("Cannot locate Pi; set PI_PACKAGE_ROOT.");
		root = dirname(root);
	}
}
const requirePi = createRequire(join(root, "package.json"));
const hostModules = {
	"@earendil-works/pi-coding-agent": join(root, "dist/index.js"),
	"@earendil-works/pi-tui": requirePi.resolve("@earendil-works/pi-tui"),
};
registerHooks({
	resolve(specifier, context, nextResolve) {
		if (hostModules[specifier]) return { url: pathToFileURL(hostModules[specifier]).href, shortCircuit: true };
		return nextResolve(specifier, context);
	},
});
const { initTheme } = await import("@earendil-works/pi-coding-agent");
const { visibleWidth } = await import("@earendil-works/pi-tui");
const { default: reader } = await import("../extensions/index.ts");
initTheme("dark", false);

function setup(cwd, mode = "tui") {
	const commands = new Map();
	// Any attempt to register a tool, send a message, or append session data fails.
	reader(new Proxy({ registerCommand: (name, command) => commands.set(name, command) }, {
		get(target, key) {
			assert.ok(key in target, `Unexpected model/session API access: ${String(key)}`);
			return target[key];
		},
	}));
	assert.deepEqual([...commands.keys()], ["md"]);
	let viewer;
	let options;
	let closed = 0;
	let renders = 0;
	const notifications = [];
	const tui = { terminal: { rows: 24 }, requestRender: () => renders++ };
	const ctx = {
		cwd, mode,
		ui: {
			notify: (message, level) => notifications.push({ message, level }),
			custom: async (factory, opts) => {
				options = opts;
				viewer = factory(tui, { fg: (_color, text) => text, bold: (text) => text }, {}, () => closed++);
			},
		},
	};
	return {
		open: (args = "") => commands.get("md").handler(args, ctx),
		get viewer() { return viewer; },
		get options() { return options; },
		get closed() { return closed; },
		get renders() { return renders; },
		notifications, tui,
	};
}

async function fixture(t) {
	const dir = await mkdtemp(join(tmpdir(), "pi-markdown-reader-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	return dir;
}

function plain(viewer, width = 100) {
	return viewer.render(width).map(stripVTControlCharacters).join("\n");
}

test("default README is rendered only in the overlay", async (t) => {
	const dir = await fixture(t);
	await writeFile(join(dir, "README.md"), "# Private heading\n\n- a list item\n\n```js\nconst secret = 42;\n```\n");
	const app = setup(dir);
	await app.open();
	assert.deepEqual(app.notifications, []);
	assert.equal(app.options.overlay, true);
	const output = plain(app.viewer);
	assert.match(output, /Private heading/);
	assert.match(output, /a list item/);
	assert.match(output, /const secret = 42/);
	assert.doesNotMatch(output, /# Private heading/);
	app.viewer.handleInput("q");
	assert.equal(app.closed, 1);
});

test("paths support spaces, quotes, absolute paths, home paths, and symlinks", async (t) => {
	const dir = await fixture(t);
	const file = join(dir, "design notes.md");
	await writeFile(file, "# Design notes");
	await symlink(file, join(dir, "linked.md"));
	for (const path of ["design notes.md", '"design notes.md"', "'design notes.md'", file, "linked.md"]) {
		const app = setup(dir);
		await app.open(path);
		assert.match(plain(app.viewer), /Design notes/);
	}
	// Fixture is normally under /tmp; make a home-relative alias when supported.
	const homeApp = setup(dir);
	await homeApp.open("~/a-pi-markdown-reader-file-that-does-not-exist.md");
	assert.match(homeApp.notifications[0].message, /Cannot read/);
	assert.doesNotMatch(homeApp.notifications[0].message, /~\//);
});

test("arrows, pages, Home/End, and Escape work; resizing clamps scrolling", async (t) => {
	const dir = await fixture(t);
	await writeFile(join(dir, "README.md"), Array.from({ length: 150 }, (_, n) => `paragraph-${String(n).padStart(3, "0")}\n`).join("\n"));
	const app = setup(dir);
	await app.open();
	const initial = plain(app.viewer);
	assert.match(initial, /paragraph-000/);
	app.viewer.handleInput("\x1b[B");
	assert.notEqual(plain(app.viewer), initial);
	app.viewer.handleInput("\x1b[A");
	assert.equal(plain(app.viewer), initial);
	app.viewer.handleInput("\x1b[6~");
	assert.doesNotMatch(plain(app.viewer), /paragraph-000/);
	app.viewer.handleInput("\x1b[5~");
	assert.equal(plain(app.viewer), initial);
	app.viewer.handleInput("\x1b[F");
	assert.match(plain(app.viewer), /paragraph-149/);
	app.tui.terminal.rows = 16;
	assert.ok(app.viewer.render(32).length <= 14);
	app.viewer.handleInput("\x1b[H");
	assert.match(plain(app.viewer), /paragraph-000/);
	app.viewer.handleInput("\x1b");
	assert.equal(app.closed, 1);
	assert.ok(app.renders >= 6);
});

test("wide characters, code and tables fit narrow terminals; themes can invalidate", async (t) => {
	const dir = await fixture(t);
	await writeFile(join(dir, "README.md"), "# 日本語 😀\n\n| Heading | Value |\n| --- | --- |\n| 日本語 | 😀 |\n\n```text\n" + "very long code ".repeat(20) + "\n```\n");
	const app = setup(dir);
	await app.open();
	for (const rows of [3, 8, 24, 50]) {
		app.tui.terminal.rows = rows;
		for (const width of [1, 8, 20, 80]) {
			const lines = app.viewer.render(width);
			assert.ok(lines.length <= Math.max(1, Math.min(rows - 2, Math.floor(rows * 0.9))));
			assert.ok(lines.every((line) => visibleWidth(line) <= width));
		}
	}
	initTheme("light", false);
	app.viewer.invalidate();
	assert.match(plain(app.viewer), /日本語/);
	initTheme("dark", false);
});

test("missing files, directories, bad quotes and oversized files are UI errors", async (t) => {
	const dir = await fixture(t);
	await writeFile(join(dir, "large.md"), "x".repeat(2 * 1024 * 1024 + 1));
	for (const path of ["missing.md", ".", '"unclosed.md', "large.md"]) {
		const app = setup(dir);
		await app.open(path);
		assert.equal(app.viewer, undefined);
		assert.equal(app.notifications.length, 1);
		assert.equal(app.notifications[0].level, "error");
	}
});

test("empty files have a readable placeholder", async (t) => {
	const dir = await fixture(t);
	await writeFile(join(dir, "README.md"), "");
	const app = setup(dir);
	await app.open();
	assert.match(plain(app.viewer), /Empty file/);
});

test("Pi's extension loader discovers the command without registering any tools", async () => {
	const { loadExtensions } = await import(pathToFileURL(join(root, "dist/core/extensions/loader.js")));
	const entry = fileURLToPath(new URL("../extensions/index.ts", import.meta.url));
	const result = await loadExtensions([entry], process.cwd());
	assert.deepEqual(result.errors, []);
	assert.equal(result.extensions.length, 1);
	assert.ok(result.extensions[0].commands.has("md"));
	assert.equal(result.extensions[0].tools.size, 0);
});

test("non-TUI modes never read or display file contents", async () => {
	for (const mode of ["rpc", "json", "print"]) {
		const app = setup("/does-not-exist", mode);
		await app.open("secret.md");
		assert.equal(app.viewer, undefined);
		assert.deepEqual(app.notifications, [{ message: "/md requires Pi's interactive terminal UI.", level: "warning" }]);
	}
});
