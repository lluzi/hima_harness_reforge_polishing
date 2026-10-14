"""The per-front-point solve driver for ``solve-and-judge`` (numeric module).

:func:`drive` takes a checked plan and, for each of its front points, applies the
plan's operators and bounded edits to the chosen base, merges the top conductor,
compacts (per the point's objective), runs the *exact-pair loop* -- compact,
authority DRC on 1x1 and 3x3, fold and classify the markers, propose exact pair
constraints and re-solve from the same pre-compaction layout, at most six times
-- and writes one candidate GDS set (``pixel.gds`` / ``pixel2x2.gds`` /
``pixel3x3.gds``), its ``geometry.json`` and its ``meta.json`` under
``cands/rNN-<name>/``. The candidates are judged in full later by the program
task; this module only produces them and records what it predicted.

Objectives (``optimisation-method.md``):

* ``legalise`` -- fixed pitch, every violated pair held to the full rule only
  inside the base layout's folded Argus marker zones; y then x.
* ``min-pitch`` -- the point's outline first, falling back to the minimum pitch
  when that is infeasible, recording the achieved pitch and the binding chain;
  y then x.
* ``min-ratio`` -- the Dinkelbach form at a fixed outline, with Ct/Cs linear rows
  from the surrogate's gradients, a trust region and the load/coupling rows;
  x then y. It needs :func:`pixelopt.attribution.gradients` and the pair-proposal
  helper from the sensitivities task; until those land it reports ``unsupported``
  so the point is recorded as failed rather than silently mis-solved.

Points run in parallel, up to ``siteCapabilities.parallelJobs`` at once.
"""
from __future__ import annotations

import os
import shutil
import tempfile
from concurrent.futures import ThreadPoolExecutor

from shapely.geometry import Polygon

from . import (attribution, compact, core, edits, geometry, judge, layout,
               markers, nets, operators, repair, reports)

_MAX_PAIR_ITERS = 6
_MAX_REPAIR_ROUNDS = 3
_MAX_REPAIR_EDITS = 12
_DEFAULT_TRUST_UM = 0.5
_ZONE_BUFFER_UM = 0.3


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #

def _pk(a, b):
    # Net-pair keys are canonical everywhere: the two names sorted, as RCEResult pairs are.
    return "|".join(sorted((a, b)))


def _storage_pairs(case):
    """The surrogate pairs: storage node vs every ratio aggressor, plus Cs."""
    nm = case.raw["nets"]
    sn = nm["storageNode"]
    st = nm["storageNet"]
    aggs = set()
    for lst in (case.raw.get("ratioDefinitions", {}) or {}).values():
        aggs |= set(lst)
    pairs = [_pk(sn, a) for a in sorted(aggs)]
    pairs.append(_pk(sn, st))
    return pairs


def _cand_top(case):
    return case.raw["candidateTopCell"]


def _parse_table(case):
    from . import rules
    ref = case.raw["decks"]["authority"]
    with open(case.file(ref), "r", encoding="utf-8", errors="replace") as fh:
        parsed = rules.parse_deck(fh.read())
    return rules.compaction_table(parsed, case), parsed


def _propose_pairs_fn():
    """The exact-pair proposer from the sensitivities task, or ``None``."""
    for modname in ("probes", "pairs"):
        try:
            mod = __import__("pixelopt." + modname, fromlist=[modname])
        except Exception:  # pragma: no cover - module not present yet
            continue
        fn = getattr(mod, "propose_pairs", None)
        if callable(fn):
            return fn
    return None


def _base_dir(workspace, base, decision):
    if base == "best":
        bid = None
        dec = decision or {}
        best = dec.get("best")
        if isinstance(best, dict):
            bid = best.get("id")
        bid = bid or dec.get("bestId")
        base = bid or "original"
    elif base == "original":
        base = "original"
    return os.path.join(workspace, "cands", base), base


def _folded_authority_markers(cand_dir, case, lay):
    marks = []
    out = os.path.join(cand_dir, "out")
    for tile in ("1x1", "3x3"):
        db = os.path.join(out, "drc_authority_%s" % tile, "argus_drc.db")
        if os.path.exists(db):
            with open(db, "r", encoding="utf-8", errors="replace") as fh:
                marks.extend(markers.parse_db(fh.read()))
    if not marks:
        return []
    return markers.fold(marks, lay.outline(case))


