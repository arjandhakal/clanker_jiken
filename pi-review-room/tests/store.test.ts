import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { listManifests, readJson, runPaths, writeJsonAtomic } from "../src/store.js";
import { SCHEMA_VERSION, type ReviewManifest } from "../src/types.js";

let root: string | undefined;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); root = undefined; });

it("writes atomically and lists newest manifests first", async () => {
  root = await mkdtemp(join(tmpdir(), "review-room-"));
  for (const [runId, createdAt] of [["old", "2020"], ["new", "2021"]] as const) {
    const paths = runPaths(root, "parent", runId);
    const manifest = { schemaVersion: SCHEMA_VERSION, runId, createdAt, cwd: "/r", parentSessionId: "parent", parentPaneId: "p", childSessionFile: "/c", agentName: runId, model: "p/m", target: "all", targetLabel: "all", patchFile: paths.patch, hunkSync: false } satisfies ReviewManifest;
    await writeJsonAtomic(paths.manifest, manifest);
  }
  expect((await listManifests(root, "parent")).map((item) => item.runId)).toEqual(["new", "old"]);
  expect(await readJson(join(root, "parent", "new", "manifest.json"))).toEqual(expect.objectContaining({ runId: "new" }));
  expect((await readFile(join(root, "parent", "new", "manifest.json"), "utf8")).endsWith("\n")).toBe(true);
});
