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
        d.mkdir(parents=True, exist_ok=True)
        (d / "NOR3_PU2.lib").write_text(lib)
        (d / "NOR3_PU2.lef").write_text(lef)
        (d / "NOR3_PU2.sp").write_text(".subckt NOR3_PU2 A B C Y VPWR VGND\n.ends\n")
        (d / "NOR3_PU2.ext").write_text(".subckt NOR3_PU2 VDD GND Y B A C\n.ends\n")
        (d / "NOR3_PU2.gds").write_bytes(b"GDSII")
        (d / "custom.lib").write_text(lib)
        (d / "custom.lef").write_text(lef)
        (d / "findings.md").write_text("findings")
        (d / "usage-guide.md").write_text("usage")
        (d / "library.md").write_text("| NOR3_PU2 | rise-skewed nor3 |")

    def cell(self, origin="r1"):
        files = {key: "cells/%s/NOR3_PU2.%s" % (origin, key) for key in ("sp", "gds", "lef", "ext")}
        return {"name": "NOR3_PU2", "inputs": ["A", "B", "C"], "outputs": ["Y"], "origin": origin,
                "functions": {"Y": "!(A|B|C)"}, "compareTo": "sky130_fd_sc_hd__nor3_1", "layout": "drc-lvs-clean",
                "files": files, "sha256": {key: sha(self.root / rel) for key, rel in files.items()}}

    def recipe(self, k=1, cells=None, **extra):
        body = {
            "schema": "hima-cellfmax-round-recipe/1", "round": k, "periodNs": 3.6,
            "synthesis": {"method": "orfs-abc"},
            "library": {"lib": "cells/r%d/custom.lib" % k, "lef": "cells/r%d/custom.lef" % k,
                        "cells": cells if cells is not None else [self.cell("r%d" % k)]},
            "hypothesis": "rise-skewed nor3 on rise-critical repairs",
            "report": {"findings": "cells/r%d/findings.md" % k, "library": "cells/r%d/library.md" % k,
                       "usage": "cells/r%d/usage-guide.md" % k},
            "agentClaim": None, "evidence": [],
        }
        body.update(extra)
        (self.root / "state" / "round-recipe.json").write_text(json.dumps(body))
        return body

    def characterized(self, k=1, measured=("NOR3_PU2",), lib=CELL_LIB, mock=()):
        """What the characterize step writes: the characterized Liberty and the per-cell outcome."""
        d = self.root / "runs" / ("r%d" % k) / "char"
        d.mkdir(parents=True, exist_ok=True)
        (d / "custom.characterized.lib").write_text(lib)
        names = list(measured) + list(mock)
        (self.root / "state" / "characterization.json").write_text(json.dumps({
            "schema": "hima-cellfmax-characterization/2", "round": k,
            "characterizedLib": "runs/r%d/char/custom.characterized.lib" % k if names else None,
            "characterizedNames": names,
            "cells": [{"name": n, "status": "measured", "basis": "extracted", "reason": None} for n in measured]
                     + [{"name": n, "status": "mock", "basis": "mock", "reason": None} for n in mock]}))

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
        self.refused(r"signal pins differ: recipe")

    def test_clean_cell_needs_its_extracted_netlist_and_abstract_does_not(self):
        cell = self.ws.cell()
        del cell["files"]["ext"], cell["sha256"]["ext"]
        self.ws.recipe(cells=[cell])
        self.refused(r"files\.ext \(the Magic-extracted netlist")
        cell["layout"] = "abstract"
        self.ws.recipe(cells=[cell])
        cli.validate_recipe(self.ws.root)

    def test_functions_must_cover_every_output_and_name_only_inputs(self):
        cell = self.ws.cell()
        cell["outputs"] = ["Y", "Z"]
        self.ws.recipe(cells=[cell])
        self.refused(r"one Liberty function per output")
        cell = self.ws.cell()
        cell["functions"] = {"Y": "!(A|B|D)"}
        self.ws.recipe(cells=[cell])
        self.refused(r"name pins \['D'\] that are not inputs")

    def test_compare_to_must_name_a_foundry_cell(self):
        cell = self.ws.cell()
        cell["compareTo"] = "nor3_1"
        self.ws.recipe(cells=[cell])
        self.refused(r"needs compareTo")

    def test_engineer_liberty_is_optional(self):
        body = self.ws.recipe()
        del body["library"]["lib"]
        (self.ws.root / "state" / "round-recipe.json").write_text(json.dumps(body))
        cli.validate_recipe(self.ws.root)

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

    def test_missing_library_table_is_refused(self):
        body = self.ws.recipe()
        del body["report"]["library"]
        (self.ws.root / "state" / "round-recipe.json").write_text(json.dumps(body))
        self.refused(r"a recipe path is empty")

    def test_many_new_cells_are_allowed(self):
        self.assertGreaterEqual(cli.MAX_NEW_CELLS, 200)

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
        (self.ws.root / "cells/r1/NOR3_PU2.sp").write_text(".subckt NOR3_PU2 A B C Y VPWR VGND\n* edited\n.ends\n")
        mutated = self.ws.cell("r1")
        self.ws.recipe(k=2, cells=[mutated])
        self.refused(r"byte-identical to best\.json")


