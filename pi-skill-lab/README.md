# pi-skill-lab

Use experimental skills and CLI tools **on your real project**, while storing the skills, tools, and generated artifacts **outside the repository**. When satisfied, promote selected assets into a new Git branch.

No alternate development checkout. No changes to Pi's working directory. Normal project edits happen in your existing working tree.

## Install

```sh
pi install /absolute/path/to/clanker_jiken/pi-skill-lab
```

Or try it without changing Pi settings:

```sh
# Run from the project you want to work on.
pi --extension /absolute/path/to/pi-skill-lab/extensions/index.ts
```

Requires Git, Node.js 20+, and Pi with `resources_discover` and mutable `tool_call` inputs. Verified with Pi 0.75.4. Shell integration targets POSIX bash, not PowerShell.

## Workflow

Run `/skill-lab` with no arguments to open a searchable picker for this project's experiments. Each result shows the lab name, active state, and primary `/skill:<name>` command. Selecting a lab activates it and reloads resources.

`/skill-lab use`, `/skill-lab status`, and `/skill-lab diff` also open the picker when their lab name is omitted. Explicit names remain available for scripts and non-interactive modes.

To create the first experiment in your project's Pi session:

```text
/skill-lab new project-maintenance
```

This creates an external skill scaffold, tools directory, and artifacts directory, selects the experiment **for this Pi session**, and reloads resources. It does not clone, stage, or write anything into your project.

Ask Pi, for example:

> Build a project-specific maintenance skill and a CLI helper in this experiment's external directories. Try them on this repo. Keep generated reports outside the repo and tell me how to evaluate the results.

After writing the skill's metadata, run `/reload`, then try it explicitly:

```text
/skill:project-maintenance inspect the real project and produce a maintenance report
```

The selected experiment's **entire `skills/` tree** is scanned, including companion skills beside `skills/<experiment>/`. Only the selected experiment for the current project is loaded, not every saved lab. Run `/reload` after adding a companion skill.

Skills are advertised through Pi's ordinary skill discovery; their full instructions remain lazily loaded. A skill with `disable-model-invocation: true` is manual-only: invoke `/skill:<name> <task>` explicitly. Remove that field or set it to `false` if you want Pi to consider it automatically; discovery alone does not override it. Choose a unique skill name: Pi keeps the first discovered skill when global/project/candidate names collide. Review Pi's startup diagnostics. The scaffold is a starting point, not a finished skill or an automated benchmark.

Iterate normally. Source-code changes are allowed in the real repository. Experimental helper scripts, skill references, reports, and other candidate assets belong in the external paths shown by:

```text
/skill-lab status project-maintenance
```

Review and promote when ready:

```text
/skill-lab diff project-maintenance
/skill-lab promote project-maintenance skills/project-maintenance
```

Promotion requests confirmation, creates a **new branch with one commit containing the selected assets**, and leaves your current checkout/index unchanged. Switch when ready:

```sh
git switch skills/project-maintenance
```

**Existing uncommitted project edits are not included in the promotion commit.** They remain in your working tree. Git will ordinarily carry them when switching to the new branch if there are no conflicts; commit them separately as appropriate. Promotion does not sweep up unrelated source edits, staged files, or generated output.

Deactivate the external candidate before testing its promoted equivalent:

```text
/skill-lab off
```

External originals remain available for further iteration.

## External storage

Default location:

```text
<agent-dir>/skill-lab/<project-path-hash>/<experiment>/
├── lab.json
├── skills/
│   ├── <experiment>/
│   │   ├── SKILL.md
│   │   └── scripts/, references/, assets/ ...
│   └── <companion-skill>/SKILL.md ...
├── tools/
│   └── bin/ ...
├── artifacts/ ...
└── review.diff                 # Created by diff/promotion review
```

`<agent-dir>` defaults to `~/.pi/agent`. Set `PI_SKILL_LAB_HOME` to choose another location. Storage inside the source repository, including through symlinks, is rejected. Experiments are scoped to the canonical project root, not its current Git branch. Different Git worktrees have separate experiment namespaces.

Experiment selection is a session-wide preference, saved in Pi session entries; different sessions can select different candidates. `use`, `new`, `rename` of the active lab, and `off` reload Pi so skill discovery follows the selection. Selection does not follow Pi conversation-tree branches. Files themselves are durable and shared by sessions selecting the same experiment.

Rename a lab when the experiment label is wrong:

```text
/skill-lab rename old-label new-label
```

This changes the external lab directory and future `tools/<new-label>` / `artifacts/<new-label>` promotion destinations. It does **not** rename any skills inside the lab, their `SKILL.md` frontmatter, or hardcoded absolute paths inside candidate files. Other Pi sessions using the old label must run `/skill-lab use new-label`.

## Running tools and storing artifacts

With a candidate active, **agent `bash` calls** get these shell variables:

| Variable | Value |
| --- | --- |
| `PI_SKILL_LAB_ROOT` | Experiment directory |
| `PI_SKILL_LAB_PROJECT` | Actual project root |
| `PI_SKILL_LAB_SKILL` | External skill directory |
| `PI_SKILL_LAB_TOOLS` | External tools directory |
| `PI_SKILL_LAB_ARTIFACTS` | External artifact/output directory |

The external `tools/bin` is prepended to `PATH`; mark scripts executable. The shell's working directory stays Pi's existing project cwd, including a subdirectory if you started Pi there. This does not mutate process-global environment variables or replace Pi's bash tool.

