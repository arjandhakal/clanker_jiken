---
name: essence-review
description: Critique concept designs and implementations for specificity, familiarity, integrity, synchronization errors, and misleading interfaces. Use for concept architecture reviews, concrete counterexamples, and release gates on concept-driven changes.
---

# Review with counterexamples

Read [shared contract](../essence/references/contract.md) and [review rubric](../essence/references/review.md). Review the actual current specs/code/diff, not the author's summary. A separate subagent is optional and requires authorization; otherwise conduct a deliberate review pass.

1. Identify scope and evidence. Distinguish a proposed specification from actual behavior and user need.
2. Apply specificity: missing need, purposeless mechanism, redundancy and overload. Do not demand one concept per method or split merely because a purpose uses “and.”
3. Apply familiarity: compare promised semantics with familiar precedents; check that deviations are intentional and communicated.
4. Apply integrity: construct an application trace and project it onto each concept. Find direct foreign-state writes, shared mutable objects, impossible transitions and invariant violations.
5. Separately test liveness/usefulness and over-/under-synchronization. A legal projection does not show that a valuable action remains reachable, that authorization is adequate, or that a user wants the automation.
6. Check failure boundaries: race windows, duplicate events, cycles, stale reads, external effects, missing rollback, and replay after restart.
7. Walk the operational principles through the UI/API mapping and implementation tests. Look for “near miss” implementations that satisfy simple stories but miss the purpose.
8. Check traceability and drift, then evaluate the strength of the evidence. Lint, tests and bounded model checking support different claims.

Return findings ordered by impact. Each finding includes: concept/rule ID, file/line or trace, expected contract, observed contradiction, smallest counterexample, user consequence, and suggested minimal repair. Classify as design, composition, mapping, implementation, or evidence gap.

Verdict: **BLOCKED**, **READY WITH LIMITATIONS**, or **READY FOR THE REQUESTED SCOPE**. Draft design can be ready for discussion without being ready to ship. List untested claims and missing user evidence explicitly; do not turn speculative concerns into proven defects or blanket approval.
