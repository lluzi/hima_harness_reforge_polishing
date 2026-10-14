"""The ``pixel-receipt`` Reader: typed values from one candidate's receipt.

:func:`reader_values` reads a ``pixel.receipt/1`` file and **re-parses every tool
report it names** (Argus ``.sum`` per deck and tile, the Calibre LVS report,
``RCEResult.sp`` and the geometry record), re-verifying each by sha256. It emits
one typed value per row of ``SPEC.md`` Semantics for ``pixel-receipt``; a value no
report states is ``null`` with an ``unknownReason`` (never a zero standing in for
an unread number). ``estimated`` and ``geometry`` provenance is honoured: the
out-of-marker Cs share is read from the geometry record, marked estimated.

What it reads from ``readiness`` (the case-readiness dict; Task 6 writes it):

``readiness["goal"]``
    The resolved goal, exactly as :func:`pixelopt.goal.resolve` returns it:
    ``values`` (``load_allowance_pct``, ``cst_ceiling_ff``, ... as numbers),
    ``ratioDefinition`` (``"narrow"`` | ``"broad"``), ``ratioNets`` (the judged
    aggressor list), ``transmittanceBasis`` (``"tiled"`` | ``"own"``) and
    ``extraCsOverlap`` (``"count"`` | ``"exclude"``).
``readiness["manifest"]``
    The raw ``pixel.case-manifest/1`` dict. Read: ``nets`` (``storageNode``,
    ``storageNet``), ``ratioDefinitions`` (``narrow`` / ``broad`` net lists),
    ``couplingLimits`` (``pair``, ``maxFf``), ``loadLimitedLines``, ``cst``
    (``tolerancePct``) and ``interactRules`` (ids that may be stripped).
``readiness["options"]``
    ``{"decks": {"authority": sha, "reference": sha}, "lvsDeck": sha,
    "schematic": sha, "extraction": {<set>: sha}}`` — asserted against the
    receipt's recorded options; any mismatch is a receipt error.
``readiness["original"]``
    ``{"loads": {line: fF}, "cstDeviceFf": fF}`` — the original's load totals and
    storage-capacitor device value, for the load-increase and undeclared-change
    values.

The geometry record (``geometry.json``) is an input the judge names as the
``geometry`` report; it carries ``outlineUm``, ``channelsChanged``,
``interactViolations``, ``tTiledPct`` / ``tOwnPct``, ``oledAreaUm2``,
``pdlSymmetryMin``, ``cstDeviceFf``, an optional ``csOutsideMarkerFf`` estimate
and an optional ``declaredChanges``.
"""
from __future__ import annotations

import os

from . import core, reports
from .core import PixelError

__all__ = ["reader_values"]

_UNCONN = "RCE_UNCONN"


def _pair_key(a, b):
    return "|".join(sorted([a, b]))


def _num(x):
    if isinstance(x, bool):
        return None
    if isinstance(x, (int, float)):
        return x
    return None


