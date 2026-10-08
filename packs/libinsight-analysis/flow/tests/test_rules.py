"""The four example insight rules on synthetic facts with planted findings, and their shared helpers."""
import gzip
import json
import math
import os
import re
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from libinsight_analysis import insight_page  # noqa: E402
from libinsight_analysis.rules import facts as F  # noqa: E402
from libinsight_analysis.rules import netlists  # noqa: E402
from libinsight_analysis.rules import (critical_path_faster_cells, size_coverage_gaps,  # noqa: E402
                                       table_spikes_kinks, vmin_bottleneck)
import rules_synthetic as R  # noqa: E402

WHO = ("chip_designer", "cell_designer", "library_provider", "note")
KIND_FIELDS = {
    "vmin": ("hi", "lo", "temps", "watch", "rows", "fan", "clsbox"),
    "gaps": ("matrix",),
    "path": ("design", "paths"),
    "spike": ("by_variant", "by_kind", "by_family")}
ITEM_FIELDS = {
    "vmin": ("name", "label", "v", "t", "x", "cls", "extra", "fan", "focus"),
    "gaps": ("label", "cls", "v", "ratio", "vts", "i", "cells", "lo", "hi", "miss", "pen_area", "pen_leak", "weak",
             "focus"),
    "path": ("label", "focus"),
    "spike": ("name", "label", "v", "ratio", "corner", "corners", "kind", "arc", "when", "pos", "label_pos", "xname",
              "axes", "vals", "res", "tol", "slice", "observed", "expected", "tolx", "verdict", "focus")}
STAGE_FIELDS = ("inst", "cell", "s", "arc", "d", "cls", "op", "nfast", "best", "eq", "focus")
BRIEF_FIELDS = ("cell", "arc", "symptom", "now", "target", "unit", "compare", "where", "levers", "cost", "check")
INTERNAL = re.compile(r"\bE\d{1,2}\b|\bNone\b|\bNaN\b|\bnan\b|lib-insight|QuaLib|\bsig\b|\bjson\b", re.I)


class Shape(unittest.TestCase):
    """Every field the shape doc requires, with its limits, and plain words in every text field."""

    def assertPlain(self, text, where):
        self.assertIsInstance(text, str, where)
        self.assertIsNone(INTERNAL.search(text), "%s holds an internal word: %s" % (where, text))

    def check(self, rule):
        json.dumps(rule, allow_nan=False)
        self.assertEqual(insight_page.check_rule(rule), [])
        self.assertRegex(rule["id"], r"^[a-z][a-z0-9_]{2,47}$")
        kind = rule["kind"]
        self.assertIn(kind, KIND_FIELDS)
        for key, limit in (("title", 80), ("summary", 200), ("result", 120), ("rule", 400), ("library", 160)):
            self.assertLessEqual(len(rule[key]), limit, key)
            self.assertPlain(rule[key], key)
        self.assertLessEqual(len(rule["facts"]), 12)
        for label, value in rule["facts"]:
            self.assertPlain(label, "facts label")
            self.assertTrue(isinstance(value, (str, int, float)) and not isinstance(value, bool), label)
        score = rule["score"]
        self.assertIn(score["dimension"], ("quality", "ppa", "robustness", "none"))
        self.assertIsInstance(score["affected"], int)
        self.assertIsInstance(score["checked"], int)
        self.assertTrue(0 <= score["affected"] <= score["checked"])
        self.assertTrue(0 <= score["weight"] <= 30)
        self.assertTrue(1 <= len(rule["impact"]) <= 5)
        for label, text in rule["impact"]:
            self.assertPlain(label, "impact")
            self.assertPlain(text, "impact")
        self.assertTrue(1 <= len(rule["todo"]) <= 5)
        for step in rule["todo"]:
            self.assertIn(step["who"], WHO)
            self.assertPlain(step["text"], "todo")
        if "hint" in rule:
            self.assertLessEqual(len(rule["hint"]), 300)
            self.assertPlain(rule["hint"], "hint")
        for key in KIND_FIELDS[kind]:
            self.assertIn(key, rule)
        self.assertLessEqual(len(rule["items"]), 400)
        for item in rule["items"]:
            for key in ITEM_FIELDS[kind]:
                self.assertIn(key, item, "%s item lacks %s" % (kind, key))
            self.assertLessEqual(len(item["label"]), 60)
            self.assertLessEqual(len(item["focus"]), 400)
            self.assertPlain(item["focus"], "focus")
            if "brief" in item:
                for key in BRIEF_FIELDS:
                    self.assertIn(key, item["brief"])
                b = item["brief"]
                self.assertTrue(1 <= len(b["levers"]) <= 4)
                for text in [b["symptom"], b["compare"], b["check"]] + [x["change"] for x in b["levers"]]:
                    self.assertPlain(text, "brief")
        if kind == "path":
            self.assertLessEqual(len(rule["paths"]), 12)
            for p in rule["paths"]:
                for key in ("slack", "start", "end", "total", "gain", "rows"):
                    self.assertIn(key, p)
                for stage in p["rows"]:
                    for key in STAGE_FIELDS:
                        self.assertIn(key, stage)
                    self.assertIn(stage["op"]["from"], ("report", "fo4"))
                    self.assertPlain(stage["focus"], "stage focus")
            for key in ("name", "lib", "flow", "corner", "fail", "wns"):
                self.assertIn(key, rule["design"])


