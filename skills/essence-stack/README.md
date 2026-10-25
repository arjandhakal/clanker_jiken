# Essence skill stack

An agentic concept-design workflow organized as focused, cooperating skills inspired by [pstack](https://github.com/backnotprop/pstack).

**Create behavioral concepts, compose them with explicit synchronizations, implement and test them, then reconcile design and code as they evolve.** Not a knowledge-graph ontology, background sync service, or synchronization runtime.

## Install globally in Pi

From this checkout, with [Babashka](https://babashka.org/) installed:

```sh
bb skills/essence-stack/essence/scripts/install.clj
```

Creates eight non-overwriting symlinks in `~/.pi/agent/skills/` (or `$PI_CODING_AGENT_DIR/skills` when configured). No settings edits, dependency downloads or network calls. Keep this checkout in place: skill changes are visible through the links after reload.

In Pi, use `/reload` or start a new session. Do not install the same names into both Pi and shared discovery locations. For shared Agent Skills discovery instead, pass `--target-dir ~/.agents/skills`. To move an existing installation, install into the new directory, then remove only the old owned links using `--uninstall --target-dir <old-directory>`.

Uninstall only links owned by this checkout:
```sh
bb skills/essence-stack/essence/scripts/install.clj --uninstall
```

The complete eight-skill set must travel together: sibling references point to shared resources inside `essence/`. Each leaf is a valid Agent Skills directory, but is not independently packaged.

## Start using it

```text
/skill:essence Design a shared reading-list app as concepts that synchronize.
/skill:essence-concept Specify a reusable Reservation concept.
/skill:essence-compose Compose Reservation, Payment and Notification; make failures explicit.
/skill:essence-build Implement the accepted concept design using this project's stack.
/skill:essence-review Find concrete counterexamples in this design and its code.
/skill:essence-evolve Reconcile our changed code with the concept specifications.
```

Natural language also triggers the relevant skill. Non-Pi agents can read the same SKILL.md instructions, but their invocation commands differ.

## Responsibilities

| Skill | Owns |
|---|---|
| essence | Routing, scope, integration and completion |
| essence-discover | Needs, concepts, alternatives and coherent subsets |
| essence-concept | Purpose, operational principle, state and actions |
| essence-compose | Action synchronizations, bindings and failure semantics |
| essence-map | UI/API/CLI action and state mapping |
| essence-build | Isolated implementation and tests |
| essence-review | Specificity/familiarity/integrity critique and evidence |
| essence-evolve | Impact, migrations, design/code reconciliation |

The skills cooperate through durable artifacts, not automatic agent spawning. Only load what the task needs. Delegation remains subject to user/project authorization.

## Included

- Concise entry skills and selectively loaded technical guides.
- Templates for concepts, synchronization rules, traces, mappings and reviews.
- Babashka artifact checker, initializer, drift baseline and installer, using bundled libraries only.
- Runnable Clojure Task + Label example with pure transitions, atomic in-process composition and regression tests.
- [Evaluation prompts](essence/references/evaluations.md) for checking an LLM's behavior with this stack (not yet run as model evaluations).

Prefer Babashka/Clojure for quick utility scripts; application code should follow the target project's language.

See [usage and tool guarantees](essence/references/usage.md), [design conventions](essence/references/sources.md), and [example](essence/examples/task-label/README.md).

## Validate the package

Run from any directory using the appropriate path to the script:

```sh
bb skills/essence-stack/essence/tests/run.clj
bb skills/essence-stack/essence/examples/task-label/test_model.clj
bb skills/essence-stack/essence/scripts/essence.clj check skills/essence-stack/essence/examples/task-label --strict --require-tests
```

The first command runs both tooling and model tests. The second runs only the example tests. See [validation](VALIDATION.md) for executed checks.

The artifact checker checks structure/paths and tracks content changes. It does not execute project tests, prove semantics, watch files, or guarantee model quality.
