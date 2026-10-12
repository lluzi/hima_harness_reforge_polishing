"""`tasks.measure_incumbent`'s F8 (identity-unknown) fallback: when the
incumbent PLA's own Group target points no longer match the CSV targets
one-for-one and its Group labels are renumbered (the real vendor
post-refine incumbent's own shape -- see spec section 9/13), binding by
Group point raises `MageError('identity')` and `measure_incumbent` must
fall back to carrying each target's fit id over from the start snapshot,
recording `identity.method: 'fit-id'` and reporting the Q2 target-distance
comparison against this incumbent as `unknown`, never a delta.
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core, pla, tasks  # noqa: E402

from tests import fixtures  # noqa: E402


def _goal():
    return {"TARGET_DROPPED": 0, "MAX_TARGET_DISTANCE_UM": 100, "MAX_ORDER_DEVIATION": 2}


class IncumbentIdentityTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.workspace = self.root / "workspace"
        self.workspace.mkdir()
        self.case = fixtures.make_case(self.root)
        self.site_caps = fixtures.make_site_capabilities(self.root, "")

    def tearDown(self):
        self._tmp.cleanup()

    def _prepare(self):
        return tasks.prepare_case(self.workspace, {
            "MAGE_CASE_MANIFEST": self.case["files"]["manifest"],
            "CONSUMER_CONTEXT": self.case["files"]["consumerContext"],
            "SITE_CAPABILITIES": self.site_caps,
            **_goal(),
        })["value"]

    def test_group_point_binding_succeeds_on_the_unmodified_fixture(self):
        prepare_value = self._prepare()
        result = tasks.measure_incumbent(self.workspace, {"CASE": prepare_value, "INCUMBENT_COMPARISON": "retained"})
        incumbent_doc = core.read_artifact(self.workspace / "state" / "incumbent.json", "incumbent-measure")
        identity = incumbent_doc["metrics"]["identity"]
        self.assertEqual(identity["method"], "group-point")
        self.assertEqual(identity["unmatchedTargets"], 0)
        self.assertEqual(incumbent_doc["metrics"]["targetDistances"]["identity"], "known")
        self.assertIn("snapshotSha256", result["value"])

    def test_renumbered_incumbent_groups_fall_back_to_fit_id_and_report_q2_unknown(self):
        dbu_per_um = self.case["manifest"]["dbuPerUm"]
        incumbent_path = Path(self.case["files"]["incumbentState"])
        doc = pla.read_pla(incumbent_path.read_text(encoding="utf-8"), dbu_per_um)

        # Shift every Group's own target point away from the CSV's CT
        # points and renumber the Group labels -- exactly what a real
        # vendor post-refine incumbent PLA does; `targets.bind_targets`
        # against these groups can bind zero or more than one row, so it
        # raises `MageError('identity')` for `measure_incumbent` to catch.
        for group in doc["groups"]:
            x, y = group["targetPointDbu"]
            group["targetPointDbu"] = [x + core.um_to_dbu("37", dbu_per_um), y + core.um_to_dbu("11", dbu_per_um)]
            group["pinstGroup"] = group["pinstGroup"] + "_RENUM"
        for fit in doc["fits"]:
            if fit["inGroup"]:
                fit["inGroup"] = fit["inGroup"] + "_RENUM"

        incumbent_path.write_text(pla.write_pla(doc, dbu_per_um, units="um"), encoding="utf-8")
        # The manifest's own sha256 for incumbentState must track the edit.
        manifest_path = Path(self.case["files"]["manifest"])
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["incumbentState"]["sha256"] = core.file_sha256(incumbent_path)
        manifest["id"] = core.digest({k: v for k, v in manifest.items() if k != "id"})
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

        prepare_value = self._prepare()
        incumbent_value = tasks.measure_incumbent(
            self.workspace, {"CASE": prepare_value, "INCUMBENT_COMPARISON": "retained"},
        )["value"]

        incumbent_doc = core.read_artifact(self.workspace / "state" / "incumbent.json", "incumbent-measure")
        identity = incumbent_doc["metrics"]["identity"]
        self.assertEqual(identity["method"], "fit-id")
        self.assertGreaterEqual(identity["inGroupRelabels"], 1)
        self.assertEqual(incumbent_doc["metrics"]["targetDistances"]["identity"], "identity-unknown")

        decision = {
            "best": {
                "metrics": {
                    "drops": {"count": 0, "lengthUm": "0"},
                    "targetDistances": {"overLimitCount": 0, "maxUm": "0", "identity": "known"},
                    "orderDeviation": {"max": 0},
                    "displacement": {"movedCount": 0, "totalUm": "0"},
                    "nativeRows": {"total": 0},
                },
                "readerValues": [],
                "round": 1,
            },
            "nextRound": {"round": 2},
            "openRequestCount": 0, "decisionRequestCount": 0, "stopReason": "",
        }
        evaluation = tasks.evaluate_placement(self.workspace, {
            "DECISION": decision, "INCUMBENT": incumbent_value, **_goal(),
        })["value"]
        self.assertIn("unknown", evaluation["comparison"]["Q2_targetDistanceDelta"])
        self.assertNotIn("value", evaluation["comparison"]["Q2_targetDistanceDelta"])
        # Q1/Q3/Q4 are unaffected -- still real numbers.
        self.assertIn("value", evaluation["comparison"]["Q1_dropsDelta"])


if __name__ == "__main__":
    unittest.main()
