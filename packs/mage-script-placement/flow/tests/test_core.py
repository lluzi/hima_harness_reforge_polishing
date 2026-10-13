import sys, unittest, tempfile
from pathlib import Path
sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core

class CoreTest(unittest.TestCase):
    def test_stamp_and_read_round_trip_and_tamper_refusal(self):
        with tempfile.TemporaryDirectory() as d:
            doc = core.stamp('finding', {'x': 1}); p = Path(d) / 'f.json'
            core.write_artifact(p, doc)
            self.assertEqual(core.read_artifact(p, 'finding')['x'], 1)
            p.write_text(p.read_text().replace('"x": 1', '"x": 2'))
            with self.assertRaises(core.MageError) as caught: core.read_artifact(p, 'finding')
            self.assertEqual(caught.exception.code, 'identity-mismatch')
    def test_units_exact_only(self):
        self.assertEqual(core.um_to_dbu('5188', 10000), 51880000)
        self.assertEqual(core.um_to_dbu('30770.55', 10000), 307705500)
        self.assertEqual(core.dbu_to_um(307705500, 10000), '30770.55')
        with self.assertRaises(core.MageError): core.um_to_dbu('0.00001', 10000)
    def test_validate_subset(self):
        schema = {'type': 'object', 'required': ['a'], 'additionalProperties': False,
                  'properties': {'a': {'type': 'string', 'enum': ['x']}, 'b': {'$ref': '#/$defs/n'}},
                  '$defs': {'n': {'type': 'integer', 'minimum': 0}}}
        self.assertEqual(core.validate({'a': 'x', 'b': 2}, schema), [])
        self.assertEqual(len(core.validate({'a': 'y', 'b': -1, 'c': 0}, schema)), 3)
if __name__ == '__main__': unittest.main()
