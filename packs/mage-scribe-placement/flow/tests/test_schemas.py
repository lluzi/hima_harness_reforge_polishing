import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core
from tests import fixtures


SCHEMAS = Path(__file__).resolve().parents[1] / "schemas"


class SchemasTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.case = fixtures.make_case(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_case_manifest_validates(self):
        schema = json.loads((SCHEMAS / "case-manifest.json").read_text())
        self.assertEqual(core.validate(self.case["manifest"], schema), [])

    def test_consumer_context_validates(self):
        schema = json.loads((SCHEMAS / "consumer-context.json").read_text())
        self.assertEqual(core.validate(self.case["consumerContext"], schema), [])

    def test_case_manifest_rejects_unknown_key(self):
        schema = json.loads((SCHEMAS / "case-manifest.json").read_text())
        broken = dict(self.case["manifest"])
        broken["unexpectedField"] = "x"
        self.assertNotEqual(core.validate(broken, schema), [])


if __name__ == "__main__":
    unittest.main()
