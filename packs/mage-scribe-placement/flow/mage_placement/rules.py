"""Reader for MAGE rule-file (`rule.tcl`) item facts and frame geometry.

A rule file is a long sequence of vendor Tcl commands. Two shapes matter
here:

- `smFlow -addItem <name> -parent <parent> -itemType <T>` opens an item and
  records its `itemType` (`SLFIT`, `SLFIX`, `GROUP`, `FRAME`, `SHOT`, ...).
- `smSLFit <name> ...` / `smSLFix <name> ...` is one long logical command
  (often spread across several physical lines joined with a trailing
  backslash continuation)
  that sets facts on an already-opened item: `-setBlock`/`-setCluster`
  (block binding), `-setProp` (turnable/priority), `-setScribe`
  (included/excluded scribe lines), `-setZone` (scribe-zone placement,
  kept verbatim as `zoneRaw` — zone *semantics* are deferred, see
  `qualified` below), `-setGrid` (placement grid), `-setSpace` (default
  spacing), and `-setNum`/`-setNumMin`/`-setNumMax` (how many instances the
  rule asks for).

`-setArea` and `-setExtScribe -min` on the `smShot` item, together with the
single `smBlockMgr -bbox` in the pblock file, give the frame geometry
(`frame_from_rule`): overall shot size, uniform external-scribe width, die
size, and the die count (`cols`/`rows`) that must divide the shot evenly.

`qualified` (space/zone/padCross) is a fixed placeholder in this task: only
`space` is asserted `True`; the finer zone and pad-cross admissibility
semantics are an explicitly deferred decision (**D** in the plan) and are
not computed here.
"""
from __future__ import annotations

import re

from . import core


# A command token that opens a new top-level directive within an
# `smSLFit`/`smSLFix` logical line. Tokens not in this set (while a
# directive is open) are arguments of the current directive.
_TOP_FLAGS = {
    "-setBlock", "-setCluster", "-setProp", "-setScribe", "-setZone",
    "-setGrid", "-setSpace", "-setNum", "-setNumMin", "-setNumMax",
    "-setFixed", "-setOffset", "-setPadCross", "-setJXF", "-setPrintOut",
    "-setByChipCell", "-PDFbyBlockType", "-setAutoRefine", "-setMerge",
}

_TOKEN_RE = re.compile(r"\{[^{}]*\}|\"[^\"]*\"|\S+")

_ADD_ITEM_RE = re.compile(r"smFlow\s+-addItem\s+(\S+)\s+-parent\s+(\S+)\s+-itemType\s+(\S+)")

_AREA_RE = re.compile(r"-setArea\s+\{([^}]*)\}")
_EXT_SCRIBE_MIN_RE = re.compile(r"-setExtScribe\s+-min\s+\{([^}]*)\}")
_BBOX_RE = re.compile(r"-bbox\s+\(([^)]*)\)")


def _join_continuations(text):
    """Join every backslash-continued physical line into its logical line."""
    return re.sub(r"\\\s*\n\s*", " ", text)


def _tokenize(line):
    return [tok.strip("{}\"") for tok in _TOKEN_RE.findall(line)]


def _logical_lines(text):
    for line in _join_continuations(text).splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            yield line


def _split_directives(tokens):
    """Group `tokens` (after the item name) into `{flag: [args]}` by `_TOP_FLAGS`."""
    directives = {}
    current = None
    for tok in tokens:
        if tok in _TOP_FLAGS:
            current = tok
            directives.setdefault(current, [])
        elif current is not None:
            directives[current].append(tok)
    return directives


def _minor_pairs(args):
    """`['-a', '1', '-b', '2']` -> `{'-a': '1', '-b': '2'}`; ignores stray values.

    Values are matched purely by preceding flag name, so option order never
    matters. Used both for the minor flags inside an `smSLFit`/`smSLFix`
    directive and for a whole `smBlockMgr` option list.
    """
    pairs = {}
    i = 0
    while i < len(args) - 1:
        if args[i].startswith("-"):
            pairs[args[i]] = args[i + 1]
            i += 2
        else:
            i += 1
    return pairs


