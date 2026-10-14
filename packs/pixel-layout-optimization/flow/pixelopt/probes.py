"""Sensitivity probes and lazy exact-pair constraints (numeric module).

Two things, both needing the layout:

* :func:`make_probes` chooses the top movable compactor edge classes by their
  facing length to the judged Ct sites (the storage node against each pair's
  aggressor, and the storage-net side), and for each solves a minimum-movement
  LP with that class pinned at ``+-step`` so every other edge moves only as far
  as the compaction table requires. Each probe is a legal candidate layout whose
  one lever is displaced; infeasible ones are dropped with their binding reason.

* :func:`propose_pairs` turns Argus markers into exact pair constraints in the
  :func:`euclid.pair_constraints` format, keeping only pairs that met the rule in
  the base layout (a violation the compaction move introduced). Port of
  ``.scratch/pixel-agent/tools/lazy.py:find_pairs`` generalised through the
  parsed deck's rule table.
"""
from __future__ import annotations

import re

import numpy as np
from shapely.geometry import Point, LineString, Polygon
from shapely.ops import unary_union

from .attribution import _netgeo, _norm_pairs, class_geom

__all__ = ["make_probes", "propose_pairs"]

_EMPTY = Polygon()
_AREA_EPS = 1e-6


# --------------------------------------------------------------------------- #
# Probes
# --------------------------------------------------------------------------- #

def _whole(G, net):
    d = G.get(net, {})
    return unary_union(list(d.values())) if d else _EMPTY


def _class_net(cls, nets_result, cg):
    """The net whose shapes most overlap a class's geometry (else its layer)."""
    best = None
    best_ov = 0.0
    for name, items in nets_result.get("nets", {}).items():
        for _, g in items:
            ov = g.intersection(cg).area
            if ov > best_ov:
                best_ov = ov
                best = name
    return best or cls["layer"]


def make_probes(lay, case, table, model, nets_result, pairs, k=6, step=0.25,
                reach=1.0):
    """Build up to ``2k`` legal +-``step`` probe layouts on the top Ct levers.

    Returns a list of ``{"name", "layout", "meta"}``. A dropped (infeasible)
    probe keeps its ``name`` and ``meta`` with ``layout=None`` and
    ``meta["dropped"]`` naming why.
    """
    from . import compact as _compact

    norm = _norm_pairs(pairs)
    storage = case.raw["nets"]["storageNode"]
    storage_net = case.raw["nets"].get("storageNet")
    G = _netgeo(nets_result)

    aggressors = set()
    for a, b in norm:
        for n in (a, b):
            if n != storage:
                aggressors.add(n)
    if storage_net:
        aggressors.add(storage_net)
    agg_geoms = [_whole(G, n) for n in aggressors]
    agg_geoms = [g for g in agg_geoms if not g.is_empty]
    victim = _whole(G, storage)
    facing_parts = list(agg_geoms)
    if not victim.is_empty:
        facing_parts.append(victim)
    facing = unary_union(facing_parts).buffer(reach) if facing_parts else _EMPTY

    # Rank movable classes across both axes by facing length to the Ct sites.
    candidates = []  # (score, axis, var, layer, net)
    for axis in ("x", "y"):
        L = lay if axis == "x" else _compact.transpose(lay)
        m = _compact.build(L, case, table)
        for cls in _compact.edge_classes(m):
            cg = class_geom(m, cls, axis)
            if cg.is_empty or facing.is_empty:
                continue
            score = cg.boundary.intersection(facing).length
            if score <= 1e-9:
                continue
            candidates.append((float(score), axis, cls["var"], cls["layer"],
                               _class_net(cls, nets_result, cg)))
    candidates.sort(key=lambda c: -c[0])
    chosen = candidates[:k]

    probes = []
    for score, axis, j, layer, net in chosen:
        L = lay if axis == "x" else _compact.transpose(lay)
        for s in (1.0, -1.0):
            target = s * step
            rows = [
                {"name": "probe-hi", "coef": {j: 1.0}, "const": 0.0, "rhs": target},
                {"name": "probe-lo", "coef": {j: -1.0}, "const": 0.0, "rhs": -target},
            ]
            m = _compact.build(L, case, table, metric_rows=rows)
            r = _compact.solve(m, objective="movement")
            side = "up" if s > 0 else "down"
            name = "probe-%s-%d-%s" % (axis, j, "p" if s > 0 else "m")
            meta = {"lever": "%s/%s %s-%s edge" % (layer, net, axis, side),
                    "step": target, "axis": axis, "var": j}
            if r["status"] != "optimal":
                meta["dropped"] = r["status"]
                probes.append({"name": name, "layout": None, "meta": meta,
                               "binding": r.get("binding", [])})
                continue
            out = _compact.apply(L, m, r["x"], case)
            if axis == "y":
                out = _compact.transpose(out)
            probes.append({"name": name, "layout": out, "meta": meta})
    return probes


