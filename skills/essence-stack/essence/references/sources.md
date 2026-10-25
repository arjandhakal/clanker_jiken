# Design conventions and references

## Skill organization

[backnotprop/pstack](https://github.com/backnotprop/pstack) inspired the focused skill organization: independently useful modules, explicit cooperation, and selective reference loading. Essence does not copy its prompts, require it to be installed, or assume its agent tools and models.

## Format and discovery

- [Agent Skills specification](https://agentskills.io/specification).
- Pi documentation: `docs/skills.md`, `docs/settings.md`, `docs/configuration.md`, `docs/packages.md`.

Each leaf contains a discoverable SKILL.md. The complete sibling set shares resources inside the essence directory. The installer defaults to Pi's global skills directory.

## Design conventions

The stack uses purpose, operational principle, private state and explicit actions to define independent concepts. Immediate synchronization constrains valid action traces. Asynchronous workflows require additional pending/failure semantics and are not interchangeable with immediate synchronization.

Artifact contracts, stable action IDs, bounded handoffs, concurrency checklists, migration plans and content-hash baselines make these ideas practical for iterative development. They are conventions to apply with judgment, not a guarantee of correctness or a required deployment architecture.

## Tooling

Use Babashka for small local scripts and Clojure for the runnable reference model and tests. Runtime tooling uses only libraries bundled with Babashka; no dependency download is needed. Keep application implementation consistent with the target project's language.

No compiler, synchronization framework, formal proof, or background watcher compatibility is implied. Tests establish their documented examples and bounds, not correctness of arbitrary generated software.
