#!/usr/bin/env python3
"""One hash-bound, license-free Library-richness evaluation-agent round.

The interface composes the existing paired Yosys/ABC mapper with the strict
mapped-netlist proxy STA.  Its result is screening evidence only: it never
claims commercial adoption, physical benefit, expected QoR, or Fmax improvement.
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


SCHEMA = "lfr-round/3"
RESULT_SCHEMA = "lfr-round-evaluation/3"
SCENARIOS = ("optimistic", "nominal", "conservative")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_TIME_UNIT = re.compile(
    r"^\s*(?:(\d+(?:\.\d*)?|\.\d+)\s*)?(fs|ps|ns|us)\s*$",
    re.IGNORECASE,
)
_SCENARIO_KEYS = frozenset({"initial_slew_ps", "wire_capacitance_in_library_units"})
_METRICS = frozenset({
    "F0.candidate_adoption_fraction",
    "F0.known_cell_fraction",
    "F0.function_class_count",
    "F2.mapped_instance_count",
    "F2.combinational_instance_count",
    "F2.max_logic_level",
    "F2.mean_fanout",
    "F2.mean_load_indicator",
    "F2.buffer_inverter_pressure_ratio",
    "F2.mean_path_stage_count",
    "F3.worst_delay_indicator_ps",
    "F3.negative_slack_mass_indicator_ps",
    "F3.path_family_coverage",
})
_PARETO_DIRECTIONS = {
    "F0.candidate_adoption_fraction": "maximize",
    "F0.known_cell_fraction": "maximize",
    "F2.mapped_instance_count": "minimize",
    "F2.combinational_instance_count": "minimize",
    "F2.max_logic_level": "minimize",
    "F2.mean_fanout": "minimize",
    "F2.mean_load_indicator": "minimize",
    "F2.buffer_inverter_pressure_ratio": "minimize",
    "F2.mean_path_stage_count": "minimize",
    "F3.worst_delay_indicator_ps": "minimize",
    "F3.negative_slack_mass_indicator_ps": "minimize",
}


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


def _integer(value: object, name: str, *, positive: bool = False) -> int:
    result = _number(value, name, positive=positive)
    if not result.is_integer():
        raise RoundRequestError(f"{name} must be an integer")
    return int(result)


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

    policy = _mapping(request.get("metric_policy"), "metric_policy")
    raw_objectives = policy.get("objectives")
    if not isinstance(raw_objectives, list) or not raw_objectives:
        raise RoundRequestError("metric_policy.objectives must be a non-empty array")
    objectives = []
    seen_metrics = set()
    for index, raw_item in enumerate(raw_objectives):
        item = _mapping(raw_item, f"metric_policy.objectives[{index}]")
        metric = _string(item.get("metric"), f"metric_policy.objectives[{index}].metric")
        direction = _string(item.get("direction"), f"metric_policy.objectives[{index}].direction")
        if metric not in _PARETO_DIRECTIONS:
            raise RoundRequestError(f"unsupported objective metric {metric!r}")
        canonical_direction = _PARETO_DIRECTIONS[metric]
        if direction != canonical_direction:
            raise RoundRequestError(
                f"metric_policy.objectives[{index}].direction for {metric} must be "
                f"system-owned canonical direction {canonical_direction!r}"
            )
        if metric in seen_metrics:
            raise RoundRequestError(f"metric_policy.objectives repeats {metric}")
        seen_metrics.add(metric)
        objectives.append({"metric": metric, "direction": canonical_direction})

    raw_required = policy.get("required_metrics")
    if not isinstance(raw_required, list) or not raw_required:
        raise RoundRequestError("metric_policy.required_metrics must be a non-empty array")
    required_metrics = [
        _string(value, f"metric_policy.required_metrics[{index}]")
        for index, value in enumerate(raw_required)
    ]
    if len(set(required_metrics)) != len(required_metrics):
        raise RoundRequestError("metric_policy.required_metrics contains duplicates")
    unsupported_required = sorted(set(required_metrics) - _METRICS)
    if unsupported_required:
        raise RoundRequestError(
            "metric_policy.required_metrics contains unsupported metrics: "
            + ", ".join(unsupported_required)
        )

    budgets = _mapping(request.get("budgets"), "budgets")
    budget_values = {
        "max_candidate_cells": _integer(
            budgets.get("max_candidate_cells"), "budgets.max_candidate_cells", positive=True
        ),
        "max_augmented_mapped_instances": _integer(
            budgets.get("max_augmented_mapped_instances"),
            "budgets.max_augmented_mapped_instances",
            positive=True,
        ),
    }
    if len(candidate_cells) > budget_values["max_candidate_cells"]:
        raise RoundRequestError(
            "candidate_cells exceeds budgets.max_candidate_cells before mapping"
        )

    comparison_source = request.get("comparison_evidence")
    comparison = None
    if comparison_source is not None:
        comparison_mapping = _mapping(comparison_source, "comparison_evidence")
        comparison = {
            "identity": _string(
                comparison_mapping.get("identity"), "comparison_evidence.identity"
            ),
            "sha256": _digest(
                comparison_mapping.get("sha256"), "comparison_evidence.sha256"
            ),
        }
    return {
        "mapping": dict(mapping_request),
        "bound_inputs": bound_inputs,
        "candidate_cells": sorted(candidate_cells),
        "timing": timing_values,
        "scenarios": scenarios,
        "metric_policy": {
            "objectives": objectives,
            "canonical_directions": dict(sorted(_PARETO_DIRECTIONS.items())),
            "required_metrics": sorted(required_metrics),
        },
        "budgets": budget_values,
        "comparison_evidence": comparison,
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


def _distribution(values: Sequence[float]) -> dict[str, object]:
    ordered = sorted(float(value) for value in values)
    if not ordered:
        return {"count": 0, "min": None, "p50": None, "p90": None, "max": None, "mean": None}
    p50 = ordered[(len(ordered) - 1) // 2]
    p90 = ordered[max(0, math.ceil(0.9 * len(ordered)) - 1)]
    return {
        "count": len(ordered),
        "min": ordered[0],
        "p50": p50,
        "p90": p90,
        "max": ordered[-1],
        "mean": sum(ordered) / len(ordered),
    }


def _histogram(values: Sequence[int]) -> dict[str, int]:
    result: dict[str, int] = {}
    for value in sorted(values):
        key = str(value)
        result[key] = result.get(key, 0) + 1
    return result


def _structural_metrics(model: object, verilog_text: str, top: str,
                        wire_capacitance: float) -> dict[str, object]:
    from verilog_netlist import (  # type: ignore
        VerilogNetlistError,
        build_named_net_graph,
        top_instances,
    )

    try:
        instances = top_instances(verilog_text, top)
        graph = build_named_net_graph(
            instances,
            {name: cell.pin_directions for name, cell in model.cells.items()},
        )
    except VerilogNetlistError as error:
        raise LibertyTimingError(str(error)) from error

    census: dict[str, int] = {}
    for instance in instances:
        census[instance.cell_type] = census.get(instance.cell_type, 0) + 1
    sequential_names = {
        instance.name for instance in instances if model.cell(instance.cell_type).sequential
    }
    combinational = sorted(
        (instance for instance in instances if instance.name not in sequential_names),
        key=lambda item: item.name,
    )

    net_depth = {net: 0 for net in graph.sinks if net not in graph.drivers}
    for instance in instances:
        if instance.name not in sequential_names:
            continue
        cell = model.cell(instance.cell_type)
        for pin in cell.sequential_outputs:
            net = instance.conns.get(pin)
            if net:
                net_depth[net] = 0
    unresolved = {instance.name: instance for instance in combinational}
    levels: dict[str, int] = {}
    while unresolved:
        progressed = False
        for name in sorted(list(unresolved)):
            instance = unresolved[name]
            cell = model.cell(instance.cell_type)
            inputs = [
                instance.conns[pin]
                for pin, direction in cell.pin_directions.items()
                if direction == "input"
            ]
            if any(net not in net_depth for net in inputs):
                continue
            level = 1 + max((net_depth[net] for net in inputs), default=0)
            levels[name] = level
            for pin, direction in cell.pin_directions.items():
                if direction == "output" and instance.conns.get(pin):
                    net_depth[instance.conns[pin]] = level
            del unresolved[name]
            progressed = True
        if not progressed:
            raise LibertyTimingError(
                "cannot derive complete combinational logic levels for "
                + ", ".join(sorted(unresolved))
            )

    driven_nets = sorted(graph.drivers)
    fanouts = [len(graph.sinks.get(net, ())) for net in driven_nets]
    loads = []
    for net in driven_nets:
        load = float(wire_capacitance)
        for sink in graph.sinks.get(net, ()):
            load += model.input_capacitance(sink.cell_type, sink.pin)
        loads.append(load)

    buffer_instances = 0
    inverter_instances = 0
    for cell_name, count in census.items():
        cell = model.cell(cell_name)
        if cell.sequential:
            continue
        inputs = [pin for pin, direction in cell.pin_directions.items() if direction == "input"]
        outputs = [pin for pin, direction in cell.pin_directions.items() if direction == "output"]
        if len(inputs) == 1 and len(outputs) == 1 and len(cell.arcs) == 1:
            if cell.arcs[0].timing_sense == "positive_unate":
                buffer_instances += count
            elif cell.arcs[0].timing_sense == "negative_unate":
                inverter_instances += count
    combinational_count = len(combinational)
    pressure_count = buffer_instances + inverter_instances
    return {
        "mapped_instance_count": len(instances),
        "cell_census": dict(sorted(census.items())),
        "sequential_instance_count": len(sequential_names),
        "combinational_instance_count": combinational_count,
        "logic_level_distribution": _histogram(list(levels.values())),
        "max_logic_level": max(levels.values(), default=0),
        "fanout_distribution": _distribution(fanouts),
        "mean_fanout": _distribution(fanouts)["mean"],
        "load_indicator_distribution": _distribution(loads),
        "mean_load_indicator": _distribution(loads)["mean"],
        "load_indicator_unit": model.capacitive_load_unit,
        "buffer_instance_count": buffer_instances,
        "inverter_instance_count": inverter_instances,
        "buffer_inverter_pressure_count": pressure_count,
        "buffer_inverter_pressure_ratio": (
            pressure_count / combinational_count if combinational_count else 0.0
        ),
    }


def _layered_metrics(model: object, verilog_text: str, top: str,
                     timing_result: Mapping[str, Any], unit_ps: float,
                     adoption: Mapping[str, Any], candidates: Sequence[str],
                     wire_capacitance: float) -> dict[str, object]:
    census = adoption["cell_census"]
    total_instances = sum(int(value) for value in census.values())
    unknown_instances = sum(int(census.get(cell, 0)) for cell in adoption["unknown_cells"])
    adopted_candidates = [cell for cell in candidates if census.get(cell, 0)]
    structural = _structural_metrics(model, verilog_text, top, wire_capacitance)
    path_stages = [len(path["stages"]) for path in timing_result["paths"]]
    structural["path_stage_distribution"] = _distribution(path_stages)
    structural["path_stage_histogram"] = _histogram(path_stages)
    structural["mean_path_stage_count"] = structural["path_stage_distribution"]["mean"]
    endpoint_families = sorted(timing_result["negative_slack_by_endpoint_family"])
    return {
        "F0": {
            "candidate_cells_declared": len(candidates),
            "candidate_cells_adopted": len(adopted_candidates),
            "candidate_adoption_fraction": len(adopted_candidates) / len(candidates),
            "candidate_instance_count": sum(int(census.get(cell, 0)) for cell in candidates),
            "mapped_cell_type_count": len(census),
            "known_cell_fraction": (
                (total_instances - unknown_instances) / total_instances if total_instances else 0.0
            ),
            "unknown_cells": list(adoption["unknown_cells"]),
            "function_class_count": len(adoption["function_class_census"]),
            "function_class_census": adoption["function_class_census"],
            "pin_interface_census": adoption["pin_interface_census"],
            "drive_variant_census": adoption["drive_variant_census"],
        },
        "F2": structural,
        "F3": {
            "indicator_only": True,
            "path_count": timing_result["path_count"],
            "worst_delay_indicator_ps": timing_result["worst_delay"] * unit_ps,
            "worst_slack_indicator_ps": timing_result["worst_slack"] * unit_ps,
            "negative_slack_mass_indicator_ps": timing_result["negative_slack_mass"] * unit_ps,
            "path_family_coverage": timing_result["endpoint_family_count"],
            "path_families": endpoint_families,
            "worst_path": _worst_path(timing_result),
        },
    }


def _migration(reference: Mapping[str, Any], augmented: Mapping[str, Any]) -> dict[str, object]:
    before = reference["F3"]["worst_path"]
    after = augmented["F3"]["worst_path"]
    before_families = set(reference["F3"]["path_families"])
    after_families = set(augmented["F3"]["path_families"])
    return {
        "changed": before != after,
        "endpoint_changed": before["endpoint"] != after["endpoint"],
        "endpoint_family_changed": before["endpoint_family"] != after["endpoint_family"],
        "launchpoint_changed": before["launchpoint"] != after["launchpoint"],
        "stage_cells_changed": before["stage_cells"] != after["stage_cells"],
        "path_families_added": sorted(after_families - before_families),
        "path_families_removed": sorted(before_families - after_families),
        "path_families_retained": sorted(before_families & after_families),
        "reference_worst": before,
        "augmented_worst": after,
    }


def _metric(metrics: Mapping[str, Any], name: str) -> float:
    layer, field = name.split(".", 1)
    value = metrics.get(layer, {}).get(field)
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise KeyError(name)
    return float(value)


def _metric_completeness(metrics: Mapping[str, Any], required: Sequence[str]) -> dict[str, object]:
    available = []
    missing = []
    for name in required:
        try:
            _metric(metrics, name)
            available.append(name)
        except KeyError:
            missing.append(name)
    return {
        "required": list(required),
        "available": available,
        "missing": missing,
        "fraction": len(available) / len(required),
        "complete": not missing,
    }


def _pairwise_relation(reference: Mapping[str, Any], augmented: Mapping[str, Any],
                       policy: Sequence[Mapping[str, str]]) -> dict[str, object]:
    comparisons = []
    better = worse = False
    for item in policy:
        name = item["metric"]
        direction = item["direction"]
        before = _metric(reference, name)
        after = _metric(augmented, name)
        relation = "equal"
        if after != before:
            improved = after < before if direction == "minimize" else after > before
            relation = "improved" if improved else "regressed"
            better = better or improved
            worse = worse or not improved
        comparisons.append({
            "metric": name,
            "direction": direction,
            "reference": before,
            "augmented": after,
            "augmented_minus_reference": after - before,
            "relation": relation,
        })
    relation = (
        "tradeoff" if better and worse
        else "augmented-dominates" if better
        else "reference-dominates" if worse
        else "equal"
    )
    return {"relation": relation, "comparisons": comparisons}


def _metric_changes(reference: Mapping[str, Any], augmented: Mapping[str, Any]) -> dict[str, float]:
    changes = {}
    for name in sorted(_METRICS):
        try:
            changes[name] = _metric(augmented, name) - _metric(reference, name)
        except KeyError:
            continue
    return changes


def _scenario_evaluation(
    name: str,
    assumptions: Mapping[str, object],
    timing: Mapping[str, float],
    models: Mapping[str, object],
    netlists: Mapping[str, str],
    adoptions: Mapping[str, Mapping[str, Any]],
    candidates: Sequence[str],
    metric_policy: Mapping[str, Any],
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
        summaries[arm] = _layered_metrics(
            model,
            netlists[arm],
            _string(models["top"], "top"),
            raw,
            unit_ps,
            adoptions[arm],
            candidates,
            float(assumptions["wire_capacitance_in_library_units"]),
        )
    required = metric_policy["required_metrics"]
    completeness = {
        arm: _metric_completeness(summaries[arm], required)
        for arm in ("reference", "augmented")
    }
    pairwise = _pairwise_relation(
        summaries["reference"], summaries["augmented"], metric_policy["objectives"]
    )
    return {
        "status": "succeeded",
        "assumptions": public_assumptions,
        "reference": summaries["reference"],
        "augmented": summaries["augmented"],
        "changes": _metric_changes(summaries["reference"], summaries["augmented"]),
        "metric_completeness": {
            **completeness,
            "complete": all(item["complete"] for item in completeness.values()),
        },
        "pairwise_relation": pairwise,
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


def _aggregate_pairwise_relation(scenarios: Mapping[str, Mapping[str, Any]]) -> dict[str, object]:
    relations = {
        name: scenario.get("pairwise_relation", {}).get("relation", "incomplete")
        for name, scenario in scenarios.items()
    }
    values = list(relations.values())
    if "incomplete" in values:
        relation = "incomplete"
    elif all(value == "equal" for value in values):
        relation = "equal"
    elif all(value in ("augmented-dominates", "equal") for value in values):
        relation = "augmented-dominates"
    elif all(value in ("reference-dominates", "equal") for value in values):
        relation = "reference-dominates"
    else:
        relation = "tradeoff"
    return {"relation": relation, "by_scenario": relations}


def _commercial_candidate(
    scenarios: Mapping[str, Mapping[str, Any]],
    aggregate_pairwise: Mapping[str, Any],
    adoption: Mapping[str, Any],
    budgets: Mapping[str, int],
) -> tuple[dict[str, object], dict[str, object]]:
    augmented_instances = sum(
        int(value) for value in adoption["augmented"]["cell_census"].values()
    )
    usage = {
        "candidate_cells": len(adoption["candidate_cells"]),
        "augmented_mapped_instances": augmented_instances,
    }
    violations = []
    if usage["candidate_cells"] > budgets["max_candidate_cells"]:
        violations.append("candidate-cell-budget-exceeded")
    if usage["augmented_mapped_instances"] > budgets["max_augmented_mapped_instances"]:
        violations.append("augmented-instance-budget-exceeded")
    budget_status = {
        "limits": dict(budgets),
        "usage": usage,
        "violations": violations,
        "within_budget": not violations,
    }

    reasons = []
    # A two-arm observation cannot establish membership in a portfolio frontier.
    # FW-07 must supply cross-candidate/cross-round evidence before this gate can open.
    blockers = ["portfolio-frontier-not-supplied"]
    if adoption["candidate_instance_count"] > 0:
        reasons.append("declared-candidate-adopted-by-open-source-mapper")
    else:
        blockers.append("no-declared-candidate-adoption")
    if adoption["candidate_cells_present_in_reference"]:
        blockers.append("declared-candidate-already-present-in-reference")
    complete = all(
        scenario.get("status") == "succeeded"
        and scenario.get("metric_completeness", {}).get("complete") is True
        for scenario in scenarios.values()
    )
    if complete:
        reasons.append("required-metric-vectors-complete")
    else:
        blockers.append("required-metric-vectors-incomplete")
    if budget_status["within_budget"]:
        reasons.append("evaluation-budgets-satisfied")
    else:
        blockers.extend(violations)
    relation = aggregate_pairwise["relation"]
    if relation in ("augmented-dominates", "tradeoff"):
        reasons.append(f"pairwise-relation:{relation}")
    else:
        blockers.append(f"pairwise-relation:{relation}")
    for scenario_name, scenario in scenarios.items():
        for item in scenario.get("pairwise_relation", {}).get("comparisons", []):
            if item["metric"].startswith("F3.") and item["relation"] == "regressed":
                blockers.append(f"f3-regression:{scenario_name}:{item['metric']}")
    nominal_improvements = [
        item["metric"]
        for item in scenarios.get("nominal", {}).get("pairwise_relation", {}).get("comparisons", [])
        if item["relation"] == "improved" and not item["metric"].startswith("F0.")
    ]
    if nominal_improvements:
        reasons.append("nominal-non-f0-indicator-improvement:" + ",".join(nominal_improvements))
    else:
        blockers.append("no-nominal-non-f0-indicator-improvement")
    candidate = {
        "value": not blockers,
        "meaning": "worth one commercial QoR observation; never an expected-benefit claim",
        "reasons": reasons,
        "blocking_reasons": blockers,
    }
    return candidate, budget_status


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
            "evidence_class": "license-free-evaluation-agent",
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
            "evidence_class": "license-free-evaluation-agent",
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

        adoptions = {
            arm: mapping_result["arms"][arm]["adoption"]
            for arm in ("reference", "augmented")
        }
        scenarios = {
            name: _scenario_evaluation(
                name,
                validated["scenarios"][name],
                validated["timing"],
                models,
                netlists,
                adoptions,
                validated["candidate_cells"],
                validated["metric_policy"],
            )
            for name in SCENARIOS
        }
        adoption = _mapping_adoption(mapping_result, validated["candidate_cells"])
        pairwise = _aggregate_pairwise_relation(scenarios)
        commercial_candidate, budget_status = _commercial_candidate(
            scenarios, pairwise, adoption, validated["budgets"]
        )
        completeness = {
            name: scenario.get("metric_completeness", {"complete": False})
            for name, scenario in scenarios.items()
        }

        result: dict[str, object] = {
            "schema": RESULT_SCHEMA,
            "status": "succeeded",
            "request_sha256": request_sha256,
            "evidence_class": "license-free-evaluation-agent",
            "claim_limits": {
                "fmax_claimed": False,
                "commercial_adoption_claimed": False,
                "physical_benefit_claimed": False,
                "expected_qor_claimed": False,
                "commercial_eda_executed": False,
            },
            "hashes": _hashes(validated, mapping_result, artifacts),
            "mapping_adoption": adoption,
            "metric_policy": validated["metric_policy"],
            "budgets": budget_status,
            "comparison_evidence": validated["comparison_evidence"],
            "scenarios": scenarios,
            "metric_completeness": {
                "by_scenario": completeness,
                "complete": all(item.get("complete") is True for item in completeness.values()),
            },
            "pairwise_relation": pairwise,
            "commercial_validation_candidate": commercial_candidate,
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
            "evidence_class": "license-free-evaluation-agent",
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
            "evidence_class": "license-free-evaluation-agent",
        }
        result["evaluation_payload_sha256"] = _sha256_bytes(_canonical_json(result))
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(_canonical_json(result))
    return 0 if result["status"] == "succeeded" else 2


if __name__ == "__main__":
    raise SystemExit(_main())
