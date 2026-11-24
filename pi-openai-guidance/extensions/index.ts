import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { guidanceFor, profileFor, SECTION, SOURCES } from "../lib/guidance.ts";

const STATE = "openai-guidance-state";

export default function openaiGuidance(pi: ExtensionAPI) {
	let enabled = true;

	const updateStatus = (ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		const profile = enabled ? profileFor(ctx.model) : undefined;
		ctx.ui.setStatus("openai-guidance", profile ? `OpenAI guidance: ${profile}` : undefined);
	};

	const restore = (ctx: ExtensionContext) => {
		enabled = true;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== STATE) continue;
			const data = entry.data as { enabled?: unknown } | undefined;
			if (typeof data?.enabled === "boolean") enabled = data.enabled;
		}
		updateStatus(ctx);
	};

	pi.on("session_start", (_event, ctx) => restore(ctx));
	pi.on("session_tree", (_event, ctx) => restore(ctx));
	pi.on("model_select", (_event, ctx) => updateStatus(ctx));

	pi.on("before_agent_start", (event, ctx) => {
		const profile = enabled ? profileFor(ctx.model) : undefined;
		if (profile) {
			event.systemPromptOptions.sections[SECTION] = guidanceFor(profile);
		} else {
			// Remove only our own section when disabled or switching away from OpenAI.
			delete event.systemPromptOptions.sections[SECTION];
		}
		updateStatus(ctx);
	});

	pi.registerCommand("openai-guidance", {
		description: "OpenAI prompt guidance: status, on, off, show, sources (session/branch scoped)",
		getArgumentCompletions: (prefix) => {
			const items = ["status", "on", "off", "show", "sources"]
				.filter((value) => value.startsWith(prefix))
				.map((value) => ({ value, label: value }));
			return items.length ? items : null;
		},
		handler: async (args, ctx) => {
			const action = args.trim() || "status";
			if (action === "on" || action === "off") {
				enabled = action === "on";
				pi.appendEntry(STATE, { enabled });
				updateStatus(ctx);
			} else if (!["status", "show", "sources"].includes(action)) {
				if (ctx.hasUI) ctx.ui.notify("Usage: /openai-guidance [status|on|off|show|sources]", "warning");
				return;
			}

			const profile = profileFor(ctx.model);
			let message: string;
			if (action === "sources") {
				message = SOURCES.join("\n");
			} else if (action === "show") {
				message = profile
					? `${enabled ? "Enabled" : "Disabled"} — ${profile}\n\n${guidanceFor(profile)}`
					: "No OpenAI guidance profile matches the selected model.";
			} else {
				const model = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "no model";
				const state = !enabled ? "disabled" : profile ? `enabled (${profile})` : "inactive (not an identified OpenAI model)";
				message = `OpenAI guidance: ${state}\nModel: ${model}\nChanges apply at the next agent start. /openai-guidance show displays this extension's guidance only.`;
			}
			if (ctx.hasUI) ctx.ui.notify(message, "info");
		},
	});
}
