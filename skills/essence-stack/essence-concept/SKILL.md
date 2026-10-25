---
name: essence-concept
description: Specify a reusable software concept with one purpose, an operational principle, private state, typed actions, preconditions, effects, and invariants. Use to create, refine, split, or test concepts independently of an application.
---

# Specify one concept

Read [shared contract](../essence/references/contract.md), [foundations](../essence/references/foundations.md), and [concept template](../essence/assets/concept.md). Read only the relevant brief, catalog entries, and existing spec.

## Procedure

1. Name the concept and type parameters. Express its purpose as a specific user need, not an action (“save”) or implementation (“store rows”). Identify whose need it serves.
2. Write the **operational principle first**: a parameterized minimal scenario that demonstrates why this concept is worth having. Include assumptions and invalidating intervening actions. A Style principle must change a style *after* assigning it to multiple elements; merely applying a preset does not demonstrate consistent ongoing formatting.
3. Derive the memory necessary to support that behavior. Define sets, relations, multiplicities, identity, initial state, derived observations, and invariants. Do not import a global domain schema.
4. Define each public action: stable name, typed inputs/outputs, generated identities, actor, enabled condition, effect, unchanged state (frame), failure/no-op behavior and observations. Distinguish precondition rejection from successful no-op; rejection cannot emit a success event.
5. Keep semantics deterministic given the named inputs and state. Model clock/random/external outcomes as explicit inputs or external completion actions. Share opaque IDs or immutable values, never mutable foreign objects.
6. Concept specs may refer to generic types, not another concept's actions/state. Move cross-concept policy and behavior into a proposed synchronization. Within code, queries may expose immutable observations through public interfaces.
7. Challenge the design with counterexamples: repeated action, empty state, removal/restoration, stale identity, conflicting actor, boundary time, and interleaved unrelated actions. State whether permissions belong here or in a separately composed authorization concept.
8. Compare familiar variants. Split an overloaded concept only if the smaller purposes and operational principles actually become clearer.

## Gate and handoff

Deliver the spec and at least a purpose-demonstrating trace, a negative/precondition trace, and a boundary/recovery trace. List any policy choices explicitly. Mark draft until missing effects, identity, or lifecycle decisions are resolved. The receiving composition skill gets stable action signatures, preconditions, observations and guaranteed invariants—not an instruction to “call other concepts as needed.”

A passing trace test proves one tested instance, not every instance of the operational principle. For high-risk designs consider an explicit Alloy/TLA+/other model with actual tool results; do not label pseudocode as executable formal syntax.
