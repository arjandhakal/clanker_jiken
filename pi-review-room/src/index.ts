import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir, SessionManager } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { CHILD_ENV, ENTRY_DRAFT, ENTRY_RUN, ENTRY_SELECTION, MESSAGE_HANDOFF, WIDGET_KEY } from "./constants.js";
import { createPatch, type GitExec } from "./git.js";
import { closeHerdrPane, findAgentPane, focusHerdrAgent, launchHerdrAgent, type Exec } from "./herdr.js";
import { createRunId, resolvePrefix } from "./ids.js";
import { buildChildArgv } from "./process.js";
import { buildReviewPrompt, formatHandoff, TARGET_LABELS } from "./prompt.js";
import { reconcileSelection } from "./selection.js";
import { listManifests, readDraft, readHandoff, readSelection, readStatus, runPaths, writeJsonAtomic } from "./store.js";
import { SCHEMA_VERSION, type ReviewDraft, type ReviewManifest, type ReviewTarget } from "./types.js";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHILD_EXTENSION = join(PACKAGE_ROOT, "src", "child.ts");
const REVIEW_ROOT = join(getAgentDir(), "review-room");
const TARGET_OPTIONS: Array<{ target: ReviewTarget; label: string }> = [
  { target: "all", label: TARGET_LABELS.all },
  { target: "working", label: TARGET_LABELS.working },
  { target: "staged", label: TARGET_LABELS.staged },
  { target: "branch", label: TARGET_LABELS.branch },
];

function shortId(id: string): string {
  return id.slice(-13);
}

function modelKey(model: { provider: string; id: string }): string {
  return `${model.provider}/${model.id}`;
}

function commandExec(pi: ExtensionAPI): Exec {
  return async (command, args) => {
    const result = await pi.exec(command, args, { timeout: 15_000 });
    return { code: result.code, stdout: result.stdout, stderr: result.stderr };
  };
}

function gitExec(pi: ExtensionAPI): GitExec {
  return async (cwd, args) => {
    const result = await pi.exec("git", args, { cwd, timeout: 30_000 });
    return { code: result.code, stdout: result.stdout, stderr: result.stderr };
  };
}

async function chooseManifest(
  ctx: ExtensionCommandContext,
  parentSessionId: string,
  prefix: string,
): Promise<ReviewManifest | undefined> {
  const manifests = await listManifests(REVIEW_ROOT, parentSessionId);
  if (manifests.length === 0) {
    ctx.ui.notify("No review rooms belong to this Pi session.", "warning");
    return undefined;
  }
  if (prefix.trim()) {
    const match = resolvePrefix(manifests, prefix.trim());
    if (!match) ctx.ui.notify(`No unique review room matches ${prefix.trim()}.`, "error");
    return match;
  }
  if (manifests.length === 1) return manifests[0];
  const labels = manifests.map((manifest) => `${shortId(manifest.runId)}  ${manifest.model}  ${manifest.targetLabel}`);
  const selected = await ctx.ui.select("Review room", labels);
  const index = selected ? labels.indexOf(selected) : -1;
  return index >= 0 ? manifests[index] : undefined;
}

function sessionId(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionId();
}

