"""The design-space card and its SVG (numeric module).

:func:`make_card` assembles the ``pixel.card/1`` document the resident reads and
keeps it at or under 4 KB (the contract's hard ceiling), trimming the most
optional detail first. :func:`card_svg` draws the unit cell -- the outline, the
conductor layers in light colours and the top coupling sites highlighted -- as a
small, self-contained, stdlib-rendered SVG string.

The inputs are already the finished, rounded lists that ``numcmd.cmd_map``
builds from :mod:`pixelopt.attribution` (sites and the surrogate), the LP
compactor (the per-axis pitch bound and its binding chain) and the manifest
roles. This module only structures them, so it stays a thin, testable seam.

Numeric module: it may import numpy/shapely, but is pure geometry/strings.
"""
from __future__ import annotations

import json

__all__ = ["make_card", "card_svg", "SCHEMA"]

SCHEMA = "pixel.card/1"

_MAX_BYTES = 4096

# A light, colour-blind-safe-ish palette; conductor layers cycle through it.
_PALETTE = ["#6ca0dc", "#b5651d", "#8fbc8f", "#c98fd9", "#d9c36a",
            "#8fd9d9", "#c98f8f", "#9f9fd9"]


# --------------------------------------------------------------------------- #
# Card assembly
# --------------------------------------------------------------------------- #

def _round(x, n=4):
    if x is None:
        return None
    try:
        return round(float(x), n)
    except (TypeError, ValueError):
        return None


def _site_entry(s):
    return {
        "victim": s.get("victim"),
        "aggressor": s.get("aggressor"),
        "layers": [s.get("victimLayer"), s.get("aggressorLayer")],
        "sharePct": _round(s.get("sharePct"), 3),
        "estFf": _round(s.get("estFf"), 6),
    }


def _lever_entry(l):
    grad = {}
    for pair, g in (l.get("gradientFfPerUm") or {}).items():
        grad[pair] = _round(g, 6)
    return {
        "id": l.get("id"),
        "kind": l.get("kind", "edge"),
        "axis": l.get("axis"),
        "layer": l.get("layer"),
        "net": l.get("net"),
        "gradientFfPerUm": grad,
        "boundUm": _round(l.get("boundUm"), 4),
    }


def _pitch_entry(p):
    if not p:
        return {"pitchUm": None, "binding": []}
    return {"pitchUm": _round(p.get("pitchUm"), 4),
            "binding": [str(t) for t in (p.get("binding") or [])][:5]}


def _front_entry(f):
    return {
        "id": f.get("id"),
        "outlineUm": [_round(v, 4) for v in (f.get("outlineUm") or [])],
        "ratioPct": _round(f.get("ratioPct"), 4),
        "legal": bool(f.get("legal")),
    }


def _marker_entry(m):
    return {
        "candidate": m.get("candidate"),
        "rule": m.get("rule"),
        "class": m.get("class"),
        "bbox": [_round(v, 3) for v in (m.get("bbox") or [])],
    }


def make_card(sites, levers, pitch_x, pitch_y, floor, front, open_markers):
    """Assemble a ``pixel.card/1`` dict, trimmed to at most 4 KB.

    Every argument is a plain list/dict of finished values (see the module
    docstring). Trimming, when the JSON would exceed 4 KB, drops the least
    load-bearing detail first: lever gradients, then the longest lists.
    """
    card = {
        "schema": SCHEMA,
        "sites": [_site_entry(s) for s in (sites or [])[:8]],
        "levers": [_lever_entry(l) for l in (levers or [])[:12]],
        "pitchBound": {"x": _pitch_entry(pitch_x), "y": _pitch_entry(pitch_y)},
        "floor": {"ctFf": _round((floor or {}).get("ctFf"), 6),
                  "note": str((floor or {}).get("note", "estimated"))},
        "front": [_front_entry(f) for f in (front or [])[:6]],
        "openMarkers": [_marker_entry(m) for m in (open_markers or [])[:8]],
    }

    # Keep under the 4 KB ceiling, shedding the most optional detail first.
    def size():
        return len(json.dumps(card, sort_keys=True).encode("utf-8"))

    if size() > _MAX_BYTES:
        for l in card["levers"]:
            l["gradientFfPerUm"] = {}
    trims = [
        ("openMarkers", 4), ("levers", 8), ("sites", 6),
        ("openMarkers", 2), ("levers", 4), ("sites", 4),
        ("front", 3), ("levers", 2), ("sites", 2), ("openMarkers", 0),
    ]
    i = 0
    while size() > _MAX_BYTES and i < len(trims):
        key, keep = trims[i]
        card[key] = card[key][:keep]
        i += 1
    return card


