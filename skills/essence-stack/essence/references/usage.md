# Usage and tooling

## Invoke the stack

In Pi use `/skill:essence <request>` for routing, or `/skill:essence-concept`, `/skill:essence-compose`, `/skill:essence-review`, etc. directly. Reload after installing/editing skills. All sibling skills must be installed together.

Useful requests:
- “Design this app with purposeful independent concepts and explicit action synchronizations. Show alternatives and counterexamples before implementation.”
- “Specify a generic Reservation concept, including its operational principle, cancellation, no-shows, identity and concurrency choices.”
- “Review whether our payment/booking synchronization can charge a user without a confirmed booking.”
- “Keep design artifacts and code aligned after this change. Investigate drift before updating a baseline.”

## Commands

Requires Babashka; all libraries are bundled, with no dependency download. Resolve `<skill>` to the directory containing the essence SKILL.md. Project is the application root, not the skill source directory. Scripts resolve their assets from their own location, including when invoked through global symlinks.

```sh
bb <skill>/scripts/essence.clj init <project>
bb <skill>/scripts/essence.clj check <project>
bb <skill>/scripts/essence.clj check <project> --strict
bb <skill>/scripts/essence.clj check <project> --strict --require-tests
bb <skill>/scripts/essence.clj drift <project>
# ONLY after reviewing and reconciling intended/current behavior:
bb <skill>/scripts/essence.clj baseline <project> --ack-reviewed
```

`--design path/from/project` selects a different artifact directory. Manifest file paths stay project-root relative.

- **init:** create draft brief/index/mapping/journal/review files and empty concept/rule/trace directories. Refuses existing workspace files; never generates an application.
- **check:** inspect manifest types/IDs, file paths, required spec headings, declared action references, dependencies and trace references. Reports unresolved draft markers. No shell commands are executed from artifacts.
- **--strict:** warnings become failures. Empty inventories and missing traces are warnings.
- **--require-tests:** require implementation paths, mapping paths and trace-to-test coverage for every concept/rule. Existence of a test file is not evidence that assertions cover a claim or that the test passed.
- **drift:** compare tracked files with a previously reviewed baseline. Reads only; changed, added or missing paths require investigation. Files outside the manifest and design prose are not monitored.
- **baseline:** fingerprint declared specs/code/tests/mappings and design Markdown after structural checks are clean and review is explicitly acknowledged. This records a claim; it does not perform a review.

Exit codes: 0 = structural pass/no tracked drift/operation success; 1 = check failures or drift needing review; 2 = invalid input, refusal or missing baseline. Output always qualifies the kind of check performed. Defaults allow drafts for iterative work; a non-strict pass with warnings is not readiness.

## Global Pi installation

Run `bb <skill>/scripts/install.clj`. The default is `~/.pi/agent/skills/`, or `$PI_CODING_AGENT_DIR/skills` if configured. Optionally select the shared Agent Skills directory with `--target-dir ~/.agents/skills`, but do not create duplicate names in multiple discovery roots.

Installation links each sibling directory back to the source checkout, refuses all preexisting foreign targets (including dangling links), and is idempotent for owned links. The complete stack is needed for relative references. Removing/moving the checkout breaks the links; reinstall intentionally rather than overwriting unknown targets.

Uninstall with the same target directory and `--uninstall`. Only owned symlinks are removed. No project artifacts or source skills are deleted. When moving from shared discovery to Pi-specific discovery, install the new links first, then uninstall the old owned links explicitly.

## Limits

No autonomous watcher, automatic two-way merge, compiler for synchronization prose, production workflow engine, or security guarantee. Semantic validation still requires agent/human reasoning, executable tests, and where appropriate user research or formal models.
