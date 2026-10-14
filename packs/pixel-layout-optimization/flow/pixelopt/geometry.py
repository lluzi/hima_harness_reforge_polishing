"""Per-candidate geometry measurements (numeric module).

Port of the day-1 geometry checks (``.scratch/pixel-agent/tools/checks.py``)
generalised through the manifest roles. Nothing here is hard-coded to a layer or
net name: opaque layers come from role ``opaque``, the emission opening from role
``emission-opening``, the outline from role ``outline``/``outline-copy``, the
capacitor from ``cst``, the channels from ``devices``, and connectivity-interact
rules from ``interactRules``.
"""
from __future__ import annotations

import math

import numpy as np
from shapely import affinity
from shapely.geometry import Polygon, box
from shapely.ops import unary_union

from . import nets

_AREA_EPS = 1e-9
_CONGRUENCE_UM = 0.002


def _parts(g):
    if g is None or g.is_empty:
        return []
    return list(g.geoms) if hasattr(g, "geoms") else [g]


# --------------------------------------------------------------------------- #
# Transmittance
# --------------------------------------------------------------------------- #

def _tile_union(lay, case, name):
    """Union of a layer over the 3x3 array at the outline pitch (neighbour copies)."""
    (x0, y0), (x1, y1) = lay.outline(case)
    w, h = x1 - x0, y1 - y0
    g = lay.geom(name)
    if g.is_empty:
        return g
    return unary_union([affinity.translate(g, i * w, j * h)
                        for i in (-1, 0, 1) for j in (-1, 0, 1)])


def _opaque(lay, case, tiled):
    geoms = []
    for n in case.layers_with("opaque"):
        g = _tile_union(lay, case, n) if tiled else lay.geom(n)
        if not g.is_empty:
            geoms.append(g)
    return unary_union(geoms) if geoms else Polygon()


def transmittance(lay, case, tiled=True):
    """Fraction of the own cell not covered by opaque layers.

    ``tiled`` takes the centre cell of the 3x3 array, so a neighbour's shape that
    overhangs into the cell counts; ``own`` uses only this cell's own shapes.
    """
    (x0, y0), (x1, y1) = lay.outline(case)
    cell = box(x0, y0, x1, y1)
    area = cell.area
    if area <= 0:
        return 0.0
    covered = _opaque(lay, case, tiled).intersection(cell).area
    return 1.0 - covered / area


# --------------------------------------------------------------------------- #
# Channels and their congruence
# --------------------------------------------------------------------------- #

def _channels(lay, case):
    poly = case.raw["devices"]["polyLayer"]
    gate = case.raw["devices"]["gateLayer"]
    ch = lay.geom(poly).intersection(lay.geom(gate))
    regs = []
    for p in _parts(ch):
        if p.area < _AREA_EPS:
            continue
        x0, y0, x1, y1 = p.bounds
        regs.append({"area": round(p.area, 4), "w": round(x1 - x0, 4),
                     "l": round(y1 - y0, 4), "bbox": (round(x0, 4), round(y0, 4),
                     round(x1, 4), round(y1, 4)), "geom": p})
    return sorted(regs, key=lambda r: (r["area"], r["w"]))


def _norm(poly):
    """Translation-invariant, canonically-ordered vertex array of a polygon."""
    x0, y0, _, _ = poly.bounds
    q = affinity.translate(poly, -x0, -y0).normalize()
    return np.round(np.array(q.exterior.coords), 4)


def _channel_changes(lay, original_lay, case):
    a = _channels(lay, case)
    b = _channels(original_lay, case)
    changed = 0
    notes = []
    n = max(len(a), len(b))
    for k in range(n):
        if k >= len(a) or k >= len(b):
            changed += 1
            notes.append("channel count %d -> %d" % (len(b), len(a)))
            continue
        na, nb = _norm(a[k]["geom"]), _norm(b[k]["geom"])
        if na.shape != nb.shape or float(np.abs(na - nb).max()) > _CONGRUENCE_UM:
            changed += 1
            notes.append("channel reshaped: bbox %s area %s -> bbox %s area %s"
                         % (b[k]["bbox"], b[k]["area"], a[k]["bbox"], a[k]["area"]))
    return changed, notes


# --------------------------------------------------------------------------- #
# OLED area and PDL symmetry
# --------------------------------------------------------------------------- #

