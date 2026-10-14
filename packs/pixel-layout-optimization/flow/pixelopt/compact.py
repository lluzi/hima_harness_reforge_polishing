"""One-dimensional constraint-graph compactor driven by the parsed deck.

A pass moves polygon edges along one axis (x; y via :func:`compact` which
transposes). This is the port of ``.scratch/pixel-agent/tools/compact.py``: the
algorithm is unchanged, but every module constant of the day-1 code is replaced
by data from the case manifest and the parsed authority deck:

* ``W`` / ``S`` -> ``table["width"]`` / ``table["space"]`` (``rules.compaction_table``)
* ``XSPACE`` -> ``table["xspace"]``; ``ENC`` -> ``table["enc"]``
* ``LAYERS`` -> every layer present in the layout except role ``outline-copy``
  (those are re-synced with :func:`layout.sync_outline_copies` in :func:`apply`)
* ``FREE_PAIRS`` -> ``case.raw["freePairs"]``
* the ``TOP`` stack -> the manifest's per-layer ``stack`` field
* rigid channels -> ``devices.polyLayer`` ∧ ``devices.gateLayer``
* rigid capacitor -> ``cst.markerLayer`` ∧ ``cst.plateLayers``
* ``labmap`` -> ``connectivity.labelLayers``

New beyond the day-1 method: constraint tags with non-zero LP duals as the
binding chain; ``metric_rows`` added as linear rows and summed into the
objective; a trust region on named variables; a ``legalise`` objective that
holds every violated rule pair at its full distance; and grid snapping in
:func:`apply`.

Numeric module (numpy, scipy with HiGHS, shapely).
"""
from __future__ import annotations

import numpy as np
from scipy.optimize import linprog
from shapely.geometry import Point, LineString, Polygon
from shapely.ops import unary_union, transform as shp_transform

from . import euclid as _euclid
from . import layout as _layout

ROUND = _layout.ROUND


# --------------------------------------------------------------------------- #
# Transpose helpers (y pass runs on the transposed layout)
# --------------------------------------------------------------------------- #

def transpose(lay):
    return _layout.transpose(lay)


def _transpose_box(box):
    base = (box[1], box[0], box[3], box[2])
    return base + tuple(box[4:])


def _transpose_geom(g):
    return shp_transform(lambda x, y, z=None: (y, x), g)


# --------------------------------------------------------------------------- #
# Union-find tying vertices into displacement classes
# --------------------------------------------------------------------------- #

class _UF:
    def __init__(self):
        self.p = {}
        self.off = {}

    def add(self, a):
        if a not in self.p:
            self.p[a] = a
            self.off[a] = 0.0

    def find(self, a):
        if self.p[a] == a:
            return a, 0.0
        r, o = self.find(self.p[a])
        self.p[a] = r
        self.off[a] += o
        return r, self.off[a]

    def union(self, a, b, d):
        ra, oa = self.find(a)
        rb, ob = self.find(b)
        if ra != rb:
            self.p[rb] = ra
            self.off[rb] = oa - ob


# --------------------------------------------------------------------------- #
# Model building
# --------------------------------------------------------------------------- #

def _layers_in_motion(lay, case):
    """Every layer present in the layout except those with role ``outline-copy``."""
    copies = set(case.layers_with("outline-copy"))
    present = set(lay.polys)
    out = [n for n in case.raw.get("layers", {}) if n in present and n not in copies]
    for n in present:  # any present layer the manifest did not order (defensive)
        if n not in out and n not in copies:
            out.append(n)
    return out


def _free_pairs(case):
    out = []
    for pr in case.raw.get("freePairs", []) or []:
        out.append(frozenset(pr))
    return out


_NO_NEW_DEVICE_UM = 0.1


