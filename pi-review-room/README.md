# Pi Review Room

**An independent, interactive code-review subagent for Pi, opened in a Herdr pane with an explicit human curation gate.**

Pi Review Room lets you pause after an implementation, ask a fresh model to review the changes, discuss its findings in a separate pane, and send only the findings you approve back to the original Pi session.

The important property is context isolation: candidate findings do **not** enter the parent agent's model context just because the reviewer published them. They remain in a local draft inbox until you select them with `/review-curate` and confirm delivery with `/review-send`, both from inside the reviewer pane.

```text
Main Pi session                    Independent reviewer pane
────────────────                  ───────────────────────────
implementation context            blank conversational context
        │                                      │
        ├── immutable patch snapshot ─────────>│ review + discussion
        │                                      ├── review_publish
        │     local draft (no parent context) <─┤
        │                                      ├── /review-curate
        │                                      ├── /review-note R1
        │<── selected findings + user notes ────┤ /review-send
        │
        └── automatic follow-up: investigate and implement the curated review
```

## Why use it?

A reviewer that inherits the implementation conversation can be biased by the same assumptions as the implementing agent. Review Room instead gives the reviewer:

- a fresh Pi conversation;
- an immutable snapshot of the selected Git diff;
- read-only access to the repository for supporting context;
- a model and thinking level chosen by you;
- no ability to edit the worktree; and
- no automatic path back into the parent model context.

You can challenge a finding, ask for evidence, or request another pass directly in the reviewer pane. Each republished draft replaces the previous candidate set. Only after that discussion do you decide what the original agent should see.

## Requirements

- **Pi** 0.84 or newer recommended
- **Herdr** with its Pi integration installed
- **Git** and a Git worktree
- A persistent parent Pi session
- At least one authenticated Pi model
- Optional: **Hunk** 0.17 or newer for live candidate annotations

The extension has been tested with Pi 0.84.x, Herdr 0.7.3, Hunk 0.17.7, and Ghostty.

## Installation

From this repository:

```bash
git clone git@github.com:arjandhakal/clanker_jiken.git
cd clanker_jiken/pi-review-room
npm install
npm run check

herdr integration install pi
pi install "$PWD"
```

Open a **new Pi pane from inside Herdr** after installing the integration. If Pi is already running with the package installed, `/reload` reloads the extension, but a new pane may still be required for Herdr's environment variables.

To load the extension directly while developing it:

```bash
pi -e ./src/index.ts
```

You can verify that the current shell is managed by Herdr with:

```bash
printf 'HERDR_ENV=%s\nHERDR_PANE_ID=%s\n' "$HERDR_ENV" "$HERDR_PANE_ID"
```

`HERDR_ENV` should be `1`, and `HERDR_PANE_ID` should not be empty.

## Recommended workflow

### 1. Let the implementation agent finish a coherent unit of work

Review Room snapshots the diff at launch time. Start a review after the main agent has paused rather than while it is still rapidly rewriting files.

Run:

```text
/review-start
```

You can add a narrow brief after the command:

```text
/review-start Focus on transaction boundaries, retries, and possible data loss
```

The brief is sent only to the reviewer. It is useful when a change has a specific risk area, but leaving it blank produces the most independent general review.

### 2. Choose the review target

Review Room offers four targets:

| Target | Included changes | Good for |
| --- | --- | --- |
| **All branch and working-tree changes** | Branch commits since the merge base, staged changes, unstaged changes, and untracked files | Reviewing the complete agent-authored task |
| **Working tree against HEAD** | Staged and unstaged tracked changes plus untracked files | Reviewing only local, uncommitted work |
| **Staged changes** | Git index only | Reviewing exactly what is about to be committed |
| **Committed branch changes against base** | Commits from the merge base through `HEAD` | Reviewing a completed feature branch without local edits |

For branch-based targets, the base is resolved in this order:

1. the configured upstream, unless it is the current branch's own remote-tracking branch;
2. `origin/HEAD`;
3. `main`, `master`, or `trunk`;
4. `origin/main`, `origin/master`, or `origin/trunk`.

The resulting patch is stored as an immutable snapshot. The maximum snapshot size is 5 MiB.

### 3. Choose the reviewer model

