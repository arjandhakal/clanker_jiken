import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import childExtension from "../src/child.js";
import { CHILD_ENV } from "../src/constants.js";
import { readDraft, readHandoff, runPaths, writeJsonAtomic } from "../src/store.js";
import { SCHEMA_VERSION, type ReviewManifest } from "../src/types.js";

let root: string | undefined;
const originalManifest = process.env[CHILD_ENV];
afterEach(async () => {
  if (originalManifest === undefined) delete process.env[CHILD_ENV]; else process.env[CHILD_ENV] = originalManifest;
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

it("publishes complete versioned drafts without messaging the parent", async () => {
  root = await mkdtemp(join(tmpdir(), "review-child-"));
  const paths = runPaths(root, "parent", "run");
  const manifest: ReviewManifest = {
    schemaVersion: SCHEMA_VERSION, runId: "run", createdAt: "now", cwd: root, parentSessionId: "parent", parentPaneId: "pane", childSessionFile: join(root, "child.jsonl"), agentName: "review-run", model: "p/m", target: "working", targetLabel: "working", patchFile: paths.patch, hunkSync: false,
  };
  await writeJsonAtomic(paths.manifest, manifest);
  await writeFile(paths.patch, "diff", "utf8");
  process.env[CHILD_ENV] = paths.manifest;

  let tool: any;
  const handlers = new Map<string, (...args: any[]) => any>();
  const commands = new Map<string, any>();
  const ui = { theme: { fg: (_name: string, text: string) => text }, setStatus: vi.fn(), setWidget: vi.fn(), setTitle: vi.fn() };
  const pi = {
    registerTool: vi.fn((definition: any) => { tool = definition; }),
    registerCommand: vi.fn((name: string, definition: any) => commands.set(name, definition)),
    setActiveTools: vi.fn(),
    on: vi.fn((name: string, handler: (...args: any[]) => any) => { handlers.set(name, handler); }),
  };
  await childExtension(pi as any);
  await handlers.get("session_start")?.({}, { ui });
  expect(pi.setActiveTools).toHaveBeenCalledWith(["read", "grep", "find", "ls", "review_publish"]);

  const args = { summary: "One issue", findings: [{ id: "R1", title: "Bug", severity: "high", confidence: "high", evidence: "broken invariant", recommendation: "restore it", file: "x.ts", line: 4 }] };
  await tool.execute("call", args, new AbortController().signal, undefined, { ui });
  expect(await readDraft(paths.draft)).toEqual(expect.objectContaining({ revision: 1, summary: "One issue", findings: [expect.objectContaining({ id: "R1" })] }));
  await tool.execute("call", { ...args, summary: "Revised" }, new AbortController().signal, undefined, { ui });
  expect(await readDraft(paths.draft)).toEqual(expect.objectContaining({ revision: 2, summary: "Revised" }));
  expect((pi as any).sendMessage).toBeUndefined();
  await handlers.get("session_shutdown")?.();
});

it("queues only curated findings and user handling notes from the child pane", async () => {
  root = await mkdtemp(join(tmpdir(), "review-child-"));
  const paths = runPaths(root, "parent", "run");
  await writeJsonAtomic(paths.manifest, {
    schemaVersion: SCHEMA_VERSION, runId: "run", createdAt: "now", cwd: root, parentSessionId: "parent", parentPaneId: "parent-pane", childSessionFile: join(root, "child.jsonl"), agentName: "review-run", model: "p/m", target: "working", targetLabel: "working", patchFile: paths.patch, hunkSync: false,
  } satisfies ReviewManifest);
  await writeJsonAtomic(paths.draft, {
    schemaVersion: SCHEMA_VERSION, runId: "run", revision: 1, publishedAt: "now", findings: [
      { id: "R1", title: "send", severity: "high", confidence: "high", evidence: "e1", recommendation: "r1" },
      { id: "R2", title: "skip", severity: "low", confidence: "low", evidence: "e2", recommendation: "r2" },
    ],
  });
  await writeJsonAtomic(paths.selection, {
    schemaVersion: SCHEMA_VERSION, runId: "run", draftRevision: 1, selectedIds: ["R1"], notes: { R1: "Add a regression test first", R2: "must stay private" }, updatedAt: "now",
  });
  process.env[CHILD_ENV] = paths.manifest;
  const commands = new Map<string, any>();
  const exec = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
  await childExtension({
    registerTool: () => {}, registerCommand: (name: string, definition: any) => commands.set(name, definition), setActiveTools: () => {}, on: () => {}, exec,
  } as any);
  const ui = { confirm: vi.fn(async () => true), notify: vi.fn(), setWidget: vi.fn() };
  await commands.get("review-send").handler("", { ui });
  expect(await readHandoff(paths.handoff)).toEqual(expect.objectContaining({
    runId: "run", draftRevision: 1, selectedIds: ["R1"], findings: [expect.objectContaining({ id: "R1" })], notes: { R1: "Add a regression test first" },
  }));
  expect(exec).toHaveBeenCalledWith("herdr", ["agent", "focus", "parent-pane"], { timeout: 5_000 });
});

it("rejects malformed finding locations", async () => {
  root = await mkdtemp(join(tmpdir(), "review-child-"));
  const paths = runPaths(root, "parent", "run");
  await writeJsonAtomic(paths.manifest, {
    schemaVersion: SCHEMA_VERSION, runId: "run", createdAt: "now", cwd: root, parentSessionId: "parent", parentPaneId: "pane", childSessionFile: join(root, "child.jsonl"), agentName: "review-run", model: "p/m", target: "working", targetLabel: "working", patchFile: paths.patch, hunkSync: false,
  } satisfies ReviewManifest);
  process.env[CHILD_ENV] = paths.manifest;
  let tool: any;
  await childExtension({ registerTool: (definition: any) => { tool = definition; }, registerCommand: () => {}, setActiveTools: () => {}, on: () => {} } as any);
  await expect(tool.execute("call", { summary: "bad", findings: [{ id: "R1", title: "bad", severity: "low", confidence: "low", evidence: "e", recommendation: "r", line: 2 }] }, new AbortController().signal)).rejects.toThrow(/line requires file/);
});
