# Shared artifact and execution contract

All modules use this contract. Read only artifacts relevant to the task. The coordinator owns integration and scope; each specialist owns the artifacts named in its skill. There is no hidden cross-agent memory.

## Meaning of “concept”

A concept is a purposeful, independently understandable behavioral unit with its own state and actions. Its application-specific inclusion may depend on another concept being useful, but its definition and implementation must not need that other concept's internals.

Do not confuse:
- conceptual action synchronization (coordinating independent machines);
- a data replication concept (propagating copies/updates, with its own conflicts and deletion rules);
- artifact reconciliation (keeping intended behavior and implementation aligned).

## Working directory

Default project workspace:
```text
design/essence/
  brief.md
  manifest.json
  concepts/<id>.md
  synchronizations/<id>.md
  traces/<id>.md
  mapping.md
  decisions.md
  journal.md
  review.md
  .baseline.json           # generated only after explicit alignment review
```

Do not initialize a large workspace for a one-paragraph question. Existing equivalent project documents can remain canonical; point the manifest at them and adapt headings deliberately. Never duplicate competing canonical specifications.

## Ownership and handoffs

- discover owns brief and candidate inventory;
- concept owns independent concept contracts;
- compose owns application instances, type bindings and synchronization contracts;
- map owns interaction mappings;
- build owns code/tests and their traceability;
- review records counterexamples and gate evidence;
- evolve owns change impact, migrations and journal;
- coordinator alone integrates shared manifest changes during parallel work.

All artifacts distinguish **proposed**, **accepted**, **implemented**, and **verified for a stated scope**. “Accepted” means a recorded design decision, not automatically user approval; changes requiring explicit permission still need it. Never invent approval. Facts, inferences and assumptions are visibly separate.

A handoff says: inputs read, outputs written, stable contracts, evidence/checks, unresolved decisions, and next recommended action. It does not copy the full conversation or research corpus.

## Manifest v1

JSON is an index and traceability graph, not a second copy of every spec. Paths are **project-root relative**, must resolve to files inside the project, and cannot contain parent traversal. Concept actions are declared once in Markdown as `### action-id` under `## Actions`; signatures/details go in the section body.

```json
{
  "schema_version": 1,
  "concepts": [
    {
      "id": "task",
      "spec": "design/essence/concepts/task.md",
      "requires_any": [],
      "implementation": ["src/task.ts"]
    }
  ],
  "synchronizations": [
    {
      "id": "clear-labels",
      "spec": "design/essence/synchronizations/clear-labels.md",
      "participants": ["task.remove", "label.clear"],
      "implementation": ["src/composition.ts"]
    }
  ],
  "traces": [
    {
      "id": "remove-labeled-task",
      "spec": "design/essence/traces/remove-labeled-task.md",
      "concepts": ["task", "label"],
      "synchronizations": ["clear-labels"],
      "tests": ["tests/composition.test.ts"]
    }
  ],
  "mappings": ["design/essence/mapping.md"]
}
```

The abbreviated illustration omits the Label entry; real manifests must include every referenced concept. IDs use lowercase kebab-case and are stable. For repeated generic concepts, give **instances** distinct IDs/specs and describe generic origin/type bindings in each spec.

`requires_any` is an OR-list of AND-lists: `[["post"], ["photo", "album"]]` means inclusion makes sense with Post OR with both Photo and Album. Empty outer list means no motivation prerequisite. This encoding captures alternative inclusion justifications; it is not a code import graph. Every named dependency must be inventoried, even if deferred to a future coherent slice; choose slices by writing a slice-specific manifest.

Implementation and test lists may be empty for design-only work, but do not claim implementation coverage. The strict build check requires mappings, each concept/rule to have code references, and each concept/rule to be covered by a trace with test references. It checks paths, not test assertions or command execution. Trace documents name exact tests and expected observations for humans.

## Minimal gates

1. **Purpose:** compelling beneficiary and need; alternatives and assumptions known.
2. **Concept:** operational principle, memory, initial state, actions/effects/frames and invariants agree.
3. **Composition:** complete bindings and failure semantics; no forbidden concept trace.
4. **Mapping:** intended actors can exercise principles and interpret observations.
5. **Build:** isolation and integration tests actually run; migration concerns addressed.
6. **Review:** concrete findings resolved or limitations accepted; no fabricated evidence.
7. **Evolution:** design/code differences reconciled before advancing the baseline.

A blocked gate routes upstream; it does not justify creating more scaffolding. High-risk decisions and irreversible effects need explicit approval. Do not commit, push, deploy, contact external parties, run migrations or install dependencies merely because a skill suggests doing so.
