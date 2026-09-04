import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSettingsListTheme } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Container, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { CHILD_ENV } from "./constants.js";
import { syncFindingsToHunk } from "./hunk.js";
import { createRunId } from "./ids.js";
import { reconcileSelection, validateFindingIds } from "./selection.js";
import { readDraft, readHandoff, readManifest, readSelection, runPathsFromDir, writeJsonAtomic } from "./store.js";
import { SCHEMA_VERSION, type ReviewDraft, type ReviewHandoff, type ReviewSelection, type ReviewStatus } from "./types.js";

const CHILD_WIDGET = "review-room-child";

const Finding = Type.Object({
  id: Type.String({ description: "Stable ID, normally R1, R2, ..." }),
  title: Type.String({ description: "One-sentence actionable title" }),
  severity: StringEnum(["blocker", "high", "medium", "low", "nit"] as const),
  confidence: StringEnum(["high", "medium", "low"] as const),
  evidence: Type.String({ description: "Concrete failure mode and evidence" }),
  recommendation: Type.String({ description: "Specific recommended action" }),
  file: Type.Optional(Type.String({ description: "Repo-relative file path" })),
  line: Type.Optional(Type.Integer({ minimum: 1, description: "1-based source-file line on the selected old/new side (not a patch-file line)" })),
  side: Type.Optional(StringEnum(["new", "old"] as const)),
});

const Publish = Type.Object({
  summary: Type.Optional(Type.String()),
  findings: Type.Array(Finding),
});

function findingLabel(finding: ReviewDraft["findings"][number]): string {
  const location = finding.file ? ` · ${finding.file}${finding.line ? `:${finding.line}` : ""}` : "";
  return `${finding.id} [${finding.severity}] ${finding.title}${location}`;
}

