#!/usr/bin/env python3
"""Writer/Reader agreement for the residual AI research document.

`ai_research_runner` writes ``feedback_ab`` unconditionally into the residual
research document it publishes for ``aiResearchSelection``.  The Pack Reader
that consumes that document validates the document's field set exactly, so the
two must agree on it.  Pack 5.2.0 shipped a Reader whose field set omitted
``feedback_ab``, which made every Campaign fail at ``read-research-selection``
with "residual AI research document has unexpected fields or status".

These tests pin that boundary from the Reader side.  They assert the field-set
gate itself: a document carrying the writer's field set must not be refused for
its fields, and a document missing ``feedback_ab`` must still be refused.
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

FLOW = Path(__file__).resolve().parents[2]
READER = FLOW / "read-stage.py"

# Exactly the field set ai_research_runner publishes (plus feedback_ab, whose
# absence in the Reader is the defect these tests exist to catch).
WRITER_FIELDS = [
    "schema", "status", "round_id", "context_sha256", "evidence",
    "next_residual_question", "budgets", "research_lenses", "candidate_program",
    "candidate_proposals", "candidate_execution", "feedback_ab", "generation_feedback", "stop_reason",
    "claims", "output_sha256",
]

UNEXPECTED = "unexpected fields or status"


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _document(*, feedback_ab: bool) -> dict:
    """A document shaped like the writer's output; values are deliberately minimal.

    The claims values must all be False or the Reader refuses for asserting a
    forbidden claim before it reaches the field-set gate.
    """
    fields = [name for name in WRITER_FIELDS if name != "feedback_ab"]
    if feedback_ab:
        fields.append("feedback_ab")
    document = {name: {} for name in fields}
    document["schema"] = "lfr-ai-residual-research/1"
    document["status"] = "proposed"
    document["round_id"] = "round-0001"
    document["claims"] = {
        "commercial_qor_prediction": False,
        "commercial_eda_executed": False,
        "candidate_identity_assigned": False,
    }
    if feedback_ab:
        document["feedback_ab"] = {
            "performed": False, "selection_changed": None,
            "without_feedback_proposal_keys": [], "with_feedback_proposal_keys": [],
            "selection_effect": {"kind": "unchanged", "added_proposal_keys": [], "removed_proposal_keys": [],
                                 "reason": "with-feedback and without-feedback selections contain the same candidates in this A/B sample; sampling is uncontrolled"},
            "interpretation": "no commercial feedback was supplied",
        }
    document["generation_feedback"] = {}
    return document


class ResidualResearchDocumentContractTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="lfr-research-doc-")
        self.workspace = Path(self.tmp.name)
        (self.workspace / "flow/records").mkdir(parents=True)
        # The Reader loads its staged domain parsers from <workspace>/flow/domain
        # and imports ai_research_runner from <workspace>/flow, exactly as the
        # Campaign workspace provides them.  Without both it dies before it ever
        # examines the document's field set, which would make these tests vacuous.
        shutil.copytree(FLOW / "domain", self.workspace / "flow/domain")
        shutil.copy2(FLOW / "ai_research_runner.py",
                     self.workspace / "flow/ai_research_runner.py")

    def tearDown(self):
        self.tmp.cleanup()

    def _run_reader(self, document: dict):
        artifact = self.workspace / "flow/research/research.json"
        artifact.parent.mkdir(parents=True, exist_ok=True)
        artifact.write_text(json.dumps(document, sort_keys=True) + "\n")
        record = self.workspace / "flow/records/read-research-selection.json"
        record.write_text(json.dumps({
            "schema": "custom-cell-fmax-stage/1",
            "stage": "read-research-selection",
            "status": "passed",
            "inputs": [],
            "artifacts": [{
                "role": "aiResearchSelection",
                "path": "flow/research/research.json",
                "sha256": _sha(artifact),
                "bytes": artifact.stat().st_size,
                "sourceType": "synthetic-reader-fixture",
            }],
            "executions": [],
            "facts": {},
        }, sort_keys=True) + "\n")
        out = self.workspace / "hima-readers/read-ai-research-selection/read-selection.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        return subprocess.run(
            ["/usr/bin/python3", str(READER), str(artifact), str(out),
             "research-selection"],
            text=True, capture_output=True,
        )

    def test_reader_field_set_matches_the_writer(self):
        ran = self._run_reader(_document(feedback_ab=True))
        self.assertNotIn(UNEXPECTED, ran.stderr,
                         "the Reader refused the writer's own field set:\n" + ran.stderr)
        # The Reader must get past both early gates, proving the document reached
        # the deeper checks rather than dying before its field set was examined.
        self.assertNotIn("staged domain parser directory", ran.stderr, ran.stderr)
        self.assertNotIn("asserts a forbidden claim", ran.stderr, ran.stderr)

    def test_reader_still_refuses_a_document_without_feedback_ab(self):
        ran = self._run_reader(_document(feedback_ab=False))
        self.assertIn(UNEXPECTED, ran.stderr,
                      "a document missing feedback_ab must still be refused")

    def test_reader_required_field_set_lists_feedback_ab(self):
        """The field-set gate itself, asserted directly against the Reader source.

        This is the assertion that fails on the pre-fix Reader
        (``flow/read-stage.py`` at origin/main lists 14 fields and omits
        ``feedback_ab``), independently of how the subprocess is invoked.
        """
        source = READER.read_text(encoding="utf-8")
        match = re.search(
            r"required = \{([^}]*)\}\s*\n\s*if set\(document\) != required", source)
        self.assertIsNotNone(match, "the Reader's required field set is not recognisable")
        names = re.findall(r'"([a-z_][a-z0-9_]*)"', match.group(1))
        self.assertEqual(sorted(WRITER_FIELDS), sorted(names),
                         "the Reader field set and the writer's field set have diverged; "
                         "ai_research_runner always writes feedback_ab, so a Reader that "
                         "omits it fails every Campaign at read-research-selection")
        self.assertIn("feedback_ab", names,
                      "the Reader's exact field-set gate omits feedback_ab")


if __name__ == "__main__":
    unittest.main()
