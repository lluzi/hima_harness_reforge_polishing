"""Unit tests for the Pack's SPICE characterizer (flow/toolbox/char), pure Python: no ngspice.

Run with `python3 -m unittest test/contract/support/cellfmax_char_test.py`. Expected values are
derived by hand from the fixtures (truth tables, hand-computed medians), never from the code under test.
"""
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
PACK = REPO / "packs" / "custom-cell-fmax-sky130-demo"
CHAR = PACK / "flow" / "toolbox" / "char"
sys.path.insert(0, str(CHAR))
import charcore as cc  # noqa: E402
import characterize as ch  # noqa: E402

spec = importlib.util.spec_from_file_location("cellfmax_cli", PACK / "flow" / "cellfmax_cli.py")
cli = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cli)


def cell(name="NOR3_X", inputs=("A", "B", "C"), outputs=("Y",), functions=None, **pins):
    return cc.normalize_cell({"name": name, "spice": "x.sp", "subckt": name,
                              "pins": dict({"inputs": list(inputs), "outputs": list(outputs)}, **pins),
                              "functions": functions or {"Y": "!(A|B|C)"}, "area_um2": 8.76})


class FunctionAndSensitization(unittest.TestCase):
    def test_nor3_side_inputs_are_non_controlling_zeros(self):
        vectors = cc.sensitize("!(A|B|C)", ["A", "B", "C"], "A")
        self.assertEqual(vectors, {"positive": [], "negative": [{"B": 0, "C": 0}]})
        self.assertEqual(cc.timing_sense(vectors), "negative_unate")

    def test_xor2_is_non_unate_with_one_vector_per_sense(self):
        for text in ("(A&!B) | (!A&B)", "A^B"):
            vectors = cc.sensitize(text, ["A", "B"], "A")
            self.assertEqual(vectors, {"positive": [{"B": 0}], "negative": [{"B": 1}]})
            self.assertEqual(cc.timing_sense(vectors), "non_unate")

    def test_mux2i_select_and_data_arcs(self):
        f = "(!A0&!S) | (!A1&S)"
        self.assertEqual(cc.sensitize(f, ["A0", "A1", "S"], "S"),
                         {"positive": [{"A0": 1, "A1": 0}], "negative": [{"A0": 0, "A1": 1}]})
        self.assertEqual(cc.sensitize(f, ["A0", "A1", "S"], "A0"),
                         {"positive": [], "negative": [{"A1": 0, "S": 0}, {"A1": 1, "S": 0}]})

    def test_aoi21(self):
        f = "!((A1&A2)|B1)"
        self.assertEqual(cc.sensitize(f, ["A1", "A2", "B1"], "A1"), {"positive": [], "negative": [{"A2": 1, "B1": 0}]})
        self.assertEqual(cc.sensitize(f, ["A1", "A2", "B1"], "B1")["negative"],
                         [{"A1": 0, "A2": 0}, {"A1": 0, "A2": 1}, {"A1": 1, "A2": 0}])

    def test_half_adder_two_outputs_plan(self):
        ha = cell("HA_X", ("A", "B"), ("COUT", "SUM"), {"COUT": "A&B", "SUM": "A^B"})
        self.assertEqual(cc.sensitize("A&B", ["A", "B"], "A"), {"positive": [{"B": 1}], "negative": []})
        units = cc.plan_units(ha)
        keys = sorted((u["output"], u["input"], u["sense"], tuple(sorted(u["vector"].items()))) for u in units)
        self.assertEqual(keys, [
            ("COUT", "A", "positive", (("B", 1),)), ("COUT", "B", "positive", (("A", 1),)),
            ("SUM", "A", "negative", (("B", 1),)), ("SUM", "A", "positive", (("B", 0),)),
            ("SUM", "B", "negative", (("A", 1),)), ("SUM", "B", "positive", (("A", 0),))])

    def test_liberty_operator_forms(self):
        env = {"A": 1, "B": 0, "C": 1}
        self.assertTrue(cc.eval_function(cc.parse_function("A B'"), env))          # implicit AND, postfix not
        self.assertTrue(cc.eval_function(cc.parse_function("A|B&C"), {"A": 1, "B": 0, "C": 0}))
        self.assertFalse(cc.eval_function(cc.parse_function("(A|B)&C"), {"A": 1, "B": 0, "C": 0}))
        self.assertFalse(cc.eval_function(cc.parse_function("!A^B"), {"A": 1, "B": 0}))  # (!A)^B
        self.assertTrue(cc.eval_function(cc.parse_function("A+B*C"), {"A": 0, "B": 1, "C": 1}))
        with self.assertRaises(cc.CharError):
            cc.sensitize("A&D", ["A", "B"], "A")

    def test_job_needs_one_function_per_output(self):
        with self.assertRaises(cc.CharError):
            cell("HA_X", ("A", "B"), ("COUT", "SUM"), {"COUT": "A&B"})


