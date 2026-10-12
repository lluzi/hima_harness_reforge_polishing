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
        self.assertIn('smPInstMgr -savePlaDBU {10000}', dbu)
        self.assertIn('-box (', dbu)
        self.assertNotIn('-umBox (', dbu)
        self.assertEqual(pla.read_pla(dbu, 10000)['fits'], pla.read_pla(text, 10000)['fits'])
        self.assertEqual(pla.read_pla(dbu, 10000)['groups'], pla.read_pla(text, 10000)['groups'])

    def test_bare_save_pla_dbu_header_also_accepted(self):
        self.assertEqual(pla._detect_units('smPInstMgr -savePlaDBU 10000\n', 10000), 'dbu')
        self.assertEqual(pla._detect_units('smPInstMgr -savePlaDBU {10000}\n', 10000), 'dbu')

    def test_mismatched_braced_save_pla_dbu_is_refused(self):
        text = Path(self.case['files']['startState']).read_text()
        braced = 'smPInstMgr -savePlaDBU {20000}\n' + text
        with self.assertRaises(core.MageError) as ctx:
            pla.read_pla(braced, 10000)
        self.assertEqual(ctx.exception.code, 'units')

    def test_real_native_dbu_shape_reads_to_the_same_snapshot_as_its_um_twin(self):
        # The real shape confirmed on the Oct-12 build: braced header,
        # -box (not -umBox) in the three foreach forms, integer-DBU
        # boxes, and Group target points still in micrometres.
        um_text = Path(self.case['files']['incumbentState']).read_text()
        um_doc = pla.read_pla(um_text, 10000)
        native_text = pla.write_pla(um_doc, 10000, units='dbu')
        self.assertIn('smPInstMgr -savePlaDBU {10000}', native_text)
        self.assertIn('-box (', native_text)
        self.assertNotIn('-umBox (', native_text)
        native_doc = pla.read_pla(native_text, 10000)
        self.assertEqual(native_doc['fixed'], um_doc['fixed'])
        self.assertEqual(native_doc['groups'], um_doc['groups'])
        self.assertEqual(native_doc['fits'], um_doc['fits'])
        self.assertEqual(native_doc['drops'], um_doc['drops'])
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

    def test_native_dbu_pla_group_points_stay_um_not_dbu(self):
        # Hand-written native-shape DBU PLA text: a braced -savePlaDBU
        # header, an integer-DBU fitinsts box, and a pinstGroupProperty
        # row carrying a plain micrometre point. If `_read_groups` ever
        # converted this row as DBU (the reviewer's reversion that still
        # passed all 184 pre-existing tests) the target point would come
        # out roughly 10000x too large instead of [300000, 119000000].
        text = (
            "smPInstMgr -savePlaDBU {10000}\n"
            "set fitinsts {\n"
            '\tBASE.BASE 67500 111266000 532500 127026000 0 "" PF1 ""\n'
            "}\n"
            "set pinstGroupProperty {\n"
            "\tG1 PG1 30.000000 11900.000000 0\n"
            "}\n"
        )
        doc = pla.read_pla(text, 10000)
        self.assertEqual(doc['groups'][0]['targetPointDbu'], [300000, 119000000])
        self.assertEqual(doc['fits'][0]['boxDbu'], [67500, 111266000, 532500, 127026000])

    def test_write_pla_dbu_emits_group_points_in_um_not_dbu(self):
        # Mirrors the read-side test on the write side: a DBU-units write
        # must still render the group row's target point as a micrometre
        # decimal (via `core.dbu_to_um`), while the fit row's box stays
        # plain integer DBU. Converting the group point as DBU would
        # render "3000000 1190000000" instead.
        doc = {
            "units": "dbu", "dbuPerUm": 10000,
            "fixed": [],
            "groups": [{"groupItem": "G1", "pinstGroup": "PG1", "targetPointDbu": [300000, 119000000], "vertSL": False}],
            "fits": [{"id": "PF1", "base": "BASE", "inst": "BASE.BASE",
                       "boxDbu": [67500, 111266000, 532500, 127026000],
                       "extraRot": "0", "postfix": "", "inGroup": ""}],
            "drops": [],
        }
        written = pla.write_pla(doc, 10000, units="dbu")
        expected_x = core.dbu_to_um(300000, 10000)
        expected_y = core.dbu_to_um(119000000, 10000)
        self.assertIn(f"G1 PG1 {expected_x} {expected_y} 0", written)
        self.assertIn("BASE.BASE 67500 111266000 532500 127026000", written)
if __name__ == '__main__': unittest.main()
