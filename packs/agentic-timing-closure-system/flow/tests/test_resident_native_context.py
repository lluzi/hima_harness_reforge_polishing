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


if __name__ == "__main__":
    unittest.main()
