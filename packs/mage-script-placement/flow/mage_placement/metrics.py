"""Placement metrics computed from `mage.layout-snapshot/2` bodies (and from
MAGE's own native verify-report text).

Forked verbatim from packs/mage-scribe-placement 0.2.0 (2026-10-12).

Five functions, each returning a plain JSON-able dict:

- `drops(snapshot)` — count/length/class of structures actually dropped by
  the PLA (`pending` entries with a non-`None` `placedFlag`); rule-derived
  synthetic shortfalls (`placedFlag: None`, from `snapshot.build_snapshot`'s
  `pending_from_rules=True` path on a `start` snapshot) are reported
  separately under `ruleShortfallCount` and never mixed into `count`.
- `target_distances(snapshot, limit_um)` — along-/cross-lane distance from
  each bound target's CT point to its Fit's placed bbox centre. Along axis
  follows the Fit's own lane (`H` -> x, `V` -> y); a Fit with `lane: null`
  falls back to the wider-dimension rule (wide box -> along = x). A target
  with no bound Fit is `unplaced` and excluded from `maxUm`.
- `order_deviation(snapshot)` — reproduces the customer `run.tcl:check_dev`
  exactly: per partition (`TB`, `LR`, `IN`), compare the CSV request order
  of `groupName` against the placed order (sorted by along-lane centre;
  `TB`/`IN` by x, `LR` by y), matching duplicate names by occurrence index.
  Also reports `maxLr`/`maxTb`, the per-side-pair maxima (`LR-left`/
  `LR-right` and `TB-bottom`/`TB-top` respectively), each `None` whenever
  either of its two sides is unknown.
- `displacement(start_snapshot, snapshot)` — Fit-by-id box movement from the
  frozen start, independent of `target_distances` (which measures distance
  to the *target*, not to the start). Also reports `priority`, the same
  movement restricted to Group-placed (priority) Fits and matched by id or
  by Group (see `_priority_displacement`), so a priority Fit's renamed id
  still counts as moved rather than as added/removed.
- `native_rows(verify_files)` — instance counts from MAGE's own native
  verify reports, one of the three fixed checks (OVERLAP, SPACE, BOUNDARY);
  a missing or unreadable file, or one without the canonical instance-count
  header, reports `None` for that type (and for the grand `total`), never a
  bare `0`.

Units: every distance is produced through `_half_um`, an exact-or-refuse
doubled-coordinate conversion (a box's bbox centre can land on a half-DBU
boundary when its two edges have odd parity; see `_half_um`'s docstring).
`core.dbu_to_um` is used directly wherever the quantity is already a whole
DBU count (e.g. `drops`' summed long-side length, `displacement`'s summed
total — box coordinates are always whole DBU, so two of them differenced,
not centred, stay whole).
"""
from __future__ import annotations

import re
from decimal import Decimal, localcontext
from fractions import Fraction
from pathlib import Path

from . import core


NATIVE_TYPES = ["OVERLAP", "SPACE", "BOUNDARY"]

# The canonical first line the native driver writes to each verify report:
# `# mage-verify/1 type=<T> command=<cmd> instances=<N>`. The instance count
# is MAGE's own, sliced from the round's stdout; `native_rows` reads it and
# nothing else from the file.
_VERIFY_HEADER_RE = re.compile(
    r"^# mage-verify/1 type=\S+ command=\S+ instances=(\d+)\s*$"
)


