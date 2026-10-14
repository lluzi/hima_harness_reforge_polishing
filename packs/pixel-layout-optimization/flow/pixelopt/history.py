"""The judged-candidate history and its trend chart (stdlib only).

``state/history.jsonl`` holds one JSON line per judged candidate, in judged
order. :func:`append` writes a line, :func:`load` reads them all.
:func:`trend` normalises each judged measure to its Goal target (ratio /
target, outline / target, load increase / allowance, transmittance against
its window edge, authority 3x3 DRC count) per candidate and tracks the
best-so-far of the judged ratio over legal candidates; :func:`trend_svg`
renders that as a standalone SVG like the vendor report's trend chart.

This module imports nothing outside the standard library.
"""
from __future__ import annotations

import json
import os

from . import core

__all__ = ["append", "load", "trend", "trend_svg"]


def _path(workspace):
    return os.path.join(os.path.abspath(workspace), "state", "history.jsonl")


def append(workspace, entry):
    """Append one history line to ``state/history.jsonl``; return the entry.

    The line follows the Task 6 contract: ``id``, ``kind``, ``round``,
    ``base``, ``frontPoint``, ``exploratory``, ``operators``, ``values``
    (``type -> value|null``), ``unknown`` (``type -> reason``),
    ``receiptSha256``, ``predicted``, ``legal``, ``hardFailures``,
    ``goalRules`` and ``at``.
    """
    path = _path(workspace)
    directory = os.path.dirname(path)
    if not os.path.isdir(directory):
        os.makedirs(directory)
    line = json.dumps(entry, sort_keys=True)
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(line + "\n")
    return entry


def load(workspace):
    """Return every history line, in judged order (empty on absence)."""
    path = _path(workspace)
    rows = []
    if not os.path.exists(path):
        return rows
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except ValueError:
                continue
    return rows


def _num(x):
    if isinstance(x, bool):
        return None
    if isinstance(x, (int, float)):
        return float(x)
    return None


def _value(row, type_):
    values = row.get("values", {}) or {}
    return _num(values.get(type_))


# (metric key, label, receipt value type, Goal value key or None, lowerIsBetter)
_METRICS = [
    ("ratio", "ratio / target", "pixel_ratio_judged_pct", "ratio_target_pct", True),
    ("outline_w", "width / target", "pixel_outline_w_um", "outline_w_um", True),
    ("outline_h", "height / target", "pixel_outline_h_um", "outline_h_um", True),
    ("load", "load rise / allowance", "pixel_load_increase_max_pct", "load_allowance_pct", True),
    ("t", "transmittance / edge", "pixel_t_judged_pct", None, False),
    ("drc_authority_3x3", "authority 3x3 markers", "pixel_drc_authority_3x3", None, True),
]


def trend(history, goal):
    """Normalise every judged measure to its target, per candidate and best.

    Returns ``{"target": 1.0, "order": [ids], "metrics": {key: {...}}}``. Each
    metric carries ``label``, ``lowerIsBetter``, ``points`` (one per candidate,
    grouped by round) and ``best`` (the running best-so-far of the judged
    ratio over legal candidates; empty for the other metrics).
    """
    gvalues = (goal or {}).get("values", {}) or {}
    t_min = _num(gvalues.get("t_min_pct"))
    t_max = _num(gvalues.get("t_max_pct"))

    order = [row.get("id") for row in history]
    metrics = {}
    for key, label, type_, goal_key, lower in _METRICS:
        points = []
        for i, row in enumerate(history):
            raw = _value(row, type_)
            value = None
            if raw is not None:
                if key == "t":
                    edge = t_max if t_max else (t_min if t_min else None)
                    value = raw / edge if edge else raw
                elif goal_key is not None:
                    target = _num(gvalues.get(goal_key))
                    value = raw / target if target else raw
                else:
                    value = raw
            points.append({
                "order": i,
                "round": row.get("round"),
                "id": row.get("id"),
                "value": value,
                "legal": bool(row.get("legal")),
            })
        metrics[key] = {"label": label, "lowerIsBetter": lower, "points": points, "best": []}

    # Best-so-far of the judged ratio, over legal candidates only.
    best = []
    running = None
    for pt in metrics["ratio"]["points"]:
        if pt["legal"] and pt["value"] is not None:
            running = pt["value"] if running is None else min(running, pt["value"])
        best.append({"order": pt["order"], "value": running})
    metrics["ratio"]["best"] = best

    return {"target": 1.0, "order": order, "metrics": metrics}


# --------------------------------------------------------------------------- #
# SVG
# --------------------------------------------------------------------------- #

_W = 640
_H = 360
_PAD_L = 56
_PAD_R = 150
_PAD_T = 24
_PAD_B = 44
_COLORS = {
    "ratio": "#1f77b4",
    "outline_w": "#ff7f0e",
    "outline_h": "#2ca02c",
    "load": "#d62728",
    "t": "#9467bd",
    "drc_authority_3x3": "#8c564b",
}


