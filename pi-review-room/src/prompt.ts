import type { ReviewManifest, ReviewTarget } from "./types.js";

export const TARGET_LABELS: Record<ReviewTarget, string> = {
  all: "All branch and working-tree changes",
  working: "Working tree against HEAD",
  staged: "Staged changes",
  branch: "Committed branch changes against base",
};

export function buildReviewPrompt(manifest: ReviewManifest): string {
  const brief = manifest.brief?.trim()
    ? `\nThe user supplied this narrow review brief:\n${manifest.brief.trim()}\n`
    : "";
  return `Conduct an independent code review of ${manifest.targetLabel}.

The patch snapshot is at:
${manifest.patchFile}

Read that patch first, then inspect relevant source files in ${manifest.cwd}. You have a deliberately blank session and read-only tools: do not infer intent from the parent conversation, and do not modify the checkout.${brief}
Concentrate on actionable correctness, security, data-loss, concurrency, compatibility, and maintainability problems. Do not report stylistic preferences unless they create a concrete risk.

Give each candidate a stable ID (R1, R2, ...). For located findings, provide the repo-relative file plus the 1-based source line on the old or new side (not the patch-file line); side defaults to new. When your initial review is ready, call review_publish with the complete candidate set. The publication is only a draft inbox update; it is not sent to the parent agent. Stay available in this pane so the user can challenge, clarify, remove, or revise findings. Call review_publish again whenever the candidate set changes. Never claim that a finding has been sent to the parent until the user explicitly runs /review-send in this reviewer pane.`;
}

export function formatHandoff(
  manifest: ReviewManifest,
  draft: import("./types.js").ReviewDraft,
  selectedIds: string[],
  notes: Record<string, string> = {},
): string {
  const selected = new Set(selectedIds);
  const findings = draft.findings.filter((finding) => selected.has(finding.id));
  const lines = findings.map((finding) => {
    const location = finding.file ? ` — ${finding.file}${finding.line ? `:${finding.line}` : ""}` : "";
    const userNote = notes[finding.id]?.trim();
    return `### ${finding.id} [${finding.severity}] ${finding.title}${location}\n\n${finding.evidence}\n\nRecommended action: ${finding.recommendation}${userNote ? `\n\nUser handling note: ${userNote}` : ""}`;
  });
  return `An independent reviewer (${manifest.model}${manifest.thinking ? `, thinking ${manifest.thinking}` : ""}) reviewed ${manifest.targetLabel}. The user discussed and explicitly selected only the findings below in the reviewer pane. Treat them as review feedback to investigate and address. Follow any “User handling note” as the user's preferred approach, while still validating the issue. Omitted candidates were intentionally not forwarded.\n\n${lines.join("\n\n---\n\n")}`;
}
