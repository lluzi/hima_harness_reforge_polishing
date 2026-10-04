"""Unit tests for the custom-cell-fmax-sky130-demo Pack tools (flow/cellfmax_cli.py and the Readers).

Run by test/contract/custom-cell-fmax-sky130-demo.test.ts with `python3 -m unittest`. The expected
values are derived by hand from the fixture inputs, never from the code under test.
"""
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
PACK = REPO / "packs" / "custom-cell-fmax-sky130-demo"
spec = importlib.util.spec_from_file_location("cellfmax_cli", PACK / "flow" / "cellfmax_cli.py")
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)

CELL_LIB = """    cell (NOR3_PU2) {
        area : 10.0;
        pg_pin ("VGND") { pg_type : "primary_ground"; voltage_name : "VGND"; }
        pg_pin ("VNB") { pg_type : "nwell"; voltage_name : "VNB"; }
        pg_pin ("VPB") { pg_type : "pwell"; voltage_name : "VPB"; }
        pg_pin ("VPWR") { pg_type : "primary_power"; voltage_name : "VPWR"; }
        pin ("A") { direction : "input"; capacitance : 0.002; }
        pin ("B") { direction : "input"; capacitance : 0.002; }
        pin ("C") { direction : "input"; capacitance : 0.002; }
        pin ("Y") { direction : "output"; function : "(!A&!B&!C)"; timing () { related_pin : "A"; } }
    }
"""

CELL_LEF = """MACRO NOR3_PU2
  CLASS CORE ;
  SIZE 3.22 BY 2.72 ;
  PIN VPWR
    USE POWER ;
  END VPWR
  PIN VGND
    USE GROUND ;
  END VGND
  PIN Y
    USE SIGNAL ;
  END Y
  PIN A
    USE SIGNAL ;
  END A
  PIN B
    USE SIGNAL ;
  END B
  PIN C
    USE SIGNAL ;
  END C
  PIN VPB
    USE POWER ;
  END VPB
  PIN VNB
    USE GROUND ;
  END VNB
END NOR3_PU2
"""


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class Workspace:
    """A Campaign workspace with flow/ copied, bound-looking state and round-1 cell files."""

    def __init__(self):
        self.root = Path(tempfile.mkdtemp(prefix="cellfmax-unit-"))
        shutil.copytree(PACK / "flow", self.root / "flow")
        state = self.root / "state"
        state.mkdir()
        (state / "lessons.json").write_text(json.dumps({"schema": "hima-cellfmax-lessons/1", "rounds": []}))
        (state / "best.json").write_text(json.dumps(cli.EMPTY_BEST))
        (state / "baseline.json").write_text(json.dumps({
            "schema": "hima-cellfmax-arm/1", "arm": "baseline", "round": 0, "periodNs": 3.6, "finished": True,
            "wnsNs": -0.249301, "tnsNs": -1.91346, "instances": 37939, "fmaxMhz": 259.7872, "routeDrc": 0}))
        self.write_cells(1)

    def write_cells(self, k, lib=CELL_LIB, lef=CELL_LEF):
        d = self.root / "cells" / ("r%d" % k)
        (d / "datasheets").mkdir(parents=True, exist_ok=True)
        (d / "NOR3_PU2.lib").write_text(lib)
        (d / "NOR3_PU2.lef").write_text(lef)
        (d / "NOR3_PU2.sp").write_text(".subckt NOR3_PU2 A B C Y VPWR VGND\n.ends\n")
        (d / "NOR3_PU2.gds").write_bytes(b"GDSII")
        (d / "custom.lib").write_text(lib)
        (d / "custom.lef").write_text(lef)
        (d / "findings.md").write_text("findings")
        (d / "usage-guide.md").write_text("usage")
        (d / "datasheets" / "NOR3_PU2.md").write_text("sheet")

    def cell(self, origin="r1"):
        files = {key: "cells/%s/NOR3_PU2.%s" % (origin, key) for key in ("sp", "gds", "lef", "lib")}
        return {"name": "NOR3_PU2", "outputs": ["Y"], "origin": origin, "function": "Y=!(A|B|C)",
                "layout": "drc-lvs-clean",
                "timingModel": {"method": "estimate_lib", "base": "sky130_fd_sc_hd__nor3_1", "derate": {"rise": 0.6},
                                "reason": "two parallel PMOS fingers in the pull-up"},
                "files": files, "sha256": {key: sha(self.root / rel) for key, rel in files.items()}}

    def recipe(self, k=1, cells=None, **extra):
        body = {
            "schema": "hima-cellfmax-round-recipe/1", "round": k, "periodNs": 3.6,
            "synthesis": {"method": "orfs-abc"},
            "library": {"lib": "cells/r%d/custom.lib" % k, "lef": "cells/r%d/custom.lef" % k,
                        "cells": cells if cells is not None else [self.cell("r%d" % k)]},
            "hypothesis": "rise-skewed nor3 on rise-critical repairs",
            "report": {"findings": "cells/r%d/findings.md" % k, "datasheets": ["cells/r%d/datasheets/NOR3_PU2.md" % k],
                       "usage": "cells/r%d/usage-guide.md" % k},
            "agentClaim": None, "evidence": [],
        }
        body.update(extra)
        (self.root / "state" / "round-recipe.json").write_text(json.dumps(body))
        return body

    def arm(self, kind, k=1, period=3.6, wns=-0.1, finished=True, custom=14, forbidden=0, drc=0, recipe_sha=None, instances=37900, tns=-1.0):
        record = {"schema": "hima-cellfmax-arm/1", "arm": kind, "round": k, "periodNs": period, "finished": finished,
                  "recipeSha256": recipe_sha or sha(self.root / "state" / "round-recipe.json")}
        if finished:
            record.update({"wnsNs": wns, "tnsNs": tns, "fmaxMhz": cli.fmax_mhz(period, wns), "routeDrc": drc,
                           "instances": instances, "customInstances": {"NOR3_PU2": custom}, "customInstanceTotal": custom,
                           "forbiddenInstances": {}, "forbiddenInstanceTotal": forbidden, "topPaths": []})
        else:
            record["failure"] = "ORFS exited 2"
        (self.root / "state" / ("arm-%s.json" % kind)).write_text(json.dumps(record))

    def state(self, name):
        return json.loads((self.root / "state" / name).read_text())

    def close(self):
        shutil.rmtree(self.root, ignore_errors=True)


