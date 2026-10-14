"""Bounded layout edits (numeric module).

A plan may carry a few hand edits that move vertices or an edge of a named
polygon by a small amount, to repair residual markers the compactor cannot
reach. The rules of the Run contract (SPEC "What a Run may change"):

* each edit moves by at most ``core.EDIT_BOUND_UM`` (1.5 um);
* no edit touches a vertex that lies on a channel (poly AND gate) or inside the
  storage-capacitor marker region, and no edit changes a channel's shape (an edge sliding
  across the poly would, with no vertex on it);
* at most 12 edits per call;
* every moved vertex is snapped to the manifest grid.

Any violation raises ``PixelError('bad-plan')`` naming the offending edit.
``apply_edits`` returns ``(new_layout, log)`` where ``log`` records each applied
edit.
"""
from __future__ import annotations

import math

import numpy as np
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

from . import core
from .core import PixelError

_MAX_EDITS = 12
_MAX_STEP_UM = core.EDIT_BOUND_UM
_STEP_EPS = 1e-6
_TOUCH = 1e-4
_CHANNEL_EPS_UM2 = 1e-4


def _forbidden_geoms(lay, case):
    """The channel union (poly AND gate) and the capacitor-marker union."""
    poly = case.raw["devices"]["polyLayer"]
    gate = case.raw["devices"]["gateLayer"]
    channel = lay.geom(poly).intersection(lay.geom(gate))
    marker = lay.geom(case.raw["cst"]["markerLayer"])
    return channel, marker


def _box_edit(i, edit, arr, channel, marker, grid):
    """The polygon with a box joined (``op: add``) or cut away (``op: cut``)."""
    from shapely.geometry import box as _box
    op = edit.get("op")
    bx = edit.get("box") or []
    if op not in ("add", "cut") or len(bx) != 4:
        raise PixelError("bad-plan", "%s needs op add|cut and a box [x0, y0, x1, y1]"
                         % _label(i, edit))
    x0, y0, x1, y1 = (core.snap(float(v), grid) for v in bx)
    if x1 <= x0 or y1 <= y0:
        raise PixelError("bad-plan", "%s has an empty box" % _label(i, edit))
    before = Polygon(arr).buffer(0)
    region = _box(x0, y0, x1, y1)
    after = before.union(region) if op == "add" else before.difference(region)
    if after.geom_type != "Polygon" or after.is_empty or list(after.interiors):
        raise PixelError("bad-plan", "%s splits the polygon or makes a hole" % _label(i, edit))
    after = after.simplify(0)
    moved = before.boundary.hausdorff_distance(after.boundary)
    if moved > _MAX_STEP_UM + _STEP_EPS:
        raise PixelError("bad-plan", "%s moves the outline %.4f um > %g um limit"
                         % (_label(i, edit), moved, _MAX_STEP_UM))
    changed = before.symmetric_difference(after)
    if (not marker.is_empty) and changed.intersection(marker).area > _CHANNEL_EPS_UM2:
        raise PixelError("bad-plan", "%s changes the capacitor region" % _label(i, edit))
    pts = list(after.exterior.coords)[:-1]
    return np.round(np.array([[core.snap(x, grid), core.snap(y, grid)] for x, y in pts], float), 4)


def _label(i, edit):
    return "edit[%d] (%s poly %s)" % (i, edit.get("layer"), edit.get("polygon"))


def apply_edits(lay, edits, case):
    """Apply bounded edits; returns ``(new_layout, log)``.

    Each edit is ``{"layer", "polygon": index, "vertices": [i...] | "edge": i,
    "dx", "dy"}`` (move vertices), or ``{"layer", "polygon": index, "op": "add" | "cut",
    "box": [x0, y0, x1, y1]}`` (a designer's local reshape: join the box to the polygon or cut it
    away; the outline may move by at most the bound anywhere, and the polygon stays one piece).
    """
    if len(edits) > _MAX_EDITS:
        raise PixelError("bad-plan",
                         "a plan holds at most %d bounded edits, got %d"
                         % (_MAX_EDITS, len(edits)))

    channel, marker = _forbidden_geoms(lay, case)
    poly = case.raw["devices"]["polyLayer"]
    gate = case.raw["devices"]["gateLayer"]
    grid = case.grid_um
    out = lay.copy()
    log = []
    for i, edit in enumerate(edits):
        layer = edit.get("layer")
        pidx = edit.get("polygon")
        dx = float(edit.get("dx", 0.0))
        dy = float(edit.get("dy", 0.0))

        if math.hypot(dx, dy) > _MAX_STEP_UM + _STEP_EPS:
            raise PixelError("bad-plan",
                             "%s moves %.4f um > %g um limit"
                             % (_label(i, edit), math.hypot(dx, dy), _MAX_STEP_UM))

        polys = out.polys.get(layer)
        if not polys or pidx is None or pidx < 0 or pidx >= len(polys):
            raise PixelError("bad-plan", "%s names no polygon" % _label(i, edit))
        arr = polys[pidx]
        n = len(arr)

        if "box" in edit:
            out.polys[layer][pidx] = _box_edit(i, edit, arr, channel, marker, grid)
            if layer in (poly, gate):
                after = out.geom(poly).intersection(out.geom(gate))
                if after.symmetric_difference(channel).area > _CHANNEL_EPS_UM2:
                    raise PixelError("bad-plan",
                                     "%s changes a channel (poly AND gate)" % _label(i, edit))
            log.append({"edit": i, "layer": layer, "polygon": pidx, "op": edit.get("op"),
                        "box": list(edit["box"])})
            continue

        if "edge" in edit:
            e = int(edit["edge"])
            if e < 0 or e >= n:
                raise PixelError("bad-plan", "%s names no edge %d" % (_label(i, edit), e))
            vids = [e, (e + 1) % n]
        elif "vertices" in edit:
            vids = [int(v) for v in edit["vertices"]]
            if any(v < 0 or v >= n for v in vids):
                raise PixelError("bad-plan", "%s names a vertex out of range" % _label(i, edit))
        else:
            raise PixelError("bad-plan", "%s names neither vertices nor an edge" % _label(i, edit))

        for v in vids:
            px, py = float(arr[v][0]), float(arr[v][1])
            pt = Point(px, py)
            if (not channel.is_empty) and channel.buffer(_TOUCH).intersects(pt):
                raise PixelError("bad-plan",
                                 "%s moves a channel vertex at (%.4f, %.4f)"
                                 % (_label(i, edit), px, py))
            if (not marker.is_empty) and marker.buffer(_TOUCH).contains(pt):
                raise PixelError("bad-plan",
                                 "%s moves a capacitor vertex at (%.4f, %.4f)"
                                 % (_label(i, edit), px, py))

        new = arr.copy()
        for v in vids:
            nx = core.snap(float(new[v][0]) + dx, grid)
            ny = core.snap(float(new[v][1]) + dy, grid)
            new[v][0] = nx
            new[v][1] = ny
        out.polys[layer][pidx] = np.round(new, 4)
        if layer in (poly, gate):
            # an edge that slides across the poly can reshape a channel with no vertex on it
            after = out.geom(poly).intersection(out.geom(gate))
            if after.symmetric_difference(channel).area > _CHANNEL_EPS_UM2:
                raise PixelError("bad-plan", "%s changes a channel (poly AND gate)" % _label(i, edit))
        log.append({"edit": i, "layer": layer, "polygon": pidx,
                    "vertices": vids, "dx": dx, "dy": dy})
    return out, log
