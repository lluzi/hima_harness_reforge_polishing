#!/usr/bin/env python3

import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


DOMAIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DOMAIN))

from cross_phase_graph import build_cross_phase_map  # noqa: E402
from build_dig_bundle import publish_bundle  # noqa: E402
from innovus_timing_facts import parse_timing_report  # noqa: E402
from design_information_graph import (  # noqa: E402
    DesignInformationGraphError,
    validate_bundle,
    validate_projection,
    augment_timing_projection,
)
from dig_store import DigStore, DigStoreError, hima_id, store_projection  # noqa: E402


def projection(snapshot_id, phase, renamed=False, ambiguous=False, completeness="complete"):
    first_name = "top/U_A_RENAMED" if renamed else "top/U_A"
    nodes = [
        {"kind": "Instance", "native_identity": first_name,
         "attributes": {"master": "AND2", "semantic_signature": "sig-and-a",
                        "logic_depth": 1, "x": 10.0, "y": 20.0},
         "geometry": {"min_x": 9, "max_x": 11, "min_y": 19, "max_y": 21}},
        {"kind": "Instance", "native_identity": "top/U_B",
         "attributes": {"master": "INV", "semantic_signature": "sig-inv-b",
                        "logic_depth": 2, "x": 15.0, "y": 20.0},
         "geometry": {"min_x": 14, "max_x": 16, "min_y": 19, "max_y": 21}},
        {"kind": "Net", "native_identity": "top/n1",
         "attributes": {"hpwl": 5.0, "capacitance": 0.002, "resistance": 1.5,
                        "via_count": 1}},
        {"kind": "EndpointState", "native_identity": "top/reg/D",
         "attributes": {"path_group": "reg2reg", "slack": -0.01,
                        "path_alternative_count": 2}},
        {"kind": "PathAlternative", "native_identity": "top/reg/D:path:0",
         "attributes": {"launch": "top/launch0", "arrival": 0.51, "required": 0.50}},
        {"kind": "PathAlternative", "native_identity": "top/reg/D:path:1",
         "attributes": {"launch": "top/launch1", "arrival": 0.505, "required": 0.50}},
    ]
    if ambiguous:
        nodes.append({"kind": "Instance", "native_identity": "top/U_A_CLONE",
                      "attributes": {"master": "AND2", "semantic_signature": "sig-and-a",
                                     "logic_depth": 1, "x": 12.0, "y": 20.0}})
    return {
        "schema": "hima.design-information-graph-projection/1",
        "snapshot": {
            "snapshot_id": snapshot_id, "phase": phase,
            "design_name": "aes", "top_module": "aes_cipher_top",
            "bundle_sha256": "bundle-" + snapshot_id,
            "units": {"distance": "um", "time": "ns", "capacitance": "pF",
                      "resistance": "ohm"},
            "completeness": completeness,
            "manifest": {"tool": "synthetic-test"},
        },
        "nodes": nodes,
        "edges": [
            {"kind": "logic-dependency", "source_kind": "Instance",
             "source_native_identity": first_name, "target_kind": "Net",
             "target_native_identity": "top/n1", "attributes": {}},
            {"kind": "logic-dependency", "source_kind": "Net",
             "source_native_identity": "top/n1", "target_kind": "Instance",
             "target_native_identity": "top/U_B", "attributes": {}},
            {"kind": "timing-alternative", "source_kind": "PathAlternative",
             "source_native_identity": "top/reg/D:path:0", "target_kind": "EndpointState",
             "target_native_identity": "top/reg/D", "attributes": {}},
            {"kind": "timing-alternative", "source_kind": "PathAlternative",
             "source_native_identity": "top/reg/D:path:1", "target_kind": "EndpointState",
             "target_native_identity": "top/reg/D", "attributes": {}},
        ],
        "hyperedges": [{"kind": "driver-to-sinks", "native_identity": "top/n1",
                        "attributes": {"fanout": 1},
                        "members": [
                            {"kind": "Instance", "native_identity": first_name, "role": "driver"},
                            {"kind": "Instance", "native_identity": "top/U_B", "role": "sink"},
                        ]}],
    }


