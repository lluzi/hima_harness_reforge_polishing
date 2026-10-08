"""Insight rules: the shape check, the page builder and the delivery's optional insight block."""
import base64
import contextlib
import copy
import hashlib
import io
import json
import os
import re
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from libinsight_analysis import common, delivery, insight_page  # noqa: E402
import insight_synthetic  # noqa: E402
import synthetic  # noqa: E402

TEMPLATE = os.path.join(synthetic.PACK, "page", "insight-page.html")


def template():
    with open(TEMPLATE, encoding="utf-8") as stream:
        return stream.read()


def rule(kind):
    return {"vmin": insight_synthetic.vmin_rule, "gaps": insight_synthetic.gaps_rule,
            "path": insight_synthetic.path_rule, "spike": insight_synthetic.spike_rule}[kind]()


class CheckRule(unittest.TestCase):
    def assertRejected(self, value, fragment):
        found = insight_page.check_rule(value)
        self.assertTrue(any(fragment in line for line in found), "%r not in %r" % (fragment, found))

    def mutated(self, kind, change):
        value = rule(kind)
        change(value)
        return value

    def test_the_four_synthetic_rules_pass(self):
        rules = insight_synthetic.rules()
        self.assertEqual([r["kind"] for r in rules], ["vmin", "gaps", "path", "spike"])
        for value in rules:
            self.assertEqual(insight_page.check_rule(value), [], value["id"])
        vmin = rules[0]
        self.assertIsNotNone(vmin["items"][0]["brief"]["where"])
        self.assertIsNone(vmin["items"][1]["brief"]["where"])
        stages = [row for path in rules[2]["paths"] for row in path["rows"]]
        self.assertEqual((len(rules[2]["paths"]), len(stages)), (3, 24))
        self.assertTrue(all(4 <= len(row["eq"]) <= 9 for row in stages))
        self.assertEqual(sorted(set(row["op"]["from"] for row in stages)), ["fo4", "report"])

    def test_no_real_library_names_in_the_synthetic_rules(self):
        text = json.dumps(insight_synthetic.rules())
        for forbidden in ("tcbn", "TSMC", "BWP", "aes_"):
            self.assertNotIn(forbidden, text)

    def test_fields_kind_and_id(self):
        self.assertEqual(insight_page.check_rule([]), ["the insight rule must be one JSON object"])
        self.assertRejected(self.mutated("vmin", lambda r: r.update(kind="bars")), "kind must be one of")
        self.assertRejected(self.mutated("vmin", lambda r: r.pop("impact")), "missing ['impact']")
        self.assertRejected(self.mutated("vmin", lambda r: r.update(html="<b>")), "unexpected ['html']")
        self.assertRejected(self.mutated("gaps", lambda r: r.pop("matrix")), "missing ['matrix']")
        self.assertRejected(self.mutated("vmin", lambda r: r.update(id="Vmin-Rule")), "id \"Vmin-Rule\" must match")
        self.assertRejected(self.mutated("vmin", lambda r: r.update(id="ab")), "must match")

    def test_lengths_and_counts(self):
        self.assertRejected(self.mutated("vmin", lambda r: r.update(title="x" * 81)), "title must be a non-empty")
        self.assertRejected(self.mutated("vmin", lambda r: r.update(summary="")), "summary must be a non-empty")
        self.assertRejected(self.mutated("vmin", lambda r: r.update(result="r" * 121)), "result must")
        self.assertRejected(self.mutated("vmin", lambda r: r.update(hint="h" * 301)), "hint must")
        self.assertRejected(self.mutated("vmin", lambda r: r.update(facts=[["a", 1]] * 13)), "facts has 13 entries")
        self.assertRejected(self.mutated("vmin", lambda r: r.update(impact=[])), "impact has 0 entries")
        self.assertRejected(self.mutated("vmin", lambda r: r.update(todo=r["todo"] * 2)), "todo has 6 entries")
        self.assertRejected(self.mutated("spike", lambda r: r.update(items=r["items"] * 51)), "items has 408 entries")
        self.assertRejected(self.mutated("vmin", lambda r: r["items"][0].update(focus="f" * 401)),
                            "items[0].focus must")
        self.assertRejected(self.mutated("vmin", lambda r: r["items"][0].update(label="")), "items[0].label must")

    def test_score(self):
        self.assertRejected(self.mutated("vmin", lambda r: r["score"].update(dimension="speed")),
                            "score.dimension must be one of quality, ppa, robustness, none")
        self.assertRejected(self.mutated("vmin", lambda r: r["score"].update(affected=2000)),
                            "score.affected (2000) must not exceed score.checked (1200)")
        self.assertRejected(self.mutated("vmin", lambda r: r["score"].update(weight=31)), "score.weight must be at most 30")
        self.assertRejected(self.mutated("vmin", lambda r: r["score"].update(checked=True)), "score.checked must be a whole")
        self.assertRejected(self.mutated("vmin", lambda r: r["score"].update(extra=1)), "score must be exactly")

    def test_numbers_are_finite_and_never_booleans(self):
        self.assertRejected(self.mutated("vmin", lambda r: r.update(hi=float("nan"))), "hi must be a finite number")
        self.assertRejected(self.mutated("vmin", lambda r: r["rows"][0]["b"].update(p50=float("inf"))),
                            "rule.rows[0].b.p50 must be a finite number")
        self.assertRejected(self.mutated("vmin", lambda r: r["items"][0].update(x=True)), "items[0].x must be a finite number")
        self.assertRejected(self.mutated("vmin", lambda r: r.update(hi=0.6)), "hi (0.6 V) must be above lo (0.7 V)")

    def test_todo_who(self):
        self.assertRejected(self.mutated("vmin", lambda r: r["todo"][0].update(who="manager")),
                            "todo[0].who must be one of chip_designer, cell_designer, library_provider, note")

    def test_brief(self):
        self.assertRejected(self.mutated("vmin", lambda r: r["items"][0]["brief"].pop("where")),
                            "items[0].brief fields: missing ['where']")
        self.assertRejected(self.mutated("vmin", lambda r: r["items"][0]["brief"].update(levers=[])),
                            "items[0].brief.levers has 0 entries")
        self.assertRejected(self.mutated("vmin", lambda r: r["items"][0]["brief"].update(now="16")),
                            "items[0].brief.now must be a finite number")
        self.assertRejected(self.mutated("vmin", lambda r: r["items"][0]["brief"].update(where=7)),
                            "items[0].brief.where must be a non-empty string")

    def test_vmin_items_follow_temps_and_fans(self):
        self.assertRejected(self.mutated("vmin", lambda r: r["items"][0].update(t="25")), "items[0].t \"25\" must be one of temps")
        self.assertRejected(self.mutated("vmin", lambda r: r["items"][0]["fan"]["-20"].append(1.5)),
                            "has 4 entries; it must have 3")

    def test_gaps_ladder(self):
        self.assertRejected(self.mutated("gaps", lambda r: r["items"][0].update(i=40)), "items[0].i must index")
        self.assertRejected(self.mutated("gaps", lambda r: r["matrix"]["counts"].pop()), "matrix.counts must hold one row")
        self.assertRejected(self.mutated("gaps", lambda r: r["items"][0]["cells"][0].update(drive=0)),
                            "drive must be above 0")

    def test_path_stages(self):
        self.assertRejected(self.mutated("path", lambda r: r["paths"][0]["rows"][0]["op"].update({"from": "guess"})),
                            "paths[0].rows[0].op.from must be report or fo4")
        self.assertRejected(self.mutated("path", lambda r: r["paths"][0]["rows"][0].update(eq=[
            e for e in r["paths"][0]["rows"][0]["eq"] if e["name"] != r["paths"][0]["rows"][0]["cell"]])),
            "paths[0].rows[0].eq must include the cell in use")
        self.assertRejected(self.mutated("path", lambda r: r["paths"][0]["rows"][0].pop("op")),
                            "paths[0].rows[0] is missing op")
        # A stage whose cell is not in the facts given is drawn as not judged, not refused.
        not_judged = self.mutated("path", lambda r: r["paths"][0]["rows"][0].update(
            op={"slew": None, "load": None, "from": "fo4"}, best=None, eq=[], nfast=0))
        self.assertEqual(insight_page.check_rule(not_judged), [])
        # Cell names reach .tcl and .sdc lines: a name that is not a plain identifier is refused.
        self.assertRejected(self.mutated("path", lambda r: r["paths"][0]["rows"][0]["eq"][0].update(
            name="X] ; file delete -force ~ ; #")), "must be a plain cell name")
        self.assertRejected(self.mutated("path", lambda r: r["paths"][0]["rows"][0].update(cls="NAND2\nset_dont_use *")),
                            "without control characters")
        self.assertRejected(self.mutated("path", lambda r: r.update(paths=[dict(r["paths"][0], rows=r["paths"][0]["rows"] * 12)] * 5)),
                            "hold 480 stages")

    def test_spike_table(self):
        self.assertRejected(self.mutated("spike", lambda r: r["items"][0].update(pos=[9, 0])), "items[0].pos must be [i, j]")
        self.assertRejected(self.mutated("spike", lambda r: r["items"][0]["vals"][0].pop()), "items[0].vals[0] has 6 entries")
        self.assertRejected(self.mutated("spike", lambda r: r["items"][0]["slice"].update(k=99)),
                            "items[0].slice.k must index")


