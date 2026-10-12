"""Placement metrics computed from `mage.layout-snapshot/2` bodies (and from
MAGE's own native verify-report text).

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
- `displacement(start_snapshot, snapshot)` — Fit-by-id box movement from the
  frozen start, independent of `target_distances` (which measures distance
  to the *target*, not to the start).
- `native_rows(verify_files)` — row counts from MAGE's own native verify
  reports, one of ten fixed types; a missing or unreadable file reports
  `None` for that type (and for the grand `total`), never a bare `0`.

Units: every distance is produced through `_half_um`, an exact-or-refuse
doubled-coordinate conversion (a box's bbox centre can land on a half-DBU
boundary when its two edges have odd parity; see `_half_um`'s docstring).
`core.dbu_to_um` is used directly wherever the quantity is already a whole
DBU count (e.g. `drops`' summed long-side length, `displacement`'s summed
total — box coordinates are always whole DBU, so two of them differenced,
not centred, stay whole).
"""
from __future__ import annotations

from decimal import Decimal, localcontext
from fractions import Fraction
from pathlib import Path

from . import core


NATIVE_TYPES = [
    "OVERLAP", "SPACE", "BOUNDARY", "CROSS", "OFFGRID",
    "DIECORNER", "PEPPER", "PADS", "LOCATION", "AUTOREFINE",
]


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


def drops(snapshot):
    """`{'count', 'lengthUm', 'byBlockType', 'ids', 'ruleShortfallCount'}`.

    `count`/`lengthUm`/`byBlockType`/`ids` cover `pending` entries whose
    `placedFlag` is not `None` (actual PLA drops, in snapshot order).
    `ruleShortfallCount` is the count of rule-derived synthetic pending
    copies (`placedFlag: None`) — never added to `count`.
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

    return {
        "count": len(dropped),
        "lengthUm": core.dbu_to_um(total_length_dbu, dbu_per_um),
        "byBlockType": by_block_type,
        "ids": ids,
        "ruleShortfallCount": len(shortfalls),
    }


def target_distances(snapshot, limit_um):
    """`{'overLimitCount', 'maxUm', 'perTarget', 'unplaced', 'laneUnknown'}`.

    `perTarget` covers every target with a bound Fit: `alongUm`/`crossUm`
    are non-negative exact micrometre distances. A target with no bound
    Fit (`fitId` falsy, or the id does not resolve — never expected, but
    checked) is listed whole under `unplaced` and excluded from `maxUm`.
    A Fit with `lane: null` contributes its id to `laneUnknown` and uses
    the wider-dimension fallback (wide box -> along = x, else along = y).
    """
    dbu_per_um = snapshot["dbuPerUm"]
    fits_by_id = {f["id"]: f for f in snapshot["fits"]}
    limit = Decimal(str(limit_um))

    per_target = []
    unplaced = []
    lane_unknown = []
    for target in snapshot["targets"]:
        fit_id = target.get("fitId")
        fit = fits_by_id.get(fit_id) if fit_id else None
        if fit is None:
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

    return {
        "overLimitCount": len(over_limit),
        "maxUm": max_entry["alongUm"] if max_entry is not None else "0",
        "perTarget": per_target,
        "unplaced": unplaced,
        "laneUnknown": lane_unknown,
    }


_PARTITION_AXIS = {"TB": "x", "LR": "y", "IN": "x"}


def _placed_centre_doubled(fit, axis):
    l, b, r, t = fit["boxDbu"]
    return (l + r) if axis == "x" else (b + t)


def order_deviation(snapshot):
    """Reproduce `run.tcl:check_dev` exactly over each of `TB`, `LR`, `IN`.

    `list1` is the **full** CSV-row-order `groupName` of every target in
    the partition, bound or not. `list2` is the `groupName` of only the
    *bound* subset, sorted by placed along-lane centre (ties by `row`) —
    an unbound target contributes no slot to `list2` at all; it is never
    "skipped past" within list1 either, it simply occupies a `list1`
    position with no counterpart.

    Matching is by occurrence index, exactly as the customer procedure
    does it, and is **positional, not identity-aware**: walking `list1`
    left to right, the k-th time a given name is seen (k counted per
    name, starting at 0) is matched against the k-th occurrence of that
    same name in `list2`. This means: (a) permuting which physical mark
    holds which placed position among two same-named occurrences never
    changes the deviation, because `list2` only ever records names, not
    which mark produced them; (b) when one of several same-named
    occurrences in `list1` is unbound, the remaining (fewer) same-named
    occurrences in `list2` still pair against `list1`'s occurrences in
    strict left-to-right order — an earlier `list1` occurrence can end up
    matched to a `list2` slot that was actually placed by a *later*
    occurrence's mark, and a `list1` occurrence beyond `list2`'s count
    for that name is left unmatched (contributes no deviation, but is not
    specially flagged either — only an unbound target's own name goes to
    `missing`).

    `dev` is `|i - j|` (positions in `list1`/`list2`), maxed over the
    partition. An empty partition reports `-1` (the customer script's own
    initial value). Every unbound target's `groupName` is collected under
    `missing`, independent of the occurrence-index matching above.
    """
    fits_by_id = {f["id"]: f for f in snapshot["fits"]}
    by_partition = {}
    missing = []

    for partition, axis in _PARTITION_AXIS.items():
        rows = [t for t in snapshot["targets"] if t["partition"] == partition]
        if not rows:
            by_partition[partition] = -1
            continue

        list1 = [t["groupName"] for t in rows]
        bound = [t for t in rows if t.get("fitId") and t["fitId"] in fits_by_id]
        missing.extend(t["groupName"] for t in rows if t not in bound)

        bound_sorted = sorted(
            bound, key=lambda t: (_placed_centre_doubled(fits_by_id[t["fitId"]], axis), t["row"])
        )
        list2 = [t["groupName"] for t in bound_sorted]

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
                continue
            max_dev = max(max_dev, abs(i - indices[k]))
        by_partition[partition] = max_dev

    return {"max": max(by_partition.values()), "byPartition": by_partition, "missing": missing}


def displacement(start_snapshot, snapshot):
    """`{'movedCount', 'totalUm', 'perFit', 'added', 'removed'}` between two
    snapshots' `fits`, matched by `id`.

    `perFit` lists only moved fits (`boxDbu` differs), with each
    `dxUm`/`dyUm` the signed centre displacement. `totalUm` sums
    `|dxUm| + |dyUm|` over moved fits, converted once at the end to stay
    exact. Fits present in only one snapshot's `fits` list are `added`
    (only in `snapshot`) or `removed` (only in `start_snapshot`), never
    counted as moved.
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

    return {
        "movedCount": len(per_fit),
        "totalUm": _half_um(total_doubled, dbu_per_um),
        "perFit": per_fit,
        "added": added,
        "removed": removed,
    }


def native_rows(verify_files):
    """`{'byType', 'total', 'unknown'}` row counts over the ten native types.

    A row is a non-empty, non-comment (`#`-prefixed, after stripping)
    line. A type missing from `verify_files`, or whose file cannot be
    read, reports `None` and is listed in `unknown`; `total` is `None`
    whenever any type is unknown, never a partial sum.
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
                count = sum(1 for line in text.splitlines() if line.strip() and not line.strip().startswith("#"))
        by_type[type_name] = count
        if count is None:
            unknown_types.append(type_name)

    total = None if unknown_types else sum(by_type.values())
    return {"byType": by_type, "total": total, "unknown": unknown_types}
