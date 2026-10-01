import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import promptSaverExtension from "../extensions/index.ts";

test("interactive commands save, browse, load, and delete without a typed prompt name", async (t) => {
	const root = await mkdtemp(join(tmpdir(), "prompt-saver-test-"));
	const previousStore = process.env.PI_PROMPT_SAVER_FILE;
	process.env.PI_PROMPT_SAVER_FILE = join(root, "prompts.json");
	t.after(async () => {
		if (previousStore === undefined) delete process.env.PI_PROMPT_SAVER_FILE;
		else process.env.PI_PROMPT_SAVER_FILE = previousStore;
		await rm(root, { recursive: true, force: true });
	});

	const commands = new Map();
	let inputHandler;
	promptSaverExtension({
		on(event, handler) {
			if (event === "input") inputHandler = handler;
		},
		registerCommand(name, command) {
			commands.set(name, command);
		},
	});

	const notifications = [];
	const selections = [];
	let editorText = "";
	const ctx = {
		hasUI: true,
		sessionManager: { getBranch: () => [] },
		ui: {
			input: async (title, placeholder) => {
				assert.equal(title, "Save prompt");
				assert.equal(placeholder, "Prompt name");
				return "daily review";
			},
			select: async (title, options) => {
				selections.push({ title, options });
				return options[0];
			},
			confirm: async () => true,
			notify: (message, type) => notifications.push({ message, type }),
			setEditorText: (text) => { editorText = text; },
		},
	};

	await inputHandler({ source: "interactive", text: "Summarize the release risks", images: [] });
	await commands.get("save-prompt").handler("", ctx);
	const saved = JSON.parse(await readFile(process.env.PI_PROMPT_SAVER_FILE, "utf8"));
	assert.equal(saved.prompts["daily review"].text, "Summarize the release risks");

	await commands.get("prompts").handler("", ctx);
	assert.equal(selections[0].title, "Saved prompts");
	assert.deepEqual(selections[0].options, ["1. daily review  •  Summarize the release risks"]);
	assert.equal(editorText, "Summarize the release risks");

	editorText = "";
	await commands.get("load-prompt").handler("", ctx);
	assert.equal(selections[1].title, "Load saved prompt");
	assert.equal(editorText, "Summarize the release risks");

	await commands.get("delete-prompt").handler("", ctx);
	assert.equal(selections[2].title, "Delete saved prompt");
	const afterDelete = JSON.parse(await readFile(process.env.PI_PROMPT_SAVER_FILE, "utf8"));
	assert.deepEqual(afterDelete.prompts, {});
	assert.equal(notifications.at(-1).message, "Deleted saved prompt “daily review”.");
});
