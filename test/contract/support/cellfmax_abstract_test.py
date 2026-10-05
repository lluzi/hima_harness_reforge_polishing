"""Unit tests for the Pack's abstract-cell builder (flow/toolbox/abstract), pure Python: no bool2cmos.

Run with `python3 -m unittest test/contract/support/cellfmax_abstract_test.py`. Expected geometry is
written by hand from the fixture macros below, never from the code under test.
"""
import re
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / "packs" / "custom-cell-fmax-sky130-demo" / "flow" / "toolbox" / "abstract"))
import abstract_cells as ab  # noqa: E402


def macro(name, width, signal):
    """A foundry-style macro: li1 signal pins at x = 0.2, 0.6, ..., met1 rails across the full width."""
    pins = []
    for i, (pin, direction) in enumerate(signal):
        x = 0.2 + 0.4 * i
        pins.append("  PIN %s\n    DIRECTION %s ;\n    USE SIGNAL ;\n    ANTENNAGATEAREA 0.1 ;\n    PORT\n"
                    "      LAYER li1 ;\n        RECT %.3f 1.000 %.3f 1.300 ;\n    END\n  END %s" % (pin, direction, x, x + 0.17, pin))
    for pin, use, y0, y1 in (("VGND", "GROUND", -0.24, 0.24), ("VNB", "GROUND", -0.19, 0.24),
                             ("VPB", "POWER", 1.3, 2.91), ("VPWR", "POWER", 2.48, 2.96)):
        layer = "met1" if pin in ("VGND", "VPWR") else ("pwell" if pin == "VNB" else "nwell")
        pins.append("  PIN %s\n    DIRECTION INOUT ;\n    USE %s ;\n    PORT\n      LAYER %s ;\n        RECT 0.000 %.3f %.3f %.3f ;\n"
                    "    END\n  END %s" % (pin, use, layer, y0, width, y1, pin))
    return ("MACRO %s\n  CLASS CORE ;\n  ORIGIN 0 0 ;\n  SIZE %.3f BY 2.720 ;\n  SITE unithd ;\n%s\n  OBS\n"
            "      LAYER li1 ;\n        RECT 0.100 0.300 0.200 0.500 ;\n  END\nEND %s\n" % (name, width, "\n".join(pins), name))


LEF = "VERSION 5.7 ;\n" + macro("sky130_fd_sc_hd__nand2_1", 1.38, [("A", "INPUT"), ("B", "INPUT"), ("Y", "OUTPUT")]) \
    + macro("sky130_fd_sc_hd__nor2_1", 1.38, [("A", "INPUT"), ("B", "INPUT"), ("Y", "OUTPUT")])
SPICE = """.subckt sky130_fd_sc_hd__nand2_1 A B VGND VNB VPB VPWR Y
X0 Y A VPWR VPB sky130_fd_pr__pfet_01v8_hvt w=1e+06u l=150000u
X1 Y B VPWR VPB sky130_fd_pr__pfet_01v8_hvt w=1e+06u l=150000u
X2 Y A n1 VNB sky130_fd_pr__nfet_01v8 w=650000u l=150000u
X3 n1 B VGND VNB sky130_fd_pr__nfet_01v8 w=650000u l=150000u
.ends
"""


def cell(name, outputs, inputs=("A", "B")):
    return {"name": name, "inputs": list(inputs), "outputs": dict(outputs)}


def pin_block(text, pin):
    return re.search(r"(?ms)^  PIN %s$.*?^  END %s$" % (pin, pin), text).group(0)


