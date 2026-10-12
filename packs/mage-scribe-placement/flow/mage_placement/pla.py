"""Reader/writer for MAGE "PLA" placement files.

A PLA file is a small Tcl fragment: four `set <name> { ... }` tables
(`fixinsts`, `pinstGroupProperty`, `fitinsts`, `dropFitInsts`) each followed
by a vendor `foreach` block that replays the table through `smPInstMgr`. All
four tables are optional in a given file (a fresh `start.pla` has no drops
yet); a missing table parses to an empty list.

Coordinates are either plain micrometre decimals (the common case) or, when
the file begins with an `smPInstMgr -savePlaDBU <n>` line, plain integer
DBU. `read_pla()` always returns integer DBU internally (`core.um_to_dbu`
does the exact conversion); `write_pla()` can emit either representation.

`PlaDocument` (the dict shape returned by `read_pla` and accepted by
`write_pla`):

    {
      "units": "um" | "dbu", "dbuPerUm": int,
      "fixed":  [{"id", "base", "boxDbu": [l, b, r, t], "idTriple": [int, int, int]}],
      "groups": [{"groupItem", "pinstGroup", "targetPointDbu": [x, y], "vertSL": bool}],
      "fits":   [{"id", "base", "boxDbu": [l, b, r, t], "extraRot", "postfix", "inGroup"}],
      "drops":  [{"id", "base", "boxDbu": [l, b, r, t], "extraRot", "placedFlag": int,
                  "postfix", "inGroup"}],
    }

For `fits`/`drops`, the vendor `inst` field is always `"<base>.<base>"`
(confirmed against the P23 reference material: the fit instance name is
always the base name repeated around the dot, only the `pinstFit` id token
carries a distinguishing suffix) so it is reconstructed on write rather than
stored a second time. For `fixed`, the vendor `inst` field can carry a
corner suffix after the dot (e.g. `"P_X.P_X_TL"`) that is not derivable from
`base`, so the full token is kept verbatim as `id`.
"""
from __future__ import annotations

import re
import shlex

from . import core


_TABLE_NAMES = ("fixinsts", "pinstGroupProperty", "fitinsts", "dropFitInsts")

_SAVE_PLA_DBU_RE = re.compile(r"smPInstMgr\s+-savePlaDBU\s+(\S+)")
_TABLE_RE = re.compile(r"set\s+(" + "|".join(_TABLE_NAMES) + r")\s*\{([^}]*)\}")

FIXINSTS_FOREACH = (
    "foreach {inst id col row l b r t} $fixinsts {\n"
    "\tsmPInstMgr -addInstFix -inst $inst -id $id -col $col -row $row -umBox ($l,$b,$r,$t) -plaCheckSize\n"
    "}\n"
)

PINST_GROUP_FOREACH = (
    "foreach {groupItem pinstGroup targetPointLeft targetPointBottom vertSL} $pinstGroupProperty {\n"
    "\tsmPInstMgr -addGroup -pinstGroup $pinstGroup -groupItem $groupItem "
    "-targetPoint ($targetPointLeft,$targetPointBottom) -vertSL $vertSL\n"
    "}\n"
)

FITINSTS_FOREACH = (
    "foreach {inst l b r t pinstFitExtraRot pf pinstFit inGroup} $fitinsts {\n"
    '\tsmPInstMgr -addInstFit -inst $inst -umBox ($l,$b,$r,$t) -pinstFitExtraRot $pinstFitExtraRot '
    '-postfix "$pf" -pinstFit $pinstFit -inGroup "$inGroup" -plaCheckSize\n'
    "}\n"
)

DROP_FIT_INSTS_FOREACH = (
    "foreach {inst l b r t pinstFitExtraRot placed pf pinstFit inGroup} $dropFitInsts {\n"
    '\tsmPInstMgr -addDropInstFit -inst $inst -umBox ($l,$b,$r,$t) -pinstFitExtraRot $pinstFitExtraRot '
    '-placed $placed -postfix "$pf" -pinstFit $pinstFit -inGroup "$inGroup" -plaCheckSize\n'
    "}\n"
)


def _detect_units(text, dbu_per_um):
    match = _SAVE_PLA_DBU_RE.search(text)
    if match is None:
        return "um"
    token = match.group(1)
    try:
        saved = int(token)
    except ValueError as exc:
        raise core.MageError("units", f"non-integer -savePlaDBU value: {token!r}") from exc
    if saved != dbu_per_um:
        raise core.MageError("units", f"-savePlaDBU {saved} does not match case dbuPerUm {dbu_per_um}")
    return "dbu"


