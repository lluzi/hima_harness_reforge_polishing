#!/usr/bin/env python3
"""Low-cost falsifiers for physical drive intent and Mock Liberty calibration."""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


DOMAIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DOMAIN))

from drive_family import scale_spice_drive, transistor_widths  # noqa: E402
from mock_liberty_calibration import (  # noqa: E402
    calibrate_prediction, demand_result, validate_electrical_families)


class DriveFamilyAndMockLibertyTests(unittest.TestCase):
    def test_spice_drive_variants_have_distinct_physical_widths(self):
        source = (
            ".subckt CELL A Y vdd gnd\n"
            "M0 Y A vdd vdd pmos w=0.34u l=0.04u\n"
            "M1 Y A gnd gnd nmos w=0.28u l=0.04u\n"
            ".ends CELL\n"
        )
        families = {}
        for drive in ("D1", "D2", "D4", "D6", "D8"):
            text = scale_spice_drive(
                source, source_cell="CELL", target_cell="CELL_" + drive, drive=drive)
            families[drive] = transistor_widths(text)
            self.assertIn(".subckt CELL_" + drive, text)
        self.assertEqual([0.34, 0.28], families["D1"])
        self.assertEqual([2.72, 2.24], families["D8"])
        self.assertEqual(5, len({tuple(values) for values in families.values()}))

    def test_calibrated_d1_uses_depth_and_stack_then_drives_scale_from_d1(self):
        prediction = {
            "arcs": [{
                "in_pin": "A", "out_pin": "Y",
                "index_1": [0.01, 0.02], "index_2": [0.001, 0.004],
                "scalars": {"cap": 0.002},
                "tables": {
                    "cell_rise": [[0.04, 0.06], [0.05, 0.07]],
                    "cell_fall": [[0.03, 0.05], [0.04, 0.06]],
                    "rise_transition": [[0.02, 0.04], [0.03, 0.05]],
                    "fall_transition": [[0.02, 0.04], [0.03, 0.05]],
                },
                "power_tables": {},
            }],
            "pins": {}, "leakage": {"leak_default": 0.01},
        }
        policy = {
            "global_delay_scale": 0.85,
            "p_series_penalty_per_extra": 0.08,
            "n_series_penalty_per_extra": 0.08,
            "drive_intrinsic_exponent": 0.15,
            "per_stage_anchor_cap": 1.0,
            "reference_slew_ns": 0.02,
            "reference_load_pf": 0.003,
        }
        topology = {("A", "Y"): {
            "fanout_internal": 2, "series_p": 3, "series_n": 2,
        }}
        cache = {}
        with tempfile.TemporaryDirectory() as folder:
            d1 = Path(folder) / "XS_FUNC_Y_D1.sp"
            d8 = Path(folder) / "XS_FUNC_Y_D8.sp"
            d1.write_text("fixture")
            d8.write_text("fixture")
            with patch("mock_liberty_calibration.generated_arc_topology", return_value=topology):
                calibrated_d1, _base, _drive, _factor = calibrate_prediction(
                    prediction, d1, policy, {"anchors_ns": {2: 0.03}}, cache)
                calibrated_d8, _base, _drive, _factor = calibrate_prediction(
                    prediction, d8, policy, {"anchors_ns": {2: 0.03}}, cache)
        rise_d1 = calibrated_d1["arcs"][0]["tables"]["cell_rise"]
        rise_d8 = calibrated_d8["arcs"][0]["tables"]["cell_rise"]
        self.assertLess(max(max(row) for row in rise_d8), max(max(row) for row in rise_d1))
        self.assertEqual(0.016, calibrated_d8["arcs"][0]["scalars"]["cap"])
        self.assertEqual(0.032, calibrated_d8["arcs"][0]["index_2"][-1])
        self.assertLess(
            calibrated_d8["mock_calibration"]["output_resistance_ns_per_pf"]["Y"],
            calibrated_d1["mock_calibration"]["output_resistance_ns_per_pf"]["Y"],
        )
        self.assertTrue(demand_result("XS_FUNC_Y_D8", calibrated_d8, 0.04)["meets"])

    def test_family_gate_rejects_name_only_or_nonmonotonic_variants(self):
        rows = []
        for index, drive in enumerate(("D1", "D2", "D4", "D6", "D8"), start=1):
            rows.append({"family": "XS_F", "drive": drive, "area_um2": float(index),
                         "input_capacitance_pf": {"A": index * 0.001},
                         "max_load_pf": {"Y": index * 0.01},
                         "output_resistance_ns_per_pf": {"Y": 1.0 / index}})
        self.assertEqual(1, len(validate_electrical_families(rows)))
        rows[-1]["area_um2"] = rows[-2]["area_um2"]
        with self.assertRaisesRegex(ValueError, "strictly increase area"):
            validate_electrical_families(rows)


if __name__ == "__main__":
    unittest.main()
