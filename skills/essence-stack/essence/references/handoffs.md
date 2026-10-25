# Bounded skill collaboration

Loading a skill is not spawning an agent. Execute directly unless delegation is authorized. Do not encode provider-specific model names or require unavailable tools.

A cold-start packet:
```text
Objective and requested deliverable:
Repository/cwd and exact ref or working-tree state:
Authority: read-only / permitted files; no commit/push/deploy:
Relevant brief/spec/rule paths and version:
Accepted signatures, invariants, policy and non-goals:
Owned output files:
Checks and completion criteria:
Stop/ask conditions:
Return: artifact paths + concise evidence + unresolved decisions:
```

For independent concept design, assign one concept spec per owner. Freeze agreed types and public action signatures before implementation. The parent owns the manifest and composition layer; children propose patches to shared contracts rather than editing them concurrently. Use isolated worktrees where concurrent mutation warrants them.

A composer needs concept contracts, not an entire research corpus or exploration transcript. A reviewer needs the changed artifacts and behavior claims, not only the writer's assurance. An evolution worker needs the accepted delta and previous counterexamples.

When tools are missing, do the same bounded roles sequentially in the current agent. When a delegated lane fails, report the exact blocker and preserve its partial work; do not silently substitute a different execution protocol.
