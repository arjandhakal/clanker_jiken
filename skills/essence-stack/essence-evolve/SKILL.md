---
name: essence-evolve
description: Evolve a concept-driven system and reconcile concept specs, synchronization rules, interfaces, code, and tests after changes. Use for design/code drift, concept migrations, adding or splitting concepts, and preserving operational principles across refactors.
---

# Evolve and reconcile

Read [shared contract](../essence/references/contract.md) and [evolution guide](../essence/references/evolution.md). This is **artifact reconciliation**, not automatic two-way data synchronization.

1. Inspect the change request, journal, current specs, code/tests, and prior baseline if present. Run `drift` read-only before modifying anything.
2. Classify the delta: purpose change, new/removed concept, action contract, synchronization, UI mapping, implementation-only, or documentation correction.
3. Trace impact in both directions: changed spec → rules → mappings → code/tests; changed code → observed semantics → spec and decisions. Hash changes are signals to investigate, never instructions to overwrite a side.
4. If code and spec disagree, determine which behavior is authorized from intent and evidence. Preserve disagreement as a decision when unclear. Do not change the specification merely to make failing tests pass.
5. Recheck purpose coherence and familiar variants. If behavior truly changes, version the contract or record an explicit migration; do not disguise a new concept as a harmless refactor.
6. Plan schema/state conversion, identity retention, compatibility, replay of old events, data loss risks and rollback. A rollback that cannot restore deleted data is not complete.
7. Select only the affected sibling skills, update the same accepted behavioral slice across artifacts, and run standalone plus composition regression tests.
8. Update the journal with why, alternatives, counterexamples, and migration evidence. Re-run review. Only then record a new baseline with `baseline --ack-reviewed`.

Stop if an irreversible migration, unknown external contract, or unresolved product-policy change needs approval. Preserve work and state exactly what remains.

Deliver: before/after behavior, affected concept/rule IDs, migration/rollback notes, changed paths, actual validation, unresolved drift, and new baseline status. Baselines are local content fingerprints; they do not monitor files or prove semantic agreement.
