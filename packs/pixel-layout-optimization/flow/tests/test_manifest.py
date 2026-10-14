"""Tests for pixelopt.manifest (stdlib only; placeholder GDS case)."""
import os
import tempfile
import unittest

from pixelopt import manifest as mani
from pixelopt.core import PixelError
from tests import fixtures


class TestLoadCase(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.built = fixtures.build_text_case(self.dir)

    def test_accepts_valid_case(self):
        case = mani.load_case(self.built["manifest"])
        self.assertEqual(case.case_id, "synthetic-1")
        self.assertEqual(case.grid_um, 0.005)
        self.assertEqual(case.candidate_top_cell, "pix")

    def test_relative_paths_resolve_from_manifest_dir(self):
        case = mani.load_case(self.built["manifest"])
        gds = case.file(case.raw["original"]["gds"])
        self.assertTrue(os.path.isabs(gds))
        self.assertEqual(os.path.dirname(gds), self.dir)
        self.assertTrue(os.path.exists(gds))

    def test_case_helpers(self):
        case = mani.load_case(self.built["manifest"])
        self.assertEqual(case.layers_with("outline"), ["Bound"])
        self.assertIn("Anode", case.layers_with("conductor"))
        gmap = case.gds_map()
        self.assertEqual(gmap[(3, 0)], "Poly")
        self.assertEqual(gmap[(4, 0)], "Metal")

    def test_changed_byte_is_refused_naming_field(self):
        # Corrupt the original GDS; load_case must refuse and name original.gds.
        gds = os.path.join(self.dir, "pixel.gds")
        with open(gds, "ab") as fh:
            fh.write(b"X")
        with self.assertRaises(PixelError) as cm:
            mani.load_case(self.built["manifest"])
        self.assertEqual(cm.exception.code, "digest-mismatch")
        self.assertIn("original.gds", cm.exception.detail)

    def test_changed_deck_names_its_field(self):
        deck = os.path.join(self.dir, "deck_authority.drc")
        with open(deck, "a", encoding="utf-8") as fh:
            fh.write("\n// tampered\n")
        with self.assertRaises(PixelError) as cm:
            mani.load_case(self.built["manifest"])
        self.assertEqual(cm.exception.code, "digest-mismatch")
        self.assertIn("decks.authority", cm.exception.detail)

    def test_missing_file_is_refused(self):
        os.remove(os.path.join(self.dir, "schematic_cst.tmpl"))
        with self.assertRaises(PixelError) as cm:
            mani.load_case(self.built["manifest"])
        self.assertEqual(cm.exception.code, "digest-mismatch")
        self.assertIn("cst.schematicTemplate", cm.exception.detail)

    def test_verify_false_skips_digests(self):
        with open(os.path.join(self.dir, "pixel.gds"), "ab") as fh:
            fh.write(b"X")
        case = mani.load_case(self.built["manifest"], verify=False)
        self.assertEqual(case.case_id, "synthetic-1")


class TestSitecaps(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.built = fixtures.build_text_case(self.dir)

    def test_load_sitecaps(self):
        caps = mani.load_sitecaps(self.built["sitecaps"])
        self.assertEqual(caps["schema"], "pixel.site-capabilities/1")
        self.assertEqual(caps["launcher"]["argv"], [])
        self.assertEqual(caps["drcStripFunctions"], ["geom_interact"])
        self.assertEqual(caps["tools"]["argus"][-1], "argus")


if __name__ == "__main__":
    unittest.main()