class FmaxTest(unittest.TestCase):
    def test_fmax_uses_worst_slack_of_either_sign(self):
        # 1000 / (3.6 + 0.249301) = 259.7871 MHz, the July golden finish Fmax (259.787 MHz).
        self.assertAlmostEqual(cli.fmax_mhz(3.6, -0.249301), 259.7871, places=3)
        # A met design: 1000 / (3.6 - 0.1) = 285.7143 MHz.
        self.assertAlmostEqual(cli.fmax_mhz(3.6, 0.1), 285.7143, places=3)
        self.assertIsNone(cli.fmax_mhz(3.6, None))


class ParseTest(unittest.TestCase):
    def test_liberty_and_lef_pins(self):
        cells = cli.liberty_cells(CELL_LIB)
        self.assertEqual(set(cells["NOR3_PU2"]["pins"]), {"A", "B", "C", "Y"})
        self.assertEqual(cells["NOR3_PU2"]["pins"]["Y"], "output")
        self.assertEqual(cells["NOR3_PU2"]["pg_pins"], {"VPWR", "VGND", "VPB", "VNB"})
        macros = cli.lef_macros(CELL_LEF)
        self.assertEqual(macros["NOR3_PU2"]["pins"]["VPB"], "POWER")
        self.assertEqual(macros["NOR3_PU2"]["pins"]["A"], "SIGNAL")

    def test_netlist_counts_and_dont_use(self):
        with tempfile.TemporaryDirectory() as tmp:
            netlist = Path(tmp) / "6_final.v"
            netlist.write_text("module aes_cipher_top (clk);\n input clk;\n wire n1;\n"
                               " sky130_fd_sc_hd__nor3_1 _1_ (.A(a), .B(b), .C(c), .Y(n1));\n"
                               " NOR3_PU2 _2_ (.A(a), .B(b), .C(c), .Y(n2));\n"
                               " NOR3_PU2 \\u_x/_3_  (.A(a), .B(b), .C(c), .Y(n3));\n"
                               " sky130_fd_sc_hd__lpflow_isobufsrc_1 _4_ (.A(a), .X(n4));\nendmodule\n")
            counts = cli.netlist_cell_counts(netlist)
            self.assertEqual(counts["NOR3_PU2"], 2)
            self.assertEqual(counts["sky130_fd_sc_hd__nor3_1"], 1)
            self.assertTrue(cli.FORBIDDEN_RE.match("sky130_fd_sc_hd__lpflow_isobufsrc_1"))
            self.assertFalse(cli.FORBIDDEN_RE.match("sky130_fd_sc_hd__nor3_1"))
            orfs = Path(tmp) / "orfs"
            (orfs / "flow" / "platforms" / "sky130hd").mkdir(parents=True)
            (orfs / "flow" / "platforms" / "sky130hd" / "config.mk").write_text(
                "export X = 1\nexport DONT_USE_CELLS += \\\n    sky130_fd_sc_hd__probe_p_8 sky130_fd_sc_hd__probec_p_8 \\\n"
                "    sky130_fd_sc_hd__lpflow_bleeder_1\nexport Y = 2\n")
            self.assertEqual(cli.platform_dont_use(orfs), ["sky130_fd_sc_hd__probe_p_8", "sky130_fd_sc_hd__probec_p_8",
                                                           "sky130_fd_sc_hd__lpflow_bleeder_1"])

    def test_sdc_period_is_replaced_once(self):
        text = "set clk_name clk\nset clk_period 3.6\nset clk_io_pct 0.2\n"
        self.assertIn("set clk_period 3.3\n", cli._sdc_with_period(text, 3.3))
        with self.assertRaises(cli.ToolError):
            cli._sdc_with_period("set clk_name clk\n", 3.3)

    def test_top_paths_marks_custom_cells(self):
        with tempfile.TemporaryDirectory() as tmp:
            report = Path(tmp) / "top-paths.txt"
            report.write_text("Startpoint: a (rising edge-triggered flip-flop clocked by clk)\nEndpoint: b/D (rising edge)\n"
                              "   0.10    0.80 ^ _1_/Y (NOR3_PU2)\n   0.20    1.00 v _2_/X (sky130_fd_sc_hd__buf_2)\n"
                              "   1.00   data arrival time\n\n  -0.120   slack (VIOLATED)\n\n")
            paths = cli.parse_top_paths(report, {"NOR3_PU2"})
            self.assertEqual(paths[0]["endpoint"], "b/D")
            self.assertEqual(paths[0]["slackNs"], -0.12)
            self.assertEqual(paths[0]["cells"], ["NOR3_PU2", "sky130_fd_sc_hd__buf_2"])
            self.assertEqual(paths[0]["customCells"], ["NOR3_PU2"])