def _oled_area(lay, case):
    openings = case.layers_with("emission-opening")
    if not openings:
        return 0.0
    g = unary_union([lay.geom(n) for n in openings])
    if g.is_empty:
        return 0.0
    for n in case.raw.get("nets", {}).get("anodeLayers", []):
        g = g.intersection(lay.geom(n))
    copies = case.layers_with("outline-copy")
    if copies:
        g = g.intersection(unary_union([lay.geom(n) for n in copies]))
    return g.area


def _pdl_symmetry_min(lay, case):
    openings = []
    for n in case.layers_with("emission-opening"):
        openings.extend(lay.polys.get(n, []))
    if not openings:
        return None
    opening = Polygon(openings[0]).buffer(0)
    if opening.is_empty:
        return None
    x0, y0, x1, y1 = opening.bounds
    xc, yc = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    vals = []
    for n in case.layers_with("conductor"):
        g = lay.geom(n).intersection(opening)
        if g.area <= 0:
            continue
        mx = affinity.scale(g, 1, -1, origin=(xc, yc))
        my = affinity.scale(g, -1, 1, origin=(xc, yc))
        vals.append(g.intersection(mx).area / g.area)
        vals.append(g.intersection(my).area / g.area)
    if not vals:
        return None
    return round(min(vals), 4)


# --------------------------------------------------------------------------- #
# Connectivity interact rules, capacitor, grid and angles
# --------------------------------------------------------------------------- #

def _interact_violations(lay, case):
    out = {}
    for rule in case.raw.get("interactRules", []):
        alts = rule.get("mustTouch", [])
        count = 0
        for p in _parts(lay.geom(rule["layer"])):
            satisfied = False
            for alt in alts:
                if all(lay.geom(a).intersects(p) for a in alt):
                    satisfied = True
                    break
            if not satisfied:
                count += 1
        if count:
            out[rule["id"]] = count
    return out


def _cst(lay, case):
    cst = case.raw["cst"]
    marker = lay.geom(cst["markerLayer"])
    g = marker
    for pl in cst["plateLayers"]:
        g = g.intersection(lay.geom(pl))
    device_ff = g.area * cst["coefficientFfPerUm2"]
    return device_ff, marker.area


def _offgrid(lay, case):
    grid = case.grid_um
    if not grid:
        return 0
    n = 0
    for ps in lay.polys.values():
        for p in ps:
            for v in p:
                qx, qy = v[0] / grid, v[1] / grid
                if abs(qx - round(qx)) > 1e-3 or abs(qy - round(qy)) > 1e-3:
                    n += 1
    return n


def _bad_angles(lay, case):
    outline = set(case.layers_with("outline"))
    bad = 0
    for name, ps in lay.polys.items():
        if name in outline:
            continue
        for p in ps:
            q = np.vstack([p, p[:1]])
            for a, b in zip(q[:-1], q[1:]):
                dx, dy = b[0] - a[0], b[1] - a[1]
                if abs(dx) < 1e-9 and abs(dy) < 1e-9:
                    continue
                ang = math.degrees(math.atan2(dy, dx)) % 180
                if min(abs(ang - t) for t in (0, 45, 90, 135, 180)) > 0.5:
                    bad += 1
    return bad


# --------------------------------------------------------------------------- #
# The measurement
# --------------------------------------------------------------------------- #

def measure(lay, case, original_lay, rules_parsed):
    """Measure one candidate layout against the frozen original.

    ``rules_parsed`` is accepted for interface stability (the parsed authority
    deck); the geometry measures here derive everything from the manifest roles
    and the two layouts.
    """
    (x0, y0), (x1, y1) = lay.outline(case)
    changed, notes = _channel_changes(lay, original_lay, case)
    cst_ff, marker_area = _cst(lay, case)
    ne = nets.extract(lay, case)
    named = sorted([k for k in ne["nets"] if k not in set(ne["unnamed"])])
    return {
        "outlineUm": [round(x1 - x0, 6), round(y1 - y0, 6)],
        "channelsChanged": changed,
        "channelNotes": notes,
        "tTiledPct": round(transmittance(lay, case, True) * 100.0, 6),
        "tOwnPct": round(transmittance(lay, case, False) * 100.0, 6),
        "oledAreaUm2": round(_oled_area(lay, case), 6),
        "pdlSymmetryMin": _pdl_symmetry_min(lay, case),
        "interactViolations": _interact_violations(lay, case),
        "cstDeviceFf": round(cst_ff, 6),
        "cstMarkerAreaUm2": round(marker_area, 6),
        "offGridVertices": _offgrid(lay, case),
        "badAngleEdges": _bad_angles(lay, case),
        "nets": named,
    }