NETLIST = """* NGSPICE file created from NOR2_PU2.ext - technology: sky130A

.subckt NOR2_PU2 GND VDD Y B A
X0 Y A a_1# w_n15_256# sky130_fd_pr__pfet_01v8_hvt ad=0.28 pd=2.56 as=0.155 ps=1.31 w=1 l=0.15
X1 a_1# B VDD w_n15_256# sky130_fd_pr__pfet_01v8_hvt w=1 l=0.15
X2 Y A GND VSUBS sky130_fd_pr__nfet_01v8 w=0.65 l=0.15
X3 GND B Y VSUBS sky130_fd_pr__nfet_01v8 w=0.65 l=0.15
C0 A Y 0.05f
C1 w_n15_256# VDD 0.03f
C2 B w_n15_256# 0.06f **FLOATING
C3 GND VSUBS 0.29f
C4 Y VSUBS 0.22f **FLOATING
.ends

.subckt OTHER a b
X0 a b c w_x# sky130_fd_pr__pfet_01v8_hvt w=1 l=0.15
.ends
"""


class NetlistSanitizing(unittest.TestCase):
    def test_floating_comments_stripped_and_wells_tied(self):
        text, report = cc.sanitize_netlist(NETLIST, "NOR2_PU2", "VDD", "GND")
        self.assertNotIn("FLOATING", text)
        self.assertEqual(report["floatingCommentsStripped"], 2)
        self.assertEqual(report["tied"], {"VSUBS": "GND", "w_n15_256#": "VDD"})
        self.assertEqual(report["selfLoopElementsDropped"], 2)          # C1 VDD-VDD and C3 GND-GND
        self.assertIn("X0 Y A a_1# VDD sky130_fd_pr__pfet_01v8_hvt", text)
        self.assertIn("X2 Y A GND GND sky130_fd_pr__nfet_01v8", text)
        self.assertIn("C2 B VDD 0.06f", text)
        self.assertIn("C4 Y GND 0.22f", text)
        self.assertNotIn("C1 ", text)
        self.assertIn("X0 a b c w_x# sky130_fd_pr__pfet_01v8_hvt", text)  # other subckts untouched
        self.assertEqual(cc.netlist_devices(text), ["sky130_fd_pr__nfet_01v8", "sky130_fd_pr__pfet_01v8_hvt"])

    def test_missing_power_port_is_named(self):
        with self.assertRaisesRegex(cc.CharError, "no port VPWR"):
            cc.sanitize_netlist(NETLIST, "NOR2_PU2", "VPWR", "VGND")

    def test_foundry_ports_need_no_tie(self):
        foundry = ".subckt inv VPB VNB VGND VPWR A Y\nX0 Y A VGND VNB sky130_fd_pr__nfet_01v8 w=0.65 l=0.15\n" \
                  "X1 Y A VPWR VPB sky130_fd_pr__pfet_01v8_hvt w=1 l=0.15\n.ends\n"
        _, report = cc.sanitize_netlist(foundry, "inv", "VPWR", "VGND")
        self.assertEqual(report["tied"], {})

    def test_port_roles_reject_unknown_ports(self):
        c = cell("NOR2_PU2", ("A", "B"), ("Y",), {"Y": "!(A|B)"}, power="VDD", ground="GND")
        self.assertEqual(cc.port_roles(["GND", "VDD", "Y", "B", "A"], c), {"GND": "0", "VDD": "vdd", "Y": "Y", "B": "B", "A": "A"})
        with self.assertRaisesRegex(cc.CharError, "port EN"):
            cc.port_roles(["GND", "VDD", "Y", "B", "A", "EN"], c)


