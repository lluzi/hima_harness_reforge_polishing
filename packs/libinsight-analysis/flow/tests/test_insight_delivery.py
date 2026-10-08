"""insight-delivery: one example rule run to a checked delivery, its candidate and the code that ran."""
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import libinsight_cli  # noqa: E402
from libinsight_analysis import common, insight_page  # noqa: E402
import rules_synthetic as R  # noqa: E402


class InsightDelivery(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp(prefix="li-insight-delivery-")
        self.corpus = os.path.join(self.dir, "corpus")
        self.root = os.path.join(self.dir, "workspace")
        os.makedirs(self.corpus)
        os.makedirs(self.root)
        R.write_vmin_corpus(self.corpus)
        self.prepared = os.path.join(self.dir, "prepared.json")
        common.write_json(self.prepared, {
            "schema": "hima-libinsight-prepared-request/1", "requestId": "req-20261008000000-abcdef",
            "question": "vmin_bottleneck: flag cells that slow down more than the inverter from 0.81 V to 0.72 V.",
            "sources": [], "buildsOn": [], "readRoots": [self.dir],
            "library": {"path": "/library", "analyses": [{"id": "vmin-bottleneck", "version": 2}], "invalid": []}})

    def tearDown(self):
        shutil.rmtree(self.dir)

    def deliver(self, *extra):
        return libinsight_cli.main(["insight-delivery", "--rule", "vmin_bottleneck", "--root", self.root,
                                    "--prepared", self.prepared] + list(extra) + [
            "--", "--facts", "9T-SVT=%s" % os.path.join(self.corpus, "*.json.gz"),
            "--hi", "0.81", "--lo", "0.72", "--temps=-40,125"])

    def test_example_rule_becomes_an_accepted_delivery(self):
        self.assertEqual(self.deliver(), 0)
        with open(os.path.join(self.root, "analysis-result.json")) as stream:
            doc = json.load(stream)
        self.assertEqual((doc["id"], doc["version"]), ("vmin-bottleneck", 3), "the next version after the admitted one")
        self.assertEqual(insight_page.check_rule(doc["insight"]), [])
        self.assertEqual(len(doc["sources"]), 4)
        self.assertTrue(all(s["kind"] == "facts" and s["sha256Before"] == s["sha256After"] for s in doc["sources"]))
        self.assertEqual(doc["code"]["main"]["path"], "analysis/vmin_bottleneck/vmin_bottleneck.py")
        self.assertEqual(sorted(f["path"] for f in doc["code"]["files"]), [
            "analysis/vmin_bottleneck/facts.py", "analysis/vmin_bottleneck/netlists.py", "analysis/vmin_bottleneck/rule.json"])
        self.assertEqual(doc["datasets"]["items"]["rows"][0][0], doc["insight"]["items"][0]["label"])
        with open(os.path.join(self.root, "resident-delivery.json")) as stream:
            candidate = json.load(stream)
        kinds = sorted(a["kind"] for a in candidate["artifacts"])
        self.assertEqual(kinds, ["result", "support", "support", "support", "support"])
        # Delivering again with the same code reuses the same folder; the delivery stays accepted.
        self.assertEqual(self.deliver(), 0)

    def test_a_netlist_glob_keeps_the_command_exact_and_short(self):
        R.write_text(os.path.join(self.corpus, "cells_a.spi"), R.NOR3_SPICE)
        pattern = os.path.join(self.corpus, "*.spi")
        self.assertEqual(libinsight_cli.main(["insight-delivery", "--rule", "vmin_bottleneck", "--root", self.root,
                                              "--prepared", self.prepared, "--",
                                              "--facts", "9T-SVT=%s" % os.path.join(self.corpus, "*.json.gz"),
                                              "--hi", "0.81", "--lo", "0.72", "--temps=-40,125", "--netlist", pattern]), 0)
        with open(os.path.join(self.root, "analysis-result.json")) as stream:
            doc = json.load(stream)
        self.assertIn(pattern, doc["run"]["command"])
        self.assertTrue(doc["insight"]["items"][0]["brief"]["where"])
        self.assertTrue(any("cells_a.spi" in line for line in doc["assumptions"]), "the netlist is named with its hash")

    def test_usage_errors_deliver_nothing(self):
        self.assertEqual(libinsight_cli.main(["insight-delivery", "--rule", "vmin_bottleneck", "--prepared", self.prepared]), 2)
        self.assertEqual(libinsight_cli.main(["insight-delivery", "--rule", "no_such_rule", "--root", self.root,
                                              "--prepared", self.prepared, "--", "--facts", "a=b"]), 2)
        self.assertFalse(os.path.exists(os.path.join(self.root, "analysis-result.json")))


if __name__ == "__main__":
    unittest.main()
