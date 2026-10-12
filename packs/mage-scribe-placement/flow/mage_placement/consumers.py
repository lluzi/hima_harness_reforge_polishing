"""Consumer models and the Finding evaluator for the mage-scribe-placement Pack.

A *consumer model* (`flow/consumer_models/<id>.json`, schema
`mage.consumer-model/1`) names one downstream process (litho-pie overlay,
metrology, ASML/Canon alignment, WAT, bonding) and the `requirements[]` a
candidate layout must satisfy for it, each `{id, kind: hard|cost, predicate,
parameters, cost, source, confidence}`. `load_consumer_model` reads the JSON
twin (the `.yml` sibling is the human-edited mirror; both are expected to
carry identical content, checked by `tests/test_consumers.py`'s own small
YAML-subset reader -- no YAML dependency ships in this module) and validates
it against `flow/schemas/consumer-model.json`.

`evaluate()` runs every requirement's predicate against a candidate/start
snapshot pair and writes one evaluator-receipt artifact per (consumer,
candidate). **Evaluator-receipt rule**: the receipt file itself is written
*first*, with every Finding's `evaluatorReceipt` field left out of the
written body (findings carry every other `mage.finding/1` field already,
including a sequence `id` -- `'F-<n>'`, numbered within this receipt -- and
`round: 0`; both are placeholders a later caller, such as Task 7's review
assembler, may renumber for a real round). The receipt file's own sha256
(`core.write_artifact`'s return value) is then copied onto each returned
Finding's `evaluatorReceipt` -- so the receipt body itself never contains
its own hash, but every Finding handed back to the caller carries it.

Ten predicates (`_PREDICATES`), each a `(requirement, scope, context,
candidate_snapshot, start_snapshot, verify_files, goal) -> list[partial
finding dict]` function, reusing `metrics.py` for every distance/order/
displacement/native-row computation rather than re-deriving the arithmetic:
`placed`, `target_distance`, `order_deviation`, `region_coverage`,
`pair_cohesion`, `orientation_unchanged`, `rigid_unit`,
`move_in_pitch_units`, `edit_on_move`, `native_rows_for`. A requirement
naming any other predicate string raises `MageError('model', ...)` --
**except** the sentinel `not_implemented`, reserved for a requirement this
Pack version deliberately does not evaluate (ASML/Canon's `canon-side-rule`
in 0.1.0: Canon side rules and TVPA separation thresholds are real customer
requirements, but have no implementation here yet). `evaluate()` turns a
`not_implemented` requirement straight into an `unknown` Finding carrying
its `cost`/explanation text as the reason, without going through the
predicate dispatch table -- it is a documented escape hatch, not an
eleventh real predicate, so it never counts against "any predicate name not
in this list".

A requirement's `parameters` are each either a literal `{"value": ...}` or
a `{"from": "consumerContext", "key": "<ns>.<name>"}` lookup resolved
against the `consumerContext` document passed as `context`
(`context[ns][name]["value"]`). A missing key resolves to `(None, key)` --
every predicate that depends on such a parameter turns that into a
`status: 'unknown'` Finding with `numbers.missing` naming the key, never a
silent zero. `target_distance`'s `limit_um` and `order_deviation`'s
`threshold` additionally fall back to the optional `goal` dict (`{
'max_target_distance_um', 'max_order_deviation', 'target_dropped_count'}`,
the same shape as the Pack's goal knobs) when the consumer-context key is
absent, since those two thresholds are also ordinary case-wide goal knobs.
"""
from __future__ import annotations

import hashlib
import json
from decimal import Decimal
from pathlib import Path

from . import core, metrics


SCHEMAS_DIR = Path(__file__).resolve().parents[1] / "schemas"


def load_consumer_model(models_dir, consumer_id):
    """Read and validate `<models_dir>/<consumer_id>.json` against `mage.consumer-model/1`."""
    path = Path(models_dir) / f"{consumer_id}.json"
    try:
        body = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise core.MageError("missing-input", f"cannot read consumer model {path}: {exc}") from exc
    schema = json.loads((SCHEMAS_DIR / "consumer-model.json").read_text(encoding="utf-8"))
    errors = core.validate(body, schema)
    if errors:
        raise core.MageError("schema", "; ".join(errors))
    return body


