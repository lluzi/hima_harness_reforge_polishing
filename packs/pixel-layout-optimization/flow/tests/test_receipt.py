"""Tests for pixelopt.receipt, the pixel-receipt Reader (stdlib only)."""
import copy
import os
import unittest

from pixelopt import core, judge, receipt
from tests import test_judge as tj


def values(rows):
    return {r["type"]: r for r in rows}


def judged(sidecar=None, geom=None, mode="full"):
    case, sitecaps, ws, cand, readiness = tj.build_env(sidecar=sidecar, geom=geom)
    judge.judge([{"id": "c0", "dir": cand}], ws, case, sitecaps, readiness, mode)
    rpath = os.path.join(cand, "receipt.json")
    return case, ws, cand, readiness, rpath


class TestCleanFull(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.case, cls.ws, cls.cand, cls.readiness, cls.rpath = judged()
        cls.v = values(receipt.reader_values(cls.rpath, cls.ws, cls.readiness))

    def test_no_errors(self):
        self.assertEqual(self.v["pixel_receipt_error_count"]["value"], 0)

    def test_drc_counts_zero(self):
        for deck in ("authority", "reference"):
            for tile in ("1x1", "2x2", "3x3"):
                self.assertEqual(self.v["pixel_drc_%s_%s" % (deck, tile)]["value"], 0)

    def test_lvs_correct(self):
        self.assertEqual(self.v["pixel_lvs_correct"]["value"], 1)

    def test_cs_and_ratios(self):
        self.assertAlmostEqual(self.v["pixel_cs_ff"]["value"], 12.0, places=5)
        self.assertAlmostEqual(self.v["pixel_ratio_broad_pct"]["value"], 8.75, places=4)
        self.assertAlmostEqual(self.v["pixel_ratio_narrow_pct"]["value"],
                               0.35 / 12.0 * 100.0, places=4)
        # broad is the default judged definition
        self.assertAlmostEqual(self.v["pixel_ratio_judged_pct"]["value"], 8.75, places=4)
        self.assertAlmostEqual(self.v["pixel_ct_judged_ff"]["value"], 1.05, places=5)

    def test_secondary_couplings(self):
        # the stand-in's storage node S couples 0.3 fF to the anode AN and 0.4 fF to the scan SC
        self.assertAlmostEqual(self.v["pixel_ct_anode_ff"]["value"], 0.3, places=5)
        self.assertAlmostEqual(self.v["pixel_ct_lines_ff"]["value"], 0.4, places=5)

    def test_cs_outside_estimated(self):
        self.assertAlmostEqual(self.v["pixel_cs_outside_marker_ff"]["value"], 0.5,
                               places=5)

    def test_loads_and_couplings(self):
        self.assertAlmostEqual(self.v["pixel_load_increase_max_pct"]["value"], 0.0,
                               places=4)
        self.assertEqual(self.v["pixel_load_over_limit_count"]["value"], 0)
        self.assertEqual(self.v["pixel_coupling_over_limit_count"]["value"], 0)

    def test_geometry_values(self):
        self.assertEqual(self.v["pixel_outline_w_um"]["value"], 18.0)
        self.assertEqual(self.v["pixel_outline_h_um"]["value"], 38.0)
        self.assertEqual(self.v["pixel_channels_changed"]["value"], 0)
        self.assertEqual(self.v["pixel_t_tiled_pct"]["value"], 12.0)
        self.assertEqual(self.v["pixel_t_judged_pct"]["value"], 12.0)
        self.assertEqual(self.v["pixel_oled_area_um2"]["value"], 40.0)
        self.assertEqual(self.v["pixel_pdl_symmetry_min"]["value"], 0.9)
        self.assertEqual(self.v["pixel_undeclared_change_count"]["value"], 0)

    def test_every_value_type_present(self):
        expected = {
            "pixel_receipt_error_count", "pixel_drc_authority_1x1",
            "pixel_drc_authority_2x2", "pixel_drc_authority_3x3",
            "pixel_drc_reference_1x1", "pixel_drc_reference_2x2",
            "pixel_drc_reference_3x3", "pixel_interact_violations",
            "pixel_lvs_correct", "pixel_channels_changed", "pixel_outline_w_um",
            "pixel_outline_h_um", "pixel_ratio_narrow_pct", "pixel_ratio_broad_pct",
            "pixel_ratio_judged_pct", "pixel_ct_judged_ff", "pixel_cs_ff",
            "pixel_cs_outside_marker_ff", "pixel_cst_device_ff",
            "pixel_coupling_over_limit_count", "pixel_load_increase_max_pct",
            "pixel_load_over_limit_count", "pixel_t_tiled_pct", "pixel_t_own_pct",
            "pixel_t_judged_pct", "pixel_oled_area_um2", "pixel_pdl_symmetry_min",
            "pixel_undeclared_change_count",
        }
        self.assertEqual(set(self.v) & expected, expected)


def _with_floating_plate():
    from tests import standin_eda
    caps = {"%s|%s" % tuple(sorted((a, b))): v for a, b, v in standin_eda.DEFAULT_CAPS}
    caps["RCE_UNCONN_9|S"] = 2.0    # a plate on no net, over the storage node
    caps["RCE_UNCONN_9|SC"] = 6.0   # and over the scan line
    return judged(sidecar={"caps": caps})


class TestFloatingPlates(unittest.TestCase):
    def test_a_clean_candidate_has_none(self):
        case, ws, cand, readiness, rpath = judged()
        v = values(receipt.reader_values(rpath, ws, readiness))
        self.assertEqual(v["pixel_floating_new_count"]["value"], 0)

    def test_a_floating_plate_the_original_lacks_is_counted(self):
        case, ws, cand, readiness, rpath = _with_floating_plate()
        v = values(receipt.reader_values(rpath, ws, readiness))
        self.assertEqual(v["pixel_floating_new_count"]["value"], 1)

    def test_the_originals_own_floating_node_is_not_new(self):
        case, ws, cand, readiness, rpath = _with_floating_plate()
        readiness["original"]["floatingNets"] = 1
        v = values(receipt.reader_values(rpath, ws, readiness))
        self.assertEqual(v["pixel_floating_new_count"]["value"], 0)

    def test_no_original_count_is_unknown_never_zero(self):
        case, ws, cand, readiness, rpath = judged()
        del readiness["original"]["floatingNets"]
        v = values(receipt.reader_values(rpath, ws, readiness))
        self.assertIsNone(v["pixel_floating_new_count"]["value"])

    def test_floating_nets_names_only_watched_couplings_above_the_floor(self):
        caps = {"RCE_UNCONN_3|SC": 6.0, "RCE_UNCONN_3|S": 2.0, "R1|RCE_UNCONN_2": 4.0,
                "RCE_UNCONN_1|SC": 0.2}
        self.assertEqual(receipt.floating_nets(caps, ["S", "SC"]), ["RCE_UNCONN_3"])


class TestExtraCsExclude(unittest.TestCase):
    def test_exclude_subtracts_outside_estimate(self):
        case, ws, cand, readiness, rpath = judged()
        readiness["goal"]["extraCsOverlap"] = "exclude"
        v = values(receipt.reader_values(rpath, ws, readiness))
        self.assertAlmostEqual(v["pixel_cs_ff"]["value"], 11.5, places=5)

    def test_exclude_without_estimate_is_null(self):
        geom = dict(tj.GEOM)
        geom.pop("csOutsideMarkerFf")
        case, ws, cand, readiness, rpath = judged(geom=geom)
        readiness["goal"]["extraCsOverlap"] = "exclude"
        v = values(receipt.reader_values(rpath, ws, readiness))
        self.assertIsNone(v["pixel_cs_ff"]["value"])
        self.assertIn("unknownReason", v["pixel_cs_ff"])


class TestCounterexamples(unittest.TestCase):
    def test_no_summary_is_null_and_error(self):
        case, ws, cand, readiness, rpath = judged()
        os.remove(os.path.join(cand, "out", "drc_authority_1x1", "argus_drc.sum"))
        v = values(receipt.reader_values(rpath, ws, readiness))
        self.assertIsNone(v["pixel_drc_authority_1x1"]["value"])
        self.assertGreaterEqual(v["pixel_receipt_error_count"]["value"], 1)

    def test_empty_rce_is_null_ratios(self):
        case, ws, cand, readiness, rpath = judged(sidecar={"capsEmpty": True})
        v = values(receipt.reader_values(rpath, ws, readiness))
        self.assertIsNone(v["pixel_ratio_judged_pct"]["value"])
        self.assertIsNone(v["pixel_cs_ff"]["value"])

    def test_lvs_incorrect_is_zero(self):
        case, ws, cand, readiness, rpath = judged(sidecar={"lvsCorrect": False})
        v = values(receipt.reader_values(rpath, ws, readiness))
        self.assertEqual(v["pixel_lvs_correct"]["value"], 0)

    def test_sha_mismatch_is_error(self):
        case, ws, cand, readiness, rpath = judged()
        rep = core.read_json(rpath)
        lvs = [r for r in rep["reports"] if r["kind"] == "lvs"][0]
        with open(os.path.join(ws, lvs["path"]), "a") as fh:
            fh.write("\ntampered\n")
        v = values(receipt.reader_values(rpath, ws, readiness))
        self.assertGreaterEqual(v["pixel_receipt_error_count"]["value"], 1)

    def test_fresh_library_false_is_error(self):
        case, ws, cand, readiness, rpath = judged()
        rep = core.read_json(rpath)
        rep["freshLibrary"] = False
        core.write_json(rpath, rep)
        v = values(receipt.reader_values(rpath, ws, readiness))
        self.assertGreaterEqual(v["pixel_receipt_error_count"]["value"], 1)

    def test_option_mismatch_is_error(self):
        case, ws, cand, readiness, rpath = judged()
        bad = copy.deepcopy(readiness)
        bad["options"]["decks"]["authority"] = "deadbeef"
        v = values(receipt.reader_values(rpath, ws, bad))
        self.assertGreaterEqual(v["pixel_receipt_error_count"]["value"], 1)


class TestDrcModeReader(unittest.TestCase):
    def test_lvs_and_ratio_unknown_without_error(self):
        case, ws, cand, readiness, rpath = judged(mode="drc")
        v = values(receipt.reader_values(rpath, ws, readiness))
        self.assertIsNone(v["pixel_lvs_correct"]["value"])
        self.assertIsNone(v["pixel_ratio_judged_pct"]["value"])
        # the geometry-sourced values are still present in drc mode
        self.assertEqual(v["pixel_outline_w_um"]["value"], 18.0)
        # absence of lvs/rce in drc mode is not a receipt error
        self.assertEqual(v["pixel_receipt_error_count"]["value"], 0)


if __name__ == "__main__":
    unittest.main()
