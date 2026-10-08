"""size_coverage_gaps: functions where the optimiser has no cell between two drive strengths.

Per variant (one facts file each, one corner), cells are grouped by function (their functional signature: same
pins, same truth table). Each cell's drive strength = the reference inverter's drive resistance / the cell's, both
read at 4x their own input capacitance at the inverter's fanout-of-4 slew. Within a ladder of at least six cells,
sorted by drive, a jump of at least 1.9x between two neighbours inside the range (not at its ends, and not between
two flavours of the same size) is a gap. d4 and d16 are each cell's delay at 4x and 16x its own input capacitance.

Usage (from flow/):
  python3 -m libinsight_analysis.rules.size_coverage_gaps --facts 9T-SVT=/corpus/svt_tt.json.gz \
      --facts 9T-LVT=/corpus/lvt_tt.json.gz --naming dnum --out size_coverage_gaps.json
"""
import argparse
import os
import sys
import time

if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from libinsight_analysis.rules import facts as F  # noqa: E402

RULE_ID = "size_coverage_gaps"
GAP = 1.9
MIN_CELLS = 6
SAME_SIZE = 1.3          # a neighbour under 1.3x the area is another flavour of the same size, not a step
MAX_ITEMS = 12


def ladder_cells(label, path, naming):
    """The comparable cells of one variant file: {signature: [cell]} with drive, area, leakage, d4, d16."""
    lib = F.load_facts(path)
    corner = F.corner(lib)
    libname = lib.get("name") or ""
    cells = F.read_cells(lib, naming, label)
    del lib
    inv = F.reference_inverter(cells)
    if inv is None:
        raise F.RuleError("%s has no usable inverter to measure drive against" % path)
    ref = F.fo4_point(cells, inv)
    r_inv = F.drive_resistance(cells[inv]["arcs"][0], ref["slew"], 4.0 * ref["cap"])
    groups = {}
    for name, rec in cells.items():
        sig = rec["sig"]
        if not sig or sig[0] != "comb" or not rec["arcs"] or not rec["area"]:
            continue
        arcs = F.metric_arcs(rec)
        d4 = F.cell_delay(arcs, rec["pins"], ref["slew"], 4.0)
        d16 = F.cell_delay(arcs, rec["pins"], ref["slew"], 16.0)
        if d4 is None:
            continue
        r_d = F.drive_resistance(d4[1], ref["slew"], d4[2])
        if not r_d or r_d <= 0 or not r_inv:
            continue
        groups.setdefault(sig, []).append({
            "name": name, "s": rec["label"], "drive_abs": r_inv / r_d, "area": rec["area"], "leak": rec["leak"],
            "d4": d4[0], "d16": d16[0] if d16 else None, "cls": rec["cls"], "vt": rec["vt"], "track": rec["track"]})
    return {"corner": corner, "groups": groups, "library": libname, "inv": cells[inv]["label"], "n": len(cells)}


def find_gap(ladder, gap=GAP):
    """(ratio, i) of the widest drive jump inside the ladder (sorted by drive), or None below `gap`."""
    best = None
    for i in range(1, len(ladder) - 2):
        a, b = ladder[i], ladder[i + 1]
        if b["area"] < SAME_SIZE * a["area"]:
            continue
        r = b["drive_abs"] / a["drive_abs"]
        if best is None or r > best[0]:
            best = (r, i)
    return best if best and best[0] >= gap else None


def _entry(e, d0):
    return {"name": e["name"], "s": e["s"], "drive": F.rnd(e["drive_abs"] / d0, 3), "area": F.rnd(e["area"], 4),
            "leak": F.rnd(e["leak"], 4), "d4": F.rnd(e["d4"], 3), "d16": F.rnd(e["d16"], 3)}


