import { randomBytes } from "node:crypto";

export function createRunId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${stamp}-${randomBytes(3).toString("hex")}`;
}

export function resolvePrefix<T extends { runId: string }>(items: T[], prefix: string): T | undefined {
  const exact = items.find((item) => item.runId === prefix);
  if (exact) return exact;
  const matches = items.filter((item) => item.runId.startsWith(prefix) || item.runId.endsWith(prefix));
  return matches.length === 1 ? matches[0] : undefined;
}
