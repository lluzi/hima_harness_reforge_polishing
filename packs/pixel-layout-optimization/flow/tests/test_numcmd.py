"""Tests for the ``num-*`` numeric subcommands (``pixelopt.numcmd``).

Everything runs on the synthetic case with the stand-in EDA (the fixture's
site-capabilities point the tool argv prefixes at ``standin_eda.py`` and leave
the launcher empty, so the judge runs in-process). Skips cleanly without the
numeric packages.
"""
import json
import os
import tempfile
import unittest

try:
    import numpy  # noqa: F401
    import scipy  # noqa: F401
    import shapely  # noqa: F401
    import gdstk  # noqa: F401
    HAVE = True
except ImportError:
    HAVE = False


def _load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _build_workspace(tmpdir):
    """Assemble a Campaign workspace mirroring what 6b's prepare-case writes:
    state/paths.json, state/rules.json and state/case-readiness.json."""
    from tests import fixtures
    from pixelopt import manifest, goal, rules, layout, core

    case_dir = os.path.join(tmpdir, "case")
    ws = os.path.join(tmpdir, "ws")
    os.makedirs(os.path.join(ws, "state"))
    built = fixtures.build_case(case_dir)

    case = manifest.load_case(built["manifest"])
    lay = layout.load_gds(built["gds"], case, top=case.raw["original"]["topCell"])
    w, h = lay.pitch(case)

    parsed_auth = rules.parse_deck(fixtures.build_authority_deck())
    parsed_ref = rules.parse_deck(fixtures.build_reference_deck())
    table = rules.compaction_table(parsed_auth, case)
    goal_resolved = goal.resolve({}, {}, case, {"outlineUm": [w, h]})

    core.write_json(os.path.join(ws, "state", "paths.json"),
                    {"manifest": built["manifest"], "sitecaps": built["sitecaps"]})
    core.write_json(os.path.join(ws, "state", "rules.json"),
                    {"authority": parsed_auth, "reference": parsed_ref, "table": table})
    core.write_json(os.path.join(ws, "state", "case-readiness.json"), {
        "schema": "pixel.case-readiness/1",
        "paths": {"manifest": built["manifest"], "sitecaps": built["sitecaps"]},
        "goal": goal_resolved, "manifest": case.raw, "options": {},
        "original": {"outlineUm": [w, h], "cstDeviceFf": 0.0, "loads": {},
                     "tTiledPct": 0.0}})
    return ws, built, case, (w, h)


