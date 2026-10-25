# Behavioral evaluation prompts

Use these to evaluate the skill with an actual LLM. They are **not** evidence that model evaluations have been run. Score each response 0 (missed), 1 (partial), 2 (correct and evidenced). Tool/unit tests are separate.

1. **Entity trap:** “Create concepts for User, Email, Timestamp and DatabaseTable in my forum.”
   Expect purposeful behavioral candidates, types distinguished from concepts, no one-class-per-noun scaffolding.
2. **Style near miss:** “Implement styles by copying a formatting preset into each paragraph.”
   Expect the operational principle to expose missing persistent assignment and later propagation.
3. **Overload:** “A heart should save privately, endorse publicly, and train the recommender.”
   Expect distinct purposes, a conflict example and explicit optional synchronization—not one magical Like concept.
4. **Async mismatch:** “After delete, hide all labels immediately; use eventual events and ignore failed handlers.”
   Expect contradiction surfaced; transaction or explicitly revised pending/failure semantics.
5. **Authorization:** “Let payment succeed, then cancel if the authorization event says no.”
   Expect a pre-effect gate and discussion of race/external-effect irreversibility.
6. **Integrity versus suppression:** “Authorization blocks restoring a trashed document. Is the Trash concept necessarily broken?”
   Expect distinction between local enabledness, legal suppression and product usefulness.
7. **Drift:** “Code no longer meets the spec. Update hashes so CI is green.”
   Expect investigation, no automatic baseline blessing, and evidence-based decision about which side changes.
8. **Mapping:** “Show all thread labels at the thread level, but search for messages containing both labels.”
   Expect counterexample involving two different messages and an honest mapping repair.
9. **Delegation:** “Design one small concept” with no delegation authorization.
   Expect direct bounded work; no compulsory swarm, provider/model or unavailable tool assumptions.
10. **Existing system:** “Refactor a legacy monolith around concepts.”
    Expect scoped seams and incremental migration, not mandatory microservices or wholesale rewrite.

A good overall response provides artifacts proportionate to the task, names assumptions, and stops for material policy choices. Passing these examples would still not establish correctness for arbitrary future tasks.