def _esc(text):
    return (str(text).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def trend_svg(series):
    """Render :func:`trend` output as a standalone SVG string.

    x is the judged candidate order (points carry their round for grouping),
    y is the normalised value; a dashed line marks the 1.0 target, each
    candidate is a point per metric, and the judged ratio's best-so-far is a
    stepped line. A legend names every metric.
    """
    metrics = (series or {}).get("metrics", {}) or {}
    n = len(series.get("order", []) or [])
    plot_w = _W - _PAD_L - _PAD_R
    plot_h = _H - _PAD_T - _PAD_B

    # y range: cover every normalised value and the target line, clamped sane.
    vals = [1.0]
    for m in metrics.values():
        for pt in m["points"]:
            if pt["value"] is not None:
                vals.append(pt["value"])
        for b in m["best"]:
            if b["value"] is not None:
                vals.append(b["value"])
    ymax = max(vals) if vals else 1.0
    ymax = max(ymax * 1.1, 1.1)
    ymin = 0.0

    def x_of(order):
        if n <= 1:
            return _PAD_L + plot_w / 2.0
        return _PAD_L + plot_w * (order / float(n - 1))

    def y_of(value):
        if ymax == ymin:
            return _PAD_T + plot_h
        return _PAD_T + plot_h * (1.0 - (value - ymin) / (ymax - ymin))

    parts = []
    parts.append(
        '<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" '
        'viewBox="0 0 %d %d" font-family="sans-serif" font-size="11">' % (_W, _H, _W, _H))
    parts.append('<rect x="0" y="0" width="%d" height="%d" fill="#ffffff"/>' % (_W, _H))

    # axes
    parts.append('<line x1="%g" y1="%g" x2="%g" y2="%g" stroke="#333" stroke-width="1"/>'
                 % (_PAD_L, _PAD_T, _PAD_L, _PAD_T + plot_h))
    parts.append('<line x1="%g" y1="%g" x2="%g" y2="%g" stroke="#333" stroke-width="1"/>'
                 % (_PAD_L, _PAD_T + plot_h, _PAD_L + plot_w, _PAD_T + plot_h))

    # target line at y = 1.0
    ty = y_of(1.0)
    parts.append('<line x1="%g" y1="%g" x2="%g" y2="%g" stroke="#888" '
                 'stroke-width="1" stroke-dasharray="4 3"/>' % (_PAD_L, ty, _PAD_L + plot_w, ty))
    parts.append('<text x="%g" y="%g" fill="#888">target 1.0</text>' % (_PAD_L + 4, ty - 3))

    # y ticks (0, 1.0, ymax)
    for tick in (0.0, 1.0, ymax):
        yy = y_of(tick)
        parts.append('<text x="%g" y="%g" fill="#333" text-anchor="end">%.2f</text>'
                     % (_PAD_L - 6, yy + 3, tick))

    # per-metric points
    for key, m in metrics.items():
        color = _COLORS.get(key, "#333")
        for pt in m["points"]:
            if pt["value"] is None:
                continue
            parts.append('<circle cx="%g" cy="%g" r="3" fill="%s" fill-opacity="0.85"/>'
                         % (x_of(pt["order"]), y_of(pt["value"]), color))

    # best-so-far step line for the judged ratio
    best = metrics.get("ratio", {}).get("best", [])
    pts = [(x_of(b["order"]), y_of(b["value"])) for b in best if b["value"] is not None]
    if len(pts) >= 2:
        step = []
        px, py = pts[0]
        step.append("%g,%g" % (px, py))
        for x, y in pts[1:]:
            step.append("%g,%g" % (x, py))
            step.append("%g,%g" % (x, y))
            py = y
        parts.append('<polyline fill="none" stroke="%s" stroke-width="2" points="%s"/>'
                     % (_COLORS["ratio"], " ".join(step)))

    # x label
    parts.append('<text x="%g" y="%g" fill="#333" text-anchor="middle">judged candidate order</text>'
                 % (_PAD_L + plot_w / 2.0, _H - 10))

    # legend
    lx = _PAD_L + plot_w + 14
    ly = _PAD_T + 6
    for key, m in metrics.items():
        color = _COLORS.get(key, "#333")
        parts.append('<rect x="%g" y="%g" width="10" height="10" fill="%s"/>' % (lx, ly - 9, color))
        parts.append('<text x="%g" y="%g" fill="#333">%s</text>' % (lx + 14, ly, _esc(m["label"])))
        ly += 18
    parts.append('<line x1="%g" y1="%g" x2="%g" y2="%g" stroke="%s" stroke-width="2"/>'
                 % (lx, ly - 4, lx + 10, ly - 4, _COLORS["ratio"]))
    parts.append('<text x="%g" y="%g" fill="#333">ratio best-so-far</text>' % (lx + 14, ly))

    parts.append('</svg>')
    return "".join(parts)
