# Shared investigation contract

Read the target repository's applicable instructions first. These skills work with any language, forge, editor, and model. They do not require pstack, other installed skills, subagents, MCP servers, image generation, or a particular test runner.

## Scope and evidence

- Identify the target from the request and conversation. Ask only when ambiguity would change the answer materially.
- For a PR or branch, establish repository, intended base, and observed head revision before explaining it. Inspect the actual diff and affected callers, not just the PR description. Separate committed changes from working-tree edits. If the base is unknown, check repository metadata rather than guessing main.
- Use existing local history first. Read-only remote lookups are appropriate when needed and available. Say when evidence is cached, unavailable, or incomplete; do not silently fetch, checkout, reset, or change a branch.
- Cite concrete file paths and symbols for behavior, and commit/PR/issue links for historical claims. Use line numbers or revisions when useful.
- Separate observed behavior, documented intent, inference, and unknowns. An AI author's explanation or a plausible story is not proof. Passing tests are evidence only for what those tests cover.
- Keep exploration proportional. Follow the request, entry points, state owners, boundary conditions, and failure paths. Do not search every connected private service just because it is available.
- Work directly by default. Delegate only when the current request or applicable instructions authorize it, using the host's available tools. Never assume a skill grants new delegation authority.

## Side effects

Explanation skills are read-only: do not edit project files, generate reports on disk, launch apps, run repository code/tests, install dependencies, or create/publish reviews, commits, issues, messages, or deployments. Read-only git and forge queries are fine. Offer a separate verification step when execution is needed.

The explicitly requested code-interrogate workflow is the bounded exception: it may run safe local checks under the target repository's verification rules. Inspect commands before execution. Keep temporary repros isolated and do not modify the user's checkout. Seek permission for actions beyond that scope, including external writes, credentials outside the request, production access, destructive operations, and dependency installation.

Do not claim background work continues unless a real supported run exists. Never expose secrets in commands, evidence, diagrams, or output.

## Explain for the reader

Start with the problem and the observable result, then explain the mechanism. Prefer one concrete input or user action over a list of files. Adapt to what the conversation shows the reader knows. Define unfamiliar terms when first needed. Use a small ASCII or Mermaid diagram only when it helps; text must still work without a renderer.

Preserve uncertainty when simplifying. No compulsory quizzes, forced metaphors, stock praise, or claims that the user now understands. Follow the requested language and depth.
