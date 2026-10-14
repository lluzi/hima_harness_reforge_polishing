"""Vertex-to-edge (Euclidean) distance constraints for one compaction pass.

Motion is along x; y is fixed. For every vertex ``v`` and every rigid
(non-horizontal) edge ``e`` of a layer pair related by a rule, within reach, the
distance after the move must stay ``>= min(rule, original)`` (or the full rule
under ``legalise``). The distance is linearised along x with the facing side
kept. This is the port of ``.scratch/pixel-agent/tools/euclid.py`` driven by the
parsed compaction table (``width``/``space`` dicts, ``xspace``/``enc`` lists)
instead of the module constants; the algorithm is unchanged.

Numeric module (numpy, shapely); imported lazily by ``compact.build``.
"""
from __future__ import annotations

import math

import numpy as np
from shapely.geometry import Point, LineString, Polygon
from shapely.ops import unary_union


def _union(polys, layer, P0):
    gs = [Polygon(p + [k * P0, 0]).buffer(0)
          for (n, i, p) in polys if n == layer for k in (-1, 0, 1)]
    return unary_union(gs) if gs else Polygon()


def generate(polys, var, P0, iP, width, space, xspace, enc, ge, tag,
             legalise=False, reach_extra=0.0):
    """Append vertex-to-edge distance rows via ``ge``; return the row count."""
    layers = sorted(set(n for n, _, _ in polys))
    U = {L: _union(polys, L, P0) for L in layers}

    # rule table: (La, Lb) -> list of (kind, d1, d2)
    rules = {}
    for L in set(width) | set(space):
        rules.setdefault((L, L), []).append(("same", width.get(L), space.get(L)))
    for a, b, d in xspace:
        rules.setdefault((a, b), []).append(("xspace", d, d))
        rules.setdefault((b, a), []).append(("xspace", d, d))
    for o, i, d in enc:
        rules.setdefault((i, o), []).append(("enc", d, d))

    verts = []   # (x, y, layer, var, pi)
    edges = []   # (x0, y0, x1, y1, layer, var, pi)  rigid non-horizontal edges
    for pi, (n, i, p) in enumerate(polys):
        N = len(p)
        for v in range(N):
            verts.append((p[v][0], p[v][1], n, var(pi, v), pi))
            a, b = p[v], p[(v + 1) % N]
            if abs(a[1] - b[1]) > 1e-9:
                edges.append((a[0], a[1], b[0], b[1], n, var(pi, v), pi))

    count = 0
    seen = set()
    interior = {L: U[L].buffer(-1e-4) for L in U}
    comps = {L: (list(U[L].geoms) if hasattr(U[L], "geoms") else [U[L]]) for L in U}

    def comp_of(L, x, y):
        pt = Point(x, y)
        for ci, c in enumerate(comps[L]):
            if c.buffer(1e-4).contains(pt):
                return ci
        return -1

    for (vx, vy, La, jv, piv) in verts:
        if interior[La].contains(Point(vx, vy)):
            continue  # vertex buried inside its own layer's union
        for (Lb_key, rl) in [(k, r) for k, r in rules.items() if k[0] == La]:
            Lb = Lb_key[1]
            for kind, d1, d2 in rl:
                vals = [v for v in (d1, d2) if v is not None]
                if not vals:
                    continue
                reach = max(vals) + 1.5 + reach_extra
                for k in (-1, 0, 1):
                    for (x0, y0, x1, y1, Le, je, pie) in edges:
                        if Le != Lb:
                            continue
                        X0, X1 = x0 + k * P0, x1 + k * P0
                        if (min(abs(vy - y0), abs(vy - y1)) > reach
                                and not (min(y0, y1) <= vy <= max(y0, y1))):
                            continue
                        if min(X0, X1) - reach > vx or max(X0, X1) + reach < vx:
                            continue
                        if pie == piv and k == 0 and kind != "same":
                            continue
                        seg = LineString([(X0, y0), (X1, y1)])
                        dist = seg.distance(Point(vx, vy))
                        if dist < 1e-6 or dist > reach:
                            continue
                        foot = seg.interpolate(seg.project(Point(vx, vy)))
                        mid = Point((vx + foot.x) / 2, (vy + foot.y) / 2)
                        inA = U[La].contains(mid)
                        inB = U[Lb].contains(mid)
                        if kind == "same":
                            dmin = d1 if inA else d2
                            if dmin is None:
                                continue
                            if not inA and comp_of(La, vx, vy) == comp_of(Lb, foot.x, foot.y):
                                continue  # notch in one shape
                            if U[Lb].buffer(-1e-4).contains(seg.interpolate(0.5, normalized=True)):
                                continue
                        elif kind == "xspace":
                            if inA or inB:
                                continue
                            dmin = d1
                        else:  # enc: vertex of inner La inside outer Lb
                            if not U[Lb].buffer(1e-6).contains(Point(vx, vy)) or not inB:
                                continue
                            if U[Lb].buffer(-1e-4).contains(seg.interpolate(0.5, normalized=True)):
                                continue
                            dmin = d1
                        prj = seg.project(Point(vx, vy))
                        interior_foot = 1e-6 < prj < seg.length - 1e-6
                        if (kind == "enc" or (kind == "same" and inA)) and not interior_foot:
                            continue  # width/enclosure: facing edges only
                        need = dmin if legalise else min(dmin, dist)
                        dx = vx - foot.x
                        dy = vy - foot.y
                        if abs(dy) >= need - 1e-9:
                            continue
                        req = math.sqrt(max(need * need - dy * dy, 0.0))
                        ex, ey = X1 - X0, y1 - y0
                        L_ = seg.length
                        pr = seg.project(Point(vx, vy))
                        if abs(ex) > 1e-9 and 1e-6 < pr < L_ - 1e-6:
                            nrm = math.hypot(ex, ey)
                            nx_, ny_ = ey / nrm, -ex / nrm
                            s = (vx - X0) * nx_ + (vy - y0) * ny_
                            sign = 1 if s > 0 else -1
                            key = (jv, je, k, round(sign * nx_, 4), round(need - sign * s, 4))
                            if key in seen:
                                continue
                            seen.add(key)
                            tag[0] = ("eu:%s:%s-%s v=(%.2f,%.2f) e=(%.2f,%.2f)-(%.2f,%.2f) need=%.2f k=%d"
                                      % (kind, La, Lb, vx, vy, X0, y0, X1, y1, need, k))
                            ge([(jv, sign * nx_), (je, -sign * nx_), (iP, -sign * nx_ * k)],
                               need - sign * s - sign * nx_ * k * P0)
                            count += 1
                            continue
                        sign = 1 if dx > 0 else -1
                        key = (jv, je, k, sign, round(req - sign * dx, 4))
                        if key in seen:
                            continue
                        seen.add(key)
                        tag[0] = ("eu:%s:%s-%s v=(%.2f,%.2f) e=(%.2f,%.2f)-(%.2f,%.2f) need=%.2f k=%d"
                                  % (kind, La, Lb, vx, vy, X0, y0, X1, y1, need, k))
                        ge([(jv, sign), (je, -sign), (iP, -sign * k)],
                           req - sign * dx - sign * k * P0)
                        count += 1
    return count


