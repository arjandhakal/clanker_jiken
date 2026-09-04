import type { ReviewDraft, ReviewSelection } from "./types.js";

export function reconcileSelection(draft: ReviewDraft, selection?: ReviewSelection): Set<string> {
  if (!selection || selection.draftRevision !== draft.revision) return new Set();
  const available = new Set(draft.findings.map((finding) => finding.id));
  return new Set(selection.selectedIds.filter((id) => available.has(id)));
}

export function validateFindingIds(findings: ReviewDraft["findings"]): string | undefined {
  const seen = new Set<string>();
  for (const finding of findings) {
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(finding.id)) return `Invalid finding ID: ${finding.id}`;
    if (seen.has(finding.id)) return `Duplicate finding ID: ${finding.id}`;
    seen.add(finding.id);
    if (finding.line !== undefined && !finding.file) return `${finding.id}: line requires file`;
  }
  return undefined;
}
