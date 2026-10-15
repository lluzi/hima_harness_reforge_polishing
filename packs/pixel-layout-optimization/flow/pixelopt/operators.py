"""The five discrete plan operators (numeric module).

A plan names operators by net, layer and role -- never by coordinate. Each
operator takes the current :class:`layout.Layout`, the operator dict, the
:class:`manifest.Case` and the extracted nets (``nets.extract`` output), and
returns ``(new_layout, description)`` where ``description`` carries ``changed``
(a human list of what moved) and ``declaredChanges`` (values a plan declares,
e.g. a new storage-capacitor device value).

* ``shield {net, layer, over: {victim, aggressor}, marginUm, bridgeWidthUm}`` -- one
  polygon on the named fixed-potential net and layer covering the victim/aggressor
  overlap grown (or, negative, shrunk) by the margin, clipped so it does not overlap
  any third net on that layer, and tied to the net's own shapes on the layer by a
  short strip when it does not touch them (refused when it cannot be tied).
* ``cst-stretch {dyUm, cutAt}`` -- a smart cut through the capacitor marker;
  everything beyond the cut moves by ``dyUm`` (edges along the motion stretch,
  diagonal edges straddling the cut are carried rigidly). Declares the new Cst.
* ``opening-shift {dxUm, dyUm}`` -- translates the emission-opening shapes and
  the anode-layer shapes inside the opening.
* ``band-trim {net, layer, widthUm}`` -- narrows the net's shape on the layer to
  ``widthUm`` about its centreline, never cutting within a contact's enclosure.
* ``contact-move {net, toward, stepUm}`` -- moves the net's contact and its
  landing/top pads one step; refused unless ``topology_moves`` is ``allowed``.
"""
from __future__ import annotations

import numpy as np
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

from .core import PixelError

OPERATORS = ("shield", "cst-stretch", "opening-shift", "band-trim", "contact-move")

_AREA_EPS = 1e-6
_EPS = 1e-9
_TOWARD = {"left": (-1.0, 0.0), "right": (1.0, 0.0), "up": (0.0, 1.0), "down": (0.0, -1.0)}


# --------------------------------------------------------------------------- #
# Shared helpers
# --------------------------------------------------------------------------- #

def _coords(geom):
    """Exterior vertices of a (largest) polygon as an (n, 2) array, no closing point."""
    if geom.is_empty:
        return None
    if hasattr(geom, "geoms"):
        geom = max(geom.geoms, key=lambda g: g.area)
    return np.array(geom.exterior.coords[:-1], dtype=float)


def _net_layer_geom(nets, net, layer):
    """Union of the net's shapes on one display layer (``PolySD`` stands in for
    the poly layer)."""
    geoms = [g for L, g in nets.get("nets", {}).get(net, []) if L == layer]
    return unary_union(geoms) if geoms else Polygon()


def _net_geom(nets, net):
    geoms = [g for _, g in nets.get("nets", {}).get(net, [])]
    return unary_union(geoms) if geoms else Polygon()


def _enclosure(case, table):
    if not table:
        return 0.0
    vals = [row[2] for row in table.get("enc", []) if len(row) >= 3]
    return max(vals) if vals else 0.0


# --------------------------------------------------------------------------- #
# shield
# --------------------------------------------------------------------------- #

# A plate further than this from its own net's shapes on the layer is refused: a bridge that long
# is a new route, not a tie.
_MAX_BRIDGE_UM = 1.5
# Clearance from third nets when the rule table names no spacing for the layer.
_MIN_CLEAR_UM = 0.05


def _bridge(plate, own, width):
    """An axis-aligned strip from ``plate`` to the nearest point of ``own`` (both shapely)."""
    from shapely.ops import nearest_points
    p, q = nearest_points(plate, own)
    half = width / 2.0
    dx, dy = abs(q.x - p.x), abs(q.y - p.y)
    ov = 0.05  # reach a little into both shapes so the union is one polygon
    if dy >= dx:   # vertical strip centred on the plate-side point
        y0, y1 = sorted((p.y, q.y))
        return box(p.x - half, y0 - ov, p.x + half, y1 + ov)
    x0, x1 = sorted((p.x, q.x))
    return box(x0 - ov, p.y - half, x1 + ov, p.y + half)


def _largest(geom):
    if geom.is_empty:
        return Polygon()
    if hasattr(geom, "geoms"):
        parts = [g for g in geom.geoms if g.area > _AREA_EPS]
        return max(parts, key=lambda g: g.area) if parts else Polygon()
    return geom