def build(lay, case, table, *, rigid_extra=(), protect=(), pairs=(),
          metric_rows=(), trust=None, use_euclid=True, legalise=False,
          legalise_zones=None):
    """Assemble the LP model for one x-pass over ``lay``.

    Returns a dict with the inequality system (``A`` x ``>=``-style rows, already
    negated for ``A_ub``), the per-row ``tags``, the displacement-class mapping
    and the pitch index ``iP``.

    ``legalise`` raises every modelled width/space/enclosure pair that violates
    its rule in the input to the full rule distance. ``legalise_zones`` (shapely
    geometries in the unit cell, e.g. the base layout's folded, buffered Argus
    markers) restricts that: a pair is raised to the full rule only when its
    place lies inside a zone, otherwise it keeps ``min(rule, original)`` like an
    ordinary pass. ``legalise=True`` with ``legalise_zones=None`` holds every
    violated pair (backward-compatible).
    """
    width = dict(table.get("width", {}))
    space = dict(table.get("space", {}))
    xspace = [list(r) for r in table.get("xspace", [])]
    enc = [list(r) for r in table.get("enc", [])]

    LAYERS = _layers_in_motion(lay, case)
    FREE_PAIRS = _free_pairs(case)
    devices = case.raw.get("devices", {})
    poly_layer = devices.get("polyLayer")
    gate_layer = devices.get("gateLayer")
    device_pair = {poly_layer, gate_layer}
    grid = case.grid_um
    if poly_layer and gate_layer and not any({r[0], r[1]} == device_pair for r in xspace):
        # No deck rule spaces poly from gate (a designer never draws a stray TFT), so the
        # compactor holds them apart itself, at min(this, original), with Euclidean rows too:
        # a slanted poly edge's corner can cross a gate edge between two scanlines.
        xspace.append([poly_layer, gate_layer, _NO_NEW_DEVICE_UM])
    cst = case.raw.get("cst", {})
    marker_layer = cst.get("markerLayer")
    plate_layers = list(cst.get("plateLayers", []))
    top_layers = set(n for n in LAYERS if case.layer(n).get("stack") == "top")
    rigid_member_layers = set([x for x in (poly_layer, gate_layer, marker_layer) if x]) | set(plate_layers)

    polys = [(n, i, p) for n in LAYERS for i, p in enumerate(lay.polys.get(n, []))]
    uf = _UF()
    for pi, (n, i, p) in enumerate(polys):
        N = len(p)
        for v in range(N):
            uf.add((pi, v))
        for v in range(N):
            a, b = p[v], p[(v + 1) % N]
            # vertical or diagonal edges move rigidly in x (not horizontal)
            if abs(a[0] - b[0]) < 1e-9 or abs(a[1] - b[1]) > 1e-9:
                if not (abs(a[1] - b[1]) < 1e-9):
                    uf.union((pi, v), (pi, (v + 1) % N), 0)

    # Rigid groups: transistor channels, the storage-capacitor region, extras.
    groups = []
    if poly_layer and gate_layer:
        pg = lay.geom(poly_layer).intersection(lay.geom(gate_layer))
        ch_parts = list(pg.geoms) if hasattr(pg, "geoms") else ([pg] if not pg.is_empty else [])
    else:
        ch_parts = []
    ch_parts = [c for c in ch_parts if c.area > 1e-6]
    for c in ch_parts:
        groups.append(c.buffer(1e-4))

    cap_groups = []  # indices into groups of the capacitor regions (marker ∧ plates)
    marker_geom = lay.geom(marker_layer) if marker_layer else Polygon()
    if marker_layer and plate_layers and not marker_geom.is_empty:
        capreg = marker_geom
        for pl in plate_layers:
            capreg = capreg.intersection(lay.geom(pl))
        for c in (capreg.geoms if hasattr(capreg, "geoms") else [capreg]):
            if c.area > 1e-3:
                groups.append(c.buffer(1e-4))
                cap_groups.append(len(groups) - 1)
    for g in rigid_extra:
        groups.append(g)

    for gi, g in enumerate(groups):
        bd = g.boundary
        members = []
        for pi, (n, i, p) in enumerate(polys):
            if n not in rigid_member_layers:
                continue
            N = len(p)
            for v in range(N):
                a_, b_ = p[v], p[(v + 1) % N]
                if abs(a_[1] - b_[1]) < 1e-9:
                    continue  # edges along the motion axis may stretch
                seg = LineString([a_, b_])
                if (seg.intersection(g.buffer(2e-4)).length > 1e-4
                        and seg.intersection(bd.buffer(2e-4)).length > 1e-4):
                    members += [(pi, v), (pi, (v + 1) % N)]
        if gi in cap_groups:
            # The device value is the area of marker ∧ plates: the marker itself must move with the
            # region's boundary edges, or the plates can slide inside a marker that stays put (a
            # region bounded only by the inner plate's edges would not tie the marker otherwise).
            for pi, (n, i, p) in enumerate(polys):
                if n == marker_layer and Polygon(p).buffer(0).intersects(g):
                    members.append((pi, 0))
        for m in members[1:]:
            uf.union(members[0], m, 0)

    # Whole polygons kept rigid: marker polygons; and plate polygons that lie
    # mostly inside the marker -- the overlap exceeds 50 % of the POLYGON's own
    # area. A wide outer plate that merely crosses the marker is NOT frozen whole
    # (that would freeze the pitch); it is held only by the marker-region group's
    # edges at the capacitor boundary.
    for pi, (n, i, p) in enumerate(polys):
        rigid_whole = False
        if marker_layer and n == marker_layer:
            rigid_whole = True
        elif plate_layers and n in plate_layers and not marker_geom.is_empty:
            poly_geom = Polygon(p).buffer(0)
            if poly_geom.area > 1e-9 and poly_geom.intersection(marker_geom).area > 0.5 * poly_geom.area:
                rigid_whole = True
        if rigid_whole:
            for v in range(1, len(p)):
                uf.union((pi, 0), (pi, v), 0)

    # Number the displacement classes; the last variable is the pitch P.
    roots = {}
    for pi, (n, i, p) in enumerate(polys):
        for v in range(len(p)):
            r, _ = uf.find((pi, v))
            roots.setdefault(r, len(roots))
    nv = len(roots) + 1
    iP = len(roots)

    def var(pi, v):
        return roots[uf.find((pi, v))[0]]

    (ox0, oy0), (ox1, oy1) = lay.outline(case)
    P0 = ox1 - ox0

    A = []
    b = []
    tags = []
    tag = ["?"]

    def ge(terms, rhs):  # sum(c*x) >= rhs  ->  -sum <= -rhs
        row = np.zeros(nv)
        for j, c in terms:
            row[j] += c
        A.append(-row)
        b.append(-rhs)
        tags.append(tag[0])

    def le(terms, rhs):  # sum(c*x) <= rhs
        row = np.zeros(nv)
        for j, c in terms:
            row[j] += c
        A.append(row)
        b.append(rhs)
        tags.append(tag[0])

    def eq_fix(j, val):
        row = np.zeros(nv)
        row[j] = 1
        A.append(row)
        b.append(val)
        A.append(-row)
        b.append(-val)
        tags.extend(["fix", "fix"])

    outline_names = case.layers_with("outline")
    outline_name = outline_names[0] if outline_names else None

    # Edges along the motion axis keep their direction and a minimum length.
    tag[0] = "edge-orient"
    for pi, (n, i, p) in enumerate(polys):
        N = len(p)
        for v in range(N):
            a_, b_ = p[v], p[(v + 1) % N]
            if abs(a_[1] - b_[1]) < 1e-9 and abs(a_[0] - b_[0]) > 1e-9:
                ja, jb = var(pi, v), var(pi, (v + 1) % N)
                if ja == jb:
                    continue
                L0 = b_[0] - a_[0]
                if L0 > 0:
                    ge([(jb, 1), (ja, -1)], min(L0, 0.1) - L0)
                else:
                    ge([(ja, 1), (jb, -1)], min(-L0, 0.1) + L0)

    # Outline vertices: left edge fixed, right edge = left + P.
    for pi, (n, i, p) in enumerate(polys):
        if n != outline_name:
            continue
        for v, q in enumerate(p):
            if abs(q[0] - ox0) < 1e-6:
                eq_fix(var(pi, v), 0.0)
            else:
                row = np.zeros(nv)
                row[var(pi, v)] = 1
                row[iP] = -1  # dx_right = P - P0
                A.append(row)
                b.append(-P0)
                A.append(-row)
                b.append(P0)
                tags.extend(["outlineR", "outlineR"])

    # Zone gating for legalise: only pairs whose place meets a zone are raised to
    # the full rule distance; everywhere else legalise keeps min(rule, original).
    _zunion = None
    if legalise and legalise_zones:
        zpolys = [g for g in legalise_zones if g is not None and not g.is_empty]
        _zunion = unary_union(zpolys) if zpolys else None

    def in_zone(coords):
        if _zunion is None:
            return False
        for s in (-P0, 0.0, P0):
            seg = LineString([(x + s, y) for (x, y) in coords])
            if _zunion.intersects(seg):
                return True
        return False

    def rule_dist(d, orig, coords):
        if not legalise:
            return min(d, orig)
        if _zunion is None:
            return d  # backward-compatible: hold every violated pair
        return d if in_zone(coords) else min(d, orig)

    # Scanline slabs.
    inside_cache = {}

    def _inside(pi, x, y):
        geom = inside_cache.get(pi)
        if geom is None:
            geom = Polygon(polys[pi][2]).buffer(0)
            inside_cache[pi] = geom
        return geom.contains(Point(x, y))

    ys = sorted({round(float(q[1]), 6) for (_, _, p) in polys for q in p})
    cons = 0
    seen = set()
    for y0, y1 in zip(ys[:-1], ys[1:]):
        if y1 - y0 < 1e-6:
            continue
        ym = 0.5 * (y0 + y1)
        items = []  # (x_orig, layer, var, pi)
        for pi, (n, i, p) in enumerate(polys):
            N = len(p)
            for v in range(N):
                a, bq = p[v], p[(v + 1) % N]
                if (a[1] - ym) * (bq[1] - ym) < 0:
                    t = (ym - a[1]) / (bq[1] - a[1])
                    x = a[0] + t * (bq[0] - a[0])
                    items.append((x, n, var(pi, v), pi))
        allit = [(x + k * P0, n, j, pi, k) for (x, n, j, pi) in items for k in (-1, 0, 1)]
        allit.sort(key=lambda it: (it[0], it[1], it[2], it[3], it[4]))

        def diff_terms(a, bb):
            xa, _, ja, _, ka = a
            xb, _, jb, _, kb = bb
            terms = [(jb, 1), (ja, -1), (iP, kb - ka)]
            return terms, xb - xa, (ka - kb) * P0

        def add(a, bb, d):
            nonlocal cons
            if a[4] != 0 and bb[4] != 0:
                return
            terms, orig, pc = diff_terms(a, bb)
            # The same two edge classes meet on many scanlines at different separations; the
            # key holds the row's whole right-hand side, or the first (often loosest) row would
            # stand for all of them (a gate line 0.43 um from the poly here, 0.855 um on an
            # earlier scanline, slid 0.855 um and made a TFT).
            key = (a[2], a[4], bb[2], bb[4], round(d - orig, 4))
            if key in seen:
                return
            seen.add(key)
            ge(terms, d - orig + (bb[4] - a[4]) * P0 * 0 - (bb[4] - a[4]) * (-P0))
            cons += 1

        # Group crossings by original x; consecutive groups keep order.
        groups_ = []
        for it in allit:
            if groups_ and abs(it[0] - groups_[-1][0][0]) < 1e-9:
                groups_[-1].append(it)
            else:
                groups_.append([it])

        tag[0] = "order y=%.2f" % ym
        for g in groups_:
            onl = [it for it in g if it[1] == outline_name]
            for a_ in g:
                for b_ in g:
                    if a_ is b_ or (a_[2] == b_[2] and a_[4] == b_[4]):
                        continue
                    if a_[1] == b_[1]:  # same layer (incl. a line abutting its copy)
                        add(a_, b_, 0.0)
                        if onl and a_[4] != b_[4]:
                            for o_ in onl:
                                add(a_, o_, 0.0)
                                add(o_, a_, 0.0)
                    elif {a_[1], b_[1]} == device_pair:
                        # a poly edge on a gate edge stays on it: sliding either way would make
                        # a transistor that is not in the schematic (or change one that is)
                        add(a_, b_, 0.0)
        # Cross-layer order: the low stack among itself; each top layer only with itself.
        for stack in ["low"] + sorted(top_layers):
            if stack == "low":
                sel = [[it for it in g if it[1] not in top_layers] for g in groups_]
            else:
                sel = [[it for it in g if it[1] == stack] for g in groups_]
            sel = [g for g in sel if g]
            for g1_, g2_ in zip(sel[:-1], sel[1:]):
                for a_ in g1_:
                    for b_ in g2_:
                        if frozenset((a_[1], b_[1])) in FREE_PAIRS:
                            continue
                        if b_[0] - a_[0] > 1e-9:
                            add(a_, b_, 0.0)
            # A free pair in between breaks the chain above (Gate1 <= Gate2, Gate2 free over
            # poly: nothing then held Gate1 below poly, and a gate line slid over the poly into a
            # new TFT). So each crossing is also ordered against the next crossing of every
            # other layer it is not free with.
            for gi, g1_ in enumerate(sel):
                for a_ in g1_:
                    done = {a_[1]}
                    for g2_ in sel[gi + 1:]:
                        for lb in sorted({b_[1] for b_ in g2_} - done):
                            done.add(lb)
                            if frozenset((a_[1], lb)) in FREE_PAIRS:
                                continue
                            for b_ in g2_:
                                if b_[1] == lb and b_[0] - a_[0] > 1e-9:
                                    add(a_, b_, 0.0)

        # Protected boxes: no compression between crossings inside the box.
        for pr in protect:
            (bx0, by0, bx1, by1), pl = (pr[:4], pr[4]) if len(pr) == 5 else (pr, None)
            if not (by0 <= ym <= by1):
                continue
            tag[0] = "protect y=%.2f" % ym
            inb = [[it for it in g if pl is None or it[1] in pl]
                   for g in groups_ if bx0 - 1e-9 <= g[0][0] <= bx1 + 1e-9]
            inb = [g for g in inb if g]
            for g1_, g2_ in zip(inb[:-1], inb[1:]):
                for a_ in g1_:
                    for b_ in g2_:
                        add(a_, b_, b_[0] - a_[0])

        # Material intervals per layer (union over polygons and periodic copies).
        layer_cov = {}
        for L in set(n for _, n, _, _, _ in allit):
            its = [it for it in allit if it[1] == L]
            xs = sorted(set(round(it[0], 6) for it in its))
            bnd = []
            prev_in = False
            for k2, xv in enumerate(xs):
                right = xs[k2 + 1] if k2 + 1 < len(xs) else xv + 1
                mid = 0.5 * (xv + right)
                inside = any(_inside(it[3], mid - it[4] * P0, ym) for it in its)
                if inside != prev_in:
                    cand = [it for it in its if abs(it[0] - xv) < 1e-6]
                    bnd.append((cand, inside))
                prev_in = inside
            layer_cov[L] = bnd

        def pairs_same(L, w, s):
            bnd = layer_cov.get(L, [])
            for (ca, ina), (cb, inb) in zip(bnd[:-1], bnd[1:]):
                d = w if ina else s
                if d is None:
                    continue
                tag[0] = "%s:%s y=%.2f x=%.2f..%.2f" % ("W" if ina else "S", L, ym, ca[0][0], cb[0][0])
                for a in ca:
                    for bb in cb:
                        orig = bb[0] - a[0]
                        add(a, bb, rule_dist(d, orig, [(a[0], ym), (bb[0], ym)]))

        for L in set(width) | set(space):
            if L in LAYERS:
                pairs_same(L, width.get(L), space.get(L))

        for La, Lb, d in xspace:
            ba = layer_cov.get(La, [])
            bb_ = layer_cov.get(Lb, [])
            ev = ([(c[0][0], 'A', c, inn) for c, inn in ba]
                  + [(c[0][0], 'B', c, inn) for c, inn in bb_])
            ev.sort(key=lambda e: e[0])
            for e1, e2 in zip(ev[:-1], ev[1:]):
                if e1[1] == e2[1]:
                    continue
                if (not e1[3]) and e2[3]:
                    tag[0] = "X:%s-%s y=%.2f x=%.2f..%.2f" % (La, Lb, ym, e1[0], e2[0])
                    for a in e1[2]:
                        for bb in e2[2]:
                            orig = bb[0] - a[0]
                            if orig > 1e-6:
                                add(a, bb, rule_dist(d, orig, [(a[0], ym), (bb[0], ym)]))
                elif e1[3] and not e2[3]:
                    # the two shapes overlap here: they keep overlapping (by a grid step, or
                    # what they had); shrunk to nothing, they would abut, a spacing of 0 to the
                    # deck (an SD edge slid onto a Gate1 edge: Gate1.4)
                    tag[0] = "O:%s-%s y=%.2f x=%.2f..%.2f" % (La, Lb, ym, e1[0], e2[0])
                    for a in e1[2]:
                        for bb in e2[2]:
                            orig = bb[0] - a[0]
                            if orig > 1e-6:
                                add(a, bb, min(orig, grid))

        for Lo, Li, d in enc:
            tag[0] = "E:%s>%s y=%.2f" % (Lo, Li, ym)
            bo = layer_cov.get(Lo, [])
            bi = layer_cov.get(Li, [])
            for ci, inn in bi:
                xi = ci[0][0]
                if inn:
                    cand = [(co, i2) for co, i2 in bo if co[0][0] <= xi + 1e-9 and i2]
                    if not cand:
                        continue
                    co = max(cand, key=lambda c: c[0][0][0])[0]
                    if any((not i2) and co[0][0] < c2[0][0] < xi for c2, i2 in bo):
                        continue
                    for a in co:
                        for bb in ci:
                            orig = bb[0] - a[0]
                            if orig >= -1e-9:
                                add(a, bb, rule_dist(d, orig, [(a[0], ym), (bb[0], ym)]))
                else:
                    cand = [(co, i2) for co, i2 in bo if co[0][0] >= xi - 1e-9 and not i2]
                    if not cand:
                        continue
                    co = min(cand, key=lambda c: c[0][0][0])[0]
                    if any(i2 and xi < c2[0][0] < co[0][0] for c2, i2 in bo):
                        continue
                    for a in ci:
                        for bb in co:
                            orig = bb[0] - a[0]
                            if orig >= -1e-9:
                                add(a, bb, rule_dist(d, orig, [(a[0], ym), (bb[0], ym)]))

    if use_euclid:
        cons += _euclid.generate(polys, var, P0, iP, width, space, xspace, enc,
                                 ge, tag, legalise=legalise,
                                 zone_fn=(in_zone if _zunion is not None else None),
                                 margin=case.grid_um)
        if pairs:
            cons += _euclid.pair_constraints(polys, var, P0, iP, pairs, ge, tag)

    # Channels stay inside the cell outline.
    for c in ch_parts:
        bx0, _, bx1, _ = c.bounds
        mem = None
        for pi, (n, i, p) in enumerate(polys):
            if n != poly_layer:
                continue
            N = len(p)
            for v, q in enumerate(p):
                if abs(q[0] - bx0) < 1e-6 or abs(q[0] - bx1) < 1e-6:
                    seg = LineString([p[v], p[(v + 1) % N]])
                    if (abs(p[v][1] - p[(v + 1) % N][1]) > 1e-9
                            and seg.intersection(c.buffer(2e-4)).length > 1e-4):
                        mem = var(pi, v)
                        break
            if mem is not None:
                break
        if mem is None:
            continue
        tag[0] = "channel-in-cell"
        m_ = 0.0 if bx0 - ox0 < 0.5 else 0.5
        ge([(mem, 1)], ox0 + min(m_, bx0 - ox0) - bx0)
        ge([(iP, 1), (mem, -1)], bx1 - ox0 + min(m_, ox1 - bx1))

    # Metric rows: coef . dx + const <= rhs.
    metric_rows = [dict(r) for r in metric_rows]
    for row in metric_rows:
        tag[0] = "metric:%s" % row.get("name", "?")
        terms = [(int(j), float(g)) for j, g in row["coef"].items()]
        le(terms, float(row.get("rhs", 0.0)) - float(row.get("const", 0.0)))

    return dict(tags=tags, A=np.array(A) if A else np.zeros((0, nv)),
                b=np.array(b) if b else np.zeros(0), nv=nv, iP=iP, roots=roots,
                uf=uf, polys=polys, P0=P0, var=var, cons=cons,
                trust=trust, metric_rows=metric_rows, legalise=legalise)


