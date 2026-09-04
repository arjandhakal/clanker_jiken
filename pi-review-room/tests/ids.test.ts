import { expect, it } from "vitest";
import { createRunId, resolvePrefix } from "../src/ids.js";

it("creates filesystem-safe sortable IDs", () => expect(createRunId(new Date("2026-09-04T12:34:56Z"))).toMatch(/^20260904T123456Z-[0-9a-f]{6}$/));
it("resolves only unique prefixes", () => {
  const items = [{ runId: "abc-1" }, { runId: "abc-2" }, { runId: "def-1" }];
  expect(resolvePrefix(items, "def")).toEqual({ runId: "def-1" });
  expect(resolvePrefix(items, "-1")).toBeUndefined();
  expect(resolvePrefix(items, "2")).toEqual({ runId: "abc-2" });
  expect(resolvePrefix(items, "abc")).toBeUndefined();
});