def _rule_shape(plate, lay, layer, table, blocked, own=None):
    """Shape a plate on ``layer`` to the rule table: keep the cross-layer spacing from shapes it
    does not cover (``xspace``), keep clear of ``blocked``, fill notches narrower than the layer's
    spacing and drop parts narrower than its width. Mitred offsets keep the edges orthogonal.
    Markers the shaping cannot foresee (enclosures, angled widths) are trimmed against the
    authority deck afterwards (:func:`solve._trim_plates`). ``own`` (the plate's net on this layer) joins the notch fill: a plate closer
    to its own net than the layer's spacing is merged into it, which also ties it."""
    t = table or {}
    width = float((t.get("width", {}) or {}).get(layer) or 0.0)
    space = float((t.get("space", {}) or {}).get(layer) or 0.0)
    encs = []
    xsp = []
    for row in t.get("xspace", []) or []:
        if len(row) >= 3 and layer in row[:2]:
            xsp.append((row[1] if row[0] == layer else row[0], float(row[2])))
    for _ in range(2):
        for inner, v in encs:
            for p in lay.polys.get(inner, []):
                g = Polygon(p).buffer(0)
                if not g.is_empty and g.intersection(plate).area > _AREA_EPS:
                    plate = plate.union(g.intersection(plate).buffer(v, join_style=2))
        for other, v in xsp:
            for p in lay.polys.get(other, []):
                g = Polygon(p).buffer(0)
                if not g.is_empty and g.intersection(plate).area <= _AREA_EPS:
                    plate = plate.difference(g.buffer(v, join_style=2))
        if not blocked.is_empty:
            plate = plate.difference(blocked)
        if space > 0:
            base = plate
            if own is not None and not own.is_empty:
                near = own.intersection(plate.buffer(space, join_style=2))
                if not near.is_empty:
                    base = plate.union(near)
            plate = base.buffer(space / 2.0, join_style=2).buffer(-space / 2.0, join_style=2)
            if not blocked.is_empty:
                plate = plate.difference(blocked)
        if width > 0:
            plate = plate.buffer(-width / 2.0, join_style=2).buffer(width / 2.0, join_style=2)
        plate = _largest(plate)
        if plate.is_empty:
            break
    return plate


