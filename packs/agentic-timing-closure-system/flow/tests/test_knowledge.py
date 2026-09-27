"""Structural checks on the Pack's method Knowledge files.

Knowledge explains methods, conditions and failure interpretation; it never states a
measured fact as established (see `docs/package-development/THE_DEVELOPMENT_OF_HIMA_PACK.md`
Section "Knowledge"). SPEC.md's "Knowledge" chapter names ten files and, for each, the
decision it must change. This test holds every file to a minimal, checkable shape: it
exists, it carries the four required `##` headings in order, every one of those
sections is non-empty, and the `Source` section actually names a path or a document
version rather than only prose. It does not evaluate the quality or accuracy of the
prose itself.

Runnable directly:
    python3 packs/agentic-timing-closure-system/flow/tests/test_knowledge.py -v

Runnable via discovery:
    python3 -m unittest discover -s packs/agentic-timing-closure-system/flow/tests -v
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

PACK_ROOT = Path(__file__).resolve().parents[2]
KNOWLEDGE_DIR = PACK_ROOT / "knowledge"

# The ten files SPEC.md's "Knowledge" chapter commits to, in the order that chapter
# lists them.
KNOWLEDGE_FILES = [
    "method-and-benchmark.md",
    "state-and-evidence.md",
    "observation-strategy.md",
    "mechanisms-and-falsifiers.md",
    "xtop-capabilities.md",
    "contribution-and-merge.md",
    "cheap-verification.md",
    "innovus-stage-interventions.md",
    "lifecycle-and-input-modes.md",
    "experience-transfer.md",
]

REQUIRED_HEADINGS = [
    "Source",
    "Applies when",
    "Changes this decision",
    "Counterexample",
]

# A path-like token: at least one path separator between non-space segments, e.g.
# "packs/xtop-timing-closure/knowledge" or "share/doc/man/man1/undo.1".
PATH_TOKEN_RE = re.compile(r"(?<![\w/])[\w.\-]+(?:/[\w.\-]+)+(?![\w/])")

# A version-like token: an ISO-ish date or year, a dotted version number (e.g.
# "23.14" or "1.0.14"), a long hex digest, or a dated man-page footer like
# "12/15/2025".
VERSION_TOKEN_RE = re.compile(
    r"(20\d\d-\d\d-\d\d"        # 2026-09-26
    r"|\b20\d\d\b"              # 2026
    r"|\b\d{1,2}/\d{1,2}/20\d\d\b"  # 12/15/2025
    r"|\b\d+\.\d+(?:\.\d+)?\b"  # 23.14, 1.0.14, 2025.09
    r"|\b[0-9a-f]{16,64}\b"     # sha256-style digest
    r")",
    re.IGNORECASE,
)


def parse_h2_sections(text):
    """Return an ordered list of (heading, body) for every level-2 heading.

    A level-2 heading is a line starting with exactly "## " (two hashes and a
    space). A "### " line never matches: its third character is "#", not " ",
    so `line.startswith("## ")` is already false for it.
    """
    sections = []
    current_heading = None
    current_body = []
    for line in text.splitlines():
        if line.startswith("## "):
            if current_heading is not None:
                sections.append((current_heading, "\n".join(current_body)))
            current_heading = line[len("## "):].strip()
            current_body = []
        elif current_heading is not None:
            current_body.append(line)
    if current_heading is not None:
        sections.append((current_heading, "\n".join(current_body)))
    return sections


def make_knowledge_file_test(filename):
    path = KNOWLEDGE_DIR / filename

    class _KnowledgeFileTest(unittest.TestCase):
        def test_file_exists(self):
            self.assertTrue(path.is_file(), f"missing {path}")

        def test_required_headings_present_and_ordered(self):
            text = path.read_text(encoding="utf-8")
            headings = [heading for heading, _ in parse_h2_sections(text)]
            self.assertEqual(
                headings,
                REQUIRED_HEADINGS,
                f"{filename} must have exactly the headings {REQUIRED_HEADINGS} "
                f"in order (### subsections underneath are fine), got {headings}",
            )

        def test_every_required_section_non_empty(self):
            text = path.read_text(encoding="utf-8")
            sections = dict(parse_h2_sections(text))
            for heading in REQUIRED_HEADINGS:
                self.assertIn(heading, sections)
                self.assertTrue(
                    sections[heading].strip(),
                    f"{filename} section '{heading}' must not be empty",
                )

        def test_source_names_a_path_or_a_version(self):
            text = path.read_text(encoding="utf-8")
            sections = dict(parse_h2_sections(text))
            source_body = sections.get("Source", "")
            self.assertIsNotNone(
                PATH_TOKEN_RE.search(source_body),
                f"{filename} 'Source' section must name at least one path",
            )
            self.assertIsNotNone(
                VERSION_TOKEN_RE.search(source_body),
                f"{filename} 'Source' section must name at least one version, "
                f"date or digest",
            )

    _KnowledgeFileTest.__name__ = "KnowledgeFileTest_" + filename.replace("-", "_").replace(".", "_")
    _KnowledgeFileTest.__qualname__ = _KnowledgeFileTest.__name__
    return _KnowledgeFileTest


def load_tests(loader, standard_tests, pattern):
    suite = unittest.TestSuite()
    suite.addTests(standard_tests)
    for filename in KNOWLEDGE_FILES:
        test_case = make_knowledge_file_test(filename)
        suite.addTests(loader.loadTestsFromTestCase(test_case))
    return suite


class KnowledgeManifestTest(unittest.TestCase):
    def test_all_ten_files_listed(self):
        self.assertEqual(len(KNOWLEDGE_FILES), 10)

    def test_knowledge_dir_exists(self):
        self.assertTrue(KNOWLEDGE_DIR.is_dir(), f"missing {KNOWLEDGE_DIR}")


if __name__ == "__main__":
    unittest.main()