def _in_scope(item, scope):
    """True when `item` (a Fit or a Pending entry) matches `consumer_model['scope']`.

    `scope: {"priority": true}` matches a Group-placed mark: a Fit's own
    `priority` flag when present, else (a Pending entry has none) a
    non-empty `inGroup`. `scope: {"blockTypes": [...]}` matches
    `item['blockType']` against that list.
    """
    if scope.get("priority"):
        if "priority" in item:
            return bool(item["priority"])
        return bool(item.get("inGroup"))
    block_types = scope.get("blockTypes")
    if block_types is not None:
        return item.get("blockType") in block_types
    return False


def _resolve_parameter(spec, context):
    """`(value, missing_key)` for one requirement parameter spec.

    `{"value": x}` resolves to `(x, None)` unconditionally. `{"from":
    "consumerContext", "key": "<ns>.<name>"}` resolves to
    `(context[ns][name]['value'], None)` when that path is a known Measure,
    else `(None, "<ns>.<name>")`. Any other spec shape is a model-authoring
    error (`MageError('model', ...)`), not a data-availability one.
    """
    if "value" in spec:
        return spec["value"], None
    if spec.get("from") == "consumerContext":
        key = spec["key"]
        namespace, _, name = key.partition(".")
        node = context.get(namespace) if isinstance(context, dict) else None
        entry = node.get(name) if isinstance(node, dict) else None
        if isinstance(entry, dict) and "value" in entry:
            return entry["value"], None
        return None, key
    raise core.MageError("model", f"unrecognised parameter source: {spec!r}")


def _severity(requirement):
    """A Finding's `severity` for a requirement-kind-driven predicate: `'hard'` when
    `requirement['kind'] == 'hard'`, else `'cost'`. Every predicate but the purely
    informational `native_rows_for` (always `'info'`) and the `not_implemented`
    sentinel (follows `requirement['kind']` directly, defaulting to `'hard'`) routes
    its pass/fail severity through this one helper, so a model's `kind` field is the
    single source of truth for how serious a Finding is -- never a predicate-specific
    hard-coded literal."""
    return "hard" if requirement.get("kind") == "hard" else "cost"


def _partial(predicate, status, severity, targets, numbers, explanation):
    return {
        "targets": list(targets),
        "predicate": predicate,
        "status": status,
        "severity": severity,
        "numbers": numbers,
        "explanation": explanation,
    }


def _displacement_vector(start_fit, candidate_fit):
    l0, b0, r0, t0 = start_fit["boxDbu"]
    l1, b1, r1, t1 = candidate_fit["boxDbu"]
    return ((l1 + r1) - (l0 + r0), (b1 + t1) - (b0 + t0))


def _box_size(box):
    l, b, r, t = box
    return (r - l, t - b)


