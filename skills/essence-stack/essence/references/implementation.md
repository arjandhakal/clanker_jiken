# Implementation playbook

Use the existing language/framework. A concept is usually a module with a store, public transitions and immutable observations. It need not be a microservice.

## Suggested shape, not mandatory file names

```text
concepts/task/            # state + actions + tests; no Label import
concepts/label/           # generic item IDs; no Task import
composition/task-label/  # instances, bindings, rules, authorization/gates
adapters/                # UI/API/CLI and external infrastructure
tests/composition/       # purpose traces, failure/race and projection checks
```

Infrastructure interfaces are allowed. The prohibition is on hidden concept-to-concept behavior and foreign-state mutation, not all imports or all shared utility code. Do not split an existing system into services solely to meet a directory diagram.

## Workflow

- Translate the agreed action contract into focused tests before or alongside code.
- Check enabledness and effect in the same atomic boundary. Read-check-write without isolation is insufficient for scarce resources.
- Reject invalid inputs without state change or successful completion events.
- Keep effect identifiers/observations precise; tests should assert values, not just “did not throw.”
- Keep generated identities stable across retries where the application promises idempotency.
- Protect read paths too: no stale deleted objects should reappear if the contract promises immediate cleanup.
- Synchronization handlers invoke target actions; they do not write the target's storage directly.
- Use durable outbox/transactional publication only when needed by the chosen consistency contract; do not prescribe it as boilerplate.
- Preserve permissions and data isolation in both normal actions and replay/recovery.
- If integrating existing code, adapt at boundaries and label known conceptual debt instead of doing an unauthorized rewrite.

## Test layers

1. **Local transition tests:** initial state, precondition rejection, effects, frames.
2. **Operational-principle tests:** the minimally convincing scenario, not just CRUD.
3. **Invariants/property tests:** generated legal action sequences and illegal requests.
4. **Composition traces:** successful coordination, binding errors, missing cleanup.
5. **Failure/concurrency tests:** target failure, re-delivery, duplicate key conflict, interleaving, crash/restart if promised.
6. **Mapping tests:** action arguments from real interactions; displayed success matches durable guarantees.
7. **Migration tests:** old state/events map to new semantics without losing critical invariants.

Project an integrated trace onto each concept and replay against its reference model where feasible. For optimized/shared storage, compare observations with an independent model. Do not make both production and oracle code share the same bug-prone transition helper.

For high-risk protocol behavior, a small formal model may be worthwhile. Document model scope, bounds, fairness assumptions and actual tool outputs; do not report formal proof from a diagram or pseudocode.
