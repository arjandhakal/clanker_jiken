---
name: code-teach
description: "Teach a PR, AI-written change, function, or subsystem through a concrete before/after example, runtime flow, and evidence-backed design rationale. Use for 'help me understand this PR', 'teach me this code', or a conversational walkthrough rather than just a summary."
---

# Code teach

Read [the shared contract](../references/contract.md).

The goal is a usable mental model, not more code or an approval verdict.

1. Establish the target and what the reader needs to understand. For a PR, read its actual diff, surrounding implementation, and relevant tests. Do not assume AI-generated code or its description is correct.
2. Read and apply [code-how](../code-how/SKILL.md) for mechanism and [code-why](../code-why/SKILL.md) for rationale. These are instruction files to follow directly, not assumed slash commands or mandatory subagents. Reuse evidence between them; skip redundant investigation for a narrow question.
3. Begin with the smallest useful answer: the problem and what changes for a user or caller. Then walk through one concrete before/after scenario. Connect each important step to the actual code.
4. Build the explanation in layers: input and output, intermediate state and ownership, then design tradeoffs and failure paths. Introduce one small diagram at a time only if it reduces the reader's work.
5. Distinguish why the implementation can work from evidence that it actually does. Read tests for the contract they assert; say when you have not run them. Highlight important assumptions and what would disprove them.
6. In conversation, explain one coherent layer and let the reader guide the next step. Do not stop after a teaser if they asked for a complete walkthrough. In one-shot mode, provide a compact complete account.

Present the explanation itself, not a report about having invoked skills. Include a few useful source anchors, not an exhaustive file inventory. When useful, end with one natural next topic. Do not turn teaching into an automatic review, code edit, or quiz.
