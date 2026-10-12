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
from mage_placement import core, snapshot  # noqa: E402

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

    def _snapshot_with_blocking_fit_in_v_cols(self):
        """A copy of the start snapshot with one extra Fit occupying the
        *whole* along range of the far exterior V track (`V:2`, the right
        edge of this 2x2-die frame) -- after the exterior fold, this
        leaves no room anywhere in the physical `V:0` lane for a 900 um
        slot, even though `V:0` itself (x band [0, 60] um) is otherwise
        completely empty."""
        snap = json.loads(self.start_snapshot_path.read_text(encoding="utf-8"))
        v_cols_band = next(entry for entry in snap["lanes"] if entry["laneId"] == "V:2")
        cross_lo, cross_hi = v_cols_band["crossRangeDbu"]
        along_lo, along_hi = v_cols_band["alongRangeDbu"]
        snap["fits"].append({
            "id": "BLOCK.BLOCK_1", "base": "BLOCK", "boxDbu": [cross_lo, along_lo, cross_hi, along_hi],
            "extraRot": "NULL", "postfix": "", "inGroup": "", "blockType": None, "priority": False,
            "ruleItem": None, "lane": {"axis": "V", "track": 2},
        })
        snap.pop("id", None)
        snap.pop("snapshotSha256", None)
        snap["id"] = core.digest(snap)
        snap["snapshotSha256"] = snapshot.snapshot_sha(snap)
        path = self.root / "blocked-snapshot.json"
        path.write_text(json.dumps(snap), encoding="utf-8")
        return path

    def test_exterior_fold_sees_an_occupant_of_the_far_track(self):
        blocked_path = self._snapshot_with_blocking_fit_in_v_cols()

        blocked_out = self.root / "plan-blocked.json"
        result = _run([
            "plan-slots", self.workspace, "--snapshot", blocked_path,
            "--lane", "V:0", "--length-um", "900", "--count", "1", "--limit-um", "100", "--out", blocked_out,
        ])
        self.assertEqual(result.returncode, 0, result.stderr)
        blocked_body = json.loads(blocked_out.read_text(encoding="utf-8"))
        self.assertEqual(blocked_body["maxSlots"], 0)
        self.assertFalse(blocked_body["feasible"])
        self.assertEqual(blocked_body["lane"], "V:0")
        self.assertEqual(blocked_body["foldedTracks"], [0, 2])

        # Querying the far track's own lane id plans the identical folded
        # physical lane (same `maxSlots`, same `lane`/`foldedTracks`).
        far_out = self.root / "plan-far.json"
        result = _run([
            "plan-slots", self.workspace, "--snapshot", blocked_path,
            "--lane", "V:2", "--length-um", "900", "--count", "1", "--limit-um", "100", "--out", far_out,
        ])
        self.assertEqual(result.returncode, 0, result.stderr)
        far_body = json.loads(far_out.read_text(encoding="utf-8"))
        self.assertEqual(far_body["maxSlots"], 0)
        self.assertEqual(far_body["lane"], "V:0")
        self.assertEqual(far_body["foldedTracks"], [0, 2])

        # Removing the blocking fit frees exactly one slot in the (now
        # entirely empty) physical lane.
        snap = json.loads(blocked_path.read_text(encoding="utf-8"))
        snap["fits"] = [f for f in snap["fits"] if f["id"] != "BLOCK.BLOCK_1"]
        snap.pop("id", None)
        snap.pop("snapshotSha256", None)
        snap["id"] = core.digest(snap)
        snap["snapshotSha256"] = snapshot.snapshot_sha(snap)
        unblocked_path = self.root / "unblocked-snapshot.json"
        unblocked_path.write_text(json.dumps(snap), encoding="utf-8")

        unblocked_out = self.root / "plan-unblocked.json"
        result = _run([
            "plan-slots", self.workspace, "--snapshot", unblocked_path,
            "--lane", "V:0", "--length-um", "900", "--count", "1", "--limit-um", "100", "--out", unblocked_out,
        ])
        self.assertEqual(result.returncode, 0, result.stderr)
        unblocked_body = json.loads(unblocked_out.read_text(encoding="utf-8"))
        self.assertEqual(unblocked_body["maxSlots"], 1)
        self.assertTrue(unblocked_body["feasible"])


if __name__ == "__main__":
    unittest.main()
