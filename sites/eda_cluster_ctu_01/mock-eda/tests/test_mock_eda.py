"""Unit tests of the mock EDA toolchain: calibration, determinism and the CLIs (python3 -m unittest)."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "lib"))
from ctu_mock import libraries, model  # noqa: E402

BIN = ROOT / "bin"
ENV = dict(os.environ, CTU_MOCK_TIME_SCALE="0")


def speed(*families):
    return {f: model.FAMILIES[f]["speedup"] for f in families}


def run(*argv, cwd=None):
    out = subprocess.run([str(BIN / argv[0]), *argv[1:]], capture_output=True, text=True, env=ENV, cwd=cwd)
    return out


class Calibration(unittest.TestCase):
    """The timing math of model.py's docstring, number by number."""

    def test_clock_and_stage_delays(self):
        # A ~2 GHz block: 0.500 ns, setup 12 ps + uncertainty 8 ps, so 480 ps from launch to capture.
        self.assertEqual((model.CLOCK_PERIOD_NS, model.SETUP_PS, model.UNCERTAINTY_PS, model.OVER_PS), (0.5, 12.0, 8.0, 20.0))
        # Logic stages are FO4-class, 10-30 ps; the flop's clock-to-Q is 34 ps.
        self.assertEqual(model.FAMILIES["DFF"]["typPs"], 34)
        for family, info in model.FAMILIES.items():
            if family != "DFF":
                self.assertTrue(10 <= info["typPs"] <= 30, family)
        self.assertEqual({f: model.FAMILIES[f]["typPs"] for f in ("INV", "NAND2", "NOR2", "AOI21", "BUF", "OAI21", "MUX2I", "XOR2", "XNOR3")},
                         dict(INV=10, NAND2=12, NOR2=14, AOI21=16, BUF=17, OAI21=17, MUX2I=19, XOR2=21, XNOR3=28))
        # AndesCell's cell-level speed-ups are 4-10 %.
        self.assertEqual({f: round(100 * model.FAMILIES[f]["speedup"]) for f in ("XNOR3", "BUF", "XOR2", "MUX2I", "AOI21", "OAI21", "NOR2", "NAND2", "DFF")},
                         dict(XNOR3=10, BUF=8, XOR2=8, MUX2I=7, AOI21=7, OAI21=6, NOR2=5, NAND2=5, DFF=5))
        self.assertTrue(all(0.04 <= f["speedup"] <= 0.10 for f in model.FAMILIES.values()))

    def test_every_worst_path_is_20_to_30_levels_of_10_to_30_ps_cells_and_2_to_5_ps_nets(self):
        for p in model.PATHS:
            st = model.stages(p, {})
            self.assertEqual(st[0]["family"], "DFF")
            self.assertTrue(20 <= len(st) - 1 <= 30, (p["id"], len(st) - 1))
            self.assertEqual(len(st) - 1, p["logicLevels"])
            for s in st[1:]:
                self.assertTrue(9.0 <= s["cellDelayPs"] <= 31.0, (p["id"], s))
            for s in st:
                self.assertTrue(2.0 <= s["netDelayPs"] <= 5.0, (p["id"], s))
            # path delay = clock-to-Q + cells + nets + setup + uncertainty = clock period - slack
            self.assertAlmostEqual(sum(s["cellDelayPs"] + s["netDelayPs"] for s in st) + model.OVER_PS, 500.0 - p["slackPs"], places=6)
        # No stock cell is slower than the flop's clock-to-Q at fanout 4; no per-cell 100 ps figures.
        self.assertTrue(all(c["fo4DelayPs"] <= 34.0 and c["riseFo4Ps"] < 40.0 for c in libraries.stock_cells()))

    def test_the_worst_path_against_the_clock(self):
        a1 = model.PATHS[0]
        self.assertEqual((a1["id"], a1["logicLevels"]), ("A1", 23))
        self.assertEqual(a1["levels"], dict(XNOR3=3, BUF=4, XOR2=2, MUX2I=1, AOI21=3, NAND2=4, INV=6))
        cells = sum(a1["mix"].values()) - a1["mix"]["DFF"]
        self.assertEqual(cells, 3 * 28 + 4 * 17 + 2 * 21 + 19 + 3 * 16 + 4 * 12 + 6 * 10)
        self.assertEqual(cells, 369)
        self.assertAlmostEqual(model.net_delay(a1), 89.4, places=6)
        self.assertAlmostEqual(model.path_delay(a1, {}), 34 + 369 + 89.4 + 20, places=6)
        self.assertAlmostEqual(model.slack_ps(a1, {}), 480 - (34 + 369 + 89.4), places=6)
        self.assertAlmostEqual(model.slack_ps(a1, {}), -12.4, places=6)

    def test_reference(self):
        t = model.timing({})
        self.assertEqual((t["wnsNs"], t["fmaxMhz"]), (-0.0124, 1951.6))
        self.assertEqual(t["fmaxMhz"], round(1000 / (0.500 + 0.0124), 2))
        self.assertEqual((t["tnsNs"], t["violatingEndpoints"]), (-0.596, 74))
        self.assertEqual(min(model.PATHS, key=lambda p: model.slack_ps(p, {}))["id"], "A1")
        a, inst, used = model.area({}, {})
        self.assertEqual((a, inst, used), (41200.0, 18400, {}))

    def test_round_one_meets_a_one_percent_goal_and_the_next_group_limits_it(self):
        ref = model.timing({})["fmaxMhz"]
        after = speed("XNOR3", "BUF")
        a1, b1 = model.PATHS[0], next(p for p in model.PATHS if p["id"] == "B1")
        # A1: 3 XNOR3 x 28 ps x 10 % + 4 BUF x 17 ps x 8 % = 8.40 + 5.44 = 13.84 ps
        self.assertAlmostEqual(model.path_delay(a1, {}) - model.path_delay(a1, after), 8.40 + 5.44, places=6)
        # B1 (key expansion) has one of each: 2.80 + 1.36 = 4.16 ps, from -9.0 to -4.84 ps; it sets Fmax
        self.assertAlmostEqual(model.slack_ps(b1, after), -9.0 + 2.80 + 1.36, places=6)
        self.assertEqual(min(model.PATHS, key=lambda p: model.slack_ps(p, after))["id"], "B1")
        t = model.timing(after)
        self.assertEqual((t["wnsNs"], t["fmaxMhz"], t["tnsNs"], t["violatingEndpoints"]), (-0.0048, 1980.98, -0.1, 33))
        self.assertEqual(t["fmaxMhz"], round(1000 / (0.500 + 0.0048), 2))
        gain = round(100 * (t["fmaxMhz"] / ref - 1), 2)
        self.assertEqual(gain, 1.51)
        self.assertTrue(1.2 <= gain <= 1.8 and gain >= 1.0, "round 1 meets the default +1 % Goal")
        # The next pair HimaTime ranks takes the key-expansion group (one more round if asked).
        self.assertEqual(round(100 * (model.timing(dict(after, **speed("XOR2", "AOI21")))["fmaxMhz"] / ref - 1), 2), 2.36)

    def test_estimated_recovery_ranks_xnor3_and_buf_first(self):
        lib = {}
        picked = []
        for _ in range(2):
            ranked = sorted((f for f in model.FAMILIES if f not in lib), key=lambda f: -model.recovery_ns(lib, f))
            picked.append(tuple(ranked[:2]))
            lib.update(speed(*ranked[:2]))
        self.assertEqual(picked, [("XNOR3", "BUF"), ("XOR2", "AOI21")])
        self.assertEqual([model.recovery_ns({}, f) for f in ("XNOR3", "BUF", "XOR2", "AOI21")], [0.302, 0.191, 0.171, 0.14])

    def test_off_path_families_gain_nothing(self):
        for fam in ("OAI22", "MUX2", "NOR3"):
            self.assertEqual(model.timing(speed(fam))["fmaxMhz"], 1951.6, fam)
            self.assertEqual(model.recovery_ns({}, fam), 0.0)
        self.assertEqual(model.area({}, {"NOR3": ["X"]})[2], {})

    def test_local_gain_is_8_to_20_ps_on_the_worst_path(self):
        before, gains = {}, []
        for fams in (("XNOR3", "BUF"), ("XOR2", "AOI21")):
            after = dict(before, **speed(*fams))
            local = model.local_gain(before, after, 8)
            gains.append((local["worstPath"], local["localGainPs"]))
            self.assertEqual(local["paths"][0]["gainPs"], local["localGainPs"])
            self.assertTrue(all(abs(r["beforePs"] - r["afterPs"] - r["gainPs"]) < 0.011 for r in local["paths"]))
            before = after
        self.assertEqual(gains, [("A1", 13.84), ("B1", 11.76)])
        # With AndesCell's extra-fast variants (-12 % XNOR3, -10 % BUF), as HimaTime verify re-times them
        self.assertEqual(model.local_gain({}, dict(XNOR3=0.12, BUF=0.10), 8)["localGainPs"], round(3 * 28 * 0.12 + 4 * 17 * 0.10, 2))
        self.assertTrue(all(8 <= g <= 20 for _, g in gains))

    def test_local_gain_is_zero_for_off_path_families(self):
        for fam in ("OAI22", "MUX2", "NOR3"):
            local = model.local_gain({}, speed(fam), 8)
            self.assertEqual((local["localGainPs"], local["pathsImproved"]), (0.0, 0), fam)

    def test_stage_lists_add_up(self):
        for p in model.PATHS:
            for sp in ({}, speed("XNOR3", "BUF")):
                st = model.stages(p, sp)
                self.assertAlmostEqual(sum(s["cellDelayPs"] + s["netDelayPs"] for s in st) + model.OVER_PS, model.path_delay(p, sp), places=6)

    def test_share_library_is_current(self):
        d = ROOT / "share" / "libs" / model.STOCK_LIBRARY
        lib = (d / ("%s_%s.lib" % (model.STOCK_LIBRARY, model.CORNER))).read_text()
        self.assertEqual(lib, libraries.liberty_text(model.STOCK_LIBRARY, libraries.stock_cells(), libraries.share_banner()))
        self.assertEqual((d / ("%s.lef" % model.STOCK_LIBRARY)).read_text(), libraries.lef_text(libraries.stock_cells(), libraries.share_banner()))
        self.assertEqual(json.loads((d / "library.json").read_text()), libraries.stock_manifest())