class BuildPage(unittest.TestCase):
    def test_build_fills_the_one_data_element_and_keeps_the_script(self):
        text = template()
        html = insight_page.build_page(text, insight_synthetic.rules(), 2)
        self.assertNotIn(insight_page.MARKER, html)
        found = re.search(r'<script type="application/json" id="insight-data">(.*?)</script>', html, re.S)
        data = json.loads(found.group(1))
        self.assertEqual(data["selected"], 2)
        self.assertEqual([r["id"] for r in data["rules"]], [r["id"] for r in insight_synthetic.rules()])
        self.assertEqual(insight_page.SCRIPT.findall(html), insight_page.SCRIPT.findall(text))

    def test_hostile_strings_stay_inert_inside_the_json(self):
        value = rule("vmin")
        value["summary"] = "</script><script>alert(1)</script> & \u2028\u2029"
        html = insight_page.build_page(template(), [value], 0)
        found = re.search(r'<script type="application/json" id="insight-data">(.*?)</script>', html, re.S)
        payload = found.group(1)
        for raw in ("<", ">", "&", "\u2028", "\u2029"):
            self.assertNotIn(raw, payload)
        self.assertIn("\\u003c/script\\u003e\\u003cscript\\u003ealert(1)", payload)
        self.assertEqual(json.loads(payload)["rules"][0]["summary"], value["summary"])
        self.assertEqual(html.count("alert(1)"), 1)
        self.assertEqual(len(re.findall(r"<script\b", html)), 2, "still one data element and one script")

    def test_refusals(self):
        text = template()
        with self.assertRaisesRegex(ValueError, "exactly one /\\*INSIGHT-DATA\\*/ marker"):
            insight_page.build_page(text.replace(insight_page.MARKER, ""), insight_synthetic.rules())
        with self.assertRaisesRegex(ValueError, "exactly one /\\*INSIGHT-DATA\\*/ marker"):
            insight_page.build_page(text + insight_page.MARKER, insight_synthetic.rules())
        with self.assertRaisesRegex(ValueError, "exactly one executable <script>"):
            insight_page.build_page(text + "<script>x()</script>", insight_synthetic.rules())
        bad = rule("vmin")
        bad["score"]["affected"] = 5000
        with self.assertRaisesRegex(ValueError, "rule 0: score.affected"):
            insight_page.build_page(text, [bad])
        with self.assertRaisesRegex(ValueError, "selected must index"):
            insight_page.build_page(text, insight_synthetic.rules(), 4)
        with self.assertRaisesRegex(ValueError, "repeats an earlier rule"):
            insight_page.build_page(text, [rule("vmin"), rule("vmin")])
        with self.assertRaisesRegex(ValueError, "at least one rule"):
            insight_page.build_page(text, [])

    def test_script_sha256_is_the_csp_source_of_the_one_script(self):
        text = template()
        scripts = re.findall(r"<script>([\s\S]*?)</script>", text)
        self.assertEqual(len(scripts), 1)
        expected = "sha256-" + base64.b64encode(hashlib.sha256(scripts[0].encode("utf-8")).digest()).decode("ascii")
        self.assertEqual(insight_page.template_script_sha256(text), expected)
        html = insight_page.build_page(text, insight_synthetic.rules())
        self.assertEqual(insight_page.template_script_sha256(html), expected, "the same on every page")

    def test_template_script_is_csp_clean(self):
        script = insight_page.SCRIPT.findall(template())[0]
        for banned in ("eval(", "new Function", "fetch(", "XMLHttpRequest", "import(", "onclick=\"", "on" + "load=\"",
                       "http://", "https://", "/*INSIGHT-DATA*/"):
            self.assertNotIn(banned, script)
        self.assertNotRegex(template(), r"<(link|img|iframe)\b|src=")

    def test_main_writes_a_page(self):
        root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, root)
        paths = []
        for index, value in enumerate(insight_synthetic.rules()):
            path = os.path.join(root, "rule%d.json" % index)
            common.write_json(path, value)
            paths.append(path)
        out = os.path.join(root, "page", "insight.html")
        quiet = io.StringIO()
        with contextlib.redirect_stdout(quiet), contextlib.redirect_stderr(quiet):
            self.assertEqual(insight_page.main(["build-page", out] + paths + ["--selected", "1"]), 0)
            self.assertEqual(insight_page.main([out]), 2)
        self.assertIn('"scriptSha256": "sha256-', quiet.getvalue())
        with open(out, encoding="utf-8") as stream:
            self.assertIn('"selected":1}', stream.read())


