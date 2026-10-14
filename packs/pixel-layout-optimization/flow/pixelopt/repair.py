"""Bounded-edit proposals for residual markers the compactor cannot reach (numeric module).

Compaction moves edges along x or y; it cannot change the angle at which an edge of one layer
crosses an edge of another. A 45-degree edge that crosses another layer's edge leaves an acute
wedge outside both shapes, which a two-layer ``space`` rule flags however far the shapes slide.
Three bounded moves take the crossing away, each keeping every edge's angle:

* ``chamfer-resize``: a corner cut (neighbour edges perpendicular) is made larger or smaller, its
  two vertices moving the same distance along their neighbour edges;
* ``jog-shift``: a jog (neighbour edges parallel) slides along its neighbours;
* ``edge-shift``: the other layer's crossed axis-parallel edge moves perpendicular to itself.

:func:`propose` screens each move in geometry only (the diagonal no longer crosses the other
layer's outline and clears it by the rule distance, or lies inside it); the caller confirms the
survivors with the authority deck (``try-edit``, ``markers``). Nothing here is a verdict.
"""
from __future__ import annotations

import math

from shapely.geometry import LineString, Polygon, box
from shapely.ops import unary_union

from .core import PixelError

__all__ = ["propose"]

_STEPS_UM = (0.25, 0.5, 0.75, 1.0, 1.25, 1.5)
_SQUARE_STEP_UM = 0.05
_EPS = 1e-6


def _check_for(checks, rule):
    for c in checks or []:
        if c.get("rule") == rule:
            return c
    return None


def _bbox(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)


def _unit(v):
    n = math.hypot(v[0], v[1])
    return (v[0] / n, v[1] / n) if n > 0 else (0.0, 0.0)


def _axis(a, b):
    """'h', 'v' or None (diagonal) for the edge a->b."""
    if abs(a[1] - b[1]) < _EPS:
        return "h"
    if abs(a[0] - b[0]) < _EPS:
        return "v"
    return None


def _seg(arr, v):
    n = len(arr)
    return LineString([tuple(arr[v]), tuple(arr[(v + 1) % n])])


def _union(lay, layer, near):
    gs = [Polygon(p).buffer(0) for p in lay.polys.get(layer, [])]
    gs = [g for g in gs if g.intersects(near)]
    return unary_union(gs) if gs else Polygon()


def _diag_moves(arr, v, steps):
    """Vertex moves for the diagonal edge v->v+1: ``(kind, size, [(vid, dx, dy), ...])``."""
    n = len(arr)
    a, b = arr[v], arr[(v + 1) % n]
    u, w = arr[(v - 1) % n], arr[(v + 2) % n]
    ka, kb = _axis(u, a), _axis(b, w)
    if ka is None or kb is None:
        return []
    out = []
    if ka != kb:  # corner cut: each vertex slides along its own neighbour edge
        da = _unit((u[0] - a[0], u[1] - a[1]))
        db = _unit((w[0] - b[0], w[1] - b[1]))
        la = math.hypot(u[0] - a[0], u[1] - a[1])
        lb = math.hypot(w[0] - b[0], w[1] - b[1])
        leg = math.hypot(b[0] - a[0], b[1] - a[1]) / math.sqrt(2.0)
        for s in steps:
            if s < la and s < lb:
                out.append(("chamfer-resize", s, [(v, da[0] * s, da[1] * s),
                                                  ((v + 1) % n, db[0] * s, db[1] * s)]))
            if s < leg:
                out.append(("chamfer-resize", s, [(v, -da[0] * s, -da[1] * s),
                                                  ((v + 1) % n, -db[0] * s, -db[1] * s)]))
    else:  # jog: both vertices slide the same way along the parallel neighbours
        d = (1.0, 0.0) if ka == "h" else (0.0, 1.0)
        for s in steps:
            for sg in (1.0, -1.0):
                mv = (d[0] * s * sg, d[1] * s * sg)
                out.append(("jog-shift", s, [(v, mv[0], mv[1]), ((v + 1) % n, mv[0], mv[1])]))
        # or square it: both vertices slide onto one line across the parallel neighbours, so the
        # 45-degree jog becomes a right-angle step
        i = 0 if ka == "h" else 1
        lo, hi = min(a[i], b[i]), max(a[i], b[i])
        bound = max(steps)
        k = math.floor((lo - bound) / _SQUARE_STEP_UM)
        while k * _SQUARE_STEP_UM <= hi + bound:
            t = k * _SQUARE_STEP_UM
            k += 1
            ma, mb = t - a[i], t - b[i]
            if abs(ma) > bound + _EPS or abs(mb) > bound + _EPS:
                continue
            va = (ma, 0.0) if i == 0 else (0.0, ma)
            vb = (mb, 0.0) if i == 0 else (0.0, mb)
            out.append(("jog-square", max(abs(ma), abs(mb)),
                        [(v, va[0], va[1]), ((v + 1) % n, vb[0], vb[1])]))
    return out


