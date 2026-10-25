---
name: essence-compose
description: Compose independent software concepts through explicit action synchronizations while preserving concept integrity. Use for concepts that sync, cross-concept workflows, event rules, existence coupling, authorization gates, and over- or under-synchronization analysis.
---

# Compose without entangling

Read [shared contract](../essence/references/contract.md), [synchronization semantics](../essence/references/synchronization.md), and [sync template](../essence/assets/synchronization.md). Read the participating concept action contracts before writing rules.

## Procedure

1. Inventory named concept **instances** and bind their generic types to shared IDs/value types. Agree on units, time zones, tenant scope and identity lifetime. Two instances of Label are not implicitly the same state.
2. Begin with independent interleavings. Add only the bookkeeping needed to remove nonsense behavior: create-before-reference, deletion cleanup, revocation, and stale results.
3. For each rule name the trigger's lifecycle point, successful result, arguments, predicate, observations used, and the exact target actions and binding expressions. Define pre/post-state observation timing. No unbound variables or “and update everything.”
4. Classify its purpose: free/existence coupling, collaborative automation, or synergistic reuse. Ask both “what bad trace is now excluded?” and “what useful trace is now forbidden?”
5. Specify failure and concurrency semantics. The immediate trigger/response constraint is NOT automatically an asynchronous event handler. Choose a faithful transaction/serialized implementation, or label an explicit asynchronous refinement with visible intermediate states, liveness assumptions, idempotency, retry, cancellation and recovery.
6. For authorization/suppression, prevent the protected action before it commits. An after-the-fact event cannot retract a leaked secret or sent payment. Check races between authorization and effect.
7. Trace cascades and cycles. Either prove a finite/monotonic termination measure, provide safe origin/correlation suppression, or reject the cycle. Arbitrary hop limits are diagnostics, not correctness proofs.
8. For each application trace, project away all other actions and confirm each concept's resulting trace satisfies its own contract. Separately check product usefulness and reachability: integrity alone permits oppressive or useless synchronizations.
9. Consider synergy only after correctness. Retain logical state ownership even if an optimized physical representation derives one concept's state from another; document and test the refinement mapping.

For concrete free, collaborative and synergistic designs, including a terminating reciprocal-label example, read [composition patterns](../essence/references/composition-patterns.md) when needed.

## Gate and handoff

Produce rules with complete bindings, invariant enforcement boundaries, a dependency/cascade map, and traces for success, rejection, duplicate delivery, partial failure and races where applicable. For true synchronous composition, state which asynchronous cases are not applicable and why.

The implementation handoff includes the consistency model and failure policy. Do not leave the coder to choose “eventually consistent” after a design promised immediate cleanup. Route new actions needed for a rule back to essence-concept rather than secretly altering a target contract.