class DesignInformationGraphTests(unittest.TestCase):
    def test_projection_hash_is_deterministic_and_identity_is_snapshot_scoped(self):
        first = validate_projection(projection("place-1", "place"))
        second = validate_projection(projection("place-1", "place"))
        self.assertEqual(first["snapshot"]["graph_sha256"], second["snapshot"]["graph_sha256"])
        self.assertNotEqual(hima_id("place-1", "Instance", "top/U_A"),
                            hima_id("post-1", "Instance", "top/U_A"))

    def test_projection_rejects_missing_units_and_dangling_edges(self):
        missing = projection("place-1", "place")
        del missing["snapshot"]["units"]["time"]
        with self.assertRaisesRegex(DesignInformationGraphError, "missing units"):
            validate_projection(missing)
        dangling = projection("place-1", "place")
        dangling["edges"][0]["source_native_identity"] = "top/missing"
        with self.assertRaisesRegex(DesignInformationGraphError, "edge source"):
            validate_projection(dangling)

    def test_store_has_hyperedges_rtree_local_window_and_append_only_annotations(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "dig.sqlite"
            snap = store_projection(database, projection("place-1", "place"))
            with DigStore(database) as store:
                seed = hima_id("place-1", "Net", "top/n1")
                window = store.project_local_window(
                    "place-1", [seed], backward_hops=1, forward_hops=1,
                    required_attributes={"Instance": ["logic_depth"]},
                    endpoint_alternatives=["top/reg/D:path:0", "top/reg/D:path:1"],
                )
                self.assertEqual(len([row for row in window["nodes"] if row["kind"] == "Instance"]), 2)
                self.assertEqual(len(store.nearby_nodes("place-1", 8, 13, 18, 22)), 1)
                annotation = {
                    "annotation_id": "ann-1", "snapshot_id": "place-1",
                    "layer": "local-proxy", "annotation_type": "logic-depth",
                    "base_graph_sha256": snap["graph_sha256"],
                    "producer_code_sha256": "code-1", "method_version": "v4",
                    "phase": "place", "inputs": {}, "units": {"logic_depth": "count"},
                    "assumptions": [], "value_vector": {"logic_depth": 2},
                    "uncertainty": {}, "status": "observed", "run_id": "test",
                    "iteration": 0, "scope": [{"object_id": seed, "object_kind": "node"}],
                }
                store.add_annotation(annotation)
                with self.assertRaises(sqlite3.IntegrityError):
                    store.connection.execute(
                        "UPDATE annotations SET status='changed' WHERE annotation_id='ann-1'"
                    )
                bad = dict(annotation, annotation_id="ann-bad", base_graph_sha256="wrong")
                with self.assertRaisesRegex(DigStoreError, "base graph hash"):
                    store.add_annotation(bad)

    def test_local_window_fails_closed_on_missing_attributes(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "dig.sqlite"
            store_projection(database, projection("place-1", "place"))
            with DigStore(database) as store:
                seed = hima_id("place-1", "Net", "top/n1")
                with self.assertRaisesRegex(DigStoreError, "missing"):
                    store.project_local_window(
                        "place-1", [seed], required_attributes={"Net": ["route_length"]}
                    )

    def test_cross_phase_map_uses_exact_semantic_ambiguous_and_absent_relations(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "dig.sqlite"
            store_projection(database, projection("place-1", "place", ambiguous=True))
            # store_projection creates the schema idempotently and adds the second snapshot.
            store_projection(database, projection("post-1", "postroute", renamed=True))
            with DigStore(database) as store:
                mapping = build_cross_phase_map(store, "place-1", "post-1")
                by_source = {}
                for row in mapping["correspondences"]:
                    by_source.setdefault(row["source_id"], []).append(row)
                renamed = hima_id("post-1", "Instance", "top/U_A_RENAMED")
                self.assertEqual({row["relation_type"] for row in by_source[renamed]}, {"ambiguous"})
                exact = hima_id("post-1", "Instance", "top/U_B")
                self.assertEqual(by_source[exact][0]["relation_type"], "one-to-one")
                self.assertEqual(len(mapping["map_sha256"]), 64)

    def test_complete_bundle_cannot_hide_missing_postroute_spef(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            roles = ("netlist", "def", "sdc", "timing_facts", "clock_facts", "census")
            artifacts = []
            for role in roles:
                path = root / (role + ".txt")
                path.write_text(role)
                import hashlib
                artifacts.append({"role": role, "path": path.name,
                                  "sha256": hashlib.sha256(role.encode()).hexdigest()})
            (root / "manifest.json").write_text(json.dumps({
                "schema": "hima.innovus-dig-export/1", "phase": "postroute",
                "completeness": "complete", "artifacts": artifacts,
            }))
            with self.assertRaisesRegex(DesignInformationGraphError, "missing roles"):
                validate_bundle(root)

    def test_bundle_builder_is_hash_bound_and_downgrades_sampled_timing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, value in {
                "design.v": "module top; endmodule\n", "design.def": "VERSION 5.8 ;\n",
                "constraints.sdc": "create_clock -period 1 clk\n",
                "parasitics.spef": "*SPEF IEEE 1481-1998\n",
                "census.tsv": "kind\tname\tmaster\tx\ty\tplace_status\n",
                "tool-version.txt": "Innovus test\n",
                "checkpoint-facts.tsv": (
                    "phase\tpostroute\ntop\ttop\ndatabase\tdb.enc.dat\n"
                    "instance_count\t0\nnet_count\t0\ndbu_per_micron\t2000\n"
                    "spef_status\tok\n"
                ),
            }.items():
                (root / name).write_text(value)
            result = publish_bundle(root, "fixture", "postroute", "top")
            self.assertEqual(result["manifest"]["completeness"], "partial")
            self.assertEqual(validate_bundle(root)["bundle_sha256"], result["bundle_sha256"])
            (root / "design.v").write_text("changed")
            with self.assertRaisesRegex(DesignInformationGraphError, "hash mismatch"):
                validate_bundle(root)

    def test_timing_facts_preserve_endpoint_alternatives_and_detect_saturation(self):
        report = """#  Design: top
#  Command: report_timing -max_paths 100 -nworst 2
Path 1: VIOLATED Setup Check
Endpoint: reg0/D checked
Beginpoint: reg1/Q triggered
Path Groups: {clk}
Analysis View: view0
Other End Arrival Time 0.050
= Required Time 0.400
- Arrival Time 0.420
= Slack Time -0.020
     + Clock Network Latency (Prop) 0.030
| Pin | Edge | Net | Cell | Delay | Arrival | Required |
| U0/A | ^ | n0 | AND2 | 0.010 | 0.300 | 0.400 |
Path 2: MET Setup Check
Endpoint: reg0/D checked
Beginpoint: reg2/Q triggered
Path Groups: {clk}
Analysis View: view0
Other End Arrival Time 0.050
= Required Time 0.400
- Arrival Time 0.395
= Slack Time 0.005
     + Clock Network Latency (Prop) 0.025
| Pin | Edge | Net | Cell | Delay | Arrival | Required |
| U1/A | ^ | n1 | OR2 | 0.009 | 0.290 | 0.400 |
"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "timing.rpt"
            path.write_text(report)
            timing, clocks = parse_timing_report(path, max_paths=100, nworst=3,
                                                 max_slack_ns=0.1)
            self.assertEqual(timing["completeness"], "complete")
            self.assertEqual(timing["endpoint_alternatives"][0]["alternatives"], [1, 2])
            self.assertEqual(clocks["path_clock_contributions"][0]["data_arrival_ns"], 0.42)
            saturated, _ = parse_timing_report(path, max_paths=100, nworst=2,
                                                max_slack_ns=0.1)
            self.assertEqual(saturated["completeness"], "partial")
            self.assertEqual(saturated["coverage_scope"]["endpoint_limits_saturated"], ["reg0/D"])

            physical = projection("post-1", "postroute")
            # Remove the synthetic endpoint/path nodes: the timing adapter owns them.
            physical["nodes"] = [row for row in physical["nodes"]
                                 if row["kind"] not in {"EndpointState", "PathAlternative"}]
            physical["edges"] = [row for row in physical["edges"]
                                 if row["kind"] != "timing-alternative"]
            joined = augment_timing_projection(physical, timing, clocks)
            normalized = validate_projection(joined)
            paths = [row for row in normalized["nodes"] if row["kind"] == "PathAlternative"]
            endpoints = [row for row in normalized["nodes"] if row["kind"] == "EndpointState"]
            self.assertEqual(len(paths), 2)
            self.assertEqual(endpoints[0]["attributes"]["path_alternative_count"], 2)


if __name__ == "__main__":
    unittest.main()