class FunctionVerifiedTest(unittest.TestCase):
    def test_equivalence_logs(self):
        with tempfile.TemporaryDirectory() as tmp:
            log = Path(tmp) / "cells/r1/equiv.log"
            log.parent.mkdir(parents=True)
            recipe = {"synthesis": {"method": "emap-window", "equivalence": "cells/r1/equiv.log"}}
            log.write_text("Found 65 $equiv cells: 65 are proven and 0 are unproven.\nEquivalence successfully proven!\n")
            self.assertEqual(cli._function_verified(tmp, recipe)[0], 1)
            log.write_text("Found 65 $equiv cells: 63 are proven and 2 are unproven.\n")
            self.assertEqual(cli._function_verified(tmp, recipe)[0], 0)
            log.write_text("EQUIVALENCE: FAIL\n")
            self.assertEqual(cli._function_verified(tmp, recipe)[0], 0)
            self.assertEqual(cli._function_verified(tmp, {"synthesis": {"method": "emap-window", "equivalence": None}})[0], 0)
            self.assertEqual(cli._function_verified(tmp, {"synthesis": {"method": "orfs-abc"}})[0], 1)


class PrecheckTest(unittest.TestCase):
    def test_engineer_prechecks_private_files_against_campaign_state(self):
        ws = Workspace()
        own = Path(tempfile.mkdtemp(prefix="cellfmax-own-"))
        try:
            # The engineer's files live in its private workspace, not yet in the Campaign.
            shutil.move(str(ws.root / "cells"), str(own / "cells"))
            recipe = own / "round-recipe.json"
            ws.root.joinpath("cells").mkdir()
            shutil.copytree(own / "cells", ws.root / "cells", dirs_exist_ok=True)
            ws.recipe()
            shutil.rmtree(ws.root / "cells")
            shutil.move(str(ws.root / "state" / "round-recipe.json"), str(recipe))
            cli.cmd_precheck(ws.root, own, recipe)
            (own / "cells/r1/usage-guide.md").unlink()
            with self.assertRaisesRegex(cli.ToolError, "usage-guide.md' does not exist"):
                cli.cmd_precheck(ws.root, own, recipe)
        finally:
            ws.close()
            shutil.rmtree(own, ignore_errors=True)


class CompareTest(unittest.TestCase):
    def setUp(self):
        self.ws = Workspace()
        self.ws.recipe(agentClaim={"customFmaxMhz": 280.0, "controlFmaxMhz": 260.0, "gainPct": 7.0, "runs": []})
        self.ws.characterized()

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
            ws.characterized()
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


def timed_cell(name, rise, fall, cap):
    """A Liberty cell with one A->Y arc and 2x2 tables, for ratio checks."""
    table = lambda q, v: ('%s ("del_1_7_7") { index_1("0.1, 0.2"); index_2("0.01, 0.02"); '
                          'values("%s, %s", "%s, %s"); }' % (q, v, v, v, v))
    return ('cell ("%s") { area : 5.0; pin ("A") { direction : "input"; capacitance : %s; } '
            'pin ("Y") { direction : "output"; function : "(!A)"; timing () { related_pin : "A"; '
            'timing_sense : "negative_unate"; %s %s } } }\n' % (name, cap, table("cell_rise", rise), table("cell_fall", fall)))


