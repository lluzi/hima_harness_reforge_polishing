#!/usr/bin/env python3
"""SAED14 RVT inverters: cell_rise/cell_fall delay versus drive strength (facts mode).

Reads one QuaLib-extracted lib-insight-facts/1 file (no QuaLib licence needed), writes one
hima-libinsight-analysis/1 result and, optionally, the resident delivery candidate.

Run from the resident private workspace, with any Python >= 3.6:

  python3 analysis/inv_drive_delay.py --prepared <campaign>/state/prepared-request.json \
      --facts <facts .json.gz> --out analysis-result.json --candidate resident-delivery.json
"""
import argparse
import gzip
import hashlib
import json
import math
import os
import re
import shlex
import sys
import time

FAMILY = re.compile(r"^SAEDRVT14_(INV|INV_S)_([0-9]+(?:P[0-9]+)?)$")
SLEW_VARS = ("input_net_transition", "input_transition_time")
LOAD_VARS = ("total_output_net_capacitance",)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1 << 22), b""):
            digest.update(block)
    return digest.hexdigest()


def drive_of(token):
    return float(token.replace("P", "."))


def arc_table(pin, kind):
    """The single combinational A->X table of `kind` (cell_rise/cell_fall) of an inverter output pin."""
    found = [table for arc in pin["timing"] if arc["timing_type"] == "combinational" and arc["related_pin"] == "A"
             for table in arc["tables"] if table["kind"] == kind]
    if len(found) != 1:
        raise ValueError("%s: expected one %s table, found %d" % (pin["name"], kind, len(found)))
    return found[0]


def axes(table, templates):
    variables = templates[table["template"]]["variables"]
    if len(variables) != 2 or len(table["index"]) != 2:
        raise ValueError("table %s is not two-dimensional" % table["template"])
    slew_axis = [i for i, name in enumerate(variables) if name in SLEW_VARS]
    load_axis = [i for i, name in enumerate(variables) if name in LOAD_VARS]
    if len(slew_axis) != 1 or len(load_axis) != 1:
        raise ValueError("table %s variables %s are not slew x load" % (table["template"], variables))
    return slew_axis[0], load_axis[0]


