#!/usr/bin/env python3
"""FW-T1 cases for timing-influence and local graph counterfactuals."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace


DOMAIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DOMAIN))

from mine_timing_route import (  # noqa: E402
    _aggregate_candidate_influence,
    _candidate_counterfactual,
    _mapped_graph,
    rank_critical_subgraph,
)
from verilog_netlist import Instance  # noqa: E402


def _cell(inputs=("A",), output="Y"):
    return SimpleNamespace(
        is_seq=False,
        inputs=tuple(inputs),
        outputs={output: ("var", inputs[0])},
    )


def _instance(cell_type, name, output, **inputs):
    return Instance("top", cell_type, name, dict(inputs, Y=output))


def _observed(families):
    slacks = {family: slack for family, slack in families}
    return {
        "path_hits": len(families),
        "max_increment_ns": 0.02,
        "path_ranks": list(range(1, len(families) + 1)),
        "path_family_count": len(families),
        "path_family_ids": sorted(slacks),
        "path_family_support": len(families),
        "beginpoint_families": ["launch"],
        "endpoint_families": ["capture"],
        "path_family_worst_slacks_ns": slacks,
        "worst_path_slack_ns": min(slacks.values()),
    }


class TimingInfluenceTests(unittest.TestCase):
    def test_dominator_and_reconvergence_remain_separate_raw_axes(self):
        cells = {"BUF": _cell(), "MERGE": _cell(("A", "B"))}
        instances = [
            _instance("BUF", "D", "n0", A="i"),
            _instance("BUF", "A", "n1", A="n0"),
            _instance("BUF", "B", "n2", A="n0"),
            _instance("MERGE", "R", "o", A="n1", B="n2"),
        ]
        record = rank_critical_subgraph(
            "top", instances, cells, {"BUF": 1.0, "MERGE": 1.0}
        )
        rows = {row["mapped_instance"]: row for row in record["critical_elements"]}

        self.assertEqual(rows["D"]["influence_vector"]["dominator_endpoint_coverage"], 1.0)
        self.assertEqual(rows["A"]["influence_vector"]["dominator_endpoint_coverage"], 0.0)
        self.assertEqual(rows["D"]["influence_vector"]["reconvergence_nodes"], ["R"])
        self.assertEqual(rows["A"]["influence_vector"]["reconvergence_nodes"], ["R"])
        self.assertGreater(rows["D"]["influence_vector"]["removable_edge_count"], 0)
        self.assertFalse(record["ranking_objective"]["commercial_qor_prediction"])

    def test_full_graph_counterfactual_records_path_migration(self):
        cells = {name: _cell() for name in ("A", "B", "C", "D")}
        instances = [
            _instance("A", "A1", "a1", A="ia"),
            _instance("B", "A2", "oa", A="a1"),
            _instance("C", "B1", "b1", A="ib"),
            _instance("D", "B2", "ob", A="b1"),
        ]
        record = rank_critical_subgraph(
            "top", instances, cells,
            {"A": 2.0, "B": 2.0, "C": 1.9, "D": 1.9},
            counterfactual_costs={"A2": {"new_cell_delay_du": 1.5}},
        )
        row = next(item for item in record["critical_elements"]
                   if item["mapped_instance"] == "A2")
        counterfactual = row["counterfactual"]

        self.assertEqual(counterfactual["baseline_worst_endpoint"], "A2")
        self.assertEqual(counterfactual["new_worst_endpoint"], "B2")
        self.assertTrue(counterfactual["path_migrated"])
        self.assertAlmostEqual(counterfactual["new_worst_delay_du"], 3.8)
        self.assertAlmostEqual(row["influence_vector"]["worst_endpoint_relief_du"], 0.2)
        self.assertGreater(counterfactual["replacement_effective_delay_du"], 0.0)
        self.assertIn("not_commercial_qor_prediction", counterfactual["scope"])

    def test_family_slack_mass_is_deduplicated_and_overlap_is_visible(self):
        cells = {"INV": _cell()}
        instances = [
            _instance("INV", "U0", "n0", A="i"),
            _instance("INV", "U1", "n1", A="n0"),
            _instance("INV", "U2", "o", A="n1"),
        ]
        observed = {
            name: _observed((("launch#->capture#", -0.10),
                             ("launch#->capture_aux#", -0.20)))
            for name in ("U0", "U1", "U2")
        }
        record = rank_critical_subgraph(
            "top", instances, cells, {"INV": 1.0}, observed_reg2reg=observed
        )
        row = next(item for item in record["critical_elements"]
                   if item["mapped_instance"] == "U1")
        vector = row["influence_vector"]

        self.assertAlmostEqual(vector["negative_slack_mass_coverage_ns"], 0.30)
        self.assertEqual(vector["path_family_count"], 2)
        self.assertEqual(vector["repeat_support"], 3)
        self.assertLess(vector["non_overlapping_support"], vector["repeat_support"])
        self.assertGreater(vector["overlap_count"], 0)
        self.assertEqual(vector["buffer_inverter_pressure"]["one_hop_count"], 3)
        self.assertEqual(vector["mapping_adoption_status"], "not_evaluated")

    def test_zero_delay_replacement_is_rejected(self):
        cells = {"BUF": _cell()}
        instances = [_instance("BUF", "U0", "o", A="i")]
        with self.assertRaisesRegex(ValueError, "new Cell delay.*positive"):
            rank_critical_subgraph(
                "top", instances, cells, {"BUF": 1.0},
                counterfactual_costs={"U0": {"new_cell_delay_du": 0.0}},
            )

    def test_multi_node_candidate_collapse_drives_its_own_path_migration(self):
        cells = {name: _cell() for name in ("A", "B", "C", "D")}
        instances = [
            _instance("A", "A1", "a1", A="ia"),
            _instance("B", "A2", "oa", A="a1"),
            _instance("C", "B1", "b1", A="ib"),
            _instance("D", "B2", "ob", A="b1"),
        ]
        (eligible, _drivers, _loads, predecessors, successors,
         order, _edges) = _mapped_graph(instances, cells)
        counterfactual = _candidate_counterfactual(
            "top", "OCC_CONE", ["A1", "A2"], "A2", eligible,
            predecessors, successors, order,
            {"A1": 2.0, "A2": 2.0, "B1": 1.9, "B2": 1.9},
            cut_boundary_input_count=1,
            cut_boundary_output_count=1,
        )

        self.assertEqual(counterfactual["logic_depth_before"], 2)
        self.assertEqual(counterfactual["logic_depth_after"], 1)
        self.assertEqual(counterfactual["removable_node_count"], 1)
        self.assertEqual(counterfactual["new_worst_endpoint"], "B2")
        self.assertTrue(counterfactual["path_migrated"])
        self.assertNotIn("@candidate:OCC_CONE", counterfactual["new_worst_path"])
        self.assertIn("@candidate:OCC_CONE", counterfactual["proposed_cell_path"])
        self.assertEqual(counterfactual["covered_instance_keys"], ["top/A1", "top/A2"])

    @staticmethod
    def _candidate_occurrence(occurrence_id, region, before, after):
        vector = {
            "path_family_ids": ["F0"],
            "dominator_endpoint_coverage": 1.0,
            "reconvergence_nodes": ["R"],
            "fanout_count": 1,
            "load_proxy": 1,
            "fanout_load_distribution": {"fanout_count": 1},
            "buffer_inverter_pressure": {"one_hop_count": 0, "one_hop_fraction": 0.0},
        }
        return {
            "occurrence_id": occurrence_id,
            "module": "top",
            "root_instance": occurrence_id,
            "endpoint_family": "F0",
            "baseline_indicator": {"kind": "observed_reg2reg_worst_slack", "value_ns": -0.1},
            "covered_instance_keys": list(region[:-1] or region),
            "cut_region_instance_keys": list(region),
            "logic_depth_before": before,
            "logic_depth_after": after,
            "logic_depth_delta": before - after,
            "removable_node_count": max(0, before - after),
            "removable_edge_count": max(0, before - after),
            "cut_boundary_input_count": 2,
            "cut_boundary_output_count": 1,
            "reg2reg_path_family_worst_slacks_ns": {"F0": -0.1},
            "influence_vector": vector,
            "counterfactual": {
                "worst_endpoint_relief_du": 0.1,
                "mapping_feasible": True,
            },
            "local_break_even_du": 2.0,
            "proxy_cell_delay_du": 1.0,
            "proxy_frontier_indicator_du": 1.0,
        }

    def test_depth_distribution_aggregates_deltas_without_cross_row_pairing(self):
        deep = self._candidate_occurrence("OCC_DEEP", ["top/a", "top/b"], 4, 1)
        shallow = self._candidate_occurrence("OCC_SHALLOW", ["top/c", "top/d"], 2, 1)
        aggregate = _aggregate_candidate_influence([deep, shallow])

        self.assertEqual(aggregate["logic_depth_delta_nonoverlap_sum"], 4)
        self.assertEqual(aggregate["logic_depth_delta_max"], 3)
        self.assertEqual(aggregate["logic_depth_delta_distribution"], [
            {"occurrence_id": "OCC_DEEP", "before": 4, "after": 1, "delta": 3},
            {"occurrence_id": "OCC_SHALLOW", "before": 2, "after": 1, "delta": 1},
        ])
        self.assertNotIn("logic_depth_before", aggregate)
        self.assertNotIn("logic_depth_after", aggregate)

    def test_distinct_roots_with_a_shared_cut_region_are_overlapping(self):
        left = self._candidate_occurrence(
            "OCC_LEFT", ["top/shared", "top/left", "top/out_left"], 3, 1
        )
        right = self._candidate_occurrence(
            "OCC_RIGHT", ["top/shared", "top/right", "top/out_right"], 3, 1
        )
        aggregate = _aggregate_candidate_influence([left, right])

        self.assertEqual(aggregate["repeat_support"], 2)
        self.assertEqual(aggregate["non_overlapping_support"], 1)
        self.assertEqual(aggregate["overlap_count"], 1)
        self.assertEqual(
            aggregate["overlap_pairs"][0]["overlap_instance_keys"], ["top/shared"]
        )

        other_module = self._candidate_occurrence(
            "OCC_OTHER_MODULE",
            ["other/shared", "other/right", "other/out_right"], 3, 1,
        )
        qualified = _aggregate_candidate_influence([left, other_module])
        self.assertEqual(qualified["non_overlapping_support"], 2)
        self.assertEqual(qualified["overlap_count"], 0)


if __name__ == "__main__":
    unittest.main()
