"""Tests for pixelopt.core (stdlib only)."""
import json
import os
import tempfile
import unittest

from pixelopt import core
from pixelopt.core import PixelError


class TestValidate(unittest.TestCase):
    def test_type_error(self):
        schema = {"type": "object", "properties": {"n": {"type": "number"}}}
        errs = core.validate({"n": "x"}, schema)
        self.assertTrue(any("expected type number" in e for e in errs))

    def test_integer_not_bool(self):
        self.assertTrue(core.validate(True, {"type": "integer"}))
        self.assertEqual(core.validate(3, {"type": "integer"}), [])

    def test_enum_and_const(self):
        self.assertTrue(core.validate("z", {"enum": ["a", "b"]}))
        self.assertEqual(core.validate("a", {"enum": ["a", "b"]}), [])
        self.assertTrue(core.validate("x", {"const": "pixel"}))
        self.assertEqual(core.validate("pixel", {"const": "pixel"}), [])

    def test_required(self):
        schema = {"type": "object", "required": ["a", "b"]}
        errs = core.validate({"a": 1}, schema)
        self.assertTrue(any("missing required property 'b'" in e for e in errs))
        self.assertEqual(core.validate({"a": 1, "b": 2}, schema), [])

    def test_additional_properties_false(self):
        schema = {"type": "object", "properties": {"a": {}},
                  "additionalProperties": False}
        errs = core.validate({"a": 1, "x": 2}, schema)
        self.assertTrue(any("additional property 'x' not allowed" in e for e in errs))
        self.assertEqual(core.validate({"a": 1}, schema), [])

    def test_additional_properties_schema(self):
        schema = {"type": "object", "additionalProperties": {"type": "number"}}
        self.assertTrue(core.validate({"a": "x"}, schema))
        self.assertEqual(core.validate({"a": 1.0}, schema), [])

    def test_items_and_bounds(self):
        schema = {"type": "array", "items": {"type": "integer", "minimum": 0},
                  "minItems": 1, "maxItems": 2}
        self.assertEqual(core.validate([1, 2], schema), [])
        self.assertTrue(core.validate([], schema))
        self.assertTrue(core.validate([1, 2, 3], schema))
        self.assertTrue(core.validate([-1], schema))

    def test_ref_and_anyof(self):
        schema = {
            "$defs": {"fileRef": {"type": "object", "required": ["path"]}},
            "type": "object",
            "properties": {"f": {"$ref": "#/$defs/fileRef"}},
        }
        self.assertEqual(core.validate({"f": {"path": "x"}}, schema), [])
        self.assertTrue(core.validate({"f": {}}, schema))

        anyof = {"anyOf": [{"type": "string"}, {"type": "number"}]}
        self.assertEqual(core.validate("x", anyof), [])
        self.assertEqual(core.validate(3, anyof), [])
        self.assertTrue(core.validate([], anyof))


class TestJson(unittest.TestCase):
    def test_write_atomic_sorted_and_hash(self):
        d = tempfile.mkdtemp()
        path = os.path.join(d, "out.json")
        sha = core.write_json(path, {"b": 1, "a": 2})
        with open(path, "r", encoding="utf-8") as fh:
            text = fh.read()
        # sorted keys: "a" before "b"
        self.assertLess(text.index('"a"'), text.index('"b"'))
        self.assertEqual(sha, core.sha256_file(path))
        self.assertEqual(json.loads(text), {"a": 2, "b": 1})

    def test_read_missing(self):
        with self.assertRaises(PixelError) as cm:
            core.read_json("/no/such/file.json")
        self.assertEqual(cm.exception.code, "missing-input")


class TestSnap(unittest.TestCase):
    def test_snap(self):
        self.assertEqual(core.snap(1.2341, 0.005), 1.235)
        self.assertEqual(core.snap(1.2360, 0.005), 1.235)
        self.assertEqual(core.snap(2.0, 0.005), 2.0)


if __name__ == "__main__":
    unittest.main()