def run(inputs, gap=GAP, min_cells=MIN_CELLS, naming="generic", max_items=MAX_ITEMS, library=None):
    """inputs: [(variant label, facts path)], one file (one corner) per variant."""
    namer = naming if isinstance(naming, F.Naming) else F.Naming(naming)
    gaps, checked, variants, corners, libname, cell_total, invs = [], 0, [], [], None, 0, set()
    for label, path in inputs:
        if label in variants:
            raise F.RuleError("variant %s is given twice; this rule reads one corner per variant" % label)
        variants.append(label)
        d = ladder_cells(label, path, namer)
        corners.append(F.corner_words(d["corner"]))
        libname = libname or d["library"]
        cell_total += d["n"]
        invs.add(d["inv"])
        for sig, ladder in d["groups"].items():
            if len(ladder) < min_cells:
                continue
            checked += 1
            ladder.sort(key=lambda e: (e["drive_abs"], e["area"], e["name"]))
            found = find_gap(ladder, gap)
            if found:
                gaps.append({"v": label, "sig": sig, "cls": ladder[0]["cls"], "ratio": found[0], "i": found[1],
                             "L": ladder, "track": namer.variant(label)[0] or label,
                             "vt": namer.variant(label)[1] or "all"})
        del d
    shared = {}
    for g in gaps:
        shared.setdefault((g["sig"], g["track"]), set()).add(g["vt"])
    gaps.sort(key=lambda g: (-g["ratio"], g["v"], g["cls"]))
    items, seen = [], set()
    for g in gaps:
        key = (g["sig"], g["track"])
        if key in seen:
            continue
        seen.add(key)
        L, i = g["L"], g["i"]
        a, b = L[i], L[i + 1]
        d0 = L[0]["drive_abs"]
        miss_area = F.gm(a["area"], b["area"])
        pen_leak = (F.gm(1.0, b["leak"] / a["leak"]) - 1.0) * 100.0 if a["leak"] and b["leak"] else None
        weak = (a["d16"] / b["d16"] - 1.0) * 100.0 if a["d16"] and b["d16"] else None
        cells = [_entry(e, d0) for e in L]
        item = {"label": F.clip("%s · %s" % (g["cls"], g["v"]), 60), "cls": g["cls"], "v": g["v"],
                "ratio": F.rnd(g["ratio"], 3), "vts": len(shared[key]), "i": i, "cells": cells,
                "lo": dict(cells[i]), "hi": dict(cells[i + 1]),
                "miss": {"drive": F.rnd(F.gm(a["drive_abs"], b["drive_abs"]) / d0, 3), "area": F.rnd(miss_area, 4)},
                "pen_area": F.rnd((b["area"] / miss_area - 1.0) * 100.0, 1), "pen_leak": F.rnd(pen_leak, 1),
                "weak": F.rnd(weak, 1)}
        item["focus"] = F.clip(
            "%s in %s jumps from %s to %s, a ×%.2f drive step: the size above costs %s area over a size in between%s." % (
                g["cls"], g["v"], a["s"], b["s"], g["ratio"], F.pct(item["pen_area"], 0),
                ", and the size below is %s slower at 16× its own input capacitance" % F.pct(weak, 0)
                if weak is not None and weak >= 0.5 else ""),
            400)
        items.append(item)
        if len(items) >= max_items:
            break
    tracks, vts = [], []
    for v in variants:
        t, vt = namer.variant(v)
        t, vt = t or v, vt or "all"
        if t not in tracks:
            tracks.append(t)
        if vt not in vts:
            vts.append(vt)
    tracks.sort(key=lambda t: (float(t[:-1].replace("P", ".")) if t[:-1].replace("P", "").isdigit() else 1e9, t))
    present = set((namer.variant(v)[0] or v, namer.variant(v)[1] or "all") for v in variants)
    counts = [[sum(1 for g in gaps if g["track"] == t and g["vt"] == vt) if (t, vt) in present else None
               for vt in vts] for t in tracks]
    every = sum(1 for (sig, t), s in shared.items()
                if len(s) == len([1 for (tt, vv) in present if tt == t]) and len(s) > 1)
    widest = items[0] if items else None
    result = "%s in %s · %d repeat in every VT" % (F.count_words(len(gaps), "gap"),
                                                   F.count_words(checked, "function set"), every)
    rule = {
        "id": RULE_ID, "kind": "gaps", "title": "Size coverage gaps",
        "summary": "Functions where the optimiser has no cell between two drive strengths.",
        "result": F.clip(result, 120),
        "rule": F.clip("For each function and variant, sort every cell (all flavours) by drive strength, measured "
                       "at 4× its own input capacitance against the reference inverter. Flag a jump of at least "
                       "%g× between neighbouring cells inside the range." % gap, 400),
        "library": F.clip("%s · %d variants · %d corners · %s cells" % (
            library or libname or "Library", len(variants), len(set(corners)), "{:,}".format(cell_total)), 160),
        "facts": [["Function sets checked", checked], ["With a gap ≥ %g×" % gap, len(gaps)],
                  ["Same gap in every VT of a track", every],
                  ["Widest", "%s ×%.2f" % (widest["label"], widest["ratio"]) if widest else "none"],
                  ["Corner", F.clip(", ".join(sorted(set(corners))), 80)],
                  ["Drive strength", "reference inverter's drive resistance ÷ the cell's, at 4× own input capacitance"],
                  ["Reference inverter", F.clip(", ".join(sorted(invs)), 80)],
                  ["Delay columns", "ps at 4× and 16× each cell's own input capacitance"],
                  ["Leakage", "nW, mean over the cell's leakage states"]],
        "score": {"dimension": "ppa", "affected": len(gaps), "checked": checked, "weight": 4},
        "impact": [
            ["Area", F.clip("Where a ladder jumps ×%.2f, a path that needs a size in between gets the next size up: "
                            "up to %s area on that cell." % (widest["ratio"], F.pct(widest["pen_area"], 0))
                            if widest else "No drive gaps: every function has a size near every drive it needs.", 300)],
            ["Timing", "Or the optimiser keeps the size below, which is weaker than the path needs."],
            ["Power", "The next size up also brings more leakage and more input capacitance on the driving net."]],
        "todo": [
            {"who": "chip_designer", "text": "Expect over-sizing on the listed functions; check their area on "
                                             "critical paths."},
            {"who": "library_provider", "text": "Add the missing sizes in the roadmap file: suggested drive and area "
                                                "for each gap."},
            {"who": "cell_designer", "text": "Build each missing size by interpolating the device widths of the two "
                                             "neighbours."}],
        "hint": "Each square counts the functions with a drive gap for one track and VT; empty squares are "
                "variants not given.",
        "matrix": {"tracks": tracks, "vts": vts, "counts": counts},
        "items": items}
    return rule


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--facts", action="append", required=True, help="VARIANT=PATH, one corner per variant (repeat)")
    ap.add_argument("--gap", type=float, default=GAP, help="flag a drive jump of at least this factor (default 1.9)")
    ap.add_argument("--min-cells", type=int, default=MIN_CELLS)
    ap.add_argument("--naming", default="generic", help="naming profile: generic, dnum, or a JSON file")
    ap.add_argument("--max-items", type=int, default=MAX_ITEMS)
    ap.add_argument("--library", help="the library name for the page header")
    ap.add_argument("--out", default="-")
    args = ap.parse_args(argv)
    start = time.time()
    try:
        rule = run(F.parse_inputs(args.facts), args.gap, args.min_cells, args.naming, min(args.max_items, 400),
                   args.library)
    except F.RuleError as exc:
        sys.stderr.write("%s: %s\n" % (RULE_ID, exc))
        return 2
    F.write_rule(rule, args.out)
    sys.stderr.write("%s: %s in %.1f s\n" % (RULE_ID, rule["result"], time.time() - start))
    return 0


if __name__ == "__main__":
    sys.exit(main())
