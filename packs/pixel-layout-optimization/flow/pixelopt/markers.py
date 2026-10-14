"""Argus DRC marker handling for the resident's ``markers`` subcommand (stdlib only).

This module runs on the Site host's ``python3`` (3.8+); it imports nothing
outside the standard library.

Three steps:

* ``parse_db(text)`` reads an Argus ``.db`` result file into a list of
  ``(rule, [[x, y], ...])`` in micrometres. The dialect (learned from the Site's
  own ``argus_drc.db``, never copied): a bare rule-id line (``Gate1.4``) names the
  rule for the markers that follow; a ``p <index> <npts>`` line starts one marker
  polygon whose next ``<npts>`` lines are integer ``x y`` database units
  (1000 units = 1 um).
* ``fold(marks, outline)`` folds the markers of the tiled copies back onto the
  unit cell (so a 3x3 run's three copies of one violation become one), then
  dedupes by rule plus rounded bounding box.
* ``classify(marks, table, start_marks, binding_tags)`` labels each folded marker
  with the class the repair playbook (section 6) acts on: ``model-gap``,
  ``exact-pair``, ``bounded-edit`` or ``binding-chain``.
"""
from __future__ import annotations

import math
import re

__all__ = ["parse_db", "fold", "classify"]

_RULE_RE = re.compile(r"^[A-Za-z][\w.]*$")
_P_RE = re.compile(r"^p\s+(\d+)\s+(\d+)")

# A folded marker whose bbox centre lies within this distance of a binding tag's
# location (or whose bbox overlaps the tag's bbox) is on the binding chain.
_NEAR_UM = 1.0


# --------------------------------------------------------------------------- #
# Parsing
# --------------------------------------------------------------------------- #

def parse_db(text):
    """Parse an Argus ``.db`` result file into ``[(rule, [[x, y], ...]), ...]``.

    Coordinates are micrometres (database integers divided by 1000). A marker
    with a malformed point line is skipped rather than raising, so a partial
    file still yields the markers it could read.
    """
    lines = text.splitlines()
    out = []
    rule = None
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        stripped = line.strip()
        if _RULE_RE.match(stripped):
            rule = stripped
            i += 1
            continue
        m = _P_RE.match(line)
        if m:
            count = int(m.group(2))
            pts = []
            ok = True
            for j in range(count):
                k = i + 1 + j
                if k >= n:
                    ok = False
                    break
                parts = lines[k].split()
                if len(parts) < 2:
                    ok = False
                    break
                try:
                    pts.append([int(parts[0]) / 1000.0, int(parts[1]) / 1000.0])
                except ValueError:
                    ok = False
                    break
            if ok and pts:
                out.append((rule, pts))
            i += 1 + count
            continue
        i += 1
    return out


# --------------------------------------------------------------------------- #
# Folding the tiled copies onto the unit cell
# --------------------------------------------------------------------------- #

def _bbox(pts):
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))


def fold(marks, outline):
    """Fold tiled copies of each marker onto the unit cell and dedupe.

    ``outline`` is ``((x0, y0), (x1, y1))`` of one cell. A marker is translated
    by the integer number of cell pitches between its centroid and the unit
    cell, so a violation repeated in every tile collapses to one copy. Duplicates
    (same rule and bounding box rounded to 0.01 um) are dropped, keeping first
    appearance order.
    """
    (x0, y0), (x1, y1) = outline
    w = x1 - x0
    h = y1 - y0
    seen = set()
    folded = []
    for rule, pts in marks:
        if w > 0:
            cx = sum(p[0] for p in pts) / len(pts)
            kx = math.floor((cx - x0) / w)
        else:
            kx = 0
        if h > 0:
            cy = sum(p[1] for p in pts) / len(pts)
            ky = math.floor((cy - y0) / h)
        else:
            ky = 0
        fp = [[p[0] - kx * w, p[1] - ky * h] for p in pts]
        bx = _bbox(fp)
        key = (rule, tuple(round(v, 2) for v in bx))
        if key in seen:
            continue
        seen.add(key)
        folded.append((rule, fp))
    return folded


# --------------------------------------------------------------------------- #
# Classification
# --------------------------------------------------------------------------- #

def _unmodelled_rules(table):
    """Rule ids the compaction table (or parsed deck) could not model."""
    out = set()
    for entry in (table or {}).get("unmodelled", []) or []:
        if isinstance(entry, str):
            out.add(entry.split(":", 1)[0].strip())
    return out


def _tag_locations(binding_tags):
    """Normalise binding tags to a list of (centre_xy, bbox_or_None)."""
    locs = []
    for tag in binding_tags or ():
        bbox = None
        center = None
        if isinstance(tag, dict):
            if isinstance(tag.get("bbox"), (list, tuple)) and len(tag["bbox"]) == 4:
                bbox = tuple(float(v) for v in tag["bbox"])
                center = ((bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0)
            elif isinstance(tag.get("loc"), (list, tuple)) and len(tag["loc"]) == 2:
                center = (float(tag["loc"][0]), float(tag["loc"][1]))
        elif isinstance(tag, (list, tuple)) and len(tag) == 2:
            center = (float(tag[0]), float(tag[1]))
        if center is not None:
            locs.append((center, bbox))
    return locs


def _bbox_overlap(a, b):
    return not (a[2] < b[0] or b[2] < a[0] or a[3] < b[1] or b[3] < a[1])


def _near_binding(bx, tag_locs):
    cx = (bx[0] + bx[2]) / 2.0
    cy = (bx[1] + bx[3]) / 2.0
    for center, tbbox in tag_locs:
        if tbbox is not None and _bbox_overlap(bx, tbbox):
            return True
        if math.hypot(cx - center[0], cy - center[1]) <= _NEAR_UM:
            return True
    return False


def _start_keys(start_marks):
    keys = set()
    for rule, pts in start_marks or []:
        keys.add((rule, tuple(round(v, 2) for v in _bbox(pts))))
    return keys


def classify(marks, table, start_marks, binding_tags=()):
    """Classify each folded marker into a repair class.

    * ``model-gap`` -- the rule family is one the compactor does not model
      (listed in ``table['unmodelled']``); no plan entry fixes it.
    * ``binding-chain`` -- the marker lies at a binding-chain location
      (``binding_tags``); the solve was infeasible there.
    * ``bounded-edit`` -- the place was already violated in the start layout (a
      pre-existing defect, never an ``exact-pair``); a bounded edit repairs it.
    * ``exact-pair`` -- a single place that was legal in the start layout and was
      broken by the move; add an exact pair constraint and re-solve.
    """
    unmodelled = _unmodelled_rules(table)
    tag_locs = _tag_locations(binding_tags)
    start = _start_keys(start_marks)
    out = []
    for rule, pts in marks:
        bx = _bbox(pts)
        key = (rule, tuple(round(v, 2) for v in bx))
        if rule in unmodelled:
            cls = "model-gap"
        elif _near_binding(bx, tag_locs):
            cls = "binding-chain"
        elif key in start:
            # already violated in the start layout: the move did not cause it,
            # so it is not an exact-pair; a bounded edit repairs it.
            cls = "bounded-edit"
        else:
            cls = "exact-pair"
        out.append({"rule": rule, "bbox": [round(v, 4) for v in bx], "class": cls})
    return out