class DeckAndMeasures(unittest.TestCase):
    I1 = [0.01, 0.02, 0.05, 0.1, 0.3, 0.6, 1.5]
    I2 = [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05]

    def test_deck_has_49_copies_plus_cap_copy_and_sensitized_sides(self):
        c = cell()
        unit = [u for u in cc.plan_units(c) if u["input"] == "B"][0]
        deck, plan = cc.build_deck(c, ["VPB", "VNB", "VGND", "VPWR", "C", "B", "A", "Y"], unit, self.I1, self.I2,
                                   "/w/x.spice", models_include="/w/models.spice")
        lines = deck.splitlines()
        instances = [l for l in lines if l.startswith("x")]
        self.assertEqual(len(instances), 50)
        self.assertEqual(instances[0], "x0_0 vdd 0 0 vdd 0 in0 0 o0_0 NOR3_X")   # C=0, A=0 (non-controlling)
        self.assertEqual(len([l for l in lines if l.startswith(".meas")]), 49 * 2 * 3 + 2)
        self.assertIn(".include /w/models.spice", lines)
        self.assertFalse(plan["outRisesOnInputRise"])
        self.assertIn(".meas tran m0_0_r_50 when v(o0_0)=0.9 td=0.05n fall=1", lines)

    def test_reduce_unit_turns_crossings_into_liberty_values(self):
        plan = {"ramps": [0.14, 0.28], "t0": 0.05, "t1": 5.0, "outRisesOnInputRise": False,
                "measures": []}
        meas = {}
        for i in range(2):
            for j in range(1):
                # output falls after the input rises: 50 % at t_in + 30 ps, 80 % (1.44 V) and 20 % 40 ps apart
                t_in = 0.05 + plan["ramps"][i] / 2
                meas.update({"m%d_0_r_50" % i: (t_in + 0.030) * 1e-9, "m%d_0_r_hi" % i: (t_in + 0.010) * 1e-9,
                             "m%d_0_r_lo" % i: (t_in + 0.050) * 1e-9})
                t_in = 5.0 + plan["ramps"][i] / 2
                meas.update({"m%d_0_f_50" % i: (t_in + 0.070) * 1e-9, "m%d_0_f_lo" % i: (t_in + 0.040) * 1e-9,
                             "m%d_0_f_hi" % i: (t_in + 0.100) * 1e-9})
        meas.update({"qrise": -3.6e-15, "qfall": 2.7e-15})
        plan["measures"] = sorted(meas)
        tables, caps = cc.reduce_unit(meas, plan, [0.1, 0.2], [0.001])
        self.assertAlmostEqual(tables["cell_fall"][1][0], 0.030, places=9)
        self.assertAlmostEqual(tables["fall_transition"][0][0], 0.040, places=9)
        self.assertAlmostEqual(tables["cell_rise"][0][0], 0.070, places=9)
        self.assertAlmostEqual(tables["rise_transition"][1][0], 0.060, places=9)
        self.assertAlmostEqual(caps["rise_capacitance"], 0.002, places=12)   # 3.6 fC / 1.8 V
        self.assertAlmostEqual(caps["fall_capacitance"], 0.0015, places=12)
        del meas["m1_0_f_lo"]
        with self.assertRaisesRegex(cc.CharError, "measurement"):
            cc.reduce_unit(meas, plan, [0.1, 0.2], [0.001])

    def test_ngspice_measure_lines_parse(self):
        out = "m0_0_r_50           =  1.234560e-10\nqrise               =  -3.60000e-15 from=  5.0e-11 to=  5.0e-09\n" \
              "Error: measure  m0_0_r_lo  :  failed!\n"
        self.assertEqual(cc.parse_measures(out), {"m0_0_r_50": 1.23456e-10, "qrise": -3.6e-15})

    def test_reduced_models_keep_only_used_devices(self):
        files = {
            "/p/ngspice/sky130.lib.spice": ".lib tt\n.param mc_mm_switch=0\n.include \"corners/tt.spice\"\n"
                                           ".include \"r+c/res.spice\"\n.endl tt\n",
            "/p/ngspice/corners/tt.spice": ".include \"../../ref/sky130_fd_pr__nfet_01v8__tt.pm3.spice\"\n"
                                           ".include \"../../ref/sky130_fd_pr__nfet_01v8_lvt__tt.corner.spice\"\n"
                                           ".include \"../../ref/sky130_fd_pr__pfet_01v8_hvt__tt.pm3.spice\"\n"
                                           ".include \"../all.spice\"\n",
            "/p/ngspice/all.spice": ".option scale=1.0u\n.include \"parameters/lod.spice\"\n.param x=1\n"
                                    ".include \"capacitors/cap.spice\"\n",
        }
        text = cc.reduced_models("/p/ngspice/sky130.lib.spice", "tt",
                                 ["sky130_fd_pr__nfet_01v8", "sky130_fd_pr__pfet_01v8_hvt"], read=files.__getitem__)
        self.assertEqual(text.splitlines()[1:], [
            ".param mc_mm_switch=0",
            '.include "/p/ref/sky130_fd_pr__nfet_01v8__tt.pm3.spice"',
            '.include "/p/ref/sky130_fd_pr__pfet_01v8_hvt__tt.pm3.spice"',
            ".option scale=1.0u", '.include "/p/ngspice/parameters/lod.spice"', ".param x=1"])
        with self.assertRaisesRegex(cc.CharError, "pfet_01v8_lvt"):
            cc.reduced_models("/p/ngspice/sky130.lib.spice", "tt", ["sky130_fd_pr__pfet_01v8_lvt"], read=files.__getitem__)