def _zones(folded):
    zones = []
    for _rule, pts in folded:
        if len(pts) >= 3:
            zones.append(Polygon(pts).buffer(_ZONE_BUFFER_UM))
    return zones


def _sum_count(path):
    if not os.path.exists(path):
        return 0
    try:
        return int(reports.argus_summary(path)["total"])
    except core.PixelError:
        return 0


# --------------------------------------------------------------------------- #
# DRC in a scratch directory (the exact-pair loop's inner judgement)
# --------------------------------------------------------------------------- #

def _drc_markers(lay, case, sitecaps, workspace):
    """Write ``lay`` to a scratch dir, run authority DRC on 1x1 and 3x3,
    return ``(count_1x1, count_3x3, folded_markers)``."""
    r = _drc_full(lay, case, sitecaps, workspace)
    return r["c1"], r["c3"], r["folded"]


def _drc_full(lay, case, sitecaps, workspace):
    """Authority DRC of ``lay`` (1x1 and 3x3): ``{"c1", "c3", "total", "byRule", "folded"}``,
    ``byRule`` summed over both tiles."""
    scratch = tempfile.mkdtemp(prefix=".solve-", dir=workspace)
    try:
        layout.write_set(lay, scratch, case)
        judge.judge_one(scratch, workspace, case, sitecaps, "drc")
        out = os.path.join(scratch, "out")
        c1 = _sum_count(os.path.join(out, "drc_authority_1x1", "argus_drc.sum"))
        c3 = _sum_count(os.path.join(out, "drc_authority_3x3", "argus_drc.sum"))
        by_rule = {}
        for tile in ("1x1", "3x3"):
            sp = os.path.join(out, "drc_authority_%s" % tile, "argus_drc.sum")
            if os.path.exists(sp):
                try:
                    for rid, n in reports.argus_summary(sp).get("byRule", {}).items():
                        by_rule[rid] = by_rule.get(rid, 0) + n
                except core.PixelError:
                    pass
        marks = []
        for tile in ("1x1", "3x3"):
            db = os.path.join(out, "drc_authority_%s" % tile, "argus_drc.db")
            if os.path.exists(db):
                with open(db, "r", encoding="utf-8", errors="replace") as fh:
                    marks.extend(markers.parse_db(fh.read()))
        folded = markers.fold(marks, lay.outline(case)) if marks else []
        return {"c1": c1, "c3": c3, "total": c1 + c3, "byRule": by_rule, "folded": folded}
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


def _finish(lay, case):
    """Clean, re-sync the outline copies, snap to grid: the layout as it is written."""
    lay = layout.clean(lay)
    lay = layout.sync_outline_copies(lay, case)
    return layout.snap(lay, case.grid_um)


def _repair(lay, ctx, drc):
    """Repair residual authority markers with verified bounded edits (:mod:`repair`).

    Each round proposes chamfer, jog and edge moves for the folded markers, confirms each with the
    authority deck, applies the confirmed ones together (or the single best when together they do
    worse) and re-runs the deck. Stops when clean, when nothing confirmed is left, after
    ``_MAX_REPAIR_ROUNDS`` or at ``_MAX_REPAIR_EDITS`` edits. Returns ``(layout, applied, drc)``;
    ``applied`` lists each round's edits as applied to that round's layout.
    """
    case = ctx["case"]
    applied = []
    n_edits = 0
    if ctx.get("parsed") is None:
        return lay, applied, drc

    def run_on(base):
        def run(eds):
            ed, _log = edits.apply_edits(base, eds, case)
            r = _drc_full(_finish(ed, case), case, ctx["sitecaps"], ctx["workspace"])
            return {"total": r["total"], "byRule": r["byRule"]}
        return run

    for _ in range(_MAX_REPAIR_ROUNDS):
        if drc["total"] == 0 or not drc["folded"]:
            break
        props = repair.propose(lay, drc["folded"], ctx["parsed"].get("checks", []),
                               case.grid_um,
                               apply_edits=lambda e, b=lay: edits.apply_edits(b, e, case),
                               table=ctx["table"])
        if not props:
            break
        base = {"total": drc["total"], "byRule": drc["byRule"]}
        _, best = repair.verify(props, base, run_on(lay), per_marker=4)
        best = [p for p in best if n_edits + len(p["edits"]) <= _MAX_REPAIR_EDITS]
        if not best:
            break
        joint = []
        for p in sorted(best, key=lambda p: p["authorityAfter"]["total"]):
            if n_edits + len(joint) + len(p["edits"]) <= _MAX_REPAIR_EDITS:
                joint.extend(p["edits"])
        ed, _log = edits.apply_edits(lay, joint, case)
        cand = _finish(ed, case)
        r = _drc_full(cand, case, ctx["sitecaps"], ctx["workspace"])
        grew = [k for k, n in r["byRule"].items() if n > drc["byRule"].get(k, 0)]
        if r["total"] >= drc["total"] or grew:
            one = min(best, key=lambda p: p["authorityAfter"]["total"])
            joint = one["edits"]
            ed, _log = edits.apply_edits(lay, joint, case)
            cand = _finish(ed, case)
            r = _drc_full(cand, case, ctx["sitecaps"], ctx["workspace"])
        if r["total"] >= drc["total"]:
            break
        applied.append({"edits": joint, "authorityBefore": drc["total"],
                        "authorityAfter": r["total"]})
        n_edits += len(joint)
        lay, drc = cand, r
    return lay, applied, drc