def _shield(lay, op, case, nets, table=None):
    """One plate on a fixed-potential net between a victim and an aggressor, tied to that net.

    ``marginUm`` grows (positive) or shrinks (negative) the victim/aggressor overlap, so a plan can
    sweep the plate's size. The plate is clipped to the layer's spacing from every third net on the
    layer (``table`` space, else 0.05 um); when it does not
    already touch the named net's own shapes there, a strip ``bridgeWidthUm`` wide (default 1.0,
    never under the layer's minimum width)
    joins it to the nearest one at most 1.5 um away. With a rule table the plate is shaped to it
    (:func:`_rule_shape`: enclosure, cross-layer spacing, width and notch rules). A plate that
    cannot be tied is refused: a floating plate hides its coupling from every judged value.
    """
    net = op["net"]
    layer = op["layer"]
    over = op.get("over", {})
    victim = over["victim"]
    aggressor = over["aggressor"]
    margin = float(op.get("marginUm", 0.0))
    min_w = float(((table or {}).get("width", {}) or {}).get(layer) or 0.0)
    bridge_w = max(float(op.get("bridgeWidthUm", 1.0)), min_w)

    vg = _net_geom(nets, victim)
    ag = _net_geom(nets, aggressor)
    overlap = vg.intersection(ag)
    region = overlap if not overlap.is_empty else vg.buffer(max(margin, 0.0) or _EPS).intersection(ag)
    if region.is_empty:
        raise PixelError("bad-plan",
                         "shield: %s and %s do not overlap" % (victim, aggressor))
    if margin:
        region = region.buffer(margin, join_style=2)
    if region.is_empty or region.area <= _AREA_EPS:
        raise PixelError("bad-plan", "shield: marginUm %g leaves no plate" % margin)

    # Clip so the plate keeps the layer's minimum spacing from every third net on this layer
    # (merely not overlapping still touches them, and a touching plate shorts the two nets).
    space = float(((table or {}).get("space", {}) or {}).get(layer) or 0.0) or _MIN_CLEAR_UM
    others = []
    for n, items in nets.get("nets", {}).items():
        if n == net:
            continue
        for L, g in items:
            if L == layer:
                others.append(g.buffer(space, join_style=2))
    # A contact under the plate would land on it and re-wire another net through it: keep the
    # plate clear of every contact that does not already belong to the plate's net on this layer.
    own_here = _net_layer_geom(nets, net, layer)
    contact_layer = (case.raw.get("connectivity", {}) or {}).get("contactLayer")
    for p in lay.polys.get(contact_layer, []) if contact_layer else []:
        c = Polygon(p).buffer(0)
        if c.is_empty or (not own_here.is_empty and c.intersection(own_here).area > _AREA_EPS):
            continue
        others.append(c.buffer(space, join_style=2))
    blocked = unary_union(others) if others else Polygon()
    clipped = region.difference(blocked) if others else region
    clipped = _largest(clipped)
    own = _net_layer_geom(nets, net, layer)
    if table:
        clipped = _rule_shape(clipped, lay, layer, table, blocked, own)
    if clipped.is_empty or clipped.area <= _AREA_EPS:
        raise PixelError("bad-plan", "shield: no plate on %s survives the layer's rules" % layer)

    if list(clipped.interiors):
        # a hole is another net's shape (or contact) the plate would surround; one GDS polygon
        # keeps only the exterior, so writing it would cover that shape and short the two nets
        raise PixelError("bad-plan", "shield: the plate would surround another net's shape on %s; "
                         "use a smaller (or negative) marginUm" % layer)
    if own.is_empty:
        raise PixelError("bad-plan", "shield: net %s has no shape on %s to tie the plate to" % (net, layer))
    bridge_area = 0.0
    if clipped.distance(own) > 1e-6:
        gap = clipped.distance(own)
        if gap > _MAX_BRIDGE_UM:
            raise PixelError("bad-plan", "shield: the plate is %.2f um from any %s shape on %s "
                             "(at most %g); it would float" % (gap, net, layer, _MAX_BRIDGE_UM))
        strip = _bridge(clipped, own, bridge_w)
        strip = strip.difference(blocked) if others else strip
        tied = unary_union([clipped, strip])
        if table:
            tied = _rule_shape(tied, lay, layer, table, blocked, own)
        if hasattr(tied, "geoms") or tied.distance(own) > 1e-6:
            raise PixelError("bad-plan", "shield: no clear %g um path ties the plate to %s on %s"
                             % (bridge_w, net, layer))
        bridge_area = float(tied.area - clipped.area)
        clipped = tied
    pts = _coords(clipped)
    if pts is None or len(pts) < 3:
        raise PixelError("bad-plan", "shield: clipped plate is empty on %s" % layer)

    out = lay.copy()
    out.polys.setdefault(layer, []).append(np.round(pts, 4))
    desc = {
        "changed": ["%s += 1 shield polygon on net %s (over %s/%s)"
                    % (layer, net, victim, aggressor)],
        "declaredChanges": {},
        "shield": {"net": net, "layer": layer, "plate": np.round(pts, 4).tolist(),
                   "areaUm2": round(float(clipped.area), 6),
                   "bridgeUm2": round(bridge_area, 6),
                   "clippedUm2": round(float(max(0.0, region.area - (clipped.area - bridge_area))), 6)},
    }
    return out, desc


# --------------------------------------------------------------------------- #
# cst-stretch (ported smart cut)
# --------------------------------------------------------------------------- #

def _smart_cut(lay, axis, c, delta, side):
    """Move every vertex on ``side`` of the cut by ``delta`` along ``axis``.

    Edges parallel to the motion axis stretch; non-parallel edges straddling the
    cut are carried rigidly to the moving side (port of day-1 ``edit.smart_cut``
    with a selectable side so the stretch can be anchored at either marker edge).
    """
    k = 0 if axis == "x" else 1
    o = 1 - k
    out = lay.copy()
    for n in out.polys:
        new = []
        for p in out.polys[n]:
            if side == "above":
                m = p[:, k] > c + _EPS
            else:
                m = p[:, k] < c - _EPS
            size = len(p)
            changed = True
            while changed:
                changed = False
                for i in range(size):
                    j = (i + 1) % size
                    if m[i] == m[j]:
                        continue
                    if abs(p[i, o] - p[j, o]) < _EPS:
                        continue  # edge runs along the motion axis: it stretches
                    m[i] = m[j] = True  # carry the straddling edge rigidly
                    changed = True
            q = p.copy()
            q[m, k] += delta
            new.append(np.round(q, 4))
        out.polys[n] = new
    nl = []
    for t, l, x, y in out.labels:
        v = x if k == 0 else y
        moves = (v > c + _EPS) if side == "above" else (v < c - _EPS)
        if moves:
            if k == 0:
                x = x + delta
            else:
                y = y + delta
        nl.append((t, l, x, y))
    out.labels = nl
    return out


