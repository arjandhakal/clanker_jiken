# Three concrete composition recipes

These are design sketches, not executable DSL or complete production contracts. They complement the runnable free-composition example.

## 1. Free: Task + Label

- Purposes: track unfinished work; retrieve overlapping categories.
- Rule: Task.remove(item) → Label.clear(item).
- Binding: the same stable item ID; not the task's text or current list position.
- Trace: add(a), affix(a, urgent), complete(a), find(urgent) includes a; remove(a), clear(a), find(urgent) excludes a.
- Counterexample without rule: a removed item reappears in search.
- Intentionally absent rule: completing does not clear categories.
- Implementation: immediate publication after both transitions, as in the runnable example. Label.clear is total on valid IDs, so it cannot be disabled by an unlabeled item.

## 2. Collaborative: Inbox + Task

- Inbox purpose: make addressed messages available to recipients.
- Task purpose: remember work to complete.
- Rule: a successfully received message addressed to a dedicated task inbox results in a task being added.
- Guard: recipient equals the designated inbox; ordinary mail does not create work.
- Bindings: message ID → correlation key; immutable message content → task content; allocate a separate fresh Task ID.
- Trace: receive(otherInbox, m1) creates no task; receive(taskInbox, m2) creates t2 with intended content.
- Counterexample: a rule with no recipient guard turns all incoming messages into tasks.
- Idempotency: if receive-completion delivery repeats, do not create another task. Do not use content equality as an identity key: two identical messages can express two distinct requests.
- Failure: if receiving already committed in an external mail service, claiming immediate atomicity with local task creation is false. Model task-import-pending and failed/retry states explicitly, or keep the rule abstract until an implementation contract is chosen.
- Cancellation and lifetime: define whether deleting the source message affects the task; default to independence rather than inventing a deletion cascade.

## 3. Synergistic: WorkStatus + Label

Goal: reuse the general label query language for status queries rather than building a second query subsystem.

Independent variants:
- WorkStatus[Item] owns a pending/done status and exposes register, finish and reopen. finish and reopen are idempotent on existing items.
- Label[Item, Tag] owns item/tag membership and exposes affix, detach and find. affix/detach are idempotent.

Application uses the reserved tag pending:
- register(i) → affix(i, pending).
- finish(i) → detach(i, pending).
- reopen(i) → affix(i, pending).
- a user detach(i, pending) → finish(i).
- a user affix(i, pending) → reopen(i).

Post-transaction invariant: i is pending in WorkStatus iff Label contains (i, pending).
This is an invariant **to establish through actions**, not permission to write either concept's state from the other.

### Resolve the reciprocal-rule trap

Naive handlers recursively emit finish/detach forever. Choose and document a finite semantics:
- user-origin boundary commands dispatch one appropriate paired transition;
- generated response actions retain the same causation ID and are not reinterpreted as new user commands;
- each transaction applies its declared pair at most once;
- both transitions check preconditions and publish together.

This origin-sensitive finite coordinator is an implementation design choice, not an assertion that unqualified reciprocal trigger/response rules magically terminate. If additional rules can fire on these actions, specify and reanalyze the expanded rule set.

### Trace and control

Register a and b; affix(a, urgent). Query pending AND urgent returns a. Finish a; pending query now excludes a while urgent still includes a. User affixes pending to a; a reopens.

Deletion requires separate lifetime bookkeeping; these rules alone do not solve it. Protect the reserved tag from arbitrary renaming/removal, or define exactly how such actions map to status changes. Explain that changing this special tag changes work status; ordinary tags do not.

The synergy is unified retrieval and interaction. Physical deduplication of status storage is optional: only derive status from labels if an explicit representation mapping preserves both concept contracts. Do not sacrifice integrity to save a column.
