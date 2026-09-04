import { describe, expect, it } from "vitest";
import { reconcileSelection, validateFindingIds } from "../src/selection.js";
import { SCHEMA_VERSION, type ReviewDraft, type ReviewSelection } from "../src/types.js";

const draft: ReviewDraft = {
  schemaVersion: SCHEMA_VERSION,
  runId: "run",
  revision: 2,
  publishedAt: "now",
  findings: [
    { id: "R1", title: "one", severity: "high", confidence: "high", evidence: "e", recommendation: "r" },
    { id: "R2", title: "two", severity: "low", confidence: "medium", evidence: "e", recommendation: "r" },
  ],
};

it("keeps only existing IDs from the matching draft revision", () => {
  const selection: ReviewSelection = { schemaVersion: SCHEMA_VERSION, runId: "run", draftRevision: 2, selectedIds: ["R1", "gone"], updatedAt: "now" };
  expect([...reconcileSelection(draft, selection)]).toEqual(["R1"]);
});

it("invalidates selection when the reviewer republishes", () => {
  const selection: ReviewSelection = { schemaVersion: SCHEMA_VERSION, runId: "run", draftRevision: 1, selectedIds: ["R1"], updatedAt: "now" };
  expect(reconcileSelection(draft, selection).size).toBe(0);
});

describe("finding validation", () => {
  it("rejects duplicates", () => expect(validateFindingIds([draft.findings[0], draft.findings[0]])).toMatch(/Duplicate/));
  it("rejects a line without a file", () => expect(validateFindingIds([{ ...draft.findings[0], line: 2, file: undefined }])).toMatch(/line requires file/));
  it("accepts a valid set", () => expect(validateFindingIds(draft.findings)).toBeUndefined());
});
