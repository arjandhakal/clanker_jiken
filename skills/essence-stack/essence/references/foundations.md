# Concept foundations

A practical framework for designing purposeful, independently understandable software behavior.

## The five-part core

**Name and parameters.** Name the invention; use generic opaque types where possible. Reservation can concern resource/user types without knowing restaurants or diners.

**Purpose.** State the human need that justifies inclusion. It should be cogent, need-focused, specific and evaluable. A user's immediate goal is not necessarily the concept's purpose: Trash enables recovery from deletion, not merely removing an item from view.

**Operational principle.** Give a minimal, archetypal behavior that makes the purpose visible. This is stronger than a convenient happy path and narrower than a full requirements suite. Say what intervening actions invalidate its promise. For Style: define a style, attach multiple elements, redefine it, observe all assigned elements change.

**State.** State is memory needed to produce behavior. Use a small local relational model, not an encyclopedia of real-world entities. Shared entities need not imply shared mutable relationships. Spell out initial state and derived versus stored observations.

**Actions.** Specify when each action is enabled and how it transforms state, including what remains unchanged. A rejected action does not occur as a successful concept event. The abstract model uses instantaneous actions and deterministic transitions given state and arguments; real implementations must justify the abstraction.

This stack additionally asks for invariants, explicit failures/frames, traceability, implementation evidence and migration plans. These engineering aids complement the five-part core.

## Three design principles

**Specificity:** aim for one concept per coherent purpose and vice versa. Diagnose:
- mechanism masquerading as a need;
- important need without a concept;
- multiple subtly different concepts doing the same job;
- one concept forced to do conflicting jobs.

Test compound purposes by reformulation, common beneficiaries, common mission, and whether a user can want one effect without the other. Do not mechanically ban conjunctions or conflate different precise purposes under a vague “organize things.”

**Familiarity:** reuse known behavioral inventions, not just names/icons. Prefer composing a familiar concept with another to quietly corrupting it. If a variant is justified, record the changed promise and explain it to users.

**Integrity:** every application trace projected onto a concept's actions/state must be legal for that concept. Composition can suppress behavior, not introduce behavior forbidden by a constituent spec. Integrity does not imply benevolence, product fitness, adequate authorization, or liveness.

## Keep these distinctions

- A noun, entity, record, class, or type is not automatically a concept.
- A feature can cross several concepts; one concept can enable many features.
- Concepts are user-facing design units, not mandatory deployment units.
- Dependence in an application is a justification for co-inclusion, not a need for direct calls.
- Local enabledness does not guarantee global availability after synchronization.
- Tests verify examples; formal checks only establish their modeled/bounded claims; neither proves human usefulness.
- Misfits arise from real contexts and users. Keep counterexamples and rationale in a journal, not only passing code.

## Small catalog of prompts, not ready-made specs

| Candidate | Distinctive need | Purpose-demonstrating behavior | Common misfit |
|---|---|---|---|
| Trash | Recover an item removed by mistake | remove → restore → accessible again | empty/purge or retention expiry defeats recovery |
| Style | Maintain consistent presentation | assign many → redefine once → all change | implementing only a preset |
| Label | Retrieve overlapping categories | affix → query finds; detach → query excludes | group display confused with per-item membership |
| Reservation | Coordinate future use of scarce resources | reserve → no intervening cancellation → use | no-shows, overbooking, clock boundaries |
| Subscription | Receive relevant future changes | subscribe → later event → eligible notification | consent scope, unsubscribe versus queued delivery |
| Authorization | Restrict actions to permitted actors | grant → allowed action; revoke → denial | checking after effect or against stale state |
| Reaction | Convey a response to another person | react → author sees intended response | secretly conflating reaction with ranking/profiling |
| Bookmark | Revisit a resource | save reference → later retrieve | reference mistaken for durable content backup |

Always specify variants, identity and lifecycle for the actual project. These prompts are not complete contracts or endorsements of particular authentication/security implementations.
