from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

import pytest


FLOW = Path(__file__).resolve().parents[2]
DOMAIN = FLOW / "domain"
sys.path.insert(0, str(DOMAIN))

from _generation_projection import expected_generation_jobs  # noqa: E402


def _load_reader():
    spec = importlib.util.spec_from_file_location("lfr_read_stage", FLOW / "read-stage.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.expected_generation_jobs = expected_generation_jobs
    return module


def _write(path: Path, value) -> dict:
    data = value if isinstance(value, bytes) else (
        value.encode() if isinstance(value, str) else
        (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return {
        "path": str(path),
        "sha256": hashlib.sha256(data).hexdigest(),
        "bytes": len(data),
    }


def _fixture(workspace: Path):
    request = {
        "candidate_id": "CAND_FIX",
        "implementation_plan": {"route": "boolean_synthesis"},
        "generator_contract": {
            "implementation_request": {
                "drive_strengths": ["D1", "D2", "D4", "D6", "D8"],
            },
            "interface": {
                "inputs": [{"name": "A"}],
                "outputs": [{"name": "Y", "liberty_function": "A"}],
            },
        },
    }
    patterns = {"generation_requests": [request]}
    cells = [row["cell_name"] for row in expected_generation_jobs(patterns)]
    liberty = "/* MODELLED, NOT MEASURED */\nlibrary (generated) {\n" + "".join(
        "  cell (\"%s\") { }\n" % cell for cell in cells) + "}\n"
    calibration = {
        "schema": "hima.mock-liberty-calibration/1",
        "status": "rejected",
        "drive_variants": [{"cell": cell} for cell in cells],
        "electrical_families": [{
            "family": "XS_FIX_Y",
            "drives": ["D1", "D2", "D4", "D6", "D8"],
        }],
        "cell_demands": {
            "DEMAND_FIX": {
                "required_delay_ns": 0.005,
                "physical_cells": [
                    {"cell": cell, "model_delay_ns": 0.010, "meets": False}
                    for cell in cells
                ],
                "met_by_any_drive": False,
            },
        },
    }
    artifacts = []
    for role, name, value in (
            ("generated_liberty", "generated.lib", liberty),
            ("characterized_patterns", "patterns.json", patterns),
            ("mock_liberty_calibration", "calibration.json", calibration)):
        artifacts.append({"role": role, **_write(workspace / name, value)})
    record = {
        "artifacts": artifacts,
        "facts": {
            "predicted_cell_count": len(cells),
            "mock_liberty_calibration_status": "rejected",
            "mock_liberty_calibration_accepted": 0,
            "cell_demand_count": 1,
            "cell_demand_met_count": 0,
            "cell_demand_unmet_count": 1,
            "cell_demand_coverage_pct": 0.0,
        },
    }
    return record


def test_rejected_calibration_is_readable_feedback_instead_of_a_tool_dead_end():
    reader = _load_reader()
    with tempfile.TemporaryDirectory() as raw:
        workspace = Path(raw)
        values = reader.values_for(_fixture(workspace), workspace, "characterize")
    by_type = {row["type"]: row["value"] for row in values}
    assert by_type["mock_liberty_calibration_accepted"] == 0
    assert by_type["cell_demand_count"] == 1
    assert by_type["cell_demand_met_count"] == 0
    assert by_type["cell_demand_unmet_count"] == 1
    assert by_type["cell_demand_coverage_pct"] == 0.0


def test_rejected_status_must_match_the_independently_recomputed_demand_rows():
    reader = _load_reader()
    with tempfile.TemporaryDirectory() as raw:
        workspace = Path(raw)
        record = _fixture(workspace)
        calibration_ref = next(
            row for row in record["artifacts"] if row["role"] == "mock_liberty_calibration")
        path = Path(calibration_ref["path"])
        document = json.loads(path.read_text())
        document["status"] = "accepted"
        calibration_ref.update(_write(path, document))
        with pytest.raises(ValueError, match="not reproducible"):
            reader.values_for(record, workspace, "characterize")


def test_charlib_emitter_retains_a_rejected_report_without_exiting_nonzero():
    text = (DOMAIN / "charlib_emit.py").read_text()
    assert 'sys.exit("ERROR: Mock Liberty calibration does not meet every Cell Demand")' not in text
    assert "CALIBRATION REJECTED" in text