class RecipeTest(unittest.TestCase):
    def setUp(self):
        self.ws = Workspace()

    def tearDown(self):
        self.ws.close()

    def refused(self, pattern):
        with self.assertRaisesRegex(cli.ToolError, pattern):
            cli.validate_recipe(self.ws.root)

    def test_valid_recipe_is_accepted(self):
        self.ws.recipe()
        recipe, digest = cli.validate_recipe(self.ws.root)
        self.assertEqual(recipe["round"], 1)
        self.assertEqual(digest, sha(self.ws.root / "state" / "round-recipe.json"))

    def test_missing_file_is_refused(self):
        self.ws.recipe()
        (self.ws.root / "cells/r1/NOR3_PU2.gds").unlink()
        self.refused(r"does not exist")

    def test_hash_mismatch_is_refused(self):
        self.ws.recipe()
        (self.ws.root / "cells/r1/NOR3_PU2.sp").write_text("changed")
        self.refused(r"files\.sp sha256 differs")

    def test_pin_mismatch_is_refused(self):
        lef = CELL_LEF.replace("  PIN C\n    USE SIGNAL ;\n  END C\n", "  PIN D\n    USE SIGNAL ;\n  END D\n")
        self.ws.write_cells(1, lef=lef)
        self.ws.recipe()
        self.refused(r"signal pins differ")

    def test_missing_power_pins_are_refused(self):
        lef = CELL_LEF.replace("  PIN VPB\n    USE POWER ;\n  END VPB\n", "")
        self.ws.write_cells(1, lef=lef)
        self.ws.recipe()
        self.refused(r"power pins VPWR, VGND, VPB, VNB")

    def test_support_file_outside_round_prefix_is_refused(self):
        body = self.ws.recipe()
        body["report"]["findings"] = "state/findings.md"
        (self.ws.root / "state" / "findings.md").write_text("x")
        (self.ws.root / "state" / "round-recipe.json").write_text(json.dumps(body))
        self.refused(r"must be under cells/r1/")
        body["report"]["findings"] = "cells/r1/../../state/findings.md"
        (self.ws.root / "state" / "round-recipe.json").write_text(json.dumps(body))
        self.refused(r"must be relative and stay inside")

    def test_wrong_round_is_refused(self):
        self.ws.write_cells(2)
        self.ws.recipe(k=2)
        self.refused(r"recipe round must be 1")

    def test_multi_output_cell_needs_emap(self):
        cell = self.ws.cell()
        cell["outputs"] = ["Y", "Z"]
        self.ws.recipe(cells=[cell])
        self.refused(r"multi-output cell NOR3_PU2 needs emap-window")

    def test_missing_datasheet_is_refused(self):
        body = self.ws.recipe()
        body["report"]["datasheets"] = []
        (self.ws.root / "state" / "round-recipe.json").write_text(json.dumps(body))
        self.refused(r"one datasheet per new cell")

    def test_best_library_cells_must_stay_byte_identical(self):
        best = dict(cli.EMPTY_BEST, round=1, customFmaxMhz=270.0,
                    library={"lib": "cells/r1/custom.lib", "lef": "cells/r1/custom.lef", "cells": [self.ws.cell("r1")]})
        (self.ws.root / "state" / "best.json").write_text(json.dumps(best))
        (self.ws.root / "state" / "lessons.json").write_text(json.dumps({"rounds": [{"round": 1}]}))
        self.ws.write_cells(2)
        # Round 2 drops the round-1 cell: refused.
        self.ws.recipe(k=2, cells=[])
        self.refused(r"drops cells of the best library: NOR3_PU2")
        # Round 2 keeps it unchanged: accepted.
        self.ws.recipe(k=2, cells=[self.ws.cell("r1")])
        cli.validate_recipe(self.ws.root)
        # A mutated old cell file: refused.
        (self.ws.root / "cells/r1/NOR3_PU2.lib").write_text(CELL_LIB.replace("10.0", "11.0"))
        mutated = self.ws.cell("r1")
        self.ws.recipe(k=2, cells=[mutated])
        self.refused(r"byte-identical to best\.json")


