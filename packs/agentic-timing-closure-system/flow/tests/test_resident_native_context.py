"""Retained native timing input identity and no-PT context preparation."""
from __future__ import annotations

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

TESTS = Path(__file__).resolve().parent
FLOW = TESTS.parent
sys.path[:0] = [str(FLOW), str(TESTS)]

import atcs_cli as cli  # noqa: E402
from atcs import core  # noqa: E402
from test_cli_state import REQUIRED_SCENARIOS, _make_baseline_manifest, _xtop_site_config  # noqa: E402


class ResidentNativeContextTest(unittest.TestCase):
    def setUp(self):
        self.w = Path(tempfile.mkdtemp(prefix="atcs-resident-native-"))
        self.addCleanup(shutil.rmtree, self.w, ignore_errors=True)
        self.manifest = _make_baseline_manifest(self.w)
        self.manifest_path = self.w / "manifest.json"
        self.manifest_path.write_text(json.dumps(self.manifest), encoding="utf-8")
        self.site_path = self.w / "site.json"
        self.site_path.write_text(json.dumps(_xtop_site_config(self.w, REQUIRED_SCENARIOS)), encoding="utf-8")
        self.sta = self.w / "retained/sta-data"
        self.sta.mkdir(parents=True)
        (self.sta / "timing_data_finish").write_text("real retained timing bytes\n", encoding="utf-8")
        self.source = self.w / "retained/source-report.rpt"
        self.source.write_text("PrimeTime source report retained before this Pack run\n", encoding="utf-8")
        constraint = self.w / "constraints.sdc"
        self.native = {
            "schema": "atcs.native-timing-context/1",
            "designStateManifestSha256": core.file_sha256(self.manifest_path),
            "requiredScenarios": list(REQUIRED_SCENARIOS),
            "staData": {"path": str(self.sta), "digest": core.tree_digest(self.sta)},
            "sourceReports": [{"path": str(self.source), "sha256": core.file_sha256(self.source)}],
            "constraints": [{"path": str(constraint), "sha256": core.file_sha256(constraint)}],
            "producer": {"tool": "PrimeTime", "version": "retained-fixture", "command": "write_timing_data"},
        }
        self.native_path = self.w / "native-timing-context.json"
        self.native_path.write_text(json.dumps(self.native), encoding="utf-8")

    def test_context_is_copied_rehashed_and_bound_to_the_staged_baseline(self):
        readiness_path, _ = cli._cmd_bind_resident_inputs(
            self.w, [str(self.manifest_path), str(self.site_path), str(self.native_path)])
        self.assertEqual(readiness_path, self.w / "state/readiness.json")
        self.assertEqual(cli.main(["baseline", str(self.w), str(self.manifest_path)]), 0)
        self.assertEqual(cli.main([
            "prepare-native-context", str(self.w), str(self.native_path), str(self.site_path),
        ]), 0)
        context = cli._read_declared(self.w / "state/xtop-context.json", "xtop-context")
        baseline = cli._read_declared(self.w / "state/baseline.json", "design-state")
        self.assertEqual(context["designStateId"], baseline["id"])
        copied = self.w / context["staData"]["path"]
        self.assertNotEqual(copied.resolve(), self.sta.resolve())
        self.assertEqual(core.tree_digest(copied), self.native["staData"]["digest"])
        self.assertEqual(context["requiredScenarios"], list(REQUIRED_SCENARIOS))
        self.assertEqual(len(context["sourceReports"]), 1)

    def test_changed_retained_timing_bytes_are_refused_before_any_native_run(self):
        (self.sta / "timing_data_finish").write_text("changed after declaration\n", encoding="utf-8")
        with self.assertRaisesRegex(core.AtcsError, "retained native STA data"):
            cli._cmd_bind_resident_inputs(
                self.w, [str(self.manifest_path), str(self.site_path), str(self.native_path)])

    def test_context_for_another_manifest_is_refused(self):
        self.native["designStateManifestSha256"] = "0" * 64
        self.native_path.write_text(json.dumps(self.native), encoding="utf-8")
        with self.assertRaisesRegex(core.AtcsError, "another designStateManifest"):
            cli._cmd_bind_resident_inputs(
                self.w, [str(self.manifest_path), str(self.site_path), str(self.native_path)])