class LibertyWriter(unittest.TestCase):
    def ha_text(self):
        ha = cell("HA_X", ("A", "B"), ("COUT", "SUM"), {"COUT": "(A&B)", "SUM": "(A&!B) | (!A&B)"})
        table = {q: [[0.01 * (i + 1) + 0.001 * j for j in range(7)] for i in range(7)] for q in cc.QUANTITIES}
        arcs = [{"output": "COUT", "input": "A", "sense": "positive_unate", "tables": table},
                {"output": "SUM", "input": "A", "sense": "positive_unate", "tables": table},
                {"output": "SUM", "input": "A", "sense": "negative_unate", "tables": table}]
        caps = {"A": {"rise_capacitance": 0.004, "fall_capacitance": 0.002}, "B": {"rise_capacitance": 0.003, "fall_capacitance": 0.003}}
        index_1 = [0.01, 0.023, 0.053, 0.122, 0.282, 0.651, 1.5]
        index_2 = {"COUT": [0.0005 * 2 ** k for k in range(7)], "SUM": [0.0005 * 3 ** k for k in range(7)]}
        return ha, cc.liberty_cell(ha, arcs, caps, index_1, index_2, extra_comment="method x")

    def test_cell_group_shape(self):
        ha, text = self.ha_text()
        self.assertIn("/* %s */" % cc.BANNER, text)
        self.assertIn("SPICE-characterized from extracted layout, tt 1.8V 25C, calibrated", text)
        items, _ = cc.parse_liberty(text)
        self.assertEqual([(i[0], i[1], i[2]) for i in items], [("group", "cell", "HA_X")])
        body = items[0][3]
        attrs = {i[1]: i[2] for i in body if i[0] == "attr"}
        self.assertEqual(attrs, {"area": "8.7600000000", "cell_footprint": "HA_X"})
        self.assertEqual([i[2] for i in body if i[0] == "group" and i[1] == "pg_pin"], ["VGND", "VNB", "VPB", "VPWR"])
        pins = {i[2]: i[3] for i in body if i[0] == "group" and i[1] == "pin"}
        self.assertEqual(sorted(pins), ["A", "B", "COUT", "SUM"])
        a = {i[1]: i[2] for i in pins["A"] if i[0] == "attr"}
        self.assertEqual((a["capacitance"], a["rise_capacitance"], a["fall_capacitance"]), ("0.0030000000", "0.0040000000", "0.0020000000"))
        sum_timing = [i for i in pins["SUM"] if i[0] == "group" and i[1] == "timing"]
        self.assertEqual(len(sum_timing), 2)
        self.assertEqual(sorted({i[1]: i[2] for i in t[3] if i[0] == "attr"}["timing_sense"] for t in sum_timing),
                         ["negative_unate", "positive_unate"])
        tables = [i for i in sum_timing[0][3] if i[0] == "group"]
        self.assertEqual([t[1] for t in tables], ["cell_fall", "cell_rise", "fall_transition", "rise_transition"])
        self.assertEqual({i[1]: i[2] for i in pins["SUM"] if i[0] == "attr"}["max_capacitance"], "%.10f" % (0.0005 * 3 ** 6))

    def test_readable_by_the_recipe_validator_and_mergeable(self):
        ha, text = self.ha_text()
        cells = cli.liberty_cells(text)
        self.assertEqual(cells["HA_X"]["pins"], {"A": "input", "B": "input", "COUT": "output", "SUM": "output"})
        self.assertEqual(cells["HA_X"]["pg_pins"], {"VGND", "VNB", "VPB", "VPWR"})
        self.assertEqual(cells["HA_X"]["area"], 8.76)
        with tempfile.TemporaryDirectory() as tmp:
            base, custom, out = Path(tmp, "base.lib"), Path(tmp, "custom.lib"), Path(tmp, "merged.lib")
            base.write_text('library ("base") {\n    cell ("x") {\n        area : 1;\n    }\n}\n')
            custom.write_text("/* banner */\n\n" + text)
            cli._merge_liberty(base, custom, out)
            merged = out.read_text()
            self.assertEqual(sorted(cli.liberty_cells(merged)), ["HA_X", "x"])
            items, _ = cc.parse_liberty(merged)
            self.assertEqual(len(items), 1)

    def test_standalone_library_round_trips(self):
        ha, text = self.ha_text()
        lib = cc.standalone_library("custom_measured", [text])
        items, _ = cc.parse_liberty(lib)
        self.assertEqual((items[0][1], items[0][2]), ("library", "custom_measured"))
        parsed = cc.read_cell(lib, "HA_X")
        self.assertEqual(len(parsed["arcs"]), 3)
        self.assertEqual(parsed["arcs"][0]["tables"]["cell_rise"][1][2], 0.022)


