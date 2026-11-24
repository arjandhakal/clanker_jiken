import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import extension from "../extensions/index.ts";
import { guidanceFor, profileFor, SECTION } from "../lib/guidance.ts";

const astra = { provider: "openai", id: "gpt-6.2-astra" };

function setup(model = astra, hasUI = true) {
	const handlers = new Map();
	const commands = new Map();
	const entries = [];
	const notifications = [];
	const statuses = new Map();
	const pi = new Proxy({
		on: (name, handler) => handlers.set(name, handler),
		registerCommand: (name, command) => commands.set(name, command),
		appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }),
	}, {
		get(target, key) {
			assert.ok(key in target, `Unexpected extension API: ${String(key)}`);
			return target[key];
		},
	});
	extension(pi);
	const ctx = {
		model, hasUI,
		sessionManager: { getBranch: () => entries },
		ui: {
			setStatus: (key, value) => statuses.set(key, value),
			notify: (message, level) => notifications.push({ message, level }),
		},
	};
	const emit = (name, event = {}) => handlers.get(name)(event, ctx);
	const options = { cwd: process.cwd(), sections: { other_extension: "KEEP" }, selectedTools: ["read"] };
	const start = (systemPromptOptions = options) => {
		const event = { systemPrompt: "DO NOT REPLACE", systemPromptOptions };
		const result = emit("before_agent_start", event);
		assert.equal(result, undefined, "must not return a forced system prompt or persistent message");
		assert.equal(event.systemPrompt, "DO NOT REPLACE");
		return event.systemPromptOptions;
	};
	const command = (args = "") => commands.get("openai-guidance").handler(args, ctx);
	return { ctx, entries, notifications, statuses, emit, start, command, commands, handlers };
}

test("OpenAI identities and documented model families select the appropriate profile", () => {
	for (const [provider, id, expected] of [
		["openai", "gpt-6.2-astra", "gpt-6.2"],
		["openai-codex", "gpt-6.2-sol", "gpt-6.2"],
		["openai", "gpt-6.2-astra-2026-11-17", "gpt-6.2"],
		["openai-codex", "gpt-6.1-sol", "gpt-6"],
		["openai", "gpt-6-astra", "gpt-6"],
		["openrouter", "openai/gpt-6.2-astra", "gpt-6.2"],
		["gateway", "gpt-6.2-sol", "gpt-6.2"],
		["azure-openai", "my-deployment", "openai"],
		["openai", "gpt-5.4", "openai"],
		["gateway", "o3-mini", "openai"],
		["github-copilot", "gpt-4.1", "openai"],
		["openai", "gpt-6.3-astra", "openai"],
		["openai", "gpt-60", "openai"],
	]) assert.equal(profileFor({ provider, id }), expected, `${provider}/${id}`);
});

test("OpenAI-compatible transports and other model namespaces are not OpenAI identity", () => {
	assert.equal(profileFor(undefined), undefined);
	for (const [provider, id] of [
		["anthropic", "claude-sonnet-4-5"],
		["ollama", "qwen3"],
		["openrouter", "anthropic/claude-opus-4-5"],
		["gateway", "vendor/gpt-6.2-astra"],
		["gateway", "not-gpt-6.2-astra"],
	]) assert.equal(profileFor({ provider, id, api: "openai-completions" }), undefined);
});

test("guidance is deterministic, model-specific, and preserves permission boundaries", () => {
	for (const profile of ["openai", "gpt-6", "gpt-6.2"]) {
		const text = guidanceFor(profile);
		assert.equal(text, guidanceFor(profile));
		assert.match(text, /does not grant permissions/);
		assert.match(text, /delegation restrictions/);
		assert.match(text, /Never claim tests ran/);
		assert.doesNotMatch(text, /think step by step|functions\.run|request_user_input_async/);
	}
	assert.match(guidanceFor("gpt-6.2"), /already concise by default/);
	assert.doesNotMatch(guidanceFor("gpt-6"), /already concise by default/);
	assert.doesNotMatch(guidanceFor("openai"), /GPT-6.2 Astra/);
});

test("agent-start injection preserves other sections and never accumulates copies", () => {
	const app = setup();
	const first = structuredClone(app.start());
	assert.equal(first.sections[SECTION], guidanceFor("gpt-6.2"));
	assert.equal(first.sections.other_extension, "KEEP");
	assert.deepEqual(app.start(), first);
	assert.deepEqual(app.entries, []);
	assert.deepEqual(first.selectedTools, ["read"]);
});

test("model switching replaces and removes only the owned section on the next start", () => {
	const app = setup();
	app.start();
	app.ctx.model = { provider: "openai-codex", id: "gpt-6.1-sol" };
	app.emit("model_select");
	assert.equal(app.start().sections[SECTION], guidanceFor("gpt-6"));
	app.ctx.model = { provider: "anthropic", id: "claude-sonnet-4-5" };
	app.emit("model_select");
	assert.deepEqual(app.start().sections, { other_extension: "KEEP" });
	assert.equal(app.statuses.get("openai-guidance"), undefined);
	app.ctx.model = astra;
	assert.equal(app.start().sections[SECTION], guidanceFor("gpt-6.2"));
});

test("on/off restores on reload and follows the active branch rather than abandoned entries", async () => {
	const app = setup();
	await app.command("off");
	assert.equal(app.start().sections[SECTION], undefined);
	app.emit("session_start");
	assert.equal(app.start().sections[SECTION], undefined);
	await app.command("on");
	assert.equal(app.start().sections[SECTION], guidanceFor("gpt-6.2"));
	app.entries.pop(); // Navigate to the branch that only disabled guidance.
	app.emit("session_tree");
	assert.equal(app.start().sections[SECTION], undefined);
	app.entries.length = 0; // New branch/session defaults to enabled.
	app.emit("session_start");
	assert.equal(app.start().sections[SECTION], guidanceFor("gpt-6.2"));
});