class Base(Shape):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir)

    def path(self, name):
        return os.path.join(self.dir, name)


class Helpers(unittest.TestCase):
    def test_lookup_interpolates_at_real_axis_values(self):
        g = {"s": [1.0, 2.0, 6.0], "l": [10.0, 30.0], "v": [[1.0, 3.0], [2.0, 4.0], [6.0, 8.0]]}
        self.assertAlmostEqual(F.lookup(g, 4.0, 20.0)[0], 5.0)
        value, inside = F.lookup(g, 8.0, 10.0)
        self.assertAlmostEqual(value, 8.0)
        self.assertFalse(inside)

    def test_chord_uses_real_axis_values(self):
        # a straight line on a non-uniform axis has no roughness; an index-space chord would see one
        self.assertEqual(table_spikes_kinks.chord([1.0, 2.0, 4.0, 8.0], [1.0, 2.0, 4.0, 8.0]), [None, 0.0, 0.0, None])

    def test_naming_profiles(self):
        generic = F.Naming("generic").parse("NAND2X1P5_LVT")
        self.assertEqual((generic["stem"], generic["drive"], generic["vt"]), ("NAND2", 1.5, "LVT"))
        self.assertEqual(F.Naming("generic").parse("DFFRX1")["stem"], "DFFR")
        dnum = F.Naming("dnum")
        self.assertEqual((dnum.parse("NAND3D0P5QQHVT")["drive"], dnum.parse("NAND3D0P5QQHVT")["vt"]), (0.5, "HVT"))
        self.assertEqual(dnum.parse("NAND3D0P5QQHVT")["label"], "NAND3D0P5 HVT")
        self.assertEqual(dnum.parse("INVD4QQ")["drive"], 4.0)
        self.assertEqual(dnum.variant("7T-HVT"), ("7T", "HVT"))

    def test_signature_groups_flops_by_function_not_name(self):
        sig = {}
        for cell in R.path_cells("SVT"):
            sig[cell["name"]] = F.signature(cell, F.pins_of(cell, 1000.0))
        self.assertEqual(sig["DFFRX1"], sig["DFFRX4"])
        self.assertEqual(sig["DFFRX1"], sig["DFFQX1"])
        self.assertNotEqual(sig["DFFRX1"], sig["DFFRX2"])
        self.assertNotEqual(sig["NAND2X1"], sig["INVX1"])

    def test_class_labels(self):
        def label(function, inputs):
            cell = R.comb("X", inputs, function, 1.0, 0.01)
            pins = F.pins_of(cell, 1000.0)
            return F.class_label(cell, pins, F.signature(cell, pins))
        self.assertEqual(label("!(A&B)", ["A", "B"]), "NAND2")
        self.assertEqual(label("(A1 A2 + B)'", ["A1", "A2", "B"]), "AOI21")
        self.assertEqual(label("(S&B)|(!S&A)", ["A", "B", "S"]), "MUX2")
        self.assertEqual(label("A^B", ["A", "B"]), "XOR2")
        flop = R.flop("DFFRX1", 1.0, clear="!RN")
        self.assertEqual(F.class_label(flop, F.pins_of(flop, 1000.0), F.signature(flop, F.pins_of(flop, 1000.0))),
                         "Flop + reset")

    def test_spice_stack_position_counts_from_the_output(self):
        base = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, base)
        spice = netlists.read_spice([R.write_text(os.path.join(base, "c.spi"), R.NOR3_SPICE)], ["NOR3X2"])
        devs = dict((d["type"], d) for d in netlists.input_devices(spice["NOR3X2"], "A", "Y"))
        self.assertEqual((devs["p"]["position"], devs["p"]["stack"], devs["p"]["fingers"]), (3, 3, 2))
        self.assertEqual((devs["n"]["position"], devs["n"]["fingers"]), (1, 2))
        self.assertAlmostEqual(devs["n"]["w"], 0.4)