def _trim(decimal_value):
    text = format(decimal_value, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


# ---------------------------------------------------------------------------
# Predicates
# ---------------------------------------------------------------------------


def _placed(requirement, scope, context, candidate, start, verify_files, goal):
    pending_in_scope = [p for p in candidate["pending"] if _in_scope(p, scope)]
    if pending_in_scope:
        return [
            _partial(
                "placed", "fail", _severity(requirement), [item["id"]],
                {"blockType": item.get("blockType")},
                f"{item['id']} is still pending (not placed)",
            )
            for item in pending_in_scope
        ]
    placed_count = sum(1 for fit in candidate["fits"] if _in_scope(fit, scope))
    return [_partial("placed", "pass", _severity(requirement), [], {"placedCount": placed_count},
                      "all in-scope items are placed")]


def _target_distance(requirement, scope, context, candidate, start, verify_files, goal):
    spec = requirement.get("parameters", {}).get("limit_um")
    limit_value, missing_key = _resolve_parameter(spec, context) if spec is not None else (None, None)
    if limit_value is None and goal is not None:
        limit_value = goal.get("max_target_distance_um")
    if limit_value is None:
        return [
            _partial(
                "target_distance", "unknown", requirement["kind"], [],
                {"missing": [missing_key] if missing_key else []},
                "target distance limit is unknown",
            )
        ]
    limit_decimal = Decimal(str(limit_value))
    result = metrics.target_distances(candidate, str(limit_value))
    over = [entry for entry in result["perTarget"] if Decimal(entry["alongUm"]) > limit_decimal]

    if requirement["kind"] == "hard":
        if not over:
            return [
                _partial("target_distance", "pass", "hard", [], {"maxUm": result["maxUm"]},
                          "all in-scope targets are within the limit")
            ]
        return [
            _partial(
                "target_distance", "fail", "hard", [entry["fitId"]],
                {"alongUm": entry["alongUm"], "limitUm": str(limit_value)},
                f"{entry['fitId']} exceeds the target distance limit",
            )
            for entry in over
        ]

    status = "fail" if over else "pass"
    return [
        _partial(
            "target_distance", status, "cost", [entry["fitId"] for entry in over],
            {"overLimitCount": result["overLimitCount"], "maxUm": result["maxUm"], "limitUm": str(limit_value)},
            "target distance rework beyond the limit",
        )
    ]


def _order_deviation(requirement, scope, context, candidate, start, verify_files, goal):
    spec = requirement.get("parameters", {}).get("threshold")
    threshold, missing_key = _resolve_parameter(spec, context) if spec is not None else (None, None)
    if threshold is None and goal is not None:
        threshold = goal.get("max_order_deviation")
    if threshold is None:
        return [
            _partial(
                "order_deviation", "unknown", requirement["kind"], [],
                {"missing": [missing_key] if missing_key else []},
                "order deviation threshold is unknown",
            )
        ]
    result = metrics.order_deviation(candidate)
    status = "fail" if result["max"] > int(threshold) else "pass"
    return [
        _partial(
            "order_deviation", status, requirement["kind"], [],
            {"max": result["max"], "threshold": int(threshold), "byPartition": result["byPartition"]},
            "placement order deviation versus the requested order",
        )
    ]


_WATCHED_REGIONS = ((0, 0), (0, 2), (2, 0), (2, 2), (1, 1))  # corners + centre of a 3x3 grid


def _region_index(frame, box):
    l, b, r, t = box
    width_doubled, height_doubled = 2 * frame["widthDbu"], 2 * frame["heightDbu"]
    centre_x_doubled, centre_y_doubled = l + r, b + t
    col = min(2, (centre_x_doubled * 3) // width_doubled) if width_doubled > 0 else 0
    row = min(2, (centre_y_doubled * 3) // height_doubled) if height_doubled > 0 else 0
    return int(row), int(col)


def _region_counts(frame, snapshot, scope):
    counts = {}
    for fit in snapshot["fits"]:
        if not _in_scope(fit, scope):
            continue
        idx = _region_index(frame, fit["boxDbu"])
        counts[idx] = counts.get(idx, 0) + 1
    return counts


def _region_coverage(requirement, scope, context, candidate, start, verify_files, goal):
    frame = candidate["frame"]
    before = _region_counts(frame, start, scope)
    after = _region_counts(frame, candidate, scope)

    per_region = {f"{row},{col}": {"before": before.get((row, col), 0), "after": after.get((row, col), 0)}
                  for row, col in _WATCHED_REGIONS}
    failed = [(row, col) for row, col in _WATCHED_REGIONS if before.get((row, col), 0) >= 1 and after.get((row, col), 0) == 0]

    if failed:
        return [
            _partial(
                "region_coverage", "fail", _severity(requirement), [],
                {"region": f"{row},{col}", "before": before.get((row, col), 0), "after": 0},
                f"region {row},{col} (corner or centre) dropped to zero in-scope sites",
            )
            for row, col in failed
        ]
    return [_partial("region_coverage", "pass", _severity(requirement), [], {"regions": per_region},
                      "corners and centre keep coverage")]


def _pair_cohesion(requirement, scope, context, candidate, start, verify_files, goal):
    start_by_id = {fit["id"]: fit for fit in start["fits"]}
    rule_facts = candidate.get("ruleFacts", {})
    clusters = {}
    for fit in candidate["fits"]:
        if not _in_scope(fit, scope):
            continue
        rule_item = fit.get("ruleItem")
        cluster = rule_facts.get(rule_item, {}).get("cluster") if rule_item else None
        if not cluster:
            continue
        start_fit = start_by_id.get(fit["id"])
        if start_fit is None:
            continue
        vector = _displacement_vector(start_fit, fit)
        clusters.setdefault(cluster, []).append((fit["id"], vector))

    findings = []
    for cluster, members in clusters.items():
        if len({vector for _, vector in members}) > 1:
            findings.append(
                _partial(
                    "pair_cohesion", "fail", _severity(requirement), [member_id for member_id, _ in members],
                    {"cluster": cluster, "memberCount": len(members)},
                    f"cluster {cluster!r} did not move together",
                )
            )
    if findings:
        return findings
    return [_partial("pair_cohesion", "pass", _severity(requirement), [], {"clusterCount": len(clusters)},
                      "paired fits moved together")]


def _orientation_unchanged(requirement, scope, context, candidate, start, verify_files, goal):
    start_by_id = {fit["id"]: fit for fit in start["fits"]}
    mismatched = [
        fit["id"] for fit in candidate["fits"]
        if _in_scope(fit, scope) and fit["id"] in start_by_id and start_by_id[fit["id"]]["extraRot"] != fit["extraRot"]
    ]
    if mismatched:
        return [_partial("orientation_unchanged", "fail", _severity(requirement), mismatched,
                          {"count": len(mismatched)}, "orientation changed for in-scope fits")]
    return [_partial("orientation_unchanged", "pass", _severity(requirement), [], {},
                      "orientation unchanged for in-scope fits")]


def _rigid_unit(requirement, scope, context, candidate, start, verify_files, goal):
    start_by_id = {fit["id"]: fit for fit in start["fits"]}
    mismatched = [
        fit["id"] for fit in candidate["fits"]
        if _in_scope(fit, scope) and fit["id"] in start_by_id
        and _box_size(start_by_id[fit["id"]]["boxDbu"]) != _box_size(fit["boxDbu"])
    ]
    if mismatched:
        return [_partial("rigid_unit", "fail", _severity(requirement), mismatched,
                          {"count": len(mismatched)}, "rigid unit size changed for in-scope fits")]
    return [_partial("rigid_unit", "pass", _severity(requirement), [], {}, "rigid unit size unchanged for in-scope fits")]


def _in_scope_moved(scope, candidate, start):
    """`metrics.displacement` entries for in-scope fits that moved, newest-box lookup included."""
    disp = metrics.displacement(start, candidate)
    candidate_by_id = {fit["id"]: fit for fit in candidate["fits"]}
    return [
        entry for entry in disp["perFit"]
        if entry["id"] in candidate_by_id and _in_scope(candidate_by_id[entry["id"]], scope)
    ]


def _move_in_pitch_units(requirement, scope, context, candidate, start, verify_files, goal):
    spec = requirement.get("parameters", {}).get("pad_pitch_um")
    pitch, missing_key = _resolve_parameter(spec, context) if spec is not None else (None, None)
    if pitch is None:
        return [
            _partial("move_in_pitch_units", "unknown", "cost", [],
                     {"missing": [missing_key] if missing_key else []}, "pad pitch is unknown")
        ]
    pitch_decimal = Decimal(str(pitch))
    moved = _in_scope_moved(scope, candidate, start)
    if not moved:
        return [_partial("move_in_pitch_units", "pass", "cost", [],
                          {"movedKeys": 0, "maxPitchUnits": "0", "wrongPadRisk": []}, "no in-scope keys moved")]

    units_by_id = {}
    for entry in moved:
        delta_um = Decimal(entry["dxUm"]).copy_abs() + Decimal(entry["dyUm"]).copy_abs()
        units_by_id[entry["id"]] = delta_um / pitch_decimal
    max_units = max(units_by_id.values())
    risk = sorted(fit_id for fit_id, units in units_by_id.items() if units >= Decimal("0.5"))
    status = "fail" if risk else "pass"
    return [
        _partial(
            "move_in_pitch_units", status, "cost", sorted(units_by_id),
            {"movedKeys": len(units_by_id), "maxPitchUnits": _trim(max_units), "wrongPadRisk": risk},
            "move distance in pad-pitch units",
        )
    ]


def _edit_on_move(requirement, scope, context, candidate, start, verify_files, goal):
    spec = requirement.get("parameters", {}).get("window_um")
    window, missing_key = _resolve_parameter(spec, context) if spec is not None else (None, None)
    moved = _in_scope_moved(scope, candidate, start)
    if window is None:
        return [
            _partial(
                "edit_on_move", "unknown", "cost", [entry["id"] for entry in moved],
                {"missing": [missing_key] if missing_key else [], "movedCount": len(moved)},
                "edit window is unknown; raw moved count only",
            )
        ]
    window_decimal = Decimal(str(window))
    beyond = [
        entry for entry in moved
        if (Decimal(entry["dxUm"]).copy_abs() + Decimal(entry["dyUm"]).copy_abs()) > window_decimal
    ]
    status = "fail" if beyond else "pass"
    return [
        _partial(
            "edit_on_move", status, "cost", [entry["id"] for entry in beyond],
            {"count": len(beyond), "windowUm": str(window_decimal)},
            "targets moved beyond the edit window",
        )
    ]


def _native_rows_for(requirement, scope, context, candidate, start, verify_files, goal):
    spec = requirement.get("parameters", {}).get("types")
    types, _missing_key = _resolve_parameter(spec, context) if spec is not None else (list(metrics.NATIVE_TYPES), None)
    in_scope_ids = [fit["id"] for fit in candidate["fits"] if _in_scope(fit, scope)]
    rows = metrics.native_rows(verify_files)

    findings = []
    for type_name in types:
        path = verify_files.get(type_name)
        if path is None or rows["byType"].get(type_name) is None:
            findings.append(_partial("native_rows_for", "unknown", "info", [],
                                      {"type": type_name}, f"native verify file missing for {type_name}"))
            continue
        try:
            text = Path(path).read_text(encoding="utf-8")
        except OSError:
            text = ""
        matched = [fit_id for fit_id in in_scope_ids if fit_id in text]
        findings.append(
            _partial(
                "native_rows_for", "pass", "info", matched,
                {"type": type_name, "rowCount": rows["byType"][type_name], "matchedFits": len(matched)},
                f"native {type_name} rows mentioning in-scope fits",
            )
        )
    return findings


_PREDICATES = {
    "placed": _placed,
    "target_distance": _target_distance,
    "order_deviation": _order_deviation,
    "region_coverage": _region_coverage,
    "pair_cohesion": _pair_cohesion,
    "orientation_unchanged": _orientation_unchanged,
    "rigid_unit": _rigid_unit,
    "move_in_pitch_units": _move_in_pitch_units,
    "edit_on_move": _edit_on_move,
    "native_rows_for": _native_rows_for,
}


def evaluate(consumer_model, context, candidate_snapshot, start_snapshot, verify_files, out_dir, goal=None):
    """Run every requirement's predicate; write and return the evaluator receipt.

    Returns `{'findings': [...], 'receiptPath': str, 'receiptSha256': str}`.
    See the module docstring for the evaluator-receipt rule governing each
    Finding's `evaluatorReceipt` field.

    `evaluate()` does not look at `consumer_model.get('enabled')` -- a
    disabled model (e.g. `bonding`, `enabled: false`) is evaluated exactly
    like any other if the caller passes it in. Deciding *which* consumer
    models to run (skipping disabled ones) is the caller's job, not this
    function's; `evaluate()` only ever evaluates the model it is handed.

    `consumerContext`'s `limitHardness` field is not consulted here in
    0.1.0 -- it exists in `flow/schemas/consumer-context.json` for a future
    version to use, but today `target_distance`'s severity (like every
    other predicate's) comes from the requirement's own `kind` field in
    the consumer model (`hard` -> `'hard'`, `cost` -> `'cost'`), never from
    `limitHardness`.
    """
    consumer_id = consumer_model["id"]
    version = consumer_model["version"]
    scope = consumer_model.get("scope", {})

    partials = []
    for requirement in consumer_model.get("requirements", []):
        predicate_name = requirement["predicate"]
        if predicate_name == "not_implemented":
            reason = requirement.get("cost") or f"{requirement['id']} is not implemented in consumer model version {version}"
            partials.append(_partial(predicate_name, "unknown", requirement.get("kind", "hard"), [], {}, reason))
            continue
        predicate_fn = _PREDICATES.get(predicate_name)
        if predicate_fn is None:
            raise core.MageError("model", f"unknown predicate: {predicate_name!r}")
        partials.extend(
            predicate_fn(requirement, scope, context, candidate_snapshot, start_snapshot, verify_files, goal)
        )

    findings = []
    for index, partial in enumerate(partials, start=1):
        finding = dict(partial)
        finding["schema"] = "mage.finding/1"
        finding["id"] = f"F-{index}"
        finding["round"] = 0
        finding["snapshotSha256"] = candidate_snapshot["snapshotSha256"]
        finding["consumer"] = consumer_id
        finding["consumerModel"] = f"{consumer_id}@{version}"
        finding["evaluatorReceipt"] = ""
        findings.append(finding)

    receipt_body = {
        "schema": "mage.evaluator-receipt/1",
        "consumerModel": f"{consumer_id}@{version}",
        "snapshotSha256": candidate_snapshot["snapshotSha256"],
        "startSnapshotSha256": start_snapshot["snapshotSha256"],
        "contextSha256": hashlib.sha256(core.canonical(context)).hexdigest(),
        "findings": [{key: value for key, value in finding.items() if key != "evaluatorReceipt"} for finding in findings],
    }
    receipt_path = Path(out_dir) / f"{consumer_id}-{candidate_snapshot['snapshotSha256'][:12]}.json"
    receipt_sha256 = core.write_artifact(receipt_path, receipt_body)

    for finding in findings:
        finding["evaluatorReceipt"] = receipt_sha256

    return {"findings": findings, "receiptPath": str(receipt_path), "receiptSha256": receipt_sha256}