class MeasuredLibraryTest(unittest.TestCase):
    def setUp(self):
        self.ws = Workspace()

    def tearDown(self):
        self.ws.close()

    def test_lef_subset_keeps_only_named_macros(self):
        two = CELL_LEF + CELL_LEF.replace("NOR3_PU2", "OTHER")
        kept = cli.lef_subset("VERSION 5.7 ;\n" + two, ["OTHER"])
        self.assertIn("MACRO OTHER", kept)
        self.assertNotIn("MACRO NOR3_PU2", kept)
        self.assertTrue(kept.startswith("VERSION 5.7 ;"))
        self.assertTrue(kept.rstrip().endswith("END LIBRARY"))

    def test_arms_load_only_characterized_cells(self):
        root = self.ws.root
        (root / "orfs").mkdir()
        (root / "orfs" / "platform.lib").write_text("library (x) {\n}\n")
        (root / "orfs" / "constraint.sdc").write_text("set clk_period 3.6\n")
        inputs = {"sdc": str(root / "orfs" / "constraint.sdc"), "platformLib": str(root / "orfs" / "platform.lib"),
                  "platformDontUse": ["sky130_fd_sc_hd__probe_p_8"]}
        abstract = dict(self.ws.cell(), name="ABSTRACT1", layout="abstract")
        abstract["files"] = {key: value for key, value in abstract["files"].items() if key in ("sp", "lef")}
        body = self.ws.recipe()
        body["library"]["cells"].append(abstract)
        self.ws.characterized(measured=("NOR3_PU2",))
        variables, sources, names = cli.prepare_run(root, inputs, root / "runs" / "r1" / "control", 3.6, body, "control")
        self.assertEqual(names, ["NOR3_PU2"])
        self.assertIn("NOR3_PU2", variables["DONT_USE_CELLS"].split())
        self.assertNotIn("ABSTRACT1", variables["DONT_USE_CELLS"].split())
        self.assertIn("custom.characterized.lib", sources)
        self.assertNotIn("GDS_ALLOW_EMPTY", variables)
        merged = (root / "runs" / "r1" / "control" / "inputs" / "merged.lib").read_text()
        self.assertIn("NOR3_PU2", merged)
        # A mock-timed abstract cell joins the arms; it has no GDS, so the final stream allows it empty.
        self.ws.characterized(measured=("NOR3_PU2",), mock=("ABSTRACT1",))
        variables, _, names = cli.prepare_run(root, inputs, root / "runs" / "r1" / "control", 3.6, body, "control")
        self.assertEqual(names, ["NOR3_PU2", "ABSTRACT1"])
        self.assertIn("ABSTRACT1", variables["DONT_USE_CELLS"].split())
        self.assertEqual(variables["GDS_ALLOW_EMPTY"], "(ABSTRACT1)$")
        # No measured cell: the arms run the stock library (an honest zero round, never a stall).
        self.ws.characterized(measured=())
        variables, _, names = cli.prepare_run(root, inputs, root / "runs" / "r1" / "custom", 3.6, body, "custom")
        self.assertEqual(names, [])
        self.assertNotIn("LIB_FILES", variables)

    def test_library_rows_report_measured_ratios_against_the_foundry_cell(self):
        root = self.ws.root
        ref = root / "platform.lib"
        ref.write_text("library (x) {\n" + timed_cell("sky130_fd_sc_hd__nor3_1", 0.20, 0.05, 0.0025) + "}\n")
        (root / "state" / "inputs.json").write_text(json.dumps({"platformLib": str(ref)}))
        body = self.ws.recipe()
        body["library"]["cells"][0]["compareTo"] = "sky130_fd_sc_hd__nor3_1"
        self.ws.characterized(lib=timed_cell("NOR3_PU2", 0.14, 0.06, 0.0040))
        rows = cli.library_rows(root, body, {"NOR3_PU2": 14})
        self.assertEqual(rows[0]["status"], "measured")
        self.assertEqual(rows[0]["adopted"], 14)
        ratios = rows[0]["vsFoundry"]
        self.assertAlmostEqual(ratios["cell_rise"], 0.7, places=3)   # 0.14 / 0.20
        self.assertAlmostEqual(ratios["cell_fall"], 1.2, places=3)   # 0.06 / 0.05
        self.assertAlmostEqual(ratios["input_cap"], 1.6, places=3)   # 0.0040 / 0.0025


class FootprintTest(unittest.TestCase):
    REF = ('library (x) {\n cell ("sky130_fd_sc_hd__nor3_1") { cell_footprint : "sky130_fd_sc_hd__nor3"; area : 5.0;\n'
           ' pin ("A") { direction : "input"; } pin ("B") { direction : "input"; } pin ("C") { direction : "input"; }\n'
           ' pin ("Y") { direction : "output"; function : "(!A&!B&!C)"; } }\n}\n')

    def test_drop_in_variants_join_the_foundry_footprint_family(self):
        cell = {"name": "NOR3_PU2", "inputs": ["A", "B", "C"], "outputs": ["Y"], "functions": {"Y": "!(A|B|C)"},
                "compareTo": "sky130_fd_sc_hd__nor3_1"}
        self.assertEqual(cli.resizer_footprint(cell, self.REF)[0], "sky130_fd_sc_hd__nor3")
        # OpenSTA compares function expressions structurally, so the foundry text is taken verbatim.
        self.assertEqual(cell["_foundryFunctions"], {"Y": "(!A&!B&!C)"})
        other = dict(cell, functions={"Y": "!(A&B&C)"})
        footprint, why = cli.resizer_footprint(other, self.REF)
        self.assertEqual(footprint, "NOR3_PU2")
        self.assertIn("function differs", why)
        fused = dict(cell, inputs=["A", "B", "C", "D"], functions={"Y": "!(A|B|C|D)"}, footprint="FUSE_NOR4")
        self.assertEqual(cli.resizer_footprint(fused, self.REF)[0], "FUSE_NOR4")