class Compose(unittest.TestCase):
    def test_drop_in_copies_the_foundry_pins_under_the_new_name(self):
        c = cell("NAND2_PU2", {"Y": "!(A&B)"})
        sources = ab.layout_sources({"compareTo": "sky130_fd_sc_hd__nand2_1"}, c, LEF)
        self.assertEqual(sources, [("sky130_fd_sc_hd__nand2_1", {"A": "A", "B": "B", "Y": "Y"})])
        text, width, height = ab.compose(c, sources, LEF, 0)
        self.assertEqual((width, height), (1.38, 2.72))
        self.assertIn("MACRO NAND2_PU2", text)
        self.assertIn("RECT 0.200 1.000 0.370 1.300 ;", pin_block(text, "A"))
        self.assertIn("DIRECTION OUTPUT ;", pin_block(text, "Y"))
        self.assertNotIn("ANTENNA", text)

    def test_widening_adds_sites_and_stretches_the_rails(self):
        c = cell("NAND2_PU2", {"Y": "!(A&B)"})
        text, width, _ = ab.compose(c, [("sky130_fd_sc_hd__nand2_1", {"A": "A", "B": "B", "Y": "Y"})], LEF, 2)
        self.assertEqual(width, 2.30)                        # 3 sites + 2 sites of 0.46
        self.assertIn("SIZE 2.300 BY 2.720 ;", text)
        self.assertIn("RECT 0.000 2.480 2.300 2.960 ;", pin_block(text, "VPWR"))
        self.assertIn("RECT 0.000 -0.240 2.300 0.240 ;", pin_block(text, "VGND"))

    def test_multi_output_cell_composes_two_foundry_cells_side_by_side(self):
        c = cell("MO_NAND2_NOR2", {"Y1": "!(A&B)", "Y2": "!(A|B)"})
        raw = {"compareTo": "sky130_fd_sc_hd__nand2_1",
               "layoutFrom": [{"cell": "nand2_1", "pins": {"A": "A", "B": "B", "Y": "Y1"}},
                              {"cell": "sky130_fd_sc_hd__nor2_1", "pins": {"A": "A", "B": "B", "Y": "Y2"}}]}
        text, width, _ = ab.compose(c, ab.layout_sources(raw, c, LEF), LEF, 0)
        self.assertEqual(width, 2.76)
        a = pin_block(text, "A")
        self.assertEqual(a.count("PORT"), 2)                 # shared input: one port in each half
        self.assertIn("RECT 0.200 1.000 0.370 1.300 ;", a)
        self.assertIn("RECT 1.580 1.000 1.750 1.300 ;", a)   # shifted by 1.38
        self.assertIn("RECT 2.380 1.000 2.550 1.300 ;", pin_block(text, "Y2"))
        self.assertIn("RECT 1.480 0.300 1.580 0.500 ;", text)  # the second half's obstruction, shifted
        self.assertIn("RECT 0.000 2.480 2.760 2.960 ;", pin_block(text, "VPWR"))

    def test_unused_source_pin_becomes_obstruction(self):
        c = cell("NAND2_A_ONLY", {"Y": "!A"}, inputs=("A",))
        text, _, _ = ab.compose(c, [("sky130_fd_sc_hd__nand2_1", {"A": "A", "B": None, "Y": "Y"})], LEF, 0)
        self.assertNotIn("PIN B", text)
        obs = re.search(r"(?ms)^  OBS$.*?^  END$", text).group(0)
        self.assertIn("RECT 0.600 1.000 0.770 1.300 ;", obs)

    def test_refusals_name_what_must_change(self):
        mo = cell("MO_X", {"Y1": "!(A&B)", "Y2": "!(A|B)"})
        with self.assertRaisesRegex(ab.AbstractError, "pins differ from sky130_fd_sc_hd__nand2_1.*give layoutFrom"):
            ab.layout_sources({"compareTo": "sky130_fd_sc_hd__nand2_1"}, mo, LEF)
        with self.assertRaisesRegex(ab.AbstractError, r"pins \['Y'\] have no mapping"):
            ab.compose(mo, [("sky130_fd_sc_hd__nand2_1", {"A": "A", "B": "B"})], LEF, 0)
        with self.assertRaisesRegex(ab.AbstractError, "layout pins .* differ from the cell's pins"):
            ab.compose(mo, [("sky130_fd_sc_hd__nand2_1", {"A": "A", "B": "B", "Y": "Y1"})], LEF, 0)
        with self.assertRaisesRegex(ab.AbstractError, "not in the platform LEF"):
            ab.macro_text(LEF, "sky130_fd_sc_hd__xor2_1")

    def test_foundry_width_reads_si_suffixes(self):
        self.assertAlmostEqual(ab.foundry_width(SPICE, "sky130_fd_sc_hd__nand2_1"), 3.3)


if __name__ == "__main__":
    unittest.main()