# --------------------------------------------------------------------------- #
# Compaction per objective
# --------------------------------------------------------------------------- #

def _compact_pitch_like(pre, case, table, objective, target, pairs, zones):
    """Compact y then x for ``legalise`` / ``min-pitch``.

    Returns ``(Layout|None, info)`` where ``info`` carries ``status`` and the
    combined ``binding`` chain. ``min-pitch`` falls back to the minimum pitch
    when the requested outline is infeasible on an axis.
    """
    lay = pre
    binding = []
    status = "optimal"
    if objective == "min-pitch":
        # y to its minimum first: a shorter cell frees x (chamfers and crossings move), then x to
        # its target (else its minimum), then y back out to its target, returning height the
        # ratio and transmittance can use.
        order = [("y", None), ("x", target[0] if target else None)]
        if target and target[1]:
            order.append(("y", target[1]))
    else:
        order = [("y", target[1] if target else None),
                 ("x", target[0] if target else None)]
    for i, (axis, tgt) in enumerate(order):
        if objective == "min-pitch" and i == 2:
            # re-expansion is optional: keep the minimum when it fails or y is already at target
            w_h = lay.pitch(case)
            if w_h[1] >= tgt - 1e-6:
                break
            out, info = compact.compact(lay, axis, case, table, target_pitch=tgt, pairs=tuple(pairs))
            if info["status"] == "optimal" and out is not None:
                lay = out
            break
        if objective == "legalise":
            out, info = compact.compact(lay, axis, case, table, objective="legalise",
                                        legalise_zones=zones, pairs=tuple(pairs))
        else:  # min-pitch
            out, info = compact.compact(lay, axis, case, table, target_pitch=tgt,
                                        pairs=tuple(pairs))
            if info["status"] != "optimal":
                out, info = compact.compact(lay, axis, case, table,
                                            objective="pitch", pairs=tuple(pairs))
        binding.extend(info.get("binding") or [])
        if info["status"] == "optimal" and out is not None:
            lay = out
        else:
            status = "partial"
            break
    if lay is pre and status != "optimal":
        return None, {"status": "infeasible", "binding": binding}
    return lay, {"status": status, "binding": binding}