def reader_values(receipt_path, workspace, readiness):
    """Return the list of typed ``pixel-receipt`` values for one candidate."""
    receipt = core.read_json(receipt_path)
    workspace = os.path.abspath(workspace)
    mode = receipt.get("mode", "full")

    goal = (readiness or {}).get("goal", {}) or {}
    gvalues = goal.get("values", {}) or {}
    manifest = (readiness or {}).get("manifest", {}) or {}
    nets = manifest.get("nets", {}) or {}
    original = (readiness or {}).get("original", {}) or {}
    ropts = (readiness or {}).get("options", {}) or {}

    out = []
    errors = []  # one string per counted receipt error

    def add(type_, unit, value, reason=None):
        row = {"type": type_, "unit": unit, "value": value}
        if value is None:
            row["unknownReason"] = reason or "not stated"
        out.append(row)

    # ---- resolve and verify every listed report ------------------------- #
    state = {}
    for r in receipt.get("reports", []):
        key = (r.get("kind"), r.get("deck"), r.get("tile"))
        abspath = os.path.join(workspace, r.get("path", ""))
        exists = os.path.exists(abspath)
        sha_ok = True
        if exists and r.get("sha256") is not None:
            if core.sha256_file(abspath) != r["sha256"]:
                sha_ok = False
                errors.append("sha256 mismatch: %s" % r.get("path"))
        if not exists:
            # A listed report whose file is gone is a receipt error.
            errors.append("missing report: %s" % r.get("path"))
        state[key] = {"abspath": abspath, "exists": exists, "sha_ok": sha_ok, "engine": r.get("engine")}

    def report(kind, deck=None, tile=None):
        return state.get((kind, deck, tile))

    # ---- option assertions against case readiness ----------------------- #
    opts = receipt.get("options", {}) or {}
    if opts.get("dbPrecision") is not True:
        errors.append("db precision not asserted yes")
    rdecks = ropts.get("decks", {}) or {}
    odecks = opts.get("decks", {}) or {}
    for name in ("authority", "reference"):
        if name in rdecks and odecks.get(name) != rdecks.get(name):
            errors.append("deck '%s' sha mismatch" % name)
    if mode == "full":
        if "lvsDeck" in ropts and opts.get("lvsDeck") != ropts.get("lvsDeck"):
            errors.append("lvs deck sha mismatch")
        if "schematic" in ropts and opts.get("schematic") != ropts.get("schematic"):
            errors.append("schematic sha mismatch")
        rext = ropts.get("extraction", {}) or {}
        oext = opts.get("extraction", {}) or {}
        for name, sha in rext.items():
            if oext.get(name) != sha:
                errors.append("extraction '%s' sha mismatch" % name)
        if receipt.get("freshLibrary") is not True:
            errors.append("library not freshly made for the candidate")
    # A stripped deck rule with no geometry check of the same id is a refusal.
    allowed = set()
    for entry in manifest.get("interactRules", []) or []:
        if isinstance(entry, dict) and "id" in entry:
            allowed.add(entry["id"])
    for rec in (opts.get("ruleRecords", {}) or {}).values():
        for rid in (rec.get("stripped", []) if isinstance(rec, dict) else []):
            if rid not in allowed:
                errors.append("stripped rule '%s' has no geometry check" % rid)

    # ---- geometry record ------------------------------------------------- #
    geom = None
    geom_reason = None
    gst = report("geometry")
    if gst is None:
        errors.append("geometry report absent")
        geom_reason = "no geometry record"
    elif not gst["exists"]:
        geom_reason = "no geometry record"
    else:
        try:
            geom = core.read_json(gst["abspath"])
        except PixelError:
            errors.append("geometry record unreadable")
            geom_reason = "geometry record unreadable"

    def g(key):
        if isinstance(geom, dict):
            return geom.get(key)
        return None

    # ---- DRC per deck and tile ------------------------------------------ #
    for deck in ("authority", "reference"):
        for tile in ("1x1", "2x2", "3x3"):
            type_ = "pixel_drc_%s_%s" % (deck, tile)
            st = report("drc", deck, tile)
            if st is None:
                errors.append("drc %s %s report absent" % (deck, tile))
                add(type_, "count", None, "no summary file")
            elif not st["exists"]:
                add(type_, "count", None, "no summary file")
            else:
                try:
                    add(type_, "count", reports.argus_summary(st["abspath"])["total"])
                except PixelError:
                    errors.append("drc %s %s summary unreadable" % (deck, tile))
                    add(type_, "count", None, "summary unreadable")

    # ---- LVS ------------------------------------------------------------- #
    if mode != "full":
        add("pixel_lvs_correct", "flag", None, "mode drc")
    else:
        st = report("lvs")
        if st is None:
            errors.append("lvs report absent")
            add("pixel_lvs_correct", "flag", None, "no lvs report")
        elif not st["exists"]:
            add("pixel_lvs_correct", "flag", None, "no lvs report")
        else:
            try:
                rep = reports.lvs_report(st["abspath"], st.get("engine") or "calibre")
                add("pixel_lvs_correct", "flag", 1 if rep["correct"] else 0)
            except PixelError:
                errors.append("lvs report unreadable")
                add("pixel_lvs_correct", "flag", None, "lvs report unreadable")

    # ---- extraction capacitances ---------------------------------------- #
    caps = None
    caps_reason = None
    if mode != "full":
        caps_reason = "mode drc"
    else:
        st = report("rce")
        if st is None:
            errors.append("rce report absent")
            caps_reason = "no extraction result"
        elif not st["exists"]:
            caps_reason = "no extraction result"
        else:
            try:
                parsed = reports.rce_caps(st["abspath"])
            except PixelError:
                parsed = {}
            if not parsed:
                errors.append("extraction result empty")
                caps_reason = "empty extraction result"
            else:
                caps = parsed

    storage_node = nets.get("storageNode")
    storage_net = nets.get("storageNet")

    # Cs and its out-of-marker share.
    cs_outside = _num(g("csOutsideMarkerFf"))
    if cs_outside is not None:
        add("pixel_cs_outside_marker_ff", "ff", cs_outside)
    else:
        add("pixel_cs_outside_marker_ff", "ff", None,
            geom_reason or "no out-of-marker estimate in geometry")

    cs_full = None
    if caps is not None and storage_node and storage_net:
        cs_full = caps.get(_pair_key(storage_node, storage_net))

    cs_ff = None
    cs_reason = caps_reason
    extra = goal.get("extraCsOverlap", "count")
    if caps is None:
        cs_reason = caps_reason
    elif cs_full is None:
        cs_reason = "no storage coupling extracted"
    elif extra == "exclude":
        if cs_outside is None:
            cs_reason = "exclude needs an out-of-marker estimate"
        else:
            cs_ff = cs_full - cs_outside
    else:
        cs_ff = cs_full
    add("pixel_cs_ff", "ff", cs_ff, cs_reason)

    def ct_of(net_list):
        total = 0.0
        for a in net_list or []:
            total += caps.get(_pair_key(storage_node, a), 0.0)
        return total

    ratio_defs = manifest.get("ratioDefinitions", {}) or {}
    ct = {}
    if caps is not None and storage_node:
        for name in ("narrow", "broad"):
            ct[name] = ct_of(ratio_defs.get(name, []))

    for name in ("narrow", "broad"):
        type_ = "pixel_ratio_%s_pct" % name
        if caps is None or storage_node is None:
            add(type_, "pct", None, caps_reason or "no extraction result")
        elif cs_ff is None or cs_ff <= 0:
            add(type_, "pct", None, cs_reason or "no storage capacitance")
        else:
            add(type_, "pct", ct[name] / cs_ff * 100.0)

    judged_def = goal.get("ratioDefinition", "broad")
    # pixel_ratio_judged_pct
    if caps is None or storage_node is None:
        add("pixel_ratio_judged_pct", "pct", None, caps_reason or "no extraction result")
        add("pixel_ct_judged_ff", "ff", None, caps_reason or "no extraction result")
    else:
        judged_ct = ct_of(goal.get("ratioNets") or ratio_defs.get(judged_def, []))
        add("pixel_ct_judged_ff", "ff", judged_ct)
        if cs_ff is None or cs_ff <= 0:
            add("pixel_ratio_judged_pct", "pct", None, cs_reason or "no storage capacitance")
        else:
            add("pixel_ratio_judged_pct", "pct", judged_ct / cs_ff * 100.0)

    # ---- coupling limits ------------------------------------------------- #
    if caps is None:
        add("pixel_coupling_over_limit_count", "count", None,
            caps_reason or "no extraction result")
    else:
        over = 0
        for lim in manifest.get("couplingLimits", []) or []:
            pair = lim.get("pair", [])
            if len(pair) == 2:
                v = caps.get(_pair_key(pair[0], pair[1]))
                if v is not None and v > lim.get("maxFf", float("inf")):
                    over += 1
        add("pixel_coupling_over_limit_count", "count", over)

    # ---- load totals ----------------------------------------------------- #
    lines = manifest.get("loadLimitedLines", []) or []
    orig_loads = original.get("loads", {}) or {}
    allowance = _num(gvalues.get("load_allowance_pct"))
    if caps is None:
        add("pixel_load_increase_max_pct", "pct", None, caps_reason or "no extraction result")
        add("pixel_load_over_limit_count", "count", None, caps_reason or "no extraction result")
    else:
        incs = []
        over = 0
        for line in lines:
            total = 0.0
            for k, v in caps.items():
                parts = k.split("|")
                if line in parts:
                    other = parts[0] if parts[1] == line else parts[1]
                    if not other.startswith(_UNCONN) and not line.startswith(_UNCONN):
                        total += v
            o = _num(orig_loads.get(line))
            if o:
                inc = (total - o) / o * 100.0
                incs.append(inc)
                if allowance is not None and inc > allowance:
                    over += 1
        if incs:
            add("pixel_load_increase_max_pct", "pct", max(incs))
            add("pixel_load_over_limit_count", "count", over)
        else:
            add("pixel_load_increase_max_pct", "pct", None, "no original load totals")
            add("pixel_load_over_limit_count", "count", None, "no original load totals")

    # ---- geometry-sourced values ---------------------------------------- #
    ol = g("outlineUm")
    w = ol[0] if isinstance(ol, (list, tuple)) and len(ol) > 0 else None
    h = ol[1] if isinstance(ol, (list, tuple)) and len(ol) > 1 else None
    add("pixel_outline_w_um", "um", _num(w), geom_reason or "no outline")
    add("pixel_outline_h_um", "um", _num(h), geom_reason or "no outline")

    channels = g("channelsChanged")
    add("pixel_channels_changed", "count", _num(channels), geom_reason or "no geometry")

    iv = g("interactViolations")
    if isinstance(iv, dict):
        add("pixel_interact_violations", "count", sum(int(x) for x in iv.values()))
    elif isinstance(iv, (int, float)) and not isinstance(iv, bool):
        add("pixel_interact_violations", "count", int(iv))
    else:
        add("pixel_interact_violations", "count", None, geom_reason or "no geometry")

    add("pixel_cst_device_ff", "ff", _num(g("cstDeviceFf")), geom_reason or "no geometry")

    t_tiled = _num(g("tTiledPct"))
    t_own = _num(g("tOwnPct"))
    add("pixel_t_tiled_pct", "pct", t_tiled, geom_reason or "no geometry")
    add("pixel_t_own_pct", "pct", t_own, geom_reason or "no geometry")
    basis = goal.get("transmittanceBasis", "tiled")
    t_judged = t_tiled if basis == "tiled" else t_own
    add("pixel_t_judged_pct", "pct", t_judged, geom_reason or "no geometry")

    add("pixel_oled_area_um2", "um2", _num(g("oledAreaUm2")), geom_reason or "no geometry")

    pdl = g("pdlSymmetryMin")
    add("pixel_pdl_symmetry_min", "ratio", _num(pdl),
        geom_reason or "no emission opening")

    # ---- undeclared changes --------------------------------------------- #
    if geom is None:
        add("pixel_undeclared_change_count", "count", None, geom_reason or "no geometry")
    else:
        count = int(_num(channels) or 0)
        cst_dev = _num(g("cstDeviceFf"))
        orig_cst = _num(original.get("cstDeviceFf"))
        tol = _num((manifest.get("cst", {}) or {}).get("tolerancePct")) or 0.0
        declared = receipt.get("declaredChanges", {}) or {}
        declared_cst = _num(declared.get("cstFf"))
        ceiling = _num(gvalues.get("cst_ceiling_ff"))
        if cst_dev is not None and orig_cst:
            if abs(cst_dev - orig_cst) > orig_cst * tol / 100.0 and declared_cst is None:
                count += 1
        if declared_cst is not None and (ceiling is None or declared_cst > ceiling):
            count += 1
        add("pixel_undeclared_change_count", "count", count)

    # ---- the error tally (emitted first for the Reader) ----------------- #
    out.insert(0, {"type": "pixel_receipt_error_count", "unit": "count",
                   "value": len(errors)})
    return out
