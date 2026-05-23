import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Registry } from "./registry.js";
import type { ViewerMode, ViewerState } from "./model.js";
import { resolveSafePath, toCwdRelative } from "./paths.js";
import { isGitRepo, getChangedFiles, getDiffStat } from "./git.js";
import { CodeViewerComponent, OVERLAY_OPTIONS } from "./viewer.js";

export function registerTools(
  pi: ExtensionAPI,
  registry: Registry,
  getCwd: () => string,
) {
  pi.registerTool({
    name: "code_ref_register",
    description:
      "Register compact code references for human viewing. Returns metadata only — no source code in output.",
    parameters: Type.Object({
      refs: Type.Array(
        Type.Object({
          path: Type.String({ description: "File path (absolute or cwd-relative)" }),
          startLine: Type.Optional(Type.Number({ description: "Start line (1-indexed)" })),
          endLine: Type.Optional(Type.Number({ description: "End line (1-indexed)" })),
          symbol: Type.Optional(Type.String({ description: "Symbol name" })),
          title: Type.Optional(Type.String({ description: "Short descriptive title" })),
          note: Type.Optional(Type.String({ description: "Short note (model-visible)" })),
        }),
      ),
      bundleTitle: Type.Optional(Type.String({ description: "Group refs into a named bundle" })),
      open: Type.Optional(Type.Boolean({ description: "Open first ref in viewer" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = getCwd();
      const createdRefs = [];

      for (const r of params.refs) {
        const absPath = resolveSafePath(r.path, cwd);
        if (!absPath) {
          return {
            content: [{ type: "text" as const, text: `Error: path outside cwd: ${r.path}` }],
            details: { error: true },
          };
        }

        const relPath = toCwdRelative(absPath, cwd);
        const ref = registry.addRef({
          path: relPath,
          startLine: r.startLine,
          endLine: r.endLine,
          symbol: r.symbol,
          title: r.title,
          note: r.note,
          source: "manual",
        });
        createdRefs.push(ref);
      }

      if (params.bundleTitle) {
        registry.addBundle(params.bundleTitle, createdRefs);
      }

      const lines = [
        `Registered ${createdRefs.length} code ref${createdRefs.length !== 1 ? "s" : ""}:`,
      ];
      for (const ref of createdRefs) {
        const range = ref.startLine
          ? `:${ref.startLine}${ref.endLine ? `-${ref.endLine}` : ""}`
          : "";
        const desc = ref.title || ref.symbol || ref.kind;
        lines.push(`- ${ref.id} ${ref.path}${range} ${desc}`);
      }
      lines.push("");
      lines.push("Open with /code-view <ref-id> or /review.");

      if (params.open && createdRefs.length > 0 && (ctx as any).hasUI !== false) {
        const firstRef = createdRefs[0];
        const state: ViewerState = {
          mode: "code",
          selectedRefId: firstRef.id,
          scroll: 0,
          selectedIndex: 0,
          searchHits: [],
          activeHit: 0,
        };
        await (ctx as any).ui.custom<undefined>(
          (tui: any, theme: any, _kb: any, done: any) =>
            new CodeViewerComponent(tui, theme, done, registry, state, cwd),
          OVERLAY_OPTIONS,
        );
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        details: { refs: createdRefs.map((r) => r.id) },
      };
    },
  });

  pi.registerTool({
    name: "code_ref_open",
    description: "Open a registered code ref in the TUI viewer overlay.",
    parameters: Type.Object({
      id: Type.String({ description: "Ref ID to open" }),
      mode: Type.Optional(Type.String({ description: "View mode: code, diff, or outline" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const ref = registry.getRef(params.id);
      if (!ref) {
        return {
          content: [{ type: "text" as const, text: `Unknown ref: ${params.id}` }],
          details: { error: true },
        };
      }

      if ((ctx as any).hasUI === false) {
        return {
          content: [
            {
              type: "text" as const,
              text: `UI unavailable. Use /code-view ${params.id} when in interactive mode.`,
            },
          ],
          details: { refId: ref.id },
        };
      }

      const cwd = getCwd();
      const state: ViewerState = {
        mode: ((params.mode as ViewerMode) || (ref.kind === "diff" ? "diff" : "code")),
        selectedRefId: ref.id,
        bundleId: ref.bundleId,
        scroll: 0,
        selectedIndex: 0,
        searchHits: [],
        activeHit: 0,
      };

      await (ctx as any).ui.custom<undefined>(
        (tui: any, theme: any, _kb: any, done: any) =>
          new CodeViewerComponent(tui, theme, done, registry, state, cwd),
        OVERLAY_OPTIONS,
      );

      return {
        content: [{ type: "text" as const, text: `Opened ${ref.id} in code viewer.` }],
        details: { refId: ref.id },
        terminate: true,
      };
    },
  });

  pi.registerTool({
    name: "code_review_changed",
    description:
      "Create a review bundle from current git changes. Returns compact metadata only.",
    parameters: Type.Object({
      staged: Type.Optional(Type.Boolean({ description: "Show staged changes only" })),
      base: Type.Optional(Type.String({ description: "Git base ref (default: HEAD)" })),
      open: Type.Optional(Type.Boolean({ description: "Open review overlay" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = getCwd();

      if (!isGitRepo(cwd)) {
        return {
          content: [{ type: "text" as const, text: "Error: not a git repository." }],
          details: { error: true },
        };
      }

      const staged = params.staged ?? false;
      const base = params.base;
      const files = getChangedFiles(cwd, staged, base);

      if (files.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No changed files." }],
          details: { empty: true },
        };
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

      const stat = getDiffStat(cwd, staged, base);

      const lines = [
        `Created review bundle ${bundle.id}: ${title}`,
        `Files changed: ${files.length}`,
      ];
      for (const ref of refs) {
        lines.push(`- ${ref.id} ${ref.path} diff`);
      }
      if (stat) {
        lines.push("");
        lines.push(stat);
      }
      lines.push("");
      lines.push("Open with /review or /code-view <ref-id>.");

      if (params.open && (ctx as any).hasUI !== false) {
        const state: ViewerState = {
          mode: "outline",
          bundleId: bundle.id,
          scroll: 0,
          selectedIndex: 0,
          searchHits: [],
          activeHit: 0,
        };
        await (ctx as any).ui.custom<undefined>(
          (tui: any, theme: any, _kb: any, done: any) =>
            new CodeViewerComponent(tui, theme, done, registry, state, cwd),
          OVERLAY_OPTIONS,
        );
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        details: { bundleId: bundle.id, refs: refs.map((r) => r.id) },
      };
    },
  });

  pi.registerTool({
    name: "code_context_summary",
    description:
      "Produce a compact inventory of registered code refs, bundles, tours, and flows.",
    parameters: Type.Object({
      bundleId: Type.Optional(Type.String()),
      tourId: Type.Optional(Type.String()),
      flowId: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params) {
      const lines: string[] = [];

      if (params.bundleId) {
        const bundle = registry.getBundle(params.bundleId);
        if (!bundle) {
          return {
            content: [{ type: "text" as const, text: `Unknown bundle: ${params.bundleId}` }],
            details: { error: true },
          };
        }
        lines.push(`Bundle ${bundle.id}: ${bundle.title}`);
        for (const ref of bundle.refs) {
          lines.push(`  ${ref.id} ${ref.path} ${ref.kind}`);
        }
      } else if (params.tourId) {
        const tour = registry.getTour(params.tourId);
        if (!tour) {
          return {
            content: [{ type: "text" as const, text: `Unknown tour: ${params.tourId}` }],
            details: { error: true },
          };
        }
        lines.push(`Tour ${tour.id}: ${tour.title}`);
        for (const step of tour.steps) {
          lines.push(`  ${step.refId} ${step.label}`);
        }
      } else if (params.flowId) {
        const flow = registry.getFlow(params.flowId);
        if (!flow) {
          return {
            content: [{ type: "text" as const, text: `Unknown flow: ${params.flowId}` }],
            details: { error: true },
          };
        }
        lines.push(`Flow ${flow.id}: ${flow.title}`);
        lines.push(
          `  Nodes: ${flow.nodeRefs.length}, Edges: ${flow.edges.length}`,
        );
      } else {
        lines.push(`Code Refs: ${registry.refs.size}`);
        lines.push(`Bundles: ${registry.bundles.size}`);
        lines.push(`Tours: ${registry.tours.size}`);
        lines.push(`Flows: ${registry.flows.size}`);
        lines.push(`Artifacts: ${registry.artifacts.size}`);

        if (registry.refs.size > 0) {
          lines.push("");
          lines.push("Recent refs:");
          const refs = Array.from(registry.refs.values()).slice(-5);
          for (const ref of refs) {
            const range = ref.startLine
              ? `:${ref.startLine}${ref.endLine ? `-${ref.endLine}` : ""}`
              : "";
            lines.push(`  ${ref.id} ${ref.path}${range} ${ref.kind}`);
          }
        }
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "code_tour_register",
    description:
      "Register a guided code tour for understanding a feature or subsystem. Returns compact metadata only.",
    parameters: Type.Object({
      title: Type.String({ description: "Tour title" }),
      purpose: Type.Optional(Type.String({ description: "Learning goal" })),
      steps: Type.Array(
        Type.Object({
          refId: Type.Optional(Type.String({ description: "Existing ref ID" })),
          path: Type.Optional(Type.String({ description: "File path (to create ref)" })),
          startLine: Type.Optional(Type.Number()),
          endLine: Type.Optional(Type.Number()),
          symbol: Type.Optional(Type.String()),
          label: Type.String({ description: "Step label" }),
          note: Type.Optional(Type.String({ description: "Short explanation" })),
          role: Type.Optional(
            Type.String({
              description: "entrypoint | transform | validation | io | test | config | other",
            }),
          ),
        }),
      ),
      open: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const cwd = getCwd();
      const steps = [];

      for (const s of params.steps) {
        let refId = s.refId;

        if (!refId && s.path) {
          const absPath = resolveSafePath(s.path, cwd);
          if (!absPath) {
            return {
              content: [{ type: "text" as const, text: `Error: path outside cwd: ${s.path}` }],
              details: { error: true },
            };
          }
          const relPath = toCwdRelative(absPath, cwd);
          const ref = registry.addRef({
            path: relPath,
            startLine: s.startLine,
            endLine: s.endLine,
            symbol: s.symbol,
            title: s.label,
            source: "manual",
          });
          refId = ref.id;
        }

        if (!refId) {
          return {
            content: [
              { type: "text" as const, text: `Error: step "${s.label}" has no refId or path` },
            ],
            details: { error: true },
          };
        }

        steps.push({
          refId,
          label: s.label,
          note: s.note,
          role: s.role as any,
        });
      }

      const tour = registry.addTour({
        title: params.title,
        purpose: params.purpose,
        steps,
      });

      const lines = [
        `Registered tour ${tour.id}: ${tour.title}`,
        `Steps: ${tour.steps.length}`,
        `Open with /tour ${tour.id}.`,
      ];

      if (params.open && (ctx as any).hasUI !== false) {
        const state: ViewerState = {
          mode: "tour",
          tourId: tour.id,
          selectedStepIndex: 0,
          scroll: 0,
          selectedIndex: 0,
          searchHits: [],
          activeHit: 0,
        };
        await (ctx as any).ui.custom<undefined>(
          (tui: any, theme: any, _kb: any, done: any) =>
            new CodeViewerComponent(tui, theme, done, registry, state, cwd),
          OVERLAY_OPTIONS,
        );
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        details: { tourId: tour.id },
      };
    },
  });

  pi.registerTool({
    name: "code_flow_register",
    description:
      "Register a compact data-flow map linking code refs with edges and runtime observations. Returns compact metadata only.",
    parameters: Type.Object({
      title: Type.String(),
      sourceTool: Type.Optional(Type.String()),
      entryRefId: Type.Optional(Type.String()),
      nodeRefs: Type.Array(Type.String({ description: "Existing ref IDs" })),
      edges: Type.Optional(
        Type.Array(
          Type.Object({
            fromRefId: Type.String(),
            toRefId: Type.String(),
            kind: Type.String({
              description: "calls | emits | reads | writes | tests | routes-to | depends-on",
            }),
            label: Type.Optional(Type.String()),
          }),
        ),
      ),
      observations: Type.Optional(
        Type.Array(
          Type.Object({
            refId: Type.Optional(Type.String()),
            label: Type.String(),
            preview: Type.Optional(Type.String({ description: "Bounded/redacted preview" })),
            artifactId: Type.Optional(Type.String()),
          }),
        ),
      ),
      summary: Type.Optional(Type.String()),
      open: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      for (const refId of params.nodeRefs) {
        if (!registry.getRef(refId)) {
          return {
            content: [{ type: "text" as const, text: `Unknown ref: ${refId}` }],
            details: { error: true },
          };
        }
      }

      const flow = registry.addFlow({
        title: params.title,
        sourceTool: params.sourceTool,
        entryRefId: params.entryRefId,
        nodeRefs: params.nodeRefs,
        edges: (params.edges || []).map((e) => ({ ...e, kind: e.kind as any })),
        observations: params.observations,
        summary: params.summary,
      });

      const obsCount = flow.observations?.length ?? 0;
      const lines = [
        `Registered data flow ${flow.id}: ${flow.title}`,
        `Nodes: ${flow.nodeRefs.length}, Edges: ${flow.edges.length}${obsCount > 0 ? `, Observations: ${obsCount}` : ""}`,
        `Open with /flow ${flow.id}.`,
      ];

      if (params.open && (ctx as any).hasUI !== false) {
        const cwd = getCwd();
        const state: ViewerState = {
          mode: "flow",
          flowId: flow.id,
          selectedStepIndex: 0,
          scroll: 0,
          selectedIndex: 0,
          searchHits: [],
          activeHit: 0,
        };
        await (ctx as any).ui.custom<undefined>(
          (tui: any, theme: any, _kb: any, done: any) =>
            new CodeViewerComponent(tui, theme, done, registry, state, cwd),
          OVERLAY_OPTIONS,
        );
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        details: { flowId: flow.id },
      };
    },
  });

  pi.registerTool({
    name: "code_artifact_register",
    description:
      "Register a compact pointer to runtime/debugging output. Metadata-first; full values stay in memory only.",
    parameters: Type.Object({
      kind: Type.String({
        description: "tap | trace | repl-result | portal | flowstorm | test | lint | profile",
      }),
      title: Type.String(),
      sourceTool: Type.Optional(Type.String()),
      refIds: Type.Optional(Type.Array(Type.String())),
      preview: Type.Optional(Type.String({ description: "Bounded/redacted preview" })),
      externalUri: Type.Optional(Type.String()),
      inMemoryOnly: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params) {
      const artifact = registry.addArtifact({
        kind: params.kind as any,
        title: params.title,
        sourceTool: params.sourceTool,
        refIds: params.refIds,
        preview: params.preview,
        externalUri: params.externalUri,
        inMemoryOnly: params.inMemoryOnly,
      });

      const lines = [
        `Registered artifact ${artifact.id}: ${artifact.title} (${artifact.kind})`,
      ];
      if (artifact.preview) {
        lines.push(`Preview: ${artifact.preview}`);
      }
      if (artifact.externalUri) {
        lines.push(`External: ${artifact.externalUri}`);
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        details: { artifactId: artifact.id },
      };
    },
  });
}