def _edge_moves(arr, e, steps):
    """Perpendicular shifts of the axis-parallel edge e->e+1 whose neighbours are perpendicular to
    it (so they only lengthen or shorten)."""
    n = len(arr)
    a, b = arr[e], arr[(e + 1) % n]
    k = _axis(a, b)
    if k is None:
        return []
    perp = "v" if k == "h" else "h"
    if _axis(arr[(e - 1) % n], a) != perp or _axis(b, arr[(e + 2) % n]) != perp:
        return []
    d = (0.0, 1.0) if k == "h" else (1.0, 0.0)
    out = []
    for s in steps:
        for sg in (1.0, -1.0):
            out.append(("edge-shift", s, (d[0] * s * sg, d[1] * s * sg)))
    return out


def _clears(seg, other, d):
    """The moved edge leaves no acute crossing with the other layer and keeps the rule distance
    from it. A diagonal must not touch the other layer's outline; an axis-parallel edge (a squared
    jog) may cross it at a right angle, and its parts outside the other layer, away from those
    crossings, keep the distance."""
    if other.is_empty:
        return True
    (x0, y0), (x1, y1) = seg.coords[0], seg.coords[-1]
    if _axis((x0, y0), (x1, y1)) is None:
        if seg.intersects(other.boundary):
            return False
        return other.buffer(_EPS).contains(seg) or seg.distance(other) >= d - _EPS
    outside = seg.difference(other.buffer(_EPS))
    parts = list(outside.geoms) if hasattr(outside, "geoms") else [outside]
    for part in parts:
        if part.is_empty or part.length <= 2 * d:
            continue
        core = LineString([part.interpolate(d), part.interpolate(part.length - d)])
        if core.distance(other) < d - _EPS:
            return False
    return True


def _same_layer_ok(lay, layer, pi, new_arr, table, near):
    """The moved polygon keeps its layer's width and spacing (no worse than before where the
    start already broke them)."""
    if not table:
        return True
    p0 = Polygon(lay.polys[layer][pi]).buffer(0)
    p1 = Polygon(new_arr).buffer(0)
    sp = (table.get("space") or {}).get(layer)
    if sp:
        reach = near.buffer(sp)
        for j, q in enumerate(lay.polys.get(layer, [])):
            if j == pi:
                continue
            o = Polygon(q).buffer(0)
            if not o.intersects(reach):
                continue
            d0, d1 = p0.distance(o), p1.distance(o)
            if d0 > _EPS and d1 < sp - _EPS and d1 < d0 - _EPS:
                return False
    w = (table.get("width") or {}).get(layer)
    if w:
        r = w / 2.0 - 1e-3
        narrow0 = p0.difference(p0.buffer(-r).buffer(r)).area
        narrow1 = p1.difference(p1.buffer(-r).buffer(r)).area
        if narrow1 > narrow0 + 0.01:
            return False
    return True


def _snap(v, grid):
    return round(round(v / grid) * grid, 6) if grid else round(v, 6)


def _apply(lay, layer, pi, moves, grid):
    """A copy of polygon ``pi`` of ``layer`` with the vertex moves applied."""
    arr = lay.polys[layer][pi].copy()
    for vid, dx, dy in moves:
        arr[vid][0] = _snap(float(arr[vid][0]) + dx, grid)
        arr[vid][1] = _snap(float(arr[vid][1]) + dy, grid)
    return arr


