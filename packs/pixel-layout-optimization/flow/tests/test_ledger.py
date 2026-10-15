"""The lever ledger groups judged moves by lever and states what each measured (stdlib only)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir))

from pixelopt import ledger  # noqa: E402

from test_rounds import _goal, _legal_values  # noqa: E402

_SHIELD = {"op": "shield", "net": "VS", "layer": "M2", "marginUm": 1.0,
           "over": {"victim": "S", "aggressor": "SC"}}
_TRIM = {"op": "band-trim", "net": "S", "layer": "M1", "widthUm": 3.0}


def _row(cid, rnd, base, ops=(), objective="min-ratio", kind="candidate", **vals):
    return {"id": cid, "round": rnd, "kind": kind, "base": base, "exploratory": False,
            "legal": vals.pop("legal", True),
            "frontPoint": {"name": cid, "objective": objective, "operators": list(ops)},
            "operators": list(ops), "values": _legal_values(**vals)}


class LedgerTest(unittest.TestCase):
    def _history(self):
        return [{"id": "original", "round": 0, "kind": "original", "base": None,
                 "values": _legal_values(pixel_ratio_judged_pct=10.0, pixel_ct_anode_ff=3.5)},
                _row("r1-plain", 1, "original", pixel_ratio_judged_pct=9.8, pixel_ct_anode_ff=3.5),
                _row("r1-shield", 1, "original", [_SHIELD], pixel_ratio_judged_pct=8.8,
                     pixel_ct_anode_ff=3.6),
                _row("r1-both", 1, "original", [_SHIELD, _TRIM], pixel_ratio_judged_pct=8.0,
                     pixel_ct_anode_ff=3.2, legal=False, pixel_drc_authority_1x1=2),
                _row("r2-fix-1", 2, "r1-both", kind="repair", objective="legalise",
                     pixel_ratio_judged_pct=7.95, pixel_ct_anode_ff=3.2)]

    def test_levers_are_ranked_by_what_they_measured_against_the_plain_point(self):
        led = ledger.build(self._history(), _goal())
        self.assertEqual(led[0]["lever"],
                         "band-trim S on M1 + shield VS on M2 between S and SC")
        self.assertAlmostEqual(led[0]["bestDRatioPctVsPlain"], -1.8)
        self.assertEqual(led[0]["nearMiss"], 1)
        shield = next(e for e in led if e["lever"] == "shield VS on M2 between S and SC")
        self.assertAlmostEqual(shield["bestDRatioPctVsPlain"], -1.0)
        self.assertAlmostEqual(shield["bestDAnodeFfVsBase"], 0.1)
        repair = next(e for e in led if e["lever"] == "bounded-edit repair")
        self.assertAlmostEqual(repair["bestDRatioPctVsBase"], -0.05)
        self.assertEqual(repair["legal"], 1)

    def test_an_earlier_run_s_moves_are_labelled_with_their_run(self):
        led = ledger.build([], _goal(), prior=[("run-a", self._history())])
        self.assertTrue(led)
        self.assertTrue(all(x["source"] == "run-a" for e in led for x in e["examples"]))


if __name__ == "__main__":
    unittest.main()
