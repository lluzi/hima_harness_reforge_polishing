#!/usr/bin/env python3
"""The Reader must accept the document the residual research writer publishes.

Trial.16 found the second instance of the same writer/Reader boundary defect.
Pack 5.2.0's Reader omitted ``feedback_ab`` from its exact field set; Pack 5.2.1
added it, but then re-validated the published document with
``validate_residual_research_proposal``, which requires exactly
``research_lenses``, ``candidate_program``, ``feedback_interpretation`` and
``stop_reason``.  The published document has no top-level
``feedback_interpretation`` - the Runner keeps it in
``feedback_ab["interpretation"]`` - so every 5.2.1 Campaign still failed at
``read-research-selection``, one check later than 5.2.0.

This test drives the REAL writer and then the REAL Reader over the bytes the
writer produced, so a Reader that only passes a field-set gate is not enough:
the round trip has to end at exit 0 with the emitted values.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

FLOW = Path(__file__).resolve().parents[2]
READER = FLOW / "read-stage.py"
TESTS = Path(__file__).resolve().parent
if str(TESTS) not in sys.path:
    sys.path.insert(0, str(TESTS))

import test_ai_residual_research_context as fixtures  # noqa: E402


class ResidualResearchWriterReaderRoundTripTests(unittest.TestCase):
    def _published_document(self, workspace: Path, commercial_response: dict | None = None) -> Path:
        shutil.copytree(FLOW / "domain", workspace / "flow/domain")
        shutil.copy2(FLOW / "ai_research_runner.py",
                     workspace / "flow/ai_research_runner.py")
        shutil.copy2(READER, workspace / "flow/read-stage.py")
        root = workspace / "flow/library-richness"
        root.mkdir(parents=True)
        request = fixtures._request(root)
        if commercial_response is not None:
            request["commercial_response"] = fixtures._write_json(
                root, "commercial-response.json", commercial_response)
        (root / "research-context.json").write_text(
            json.dumps(request, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        output = workspace / "flow/research/research.json"

        def research(context):
            proposal = fixtures._proposal(context)
            if commercial_response is None:
                proposal["candidate_program"]["source"] = (
                    "def propose_candidates(residual, budget):\n"
                    "    return [{\"lens\": \"onsite-inspiration\",\n"
                    "             \"transformation\": {\"cut_kind\": \"reconvergent\"},\n"
                    "             \"rationale\": \"advance the residual structure\"}]\n"
                )
            return proposal

        fixtures.run_residual_research(research, workspace, output)
        return output

    def test_reader_accepts_the_document_the_writer_publishes(self):
        with tempfile.TemporaryDirectory(prefix="lfr-writer-reader-") as folder:
            workspace = Path(folder)
            report = self._published_document(workspace)
            out = workspace / "hima-readers/read-ai-research-selection/read-selection.json"
            out.parent.mkdir(parents=True, exist_ok=True)
            ran = subprocess.run(
                ["/usr/bin/python3", str(workspace / "flow/read-stage.py"),
                 str(report), str(out), "research-selection"],
                text=True, capture_output=True)
            self.assertEqual(
                0, ran.returncode,
                "the Reader refused the document its own writer published:\n" + ran.stderr)
            values = {row["type"]: row["value"] for row in json.loads(out.read_text())["values"]}
            self.assertEqual(2, values["research_hypothesis_count"])
            self.assertEqual(1, values["selected_count"])
            self.assertEqual(1, values["onsite_inspiration_selected_count"])
            self.assertEqual(1, values["retained_candidate_count"])
            for name in ("fixed", "remaining", "entrant", "regressed", "missing"):
                self.assertIsNone(values["generation_endpoint_%s_count" % name],
                                  "missing commercial endpoint evidence must not become zero")

    def test_reader_preserves_unknown_counts_when_full_commercial_lists_exceed_context_caps(self):
        with tempfile.TemporaryDirectory(prefix="lfr-truncated-feedback-") as folder:
            workspace = Path(folder)
            report = self._published_document(workspace, fixtures._large_commercial_response())
            out = workspace / "hima-readers/read-ai-research-selection/read-selection.json"
            out.parent.mkdir(parents=True, exist_ok=True)
            ran = subprocess.run(["/usr/bin/python3", str(workspace / "flow/read-stage.py"),
                                  str(report), str(out), "research-selection"],
                                 text=True, capture_output=True)
            self.assertEqual(0, ran.returncode, ran.stderr)
            values = {row["type"]: row["value"] for row in json.loads(out.read_text())["values"]}
            for name in ("fixed", "remaining", "entrant", "regressed", "missing"):
                self.assertIsNone(values["generation_endpoint_%s_count" % name], name)


if __name__ == "__main__":
    unittest.main()
