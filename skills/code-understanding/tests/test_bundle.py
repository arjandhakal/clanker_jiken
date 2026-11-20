"""Structural and installation checks; no model calls or repository execution."""

import importlib.util
import os
from pathlib import Path
import re
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("bundle_install", ROOT / "install.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class BundleTests(unittest.TestCase):
    def test_skill_frontmatter(self):
        explicit = {"session-catch-up", "plain-language", "code-interrogate"}
        for name in installer.SKILLS:
            with self.subTest(name=name):
                content = (ROOT / name / "SKILL.md").read_text()
                self.assertTrue(content.startswith("---\n"))
                frontmatter = content.split("---", 2)[1]
                self.assertIn(f"name: {name}\n", frontmatter)
                description = re.search(r'^description: "(.+)"$', frontmatter, re.M)
                self.assertIsNotNone(description)
                self.assertLessEqual(len(description.group(1)), 1024)
                self.assertEqual("disable-model-invocation: true" in frontmatter,
                                 name in explicit)

    def test_local_markdown_links_exist(self):
        for path in ROOT.rglob("*.md"):
            for target in re.findall(r"\]\(([^)]+)\)", path.read_text()):
                if "://" not in target and not target.startswith("#"):
                    self.assertTrue((path.parent / target.split("#")[0]).exists(),
                                    f"{path}: {target}")

    def test_install_and_reinstall(self):
        with tempfile.TemporaryDirectory() as temp:
            dest = Path(temp) / "skills"
            self.assertEqual(installer.install(dest), 1)
            link = dest / ROOT.name
            self.assertTrue(link.is_symlink())
            self.assertEqual(link.resolve(), ROOT)
            for name in installer.SKILLS:
                self.assertTrue((link / name / "SKILL.md").is_file())
            self.assertEqual(installer.install(dest), 0)
            self.assertEqual(installer.install(dest, check=True), 0)

    def test_installed_references_survive_lexical_normalization(self):
        with tempfile.TemporaryDirectory() as temp:
            dest = Path(temp)
            installer.install(dest)
            for name in installer.SKILLS:
                skill = dest / ROOT.name / name / "SKILL.md"
                for target in re.findall(r"\]\(([^)]+)\)", skill.read_text()):
                    normalized = Path(os.path.normpath(skill.parent / target))
                    self.assertTrue(normalized.is_file(), str(normalized))

    def test_check_does_not_create_directories(self):
        with tempfile.TemporaryDirectory() as temp:
            dest = Path(temp) / "missing" / "skills"
            with self.assertRaisesRegex(RuntimeError, "Not installed"):
                installer.install(dest, check=True)
            self.assertFalse(dest.exists())

    def test_collision_preserves_existing_file(self):
        with tempfile.TemporaryDirectory() as temp:
            dest = Path(temp)
            conflict = dest / ROOT.name
            conflict.write_text("user customization")
            with self.assertRaisesRegex(RuntimeError, "Refusing to replace"):
                installer.install(dest)
            self.assertEqual(conflict.read_text(), "user customization")
            self.assertEqual(list(dest.iterdir()), [conflict])

    def test_collision_preserves_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            dest = Path(temp)
            conflict = dest / ROOT.name
            conflict.mkdir()
            with self.assertRaisesRegex(RuntimeError, "Refusing to replace"):
                installer.install(dest)
            self.assertEqual(list(dest.iterdir()), [conflict])

    def test_broken_link_is_not_replaced(self):
        with tempfile.TemporaryDirectory() as temp:
            dest = Path(temp)
            conflict = dest / ROOT.name
            conflict.symlink_to(dest / "missing")
            with self.assertRaisesRegex(RuntimeError, "Refusing to replace"):
                installer.install(dest)
            self.assertTrue(conflict.is_symlink())
            self.assertEqual(list(dest.iterdir()), [conflict])

    def test_check_detects_missing_link_without_repair(self):
        with tempfile.TemporaryDirectory() as temp:
            dest = Path(temp)
            installer.install(dest)
            missing = dest / ROOT.name
            missing.unlink()
            with self.assertRaisesRegex(RuntimeError, "Not installed"):
                installer.install(dest, check=True)
            self.assertFalse(missing.is_symlink())
            self.assertEqual(installer.install(dest), 1)


if __name__ == "__main__":
    unittest.main()
