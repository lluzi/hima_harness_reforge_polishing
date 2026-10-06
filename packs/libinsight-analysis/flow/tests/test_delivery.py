"""Reader contract: the real linglong SAED14 delivery is accepted; every rejection is precise."""
import copy
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from libinsight_analysis import common, delivery  # noqa: E402
import synthetic  # noqa: E402

FIXTURE = synthetic.FIXTURE


def load(name):
    with open(os.path.join(FIXTURE, name), "rb") as stream:
        return json.loads(stream.read().decode("utf-8"))


class RealFixture(unittest.TestCase):
    """The delivery produced on linglong by knowledge/example-custom-analysis.md (2026-10-05)."""

    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root)
        os.makedirs(os.path.join(self.root, "analysis"))
        shutil.copy(os.path.join(FIXTURE, "analysis", "inv_drive_delay.py"), os.path.join(self.root, "analysis"))
        self.doc = load("analysis-result.json")
        self.prepared = load("prepared-request.json")
        self.hashes = dict((s["path"], s["sha256"]) for s in self.prepared["sources"])

    def current(self, path):
        if path not in self.hashes:
            raise common.LiaError("missing-input", "no such file in this test")
        return self.hashes[path]

    def problems(self, doc=None, size=1000, prepared=None):
        return delivery.problems(self.doc if doc is None else doc, self.root,
                                 self.prepared if prepared is None else prepared, size, self.current)

    def mutated(self, change):
        doc = copy.deepcopy(self.doc)
        change(doc)
        return self.problems(doc)

    def assertRejected(self, found, fragment):
        self.assertTrue(any(fragment in line for line in found), "%r not in %r" % (fragment, found))

    def test_real_delivery_is_accepted(self):
        with open(os.path.join(FIXTURE, "analysis-result.json"), "rb") as stream:
            size = len(stream.read())
        self.assertEqual(self.problems(size=size), [])
        self.assertEqual(delivery.measures(self.doc), {"plots": 5, "rows": 78, "datasets": 2})
        self.assertEqual(self.doc["sources"][0]["libertySha256"],
                         "49962e1b61d08eae063633ba32ab76fc002c405d40e391e181e92ff445442571")
        self.assertEqual(len(self.doc["datasets"]["inv_drive"]["rows"]), 29)

    def test_fixture_script_is_the_delivered_main(self):
        with open(os.path.join(FIXTURE, "analysis", "inv_drive_delay.py"), "rb") as stream:
            data = stream.read()
        self.assertEqual(self.doc["code"]["main"]["text"].encode("utf-8"), data)
        candidate = load("resident-delivery.json")
        self.assertEqual(sorted(a["kind"] for a in candidate["artifacts"]), ["result", "support"])

    def test_wrong_schema_and_keys(self):
        self.assertRejected(self.mutated(lambda d: d.update(schema="hima-libinsight-analysis/2")), "schema must be")
        self.assertRejected(self.mutated(lambda d: d.update(extra=1)), "unexpected ['extra']")
        self.assertRejected(self.mutated(lambda d: d.pop("limits")), "missing ['limits']")
        self.assertRejected(self.mutated(lambda d: d.update(id="Bad_ID")), "id 'Bad_ID'")
        self.assertRejected(self.mutated(lambda d: d.update(version=0)), "version must be")

    def test_non_finite_numbers(self):
        text = json.dumps(self.doc).replace('"version": 1', '"version": NaN', 1)
        path = os.path.join(self.root, "nan.json")
        with open(path, "w") as stream:
            stream.write(text)
        with self.assertRaises(common.LiaError) as raised:
            delivery.load_result(path)
        self.assertIn("non-finite", raised.exception.detail)

        def huge(doc):
            doc["datasets"]["inv_drive"]["rows"][0][2] = float("inf")
        self.assertRejected(self.mutated(huge), "must be a finite number")

    def test_null_needs_null_means(self):
        def null_area(doc):
            doc["datasets"]["inv_drive"]["rows"][0][3] = None
        self.assertRejected(self.mutated(null_area), "column area is null, but the column declares no nullMeans")

        def null_leakage(doc):
            doc["datasets"]["inv_drive"]["rows"][0][5] = None
        self.assertEqual(self.mutated(null_leakage), [])

    def test_source_hash_rules(self):
        def changed(doc):
            doc["sources"][0]["sha256After"] = "0" * 64
        self.assertRejected(self.mutated(changed), "changed while the analysis ran")

        def other(doc):
            doc["sources"][0]["sha256Before"] = doc["sources"][0]["sha256After"] = "1" * 64
        self.assertRejected(self.mutated(other), "differs from the prepared request sha256")

        def liberty(doc):
            doc["sources"][0]["libertySha256"] = "2" * 64
        self.assertRejected(self.mutated(liberty), "libertySha256")

        def kind(doc):
            doc["sources"][0]["kind"] = "liberty"
            del doc["sources"][0]["libertySha256"]
        self.assertRejected(self.mutated(kind), "is a facts source in the prepared request")

        def missing_identity(doc):
            del doc["sources"][0]["libertySha256"]
        self.assertRejected(self.mutated(missing_identity), "missing ['libertySha256']")

        def unknown_extra(doc):
            doc["sources"].append({"path": "/elsewhere/x.lib", "kind": "liberty", "sha256Before": "3" * 64,
                                   "sha256After": "3" * 64})
        self.assertRejected(self.mutated(unknown_extra), "cannot be re-hashed")
        self.hashes["/elsewhere/x.lib"] = "4" * 64
        self.assertRejected(self.mutated(unknown_extra), "now hashes")
        self.hashes["/elsewhere/x.lib"] = "3" * 64
        self.assertEqual(self.mutated(unknown_extra), [])
        self.hashes[self.doc["sources"][0]["path"]] = "5" * 64
        self.assertRejected(self.problems(), "now hashes")

    def test_empty_sources_need_builds_on(self):
        self.assertRejected(self.mutated(lambda d: d.update(sources=[])), "sources is empty")
        prepared = copy.deepcopy(self.prepared)
        prepared["buildsOn"] = [{"ref": "x-y@1"}]
        doc = copy.deepcopy(self.doc)
        doc["sources"] = []
        self.assertEqual(self.problems(doc, prepared=prepared), [])

    def test_code_hashes(self):
        def text(doc):
            doc["code"]["main"]["text"] += "\n"
        self.assertRejected(self.mutated(text), "is not sha256(code.main.text)")
        with open(os.path.join(self.root, "analysis", "inv_drive_delay.py"), "a") as stream:
            stream.write("# edited after delivery\n")
        self.assertRejected(self.problems(), "differs from the delivered file analysis/inv_drive_delay.py")

    def test_code_files_and_prefix(self):
        with open(os.path.join(self.root, "analysis", "helper.py"), "w") as stream:
            stream.write("x = 1\n")
        good = common.sha256_file(os.path.join(self.root, "analysis", "helper.py"))
        self.assertEqual(self.mutated(lambda d: d["code"]["files"].append({"path": "analysis/helper.py", "sha256": good})), [])
        self.assertRejected(self.mutated(lambda d: d["code"]["files"].append({"path": "analysis/helper.py", "sha256": "6" * 64})),
                            "differs from the delivered file analysis/helper.py")
        self.assertRejected(self.mutated(lambda d: d["code"]["files"].append({"path": "analysis/absent.py", "sha256": good})),
                            "is not a delivered plain file")
        self.assertRejected(self.mutated(lambda d: d["code"]["files"].append({"path": "elsewhere/helper.py", "sha256": good})),
                            "under analysis/")

    def test_size_limits(self):
        def many(doc):
            doc["datasets"]["inv_drive"]["rows"] = doc["datasets"]["inv_drive"]["rows"][:1] * 20001
        self.assertRejected(self.mutated(many), "at most 20000 rows")
        self.assertRejected(self.problems(size=4 * 1024 * 1024 + 1), "4 MiB")

    def test_plot_rules(self):
        self.assertRejected(self.mutated(lambda d: d.update(plots=[])), "plots must be a list of 1..32")
        self.assertRejected(self.mutated(lambda d: d["plots"][0].update(dataset="absent")), "is not a valid dataset")
        self.assertRejected(self.mutated(lambda d: d["plots"][0]["y"].update(column="absent")), "is not a column of dataset")
        self.assertRejected(self.mutated(lambda d: d["plots"][1]["x"].update(column="cell")), "needs a number column for x")
        self.assertRejected(self.mutated(lambda d: d["plots"][3].pop("value")), "missing ['value']")
        self.assertRejected(self.mutated(lambda d: d["plots"][4].update(x={"column": "cell"})), "unexpected ['x']")
        self.assertRejected(self.mutated(lambda d: d["plots"][0].update(kind="pie")), "kind must be one of")
        self.assertRejected(self.mutated(lambda d: d["plots"][1].update(id=d["plots"][0]["id"])), "unique slug")

    def test_run_must_have_succeeded(self):
        self.assertRejected(self.mutated(lambda d: d["run"].update(exitCode=3)), "run.exitCode is 3")
        self.assertRejected(self.mutated(lambda d: d["run"].update(usedQualib="no")), "usedQualib")


if __name__ == "__main__":
    unittest.main()