def read_rule_facts(rule_text, dbu_per_um):
    """Per rule-item facts, keyed by item name.

    Each value has the `ruleFacts` shape from the frozen `mage.layout-snapshot/2`
    interface: `itemType`, `blockType`, `scribeInc`, `scribeExc`, `turnable`,
    `priority`, `setNum`, `spaceDbu`, `padCross`, `zoneRaw`, `gridDbu`,
    `cluster`, `qualified`.
    """
    facts = {}
    item_types = {}
    for line in _logical_lines(rule_text):
        match = _ADD_ITEM_RE.search(line)
        if match:
            name, _parent, item_type = match.groups()
            item_types[name] = item_type
            continue
        tokens = _tokenize(line)
        if not tokens or tokens[0] not in ("smSLFit", "smSLFix"):
            continue
        name = tokens[1]
        entry = facts.setdefault(name, {
            "itemType": item_types.get(name),
            "blockType": None,
            "scribeInc": [],
            "scribeExc": [],
            "turnable": False,
            "priority": None,
            "setNum": [0, 0, 0],
            "spaceDbu": {"x": 0, "y": 0},
            "padCross": None,
            "zoneRaw": "",
            "gridDbu": [0, 0],
            "cluster": None,
            "qualified": {"space": True, "zone": False, "padCross": False},
        })
        entry["itemType"] = item_types.get(name, entry["itemType"])
        directives = _split_directives(tokens[2:])

        if "-setBlock" in directives:
            minor = _minor_pairs(directives["-setBlock"])
            entry["blockType"] = minor.get("-bindBlkType", entry["blockType"])
        if "-setCluster" in directives:
            args = directives["-setCluster"]
            entry["cluster"] = args[0] if args else entry["cluster"]
            minor = _minor_pairs(args)
            entry["blockType"] = minor.get("-bindBlkType", entry["blockType"])
        if "-setProp" in directives:
            minor = _minor_pairs(directives["-setProp"])
            if "-turnable" in minor:
                entry["turnable"] = bool(int(minor["-turnable"]))
            if "-pri" in minor:
                entry["priority"] = int(minor["-pri"])
        if "-setScribe" in directives:
            minor = _minor_pairs(directives["-setScribe"])
            if "-inc" in minor:
                entry["scribeInc"] = [minor["-inc"]]
            if "-exc" in minor:
                entry["scribeExc"] = [minor["-exc"]]
        if "-setZone" in directives:
            entry["zoneRaw"] = " ".join(directives["-setZone"])
        if "-setGrid" in directives:
            minor = _minor_pairs(directives["-setGrid"])
            grid_x = minor.get("-gridX")
            grid_y = minor.get("-gridY")
            if grid_x is not None and grid_y is not None:
                entry["gridDbu"] = [core.um_to_dbu(grid_x, dbu_per_um), core.um_to_dbu(grid_y, dbu_per_um)]
        if "-setSpace" in directives:
            minor = _minor_pairs(directives["-setSpace"])
            x_spc = minor.get("-xSpc")
            y_spc = minor.get("-ySpc")
            if x_spc is not None and y_spc is not None:
                entry["spaceDbu"] = {"x": core.um_to_dbu(x_spc, dbu_per_um), "y": core.um_to_dbu(y_spc, dbu_per_um)}
        if "-setNum" in directives and directives["-setNum"]:
            entry["setNum"][0] = int(directives["-setNum"][0])
        if "-setNumMin" in directives and directives["-setNumMin"]:
            entry["setNum"][1] = int(directives["-setNumMin"][0])
        if "-setNumMax" in directives and directives["-setNumMax"]:
            entry["setNum"][2] = int(directives["-setNumMax"][0])
        if "-setPadCross" in directives:
            args = directives["-setPadCross"]
            entry["padCross"] = bool(int(args[0])) if args else True
    return facts


