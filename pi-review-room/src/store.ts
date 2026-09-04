import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ReviewDraft, ReviewHandoff, ReviewManifest, ReviewSelection, ReviewStatus, RunPaths } from "./types.js";

export function runPathsFromDir(dir: string): RunPaths {
  return {
    dir,
    manifest: join(dir, "manifest.json"),
    draft: join(dir, "draft.json"),
    selection: join(dir, "selection.json"),
    handoff: join(dir, "handoff.json"),
    status: join(dir, "status.json"),
    patch: join(dir, "review.patch"),
  };
}

export function runPaths(root: string, parentSessionId: string, runId: string): RunPaths {
  return runPathsFromDir(join(root, parentSessionId, runId));
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

export async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export async function listManifests(root: string, parentSessionId: string): Promise<ReviewManifest[]> {
  const sessionDir = join(root, parentSessionId);
  let names: string[];
  try {
    names = await readdir(sessionDir);
  } catch {
    return [];
  }
  const manifests = await Promise.all(
    names.map((name) => readJson<ReviewManifest>(join(sessionDir, name, "manifest.json"))),
  );
  return manifests
    .filter((item): item is ReviewManifest => Boolean(item?.runId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const readManifest = (path: string) => readJson<ReviewManifest>(path);
export const readDraft = (path: string) => readJson<ReviewDraft>(path);
export const readSelection = (path: string) => readJson<ReviewSelection>(path);
export const readHandoff = (path: string) => readJson<ReviewHandoff>(path);
export const readStatus = (path: string) => readJson<ReviewStatus>(path);
