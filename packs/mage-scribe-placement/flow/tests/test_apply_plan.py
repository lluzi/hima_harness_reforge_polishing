"""Subprocess tests for the `apply-plan` resident subcommand.

`apply-plan` turns one or more `plan-slots` plans into a complete candidate
PLA: it moves the planned Fit boxes along their lane axis and leaves every
Group target point, Fixed instance, drop and unmoved Fit untouched. These
tests drive it exactly as a resident would -- plan on the start snapshot,
then apply -- and read the written PLA back with `pla.read_pla` to prove the
move landed and nothing else changed, that every refusal fires, and that the
candidate replays through the stand-in with a matching moved-instance count.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core, pla  # noqa: E402

from tests import fixtures  # noqa: E402


FLOW_DIR = Path(__file__).resolve().parents[1]
CLI = FLOW_DIR / "mage_placement_cli.py"
STANDIN = FLOW_DIR / "tests" / "standin_mage.py"
DBU_PER_UM = 10000


def _run_raw(args, env=None):
    return subprocess.run(
        [sys.executable, str(CLI)] + [str(a) for a in args],
        capture_output=True, text=True, env=env,
    )


def _run(args, env=None):
    result = _run_raw(args, env=env)
    assert result.returncode == 0, f"{args} failed ({result.returncode}): {result.stderr}\n{result.stdout}"
    return result


class ApplyPlanTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.workspace = self.root / "workspace"
        self.workspace.mkdir()
        os.symlink(FLOW_DIR, self.workspace / "flow")

        self.case = fixtures.make_case(self.root, mage_executable=[sys.executable, str(STANDIN)])
        self.site_caps = fixtures.make_site_capabilities(self.root, [sys.executable, str(STANDIN)])
        self.start_pla = Path(self.case["files"]["startState"])

        task_input = self.root / "prepare-input.json"
        task_input.write_text(json.dumps({
            "MAGE_CASE_MANIFEST": self.case["files"]["manifest"],
            "CONSUMER_CONTEXT": self.case["files"]["consumerContext"],
            "SITE_CAPABILITIES": self.site_caps,
            "TARGET_DROPPED": 0, "MAX_TARGET_DISTANCE_UM": 1000, "MAX_ORDER_DEVIATION": 2,
        }), encoding="utf-8")
        _run(["task-prepare-case", self.workspace, task_input, self.root / "prepare-output.json"])
        self.snapshot_path = self.workspace / "state" / "start-snapshot.json"

    def tearDown(self):
        self._tmp.cleanup()

    # -- helpers ----------------------------------------------------------

    def _plan(self, name, lane, length_um, count, limit_um="1000", extra=()):
        out = self.root / f"{name}.json"
        _run(["plan-slots", self.workspace, "--snapshot", self.snapshot_path,
              "--lane", lane, "--length-um", length_um, "--count", str(count),
              "--limit-um", limit_um, *extra, "--out", out])
        return out, json.loads(out.read_text(encoding="utf-8"))

    def _write_plan(self, name, body):
        """Stamp a hand-built slot-plan body and write it like `plan-slots` does."""
        path = self.root / f"{name}.json"
        path.write_text(json.dumps(core.stamp("slot-plan", body)), encoding="utf-8")
        return path

    def _moving_plan_body(self, lane, move_id, from_dbu, to_dbu, relaxations):
        return {
            "lane": lane,
            "slot": {"count": 1, "length": 1000000, "clearance": 0},
            "model": {"relaxations": list(relaxations), "gapsQualified": True},
            "maxSlots": 1, "feasible": True,
            "moves": [{"id": move_id, "fromDbu": from_dbu, "toDbu": to_dbu}],
            "slotStarts": [0], "totalDisplacementDbu": abs(to_dbu - from_dbu),
            "movedCount": 1, "infeasibleReason": None,
        }

    def _start_doc(self):
        return pla.read_pla(self.start_pla.read_text(encoding="utf-8"), DBU_PER_UM)

    # -- positive round trip ---------------------------------------------

    def test_apply_moves_the_planned_priority_fit_and_leaves_everything_else(self):
        plan_path, plan = self._plan("plan-h0", "H:0", "1500", 1)
        self.assertTrue(plan["feasible"])
        self.assertEqual(plan["movedCount"], 1, f"fixture plan did not need a move: {plan['moves']}")
        move = plan["moves"][0]

        out = self.root / "candidate.pla"
        # `--keep-group-points` isolates the pure move: no Group target point
        # follows the Fit, so "everything else byte-for-byte" still holds.
        # (The follow-groups default is covered by its own test below.)
        result = _run(["apply-plan", self.workspace, "--pla", self.start_pla, "--plan", plan_path,
                       "--keep-group-points", "--out", out])
        summary = json.loads(result.stdout)

        self.assertEqual(summary["movedCount"], 1)
        self.assertEqual(summary["lanes"], ["H:0"])
        self.assertEqual(summary["out"], str(out))
        expected_disp = core.dbu_to_um(abs(move["toDbu"] - move["fromDbu"]), DBU_PER_UM)
        self.assertEqual(summary["totalDisplacementUm"], expected_disp)
        self.assertEqual(summary["maxDisplacementUm"], expected_disp)

        start = self._start_doc()
        candidate = pla.read_pla(out.read_text(encoding="utf-8"), DBU_PER_UM)

        start_fit = next(f for f in start["fits"] if f["id"] == move["id"])
        moved_fit = next(f for f in candidate["fits"] if f["id"] == move["id"])
        sl, sb, sr, st = start_fit["boxDbu"]
        ml, mb, mr, mt = moved_fit["boxDbu"]
        # H lane -> moved along x: left edge == planned position, width kept,
        # cross (y) coordinates untouched.
        self.assertEqual(ml, move["toDbu"])
        self.assertEqual(mr - ml, sr - sl)
        self.assertEqual((mb, mt), (sb, st))

        # Everything else byte-for-byte equivalent: Groups, Fixed, drops, and
        # every other Fit identical between start and candidate.
        self.assertEqual(candidate["groups"], start["groups"])
        self.assertEqual(candidate["fixed"], start["fixed"])
        self.assertEqual(candidate["drops"], start["drops"])
        others_start = [f for f in start["fits"] if f["id"] != move["id"]]
        others_candidate = [f for f in candidate["fits"] if f["id"] != move["id"]]
        self.assertEqual(others_candidate, others_start)

    # -- refusals ---------------------------------------------------------

    def test_two_plans_moving_the_same_id_are_refused(self):
        plan_path, _ = self._plan("plan-dup", "H:0", "1500", 1)
        result = _run_raw(["apply-plan", self.workspace, "--pla", self.start_pla,
                           "--plan", plan_path, "--plan", plan_path, "--out", self.root / "c.pla"])
        self.assertEqual(result.returncode, 3, result.stdout)
        self.assertIn("apply-plan", result.stderr)
        self.assertIn("same id", result.stderr)

    def test_a_move_of_an_unknown_id_is_refused(self):
        _plan_path, plan = self._plan("plan-unknown", "H:0", "1500", 1)
        plan["moves"] = [{**plan["moves"][0], "id": "NOPE.NOPE_1"}]
        bad = self._write_plan("plan-unknown-bad", {k: v for k, v in plan.items() if k not in ("id", "schema")})
        result = _run_raw(["apply-plan", self.workspace, "--pla", self.start_pla,
                           "--plan", bad, "--out", self.root / "c.pla"])
        self.assertEqual(result.returncode, 3, result.stdout)
        self.assertIn("apply-plan", result.stderr)
        self.assertIn("not a Fit", result.stderr)

    def test_a_move_of_a_fixed_instance_is_refused(self):
        _plan_path, plan = self._plan("plan-fixed", "H:0", "1500", 1)
        fixed_id = self._start_doc()["fixed"][0]["id"]
        plan["moves"] = [{**plan["moves"][0], "id": fixed_id}]
        bad = self._write_plan("plan-fixed-bad", {k: v for k, v in plan.items() if k not in ("id", "schema")})
        result = _run_raw(["apply-plan", self.workspace, "--pla", self.start_pla,
                           "--plan", bad, "--out", self.root / "c.pla"])
        self.assertEqual(result.returncode, 3, result.stdout)
        self.assertIn("Fixed instance", result.stderr)

    def test_an_infeasible_plan_is_refused(self):
        plan_path, plan = self._plan("plan-infeasible", "H:0", "2000", 1)
        self.assertFalse(plan["feasible"])
        result = _run_raw(["apply-plan", self.workspace, "--pla", self.start_pla,
                           "--plan", plan_path, "--out", self.root / "c.pla"])
        self.assertEqual(result.returncode, 3, result.stdout)
        self.assertIn("infeasible", result.stderr)

    def test_a_non_priority_move_is_refused_without_the_relaxation_and_accepted_with_it(self):
        # A PLA with one ordinary (empty inGroup) OVL_F Fit in an H lane.
        doc = self._start_doc()
        doc["fits"].append({
            "id": "OVL_F.OVL_F_1", "base": "OVL_F", "inst": "OVL_F.OVL_F_1",
            "boxDbu": [5500000, 20000, 6500000, 580000],
            "extraRot": "NULL", "postfix": "", "inGroup": "",
        })
        ordinary_pla = self.root / "ordinary.pla"
        ordinary_pla.write_text(pla.write_pla(doc, DBU_PER_UM, units="um"), encoding="utf-8")

        plain = self._write_plan("plan-ordinary-plain", self._moving_plan_body(
            "H:1", "OVL_F.OVL_F_1", 5500000, 7000000, relaxations=[]))
        refused = _run_raw(["apply-plan", self.workspace, "--pla", ordinary_pla,
                            "--plan", plain, "--out", self.root / "c.pla"])
        self.assertEqual(refused.returncode, 3, refused.stdout)
        self.assertIn("non-priority", refused.stderr)
        self.assertIn("movableNonpriority", refused.stderr)

        relaxed = self._write_plan("plan-ordinary-relaxed", self._moving_plan_body(
            "H:1", "OVL_F.OVL_F_1", 5500000, 7000000, relaxations=["movableNonpriority"]))
        out = self.root / "ordinary-candidate.pla"
        result = _run(["apply-plan", self.workspace, "--pla", ordinary_pla, "--plan", relaxed, "--out", out])
        summary = json.loads(result.stdout)
        self.assertEqual(summary["movedCount"], 1)
        candidate = pla.read_pla(out.read_text(encoding="utf-8"), DBU_PER_UM)
        moved = next(f for f in candidate["fits"] if f["id"] == "OVL_F.OVL_F_1")
        self.assertEqual(moved["boxDbu"], [7000000, 20000, 8000000, 580000])

    # -- follow-groups (default on) --------------------------------------

    def test_follow_groups_default_shifts_the_moved_marks_group_point(self):
        plan_path, plan = self._plan("plan-fg", "H:0", "1500", 1)
        self.assertEqual(plan["movedCount"], 1)
        move = plan["moves"][0]
        start = self._start_doc()
        moved_fit = next(f for f in start["fits"] if f["id"] == move["id"])
        label = moved_fit["inGroup"]
        start_group = next(g for g in start["groups"] if g["pinstGroup"] == label)
        delta = move["toDbu"] - move["fromDbu"]

        default_out = self.root / "fg-default.pla"
        summary = json.loads(_run(["apply-plan", self.workspace, "--pla", self.start_pla,
                                   "--plan", plan_path, "--out", default_out]).stdout)
        self.assertEqual(summary["groupPointsShifted"], 1)
        default_group = next(g for g in pla.read_pla(default_out.read_text(encoding="utf-8"), DBU_PER_UM)["groups"]
                             if g["pinstGroup"] == label)
        # H lane -> the Group point follows along x by the Fit's delta.
        self.assertEqual(default_group["targetPointDbu"],
                         [start_group["targetPointDbu"][0] + delta, start_group["targetPointDbu"][1]])

        keep_out = self.root / "fg-keep.pla"
        summary = json.loads(_run(["apply-plan", self.workspace, "--pla", self.start_pla, "--plan", plan_path,
                                   "--keep-group-points", "--out", keep_out]).stdout)
        self.assertEqual(summary["groupPointsShifted"], 0)
        keep_group = next(g for g in pla.read_pla(keep_out.read_text(encoding="utf-8"), DBU_PER_UM)["groups"]
                          if g["pinstGroup"] == label)
        self.assertEqual(keep_group["targetPointDbu"], start_group["targetPointDbu"])

    # -- reserve ----------------------------------------------------------

    def _incumbent_pla_path(self):
        return Path(self.case["files"]["incumbentState"])

    def test_reserve_places_the_vert_key_at_a_slot_start_with_clearance(self):
        plan_path, plan = self._plan("plan-res-v", "V:1", "902", 1, extra=("--interior",))
        self.assertTrue(plan["feasible"])
        slot_start = plan["slotStarts"][0]

        out = self.root / "reserved-v.pla"
        summary = json.loads(_run([
            "apply-plan", self.workspace, "--pla", self.start_pla, "--plan", plan_path,
            "--reserve", self._incumbent_pla_path(), "--reserve-length-um", "900",
            "--keep-group-points", "--no-straddle-guard", "--out", out]).stdout)
        self.assertEqual(summary["reserved"], {"V": 1, "H": 0})
        self.assertEqual(summary["unreserved"], [])

        candidate = pla.read_pla(out.read_text(encoding="utf-8"), DBU_PER_UM)
        key = next(f for f in candidate["fits"] if f["id"] == "KEY_V.KEY_V")
        v1 = next(entry for entry in json.loads(self.snapshot_path.read_text(encoding="utf-8"))["lanes"]
                  if entry["laneId"] == "V:1")
        lo, hi = v1["crossRangeDbu"]
        clearance = core.um_to_dbu("1", DBU_PER_UM)
        # Cross extent is exactly the V:1 band; along start is the slot start + 1 um;
        # the 900 um x 60 um incumbent drop is transposed to a 60 um x 900 um lane box.
        self.assertEqual(key["boxDbu"][0], lo)
        self.assertEqual(key["boxDbu"][2], hi)
        self.assertEqual(key["boxDbu"][1], slot_start + clearance)
        self.assertEqual(key["boxDbu"][3] - key["boxDbu"][1], core.um_to_dbu("900", DBU_PER_UM))

    def test_reserve_reports_a_vert_key_unreserved_in_an_h_stage(self):
        plan_path, _ = self._plan("plan-res-h", "H:0", "100", 1)
        out = self.root / "reserved-h.pla"
        summary = json.loads(_run([
            "apply-plan", self.workspace, "--pla", self.start_pla, "--plan", plan_path,
            "--reserve", self._incumbent_pla_path(), "--reserve-length-um", "900",
            "--no-straddle-guard", "--out", out]).stdout)
        self.assertEqual(summary["reserved"], {"V": 0, "H": 0})
        self.assertIn("KEY_V.KEY_V", summary["unreserved"])

    def test_reserve_refuses_a_mixed_axis_plan_set(self):
        plan_v, _ = self._plan("plan-mix-v", "V:1", "902", 1, extra=("--interior",))
        plan_h, _ = self._plan("plan-mix-h", "H:0", "100", 1)
        result = _run_raw([
            "apply-plan", self.workspace, "--pla", self.start_pla, "--plan", plan_v, "--plan", plan_h,
            "--reserve", self._incumbent_pla_path(), "--reserve-length-um", "900", "--out", self.root / "c.pla"])
        self.assertEqual(result.returncode, 3, result.stdout)
        self.assertIn("apply-plan", result.stderr)
        self.assertIn("one lane axis", result.stderr)

    def test_reserve_requires_a_reserve_length(self):
        plan_path, _ = self._plan("plan-res-nolen", "V:1", "902", 1, extra=("--interior",))
        result = _run_raw([
            "apply-plan", self.workspace, "--pla", self.start_pla, "--plan", plan_path,
            "--reserve", self._incumbent_pla_path(), "--out", self.root / "c.pla"])
        self.assertEqual(result.returncode, 3, result.stdout)
        self.assertIn("reserve-length-um", result.stderr)

    # -- full V-then-H reserve-first route --------------------------------

    def test_full_v_then_h_reserve_route_replays_and_validates(self):
        # V lanes: plan interior, apply with reserve.
        plan_v, _ = self._plan("route-v", "V:1", "902", 1, extra=("--interior",))
        stage1 = self.root / "stage1-v.pla"
        _run(["apply-plan", self.workspace, "--pla", self.start_pla, "--plan", plan_v,
              "--reserve", self._incumbent_pla_path(), "--reserve-length-um", "900",
              "--no-straddle-guard", "--out", stage1])

        # Re-snapshot the V-placed PLA, then plan the H lanes on it.
        stage1_snap = self.root / "stage1-snap.json"
        _run(["snapshot", self.workspace, "--pla", stage1, "--stage", "candidate", "--out", stage1_snap])
        plan_h = self.root / "route-h.json"
        _run(["plan-slots", self.workspace, "--snapshot", stage1_snap, "--lane", "H:1",
              "--length-um", "102", "--count", "1", "--limit-um", "1000", "--interior", "--out", plan_h])

        reserved = self.root / "reserved.pla"
        _run(["apply-plan", self.workspace, "--pla", stage1, "--plan", plan_h,
              "--reserve", self._incumbent_pla_path(), "--reserve-length-um", "900", "--out", reserved])

        # One real round (--fill) on the reserved PLA, then the candidate.
        round_dir = self.workspace / "placement" / "round-01"
        env = dict(os.environ)
        env["MAGE_STANDIN_ROWS"] = "{}"
        _run(["mage-round", self.workspace, "--round", "1", "--pla", reserved,
              "--role", "engineer", "--out-dir", round_dir, "--fill"], env=env)
        candidate_doc_path = self.root / "route-candidate.json"
        _run(["candidate", self.workspace, "--round", "1", "--round-dir", round_dir, "--out", candidate_doc_path])
        candidate_doc = json.loads(candidate_doc_path.read_text(encoding="utf-8"))

        self.assertEqual(candidate_doc["outcome"], "completed", candidate_doc.get("stopReason"))
        # The reserved KEY_V survives the replay/fill into the exported snapshot.
        export_snap = json.loads((round_dir / "out" / "snapshot.json").read_text(encoding="utf-8"))
        self.assertIn("KEY_V.KEY_V", {f["id"] for f in export_snap["fits"]})

    def test_apply_plan_requires_at_least_one_plan(self):
        result = _run_raw(["apply-plan", self.workspace, "--pla", self.start_pla, "--out", self.root / "c.pla"])
        self.assertEqual(result.returncode, 2, f"{result.stdout}\n{result.stderr}")

    # -- replay round trip ------------------------------------------------

    def test_candidate_replays_with_a_matching_moved_instance_count(self):
        plan_path, _ = self._plan("plan-replay", "H:0", "1500", 1)
        candidate_pla = self.root / "replay-candidate.pla"
        summary = json.loads(_run(["apply-plan", self.workspace, "--pla", self.start_pla,
                                   "--plan", plan_path, "--out", candidate_pla]).stdout)

        round_dir = self.workspace / "placement" / "round-01"
        env = dict(os.environ)
        env["MAGE_STANDIN_ROWS"] = "{}"
        _run(["mage-round", self.workspace, "--round", "1", "--pla", candidate_pla,
              "--role", "engineer", "--out-dir", round_dir, "--fill"], env=env)

        candidate_doc_path = self.root / "replay-candidate.json"
        _run(["candidate", self.workspace, "--round", "1", "--round-dir", round_dir,
              "--out", candidate_doc_path])
        candidate_doc = json.loads(candidate_doc_path.read_text(encoding="utf-8"))

        self.assertEqual(candidate_doc["outcome"], "completed", candidate_doc.get("stopReason"))
        self.assertEqual(candidate_doc["metrics"]["displacement"]["movedCount"], summary["movedCount"])


if __name__ == "__main__":
    unittest.main()
