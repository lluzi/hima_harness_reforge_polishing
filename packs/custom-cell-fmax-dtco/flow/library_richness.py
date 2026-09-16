#!/usr/bin/env python3
"""One hash-bound, license-free Library-richness round evaluation.

The interface composes the existing paired Yosys/ABC mapper with the strict
mapped-netlist proxy STA.  Its result is screening evidence only: it never
claims commercial adoption, physical benefit, or Fmax improvement.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence


FLOW_DIR = Path(__file__).resolve().parent
DOMAIN_DIR = FLOW_DIR / "domain"
if str(DOMAIN_DIR) not in sys.path:
    sys.path.insert(0, str(DOMAIN_DIR))

from proxy_mapping import map_reference_and_augmented  # type: ignore  # noqa: E402
from cell_need_miner.liberty_timing import (  # type: ignore  # noqa: E402
    LibertyTimingError,
    analyze_mapped_netlist_reg2reg,
    parse_liberty_timing,
)


SCHEMA = "lfr-round/1"
RESULT_SCHEMA = "lfr-round-evaluation/1"
SCENARIOS = ("optimistic", "nominal", "conservative")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_TIME_UNIT = re.compile(
    r"^\s*(?:(\d+(?:\.\d*)?|\.\d+)\s*)?(fs|ps|ns|us)\s*$",
    re.IGNORECASE,
)
_SCENARIO_KEYS = frozenset({"initial_slew_ps", "wire_capacitance_in_library_units"})


class RoundRequestError(ValueError):
    """The round request is incomplete, unbound, or internally inconsistent."""


def _canonical_json(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode()


def _sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _mapping(value: object, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise RoundRequestError(f"{name} must be an object")
    return value


def _string(value: object, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise RoundRequestError(f"{name} must be a non-empty string")
    return value


def _number(value: object, name: str, *, positive: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise RoundRequestError(f"{name} must be a number")
    result = float(value)
    if not math.isfinite(result):
        raise RoundRequestError(f"{name} must be finite")
    if positive and result <= 0.0:
        raise RoundRequestError(f"{name} must be greater than zero")
    if not positive and result < 0.0:
        raise RoundRequestError(f"{name} must be non-negative")
    return result


def _digest(value: object, name: str) -> str:
    result = _string(value, name).lower()
    if not _SHA256.fullmatch(result):
        raise RoundRequestError(f"{name} must be a lowercase SHA-256 digest")
    return result


def _path(value: object, name: str) -> Path:
    path = Path(_string(value, name)).expanduser().resolve()
    if not path.is_file():
        raise RoundRequestError(f"{name} does not name a regular file: {path}")
    return path


def _required_mapping_inputs(mapping_request: Mapping[str, Any]) -> list[Path]:
    paths: list[Path] = []
    rtl = mapping_request.get("rtl_files")
    if not isinstance(rtl, list) or not rtl:
        raise RoundRequestError("mapping.rtl_files must be a non-empty array")
    paths.extend(_path(value, f"mapping.rtl_files[{index}]") for index, value in enumerate(rtl))

    constraints = _mapping(mapping_request.get("constraints"), "mapping.constraints")
    sdc_files = constraints.get("sdc_files", [])
    if not isinstance(sdc_files, list):
        raise RoundRequestError("mapping.constraints.sdc_files must be an array")
    paths.extend(
        _path(value, f"mapping.constraints.sdc_files[{index}]")
        for index, value in enumerate(sdc_files)
    )

    libraries = _mapping(mapping_request.get("libraries"), "mapping.libraries")
    for arm in ("reference", "augmented"):
        library = _mapping(libraries.get(arm), f"mapping.libraries.{arm}")
        paths.append(_path(library.get("mapping"), f"mapping.libraries.{arm}.mapping"))
        support = library.get("support", [])
        if not isinstance(support, list):
            raise RoundRequestError(f"mapping.libraries.{arm}.support must be an array")
        paths.extend(
            _path(value, f"mapping.libraries.{arm}.support[{index}]")
            for index, value in enumerate(support)
        )
    # A reference Liberty may intentionally be reused as augmented support.
    # Bind each physical file once without changing either arm's declared set.
    return list(dict.fromkeys(paths))


def _bound_inputs(mapping_request: Mapping[str, Any], value: object) -> dict[str, str]:
    supplied = _mapping(value, "input_hashes")
    normalized: dict[str, str] = {}
    for raw_path, raw_digest in supplied.items():
        if not isinstance(raw_path, str):
            raise RoundRequestError("input_hashes keys must be file paths")
        path = str(Path(raw_path).expanduser().resolve())
        if path in normalized:
            raise RoundRequestError(f"input_hashes repeats canonical path {path}")
        normalized[path] = _digest(raw_digest, f"input_hashes[{raw_path!r}]")
    validated: dict[str, str] = {}
    for path in _required_mapping_inputs(mapping_request):
        expected = normalized.get(str(path))
        if expected is None:
            raise RoundRequestError(f"input_hashes does not bind required input {path}")
        actual = _sha256_file(path)
        if actual != expected:
            raise RoundRequestError(
                f"input hash mismatch for {path}: expected {expected}, observed {actual}"
            )
        validated[str(path)] = actual
    return dict(sorted(validated.items()))


def _validate_request(request: Mapping[str, object]) -> dict[str, object]:
    if request.get("schema") != SCHEMA:
        raise RoundRequestError(f"schema must be {SCHEMA!r}")
    mapping_request = _mapping(request.get("mapping"), "mapping")
    bound_inputs = _bound_inputs(mapping_request, request.get("input_hashes"))

    candidates = request.get("candidate_cells")
    if not isinstance(candidates, list) or not candidates:
        raise RoundRequestError("candidate_cells must be a non-empty array")
    candidate_cells = [_string(value, f"candidate_cells[{index}]") for index, value in enumerate(candidates)]
    if len(set(candidate_cells)) != len(candidate_cells):
        raise RoundRequestError("candidate_cells contains duplicates")

    timing = _mapping(request.get("timing"), "timing")
    timing_values = {
        "clock_period_ps": _number(timing.get("clock_period_ps"), "timing.clock_period_ps", positive=True),
        "uncertainty_ps": _number(timing.get("uncertainty_ps"), "timing.uncertainty_ps"),
    }
    if timing_values["uncertainty_ps"] >= timing_values["clock_period_ps"]:
        raise RoundRequestError("timing.uncertainty_ps must be less than clock_period_ps")

    raw_scenarios = _mapping(request.get("scenarios"), "scenarios")
    scenarios: dict[str, dict[str, object]] = {}
    for name in SCENARIOS:
        source = _mapping(raw_scenarios.get(name), f"scenarios.{name}")
        scenarios[name] = {
            "initial_slew_ps": _number(
                source.get("initial_slew_ps"), f"scenarios.{name}.initial_slew_ps"
            ),
            "wire_capacitance_in_library_units": _number(
                source.get("wire_capacitance_in_library_units"),
                f"scenarios.{name}.wire_capacitance_in_library_units",
            ),
            "unsupported_assumptions": sorted(set(source) - _SCENARIO_KEYS),
        }

    objective = _mapping(request.get("objective"), "objective")
    calibration = _mapping(request.get("calibration"), "calibration")
    calibration_status = _string(calibration.get("status"), "calibration.status")
    if calibration_status not in {"valid", "uncalibrated"}:
        raise RoundRequestError("calibration.status must be 'valid' or 'uncalibrated'")
    return {
        "mapping": dict(mapping_request),
        "bound_inputs": bound_inputs,
        "candidate_cells": sorted(candidate_cells),
        "timing": timing_values,
        "scenarios": scenarios,
        "objective": {
            "target_delta_ps": _number(
                objective.get("target_delta_ps"), "objective.target_delta_ps", positive=True
            ),
        },
        "calibration": {
            "status": calibration_status,
            "error_band_ps": _number(
                calibration.get("error_band_ps"), "calibration.error_band_ps"
            ),
            "scope": _string(calibration.get("scope"), "calibration.scope"),
            "evidence_sha256": _digest(
                calibration.get("evidence_sha256"), "calibration.evidence_sha256"
            ),
        },
    }


def _artifact(arm: Mapping[str, Any], role: str) -> dict[str, object]:
    matches = [item for item in arm.get("artifacts", []) if item.get("role") == role]
    if len(matches) != 1:
        raise RoundRequestError(f"mapping arm has {len(matches)} {role!r} artifacts")
    item = matches[0]
    path = _path(item.get("path"), f"mapping artifact {role}")
    expected = _digest(item.get("sha256"), f"mapping artifact {role}.sha256")
    actual = _sha256_file(path)
    if actual != expected:
        raise RoundRequestError(
            f"mapping artifact {role} changed after mapping: expected {expected}, observed {actual}"
        )
    return {"path": path, "sha256": actual, "bytes": path.stat().st_size}


def _time_unit_ps(unit: object) -> float:
    match = _TIME_UNIT.fullmatch(_string(unit, "Liberty time_unit"))
    if not match:
        raise RoundRequestError(f"unsupported Liberty time_unit {unit!r}")
    scale = float(match.group(1) or "1")
    return scale * {"fs": 0.001, "ps": 1.0, "ns": 1000.0, "us": 1_000_000.0}[match.group(2).lower()]


def _worst_path(result: Mapping[str, Any]) -> dict[str, object]:
    path = result["paths"][0]
    return {
        "launchpoint": path["launchpoint"],
        "endpoint": path["endpoint"],
        "endpoint_family": path["endpoint_family"],
        "stage_cells": [stage["cell"] for stage in path["stages"]],
        "stage_instances": [stage["instance"] for stage in path["stages"]],
    }


def _timing_summary(result: Mapping[str, Any], unit_ps: float) -> dict[str, object]:
    return {
        "path_count": result["path_count"],
        "endpoint_family_count": result["endpoint_family_count"],
        "worst_delay_ps": result["worst_delay"] * unit_ps,
        "worst_slack_ps": result["worst_slack"] * unit_ps,
        "negative_slack_mass_ps": result["negative_slack_mass"] * unit_ps,
        "worst_path": _worst_path(result),
    }


def _migration(reference: Mapping[str, Any], augmented: Mapping[str, Any]) -> dict[str, object]:
    before = reference["worst_path"]
    after = augmented["worst_path"]
    return {
        "changed": before != after,
        "endpoint_changed": before["endpoint"] != after["endpoint"],
        "endpoint_family_changed": before["endpoint_family"] != after["endpoint_family"],
        "launchpoint_changed": before["launchpoint"] != after["launchpoint"],
        "stage_cells_changed": before["stage_cells"] != after["stage_cells"],
        "reference_worst": before,
        "augmented_worst": after,
    }


def _scenario_evaluation(
    name: str,
    assumptions: Mapping[str, object],
    timing: Mapping[str, float],
    models: Mapping[str, object],
    netlists: Mapping[str, str],
) -> dict[str, object]:
    unsupported = list(assumptions["unsupported_assumptions"])  # type: ignore[arg-type]
    public_assumptions = {
        "clock_period_ps": timing["clock_period_ps"],
        "uncertainty_ps": timing["uncertainty_ps"],
        "initial_slew_ps": assumptions["initial_slew_ps"],
        "wire_capacitance_in_library_units": assumptions["wire_capacitance_in_library_units"],
    }
    if unsupported:
        return {
            "status": "unsupported",
            "assumptions": public_assumptions,
            "unsupported_assumptions": unsupported,
            "reason": (
                "the current NLDM proxy can vary measured slew/load coordinates only; "
                "it does not rescale measured Liberty arcs"
            ),
        }

    summaries: dict[str, dict[str, object]] = {}
    for arm in ("reference", "augmented"):
        model = models[arm]
        unit_ps = _time_unit_ps(model.time_unit)  # type: ignore[attr-defined]
        raw = analyze_mapped_netlist_reg2reg(
            model,
            netlists[arm],
            _string(models["top"], "top"),
            clock_period=timing["clock_period_ps"] / unit_ps,
            uncertainty=timing["uncertainty_ps"] / unit_ps,
            initial_slew=float(assumptions["initial_slew_ps"]) / unit_ps,
            wire_capacitance=float(assumptions["wire_capacitance_in_library_units"]),
        )
        summaries[arm] = _timing_summary(raw, unit_ps)
    predicted = summaries["reference"]["worst_delay_ps"] - summaries["augmented"]["worst_delay_ps"]
    slack_gain = summaries["augmented"]["worst_slack_ps"] - summaries["reference"]["worst_slack_ps"]
    mass_reduction = (
        summaries["reference"]["negative_slack_mass_ps"]
        - summaries["augmented"]["negative_slack_mass_ps"]
    )
    return {
        "status": "succeeded",
        "assumptions": public_assumptions,
        "reference": summaries["reference"],
        "augmented": summaries["augmented"],
        "predicted_delta_ps": predicted,
        "worst_slack_gain_ps": slack_gain,
        "negative_slack_mass_reduction_ps": mass_reduction,
        "direction": "improved" if predicted > 0.0 else "regressed" if predicted < 0.0 else "flat",
        "path_migration": _migration(summaries["reference"], summaries["augmented"]),
    }


def _mapping_adoption(mapping_result: Mapping[str, Any], candidates: Sequence[str]) -> dict[str, object]:
    reference = mapping_result["arms"]["reference"]["adoption"]
    augmented = mapping_result["arms"]["augmented"]["adoption"]
    reference_census = reference["cell_census"]
    augmented_census = augmented["cell_census"]
    adopted = {cell: int(augmented_census.get(cell, 0)) for cell in candidates if augmented_census.get(cell, 0)}
    leaked = {cell: int(reference_census.get(cell, 0)) for cell in candidates if reference_census.get(cell, 0)}
    return {
        "candidate_cells": list(candidates),
        "candidate_instances_in_augmented": dict(sorted(adopted.items())),
        "candidate_instance_count": sum(adopted.values()),
        "candidate_cells_present_in_reference": dict(sorted(leaked.items())),
        "reference": reference,
        "augmented": augmented,
    }


def _hashes(
    validated: Mapping[str, Any], mapping_result: Mapping[str, Any], artifacts: Mapping[str, Any]
) -> dict[str, object]:
    return {
        "validated_inputs": validated["bound_inputs"],
        "mapping_request_sha256": mapping_result["request_sha256"],
        "invariant_mapping_plan_sha256": mapping_result["script_audit"]["invariant_plan_sha256"],
        "tools": {
            name: mapping_result["tool_identity"][name]["sha256"]
            for name in ("yosys", "abc")
        },
        "libraries": {
            arm: mapping_result["inputs"]["libraries"][arm]["files"]
            for arm in ("reference", "augmented")
        },
        "outputs": {
            arm: {
                item["role"]: item["sha256"]
                for item in mapping_result["arms"][arm]["artifacts"]
            }
            for arm in ("reference", "augmented")
        },
        "mapped_netlists_revalidated": {
            arm: artifacts[arm]["sha256"] for arm in ("reference", "augmented")
        },
    }


def evaluate_round(request: Mapping[str, object]) -> dict[str, object]:
    """Evaluate one paired mapping/STA round and return deterministic proxy evidence."""
    request_sha256 = _sha256_bytes(_canonical_json(request))
    try:
        validated = _validate_request(request)
    except (RoundRequestError, OSError) as error:
        return {
            "schema": RESULT_SCHEMA,
            "status": "failed",
            "stage": "request",
            "request_sha256": request_sha256,
            "error": {"code": "invalid-request", "message": str(error)},
            "evidence_class": "license-free-proxy-screening",
        }

    mapping_result = map_reference_and_augmented(validated["mapping"])
    if mapping_result.get("status") != "succeeded":
        result = {
            "schema": RESULT_SCHEMA,
            "status": "failed",
            "stage": "mapping",
            "request_sha256": request_sha256,
            "mapping": mapping_result,
            "error": mapping_result.get("error", {"code": "mapping-failed", "message": "paired mapping failed"}),
            "evidence_class": "license-free-proxy-screening",
        }
        result["evaluation_payload_sha256"] = _sha256_bytes(_canonical_json(result))
        return result

    try:
        mapping_request = validated["mapping"]
        top = _string(mapping_request.get("top"), "mapping.top")
        libraries = _mapping(mapping_request.get("libraries"), "mapping.libraries")
        artifacts: dict[str, dict[str, object]] = {}
        models: dict[str, object] = {"top": top}
        netlists: dict[str, str] = {}
        for arm in ("reference", "augmented"):
            arm_result = mapping_result["arms"][arm]
            artifact = _artifact(arm_result, "mapped_netlist")
            artifacts[arm] = artifact
            netlists[arm] = artifact["path"].read_text(errors="replace")  # type: ignore[union-attr]
            library = _mapping(libraries.get(arm), f"mapping.libraries.{arm}")
            library_path = _path(library.get("mapping"), f"mapping.libraries.{arm}.mapping")
            required_cells = set(arm_result["adoption"]["cell_census"])
            models[arm] = parse_liberty_timing(library_path, required_cells)
        if models["reference"].capacitive_load_unit != models["augmented"].capacitive_load_unit:  # type: ignore[attr-defined]
            raise RoundRequestError(
                "reference and augmented Liberty capacitive_load_unit values differ; "
                "one wire-capacitance assumption would not be comparable"
            )

        scenarios = {
            name: _scenario_evaluation(
                name,
                validated["scenarios"][name],
                validated["timing"],
                models,
                netlists,
            )
            for name in SCENARIOS
        }
        adoption = _mapping_adoption(mapping_result, validated["candidate_cells"])
        target = validated["objective"]["target_delta_ps"]
        error_band = validated["calibration"]["error_band_ps"]
        nominal = scenarios["nominal"]
        nominal_delta = nominal.get("predicted_delta_ps") if nominal["status"] == "succeeded" else None
        margin = None if nominal_delta is None else nominal_delta - target - error_band

        residual: list[dict[str, str]] = []
        if validated["calibration"]["status"] != "valid":
            residual.append({
                "code": "calibration-unavailable",
                "detail": "proxy evidence has no applicable validated calibration error band",
            })
        if adoption["candidate_instance_count"] == 0:
            residual.append({"code": "no-candidate-adoption", "detail": "augmented mapping used no declared candidate Cell"})
        if adoption["candidate_cells_present_in_reference"]:
            residual.append({"code": "candidate-not-delta", "detail": "a declared candidate Cell is already present in reference mapping"})
        for name in SCENARIOS:
            scenario = scenarios[name]
            if scenario["status"] != "succeeded":
                residual.append({"code": f"scenario-unsupported:{name}", "detail": scenario["reason"]})
            elif scenario["predicted_delta_ps"] <= 0.0:
                residual.append({"code": f"scenario-not-improved:{name}", "detail": "augmented worst reg2reg delay did not improve"})
        if nominal_delta is not None and nominal_delta < target:
            residual.append({"code": "target-delta-not-met", "detail": "nominal predicted delta is below the requested target"})
        if margin is not None and margin <= 0.0:
            residual.append({"code": "calibration-margin-not-met", "detail": "nominal delta does not exceed target plus calibration error band"})
        exit_ready = not residual

        result: dict[str, object] = {
            "schema": RESULT_SCHEMA,
            "status": "succeeded",
            "request_sha256": request_sha256,
            "evidence_class": "license-free-proxy-screening",
            "claim_limits": {
                "fmax_claimed": False,
                "commercial_adoption_claimed": False,
                "physical_benefit_claimed": False,
                "commercial_eda_executed": False,
            },
            "hashes": _hashes(validated, mapping_result, artifacts),
            "mapping_adoption": adoption,
            "scenarios": scenarios,
            "objective": {
                "target_delta_ps": target,
                "calibration_error_band_ps": error_band,
                "calibration_status": validated["calibration"]["status"],
                "calibration_scope": validated["calibration"]["scope"],
                "calibration_evidence_sha256": validated["calibration"]["evidence_sha256"],
                "nominal_predicted_delta_ps": nominal_delta,
                "margin_ps": margin,
            },
            "path_migration": nominal.get("path_migration"),
            "residual_reasons": residual,
            "exit_ready": exit_ready,
            "stopping_reason": "proxy-exit-ready" if exit_ready else "proxy-evidence-insufficient",
            "mapping": mapping_result,
        }
        result["evaluation_payload_sha256"] = _sha256_bytes(_canonical_json(result))
        return result
    except (RoundRequestError, LibertyTimingError, OSError, KeyError, TypeError, ValueError) as error:
        result = {
            "schema": RESULT_SCHEMA,
            "status": "failed",
            "stage": "proxy-sta",
            "request_sha256": request_sha256,
            "mapping": mapping_result,
            "error": {"code": "proxy-sta-failed", "message": str(error)},
            "evidence_class": "license-free-proxy-screening",
        }
        result["evaluation_payload_sha256"] = _sha256_bytes(_canonical_json(result))
        return result


def _main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", required=True, help="JSON request path")
    parser.add_argument("--output", required=True, help="JSON evaluation path")
    arguments = parser.parse_args(argv)
    output = Path(arguments.output).expanduser().resolve()
    try:
        request = json.loads(Path(arguments.request).read_text())
        if not isinstance(request, Mapping):
            raise RoundRequestError("request JSON root must be an object")
        result = evaluate_round(request)
    except (OSError, json.JSONDecodeError, RoundRequestError) as error:
        result = {
            "schema": RESULT_SCHEMA,
            "status": "failed",
            "stage": "request",
            "error": {"code": "invalid-json", "message": str(error)},
            "evidence_class": "license-free-proxy-screening",
        }
        result["evaluation_payload_sha256"] = _sha256_bytes(_canonical_json(result))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(_canonical_json(result))
    return 0 if result["status"] == "succeeded" else 2


if __name__ == "__main__":
    raise SystemExit(_main())
