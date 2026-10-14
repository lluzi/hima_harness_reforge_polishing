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
               markers, nets, operators, reports)

_MAX_PAIR_ITERS = 6
_DEFAULT_TRUST_UM = 0.5
_ZONE_BUFFER_UM = 0.3


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #

def _pk(a, b):
    return "%s|%s" % (a, b)


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
    scratch = tempfile.mkdtemp(prefix=".solve-", dir=workspace)
    try:
        layout.write_set(lay, scratch, case)
        judge.judge_one(scratch, workspace, case, sitecaps, "drc")
        out = os.path.join(scratch, "out")
        c1 = _sum_count(os.path.join(out, "drc_authority_1x1", "argus_drc.sum"))
        c3 = _sum_count(os.path.join(out, "drc_authority_3x3", "argus_drc.sum"))
        marks = []
        for tile in ("1x1", "3x3"):
            db = os.path.join(out, "drc_authority_%s" % tile, "argus_drc.db")
            if os.path.exists(db):
                with open(db, "r", encoding="utf-8", errors="replace") as fh:
                    marks.extend(markers.parse_db(fh.read()))
        folded = markers.fold(marks, lay.outline(case)) if marks else []
        return c1, c3, folded
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


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
    order = [("y", target[1] if target else None),
             ("x", target[0] if target else None)]
    for axis, tgt in order:
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
        tgt = [target[0] if target else None, target[1] if target else None]

        lay = pre
        binding = []
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
                return (None if ai == 0 else lay), {"status": "infeasible",
                                                    "binding": binding}
            m2, res = best
            applied = compact.apply(L, m2, res["x"], case)
            lay = applied if axis == "x" else compact.transpose(applied)
            binding.extend(res.get("binding") or [])
        return lay, {"status": "optimal", "binding": binding}
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
        newp = [tuple(p) for p in newp if tuple(p) not in pairs]
        if not newp:
            break
        pairs.extend(newp)

    # Finish the layout: clean, re-sync the outline copies, snap to grid.
    final = layout.clean(final)
    final = layout.sync_outline_copies(final, case)
    final = layout.snap(final, case.grid_um)

    cand_dir = os.path.join(ctx["workspace"], "cands", cid)
    if os.path.isdir(cand_dir):
        shutil.rmtree(cand_dir)
    layout.write_set(final, cand_dir, case)

    geom = geometry.measure(final, case, ctx["original_lay"], ctx["parsed"])
    geom["declaredChanges"] = dict(ctx["declared"])
    core.write_json(os.path.join(cand_dir, "geometry.json"), geom)

    predicted = _predict(ctx["model"], final, case)
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

    ctx = {
        "workspace": workspace, "round": round_num, "case": case,
        "sitecaps": sitecaps, "readiness": readiness, "table": table,
        "parsed": parsed, "model": model or {"pairs": {}}, "plan": plan,
        "pre": pre, "declared": declared, "base_lay": base_lay,
        "base_id": base_id, "base_marks": base_marks, "zones": zones,
        "original_lay": original_lay, "default_outline": default_outline,
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