export default function reviewRoom(pi: ExtensionAPI): void {
  let activeSessionId: string | undefined;
  let timer: NodeJS.Timeout | undefined;
  let revisionByRun = new Map<string, number>();
  let currentCtx: ExtensionContext | undefined;
  const deliveringHandoffs = new Set<string>();
  const notifiedHandoffErrors = new Set<string>();

  async function refreshWidget(ctx: ExtensionContext, announce: boolean): Promise<void> {
    const id = sessionId(ctx);
    const manifests = await listManifests(REVIEW_ROOT, id);
    const lines: string[] = [];
    for (const [index, manifest] of manifests.entries()) {
      const paths = runPaths(REVIEW_ROOT, id, manifest.runId);
      const [draft, selection, handoff, status] = await Promise.all([
        readDraft(paths.draft),
        readSelection(paths.selection),
        readHandoff(paths.handoff),
        readStatus(paths.status),
      ]);
      const previous = revisionByRun.get(manifest.runId) ?? 0;
      if (draft && draft.revision > previous) {
        revisionByRun.set(manifest.runId, draft.revision);
        if (announce) {
          pi.appendEntry(ENTRY_DRAFT, { runId: manifest.runId, revision: draft.revision, count: draft.findings.length });
          ctx.ui.notify(`Review ${shortId(manifest.runId)} published draft r${draft.revision} with ${draft.findings.length} candidate(s).`, "info");
        }
      }
      if (handoff && !handoff.deliveredAt && !deliveringHandoffs.has(handoff.handoffId)) {
        deliveringHandoffs.add(handoff.handoffId);
        try {
          const handoffDraft: ReviewDraft = {
            schemaVersion: SCHEMA_VERSION,
            runId: manifest.runId,
            revision: handoff.draftRevision,
            publishedAt: handoff.createdAt,
            findings: handoff.findings,
          };
          const content = formatHandoff(manifest, handoffDraft, handoff.selectedIds, handoff.notes);
          pi.sendMessage(
            { customType: MESSAGE_HANDOFF, content, display: true, details: { runId: manifest.runId, revision: handoff.draftRevision, selectedIds: handoff.selectedIds, handoffId: handoff.handoffId } },
            { deliverAs: "followUp", triggerTurn: true },
          );
          const deliveredAt = new Date().toISOString();
          await writeJsonAtomic(paths.handoff, { ...handoff, deliveredAt });
          const latestSelection = await readSelection(paths.selection);
          if (latestSelection?.draftRevision === handoff.draftRevision) {
            await writeJsonAtomic(paths.selection, {
              ...latestSelection,
              sentIds: [...new Set([...(latestSelection.sentIds ?? []), ...handoff.selectedIds])],
              sentAt: deliveredAt,
              updatedAt: deliveredAt,
            });
          }
          pi.appendEntry(ENTRY_SELECTION, { runId: manifest.runId, revision: handoff.draftRevision, selectedIds: handoff.selectedIds, sentAt: deliveredAt });
          notifiedHandoffErrors.delete(handoff.handoffId);
          ctx.ui.notify(`Review ${shortId(manifest.runId)} sent ${handoff.selectedIds.length} curated finding(s).`, "info");
        } catch (error) {
          if (!notifiedHandoffErrors.has(handoff.handoffId)) {
            notifiedHandoffErrors.add(handoff.handoffId);
            ctx.ui.notify(`Could not deliver review ${shortId(manifest.runId)}: ${error instanceof Error ? error.message : String(error)}. Retrying…`, "error");
          }
        } finally {
          deliveringHandoffs.delete(handoff.handoffId);
        }
      }
      const selected = draft ? reconcileSelection(draft, selection).size : 0;
      const state = status?.state ?? "starting";
      const pending = handoff && !handoff.deliveredAt ? " · handoff pending" : "";
      if (index < 3) {
        lines.push(`Review ${shortId(manifest.runId)} · ${state} · ${draft ? `r${draft.revision}, ${draft.findings.length} candidate(s), ${selected} accepted${pending}` : "waiting for draft"}`);
      }
    }
    if (lines.length > 0) {
      lines.push("Curate and send from the reviewer pane · /review-focus · /review-close");
      ctx.ui.setWidget(WIDGET_KEY, lines, { placement: "belowEditor" });
      ctx.ui.setStatus(WIDGET_KEY, ctx.ui.theme.fg("accent", `${manifests.length} review room${manifests.length === 1 ? "" : "s"}`));
    } else {
      ctx.ui.setWidget(WIDGET_KEY, undefined);
      ctx.ui.setStatus(WIDGET_KEY, undefined);
    }
  }

  function stopWatcher(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
    currentCtx = undefined;
  }

  async function startWatcher(ctx: ExtensionContext): Promise<void> {
    stopWatcher();
    currentCtx = ctx;
    activeSessionId = sessionId(ctx);
    revisionByRun = new Map();
    const manifests = await listManifests(REVIEW_ROOT, activeSessionId);
    for (const manifest of manifests) {
      const draft = await readDraft(runPaths(REVIEW_ROOT, activeSessionId, manifest.runId).draft);
      if (draft) revisionByRun.set(manifest.runId, draft.revision);
    }
    await refreshWidget(ctx, false);
    timer = setInterval(() => {
      if (currentCtx && sessionId(currentCtx) === activeSessionId) {
        void refreshWidget(currentCtx, true).catch(() => undefined);
      }
    }, 1000);
    timer.unref?.();
  }

  pi.on("session_start", async (_event, ctx) => {
    if (ctx.mode === "tui") await startWatcher(ctx);
  });

  pi.on("session_shutdown", () => {
    stopWatcher();
  });

  pi.registerCommand("review-start", {
    description: "Start an independent interactive reviewer in a Herdr pane",
    handler: async (args, ctx) => {
      if (ctx.mode !== "tui") {
        ctx.ui.notify("/review-start requires Pi TUI mode.", "error");
        return;
      }
      const parentPaneId = process.env.HERDR_PANE_ID;
      if (process.env.HERDR_ENV !== "1" || !parentPaneId) {
        ctx.ui.notify("Review Room must be started from a Pi pane inside Herdr (HERDR_PANE_ID is absent).", "error");
        return;
      }
      const parentSessionFile = ctx.sessionManager.getSessionFile();
      if (!parentSessionFile) {
        ctx.ui.notify("Review Room requires a persistent parent Pi session.", "error");
        return;
      }

      const targetLabel = await ctx.ui.select("Review target", TARGET_OPTIONS.map((item) => item.label));
      const target = TARGET_OPTIONS.find((item) => item.label === targetLabel)?.target;
      if (!target) return;

      const scoped = ctx.scopedModels.length > 0
        ? ctx.scopedModels.map((entry) => ({ model: entry.model, thinking: entry.thinkingLevel }))
        : ctx.modelRegistry.getAvailable().map((model) => ({ model, thinking: undefined }));
      if (scoped.length === 0) {
        ctx.ui.notify("No authenticated reviewer models are available.", "error");
        return;
      }
      scoped.sort((a, b) => modelKey(a.model).localeCompare(modelKey(b.model)));
      const currentKey = ctx.model ? modelKey(ctx.model) : undefined;
      if (currentKey) scoped.sort((a, b) => Number(modelKey(b.model) === currentKey) - Number(modelKey(a.model) === currentKey));
      const modelLabels = scoped.map(({ model }) => `${modelKey(model)} — ${model.name}`);
      const pickedModelLabel = await ctx.ui.select("Reviewer model", modelLabels);
      const modelIndex = pickedModelLabel ? modelLabels.indexOf(pickedModelLabel) : -1;
      if (modelIndex < 0) return;
      const picked = scoped[modelIndex];

      let thinking = picked.thinking;
      if (!thinking && picked.model.reasoning) {
        const chosenThinking = await ctx.ui.select("Reviewer thinking", ["high", "medium", "low", "minimal", "off"]);
        if (!chosenThinking) return;
        thinking = chosenThinking as typeof picked.thinking;
      }

      ctx.ui.notify("Preparing an immutable patch snapshot…", "info");
      let snapshot;
      try {
        snapshot = await createPatch(gitExec(pi), ctx.cwd, target);
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
        return;
      }
      if (!snapshot.patch.trim()) {
        ctx.ui.notify("The selected review target has no changes.", "warning");
        return;
      }

      const runId = createRunId();
      const paths = runPaths(REVIEW_ROOT, sessionId(ctx), runId);
      const childSessions = join(paths.dir, "session");
      const childManager = SessionManager.create(snapshot.root, childSessions, { parentSession: parentSessionFile });
      const childSessionFile = childManager.getSessionFile();
      if (!childSessionFile) {
        ctx.ui.notify("Could not create the reviewer session.", "error");
        return;
      }
      const agentName = `review-${runId.slice(-6)}`;
      const manifest: ReviewManifest = {
        schemaVersion: SCHEMA_VERSION,
        runId,
        createdAt: new Date().toISOString(),
        cwd: snapshot.root,
        parentSessionId: sessionId(ctx),
        parentSessionFile,
        parentPaneId,
        childSessionFile,
        agentName,
        model: modelKey(picked.model),
        thinking,
        target,
        targetLabel: `${TARGET_LABELS[target]}${snapshot.labelSuffix ?? ""}`,
        patchFile: paths.patch,
        brief: args.trim() || undefined,
        hunkSync: true,
      };
      await writeFile(paths.patch, snapshot.patch, { encoding: "utf8", mode: 0o600 });
      await writeJsonAtomic(paths.manifest, manifest);
      const child = buildChildArgv({
        childExtension: CHILD_EXTENSION,
        childSessionFile,
        model: manifest.model,
        thinking,
        sessionName: `Review ${shortId(runId)}`,
        prompt: buildReviewPrompt(manifest),
      });
      try {
        manifest.childPaneId = await launchHerdrAgent(commandExec(pi), {
          agentName,
          cwd: snapshot.root,
          env: { [CHILD_ENV]: paths.manifest },
          command: child.command,
          args: child.args,
          focus: true,
        });
        await writeJsonAtomic(paths.manifest, manifest);
      } catch (error) {
        await writeJsonAtomic(paths.status, { schemaVersion: SCHEMA_VERSION, runId, state: "error", updatedAt: new Date().toISOString(), message: error instanceof Error ? error.message : String(error) });
        ctx.ui.notify(`Could not start reviewer: ${error instanceof Error ? error.message : String(error)}`, "error");
        return;
      }
      pi.appendEntry(ENTRY_RUN, { runId, manifestPath: paths.manifest });
      revisionByRun.set(runId, 0);
      await refreshWidget(ctx, false);
    },
  });

  pi.registerCommand("review-focus", {
    description: "Focus an interactive reviewer pane",
    handler: async (args, ctx) => {
      const manifest = await chooseManifest(ctx, sessionId(ctx), args);
      if (!manifest) return;
      try {
        await focusHerdrAgent(commandExec(pi), manifest.childPaneId ?? manifest.agentName);
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerCommand("review-resume", {
    description: "Resume a closed reviewer session in a new Herdr pane",
    handler: async (args, ctx) => {
      const manifest = await chooseManifest(ctx, sessionId(ctx), args);
      if (!manifest) return;
      const exec = commandExec(pi);
      const listed = await exec("herdr", ["agent", "list"]);
      const existingPane = listed.code === 0
        ? findAgentPane(listed.stdout, manifest.childPaneId ?? manifest.agentName)
        : undefined;
      if (existingPane) {
        await focusHerdrAgent(exec, existingPane);
        return;
      }
      const child = buildChildArgv({
        childExtension: CHILD_EXTENSION,
        childSessionFile: manifest.childSessionFile,
        model: manifest.model,
        thinking: manifest.thinking,
        sessionName: `Review ${shortId(manifest.runId)}`,
      });
      try {
        const paths = runPaths(REVIEW_ROOT, manifest.parentSessionId, manifest.runId);
        manifest.childPaneId = await launchHerdrAgent(exec, {
          agentName: manifest.agentName,
          cwd: manifest.cwd,
          env: { [CHILD_ENV]: paths.manifest },
          command: child.command,
          args: child.args,
          focus: true,
        });
        await writeJsonAtomic(paths.manifest, manifest);
      } catch (error) {
        ctx.ui.notify(`Could not resume reviewer: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });

  pi.registerCommand("review-status", {
    description: "Refresh Review Room status",
    handler: async (_args, ctx) => {
      await refreshWidget(ctx, false);
      const manifests = await listManifests(REVIEW_ROOT, sessionId(ctx));
      ctx.ui.notify(`${manifests.length} review room(s) attached to this session.`, "info");
    },
  });

  pi.registerCommand("review-close", {
    description: "Close a reviewer pane without sending findings",
    handler: async (args, ctx) => {
      const manifest = await chooseManifest(ctx, sessionId(ctx), args);
      if (!manifest) return;
      if (!(await ctx.ui.confirm("Close review room?", `Close ${shortId(manifest.runId)}? Drafts remain on disk and nothing will be sent.`))) return;
      try {
        await closeHerdrPane(commandExec(pi), manifest.childPaneId ?? manifest.agentName);
        const paths = runPaths(REVIEW_ROOT, manifest.parentSessionId, manifest.runId);
        await writeJsonAtomic(paths.status, { schemaVersion: SCHEMA_VERSION, runId: manifest.runId, state: "closed", updatedAt: new Date().toISOString() });
        await refreshWidget(ctx, false);
        ctx.ui.notify("Reviewer pane closed.", "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
      }
    },
  });

  pi.registerEntryRenderer(ENTRY_DRAFT, (entry, _options, theme) => {
    const data = entry.data as { runId?: string; revision?: number; count?: number };
    return new Text(theme.fg("accent", `Review ${data.runId ? shortId(data.runId) : "?"} published draft r${data.revision ?? "?"} · ${data.count ?? 0} candidate(s). Open the reviewer pane to curate and send.`), 0, 0);
  });

  pi.registerMessageRenderer(MESSAGE_HANDOFF, (message, options, theme) => {
    const text = typeof message.content === "string" ? message.content : "Selected review findings";
    const first = text.split("\n")[0];
    return new Text(theme.fg("accent", theme.bold("Selected review handoff")) + `\n${options.expanded ? text : first}`, options.outputPad, 0);
  });
}
