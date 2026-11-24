# Nebius research and brainstorming skills

Repo-grounded technical research and solution exploration, vendored from
[Nebius Platform Services](https://github.com/nebius/nebius-ps-services).

## Included skills

| Skill | Use it for | Default outcome |
| --- | --- | --- |
| `brainstorm` | Explore a problem, challenge assumptions, and compare possible directions | Chat-only options, tradeoffs, and recommendation-changing questions |
| `research` | Investigate one technology, pattern, requirement, or disputed claim | Source-backed due diligence, limitations, alternatives, and recommendations |
| `design` | Turn an understood problem and research into a concrete solution | Code-grounded design and implementation-plan handoff, not implementation |
| `system-design-rules` | Stress-test a proposal before committing to it | Relevant architecture, ownership, failure-mode, security, and operational findings |

`design` and `system-design-rules` are included because `brainstorm` explicitly
consults them as advisers for major decisions. This does not switch a brainstorm
into implementation or authorize file writes. `research` also routes final design
and checklist review to these skills.

All four skill directories are unmodified upstream snapshots, including their
references, agent metadata, examples, and evaluation cases. No upstream installer,
hook, global instruction template, or executable integration is installed.

## Use in Pi

Open Pi in the repository you want investigated. In an existing session, run
`/reload` first. New sessions discover globally linked skills automatically.
Pi's native commands are `/skill:<name>`; upstream `$name`, `/name`, and
`/skills:name` examples refer to Codex or Claude, not extra Pi commands.

Start with the problem when the solution is still open:

```text
/skill:brainstorm We need resumable background jobs in this repo. Inspect our current job flow and failure handling first. Compare 2-3 viable approaches, including the smallest change. Give tradeoffs, likely integration points, and a recommendation. Stay read-only.
```

Use focused research when an external technical question needs evidence:

```text
/skill:research Investigate PostgreSQL-backed job queues for this repo. Read our database dependencies, transaction boundaries, workers, and deployment config first. Verify current official documentation and maintainer sources. Compare the current approach, a database queue, and a managed queue. Cite local files/symbols and external sources; explain compatibility, failure modes, migration cost, and what would change the recommendation. Keep the report concise. Do not implement anything.
```

Once you have enough evidence, request a concrete design separately:

```text
/skill:design Use the findings above to design the selected approach. Name affected files, state ownership, APIs, failure paths, rollout/rollback, and validation steps. Return the plan in chat; do not implement or publish design documents.
```

To challenge an existing proposal rather than restart design:

```text
/skill:system-design-rules Review the proposal above against this repo. Focus on data ownership, retries/idempotency, recovery, and operational cost. Compare against the simplest baseline and identify evidence still needed.
```

A useful progression is **brainstorm -> research a named gap -> resume the
brainstorm -> design -> review -> explicitly request implementation**. Not every
problem needs every stage. For small decisions, just use `brainstorm`; for a
focused factual investigation, start with `research`.

For useful results, state the decision, relevant paths, constraints, and desired
depth/output. Ask for a compact comparison if you do not want the longer upstream
research-report template. Neither `brainstorm` nor `research` saves findings by
default; request persistence separately under an appropriate writing workflow.

## Tools and dependency boundaries

- The workflow starts with relevant repo code, tests, docs, and configuration.
  External evidence fills named gaps; it should not replace local investigation.
- Upstream mentions Tavily and vendor-documentation MCPs. They are not installed
  by this bundle. Use tools actually available in Pi; in this setup Radius web
  search and GitHub retrieval can provide the documented web/retrieval fallback.
  Disclose unavailable capabilities rather than claiming they ran.
- Internal Slack/Confluence/etc. sources are only relevant for unresolved
  organizational questions. They are not mandatory prerequisites. Keep private
  code, internal excerpts, credentials, and sensitive details out of public
  search requests and external research-service briefs.
- `app-stack`, `ai-agent-design`, `ai-stack`, and `nebius` are conditional domain
  advisers, not required for the core research/brainstorm workflow. They are not
  included. `design` explicitly documents a bounded `research` fallback when an
  applicable specialist is unavailable.
- SDLC coordination, troubleshooting, scaffolding, implementation checks, and
  canonical-spec publication skills are separate workflows, not dependencies
  for read-only research. They are not included. In particular, upstream `design`
  reserves canonical document publication for `maintain-project-specs`; when
  that skill is absent, return the pending handoff rather than silently writing
  canonical specs or claiming publication.
- These are agent instructions, not a sandbox or an enforcement mechanism.

## Global installation

Canonical files live here. Install using the same global symlink convention as
other skill bundles in this repository:

```bash
source=/absolute/path/to/clanker_jiken/skills/nebius-research
mkdir -p "$HOME/.agents/skills"
for name in research brainstorm design system-design-rules; do
  ln -s "$source/$name" "$HOME/.agents/skills/$name"
done
```

`ln -s` refuses existing destinations rather than replacing another skill.
Pi discovers `~/.agents/skills` globally; no Pi settings, model defaults, packages,
MCP servers, or other agent-specific configuration need changing. These shared
links may also be discovered by other agents that support `~/.agents/skills`.
Remove only these four symlinks to uninstall, then `/reload`.

## Provenance and updates

- Upstream: `https://github.com/nebius/nebius-ps-services`
- Snapshot: `1a325c340df6d1715de0a33f1e4dd2f0001fd592`
- Source paths: `skills/{research,brainstorm,design,system-design-rules}` and root `LICENSE`.
- License: Apache-2.0; see [LICENSE](LICENSE).
- [UPSTREAM.json](UPSTREAM.json) records the revision and SHA-256 of every vendored file.

This is a pinned copy, not an auto-updating checkout. For updates, review the
upstream diff and dependency changes, replace the four snapshot directories and
license from one revision, regenerate the manifest, and revalidate. Keep local
usage notes separate so the upstream source remains easy to compare.

## Verification

```bash
python3 -B tests/validate.py
```

The validation checks exact file inventory and hashes, skill names/descriptions,
bundled runtime references, the expected advisory relationships, and the declared
missing-specialist fallback. Run it from this directory. Pi discovery should also
be checked after installation. Structural checks and upstream example/evaluation
files are not a benchmark of research quality or proof that an agent follows every
instruction.
