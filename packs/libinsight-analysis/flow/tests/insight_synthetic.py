"""Deterministic synthetic insight rules, one per kind, for the page tests and the preview.

Every name and number here is made up (cell names like NAND2X2, design demo_top, library "Demo
library"); none comes from a real library or design. They are big enough to fill every chart: several
variants, flagged cells, a gap ladder, three paths of eight stages with four to eight equivalents per
stage, and a spike table with axes. One vmin item carries a design brief with a netlist location and
one carries a brief without (`where: null`).
"""
import math
import random

LIBRARY = "Demo library · 9 variants · 6 corners · 1,200 cells"
TRACKS = ("6T", "8T", "10T")
VTS = ("SVT", "HVT", "LVT")
VARIANTS = ["%s-%s" % (track, vt) for track in TRACKS for vt in VTS]
TEMPS = ["-20", "110"]
HI, MID, LO = 0.80, 0.75, 0.70


def _r(value, digits=2):
    return round(value, digits)


def _box(rng, centre, spread):
    p50 = centre
    p25, p75 = p50 - spread * 0.6, p50 + spread * 0.7
    p5, p95 = p50 - spread * 1.6, p50 + spread * 2.0
    mn, mx = p5 - spread * 0.5, p95 + spread * (1.5 + rng.random())
    return {"p5": _r(p5), "p25": _r(p25), "p50": _r(p50), "p75": _r(p75), "p95": _r(p95), "mn": _r(mn),
            "mx": _r(mx), "n": rng.randint(80, 160)}


def _ratio_box(rng, ratio, spread):
    box = _box(rng, ratio, spread)
    return dict((key, _r(value, 3) if key != "n" else value) for key, value in box.items())


