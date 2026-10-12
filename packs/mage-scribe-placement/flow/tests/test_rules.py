import sys, unittest, tempfile
from pathlib import Path
sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core, rules
from tests import fixtures


class RulesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.case = fixtures.make_case(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_rule_facts_for_long_key(self):
        facts = rules.read_rule_facts(Path(self.case['files']['rule']).read_text(), 10000)
        key = facts['KEY_V']
        self.assertEqual(key['itemType'], 'SLFIT')
        self.assertEqual(key['blockType'], 'TSK/MPAD')
        self.assertEqual(key['scribeInc'], ['VERT'])
        self.assertFalse(key['turnable'])
        self.assertEqual(key['setNum'], [0, 1, 1])
        self.assertEqual(key['gridDbu'], [100, 100])
        self.assertEqual(key['spaceDbu'], {'x': 0, 'y': 0})
        self.assertFalse(key['qualified']['zone'])
        self.assertTrue(key['zoneRaw'].startswith('-by PCT'))

    def test_rule_facts_for_ovl_f_setnummin_two(self):
        facts = rules.read_rule_facts(Path(self.case['files']['rule']).read_text(), 10000)
        ovl_f = facts['OVL_F']
        self.assertEqual(ovl_f['itemType'], 'SLFIT')
        self.assertEqual(ovl_f['blockType'], 'OVL')
        self.assertEqual(ovl_f['scribeInc'], ['HORIZ'])
        self.assertEqual(ovl_f['setNum'], [0, 2, 1])

    def test_frame_from_rule(self):
        rule_text = Path(self.case['files']['rule']).read_text()
        pblock_text = Path(self.case['files']['pblock']).read_text()
        frame = rules.frame_from_rule(rule_text, pblock_text, 10000)
        self.assertEqual(frame, {
            'widthDbu': 21800000, 'heightDbu': 17800000, 'scribeDbu': 600000,
            'cols': 2, 'rows': 2, 'dieWidthDbu': 10000000, 'dieHeightDbu': 8000000,
        })

    def test_continuation_lines_are_joined(self):
        # The -setZone clause on KEY_V spans several `\`-continued physical
        # lines in the rule text; it must be read as one logical command.
        rule_text = Path(self.case['files']['rule']).read_text()
        self.assertIn('-bindBlkType TSK/MPAD \\\n', rule_text)  # the KEY_V command really continues
        facts = rules.read_rule_facts(rule_text, 10000)
        self.assertEqual(facts['KEY_V']['zoneRaw'], '-by PCT -xPos CENTER -xPct 50 -xTgt BOUND')

    def test_frame_from_rule_rejects_non_uniform_scribe(self):
        rule_text = Path(self.case['files']['rule']).read_text()
        pblock_text = Path(self.case['files']['pblock']).read_text()
        broken = rule_text.replace(
            'smShot shot -setExtScribe -min {60 60 60 60} -olap {-1 -1}',
            'smShot shot -setExtScribe -min {60 60 60 70} -olap {-1 -1}',
        )
        with self.assertRaises(core.MageError):
            rules.frame_from_rule(broken, pblock_text, 10000)

    def test_read_block_types(self):
        block_types = rules.read_block_types(Path(self.case['files']['block']).read_text(), 10000)
        self.assertEqual(block_types['KEY_V'], {'blockType': 'TSK/MPAD', 'sizeDbu': [9000000, 600000]})
        self.assertEqual(block_types['OVL_F'], {'blockType': 'OVL', 'sizeDbu': [1000000, 560000]})


if __name__ == '__main__':
    unittest.main()
