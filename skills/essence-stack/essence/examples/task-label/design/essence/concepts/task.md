# Concept: Task
Status: accepted teaching contract

## Purpose
Remember unfinished work and distinguish work that has been completed.

## Parameters
Item is an opaque nonempty string identity. An identity is fresh at most once for the lifetime of this instance. Content editing is outside this minimal variant.

## Operational principle
After add(a), a is live and pending. After complete(a), a is live and done. Completion of a does not complete any other item. Removing a invalidates further completion.

## State
live: set of Item; done: set of Item; seen: set of all identities ever added. Pending is derived as live minus done.

## Initial state
All sets are empty.

## Invariants
done is a subset of live; live is a subset of seen. seen never shrinks.

## Actions
### add
Signature add(item: Item) returns new Task state. Caller supplies a generated fresh identity. Enabled iff item is not in seen. Add item to live and seen; done unchanged. Rejection has no effect. Duplicate identity is rejected, not treated as another success.

### complete
Signature complete(item: Item) returns new Task state. Enabled iff item is live. Insert item into done; live and seen unchanged. Already-completed items are a successful no-op. Missing items are rejected.

### remove
Signature remove(item: Item) returns new Task state. Enabled iff item is live. Remove item from live and done; seen unchanged. Missing items are rejected. This is permanent removal, not Trash/recovery.

## Boundaries
No labels, authorization, presentation or notifications. Local transitions do not contact other concepts.

## Misfits and variants
This minimal concept has no text, deadlines, restore or identity recycling. Persistent systems need a retention strategy for seen IDs. Adding content or recovery requires an explicit extension, not hidden changes.

## Evidence
task-principle-and-frames and removed-identity-not-reused in test_model.clj exercise the principle and identity policy. Bounded projection tests cover selected request sequences, not all possible executions.
