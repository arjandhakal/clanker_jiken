import { expect, it } from "vitest";
import { buildChildArgv } from "../src/process.js";

it("builds a fresh read-only child invocation", () => {
  const invocation = buildChildArgv({ childExtension: "/pkg/src/child.ts", childSessionFile: "/run/session.jsonl", model: "provider/model", thinking: "high", sessionName: "Review x", prompt: "Inspect patch" });
  expect(invocation.args).toContain("--no-extensions");
  expect(invocation.args).toContain("--no-context-files");
  expect(invocation.args).toContain("--no-approve");
  expect(invocation.args).toContain("read,grep,find,ls,review_publish");
  expect(invocation.args).not.toContain("bash");
  expect(invocation.args.at(-1)).toBe("Inspect patch");
});

it("can resume without creating another user prompt", () => {
  const invocation = buildChildArgv({ childExtension: "/child.ts", childSessionFile: "/session.jsonl", model: "p/m", sessionName: "Review" });
  expect(invocation.args.at(-1)).toBe("p/m");
});
