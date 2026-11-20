---
name: code-interrogate
description: "Stress-test a PR or diff against its intended behavior, reproducing concrete failures and separating verified bugs from unverified concerns. Use when explicitly asked to challenge AI-written code, find blind spots, or verify a claimed fix; report findings without applying fixes."
disable-model-invocation: true
---

# Code interrogate

Read [the shared contract](../references/contract.md), especially the bounded local-execution exception. This is verification, not a substitute for understanding or permission to fix and publish.

1. Establish intent, repository, base, observed head, and whether uncommitted edits are in scope. Inspect the actual diff and surrounding execution path. If a branch base or intent cannot be established reliably, ask before claiming a review of the complete change.
2. Select a few plausible ways the change could violate its contract. Follow callers, state transitions, authorization, retries/concurrency, error paths, and compatibility where relevant. Ignore speculative future changes and style preferences.
3. Inspect the repository's test instructions and candidate commands before running anything. Prefer the smallest documented safe local check. Keep any new repro files outside the user's checkout or in an explicitly permitted isolated test area. Do not install dependencies, start services, change branches, alter production/external state, or apply fixes without the required permission.
4. Reproduce each candidate against the actual scoped code. Record the exact command, relevant output, expected behavior, observed behavior, and revision. For a claimed regression, compare with the base when a safe existing setup permits it; otherwise state that the baseline is untested.
5. Recheck surviving evidence, merge duplicate root causes, and report only reproducible contract violations as verified findings. An unavailable service, missing dependency, or failing test alone does not establish a product bug. Do not rerun costly or destructive commands just to satisfy a ritual.
6. If execution is blocked, provide an explicitly unverified concern and the exact check needed. Do not discard important security or correctness risks merely because this environment cannot reproduce them.

Present a short intent statement and findings ordered by impact. Each verified finding needs its trigger, consequence, path/symbol anchor, and reproducible evidence. Keep blocked/unverified concerns separate. If none survive, say "No verified findings" and describe the actual coverage and gaps; never imply the change is proven safe.

Direct review is the default. If the operator explicitly authorizes independent reviewers, give each the same bounded intent and evidence contract, verify their material claims, and do not claim a multi-model review unless distinct models actually ran. No mandatory arena, swarm, model, or harness-specific tool.
