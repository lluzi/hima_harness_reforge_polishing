"""Unit tests for the Pack's mock characterizer (flow/toolbox/char/mockcore.py), pure Python: no PDK, no SPICE.

Run with `python3 -m unittest test/contract/support/cellfmax_mock_test.py`. The foundry Liberty here is
synthetic (charcore writes it from hand-made tables); the model is the shipped mock-fit.json.
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
CHAR = REPO / "packs" / "custom-cell-fmax-sky130-demo" / "flow" / "toolbox" / "char"
sys.path.insert(0, str(CHAR))
import charcore as cc  # noqa: E402
import characterize  # noqa: E402
import mockcore as mc  # noqa: E402

I1 = [0.01, 0.023, 0.053, 0.122, 0.282, 0.651, 1.5]
I2 = [0.0005, 0.0013, 0.0036, 0.0095, 0.0254, 0.0679, 0.1813]

FOUNDRY_SPICE = """.subckt sky130_fd_sc_hd__nand2_1 A B VGND VNB VPB VPWR Y
X0 Y A VPWR VPB sky130_fd_pr__pfet_01v8_hvt w=1e+06u l=150000u
X1 VPWR B Y VPB sky130_fd_pr__pfet_01v8_hvt w=1e+06u l=150000u
X2 Y A n1 VNB sky130_fd_pr__nfet_01v8 w=650000u l=150000u
X3 n1 B VGND VNB sky130_fd_pr__nfet_01v8 w=650000u l=150000u
.ends
.subckt sky130_fd_sc_hd__nor2_1 A B VGND VNB VPB VPWR Y
X0 VPWR A n1 VPB sky130_fd_pr__pfet_01v8_hvt w=1e+06u l=150000u
X1 n1 B Y VPB sky130_fd_pr__pfet_01v8_hvt w=1e+06u l=150000u
X2 Y A VGND VNB sky130_fd_pr__nfet_01v8 w=650000u l=150000u
X3 VGND B Y VNB sky130_fd_pr__nfet_01v8 w=650000u l=150000u
.ends
"""


def table(base, slope):
    return [[base + 0.2 * s + slope * l for l in I2] for s in I1]


def foundry_lib():
    groups = []
    for name, function, rise, fall in (("sky130_fd_sc_hd__nand2_1", "!(A&B)", 1.0, 1.4),
                                       ("sky130_fd_sc_hd__nor2_1", "!(A|B)", 2.0, 0.9)):
        cell = {"name": name, "area": 3.75, "footprint": name.split("__")[1][:-2], "inputs": ["A", "B"],
                "outputs": ["Y"], "functions": {"Y": function}}
        arcs = [{"output": "Y", "input": pin, "sense": "negative_unate",
                 "tables": {"cell_rise": table(0.03, 4.0 * rise), "cell_fall": table(0.02, 4.0 * fall),
                            "rise_transition": table(0.02, 6.0 * rise), "fall_transition": table(0.015, 6.0 * fall)}}
                for pin in ("A", "B")]
        caps = {pin: {"rise_capacitance": 0.0023, "fall_capacitance": 0.0023} for pin in ("A", "B")}
        groups.append(cc.liberty_cell(cell, arcs, caps, I1, {"Y": I2}))
    return cc.standalone_library("foundry", groups)


def custom_netlist(name, ports, devices):
    return ".subckt %s %s VGND VNB VPB VPWR\n%s\n.ends %s\n" % (name, " ".join(ports), "\n".join(devices), name)


def nand2(name, pfet_w=1.0, out="Y"):
    return custom_netlist(name, ["A", "B", out], [
        "X0 %s A VPWR VPB sky130_fd_pr__pfet_01v8_hvt w=%g l=0.15" % (out, pfet_w),
        "X1 %s B VPWR VPB sky130_fd_pr__pfet_01v8_hvt w=%g l=0.15" % (out, pfet_w),
        "X2 %s A n1 VNB sky130_fd_pr__nfet_01v8 w=0.65 l=0.15" % out,
        "X3 n1 B VGND VNB sky130_fd_pr__nfet_01v8 w=0.65 l=0.15"])


def cell(name, inputs, functions, anchors):
    return cc.normalize_cell({"name": name, "pins": {"inputs": inputs, "outputs": list(functions)},
                              "functions": functions, "area_um2": 3.75, "anchors": anchors})


class Mock(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.model = mc.load_model()["model"]
        cls.lib = foundry_lib()
        cls.refs = {n: mc.foundry_stages(FOUNDRY_SPICE, cls.lib, n)
                    for n in ("sky130_fd_sc_hd__nand2_1", "sky130_fd_sc_hd__nor2_1")}
        cls.ref_nand = cc.read_cell(cls.lib, "sky130_fd_sc_hd__nand2_1")

    def mock(self, c, text):
        return mc.mock_cell(c, text, I1, {o: I2 for o in c["outputs"]}, self.refs, c["anchors"], self.model)

    def test_shipped_fit_is_a_mockchar_model(self):
        fit = mc.load_model()
        self.assertEqual(fit["model"]["version"], "mockchar/1")
        self.assertEqual(fit["fingerprint"], mc.model_fingerprint(fit["model"]))
        self.assertEqual(set(fit["model"]["coef"]), set(cc.QUANTITIES))

    def test_folded_devices_are_one_wider_switch(self):
        text = custom_netlist("INV_F", ["A", "Y"], [
            "X0_f0 Y A VPWR VPB sky130_fd_pr__pfet_01v8_hvt w=1 l=0.15",
            "X0_f1 Y A VPWR VPB sky130_fd_pr__pfet_01v8_hvt w=1 l=0.15",
            "X1 Y A VGND VNB sky130_fd_pr__nfet_01v8 w=650000u l=150000u"])
        stages = mc.Stages(mc.parse_devices(text, "INV_F"), ["A"], ["Y"])
        self.assertAlmostEqual(stages.pull[("Y", "A", "rise")], 0.5)
        self.assertAlmostEqual(stages.pull[("Y", "A", "fall")], 1 / 0.65)
        self.assertAlmostEqual(stages.gates["A"], 2.65)

    def test_the_foundry_netlist_reproduces_the_foundry_table(self):
        text = FOUNDRY_SPICE.split(".ends")[0].replace("sky130_fd_sc_hd__nand2_1", "SAME") + ".ends\n"
        c = cell("SAME", ["A", "B"], {"Y": "!(A&B)"}, [["sky130_fd_sc_hd__nand2_1", {"A": "A", "B": "B", "Y": "Y"}]])
        arcs, _, basis = self.mock(c, text)
        self.assertEqual(len(basis["anchored"]), 2)
        self.assertEqual(basis["model"], [])
        for arc in arcs:
            ref = next(a for a in self.ref_nand["arcs"] if a["input"] == arc["input"])
            for q in cc.QUANTITIES:
                for mine, theirs in zip(arc["tables"][q], ref["tables"][q]):
                    for a, b in zip(mine, theirs):
                        self.assertAlmostEqual(a, b, places=9)

    def test_a_stronger_pull_up_rises_faster_and_loads_its_inputs_more(self):
        anchors = [["sky130_fd_sc_hd__nand2_1", {"A": "A", "B": "B", "Y": "Y"}]]
        base, _, _ = self.mock(cell("N1", ["A", "B"], {"Y": "!(A&B)"}, anchors), nand2("N1"))
        pu2, caps2, _ = self.mock(cell("N2", ["A", "B"], {"Y": "!(A&B)"}, anchors), nand2("N2", pfet_w=2.0))
        _, caps1, _ = self.mock(cell("N1", ["A", "B"], {"Y": "!(A&B)"}, anchors), nand2("N1"))
        self.assertLess(pu2[0]["tables"]["cell_rise"][3][5], base[0]["tables"]["cell_rise"][3][5])
        self.assertLess(pu2[0]["tables"]["rise_transition"][3][5], base[0]["tables"]["rise_transition"][3][5])
        self.assertGreater(caps2["A"]["rise_capacitance"], caps1["A"]["rise_capacitance"])

    def test_multi_output_cells_anchor_each_output_to_its_layout_source(self):
        text = custom_netlist("MO", ["A", "B", "Y1", "Y2"], [
            "X0 Y1 A VPWR VPB sky130_fd_pr__pfet_01v8_hvt w=1 l=0.15",
            "X1 Y1 B VPWR VPB sky130_fd_pr__pfet_01v8_hvt w=1 l=0.15",
            "X2 Y1 A n1 VNB sky130_fd_pr__nfet_01v8 w=0.65 l=0.15",
            "X3 n1 B VGND VNB sky130_fd_pr__nfet_01v8 w=0.65 l=0.15",
            "X4 VPWR A n2 VPB sky130_fd_pr__pfet_01v8_hvt w=1 l=0.15",
            "X5 n2 B Y2 VPB sky130_fd_pr__pfet_01v8_hvt w=1 l=0.15",
            "X6 Y2 A VGND VNB sky130_fd_pr__nfet_01v8 w=0.65 l=0.15",
            "X7 VGND B Y2 VNB sky130_fd_pr__nfet_01v8 w=0.65 l=0.15"])
        anchors = [["sky130_fd_sc_hd__nand2_1", {"A": "A", "B": "B", "Y": "Y1"}],
                   ["sky130_fd_sc_hd__nor2_1", {"A": "A", "B": "B", "Y": "Y2"}],
                   ["sky130_fd_sc_hd__nand2_1", {"A": "A", "B": "B", "Y1": "Y1", "Y2": "Y2"}]]
        arcs, _, basis = self.mock(cell("MO", ["A", "B"], {"Y1": "!(A&B)", "Y2": "!(A|B)"}, anchors), text)
        self.assertEqual(sorted(t.split(" (")[1] for t in basis["anchored"]),
                         ["sky130_fd_sc_hd__nand2_1 A->Y)", "sky130_fd_sc_hd__nand2_1 B->Y)",
                          "sky130_fd_sc_hd__nor2_1 A->Y)", "sky130_fd_sc_hd__nor2_1 B->Y)"])
        self.assertEqual(len(arcs), 4)

    def test_an_arc_without_a_foundry_counterpart_uses_the_model_and_says_so(self):
        text = custom_netlist("AND2X", ["A", "B", "X"], [
            "X0 n A VPWR VPB sky130_fd_pr__pfet_01v8_hvt w=1 l=0.15",
            "X1 n B VPWR VPB sky130_fd_pr__pfet_01v8_hvt w=1 l=0.15",
            "X2 n A m VNB sky130_fd_pr__nfet_01v8 w=0.65 l=0.15",
            "X3 m B VGND VNB sky130_fd_pr__nfet_01v8 w=0.65 l=0.15",
            "X4 X n VPWR VPB sky130_fd_pr__pfet_01v8_hvt w=1 l=0.15",
            "X5 X n VGND VNB sky130_fd_pr__nfet_01v8 w=0.65 l=0.15"])
        c = cell("AND2X", ["A", "B"], {"X": "A&B"}, [["sky130_fd_sc_hd__nand2_1", {"A": "A", "B": "B", "X": "X"}]])
        arcs, _, basis = self.mock(c, text)
        self.assertEqual(basis["anchored"], [])
        self.assertEqual(sorted(basis["model"]), ["A->X positive_unate", "B->X positive_unate"])
        for arc in arcs:
            for q in cc.QUANTITIES:
                for row in arc["tables"][q]:
                    self.assertEqual(row, sorted(row), "%s must not decrease with load" % q)
                    self.assertGreater(min(row), 0.0)

    def test_monotone_in_load(self):
        self.assertEqual(mc._monotone_in_load([[0.3, 0.2, 0.5]]), [[0.3, 0.3, 0.5]])
        self.assertEqual(mc._monotone_in_load([[-0.1, 0.0005]], floor=0.002), [[0.002, 0.002]])


class MockCli(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        (root / "foundry.lib").write_text(foundry_lib())
        (root / "foundry.spice").write_text(FOUNDRY_SPICE)
        (root / "N2.sp").write_text(nand2("N2", pfet_w=2.0))
        self.job = root / "job.json"
        self.job.write_text(json.dumps({"cells": [{
            "name": "N2", "spice": str(root / "N2.sp"), "subckt": "N2",
            "pins": {"inputs": ["A", "B"], "outputs": ["Y"]}, "functions": {"Y": "!(A&B)"}, "area_um2": 3.75,
            "index_ref": "sky130_fd_sc_hd__nand2_1", "footprint": "nand2",
            "anchors": [["sky130_fd_sc_hd__nand2_1", {"A": "A", "B": "B", "Y": "Y"}]]}]}))
        self.root = root

    def tearDown(self):
        self.tmp.cleanup()

    def run_main(self, *extra):
        out = self.root / "out"
        argv = [str(self.job), "--reference-lib", str(self.root / "foundry.lib"), "--foundry-spice",
                str(self.root / "foundry.spice"), "--out", str(out), "--netlist-kind", "mock"] + list(extra)
        stdout = sys.stdout
        try:
            sys.stdout = open(os.devnull, "w")
            sys.stderr, saved = open(os.devnull, "w"), sys.stderr
            rc = characterize.main(argv)
        finally:
            sys.stdout.close()
            sys.stdout = stdout
            sys.stderr.close()
            sys.stderr = saved
        return rc, out

    def test_mock_writes_a_labelled_liberty_and_record(self):
        rc, out = self.run_main()
        self.assertEqual(rc, 0)
        text = (out / "custom.mock.lib").read_text()
        self.assertIn("MOCK: RC model", text)
        self.assertIn('cell_footprint : "nand2"', text)
        record = json.loads((out / "characterization.json").read_text())
        self.assertEqual(record["netlistKind"], "mock")
        self.assertEqual(record["cells"][0]["status"], "ok")
        self.assertEqual(len(record["cells"][0]["anchoredArcs"]), 2)
        self.assertEqual(record["mockFit"]["fingerprint"], mc.load_model()["fingerprint"])

    def test_mock_takes_no_calibration(self):
        rc, out = self.run_main("--calibration", str(self.root / "x.json"))
        self.assertEqual(rc, 2)
        self.assertIn("takes no calibration", json.loads((out / "characterization.json").read_text())["refused"])

    def test_spice_kinds_still_need_a_calibration(self):
        out = self.root / "out2"
        argv = [str(self.job), "--reference-lib", str(self.root / "foundry.lib"), "--out", str(out)]
        saved = sys.stderr
        try:
            sys.stderr = open(os.devnull, "w")
            rc = characterize.main(argv)
        finally:
            sys.stderr.close()
            sys.stderr = saved
        self.assertEqual(rc, 2)
        self.assertIn("needs --calibration", json.loads((out / "characterization.json").read_text())["refused"])


if __name__ == "__main__":
    unittest.main()