class Clis(unittest.TestCase):
    def test_versions_and_help(self):
        for tool in ("sapr", "himatime", "qualib", "andescell", "xtop"):
            out = run(tool, "-version")
            self.assertEqual(out.returncode, 0, out.stderr)
            self.assertIn("version", out.stdout)
            self.assertEqual(run(tool, "-help").returncode, 0)
        self.assertEqual(run("xtop", "-batch", "x.tcl").returncode, 2)

    def test_one_round(self):
        with tempfile.TemporaryDirectory() as tmp:
            t = Path(tmp)
            self.assertEqual(run("sapr", "run", "--design", "aes_cipher_top", "--out", str(t / "ref"), "--quiet").returncode, 0)
            self.assertEqual(run("sapr", "run", "--design", "aes_cipher_top", "--out", str(t / "ref"), "--quiet").returncode, 2, "non-empty out refused")
            out = run("himatime", "load", "--db", str(t / "ref"), "--out", str(t / "ht"), "--quiet")
            self.assertEqual(out.returncode, 0, out.stderr)
            summary = json.loads((t / "ht" / "timing_summary.json").read_text())
            self.assertEqual(summary["stageBreakdown"][0]["family"], "XNOR3")
            self.assertIn("slack (VIOLATED)", (t / "ht" / "report_timing.rpt").read_text())
            self.assertEqual(run("qualib", "analyze", "--timing", str(t / "ht" / "timing_summary.json"), "--out", str(t / "ql"), "--quiet").returncode, 0)
            req = t / "req.json"
            req.write_text(json.dumps({"requirements": [
                {"family": "XOR2", "priority": 3, "target": "-8 %"}, {"family": "XNOR3", "priority": 1, "target": "-10 %"},
                {"family": "buffer", "priority": 2, "target": "-8 %"}, {"family": "FA", "priority": 1, "target": "-10 %"}]}))
            dry = run("andescell", "generate", "--requirements", str(req), "--db", str(t / "ref"), "--round", "1", "--dry-run")
            self.assertIn("1. XNOR3", dry.stdout)
            self.assertIn("no template", dry.stdout)
            self.assertEqual(run("andescell", "generate", "--requirements", str(req), "--db", str(t / "ref"), "--round", "1", "--out", str(t / "g1"), "--quiet").returncode, 0)
            gen = json.loads((t / "g1" / "generation.json").read_text())
            self.assertEqual(gen["selected"], ["XNOR3", "BUF"])
            self.assertEqual(run("qualib", "screen", "--cells", str(t / "g1"), "--out", str(t / "s1"), "--quiet").returncode, 0)
            screen = json.loads((t / "s1" / "screen.json").read_text())
            self.assertEqual(sorted(screen["failed"]), ["ANDES_BUF_XF8_R1", "ANDES_XNOR3_XF4_R1"])
            self.assertIn("4 of 6 cell(s) pass", (t / "s1" / "cell_screen.rpt").read_text())
            fast = json.loads(run("qualib", "screen", "--cells", str(t / "g1"), "--json").stdout)
            self.assertEqual((fast["passed"], fast["failed"]), (screen["passed"], screen["failed"]))
            # HimaTime re-times the worst paths of the build the cells are for: a positive local gain
            out = run("himatime", "verify", "--cells", str(t / "g1"), "--db", str(t / "ref"), "--paths", "8", "--out", str(t / "v1"), "--quiet")
            self.assertEqual(out.returncode, 0, out.stderr)
            verify = json.loads((t / "v1" / "verify.json").read_text())
            self.assertEqual(verify["local"]["worstPath"], "A1")
            self.assertEqual(verify["local"]["localGainPs"], 16.88, "A1 with the extra-fast variants: 84 x 12 % + 68 x 10 %")
            self.assertEqual(len(verify["local"]["paths"]), 8)
            self.assertTrue(all(c["fo4DelayPs"] < c["stockFo4DelayPs"] for c in verify["cells"]))
            rpt = (t / "v1" / "verify.rpt").read_text()
            self.assertIn("Local gain on the worst path (A1)", rpt)
            self.assertEqual(json.loads(run("himatime", "verify", "--cells", str(t / "g1"), "--db", str(t / "ref"), "--json").stdout)["local"],
                             verify["local"], "--json alone gives the same numbers")
            self.assertEqual(run("himatime", "verify", "--cells", str(t / "g1"), "--db", str(t / "ref")).returncode, 2, "--out or --json")
            # the plan's families, exactly: BUF alone although XNOR3 ranks first
            self.assertEqual(run("andescell", "generate", "--requirements", str(req), "--db", str(t / "ref"), "--round", "1",
                                 "--families", "buffer", "--out", str(t / "g1b"), "--quiet").returncode, 0)
            plan = json.loads((t / "g1b" / "generation.json").read_text())
            self.assertEqual(plan["selected"], ["BUF"])
            self.assertTrue(any(s["family"] == "XNOR3" and "not in the generation plan" in s["reason"] for s in plan["skipped"]))
            refused = run("andescell", "generate", "--requirements", str(req), "--db", str(t / "ref"), "--round", "1", "--families", "NOR2", "--dry-run")
            self.assertEqual(refused.returncode, 2)
            self.assertIn("not a candidate", refused.stderr)
            argv = ["sapr", "run", "--design", "aes_cipher_top", "--extra-lib", str(t / "g1"), "--out", str(t / "b1"), "--quiet"]
            for cell in screen["failed"]:
                argv += ["--dont-use", cell]
            self.assertEqual(run(*argv).returncode, 0)
            b1 = json.loads((t / "b1" / "sapr_summary.json").read_text())
            self.assertEqual(b1["fmaxMhz"], 1980.98)
            for name in ("report_qor.rpt", "postroute_timing.rpt", "area.rpt", "route_drc.rpt"):
                text = (t / "b1" / "reports" / name).read_text()
                self.assertNotIn("mock", text.lower(), name)
            self.assertIn("(VIOLATED)", (t / "ref" / "reports" / "postroute_timing.rpt").read_text())
            self.assertIn("Synthesis effort:           high", (t / "ref" / "reports" / "report_qor.rpt").read_text())
            # Every report a person opens in the App reads as a tool report: no word "mock" in it.
            for rpt in (t / "ht" / "report_timing.rpt", t / "ht" / "stage_breakdown.rpt", t / "ql" / "library_analysis.rpt",
                        t / "g1" / "generation.rpt", t / "s1" / "cell_screen.rpt", t / "v1" / "verify.rpt"):
                self.assertNotIn("mock", rpt.read_text().lower(), rpt.name)
            # No cell stage on a timed path is near 100 ps: every Incr of a cell pin is under 35 ps.
            incr = [float(line.split()[-3]) for line in (t / "ht" / "report_timing.rpt").read_text().splitlines()
                    if line.strip().endswith((" r", " f")) and "/CK " not in line]
            self.assertTrue(incr and max(incr) < 0.035, max(incr))
            for c in json.loads((t / "g1" / "andes_r1.json").read_text())["cells"]:
                self.assertTrue(c["fo4DelayPs"] < 30.0, c)
            self.assertEqual(summary["stageBreakdown"][1]["family"], "BUF")
            self.assertEqual(summary["stageBreakdown"][0]["meanStagePs"], 28.0)
            self.assertGreater(b1["newCellInstances"], 0)
            self.assertTrue(all(c not in b1["newCellInstancesByCell"] for c in screen["failed"]))
            # without the dont-use list the unscreened XF variants would be used, and faster
            self.assertEqual(run("sapr", "run", "--design", "aes_cipher_top", "--extra-lib", str(t / "g1"), "--out", str(t / "b1x"), "--quiet").returncode, 0)
            self.assertGreater(json.loads((t / "b1x" / "sapr_summary.json").read_text())["fmaxMhz"], 1980.98)


if __name__ == "__main__":
    unittest.main()