def value_at(table, i, j):
    """Liberty values are row-major over index_1 then index_2."""
    width = len(table["index"][1])
    value = float(table["values"][i * width + j])
    if not math.isfinite(value):
        raise ValueError("non-finite table value")
    return value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepared", required=True)
    parser.add_argument("--facts", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--candidate")
    parser.add_argument("--id", default="saed14-inv-drive-delay")
    parser.add_argument("--version", type=int, default=1)
    args = parser.parse_args()
    started = time.time()

    with open(args.prepared, "rb") as stream:
        prepared = json.loads(stream.read().decode("utf-8"))
    bound = [s for s in prepared["sources"] if s["path"] == args.facts and s["kind"] == "facts"]
    if len(bound) != 1:
        raise SystemExit("facts file %s is not a facts source of the prepared request" % args.facts)
    before = sha256_file(args.facts)
    if before != bound[0]["sha256"]:
        raise SystemExit("facts file changed since prepare-request: %s != %s" % (before, bound[0]["sha256"]))

    with gzip.open(args.facts, "rt") as stream:
        facts = json.load(stream)
    if facts.get("schema") != "lib-insight-facts/1" or facts.get("status") != "ok":
        raise SystemExit("not an ok lib-insight-facts/1 record")
    library = facts["library"]
    units = library["units"]
    to_ns, to_ff, to_pw = units["time_s"] / 1e-9, units["cap_F"] / 1e-15, units["leakage_W"] / 1e-12
    templates = dict((t["name"], t) for t in library["templates"])

    cells, inv1 = [], None
    for cell in library["cells"]:
        match = FAMILY.match(cell["name"])
        if not match:
            continue
        inputs = [p for p in cell["pins"] if p["direction"] == "input"]
        outputs = [p for p in cell["pins"] if p["direction"] == "output"]
        if len(inputs) != 1 or len(outputs) != 1 or inputs[0]["name"] != "A":
            raise ValueError("%s is not a one-input inverter" % cell["name"])
        rise, fall = arc_table(outputs[0], "cell_rise"), arc_table(outputs[0], "cell_fall")
        slew_axis, load_axis = axes(rise, templates)
        if axes(fall, templates) != (slew_axis, load_axis) or rise["index"] != fall["index"]:
            raise ValueError("%s rise/fall tables use different grids" % cell["name"])
        cells.append((cell, match, inputs[0], rise, fall, slew_axis, load_axis))
        if cell["name"] == "SAEDRVT14_INV_1":
            inv1 = []
            for i, first in enumerate(rise["index"][0]):
                for j, second in enumerate(rise["index"][1]):
                    coordinate = (first, second)
                    inv1.append([coordinate[slew_axis] * to_ns, coordinate[load_axis] * to_ff,
                                 value_at(rise, i, j) * to_ns])
    if not cells or inv1 is None:
        raise SystemExit("no SAEDRVT14 INV/INV_S cells (or no SAEDRVT14_INV_1) in %s" % args.facts)

    def mid_point(entry):
        index, slew_axis, load_axis = entry[3]["index"], entry[5], entry[6]
        mid = [len(index[0]) // 2, len(index[1]) // 2]
        return mid, index[slew_axis][mid[slew_axis]] * to_ns, index[load_axis][mid[load_axis]] * to_ff

    def at_load(table, slew_axis, load_axis, slew_position, load_ff):
        """Linear interpolation along the load axis at one slew grid row; None outside the grid."""
        loads = [value * to_ff for value in table["index"][load_axis]]

        def point(position):
            i, j = (slew_position, position) if slew_axis == 0 else (position, slew_position)
            return value_at(table, i, j) * to_ns

        for k in range(len(loads) - 1):
            if loads[k] <= load_ff <= loads[k + 1]:
                share = (load_ff - loads[k]) / (loads[k + 1] - loads[k])
                return point(k) + share * (point(k + 1) - point(k))
        return None

    # The SAED14 load axis is drive-scaled, so a mid-grid point is a different load for every cell.
    # Drive strengths are compared at one fixed load: the weakest inverter's mid-grid load.
    fixed_load = min(mid_point(entry)[2] for entry in cells)
    rows = []
    for entry in cells:
        cell, match, pin, rise, fall, slew_axis, load_axis = entry
        mid, slew, load = mid_point(entry)
        leakage = cell["attrs"].get("cell_leakage_power")
        leakage = float(leakage) * to_pw if isinstance(leakage, (int, float)) and not isinstance(leakage, bool) else None
        rows.append([cell["name"], match.group(1), drive_of(match.group(2)), float(cell["area"]),
                     float(pin["cap"]) * to_ff, leakage, slew, load,
                     value_at(rise, mid[0], mid[1]) * to_ns, value_at(fall, mid[0], mid[1]) * to_ns,
                     at_load(rise, slew_axis, load_axis, mid[slew_axis], fixed_load),
                     at_load(fall, slew_axis, load_axis, mid[slew_axis], fixed_load)])
    rows.sort(key=lambda row: (row[1], row[2]))
    after = sha256_file(args.facts)

    plain = [row for row in rows if row[1] == "INV" and row[10] is not None]
    xs = [math.log(row[2]) for row in plain]
    ys = [math.log(row[10]) for row in plain]
    mean_x, mean_y = sum(xs) / len(xs), sum(ys) / len(ys)
    slope = (sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
             / sum((x - mean_x) ** 2 for x in xs)) if len(xs) > 1 else float("nan")
    weakest, strongest = plain[0], plain[-1]
    mid_rise = [row[8] for row in rows]
    summary = ("%d SAED14 RVT inverters (%d INV, %d INV_S). The cell_rise tables are drive-scaled: the mid-grid load "
               "grows from %.4g fF to %.4g fF, so mid-grid cell_rise stays within %.4g-%.4g ns. At one fixed %.4g fF "
               "load and %.4g ns input slew, INV cell_rise falls from %.4g ns at drive %g to %.4g ns at drive %g "
               "(%.1fx faster, log-log slope %.2f) while area grows from %.4g to %.4g." % (
                   len(rows), len([r for r in rows if r[1] == "INV"]), len([r for r in rows if r[1] == "INV_S"]),
                   min(r[7] for r in rows), max(r[7] for r in rows), min(mid_rise), max(mid_rise), fixed_load,
                   rows[0][6], weakest[10], weakest[2], strongest[10], strongest[2], weakest[10] / strongest[10],
                   slope, weakest[3], strongest[3]))
    limits = ["One TT 0.8 V 25 C corner only; no other PVT corner is compared.",
              "Fixed-load delay is linear interpolation along the load axis between the two enclosing grid points "
              "at the mid slew row; strong cells have a coarse grid near %.4g fF." % fixed_load,
              "Drive strength is the numeric suffix of the cell name, not a measured current."]
    if len(set(round(row[6], 9) for row in rows)) != 1:
        limits.append("Cells use different mid-grid slews; compare the slew_ns column before comparing delay.")

    script = os.path.abspath(__file__)
    code_path = os.path.relpath(script, os.getcwd()).replace(os.sep, "/")
    with open(script, "rb") as stream:
        text = stream.read().decode("utf-8")
    unknown = "the fixed load lies outside this cell's table; not extrapolated"
    result = {
        "schema": "hima-libinsight-analysis/1",
        "id": args.id,
        "version": args.version,
        "question": prepared["request"]["question"],
        "summary": summary,
        "sources": [{"path": args.facts, "kind": "facts", "sha256Before": before, "sha256After": after,
                     "libertySha256": facts["source"]["sha256"]}],
        "datasets": {
            "inv_drive": {
                "columns": [
                    {"name": "cell", "type": "string"}, {"name": "family", "type": "string"},
                    {"name": "drive", "type": "number", "unit": "x"},
                    {"name": "area", "type": "number", "unit": "library area"},
                    {"name": "input_cap_fF", "type": "number", "unit": "fF"},
                    {"name": "leakage_pW", "type": "number", "unit": "pW",
                     "nullMeans": "the cell declares no numeric cell_leakage_power"},
                    {"name": "mid_slew_ns", "type": "number", "unit": "ns"},
                    {"name": "mid_load_fF", "type": "number", "unit": "fF"},
                    {"name": "mid_rise_ns", "type": "number", "unit": "ns"},
                    {"name": "mid_fall_ns", "type": "number", "unit": "ns"},
                    {"name": "fixed_load_rise_ns", "type": "number", "unit": "ns", "nullMeans": unknown},
                    {"name": "fixed_load_fall_ns", "type": "number", "unit": "ns", "nullMeans": unknown}],
                "rows": rows},
            "inv1_cell_rise": {
                "columns": [{"name": "slew_ns", "type": "number", "unit": "ns"},
                            {"name": "load_fF", "type": "number", "unit": "fF"},
                            {"name": "cell_rise_ns", "type": "number", "unit": "ns"}],
                "rows": inv1}},
        "plots": [
            {"id": "fixed-load-rise-vs-drive", "title": "cell_rise at %.4g fF versus drive strength" % fixed_load,
             "kind": "scatter", "dataset": "inv_drive", "x": {"column": "drive", "label": "drive (x)"},
             "y": {"column": "fixed_load_rise_ns", "label": "cell_rise (ns)"}, "series": {"column": "family"}},
            {"id": "mid-grid-rise-vs-drive", "title": "Mid-grid cell_rise versus drive strength (drive-scaled load)",
             "kind": "line", "dataset": "inv_drive", "x": {"column": "drive", "label": "drive (x)"},
             "y": {"column": "mid_rise_ns", "label": "cell_rise (ns)"}, "series": {"column": "family"}},
            {"id": "area-by-cell", "title": "Area by inverter", "kind": "bar", "dataset": "inv_drive",
             "x": {"column": "cell", "label": "cell"}, "y": {"column": "area", "label": "area"}},
            {"id": "inv1-rise-grid", "title": "SAEDRVT14_INV_1 cell_rise table", "kind": "heatmap",
             "dataset": "inv1_cell_rise", "x": {"column": "slew_ns", "label": "input slew (ns)"},
             "y": {"column": "load_fF", "label": "output load (fF)"},
             "value": {"column": "cell_rise_ns", "label": "cell_rise (ns)"}},
            {"id": "inv-table", "title": "Inverter drive facts", "kind": "table", "dataset": "inv_drive"}],
        "code": {"main": {"path": code_path, "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(), "text": text},
                 "files": []},
        "run": {"command": " ".join(shlex.quote(word) for word in [sys.executable] + sys.argv), "exitCode": 0,
                "elapsedSeconds": round(time.time() - started, 3), "usedQualib": False},
        "assumptions": ["Inverter cells are SAEDRVT14_INV_<drive> and SAEDRVT14_INV_S_<drive>; ECO/PECO variants are excluded.",
                        "Units are converted with the facts record's library units (time_s, cap_F, leakage_W)."],
        "limits": limits,
    }
    encoded = (json.dumps(result, sort_keys=True, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8")
    with open(args.out, "wb") as stream:
        stream.write(encoded)
    if args.candidate:
        candidate = {"schema": "hima-resident-engineering-candidate/1", "outcome": "completed",
                     "summary": summary, "stopReason": "analysis complete",
                     "artifacts": [{"path": os.path.relpath(os.path.abspath(args.out), os.getcwd()).replace(os.sep, "/"),
                                    "sha256": hashlib.sha256(encoded).hexdigest(), "kind": "result"},
                                   {"path": code_path, "sha256": result["code"]["main"]["sha256"], "kind": "support"}]}
        with open(args.candidate, "w") as stream:
            json.dump(candidate, stream, sort_keys=True)
    print(json.dumps({"out": args.out, "cells": len(rows), "elapsedSeconds": result["run"]["elapsedSeconds"]}))


if __name__ == "__main__":
    main()
