#!/usr/bin/env python3
"""Compare LFR open-source metric layers with retained commercial QoR.

This is development-evidence tooling.  It reads compact JSON records and never
launches Yosys, ABC, DC, Innovus, Library Compiler, or a HimaPack stage.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence

from validate_corpus import load_manifest, validate_manifest


REPORT_SCHEMA = "hima.library-richness.metric-qor-relationship-report/1"
MAPPING_SCHEMA = "lfr-proxy-mapping-result/1"
ROUND_SCHEMAS = {
    "lfr-round-evaluation/1",
    "lfr-round-evaluation/2",
    "lfr-round-evaluation/3",
}
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class CalibrationError(ValueError):
    """The supplied evidence cannot support a metric/QoR relationship report."""


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise CalibrationError(message)


def _mapping(value: object, label: str) -> Mapping[str, Any]:
    _require(isinstance(value, Mapping), f"{label} must be an object")
    return value


def _list(value: object, label: str) -> list[Any]:
    _require(isinstance(value, list), f"{label} must be an array")
    return value


def _number(value: object, label: str) -> float:
    _require(
        isinstance(value, (int, float)) and not isinstance(value, bool),
        f"{label} must be a number",
    )
    result = float(value)
    _require(math.isfinite(result), f"{label} must be finite")
    return result


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _verify_file(path: Path, expected: str, label: str) -> str:
    _require(path.is_file(), f"{label} is unavailable: {path}")
    _require(SHA256_RE.fullmatch(expected) is not None, f"{label} expected SHA-256 is invalid")
    observed = _sha256_file(path)
    _require(
        observed == expected,
        f"{label} SHA-256 mismatch: expected {expected}, observed {observed}",
    )
    return observed


def _load_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise CalibrationError(f"{label} is not readable JSON: {error}") from error
    _require(isinstance(value, dict), f"{label} JSON root must be an object")
    return value


def _average_descending_ranks(values: Mapping[str, float]) -> dict[str, float]:
    """Rank larger values first and assign the average rank to ties."""

    ordered = sorted(values.items(), key=lambda item: (-item[1], item[0]))
    ranks: dict[str, float] = {}
    index = 0
    while index < len(ordered):
        end = index + 1
        while end < len(ordered) and ordered[end][1] == ordered[index][1]:
            end += 1
        average = ((index + 1) + end) / 2.0
        for key, _ in ordered[index:end]:
            ranks[key] = average
        index = end
    return ranks


def _pearson(left: Sequence[float], right: Sequence[float]) -> float | None:
    _require(len(left) == len(right), "rank vectors have different lengths")
    if len(left) < 2:
        return None
    left_mean = sum(left) / len(left)
    right_mean = sum(right) / len(right)
    numerator = sum(
        (left_value - left_mean) * (right_value - right_mean)
        for left_value, right_value in zip(left, right)
    )
    left_square = sum((value - left_mean) ** 2 for value in left)
    right_square = sum((value - right_mean) ** 2 for value in right)
    if left_square == 0.0 or right_square == 0.0:
        return None
    return numerator / math.sqrt(left_square * right_square)


def _spearman_with_ties(
    left: Mapping[str, float], right: Mapping[str, float]
) -> dict[str, object]:
    universe = sorted(set(left) | set(right))
    left_values = {key: float(left.get(key, 0.0)) for key in universe}
    right_values = {key: float(right.get(key, 0.0)) for key in universe}
    left_ranks = _average_descending_ranks(left_values)
    right_ranks = _average_descending_ranks(right_values)
    rho = _pearson(
        [left_ranks[key] for key in universe],
        [right_ranks[key] for key in universe],
    )
    return {
        "method": "spearman-average-ranks-descending-with-ties",
        "universe_count": len(universe),
        "rho": rho,
        "undefined_reason": (
            "fewer than two items or one ranking has zero variance" if rho is None else None
        ),
    }


def _tie_inclusive_top(values: Mapping[str, float], requested_k: int) -> set[str]:
    positive = sorted(
        ((key, value) for key, value in values.items() if value > 0.0),
        key=lambda item: (-item[1], item[0]),
    )
    if not positive:
        return set()
    boundary = positive[min(requested_k, len(positive)) - 1][1]
    return {key for key, value in positive if value >= boundary}


def _top_k_overlap(
    proxy_counts: Mapping[str, float],
    commercial_counts: Mapping[str, float],
    top_ks: Iterable[int],
) -> list[dict[str, object]]:
    results = []
    for requested_k in sorted(set(top_ks)):
        _require(requested_k > 0, "top-k values must be positive")
        proxy = _tie_inclusive_top(proxy_counts, requested_k)
        commercial = _tie_inclusive_top(commercial_counts, requested_k)
        intersection = proxy & commercial
        union = proxy | commercial
        results.append(
            {
                "requested_k": requested_k,
                "tie_policy": "include every positive-count item tied at the kth boundary",
                "proxy_set_size": len(proxy),
                "commercial_set_size": len(commercial),
                "overlap_count": len(intersection),
                "jaccard": len(intersection) / len(union) if union else None,
                "overlap": sorted(intersection),
            }
        )
    return results


def _commercial_master_counts(record: Mapping[str, Any]) -> tuple[dict[str, float], set[str]]:
    _require(record.get("schema") == "custom-cell-fmax-stage/1", "commercial adoption schema")
    _require(record.get("status") == "passed", "commercial adoption record did not pass")
    _require(record.get("stage") == "adoption", "commercial record is not an adoption stage")
    facts = _mapping(record.get("facts"), "commercial adoption facts")
    rows = _list(facts.get("candidate_rows"), "commercial candidate_rows")
    counts: dict[str, float] = {}
    offered: set[str] = set()
    for row_index, raw_row in enumerate(rows):
        row = _mapping(raw_row, f"commercial candidate_rows[{row_index}]")
        for master in _list(row.get("offered_masters"), f"candidate_rows[{row_index}].offered_masters"):
            _require(isinstance(master, str) and master, "offered master must be a string")
            offered.add(master)
            counts.setdefault(master, 0.0)
        for adopted_index, raw_adopted in enumerate(
            _list(row.get("adopted_masters"), f"candidate_rows[{row_index}].adopted_masters")
        ):
            adopted = _mapping(
                raw_adopted,
                f"candidate_rows[{row_index}].adopted_masters[{adopted_index}]",
            )
            master = adopted.get("master")
            _require(isinstance(master, str) and master, "adopted master must be a string")
            _require(master in offered, f"adopted master {master} is absent from offered_masters")
            count = _number(adopted.get("instance_count"), f"{master}.instance_count")
            _require(count >= 0.0, f"{master}.instance_count must not be negative")
            counts[master] = counts.get(master, 0.0) + count
    _require(offered, "commercial adoption record has no offered candidate masters")
    return counts, offered


def _proxy_master_counts(
    mapping_result: Mapping[str, Any], offered: set[str]
) -> dict[str, float]:
    _require(mapping_result.get("schema") == MAPPING_SCHEMA, "mapping result schema")
    _require(mapping_result.get("status") == "succeeded", "mapping result did not succeed")
    audit = _mapping(mapping_result.get("script_audit"), "mapping script_audit")
    for field in ("constraint_drift", "profile_drift", "rtl_drift", "top_drift"):
        _require(audit.get(field) is False, f"mapping script audit reports {field}")
    arms = _mapping(mapping_result.get("arms"), "mapping arms")
    for arm_name in ("reference", "augmented"):
        arm = _mapping(arms.get(arm_name), f"mapping arm {arm_name}")
        _require(arm.get("status") == "succeeded", f"mapping arm {arm_name} did not succeed")
    reference = _mapping(
        _mapping(arms["reference"], "mapping reference").get("adoption"),
        "mapping reference adoption",
    )
    augmented = _mapping(
        _mapping(arms["augmented"], "mapping augmented").get("adoption"),
        "mapping augmented adoption",
    )
    reference_census = _mapping(reference.get("cell_census"), "reference cell_census")
    augmented_census = _mapping(augmented.get("cell_census"), "augmented cell_census")
    leaked = sorted(
        master for master in offered if _number(reference_census.get(master, 0), master) > 0.0
    )
    _require(not leaked, f"candidate masters are present in reference mapping: {', '.join(leaked)}")
    counts = {
        master: _number(augmented_census.get(master, 0), f"augmented census {master}")
        for master in sorted(offered)
    }
    _require(all(value >= 0.0 for value in counts.values()), "proxy adoption count is negative")
    return counts


def _adoption_metrics(
    proxy_counts: Mapping[str, float], commercial_counts: Mapping[str, float]
) -> dict[str, object]:
    proxy = {key for key, value in proxy_counts.items() if value > 0.0}
    commercial = {key for key, value in commercial_counts.items() if value > 0.0}
    matched = proxy & commercial
    return {
        "identity_level": "exact custom-Cell master name",
        "proxy_adopted_count": len(proxy),
        "commercial_adopted_count": len(commercial),
        "matched_adopted_count": len(matched),
        "precision": len(matched) / len(proxy) if proxy else None,
        "recall": len(matched) / len(commercial) if commercial else None,
        "proxy_only": sorted(proxy - commercial),
        "commercial_only": sorted(commercial - proxy),
        "matched": sorted(matched),
    }


def _manifest_adoption_hashes(corpus: Mapping[str, Any]) -> dict[str, set[str]]:
    result: dict[str, set[str]] = {}
    for trial in _list(corpus.get("trials"), "corpus trials"):
        row = _mapping(trial, "corpus trial")
        trial_id = row.get("id")
        _require(isinstance(trial_id, str), "corpus trial id")
        for item in _list(row.get("evidence"), f"{trial_id}.evidence"):
            evidence = _mapping(item, f"{trial_id}.evidence item")
            if evidence.get("kind") == "dc-adoption":
                result.setdefault(str(evidence.get("sha256")), set()).add(trial_id)
    return result


def _verify_round_mapping_identity(
    round_evaluation: Mapping[str, Any], mapping_result: Mapping[str, Any]
) -> None:
    expected = mapping_result.get("request_sha256")
    embedded = round_evaluation.get("mapping")
    if isinstance(embedded, Mapping) and embedded.get("request_sha256") is not None:
        _require(
            embedded.get("request_sha256") == expected,
            "round evaluation embeds a different mapping request",
        )
        return
    hashes = round_evaluation.get("hashes")
    if isinstance(hashes, Mapping) and hashes.get("mapping_request_sha256") is not None:
        _require(
            hashes.get("mapping_request_sha256") == expected,
            "round evaluation references a different mapping request",
        )
        return
    raise CalibrationError("round evaluation does not bind its mapping request identity")


def _nested_metric(metrics: Mapping[str, Any], name: str) -> float | None:
    if "." not in name:
        return None
    layer, field = name.split(".", 1)
    layer_value = metrics.get(layer)
    if not isinstance(layer_value, Mapping):
        return None
    raw = layer_value.get(field)
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return None
    value = float(raw)
    return value if math.isfinite(value) else None


def _metric_change(
    *,
    metric: str,
    raw_change: float,
    direction: str,
    reference: float | None,
    augmented: float | None,
) -> dict[str, object]:
    _require(direction in {"minimize", "maximize", "descriptive-only"}, f"{metric}: direction")
    normalized = (
        -raw_change
        if direction == "minimize"
        else raw_change
        if direction == "maximize"
        else None
    )
    relation = (
        "descriptive-only"
        if normalized is None
        else "improved"
        if normalized > 0
        else "regressed"
        if normalized < 0
        else "equal"
    )
    return {
        "metric": metric,
        "layer": metric.split(".", 1)[0],
        "reference": reference,
        "augmented": augmented,
        "raw_augmented_minus_reference": raw_change,
        "canonical_direction": direction,
        "direction_owned_by_system": direction != "descriptive-only",
        "improvement_positive_change": normalized,
        "relation": relation,
    }


def _production_scenario_changes(
    scenario_name: str,
    scenario: Mapping[str, Any],
    canonical_directions: Mapping[str, Any],
) -> list[dict[str, object]]:
    changes = _mapping(scenario.get("changes"), f"round scenario {scenario_name}.changes")
    reference = _mapping(scenario.get("reference"), f"round scenario {scenario_name}.reference")
    augmented = _mapping(scenario.get("augmented"), f"round scenario {scenario_name}.augmented")
    records = []
    for metric, raw in sorted(changes.items()):
        raw_change = _number(raw, f"round scenario {scenario_name}.changes.{metric}")
        raw_direction = canonical_directions.get(metric, "descriptive-only")
        direction = str(raw_direction)
        records.append(
            _metric_change(
                metric=str(metric),
                raw_change=raw_change,
                direction=direction,
                reference=_nested_metric(reference, str(metric)),
                augmented=_nested_metric(augmented, str(metric)),
            )
        )
    _require(records, f"round scenario {scenario_name} has no numeric metric changes")
    return records


def _legacy_scenario_changes(
    scenario_name: str, scenario: Mapping[str, Any]
) -> list[dict[str, object]]:
    """Adapt only the retained v1 prediction-named fields into indicator changes."""

    release = _number(
        scenario.get("predicted_delta_ps"),
        f"round scenario {scenario_name}.predicted_delta_ps",
    )
    slack_gain = _number(
        scenario.get("worst_slack_gain_ps"),
        f"round scenario {scenario_name}.worst_slack_gain_ps",
    )
    mass_reduction = _number(
        scenario.get("negative_slack_mass_reduction_ps"),
        f"round scenario {scenario_name}.negative_slack_mass_reduction_ps",
    )
    return [
        _metric_change(
            metric="F3.worst_delay_indicator_ps",
            raw_change=-release,
            direction="minimize",
            reference=None,
            augmented=None,
        ),
        _metric_change(
            metric="F3.worst_slack_indicator_ps",
            raw_change=slack_gain,
            direction="maximize",
            reference=None,
            augmented=None,
        ),
        _metric_change(
            metric="F3.negative_slack_mass_indicator_ps",
            raw_change=-mass_reduction,
            direction="minimize",
            reference=None,
            augmented=None,
        ),
    ]


def _read_round_metrics(round_evaluation: Mapping[str, Any]) -> dict[str, object]:
    """Read the production scenario seam or explicitly adapt retained schema v1."""

    schema = round_evaluation.get("schema")
    _require(schema in ROUND_SCHEMAS, "round evaluation schema")
    _require(round_evaluation.get("status") == "succeeded", "round evaluation did not succeed")
    scenarios = _mapping(round_evaluation.get("scenarios"), "round scenarios")
    production_shape = any(
        isinstance(raw, Mapping)
        and all(key in raw for key in ("reference", "augmented", "changes"))
        for raw in scenarios.values()
    )
    if schema != "lfr-round-evaluation/1":
        _require(
            production_shape,
            f"{schema} must expose scenarios.*.reference/augmented/changes",
        )
        policy = _mapping(round_evaluation.get("metric_policy"), "round metric_policy")
        canonical_directions = _mapping(
            policy.get("canonical_directions"), "round canonical directions"
        )
        reader_mode = "production-layered-scenario-interface"
        legacy_fields: list[str] = []
    else:
        _require(
            not production_shape,
            "schema v1 unexpectedly uses the production layered scenario seam",
        )
        canonical_directions = {}
        reader_mode = "legacy-lfr-round-evaluation-v1-adapter"
        legacy_fields = [
            "scenarios.*.predicted_delta_ps",
            "scenarios.*.worst_slack_gain_ps",
            "scenarios.*.negative_slack_mass_reduction_ps",
        ]

    scenario_rows: list[dict[str, object]] = []
    unsupported = []
    metric_names: set[str] = set()
    for scenario_name, raw_scenario in sorted(scenarios.items()):
        scenario = _mapping(raw_scenario, f"round scenario {scenario_name}")
        if scenario.get("status", "succeeded") != "succeeded":
            unsupported.append(
                {
                    "scenario": str(scenario_name),
                    "status": scenario.get("status"),
                    "reason": scenario.get("reason"),
                }
            )
            continue
        changes = (
            _production_scenario_changes(
                str(scenario_name), scenario, canonical_directions
            )
            if production_shape
            else _legacy_scenario_changes(str(scenario_name), scenario)
        )
        metric_names.update(str(item["metric"]) for item in changes)
        scenario_rows.append(
            {
                "scenario": str(scenario_name),
                "assumptions": dict(scenario.get("assumptions", {})),
                "metric_changes": changes,
                "producer_pairwise_relation": scenario.get("pairwise_relation"),
                "path_migration": scenario.get("path_migration"),
            }
        )
    _require(scenario_rows, "round evaluation has no usable scenario metric changes")

    availability: dict[str, dict[str, object]] = {}
    for layer in ("F0", "F1", "F2", "F3"):
        names = sorted(name for name in metric_names if name.startswith(f"{layer}."))
        availability[layer] = {
            "available": bool(names),
            "metrics": names,
            "source": "round scenarios.*.changes" if names else None,
        }
    availability["F2"] = {
        "available": True,
        "metrics": sorted(
            set(availability["F2"]["metrics"])
            | {
                "mapping.adopted_custom_master_count",
                "mapping.custom_instance_count",
                "mapping.instance_count_order",
            }
        ),
        "source": "round scenarios.*.changes and paired Yosys/ABC mapping result",
    }
    return {
        "reader_mode": reader_mode,
        "legacy_source_fields": legacy_fields,
        "availability": availability,
        "scenario_metric_layers": sorted(
            {
                name.split(".", 1)[0]
                for name in metric_names
                if "." in name
            }
        ),
        "scenarios": scenario_rows,
        "unsupported_scenarios": unsupported,
    }


def _sign_relationship(left: float | None, right: float | None) -> str:
    if left is None or right is None:
        return "unavailable"
    left_sign = 1 if left > 0 else -1 if left < 0 else 0
    right_sign = 1 if right > 0 else -1 if right < 0 else 0
    if left_sign == 0 or right_sign == 0:
        return "one-or-both-flat"
    return "same-direction" if left_sign == right_sign else "opposite-direction"


def _metric_relationship(
    change: Mapping[str, Any],
    observed_wns_improvement_ps: float,
    observed_fmax_improvement_pct: float | None,
) -> dict[str, object]:
    normalized_raw = change.get("improvement_positive_change")
    normalized = (
        _number(normalized_raw, f"{change.get('metric')}.improvement_positive_change")
        if normalized_raw is not None
        else None
    )
    metric = str(change.get("metric"))
    return {
        **dict(change),
        "wns_sign_relationship": _sign_relationship(normalized, observed_wns_improvement_ps),
        "fmax_sign_relationship": _sign_relationship(normalized, observed_fmax_improvement_pct),
        "wns_numeric_gap_ps": (
            normalized - observed_wns_improvement_ps
            if normalized is not None and metric.endswith("_ps")
            else None
        ),
        "meaning": (
            "descriptive open-source metric/F4 relationship on this scenario and trial; "
            "not a commercial-benefit estimate or optimization target"
        ),
    }


def _open_source_f4_relationship(
    corpus: Mapping[str, Any], round_metrics: Mapping[str, Any]
) -> dict[str, object]:
    rows: list[dict[str, object]] = []
    condition_keys = set()
    scenarios = _list(round_metrics.get("scenarios"), "round scenarios")
    for raw_trial in _list(corpus.get("trials"), "corpus trials"):
        trial = _mapping(raw_trial, "corpus trial")
        facts = _mapping(trial.get("facts"), f"{trial.get('id')}.facts")
        _require(facts.get("comparisonValid") is True, f"{trial.get('id')} comparison is invalid")
        foundry = _number(facts.get("foundrySetupWnsNs"), "foundrySetupWnsNs")
        generated = _number(facts.get("generatedSetupWnsNs"), "generatedSetupWnsNs")
        observed_wns_improvement_ps = (generated - foundry) * 1000.0
        fmax_raw = facts.get("fmaxImprovementPct")
        observed_fmax_improvement_pct = (
            _number(fmax_raw, "fmaxImprovementPct") if fmax_raw is not None else None
        )
        conditions = _mapping(trial.get("conditions"), f"{trial.get('id')}.conditions")
        condition_identity = {
            "route_uncertainty_ns": conditions.get("routeUncertaintyNs"),
            "cts_policy": conditions.get("ctsPolicy"),
            "route_timing_expansion": conditions.get("routeTimingExpansion"),
            "pin_plan_sha256": conditions.get("pinPlanSha256"),
        }
        condition_keys.add(json.dumps(condition_identity, sort_keys=True))
        for raw_scenario in scenarios:
            scenario = _mapping(raw_scenario, "round scenario")
            changes = _list(scenario.get("metric_changes"), "open-source metric changes")
            rows.append(
                {
                    "scenario": scenario.get("scenario"),
                    "producer_pairwise_relation": scenario.get(
                        "producer_pairwise_relation"
                    ),
                    "open_source_metric_changes": [
                        _metric_relationship(
                            _mapping(change, "metric change"),
                            observed_wns_improvement_ps,
                            observed_fmax_improvement_pct,
                        )
                        for change in changes
                    ],
                    "scenario_assumptions": scenario.get("assumptions"),
                    "f4_trial_id": trial.get("id"),
                    "f4_qor_improvements": {
                        "matched_route_setup_wns_improvement_ps": observed_wns_improvement_ps,
                        "fmax_change_mhz": facts.get("fmaxDeltaMhz"),
                        "fmax_improvement_pct": observed_fmax_improvement_pct,
                        "route_custom_instance_count": facts.get("routeCustomInstanceCount"),
                    },
                    "f4_conditions": condition_identity,
                }
            )
    _require(rows, "corpus contains no commercial trial relationship rows")
    return {
        "status": "passed",
        "meaning": "relationship rows were computed; passed is not a correlation threshold",
        "scenario_count": len(scenarios),
        "commercial_trial_count": len(rows) // len(scenarios),
        "relationship_row_count": len(rows),
        "rows": rows,
        "conditions_homogeneous": len(condition_keys) == 1,
        "unsupported_scenarios": round_metrics.get("unsupported_scenarios", []),
    }


def build_calibration_report(
    *,
    corpus_path: Path,
    mapping_path: Path,
    mapping_sha256: str,
    commercial_adoption_path: Path,
    commercial_adoption_sha256: str | None = None,
    round_evaluation_path: Path | None = None,
    round_evaluation_sha256: str | None = None,
    top_ks: Sequence[int] = (5, 10),
) -> dict[str, object]:
    """Build a hash-bound calibration report without running any EDA tool."""

    corpus = load_manifest(corpus_path)
    validate_manifest(corpus)
    corpus_digest = _sha256_file(corpus_path)

    observed_mapping_sha = _verify_file(mapping_path, mapping_sha256, "mapping result")
    mapping_result = _load_json(mapping_path, "mapping result")

    observed_commercial_sha = _sha256_file(commercial_adoption_path)
    manifest_adoption_hashes = _manifest_adoption_hashes(corpus)
    _require(
        observed_commercial_sha in manifest_adoption_hashes,
        "commercial adoption record does not match any corpus dc-adoption identity",
    )
    if commercial_adoption_sha256 is not None:
        _verify_file(
            commercial_adoption_path,
            commercial_adoption_sha256,
            "commercial adoption record",
        )
    commercial = _load_json(commercial_adoption_path, "commercial adoption record")

    commercial_counts, offered = _commercial_master_counts(commercial)
    proxy_counts = _proxy_master_counts(mapping_result, offered)
    mapping_relationship = {
        "status": "passed",
        "meaning": (
            "F2 mapping and F4 commercial adoption relationship observations were computed; "
            "they are not benefit estimates or optimization targets"
        ),
        "relationship_observations": {
            "adoption_overlap": _adoption_metrics(proxy_counts, commercial_counts),
            "instance_count_rank_correlation": _spearman_with_ties(
                proxy_counts, commercial_counts
            ),
            "top_k_overlap": _top_k_overlap(proxy_counts, commercial_counts, top_ks),
        },
        "counts": {
            "f2_open_source_mapping_by_master": dict(sorted(proxy_counts.items())),
            "f4_commercial_adoption_by_master": dict(sorted(commercial_counts.items())),
        },
        "optimization_target": False,
        "applicable_scope": (
            "Exact master-name adoption and instance-count ordering for the retained AES RTL, "
            "47-Cell Library, fixed Yosys/ABC profile, and represented mapping constraints."
        ),
        "excluded_claims": [
            "DC adoption on another design or tool version",
            "physical adoption",
            "post-route direction or magnitude",
            "Fmax improvement",
            "function-class, pin-interface, or drive-variant correlation not present in the commercial record",
        ],
    }

    identities: dict[str, object] = {
        "corpus_file_sha256": corpus_digest,
        "corpus_identity_sha256": corpus["corpusIdentitySha256"],
        "mapping_result_sha256": observed_mapping_sha,
        "commercial_adoption_sha256": observed_commercial_sha,
        "commercial_adoption_manifest_trials": sorted(
            manifest_adoption_hashes[observed_commercial_sha]
        ),
    }
    gaps = [
        {
            "code": "commercial-record-has-no-function-interface-drive-identity",
            "impact": "F2/F4 adoption relationship is exact-master based, not function-class based",
        },
        {
            "code": "single-design-evidence",
            "impact": "no cross-design relationship or universal threshold can be inferred",
        },
    ]

    metric_availability: dict[str, dict[str, object]] = {
        "F0": {"available": False, "metrics": [], "source": None},
        "F1": {"available": False, "metrics": [], "source": None},
        "F2": {
            "available": True,
            "metrics": [
                "mapping.adopted_custom_master_count",
                "mapping.custom_instance_count",
                "mapping.instance_count_order",
            ],
            "source": "paired Yosys/ABC mapping result",
        },
        "F3": {"available": False, "metrics": [], "source": None},
    }

    if round_evaluation_path is None:
        _require(
            round_evaluation_sha256 is None,
            "round evaluation SHA-256 was supplied without a round evaluation file",
        )
        metric_relationship: dict[str, object] = {
            "status": "not_evaluated",
            "root_causes": ["no round evaluation was supplied"],
            "applicable_scope": None,
        }
        gaps.append(
            {
                "code": "open-source-f4-relationship-not-evaluated",
                "impact": "no scenario metric changes were supplied for comparison with F4 QoR",
            }
        )
        round_reader = None
        scenario_metric_layers: set[str] = set()
    else:
        _require(
            round_evaluation_sha256 is not None,
            "round evaluation requires a caller-provided SHA-256",
        )
        observed_round_sha = _verify_file(
            round_evaluation_path,
            round_evaluation_sha256,
            "round evaluation",
        )
        identities["round_evaluation_sha256"] = observed_round_sha
        round_evaluation = _load_json(round_evaluation_path, "round evaluation")
        _verify_round_mapping_identity(round_evaluation, mapping_result)
        round_metrics = _read_round_metrics(round_evaluation)
        metric_availability = dict(round_metrics["availability"])
        scenario_metric_layers = set(round_metrics["scenario_metric_layers"])
        metric_relationship = _open_source_f4_relationship(corpus, round_metrics)
        metric_relationship["applicable_scope"] = (
            "Descriptive F0-F3 scenario-metric and F4 QoR relationships for retained AES trials, "
            "with each commercial trial's APR/CTS conditions kept distinct."
        )
        metric_relationship["excluded_claims"] = [
            "commercial QoR estimation from open-source metrics",
            "causal isolation of wire, fanout, CTS, congestion, or path migration",
            "commercial Fmax prediction on another design, Library, Site, or tool version",
        ]
        round_reader = {
            "mode": round_metrics["reader_mode"],
            "legacy_source_fields": round_metrics["legacy_source_fields"],
        }
        if metric_relationship["conditions_homogeneous"] is False:
            gaps.append(
                {
                    "code": "commercial-trial-conditions-differ",
                    "impact": (
                        "metric/F4 relationship rows remain trial-specific and cannot define a "
                        "cross-condition transform or universal numeric threshold"
                    ),
                }
            )

    available_layers = [
        layer for layer, row in metric_availability.items() if row.get("available") is True
    ]
    for layer in ("F0", "F1", "F2", "F3"):
        if layer not in available_layers:
            gaps.append(
                {
                    "code": f"{layer.lower()}-metrics-unavailable",
                    "impact": f"no {layer}/F4 relationship is present in this report",
                }
            )
    return {
        "schema": REPORT_SCHEMA,
        "status": "passed",
        "meaning": (
            "all supplied identities were verified and available relationship observations were "
            "computed; passed means computation complete"
        ),
        "universal_thresholds_applied": False,
        "commercial_eda_executed": False,
        "assessment_complete": metric_relationship["status"] == "passed",
        "identities": identities,
        "metric_availability": metric_availability,
        "available_metric_layers": available_layers,
        "round_reader": round_reader,
        "f2_to_f4_adoption_relationship": mapping_relationship,
        "f0_f3_to_f4_qor_relationship": metric_relationship,
        "relation_evidence_coverage": {
            **{
                f"{layer}_to_F4": (
                    "observed-scenario-by-trial"
                    if layer in scenario_metric_layers
                    and metric_relationship["status"] == "passed"
                    else "observed-exact-master-adoption-only"
                    if layer == "F2"
                    else "not-observed"
                )
                for layer in ("F0", "F1", "F2", "F3")
            },
            "F2_adoption_to_F4": "observed-exact-master-adoption",
            "design_count": 1,
            "commercial_trial_count": len(corpus["trials"]),
            "scenario_count": metric_relationship.get("scenario_count", 0),
            "relationship_row_count": metric_relationship.get("relationship_row_count", 0),
        },
        "root_causes": [],
        "gaps": gaps,
        "applicable_scope": {
            "design_top": corpus["design"]["top"],
            "corpus_id": corpus["corpusId"],
            "F2_to_F4": mapping_relationship["applicable_scope"],
            "F0_F3_to_F4": metric_relationship.get("applicable_scope"),
        },
    }


def failed_report(error: Exception) -> dict[str, object]:
    return {
        "schema": REPORT_SCHEMA,
        "status": "failed",
        "meaning": "relationship evidence was rejected before observations were drawn",
        "universal_thresholds_applied": False,
        "commercial_eda_executed": False,
        "assessment_complete": False,
        "root_causes": [str(error)],
        "applicable_scope": None,
        "gaps": [],
    }


def _parse_top_ks(value: str) -> tuple[int, ...]:
    try:
        parsed = tuple(int(item.strip()) for item in value.split(",") if item.strip())
    except ValueError as error:
        raise argparse.ArgumentTypeError("top-k must be comma-separated integers") from error
    if not parsed or any(item <= 0 for item in parsed):
        raise argparse.ArgumentTypeError("top-k values must be positive")
    return parsed


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--mapping", type=Path, required=True)
    parser.add_argument("--mapping-sha256", required=True)
    parser.add_argument("--commercial-adoption", type=Path, required=True)
    parser.add_argument("--commercial-adoption-sha256")
    parser.add_argument("--round-evaluation", type=Path)
    parser.add_argument("--round-evaluation-sha256")
    parser.add_argument("--top-k", type=_parse_top_ks, default=(5, 10))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        report = build_calibration_report(
            corpus_path=args.corpus,
            mapping_path=args.mapping,
            mapping_sha256=args.mapping_sha256,
            commercial_adoption_path=args.commercial_adoption,
            commercial_adoption_sha256=args.commercial_adoption_sha256,
            round_evaluation_path=args.round_evaluation,
            round_evaluation_sha256=args.round_evaluation_sha256,
            top_ks=args.top_k,
        )
    except (CalibrationError, OSError, KeyError, TypeError, ValueError) as error:
        report = failed_report(error)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return 0 if report["status"] == "passed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
