#!/usr/bin/env python3
"""Validate the pinned skill bundle without running vendored code or using network."""

import hashlib
import json
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
SKILLS = ("research", "brainstorm", "design", "system-design-rules")


def validate():
    errors = []
    manifest = json.loads((ROOT / "UPSTREAM.json").read_text())
    if manifest["repository"] != "https://github.com/nebius/nebius-ps-services":
        errors.append("Unexpected upstream repository")
    if not re.fullmatch(r"[0-9a-f]{40}", manifest["revision"]):
        errors.append("Revision must be a full git commit SHA")
    if manifest["license"] != "Apache-2.0":
        errors.append("Unexpected upstream license")
    if manifest["skills"] != list(SKILLS):
        errors.append("Unexpected skill selection")

    actual_files = {"LICENSE"}
    for name in SKILLS:
        actual_files.update(
            path.relative_to(ROOT).as_posix()
            for path in (ROOT / name).rglob("*")
            if path.is_file()
        )
    recorded_files = set(manifest["sha256"])
    for path in sorted(actual_files - recorded_files):
        errors.append(f"Unrecorded vendored file: {path}")
    for path in sorted(recorded_files - actual_files):
        errors.append(f"Missing vendored file: {path}")
    for relative in sorted(actual_files & recorded_files):
        path = ROOT / relative
        if not path.is_file():
            errors.append(f"Missing file: {relative}")
            continue
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest != manifest["sha256"][relative]:
            errors.append(f"Upstream hash mismatch: {relative}")

    skill_text = {}
    for name in SKILLS:
        path = ROOT / name / "SKILL.md"
        if not path.is_file():
            errors.append(f"Missing skill: {name}")
            continue
        content = path.read_text()
        skill_text[name] = content
        frontmatter = re.match(r"\A---\n(.*?)\n---\n", content, re.DOTALL)
        if not frontmatter:
            errors.append(f"Missing frontmatter: {name}")
            continue
        fields = dict(re.findall(r"^(name|description): (.+)$", frontmatter[1], re.MULTILINE))
        if fields.get("name") != name:
            errors.append(f"Skill name does not match directory: {name}")
        description = fields.get("description", "")
        if description.startswith('"'):
            description = json.loads(description)
        if not 1 <= len(description) <= 1024:
            errors.append(f"Invalid routing description: {name}")

        # Check runtime files, not just the top-level SKILL.md. References may
        # point at more bundled references or evaluation inputs.
        runtime_files = [path, *(ROOT / name / "references").rglob("*.md")]
        for runtime in runtime_files:
            references = set(re.findall(
                r"(?<![\w/])(?:references|evals)/[A-Za-z0-9_./-]+\.(?:md|csv|json)",
                runtime.read_text(),
            ))
            for reference in sorted(references):
                if not (ROOT / name / reference).is_file():
                    errors.append(f"Missing runtime reference in {runtime.relative_to(ROOT)}: {reference}")

    brainstorm = skill_text.get("brainstorm", "")
    for adviser in ("research", "design", "system-design-rules"):
        if f"`{adviser}`" not in brainstorm:
            errors.append(f"Missing expected brainstorm adviser: {adviser}")
    workflow = ROOT / "design/references/design-workflow.md"
    if not workflow.is_file() or "Missing-Specialist Research Fallback" not in workflow.read_text():
        errors.append("Missing documented fallback for optional specialist skills")

    if errors:
        for error in errors:
            print(f"FAIL: {error}", file=sys.stderr)
        return 1
    print(f"PASS: {len(SKILLS)} skills; {len(recorded_files)} upstream file hashes; bundled runtime references and advisory fallback")
    return 0


if __name__ == "__main__":
    sys.exit(validate())
