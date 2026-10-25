# Validation record

Executed locally with Babashka v1.13.225:

| Check | Result |
|---|---|
| Clojure tooling/package tests | 20 passed |
| Clojure Task + Label model tests | 10 passed |
| Combined suite | 30 tests, 23,333 assertions, zero failures/errors |
| Four-request sequence enumeration inside model tests | 1,296 sequences checked with rejection stuttering, invariants and projection replay |
| Filled example: strict structural/build-traceability gate | Passed |
| Global Pi native skill discovery | 8 skills discovered, no stack diagnostics |
| Relative SKILL.md links from installed locations | All resolved |

Commands from the repository root:

```sh
bb skills/essence-stack/essence/tests/run.clj
bb skills/essence-stack/essence/examples/task-label/test_model.clj
bb skills/essence-stack/essence/scripts/essence.clj check skills/essence-stack/essence/examples/task-label --strict --require-tests
bb skills/essence-stack/essence/scripts/install.clj
```

The combined suite covers initializer overwrite refusal, unsafe paths and symlink escapes, malformed artifacts, traceability, reviewed baselines, drift, installer collision/ownership handling, CLI execution from an unrelated directory through symlinks, skill metadata and relative links. The example covers pure transitions, atomic composition, failed responses and concurrent duplicates.

Global installation uses eight source-linked directories under `~/.pi/agent/skills/`. Pi's native skill loader parses them successfully. Reload remains necessary in an already-running interactive session. No settings files are changed.

## Limits

- No LLM behavioral evaluation suite has been run; prompts are supplied for future evaluation.
- No production application was generated, deployed or migrated.
- No distributed runtime or restart-durability guarantee was tested.
- Bounded enumeration and unit tests are not universal formal proofs.
- Structural checks do not assess whether a concept fulfills a real user's needs.
- Global discovery in non-Pi harnesses has not been tested.
