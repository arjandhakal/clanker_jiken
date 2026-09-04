import { relative } from "node:path";
import type { ReviewTarget } from "./types.js";

export interface GitExecResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type GitExec = (cwd: string, args: string[]) => Promise<GitExecResult>;

async function must(exec: GitExec, cwd: string, args: string[]): Promise<string> {
  const result = await exec(cwd, args);
  if (result.code !== 0) throw new Error(result.stderr.trim() || `git ${args[0]} failed`);
  return result.stdout.trim();
}

export async function repositoryRoot(exec: GitExec, cwd: string): Promise<string> {
  return must(exec, cwd, ["rev-parse", "--show-toplevel"]);
}

async function refExists(exec: GitExec, cwd: string, ref: string): Promise<boolean> {
  return (await exec(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).code === 0;
}

export async function resolveBase(exec: GitExec, cwd: string): Promise<string> {
  const branch = await must(exec, cwd, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => "");
  const upstream = await must(exec, cwd, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]).catch(() => "");
  const ownRemote = branch && upstream.endsWith(`/${branch}`);
  if (upstream && !ownRemote && (await refExists(exec, cwd, upstream))) return upstream;

  const originHead = await must(exec, cwd, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]).catch(() => "");
  if (originHead && (await refExists(exec, cwd, originHead))) return originHead;

  for (const candidate of ["main", "master", "trunk", "origin/main", "origin/master", "origin/trunk"]) {
    if (await refExists(exec, cwd, candidate)) return candidate;
  }
  throw new Error("Could not resolve a base branch (upstream, origin/HEAD, main, master, or trunk).");
}

async function diff(exec: GitExec, cwd: string, args: string[]): Promise<string> {
  const result = await exec(cwd, ["diff", "--no-ext-diff", "--find-renames", "--no-color", ...args]);
  if (result.code !== 0) throw new Error(result.stderr.trim() || "git diff failed");
  return result.stdout;
}

async function untrackedPatch(exec: GitExec, cwd: string, maxBytes: number): Promise<string> {
  const filesResult = await exec(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]);
  if (filesResult.code !== 0) return "";
  const files = filesResult.stdout.split("\0").filter(Boolean);
  let output = "";
  for (const file of files) {
    const result = await exec(cwd, ["diff", "--no-index", "--no-color", "--", "/dev/null", file]);
    if (result.code !== 0 && result.code !== 1) continue;
    output += `\n${result.stdout}`;
    if (Buffer.byteLength(output) > maxBytes) {
      output += "\n[review-room: untracked patch truncated]\n";
      break;
    }
  }
  return output;
}

export async function createPatch(exec: GitExec, cwd: string, target: ReviewTarget, maxBytes = 5 * 1024 * 1024): Promise<{ root: string; patch: string; labelSuffix?: string }> {
  const root = await repositoryRoot(exec, cwd);
  let patch: string;
  let labelSuffix: string | undefined;
  if (target === "staged") {
    patch = await diff(exec, root, ["--cached"]);
  } else if (target === "working") {
    patch = await diff(exec, root, ["HEAD"]);
    patch += await untrackedPatch(exec, root, maxBytes - Buffer.byteLength(patch));
  } else {
    const base = await resolveBase(exec, root);
    const mergeBase = await must(exec, root, ["merge-base", "HEAD", base]);
    labelSuffix = ` (${base})`;
    patch = target === "branch"
      ? await diff(exec, root, [`${mergeBase}...HEAD`])
      : await diff(exec, root, [mergeBase]);
    if (target === "all") patch += await untrackedPatch(exec, root, maxBytes - Buffer.byteLength(patch));
  }
  if (Buffer.byteLength(patch) > maxBytes) throw new Error(`Patch exceeds ${Math.round(maxBytes / 1024 / 1024)} MiB; narrow the review first.`);
  return { root, patch, labelSuffix };
}

export function displayPath(root: string, file: string): string {
  return relative(root, file) || ".";
}
