import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Registry } from "../src/registry.js";
import { registerTools } from "../src/tools.js";
import { registerCommands } from "../src/commands.js";
import type { PersistenceData } from "../src/model.js";

const CUSTOM_TYPE = "code-viewer-index";

export default function codeViewerExtension(pi: ExtensionAPI) {
  const registry = new Registry();
  let cwd = process.cwd();

  function getCwd(): string {
    return cwd;
  }

  registerTools(pi, registry, getCwd);
  registerCommands(pi, registry, getCwd);

  pi.on("session_start", async (_event, ctx) => {
    cwd = ctx.cwd;
    restoreState(ctx);
  });

  pi.on("session_tree", async (_event, ctx) => {
    cwd = ctx.cwd;
    restoreState(ctx);
  });

  pi.on("tool_result", async (event) => {
    try {
      const ev = event as any;
      const toolName = ev?.toolName || ev?.name || "";

      if (toolName !== "edit" && toolName !== "write") return;

      const result = ev?.result;
      let filePath: string | undefined;

      if (result?.details?.path) {
        filePath = result.details.path;
      } else if (result?.details?.file_path) {
        filePath = result.details.file_path;
      }

      if (!filePath && result?.content) {
        for (const block of result.content) {
          if (block.type === "text" && block.text) {
            const match = block.text.match(
              /(?:wrote|edited|updated|created)\s+(\S+)/i,
            );
            if (match) filePath = match[1];
          }
        }
      }

      if (!filePath) return;

      const autoBundle = registry.getOrCreateAutoBundle();
      const alreadyTracked = autoBundle.refs.some((r) => r.path === filePath);
      if (alreadyTracked) return;

      const ref = registry.addRef({
        path: filePath,
        kind: "diff",
        source: toolName === "edit" ? "auto-edit" : "auto-write",
      });
      autoBundle.refs.push(ref);
      ref.bundleId = autoBundle.id;
      autoBundle.timestamp = Date.now();

      persistState(pi, registry);
    } catch {
      // never crash on auto-tracking
    }
  });

  function restoreState(ctx: ExtensionContext) {
    const entries = ctx.sessionManager.getBranch();
    let lastData: PersistenceData | undefined;

    for (const entry of entries) {
      if (
        entry.type === "custom" &&
        (entry as any).customType === CUSTOM_TYPE
      ) {
        const data = (entry as any).data as PersistenceData | undefined;
        if (data) lastData = data;
      }
    }

    if (lastData) {
      registry.restore(lastData);
    }
  }
}

function persistState(pi: ExtensionAPI, registry: Registry) {
  pi.appendEntry(CUSTOM_TYPE, registry.serialize());
}
