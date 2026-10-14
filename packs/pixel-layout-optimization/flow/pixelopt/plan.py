"""Check a ``pixel.plan/1`` and emit the ``pixel-plan`` Reader values (stdlib).

A plan is the resident engineering agent's single result. :func:`check`
validates it against the schema, the resolved Goal, the Strategy, the
manifest's layers and nets and the history's candidate ids, returning a list
of human error strings (empty means the plan is admissible).
:func:`reader_values` is the ``pixel-plan`` Reader: it runs :func:`check` and
emits the five typed counts of ``SPEC.md`` Semantics.

This module runs on the Site host's ``python3``; it imports nothing outside
the standard library.
"""
from __future__ import annotations

import os

from . import core

__all__ = ["check", "reader_values"]

_OPERATORS = ("shield", "cst-stretch", "opening-shift", "band-trim", "contact-move")


def _num(x):
    if isinstance(x, bool):
        return None
    if isinstance(x, (int, float)):
        return float(x)
    return None


def _net_universe(manifest):
    """Every net name the manifest declares, for operator validation."""
    nets = set()
    n = manifest.get("nets", {}) or {}
    for key in ("storageNode", "storageNet", "anode"):
        if isinstance(n.get(key), str):
            nets.add(n[key])
    for defn in (manifest.get("ratioDefinitions", {}) or {}).values():
        for name in defn or []:
            nets.add(name)
    for name in manifest.get("loadLimitedLines", []) or []:
        nets.add(name)
    for lim in manifest.get("couplingLimits", []) or []:
        for name in lim.get("pair", []) or []:
            nets.add(name)
    return nets


def _exceeds_goal(fp, gvalues):
    """True when a front point's own limits are looser than the Goal's.

    A larger load allowance than the Goal's makes the point exploratory: it can
    never be the delivered layout and exists only for the trade-off table.
    """
    # The outline and the ratio are Goal targets, not hard limits: a point asking for a larger
    # outline (a relaxed pitch after a measured shortfall) or a ratio cap is an ordinary point and
    # can be delivered with its shortfall stated. Only a looser hard limit makes a point exploratory.
    la = _num(fp.get("loadAllowancePct"))
    gla = _num(gvalues.get("load_allowance_pct"))
    if la is not None and gla is not None and la > gla + 1e-9:
        return True
    return False


