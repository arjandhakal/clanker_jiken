---
name: session-catch-up
description: "Catch the user up on work in the current conversation since their previous substantive message: what changed, what is verified, what remains, and decisions waiting on them. Use for 'what did you change while I was away?' or a post-agent-work recap, not a repository-wide digest."
disable-model-invocation: true
---

# Session catch-up

Read [the shared contract](../references/contract.md).

1. Use the last substantive user message before this catch-up request as the default checkpoint, or the explicit checkpoint they name. Notifications and agent results are not user messages. Include older decisions that still need the user.
2. Gather visible work and results from this conversation. Check current local diffs or the status of specific PRs/checks already involved when available and relevant. Do not scan unrelated session histories, launch jobs, or assume access to other agents.
3. Distinguish changed, attempted, verified, failed, still running, and unknown. Do not promote an agent's report to independently verified evidence. Reuse existing screenshots or diagrams only if they exist and explain something useful.
4. Identify decisions only the user can make: product choices, approvals, missing access, or requested irreversible actions. Work the agent can still do within scope is remaining work, not a user blocker.

Open with what needs their attention, or say nothing does. Then briefly explain the meaningful before/after changes and verification state. For every pending decision, include the concrete choice, recommendation, supporting evidence, uncertainty/risk, and link when available. List all genuine pending decisions; do not hide them behind a count or a link.

Use plain language and recognizable feature names. Include paths, commands, and revisions only when they help the user act. No invented visuals, proof, action items, deadlines, or background runs. If nothing changed and nothing is pending, say so and stop.
