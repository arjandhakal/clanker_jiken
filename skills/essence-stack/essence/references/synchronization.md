# Synchronization design and implementation semantics

## Abstract meaning

Start with the interleavings of valid traces of independent concept instances. A rule constrains them. In the immediate synchronization model, a matching trigger occurrence must be followed immediately by its response action(s), with arguments appropriately bound. This removes invalid/unwanted interleavings. It does not authorize another concept to edit private state.

Illustrative notation only, **not a compiler input**:
```text
sync clear-labels
  on Task.remove(item) successfully occurring
  then Label.clear(item)
```

A rule can guard on trigger arguments and observable state. Say explicitly whether a lookup is evaluated before or after the trigger. Pass immutable snapshots or opaque identities. Arguments referring to objects need legitimate provenance: generated now or previously generated/returned, not a fabricated ID for a future object.

“On success” in this abstract description does not require exposing a committed trigger before its consequences. If a mandatory response is disabled, the synchronized transition cannot complete as promised. Reject the whole operation or define another explicit behavior; do not leave half an allegedly synchronous transition committed.

## Three levels of composition

- **Free:** largely independent behavior plus bookkeeping, e.g. delete an item and clear its labels.
- **Collaborative:** automate distinct purposes, e.g. a received message creates a task.
- **Synergistic:** reuse a concept's functionality to fulfill another's purpose more uniformly, e.g. a special label makes status queryable through existing label queries.

For every tighter coupling, show what the user gains and loses. Deleting an invitation is not necessarily declining and notifying its sender. Good synergy is not a reason to remove independent actions without thought.

## Required implementation choice

**Immediate/transactional.** A coordinator checks and executes rules within an isolation boundary so no observer sees a forbidden interleaving. Specify transaction scope, ordering, rollback and external-effect boundary. Public concept action calls execute the transitions; the coordinator does not implement them by writing their tables. A single-threaded reference model is not a concurrency proof.

**Asynchronous refinement.** Explicitly revise the application contract to include pending, failed and recovery behavior. Specify durable event/outbox publication, delivery guarantees, idempotency key and retention, retry/backoff limits, dead-letter handling, cancellation/compensation and query visibility. Explain what guarantee replaced “immediate.” Do not claim network-wide atomicity or exactly-once effects from an in-memory set.

A compensating action is another real action, not erasure of history. Sent email, exposed secrets and externally settled payments may not be reversible. If the needed guarantee cannot be provided, stop and expose the trade-off.

## Audit each rule

1. Instance-qualified action names and typed inputs/outputs.
2. Trigger lifecycle: request, enabled transition, committed completion or failure—not an ambiguous “event.”
3. Guard and immutable argument bindings, including authorization/tenant scope.
4. All response preconditions; behavior when one fails.
5. Ordering, observable intermediate states and consistency model.
6. Duplicate/retry identity, origin and causation for cascades.
7. Termination and concurrency: A→B→A loops, fan-out, multiple rules on one trigger.
8. Lifetime: create-before-reference, deletion, restoration, reuse of IDs, revocation and expiration.
9. Read paths: can a query run between a deletion and cleanup?
10. Evidence: successful trace, counterexample without the rule, useful trace excluded by it, failure/race/duplicate traces as applicable.

## Integrity versus availability

Project the full application trace onto each concept by retaining only its actions/observations. The result must be a legal standalone trace. Then ask separately whether operational principles remain achievable in the product.

An authorization gate can legitimately prevent an otherwise locally enabled action. That is not by itself an integrity violation, though an overrestrictive gate may defeat the product's purpose. If a result is silently changed without a corresponding legal action, that *is* an integrity violation.

## Avoid easy traps

- An event bus is a transport, not a synchronization semantics.
- Shared tables/objects are hidden communication unless covered by an explicit, tested representation refinement.
- Bidirectional sync is not two unguarded reciprocal callbacks.
- Data replication additionally needs authority, conflict resolution, tombstones, identity and retention. Never assume replication is backup.
- UI disabling is not server-side enforcement.
- A concept with no peers should remain independently understandable and testable.
