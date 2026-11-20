---
name: code-why
description: "Investigate why code or a PR took its current shape using introduction commits, later changes, review discussion, linked issues, and design records. Use for design rationale and tradeoffs; distinguish documented reasons, inference, and unknowns."
---

# Code why

Read [the shared contract](../references/contract.md).

Answer from the decision record, not a story inferred from the current implementation.

1. Anchor the question in concrete paths, symbols, and the current behavior.
2. Inspect local history with scoped git log, blame, and show. Blame identifies the last touch, not necessarily the original decision. Trace the introducing change and material later changes, following renames where necessary.
3. Read associated PR bodies, review discussion, linked issues, and design records when available. Use the repository's forge/API or CLI without assuming GitHub. If no remote tooling is available, give the supported local answer and identify the gap.
4. Start narrow. Widen to other authorized sources only when they can settle a particular unanswered question. Do not enumerate or query every private integration.
5. Compare the original constraints with later evidence. Explain the alternatives and tradeoffs actually recorded. Do not retrofit today's context onto an old decision.

Keep three distinctions explicit in natural prose:
- **Documented:** what a named source says, with a source link or commit.
- **Inferred:** a plausible explanation and the evidence supporting it.
- **Unknown:** what the accessible record does not settle.

When records conflict, show the disagreement and chronology. An AI-authored PR description is evidence of its stated intent, not proof of correctness or the human team's decision. Do not claim to know an AI agent's hidden reasoning.

End with the practical consequence for the reader, including constraints worth preserving if a future change is being considered. Do not propose or apply changes unless requested.