class CalibrationMath(unittest.TestCase):
    def test_uniform_bias_gives_exact_factor_and_zero_residual(self):
        factors, residual = cc.calibration_factors({"cell_rise": [(1.0, 1.1), (2.0, 2.2), (0.5, 0.55)]})
        self.assertAlmostEqual(factors["cell_rise"], 1.1)
        self.assertAlmostEqual(residual["cell_rise"]["p90"], 0.0)
        self.assertAlmostEqual(residual["cell_rise"]["rawP90"], 0.1 / 1.1)

    def test_median_factor_and_p90_residual(self):
        # ratios ref/sim 0.9, 1.0, 1.2 -> factor 1.0; |residuals| 1/0.9-1, 0, 1-1/1.2
        factors, residual = cc.calibration_factors({"cell_fall": [(1.0, 0.9), (1.0, 1.0), (1.0, 1.2)]})
        self.assertAlmostEqual(factors["cell_fall"], 1.0)
        a, b = 1 / 0.9 - 1, 1 - 1 / 1.2
        self.assertAlmostEqual(residual["cell_fall"]["p90"], a + 0.8 * (b - a))
        self.assertAlmostEqual(residual["cell_fall"]["max"], b)
        self.assertEqual(cc.percentile([4, 1, 3, 2], 50), 2.5)

    def calibration(self, **over):
        quantities = cc.QUANTITIES + cc.CAP_QUANTITIES
        data = {"schema": "hima-cellchar-calibration/1", "methodFingerprint": cc.method_fingerprint(),
                "tolerance": {"p90AbsResidual": 0.15}, "factors": {q: 1.05 for q in quantities},
                "residual": {q: {"p90": 0.12} for q in quantities}}
        data.update(over)
        return data

    def test_gate(self):
        self.assertIsNone(cc.calibration_gate(self.calibration(), cc.method_fingerprint()))
        bad = self.calibration()
        bad["residual"]["fall_transition"]["p90"] = 0.2
        self.assertIn("fall_transition p90 20.0%", cc.calibration_gate(bad, cc.method_fingerprint()))
        self.assertIn("rerun calibrate.py", cc.calibration_gate(self.calibration(methodFingerprint="old"), cc.method_fingerprint()))
        wild = self.calibration()
        wild["factors"]["cell_rise"] = 1.6
        self.assertIn("cell_rise 1.600", cc.calibration_gate(wild, cc.method_fingerprint()))
        self.assertIn("looser", cc.calibration_gate(self.calibration(tolerance={"p90AbsResidual": 0.3}), cc.method_fingerprint()))

    def test_apply_factors(self):
        arcs = [{"output": "Y", "input": "A", "sense": "negative_unate",
                 "tables": {q: [[1.0, 2.0]] for q in cc.QUANTITIES}}]
        factors = {"cell_rise": 2.0, "cell_fall": 0.5, "rise_transition": 1.0, "fall_transition": 1.5,
                   "rise_capacitance": 0.9, "fall_capacitance": 1.1}
        out, caps = cc.apply_factors(arcs, {"A": {"rise_capacitance": 0.002, "fall_capacitance": 0.002}}, factors)
        self.assertEqual(out[0]["tables"]["cell_rise"], [[2.0, 4.0]])
        self.assertEqual(out[0]["tables"]["cell_fall"], [[0.5, 1.0]])
        self.assertAlmostEqual(caps["A"]["fall_capacitance"], 0.0022)
        self.assertEqual(arcs[0]["tables"]["cell_rise"], [[1.0, 2.0]])   # input untouched

    def test_characterize_refuses_before_simulating(self):
        with tempfile.TemporaryDirectory() as tmp:
            cal = Path(tmp, "cal.json")
            bad = self.calibration()
            bad["residual"]["cell_rise"]["p90"] = 0.4
            cal.write_text(json.dumps(bad))
            job = Path(tmp, "job.json")
            job.write_text(json.dumps({"cells": []}))
            out = Path(tmp, "out")
            code = ch.main([str(job), "--reference-lib", str(job), "--calibration", str(cal), "--out", str(out)])
            self.assertEqual(code, 2)
            result = json.loads((out / "characterization.json").read_text())
            self.assertIn("cell_rise p90 40.0%", result["refused"])
            self.assertFalse((out / "custom.measured.lib").exists())

    def test_prelayout_netlist_needs_a_prelayout_calibration(self):
        with tempfile.TemporaryDirectory() as tmp:
            cal = Path(tmp, "cal.json")
            cal.write_text(json.dumps(self.calibration()))          # an extracted-layout calibration
            job = Path(tmp, "job.json")
            job.write_text(json.dumps({"cells": []}))
            out = Path(tmp, "out")
            code = ch.main([str(job), "--reference-lib", str(job), "--calibration", str(cal), "--out", str(out),
                            "--netlist-kind", "pre-layout"])
            self.assertEqual(code, 2)
            self.assertIn("is for extracted netlists, this job is pre-layout",
                          json.loads((out / "characterization.json").read_text())["refused"])
            stale = dict(self.calibration(), netlistKind="pre-layout", prelayoutParasitics={"version": "old"})
            cal.write_text(json.dumps(stale))
            code = ch.main([str(job), "--reference-lib", str(job), "--calibration", str(cal), "--out", str(out),
                            "--netlist-kind", "pre-layout"])
            self.assertEqual(code, 2)
            self.assertIn("another pre-layout parasitic estimate",
                          json.loads((out / "characterization.json").read_text())["refused"])


