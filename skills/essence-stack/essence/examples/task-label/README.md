# Worked example: Task + Label

A small Clojure teaching implementation of independent concepts and free composition, not a production framework.

Task remembers work that is pending or completed. Label supports retrieval by overlapping categories. Completing a task does not remove its labels. Removing a task synchronizes with clearing its labels, so search cannot return a nonexistent task.

## Run

Requires Babashka; no dependency downloads:

```sh
bb <essence-skill-dir>/examples/task-label/test_model.clj
bb <essence-skill-dir>/scripts/essence.clj check <essence-skill-dir>/examples/task-label --strict --require-tests
```

Inspect `design/essence/manifest.json` for artifact/code/test links. The templates elsewhere are drafts; these documents are filled examples.

## Semantics

Independent immutable state machines expose pure functions. A pure application transition stages task-remove and label-clear, then publishes the complete state, history and request receipt through one atom update. If a transition throws, the atom is unchanged. Snapshot reads dereference that same atom once.

Under contention, `swap!` may recompute the transition. The transition must therefore remain pure: no external effects, event publication or mutable concept stores inside it. Only the committed aggregate state counts as successful action history.

Request IDs suppress repeated successful requests *within the lifetime of this process*. Reusing a request ID with another payload is rejected. IDs of removed tasks cannot be reused. Affixing to a nonexistent task is blocked by the application, while Label alone works on opaque IDs without depending on Task.

`test_model.clj` includes local principles, rejection/frame behavior, rollback on response failure, deduplication, a concurrent duplicate test, an explicit missing-rule counterexample and enumeration of 1,296 four-request sequences with local trace projection/replay.

## Limits

No persistence, restart recovery, distributed delivery, real UI, external effects or user authorization. A local atom does not establish network-wide atomicity. Bounded enumeration is not proof for arbitrary traces. Memory for histories/receipts/retired IDs is unbounded. Treat the atom as private application state and interact through the public functions.

The example demonstrates one free composition, not a universal synchronization engine. See the composition guide for collaborative and synergistic patterns.