Example candidate invocation:

```sh
python "$PI_SKILL_LAB_TOOLS/check_project.py" \
  --project "$PI_SKILL_LAB_PROJECT" \
  --output-dir "$PI_SKILL_LAB_ARTIFACTS"
```

Pi's `!`/`!!` user shell commands and separate terminals **do not automatically receive these variables**. `status` prints shell exports you can copy into a terminal.

Tools must honor an output-directory argument or `PI_SKILL_LAB_ARTIFACTS`. The extension cannot relocate arbitrary output from a CLI that insists on writing to cwd. Likewise, standard project operations can still produce build/cache files in the repo. Built-in `write`/`edit` calls targeting this experiment's future repo destinations are blocked with the corresponding external path, but shell commands and other tools are not comprehensively intercepted.

Before promoting, make the skill portable: resolve bundled scripts relative to its directory, give standalone tools explicit project/output arguments, and avoid hardcoding an external machine-specific path. The extension does not automatically rewrite scripts or skill references. Self-contained helpers can be bundled inside the skill's `scripts/` directory and promoted with the skill alone.

## Promotion selection

| Component | External source | Repo destination |
| --- | --- | --- |
| `skill` | `skills/<name>/` | `.pi/skills/<name>/` |
| `tools` | `tools/` | `tools/<lab-name>/` |
| `artifacts` | `artifacts/` | `artifacts/<lab-name>/` |

Default: **skill + tools**. Reports and other artifacts are excluded unless explicitly selected:

```text
/skill-lab diff project-maintenance all
/skill-lab promote project-maintenance skills/maintenance all
/skill-lab promote project-maintenance skills/skill-only skill
```

If a lab is renamed, the primary skill path and repo destination keep the original primary skill name. The lab label controls tools/artifacts destinations.

The `skill` promotion component currently includes only the primary `skills/<primary-skill>/` directory, not sibling companion skills. To promote companions together with the primary skill, bundle their directories inside the primary skill directory before reviewing; those nested skills are also discovered recursively. Loading the full skills tree does not expand the promotion selection.

Selection is whole components, not individual files. Inspect the complete diff at the printed external `review.diff` path before approving. For fine-grained promotion, curate the component directory first.

Selected destination directories are **replaced** by their external versions in the new branch, including removal of obsolete files. Missing external directories are rejected rather than treated as deletion requests. Empty directories are not recorded by Git. Ignored candidate files are force-added only to the temporary promotion snapshot, so inspect for secrets, dependencies, caches, and large output before promotion.

Promotion uses the project's **current committed HEAD**, not the HEAD when the experiment was created. A disposable temporary clone is used *only* to build the review/promotion commit, never as the working project. Binary files and executable bits are preserved. Source checkout/index/hooks are not used to create the commit. Source Git objects and the new branch ref are the only intended source-repo changes. The branch must not already exist; changes to HEAD or the candidate after confirmation invalidate the reviewed snapshot. Symlinks, special files, and nested repositories in selected assets are rejected. Configure Git `user.name`/`user.email` before promoting. The generated commit is unsigned; source commit hooks are deliberately bypassed.

## Commands

```text
/skill-lab new <name>
/skill-lab use <name>
/skill-lab rename <old-name> <new-name>
/skill-lab off
/skill-lab list
/skill-lab status <name>
/skill-lab open <name>
/skill-lab diff <name> [skill tools artifacts | all]
/skill-lab promote <name> <new-branch> [skill tools artifacts | all]
/skill-lab help
```

`open` prints a launch command for Pi **in the same real project**, with the experiment selected. It does not spawn another Pi or change the current session.

The optional standalone CLI shares storage and promotion behavior:

```sh
# From your real project:
node /absolute/path/to/pi-skill-lab/cli.mjs new project-maintenance
node /absolute/path/to/pi-skill-lab/cli.mjs rename project-maintenance project-helper
node /absolute/path/to/pi-skill-lab/cli.mjs diff project-helper
node /absolute/path/to/pi-skill-lab/cli.mjs promote project-maintenance skills/maintenance --yes
```

CLI `new`/`use` cannot activate a candidate in an already-running Pi process; use `/skill-lab use <name>` there or the printed launch command. CLI promotion requires explicit `--yes`; interactive Pi uses a confirmation dialog.

## Limitations and safety

This is **external asset storage, not filesystem isolation or a security sandbox**. Skills and scripts run with your normal permissions and may modify the actual project. There is no automatic evaluation/scoring, rollback of project edits, container boundary, or prohibition on a model using the CLI to promote via bash. Review behavior and outputs before trusting a candidate.

Back up important project work, avoid secrets in selected assets, and use a container/dedicated OS account if you need to execute hostile code. Other extensions can modify the same tool calls; shell integration assumes local POSIX bash.

## Tests

```sh
npm test
```

Tests cover external-only creation, real-project tool execution, external reports, selective promotion, unchanged source checkout/index, ignored and binary assets, executable bits, destination deletions, current-HEAD promotion, review invalidation, renames that preserve skill identity, mutation locking, and invalid storage/assets.

The Pi runtime integration test runs when the peer dependency is resolvable, or with `PI_SDK_PATH=/absolute/path/to/pi/dist/index.js npm test`; otherwise it is skipped. It verifies resource reload, primary and sibling skill activation/deactivation, preservation of manual-only flags, exclusion of artifact fixtures, unchanged cwd, shell variables, and candidate write guards without making model calls.