export default async function reviewRoomChild(pi: ExtensionAPI): Promise<void> {
  const manifestPath = process.env[CHILD_ENV];
  if (!manifestPath) return;
  const manifest = await readManifest(manifestPath);
  if (!manifest) throw new Error(`Review manifest unavailable: ${manifestPath}`);
  const paths = runPathsFromDir(dirname(manifestPath));
  let chromeTimer: NodeJS.Timeout | undefined;

  const setStatus = async (state: ReviewStatus["state"], message?: string) => {
    await writeJsonAtomic(paths.status, { schemaVersion: SCHEMA_VERSION, runId: manifest.runId, state, updatedAt: new Date().toISOString(), message } satisfies ReviewStatus);
  };

  const updateChrome = async (ctx: ExtensionContext): Promise<void> => {
    const [draft, selection, handoff] = await Promise.all([
      readDraft(paths.draft),
      readSelection(paths.selection),
      readHandoff(paths.handoff),
    ]);
    if (!draft) {
      ctx.ui.setWidget(CHILD_WIDGET, ["Reviewing patch · no draft published yet"], { placement: "belowEditor" });
      return;
    }
    const selected = reconcileSelection(draft, selection);
    const noteCount = selection?.draftRevision === draft.revision ? Object.keys(selection.notes ?? {}).length : 0;
    const pending = handoff?.draftRevision === draft.revision && !handoff.deliveredAt;
    ctx.ui.setWidget(CHILD_WIDGET, [
      `Draft r${draft.revision} · ${draft.findings.length} candidate(s) · ${selected.size} accepted · ${noteCount} handling note(s)${pending ? " · sending…" : ""}`,
      "/review-curate · /review-note [R1] · /review-send",
    ], { placement: "belowEditor" });
  };

  const saveSelection = async (
    draft: ReviewDraft,
    selectedIds: Iterable<string>,
    previous?: ReviewSelection,
    notes = previous?.notes ?? {},
  ): Promise<ReviewSelection> => {
    const selection: ReviewSelection = {
      schemaVersion: SCHEMA_VERSION,
      runId: manifest.runId,
      draftRevision: draft.revision,
      selectedIds: [...selectedIds],
      notes,
      updatedAt: new Date().toISOString(),
      sentIds: previous?.draftRevision === draft.revision ? previous.sentIds : undefined,
      sentAt: previous?.draftRevision === draft.revision ? previous.sentAt : undefined,
    };
    await writeJsonAtomic(paths.selection, selection);
    return selection;
  };

  pi.registerTool({
    name: "review_publish",
    label: "Publish Review Draft",
    description: "Replace the shared draft inbox with the complete current set of candidate review findings. This does not send findings to the parent model.",
    promptSnippet: "Publish or revise the complete candidate review finding set",
    promptGuidelines: [
      "Use review_publish after the initial review and after any user-requested revision; always send the complete current candidate set and retain stable IDs.",
      "review_publish updates a draft inbox only. Never state that findings reached the parent agent.",
    ],
    parameters: Publish,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const error = validateFindingIds(params.findings);
      if (error) throw new Error(error);
      const previous = await readDraft(paths.draft);
      const draft: ReviewDraft = {
        schemaVersion: SCHEMA_VERSION,
        runId: manifest.runId,
        revision: (previous?.revision ?? 0) + 1,
        publishedAt: new Date().toISOString(),
        summary: params.summary,
        findings: params.findings,
      };
      await writeJsonAtomic(paths.draft, draft);
      await saveSelection(draft, [], undefined, {});
      const hunk = manifest.hunkSync
        ? await syncFindingsToHunk(manifest.cwd, manifest.runId, draft.findings)
        : "Hunk synchronization disabled; draft saved.";
      await updateChrome(ctx);
      return {
        content: [{ type: "text", text: `${hunk}\nRemain available for discussion. The user can now run /review-curate, add handling notes with /review-note R1, and use /review-send from this reviewer pane.` }],
        details: { revision: draft.revision, count: draft.findings.length, hunk },
      };
    },
    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("review_publish")), 0, 0);
    },
    renderResult(result, _options, theme) {
      const details = result.details as { revision?: number; count?: number } | undefined;
      return new Text(theme.fg("success", `Draft r${details?.revision ?? "?"}: ${details?.count ?? 0} candidate(s)`), 0, 0);
    },
  });

  pi.registerCommand("review-curate", {
    description: "Choose which findings should be sent to the parent session",
    handler: async (_args, ctx) => {
      const draft = await readDraft(paths.draft);
      if (!draft) {
        ctx.ui.notify("Publish a review draft before curating it.", "warning");
        return;
      }
      if (draft.findings.length === 0) {
        ctx.ui.notify("This draft is a clean review with no candidate findings.", "info");
        return;
      }
      const previous = await readSelection(paths.selection);
      const selected = reconcileSelection(draft, previous);
      const notes = previous?.draftRevision === draft.revision ? previous.notes ?? {} : {};
      await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
        const items: SettingItem[] = draft.findings.map((finding) => ({
          id: finding.id,
          label: findingLabel(finding),
          description: `Confidence: ${finding.confidence}\n${finding.evidence}\nRecommended action: ${finding.recommendation}${notes[finding.id] ? `\nYour handling note: ${notes[finding.id]}` : ""}`,
          currentValue: selected.has(finding.id) ? "accept" : "skip",
          values: ["skip", "accept"],
        }));
        const container = new Container();
        container.addChild(new Text(theme.fg("accent", theme.bold(`Curate draft r${draft.revision}`)), 1, 1));
        const settings = new SettingsList(
          items,
          Math.min(Math.max(items.length + 2, 5), 18),
          getSettingsListTheme(),
          (id, value) => value === "accept" ? selected.add(id) : selected.delete(id),
          () => done(undefined),
          { enableSearch: true },
        );
        container.addChild(settings);
        container.addChild(new Text(theme.fg("dim", "Enter/Space toggles · Esc saves · add instructions afterward with /review-note R1"), 1, 1));
        return {
          render: (width: number) => container.render(width),
          invalidate: () => container.invalidate(),
          handleInput: (data: string) => { settings.handleInput?.(data); tui.requestRender(); },
        };
      });
      await saveSelection(draft, selected, previous, notes);
      await updateChrome(ctx);
      ctx.ui.notify(`Saved ${selected.size} accepted finding(s). Add optional instructions with /review-note R1, then run /review-send here.`, "info");
    },
  });

  pi.registerCommand("review-note", {
    description: "Add your own handling instructions to a review finding",
    handler: async (args, ctx) => {
      const draft = await readDraft(paths.draft);
      if (!draft || draft.findings.length === 0) {
        ctx.ui.notify("There are no published findings to annotate.", "warning");
        return;
      }
      const requested = args.trim().split(/\s+/, 1)[0];
      let finding = requested
        ? draft.findings.find((candidate) => candidate.id.toLowerCase() === requested.toLowerCase())
        : undefined;
      if (requested && !finding) {
        ctx.ui.notify(`Finding ${requested} does not exist in draft r${draft.revision}.`, "error");
        return;
      }
      if (!finding) {
        const labels = draft.findings.map(findingLabel);
        const picked = await ctx.ui.select("Add handling note to finding", labels);
        const index = picked ? labels.indexOf(picked) : -1;
        if (index < 0) return;
        finding = draft.findings[index];
      }
      const previous = await readSelection(paths.selection);
      const selected = reconcileSelection(draft, previous);
      const notes = previous?.draftRevision === draft.revision ? { ...(previous.notes ?? {}) } : {};
      const note = await ctx.ui.editor(`How should the parent tackle ${finding.id}?`, notes[finding.id] ?? "");
      if (note === undefined) return;
      if (note.trim()) notes[finding.id] = note.trim();
      else delete notes[finding.id];
      await saveSelection(draft, selected, previous, notes);
      await updateChrome(ctx);
      ctx.ui.notify(note.trim() ? `Saved handling note for ${finding.id}.` : `Removed handling note from ${finding.id}.`, "info");
    },
  });

  pi.registerCommand("review-send", {
    description: "Send accepted findings and handling notes to the parent session",
    handler: async (_args, ctx) => {
      const [draft, selection, currentHandoff] = await Promise.all([
        readDraft(paths.draft),
        readSelection(paths.selection),
        readHandoff(paths.handoff),
      ]);
      if (!draft) {
        ctx.ui.notify("The reviewer has not published a draft yet.", "warning");
        return;
      }
      if (!selection || selection.draftRevision !== draft.revision) {
        ctx.ui.notify("Run /review-curate for the current draft before sending.", "warning");
        return;
      }
      if (currentHandoff && !currentHandoff.deliveredAt) {
        ctx.ui.notify("The previous handoff is still waiting for the parent pane.", "warning");
        return;
      }
      const selected = reconcileSelection(draft, selection);
      const deliveredByHandoff = currentHandoff?.deliveredAt && currentHandoff.draftRevision === draft.revision
        ? currentHandoff.selectedIds
        : [];
      const sent = new Set([...(selection.sentIds ?? []), ...deliveredByHandoff]);
      const pending = [...selected].filter((id) => !sent.has(id));
      if (pending.length === 0) {
        ctx.ui.notify(selected.size === 0 ? "No findings are accepted." : "Every accepted finding in this draft was already sent.", "warning");
        return;
      }
      const withNotes = pending.filter((id) => selection.notes?.[id]?.trim()).length;
      const confirmed = await ctx.ui.confirm(
        "Send review to parent?",
        `${pending.length} finding(s)${withNotes ? ` with ${withNotes} handling note(s)` : ""} will enter the parent model context. The parent agent will start a follow-up turn.`,
      );
      if (!confirmed) return;
      const notes = Object.fromEntries(
        pending.flatMap((id) => selection.notes?.[id]?.trim() ? [[id, selection.notes[id].trim()]] : []),
      );
      const handoff: ReviewHandoff = {
        schemaVersion: SCHEMA_VERSION,
        handoffId: createRunId(),
        runId: manifest.runId,
        draftRevision: draft.revision,
        selectedIds: pending,
        findings: draft.findings.filter((finding) => pending.includes(finding.id)),
        notes,
        createdAt: new Date().toISOString(),
      };
      await writeJsonAtomic(paths.handoff, handoff);
      await setStatus("active", "handoff pending");
      await updateChrome(ctx);
      ctx.ui.notify("Review queued for the parent. Returning to the parent pane…", "info");
      await pi.exec("herdr", ["agent", "focus", manifest.parentPaneId], { timeout: 5_000 }).catch(() => undefined);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    pi.setActiveTools(["read", "grep", "find", "ls", "review_publish"]);
    ctx.ui.setStatus(CHILD_WIDGET, ctx.ui.theme.fg("accent", `review room ${manifest.runId}`));
    ctx.ui.setTitle(`Review ${manifest.runId.slice(-13)}`);
    await setStatus("active");
    await updateChrome(ctx);
    if (chromeTimer) clearInterval(chromeTimer);
    chromeTimer = setInterval(() => void updateChrome(ctx).catch(() => undefined), 1_000);
    chromeTimer.unref?.();
  });

  pi.on("before_agent_start", (event) => ({
    systemPrompt: `${event.systemPrompt}\n\nYou are running inside an interactive Review Room. You are an independent, read-only reviewer. Never edit files, spawn agents, or attempt to message the parent session. Candidate findings become visible outside this pane only through review_publish. Publishing is not final delivery: the user must explicitly curate and send from this reviewer pane. Stay available for dialogue after publishing.`,
  }));

  pi.on("session_shutdown", async () => {
    if (chromeTimer) clearInterval(chromeTimer);
    chromeTimer = undefined;
    await setStatus("closed");
  });
}