class Vmin(Base):
    def corpus(self):
        return R.write_vmin_corpus(self.dir)

    def test_flags_cells_that_slow_more_than_the_inverter(self):
        rule = vmin_bottleneck.run(self.corpus(), hi=0.81, lo=0.72)
        self.check(rule)
        self.assertEqual(rule["score"], {"dimension": "robustness", "affected": 2, "checked": 7, "weight": 6})
        names = [i["name"] for i in rule["items"]]
        self.assertEqual(names, ["NOR3X1", "NAND2X1"])
        worst = rule["items"][0]
        self.assertAlmostEqual(worst["x"], 12.0, places=2)
        self.assertEqual(worst["t"], "-40")
        self.assertAlmostEqual(worst["extra"]["125"], 4.0, places=2)
        nand = rule["items"][1]
        self.assertEqual((nand["t"], round(nand["x"], 2)), ("125", 6.0))
        self.assertEqual(rule["temps"], ["-40", "125"])
        fan = rule["fan"]["9T-SVT|-40"]
        self.assertEqual(fan["volts"], [0.81, 0.72])
        self.assertAlmostEqual(fan["inv"][1], 1.3, places=4)
        self.assertAlmostEqual(worst["fan"]["-40"][1], 1.3 * 1.12, places=3)
        self.assertEqual(rule["rows"][0]["n"], 2)
        self.assertIn("9T-SVT|-40|NOR3", rule["clsbox"])
        brief = worst["brief"]
        self.assertEqual(brief["arc"], "A→Y rise")
        self.assertIsNone(brief["where"])
        self.assertEqual(brief["target"], 5.0)
        self.assertTrue(brief["cost"][0][1].startswith("+33%"))

    def test_brief_locates_the_arc_in_the_cell_netlist(self):
        spice = R.write_text(self.path("cells.spi"), R.NOR3_SPICE)
        rule = vmin_bottleneck.run(self.corpus(), hi=0.81, lo=0.72, netlist=[spice])
        self.check(rule)
        where = rule["items"][0]["brief"]["where"]
        self.assertIn("p-channel MP1 (W 0.4 µm, L 0.03 µm, 1 finger) 3rd from the output in a 3-high stack", where)
        self.assertIn("Sibling sizes: NOR3X2", where)
        levers = [x["change"] for x in rule["items"][0]["brief"]["levers"]]
        self.assertEqual(len(levers), 3)
        self.assertIn("3 high", levers[0])

    def test_cli_writes_the_rule(self):
        out = self.path("vmin.json")
        corpus = self.corpus()
        argv = ["--facts", "9T-SVT=%s" % os.path.join(self.dir, "vmin_*.json.gz"), "--hi", "0.81", "--lo", "0.72",
                "--temps=-40,125", "--out", out]
        self.assertEqual(vmin_bottleneck.main(argv), 0)
        with open(out) as stream:
            rule = json.load(stream)
        self.assertEqual(len(corpus), 4)
        self.assertEqual(rule["result"], "2 cells flagged · worst +12.0%")