# --------------------------------------------------------------------------- #
# Solving
# --------------------------------------------------------------------------- #

def _binding(tags, res):
    marg = getattr(getattr(res, "ineqlin", None), "marginals", None)
    if marg is None:
        return []
    best = {}
    for i in range(min(len(tags), len(marg))):
        m = float(marg[i])
        if abs(m) > 1e-7:
            t = tags[i]
            if t not in best or abs(m) > abs(best[t]):
                best[t] = m
    return [t for t, _ in sorted(best.items(), key=lambda kv: -abs(kv[1]))[:30]]


def _elastic_binding(A2, b2, bounds, tags, ncols):
    """Name the conflicting rows of an infeasible system with slack variables."""
    nt = len(tags)
    if nt == 0 or A2.shape[0] == 0:
        return []
    S = np.zeros((A2.shape[0], nt))
    for i in range(nt):
        S[i, i] = -1.0
    Ae = np.hstack([A2, S])
    ce = np.zeros(ncols + nt)
    ce[ncols:] = 1.0
    bnds = list(bounds) + [(0, None)] * nt
    res = linprog(ce, A_ub=Ae, b_ub=b2, bounds=bnds, method="highs")
    if not res.success:
        return []
    s = res.x[ncols:]
    agg = {}
    for i in range(nt):
        if s[i] > 1e-6:
            t = tags[i]
            if t not in agg or s[i] > agg[t]:
                agg[t] = s[i]
    return [t for t, _ in sorted(agg.items(), key=lambda kv: -kv[1])[:30]]


