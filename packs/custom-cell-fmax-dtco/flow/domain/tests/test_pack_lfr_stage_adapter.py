#!/usr/bin/env python3
"""Focused PACK-04 seams: residual delta binding and Liberty shard assembly."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


FLOW = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(FLOW))

import stages  # noqa: E402


class _Context:
    def __init__(self, workspace, pool):
        self.workspace = workspace
        self.flow = workspace / "flow"
        self.run_dir = self.flow / "artifacts" / "merge" / "run-fixture"
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self.inputs, self.artifacts, self.facts = [], [], {}
        self.inputs_doc = {"MAX_NEW_CELLS": 50}
        self.evidence_class = "synthetic-fixture"
        self._pool = pool

    def binding(self, name):
        return {"MAX_NEW_CELLS": 50, "LFR_CANDIDATE_POOL": str(self._pool)}[name]

    def add_artifact(self, path, role, source_type="tool-output"):
        ref = stages.file_ref(path, self.workspace, role, source_type)
        self.artifacts.append(ref)
        return ref


class PackLfrStageAdapterTests(unittest.TestCase):
    def test_residual_research_can_only_materialize_a_hash_bound_pool_request(self):
        fixture = (FLOW / "domain/tests/fixtures/lfr-pre-mapping-portfolio.production.json")
        portfolio = json.loads(fixture.read_text())
        request = portfolio["candidate_evaluations"][0]["candidate"]["source_generation_request"]
        with tempfile.TemporaryDirectory() as raw:
            workspace = Path(raw)
            (workspace / "flow/research").mkdir(parents=True)
            pool = workspace / "flow/library-richness/candidate-pool.json"
            pool.parent.mkdir(parents=True)
            pool.write_text(json.dumps({
                "report_schema": "xspace_cell-pattern-search/v2",
                "generation_requests": [request],
            }))
            digest = stages.canonical_json_sha(request)
            (workspace / "flow/research/research.json").write_text(json.dumps({
                "schema": "lfr-ai-residual-research/1",
                "candidate_proposals": [{
                    "transformation": {"proposal_key": "proposal:fixture"},
                    "generation_request_sha256": digest,
                    "generation_request": request,
                }],
            }))
            ctx = _Context(workspace, pool)
            stages.stage_merge(ctx)
            merged = json.loads((workspace / "flow/mining/merged.json").read_text())
            self.assertEqual(merged["strategy_id"], "residual_research_delta")
            self.assertEqual(merged["generation_requests"], [request])
            self.assertEqual(ctx.facts["retained_candidate_count"], 0)

            tampered = json.loads(json.dumps(request))
            tampered["candidate_id"] += "_TAMPERED"
            (workspace / "flow/research/research.json").write_text(json.dumps({
                "schema": "lfr-ai-residual-research/1",
                "candidate_proposals": [{
                    "transformation": {"proposal_key": "proposal:fixture"},
                    "generation_request_sha256": stages.canonical_json_sha(tampered),
                    "generation_request": tampered,
                }],
            }))
            with self.assertRaisesRegex(stages.Rejected, "not bound to the candidate pool"):
                stages.stage_merge(_Context(workspace, pool))

    def test_liberty_cell_extraction_preserves_balanced_nested_groups(self):
        text = '''library (fixture) {
  cell (A) { pin (Y) { direction : output; function : "A & B"; } }
  cell (B) { pin (Y) { timing () { values ("{1, 2}"); } } }
}
'''
        blocks = stages._liberty_cell_blocks(text)
        self.assertEqual(len(blocks), 2)
        self.assertIn("cell (A)", blocks[0])
        self.assertIn('values ("{1, 2}")', blocks[1])


if __name__ == "__main__":
    unittest.main()
