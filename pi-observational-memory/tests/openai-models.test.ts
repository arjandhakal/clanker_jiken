import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { type ConfiguredThinkingLevel, loadConfig } from "../src/config.js";
import { buildWorkerArgv } from "../src/spawn/launch.js";

const STANDARD: ConfiguredThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
const STANDARD_WITH_MAX: ConfiguredThinkingLevel[] = [...STANDARD, "max"];

const SUPPORTED: Array<{
	provider: "openai" | "openai-codex";
	id: string;
	levels: ConfiguredThinkingLevel[];
}> = [
	{ provider: "openai-codex", id: "gpt-5.5", levels: STANDARD },
	{ provider: "openai-codex", id: "gpt-5.6-luna", levels: STANDARD_WITH_MAX },
	{ provider: "openai-codex", id: "gpt-5.6-sol", levels: STANDARD_WITH_MAX },
	{ provider: "openai-codex", id: "gpt-5.6-terra", levels: STANDARD_WITH_MAX },
	{ provider: "openai", id: "gpt-5.5", levels: ["off", "low", "medium", "high", "xhigh"] },
	{ provider: "openai", id: "gpt-5.5-pro", levels: ["medium", "high", "xhigh"] },
	{ provider: "openai", id: "gpt-5.6-luna", levels: ["off", "low", "medium", "high", "xhigh", "max"] },
	{ provider: "openai", id: "gpt-5.6-sol", levels: ["off", "low", "medium", "high", "xhigh", "max"] },
	{ provider: "openai", id: "gpt-5.6-terra", levels: ["off", "low", "medium", "high", "xhigh", "max"] },
];

describe("OpenAI GPT-5.5/5.6 worker configuration", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	for (const { provider, id, levels } of SUPPORTED) {
		for (const thinking of levels) {
			it(`accepts ${provider}/${id} at ${thinking} effort`, () => {
				const cwd = mkdtempSync(join(tmpdir(), "om-openai-"));
				dirs.push(cwd);
				mkdirSync(join(cwd, ".pi"));
				writeFileSync(
					join(cwd, ".pi", "settings.json"),
					JSON.stringify({
						"observational-memory": {
							models: {
								observer: { provider, id, thinking },
								consolidator: { provider, id, thinking },
							},
						},
					}),
				);

				const model = loadConfig(cwd, {}).models.observer;
				expect(model).toEqual({ provider, id, thinking });

				const argv = buildWorkerArgv({ model, sessionName: "test", kickoffPrompt: "test" });
				expect(argv[argv.indexOf("--model") + 1]).toBe(`${provider}/${id}`);
				expect(argv[argv.indexOf("--thinking") + 1]).toBe(thinking);
			});
		}
	}
});