def _cst_device(lay, case):
    cst = case.raw["cst"]
    g = lay.geom(cst["markerLayer"])
    for pl in cst["plateLayers"]:
        g = g.intersection(lay.geom(pl))
    return float(g.area) * cst["coefficientFfPerUm2"]


def _cst_stretch(lay, op, case, nets):
    cst = case.raw["cst"]
    dy = float(op["dyUm"])
    cut_at = op.get("cutAt", "marker-bottom")
    if cut_at not in ("marker-top", "marker-bottom"):
        raise PixelError("bad-plan", "cst-stretch: bad cutAt %r" % (cut_at,))
    marker = lay.geom(cst["markerLayer"])
    if marker.is_empty:
        raise PixelError("bad-plan", "cst-stretch: no capacitor marker")
    y0, y1 = marker.bounds[1], marker.bounds[3]
    c = (y0 + y1) / 2.0  # cut through the marker interior so the plates grow
    if cut_at == "marker-bottom":
        out = _smart_cut(lay, "y", c, dy, "above")  # anchor the bottom, raise the top
    else:
        out = _smart_cut(lay, "y", c, -dy, "below")  # anchor the top, lower the bottom

    new_ff = _cst_device(out, case)
    desc = {
        "changed": ["%s/%s plates stretched by %g um in y (cut %s)"
                    % (cst["markerLayer"], "+".join(cst["plateLayers"]), dy, cut_at)],
        "declaredChanges": {"cstFf": round(new_ff, 6)},
    }
    return out, desc


# --------------------------------------------------------------------------- #
# opening-shift
# --------------------------------------------------------------------------- #

def _opening_shift(lay, op, case, nets):
    dx = float(op.get("dxUm", 0.0))
    dy = float(op.get("dyUm", 0.0))
    openings = case.layers_with("emission-opening")
    anode_layers = list(case.raw.get("nets", {}).get("anodeLayers", []))
    if not openings:
        raise PixelError("bad-plan", "opening-shift: no emission-opening layer")

    opening_geom = unary_union([lay.geom(n) for n in openings])
    out = lay.copy()
    shift = np.array([dx, dy])
    changed = []
    for n in openings:
        if out.polys.get(n):
            out.polys[n] = [np.round(p + shift, 4) for p in out.polys[n]]
            changed.append(n)
    for n in anode_layers:
        moved = []
        any_moved = False
        for p in out.polys.get(n, []):
            poly = Polygon(p).buffer(0)
            if not poly.is_empty and poly.intersection(opening_geom).area > _AREA_EPS:
                moved.append(np.round(p + shift, 4))
                any_moved = True
            else:
                moved.append(p)
        out.polys[n] = moved
        if any_moved:
            changed.append(n)
    desc = {
        "changed": ["%s shifted by (%g, %g) um" % (", ".join(changed), dx, dy)],
        "declaredChanges": {},
    }
    return out, desc


# --------------------------------------------------------------------------- #
# band-trim
# --------------------------------------------------------------------------- #

def _band_trim(lay, op, case, nets, table):
    net = op["net"]
    layer = op["layer"]
    width = float(op["widthUm"])
    enc = _enclosure(case, op.get("table", table))
    contact_layer = case.raw["connectivity"]["contactLayer"]

    net_geom = _net_layer_geom(nets, net, layer)
    if net_geom.is_empty and layer == case.raw["devices"]["polyLayer"]:
        net_geom = _net_layer_geom(nets, net, "PolySD")
    if net_geom.is_empty:
        raise PixelError("bad-plan", "band-trim: net %s has no shape on %s" % (net, layer))

    contacts = [Polygon(p).buffer(0) for p in lay.polys.get(contact_layer, [])
                if len(p) >= 3]
    out = lay.copy()
    changed = 0
    new_polys = []
    for p in out.polys.get(layer, []):
        poly = Polygon(p).buffer(0)
        if poly.is_empty or poly.intersection(net_geom).area <= _AREA_EPS:
            new_polys.append(p)
            continue
        x0, y0, x1, y1 = poly.bounds
        w, h = x1 - x0, y1 - y0
        if h >= w:  # vertical strip: narrow in x about the centreline
            xc = (x0 + x1) / 2.0
            narrowed = box(xc - width / 2.0, y0, xc + width / 2.0, y1)
        else:       # horizontal strip: narrow in y
            yc = (y0 + y1) / 2.0
            narrowed = box(x0, yc - width / 2.0, x1, yc + width / 2.0)
        narrowed = narrowed.intersection(poly)
        protect = [poly.intersection(c.buffer(enc)) for c in contacts
                   if poly.intersection(c.buffer(enc)).area > _AREA_EPS]
        result = unary_union([narrowed] + protect) if protect else narrowed
        pts = _coords(result)
        if pts is None or len(pts) < 3:
            new_polys.append(p)
            continue
        new_polys.append(np.round(pts, 4))
        changed += 1
    out.polys[layer] = new_polys
    if not changed:
        raise PixelError("bad-plan", "band-trim: no %s shape of net %s to trim" % (layer, net))
    desc = {
        "changed": ["%s of net %s narrowed to %g um (enclosure %g kept)"
                    % (layer, net, width, enc)],
        "declaredChanges": {},
    }
    return out, desc


