#!/usr/bin/env python3
"""Install only this bundle's skills as collision-safe global symlinks."""

import argparse
from pathlib import Path

SKILLS = (
    "code-teach",
    "code-how",
    "code-why",
    "session-catch-up",
    "plain-language",
    "code-interrogate",
)
ROOT = Path(__file__).resolve().parent


def install(destination, *, check=False):
    destination = Path(destination).expanduser().absolute()
    for name in SKILLS:
        source = ROOT / name
        if not (source / "SKILL.md").is_file():
            raise RuntimeError(f"Missing skill source: {source}")
    # Link the complete bundle so sibling references work even when a host
    # lexically normalizes paths before opening files through the symlink.
    target = destination / ROOT.name
    if target.is_symlink() and target.resolve() == ROOT:
        return 0
    if target.exists() or target.is_symlink():
        raise RuntimeError(f"Refusing to replace existing destination: {target}")
    if check:
        raise RuntimeError(f"Not installed: {target}")
    destination.mkdir(parents=True, exist_ok=True)
    # No force flag: refuse a destination created after preflight too.
    target.symlink_to(ROOT, target_is_directory=True)
    return 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skills-dir", type=Path, default=Path.home() / ".agents/skills")
    parser.add_argument("--check", action="store_true", help="Verify links without writing")
    args = parser.parse_args()
    try:
        count = install(args.skills_dir, check=args.check)
    except (OSError, RuntimeError) as error:
        parser.exit(1, f"{error}\n")
    print(f"Verified bundle link; {len(SKILLS)} skills ready." if args.check
          else f"Installed {count} new bundle links; {len(SKILLS)} skills ready.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