# --------------------------------------------------------------------------- #
# Lazy exact pairs from markers
# --------------------------------------------------------------------------- #

def _first_base_layer(token, derived):
    """Resolve a (possibly derived) layer token to its first base layer name."""
    seen = set()
    cur = token
    while cur in derived and cur not in seen:
        seen.add(cur)
        toks = re.findall(r"[A-Za-z_]\w*", derived[cur])
        if not toks:
            break
        # ``geom_and( A B )`` -> first operand after the function name
        cur = toks[1] if len(toks) >= 2 else toks[0]
    return cur


def _rule_map(parsed):
    """``rule id -> (layerA, layerB, distance)`` from a parsed deck's checks."""
    derived = parsed.get("derived", {})
    out = {}
    for chk in parsed.get("checks", []):
        if not chk.get("modelled") or chk.get("value") is None:
            continue
        ls = [_first_base_layer(t, derived) for t in chk.get("layers", [])]
        if not ls:
            continue
        kind = chk["kind"]
        v = float(chk["value"])
        if kind in ("width", "space"):
            out[chk["rule"]] = (ls[0], ls[0], v)
        elif kind == "space2" and len(ls) >= 2:
            out[chk["rule"]] = (ls[0], ls[1], v)
        elif kind == "enc" and len(ls) >= 2:
            out[chk["rule"]] = (ls[0], ls[1], v)  # (inner, outer); order is tried both ways
    return out


def _pitch(lay):
    pts = [p for ps in lay.polys.values() for p in ps if len(p)]
    allv = np.vstack(pts)
    lo = allv.min(0)
    hi = allv.max(0)
    return float(hi[0] - lo[0]), float(hi[1] - lo[1])


def propose_pairs(lay, marks, table, base, axis):
    """Propose exact pair constraints for one axis from folded Argus markers.

    ``table`` is a parsed deck (``rules.parse_deck`` output) carrying the checks.
    ``base`` is the pre-move layout (same topology as ``lay``). Each result is
    ``(La, ia, va, Lb, ib, eb, need, k)`` in :func:`euclid.pair_constraints`
    format: only the pair's periodic copy *along* ``axis`` is kept (``k``), and a
    pair is returned only when the vertex met the rule in ``base`` (so the move,
    not a pre-existing defect, caused the violation).
    """
    rmap = _rule_map(table)
    P, H = _pitch(lay)
    bP, bH = _pitch(base)
    out = []
    for rule, pts in marks:
        if rule not in rmap:
            continue
        La, Lb, d = rmap[rule]
        if len(pts) >= 3:
            zone = Polygon(pts).buffer(0.15)
        else:
            cx = sum(p[0] for p in pts) / len(pts)
            cy = sum(p[1] for p in pts) / len(pts)
            zone = Point(cx, cy).buffer(0.5)
        if zone.is_empty:
            continue
        centroid = zone.centroid
        for (A, B) in ((La, Lb), (Lb, La)):
            la_polys = lay.polys.get(A, [])
            lb_polys = lay.polys.get(B, [])
            ba_polys = base.polys.get(A, [])
            bb_polys = base.polys.get(B, [])
            for ia, pa in enumerate(la_polys):
                for va in range(len(pa)):
                    v = pa[va]
                    for ky in (-1, 0, 1):
                        for kx in (-1, 0, 1):
                            if axis == "x" and ky != 0:
                                continue
                            if axis == "y" and kx != 0:
                                continue
                            vv = Point(v[0] + kx * P, v[1] + ky * H)
                            if not zone.buffer(0.05).contains(vv):
                                continue
                            for ib, pb in enumerate(lb_polys):
                                m = len(pb)
                                for eb in range(m):
                                    a2, b2 = pb[eb], pb[(eb + 1) % m]
                                    seg = LineString([a2, b2])
                                    dd = seg.distance(vv)
                                    if not (1e-6 < dd < d - 1e-6):
                                        continue
                                    if seg.distance(centroid) >= 3.0:
                                        continue
                                    if A == B and ia == ib and (eb == va or (eb + 1) % m == va):
                                        continue  # own adjacent edge
                                    if ia >= len(ba_polys) or ib >= len(bb_polys):
                                        continue
                                    oa, ob = ba_polys[ia], bb_polys[ib]
                                    if va >= len(oa) or eb >= len(ob):
                                        continue
                                    ov = Point(oa[va][0] + kx * bP, oa[va][1] + ky * bH)
                                    od = LineString([ob[eb], ob[(eb + 1) % len(ob)]]).distance(ov)
                                    if od < d - 1e-3:
                                        continue  # already violated in base: not an exact pair
                                    k = kx if axis == "x" else ky
                                    tup = (A, ia, va, B, ib, eb, float(d), int(k))
                                    if tup not in out:
                                        out.append(tup)
    return out