def vmin_rule():
    rng = random.Random(11)
    classes = ["NOR3", "NAND4", "AOI22", "OAI21", "MUX2", "XOR2", "DFFR", "NOR2"]
    rows, fan, clsbox, items = [], {}, {}, []
    for index, variant in enumerate(VARIANTS):
        hvt = variant.endswith("HVT")
        centre = 1.5 + (2.5 if hvt else 0) + (1.0 if variant.startswith("6T") else 0)
        dots = sorted((_r(5 + rng.random() * (11 if hvt else 4), 1) for _ in range(6 + (14 if hvt else 3))),
                      reverse=True)
        rows.append({"v": variant, "b": _box(rng, centre, 1.2), "n": len(dots), "dots": dots})
        for temp in TEMPS:
            cold = temp == TEMPS[0]
            inv = [1.0, _r(1.10 + (0.04 if cold else 0), 3), _r(1.24 + (0.08 if cold else 0), 3)]
            boxes = [None, _ratio_box(rng, inv[1] * 1.02, 0.02), _ratio_box(rng, inv[2] * 1.03, 0.03)]
            fan["%s|%s" % (variant, temp)] = {"volts": [HI, MID, LO], "inv": inv, "boxes": boxes}
    for index in range(30):
        variant = VARIANTS[[1, 4, 1, 7, 3, 1, 4, 0][index % 8]]
        cls = classes[index % len(classes)]
        drive = (1, 2, 4)[index % 3]
        name = "%sX%d_%s" % (cls, drive, variant.replace("-", "_"))
        worst = _r(15.5 - index * 0.33, 1)
        other = _r(worst * (0.4 + 0.2 * rng.random()), 1)
        extra = {TEMPS[0]: worst, TEMPS[1]: other}
        inv = fan["%s|%s" % (variant, TEMPS[0])]["inv"]
        curve = {TEMPS[0]: [1.0, _r(inv[1] * (1 + worst / 200.0), 3), _r(inv[2] * (1 + worst / 100.0), 3)]}
        inv2 = fan["%s|%s" % (variant, TEMPS[1])]["inv"]
        curve[TEMPS[1]] = [1.0, _r(inv2[1] * (1 + other / 200.0), 3), _r(inv2[2] * (1 + other / 100.0), 3)]
        label = "%sX%d %s" % (cls, drive, variant.split("-")[1])
        items.append({
            "name": name, "label": label, "v": variant, "t": TEMPS[0], "x": worst, "cls": cls, "extra": extra,
            "fan": curve,
            "focus": "From %.2f V to %.2f V at %s °C, %s (%s) slows %.1f%% more than the reference inverter; a "
                     "%.2f late derate covers it." % (HI, LO, TEMPS[0], label, variant, worst, 1 + worst / 100.0)})
        for temp in TEMPS:
            key = "%s|%s|%s" % (variant, temp, cls)
            if key not in clsbox:
                ratio = fan["%s|%s" % (variant, temp)]["inv"]
                clsbox[key] = {"n": rng.randint(6, 24), "boxes": [
                    None, _ratio_box(rng, ratio[1] * 1.04, 0.015), _ratio_box(rng, ratio[2] * 1.06, 0.02)]}
    first = items[0]
    first["brief"] = {
        "cell": first["name"], "arc": "A2→ZN fall",
        "symptom": "The falling output through A2 slows far more than the inverter as the supply drops: "
                   "three series pull-down devices lose drive faster near threshold.",
        "now": first["x"], "target": 5.0, "unit": "% extra slowdown",
        "compare": "the reference inverter of the same variant, and the NOR3 class box at %.2f V" % LO,
        "where": "Pull-down stack MN1–MN3 between ZN and VSS; A2 drives MN2, the middle device, "
                 "which carries the body effect of MN3 below it.",
        "levers": [{"change": "Widen MN1–MN3 by 30 %", "effect": "about −7 %% extra slowdown at %.2f V" % LO},
                   {"change": "Move A2 to the device nearest VSS", "effect": "qualitative"}],
        "cost": [["Area", "+6 %"], ["Input capacitance on A2", "+0.12 fF"], ["Leakage", "+9 %"]],
        "check": "Re-characterise A2→ZN fall at %.2f V and %.2f V, both temperatures; re-run this rule; pass "
                 "below +5 %% extra slowdown." % (HI, LO)}
    second = items[1]
    second["brief"] = {
        "cell": second["name"], "arc": "S→Z rise",
        "symptom": "The select arc slows more than its class as the supply drops.",
        "now": second["x"], "target": 5.0, "unit": "% extra slowdown",
        "compare": "the reference inverter and the sibling sizes X1 and X4",
        "where": None,
        "levers": [{"change": "Upsize the select inverter feeding the transmission gates",
                    "effect": "qualitative"}],
        "cost": [["Area", "+3 %"], ["Leakage", "+4 %"]],
        "check": "Re-characterise S→Z rise at %.2f V; re-run this rule; pass below +5 %% extra slowdown." % LO}
    return {
        "id": "vmin_bottleneck", "kind": "vmin", "title": "Low-voltage bottleneck cells",
        "summary": "Cells that slow down more than the inverter when the supply drops from %.2f V to %.2f V."
                   % (HI, LO),
        "result": "%d cells flagged · worst +%.1f%%" % (sum(row["n"] for row in rows), items[0]["x"]),
        "rule": "Flag a cell when its delay grows at least 5 %% more than the reference inverter's from "
                "%.2f V to %.2f V (slow corner, %s °C and %s °C). Derate = the excess." % (HI, LO, TEMPS[0],
                                                                                         TEMPS[1]),
        "library": LIBRARY,
        "facts": [["Cells flagged", "%d of 1,200" % sum(row["n"] for row in rows)],
                  ["Worst cell", "%s +%.1f%%" % (items[0]["label"], items[0]["x"])],
                  ["Most flagged", "6T-HVT"], ["Cleanest", "8T-LVT"]],
        "score": {"dimension": "robustness", "affected": 60, "checked": 1200, "weight": 6},
        "impact": [["Timing", "Up to +%.0f%% more delay at %.2f V than an inverter-based guard band assumes."
                    % (items[0]["x"], LO)],
                   ["Monitors", "Ring oscillators are inverter chains: they do not see these cells slow down."],
                   ["Where", "HVT variants, mostly cold."]],
        "todo": [{"who": "chip_designer", "text": "Load the derate script for low-voltage runs, or keep the "
                                                 "worst cells off critical paths."},
                 {"who": "cell_designer", "text": "Widen the stacked devices of NOR3 and NAND4 HVT X1."},
                 {"who": "note", "text": "Delay cells are left out of the derate."}],
        "hint": "HVT boxes sit to the right: those variants lose the most speed at low voltage.",
        "hi": HI, "lo": LO, "temps": list(TEMPS), "watch": 5, "rows": rows, "fan": fan, "clsbox": clsbox,
        "items": items}


