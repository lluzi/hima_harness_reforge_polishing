"""Calibration mutants for ``judge-original`` (numeric module).

Two deliberate defects the judge must catch:

* ``remove_contact`` drops exactly one contact shape whose removal splits a
  labelled net (so LVS must fail on it). The split is verified by running
  ``nets.extract`` before and after.
* ``shrink_space`` moves exactly one polygon edge, outside any channel or the
  storage capacitor, so one same-layer spacing falls to half its rule value (so
  the authority DRC must fail on it).

Both change exactly one thing.
"""
from __future__ import annotations

import numpy as np

from . import core
from . import nets
from .core import PixelError

_EDGE_EPS = 1e-6


def _bbox(poly):
    lo = poly.min(0)
    hi = poly.max(0)
    return [float(lo[0]), float(lo[1]), float(hi[0]), float(hi[1])]


def _named_counts(extracted):
    unnamed = set(extracted["unnamed"])
    return dict((k, len(v)) for k, v in extracted["nets"].items() if k not in unnamed)


def remove_contact(lay, case):
    """Remove one contact shape whose removal splits a labelled net."""
    contact_layer = case.raw["connectivity"]["contactLayer"]
    vias = lay.polys.get(contact_layer, [])
    if not vias:
        raise PixelError("infeasible", "the layout has no contact shapes to remove")

    base = nets.extract(lay, case)
    base_unnamed = len(base["unnamed"])
    base_counts = _named_counts(base)

    for idx in range(len(vias)):
        cand = lay.copy()
        cand.polys[contact_layer] = [v for j, v in enumerate(vias) if j != idx]
        after = nets.extract(cand, case)
        if len(after["unnamed"]) <= base_unnamed:
            continue
        after_counts = _named_counts(after)
        split = [k for k in base_counts if after_counts.get(k, 0) < base_counts[k]]
        desc = {
            "kind": "remove-contact",
            "net": split[0] if split else None,
            "bbox": _bbox(vias[idx]),
        }
        return cand, desc

    raise PixelError("infeasible",
                     "no single contact removal splits a labelled net")


def _facing(a, b):
    """Return ``(axis, edge_val, new_from_other)`` orientation data for shape A's
    edge facing shape B across a positive gap, or ``None``.

    ``axis`` is the coordinate index (0 = x, 1 = y) of the facing edges, ``side``
    is A's facing edge value, ``other`` is B's near edge value, and ``gap`` the
    distance between them. Only clean bbox-to-bbox facings with overlap on the
    other axis are returned.
    """
    amin, amax = a.min(0), a.max(0)
    bmin, bmax = b.min(0), b.max(0)
    for axis in (0, 1):
        o = 1 - axis
        overlap = min(amax[o], bmax[o]) - max(amin[o], bmin[o])
        if overlap <= _EDGE_EPS:
            continue
        # A's high edge faces B's low edge
        gap = bmin[axis] - amax[axis]
        if gap > _EDGE_EPS:
            return axis, float(amax[axis]), float(bmin[axis]), float(gap)
        # A's low edge faces B's high edge
        gap = amin[axis] - bmax[axis]
        if gap > _EDGE_EPS:
            return axis, float(amin[axis]), float(bmax[axis]), float(gap)
    return None


def shrink_space(lay, case, table):
    """Move one edge so one same-layer spacing becomes 0.5x its rule value."""
    space = table.get("space", {})
    if not space:
        raise PixelError("infeasible", "the rule table has no same-layer space rule")

    plate = set(case.raw["cst"]["plateLayers"])
    gate = case.raw["devices"]["gateLayer"]
    poly = case.raw["devices"]["polyLayer"]
    top = case.raw["connectivity"]["topConductor"]

    order = [top] + [l for l in space if l != top]
    for layer in order:
        if layer not in space:
            continue
        if layer in plate or layer in (gate, poly):
            continue  # never move a capacitor plate or a device layer
        value = space[layer]
        target = 0.5 * value
        shapes = lay.polys.get(layer, [])
        for i in range(len(shapes)):
            for j in range(len(shapes)):
                if i == j:
                    continue
                face = _facing(shapes[i], shapes[j])
                if face is None:
                    continue
                axis, edge_val, other_val, gap = face
                if target >= gap - _EDGE_EPS:
                    continue  # cannot shrink this gap down to half the rule
                if other_val > edge_val:
                    new_val = core.snap(other_val - target, case.grid_um)
                else:
                    new_val = core.snap(other_val + target, case.grid_um)
                cand = lay.copy()
                arr = cand.polys[layer][i].copy()
                for v in arr:
                    if abs(v[axis] - edge_val) < _EDGE_EPS:
                        v[axis] = new_val
                cand.polys[layer][i] = arr
                desc = {
                    "kind": "shrink-space",
                    "layer": layer,
                    "rule": value,
                    "newSpace": round(abs(other_val - new_val), 6),
                    "axis": "x" if axis == 0 else "y",
                    "bbox": _bbox(shapes[i]),
                }
                return cand, desc

    raise PixelError("infeasible",
                     "no same-layer space can be shrunk to half its rule")
