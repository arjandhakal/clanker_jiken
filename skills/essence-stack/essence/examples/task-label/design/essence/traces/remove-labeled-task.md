# Trace: remove-labeled-task
Status: accepted teaching contract

## Purpose
Demonstrate independent task completion and label retrieval, then existence-coupled deletion.

## Setup
Fresh Task and Label, generated item a, tag urgent.

## Steps
task.add(a); label.affix(a, urgent); task.complete(a); observe label.find(urgent) contains a; task.remove(a); label.clear(a); observe label.find(urgent) is empty.

## Expected observations
Completion does not hide a from tag queries. Removal excludes a from both live tasks and tag search. No query observes a removed task with lingering labels.

## Projection and invariants
Task projection: add(a), complete(a), remove(a). Label projection: affix(a, urgent), clear(a). Both are valid alone; done subset live and published label items subset live hold.

## Implementation evidence
remove-cleanup in test_model.clj. projection-replay-and-bounded-interleavings replays local projections for all 6^4 configured request sequences. Run bb test_model.clj from the example root; consult actual command output rather than assuming a stored result.
