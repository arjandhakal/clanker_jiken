import { describe, expect, it } from "vitest";
import { createPatch, resolveBase, type GitExec } from "../src/git.js";

function fake(responses: Record<string, { code?: number; stdout?: string; stderr?: string }>): GitExec {
  return async (_cwd, args) => {
    const response = responses[args.join(" ")] ?? {};
    return { code: response.code ?? 0, stdout: response.stdout ?? "", stderr: response.stderr ?? "" };
  };
}

it("does not use a feature branch's own remote tracking branch as its review base", async () => {
  const exec = fake({
    "symbolic-ref --quiet --short HEAD": { stdout: "feature\n" },
    "rev-parse --abbrev-ref --symbolic-full-name @{upstream}": { stdout: "origin/feature\n" },
    "symbolic-ref --quiet --short refs/remotes/origin/HEAD": { stdout: "origin/main\n" },
    "rev-parse --verify --quiet origin/main^{commit}": {},
  });
  expect(await resolveBase(exec, "/repo")).toBe("origin/main");
});

it("builds all changes from merge-base and appends untracked files", async () => {
  const exec = fake({
    "rev-parse --show-toplevel": { stdout: "/repo\n" },
    "symbolic-ref --quiet --short HEAD": { stdout: "feature\n" },
    "rev-parse --abbrev-ref --symbolic-full-name @{upstream}": { code: 1 },
    "symbolic-ref --quiet --short refs/remotes/origin/HEAD": { stdout: "origin/main\n" },
    "rev-parse --verify --quiet origin/main^{commit}": {},
    "merge-base HEAD origin/main": { stdout: "abc\n" },
    "diff --no-ext-diff --find-renames --no-color abc": { stdout: "tracked patch\n" },
    "ls-files --others --exclude-standard -z": { stdout: "new.ts\0" },
    "diff --no-index --no-color -- /dev/null new.ts": { code: 1, stdout: "untracked patch\n" },
  });
  const result = await createPatch(exec, "/repo/sub", "all");
  expect(result.root).toBe("/repo");
  expect(result.patch).toContain("tracked patch");
  expect(result.patch).toContain("untracked patch");
  expect(result.labelSuffix).toBe(" (origin/main)");
});

describe("target modes", () => {
  it("uses the staged diff", async () => {
    const exec = fake({ "rev-parse --show-toplevel": { stdout: "/repo\n" }, "diff --no-ext-diff --find-renames --no-color --cached": { stdout: "staged" } });
    expect((await createPatch(exec, "/repo", "staged")).patch).toBe("staged");
  });
});