class XtopNativeInputTest(unittest.TestCase):
    """An XTop-native design (netlist + DEF + retained STA dump, no Innovus DB/SPEF/SDC).

    The vendor XTop tutorial ships exactly this shape: its constraints exist only inside the
    retained PrimeTime dump, and it has two modes (func/test) over two corners.
    """

    SCENARIOS = ["func_slow", "func_fast", "test_slow", "test_fast"]

    def setUp(self):
        self.w = Path(tempfile.mkdtemp(prefix="atcs-xtop-native-"))
        self.addCleanup(shutil.rmtree, self.w, ignore_errors=True)
        (self.w / "cpu.v.gz").write_bytes(b"netlist-bytes")
        (self.w / "cpu.def.gz").write_bytes(b"def-bytes")
        libs = {}
        for corner in ("slow", "fast"):
            directory = self.w / "lib" / corner
            directory.mkdir(parents=True)
            (directory / f"tutorial{corner}.idb").write_bytes(b"idb")
            libs[corner] = str(directory / "*.idb")
        self.manifest = {
            "inputKind": "xtop-native", "top": "cpu", "stage": "postroute", "root": str(self.w),
            "netlist": "cpu.v.gz", "def": "cpu.def.gz",
            "libraries": [str(self.w / "lib/slow/tutorialslow.idb"), str(self.w / "lib/fast/tutorialfast.idb")],
            "scenarios": [{"name": name, "corner": name.split("_")[1]} for name in self.SCENARIOS],
            "tools": {"xtop": "XTop 2025.09.tmp15"},
        }
        self.manifest_path = self.w / "manifest.json"
        self.manifest_path.write_text(json.dumps(self.manifest), encoding="utf-8")
        self.site = {"xtopContext": {
            "siteMap": ["unit", "core12T"], "removableFillers": ["FILL*"],
            "scenarios": [{"name": name, "mode": name.split("_")[0], "corner": name.split("_")[1],
                           "libertyGlob": libs[name.split("_")[1]]} for name in self.SCENARIOS],
            "ecoParameters": {
                "bufferListForHold": ["DEL1EP"], "bufferListForSetup": ["BUFFD4EP"],
                "cellClassifyRule": "cell_attribute", "cellMatchAttribute": "footprint",
                "cellNominalSwapKeywords": ["LVT", "", "HVT"],
                "cellNominalSizingPattern": "D([0-9]+)EP", "gainThreshold": 0.001,
            },
        }}
        self.site_path = self.w / "site.json"
        self.site_path.write_text(json.dumps(self.site), encoding="utf-8")
        self.sta = self.w / "retained/sta_data"
        self.sta.mkdir(parents=True)
        (self.sta / "func_slow_data_finish").write_text("dumped\n", encoding="utf-8")
        source = self.w / "retained/func_slow_data_timing_rpt.txt.gz"
        source.write_bytes(b"report")
        self.native = {
            "schema": "atcs.native-timing-context/1",
            "designStateManifestSha256": core.file_sha256(self.manifest_path),
            "requiredScenarios": list(self.SCENARIOS),
            "staData": {"path": str(self.sta), "digest": core.tree_digest(self.sta)},
            "sourceReports": [{"path": str(source), "sha256": core.file_sha256(source)}],
            "constraints": [], "constraintsEmbeddedIn": "staData",
            "producer": {"tool": "PrimeTime", "version": "vendor-dump", "command": "pt_util2.tcl"},
        }
        self.native_path = self.w / "native.json"
        self.native_path.write_text(json.dumps(self.native), encoding="utf-8")

    def test_xtop_native_design_is_ready_staged_and_bound_without_innovus_inputs(self):
        _, readiness = cli._cmd_bind_resident_inputs(
            self.w, [str(self.manifest_path), str(self.site_path), str(self.native_path)])
        self.assertEqual(readiness["missing"], [])
        self.assertEqual(cli.main(["baseline", str(self.w), str(self.manifest_path)]), 0)
        baseline = cli._read_declared(self.w / "state/baseline.json", "design-state")
        self.assertEqual(baseline["inputKind"], "xtop-native")
        self.assertIsNone(baseline["database"])
        self.assertEqual(baseline["sdc"], [])
        self.assertEqual(cli.main(["prepare-native-context", str(self.w), str(self.native_path), str(self.site_path)]), 0)
        context = cli._read_declared(self.w / "state/xtop-context.json", "xtop-context")
        self.assertEqual(context["constraintsEmbeddedIn"], "staData")
        tcl = (self.w / context["libraryTcl"]["path"]).read_text()
        self.assertIn("create_mode func", tcl)
        self.assertIn("create_mode test", tcl)
        self.assertIn("create_scenario -corner slow -mode test test_slow", tcl)

    def test_an_ordinary_manifest_still_needs_its_database_spef_and_sdc(self):
        del self.manifest["inputKind"]
        self.manifest_path.write_text(json.dumps(self.manifest), encoding="utf-8")
        missing = cli.state.input_readiness(self.manifest, {})["missing"]
        self.assertIn("database.enc", missing)
        self.assertIn("sdc", missing)

    def test_empty_constraints_need_the_embedded_declaration(self):
        del self.native["constraintsEmbeddedIn"]
        self.native_path.write_text(json.dumps(self.native), encoding="utf-8")
        with self.assertRaisesRegex(Exception, "constraints"):
            cli._native_timing_input(self.native_path)

    def test_embedded_constraints_cannot_also_name_sdc_files(self):
        self.native["constraints"] = [{"path": str(self.manifest_path), "sha256": core.file_sha256(self.manifest_path)}]
        self.native_path.write_text(json.dumps(self.native), encoding="utf-8")
        with self.assertRaisesRegex(Exception, "constraintsEmbeddedIn"):
            cli._native_timing_input(self.native_path)


if __name__ == "__main__":
    unittest.main()