class CompareTest(unittest.TestCase):
    def setUp(self):
        self.ws = Workspace()
        self.ws.recipe(agentClaim={"customFmaxMhz": 280.0, "controlFmaxMhz": 260.0, "gainPct": 7.0, "runs": []})

    def tearDown(self):
        self.ws.close()

    def test_valid_improving_round(self):
        self.ws.arm("custom", wns=-0.1)       # 1000/3.7 = 270.2703
        self.ws.arm("control", wns=-0.249301, custom=0, instances=37939, tns=-1.91346)  # 259.7871, equals baseline
        cli.cmd_compare(self.ws.root)
        record = self.ws.state("round.json")
        self.assertTrue(record["comparisonValid"])
        self.assertAlmostEqual(record["roundGainPct"], 100 * (270.2703 / 259.7871 - 1), places=2)  # 4.035 %
        self.assertTrue(record["roundImproved"])
        self.assertEqual(record["customAdopted"], 14)
        self.assertEqual(record["functionVerified"], 1)
        self.assertTrue(record["controlMatchesBaseline"])
        self.assertAlmostEqual(record["claimDeltaPct"], 7.0 - record["roundGainPct"], places=3)
        self.assertEqual(record["bestCustomFmaxMhz"], 270.2703)
        best = self.ws.state("best.json")
        self.assertEqual(best["round"], 1)
        self.assertEqual([c["name"] for c in best["library"]["cells"]], ["NOR3_PU2"])
        lessons = self.ws.state("lessons.json")
        self.assertEqual(len(lessons["rounds"]), 1)
        self.assertTrue((self.ws.root / "derived" / "round-1.md").is_file())
        self.assertIn("not signoff, not silicon", (self.ws.root / "derived" / "summary.md").read_text())
        # Re-running compare for the same round replaces, never duplicates, its lesson, and still
        # judges the round against the best before it.
        cli.cmd_compare(self.ws.root)
        self.assertEqual(len(self.ws.state("lessons.json")["rounds"]), 1)
        self.assertTrue(self.ws.state("round.json")["roundImproved"])

    def test_control_with_custom_instances_is_invalid(self):
        self.ws.arm("custom")
        self.ws.arm("control", custom=3)
        cli.cmd_compare(self.ws.root)
        record = self.ws.state("round.json")
        self.assertFalse(record["comparisonValid"])
        self.assertIsNone(record["roundGainPct"])
        self.assertFalse(record["roundImproved"])
        self.assertIn("control arm used 3 custom instances", record["reason"])
        self.assertEqual(self.ws.state("best.json")["round"], 0)
        # Before any valid round the best custom Fmax is the stock baseline's.
        self.assertEqual(record["bestCustomFmaxMhz"], 259.7872)

    def test_failed_arm_is_invalid(self):
        self.ws.arm("custom", finished=False)
        self.ws.arm("control", custom=0)
        cli.cmd_compare(self.ws.root)
        record = self.ws.state("round.json")
        self.assertFalse(record["comparisonValid"])
        self.assertIn("custom arm did not finish", record["reason"])

    def test_forbidden_cells_and_drc_invalidate(self):
        self.ws.arm("custom", forbidden=2)
        self.ws.arm("control", custom=0, drc=4)
        cli.cmd_compare(self.ws.root)
        problems = " ".join(self.ws.state("round.json")["problems"])
        self.assertIn("lpflow/probe", problems)
        self.assertIn("4 route DRC errors", problems)

    def test_period_change_is_not_compared_to_baseline(self):
        self.ws.recipe(periodNs=3.3)
        self.ws.arm("custom", period=3.3, wns=-0.05)
        self.ws.arm("control", period=3.3, wns=-0.2, custom=0)
        cli.cmd_compare(self.ws.root)
        record = self.ws.state("round.json")
        self.assertTrue(record["comparisonValid"])
        self.assertIsNone(record["controlMatchesBaseline"])
        # 1000/3.35 = 298.5075 vs 1000/3.5 = 285.7143 -> +4.4776 %.
        self.assertAlmostEqual(record["roundGainPct"], 4.4776, places=3)

    def test_slower_round_is_not_improved(self):
        self.ws.arm("custom", wns=-0.3)
        self.ws.arm("control", wns=-0.249301, custom=0)
        cli.cmd_compare(self.ws.root)
        record = self.ws.state("round.json")
        self.assertTrue(record["comparisonValid"])
        self.assertFalse(record["roundImproved"])
        self.assertTrue(record["reason"].startswith("adopted but not faster"))

    def test_arm_from_another_recipe_is_invalid(self):
        self.ws.arm("custom", recipe_sha="0" * 64)
        self.ws.arm("control", custom=0)
        cli.cmd_compare(self.ws.root)
        self.assertIn("custom arm ran a different recipe", self.ws.state("round.json")["reason"])