# --------------------------------------------------------------------------- #
# contact-move
# --------------------------------------------------------------------------- #

def _contact_move(lay, op, case, nets, topology_moves):
    allowed = topology_moves == "allowed" or op.get("topologyMoves") == "allowed"
    if not allowed:
        raise PixelError("bad-plan", "contact-move needs topologyMoves allowed")
    net = op["net"]
    toward = op.get("toward")
    if toward not in _TOWARD:
        raise PixelError("bad-plan", "contact-move: bad toward %r" % (toward,))
    step = float(op["stepUm"])
    ux, uy = _TOWARD[toward]
    shift = np.array([ux * step, uy * step])

    conn = case.raw["connectivity"]
    contact_layer = conn["contactLayer"]
    net_geom = _net_geom(nets, net)
    if net_geom.is_empty:
        raise PixelError("bad-plan", "contact-move: net %s has no shapes" % net)

    out = lay.copy()
    vias = out.polys.get(contact_layer, [])
    moved_vias = [i for i, p in enumerate(vias)
                  if Polygon(p).buffer(0).intersection(net_geom).area > _AREA_EPS]
    if not moved_vias:
        raise PixelError("bad-plan", "contact-move: net %s has no contact" % net)
    via_geom = unary_union([Polygon(vias[i]).buffer(0) for i in moved_vias])
    for i in moved_vias:
        out.polys[contact_layer][i] = np.round(vias[i] + shift, 4)

    changed = ["%s: %d contact(s) of net %s" % (contact_layer, len(moved_vias), net)]
    # Move the top/landing pads the moved contacts sit on.
    pad_layers = [conn["topConductor"]] + [l for l in conn["landingOrder"] if l != "PolySD"]
    for layer in pad_layers:
        polys = out.polys.get(layer, [])
        hit = [j for j, p in enumerate(polys)
               if Polygon(p).buffer(0).intersection(via_geom).area > _AREA_EPS]
        for j in hit:
            out.polys[layer][j] = np.round(polys[j] + shift, 4)
        if hit:
            changed.append("%s: %d pad(s)" % (layer, len(hit)))
    desc = {"changed": changed, "declaredChanges": {}}
    return out, desc


# --------------------------------------------------------------------------- #
# Dispatch
# --------------------------------------------------------------------------- #

def apply_operator(lay, op, case, nets, table=None, topology_moves=None):
    """Apply one plan operator; returns ``(new_layout, description)``.

    ``table`` is a ``rules.compaction_table`` (band-trim enclosure); it may also
    arrive as ``op['table']``. ``topology_moves`` is the Strategy knob the caller
    passes for ``contact-move`` (``'allowed'`` or ``'off'``). An unknown operator
    raises ``PixelError('bad-plan')``.
    """
    kind = op.get("op") or op.get("operator") or op.get("kind")  # plans name it "op"
    if kind == "shield":
        return _shield(lay, op, case, nets, op.get("table", table))
    if kind == "cst-stretch":
        return _cst_stretch(lay, op, case, nets)
    if kind == "opening-shift":
        return _opening_shift(lay, op, case, nets)
    if kind == "band-trim":
        return _band_trim(lay, op, case, nets, table)
    if kind == "contact-move":
        return _contact_move(lay, op, case, nets, topology_moves)
    raise PixelError("bad-plan", "unknown operator %r" % (kind,))
