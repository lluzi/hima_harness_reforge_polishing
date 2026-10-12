import sys, unittest, tempfile
from pathlib import Path
sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core, pla
from tests import fixtures


class PlaTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.case = fixtures.make_case(self.tmp.name)
    def tearDown(self):
        self.tmp.cleanup()
    def test_reads_um_pla_with_fixed_groups_fits(self):
        doc = pla.read_pla(Path(self.case['files']['startState']).read_text(), 10000)
        self.assertEqual(doc['units'], 'um'); self.assertEqual(len(doc['fixed']), 1); self.assertEqual(len(doc['groups']), 3)
        fit = next(f for f in doc['fits'] if f['base'] == 'OVL_B')
        self.assertEqual(fit['inGroup'], 'G1_2'); self.assertEqual(fit['boxDbu'][2] - fit['boxDbu'][0], 1350000)
    def test_reads_drops_and_placed_flag(self):
        doc = pla.read_pla(Path(self.case['files']['incumbentState']).read_text(), 10000)
        self.assertEqual([d['base'] for d in doc['drops']], ['KEY_V']); self.assertEqual(doc['drops'][0]['placedFlag'], 0)
    def test_dbu_header_switches_units(self):
        text = Path(self.case['files']['startState']).read_text()
        dbu = pla.write_pla(pla.read_pla(text, 10000), 10000, units='dbu')
        self.assertIn('smPInstMgr -savePlaDBU 10000', dbu)
        self.assertEqual(pla.read_pla(dbu, 10000)['fits'], pla.read_pla(text, 10000)['fits'])
    def test_write_round_trips_including_drops(self):
        text = Path(self.case['files']['incumbentState']).read_text(); doc = pla.read_pla(text, 10000)
        again = pla.read_pla(pla.write_pla(doc, 10000), 10000)
        self.assertEqual(again['fits'], doc['fits']); self.assertEqual(again['drops'], doc['drops']); self.assertEqual(again['groups'], doc['groups'])
    def test_duplicate_fit_id_refused(self):
        text = Path(self.case['files']['startState']).read_text()
        line = [l for l in text.splitlines() if 'OVL_A.OVL_A_1' in l][0]
        with self.assertRaises(core.MageError): pla.read_pla(text.replace(line, line + '\n' + line), 10000)
    def test_inst_tokens_survive_read_write_round_trip_verbatim(self):
        text = Path(self.case['files']['incumbentState']).read_text()
        doc = pla.read_pla(text, 10000)
        insts = {f['id']: f['inst'] for f in doc['fits']}
        self.assertIn('OVL_F.OVL_F_7_1', insts); self.assertEqual(insts['OVL_F.OVL_F_7_1'], 'OVL_F.OVL_F_7')
        again = pla.read_pla(pla.write_pla(doc, 10000), 10000)
        self.assertEqual([f['inst'] for f in again['fits']], [f['inst'] for f in doc['fits']])
        self.assertEqual([d['inst'] for d in again['drops']], [d['inst'] for d in doc['drops']])
    def test_write_pla_emits_suffixed_inst_token_verbatim(self):
        doc = pla.read_pla(Path(self.case['files']['incumbentState']).read_text(), 10000)
        written = pla.write_pla(doc, 10000)
        self.assertIn('OVL_F.OVL_F_7 2000', written)
if __name__ == '__main__': unittest.main()
