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
    def test_reference(self):
        t = model.timing({})
        self.assertEqual((t["wnsNs"], t["fmaxMhz"]), (-0.0442, 957.67))
        self.assertAlmostEqual(t["tnsNs"], -3.2, delta=0.1)
        a, inst, used = model.area({}, {})
        self.assertEqual((a, inst, used), (41200.0, 18400, {}))

    def test_rounds_with_the_critical_families(self):
        ref = model.timing({})["fmaxMhz"]
        gains = []
        for fams in (("XNOR3", "BUF"), ("XNOR3", "BUF", "XOR2", "MUX2I"), ("XNOR3", "BUF", "XOR2", "MUX2I", "AOI21", "OAI21")):
            gains.append(round(100 * (model.timing(speed(*fams))["fmaxMhz"] / ref - 1), 2))
        self.assertEqual(gains, [2.5, 3.4, 5.2])

    def test_estimated_recovery_ranks_the_calibrated_pairs(self):
        lib = {}
        picked = []
        for _ in range(3):
            ranked = sorted((f for f in model.FAMILIES if f not in lib), key=lambda f: -model.recovery_ns(lib, f))
            picked.append(tuple(ranked[:2]))
            lib.update(speed(*ranked[:2]))
        self.assertEqual(picked, [("XNOR3", "BUF"), ("XOR2", "MUX2I"), ("AOI21", "OAI21")])

    def test_off_path_families_gain_nothing(self):
        for fam in ("OAI22", "MUX2", "NOR3"):
            self.assertEqual(model.timing(speed(fam))["fmaxMhz"], 957.67, fam)
            self.assertEqual(model.recovery_ns({}, fam), 0.0)
        self.assertEqual(model.area({}, {"NOR3": ["X"]})[2], {})

    def test_local_gain_is_positive_for_the_calibrated_pairs_on_the_worst_path(self):
        before, gains = {}, []
        for fams in (("XNOR3", "BUF"), ("XOR2", "MUX2I"), ("AOI21", "OAI21")):
            after = dict(before, **speed(*fams))
            local = model.local_gain(before, after, 8)
            gains.append((local["worstPath"], local["localGainPs"]))
            self.assertEqual(local["paths"][0]["gainPs"], local["localGainPs"])
            self.assertTrue(all(abs(r["beforePs"] - r["afterPs"] - r["gainPs"]) < 0.011 for r in local["paths"]))
            before = after
        self.assertEqual(gains, [("A1", 140.64), ("B1", 115.2), ("C1", 107.76)])

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
        banner = ["std9t_svt standard-cell library, %s, 9-track SVT (MOCK library of the demo Site eda_cluster_ctu_01)" % model.CORNER,
                  "Generated from the mock EDA design model; not a foundry library, not for signoff."]
        self.assertEqual(lib, libraries.liberty_text(model.STOCK_LIBRARY, libraries.stock_cells(), banner))


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
                {"family": "XOR2", "priority": 3, "target": "-20 %"}, {"family": "XNOR3", "priority": 1, "target": "-30 %"},
                {"family": "buffer", "priority": 2, "target": "-25 %"}, {"family": "FA", "priority": 1, "target": "-10 %"}]}))
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
            self.assertGreater(verify["local"]["localGainPs"], 0)
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
            self.assertEqual(b1["fmaxMhz"], 981.64)
            for name in ("report_qor.rpt", "postroute_timing.rpt", "area.rpt", "route_drc.rpt"):
                text = (t / "b1" / "reports" / name).read_text()
                self.assertNotIn("mock", text.lower(), name)
            self.assertIn("(VIOLATED)", (t / "ref" / "reports" / "postroute_timing.rpt").read_text())
            self.assertIn("Synthesis effort:           high", (t / "ref" / "reports" / "report_qor.rpt").read_text())
            # Every report a person opens in the App reads as a tool report: no word "mock" in it.
            for rpt in (t / "ht" / "report_timing.rpt", t / "ht" / "stage_breakdown.rpt", t / "ql" / "library_analysis.rpt",
                        t / "g1" / "generation.rpt", t / "s1" / "cell_screen.rpt", t / "v1" / "verify.rpt"):
                self.assertNotIn("mock", rpt.read_text().lower(), rpt.name)
            self.assertGreater(b1["newCellInstances"], 0)
            self.assertTrue(all(c not in b1["newCellInstancesByCell"] for c in screen["failed"]))
            # without the dont-use list the unscreened XF variants would be used, and faster
            self.assertEqual(run("sapr", "run", "--design", "aes_cipher_top", "--extra-lib", str(t / "g1"), "--out", str(t / "b1x"), "--quiet").returncode, 0)
            self.assertGreater(json.loads((t / "b1x" / "sapr_summary.json").read_text())["fmaxMhz"], 981.64)


if __name__ == "__main__":
    unittest.main()
