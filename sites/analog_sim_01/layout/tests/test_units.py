#!/usr/bin/env python3
"""Unit checks of cell_layout.py's pure parts (no tools needed): python3 tests/test_units.py"""
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import cell_layout as cl  # noqa: E402


class Units(unittest.TestCase):
    def test_finger_plan_exact_total(self):
        for w in (280, 3815, 28330, 71980, 86215, 100000):
            plan = cl.finger_plan(w)
            self.assertEqual(sum(c * f for c, f in plan), w)
            self.assertTrue(all(f <= cl.MAX_FINGER_NM for _c, f in plan))
            self.assertLessEqual(len(plan), 2)

    def test_band_counts(self):
        for n in range(1, 45):
            for b in (1, 2, 3):
                c = cl.ResBlock.band_counts(n, b)
                self.assertEqual(sum(c), n)
                self.assertTrue(all(x <= c[0] for x in c))
                self.assertTrue(all(x % 2 for x in c[:-1]))

    def test_netlists_floorplan(self):
        for name, cell in (("bandgap_shape.spice", "bandgap"), ("bandgap_pack_lb.spice", "bandgap_lb"), ("bandgap_site_r1.spice", "bandgap_lb")):
            pins, devices, _ = cl.read_subckt(HERE / name, cell)
            drawn, facts = cl.build(pins, devices)
            w, h = facts["floorplan"]["estimateUm"]
            self.assertLess(max(w, h) / min(w, h), 1.6, name)
            for d, m in facts["mos"].items():
                self.assertAlmostEqual(sum(c * f for c, f in m["fingers"]), m["wUm"], places=6)

    def test_ports_vsubs_mapped(self):
        with tempfile.TemporaryDirectory() as t:
            p = Path(t) / "x.spice"
            p.write_text(".subckt c vdd vss a VSUBS\nC0 a VSUBS 1f\n.ends\n")
            ok, notes = cl.check_ports(p, "c", ["vdd", "vss", "a"], "vss")
            self.assertTrue(ok)
            self.assertIn("VSUBS", notes[0])
            self.assertNotIn("VSUBS", p.read_text())
            p.write_text(".subckt c vdd vss a extra\n.ends\n")
            self.assertFalse(cl.check_ports(p, "c", ["vdd", "vss", "a"], "vss")[0])

    def test_refuses_non_empty_folder(self):
        with tempfile.TemporaryDirectory() as t:
            (Path(t) / "old.txt").write_text("x")
            with self.assertRaises(cl.Error):
                cl.cmd_all(str(HERE / "bandgap_shape.spice"), "bandgap", t)


if __name__ == "__main__":
    unittest.main()