def check(plan, readiness, history_ids, round=None):
    """Return a list of error strings; empty means the plan is admissible.

    ``plan`` is a ``pixel.plan/1`` dict, ``readiness`` the case-readiness dict
    (for the resolved Goal, the Strategy and the manifest), ``history_ids`` the
    candidate ids a repair base may name. ``round``, when given, is the round
    the plan must declare.
    """
    errors = []

    schema_errors = core.validate(plan, core.load_schema("plan"))
    if schema_errors:
        # A structurally broken plan is reported alone: later field reads are
        # unsafe once the shape is wrong.
        return ["schema: " + e for e in schema_errors]

    goal = (readiness or {}).get("goal", {}) or {}
    gvalues = goal.get("values", {}) or {}
    manifest = (readiness or {}).get("manifest", {}) or {}
    layers = set((manifest.get("layers", {}) or {}).keys())
    nets = _net_universe(manifest)
    topo = goal.get("topologyMoves", "off")
    ceiling = _num(gvalues.get("cst_ceiling_ff")) or 0.0

    # -- round ------------------------------------------------------------- #
    if round is not None and plan.get("round") != round:
        errors.append("round %r does not match the current round %r"
                      % (plan.get("round"), round))

    # -- base -------------------------------------------------------------- #
    base = plan.get("base")
    if base not in ("original", "best") and base not in set(history_ids or []):
        errors.append("base %r is neither 'original', 'best', nor a history candidate id" % (base,))

    # -- front points ------------------------------------------------------ #
    fronts = plan.get("frontPoints", [])
    if len(fronts) > 6:
        errors.append("%d front points exceeds the maximum of 6" % len(fronts))
    for fp in fronts:
        name = fp.get("name", "?")
        if fp.get("objective") not in ("legalise", "min-pitch", "min-ratio"):
            errors.append("front point %r has an unknown objective %r" % (name, fp.get("objective")))
        if fp.get("throughChain") and fp.get("objective") != "min-pitch":
            errors.append("front point %r asks throughChain, which only a min-pitch point takes" % name)
        exploratory = bool(fp.get("exploratory"))
        exceeds = _exceeds_goal(fp, gvalues)
        if exceeds and not exploratory:
            errors.append("front point %r has limits looser than the Goal but is not marked exploratory" % name)
        if exploratory and not exceeds:
            errors.append("front point %r is marked exploratory but its limits do not exceed the Goal" % name)

    # -- operators --------------------------------------------------------- #
    for op in plan.get("operators", []):
        kind = op.get("op")
        if kind not in _OPERATORS:
            errors.append("operator %r is not one of %s" % (kind, ", ".join(_OPERATORS)))
            continue
        if kind == "cst-stretch" and ceiling <= 0:
            errors.append("operator 'cst-stretch' needs cst_ceiling_ff above 0")
        if kind == "contact-move" and topo != "allowed":
            errors.append("operator 'contact-move' needs topologyMoves 'allowed'")
        # layer / net references must exist in the manifest
        if "layer" in op and op["layer"] not in layers:
            errors.append("operator %r names unknown layer %r" % (kind, op["layer"]))
        for key in ("net",):
            if key in op and op[key] not in nets:
                errors.append("operator %r names unknown net %r" % (kind, op[key]))
        over = op.get("over") if isinstance(op.get("over"), dict) else {}
        for key in ("victim", "aggressor"):
            if key in over and over[key] not in nets:
                errors.append("operator %r 'over.%s' names unknown net %r" % (kind, key, over[key]))

    # -- edits ------------------------------------------------------------- #
    edits = plan.get("edits", [])
    if len(edits) > 12:
        errors.append("%d bounded edits exceeds the maximum of 12" % len(edits))
    for i, edit in enumerate(edits):
        if edit.get("layer") not in layers:
            errors.append("edit %d names unknown layer %r" % (i, edit.get("layer")))
        if "box" in edit:
            bx = edit.get("box")
            if edit.get("op") not in ("add", "cut") or not isinstance(bx, list) or len(bx) != 4 \
                    or any(_num(v) is None for v in bx):
                errors.append("edit %d needs op add|cut and a box [x0, y0, x1, y1]" % i)
            elif min(_num(bx[2]) - _num(bx[0]), _num(bx[3]) - _num(bx[1])) > core.EDIT_BOUND_UM + 1e-9:
                errors.append("edit %d box is deeper than the %g um bound" % (i, core.EDIT_BOUND_UM))
            continue
        for axis in ("dx", "dy"):
            v = _num(edit.get(axis))
            if v is not None and abs(v) > core.EDIT_BOUND_UM + 1e-9:
                errors.append("edit %d %s %s exceeds the %g um bound" % (i, axis, v, core.EDIT_BOUND_UM))

    return errors


def _history_ids(workspace):
    """Candidate ids from ``state/history.jsonl`` (empty on absence)."""
    path = os.path.join(os.path.abspath(workspace), "state", "history.jsonl")
    ids = []
    if not os.path.exists(path):
        return ids
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                import json
                row = json.loads(line)
                if isinstance(row, dict) and isinstance(row.get("id"), str):
                    ids.append(row["id"])
    except (OSError, ValueError):
        return ids
    return ids


def reader_values(plan_path, workspace, readiness):
    """The ``pixel-plan`` Reader: the five typed counts of ``SPEC.md``.

    Reads the plan at ``plan_path``, the history candidate ids from
    ``<workspace>/state/history.jsonl`` and the resolved Goal from
    ``readiness``; runs :func:`check` and emits:
    ``pixel_plan_error_count`` (count of check errors), plus the front-point,
    operator, edit and exploratory-point counts.
    """
    plan = core.read_json(plan_path)
    history_ids = _history_ids(workspace)
    errors = check(plan, readiness, history_ids, round=plan.get("round") if isinstance(plan, dict) else None)

    fronts = plan.get("frontPoints", []) if isinstance(plan, dict) else []
    operators = plan.get("operators", []) if isinstance(plan, dict) else []
    edits = plan.get("edits", []) if isinstance(plan, dict) else []
    exploratory = sum(1 for fp in fronts if isinstance(fp, dict) and fp.get("exploratory"))

    return [
        {"type": "pixel_plan_error_count", "unit": "count", "value": len(errors)},
        {"type": "pixel_plan_front_points", "unit": "count", "value": len(fronts)},
        {"type": "pixel_plan_operator_count", "unit": "count", "value": len(operators)},
        {"type": "pixel_plan_edit_count", "unit": "count", "value": len(edits)},
        {"type": "pixel_plan_exploratory_points", "unit": "count", "value": exploratory},
    ]