@unittest.skipUnless(HAVE, "numeric packages not installed")
class NumCmdTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.ws, self.built, self.case, self.outline = _build_workspace(self.tmp.name)

    def _judge_original_and_record(self):
        from pixelopt import judge, manifest
        sitecaps = manifest.load_sitecaps(self.built["sitecaps"])
        judge.judge_one(os.path.join(self.ws, "cands", "original"), self.ws,
                        self.case, sitecaps, "full")
        with open(os.path.join(self.ws, "state", "history.jsonl"), "w") as fh:
            fh.write(json.dumps({"id": "original", "kind": "original",
                                 "round": 0}) + "\n")

    # -- num-prepare -------------------------------------------------------- #
    def test_prepare_writes_the_original(self):
        from pixelopt import numcmd
        res = numcmd.cmd_prepare(self.ws)
        cdir = os.path.join(self.ws, "cands", "original")
        for fname in ("pixel.gds", "pixel2x2.gds", "pixel3x3.gds",
                      "geometry.json", "meta.json"):
            self.assertTrue(os.path.exists(os.path.join(cdir, fname)), fname)
        self.assertIn("versions", res)
        self.assertEqual(res["outlineUm"], list(self.outline))
        state = _load(os.path.join(self.ws, "state", "original.json"))
        self.assertEqual(state["outlineUm"], list(self.outline))
        self.assertIn("S", state["nets"])

    # -- num-mutants -------------------------------------------------------- #
    def test_mutants_makes_two(self):
        from pixelopt import numcmd
        numcmd.cmd_prepare(self.ws)
        res = numcmd.cmd_mutants(self.ws)
        ids = sorted(m["id"] for m in res["mutants"])
        self.assertEqual(ids, ["mutant-contact", "mutant-space"])
        for cid in ids:
            self.assertTrue(os.path.exists(
                os.path.join(self.ws, "cands", cid, "pixel.gds")))

    # -- num-map ------------------------------------------------------------ #
    def test_map_writes_a_small_card(self):
        from pixelopt import numcmd
        numcmd.cmd_prepare(self.ws)
        self._judge_original_and_record()
        res = numcmd.cmd_map(self.ws)
        self.assertIsNotNone(res["pitchBound"]["x"])
        self.assertIsNotNone(res["pitchBound"]["y"])
        card_path = os.path.join(self.ws, "state", "card.json")
        self.assertTrue(os.path.exists(card_path))
        self.assertTrue(os.path.exists(os.path.join(self.ws, "state", "card.svg")))
        self.assertLessEqual(os.path.getsize(card_path), 4096)
        doc = _load(card_path)
        for key in ("schema", "sites", "levers", "pitchBound", "floor", "front",
                    "openMarkers"):
            self.assertIn(key, doc)

    # -- num-fit ------------------------------------------------------------ #
    def test_fit_reports_pairs(self):
        from pixelopt import numcmd
        numcmd.cmd_prepare(self.ws)
        self._judge_original_and_record()
        res = numcmd.cmd_fit(self.ws)
        self.assertTrue(res["pairs"])
        model = _load(os.path.join(self.ws, "state", "model.json"))
        self.assertIn("pairs", model)
        # Cs pair (storage node to storage net) was fitted from the stand-in caps.
        self.assertIn("S|VP", model["pairs"])

    # -- num-try-edit ------------------------------------------------------- #
    def test_try_edit_runs_authority_drc(self):
        from pixelopt import numcmd
        numcmd.cmd_prepare(self.ws)
        ops = [{"layer": "Metal", "polygon": 0, "vertices": [0], "dx": 0.0, "dy": 0.0}]
        ops_path = os.path.join(self.ws, "ops.json")
        
        with open(ops_path, "w") as _fh:
            json.dump(ops, _fh)
        out_dir = os.path.join(self.ws, "preview")
        res = numcmd.cmd_try_edit(self.ws, "original", ops_path, out_dir)
        self.assertIn("1x1", res["authority"])
        self.assertIn("3x3", res["authority"])
        self.assertTrue(os.path.exists(os.path.join(out_dir, "pixel.gds")))

    # -- num-markers -------------------------------------------------------- #
    def test_markers_classifies_and_writes(self):
        from pixelopt import numcmd
        numcmd.cmd_prepare(self.ws)
        self._judge_original_and_record()
        out = os.path.join(self.ws, "markers.json")
        res = numcmd.cmd_markers(self.ws, "original", out)
        self.assertTrue(os.path.exists(out))
        doc = _load(out)
        for key in ("candidate", "markers", "proposedPairs", "proposedEdits"):
            self.assertIn(key, doc)
        self.assertEqual(res["markers"], len(doc["markers"]))

    # -- num-probes --------------------------------------------------------- #
    def test_probes_returns_summary(self):
        from pixelopt import numcmd
        numcmd.cmd_prepare(self.ws)
        self._judge_original_and_record()
        numcmd.cmd_fit(self.ws)
        res = numcmd.cmd_probes(self.ws, 2, 0.25)
        self.assertIn("probes", res)
        self.assertIn("dropped", res)
        for cid in res["probes"]:
            self.assertTrue(os.path.exists(
                os.path.join(self.ws, "cands", cid, "pixel.gds")))

    # -- dispatch / errors -------------------------------------------------- #
    def test_main_unknown_subcommand_exits_two(self):
        from pixelopt import numcmd
        self.assertEqual(numcmd.main(["num-bogus", self.ws]), 2)

    def test_main_prepare_through_dispatch(self):
        from pixelopt import numcmd
        self.assertEqual(numcmd.main(["num-prepare", self.ws]), 0)


if __name__ == "__main__":
    unittest.main()