class ReaderTest(unittest.TestCase):
    def run_reader(self, name, report, *extra):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "out.json"
            done = subprocess.run([sys.executable, str(PACK / "tools" / name), str(report), str(out), *extra],
                                  capture_output=True, text=True)
            if done.returncode != 0:
                return None, done.stderr
            return {v["type"]: v for v in json.loads(out.read_text())["values"]}, None

    def test_round_reader_emits_declared_facts(self):
        ws = Workspace()
        try:
            ws.recipe()
            # At delivery the recipe Reader accepts the next round's recipe ...
            values, error = self.run_reader("read-recipe.py", ws.root / "state" / "round-recipe.json", str(ws.root))
            self.assertIsNone(error)
            self.assertEqual(values["recipe_valid"]["value"], 1)
            self.assertEqual(values["recipe_new_cells"]["value"], 1)
            # ... and refuses a broken one with the validator's message, so the task can repair it.
            usage = ws.root / "cells/r1/usage-guide.md"
            usage.rename(usage.with_suffix(".bak"))
            values, error = self.run_reader("read-recipe.py", ws.root / "state" / "round-recipe.json", str(ws.root))
            self.assertIsNone(values)
            self.assertIn("round recipe refused", error)
            usage.with_suffix(".bak").rename(usage)
            ws.arm("custom", wns=-0.1)
            ws.arm("control", wns=-0.249301, custom=0, instances=37939, tns=-1.91346)
            cli.cmd_compare(ws.root)
            # After compare the same recipe is a measured round: a new delivery must be round 2.
            values, error = self.run_reader("read-recipe.py", ws.root / "state" / "round-recipe.json", str(ws.root))
            self.assertIn("recipe round must be 2", error)
            values, error = self.run_reader("read-round.py", ws.root / "state" / "round.json")
            self.assertIsNone(error)
            self.assertEqual(values["comparison_valid"]["value"], 1)
            self.assertEqual(values["round_improved"]["value"], 1)
            self.assertEqual(values["custom_adopted"]["value"], 14)
            self.assertEqual(values["best_custom_fmax_mhz"]["unit"], "mhz")
            self.assertIsNone(values["agent_claim_gain_pct"]["value"])
            self.assertIn("unknownReason", values["agent_claim_gain_pct"])
            declared = set(self.declared_emits("cellfmax-round"))
            self.assertEqual(set(values), declared)
        finally:
            ws.close()

    def test_arm_reader_states_unfinished_arms_as_unknown(self):
        with tempfile.TemporaryDirectory() as tmp:
            report = Path(tmp) / "arm.json"
            report.write_text(json.dumps({"schema": "hima-cellfmax-arm/1", "arm": "custom", "finished": False, "failure": "ORFS exited 2"}))
            values, error = self.run_reader("read-arm.py", report)
            self.assertIsNone(error)
            self.assertEqual(values["arm_finished"]["value"], 0)
            self.assertIsNone(values["arm_fmax_mhz"]["value"])
            self.assertIn("did not finish", values["arm_fmax_mhz"]["unknownReason"])
            self.assertEqual(set(values), set(self.declared_emits("cellfmax-arm")))

    def test_baseline_reader(self):
        with tempfile.TemporaryDirectory() as tmp:
            report = Path(tmp) / "baseline.json"
            report.write_text(json.dumps({"schema": "hima-cellfmax-arm/1", "arm": "baseline", "finished": True,
                                          "fmaxMhz": 259.7871, "wnsNs": -0.249301, "routeDrc": 0}))
            values, error = self.run_reader("read-baseline.py", report)
            self.assertIsNone(error)
            self.assertEqual(values["baseline_valid"]["value"], 1)
            self.assertEqual(values["baseline_fmax_mhz"]["value"], 259.7871)
            report.write_text(json.dumps({"schema": "hima-cellfmax-arm/1", "arm": "baseline", "finished": True,
                                          "fmaxMhz": 259.7871, "wnsNs": -0.249301, "routeDrc": 3}))
            values, _ = self.run_reader("read-baseline.py", report)
            self.assertEqual(values["baseline_valid"]["value"], 0)
            self.assertEqual(set(values), set(self.declared_emits("cellfmax-baseline")))

    def declared_emits(self, reader_id):
        text = (PACK / "readers" / ("%s.yml" % reader_id)).read_text()
        line = next(l for l in text.splitlines() if l.startswith("emits:"))
        return [item.strip() for item in line.split("[", 1)[1].rstrip("]").split(",")]


if __name__ == "__main__":
    unittest.main()
