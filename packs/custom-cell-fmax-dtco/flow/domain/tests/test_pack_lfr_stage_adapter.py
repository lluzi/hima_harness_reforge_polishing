#!/usr/bin/env python3
"""Focused PACK-04 seams: residual delta binding and Liberty shard assembly."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


FLOW = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(FLOW))

import stages  # noqa: E402
from library_richness import _portfolio_candidate_cells  # noqa: E402
from domain._generation_projection import (  # noqa: E402
    empty_cumulative_manifest,
    expected_generation_jobs,
)


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
        self._manifest = self.flow / "library/cumulative-manifest.json"
        self._manifest.parent.mkdir(parents=True, exist_ok=True)
        self._manifest.write_text(json.dumps(empty_cumulative_manifest({
            "source": "/foundry.lib", "bytes": 1, "sha256": "0" * 64,
        })))

    def binding(self, name):
        return {
            "MAX_NEW_CELLS": 50,
            "LFR_CANDIDATE_POOL": str(self._pool),
            "LFR_CUMULATIVE_LIBRARY_MANIFEST": str(self._manifest),
        }[name]

    def add_artifact(self, path, role, source_type="tool-output"):
        ref = stages.file_ref(path, self.workspace, role, source_type)
        self.artifacts.append(ref)
        return ref


class PackLfrStageAdapterTests(unittest.TestCase):
    def test_floorplan_area_is_doubled_from_the_failure_baseline(self):
        self.assertEqual("0.125000", stages.expanded_floorplan_utilization("0.25"))
        self.assertEqual("0.250000", stages.expanded_floorplan_utilization("0.5"))

    def test_failed_pnr_log_retains_density_control_facts(self):
        markers = stages.pnr_density_markers("\n".join([
            "=== CCFMAX V5 PLANNED OCCUPANCY foundry 0.4305 ===",
            "=== CCFMAX V5 FIXED CELL AREA foundry 13685.112 ===",
            "**ERROR: (IMPSP-2021): Could not legalize <53> instances",
            "VERIFY DRC did not complete: Number of violations hits the Error Limit [100000]",
            "2857352 geometry drc markers are saved",
            "**ERROR: fixture",
        ]), "foundry")
        self.assertEqual({
            "planned_occupancy": 0.4305,
            "fixed_cell_area_um2": 13685.112,
            "route_drc_violations": 2857352,
            "innovus_process_exit_code": 0,
            "innovus_batch_error_count": 0,
            "innovus_failure_class": "placement-legalization+route-drc-overflow",
        }, markers)

    def test_innovus_route_layer_name_is_rendered_as_an_integer(self):
        self.assertEqual(7, stages.innovus_route_layer_index("M7"))
        self.assertEqual(8, stages.innovus_route_layer_index(8))
        for value in ("M0", "M7A", "metal7", 0, True):
            with self.subTest(value=value):
                with self.assertRaisesRegex(stages.Rejected, "routing layer"):
                    stages.innovus_route_layer_index(value)

    def test_innovus_batch_wrapper_turns_tcl_errors_into_process_failure(self):
        with tempfile.TemporaryDirectory() as raw:
            root = Path(raw)
            source = root / "init_foundry.tcl"
            source.write_text("error {fixture failure}\n")
            wrapper = stages.innovus_batch_wrapper(root, source, "init-foundry")
            text = wrapper.read_text()
            self.assertIn("catch {source {%s}}" % source.resolve(), text)
            self.assertIn("HIMA_BATCH_ERROR", text)
            self.assertRegex(text, r"(?m)^\s*exit 1$")
            self.assertRegex(text, r"(?m)^exit 0$")
            executed = subprocess.run(
                ["/usr/bin/tclsh", str(wrapper)], capture_output=True, text=True)
            self.assertEqual(1, executed.returncode)
            self.assertIn("HIMA_BATCH_ERROR: fixture failure", executed.stderr)

    def test_multi_output_candidate_uses_the_one_generated_cell_identity(self):
        request = {
            "candidate_id": "CAND_FUNCTIONAL_DIVERSITY_MAPPED_MULTI_0066",
            "implementation_plan": {"route": "multi_output_resynthesis"},
            "generator_contract": {"interface": {
                "inputs": [{"name": "A"}, {"name": "B"}],
                "outputs": [
                    {"name": "Y0", "liberty_function": "A & B"},
                    {"name": "Y1", "liberty_function": "A | B"},
                ],
            }},
        }
        jobs = expected_generation_jobs({"generation_requests": [request]})
        self.assertEqual(["XS_FUNCTIONAL_DIVERSITY_MAPPED_MULTI_0066_MO"],
                         [job["cell_name"] for job in jobs])
        self.assertEqual(
            [job["cell_name"] for job in jobs],
            _portfolio_candidate_cells(
                {"source_generation_request": request}, "multi-output fixture"),
        )

    def test_generation_namespace_makes_physical_cell_names_unique_across_shards(self):
        fixture = (FLOW / "domain/tests/fixtures/lfr-pre-mapping-portfolio.production.json")
        portfolio = json.loads(fixture.read_text())
        request = portfolio["candidate_evaluations"][0]["candidate"]["source_generation_request"]

        generation_1 = stages.namespace_generation_requests([request], "0001")
        generation_2 = stages.namespace_generation_requests([request], "0002")
        names_1 = {row["cell_name"] for row in expected_generation_jobs({
            "generation_requests": generation_1,
        })}
        names_2 = {row["cell_name"] for row in expected_generation_jobs({
            "generation_requests": generation_2,
        })}

        self.assertRegex(generation_1[0]["candidate_id"], r"_G0001$")
        self.assertRegex(generation_2[0]["candidate_id"], r"_G0002$")
        self.assertTrue(names_1.isdisjoint(names_2))

    def test_cumulative_library_paths_are_declared_arm_only_script_inputs(self):
        liberty = "/workspace/flow/library/cumulative-custom.lib"
        lef = "/workspace/flow/library/cumulative-custom.lef"
        foundry = "set libs [list /foundry.lib]\nset lefs [list /tech.lef /foundry.lef]\n"
        generated = (
            "set libs [list /foundry.lib %s]\n"
            "set lefs [list /tech.lef /foundry.lef %s]\n" % (liberty, lef)
        )

        self.assertEqual(
            stages.normalized_arm_script(foundry, (liberty, lef)),
            stages.normalized_arm_script(generated, (liberty, lef)),
        )

    def test_frozen_patterns_only_accept_method_metadata_from_same_function(self):
        fixture = (FLOW / "domain/tests/fixtures/lfr-pre-mapping-portfolio.production.json")
        portfolio = json.loads(fixture.read_text())
        current = json.loads(json.dumps(
            portfolio["candidate_evaluations"][0]["candidate"]["source_generation_request"]))
        current["discovery_evidence"]["strategy_ids"] = ["timing_criticality"]
        current["discovery_evidence"]["strategy_rankings"] = {
            "timing_criticality": {
                "candidate_id": current["candidate_id"], "local_rank": 1,
                "search_objective": "critical_impact",
            }
        }
        frozen = json.loads(json.dumps(current))
        frozen["discovery_evidence"].pop("strategy_ids")
        frozen["discovery_evidence"].pop("strategy_rankings")

        enriched = stages._overlay_current_method_provenance(
            {"generation_requests": [frozen]},
            {"generation_requests": [current]},
        )

        evidence = enriched["generation_requests"][0]["discovery_evidence"]
        self.assertEqual(["timing_criticality"], evidence["strategy_ids"])
        self.assertEqual(
            current["generator_contract"],
            enriched["generation_requests"][0]["generator_contract"],
        )

    def test_function_deduplication_retains_every_contributing_method(self):
        fixture = (FLOW / "domain/tests/fixtures/lfr-pre-mapping-portfolio.production.json")
        portfolio = json.loads(fixture.read_text())
        request = portfolio["candidate_evaluations"][0]["candidate"]["source_generation_request"]
        duplicate = json.loads(json.dumps(request))
        duplicate["candidate_id"] += "_SECOND_VIEW"

        result = stages._deduplicated_mined_requests([
            ("timing_criticality", [request]),
            ("timing_context", [duplicate]),
        ])

        self.assertEqual(1, len(result))
        evidence = result[0]["discovery_evidence"]
        self.assertEqual(
            ["timing_criticality", "timing_context"], evidence["strategy_ids"])
        self.assertEqual(1, evidence["strategy_rankings"]["timing_criticality"]["local_rank"])
        self.assertEqual(1, evidence["strategy_rankings"]["timing_context"]["local_rank"])

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
            self.assertEqual(
                stages.namespace_generation_requests([request], "0001"),
                merged["generation_requests"],
            )
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

    def test_mapping_library_rejects_a_cross_shard_cell_name_collision(self):
        # trial.11: a generation-2 delta and a generation-1 cumulative shard can
        # legally both name a Cell "XS_TIMING_CONTEXT_A2_SINGLE_0001_Y" (candidate
        # ids are per-round labels, not globally unique, see
        # _generation_projection.canonical_cell_name's docstring) while the two
        # Cells are physically different (different area/leakage). Composing them
        # into one augmented mapping Library used to concatenate both blocks
        # silently; the *last* one wins wherever a tool keys Cells by name
        # (cell_need_miner.liberty.parse_skeleton does exactly that), so the
        # mapper picks up whichever shard happened to be read last. This must
        # fail closed with the colliding name named in the error instead.
        with tempfile.TemporaryDirectory() as folder:
            workspace = Path(folder)
            (workspace / "flow").mkdir()
            foundry = workspace / "foundry.lib"
            foundry.write_text('library (foundry) {\n  cell (AND2) { area : 1.0; }\n}\n')
            gen1 = workspace / "gen1-shard.lib"
            gen1.write_text(
                'library (gen1) {\n'
                '  cell ("XS_TIMING_CONTEXT_A2_SINGLE_0001_Y") { area : 1.6789; }\n'
                '}\n'
            )
            gen2 = workspace / "gen2-delta.lib"
            gen2.write_text(
                'library (gen2) {\n'
                '  cell ("XS_TIMING_CONTEXT_A2_SINGLE_0001_Y") { area : 1.26323; }\n'
                '}\n'
            )

            class _MappingContext:
                def __init__(self):
                    self.workspace = workspace
                    self.run_dir = workspace / "flow" / "run-fixture"
                    self.run_dir.mkdir(parents=True, exist_ok=True)
                    self.inputs = []

                def file_binding(self, name):
                    assert name == "FOUNDRY_LIB"
                    return foundry

            with self.assertRaisesRegex(
                stages.Rejected, "XS_TIMING_CONTEXT_A2_SINGLE_0001_Y"
            ):
                stages._mapping_library(_MappingContext(), "augmented.lib", [gen1, gen2])


if __name__ == "__main__":
    unittest.main()
