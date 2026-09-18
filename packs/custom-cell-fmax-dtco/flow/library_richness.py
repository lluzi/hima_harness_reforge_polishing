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
from _generation_projection import physical_cell_names, validate_cumulative_manifest  # type: ignore  # noqa: E402
from cell_need_miner.liberty_timing import (  # type: ignore  # noqa: E402
    LibertyTimingError,
    analyze_mapped_netlist_reg2reg,
    parse_liberty_timing,
)


SCHEMA = "lfr-round/3"
RESULT_SCHEMA = "lfr-round-evaluation/3"
FRONTIER_REQUEST_SCHEMA = "lfr-frontier-request/1"
FRONTIER_RESULT_SCHEMA = "lfr-frontier-evaluation/1"
CGO_REQUEST_SCHEMA = "hima.lfr-cumulative-gain-request/1"
CGO_RESULT_SCHEMA = "hima.lfr-cumulative-gain-evaluation/1"
SCENARIOS = ("optimistic", "nominal", "conservative")
FREE_FACTOR_LAYERS = ("F1", "F2", "F3")
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
    "F1.levels_removed",
    "F1.nodes_removed",
    "F1.edges_removed",
    "F1.cut_width_max",
    "F1.reconvergence_coverage",
    "F1.dominator_endpoint_coverage",
    "F1.overlap_ratio",
    "F1.new_library_cells",
    "F1.generation_units",
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
    "F1.levels_removed": "maximize",
    "F1.nodes_removed": "maximize",
    "F1.edges_removed": "maximize",
    "F1.reconvergence_coverage": "maximize",
    "F1.dominator_endpoint_coverage": "maximize",
    "F1.overlap_ratio": "minimize",
    "F1.new_library_cells": "minimize",
    "F1.generation_units": "minimize",
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
_F1_REQUIRED_METRICS = frozenset({
    "F1.levels_removed",
    "F1.nodes_removed",
    "F1.edges_removed",
    "F1.cut_width_max",
    "F1.reconvergence_coverage",
    "F1.dominator_endpoint_coverage",
    "F1.overlap_ratio",
    "F1.new_library_cells",
    "F1.generation_units",
})
_COST_DIRECTIONS = {
    "cost.cumulative_new_library_cells": "minimize",
    "cost.cumulative_generation_units": "minimize",
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


def required_mapping_input_paths(mapping_request: Mapping[str, Any]) -> list[Path]:
    """Return the exact files one round request must bind by SHA-256.

    Pack integration uses this narrow public seam instead of duplicating the
    Framework's input-enumeration policy.
    """
    return _required_mapping_inputs(mapping_request)


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


def _candidate_function_bindings(value: object) -> dict[str, dict[str, object]]:
    if not isinstance(value, list) or not value:
        raise RoundRequestError("candidate_functions must be a non-empty array")
    bindings: dict[str, dict[str, object]] = {}
    for index, raw in enumerate(value):
        item = _mapping(raw, f"candidate_functions[{index}]")
        candidate_id = _string(item.get("candidate_id"), f"candidate_functions[{index}].candidate_id")
        if candidate_id in bindings:
            raise RoundRequestError(f"candidate_functions repeats candidate_id {candidate_id}")
        raw_cells = item.get("candidate_cells")
        if not isinstance(raw_cells, list) or not raw_cells:
            raise RoundRequestError(f"candidate_functions[{index}].candidate_cells must be non-empty")
        cells = [
            _string(cell, f"candidate_functions[{index}].candidate_cells[{cell_index}]")
            for cell_index, cell in enumerate(raw_cells)
        ]
        if len(set(cells)) != len(cells):
            raise RoundRequestError(f"candidate_functions[{index}].candidate_cells contains duplicates")
        identity = _mapping(item.get("identity"), f"candidate_functions[{index}].identity")
        if identity.get("schema") != "hima.library-richness.candidate-identity/1":
            raise RoundRequestError(
                f"candidate_functions[{index}].identity has an unsupported schema"
            )
        selected = item.get("selected")
        if not isinstance(selected, bool):
            raise RoundRequestError(f"candidate_functions[{index}].selected must be boolean")
        bindings[candidate_id] = {
            "candidate_id": candidate_id,
            "candidate_cells": sorted(cells),
            "identity": dict(identity),
            "selected": selected,
        }
    return bindings


def _portfolio_candidate_cells(candidate: Mapping[str, Any], name: str) -> list[str]:
    source = _mapping(candidate.get("source_generation_request"), f"{name}.source_generation_request")
    candidate_id = _string(source.get("candidate_id"), f"{name}.source_generation_request.candidate_id")
    contract = _mapping(source.get("generator_contract"), f"{name}.source_generation_request.generator_contract")
    interface = _mapping(contract.get("interface"), f"{name}.source_generation_request.generator_contract.interface")
    outputs = interface.get("outputs")
    if not isinstance(outputs, list) or not outputs:
        raise RoundRequestError(f"{name} has no generator output identity")
    for index, raw_output in enumerate(outputs):
        output = _mapping(raw_output, f"{name}.outputs[{index}]")
        _string(output.get("name"), f"{name}.outputs[{index}].name")
    try:
        return sorted(physical_cell_names(source))
    except ValueError as error:
        raise RoundRequestError(f"{name} has invalid generation identity: {error}") from error


def _f1_vector(evaluation: Mapping[str, Any], name: str) -> tuple[dict[str, float], dict[str, float]]:
    candidate = _mapping(evaluation.get("candidate"), f"{name}.candidate")
    structural = _mapping(candidate.get("structural_metrics"), f"{name}.candidate.structural_metrics")
    cost = _mapping(candidate.get("library_cost"), f"{name}.candidate.library_cost")
    raw = {
        "levels_removed": _number(structural.get("levels_removed"), f"{name}.levels_removed"),
        "nodes_removed": _number(structural.get("nodes_removed"), f"{name}.nodes_removed"),
        "edges_removed": _number(structural.get("edges_removed"), f"{name}.edges_removed"),
        "cut_width": _number(structural.get("cut_width"), f"{name}.cut_width", positive=True),
        "reconvergence_coverage": _number(
            structural.get("reconvergence_coverage"), f"{name}.reconvergence_coverage"
        ),
        "dominator_endpoint_coverage": _number(
            structural.get("dominator_endpoint_coverage"),
            f"{name}.dominator_endpoint_coverage",
        ),
        "overlap_ratio": _number(structural.get("overlap_ratio"), f"{name}.overlap_ratio"),
        "new_library_cells": _number(
            cost.get("new_library_cells"), f"{name}.new_library_cells", positive=True
        ),
        "generation_units": _number(
            cost.get("generation_units"), f"{name}.generation_units", positive=True
        ),
    }
    normalized = {
        "structural.levels_removed": raw["levels_removed"],
        "structural.nodes_removed": raw["nodes_removed"],
        "structural.edges_removed": raw["edges_removed"],
        "structural.cut_width": -raw["cut_width"],
        "structural.reconvergence_coverage": raw["reconvergence_coverage"],
        "structural.dominator_endpoint_coverage": raw["dominator_endpoint_coverage"],
        "structural.overlap_ratio": -raw["overlap_ratio"],
        "cost.new_library_cells": -raw["new_library_cells"],
        "cost.generation_units": -raw["generation_units"],
    }
    return raw, normalized


def _verify_f1_axes(actual_value: object, expected: Mapping[str, float], name: str) -> None:
    actual = _mapping(actual_value, name)
    for axis, expected_value in expected.items():
        value = actual.get(axis)
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(float(value))
            or not math.isclose(float(value), expected_value, rel_tol=0.0, abs_tol=1e-12)
        ):
            raise RoundRequestError(f"{name}.{axis} disagrees with candidate_evaluations")