class Gaps(Base):
    def corpus(self):
        return [("9T-SVT", R.write_facts(self.path("svt.json.gz"), R.gap_cells())),
                ("9T-LVT", R.write_facts(self.path("lvt.json.gz"), R.gap_cells("_LVT")))]

    def test_finds_the_missing_drive(self):
        rule = size_coverage_gaps.run(self.corpus())
        self.check(rule)
        self.assertEqual(rule["score"], {"dimension": "ppa", "affected": 2, "checked": 4, "weight": 4})
        self.assertEqual(len(rule["items"]), 1)                 # the same gap in both VTs is one item
        item = rule["items"][0]
        self.assertEqual((item["cls"], item["i"], item["vts"]), ("NAND2", 4, 2))
        self.assertAlmostEqual(item["ratio"], 2.0, places=3)
        self.assertEqual(item["lo"]["s"].split()[0], "NAND2X4")
        self.assertEqual(item["hi"]["s"].split()[0], "NAND2X8")
        self.assertAlmostEqual(item["miss"]["drive"], math.sqrt(32.0), places=2)
        self.assertEqual(rule["matrix"], {"tracks": ["9T"], "vts": ["SVT", "LVT"], "counts": [[1, 1]]})

    def test_fanout_loads_are_each_cells_own_input_capacitance(self):
        rule = size_coverage_gaps.run(self.corpus())
        # delay = 0.95 (p + R c) with R = 4 ns/pF / drive and input cap 1.5 fF x drive: at 4x and 16x its own
        # input capacitance every size of the ladder has the same delay (a library-wide load would not)
        for cell in rule["items"][0]["cells"]:
            self.assertAlmostEqual(cell["d4"], 0.95 * (0.009 + 4.0 * 4 * 0.0015) * 1000, places=2)
            self.assertAlmostEqual(cell["d16"], 0.95 * (0.009 + 4.0 * 16 * 0.0015) * 1000, places=2)


class Spikes(Base):
    def test_flags_the_planted_spike_only(self):
        rule = table_spikes_kinks.run([("9T-SVT", R.write_facts(self.path("s.json.gz"), R.spike_cells()))])
        self.check(rule)
        self.assertEqual(rule["score"], {"dimension": "quality", "affected": 1, "checked": 24, "weight": 6})
        item = rule["items"][0]
        self.assertEqual((item["name"], item["kind"], item["arc"], item["pos"]), ("NAND2X1", "cell_rise", "A→Y", [3, 3]))
        self.assertAlmostEqual(item["observed"] - item["expected"], 12.0, places=3)
        self.assertAlmostEqual(item["ratio"], 6.0, places=3)        # 12 ps over the 2 ps floor
        self.assertAlmostEqual(item["res"][3][3], 6.0, places=3)
        self.assertEqual(item["slice"]["k"], 3)
        self.assertEqual(rule["by_kind"], [["spike", 1]])
        self.assertEqual(item["axes"][0][:3], [4.0, 8.0, 16.0])      # ns -> ps


    def test_noise_floor_of_tables_on_the_same_grid(self):
        path = R.write_facts(self.path("n.json.gz"), R.noisy_cells())
        plain = table_spikes_kinks.run([("9T-SVT", path)], noise=False)
        floored = table_spikes_kinks.run([("9T-SVT", path)])
        self.check(floored)
        self.assertEqual(plain["score"]["affected"], 6)              # every wobble is beyond 2 ps
        self.assertLess(floored["score"]["affected"], plain["score"]["affected"])


