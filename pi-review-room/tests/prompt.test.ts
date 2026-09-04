import { expect, it } from "vitest";
import { buildReviewPrompt, formatHandoff } from "../src/prompt.js";
import { SCHEMA_VERSION, type ReviewDraft, type ReviewManifest } from "../src/types.js";

const manifest: ReviewManifest = {
  schemaVersion: SCHEMA_VERSION, runId: "run", createdAt: "now", cwd: "/repo", parentSessionId: "parent", parentSessionFile: "/p.jsonl", parentPaneId: "pane", childSessionFile: "/c.jsonl", agentName: "review-run", model: "provider/model", thinking: "high", target: "all", targetLabel: "All changes", patchFile: "/review.patch", brief: "Check transactions", hunkSync: true,
};
const draft: ReviewDraft = {
  schemaVersion: SCHEMA_VERSION, runId: "run", revision: 1, publishedAt: "now", findings: [
    { id: "R1", title: "Selected", severity: "high", confidence: "high", evidence: "selected evidence", recommendation: "fix one", file: "a.ts", line: 4 },
    { id: "R2", title: "Rejected", severity: "low", confidence: "low", evidence: "private evidence", recommendation: "fix two" },
  ],
};

it("creates a blind, interactive review prompt", () => {
  const prompt = buildReviewPrompt(manifest);
  expect(prompt).toContain("deliberately blank session");
  expect(prompt).toContain("Check transactions");
  expect(prompt).toContain("review_publish");
  expect(prompt).toContain("/review.patch");
});

it("hands off only selected findings", () => {
  const handoff = formatHandoff(manifest, draft, ["R1"], { R1: "Write the regression test first", R2: "private note" });
  expect(handoff).toContain("R1");
  expect(handoff).toContain("User handling note: Write the regression test first");
  expect(handoff).toContain("selected evidence");
  expect(handoff).not.toContain("R2");
  expect(handoff).not.toContain("private evidence");
  expect(handoff).not.toContain("private note");
});