def _portfolio_evidence(
    value: object,
    declared_cells: Sequence[str],
    declared_functions: object,
) -> dict[str, object]:
    reference = _mapping(value, "local_portfolio")
    path = _path(reference.get("path"), "local_portfolio.path")
    expected_sha256 = _digest(reference.get("sha256"), "local_portfolio.sha256")
    observed_sha256 = _sha256_file(path)
    if observed_sha256 != expected_sha256:
        raise RoundRequestError(
            f"local_portfolio hash mismatch: expected {expected_sha256}, observed {observed_sha256}"
        )
    try:
        document = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise RoundRequestError(f"local_portfolio is not valid JSON: {error}") from error
    portfolio = _mapping(document, "local_portfolio document")
    if portfolio.get("schema") != "hima.library-richness.portfolio/1":
        raise RoundRequestError("local_portfolio schema must be 'hima.library-richness.portfolio/1'")
    if portfolio.get("status") != "PRE_MAPPING_PLANNING":
        raise RoundRequestError("local_portfolio status must be PRE_MAPPING_PLANNING")
    claims = _mapping(portfolio.get("claims"), "local_portfolio.claims")
    required_claims = {
        "commercial_qor_prediction", "commercial_adoption",
        "post_route_benefit", "fmax_improvement",
    }
    if set(claims) != required_claims or any(value is not False for value in claims.values()):
        raise RoundRequestError("local_portfolio claims must contain only the four false claims")
    layers = _mapping(portfolio.get("evidence_layers"), "local_portfolio.evidence_layers")
    if layers.get("F1_local_structure") is not True:
        raise RoundRequestError("local_portfolio must carry true F1_local_structure evidence")

    bindings = _candidate_function_bindings(declared_functions)
    evaluations_value = portfolio.get("candidate_evaluations")
    selected_value = portfolio.get("selected")
    trace_value = portfolio.get("objective_trace")
    if not isinstance(evaluations_value, list) or not evaluations_value:
        raise RoundRequestError("local_portfolio.candidate_evaluations must be non-empty")
    if not isinstance(selected_value, list) or not selected_value:
        raise RoundRequestError("local_portfolio.selected must be non-empty")
    if not isinstance(trace_value, list) or not trace_value:
        raise RoundRequestError("local_portfolio.objective_trace must be non-empty")

    evaluations: dict[str, Mapping[str, Any]] = {}
    for index, raw in enumerate(evaluations_value):
        evaluation = _mapping(raw, f"local_portfolio.candidate_evaluations[{index}]")
        candidate_id = _string(
            evaluation.get("candidate_id"),
            f"local_portfolio.candidate_evaluations[{index}].candidate_id",
        )
        if candidate_id in evaluations:
            raise RoundRequestError(f"local_portfolio repeats candidate evaluation {candidate_id}")
        evaluations[candidate_id] = evaluation
    if set(evaluations) != set(bindings):
        raise RoundRequestError("candidate_functions identities do not match candidate_evaluations")

    selected: dict[str, Mapping[str, Any]] = {}
    for index, raw in enumerate(selected_value):
        row = _mapping(raw, f"local_portfolio.selected[{index}]")
        candidate_id = _string(row.get("candidate_id"), f"local_portfolio.selected[{index}].candidate_id")
        if candidate_id in selected:
            raise RoundRequestError(f"local_portfolio.selected repeats {candidate_id}")
        selected[candidate_id] = row
    selected_bindings = {candidate_id for candidate_id, row in bindings.items() if row["selected"]}
    if set(selected) != selected_bindings:
        raise RoundRequestError("selected portfolio identities do not match declared candidate cells")
    declared_selected_cells = sorted(
        cell for candidate_id in selected_bindings for cell in bindings[candidate_id]["candidate_cells"]
    )
    if declared_selected_cells != sorted(declared_cells):
        raise RoundRequestError("candidate_functions Cell identities do not match candidate_cells")

    trace: dict[str, Mapping[str, Any]] = {}
    ranks = []
    for index, raw in enumerate(trace_value):
        row = _mapping(raw, f"local_portfolio.objective_trace[{index}]")
        candidate_id = _string(row.get("candidate_id"), f"local_portfolio.objective_trace[{index}].candidate_id")
        if candidate_id in trace:
            raise RoundRequestError(f"local_portfolio.objective_trace repeats {candidate_id}")
        rank = _integer(row.get("rank"), f"local_portfolio.objective_trace[{index}].rank", positive=True)
        ranks.append(rank)
        trace[candidate_id] = row
    if set(trace) != set(selected) or sorted(ranks) != list(range(1, len(trace) + 1)):
        raise RoundRequestError("local_portfolio objective trace does not exactly rank selected candidates")

    vectors = []
    for candidate_id in sorted(evaluations):
        evaluation = evaluations[candidate_id]
        candidate = _mapping(evaluation.get("candidate"), f"candidate_evaluations[{candidate_id}].candidate")
        if candidate.get("candidate_id") != candidate_id:
            raise RoundRequestError(f"candidate_evaluations[{candidate_id}] candidate identity is inconsistent")
        binding = bindings[candidate_id]
        if candidate.get("identity") != binding["identity"]:
            raise RoundRequestError(f"candidate_evaluations[{candidate_id}] function identity mismatch")
        derived_cells = _portfolio_candidate_cells(candidate, f"candidate_evaluations[{candidate_id}].candidate")
        if derived_cells != binding["candidate_cells"]:
            raise RoundRequestError(f"candidate_evaluations[{candidate_id}] Cell identity mismatch")
        if candidate_id not in selected:
            continue
        if evaluation.get("rejection_reasons") != []:
            raise RoundRequestError(f"selected candidate {candidate_id} carries rejection reasons")
        selected_row = selected[candidate_id]
        if selected_row.get("identity") != binding["identity"]:
            raise RoundRequestError(f"selected[{candidate_id}] function identity mismatch")
        raw, normalized = _f1_vector(evaluation, f"candidate_evaluations[{candidate_id}]")
        multi_index = _mapping(evaluation.get("multi_index"), f"candidate_evaluations[{candidate_id}].multi_index")
        _verify_f1_axes(multi_index.get("axes"), normalized, f"candidate_evaluations[{candidate_id}].multi_index.axes")
        _verify_f1_axes(selected_row.get("pareto_axes"), normalized, f"selected[{candidate_id}].pareto_axes")
        _verify_f1_axes(trace[candidate_id].get("pareto_axes"), normalized, f"objective_trace[{candidate_id}].pareto_axes")
        vectors.append({"candidate_id": candidate_id, "candidate_cells": derived_cells, **raw})

    def aggregate(field: str, operation: str = "sum") -> float:
        values = [float(vector[field]) for vector in vectors]
        return max(values) if operation == "max" else sum(values)

    zero = {
        "selected_candidate_count": 0,
        "levels_removed": 0.0,
        "nodes_removed": 0.0,
        "edges_removed": 0.0,
        "cut_width_max": 0.0,
        "reconvergence_coverage": 0.0,
        "dominator_endpoint_coverage": 0.0,
        "overlap_ratio": 0.0,
        "new_library_cells": 0.0,
        "generation_units": 0.0,
        "candidate_vectors": [],
        "interpretation": "reference baseline has no candidate transformation",
    }
    augmented = {
        "selected_candidate_count": len(vectors),
        "levels_removed": aggregate("levels_removed", "max"),
        "nodes_removed": aggregate("nodes_removed", "max"),
        "edges_removed": aggregate("edges_removed", "max"),
        "cut_width_max": aggregate("cut_width", "max"),
        "reconvergence_coverage": aggregate("reconvergence_coverage", "max"),
        "dominator_endpoint_coverage": aggregate("dominator_endpoint_coverage", "max"),
        "overlap_ratio": aggregate("overlap_ratio", "max"),
        "new_library_cells": aggregate("new_library_cells"),
        "generation_units": aggregate("generation_units"),
        "candidate_vectors": vectors,
        "aggregation": {
            "additive": ["new_library_cells", "generation_units"],
            "maximum": [
                "levels_removed", "nodes_removed", "edges_removed", "cut_width_max",
                "reconvergence_coverage", "dominator_endpoint_coverage", "overlap_ratio",
            ],
            "reason": "pre-mapping local regions may overlap; structural raw axes are not summed",
        },
        "interpretation": "pre-mapping local transformation evidence, not whole-design QoR",
    }
    return {
        "source": {"path": str(path), "sha256": observed_sha256},
        "selected_candidate_ids": sorted(selected),
        "reference": zero,
        "augmented": augmented,
    }


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
    local_portfolio = _portfolio_evidence(
        request.get("local_portfolio"),
        candidate_cells,
        request.get("candidate_functions"),
    )

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
    required_metrics = sorted(set(required_metrics) | _F1_REQUIRED_METRICS)

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
        "local_portfolio": local_portfolio,
        "timing": timing_values,
        "scenarios": scenarios,
        "metric_policy": {
            "objectives": objectives,
            "canonical_directions": dict(sorted(_PARETO_DIRECTIONS.items())),
            "required_metrics": required_metrics,
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
                     wire_capacitance: float,
                     f1: Mapping[str, Any]) -> dict[str, object]:
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
        "F1": dict(f1),
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
    local_portfolio: Mapping[str, Any],
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
            local_portfolio[arm],
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


def _free_factor_assessment(
    scenarios: Mapping[str, Mapping[str, Any]],
) -> dict[str, object]:
    """Classify parallel free factors without turning them into an E0 predictor."""
    factors: dict[str, dict[str, object]] = {}
    for layer in FREE_FACTOR_LAYERS:
        rows = [
            {"scenario": scenario_name, **comparison}
            for scenario_name in sorted(scenarios)
            for comparison in sorted(
                scenarios[scenario_name].get("pairwise_relation", {}).get("comparisons", []),
                key=lambda row: (str(row.get("metric")), str(row.get("relation"))))
            if comparison.get("metric", "").startswith(layer + ".")
        ]
        relations = {row["relation"] for row in rows}
        improved = "improved" in relations
        regressed = "regressed" in relations
        if not rows:
            status = "unknown"
        elif improved and regressed:
            status = "mixed"
        elif improved:
            status = "positive"
        elif regressed:
            status = "negative"
        else:
            status = "neutral"
        factors[layer] = {
            "status": status,
            "explicitly_negative": status == "negative",
            "observations": rows,
        }
    all_negative = all(
        factors[layer]["explicitly_negative"] is True for layer in FREE_FACTOR_LAYERS
    )
    return {
        "unit_of_analysis": "candidate-library-round",
        "parallel_factors": list(FREE_FACTOR_LAYERS),
        "factors": factors,
        "all_parallel_factors_explicitly_negative": all_negative,
        "passes_free_factor_gate": not all_negative,
        "expensive_outcome": "E0",
    }


