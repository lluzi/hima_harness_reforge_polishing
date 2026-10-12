"""Subprocess tests for the `plan-slots` resident subcommand against the
synthetic start snapshot."""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core  # noqa: E402

from tests import fixtures  # noqa: E402


FLOW_DIR = Path(__file__).resolve().parents[1]
CLI = FLOW_DIR / "mage_placement_cli.py"


def _run(args):
    result = subprocess.run([sys.executable, str(CLI)] + [str(a) for a in args], capture_output=True, text=True)
    return result


def _write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj), encoding="utf-8")
    return path


class PlanSlotsTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.workspace = self.root / "workspace"
        self.workspace.mkdir()

        self.case = fixtures.make_case(self.root)
        site_caps = fixtures.make_site_capabilities(self.root, "")

        goal = {"TARGET_DROPPED": 0, "MAX_TARGET_DISTANCE_UM": 100, "MAX_ORDER_DEVIATION": 2}
        task_input = _write_json(self.root / "prepare-input.json", {
            "MAGE_CASE_MANIFEST": self.case["files"]["manifest"],
            "CONSUMER_CONTEXT": self.case["files"]["consumerContext"],
            "SITE_CAPABILITIES": site_caps,
            **goal,
        })
        task_output = self.root / "prepare-output.json"
        result = _run(["task-prepare-case", self.workspace, task_input, task_output])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.start_snapshot_path = self.workspace / "state" / "start-snapshot.json"

    def tearDown(self):
        self._tmp.cleanup()

    def test_one_slot_in_the_empty_interior_vertical_lane_is_feasible_with_zero_moves(self):
        out_path = self.root / "plan1.json"
        result = _run([
            "plan-slots", self.workspace, "--snapshot", self.start_snapshot_path,
            "--lane", "V:1", "--length-um", "900", "--count", "1", "--limit-um", "100", "--out", out_path,
        ])
        self.assertEqual(result.returncode, 0, result.stderr)
        body = json.loads(out_path.read_text(encoding="utf-8"))
        self.assertTrue(body["feasible"])
        self.assertEqual(body["movedCount"], 0)
        self.assertEqual(body["moves"], [])
        self.assertEqual(len(body["slotStarts"]), 1)
        slot_start_dbu = body["slotStarts"][0]
        along_low, along_high = 0, core.um_to_dbu("1780", 10000)
        self.assertGreaterEqual(slot_start_dbu, along_low)
        self.assertLessEqual(slot_start_dbu + core.um_to_dbu("900", 10000), along_high)

    def test_two_wide_slots_in_the_same_lane_are_infeasible(self):
        out_path = self.root / "plan2.json"
        result = _run([
            "plan-slots", self.workspace, "--snapshot", self.start_snapshot_path,
            "--lane", "V:1", "--length-um", "1700", "--count", "2", "--limit-um", "100", "--out", out_path,
        ])
        self.assertEqual(result.returncode, 0, result.stderr)
        body = json.loads(out_path.read_text(encoding="utf-8"))
        self.assertFalse(body["feasible"])
        self.assertIsNotNone(body["infeasibleReason"])

    def test_h0_lane_moves_are_limited_to_priority_fits_within_their_windows(self):
        out_path = self.root / "plan3.json"
        result = _run([
            "plan-slots", self.workspace, "--snapshot", self.start_snapshot_path,
            "--lane", "H:0", "--length-um", "100", "--count", "1", "--limit-um", "100", "--out", out_path,
        ])
        self.assertEqual(result.returncode, 0, result.stderr)
        body = json.loads(out_path.read_text(encoding="utf-8"))
        self.assertTrue(body["feasible"])

        snap = json.loads(self.start_snapshot_path.read_text(encoding="utf-8"))
        priority_ids = {f["id"] for f in snap["fits"] if f.get("priority") and f["lane"] == {"axis": "H", "track": 0}}
        self.assertTrue(priority_ids)  # OVL_A, OVL_B

        targets_by_fit = {t["fitId"]: t for t in snap["targets"] if t.get("fitId")}
        fits_by_id = {f["id"]: f for f in snap["fits"]}
        limit_dbu = core.um_to_dbu("100", 10000)

        for move in body["moves"]:
            self.assertIn(move["id"], priority_ids, f"{move['id']} moved but is not a priority fit in H:0")
            fit = fits_by_id[move["id"]]
            length_dbu = fit["boxDbu"][2] - fit["boxDbu"][0]
            target = targets_by_fit[move["id"]]
            ct_dbu = target["ctDbu"][0]
            centre_dbu = (fit["boxDbu"][0] + fit["boxDbu"][2]) // 2
            deviation_dbu = abs(centre_dbu - ct_dbu)
            effective_limit_dbu = max(limit_dbu, deviation_dbu)
            lo_dbu = ct_dbu - effective_limit_dbu - length_dbu // 2
            hi_dbu = ct_dbu + effective_limit_dbu - length_dbu // 2
            self.assertGreaterEqual(move["toDbu"], lo_dbu)
            self.assertLessEqual(move["toDbu"], hi_dbu)


if __name__ == "__main__":
    unittest.main()