def _compact_min_ratio(pre, case, table, target, pairs_acc, trust_radius,
                       model, readiness):
    """Dinkelbach min-ratio at a fixed outline (needs the surrogate gradients).

    Returns ``(Layout|None, info)``. When the gradients helper or a usable
    surrogate is absent, returns ``status: 'unsupported'`` so the point is
    recorded as failed; any internal error degrades the same way.
    """
    grad_fn = getattr(attribution, "gradients", None)
    if grad_fn is None or not (model or {}).get("pairs"):
        return None, {"status": "unsupported",
                      "binding": ["min-ratio needs attribution.gradients and a model"]}
    try:
        goal = (readiness or {}).get("goal", {}) or {}
        nm = case.raw["nets"]
        sn, st = nm["storageNode"], nm["storageNet"]
        ratio_nets = goal.get("ratioNets") or []
        ct_pairs = [_pk(sn, a) for a in ratio_nets]
        cs_pair = _pk(sn, st)
        allpairs = sorted(set(ct_pairs + [cs_pair]))
        binding = []
        status = "optimal"
        if target and any(t is not None and abs(t - b) > 1e-6
                          for t, b in zip(target, pre.pitch(case))):
            # reach the outline first: the ratio step moves each shape only within the trust
            # radius, which a pitch change of more than that never fits in
            sized, sinfo = _compact_pitch_like(pre, case, table, "min-pitch", target,
                                               pairs_acc, None)
            if sized is None:
                return None, sinfo
            binding.extend(sinfo.get("binding") or [])
            pre = sized
            if sinfo.get("status") != "optimal":
                status = "partial"
        tgt = list(pre.pitch(case))

        lay = pre
        for ai, axis in enumerate(("x", "y")):
            L = lay if axis == "x" else compact.transpose(lay)
            comp_model = compact.build(L, case, table, pairs=tuple(pairs_acc))
            gres = grad_fn(model, lay, case, comp_model, allpairs, axis)
            grads = gres.get("gradients", {}) or {}
            base_pred = gres.get("base", {}) or {}
            ct0 = sum(base_pred.get(p, 0.0) for p in ct_pairs)
            cs0 = base_pred.get(cs_pair, 0.0)
            jvars = set()
            for p in allpairs:
                jvars |= set(grads.get(p, {}).keys())
            jvars = sorted(int(j) for j in jvars)

            def gsum(pairset, j):
                return sum(grads.get(p, {}).get(j, 0.0) for p in pairset)

            r_lo, r_hi = 0.0, (ct0 / cs0 if cs0 > 1e-9 else 100.0)
            best = None
            for _ in range(6):
                r = 0.5 * (r_lo + r_hi)
                coef = {}
                for j in jvars:
                    coef[j] = gsum(ct_pairs, j) - r * gsum([cs_pair], j)
                rows = [{"name": "ratio", "coef": coef,
                         "const": ct0 - r * cs0, "op": "le", "rhs": 0.0}]
                m2 = compact.build(L, case, table, pairs=tuple(pairs_acc),
                                   metric_rows=rows,
                                   trust={"radius": trust_radius, "vars": jvars})
                tp = tgt[ai]
                res = compact.solve(m2, objective="movement", target_pitch=tp)
                if res["status"] == "optimal":
                    best = (m2, res)
                    r_hi = r
                else:
                    r_lo = r
            if best is None:
                status = "partial"  # this axis keeps the sized layout
                continue
            m2, res = best
            applied = compact.apply(L, m2, res["x"], case)
            lay = applied if axis == "x" else compact.transpose(applied)
            binding.extend(res.get("binding") or [])
        return lay, {"status": status, "binding": binding}
    except Exception as exc:  # pragma: no cover - defensive until gradients land
        return None, {"status": "unsupported", "binding": ["min-ratio error: %s" % exc]}


# --------------------------------------------------------------------------- #
# Prediction
# --------------------------------------------------------------------------- #

def _predict(model, lay, case):
    pairs = list((model or {}).get("pairs", {}).keys()) or _storage_pairs(case)
    if not (model or {}).get("pairs"):
        return None
    feats = attribution.features(nets.extract(lay, case), case, pairs)
    pred = attribution.predict(model, feats)
    if not pred:
        return None
    nm = case.raw["nets"]
    sn, st = nm["storageNode"], nm["storageNet"]
    cs = pred.get(_pk(sn, st))
    ratio = {}
    for defn in ("narrow", "broad"):
        aggs = (case.raw.get("ratioDefinitions", {}) or {}).get(defn, [])
        ct = sum(pred.get(_pk(sn, a), 0.0) for a in aggs)
        ratio[defn] = round(ct / cs * 100.0, 6) if cs and cs > 1e-9 else None
    return {"pairsFf": {k: round(float(v), 6) for k, v in pred.items()},
            "ratioPct": ratio}


# --------------------------------------------------------------------------- #
# One front point
# --------------------------------------------------------------------------- #

