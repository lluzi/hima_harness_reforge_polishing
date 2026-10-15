"""Candidates of earlier Runs on the same case (stdlib only)."""
import json
import os
import shutil
import tempfile
import unittest

from pixelopt import incumbents
from tests.test_rounds import _goal, _legal_values


def _run(root, name, manifest="m1", deck="d1", rows=()):
    d = os.path.join(root, name)
    os.makedirs(os.path.join(d, "state"))
    with open(os.path.join(d, "state", "case-readiness.json"), "w") as fh:
        json.dump({"manifestSha256": manifest,
                   "options": {"decks": {"authority": deck, "reference": "r1"}}}, fh)
    with open(os.path.join(d, "state", "history.jsonl"), "w") as fh:
        for r in rows:
            fh.write(json.dumps(r) + "\n")
            os.makedirs(os.path.join(d, "cands", r["id"]), exist_ok=True)
            open(os.path.join(d, "cands", r["id"], "pixel.gds"), "wb").close()
    return d


def _row(cid, **vals):
    return {"id": cid, "kind": "candidate", "round": 1, "exploratory": False,
            "values": _legal_values(**vals)}


class IncumbentsTest(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        self.me = os.path.join(self.root, "this-run")
        os.makedirs(os.path.join(self.me, "state"))
        self.readiness = {"manifestSha256": "m1",
                          "options": {"decks": {"authority": "d1", "reference": "r1"}}}

    def test_only_runs_of_the_same_case_and_decks_count(self):
        a = _run(self.root, "run-a", rows=[_row("x")])
        _run(self.root, "run-other-case", manifest="m2", rows=[_row("y")])
        _run(self.root, "run-other-deck", deck="d2", rows=[_row("z")])
        self.assertEqual(incumbents.prior_runs(self.me, self.readiness), [a])

    def test_best_legal_and_best_near_misses_are_picked_under_this_goal(self):
        a = _run(self.root, "run-a", rows=[
            _row("legal-85", pixel_ratio_judged_pct=8.5),
            _row("legal-80", pixel_ratio_judged_pct=8.0),
            _row("near-75", pixel_ratio_judged_pct=7.5, pixel_drc_authority_1x1=2),
            _row("near-lvs", pixel_ratio_judged_pct=7.0, pixel_lvs_correct=0)])
        b = _run(self.root, "run-b", rows=[_row("legal-79", pixel_ratio_judged_pct=7.9)])
        picked = incumbents.pick(incumbents.prior_runs(self.me, self.readiness), _goal())
        legal = [(os.path.basename(r), c) for r, c, why in picked if why == "legal"]
        near = [(os.path.basename(r), c) for r, c, why in picked if why == "near-miss"]
        self.assertEqual(legal, [("run-b", "legal-79"), ("run-a", "legal-80")])
        self.assertEqual(near, [("run-a", "near-75")])
        self.assertTrue(a and b)

    def test_a_fixed_outline_imports_only_candidates_of_that_size(self):
        a = _run(self.root, "run-a", rows=[
            _row("same-size", pixel_ratio_judged_pct=8.5),
            _row("shrunk", pixel_ratio_judged_pct=7.0, pixel_outline_w_um=18.0)])
        goal = _goal(outlineMode="fixed", values={"outline_w_um": 19.0, "outline_h_um": 39.0})
        self.assertEqual([c for _, c, _ in incumbents.pick([a], goal)], ["same-size"])

    def test_a_candidate_without_its_gds_is_skipped(self):
        a = _run(self.root, "run-a", rows=[_row("gone", pixel_ratio_judged_pct=8.0)])
        os.remove(os.path.join(a, "cands", "gone", "pixel.gds"))
        self.assertEqual(incumbents.pick([a], _goal()), [])


if __name__ == "__main__":
    unittest.main()
