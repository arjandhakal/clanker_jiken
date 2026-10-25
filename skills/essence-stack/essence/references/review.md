# Review rubric and counterexample prompts

Use severity proportional to real user impact, not to the elegance of an abstraction. Cite actual evidence.

| Question | Counterexample to seek |
|---|---|
| Does purpose justify the invention? | A simpler mechanism meets the stated need just as well. |
| Is the operational principle distinctive? | Tests apply a style once but never propagate a later change. |
| Are purposes coherent? | User wants private saving without public endorsement. |
| Is redundancy real? | Similar names conceal different lifecycle or privacy guarantees. |
| Is familiarity preserved? | “Sync” copies a pointer rather than the promised content. |
| Is state locally owned? | One concept mutates an object retained by another. |
| Are frames correct? | Completing item A changes labels of unrelated item B. |
| Are bindings scoped? | Same numeric ID in two tenants triggers the wrong action. |
| Are observations timed? | Guard sees prestate in one path and poststate in another. |
| Is authorization preventative? | Sensitive action commits before the gate rejects it. |
| Is cleanup complete? | Query returns removed item between trigger and response. |
| Is a cycle bounded correctly? | A no-op emits another success event indefinitely. |
| Are retries safe? | Retry repeats an external charge after crash before ack. |
| Is idempotency honest? | Same key with different payload silently succeeds. |
| Are lifetimes handled? | Delayed event attaches a label to a deleted/reused ID. |
| Is failure observable? | UI says “done” after only enqueueing a fallible operation. |
| Is synchronization too tight? | Deleting a local invitation notifies an unwanted sender. |
| Is synchronization too loose? | Permission says joinable but discovery gate blocks joining. |
| Is mapping faithful? | Group shows two labels but no member has both. |
| Are migrations reversible? | Rollback loses values discarded by a “cleanup.” |

Report each finding as:
```text
[impact] ID — short title
Evidence: path:line / observed trace / actual failed check
Expected: named action, rule or purpose
Counterexample: inputs and sequence
Consequence: user-visible harm or blocked need
Repair: smallest change, affected artifacts, regression check
```

Distinguish:
- broken design versus faithful implementation of a poor design;
- integrity violation versus legitimate but undesirable synchronization;
- tested contradiction versus plausible risk needing a test;
- correctness for a declared scope versus universal correctness.

Finish with a scope-specific verdict, checks run, evidence gaps and unresolved decisions. Do not require zero cosmetic findings to finish.
