import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core
from tests import fixtures


SCHEMAS = Path(__file__).resolve().parents[1] / "schemas"
PACK_DIR = Path(__file__).resolve().parents[2]
READER = PACK_DIR / "tools" / "read-mage.py"
SEMANTICS = PACK_DIR / "semantics.yml"


def _load_read_mage_module():
    spec = importlib.util.spec_from_file_location("read_mage_schemas", READER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _semantics_entries(text):
    """`{name: unit}` from `semantics.yml`'s flat `values:` map -- a tiny
    line-based parser (no YAML library in this Pack's own runtime)."""
    entries = {}
    current = None
    for line in text.splitlines():
        if line.startswith("  ") and line.rstrip().endswith(":") and not line.startswith("    "):
            current = line.strip().rstrip(":")
        elif current and line.strip().startswith("unit:"):
            entries[current] = line.split(":", 1)[1].strip()
            current = None
    return entries


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

    def test_case_manifest_with_reference_method_validates(self):
        tmp2 = tempfile.TemporaryDirectory()
        self.addCleanup(tmp2.cleanup)
        case = fixtures.make_case(tmp2.name, reference_method=True)
        schema = json.loads((SCHEMAS / "case-manifest.json").read_text())
        self.assertEqual(core.validate(case["manifest"], schema), [])
        self.assertIn("referenceMethod", case["manifest"])


class SemanticsCoverageTest(unittest.TestCase):
    """Every Reader fact `tools/read-mage.py` can emit must have a
    `semantics.yml` entry, with the same unit, including the two new
    ordinary-drop facts."""

    def test_every_candidate_and_review_fact_has_a_semantics_entry(self):
        module = _load_read_mage_module()
        semantics = _semantics_entries(SEMANTICS.read_text(encoding="utf-8"))
        for fact in module.CANDIDATE_EMITS + module.REVIEW_EMITS:
            self.assertIn(fact, semantics, f"{fact!r} is missing from semantics.yml")
            self.assertEqual(semantics[fact], module._UNITS[fact], f"{fact!r} unit mismatch")

    def test_ordinary_drop_facts_are_covered(self):
        semantics = _semantics_entries(SEMANTICS.read_text(encoding="utf-8"))
        self.assertEqual(semantics["mage_dropped_ordinary_count"], "count")
        self.assertEqual(semantics["mage_dropped_ordinary_length_um"], "um")


if __name__ == "__main__":
    unittest.main()