def solve(model, *, target_pitch=None, objective="pitch", metric_weights=None):
    """Solve one pass. Returns ``{"status","x","pitch","binding"}``.

    ``objective``: ``"pitch"`` (smallest pitch, or minimum movement at
    ``target_pitch``), ``"movement"`` (minimum movement at a fixed pitch),
    ``"metric"`` (minimum weighted metric rows plus a small movement term) or
    ``"legalise"`` (minimum movement at the input pitch).
    """
    A = model["A"]
    b = model["b"]
    nv = model["nv"]
    iP = model["iP"]
    P0 = model["P0"]
    tags = model["tags"]
    metric_rows = model.get("metric_rows", [])
    trust = model.get("trust")
    n = nv - 1
    nrows = A.shape[0]
    ncols = nv + n

    if objective not in ("pitch", "movement", "metric", "legalise"):
        return {"status": "error", "x": None, "pitch": None, "binding": []}

    c = np.zeros(ncols)
    wmove = 1e-4 if objective == "metric" else 1.0
    c[nv:] = wmove
    fix_pitch = None
    if objective == "pitch":
        if target_pitch is not None:
            fix_pitch = target_pitch
        else:
            c[iP] = 1000.0
    elif objective == "legalise":
        fix_pitch = P0
    else:  # movement, metric
        fix_pitch = target_pitch if target_pitch is not None else P0

    if objective == "metric":
        mw = metric_weights or {}
        for row in metric_rows:
            w = mw.get(row.get("name"), 1.0)
            for j, g in row["coef"].items():
                c[int(j)] += w * float(g)

    # |dx| auxiliary rows: aux_j >= dx_j and aux_j >= -dx_j.
    if nrows:
        A2 = np.hstack([A, np.zeros((nrows, n))])
    else:
        A2 = np.zeros((0, ncols))
    extra = []
    eb = []
    for j in range(n):
        r = np.zeros(ncols)
        r[j] = 1
        r[nv + j] = -1
        extra.append(r)
        eb.append(0.0)
        r = np.zeros(ncols)
        r[j] = -1
        r[nv + j] = -1
        extra.append(r)
        eb.append(0.0)
    if extra:
        A2 = np.vstack([A2] + extra)
        b2 = np.concatenate([b, eb])
    else:
        b2 = b.copy()

    bounds = [(None, None)] * n + [(0, None)] + [(0, None)] * n
    if fix_pitch is not None:
        bounds[iP] = (fix_pitch, fix_pitch)
    if trust:
        d = float(trust["radius"])
        for j in trust.get("vars", []):
            j = int(j)
            if 0 <= j < n:
                bounds[j] = (-d, d)

    res = linprog(c, A_ub=A2, b_ub=b2, bounds=bounds, method="highs")
    if res.success and res.status == 0:
        x = [float(v) for v in res.x[:nv]]
        return {"status": "optimal", "x": x, "pitch": float(res.x[iP]),
                "binding": _binding(tags, res)}
    if res.status == 2:
        return {"status": "infeasible", "x": None, "pitch": None,
                "binding": _elastic_binding(A2, b2, bounds, tags, ncols)}
    return {"status": "error", "x": None, "pitch": None, "binding": []}


