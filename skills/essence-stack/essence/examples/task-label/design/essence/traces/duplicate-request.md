# Trace: duplicate-request
Status: accepted teaching contract

## Purpose
Demonstrate the explicitly bounded in-process retry contract.

## Setup
New Application. A caller holds request ID r1.

## Steps
execute(r1, add, a); repeat execute(r1, add, a); attempt execute(r1, add, b).

## Expected observations
The first call creates a. The second returns the same receipt with no new transition. The conflicting third call is rejected; b is not created.

## Projection and invariants
Task sees one add(a), not two; Label sees no transitions. This is request-boundary deduplication, not a relaxation of Task.add's fresh-identity precondition.

## Implementation evidence
duplicate-request-and-conflicting-payload and in-process-concurrent-duplicate-is-atomic in test_model.clj. No restart-durability claim.
