"""Scribe-lane model and periodic-image projection.

Forked verbatim from packs/mage-scribe-placement 0.2.0 (2026-10-12).

A frame tiles a `cols` x `rows` grid of dies, each separated by an external
scribe band of width `scribeDbu`. A *lane* is one scribe band: `H:k` is the
horizontal band between die-row `k-1` and die-row `k` (running the full
frame width), `V:k` the vertical band between die-column `k-1` and column
`k` (running the full frame height). Because the frame itself repeats
periodically across the full exposed field (one step per die + scribe),
`H:0` and `H:rows` are literally the same physical scribe line seen from
the two opposite exterior edges of one frame tile — `physical_lane` folds
the exterior track back to `0`.

`project()`'s periodic-image search (translate every box by -1/0/+1 frame
steps in each axis, keep whichever translated copies land in the query
lane's along/cross window) is a reimplementation, with attribution, of
`lane_view`'s image loop and `_intervals`' interval-merge in
`mage_smart_conflict_resolver/product/src/mage_assist/exchange.py`
(read-only prior art; not imported — this Pack is standard-library only
and works on plain dicts/box tuples, not that module's dataclasses).
"""
from __future__ import annotations


def lane_model(frame):
    """One entry per `H:0..rows` and `V:0..cols` scribe band."""
    die_w, die_h, scribe = frame["dieWidthDbu"], frame["dieHeightDbu"], frame["scribeDbu"]
    rows, cols = frame["rows"], frame["cols"]
    lanes = []
    for k in range(rows + 1):
        y0 = k * (die_h + scribe)
        lanes.append({
            "laneId": f"H:{k}", "axis": "H", "track": k,
            "alongRangeDbu": [0, frame["widthDbu"]],
            "crossRangeDbu": [y0, y0 + scribe],
            "physicalLane": physical_lane(frame, "H", k),
            "sharedExterior": k == 0 or k == rows,
        })
    for k in range(cols + 1):
        x0 = k * (die_w + scribe)
        lanes.append({
            "laneId": f"V:{k}", "axis": "V", "track": k,
            "alongRangeDbu": [0, frame["heightDbu"]],
            "crossRangeDbu": [x0, x0 + scribe],
            "physicalLane": physical_lane(frame, "V", k),
            "sharedExterior": k == 0 or k == cols,
        })
    return lanes


def physical_lane(frame, axis, track):
    """Exterior opposite lanes (track 0 and track rows/cols) fold to track 0."""
    limit = frame["rows"] if axis == "H" else frame["cols"]
    return f"{axis}:0" if track == limit else f"{axis}:{track}"


def _band(frame, axis, track):
    die = frame["dieHeightDbu"] if axis == "H" else frame["dieWidthDbu"]
    scribe = frame["scribeDbu"]
    start = track * (die + scribe)
    return start, start + scribe


def assign_lane(frame, box):
    """`{'axis', 'track'}` for the one scribe band fully containing `box`, or `None`."""
    l, b, r, t = box
    rows, cols = frame["rows"], frame["cols"]

    h_track = None
    for k in range(rows + 1):
        y0, y1 = _band(frame, "H", k)
        if y0 <= b and t <= y1:
            h_track = k
            break
    v_track = None
    for k in range(cols + 1):
        x0, x1 = _band(frame, "V", k)
        if x0 <= l and r <= x1:
            v_track = k
            break

    if h_track is not None and v_track is None:
        return {"axis": "H", "track": h_track}
    if v_track is not None and h_track is None:
        return {"axis": "V", "track": v_track}
    if h_track is not None and v_track is not None:
        width, height = r - l, t - b
        return {"axis": "H", "track": h_track} if width >= height else {"axis": "V", "track": v_track}
    return None


def _merge_intervals(blocked, low, high):
    """Merge `blocked` [start, end) pairs and return the free gaps in `[low, high)`."""
    merged = []
    for left, right in sorted(blocked):
        left, right = max(left, low), min(right, high)
        if left >= right:
            continue
        if merged and left <= merged[-1][1]:
            merged[-1][1] = max(right, merged[-1][1])
        else:
            merged.append([left, right])
    free, cursor = [], low
    for left, right in merged:
        if cursor < left:
            free.append([cursor, left])
        cursor = max(cursor, right)
    if cursor < high:
        free.append([cursor, high])
    return free


def project(frame, boxes, lane_id, along=None, cross=None):
    """Project `boxes` (`[[id, [l, b, r, t]], ...]`) onto lane `lane_id`.

    Every box is also tried translated by -1/0/+1 frame steps in x and y
    (the periodic images of the tiled frame); a translated copy is an
    occupant of the lane when it overlaps the query along/cross window in
    both dimensions.
    """
    lane = next((entry for entry in lane_model(frame) if entry["laneId"] == lane_id), None)
    if lane is None:
        raise ValueError(f"unknown lane {lane_id!r}")

    along_low, along_high = along if along is not None else lane["alongRangeDbu"]
    cross_low, cross_high = cross if cross is not None else lane["crossRangeDbu"]
    horizontal = lane["axis"] == "H"
    step_x, step_y = frame["widthDbu"] - frame["scribeDbu"], frame["heightDbu"] - frame["scribeDbu"]

    occupants = []
    for box_id, (l, b, r, t) in boxes:
        for sx in (-1, 0, 1):
            for sy in (-1, 0, 1):
                tl, tb, tr, tt = l + sx * step_x, b + sy * step_y, r + sx * step_x, t + sy * step_y
                along_box = (tl, tr) if horizontal else (tb, tt)
                cross_box = (tb, tt) if horizontal else (tl, tr)
                overlaps = (max(along_box[0], along_low) < min(along_box[1], along_high)
                            and max(cross_box[0], cross_low) < min(cross_box[1], cross_high))
                if not overlaps:
                    continue
                occupants.append({
                    "id": box_id, "sourceImage": [sx, sy],
                    "alongDbu": [along_box[0], along_box[1]],
                    "crossDbu": [cross_box[0], cross_box[1]],
                })
    occupants.sort(key=lambda o: (o["alongDbu"][0], o["id"]))

    free = _merge_intervals([tuple(o["alongDbu"]) for o in occupants], along_low, along_high)
    free_intervals = [{"alongDbu": [a, b], "lengthDbu": b - a} for a, b in free]
    return {
        "laneId": lane_id,
        "queryAlongDbu": [along_low, along_high],
        "queryCrossDbu": [cross_low, cross_high],
        "occupants": occupants,
        "freeIntervals": free_intervals,
        "largestFreeDbu": max((f["lengthDbu"] for f in free_intervals), default=0),
    }