def _table_rows(text, table_name):
    rows = []
    for match in _TABLE_RE.finditer(text):
        if match.group(1) != table_name:
            continue
        for line in match.group(2).splitlines():
            line = line.strip()
            if not line:
                continue
            rows.append(shlex.split(line))
    return rows


def _pos_value(token, units, dbu_per_um):
    """A coordinate/length field: integer DBU directly, or exact um -> DBU."""
    if units == "dbu":
        try:
            return int(token)
        except ValueError as exc:
            raise core.MageError("units", f"non-integer DBU value: {token!r}") from exc
    return core.um_to_dbu(token, dbu_per_um)


def _refuse_duplicates(entries, key, where):
    seen = set()
    for entry in entries:
        value = entry[key]
        if value in seen:
            raise core.MageError("duplicate-id", f"duplicate {key} {value!r} in {where}")
        seen.add(value)


def _read_fixed(text, units, dbu_per_um):
    entries = []
    for tokens in _table_rows(text, "fixinsts"):
        if len(tokens) != 8:
            raise core.MageError("format", f"fixinsts row has {len(tokens)} fields, expected 8: {tokens!r}")
        inst, id_field, col_field, row_field, l, b, r, t = tokens
        entries.append({
            "id": inst,
            "base": inst.split(".", 1)[0],
            "boxDbu": [
                _pos_value(l, units, dbu_per_um),
                _pos_value(b, units, dbu_per_um),
                _pos_value(r, units, dbu_per_um),
                _pos_value(t, units, dbu_per_um),
            ],
            "idTriple": [int(id_field), int(col_field), int(row_field)],
        })
    _refuse_duplicates(entries, "id", "fixinsts")
    return entries


def _read_groups(text, units, dbu_per_um):
    entries = []
    for tokens in _table_rows(text, "pinstGroupProperty"):
        if len(tokens) != 5:
            raise core.MageError(
                "format", f"pinstGroupProperty row has {len(tokens)} fields, expected 5: {tokens!r}"
            )
        group_item, pinst_group, left, bottom, vert_sl = tokens
        entries.append({
            "groupItem": group_item,
            "pinstGroup": pinst_group,
            "targetPointDbu": [
                _pos_value(left, units, dbu_per_um),
                _pos_value(bottom, units, dbu_per_um),
            ],
            "vertSL": bool(int(vert_sl)),
        })
    _refuse_duplicates(entries, "pinstGroup", "pinstGroupProperty")
    return entries


def _read_fits(text, units, dbu_per_um):
    entries = []
    for tokens in _table_rows(text, "fitinsts"):
        if len(tokens) != 9:
            raise core.MageError("format", f"fitinsts row has {len(tokens)} fields, expected 9: {tokens!r}")
        inst, l, b, r, t, extra_rot, postfix, pinst_fit, in_group = tokens
        entries.append({
            "id": pinst_fit,
            "base": inst.split(".", 1)[0],
            "boxDbu": [
                _pos_value(l, units, dbu_per_um),
                _pos_value(b, units, dbu_per_um),
                _pos_value(r, units, dbu_per_um),
                _pos_value(t, units, dbu_per_um),
            ],
            "extraRot": extra_rot,
            "postfix": postfix,
            "inGroup": in_group,
        })
    _refuse_duplicates(entries, "id", "fitinsts")
    return entries


def _read_drops(text, units, dbu_per_um):
    entries = []
    for tokens in _table_rows(text, "dropFitInsts"):
        if len(tokens) != 10:
            raise core.MageError(
                "format", f"dropFitInsts row has {len(tokens)} fields, expected 10: {tokens!r}"
            )
        inst, l, b, r, t, extra_rot, placed, postfix, pinst_fit, in_group = tokens
        entries.append({
            "id": pinst_fit,
            "base": inst.split(".", 1)[0],
            "boxDbu": [
                _pos_value(l, units, dbu_per_um),
                _pos_value(b, units, dbu_per_um),
                _pos_value(r, units, dbu_per_um),
                _pos_value(t, units, dbu_per_um),
            ],
            "extraRot": extra_rot,
            "placedFlag": int(placed),
            "postfix": postfix,
            "inGroup": in_group,
        })
    _refuse_duplicates(entries, "id", "dropFitInsts")
    return entries