# --------------------------------------------------------------------------- #
# SVG
# --------------------------------------------------------------------------- #

def _poly_points(p, x0, y1):
    # SVG y grows downward: map (x, y) -> (x - x0, y1 - y) so the cell reads
    # the way it is drawn in the layout.
    return " ".join("%.3f,%.3f" % (float(v[0]) - x0, y1 - float(v[1])) for v in p)


def card_svg(case, lay, sites_top):
    """Render the unit cell as an SVG string (stdlib; no external renderer).

    Conductor layers are drawn in light translucent colours with a legend; the
    top coupling sites (``sites_top``, the same entries as the card) get a red
    bounding box. Returns the SVG document text.
    """
    (x0, y0), (x1, y1) = lay.outline(case)
    w = x1 - x0
    h = y1 - y0
    pad = max(w, h) * 0.04 + 0.5
    vb_w = w + 2 * pad
    vb_h = h + 2 * pad + max(2.0, h * 0.18)  # extra band at the bottom for the legend

    conductors = case.layers_with("conductor")
    colour = {}
    for k, name in enumerate(conductors):
        colour[name] = _PALETTE[k % len(_PALETTE)]

    parts = []
    parts.append(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="%.3f %.3f %.3f %.3f" '
        'font-family="sans-serif">' % (-pad, -pad, vb_w, vb_h))
    parts.append('<rect x="%.3f" y="%.3f" width="%.3f" height="%.3f" '
                 'fill="none" stroke="#333" stroke-width="%.3f"/>'
                 % (0.0, 0.0, w, h, max(w, h) * 0.004))

    for name in conductors:
        col = colour[name]
        for p in lay.polys.get(name, []):
            if len(p) < 3:
                continue
            parts.append('<polygon points="%s" fill="%s" fill-opacity="0.30" '
                         'stroke="%s" stroke-width="%.3f"/>'
                         % (_poly_points(p, x0, y1), col, col, max(w, h) * 0.002))

    for s in (sites_top or [])[:8]:
        bb = s.get("bbox")
        if not bb or len(bb) != 4:
            continue
        sx0, sy0, sx1, sy1 = [float(v) for v in bb]
        parts.append('<rect x="%.3f" y="%.3f" width="%.3f" height="%.3f" '
                     'fill="none" stroke="#d6336c" stroke-width="%.3f"/>'
                     % (sx0 - x0, y1 - sy1, max(sx1 - sx0, 1e-3),
                        max(sy1 - sy0, 1e-3), max(w, h) * 0.006))

    # Legend along the bottom band.
    fs = max(0.6, max(w, h) * 0.03)
    ly = h + pad + fs
    lx = 0.0
    for name in conductors:
        parts.append('<rect x="%.3f" y="%.3f" width="%.3f" height="%.3f" '
                     'fill="%s" fill-opacity="0.5"/>'
                     % (lx, ly - fs * 0.8, fs, fs, colour[name]))
        parts.append('<text x="%.3f" y="%.3f" font-size="%.3f" fill="#222">%s</text>'
                     % (lx + fs * 1.2, ly, fs, name))
        lx += fs * (1.4 + 0.65 * len(name))
    parts.append('</svg>')
    return "".join(parts)
