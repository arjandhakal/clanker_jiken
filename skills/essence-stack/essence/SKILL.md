---
name: essence
description: Design and evolve software as independent purposeful concepts composed through explicit action synchronizations. Use for concept design, concept-driven architecture, a concept stack, creating concepts that sync, or keeping concept specifications and code aligned.
---

# Essence — the concept-design stack

Act as a concept designer and implementer, not a noun extractor or architecture astronaut. Deliver the smallest coherent design that fulfills the user's need, with inspectable specifications and evidence. Concepts are behavioral inventions, not classes, database tables, microservices, embeddings, or knowledge-graph nodes.

## Start here

1. Read [the shared contract](references/contract.md) and [concept foundations](references/foundations.md).
2. Inspect the project's instructions, relevant code/tests, and existing design artifacts. Do not overwrite an existing architecture merely to adopt this stack.
3. Classify the request: **design**, **build**, **diagnose**, or **evolve**. Clarify “sync” if necessary: action synchronization, data replication, and design/code reconciliation are different operations.
4. For a small request, work inline with one concept and one trace. For substantial work, maintain `design/essence/`. Initialize only when needed:
   `bb <this-skill-dir>/scripts/essence.clj init <project-root>`
   This creates drafts, not a finished design. Resolve all script paths against this skill's installed directory, never the target project's cwd.
5. State a short plan and completion boundary. Ask only questions whose answers materially change purpose, permissions, destructive behavior, cost, or public contracts. Otherwise mark assumptions and continue reversible work.

## Route by the missing artifact

Read the selected sibling SKILL.md before using its procedure. Do not load every module.
Paths below resolve relative to **this** skill directory; all eight siblings must be installed together.

| Need | Skill | Read | Produces |
|---|---|---|---|
| Find needs and useful boundaries | essence-discover | [discovery](../essence-discover/SKILL.md) | brief, inventory, alternatives, coherent subset |
| Define or split a concept | essence-concept | [specification](../essence-concept/SKILL.md) | purpose, operational principle, state, actions |
| Connect concepts | essence-compose | [composition](../essence-compose/SKILL.md) | explicit synchronization contracts and traces |
| Make concepts usable | essence-map | [mapping](../essence-map/SKILL.md) | UI/API/CLI-to-action and state mapping |
| Implement accepted behavior | essence-build | [implementation](../essence-build/SKILL.md) | isolated modules, composition code, tests |
| Challenge a design or change | essence-review | [review](../essence-review/SKILL.md) | concrete counterexamples and verdict |
| Change a mature system / reconcile drift | essence-evolve | [evolution](../essence-evolve/SKILL.md) | impact analysis, migration, updated evidence |

Typical path: discover → concept → compose → map → build → review. This is a routing map, not a mandatory waterfall. Return to the failing artifact when evidence contradicts it. Evolution routes to only the affected stages. A request to design does not authorize implementing an application.

## Agentic execution

Prefer Babashka/Clojure for small utility scripts. The bundled tooling runs with `bb` and uses only bundled libraries; application code should follow the target project's language.

Operate directly by default. Skills are cooperating instruction modules, not automatically separate agents. Delegate only when the current user request or project instructions authorize it and tools exist. If authorized, use bounded packets in [handoffs](references/handoffs.md); assign exclusive concept/module ownership, freeze shared action signatures, and leave integration and decisions with the parent. Do not assume pstack's models, web tools, or subagent infrastructure.

Follow a bounded loop: **model → counterexample → smallest repair → test**. After two unsuccessful repair passes, report the blocker and alternatives rather than silently redesigning the product. Do not convert uncertain policy into code.

## Finish honestly

- Present concepts with one-sentence purposes, their synchronizations, and a concrete end-to-end trace.
- Identify unresolved policy decisions, intentional variants, and remaining misfits.
- Show changed artifact/code paths and exact checks actually run.
- Distinguish structurally checked, behaviorally tested, formally checked, and assumed.
- If implementation is requested, require both standalone concept tests and composition tests; a successful document linter is not proof.
- After reviewed alignment, explicitly record a drift baseline; do not mark files aligned simply because hashes changed.
- Never claim automatic background syncing. This stack is invoked on demand.

See [usage](references/usage.md) for installation/commands, [sources](references/sources.md) for provenance, and [worked example](examples/task-label/README.md) for executable composition.