# --------------------------------------------------------------------------- #
# Applying a solution
# --------------------------------------------------------------------------- #

def _crossings(p, y):
    xs = []
    N = len(p)
    for v in range(N):
        a_, b_ = p[v], p[(v + 1) % N]
        if (a_[1] - y) * (b_[1] - y) < 0:
            t_ = (y - a_[1]) / (b_[1] - a_[1])
            xs.append((a_[0] + t_ * (b_[0] - a_[0]), v))
    return xs


def apply(lay, model, x, case):
    """Return a new Layout with every x-displacement applied, on the grid.

    Outline-copy layers are re-synced to the moved outline; labels keep their
    proportional position between the crossings of their own shape.
    """
    polys = model["polys"]
    var = model["var"]
    grid = case.grid_um
    # Each displacement is rounded DOWN to the grid, not each vertex to the nearest grid point:
    # every rule distance is a whole number of grid steps, so x_j - x_k >= c survives
    # floor(x_j) - floor(x_k) >= c exactly, and shapes that share a variable move together
    # (rounding vertices separately shaved 5 nm off a TFT width and failed LVS).
    step = np.floor(np.asarray(x, dtype=float) / grid + 1e-6) * grid
    out = lay.copy()
    newp = {}
    for pi, (n, i, p) in enumerate(polys):
        q = p.copy().astype(float)
        for v in range(len(p)):
            q[v, 0] = p[v, 0] + step[var(pi, v)]
        q = np.round(np.round(q / grid) * grid, ROUND)
        newp.setdefault(n, []).append(q)
    for n in newp:
        out.polys[n] = newp[n]

    labmap = {}
    for k, v in case.raw.get("connectivity", {}).get("labelLayers", {}).items():
        labmap[int(k)] = v
    labs = []
    for t_, l, lx, ly in lay.labels:
        nx = lx
        name = labmap.get(l)
        if name is not None:
            for pi, (n, i, p) in enumerate(polys):
                if n != name:
                    continue
                if not Polygon(p).buffer(1e-3).contains(Point(lx, ly)):
                    continue
                yy = ly if any(abs(ly - q[1]) > 1e-6 for q in p) else ly + 1e-4
                q = p.copy().astype(float)
                q[:, 0] = [p[v, 0] + step[var(pi, v)] for v in range(len(p))]
                co = _crossings(p, yy)
                cn = dict((v, xx) for xx, v in _crossings(q, yy))
                left = max([c for c in co if c[0] <= lx], default=None, key=lambda c: c[0])
                right = min([c for c in co if c[0] >= lx], default=None, key=lambda c: c[0])
                if left and right and right[0] > left[0] and left[1] in cn and right[1] in cn:
                    f = (lx - left[0]) / (right[0] - left[0])
                    nx = cn[left[1]] + f * (cn[right[1]] - cn[left[1]])
                break
        labs.append((t_, l, round(round(nx / grid) * grid, ROUND), ly))
    out.labels = labs

    out = _layout.sync_outline_copies(out, case)
    return out