class PrelayoutParasitics(unittest.TestCase):
    NAND2 = """.subckt NAND2_X A B Y VGND VNB VPB VPWR
X0 Y A VPWR VPB sky130_fd_pr__pfet_01v8_hvt w=1e+06u l=150000u
X1 Y B VPWR VPB sky130_fd_pr__pfet_01v8_hvt w=1e+06u l=150000u
X2 Y A n1 VNB sky130_fd_pr__nfet_01v8 w=0.65 l=0.15
X3 n1 B VGND VNB sky130_fd_pr__nfet_01v8 w=0.65 l=0.15
.ends
"""

    def devices(self, text):
        return {line.split()[0]: dict(t.split("=", 1) for t in line.split()[6:]) for line in text.splitlines()
                if line.startswith("X")}

    def test_diffusion_follows_the_foundry_extraction(self):
        devs = self.devices(cc.add_prelayout_parasitics(self.NAND2, "NAND2_X"))
        # 1e+06u = 1 um; output and rail diffusions are end diffusions: 0.265 um long, 2*(W + 0.265) perimeter
        self.assertAlmostEqual(float(devs["X0"]["ad"]), 0.265)
        self.assertAlmostEqual(float(devs["X0"]["pd"]), 2.53)
        # n1 joins exactly two nfets: a shared diffusion, 0.14 um long, W + 2 * 0.14 perimeter
        self.assertAlmostEqual(float(devs["X2"]["as"]), 0.65 * 0.14)
        self.assertAlmostEqual(float(devs["X2"]["ps"]), 0.93)
        self.assertAlmostEqual(float(devs["X2"]["ad"]), 0.65 * 0.265)

    def test_wire_cap_per_terminal_and_bigger_cells_load_their_inputs_more(self):
        text = cc.add_prelayout_parasitics(self.NAND2, "NAND2_X", ["A", "B"])
        caps = {line.split()[1]: line.split()[3] for line in text.splitlines() if line.startswith("Cpre_")}
        # 4 devices < 6: no size scaling. Y touches 3 drains -> 0.3 fF, A two gates -> 0.2 fF, n1 two diffusions
        self.assertEqual(caps, {"A": "0.2f", "B": "0.2f", "Y": "0.3f", "n1": "0.2f"})
        big = self.NAND2.replace(".ends", "\n".join("X%d Y A VPWR VPB sky130_fd_pr__pfet_01v8_hvt w=1 l=0.15" % i
                                                   for i in range(10, 18)) + "\n.ends")
        caps = {line.split()[1]: line.split()[3] for line in cc.add_prelayout_parasitics(big, "NAND2_X", ["A", "B"]).splitlines()
                if line.startswith("Cpre_")}
        # 12 devices: inputs scale by (12/6)**0.65 = 1.569; A has 10 gates -> 1.569 fF; Y (not an input) stays 1.1 fF
        self.assertEqual(caps["A"], "1.569f")
        self.assertEqual(caps["Y"], "1.1f")

    def test_existing_geometry_is_kept(self):
        extracted = self.NAND2.replace("w=0.65 l=0.15\nX3", "w=0.65 l=0.15 ad=0.1 pd=1 as=0.1 ps=1\nX3")
        devs = self.devices(cc.add_prelayout_parasitics(extracted, "NAND2_X"))
        self.assertEqual(devs["X2"]["ad"], "0.1")


if __name__ == "__main__":
    unittest.main()