def gaps_rule():
    rng = random.Random(23)
    functions = ["NOR3", "NAND2", "AOI21", "OAI22", "MUX2", "XOR2", "BUF", "INV", "NOR2", "AND2"]
    items = []
    for index, cls in enumerate(functions):
        variant = VARIANTS[(index * 4) % len(VARIANTS)]
        steps = [1, 1.4, 2, 2.6, 4, 6, 8, 12, 16]
        gap_at = 2 + index % 4
        jump = _r(2.4 - index * 0.06, 2)
        drives = steps[:gap_at + 1] + [_r(steps[gap_at] * jump * (1 + 0.6 * k), 2) for k in range(4)]
        cells = []
        for k, drive in enumerate(drives):
            size = "%sX%s" % (cls, ("%g" % drive).replace(".", "P"))
            area = _r(0.35 + 0.22 * drive + rng.random() * 0.05, 3)
            cells.append({"name": "%s_%s" % (size, variant.replace("-", "_")), "s": size, "drive": drive,
                          "area": area, "leak": _r(0.8 * drive + rng.random() * 0.2, 3),
                          "d4": _r(18 + 3 / drive + rng.random(), 1), "d16": _r(40 + 60 / drive + rng.random(), 1)})
        lo, hi = cells[gap_at], cells[gap_at + 1]
        ratio = _r(hi["drive"] / lo["drive"], 2)
        miss_drive = _r(math.sqrt(lo["drive"] * hi["drive"]), 2)
        miss_area = _r(lo["area"] + (hi["area"] - lo["area"]) * 0.45, 3)
        vts = 3 if index % 3 == 0 else (2 if index % 3 == 1 else 1)
        items.append({
            "label": "%s · %s" % (cls, variant), "cls": cls, "v": variant, "ratio": ratio, "vts": vts,
            "i": gap_at, "cells": cells, "lo": dict(lo), "hi": dict(hi),
            "miss": {"drive": miss_drive, "area": miss_area},
            "pen_area": _r((hi["area"] / miss_area - 1) * 100, 1), "pen_leak": _r((ratio ** 0.5 - 1) * 100, 1),
            "weak": _r((ratio ** 0.5 - 1) * 60, 1),
            "focus": "Loads that need between ×%.1f and ×%.1f drive get either %s or %s, about %.0f%% more area "
                     "than a size in between." % (lo["drive"], hi["drive"], lo["s"], hi["s"],
                                                   (hi["area"] / miss_area - 1) * 100)})
    items.sort(key=lambda item: -item["ratio"])
    return {
        "id": "size_coverage_gaps", "kind": "gaps", "title": "Size coverage gaps",
        "summary": "Functions where the optimiser has no cell between two drive strengths.",
        "result": "%d gaps in 90 function sets · %d repeat in all VTs" % (
            len(items), sum(1 for item in items if item["vts"] == 3)),
        "rule": "For each function and variant, sort every cell by drive strength. Flag a jump of at least "
                "×1.9 between neighbouring cells inside the range.",
        "library": LIBRARY,
        "facts": [["Function sets checked", 90], ["With a gap", len(items)],
                  ["Same gap in every VT", sum(1 for item in items if item["vts"] == 3)],
                  ["Widest", "%s ×%.2f" % (items[0]["label"], items[0]["ratio"])],
                  ["Leakage unit", "nW"]],
        "score": {"dimension": "ppa", "affected": 12, "checked": 90, "weight": 4},
        "impact": [["Area / power", "Every instance that lands in a gap is oversized: more area and leakage."],
                   ["Timing", "Or it stays undersized and slow at heavy load."]],
        "todo": [{"who": "cell_designer", "text": "Add the missing sizes in the CSV, in every VT."},
                 {"who": "chip_designer", "text": "Until then, expect upsizing to jump past the gap."}],
        "matrix": {"tracks": list(TRACKS), "vts": list(VTS), "counts": [[3, 4, 2], [1, None, 2], [0, 2, 1]]},
        "items": items}


