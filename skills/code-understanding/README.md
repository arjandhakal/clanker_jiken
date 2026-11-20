# Code Understanding

Six portable skills for understanding and checking AI-written (or human-written) code. Generalized from pstack's teach, how, why, ketchup, bro, and interrogate workflows.

No extension code, model configuration, subprocess agents, package install, MCP server, or particular language is required. Python 3 is needed only for the optional installer/tests.

## Choose a skill

| Pi command | Use it for | pstack inspiration |
| --- | --- | --- |
| `/skill:code-teach` | Understand a PR through an example, mechanism, and rationale. | teach |
| `/skill:code-how` | Trace how a request or value flows through real code. | how |
| `/skill:code-why` | Find recorded design reasons and separate inference from facts. | why |
| `/skill:session-catch-up` | See what the agent changed in this conversation and what needs your decision. | ketchup |
| `/skill:plain-language` | Restate the previous explanation without jargon. | bro |
| `/skill:code-interrogate` | Try to reproduce concrete contract violations in a diff. No automatic fixes. | interrogate |

The first three can be selected automatically by the agent. The last three are explicit-invocation-only. Use Pi's native `/skill:name` commands; no short-command aliases or extension are installed.

### Start here

```text
/skill:code-teach PR <URL>. Start with the problem and one concrete
before/after example. Trace it through the changed code. Explain the
design choices and failure paths. Separate proof from assumptions.
Don't change any code.

/skill:code-how How does cancellation reach the worker?
/skill:code-why Why was this retry limit chosen?
/skill:session-catch-up What changed while I was away?
/skill:plain-language
/skill:code-interrogate Review this branch against its intended behavior.
```

Teaching does not prove correctness. Use code-interrogate for explicitly requested local verification. Its safety instructions still depend on the agent following them; they are not an executable sandbox.

## Global Pi installation

From this directory:

```bash
python3 install.py
python3 install.py --check
```

This creates one symlink, `~/.agents/skills/code-understanding`, pointing to this complete bundle. Pi discovers the six nested skills recursively. Keeping the bundle together preserves sibling references when paths are normalized. It does not edit settings, install extensions, or change existing pstack, customized explain/bro, or repo-compass skills. Re-running is idempotent. A conflicting destination aborts without replacing anything.

Run **`/reload` in each already-running Pi session**. New sessions discover the skills automatically. Filesystem changes alone cannot refresh an active conversation's skill inventory.

The names are deliberately non-conflicting. Existing repo-how/repo-why/repo-teach provide a richer saved-report workflow; these are lightweight in-chat explanations with no automatic disk artifacts.

For a test or alternate installation root:

```bash
python3 install.py --skills-dir /path/to/skills
```

Uninstall by removing only the `~/.agents/skills/code-understanding` symlink, then reload. Keep this source directory in place while installed; moving it requires reinstalling after removing the old link.

## Generalization and boundaries

- Follow the repository's instructions and actual base/head, not a hardcoded project or branch.
- Direct execution by default, with no implicit authorization for delegation.
- Read-only explanations. No automatic code edits, test execution, app startup, reports, private-service sweep, or publishing.
- Interrogation may run safe, explicitly requested local checks under repository rules. Blocked concerns remain visible but are not called verified bugs.
- Ordinary Markdown and optional ASCII/Mermaid, not required image generation or rendering.
- Citation-backed explanations preserve documented intent, inferred reasons, and unknowns.
- No automatic claim that tests passed, a PR is correct, work is deployed, or the human has understood it.

## Validation

```bash
python3 -B -m unittest discover -s tests -v
```

Tests cover manifest shape, sibling references, installation, idempotence, check-only mode, and collision safety. Pi's own skill loader should also be used after installation to confirm discovery and command visibility. These checks do not measure explanation quality or prove agent compliance with safety instructions.

## Sources and license

Adapted from the MIT-licensed [pstack](https://github.com/cursor/plugins/tree/main/pstack) skills by Lauren Tan, consulted November 20, 2026: [teach](https://github.com/cursor/plugins/blob/main/pstack/skills/teach/SKILL.md), [how](https://github.com/cursor/plugins/blob/main/pstack/skills/how/SKILL.md), [why](https://github.com/cursor/plugins/blob/main/pstack/skills/why/SKILL.md), [ketchup](https://github.com/cursor/plugins/blob/main/pstack/skills/ketchup/SKILL.md), [bro](https://github.com/cursor/plugins/blob/main/pstack/skills/bro/SKILL.md), and [interrogate](https://github.com/cursor/plugins/blob/main/pstack/skills/interrogate/SKILL.md).

This is a separately maintained adaptation, not an upstream installation. See [PSTACK-LICENSE](PSTACK-LICENSE) for the preserved notice.