def _solve_point(point, ctx):
    name = point.get("name")
    objective = point.get("objective")
    case = ctx["case"]
    table = ctx["table"]
    cid = "r%02d-%s" % (ctx["round"], name)

    default_outline = ctx["default_outline"]
    target = point.get("outlineUm") or default_outline

    pre = ctx["pre"]
    pairs = []
    propose = _propose_pairs_fn()
    final = None
    info = {"status": "error", "binding": []}
    residual = []
    pair_iters = 0

    if objective == "legalise" and ctx.get("base_clean"):
        # nothing to legalise: re-solving a clean base only moves shapes for no gain
        return {"ok": False, "name": name, "status": "already-clean", "binding": []}

    for it in range(_MAX_PAIR_ITERS):
        pair_iters = it + 1
        if objective == "legalise":
            lay, info = _compact_pitch_like(pre, case, table, "legalise", None,
                                            pairs, ctx["zones"])
        elif objective == "min-pitch":
            lay, info = _compact_pitch_like(pre, case, table, "min-pitch", target,
                                            pairs, None)
        elif objective == "min-ratio":
            lay, info = _compact_min_ratio(pre, case, table, target, pairs,
                                           ctx["trust"], ctx["model"], ctx["readiness"])
        else:
            return {"ok": False, "name": name, "status": "unknown-objective",
                    "binding": []}
        if lay is None:
            return {"ok": False, "name": name, "status": info["status"],
                    "binding": info.get("binding") or []}
        final = lay

        # judge the layout on the grid, as it will be written: snapping a 45-degree edge can
        # lose a few nm of a distance the LP held exactly (snap keeps polygon indices)
        lay = layout.snap(lay, case.grid_um)
        c1, c3, folded = _drc_markers(lay, case, ctx["sitecaps"], ctx["workspace"])
        if c1 == 0 and c3 == 0:
            residual = []
            break
        classified = markers.classify(folded, table, ctx["base_marks"],
                                      info.get("binding") or ())
        residual = classified
        exact = [m for m in classified if m["class"] == "exact-pair"]
        if not exact or propose is None or ctx["parsed"] is None:
            break
        newp = []
        try:
            lp = lay.pitch(case)
            bp = pre.pitch(case)
            for ax in ("x", "y"):
                newp.extend(propose(lay, folded, ctx["parsed"], pre, ax,
                                    pitch=lp, base_pitch=bp) or [])
        except Exception:
            newp = []
        # one grid step more than the rule, so the pair survives the snap; the same pair once
        held = {p[:6] + p[7:] for p in pairs}
        newp = [tuple(p[:6]) + (float(p[6]) + case.grid_um,) + tuple(p[7:]) for p in newp
                if tuple(p[:6]) + tuple(p[7:]) not in held]
        if not newp:
            break
        pairs.extend(newp)

    # Finish the layout: clean, re-sync the outline copies, snap to grid; then repair what the
    # compactor left with verified bounded edits.
    final = _finish(final, case)
    repairs = []
    if residual:
        drc = _drc_full(final, case, ctx["sitecaps"], ctx["workspace"])
        final, repairs, drc = _repair(final, ctx, drc)
        residual = markers.classify(drc["folded"], table, ctx["base_marks"],
                                    info.get("binding") or ()) if drc["total"] else []

    cand_dir = os.path.join(ctx["workspace"], "cands", cid)
    if os.path.isdir(cand_dir):
        shutil.rmtree(cand_dir)
    layout.write_set(final, cand_dir, case)

    geom = geometry.measure(final, case, ctx["original_lay"], ctx["parsed"])
    geom["declaredChanges"] = dict(ctx["declared"])
    core.write_json(os.path.join(cand_dir, "geometry.json"), geom)

    # Predict from the layout exactly as written (the judged artifact), not the in-memory copy.
    written = layout.load_gds(os.path.join(cand_dir, "pixel.gds"), case, top=case.raw["candidateTopCell"])
    predicted = _predict(ctx["model"], written, case)
    w, h = final.pitch(case)
    meta = {
        "id": cid,
        "kind": "candidate",
        "round": ctx["round"],
        "base": ctx["base_id"],
        "frontPoint": point,
        "exploratory": bool(point.get("exploratory")),
        "operators": ctx["plan"].get("operators", []),
        "edits": ctx["plan"].get("edits", []),
        "declaredChanges": dict(ctx["declared"]),
        "predicted": predicted,
        "solve": {
            "status": info["status"],
            "pitchUm": [round(float(w), 6), round(float(h), 6)],
            "binding": [str(t) for t in (info.get("binding") or [])][:30],
            "pairIterations": pair_iters,
            "repairs": repairs,
            "residualMarkers": residual,
        },
    }
    core.write_json(os.path.join(cand_dir, "meta.json"), meta)
    return {"ok": True, "id": cid, "name": name}


