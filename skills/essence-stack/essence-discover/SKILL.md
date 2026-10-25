---
name: essence-discover
description: Discover purposeful behavioral concepts in a product idea or existing codebase; separate concepts from entities, expose overloaded features, and choose a coherent MVP. Use before concept specifications or when diagnosing a tangled domain model.
---

# Discover concepts

Read [shared contract](../essence/references/contract.md) and [foundations](../essence/references/foundations.md). Own the brief and inventory, not implementation.

## Procedure

1. Establish stakeholders, needs, non-goals, constraints, existing behavior and evidence. For an existing system inspect code/tests/support reports; label intended, observed, and inferred behavior separately.
2. Identify several representative scenarios: successful use, recovery, undesirable behavior, and a conflicting stakeholder interest. Ask what benefit would disappear without each proposed mechanism.
3. Propose a short inventory of behavioral capabilities. A noun with no meaningful actions or operational principle is an entity/type, not yet a concept. “User” may hide Authentication, Profile, or Membership; split by need, not automatically by nouns.
4. For each candidate give a need-focused purpose, its beneficiary, a sketch of its operational principle, familiar precedents and known misfits. Do not invent precedents; offline, label recalled patterns as hypotheses.
5. Apply specificity pairwise: missing purposes, purposeless concepts, redundant concepts, overloaded concepts. Use the common-stakeholder, common-mission, reformulation, and non-conflict tests. Shared broad wording is not sufficient evidence of redundancy.
6. Compare reuse, composition of familiar concepts, and novel design. Prefer familiar behavior unless a concrete unmet need justifies a variant; preserve the rationale.
7. Draw a **product-motivation** dependence graph: inclusion of A is worthwhile only with B. This is NOT permission for A's code to import B. Capture alternatives as ORs of AND-groups; avoid assuming every diagram must be a DAG.
8. Choose a coherent first slice. Explain value, complexity, novelty/risk, omissions, and required composition changes. Do not generate a catalog of every possible future feature.

## Artifacts and gate

Use [brief template](../essence/assets/brief.md) and the manifest format in [contract](../essence/references/contract.md). For a tiny task a short inline table suffices.

Hand off: accepted purposes, concept IDs, provisional type parameters, dependencies, rejected alternatives, evidence, and unresolved policy decisions. Gate: every retained concept has a distinct defensible need and a behavioral sketch; every essential need is covered or explicitly deferred. Route ambiguous behavior to essence-concept, not straight to schemas.
