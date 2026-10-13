"""Reader/binder for the customer target CSV and the generated request
order (`group_*_load.t`-shaped Tcl).

Forked verbatim from packs/mage-scribe-placement 0.2.0 (2026-10-12).

CT conversion. The customer's placement-request generator emits
`smPFlow -placeGroup -groupItem G -groupTargetPoint (x,y) -groupPlaceType CT`
where `(x, y) = LOC + Frame size / 2` (LOC is frame-centre-relative, CT is
frame-absolute). `read_targets` performs that same conversion into
`ctDbu`, converting the micrometre `LOC X`/`LOC Y` fields to DBU first so
the whole computation stays exact integer arithmetic.

Partition. `split_csv` (the customer's own `run.tcl` procedure, confirmed
against the read-only frame-case reference material) is: `abs(y - ymax) <= tol or
abs(y - ymin) <= tol -> TB`; otherwise `abs(x - xmax) <= tol or
abs(x - xmin) <= tol -> LR`; otherwise `IN`. `ymin`/`ymax`/`xmin`/`xmax`
are the min/max `LOC Y`/`LOC X` over the whole table; `tol` is
`partitionToleranceUm` (default `'2'`).

Binding. `bind_targets` joins a target row to its native occurrence
*only* through the exact Group target point (`ctDbu` == a Group's
`targetPointDbu`) — never by guessing a T-number or occurrence suffix —
then to that Group's one Fit via `inGroup`.
"""
from __future__ import annotations

import csv
import io
import re
from decimal import Decimal

from . import core


_PLACE_GROUP_RE = re.compile(
    r"-placeGroup\s+-groupItem\s+(\S+)\s+-groupTargetPoint\s+\(([^,]+),([^)]+)\)"
)


def read_targets(csv_text, frame, dbu_per_um, tolerance_um="2"):
    """Target-table rows with `ctDbu` and `partition` filled in.

    `csv_text` may carry a leading UTF-8 BOM (`utf-8-sig`), as the vendor
    file does; it is stripped before parsing. Column order is fixed:
    Group Name, Part/Cluster Name, Target, Part/Cluster Length(um), LOC X,
    LOC Y.
    """
    text = csv_text.lstrip("﻿")
    reader = csv.reader(io.StringIO(text))
    rows_raw = list(reader)
    if not rows_raw:
        return []
    data_rows = [r for r in rows_raw[1:] if r]

    half_width, half_height = frame["widthDbu"] // 2, frame["heightDbu"] // 2
    if frame["widthDbu"] % 2 or frame["heightDbu"] % 2:
        raise core.MageError("units", "frame width/height is not evenly divisible by 2")

    loc_x_values = [Decimal(r[4]) for r in data_rows]
    loc_y_values = [Decimal(r[5]) for r in data_rows]
    xmin, xmax = min(loc_x_values), max(loc_x_values)
    ymin, ymax = min(loc_y_values), max(loc_y_values)
    tol = Decimal(str(tolerance_um))

    rows = []
    for index, raw in enumerate(data_rows):
        group_name, part_name, target, length_um, loc_x_um, loc_y_um = raw
        x, y = Decimal(loc_x_um), Decimal(loc_y_um)
        ct_dbu = [
            core.um_to_dbu(loc_x_um, dbu_per_um) + half_width,
            core.um_to_dbu(loc_y_um, dbu_per_um) + half_height,
        ]
        if abs(y - ymax) <= tol or abs(y - ymin) <= tol:
            partition = "TB"
        elif abs(x - xmax) <= tol or abs(x - xmin) <= tol:
            partition = "LR"
        else:
            partition = "IN"
        rows.append({
            "row": index,
            "groupName": group_name,
            "partName": part_name,
            "target": target,
            "lengthUm": length_um,
            "locXUm": loc_x_um,
            "locYUm": loc_y_um,
            "ctDbu": ct_dbu,
            "partition": partition,
            "pinstGroup": None,
            "fitId": None,
        })
    return rows


def read_request_order(tcl_text):
    """`[[x_str, y_str], ...]` in the file's own `-placeGroup` command order."""
    return [[match.group(2), match.group(3)] for match in _PLACE_GROUP_RE.finditer(tcl_text)]


def bind_targets(targets, groups, fits):
    """Fill `pinstGroup`/`fitId` by exact `targetPointDbu` match.

    Raises `core.MageError('identity', ...)` when a target's `ctDbu` binds
    to zero or more than one Group, or the bound Group has anything other
    than exactly one Fit (`inGroup` == that Group's `pinstGroup`).
    """
    bound = []
    for target in targets:
        matches = [g for g in groups if g["targetPointDbu"] == target["ctDbu"]]
        if len(matches) != 1:
            raise core.MageError(
                "identity",
                f"target row {target['row']} binds to {len(matches)} groups at {target['ctDbu']!r}",
            )
        group = matches[0]
        group_fits = [f for f in fits if f["inGroup"] == group["pinstGroup"]]
        if len(group_fits) != 1:
            raise core.MageError(
                "identity",
                f"group {group['pinstGroup']!r} has {len(group_fits)} fits, expected exactly 1",
            )
        entry = dict(target)
        entry["pinstGroup"] = group["pinstGroup"]
        entry["fitId"] = group_fits[0]["id"]
        bound.append(entry)
    return bound
