# Permission grants

Users complained that auto mode treated permission too literally. They approved a safe operation, then the extension asked again for the same practical action. Session grants keep the useful safety properties of the old path. Exact commands remain auditable, and protected paths still escalate.

`src/grants.ts` now owns the typed grant model. Live grants are created from user-confirmed prompt choices and restored from local decision records on the active session branch. The prototype-only prose inference helper remains covered by tests, but the live gate does not derive permission from user wording alone.

## A. Exact session command

Remember the exact command a user chose to remember for this session branch.

- Good: predictable, easy to explain, low risk.
- Bad: still misses harmless variants like a different test file.
- Bound: credential path and protected target rules still outrank the grant.

`Allow once` is still separate. It permits only the current call and keeps recording the approved command as Jev context.

## B. Operation grant

Remember a narrow operation grant, currently non-force `git push`.

Live behavior:

- Covers `git push`, `git push origin HEAD`, and chains with benign git companions like `git add … && git commit … && git push`.
- Does **not** cover `git push --force`, `git push --mirror`, `npm publish`, `git push && npm publish`, pipes, redirection, or fallback shell branches.

This addresses the “I allowed git push and it still asked” complaint without turning approval into shell wildcard access.

## C. File-scope grant

Remember a scoped file grant for outside-cwd write/edit calls.

Live behavior:

- Covers `write`/`edit` outside the working directory.
- Does **not** cover protected paths such as `.ssh`, `.pi`, `.git`, `.env`, agent instruction files, or configured protected paths.

This addresses the “I told it to edit that outside file” complaint while keeping credential and instruction surfaces gated.

## Prompt shape

The prompt names what each choice remembers:

1. Allow once.
2. This session: remember this exact command.
3. This session: remember non-force git push.
4. This session: remember outside-cwd write/edit to non-protected paths.
5. Globally or locally allow always for exact bash commands.
6. Block.

The operation and file-scope choices only appear when the gate can name that scope deterministically.
