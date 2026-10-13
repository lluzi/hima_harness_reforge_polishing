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

    # ---------------------------------------------------------------- the reference ladder

    def ladder_netlist(self, rl0):
        """A small cell with a 12-unit ladder vbg -> vss (taps t_1..t_10 pins, t_11 internal, t_5 to a gate)."""
        unit = "ppolyf_u_1k r_length=10u r_width=1u s=1"
        lines = [".subckt lad vdd vss vbg o " + " ".join("t_%d" % k for k in range(1, 11))]
        lines += rl0
        lines += ["XRL%d t_%d %s vss %s" % (k, k, "t_%d" % (k - 1) if k > 1 else "vss", unit) for k in range(11, 0, -1)]
        lines += ["MN o t_5 vss vss nfet_03v3 w=1u l=1u", "MP o vbg vdd vdd pfet_03v3 w=1u l=1u", ".ends lad", ""]
        return "\n".join(lines)

    def read_text(self, text, cell):
        with tempfile.TemporaryDirectory() as t:
            p = Path(t) / "x.spice"
            p.write_text(text)
            return cl.read_subckt(p, cell)

    def test_ladder_found_in_bgcore_only(self):
        pins, devices, _ = cl.read_subckt(HERE / "bgcore_shape.spice", "bandgap_lb")
        self.assertEqual(len(pins), 128)
        (lad,) = cl.find_ladders(devices, "vss")
        self.assertEqual((lad["start"], lad["end"], len(lad["elements"])), ("vbg", "vss", 123))
        self.assertEqual(lad["elements"][0]["k"], 2)
        self.assertEqual(lad["junctions"], ["vref_%d" % k for k in range(122, 0, -1)])
        self.assertTrue(all(e["k"] == 1 for e in lad["elements"][1:]))
        for name, cell in (("bandgap_shape.spice", "bandgap"), ("bandgap_pack_lb.spice", "bandgap_lb"), ("bandgap_site_r1.spice", "bandgap_lb")):
            _p, devs, _ = cl.read_subckt(HERE / name, cell)
            self.assertEqual(cl.find_ladders(devs, "vss"), [], name)

    def test_ladder_parallel_forms(self):
        unit = "ppolyf_u_1k r_length=10u r_width=1u s=1"
        for rl0 in (["XRL0 vbg t_11 vss %s m=2" % unit], ["XRL0 vbg t_11 vss %s par=2" % unit],
                    ["XRL0a vbg t_11 vss %s" % unit, "XRL0b t_11 vbg vss %s" % unit]):
            pins, devices, _ = self.read_text(self.ladder_netlist(rl0), "lad")
            (lad,) = cl.find_ladders(devices, "vss")
            self.assertEqual((lad["start"], lad["end"], len(lad["elements"]), lad["elements"][0]["k"]), ("vbg", "vss", 12, 2), rl0)
        # a different unit breaks the chain into pieces too short to be a ladder
        pins, devices, _ = self.read_text(self.ladder_netlist(["XRL0 vbg t_11 vss %s m=2" % unit]).replace(
            "XRL6 t_6 t_5 vss ppolyf_u_1k r_length=10u", "XRL6 t_6 t_5 vss ppolyf_u_1k r_length=12u"), "lad")
        self.assertEqual(cl.find_ladders(devices, "vss"), [])

    @staticmethod
    def metal1_groups(rects):
        """Union of touching metal1 rectangles: a group id per rectangle."""
        parent = list(range(len(rects)))

        def find(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i
        for i, a in enumerate(rects):
            for j in range(i):
                b = rects[j]
                ox = min(a[2], b[2]) - max(a[0], b[0])
                oy = min(a[3], b[3]) - max(a[1], b[1])
                if ox >= 0 and oy >= 0 and (ox > 0 or oy > 0):
                    parent[find(i)] = find(j)
        return [find(i) for i in range(len(rects))]

    def check_ladder_geometry(self, lad, bands, pins, outside, flip):
        cell = cl.Cell()
        lb = cl.LadderBlock(lad, bands, outside, pins)
        terms = lb.draw(cell, 0, 0, flip)
        # the riser pads the router adds at each terminal
        for _net, x, y in terms:
            cell.paint("metal1", x - cl.PAD, y - cl.PAD, x + cl.PAD, y + cl.PAD)
        m1 = [r[1:] for r in cell.rects if r[0] == "metal1"]
        group = self.metal1_groups(m1)

        def at(x, y):
            g = {group[i] for i, r in enumerate(m1) if r[0] <= x <= r[2] and r[1] <= y <= r[3]}
            self.assertEqual(len(g), 1, (x, y))
            return g.pop()
        y = (lambda v: -v) if flip else (lambda v: v)
        side_group = []
        for h in lb.heads:
            cx = h["x"] + lb.w // 2
            side_group.append(dict(top=at(cx, y(sum(h["top"]) // 2)), bot=at(cx, y(sum(h["bot"]) // 2)), element=h["element"]))
        net_group = {}
        pads = {n: [] for n in lb.external}
        for net, x, yy in terms:
            pads[net].append(at(x, yy))
        self.assertTrue(all(len(v) == 1 for v in pads.values()), pads)
        net_group[lad["start"]] = pads[lad["start"]][0]
        for i, e in enumerate(lad["elements"]):
            hs = [g for g in side_group if g["element"] == i]
            self.assertEqual(len(hs), e["k"])
            for side in ("top", "bot"):
                self.assertEqual(len({g[side] for g in hs}), 1, (i, side))
            ends = {hs[0]["top"], hs[0]["bot"]}
            self.assertEqual(len(ends), 2, "element %d shorted" % i)
            self.assertIn(net_group[e["a"]], ends, "element %d does not start on %s" % (i, e["a"]))
            net_group[e["b"]] = (ends - {net_group[e["a"]]}).pop()
        self.assertEqual(len(set(net_group.values())), len(net_group), "two ladder nets share metal1")
        for n in lb.external:
            self.assertEqual(pads[n][0], net_group[n], n)
        labels = [l for l in cell.labels if l[1] == "metal1"]
        for text, _layer, x1, y1, x2, y2, port in labels:
            self.assertEqual(at((x1 + x2) // 2, (y1 + y2) // 2), net_group[text], text)
            self.assertEqual(port, pins.index(text) + 1)
        expect = [j for j in lad["junctions"] if j in pins and j not in lb.external]
        self.assertEqual(sorted(l[0] for l in labels), sorted(expect))
        xs = sorted(x for _n, x, _y in terms)
        self.assertTrue(all(b - a >= 800 for a, b in zip(xs, xs[1:])), xs)
        return lb

    def test_ladder_geometry_straps_labels(self):
        unit = "ppolyf_u_1k r_length=10u r_width=1u s=1"
        pins, devices, _ = self.read_text(self.ladder_netlist(["XRL0 vbg t_11 vss %s m=2" % unit]), "lad")
        (lad,) = cl.find_ladders(devices, "vss")
        for bands in (1, 2, 3, 4, 5, 7):
            for flip in (False, True):
                lb = self.check_ladder_geometry(lad, bands, pins, {"vbg", "vss", "t_5", "o", "vdd"}, flip)
                self.assertTrue(all(len(b) % 2 for b in lb.band_els[:-1]), lb.band_els)
        pins, devices, _ = cl.read_subckt(HERE / "bgcore_shape.spice", "bandgap_lb")
        (lad,) = cl.find_ladders(devices, "vss")
        outside = {n for d in devices if not d["name"].startswith("XRL") for n in d["nets"]}
        for bands in (1, 2, 6):
            lb = self.check_ladder_geometry(lad, bands, pins, outside, False)
            self.assertEqual(lb.external, ["vbg", "vref_100", "vss"])
            self.assertEqual(len(lb.labelled), 119)

    def test_bgcore_floorplan_and_pins(self):
        pins, devices, _ = cl.read_subckt(HERE / "bgcore_shape.spice", "bandgap_lb")
        cell, facts = cl.build(pins, devices)
        w, h = facts["floorplan"]["estimateUm"]
        self.assertLess(max(w, h) / min(w, h), 1.6)
        self.assertLess(max(w, h), 260)
        ports = sorted(l[6] for l in cell.labels if l[6] is not None)
        self.assertEqual(ports, list(range(1, len(pins) + 1)))
        self.assertEqual(sorted({l[0] for l in cell.labels if l[6] is not None}), sorted(pins))
        self.assertFalse(any(n.startswith("vref_") and n != "vref_100" for t in facts["tracks"] for n in t))
        (lf,) = facts["ladders"]
        self.assertEqual((lf["units"], lf["labelledPins"]), (124, 119))

    def test_references_expand_parallel_units(self):
        with tempfile.TemporaryDirectory() as t:
            ref = Path(t) / "lad_ref.spice"
            unit = "ppolyf_u_1k r_length=10u r_width=1u s=1"
            ref.write_text(self.ladder_netlist(["XRL0 vbg t_11 vss %s m=2" % unit]))
            cl.lvs_reference(ref, "lad", Path(t) / "n.spice")
            n = (Path(t) / "n.spice").read_text()
            self.assertIn("XRL0_1 vbg t_11 vss ppolyf_u_1k", n)
            self.assertIn("XRL0_2 vbg t_11 vss ppolyf_u_1k", n)
            self.assertNotIn("m=2", n)
            cl.klayout_reference(ref, "lad", Path(t) / "k.spice")
            k = (Path(t) / "k.spice").read_text()
            self.assertEqual(len([l for l in k.splitlines() if l.startswith("RRL0_")]), 2)
            self.assertEqual(len([l for l in k.splitlines() if l.startswith("R")]), 13)

    def test_ports_continuation_lines(self):
        with tempfile.TemporaryDirectory() as t:
            p = Path(t) / "x.spice"
            p.write_text(".subckt c vdd vss\n+ a b VSUBS\nC0 a VSUBS 1f\n.ends\n")
            ok, notes = cl.check_ports(p, "c", ["vdd", "vss", "a", "b"], "vss")
            self.assertTrue(ok, notes)
            ok, _ = cl.check_ports(p, "c", ["vdd", "vss", "a", "b"], "vss")
            self.assertTrue(ok)
            p.write_text(".subckt c vdd vss\n+ a\n.ends\n")
            self.assertFalse(cl.check_ports(p, "c", ["vdd", "vss", "a", "b"], "vss")[0])

    def test_lvsdb_pin_names(self):
        db = """#%lvsdb-klayout
J(
 W(c)
 X(c
  N(1 I(vdd)
   R(l1 (0 0) (1 1))
  )
  N(2 I(t_1)
  )
  N(3 I(t_2)
  )
 )
)
H(
 X(C
  N(1 I(VDD))
  N(2 I(T_1))
  N(3 I(T_2))
  P(1 I(VDD))
  P(2 I(T_1))
  P(3 I(T_2))
 )
)
Z(
 X(c C 1
  Z(
   N(1 1 1)
   N(A 1)
   N(B 1)
  )
 )
)
"""
        with tempfile.TemporaryDirectory() as t:
            p = Path(t) / "c.lvsdb"
            p.write_text(db.replace("A", "2 2").replace("B", "3 3"))
            self.assertEqual(cl.lvsdb_pins(p, "c"), dict(total=3, matched=3, wrong=[]))
            p.write_text(db.replace("A", "3 2").replace("B", "2 3"))
            self.assertEqual(cl.lvsdb_pins(p, "c")["wrong"], ["t_1", "t_2"])


if __name__ == "__main__":
    unittest.main()
