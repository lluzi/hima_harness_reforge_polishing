from __future__ import annotations

import hashlib
import pathlib
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock


FLOW = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(FLOW))

import library_richness as lfr  # noqa: E402
import stages  # noqa: E402


def _artifact(path):
    return {
        "role": "mapped_netlist",
        "path": str(path),
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def _baseline_mapping(reference, augmented, reference_library, augmented_library):
    adoption = {"cell_census": {"DFF": 2}}
    return {
        "inputs": {
            "libraries": {
                "reference": reference_library,
                "augmented": augmented_library,
            },
        },
        "arms": {
            "reference": {
                "artifacts": [_artifact(reference)],
                "adoption": adoption,
            },
            "augmented": {
                "artifacts": [_artifact(augmented)],
                "adoption": adoption,
            },
        },
    }


class ClockIdentityGuardTests(unittest.TestCase):
    def test_baseline_self_comparison_rejects_different_netlist_identity(self):
        with tempfile.TemporaryDirectory() as root:
            root = pathlib.Path(root)
            reference = root / "reference.v"
            augmented = root / "augmented.v"
            reference.write_text("module top; endmodule\n")
            augmented.write_text("module top; wire changed; endmodule\n")
            mapping = _baseline_mapping(
                reference, augmented, {"files": [{"sha256": "a" * 64}]},
                {"files": [{"sha256": "a" * 64}]},
            )
            with self.assertRaisesRegex(stages.Rejected, "different netlist"):
                stages._baseline_metrics(mapping, {}, object())

    def test_baseline_self_comparison_rejects_different_library_identity(self):
        with tempfile.TemporaryDirectory() as root:
            root = pathlib.Path(root)
            reference = root / "reference.v"
            augmented = root / "augmented.v"
            reference.write_text("module top; endmodule\n")
            augmented.write_bytes(reference.read_bytes())
            mapping = _baseline_mapping(
                reference, augmented, {"files": [{"sha256": "a" * 64}]},
                {"files": [{"sha256": "b" * 64}]},
            )
            with self.assertRaisesRegex(stages.Rejected, "Library"):
                stages._baseline_metrics(mapping, {}, object())

    def test_paired_round_rejects_different_clock_identity_before_metrics(self):
        common = {
            "clock_identity": {"root_clock": "clk"},
        }
        changed = {
            "clock_identity": {"root_clock": "other_clk"},
        }
        models = {
            "top": "top",
            "reference": SimpleNamespace(time_unit="1ns"),
            "augmented": SimpleNamespace(time_unit="1ns"),
        }
        with mock.patch.object(
            lfr,
            "analyze_mapped_netlist_reg2reg",
            side_effect=(common, changed),
        ), mock.patch.object(
            lfr,
            "_layered_metrics",
            side_effect=AssertionError("metrics must not run for incomparable clocks"),
        ):
            with self.assertRaisesRegex(
                lfr.IncomparableClockIdentity, "different clock identities"
            ):
                lfr._scenario_evaluation(
                    "nominal",
                    {
                        "unsupported_assumptions": [],
                        "initial_slew_ps": 1.0,
                        "wire_capacitance_in_library_units": 0.0,
                    },
                    {"clock_period_ps": 1000.0, "uncertainty_ps": 0.0},
                    models,
                    {"reference": "reference", "augmented": "augmented"},
                    {"reference": {}, "augmented": {}},
                    [],
                    {},
                    {"reference": {}, "augmented": {}},
                )


if __name__ == "__main__":
    unittest.main()