# --------------------------------------------------------------------------- #
# Edge classes (for gradient bookkeeping by the attribution surrogate)
# --------------------------------------------------------------------------- #

def edge_classes(model):
    """``[{"var", "layer", "polys", "orient"}]`` — one entry per displacement class."""
    polys = model["polys"]
    var = model["var"]
    iP = model["iP"]
    byvar = {}
    for pi, (n, i, p) in enumerate(polys):
        for v in range(len(p)):
            j = var(pi, v)
            if j == iP:
                continue
            d = byvar.setdefault(j, {"layers": {}, "polys": set()})
            d["layers"][n] = d["layers"].get(n, 0) + 1
            d["polys"].add(pi)
    out = []
    for j in sorted(byvar):
        d = byvar[j]
        layer = max(d["layers"], key=lambda kk: d["layers"][kk])
        out.append({"var": j, "layer": layer, "polys": sorted(d["polys"]), "orient": "x"})
    return out


# --------------------------------------------------------------------------- #
# One compaction pass on a given axis
# --------------------------------------------------------------------------- #

def compact(lay, axis, case, table, *, target_pitch=None, objective="pitch",
            metric_weights=None, legalise_zones=None, **buildkw):
    """Compact ``lay`` along ``axis`` ("x" or "y"); returns ``(Layout|None, info)``."""
    buildkw = dict(buildkw)
    if objective == "legalise" and not buildkw.get("legalise"):
        buildkw["legalise"] = True
    if legalise_zones is not None:
        buildkw["legalise_zones"] = legalise_zones
    L = lay if axis == "x" else transpose(lay)
    if axis == "y":
        if buildkw.get("protect"):
            buildkw["protect"] = [_transpose_box(bx) for bx in buildkw["protect"]]
        if buildkw.get("rigid_extra"):
            buildkw["rigid_extra"] = [_transpose_geom(g) for g in buildkw["rigid_extra"]]
        if buildkw.get("legalise_zones"):
            buildkw["legalise_zones"] = [_transpose_geom(g) for g in buildkw["legalise_zones"]]
    model = build(L, case, table, **buildkw)
    r = solve(model, target_pitch=target_pitch, objective=objective,
              metric_weights=metric_weights)
    info = {"status": r["status"], "pitch": r["pitch"], "binding": r["binding"],
            "cons": model["cons"], "nvars": model["nv"], "axis": axis}
    if r["status"] != "optimal":
        return None, info
    out = apply(L, model, r["x"], case)
    out = out if axis == "x" else transpose(out)
    return out, info