def pair_constraints(polys, var, P0, iP, pairs, ge, tag):
    """Exact lazily-added pairs from markers.

    Each pair is ``(La, ia, va, Lb, ib, eb, need, k)``: the distance from vertex
    ``va`` of polygon ``ia`` on layer ``La`` to edge ``eb`` of polygon ``ib`` on
    layer ``Lb`` (shifted by ``k`` pitches) must stay ``>= min(need, original)``.
    """
    idx = {(n, i): pi for pi, (n, i, p) in enumerate(polys)}
    cnt = 0
    for (La, ia, va, Lb, ib, eb, need0, k) in pairs:
        pa = idx.get((La, ia))
        pb = idx.get((Lb, ib))
        if pa is None or pb is None:
            continue
        P = polys[pa][2]
        Q = polys[pb][2]
        if va >= len(P) or eb >= len(Q):
            continue
        vx, vy = P[va]
        jv = var(pa, va)
        a, b = Q[eb], Q[(eb + 1) % len(Q)]
        X0, X1 = a[0] + k * P0, b[0] + k * P0
        seg = LineString([(X0, a[1]), (X1, b[1])])
        dist = seg.distance(Point(vx, vy))
        need = min(need0, dist)
        if need <= 1e-6:
            continue
        pr = seg.project(Point(vx, vy))
        tag[0] = "pair:%s%d.%d-%s%d.%d need=%.2f" % (La, ia, va, Lb, ib, eb, need)
        rigid = abs(a[1] - b[1]) > 1e-9
        if rigid and 1e-6 < pr < seg.length - 1e-6 and abs(X1 - X0) > 1e-9:
            je = var(pb, eb)
            ex, ey = X1 - X0, b[1] - a[1]
            nrm = math.hypot(ex, ey)
            nx_, ny_ = ey / nrm, -ex / nrm
            s = (vx - X0) * nx_ + (vy - a[1]) * ny_
            sign = 1 if s > 0 else -1
            ge([(jv, sign * nx_), (je, -sign * nx_), (iP, -sign * nx_ * k)],
               need - sign * s - sign * nx_ * k * P0)
            cnt += 1
            continue
        foot = seg.interpolate(pr)
        if rigid or pr <= 1e-6:
            je = var(pb, eb)
        elif pr >= seg.length - 1e-6:
            je = var(pb, (eb + 1) % len(Q))
        else:
            continue
        dx = vx - foot.x
        dy = vy - foot.y
        if abs(dy) >= need - 1e-9:
            continue
        req = math.sqrt(need * need - dy * dy)
        sign = 1 if dx > 0 else -1
        ge([(jv, sign), (je, -sign), (iP, -sign * k)],
           req - sign * dx - sign * k * P0)
        cnt += 1
    return cnt
