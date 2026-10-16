"""Resolve the nine Goal numbers and the nine Strategy knobs (stdlib only).

A Goal value of ``0`` means "take the manifest's target"; for the outline it
falls back to the original cell when the manifest states none, the ratio target
*must* resolve (else ``PixelError('unresolved-goal')``), and the transmittance
edges may resolve to ``None`` (no edge). Every resolved value records its
source: ``goal``, ``manifest``, ``original`` or ``none``.
"""
from __future__ import annotations

from .core import PixelError

_STRATEGY_DEFAULTS = {
    "ratioDefinition": "broad",
    "transmittanceBasis": "tiled",
    "extraCsOverlap": "count",
    "topologyMoves": "off",
    "convergeBandPct": 0.02,
    "maxRounds": 6,
    "convergePatienceRounds": 2,
    "outlineMode": "target",
    "warmStart": "off",
}


def _num(d, key, default=0):
    v = d.get(key, default)
    try:
        return float(v)
    except (TypeError, ValueError):
        return float(default)


def resolve(goal, strategy, case, original):
    """Resolve a Run's Goal against the case manifest and the original cell.

    ``goal`` carries the SPEC Goal names; ``strategy`` the five knobs; ``original``
    holds ``outlineUm: [w, h]``. Returns the resolved values, each value's source,
    and the strategy-derived fields.
    """
    strat = dict(_STRATEGY_DEFAULTS)
    strat.update({k: v for k, v in (strategy or {}).items() if v is not None})

    manifest = case.raw
    targets = manifest.get("targets", {}) or {}
    values = {}
    sources = {}

    # -- outline (0 -> manifest target -> original) ------------------------- #
    # outlineMode "fixed": the cell keeps its size, so an unstated outline is the original's, not
    # the manifest's shrink target, and plan-check holds every front point to it.
    outline_mode = "fixed" if strat.get("outlineMode") == "fixed" else "target"
    manifest_outline = targets.get("outlineUm") if outline_mode == "target" else None
    orig_outline = (original or {}).get("outlineUm")
    for idx, name in ((0, "outline_w_um"), (1, "outline_h_um")):
        g = _num(goal, name, 0)
        if g > 0:
            values[name] = g
            sources[name] = "goal"
        elif isinstance(manifest_outline, (list, tuple)) and len(manifest_outline) > idx:
            values[name] = float(manifest_outline[idx])
            sources[name] = "manifest"
        elif isinstance(orig_outline, (list, tuple)) and len(orig_outline) > idx:
            values[name] = float(orig_outline[idx])
            sources[name] = "original"
        else:
            raise PixelError("unresolved-goal",
                             "%s has no goal, manifest or original value" % name)

    # -- ratio target (0 -> manifest; must resolve) ------------------------- #
    ratio_def = strat["ratioDefinition"]
    g = _num(goal, "ratio_target_pct", 0)
    if g > 0:
        values["ratio_target_pct"] = g
        sources["ratio_target_pct"] = "goal"
    else:
        ratio_targets = targets.get("ratioPct", {}) or {}
        if ratio_def in ratio_targets:
            values["ratio_target_pct"] = float(ratio_targets[ratio_def])
            sources["ratio_target_pct"] = "manifest"
        else:
            raise PixelError(
                "unresolved-goal",
                "ratio_target_pct unresolved: no goal value and manifest "
                "targets.ratioPct has no '%s'" % ratio_def)

    # -- load allowance (plain default, never manifest) --------------------- #
    values["load_allowance_pct"] = _num(goal, "load_allowance_pct", 5)
    sources["load_allowance_pct"] = "goal"

    # -- transmittance window (0 -> manifest; may be None) ------------------ #
    t_window = targets.get("transmittancePct")
    for idx, name in ((0, "t_min_pct"), (1, "t_max_pct")):
        g = _num(goal, name, 0)
        if g > 0:
            values[name] = g
            sources[name] = "goal"
        elif isinstance(t_window, (list, tuple)) and len(t_window) > idx \
                and t_window[idx] is not None:
            values[name] = float(t_window[idx])
            sources[name] = "manifest"
        else:
            values[name] = None
            sources[name] = "none"

    # -- Cst ceiling (0 = fixed within tolerance; a plain Goal value) ------- #
    values["cst_ceiling_ff"] = _num(goal, "cst_ceiling_ff", 0)
    sources["cst_ceiling_ff"] = "goal"

    # -- secondary coupling targets (0 = none; a plain Goal value) ----------- #
    for name in ("anode_coupling_max_ff", "scan_coupling_max_ff"):
        g = _num(goal, name, 0)
        values[name] = g if g > 0 else None
        sources[name] = "goal" if g > 0 else "none"

    ratio_nets = (manifest.get("ratioDefinitions", {}) or {}).get(ratio_def, [])

    return {
        "values": values,
        "sources": sources,
        "ratioDefinition": ratio_def,
        "ratioNets": list(ratio_nets),
        "transmittanceBasis": strat["transmittanceBasis"],
        "extraCsOverlap": strat["extraCsOverlap"],
        "topologyMoves": strat["topologyMoves"],
        "convergeBandPct": float(strat["convergeBandPct"]),
        "maxRounds": max(1, int(round(_num(strat, "maxRounds", 6)))),
        "convergePatienceRounds": max(1, int(round(_num(strat, "convergePatienceRounds", 2)))),
        "outlineMode": outline_mode,
        "warmStart": "prior-runs" if strat.get("warmStart") == "prior-runs" else "off",
    }