class Path(Base):
    def setUp(self):
        Base.setUp(self)
        self.inputs = [("9T-SVT", R.write_facts(self.path("svt.json.gz"), R.path_cells("SVT"))),
                       ("9T-LVT", R.write_facts(self.path("lvt.json.gz"), R.path_cells("LVT")))]

    def stage(self, rule, inst):
        return next(r for r in rule["paths"][0]["rows"] if r["inst"] == inst)

    def test_judges_each_stage_at_the_reports_operating_point(self):
        rule = critical_path_faster_cells.run(self.inputs, R.write_report(self.path("r.gz"), with_op=True))
        self.check(rule)
        self.assertEqual((rule["design"]["fail"], rule["design"]["wns"]), (2, -20.0))
        self.assertEqual([r["inst"] for r in rule["paths"][0]["rows"]], ["r1", "U11", "U12", "u1/U13"])
        st = self.stage(rule, "U12")
        self.assertEqual(st["op"], {"slew": 20.0, "load": 30.0, "from": "report"})
        self.assertEqual(st["eq"][0]["name"], "NAND2X4_LVT")
        self.assertAlmostEqual(st["best"], (0.9 * 0.017 + 0.1 * 0.020 + 0.9 * 0.45 * 0.030) * 1000, places=2)
        self.assertEqual(st["nfast"], 3)
        self.assertEqual(rule["score"]["dimension"], "none")

    def test_falls_back_to_fanout_of_4_and_says_so(self):
        rule = critical_path_faster_cells.run(self.inputs, R.write_report(self.path("r.gz"), with_op=False))
        self.check(rule)
        st = self.stage(rule, "U12")
        self.assertEqual(st["op"]["from"], "fo4")
        self.assertAlmostEqual(st["op"]["load"], 6.0)                 # 4 x its own 1.5 fF input
        self.assertEqual(st["eq"][0]["name"], "NAND2X1_LVT")          # a different winner than at its real load

    def test_reads_the_load_from_the_netlist(self):
        rule = critical_path_faster_cells.run(self.inputs, R.write_report(self.path("r.gz"), with_op=False),
                                              netlist=R.write_text(self.path("top.v"), R.NETLIST))
        self.check(rule)
        st = self.stage(rule, "U12")
        self.assertEqual(st["op"]["from"], "report")
        self.assertAlmostEqual(st["op"]["load"], R.NETLIST_N5_LOAD, places=3)
        self.assertEqual(st["eq"][0]["name"], "NAND2X4_LVT")
        self.assertAlmostEqual(self.stage(rule, "u1/U13")["op"]["load"], 2.0, places=3)   # through the module port

    def test_flop_equivalents_share_the_function_not_the_name(self):
        rule = critical_path_faster_cells.run(self.inputs, R.write_report(self.path("r.gz"), with_op=True))
        names = set(e["name"] for e in self.stage(rule, "r1")["eq"])
        self.assertEqual(names, set(["DFFRX1", "DFFRX4", "DFFQX1", "DFFRX1_LVT"]))
        self.assertEqual(self.stage(rule, "r1")["cls"], "Flop + reset")

    def test_cli(self):
        out = self.path("path.json")
        argv = ["--report", R.write_report(self.path("r.gz")), "--facts", "9T-SVT=%s" % self.inputs[0][1],
                "--facts", "9T-LVT=%s" % self.inputs[1][1], "--out", out]
        self.assertEqual(critical_path_faster_cells.main(argv), 0)
        with open(out) as stream:
            self.assertEqual(json.load(stream)["kind"], "path")


class Inputs(Base):
    def test_refuses_a_failed_record(self):
        path = self.path("bad.json.gz")
        with gzip.open(path, "wt") as stream:
            json.dump({"schema": "lib-insight-facts/1", "status": "failed", "failure": "parse"}, stream)
        with self.assertRaises(F.RuleError):
            F.load_facts(path)
        with self.assertRaises(F.RuleError):
            F.parse_inputs(["no-label-here"])


if __name__ == "__main__":
    unittest.main()