def read_pla(text, dbu_per_um):
    """Parse PLA text into a `PlaDocument`.

    Raises `core.MageError("units", ...)` when an `smPInstMgr -savePlaDBU`
    line disagrees with `dbu_per_um`, `core.MageError("format", ...)` on a
    table row with the wrong field count, and `core.MageError("duplicate-id",
    ...)` when a table's identity column repeats.
    """
    units = _detect_units(text, dbu_per_um)
    return {
        "units": units,
        "dbuPerUm": dbu_per_um,
        "fixed": _read_fixed(text, units, dbu_per_um),
        "groups": _read_groups(text, units, dbu_per_um),
        "fits": _read_fits(text, units, dbu_per_um),
        "drops": _read_drops(text, units, dbu_per_um),
    }


def _emit_value(value_dbu, units, dbu_per_um):
    return str(value_dbu) if units == "dbu" else core.dbu_to_um(value_dbu, dbu_per_um)


def _emit_fixed_rows(fixed, units, dbu_per_um):
    lines = []
    for entry in fixed:
        l, b, r, t = (_emit_value(v, units, dbu_per_um) for v in entry["boxDbu"])
        id_field, col_field, row_field = entry["idTriple"]
        lines.append(f"\t{entry['id']} {id_field} {col_field} {row_field} {l} {b} {r} {t}")
    return lines


def _emit_group_rows(groups, units, dbu_per_um):
    lines = []
    for entry in groups:
        x, y = (_emit_value(v, units, dbu_per_um) for v in entry["targetPointDbu"])
        vert_sl = 1 if entry["vertSL"] else 0
        lines.append(f"\t{entry['groupItem']} {entry['pinstGroup']} {x} {y} {vert_sl}")
    return lines


def _emit_fit_rows(fits, units, dbu_per_um):
    lines = []
    for entry in fits:
        l, b, r, t = (_emit_value(v, units, dbu_per_um) for v in entry["boxDbu"])
        inst = f"{entry['base']}.{entry['base']}"
        lines.append(
            f'\t{inst} {l} {b} {r} {t} {entry["extraRot"]} "{entry["postfix"]}" '
            f'{entry["id"]} "{entry["inGroup"]}"'
        )
    return lines


def _emit_drop_rows(drops, units, dbu_per_um):
    lines = []
    for entry in drops:
        l, b, r, t = (_emit_value(v, units, dbu_per_um) for v in entry["boxDbu"])
        inst = f"{entry['base']}.{entry['base']}"
        lines.append(
            f'\t{inst} {l} {b} {r} {t} {entry["extraRot"]} {entry["placedFlag"]} '
            f'"{entry["postfix"]}" {entry["id"]} "{entry["inGroup"]}"'
        )
    return lines


def write_pla(doc, dbu_per_um, units="um"):
    """Render a `PlaDocument` back to replayable PLA text.

    Writes a header comment, then `fixinsts`, `pinstGroupProperty`,
    `fitinsts`, and `dropFitInsts` (the last only when non-empty), each
    immediately followed by its vendor `foreach` replay block. With
    `units="dbu"` it also emits `smPInstMgr -savePlaDBU <dbu_per_um>` near
    the top and writes integer DBU instead of micrometre decimals. The
    result round-trips through `read_pla(..., dbu_per_um)` back to an
    equivalent document regardless of `units`.
    """
    parts = ["############# mage-scribe-placement generated PLA #############\n"]
    if units == "dbu":
        parts.append(f"smPInstMgr -savePlaDBU {dbu_per_um}\n")

    parts.append("############# For placed fix instances #############\n")
    parts.append("set fixinsts {\n" + "\n".join(_emit_fixed_rows(doc["fixed"], units, dbu_per_um)) + "\n}\n")
    parts.append(FIXINSTS_FOREACH)

    parts.append("############# For group instances #############\n")
    parts.append(
        "set pinstGroupProperty {\n" + "\n".join(_emit_group_rows(doc["groups"], units, dbu_per_um)) + "\n}\n"
    )
    parts.append(PINST_GROUP_FOREACH)

    parts.append("############# For placed fit instances #############\n")
    parts.append("set fitinsts {\n" + "\n".join(_emit_fit_rows(doc["fits"], units, dbu_per_um)) + "\n}\n")
    parts.append(FITINSTS_FOREACH)

    if doc["drops"]:
        parts.append("############# For dropped fit instances #############\n")
        parts.append(
            "set dropFitInsts {\n" + "\n".join(_emit_drop_rows(doc["drops"], units, dbu_per_um)) + "\n}\n"
        )
        parts.append(DROP_FIT_INSTS_FOREACH)

    return "\n".join(parts) + "\n"
