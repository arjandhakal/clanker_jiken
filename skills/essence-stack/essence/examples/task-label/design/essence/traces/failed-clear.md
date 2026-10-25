# Trace: failed-clear
Status: accepted teaching contract

## Purpose
Show a failed mandatory response cannot leave a committed trigger behind.

## Setup
Task a exists and has label urgent. Capture immutable snapshot and event history. Inject an exception into Label.clear for this test only.

## Steps
Request remove(a). Stage task.remove. label.clear raises. Reject request, discard staged changes, publish no successful events. Restore the normal transition and retry the same request ID.

## Expected observations
After failure both task and labels remain exactly as before. History is unchanged. Corrected retry removes both task and labels.

## Projection and invariants
There is no successful remove in either log on the failed request. After retry the usual remove/clear projections apply. Failure injection is an implementation fault, not an invented legal Label transition.

## Implementation evidence
failed-response-does-not-publish-trigger in test_model.clj uses with-redefs to inject a transition exception and asserts unchanged aggregate state plus successful retry.
