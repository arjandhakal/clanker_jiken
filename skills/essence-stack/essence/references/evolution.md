# Change impact and reconciliation

## Source of truth is scoped, not magical

Accepted concept contracts define intended behavior; code and runtime observations establish current behavior; tests establish only what they assert; user research informs whether the intended behavior meets a need. None automatically overrides the others.

Record the decision when they disagree:
- implementation bug → repair code and add a regression;
- approved requirement change → revise spec, composition, mapping, tests and migration together;
- outdated documentation → correct it with evidence, retaining rationale;
- unknown intent → record uncertainty and ask the owner before risky behavior changes.

## Change checklist

| Delta | Inspect |
|---|---|
| Purpose | need/beneficiary, specificity, alternative concept, operational principle |
| Action signature | callers, sync bindings, UI arguments, events, tests |
| State/invariant | persistence, snapshots, derived views, concurrency, migrations |
| Identity/lifetime | references, tombstones, retry keys, restore, delayed events |
| Synchronization | affected concepts, forbidden/permitted interleavings, cascading rules |
| UI/API wording | state/action mapping, user mental model, compatibility |
| Implementation only | observed behavior unchanged, performance/concurrency contracts |
| Removed concept | motivation dependents, composition wiring, retained data |

Use the manifest as an index, not as an exhaustive impact oracle. Search the code and external interfaces too.

## Baseline tooling

`drift` compares a reviewed content fingerprint with current spec, trace, mapping and declared code/test files. It reports changed, added and removed paths. It does **not** know whether a change is semantic, whether undeclared code matters, or whether tests passed.

`baseline --ack-reviewed` acknowledges that a human/agent has performed alignment review. It does not perform that review. Do not run it simply to make drift output green. Treat an absent baseline as “not established,” not “everything in sync.”

Record significant differences and rationale in `journal.md` and decisions with stable IDs in `decisions.md`. Keep old design lessons: a refactor that loses a known misfit can reintroduce it years later.

For breaking changes, include old/new examples, conversion strategy, compatibility window, replay strategy, rollback limitations and data backup/recovery evidence. Dry-run migration before production and obtain approval for destructive actions.