def _half_um(doubled_dbu, dbu_per_um):
    """Exact micrometre string for `doubled_dbu / 2` DBU (both non-negative).

    `doubled_dbu` is twice a DBU distance (e.g. `(l + r) - 2 * ctDbu[0]`):
    always an integer, but not always even, since a box's two edges `l`/`r`
    can have odd combined parity, putting its centre on a half-DBU
    boundary. Dividing by `2 * dbu_per_um` as an exact `Fraction` (rather
    than rounding at the DBU stage) keeps that case representable whenever
    its reduced denominator's only prime factors are 2 and 5 (i.e. the
    micrometre value terminates in decimal); otherwise raises
    `MageError('units', ...)` rather than silently rounding.
    """
    frac = Fraction(abs(doubled_dbu), 2 * dbu_per_um)
    remainder = frac.denominator
    for prime in (2, 5):
        while remainder % prime == 0:
            remainder //= prime
    if remainder != 1:
        raise core.MageError(
            "units",
            f"{doubled_dbu}/2 dbu at {dbu_per_um} dbu/um is not exactly representable in micrometres",
        )
    with localcontext() as ctx:
        ctx.prec = 60
        value = Decimal(frac.numerator) / Decimal(frac.denominator)
    text = format(value, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text


def _signed_half_um(doubled_dbu, dbu_per_um):
    magnitude = _half_um(doubled_dbu, dbu_per_um)
    return f"-{magnitude}" if doubled_dbu < 0 and magnitude != "0" else magnitude


def _drop_class(items, dbu_per_um):
    total_length_dbu = 0
    ids = []
    for item in items:
        total_length_dbu += max(item["sizeDbu"])
        ids.append(item["id"])
    return {
        "count": len(items),
        "lengthUm": core.dbu_to_um(total_length_dbu, dbu_per_um),
        "ids": ids,
    }


def drops(snapshot):
    """`{'count', 'lengthUm', 'byBlockType', 'ids', 'ruleShortfallCount',
    'ordinary', 'grouped'}`.

    `count`/`lengthUm`/`byBlockType`/`ids` cover `pending` entries whose
    `placedFlag` is not `None` (actual PLA drops, in snapshot order).
    `ruleShortfallCount` is the count of rule-derived synthetic pending
    copies (`placedFlag: None`) — never added to `count`.

    `ordinary` and `grouped` split that same drop set by `inGroup`: a
    dropped pending entry with a non-empty `inGroup` is a Group-placed
    (priority) mark and counts as `grouped`; an empty `inGroup` (the
    common case) counts as `ordinary`. `ordinary.count + grouped.count
    == count` and likewise for `lengthUm`, always. The external
    benchmark's comparison objective against any baseline/reference
    method is ordinary dropped length — a priority mark being dropped is
    already reported separately (`priority-all-placed`) and is never
    folded into the ordinary comparison.
    """
    dbu_per_um = snapshot["dbuPerUm"]
    dropped = [p for p in snapshot["pending"] if p.get("placedFlag") is not None]
    shortfalls = [p for p in snapshot["pending"] if p.get("placedFlag") is None]

    by_block_type = {}
    total_length_dbu = 0
    ids = []
    for item in dropped:
        block_type = item.get("blockType") or "unknown"
        by_block_type[block_type] = by_block_type.get(block_type, 0) + 1
        total_length_dbu += max(item["sizeDbu"])
        ids.append(item["id"])

    ordinary_items = [p for p in dropped if not p.get("inGroup")]
    grouped_items = [p for p in dropped if p.get("inGroup")]

    return {
        "count": len(dropped),
        "lengthUm": core.dbu_to_um(total_length_dbu, dbu_per_um),
        "byBlockType": by_block_type,
        "ids": ids,
        "ruleShortfallCount": len(shortfalls),
        "ordinary": _drop_class(ordinary_items, dbu_per_um),
        "grouped": _drop_class(grouped_items, dbu_per_um),
    }


def target_distances(snapshot, limit_um):
    """`{'overLimitCount', 'maxUm', 'perTarget', 'unplaced', 'unbound',
    'droppedTargets', 'laneUnknown', 'unknownReason'}`.

    `perTarget` covers every target with a bound Fit: `alongUm`/`crossUm`
    are non-negative exact micrometre distances. A target with no bound
    Fit splits two ways (N5): one whose Fit is among the export's dropped
    instances is a *known drop*, listed under `droppedTargets` and excluded
    without making any fact unknown (it is already counted by
    `priorityUnplaced`); one whose Fit appears nowhere (`fitId` falsy, or the
    id resolves to neither a placed nor a dropped instance) is listed under
    `unplaced` (also exposed as `unbound`). Both are excluded from `perTarget`.
    A Fit with `lane: null` contributes its id to `laneUnknown` and uses
    the wider-dimension fallback (wide box -> along = x, else along = y).

    C4: an unbound target makes both the over-limit count and the max
    distance *unknown* (`None`), never `0` — a renamed or vanished Fit
    must never read as "zero marks over the limit" or "zero distance".
    `overLimitCount` is `None` whenever any target is unbound; `maxUm` is
    `None` whenever any target is unbound or there is no bound target at
    all. `unknownReason` is a human string whenever either is `None`,
    else `None`. (A dropped mark's inventory is separately conserved by
    the Reader's start-vs-candidate inventory check, which refuses a mark
    that vanished entirely rather than merely being dropped.)
    """
    dbu_per_um = snapshot["dbuPerUm"]
    fits_by_id = {f["id"]: f for f in snapshot["fits"]}
    dropped_ids = {p["id"] for p in snapshot.get("pending", [])}
    limit = Decimal(str(limit_um))

    per_target = []
    unplaced = []
    dropped_targets = []
    lane_unknown = []
    for target in snapshot["targets"]:
        fit_id = target.get("fitId")
        fit = fits_by_id.get(fit_id) if fit_id else None
        if fit is None:
            # N5: a target whose bound Fit is a *known drop* (its id is in the
            # export's dropped instances) is reported under `droppedTargets`
            # and excluded; it does NOT make the whole round's target facts
            # unknown (that mark is already counted by priorityUnplaced). Only
            # a target whose Fit appears NOWHERE -- neither placed nor dropped,
            # or never bound -- is `unplaced` (truly unknown).
            if fit_id and fit_id in dropped_ids:
                dropped_targets.append(target)
            else:
                unplaced.append(target)
            continue

        l, b, r, t = fit["boxDbu"]
        ct_x, ct_y = target["ctDbu"]
        lane = fit.get("lane")
        if lane is not None and lane["axis"] == "H":
            along_doubled, cross_doubled = (l + r) - 2 * ct_x, (b + t) - 2 * ct_y
        elif lane is not None and lane["axis"] == "V":
            along_doubled, cross_doubled = (b + t) - 2 * ct_y, (l + r) - 2 * ct_x
        else:
            lane_unknown.append(fit_id)
            if (r - l) > (t - b):
                along_doubled, cross_doubled = (l + r) - 2 * ct_x, (b + t) - 2 * ct_y
            else:
                along_doubled, cross_doubled = (b + t) - 2 * ct_y, (l + r) - 2 * ct_x

        per_target.append({
            "row": target["row"], "fitId": fit_id,
            "alongUm": _half_um(along_doubled, dbu_per_um),
            "crossUm": _half_um(cross_doubled, dbu_per_um),
        })

    over_limit = [p for p in per_target if Decimal(p["alongUm"]) > limit]
    max_entry = max(per_target, key=lambda p: Decimal(p["alongUm"]), default=None)

    unknown_reason = None
    if unplaced:
        over_limit_count = None
        max_um = None
        unknown_reason = (
            f"{len(unplaced)} target(s) have no bound Fit; "
            "target-distance facts are unknown rather than 0"
        )
    elif max_entry is None:
        over_limit_count = 0
        max_um = None
        unknown_reason = "no bound target to measure a distance from"
    else:
        over_limit_count = len(over_limit)
        max_um = max_entry["alongUm"]

    return {
        "overLimitCount": over_limit_count,
        "maxUm": max_um,
        "perTarget": per_target,
        "unplaced": unplaced,
        "unbound": unplaced,
        "droppedTargets": dropped_targets,
        "laneUnknown": lane_unknown,
        "unknownReason": unknown_reason,
    }


def _placed_centre_doubled(fit, axis):
    l, b, r, t = fit["boxDbu"]
    return (l + r) if axis == "x" else (b + t)


_SIDES = ("TB-bottom", "TB-top", "LR-left", "LR-right")
_SIDE_AXIS = {"TB-bottom": "x", "TB-top": "x", "LR-left": "y", "LR-right": "y"}
_SIDE_DESCENDING = {"TB-bottom": False, "TB-top": False, "LR-left": True, "LR-right": True}
ORDER_DEVIATION_FLAGS = {"LR": 3, "TB": 2}


def _side_of(frame, target):
    """`TB-bottom`/`TB-top`/`LR-left`/`LR-right`/`None`, per the customer
    `run.tcl` side split. Membership in `TB` vs `LR` (vs `IN`, never
    sided) comes from the existing `partition` field; a `TB` target's
    side is the sign of its CT y relative to the Frame's vertical centre
    (`< -> bottom`, `>= -> top`); an `LR` target's side is CT x relative
    to the horizontal centre (`< -> left`, `>= -> right`). Compared as
    `2 * ctDbu[axis]` against `frame['heightDbu']`/`['widthDbu']` to stay
    exact integer arithmetic (no Decimal needed for a yes/no side pick).
    """
    if target["partition"] == "TB":
        return "TB-bottom" if 2 * target["ctDbu"][1] < frame["heightDbu"] else "TB-top"
    if target["partition"] == "LR":
        return "LR-left" if 2 * target["ctDbu"][0] < frame["widthDbu"] else "LR-right"
    return None


def order_deviation(snapshot):
    """Reproduce the customer `run.tcl:check_dev` exactly, per side.

    Only `TB` (split into `TB-bottom`/`TB-top`) and `LR` (split into
    `LR-left`/`LR-right`) are checked — `IN` never is, and reports `None`
    in `byPartition`. `max` is the maximum of the four checked sides
    (`-1` when every one of them is empty, the customer script's own
    initial value). `maxLr` is the maximum of `LR-left`/`LR-right` alone
    (`None` if either is `None`); `maxTb` is the same for
    `TB-bottom`/`TB-top` — each axis's unknown-ness is independent of the
    other's, so one side being unbound makes only that axis's max `None`,
    never both.

    For each side: `list2` ("requested") is every target's `groupName` in
    that side — bound or not — sorted by its **requested** CT coordinate
    along that side's axis (`TB` by x, `LR` by y; `LR` descending, `TB`
    ascending, per the customer's own convention — note this direction
    choice cannot itself change any `dev` value, since reversing both
    `list1` and `list2` the same way preserves every pairwise index
    difference; only the *axis* choice, x vs y, is observable). `list1`
    ("placed") is only the *bound* subset's `groupName`, sorted the same
    way by its **placed** bbox-centre coordinate. An unbound target
    contributes no slot to `list1` and its name goes straight to
    `missing`.

    Matching is by occurrence index and is **positional, not
    identity-aware**, exactly like the customer procedure: walking
    `list1` left to right, the k-th time a name is seen there (k counted
    per name, from 0) is matched against the k-th occurrence of that same
    name in `list2`; `dev = |i - j|`, maxed per side. A `list1` occurrence
    with no k-th counterpart in `list2` (should not happen when `list2`
    truly is a superset, but guarded) also goes to `missing` rather than
    silently skipped. `flags` carries the customer script's own "bad"
    thresholds (`dev >= flags['TB']` / `dev >= flags['LR']`) as data, not
    a judgement this function makes itself.
    """
    frame = snapshot["frame"]
    fits_by_id = {f["id"]: f for f in snapshot["fits"]}
    dropped_ids = {p["id"] for p in snapshot.get("pending", [])}
    missing = []
    dropped_targets = []
    by_side = {}

    for side in _SIDES:
        axis = _SIDE_AXIS[side]
        descending = _SIDE_DESCENDING[side]
        all_rows = [t for t in snapshot["targets"] if _side_of(frame, t) == side]
        # N5: a target whose bound Fit is a known drop is excluded from this
        # side entirely (reported in `droppedTargets`), never counted in
        # list1/list2/missing and never making the side unknown -- a single
        # dropped priority mark therefore keeps the side's order known.
        side_dropped = [
            t for t in all_rows
            if t.get("fitId") and t["fitId"] in dropped_ids and t["fitId"] not in fits_by_id
        ]
        dropped_targets.extend(side_dropped)
        rows = [t for t in all_rows if t not in side_dropped]
        if not rows:
            by_side[side] = -1
            continue

        def requested_key(t, axis=axis):
            return t["ctDbu"][0] if axis == "x" else t["ctDbu"][1]

        requested_sorted = sorted(rows, key=lambda t: (requested_key(t), t["row"]), reverse=descending)
        list2 = [t["groupName"] for t in requested_sorted]

        bound = [t for t in rows if t.get("fitId") and t["fitId"] in fits_by_id]
        missing.extend(t["groupName"] for t in rows if t not in bound)

        if not bound:
            # C4: a side that has requested targets but no placed (bound)
            # Fit at all has no order to measure -- it reads as *unknown*,
            # never 0. (The old code left `max_dev` at 0 for such a side.)
            by_side[side] = None
            continue

        def placed_key(t, axis=axis):
            return _placed_centre_doubled(fits_by_id[t["fitId"]], axis)

        placed_sorted = sorted(bound, key=lambda t: (placed_key(t), t["row"]), reverse=descending)
        list1 = [t["groupName"] for t in placed_sorted]

        positions_by_name = {}
        for index, name in enumerate(list2):
            positions_by_name.setdefault(name, []).append(index)

        occurrence_cursor = {}
        max_dev = 0
        for i, name in enumerate(list1):
            k = occurrence_cursor.get(name, 0)
            occurrence_cursor[name] = k + 1
            indices = positions_by_name.get(name, [])
            if k >= len(indices):
                missing.append(name)
                continue
            max_dev = max(max_dev, abs(i - indices[k]))
        by_side[side] = max_dev

    by_partition = dict(by_side)
    by_partition["IN"] = None
    unknown_sides = [side for side, value in by_side.items() if value is None]
    if unknown_sides:
        # Any checked side being unknown makes the overall max unknown,
        # never a number that silently ignored an unplaced side.
        max_value = None
        unknown_reason = "order deviation unknown on side(s): " + ", ".join(sorted(unknown_sides))
    else:
        max_value = max(by_side.values())
        unknown_reason = None

    def _axis_max(sides):
        values = [by_side[s] for s in sides]
        if any(v is None for v in values):
            return None
        return max(values)

    max_lr = _axis_max(("LR-left", "LR-right"))
    max_tb = _axis_max(("TB-bottom", "TB-top"))
    return {
        "max": max_value,
        "maxLr": max_lr,
        "maxTb": max_tb,
        "byPartition": by_partition,
        "missing": missing,
        "droppedTargets": dropped_targets,
        "flags": dict(ORDER_DEVIATION_FLAGS),
        "unknownReason": unknown_reason,
    }


def _single_in_group_fit(fits, group_label):
    members = [f for f in fits if f.get("inGroup") == group_label]
    return members[0] if len(members) == 1 else None


def _priority_displacement(start_snapshot, snapshot, dbu_per_um):
    """Movement of every start priority (in-group) Fit, matched by exact id,
    else by its Group when that Group holds exactly one in-group Fit on both
    sides; otherwise `unmatched` (identity-unknown: `maxUm` is None).
    `distanceUm` is |dx| + |dy| of the box centre."""
    current_by_id = {f["id"]: f for f in snapshot["fits"]}
    per_fit, unmatched = [], []
    total_doubled = max_doubled = 0
    matched = 0
    for start_fit in start_snapshot["fits"]:
        if not start_fit.get("inGroup"):
            continue
        current = current_by_id.get(start_fit["id"])
        if current is None:
            start_single = _single_in_group_fit(start_snapshot["fits"], start_fit["inGroup"])
            current_single = _single_in_group_fit(snapshot["fits"], start_fit["inGroup"])
            if start_single is not None and current_single is not None and start_single["id"] == start_fit["id"]:
                current = current_single
        if current is None:
            unmatched.append(start_fit["id"])
            continue
        matched += 1
        l0, b0, r0, t0 = start_fit["boxDbu"]
        l1, b1, r1, t1 = current["boxDbu"]
        dx_doubled, dy_doubled = (l1 + r1) - (l0 + r0), (b1 + t1) - (b0 + t0)
        if dx_doubled == 0 and dy_doubled == 0:
            continue
        distance_doubled = abs(dx_doubled) + abs(dy_doubled)
        per_fit.append({
            "id": current["id"], "startId": start_fit["id"],
            "dxUm": _signed_half_um(dx_doubled, dbu_per_um), "dyUm": _signed_half_um(dy_doubled, dbu_per_um),
            "distanceUm": _half_um(distance_doubled, dbu_per_um),
        })
        total_doubled += distance_doubled
        max_doubled = max(max_doubled, distance_doubled)
    return {
        "movedCount": len(per_fit),
        "maxUm": None if unmatched else _half_um(max_doubled, dbu_per_um),
        "totalUm": _half_um(total_doubled, dbu_per_um),
        "matched": matched,
        "unmatched": unmatched,
        "perFit": per_fit,
    }


def displacement(start_snapshot, snapshot):
    """`{'movedCount', 'totalUm', 'perFit', 'added', 'removed', 'priority'}`
    between two snapshots' `fits`, matched by `id`.

    `perFit` lists only moved fits (`boxDbu` differs), with each
    `dxUm`/`dyUm` the signed centre displacement. `totalUm` sums
    `|dxUm| + |dyUm|` over moved fits, converted once at the end to stay
    exact. Fits present in only one snapshot's `fits` list are `added`
    (only in `snapshot`) or `removed` (only in `start_snapshot`), never
    counted as moved.

    `priority` is a separate sub-report (see `_priority_displacement`)
    covering only the frozen start's Group-placed (priority) Fits,
    matched by id or, when a Fit has been renamed/resuffixed, by its
    Group holding exactly one in-group Fit on both sides; a Fit that
    cannot be matched either way is `unmatched` and makes `priority`'s
    own `maxUm` unknown (`None`), independent of the top-level
    `movedCount`/`totalUm`, which stay id-matched only.
    """
    dbu_per_um = snapshot["dbuPerUm"]
    start_by_id = {f["id"]: f for f in start_snapshot["fits"]}
    current_by_id = {f["id"]: f for f in snapshot["fits"]}

    per_fit = []
    total_doubled = 0
    for fit_id, start_fit in start_by_id.items():
        current_fit = current_by_id.get(fit_id)
        if current_fit is None:
            continue
        if current_fit["boxDbu"] == start_fit["boxDbu"]:
            continue
        l0, b0, r0, t0 = start_fit["boxDbu"]
        l1, b1, r1, t1 = current_fit["boxDbu"]
        dx_doubled, dy_doubled = (l1 + r1) - (l0 + r0), (b1 + t1) - (b0 + t0)
        per_fit.append({
            "id": fit_id,
            "dxUm": _signed_half_um(dx_doubled, dbu_per_um),
            "dyUm": _signed_half_um(dy_doubled, dbu_per_um),
        })
        total_doubled += abs(dx_doubled) + abs(dy_doubled)

    added = sorted(set(current_by_id) - set(start_by_id))
    removed = sorted(set(start_by_id) - set(current_by_id))
    priority = _priority_displacement(start_snapshot, snapshot, dbu_per_um)

    return {
        "movedCount": len(per_fit),
        "totalUm": _half_um(total_doubled, dbu_per_um),
        "perFit": per_fit,
        "added": added,
        "removed": removed,
        "priority": priority,
    }


def native_rows(verify_files):
    """`{'byType', 'total', 'unknown'}` instance counts over the three native
    checks (`OVERLAP`, `SPACE`, `BOUNDARY`).

    The count for a type is the integer MAGE itself reported, read from the
    first line of its `verify-<TYPE>.txt` report, which the native driver
    wrote as `# mage-verify/1 type=<T> command=<cmd> instances=<N>`. Any
    other first line (or a type missing from `verify_files`, or a file that
    cannot be read) reports `None` and is listed in `unknown`; `total` is
    `None` whenever any type is unknown, never a partial sum.
    """
    by_type = {}
    unknown_types = []
    for type_name in NATIVE_TYPES:
        path = verify_files.get(type_name)
        count = None
        if path:
            try:
                text = Path(path).read_text(encoding="utf-8")
            except OSError:
                text = None
            if text is not None:
                lines = text.splitlines()
                match = _VERIFY_HEADER_RE.match(lines[0]) if lines else None
                if match:
                    count = int(match.group(1))
        by_type[type_name] = count
        if count is None:
            unknown_types.append(type_name)

    total = None if unknown_types else sum(by_type.values())
    return {"byType": by_type, "total": total, "unknown": unknown_types}