def frame_from_rule(rule_text, pblock_text, dbu_per_um):
    """The snapshot `frame` block: shot size, uniform scribe, die size, die count."""
    joined = _join_continuations(rule_text)
    area_match = _AREA_RE.search(joined)
    if area_match is None:
        raise core.MageError("frame", "no -setArea found in rule text")
    area_values = area_match.group(1).split()
    if len(area_values) != 4:
        raise core.MageError("frame", f"-setArea expects 4 values, got {area_values!r}")
    x0, y0, x1, y1 = (core.um_to_dbu(v, dbu_per_um) for v in area_values)
    width_dbu, height_dbu = x1 - x0, y1 - y0

    scribe_match = _EXT_SCRIBE_MIN_RE.search(joined)
    if scribe_match is None:
        raise core.MageError("frame", "no -setExtScribe -min found in rule text")
    scribe_values = scribe_match.group(1).split()
    if len(scribe_values) != 4:
        raise core.MageError("frame", f"-setExtScribe -min expects 4 values, got {scribe_values!r}")
    scribe_dbu_values = [core.um_to_dbu(v, dbu_per_um) for v in scribe_values]
    if len(set(scribe_dbu_values)) != 1:
        raise core.MageError("frame", f"non-uniform external scribe: {scribe_values!r}")
    scribe_dbu = scribe_dbu_values[0]

    bbox_match = _BBOX_RE.search(pblock_text)
    if bbox_match is None:
        raise core.MageError("frame", "no -bbox found in pblock text")
    bbox_values = bbox_match.group(1).split(",")
    if len(bbox_values) != 4:
        raise core.MageError("frame", f"-bbox expects 4 values, got {bbox_values!r}")
    bx0, by0, bx1, by1 = (core.um_to_dbu(v.strip(), dbu_per_um) for v in bbox_values)
    die_width_dbu, die_height_dbu = bx1 - bx0, by1 - by0

    cols_num, cols_den = width_dbu - scribe_dbu, die_width_dbu + scribe_dbu
    rows_num, rows_den = height_dbu - scribe_dbu, die_height_dbu + scribe_dbu
    if cols_den <= 0 or cols_num % cols_den != 0:
        raise core.MageError("frame", f"(width - scribe) / (dieWidth + scribe) is not exact: {cols_num}/{cols_den}")
    if rows_den <= 0 or rows_num % rows_den != 0:
        raise core.MageError("frame", f"(height - scribe) / (dieHeight + scribe) is not exact: {rows_num}/{rows_den}")

    return {
        "widthDbu": width_dbu,
        "heightDbu": height_dbu,
        "scribeDbu": scribe_dbu,
        "cols": cols_num // cols_den,
        "rows": rows_num // rows_den,
        "dieWidthDbu": die_width_dbu,
        "dieHeightDbu": die_height_dbu,
    }


def _strip_bbox_wrapper(raw):
    """`{(0,0,1,1)}` / `"(0,0,1,1)"` / `(0,0,1,1)` -> `"0,0,1,1"`."""
    value = raw.strip("{}\"").strip()
    return value.strip("()")


def read_block_types(block_text, dbu_per_um):
    """`{base_name: {'blockType': str, 'sizeDbu': [w, h]}}` from `block.tcl`.

    Each `smBlockMgr -def <name> ...` line is read by option name, in
    whatever order the vendor writes them, with `-blkType`/`-bbox` (and any
    other option) bare, `"double-quoted"`, or `{brace-wrapped}`; `-bbox`'s
    own value may additionally be `{(l,b,r,t)}` or `"(l,b,r,t)"` as well as
    the bare `(l,b,r,t)`. Unrelated commands (`smBlockType`, `smBListMgr`,
    `smClusterMgr`, a plain `set ...`) are ignored. A `-def` line missing
    `-blkType` or `-bbox` raises `core.MageError('format', ...)` naming the
    block — this reader never guesses a block's type or size.
    """
    result = {}
    for line in _logical_lines(block_text):
        tokens = _tokenize(line)
        if not tokens or tokens[0] != "smBlockMgr":
            continue
        options = _minor_pairs(tokens[1:])
        name = options.get("-def")
        if name is None:
            continue
        blk_type, bbox_raw = options.get("-blkType"), options.get("-bbox")
        if blk_type is None or bbox_raw is None:
            raise core.MageError("format", f"block {name!r} is missing -blkType or -bbox")
        values = _strip_bbox_wrapper(bbox_raw).split(",")
        if len(values) != 4:
            raise core.MageError("format", f"block {name!r} -bbox expects 4 values, got {values!r}")
        x0, y0, x1, y1 = (core.um_to_dbu(v.strip(), dbu_per_um) for v in values)
        result[name] = {"blockType": blk_type, "sizeDbu": [x1 - x0, y1 - y0]}
    return result