The picker shows authenticated models available to the current Pi installation. If the selected model supports reasoning, Review Room also asks for a thinking level.

The reviewer model does not need to match the model used by the main session. Choosing a different model is often useful for genuinely fresh review coverage.

### 4. Work with the reviewer in its Herdr pane

Review Room creates a right-hand Herdr split and focuses it. The child Pi session starts with no copy of the parent conversation. It first reads the patch and may inspect relevant repository files with read-only tools.

When ready, the reviewer calls `review_publish`. This creates a versioned draft containing findings such as `R1`, `R2`, and `R3`. Publication does **not** send anything to the parent model.

Continue talking to the reviewer normally. For example:

```text
Explain the concrete failure path for R2.
```

```text
Re-check R1 against the caller in src/service.ts. Remove it if that guard makes it impossible.
```

```text
Look specifically for cancellation and cleanup races, then republish the complete draft.
```

Whenever the candidate set changes, the reviewer republishes the **complete** draft. A new revision invalidates previous curation so that stale selections cannot be sent accidentally.

Keep the reviewer pane open for the rest of the workflow. From the parent you can run `/review-focus` whenever you want to jump back to it.

### 5. Curate findings in the reviewer pane

Run this **inside the child reviewer pane**:

```text
/review-curate
```

The curation screen shows each finding's:

- stable ID and severity;
- title and source location;
- confidence;
- evidence;
- recommended action; and
- any handling note you already added.

Use the arrow keys to move between findings. Press **Enter** or **Space** to toggle the current finding between:

- `skip` — keep it out of the parent model context; and
- `accept` — include it in the handoff.

Press **Esc** to save and close the curation screen. Nothing is delivered merely by selecting `accept`.

### 6. Add your own handling instructions

Still in the reviewer pane, optionally attach a note explaining how the implementation agent should tackle an accepted finding:

```text
/review-note R1
```

Review Room opens an editor. Example notes include:

```text
Add a regression test that reproduces this before changing the retry loop.
```

```text
Fix this without changing the public API; preserve compatibility with existing callers.
```

```text
Investigate first. If the reviewer's assumption is wrong, explain why instead of changing code.
```

Run `/review-note` without an ID to choose a finding from a list. Submit an empty note to remove an existing one. Notes for skipped findings remain private and are not included in the handoff.

### 7. Send the curated review and return to the parent

Run this in the reviewer pane:

```text
/review-send
```

Review Room shows a final confirmation. It queues only accepted findings that have not already been sent from the current draft, together with their handling notes, and focuses the parent Herdr pane.

The parent extension picks up the handoff, inserts it into the original Pi session, and triggers a follow-up turn. The main agent can then investigate and implement the review, using your notes as guidance rather than blindly applying every recommendation.

Skipped findings, reviewer discussion, and the rest of the draft remain outside the parent model context. Re-running `/review-send` does not duplicate findings already delivered from that draft.

## Commands

### Commands in the parent pane

| Command | Description |
| --- | --- |
| `/review-start [brief]` | Snapshot a target and start a fresh interactive reviewer in a Herdr split |
| `/review-focus [id]` | Focus the reviewer's current Herdr pane |
| `/review-resume [id]` | Reopen a closed reviewer using its existing Pi session |
| `/review-status` | Refresh the parent widget and report the number of attached rooms |
| `/review-close [id]` | Close the reviewer pane without sending findings |

### Commands in the child reviewer pane

| Command | Description |
| --- | --- |
| `/review-curate` | Inspect the current draft and toggle findings between `skip` and `accept` |
| `/review-note [finding-id]` | Add, edit, or remove your handling instructions for a finding |
| `/review-send` | Send only new accepted findings and their notes, then focus the parent pane |

### Working with multiple review rooms

Parent commands use the only room automatically when one exists. When several rooms belong to the current parent session, Review Room opens a picker.

You can bypass the picker with a unique run-ID fragment shown in the parent status widget:

```text
/review-focus 23456Z-a1b2c3
/review-resume a1b2c3
/review-close a1b2c3
```

Both a unique leading prefix and a unique trailing fragment are accepted. Child commands never need a room ID because each child pane belongs to exactly one review room.

## Hunk integration

Hunk support is optional and does not require the `herdr-hunk-diff` plugin.