# --------------------------------------------------------------------------- #
# The driver
# --------------------------------------------------------------------------- #

def drive(workspace, round_num, case, sitecaps, readiness, rules_state, model, plan,
          decision):
    """Produce one candidate per plan front point; return the summary dict.

    ``{"candidates": [ids written], "failed": [{"name","status","binding"}]}``.
    """
    workspace = os.path.abspath(workspace)
    if rules_state and isinstance(rules_state.get("table"), dict):
        table = rules_state["table"]
        parsed = rules_state.get("authority")
    else:
        table, parsed = _parse_table(case)

    goal = (readiness or {}).get("goal", {}) or {}
    gvalues = goal.get("values", {}) or {}
    topo = goal.get("topologyMoves", "off")
    default_outline = [gvalues.get("outline_w_um"), gvalues.get("outline_h_um")]
    if None in default_outline:
        default_outline = None
    trust = (decision or {}).get("trustRadiusUm", _DEFAULT_TRUST_UM)

    base_id_req = plan.get("base", "original")
    base_dir, base_id = _base_dir(workspace, base_id_req, decision)
    top = case.raw["original"]["topCell"]
    base_lay = layout.load_gds(os.path.join(base_dir, "pixel.gds"), case,
                               top=_cand_top(case))
    original_lay = layout.load_gds(
        os.path.join(workspace, "cands", "original", "pixel.gds"), case,
        top=_cand_top(case))

    # Operators, then bounded edits, then merge the top conductor.
    top_conductor = case.raw["connectivity"]["topConductor"]
    nets_result = nets.extract(base_lay, case)
    pre = base_lay
    declared = {}
    for op in plan.get("operators", []) or []:
        pre, desc = operators.apply_operator(pre, op, case, nets_result,
                                              table=table, topology_moves=topo)
        declared.update(desc.get("declaredChanges", {}) or {})
        nets_result = nets.extract(pre, case)
    if plan.get("edits"):
        pre, _log = edits.apply_edits(pre, plan["edits"], case)
    pre = layout.merge_layers(pre, [top_conductor])

    base_marks = _folded_authority_markers(base_dir, case, base_lay)
    zones = _zones(base_marks)
    sums = [os.path.join(base_dir, "out", "drc_authority_%s" % t, "argus_drc.sum")
            for t in ("1x1", "3x3")]
    base_clean = (not plan.get("operators") and not plan.get("edits")
                  and all(os.path.exists(p) for p in sums)
                  and sum(_sum_count(p) for p in sums) == 0)

    ctx = {
        "workspace": workspace, "round": round_num, "case": case,
        "sitecaps": sitecaps, "readiness": readiness, "table": table,
        "parsed": parsed, "model": model or {"pairs": {}}, "plan": plan,
        "pre": pre, "declared": declared, "base_lay": base_lay,
        "base_id": base_id, "base_marks": base_marks, "zones": zones,
        "original_lay": original_lay, "default_outline": default_outline,
        "base_clean": base_clean,
        "trust": trust,
    }

    points = plan.get("frontPoints", []) or []
    jobs = max(1, int(sitecaps.get("parallelJobs", 1) or 1))
    results = [None] * len(points)
    if points:
        with ThreadPoolExecutor(max_workers=min(jobs, len(points))) as pool:
            futs = {pool.submit(_solve_point, p, ctx): i for i, p in enumerate(points)}
            for fut in futs:
                results[futs[fut]] = fut.result()

    candidates = []
    failed = []
    for r in results:
        if r and r.get("ok"):
            candidates.append(r["id"])
        elif r:
            failed.append({"name": r.get("name"), "status": r.get("status"),
                           "binding": r.get("binding") or []})
    return {"candidates": candidates, "failed": failed}