def propose(lay, marks, checks, grid, apply_edits=None, steps=_STEPS_UM, limit=6,
            table=None):
    """Candidate bounded edits for each folded marker of a two-layer ``space`` rule.

    ``marks`` is ``[(rule, pts)]`` (folded markers), ``checks`` the parsed deck's checks,
    ``apply_edits(edits)`` (optional) raises ``PixelError`` for an edit the Run contract refuses
    (a channel or capacitor vertex); ``table`` (the compaction table) screens out moves that break
    the moved layer's own width or spacing. Returns ``[{"rule", "bbox", "kind", "moveUm", "edits"}]``,
    smallest move first, at most ``limit`` per marker; ``edits`` is in the :mod:`edits` format.
    """
    out = []
    for rule, pts in marks:
        chk = _check_for(checks, rule)
        if not chk or chk.get("kind") not in ("space", "space2") or len(chk.get("layers") or []) != 2:
            continue
        la, lb = chk["layers"]
        d = float(chk.get("value") or 0.0)
        bb = _bbox(pts)
        window = box(*bb).buffer(d + 0.5)
        near = window.buffer(2.0)
        found = []
        for layer, other_layer in ((la, lb), (lb, la)):
            other = _union(lay, other_layer, near)
            for pi, arr in enumerate(lay.polys.get(layer, [])):
                n = len(arr)
                for v in range(n):
                    if _axis(arr[v], arr[(v + 1) % n]) is not None:
                        continue
                    seg = _seg(arr, v)
                    if not seg.intersects(window) or not seg.intersects(other.boundary):
                        continue
                    # move the diagonal itself, or the other layer's edge it crosses, or both
                    diag = []
                    for kind, sz, moves in _diag_moves(arr, v, steps):
                        new = _apply(lay, layer, pi, moves, grid)
                        if not _same_layer_ok(lay, layer, pi, new, table, near):
                            continue
                        diag.append((kind, sz, [
                            {"layer": layer, "polygon": pi, "vertices": [vid],
                             "dx": _snap(dx, grid), "dy": _snap(dy, grid)}
                            for vid, dx, dy in moves], _seg(new, v)))
                    edge = []
                    for opi, oarr in enumerate(lay.polys.get(other_layer, [])):
                        m = len(oarr)
                        for e in range(m):
                            if not _seg(oarr, e).intersects(seg):
                                continue
                            rest = [Polygon(q).buffer(0)
                                    for j, q in enumerate(lay.polys.get(other_layer, []))
                                    if j != opi and Polygon(q).buffer(0).intersects(near)]
                            for kind, sz, (dx, dy) in _edge_moves(oarr, e, steps):
                                moved = _apply(lay, other_layer, opi,
                                               [(e, dx, dy), ((e + 1) % m, dx, dy)], grid)
                                if not _same_layer_ok(lay, other_layer, opi, moved, table, near):
                                    continue
                                edge.append((kind, sz, [
                                    {"layer": other_layer, "polygon": opi, "edge": e,
                                     "dx": _snap(dx, grid), "dy": _snap(dy, grid)}],
                                    unary_union(rest + [Polygon(moved).buffer(0)])))
                    singles = [(sz, kind, eds) for kind, sz, eds, nseg in diag
                               if _clears(nseg, other, d)]
                    singles += [(sz, kind, eds) for kind, sz, eds, o2 in edge
                                if _clears(seg, o2, d)]
                    found.extend(singles)
                    if not singles:  # neither move alone is enough within the bound
                        for kd, sd, ed, nseg in diag:
                            for ke, se, ee, o2 in edge:
                                if _clears(nseg, o2, d):
                                    found.append((sd + se, kd + "+" + ke, ed + ee))
        kept = []
        for s, kind, eds in sorted(found, key=lambda t: t[0]):
            if apply_edits is not None:
                try:
                    apply_edits(eds)
                except PixelError:
                    continue
            kept.append({"rule": rule, "bbox": [round(t, 4) for t in bb], "kind": kind,
                         "moveUm": s, "edits": eds})
            if len(kept) >= limit:
                break
        out.extend(kept)
    return out


def verify(proposals, base, run, per_marker=4):
    """Confirm proposals with the authority deck.

    ``base`` is the candidate's own ``{"total": n, "byRule": {rule: n}}`` (single cell plus 3x3);
    ``run(edits)`` returns the same for the candidate with ``edits`` applied. Each proposal gains
    ``authorityAfter`` and ``verified`` (the total drops and no rule gains a marker). Returns the
    proposals and ``best``: per marker, the verified proposal with the fewest markers left.
    """
    tried = {}
    best = {}
    for p in proposals:
        key = (p["rule"], tuple(p["bbox"]))
        if tried.get(key, 0) >= per_marker:
            continue
        tried[key] = tried.get(key, 0) + 1
        after = run(p["edits"])
        p["authorityAfter"] = after
        grew = [r for r, n in (after.get("byRule") or {}).items()
                if n > (base.get("byRule") or {}).get(r, 0)]
        p["verified"] = (after.get("total") is not None and base.get("total") is not None
                         and after["total"] < base["total"] and not grew)
        if p["verified"] and (key not in best
                              or after["total"] < best[key]["authorityAfter"]["total"]):
            best[key] = p
    return proposals, list(best.values())