def path_rule():
    rng = random.Random(37)
    functions = [("DFFR", "CK→Q"), ("NAND2", "A1→ZN"), ("INV", "I→ZN"), ("NOR3", "A2→ZN"),
                 ("AOI21", "B→ZN"), ("OAI22", "A1→ZN"), ("BUF", "I→Z"), ("XOR2", "A1→Z")]
    paths = []
    for p in range(3):
        rows = []
        for k in range(8):
            cls, arc = functions[(k + p) % len(functions)]
            drive = (1, 2, 4)[(k + p) % 3]
            used = "%sX%d_SVT" % (cls, drive)
            base = 18 + rng.random() * 30
            slew, load = _r(12 + rng.random() * 60, 1), _r(0.8 + rng.random() * 6, 2)
            source = "fo4" if (p, k) == (0, 5) else "report"
            eq = []
            count = 4 + (k + p) % 5
            for e in range(count):
                vt = VTS[e % 3]
                size = (1, 2, 4, 8)[(e // 3) % 4]
                name = "%sX%d_%s" % (cls, size, vt)
                speed = {"SVT": 1.0, "HVT": 1.18, "LVT": 0.86}[vt] * (1.0 + 0.25 / size - 0.25 / drive)
                eq.append({"name": name, "s": "%sX%d %s" % (cls, size, vt), "vt": vt, "d": _r(base * speed, 1),
                           "a": _r(0.4 + 0.3 * size + (0.02 if vt == "LVT" else 0), 2),
                           "l": _r((3.5 if vt == "LVT" else 1.0 if vt == "SVT" else 0.3) * size, 2)})
            if used not in [entry["name"] for entry in eq]:
                eq.append({"name": used, "s": "%sX%d SVT" % (cls, drive), "vt": "SVT", "d": _r(base, 1),
                           "a": _r(0.4 + 0.3 * drive, 2), "l": _r(1.0 * drive, 2)})
            mine = [entry for entry in eq if entry["name"] == used][0]
            fast = [entry for entry in eq if entry["d"] < mine["d"] * 0.98]
            best = min(entry["d"] for entry in eq)
            rows.append({
                "inst": "u%d/U%d" % (p + 1, 10 + k * 7), "cell": used, "s": "%sX%d" % (cls, drive), "arc": arc,
                "d": mine["d"], "cls": cls,
                "op": {"slew": slew, "load": load, "from": source}, "nfast": len(fast), "best": best, "eq": eq,
                "focus": ("%d equivalents are faster here; the fastest saves %.0f ps." % (
                    len(fast), mine["d"] - best)) if fast else "This is already the fastest equivalent here."})
        total = _r(sum(row["d"] for row in rows), 1)
        gain = _r(sum(row["d"] - row["best"] for row in rows), 1)
        paths.append({"slack": _r(-14 + p * 4.5, 1), "start": "u%d/r_reg_%d_/Q" % (p + 1, p),
                      "end": "u%d/s_reg_%d_/D" % (p + 2, p * 3), "total": total, "gain": gain, "rows": rows})
    return {
        "id": "critical_path_faster_cells", "kind": "path", "title": "Faster cells on failing paths",
        "summary": "For each cell on a failing path: the faster drop-in cells, and the slower ones to don't-use.",
        "result": "3 worst paths · 24 cells · up to %.0f ps faster" % max(path["gain"] for path in paths),
        "rule": "Equivalent = same function, same track, any VT. Faster = lower delay at the instance's own "
                "operating point. Slower equivalents become don't-use candidates.",
        "library": LIBRARY,
        "facts": [["Design", "demo_top"], ["Failing paths", 40], ["Worst slack", "-14 ps"],
                  ["Distinct cells on these paths", 18]],
        "score": {"dimension": "none", "affected": 24, "checked": 24, "weight": 4},
        "impact": [["Timing", "Taking the fastest equivalent on every stage closes the worst path."],
                   ["Area", "Most faster options are LVT: more leakage, similar area."]],
        "todo": [{"who": "chip_designer", "text": "Load the don't-use script for the setup-repair step only."},
                 {"who": "note", "text": "The gain is an upper bound, not a sign-off number."}],
        "design": {"name": "demo_top", "lib": "Demo library 8T", "flow": "post-route", "corner": "typical",
                   "fail": 40, "wns": -14.0},
        "paths": paths, "items": []}


def spike_rule():
    slews = [4.0, 12.0, 30.0, 80.0, 200.0, 500.0, 1100.0]
    loads = [0.3, 1.5, 5.0, 14.0, 40.0, 110.0, 260.0]
    families = ["SDFFR", "DFFS", "SDFF", "LATQ", "AOI", "OAI", "MUX", "XOR"]
    items = []
    for index, family in enumerate(families):
        pos = [5 - index % 3, 3 + index % 3]
        vals = [[_r(14 + 0.18 * s + 5.6 * l + 0.004 * s * l, 1) for l in loads] for s in slews]
        expected_row = list(vals[pos[0]])
        tol = _r(max(4.0, 0.05 * expected_row[pos[1]]), 1)
        bump = (-1 if index % 2 else 1) * tol * (3.8 - index * 0.3)
        vals[pos[0]][pos[1]] = _r(vals[pos[0]][pos[1]] + bump, 1)
        res = [[0.0 for _ in loads] for _ in slews]
        for i, row in enumerate(vals):
            for j in range(1, len(loads) - 1):
                w = (loads[j] - loads[j - 1]) / (loads[j + 1] - loads[j - 1])
                chord = row[j - 1] + w * (row[j + 1] - row[j - 1])
                res[i][j] = _r(abs(row[j] - chord) / tol, 2)
            res[i][0] = res[i][-1] = None
        observed = vals[pos[0]][pos[1]]
        k = pos[1]
        w = (loads[k] - loads[k - 1]) / (loads[k + 1] - loads[k - 1])
        expected = _r(vals[pos[0]][k - 1] + w * (vals[pos[0]][k + 1] - vals[pos[0]][k - 1]), 1)
        ratio = _r(abs(observed - expected) / tol, 2)
        variant = VARIANTS[[4, 1, 7, 4, 0, 3, 6, 2][index]]
        drive = (1, 2, 4)[index % 3]
        name = "%sX%d_%s" % (family, drive, variant.replace("-", "_"))
        label = "%sX%d %s" % (family, drive, variant.split("-")[1])
        point = "slew %g ps × load %g fF" % (slews[pos[0]], loads[pos[1]])
        items.append({
            "name": name, "label": label, "v": variant, "ratio": ratio, "corner": "slow 0.70 V -20 °C",
            "corners": "%d of 6 corners · %d arcs" % (2 + index % 3, 2 + index % 5), "kind": "fall_transition",
            "arc": "CDN→Q" if index < 3 else "A→Z", "when": "!SE" if index < 2 else "", "pos": pos,
            "label_pos": point, "xname": "output load (fF)", "axes": [slews, loads], "vals": vals, "res": res,
            "tol": tol,
            "slice": {"x": loads, "y": vals[pos[0]], "k": k, "at": "slew %g ps" % slews[pos[0]],
                      "others": [{"label": "sibling X%d" % size,
                                  "y": [_r(v * (1 + 0.08 * (size - drive)), 1) for v in expected_row]}
                                 for size in (1, 2, 4) if size != drive]},
            "observed": observed, "expected": expected, "tolx": ratio, "verdict": "spike" if bump > 0 else "dip",
            "focus": "At %s of the fall transition table, the file says %.0f ps where the smooth curve says "
                     "%.0f ps; its siblings stay smooth there." % (point, observed, expected)})
    items.sort(key=lambda item: -item["ratio"])
    return {
        "id": "table_spikes_kinks", "kind": "spike", "title": "Table spikes and kinks",
        "summary": "Table points that jump off the smooth curve: characterisation glitches the tools will "
                   "read as real.",
        "result": "40 cells · 96 tables · worst %.1f× tolerance" % items[0]["ratio"],
        "rule": "Along each table axis, a point must not sit further from the chord between its neighbours "
                "than the tolerance.",
        "library": LIBRARY,
        "facts": [["Cells affected", 40], ["Tables affected", 96], ["Issue groups", 52], ["Most affected", "8T-HVT"]],
        "score": {"dimension": "quality", "affected": 40, "checked": 1200, "weight": 6},
        "impact": [["Timing", "STA interpolates the glitch as real; downstream delays inherit it."],
                   ["Tools", "Different tools read different neighbours, so sign-off and place-and-route "
                             "can disagree."]],
        "todo": [{"who": "library_provider", "text": "Re-simulate the flagged points and re-release the tables."},
                 {"who": "chip_designer", "text": "Until then, keep slew on these pins below the flagged slew."}],
        "hint": "Most issues are on flops with set or reset, in HVT.",
        "by_variant": [["8T-HVT", 21], ["6T-HVT", 12], ["10T-HVT", 8], ["8T-SVT", 5], ["6T-SVT", 3],
                       ["10T-LVT", 1]],
        "by_kind": [["fall_transition", 30], ["rise_transition", 14], ["cell_fall", 2]],
        "by_family": [[family, 12 - index] for index, family in enumerate(families)],
        "items": items}


def rules():
    return [vmin_rule(), gaps_rule(), path_rule(), spike_rule()]