def _e0_library_candidate(
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
        reasons.append("candidate-library-adopted-by-open-source-mapper")
    else:
        reasons.append("candidate-library-not-adopted-by-open-source-mapper:F2-negative-evidence")
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
    reasons.append(f"pairwise-relation:{relation}")
    factors = _free_factor_assessment(scenarios)
    reasons.extend(
        f"free-factor:{layer}:{factors['factors'][layer]['status']}"
        for layer in FREE_FACTOR_LAYERS
    )
    unobserved = [
        layer for layer in FREE_FACTOR_LAYERS
        if factors["factors"][layer]["status"] == "unknown"
    ]
    if unobserved:
        blockers.extend("free-factor-unobserved:" + layer for layer in unobserved)
    elif factors["all_parallel_factors_explicitly_negative"]:
        blockers.append("all-free-factors-explicitly-negative")
    candidate = {
        "value": not blockers,
        "unit_of_analysis": "candidate-library-round",
        "validation_layer": "E0",
        "meaning": "candidate Library is eligible for one expensive commercial observation; never an expected-benefit claim",
        "factor_assessment": factors,
        "reasons": reasons,
        "blocking_reasons": blockers,
    }
    return candidate, budget_status


def _verified_evaluation_payload(value: object, name: str) -> Mapping[str, Any]:
    """Verify one immutable round result without trusting its declared digest."""
    evaluation = _mapping(value, name)
    if evaluation.get("schema") != RESULT_SCHEMA:
        raise RoundRequestError(f"{name}.schema must be {RESULT_SCHEMA!r}")
    if evaluation.get("status") != "succeeded":
        raise RoundRequestError(f"{name} must be a successful round evaluation")
    expected = _digest(
        evaluation.get("evaluation_payload_sha256"),
        f"{name}.evaluation_payload_sha256",
    )
    payload = dict(evaluation)
    del payload["evaluation_payload_sha256"]
    observed = _sha256_bytes(_canonical_json(payload))
    if observed != expected:
        raise RoundRequestError(
            f"{name} payload hash mismatch: expected {expected}, observed {observed}"
        )
    limits = _mapping(evaluation.get("claim_limits"), f"{name}.claim_limits")
    forbidden_claims = (
        "fmax_claimed",
        "commercial_adoption_claimed",
        "physical_benefit_claimed",
        "expected_qor_claimed",
        "commercial_eda_executed",
    )
    asserted = [claim for claim in forbidden_claims if limits.get(claim) is not False]
    if asserted:
        raise RoundRequestError(
            f"{name} does not preserve license-free claim limits: " + ", ".join(asserted)
        )
    return evaluation


def _evaluation_identities(
    evaluation: Mapping[str, Any],
) -> tuple[str, dict[str, object], dict[str, object]]:
    """Separate stable experiment identity from the cumulative Library lineage."""
    hashes = _mapping(evaluation.get("hashes"), "evaluation.hashes")
    tools = _mapping(hashes.get("tools"), "evaluation.hashes.tools")
    libraries = _mapping(hashes.get("libraries"), "evaluation.hashes.libraries")
    outputs = _mapping(hashes.get("mapped_netlists_revalidated"),
                       "evaluation.hashes.mapped_netlists_revalidated")
    library_hashes = {}
    for arm in ("reference", "augmented"):
        arm_libraries = libraries.get(arm)
        if not isinstance(arm_libraries, list) or not arm_libraries:
            raise RoundRequestError(f"evaluation.hashes.libraries.{arm} must be non-empty")
        library_hashes[arm] = sorted(
            _digest(
                _mapping(item_value, f"evaluation.hashes.libraries.{arm}[{index}]").get("sha256"),
                f"evaluation.hashes.libraries.{arm}[{index}].sha256",
            )
            for index, item_value in enumerate(arm_libraries)
        )
    mapping = _mapping(evaluation.get("mapping"), "evaluation.mapping")
    inputs = _mapping(mapping.get("inputs"), "evaluation.mapping.inputs")
    rtl_value = inputs.get("rtl")
    if not isinstance(rtl_value, list) or not rtl_value:
        raise RoundRequestError("evaluation mapping RTL identity is missing")
    rtl_hashes = sorted(
        _digest(
            _mapping(item_value, f"evaluation.mapping.inputs.rtl[{index}]").get("sha256"),
            f"evaluation.mapping.inputs.rtl[{index}].sha256",
        )
        for index, item_value in enumerate(rtl_value)
    )
    top = _string(inputs.get("top"), "evaluation.mapping.inputs.top")
    output_hashes = _mapping(hashes.get("outputs"), "evaluation.hashes.outputs")
    reference_outputs = _mapping(
        output_hashes.get("reference"), "evaluation.hashes.outputs.reference"
    )
    scenario_identity = {}
    scenarios = _mapping(evaluation.get("scenarios"), "evaluation.scenarios")
    for scenario_name in SCENARIOS:
        scenario = _mapping(scenarios.get(scenario_name), f"evaluation.scenarios.{scenario_name}")
        scenario_identity[scenario_name] = _mapping(
            scenario.get("assumptions"),
            f"evaluation.scenarios.{scenario_name}.assumptions",
        )
    stable_identity = {
        "tools": {
            "yosys": _digest(tools.get("yosys"), "evaluation.hashes.tools.yosys"),
            "abc": _digest(tools.get("abc"), "evaluation.hashes.tools.abc"),
        },
        "invariant_mapping_plan_sha256": _digest(
            hashes.get("invariant_mapping_plan_sha256"),
            "evaluation.hashes.invariant_mapping_plan_sha256",
        ),
        "design": {"top": top, "rtl_sha256": rtl_hashes},
        "constraints_sha256": _digest(
            reference_outputs.get("abc_constraints"),
            "evaluation.hashes.outputs.reference.abc_constraints",
        ),
        "scenarios": scenario_identity,
    }
    lineage = {
        "reference_library_sha256": library_hashes["reference"],
        "augmented_library_sha256": library_hashes["augmented"],
        "reference_mapped_netlist_sha256": _digest(
            outputs.get("reference"),
            "evaluation.hashes.mapped_netlists_revalidated.reference",
        ),
        "augmented_mapped_netlist_sha256": _digest(
            outputs.get("augmented"),
            "evaluation.hashes.mapped_netlists_revalidated.augmented",
        ),
    }
    return _sha256_bytes(_canonical_json(stable_identity)), stable_identity, lineage


def _frontier_metric_vector(
    evaluation: Mapping[str, Any],
) -> tuple[dict[str, float], dict[str, float], dict[str, str], list[str]]:
    """Return raw and maximize-normalized pairwise changes for system-owned axes."""
    policy = _mapping(evaluation.get("metric_policy"), "evaluation.metric_policy")
    objectives_value = policy.get("objectives")
    if not isinstance(objectives_value, list) or not objectives_value:
        raise RoundRequestError("evaluation.metric_policy.objectives must be non-empty")
    objectives: dict[str, str] = {}
    for index, item_value in enumerate(objectives_value):
        item = _mapping(item_value, f"evaluation.metric_policy.objectives[{index}]")
        metric = _string(item.get("metric"), f"evaluation.metric_policy.objectives[{index}].metric")
        direction = _string(
            item.get("direction"),
            f"evaluation.metric_policy.objectives[{index}].direction",
        )
        canonical = _PARETO_DIRECTIONS.get(metric)
        if canonical is None or direction != canonical:
            raise RoundRequestError(
                f"evaluation objective {metric!r} does not use its system-owned direction"
            )
        if metric in objectives:
            raise RoundRequestError(f"evaluation objective repeats {metric}")
        objectives[metric] = canonical

    raw: dict[str, float] = {}
    normalized: dict[str, float] = {}
    directions: dict[str, str] = {}
    f3_regressions: list[str] = []
    scenarios = _mapping(evaluation.get("scenarios"), "evaluation.scenarios")
    for scenario_name in SCENARIOS:
        scenario = _mapping(scenarios.get(scenario_name), f"evaluation.scenarios.{scenario_name}")
        if scenario.get("status") != "succeeded":
            raise RoundRequestError(f"evaluation scenario {scenario_name} did not succeed")
        reference = _mapping(scenario.get("reference"), f"evaluation.scenarios.{scenario_name}.reference")
        augmented = _mapping(scenario.get("augmented"), f"evaluation.scenarios.{scenario_name}.augmented")
        for metric in sorted(objectives):
            before = _metric(reference, metric)
            after = _metric(augmented, metric)
            change = after - before
            axis = f"{scenario_name}:{metric}"
            direction = objectives[metric]
            raw[axis] = change
            normalized[axis] = change if direction == "maximize" else -change
            directions[axis] = direction
            if metric.startswith("F3.") and normalized[axis] < 0.0:
                f3_regressions.append(axis)
    return raw, normalized, directions, f3_regressions


def _frontier_cost(value: object, name: str) -> dict[str, float | int]:
    cost = _mapping(value, name)
    return {
        "new_library_cells": _integer(
            cost.get("new_library_cells"), f"{name}.new_library_cells"
        ),
        "generation_units": _number(
            cost.get("generation_units"), f"{name}.generation_units"
        ),
    }


def _research_question(value: object, name: str) -> dict[str, str]:
    question = _mapping(value, name)
    return {
        "id": _string(question.get("id"), f"{name}.id"),
        "prompt": _string(question.get("prompt"), f"{name}.prompt"),
    }


def _dominates(left: Mapping[str, float], right: Mapping[str, float]) -> bool:
    if set(left) != set(right):
        raise RoundRequestError("frontier metric vectors use different axes")
    return all(left[name] >= right[name] for name in left) and any(
        left[name] > right[name] for name in left
    )


def _recomputed_round_facts(evaluation: Mapping[str, Any]) -> dict[str, object]:
    """Recompute every validation fact; self-declared gates are never authority."""
    policy = _mapping(evaluation.get("metric_policy"), "evaluation.metric_policy")
    objectives_value = policy.get("objectives")
    required_value = policy.get("required_metrics")
    if not isinstance(objectives_value, list) or not objectives_value:
        raise RoundRequestError("evaluation metric objectives are missing")
    if not isinstance(required_value, list) or not required_value:
        raise RoundRequestError("evaluation required metrics are missing")
    objectives = []
    for index, value in enumerate(objectives_value):
        item = _mapping(value, f"evaluation.metric_policy.objectives[{index}]")
        metric = _string(item.get("metric"), f"evaluation.metric_policy.objectives[{index}].metric")
        direction = _string(
            item.get("direction"), f"evaluation.metric_policy.objectives[{index}].direction"
        )
        canonical = _PARETO_DIRECTIONS.get(metric)
        if canonical is None or canonical != direction:
            raise RoundRequestError(f"evaluation objective {metric!r} has a noncanonical direction")
        objectives.append({"metric": metric, "direction": direction})
    required = [
        _string(value, f"evaluation.metric_policy.required_metrics[{index}]")
        for index, value in enumerate(required_value)
    ]

    scenarios = _mapping(evaluation.get("scenarios"), "evaluation.scenarios")
    computed_completeness: dict[str, dict[str, object]] = {}
    computed_pairwise: dict[str, dict[str, object]] = {}
    f3_regressions = []
    nominal_non_f0_improvements = []
    for scenario_name in SCENARIOS:
        scenario = _mapping(scenarios.get(scenario_name), f"evaluation.scenarios.{scenario_name}")
        if scenario.get("status") != "succeeded":
            raise RoundRequestError(f"evaluation scenario {scenario_name} did not succeed")
        reference = _mapping(scenario.get("reference"), f"evaluation.scenarios.{scenario_name}.reference")
        augmented = _mapping(scenario.get("augmented"), f"evaluation.scenarios.{scenario_name}.augmented")
        completeness = {
            arm: _metric_completeness(metrics, required)
            for arm, metrics in (("reference", reference), ("augmented", augmented))
        }
        completeness["complete"] = all(
            item["complete"] for item in completeness.values()
            if isinstance(item, Mapping)
        )
        pairwise = _pairwise_relation(reference, augmented, objectives)
        computed_completeness[scenario_name] = completeness
        computed_pairwise[scenario_name] = pairwise
        if scenario.get("metric_completeness") != completeness:
            raise RoundRequestError(
                f"evaluation scenario {scenario_name} metric completeness is internally inconsistent"
            )
        if scenario.get("pairwise_relation") != pairwise:
            raise RoundRequestError(
                f"evaluation scenario {scenario_name} pairwise relation is internally inconsistent"
            )
        for comparison in pairwise["comparisons"]:
            if comparison["metric"].startswith("F3.") and comparison["relation"] == "regressed":
                f3_regressions.append(f"{scenario_name}:{comparison['metric']}")
            if (
                scenario_name == "nominal"
                and not comparison["metric"].startswith("F0.")
                and comparison["relation"] == "improved"
            ):
                nominal_non_f0_improvements.append(comparison["metric"])
    complete = all(item["complete"] is True for item in computed_completeness.values())
    expected_top_completeness = {
        "by_scenario": computed_completeness,
        "complete": complete,
    }
    if evaluation.get("metric_completeness") != expected_top_completeness:
        raise RoundRequestError("evaluation top-level metric completeness is internally inconsistent")
    aggregate_pairwise = _aggregate_pairwise_relation({
        name: {"pairwise_relation": pairwise}
        for name, pairwise in computed_pairwise.items()
    })
    if evaluation.get("pairwise_relation") != aggregate_pairwise:
        raise RoundRequestError("evaluation aggregate pairwise relation is internally inconsistent")

    adoption = _mapping(evaluation.get("mapping_adoption"), "evaluation.mapping_adoption")
    candidate_cells_value = adoption.get("candidate_cells")
    if (
        not isinstance(candidate_cells_value, list)
        or not candidate_cells_value
        or not all(isinstance(cell, str) and cell for cell in candidate_cells_value)
        or len(set(candidate_cells_value)) != len(candidate_cells_value)
    ):
        raise RoundRequestError("evaluation candidate Cell identities are invalid")
    candidate_cells = list(candidate_cells_value)
    reference_adoption = _mapping(adoption.get("reference"), "evaluation.mapping_adoption.reference")
    augmented_adoption = _mapping(adoption.get("augmented"), "evaluation.mapping_adoption.augmented")
    reference_census = _mapping(
        reference_adoption.get("cell_census"), "evaluation.mapping_adoption.reference.cell_census"
    )
    augmented_census = _mapping(
        augmented_adoption.get("cell_census"), "evaluation.mapping_adoption.augmented.cell_census"
    )
    for arm_name, census in (("reference", reference_census), ("augmented", augmented_census)):
        if any(
            not isinstance(cell, str)
            or not cell
            or isinstance(count, bool)
            or not isinstance(count, int)
            or count < 0
            for cell, count in census.items()
        ):
            raise RoundRequestError(f"evaluation {arm_name} cell census is invalid")
    adopted = {
        cell: int(augmented_census.get(cell, 0))
        for cell in candidate_cells
        if augmented_census.get(cell, 0)
    }
    leaked = {
        cell: int(reference_census.get(cell, 0))
        for cell in candidate_cells
        if reference_census.get(cell, 0)
    }
    candidate_instance_count = sum(adopted.values())
    if adoption.get("candidate_instances_in_augmented") != dict(sorted(adopted.items())):
        raise RoundRequestError("evaluation candidate adoption census is internally inconsistent")
    if adoption.get("candidate_instance_count") != candidate_instance_count:
        raise RoundRequestError("evaluation candidate instance count is internally inconsistent")
    if adoption.get("candidate_cells_present_in_reference") != dict(sorted(leaked.items())):
        raise RoundRequestError("evaluation reference leakage is internally inconsistent")
    expected_adoption_fraction = len(adopted) / len(candidate_cells)
    expected_reference_fraction = len(leaked) / len(candidate_cells)
    for scenario_name in SCENARIOS:
        scenario = _mapping(scenarios.get(scenario_name), f"evaluation.scenarios.{scenario_name}")
        reference = _mapping(scenario.get("reference"), f"evaluation.scenarios.{scenario_name}.reference")
        augmented = _mapping(scenario.get("augmented"), f"evaluation.scenarios.{scenario_name}.augmented")
        if _metric(reference, "F0.candidate_adoption_fraction") != expected_reference_fraction:
            raise RoundRequestError(
                f"evaluation scenario {scenario_name} reference adoption metric is inconsistent"
            )
        if _metric(augmented, "F0.candidate_adoption_fraction") != expected_adoption_fraction:
            raise RoundRequestError(
                f"evaluation scenario {scenario_name} augmented adoption metric is inconsistent"
            )

    budget = _mapping(evaluation.get("budgets"), "evaluation.budgets")
    limits = _mapping(budget.get("limits"), "evaluation.budgets.limits")
    max_candidate_cells = _integer(
        limits.get("max_candidate_cells"),
        "evaluation.budgets.limits.max_candidate_cells",
        positive=True,
    )
    max_augmented_instances = _integer(
        limits.get("max_augmented_mapped_instances"),
        "evaluation.budgets.limits.max_augmented_mapped_instances",
        positive=True,
    )
    augmented_instance_count = sum(int(count) for count in augmented_census.values())
    usage = {
        "candidate_cells": len(candidate_cells),
        "augmented_mapped_instances": augmented_instance_count,
    }
    violations = []
    if usage["candidate_cells"] > max_candidate_cells:
        violations.append("candidate-cell-budget-exceeded")
    if usage["augmented_mapped_instances"] > max_augmented_instances:
        violations.append("augmented-instance-budget-exceeded")
    expected_budget = {
        "limits": {
            "max_candidate_cells": max_candidate_cells,
            "max_augmented_mapped_instances": max_augmented_instances,
        },
        "usage": usage,
        "violations": violations,
        "within_budget": not violations,
    }
    if budget != expected_budget:
        raise RoundRequestError("evaluation budget status is internally inconsistent")

    reasons = []
    blockers = []
    if candidate_instance_count > 0:
        reasons.append("candidate-library-adopted-by-open-source-mapper")
    else:
        reasons.append("candidate-library-not-adopted-by-open-source-mapper:F2-negative-evidence")
    if leaked:
        blockers.append("declared-candidate-already-present-in-reference")
    if complete:
        reasons.append("required-metric-vectors-complete")
    else:
        blockers.append("required-metric-vectors-incomplete")
    if not violations:
        reasons.append("evaluation-budgets-satisfied")
    else:
        blockers.extend(violations)
    relation = aggregate_pairwise["relation"]
    reasons.append(f"pairwise-relation:{relation}")
    factors = _free_factor_assessment(scenarios)
    reasons.extend(
        f"free-factor:{layer}:{factors['factors'][layer]['status']}"
        for layer in FREE_FACTOR_LAYERS
    )
    unobserved = [
        layer for layer in FREE_FACTOR_LAYERS
        if factors["factors"][layer]["status"] == "unknown"
    ]
    if unobserved:
        blockers.extend("free-factor-unobserved:" + layer for layer in unobserved)
    elif factors["all_parallel_factors_explicitly_negative"]:
        blockers.append("all-free-factors-explicitly-negative")
    return {
        "candidate_cells": candidate_cells,
        "candidate_instance_count": candidate_instance_count,
        "reference_leakage": dict(sorted(leaked.items())),
        "metric_complete": complete,
        "pairwise_relation": aggregate_pairwise,
        "f3_regressions": f3_regressions,
        "factor_assessment": factors,
        "evaluation_budget": expected_budget,
        "reasons": reasons,
        "blockers": blockers,
    }


def _manifest_candidate_cells(
    manifest_functions: Mapping[str, Mapping[str, Any]], function_keys: Sequence[str]
) -> list[str]:
    cells = []
    for key in sorted(set(function_keys)):
        row = manifest_functions.get(key)
        if row is None:
            continue
        physical_cells = row.get("physicalCellNames")
        if (
            not isinstance(physical_cells, list)
            or not physical_cells
            or not all(isinstance(cell, str) and cell for cell in physical_cells)
            or len(set(physical_cells)) != len(physical_cells)
        ):
            raise RoundRequestError(
                f"library function {key} has no unique physical Cell identity"
            )
        cells.extend(physical_cells)
    if len(set(cells)) != len(cells):
        raise RoundRequestError("Library manifest repeats a physical Cell identity")
    return sorted(cells)


def evaluate_frontier(request: Mapping[str, object]) -> dict[str, object]:
    """Maintain the hash-bound cross-round Pareto frontier for one Library.

    The interface consumes completed ``lfr-round-evaluation/3`` observations.
    It never predicts E0 commercial QoR. A positive validation candidate only
    means that one surviving Library frontier member is eligible for one expensive observation.
    """
    request_sha256 = _sha256_bytes(_canonical_json(request))
    try:
        if request.get("schema") != FRONTIER_REQUEST_SCHEMA:
            raise RoundRequestError(f"schema must be {FRONTIER_REQUEST_SCHEMA!r}")
        manifest = _mapping(request.get("library_manifest"), "library_manifest")
        try:
            validate_cumulative_manifest(dict(manifest))
        except ValueError as error:
            raise RoundRequestError(str(error)) from error
        manifest_sha256 = _digest(
            request.get("library_manifest_sha256"), "library_manifest_sha256"
        )
        observed_manifest_sha256 = _sha256_bytes(_canonical_json(manifest))
        if manifest_sha256 != observed_manifest_sha256:
            raise RoundRequestError(
                "library_manifest_sha256 does not bind the supplied cumulative manifest"
            )
        manifest_functions = {
            row["functionKey"]: row for row in manifest["functions"]  # type: ignore[index]
        }

        budgets_value = _mapping(request.get("budgets"), "budgets")
        budgets = {
            "max_rounds": _integer(budgets_value.get("max_rounds"), "budgets.max_rounds", positive=True),
            "max_new_library_cells": _integer(
                budgets_value.get("max_new_library_cells"),
                "budgets.max_new_library_cells",
                positive=True,
            ),
            "max_generation_units": _number(
                budgets_value.get("max_generation_units"),
                "budgets.max_generation_units",
                positive=True,
            ),
            "plateau_rounds": _integer(
                budgets_value.get("plateau_rounds"), "budgets.plateau_rounds", positive=True
            ),
        }
        rounds_value = request.get("rounds")
        if not isinstance(rounds_value, list) or not rounds_value:
            raise RoundRequestError("rounds must be a non-empty array")
        next_question_value = request.get("next_residual_question")
        next_question = (
            None if next_question_value is None
            else _research_question(next_question_value, "next_residual_question")
        )

        rows: list[dict[str, Any]] = []
        active: list[dict[str, Any]] = []
        seen_round_ids: set[str] = set()
        seen_function_keys: dict[str, str] = {}
        seen_question_ids: set[str] = set()
        stable_sha256: str | None = None
        stable_identity: dict[str, object] | None = None
        accepted_lineage: dict[str, dict[str, Any]] = {}
        accepted_round_ids: list[str] = []
        accepted_question_ids: set[str] = set()
        accepted_cost = {"new_library_cells": 0, "generation_units": 0.0}
        objective_axes: set[str] | None = None
        metric_directions: dict[str, str] = {}
        cumulative_cost = {"new_library_cells": 0, "generation_units": 0.0}
        trailing_no_progress = 0

        for index, round_value in enumerate(rounds_value):
            round_input = _mapping(round_value, f"rounds[{index}]")
            round_id = _string(round_input.get("round_id"), f"rounds[{index}].round_id")
            if round_id in seen_round_ids:
                raise RoundRequestError(f"rounds repeats round_id {round_id!r}")
            seen_round_ids.add(round_id)
            question = _research_question(
                round_input.get("research_question"), f"rounds[{index}].research_question"
            )
            cost = _frontier_cost(round_input.get("library_cost"), f"rounds[{index}].library_cost")
            cumulative_cost = {
                "new_library_cells": cumulative_cost["new_library_cells"] + cost["new_library_cells"],
                "generation_units": cumulative_cost["generation_units"] + cost["generation_units"],
            }
            function_keys_value = round_input.get("function_keys")
            if not isinstance(function_keys_value, list) or not function_keys_value:
                raise RoundRequestError(f"rounds[{index}].function_keys must be non-empty")
            function_keys = [
                _string(value, f"rounds[{index}].function_keys[{key_index}]")
                for key_index, value in enumerate(function_keys_value)
            ]
            reasons: list[str] = []
            if len(set(function_keys)) != len(function_keys):
                reasons.append("duplicate-function-identity-within-round")
            missing = sorted(set(function_keys) - set(manifest_functions))
            if missing:
                reasons.append("function-identity-not-in-library-manifest:" + ",".join(missing))
            duplicates = sorted(key for key in function_keys if key in seen_function_keys)
            if duplicates:
                reasons.extend(
                    f"duplicate-function-identity:{key}:first-seen-in:{seen_function_keys[key]}"
                    for key in duplicates
                )
            if cost["new_library_cells"] < len(set(function_keys)):
                reasons.append("new-library-cell-cost-below-function-count")
            if index + 1 > budgets["max_rounds"]:
                reasons.append("round-budget-overshoot")
            if cumulative_cost["new_library_cells"] > budgets["max_new_library_cells"]:
                reasons.append("new-library-cell-budget-overshoot")
            if cumulative_cost["generation_units"] > budgets["max_generation_units"]:
                reasons.append("generation-unit-budget-overshoot")

            row: dict[str, Any] = {
                "round_id": round_id,
                "research_question": question,
                "function_keys": sorted(set(function_keys)),
                "library_cost": cost,
                "cumulative_library_cost": dict(cumulative_cost),
                "status": "rejected" if reasons else "pending",
                "reasons": reasons,
            }
            verified_identity = False
            try:
                evaluation = _verified_evaluation_payload(
                    round_input.get("evaluation"), f"rounds[{index}].evaluation"
                )
                row["evaluation_payload_sha256"] = evaluation["evaluation_payload_sha256"]
                row["round_request_sha256"] = _digest(
                    evaluation.get("request_sha256"),
                    f"rounds[{index}].evaluation.request_sha256",
                )
                expected_candidate_cells = _manifest_candidate_cells(
                    manifest_functions, function_keys
                )
                recomputed = _recomputed_round_facts(evaluation)
                if sorted(recomputed["candidate_cells"]) != expected_candidate_cells:
                    row["reasons"].append("candidate-cell-function-identity-mismatch")
                if cost["new_library_cells"] < len(expected_candidate_cells):
                    row["reasons"].append("new-library-cell-cost-below-physical-cell-count")
                current_stable_sha256, current_stable, lineage = _evaluation_identities(evaluation)
                row["lineage"] = lineage
                raw, normalized, directions, f3_regressions = _frontier_metric_vector(evaluation)
                current_axes = set(normalized)
                normalized["cost.cumulative_new_library_cells"] = -cumulative_cost["new_library_cells"]
                normalized["cost.cumulative_generation_units"] = -cumulative_cost["generation_units"]
                raw["cost.cumulative_new_library_cells"] = cumulative_cost["new_library_cells"]
                raw["cost.cumulative_generation_units"] = cumulative_cost["generation_units"]
                row["metric_changes"] = raw
                row["normalized_vector"] = normalized
                if sorted(f3_regressions) != sorted(recomputed["f3_regressions"]):
                    row["reasons"].append("recomputed-f3-regression-disagreement")
                row["f3_regressions"] = recomputed["f3_regressions"]
                row["factor_assessment"] = recomputed["factor_assessment"]
                if recomputed["metric_complete"] is not True:
                    row["reasons"].append("required-metric-vectors-incomplete")
                if recomputed["reference_leakage"]:
                    row["reasons"].append("declared-candidate-already-present-in-reference")
                evaluation_budget = recomputed["evaluation_budget"]
                if evaluation_budget["violations"]:
                    row["reasons"].extend(
                        f"evaluation-budget-overshoot:{reason}"
                        for reason in evaluation_budget["violations"]
                    )
                row["round_gate_reasons"] = recomputed["reasons"]
                row["round_gate_blockers"] = recomputed["blockers"]
                row["f3_metrics_present"] = {
                    metric for metric in directions if ":F3." in metric
                } == {
                    f"{scenario}:{metric}"
                    for scenario in SCENARIOS
                    for metric in (
                        "F3.worst_delay_indicator_ps",
                        "F3.negative_slack_mass_indicator_ps",
                    )
                }
                row["f2_structural_improvement"] = any(
                    value > 0.0 and ":F2." in axis
                    for axis, value in normalized.items()
                )
                if not row["reasons"]:
                    if stable_sha256 is not None and current_stable_sha256 != stable_sha256:
                        row["reasons"].append("stable-experiment-identity-mismatch")
                    if objective_axes is not None and current_axes != objective_axes:
                        row["reasons"].append("objective-axis-set-mismatch")
                if not row["reasons"]:
                    parent_value = round_input.get("parent_round")
                    parent = None
                    if parent_value is not None:
                        parent_spec = _mapping(
                            parent_value, f"rounds[{index}].parent_round"
                        )
                        parent_id = _string(
                            parent_spec.get("round_id"),
                            f"rounds[{index}].parent_round.round_id",
                        )
                        parent_hash = _digest(
                            parent_spec.get("evaluation_sha256"),
                            f"rounds[{index}].parent_round.evaluation_sha256",
                        )
                        parent = accepted_lineage.get(parent_id)
                        if parent is None:
                            row["reasons"].append("parent-round-is-not-accepted")
                        elif parent["evaluation_payload_sha256"] != parent_hash:
                            row["reasons"].append("parent-round-evaluation-hash-mismatch")
                    elif accepted_round_ids:
                        parent = accepted_lineage[accepted_round_ids[-1]]
                    if parent is not None and not row["reasons"]:
                        parent_lineage = parent["lineage"]
                        if (
                            lineage["reference_library_sha256"]
                            != parent_lineage["augmented_library_sha256"]
                        ):
                            row["reasons"].append("reference-library-lineage-mismatch")
                        if (
                            lineage["reference_mapped_netlist_sha256"]
                            != parent_lineage["augmented_mapped_netlist_sha256"]
                        ):
                            row["reasons"].append("reference-netlist-lineage-mismatch")
                        row["parent_round"] = {
                            "round_id": parent["round_id"],
                            "evaluation_sha256": parent["evaluation_payload_sha256"],
                        }
                    elif not accepted_round_ids and parent_value is not None:
                        row["reasons"].append("first-accepted-round-cannot-declare-a-parent")
                if not row["reasons"]:
                    if stable_sha256 is None:
                        stable_sha256 = current_stable_sha256
                        stable_identity = current_stable
                    if objective_axes is None:
                        objective_axes = current_axes
                    metric_directions.update(directions)
                    for cost_name, direction in _COST_DIRECTIONS.items():
                        metric_directions[cost_name] = direction
                    verified_identity = True
            except (RoundRequestError, KeyError, TypeError, ValueError) as error:
                row["reasons"].append("invalid-round-evaluation:" + str(error))

            seen_question_ids.add(question["id"])
            if verified_identity:
                for key in function_keys:
                    seen_function_keys.setdefault(key, round_id)
            if row["reasons"]:
                row["status"] = "rejected"
                rows.append(row)
                continue

            accepted_lineage[round_id] = row
            accepted_round_ids.append(round_id)
            accepted_question_ids.add(question["id"])
            accepted_cost = {
                "new_library_cells": accepted_cost["new_library_cells"] + cost["new_library_cells"],
                "generation_units": accepted_cost["generation_units"] + cost["generation_units"],
            }

            equal = next(
                (member for member in active
                 if member["normalized_vector"] == row["normalized_vector"]),
                None,
            )
            dominators = [
                member for member in active
                if _dominates(member["normalized_vector"], row["normalized_vector"])
            ]
            if equal is not None:
                row["status"] = "dominated"
                row["reasons"].append(f"equivalent-metric-vector:{equal['round_id']}")
                trailing_no_progress += 1
            elif dominators:
                row["status"] = "dominated"
                row["reasons"].extend(
                    f"pareto-dominated-by:{member['round_id']}" for member in dominators
                )
                trailing_no_progress += 1
            else:
                displaced = [
                    member for member in active
                    if _dominates(row["normalized_vector"], member["normalized_vector"])
                ]
                for member in displaced:
                    member["status"] = "dominated"
                    member["reasons"].append(f"pareto-dominated-by:{round_id}")
                    active.remove(member)
                row["status"] = "frontier"
                active.append(row)
                trailing_no_progress = 0
            rows.append(row)

        budget_reasons = []
        budget_violations = []
        if len(rounds_value) >= budgets["max_rounds"]:
            budget_reasons.append("round-budget-exhausted")
        if len(rounds_value) > budgets["max_rounds"]:
            budget_violations.append("round-budget-overshoot")
        if cumulative_cost["new_library_cells"] >= budgets["max_new_library_cells"]:
            budget_reasons.append("new-library-cell-budget-exhausted")
        if cumulative_cost["new_library_cells"] > budgets["max_new_library_cells"]:
            budget_violations.append("new-library-cell-budget-overshoot")
        if cumulative_cost["generation_units"] >= budgets["max_generation_units"]:
            budget_reasons.append("generation-unit-budget-exhausted")
        if cumulative_cost["generation_units"] > budgets["max_generation_units"]:
            budget_violations.append("generation-unit-budget-overshoot")
        stop_reasons = list(budget_reasons)
        converged = trailing_no_progress >= budgets["plateau_rounds"]
        if converged:
            stop_reasons.append("pareto-frontier-plateau")
        if next_question is None or next_question["id"] in seen_question_ids:
            stop_reasons.append("no-new-residual-question")
            next_question = None
        should_stop = bool(stop_reasons)
        eligible_stop_reasons = []
        if len(accepted_round_ids) >= budgets["max_rounds"]:
            eligible_stop_reasons.append("accepted-round-budget-exhausted")
        if accepted_cost["new_library_cells"] >= budgets["max_new_library_cells"]:
            eligible_stop_reasons.append("accepted-library-cell-budget-exhausted")
        if accepted_cost["generation_units"] >= budgets["max_generation_units"]:
            eligible_stop_reasons.append("accepted-generation-unit-budget-exhausted")
        if converged:
            eligible_stop_reasons.append("pareto-frontier-plateau")
        requested_next_question = request.get("next_residual_question")
        if requested_next_question is None:
            eligible_stop_reasons.append("no-new-residual-question")
        elif isinstance(requested_next_question, Mapping):
            requested_next_id = requested_next_question.get("id")
            if requested_next_id in accepted_question_ids:
                eligible_stop_reasons.append("no-new-residual-question")

        selected = None
        selected_reasons: list[str] = []
        selected_blockers: list[str] = []
        for row in reversed(rows):
            blockers = list(row.get("round_gate_blockers", []))
            if row["status"] != "frontier":
                blockers.append("not-a-current-frontier-member")
            if budget_violations:
                blockers.extend(
                    f"frontier-{reason}" for reason in budget_violations
                )
            blockers = list(dict.fromkeys(blockers))
            row["validation_blockers"] = blockers
            if not blockers and selected is None:
                selected = row
                selected_reasons = list(row.get("round_gate_reasons", [])) + [
                    "verified-cross-round-pareto-frontier-member",
                    "free-factor-gate:F1-F2-F3-not-all-explicitly-negative",
                ]
                break
            if row["status"] == "frontier" and not selected_blockers:
                selected_blockers = blockers

        candidate = {
            "value": selected is not None,
            "round_id": selected["round_id"] if selected is not None else None,
            "unit_of_analysis": "candidate-library-round",
            "validation_layer": "E0",
            "meaning": "candidate Library is eligible for one expensive commercial observation; never an expected-benefit claim",
            "factor_assessment": selected.get("factor_assessment") if selected is not None else None,
            "reasons": selected_reasons,
            "blocking_reasons": [] if selected is not None else (
                selected_blockers or ["no-eligible-frontier-member"]
            ),
        }
        for row in rows:
            row["e0_library_validation_candidate"] = {
                "value": selected is row,
                "unit_of_analysis": "candidate-library-round",
                "validation_layer": "E0",
                "meaning": candidate["meaning"],
                "factor_assessment": row.get("factor_assessment"),
                "reasons": selected_reasons if selected is row else [],
                "blocking_reasons": row.get(
                    "validation_blockers", ["not-evaluated-for-commercial-validation"]
                ),
            }

        portfolio_members = [{
            "id": row["round_id"],
            "round_id": row["round_id"],
            "evaluation_sha256": row["evaluation_payload_sha256"],
            "metric_vector": row["metric_changes"],
            "function_keys": row["function_keys"],
            "library_cost": row["cumulative_library_cost"],
            "status": row["status"],
            "reasons": row["reasons"],
        } for row in rows if "normalized_vector" in row and row["status"] != "rejected"]
        frontier_member_ids = [
            row["round_id"] for row in rows if row["status"] == "frontier"
        ]

        result: dict[str, object] = {
            "schema": FRONTIER_RESULT_SCHEMA,
            "status": "succeeded",
            "request_sha256": request_sha256,
            "evidence_class": "license-free-cross-round-frontier",
            "claim_limits": {
                "commercial_qor_predicted": False,
                "fmax_predicted": False,
                "commercial_eda_executed": False,
            },
            "library_manifest": {
                "sha256": manifest_sha256,
                "function_count": len(manifest_functions),
                "shard_count": len(manifest["shards"]),  # type: ignore[index]
            },
            "stable_identity": {
                "sha256": stable_sha256,
                "facts": stable_identity,
            },
            "reference_identity": {
                "sha256": stable_sha256,
                "facts": stable_identity,
            },
            "metric_directions": dict(sorted(metric_directions.items())),
            "objectives": [
                {"metric": metric, "direction": direction}
                for metric, direction in sorted(metric_directions.items())
            ],
            "members": portfolio_members,
            "frontier_member_ids": frontier_member_ids,
            "library_cost": dict(cumulative_cost),
            "rounds": rows,
            "frontier": {
                "member_round_ids": frontier_member_ids,
                "dominated_round_ids": [row["round_id"] for row in rows if row["status"] == "dominated"],
                "rejected_round_ids": [row["round_id"] for row in rows if row["status"] == "rejected"],
            },
            "budgets": {
                "limits": budgets,
                "usage": {
                    "rounds": len(rounds_value),
                    **cumulative_cost,
                },
                "accepted_usage": {
                    "rounds": len(accepted_round_ids),
                    **accepted_cost,
                },
                "exhausted": bool(budget_reasons),
                "reasons": budget_reasons,
                "violations": budget_violations,
            },
            "convergence": {
                "trailing_rounds_without_frontier_progress": trailing_no_progress,
                "plateau_rounds": budgets["plateau_rounds"],
                "plateau": converged,
            },
            "stopping": {
                "should_stop": should_stop,
                "reasons": stop_reasons,
                "commercial_gate_eligible_reasons": eligible_stop_reasons,
            },
            "next_residual_question": next_question,
            "factor_model": {
                "free_factors": list(FREE_FACTOR_LAYERS),
                "expensive_outcome": "E0",
                "unit_of_analysis": "candidate-library-round",
                "relationship_goal": "measure condition-labelled factor association with E0; do not predict portable benefit",
            },
            "e0_library_validation_candidate": candidate,
        }
        result["frontier_payload_sha256"] = _sha256_bytes(_canonical_json(result))
        return result
    except (RoundRequestError, KeyError, TypeError, ValueError) as error:
        result = {
            "schema": FRONTIER_RESULT_SCHEMA,
            "status": "failed",
            "stage": "frontier-request",
            "request_sha256": request_sha256,
            "error": {"code": "invalid-frontier-request", "message": str(error)},
            "evidence_class": "license-free-cross-round-frontier",
        }
        result["frontier_payload_sha256"] = _sha256_bytes(_canonical_json(result))
        return result


def _hashes(
    validated: Mapping[str, Any], mapping_result: Mapping[str, Any], artifacts: Mapping[str, Any]
) -> dict[str, object]:
    return {
        "validated_inputs": validated["bound_inputs"],
        "local_portfolio": validated["local_portfolio"]["source"],
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
                validated["local_portfolio"],
            )
            for name in SCENARIOS
        }
        adoption = _mapping_adoption(mapping_result, validated["candidate_cells"])
        pairwise = _aggregate_pairwise_relation(scenarios)
        e0_candidate, budget_status = _e0_library_candidate(
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
            "local_portfolio": {
                "source": validated["local_portfolio"]["source"],
                "selected_candidate_ids": validated["local_portfolio"]["selected_candidate_ids"],
                "reference": validated["local_portfolio"]["reference"],
                "augmented": validated["local_portfolio"]["augmented"],
                "evidence_layer": "F1_local_structure",
                "status": "PRE_MAPPING_PLANNING",
            },
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
            "e0_library_validation_candidate": e0_candidate,
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


def _cgo_signed_number(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise RoundRequestError("%s must be a number" % name)
    result = float(value)
    if not math.isfinite(result):
        raise RoundRequestError("%s must be finite" % name)
    return result


def _cgo_endpoint_state(design_state: Mapping[str, Any]) -> tuple[dict[str, float], float, str]:
    """Read the v3 endpoint state without accepting path-row multiplicity."""
    if design_state.get("schema") != "hima.lfr-endpoint-frontier/1":
        raise RoundRequestError("design_state must be an endpoint-frontier/1 document")
    rows = design_state.get("endpoints")
    if not isinstance(rows, list) or not rows:
        raise RoundRequestError("design_state.endpoints must be non-empty")
    slacks: dict[str, float] = {}
    for index, row_value in enumerate(rows):
        row = _mapping(row_value, "design_state.endpoints[%d]" % index)
        endpoint = _string(row.get("endpoint"), "design_state endpoint")
        if endpoint in slacks:
            raise RoundRequestError("design_state repeats endpoint %s" % endpoint)
        slacks[endpoint] = _cgo_signed_number(row.get("slack_ns"), "endpoint slack")
    target = _cgo_signed_number(design_state.get("target_slack_ns"), "target_slack_ns")
    group = _string(design_state.get("path_group"), "path_group")
    return slacks, target, group


def _cgo_snapshot(slacks: Mapping[str, float], target: float, epsilon: float) -> dict[str, object]:
    wns = min(slacks.values())
    frontier = sorted(name for name, slack in slacks.items() if slack <= wns + epsilon + 1e-12)
    deficit = sum(max(0.0, target - slacks[name]) for name in slacks)
    tns = sum(min(0.0, slack) for slack in slacks.values())
    return {
        "wns_ns": round(wns, 12), "frontier_endpoints": frontier,
        "frontier_deficit_ns": round(deficit, 12), "tns_ns": round(tns, 12),
        "violating_endpoint_count": sum(slack < 0 for slack in slacks.values()),
    }


def _cgo_action(value: object, known_endpoints: set[str], index: int) -> dict[str, object]:
    row = dict(_mapping(value, "actions[%d]" % index))
    identifier = _string(row.get("action_id"), "actions[%d].action_id" % index)
    kind = _string(row.get("kind"), "actions[%d].kind" % index)
    if kind not in {"single-output", "multi-output", "physical-fusion"}:
        raise RoundRequestError("action %s has unsupported kind" % identifier)
    apply_mode = _string(row.get("apply_mode"), "actions[%d].apply_mode" % index)
    if apply_mode not in {"eco-only", "synthesis-eligible"}:
        raise RoundRequestError("action %s has unsupported apply_mode" % identifier)
    deltas_value = _mapping(row.get("delta_slack_by_endpoint"), "action delta")
    unknown = sorted(set(deltas_value) - known_endpoints)
    if unknown:
        raise RoundRequestError("action %s names unknown endpoints: %s" % (identifier, unknown))
    uncertainty = _number(row.get("model_uncertainty_ns", 0.0), "model_uncertainty_ns")
    penalty = _number(row.get("physical_penalty_ns", 0.0), "physical_penalty_ns")
    if uncertainty < 0 or penalty < 0:
        raise RoundRequestError("action uncertainty and physical penalty must be non-negative")
    conservative = {}
    for endpoint, value_delta in deltas_value.items():
        delta = _cgo_signed_number(value_delta, "delta_slack_by_endpoint.%s" % endpoint)
        conservative[endpoint] = round(delta - uncertainty - penalty, 12)
    root_checks = row.get("root_checks", [])
    if not isinstance(root_checks, list):
        raise RoundRequestError("action root_checks must be an array")
    rejected_roots = []
    for root_index, root_value in enumerate(root_checks):
        root = _mapping(root_value, "root_checks[%d]" % root_index)
        if root.get("output_used") is not True or root.get("required_time_met") is not True:
            rejected_roots.append(str(root.get("root") or root_index))
    demand = _mapping(row.get("cell_demand"), "action cell_demand")
    demand_id = _string(demand.get("demand_id"), "cell_demand.demand_id")
    resources = row.get("resources", [])
    if not isinstance(resources, list) or not all(isinstance(item, str) and item for item in resources):
        raise RoundRequestError("action resources must be non-empty strings")
    row.update({
        "action_id": identifier, "kind": kind, "apply_mode": apply_mode,
        "delta_slack_by_endpoint": {str(key): float(value) for key, value in deltas_value.items()},
        "conservative_delta_slack_by_endpoint": conservative,
        "affected_endpoints": sorted(conservative), "resources": sorted(set(resources)),
        "cell_demand": dict(demand), "demand_id": demand_id,
        "root_rejections": rejected_roots,
    })
    return row


def optimize_action_portfolio(design_state: Mapping[str, Any], actions: Sequence[object],
                              cell_budget: int, proxy_decision_authority: bool = True) -> dict[str, object]:
    """Select a stateful, endpoint-frontier Action Portfolio.

    The evaluator intentionally operates on timing-graph indicators.  It does
    not predict commercial MHz.  Each accepted Action updates endpoint slacks;
    all remaining marginal vectors are then recomputed against that state.
    """
    if isinstance(cell_budget, bool) or not isinstance(cell_budget, int) or not 1 <= cell_budget <= 100:
        raise RoundRequestError("cell_budget must be within 1..100")
    if not isinstance(actions, Sequence) or isinstance(actions, (str, bytes)):
        raise RoundRequestError("actions must be an array")
    slacks, target, path_group = _cgo_endpoint_state(design_state)
    epsilon = _number(design_state.get("epsilon_ns"), "epsilon_ns")
    normalized = [_cgo_action(value, set(slacks), index) for index, value in enumerate(actions)]
    for index, row in enumerate(normalized):
        row["input_order"] = index
    if len({row["action_id"] for row in normalized}) != len(normalized):
        raise RoundRequestError("actions repeat action_id")
    baseline = _cgo_snapshot(slacks, target, epsilon)
    current = dict(slacks)
    selected: list[dict[str, object]] = []
    selected_resources: set[str] = set()
    selected_demands: set[str] = set()
    remaining = list(normalized)
    trace = []
    stop_reason = "no-positive-conservative-action"
    while remaining:
        before = _cgo_snapshot(current, target, epsilon)
        evaluations = []
        for action in remaining:
            reasons = list(action["root_rejections"])
            if set(action["resources"]) & selected_resources:
                reasons.append("resource-conflict")
            new_demand = action["demand_id"] not in selected_demands
            if new_demand and len(selected_demands) >= cell_budget:
                reasons.append("cell-budget-reached")
            simulated = dict(current)
            for endpoint, delta in action["conservative_delta_slack_by_endpoint"].items():
                simulated[endpoint] += delta
            after = _cgo_snapshot(simulated, target, epsilon)
            wns_gain = round(after["wns_ns"] - before["wns_ns"], 12)
            deficit_gain = round(before["frontier_deficit_ns"] - after["frontier_deficit_ns"], 12)
            tns_gain = round(after["tns_ns"] - before["tns_ns"], 12)
            current_frontier = set(before["frontier_endpoints"])
            affected_frontier = current_frontier & set(action["affected_endpoints"])
            coverable = set(action["affected_endpoints"])
            blocked = set(action["resources"]) | selected_resources
            for other in remaining:
                if other["action_id"] == action["action_id"] or other["root_rejections"]:
                    continue
                if set(other["resources"]) & blocked:
                    continue
                coverable.update(other["affected_endpoints"])
            complete_plan = current_frontier <= coverable
            admission = None
            if not reasons and not proxy_decision_authority:
                admission = "commercial-calibration"
            elif not reasons and wns_gain > 0:
                admission = "direct-gain"
            elif (not reasons and deficit_gain > 0 and affected_frontier and complete_plan):
                admission = "portfolio-preparation"
            elif not reasons:
                reasons.append("no-complete-positive-frontier-plan")
            evaluations.append({
                "action": action, "after_slacks": simulated, "after": after,
                "admission": admission, "rejection_reasons": reasons,
                "marginal": {
                    "delta_wns_ns": wns_gain,
                    "delta_frontier_deficit_ns": deficit_gain,
                    "delta_tns_ns": tns_gain,
                    "affected_frontier_endpoints": sorted(affected_frontier),
                    "complete_frontier_plan": complete_plan,
                },
            })
        admitted = [row for row in evaluations if row["admission"]]
        trace.append({
            "iteration": len(selected) + 1, "state_before": before,
            "evaluations": [{
                "action_id": row["action"]["action_id"], "admission": row["admission"],
                "rejection_reasons": row["rejection_reasons"], "marginal": row["marginal"],
            } for row in evaluations],
        })
        if not admitted:
            if any("cell-budget-reached" in row["rejection_reasons"] for row in evaluations):
                stop_reason = "cell-budget-reached"
            break
        if proxy_decision_authority:
            best = max(admitted, key=lambda row: (
                row["marginal"]["delta_wns_ns"], row["marginal"]["delta_frontier_deficit_ns"],
                row["marginal"]["delta_tns_ns"],
                len(row["marginal"]["affected_frontier_endpoints"]),
                -int(row["action"].get("library_cost", 1)),
                str(row["action"]["action_id"]),
            ))
        else:
            best = min(admitted, key=lambda row: int(row["action"]["input_order"]))
        current = best["after_slacks"]
        action = best["action"]
        selected_resources.update(action["resources"])
        selected_demands.add(action["demand_id"])
        selected.append({
            **action, "admission": best["admission"], "marginal_at_selection": best["marginal"],
            "state_after": best["after"],
        })
        remaining = [row for row in remaining if row["action_id"] != action["action_id"]]
        if not remaining:
            stop_reason = "candidate-actions-exhausted"
    final = _cgo_snapshot(current, target, epsilon)
    return {
        "schema": "hima.lfr-action-portfolio/1", "status": "succeeded",
        "path_group": path_group, "cell_budget": cell_budget,
        "baseline": baseline, "final": final,
        "selected_actions": selected, "selected_action_ids": [row["action_id"] for row in selected],
        "selected_demand_ids": sorted(selected_demands), "cells_demanded": len(selected_demands),
        "stop_reason": stop_reason, "objective_trace": trace,
        "selection_policy": ("free-proxy-gated-legacy"
                             if proxy_decision_authority
                             else "commercial-calibration-all-feasible-in-input-order"),
        "free_proxy_decision_authority": proxy_decision_authority,
        "claim_limits": {"commercial_qor": False, "fmax_prediction": False},
    }


def _v5_graph_model(design_state: Mapping[str, Any]):
    if design_state.get("schema") != "hima.lfr-timing-graph-state/1":
        raise RoundRequestError("V5 design_state must be a timing-graph-state/1 document")
    raw_nodes = design_state.get("nodes")
    raw_arcs = design_state.get("arcs")
    endpoints = design_state.get("endpoints")
    if not isinstance(raw_nodes, list) or not raw_nodes or not isinstance(raw_arcs, list):
        raise RoundRequestError("V5 timing graph needs non-empty nodes and an arc array")
    nodes = {}
    for row in raw_nodes:
        item = _mapping(row, "timing graph node")
        name = _string(item.get("node"), "timing graph node identity")
        if name in nodes:
            raise RoundRequestError("V5 timing graph repeats node %s" % name)
        nodes[name] = _cgo_signed_number(item.get("source_arrival_ns", 0.0),
                                         "source_arrival_ns")
    arcs = {}
    incoming = {name: [] for name in nodes}
    outgoing = {name: [] for name in nodes}
    for row in raw_arcs:
        item = _mapping(row, "timing graph arc")
        identifier = _string(item.get("arc_id"), "arc_id")
        source, target = _string(item.get("source"), "arc source"), _string(item.get("target"), "arc target")
        if identifier in arcs or source not in nodes or target not in nodes:
            raise RoundRequestError("V5 timing graph has duplicate or dangling arc %s" % identifier)
        delay = _number(item.get("delay_ns"), "arc delay")
        arcs[identifier] = {"source": source, "target": target, "delay_ns": delay}
        incoming[target].append(identifier); outgoing[source].append(identifier)
    endpoint_names = [_string(value, "endpoint") for value in endpoints or ()]
    if not endpoint_names or set(endpoint_names) - set(nodes) or len(endpoint_names) != len(set(endpoint_names)):
        raise RoundRequestError("V5 endpoints must be unique graph nodes")
    indegree = {name: len(incoming[name]) for name in nodes}
    ready = sorted(name for name, degree in indegree.items() if degree == 0)
    order = []
    while ready:
        name = ready.pop(0); order.append(name)
        for arc_id in sorted(outgoing[name]):
            target = arcs[arc_id]["target"]
            indegree[target] -= 1
            if indegree[target] == 0:
                ready.append(target); ready.sort()
    if len(order) != len(nodes):
        raise RoundRequestError("V5 timing graph must be acyclic")
    q_target = _number(design_state.get("q_target_ns"), "q_target_ns", positive=True)
    scenarios = design_state.get("scenarios") or [{"scenario_id": "nominal"}]
    if not isinstance(scenarios, list) or not scenarios:
        raise RoundRequestError("V5 scenarios must be a non-empty array")
    return nodes, arcs, incoming, order, endpoint_names, q_target, scenarios


def _v5_action(value, arcs, index):
    row = dict(_mapping(value, "actions[%d]" % index))
    identifier = _string(row.get("action_id"), "action_id")
    master = _string(row.get("master_id"), "master_id")
    changes = row.get("graph_changes")
    if not isinstance(changes, list) or not changes:
        raise RoundRequestError("V5 action %s needs graph_changes" % identifier)
    normalized = []
    for change in changes:
        item = _mapping(change, "graph change")
        arc_id = _string(item.get("arc_id"), "graph change arc_id")
        if arc_id not in arcs:
            raise RoundRequestError("V5 action %s changes unknown arc %s" % (identifier, arc_id))
        normalized.append({"arc_id": arc_id,
                           "delta_delay_ns": _cgo_signed_number(item.get("delta_delay_ns"),
                                                                  "delta_delay_ns")})
    resources = row.get("resources") or []
    if not isinstance(resources, list) or not all(isinstance(item, str) and item for item in resources):
        raise RoundRequestError("V5 action resources must be strings")
    hard = row.get("hard_gates") or {}
    required_gates = ("logical_proof", "all_outputs_used", "ccei_applicable", "rollback_proved")
    failed = [gate for gate in required_gates if hard.get(gate) is not True]
    return {**row, "action_id": identifier, "master_id": master,
            "graph_changes": normalized, "resources": sorted(set(resources)),
            "hard_gate_failures": failed, "input_order": index}


def _v5_recompute(model, selected):
    nodes, arcs, incoming, order, endpoints, q_target, scenarios = model
    delay_delta = {}
    for action in selected:
        for change in action["graph_changes"]:
            delay_delta[change["arc_id"]] = delay_delta.get(change["arc_id"], 0.0) + change["delta_delay_ns"]
    scenario_rows = []
    for scenario in scenarios:
        scenario_id = _string(scenario.get("scenario_id"), "scenario_id")
        scenario_delta = scenario.get("arc_delay_delta_ns") or {}
        arrivals = {}
        for node in order:
            candidates = []
            for arc_id in incoming[node]:
                arc = arcs[arc_id]
                delay = arc["delay_ns"] + delay_delta.get(arc_id, 0.0) + float(scenario_delta.get(arc_id, 0.0))
                if delay < 0:
                    raise RoundRequestError("V5 action portfolio makes arc %s negative" % arc_id)
                candidates.append(arrivals[arc["source"]] + delay)
            arrivals[node] = max([nodes[node], *candidates])
        q = {endpoint: arrivals[endpoint] for endpoint in endpoints}
        scenario_rows.append({"scenario_id": scenario_id, "endpoint_q_ns": q,
                              "worst_q_ns": max(q.values()),
                              "target_deficit_ns": sum(max(0.0, value - q_target) for value in q.values())})
    return {"scenarios": scenario_rows,
            "worst_q_ns": max(row["worst_q_ns"] for row in scenario_rows),
            "target_deficit_ns": max(row["target_deficit_ns"] for row in scenario_rows)}


def optimize_action_portfolio_v5(design_state: Mapping[str, Any], actions: Sequence[object],
                                 master_budget: int, action_budget: int, beam_width: int = 12):
    """Bounded whole-graph beam search with alternative-path takeover."""
    if any(isinstance(value, bool) or not isinstance(value, int) or value < 1 or value > 100
           for value in (master_budget, action_budget, beam_width)):
        raise RoundRequestError("V5 budgets and beam width must be integers within 1..100")
    model = _v5_graph_model(design_state)
    normalized = [_v5_action(value, model[1], index) for index, value in enumerate(actions)]
    if len({row["action_id"] for row in normalized}) != len(normalized):
        raise RoundRequestError("V5 actions repeat action_id")
    baseline = _v5_recompute(model, [])
    frontier = [tuple()]
    evaluated = {tuple(): baseline}
    for _depth in range(action_budget):
        expanded = set(frontier)
        for prefix in frontier:
            chosen = [normalized[index] for index in prefix]
            resources = set().union(*(set(row["resources"]) for row in chosen)) if chosen else set()
            masters = {row["master_id"] for row in chosen}
            start = prefix[-1] + 1 if prefix else 0
            for index in range(start, len(normalized)):
                action = normalized[index]
                if action["hard_gate_failures"] or resources.intersection(action["resources"]):
                    continue
                if action["master_id"] not in masters and len(masters) >= master_budget:
                    continue
                candidate = prefix + (index,)
                evaluated[candidate] = _v5_recompute(model, [normalized[item] for item in candidate])
                expanded.add(candidate)
        def score(prefix):
            state = evaluated[prefix]
            masters = len({normalized[index]["master_id"] for index in prefix})
            return (state["worst_q_ns"], state["target_deficit_ns"], masters,
                    len(prefix), tuple(normalized[index]["action_id"] for index in prefix))
        frontier = sorted(expanded, key=score)[:beam_width]
    best = min(frontier, key=lambda prefix: (
        evaluated[prefix]["worst_q_ns"], evaluated[prefix]["target_deficit_ns"],
        len({normalized[index]["master_id"] for index in prefix}), len(prefix),
        tuple(normalized[index]["action_id"] for index in prefix)))
    selected = [normalized[index] for index in best]
    return {
        "schema": "hima.lfr-action-portfolio/2", "status": "succeeded",
        "baseline": baseline, "final": evaluated[best],
        "selected_actions": selected,
        "selected_action_ids": [row["action_id"] for row in selected],
        "selected_master_ids": sorted({row["master_id"] for row in selected}),
        "master_budget": master_budget, "action_budget": action_budget,
        "beam_width": beam_width, "whole_graph_recomputed": True,
        "alternative_path_takeover_modeled": True,
        "free_proxy_decision_authority": False,
        "claim_limits": {"commercial_qor": False, "fmax_prediction": False},
    }


def derive_cell_demands(portfolio: Mapping[str, Any]) -> dict[str, object]:
    """Aggregate selected Action sites into the minimal delta Library demand."""
    if portfolio.get("schema") != "hima.lfr-action-portfolio/1":
        raise RoundRequestError("portfolio must be an action-portfolio/1 document")
    selected = portfolio.get("selected_actions")
    if not isinstance(selected, list):
        raise RoundRequestError("portfolio.selected_actions must be an array")
    demands: dict[str, dict[str, object]] = {}
    for index, action_value in enumerate(selected):
        action = _mapping(action_value, "selected_actions[%d]" % index)
        demand = dict(_mapping(action.get("cell_demand"), "selected action cell_demand"))
        demand_id = _string(demand.get("demand_id"), "cell_demand.demand_id")
        if demand_id in demands:
            identity = {key: value for key, value in demand.items() if key != "demand_id"}
            existing = {key: value for key, value in demands[demand_id].items()
                        if key not in {"demand_id", "action_ids", "sites", "expected_occurrences"}}
            if identity != existing:
                raise RoundRequestError("demand %s has inconsistent definitions" % demand_id)
        else:
            demands[demand_id] = {
                **demand, "action_ids": [], "sites": [], "expected_occurrences": 0,
            }
        row = demands[demand_id]
        row["action_ids"].append(action["action_id"])
        row["sites"].append({
            "module": action.get("module"),
            "source_instances": list(action.get("source_instances") or ()),
            "affected_endpoints": list(action.get("affected_endpoints") or ()),
        })
        row["expected_occurrences"] += 1
    return {
        "schema": "hima.lfr-cell-demand/1", "status": "succeeded",
        "library_budget": portfolio.get("cell_budget"),
        "demand_count": len(demands),
        "demands": [demands[key] for key in sorted(demands)],
        "source_action_portfolio_sha256": _sha256_bytes(_canonical_json(portfolio)),
    }


def evaluate_cumulative_gain(request: Mapping[str, Any]) -> dict[str, object]:
    """Execute the v3 free Action loop and emit its three internal artifacts."""
    if request.get("schema") != CGO_REQUEST_SCHEMA:
        raise RoundRequestError("unsupported cumulative-gain request schema")
    state = _mapping(request.get("design_state"), "design_state")
    actions = request.get("actions")
    if not isinstance(actions, list):
        raise RoundRequestError("actions must be an array")
    budget = _integer(request.get("cell_budget"), "cell_budget", positive=True)
    policy = request.get("free_proxy_policy", "observation-only")
    if policy not in ("observation-only", "legacy-gate"):
        raise RoundRequestError("free_proxy_policy must be observation-only or legacy-gate")
    portfolio = optimize_action_portfolio(
        state, actions, budget, proxy_decision_authority=(policy == "legacy-gate")
    )
    demands = derive_cell_demands(portfolio)
    blockers = []
    if not portfolio["selected_actions"]:
        blockers.append("no-structurally-feasible-action-portfolio")
    result = {
        "schema": CGO_RESULT_SCHEMA, "status": "succeeded",
        "design_state": dict(state), "action_portfolio": portfolio,
        "cell_demand": demands,
        "evaluated_actions": list(actions), "cell_budget": budget,
        "commercial_gate": {
            "eligible": not blockers,
            "reason": ("commercial-calibration-required" if not blockers else blockers[0]),
            "blocking_reasons": blockers,
            "maximum_generated_arms": 1,
            "free_proxy_decision_authority": False if policy == "observation-only" else True,
        },
        "free_proxy_observations": {
            "coverage_scope": state.get("coverage_scope"),
            "proxy_wns_delta_ns": round(
                portfolio["final"]["wns_ns"] - portfolio["baseline"]["wns_ns"], 12),
            "used_for_admission": policy == "legacy-gate",
        },
        "claim_limits": {"commercial_qor": False, "fmax_prediction": False},
    }
    result["evaluation_payload_sha256"] = _sha256_bytes(_canonical_json(result))
    return result


def summarize_proxy_success_rates(observations: Sequence[object]) -> dict[str, object]:
    """Report proxy/E0 contingency rates without promoting a decision rule."""
    if not isinstance(observations, Sequence) or isinstance(observations, (str, bytes)):
        raise RoundRequestError("proxy observations must be an array")
    factors: dict[str, dict[str, int]] = {}
    for index, value in enumerate(observations):
        row = _mapping(value, "observations[%d]" % index)
        factor = _string(row.get("factor"), "observation.factor")
        proxy = row.get("metric_success")
        commercial = row.get("commercial_success")
        if not isinstance(proxy, bool) or not isinstance(commercial, bool):
            raise RoundRequestError("proxy/commercial success must be booleans")
        counts = factors.setdefault(factor, {"tp": 0, "fp": 0, "tn": 0, "fn": 0})
        counts["tp" if proxy and commercial else
               "fp" if proxy and not commercial else
               "tn" if not proxy and not commercial else "fn"] += 1
    rows = []
    for factor in sorted(factors):
        counts = factors[factor]
        total = sum(counts.values())
        predicted_positive = counts["tp"] + counts["fp"]
        predicted_negative = counts["tn"] + counts["fn"]
        rows.append({
            "factor": factor, "observations": total, **counts,
            "commercial_success_rate_when_metric_positive": (
                counts["tp"] / predicted_positive if predicted_positive else None),
            "commercial_failure_rate_when_metric_negative": (
                counts["tn"] / predicted_negative if predicted_negative else None),
            "decision_authority": False,
        })
    return {"schema": "hima.free-proxy-success-rates/1", "factors": rows,
            "policy": "observation-only-no-automatic-promotion"}

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
        result = (evaluate_cumulative_gain(request)
                  if request.get("schema") == CGO_REQUEST_SCHEMA
                  else evaluate_round(request))
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
