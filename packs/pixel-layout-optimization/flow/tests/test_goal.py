"""Tests for pixelopt.goal (stdlib only)."""
import copy
import tempfile
import unittest

from pixelopt import goal as goalmod
from pixelopt import manifest as mani
from pixelopt.core import PixelError
from tests import fixtures

ORIGINAL = {"outlineUm": [22.0, 44.0]}


class TestResolve(unittest.TestCase):
    def setUp(self):
        d = tempfile.mkdtemp()
        built = fixtures.build_text_case(d)
        self.base = mani.load_case(built["manifest"], verify=False)

    def case_with(self, **mutate):
        raw = copy.deepcopy(self.base.raw)
        for key, value in mutate.items():
            raw["targets"][key] = value
        return mani.Case(raw, self.base.root)

    def _zero_goal(self):
        return {"outline_w_um": 0, "outline_h_um": 0, "ratio_target_pct": 0,
                "load_allowance_pct": 5, "t_min_pct": 0, "t_max_pct": 0,
                "cst_ceiling_ff": 0}

    def test_all_from_manifest(self):
        out = goalmod.resolve(self._zero_goal(), {}, self.base, ORIGINAL)
        self.assertEqual(out["values"]["outline_w_um"], 20.0)
        self.assertEqual(out["values"]["outline_h_um"], 40.0)
        self.assertEqual(out["sources"]["outline_w_um"], "manifest")
        self.assertEqual(out["values"]["ratio_target_pct"], 9.0)  # broad default
        self.assertEqual(out["sources"]["ratio_target_pct"], "manifest")
        self.assertEqual(out["values"]["t_min_pct"], 5.0)
        self.assertEqual(out["values"]["t_max_pct"], 30.0)
        self.assertEqual(out["sources"]["t_min_pct"], "manifest")
        self.assertEqual(out["ratioDefinition"], "broad")
        self.assertEqual(out["ratioNets"], ["EN", "R1", "SC", "AN"])
        self.assertEqual(out["transmittanceBasis"], "tiled")
        self.assertEqual(out["convergeBandPct"], 0.02)
        self.assertEqual(out["maxRounds"], 6)
        self.assertEqual(out["convergePatienceRounds"], 2)

    def test_project_raises_max_rounds(self):
        out = goalmod.resolve(self._zero_goal(), {"maxRounds": 8, "convergePatienceRounds": 3},
                              self.base, ORIGINAL)
        self.assertEqual(out["maxRounds"], 8)
        self.assertEqual(out["convergePatienceRounds"], 3)

    def test_fixed_outline_keeps_the_original_cell_not_the_manifest_target(self):
        out = goalmod.resolve(self._zero_goal(), {"outlineMode": "fixed"}, self.base, ORIGINAL)
        self.assertEqual(out["outlineMode"], "fixed")
        self.assertEqual([out["values"]["outline_w_um"], out["values"]["outline_h_um"]], [22.0, 44.0])
        self.assertEqual(out["sources"]["outline_w_um"], "original")
        self.assertEqual(goalmod.resolve(self._zero_goal(), {}, self.base, ORIGINAL)["outlineMode"],
                         "target")

    def test_secondary_coupling_targets_are_none_unless_stated(self):
        out = goalmod.resolve(self._zero_goal(), {}, self.base, ORIGINAL)
        self.assertIsNone(out["values"]["anode_coupling_max_ff"])
        self.assertEqual(out["sources"]["scan_coupling_max_ff"], "none")
        g = self._zero_goal()
        g.update({"anode_coupling_max_ff": 3.1, "scan_coupling_max_ff": 1.5})
        out = goalmod.resolve(g, {}, self.base, ORIGINAL)
        self.assertEqual(out["values"]["anode_coupling_max_ff"], 3.1)
        self.assertEqual(out["values"]["scan_coupling_max_ff"], 1.5)

    def test_goal_values_win(self):
        g = self._zero_goal()
        g.update({"outline_w_um": 18.0, "ratio_target_pct": 7.5, "t_min_pct": 6.0})
        out = goalmod.resolve(g, {}, self.base, ORIGINAL)
        self.assertEqual(out["values"]["outline_w_um"], 18.0)
        self.assertEqual(out["sources"]["outline_w_um"], "goal")
        self.assertEqual(out["values"]["ratio_target_pct"], 7.5)
        self.assertEqual(out["sources"]["ratio_target_pct"], "goal")
        self.assertEqual(out["sources"]["t_min_pct"], "goal")

    def test_outline_falls_back_to_original(self):
        case = self.case_with()
        del case.raw["targets"]["outlineUm"]
        out = goalmod.resolve(self._zero_goal(), {}, case, ORIGINAL)
        self.assertEqual(out["values"]["outline_w_um"], 22.0)
        self.assertEqual(out["values"]["outline_h_um"], 44.0)
        self.assertEqual(out["sources"]["outline_w_um"], "original")

    def test_transmittance_resolves_to_none(self):
        case = self.case_with()
        del case.raw["targets"]["transmittancePct"]
        out = goalmod.resolve(self._zero_goal(), {}, case, ORIGINAL)
        self.assertIsNone(out["values"]["t_min_pct"])
        self.assertIsNone(out["values"]["t_max_pct"])
        self.assertEqual(out["sources"]["t_min_pct"], "none")

    def test_narrow_definition_picks_its_target(self):
        out = goalmod.resolve(self._zero_goal(), {"ratioDefinition": "narrow"},
                              self.base, ORIGINAL)
        self.assertEqual(out["values"]["ratio_target_pct"], 2.0)
        self.assertEqual(out["ratioNets"], ["EN", "R1"])

    def test_unresolved_ratio_refused(self):
        case = self.case_with()
        del case.raw["targets"]["ratioPct"]
        with self.assertRaises(PixelError) as cm:
            goalmod.resolve(self._zero_goal(), {}, case, ORIGINAL)
        self.assertEqual(cm.exception.code, "unresolved-goal")

    def test_unresolved_ratio_when_definition_absent(self):
        case = self.case_with(ratioPct={"narrow": 2.0})  # no 'broad'
        with self.assertRaises(PixelError) as cm:
            goalmod.resolve(self._zero_goal(), {"ratioDefinition": "broad"},
                            case, ORIGINAL)
        self.assertEqual(cm.exception.code, "unresolved-goal")


if __name__ == "__main__":
    unittest.main()
