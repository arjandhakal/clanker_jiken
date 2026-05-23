import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Registry } from "./registry.js";
import type { ViewerState } from "./model.js";
import { parsePathRange, resolveSafePath, toCwdRelative } from "./paths.js";
import { isGitRepo, getChangedFiles } from "./git.js";
import { openViewer } from "./viewer.js";

function makeState(partial: Partial<ViewerState>): ViewerState {
  return {
    mode: "code",
    scroll: 0,
    selectedIndex: 0,
    searchHits: [],
    activeHit: 0,
    ...partial,
  };
}

export function registerCommands(
  pi: ExtensionAPI,
  registry: Registry,
  getCwd: () => string,
) {
  pi.registerCommand("code-view", {
    description: "Open code viewer for a ref or file path",
    handler: async (args, ctx) => {
      const cwd = getCwd();
      const input = args.trim();

      if (!input) {
        ctx.ui.notify(
          "Usage: /code-view <ref-id | path[:line[-line]]>",
          "warning",
        );
        return;
      }

      const ref = registry.getRef(input);
      if (ref) {
        await openViewer(
          ctx,
          registry,
          cwd,
          makeState({
            mode: ref.kind === "diff" ? "diff" : "code",
            selectedRefId: ref.id,
            bundleId: ref.bundleId,
          }),
        );
        return;
      }

      const parsed = parsePathRange(input);
      const absPath = resolveSafePath(parsed.path, cwd);
      if (!absPath) {
        ctx.ui.notify(`Path outside cwd: ${parsed.path}`, "error");
        return;
      }

      const relPath = toCwdRelative(absPath, cwd);
      const newRef = registry.addRef({
        path: relPath,
        startLine: parsed.startLine,
        endLine: parsed.endLine,
        source: "manual",
      });

      await openViewer(
        ctx,
        registry,
        cwd,
        makeState({
          mode: "code",
          selectedRefId: newRef.id,
        }),
      );
    },
  });

  pi.registerCommand("review", {
    description: "Open the latest review bundle",
    handler: async (_args, ctx) => {
      const cwd = getCwd();
      let bundle = registry.getLatestBundle();

      if (!bundle) {
        if (!isGitRepo(cwd)) {
          ctx.ui.notify("Not a git repository", "error");
          return;
        }

        const files = getChangedFiles(cwd, false);
        if (files.length === 0) {
          ctx.ui.notify("No changed files", "info");
          return;
        }

        const refs = files.map((f) =>
          registry.addRef({ path: f, kind: "diff", source: "git" }),
        );
        bundle = registry.addBundle("Working tree changes", refs);
      }

      await openViewer(
        ctx,
        registry,
        cwd,
        makeState({
          mode: "outline",
          bundleId: bundle.id,
        }),
      );
    },
  });

  pi.registerCommand("changed", {
    description: "Create and open review bundle for current changes",
    handler: async (args, ctx) => {
      const cwd = getCwd();

      if (!isGitRepo(cwd)) {
        ctx.ui.notify("Not a git repository", "error");
        return;
      }

      const staged = args.includes("--staged");
      const baseMatch = args.match(/--base\s+(\S+)/);
      const base = baseMatch?.[1];

      const files = getChangedFiles(cwd, staged, base);
      if (files.length === 0) {
        ctx.ui.notify("No changed files", "info");
        return;
      }

      const refs = files.map((f) =>
        registry.addRef({ path: f, kind: "diff", source: "git" }),
      );
      const title = staged
        ? "Staged changes"
        : base
          ? `Changes vs ${base}`
          : "Working tree changes";
      const bundle = registry.addBundle(title, refs, {
        gitBase: base,
        staged,
      });

      await openViewer(
        ctx,
        registry,
        cwd,
        makeState({
          mode: "outline",
          bundleId: bundle.id,
        }),
      );
    },
  });

  pi.registerCommand("code-refs", {
    description: "List registered code refs, bundles, tours, and flows",
    handler: async (_args, ctx) => {
      const cwd = getCwd();

      await openViewer(
        ctx,
        registry,
        cwd,
        makeState({ mode: "outline" }),
      );
    },
  });

  pi.registerCommand("tour", {
    description: "Open a guided code tour",
    handler: async (args, ctx) => {
      const cwd = getCwd();
      const input = args.trim();

      if (input) {
        const tour = registry.getTour(input);
        if (!tour) {
          ctx.ui.notify(`Unknown tour: ${input}`, "error");
          return;
        }

        await openViewer(
          ctx,
          registry,
          cwd,
          makeState({
            mode: "tour",
            tourId: tour.id,
            selectedStepIndex: 0,
          }),
        );
        return;
      }

      const tours = Array.from(registry.tours.values());
      if (tours.length === 0) {
        ctx.ui.notify("No tours registered", "info");
        return;
      }

      if (tours.length === 1) {
        await openViewer(
          ctx,
          registry,
          cwd,
          makeState({
            mode: "tour",
            tourId: tours[0].id,
            selectedStepIndex: 0,
          }),
        );
        return;
      }

      const selected = await ctx.ui.select(
        "Select a tour",
        tours.map((t) => ({
          label: `${t.id}: ${t.title}`,
          value: t.id,
        })),
      );

      if (selected) {
        await openViewer(
          ctx,
          registry,
          cwd,
          makeState({
            mode: "tour",
            tourId: selected,
            selectedStepIndex: 0,
          }),
        );
      }
    },
  });

  pi.registerCommand("flow", {
    description: "Open a data-flow view",
    handler: async (args, ctx) => {
      const cwd = getCwd();
      const input = args.trim();

      if (input) {
        const flow = registry.getFlow(input);
        if (!flow) {
          ctx.ui.notify(`Unknown flow: ${input}`, "error");
          return;
        }

        await openViewer(
          ctx,
          registry,
          cwd,
          makeState({
            mode: "flow",
            flowId: flow.id,
            selectedStepIndex: 0,
          }),
        );
        return;
      }

      const flows = Array.from(registry.flows.values());
      if (flows.length === 0) {
        ctx.ui.notify("No flows registered", "info");
        return;
      }

      if (flows.length === 1) {
        await openViewer(
          ctx,
          registry,
          cwd,
          makeState({
            mode: "flow",
            flowId: flows[0].id,
            selectedStepIndex: 0,
          }),
        );
        return;
      }

      const selected = await ctx.ui.select(
        "Select a flow",
        flows.map((f) => ({
          label: `${f.id}: ${f.title}`,
          value: f.id,
        })),
      );

      if (selected) {
        await openViewer(
          ctx,
          registry,
          cwd,
          makeState({
            mode: "flow",
            flowId: selected,
            selectedStepIndex: 0,
          }),
        );
      }
    },
  });
}
