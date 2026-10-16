"""Tests for pixelopt.judge (stdlib only; uses the stand-in EDA tools)."""
import copy
import os
import tempfile
import unittest

from pixelopt import core, goal as goalmod, judge, manifest as mani
from pixelopt.core import PixelError
from tests import fixtures

GEOM = {
    "outlineUm": [18.0, 38.0],
    "channelsChanged": 0,
    "interactViolations": {},
    "tTiledPct": 12.0,
    "tOwnPct": 15.0,
    "oledAreaUm2": 40.0,
    "pdlSymmetryMin": 0.9,
    "cstDeviceFf": 12.0,
    "csOutsideMarkerFf": 0.5,
    "declaredChanges": {},
}

_EXT_KEYS = ("techLibOalib", "techLibTechDb", "layerMap", "etf",
             "layerMapBool", "tclTemplate")


def make_readiness(case):
    g = goalmod.resolve({}, {}, case, {"outlineUm": [20.0, 40.0]})
    ext = case.raw["extraction"]
    ropts = {
        "decks": {"authority": case.raw["decks"]["authority"]["sha256"],
                  "reference": case.raw["decks"]["reference"]["sha256"]},
        "lvsDeck": case.raw["lvs"]["deckTemplate"]["sha256"],
        "schematic": case.raw["lvs"]["schematic"]["sha256"],
        "extraction": {k: ext[k]["sha256"] for k in _EXT_KEYS},
    }
    return {"goal": g, "manifest": case.raw, "options": ropts,
            "original": {"loads": {"SC": 2.7, "AN": 8.85}, "cstDeviceFf": 12.0,
                         "floatingNets": 0}}


def build_env(sidecar=None, geom=None):
    casedir = tempfile.mkdtemp()
    built = fixtures.build_text_case(casedir)
    case = mani.load_case(built["manifest"], verify=True)
    sitecaps = mani.load_sitecaps(built["sitecaps"])
    workspace = tempfile.mkdtemp()
    cand_dir = os.path.join(workspace, "cands", "c0")
    os.makedirs(cand_dir)
    for n in ("pixel.gds", "pixel2x2.gds", "pixel3x3.gds"):
        with open(os.path.join(cand_dir, n), "wb") as fh:
            fh.write(b"SYNTH-GDS\n")
    core.write_json(os.path.join(cand_dir, "geometry.json"), geom or GEOM)
    if sidecar is not None:
        core.write_json(os.path.join(cand_dir, "standin.json"), sidecar)
    readiness = make_readiness(case)
    return case, sitecaps, workspace, cand_dir, readiness


def kinds(receipt):
    return [(r["kind"], r["deck"], r["tile"]) for r in receipt["reports"]]


class TestFullJudge(unittest.TestCase):
    def setUp(self):
        self.case, self.sitecaps, self.ws, self.cand, self.readiness = build_env()
        self.receipts = judge.judge(
            [{"id": "c0", "dir": self.cand}], self.ws, self.case,
            self.sitecaps, self.readiness, "full")

    def test_one_receipt_valid(self):
        self.assertEqual(len(self.receipts), 1)
        core.check(self.receipts[0], "receipt")

    def test_all_reports_present(self):
        ks = kinds(self.receipts[0])
        for deck in ("authority", "reference"):
            for tile in ("1x1", "2x2", "3x3"):
                self.assertIn(("drc", deck, tile), ks)
        self.assertIn(("lvs", None, None), ks)
        self.assertIn(("rce", None, None), ks)
        self.assertIn(("gdsin", None, None), ks)
        self.assertIn(("geometry", None, None), ks)

    def test_report_files_exist_on_disk(self):
        for r in self.receipts[0]["reports"]:
            if r["sha256"] is not None:
                self.assertTrue(os.path.exists(os.path.join(self.ws, r["path"])),
                                r["path"])

    def test_fresh_library(self):
        self.assertTrue(self.receipts[0]["freshLibrary"])
        lib = os.path.join(self.cand, "out", "rce", "lib", "pix")
        self.assertTrue(os.path.exists(os.path.join(lib, ".oalib")))
        self.assertTrue(os.path.exists(os.path.join(lib, "tech.db")))
        self.assertTrue(os.path.exists(
            os.path.join(lib, "pix", "layout", "layout.oa")))

    def test_rce_result_has_caps(self):
        sp = os.path.join(self.cand, "out", "rce", "RCEResult.sp")
        with open(sp) as fh:
            self.assertIn("C_S_VP", fh.read())


class TestDrcMode(unittest.TestCase):
    def test_drc_mode_omits_lvs_and_rce(self):
        case, sitecaps, ws, cand, readiness = build_env()
        receipts = judge.judge([{"id": "c0", "dir": cand}], ws, case,
                               sitecaps, readiness, "drc")
        ks = kinds(receipts[0])
        self.assertIn(("drc", "authority", "1x1"), ks)
        self.assertIn(("geometry", None, None), ks)
        self.assertNotIn(("lvs", None, None), ks)
        self.assertNotIn(("rce", None, None), ks)
        self.assertEqual(receipts[0]["mode"], "drc")


class TestStripRefusal(unittest.TestCase):
    def test_strip_without_geometry_check_refuses(self):
        case, sitecaps, ws, cand, _r = build_env()
        caps = copy.deepcopy(sitecaps)
        # offgrid_check uses check_original_layer and has no interactRules entry.
        caps["drcStripFunctions"] = ["geom_interact", "check_original_layer"]
        with self.assertRaises(PixelError) as ctx:
            judge.judge_one(cand, ws, case, caps, "drc")
        self.assertEqual(ctx.exception.code, "schema")


class TestParallel(unittest.TestCase):
    def test_two_candidates(self):
        case, sitecaps, ws, cand0, readiness = build_env()
        cand1 = os.path.join(ws, "cands", "c1")
        os.makedirs(cand1)
        for n in ("pixel.gds", "pixel2x2.gds", "pixel3x3.gds"):
            with open(os.path.join(cand1, n), "wb") as fh:
                fh.write(b"SYNTH-GDS\n")
        core.write_json(os.path.join(cand1, "geometry.json"), GEOM)
        receipts = judge.judge(
            [{"id": "c0", "dir": cand0}, {"id": "c1", "dir": cand1}],
            ws, case, sitecaps, readiness, "full")
        self.assertEqual(len(receipts), 2)
        self.assertEqual({r["candidate"] for r in receipts}, {"c0", "c1"})


if __name__ == "__main__":
    unittest.main()