test("malformed persisted state is ignored", () => {
	const app = setup();
	for (const data of [undefined, null, { enabled: "false" }]) {
		app.entries.push({ type: "custom", customType: "openai-guidance-state", data });
	}
	app.emit("session_start");
	assert.equal(app.start().sections[SECTION], guidanceFor("gpt-6.2"));
});

test("inspection commands expose only the extension guidance and sources", async () => {
	const app = setup();
	await app.command();
	assert.match(app.notifications.at(-1).message, /enabled \(gpt-6.2\)/);
	await app.command("show");
	assert.match(app.notifications.at(-1).message, /already concise by default/);
	assert.doesNotMatch(app.notifications.at(-1).message, /DO NOT REPLACE/);
	await app.command("sources");
	assert.match(app.notifications.at(-1).message, /https:\/\/developers\.openai\.com/);
	await app.command("bad input");
	assert.equal(app.notifications.at(-1).level, "warning");
	assert.deepEqual(app.entries, []);
	assert.deepEqual(app.commands.get("openai-guidance").getArgumentCompletions("of"), [{ value: "off", label: "off" }]);
});

test("headless agent runs still receive guidance without UI calls or extra stdout", async () => {
	const app = setup(astra, false);
	app.ctx.ui = new Proxy({}, { get() { throw new Error("Headless UI access"); } });
	app.emit("session_start");
	assert.equal(app.start().sections[SECTION], guidanceFor("gpt-6.2"));
	await app.command("off");
	assert.equal(app.start().sections[SECTION], undefined);
});

function piRoot() {
	if (process.env.PI_PACKAGE_ROOT) return process.env.PI_PACKAGE_ROOT;
	let root;
	try {
		root = dirname(realpathSync(execFileSync("sh", ["-c", "command -v pi"], { encoding: "utf8" }).trim()));
	} catch { return undefined; }
	while (true) {
		const manifest = join(root, "package.json");
		if (existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).name === "@earendil-works/pi-coding-agent") return root;
		if (root === parse(root).root) return undefined;
		root = dirname(root);
	}
}

test("real Pi loader, prompt renderer, section diffs, and Responses serialization", async (t) => {
	const root = piRoot();
	if (!root) return t.skip("Install Pi or set PI_PACKAGE_ROOT to run integration coverage.");
	const host = (relative) => import(pathToFileURL(join(root, relative)).href);
	const { loadExtensions } = await host("dist/core/extensions/loader.js");
	const { buildSystemPrompt, buildSystemPromptState, diffSystemPromptSections } = await host("dist/core/system-prompt.js");
	const { convertResponsesMessages } = await host("node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js");
	const loaded = await loadExtensions([fileURLToPath(new URL("../extensions/index.ts", import.meta.url))], process.cwd());
	assert.deepEqual(loaded.errors, []);
	assert.equal(loaded.extensions.length, 1);
	const ext = loaded.extensions[0];
	assert.ok(ext.commands.has("openai-guidance"));
	assert.equal(ext.tools.size, 0);
	assert.equal(ext.handlers.has("before_provider_request"), false);

	const app = setup();
	const options = { cwd: process.cwd(), customPrompt: "BASE INSTRUCTIONS", sections: { other: "KEEP" } };
	const invoke = ext.handlers.get("before_agent_start")[0];
	await invoke({ systemPromptOptions: options }, app.ctx);
	const initial = buildSystemPromptState(options);
	const text = buildSystemPrompt(options);
	assert.match(text, /^BASE INSTRUCTIONS/);
	assert.match(text, /<openai_model_guidance>/);
	assert.match(text, /<other>\nKEEP/);
	await invoke({ systemPromptOptions: options }, app.ctx);
	assert.equal(diffSystemPromptSections(initial.sections, buildSystemPromptState(options).sections), undefined);

	app.ctx.model = { provider: "openai-codex", id: "gpt-6.1-sol" };
	await invoke({ systemPromptOptions: options }, app.ctx);
	const patch = diffSystemPromptSections(initial.sections, buildSystemPromptState(options).sections);
	assert.deepEqual(Object.keys(patch), [SECTION]);
	const head = { role: "system", ...initial, timestamp: 0 };
	const messages = [head, { role: "user", content: "First request", timestamp: 1 }];
	const model = { ...astra, api: "openai-responses", reasoning: true, input: ["text"], compat: {} };
	const compat = { supportsMidConvoSystemMessages: true, supportsAdditionalTools: true };
	const before = convertResponsesMessages(model, { messages }, new Set(["openai"]), compat);
	const after = convertResponsesMessages(model, { messages: [...messages, { role: "system", content: "", sections: patch, timestamp: 2 }] }, new Set(["openai"]), compat);
	assert.deepEqual(after.slice(0, before.length), before, "an instruction update must retain the prior serialized prefix");
	assert.equal(before[0].role, "developer");
	assert.equal(after.at(-1).role, "developer");
	assert.deepEqual(messages[0], head, "historical messages must not be rewritten");

	app.ctx.model = { provider: "anthropic", id: "claude-sonnet-4-5" };
	await invoke({ systemPromptOptions: options }, app.ctx);
	const removal = diffSystemPromptSections(initial.sections, buildSystemPromptState(options).sections);
	assert.deepEqual(removal, { [SECTION]: null });
	assert.doesNotMatch(buildSystemPrompt(options), /openai_model_guidance/);
	assert.equal(buildSystemPrompt({ ...options, forceSystemPrompt: "EXACT OVERRIDE" }), "EXACT OVERRIDE");
});