If `hunk` is on `PATH` and a live Hunk review is already open for the same repository when the reviewer publishes, findings with a valid file and line are added as **agent annotations**. This lets you inspect them next to the diff.

Review Room deliberately does not:

- launch Hunk;
- change the diff loaded in your Hunk TUI;
- remove or edit human comments; or
- send Hunk comments to the parent agent.

When a reviewer republishes, only annotations authored by that particular Review Room run are replaced. If no matching Hunk session exists, publication still succeeds and the draft remains available through `/review-curate` in the reviewer pane.

For the smoothest workflow, open the desired review in Hunk before starting Review Room or before asking the reviewer to republish.

## Context isolation and safety

### Child reviewer

- The child session records a lineage link to the parent session file, but parent conversation entries are not copied.
- Project context files, discovered extensions, skills, and prompt templates are disabled.
- Project-local context and executable resources are not trusted or loaded for the child invocation.
- The only active tools are `read`, `grep`, `find`, `ls`, and `review_publish`.
- The child has no shell, edit, or write tool and cannot modify the worktree through Pi tools.
- The patch is fixed at launch time. Repository files read for extra context may still change afterward, so start a new review if the implementation changes substantially.

### Parent session

Candidate details are stored in local JSON files. The parent receives only non-contextual status data such as the run ID, draft revision, and finding count until `/review-send` is confirmed in the reviewer pane.

The child writes a curated handoff file, and the parent extension consumes it. This explicit child-side `/review-send` action is the only Review Room path that creates a context-bearing message in the parent session.

## Stored data

Runs are stored under:

```text
~/.pi/agent/review-room/<parent-session-id>/<run-id>/
├── manifest.json
├── review.patch
├── draft.json
├── selection.json
├── handoff.json
├── status.json
└── session/
```

Review Room's JSON state and patch snapshot are written with user-only permissions where supported. Review Room does not currently remove old runs automatically. You may delete old run directories manually after closing their panes and confirming that you no longer need their reviewer sessions or drafts.

## Closing and resuming

`/review-close` closes the Herdr pane but keeps the patch, draft, selections, and child Pi session on disk. It never sends findings.

Use `/review-resume` to open that child session in a new Herdr pane. The previous conversation with the reviewer is restored, allowing you to continue asking questions or request another draft revision.

## Troubleshooting

### “Review Room must be started from a Pi pane inside Herdr”

Install Herdr's Pi integration and open a new Pi process from a Herdr-managed pane:

```bash
herdr integration install pi
```

Then verify `HERDR_ENV=1` and a non-empty `HERDR_PANE_ID`.

### “Review Room requires a persistent parent Pi session”

Do not start the parent with `--no-session`. Start a normal interactive Pi session instead.

### “The selected review target has no changes”

Choose another target or confirm the expected changes with `git status` and `git diff`.

### “Could not resolve a base branch”

Configure an upstream or ensure one of `origin/HEAD`, `main`, `master`, or `trunk` exists locally.

### “Patch exceeds 5 MiB”

Choose a narrower review target, split the work into smaller reviews, or remove generated/binary files from the target.

### The draft changed after curation

This is intentional. A newly published draft may add, remove, or revise findings, so Review Room clears the effective selection. Run `/review-curate` again in the reviewer pane before sending.

### Hunk annotations do not appear

Check that:

1. `hunk` is on `PATH` for the child Pi process;
2. Hunk has an open live review;
3. the live review uses the same repository root; and
4. findings contain valid repo-relative files and old/new source lines.

A Hunk failure does not prevent inbox publication or child-side curation.

### The reviewer pane was closed

Run `/review-resume`. If it is still open but unfocused, use `/review-focus`.

## Development

```bash
npm run typecheck
npm test
npm run check
```

The test suite covers patch construction, base resolution, child draft publication, finding validation, prompt isolation, selective handoff formatting, Herdr launch argument safety, run storage, and process construction.

## Current limitations

- Herdr is the only pane backend.
- Reviewers cannot run tests or arbitrary commands because their tools are intentionally read-only.
- The patch snapshot limit is fixed at 5 MiB.
- Hunk annotations require a pre-existing live session and `hunk` on `PATH`.
- Stored runs and Hunk annotations are not automatically garbage-collected.
