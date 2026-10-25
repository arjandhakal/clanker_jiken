# Synchronization: clear-labels
Status: accepted teaching contract

## Intent
Free composition/existence bookkeeping: a removed task must not appear in label queries. Completion leaves labels unchanged, preserving retrieval of finished work.

## Participants
task: Task[Item]; label: Label[Item, Tag]. Actions task.remove and label.clear share the same immutable Item value.

## Trigger
A valid task.remove(item) transition within execute!. It is staged, not committed to observers before the response.

## Guard and bindings
Match every successful staged remove. Bind response.item = trigger.item. No foreign-state reads or tenant assumptions; this example models one local instance and no tenants.

## Response
Immediately perform label.clear(item). It is always locally enabled for a valid Item. Append task.remove followed by label.clear to the new aggregate history only after both pure transitions succeed.

## Consistency and failure
In-process immediate composition. The pure transition returns new concept state, history and receipt together; swap! atomically publishes that aggregate. Queries dereference the same atom once. If clear throws, nothing is committed. A corrected retry can succeed. No network or durable side effects.

## Concurrency and termination
One remove produces one clear; clear triggers no further rule. Thus this cascade terminates after one response. Repeated request IDs return prior receipts without another committed transition; conflicting payloads are rejected. swap! may recompute pure transitions under contention, so no external effects are allowed inside them. Receipt history is volatile and unbounded.

## Preserved integrity
Each action uses its own concept's public pure function. Projection of the committed application log yields valid local traces. At published boundaries every labeled item is live because affix is application-gated and remove clears all labels. This product invariant is stronger than either local invariant.

## Traces and evidence
remove-labeled-task, failed-clear and duplicate-request traces link to test_model.clj. Failures and in-process duplicates are tested. Process crashes/restart recovery, external effects and distributed consistency are explicitly not promised.
