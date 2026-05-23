import { execSync } from "node:child_process";

function run(cmd: string, cwd: string): string {
  try {
    return execSync(cmd, {
      cwd,
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

export function isGitRepo(cwd: string): boolean {
  return run("git rev-parse --is-inside-work-tree", cwd) === "true";
}

export function getChangedFiles(
  cwd: string,
  staged: boolean,
  base?: string,
): string[] {
  let cmd: string;
  if (base) {
    cmd = `git diff ${base} --name-only`;
  } else if (staged) {
    cmd = "git diff --cached --name-only";
  } else {
    cmd = "git diff --name-only";
  }
  const out = run(cmd, cwd);
  if (!out) return [];
  return out.split("\n").filter(Boolean);
}

export function getDiff(
  cwd: string,
  filePath: string,
  staged: boolean,
  base?: string,
): string {
  const escapedPath = filePath.replace(/"/g, '\\"');
  let cmd: string;
  if (base) {
    cmd = `git diff ${base} --no-ext-diff --unified=80 -- "${escapedPath}"`;
  } else if (staged) {
    cmd = `git diff --cached --no-ext-diff --unified=80 -- "${escapedPath}"`;
  } else {
    cmd = `git diff --no-ext-diff --unified=80 -- "${escapedPath}"`;
  }
  return run(cmd, cwd);
}

export function getDiffStat(
  cwd: string,
  staged: boolean,
  base?: string,
): string {
  let cmd: string;
  if (base) {
    cmd = `git diff ${base} --stat`;
  } else if (staged) {
    cmd = "git diff --cached --stat";
  } else {
    cmd = "git diff --stat";
  }
  return run(cmd, cwd);
}