class DeliveryInsight(unittest.TestCase):
    """The optional insight block of a hima-libinsight-analysis/1 delivery."""

    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root)
        os.makedirs(os.path.join(self.root, "analysis"))
        shutil.copy(os.path.join(synthetic.FIXTURE, "analysis", "inv_drive_delay.py"), os.path.join(self.root, "analysis"))
        with open(os.path.join(synthetic.FIXTURE, "analysis-result.json"), encoding="utf-8") as stream:
            self.doc = json.load(stream)
        with open(os.path.join(synthetic.FIXTURE, "prepared-request.json"), encoding="utf-8") as stream:
            self.prepared = json.load(stream)
        self.hashes = dict((s["path"], s["sha256"]) for s in self.prepared["sources"])

    def problems(self, doc):
        return delivery.problems(doc, self.root, self.prepared, 1000, lambda path: self.hashes[path])

    def test_valid_insight_is_accepted(self):
        doc = copy.deepcopy(self.doc)
        doc["insight"] = rule("gaps")
        self.assertEqual(self.problems(doc), [])

    def test_invalid_insight_returns_its_problems(self):
        doc = copy.deepcopy(self.doc)
        doc["insight"] = rule("path")
        doc["insight"]["paths"][0]["rows"][0]["op"]["from"] = "guess"
        doc["insight"]["todo"][0]["who"] = "boss"
        found = self.problems(doc)
        self.assertTrue(any(line.startswith("insight: paths[0].rows[0].op.from must be report or fo4") for line in found), found)
        self.assertTrue(any(line.startswith("insight: todo[0].who must be one of") for line in found), found)

    def test_without_insight_nothing_changes(self):
        self.assertEqual(self.problems(copy.deepcopy(self.doc)), [])
        doc = copy.deepcopy(self.doc)
        doc["extra"] = 1
        self.assertTrue(any("unexpected ['extra']" in line for line in self.problems(doc)))


if __name__ == "__main__":
    unittest.main()
