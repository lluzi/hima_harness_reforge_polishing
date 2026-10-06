# Worked example: SAED14 inverter delay versus drive strength (facts mode, verified)

This is a real run, not a sketch. On 2026-10-05 the script below ran on linglong against the
QuaLib-extracted SAED14 RVT TT facts file, and its delivery passed `check-delivery`, the Pack
Reader, `admit-analysis` (admitted as `saed14-inv-drive-delay@1` in a development library) and
`deliver`. The same delivery is the Pack's Reader test fixture.

## 1. The request

```json
{"schema": "hima-libinsight-request/1", "requestId": "req-20261005120000-r1demo",
 "question": "For SAED14 RVT TT 0.8V 25C, how does mid-grid cell_rise and cell_fall delay of the INV and INV_S inverters scale with drive strength, and what does each drive step cost in area?",
 "sources": ["/data/eda/project/hima_harness/library-intelligence-prototypes/claude-libint-20260923-01/canonical/saed14/saed14rvt_tt0p8v25c.json.gz"],
 "buildsOn": [], "createdAt": "2026-10-05T12:00:00Z"}
```

`prepare-request` bound the source as `kind: facts`, sha256 `ca4a9e38…36d0`, 20460411 bytes, with
embedded Liberty identity `/data/eda/pdk/saed14/stdcell_rvt/db_nldm/saed14rvt_tt0p8v25c.lib`
sha256 `49962e1b…2571` (67985936 bytes). The source is a facts file, so no licence is needed.

## 2. Look before you compute

A first version compared each inverter at its own table's mid-grid point and found delay nearly
flat (0.0329–0.0342 ns) across drive 0.5 to 20. Reading the indexes showed why: every
`SAEDRVT14_INV_*` table shares the slew axis, but the load axis is **drive-scaled** (mid-grid load
4.08 fF at drive 0.5, 152 fF at drive 20). The answer to "how does delay scale with drive" needs one
common load. The script therefore reports both: the native mid-grid point (which shows the
scaling of the grid) and delay at one fixed load, the weakest cell's mid-grid load, which lies inside
every cell's grid, by linear interpolation along the load axis at the shared mid slew.

## 3. The script (`analysis/inv_drive_delay.py`)

It verifies the facts file against the prepared sha256, hashes it before and after, converts
units with the record's own `library.units`, builds two datasets and five plots (one of each kind),
copies its own text into `code.main`, and writes both `analysis-result.json` and the candidate.
It runs on Python 3.6 and later and needs no numpy.

<!-- BEGIN inv_drive_delay.py -->
```python
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
```
<!-- END inv_drive_delay.py -->

## 4. The commands that ran

From the private workspace (here `.../dev/claude-r1-20261005/private`), with the Campaign's
prepared request:

```sh
python3 analysis/inv_drive_delay.py \
  --prepared <campaignWorkspace>/state/prepared-request.json \
  --facts /data/eda/project/hima_harness/library-intelligence-prototypes/claude-libint-20260923-01/canonical/saed14/saed14rvt_tt0p8v25c.json.gz \
  --out analysis-result.json --candidate resident-delivery.json
python3 <campaignWorkspace>/flow/libinsight_cli.py check-delivery . analysis-result.json
```

- `/usr/bin/python3` 3.12.3 on the linglong host: 29 cells, 1.46 s, `accepted … {"datasets": 2,
  "plots": 5, "rows": 78}`.
- `python3` 3.6.8 inside the edarunner image with the resident sandbox's mount shape (read-only
  corpus and Campaign, read-write private workspace): the same 29 cells in 1.72 s, `accepted`.
- After copying the delivery the way the Host does, the Pack Reader emitted
  `li_analysis_error_count 0, plot_count 5, dataset_count 2, row_count 78`; `admit-analysis`
  created `<library>/saed14-inv-drive-delay/v1/{admission.json, analysis-result.json,
  analysis/inv_drive_delay.py}` and a second admission of the same bytes reported `reused: true`.

## 5. The answer it delivered

> 29 SAED14 RVT inverters (13 INV, 16 INV_S). The cell_rise tables are drive-scaled: the mid-grid
> load grows from 4.084 fF to 152.4 fF, so mid-grid cell_rise stays within 0.03287-0.03415 ns. At
> one fixed 4.084 fF load and 0.02922 ns input slew, INV cell_rise falls from 0.03414 ns at drive
> 0.5 to 0.005939 ns at drive 20 (5.7x faster, log-log slope -0.48) while area grows from 0.1776 to
> 1.021.

## 6. The delivery (`analysis-result.json`, `code.main.text` elided)

<!-- BEGIN delivery.json -->
```json
{
  "assumptions": ["Inverter cells are SAEDRVT14_INV_<drive> and SAEDRVT14_INV_S_<drive>; ECO/PECO variants are excluded.", "Units are converted with the facts record's library units (time_s, cap_F, leakage_W)."],
  "code": {
    "files": [],
    "main": {
      "path": "analysis/inv_drive_delay.py",
      "sha256": "2d613ef85d0117f5f62c2acdf2f83360a0de4ce4a6d881fd2c575d1e39f22ec2",
      "text": "<the script of section 3, byte for byte>"
    }
  },
  "datasets": {
    "inv1_cell_rise": {
      "columns": [{"name": "slew_ns", "type": "number", "unit": "ns"}, {"name": "load_fF", "type": "number", "unit": "fF"}, {"name": "cell_rise_ns", "type": "number", "unit": "ns"}],
      "rows": [
        [0.003000000026077032, 0.15000000596046448, 0.0026910000015050173],
        [0.003000000026077032, 0.838699996471405, 0.004377000033855438],
        [0.003000000026077032, 3.25600004196167, 0.009832000359892845],
        [0.003000000026077032, 7.873000144958496, 0.02020999975502491],
        [0.003000000026077032, 15.0600004196167, 0.03629999980330467],
        [0.003000000026077032, 25.15999984741211, 0.05886000022292137],
        [0.003000000026077032, 38.439998626708984, 0.08874999731779099],
        [0.005338000133633614, 0.15000000596046448, 0.0034000000450760126],
        [0.005338000133633614, 0.838699996471405, 0.005530000198632479],
        [0.005338000133633614, 3.25600004196167, 0.011009999550879002],
        [0.005338000133633614, 7.873000144958496, 0.021369999274611473],
        [0.005338000133633614, 15.0600004196167, 0.037470001727342606],
        [0.005338000133633614, 25.15999984741211, 0.060029998421669006],
        [0.005338000133633614, 38.439998626708984, 0.089819997549057],
        [0.01355000026524067, 0.15000000596046448, 0.005028999876230955],
        [0.01355000026524067, 0.838699996471405, 0.008441999554634094],
        [0.01355000026524067, 3.25600004196167, 0.015200000256299973],
        [0.01355000026524067, 7.873000144958496, 0.025510000064969063],
        [0.01355000026524067, 15.0600004196167, 0.04162000119686127],
        [0.01355000026524067, 25.15999984741211, 0.06419000029563904],
        [0.01355000026524067, 38.439998626708984, 0.09391999989748001],
        [0.02921999990940094, 0.15000000596046448, 0.006891999859362841],
        [0.02921999990940094, 0.838699996471405, 0.011889999732375145],
        [0.02921999990940094, 3.25600004196167, 0.021810000762343407],
        [0.02921999990940094, 7.873000144958496, 0.03359000012278557],
        [0.02921999990940094, 15.0600004196167, 0.049789998680353165],
        [0.02921999990940094, 25.15999984741211, 0.07236000150442123],
        [0.02921999990940094, 38.439998626708984, 0.10199999809265137],
        [0.05364000052213669, 0.15000000596046448, 0.00879599992185831],
        [0.05364000052213669, 0.838699996471405, 0.01551000028848648],
        [0.05364000052213669, 3.25600004196167, 0.028880000114440918],
        [0.05364000052213669, 7.873000144958496, 0.04456000030040741],
        [0.05364000052213669, 15.0600004196167, 0.06210999935865402],
        [0.05364000052213669, 25.15999984741211, 0.08473999798297882],
        [0.05364000052213669, 38.439998626708984, 0.1145000010728836],
        [0.087909996509552, 0.15000000596046448, 0.010599999688565731],
        [0.087909996509552, 0.838699996471405, 0.019009999930858612],
        [0.087909996509552, 3.25600004196167, 0.036490000784397125],
        [0.087909996509552, 7.873000144958496, 0.056759998202323914],
        [0.087909996509552, 15.0600004196167, 0.07885999977588654],
        [0.087909996509552, 25.15999984741211, 0.10270000249147415],
        [0.087909996509552, 38.439998626708984, 0.13249999284744263],
        [0.13300000131130219, 0.15000000596046448, 0.01228999998420477],
        [0.13300000131130219, 0.838699996471405, 0.02250000089406967],
        [0.13300000131130219, 3.25600004196167, 0.04382999986410141],
        [0.13300000131130219, 7.873000144958496, 0.06909000128507614],
        [0.13300000131130219, 15.0600004196167, 0.09600000083446503],
        [0.13300000131130219, 25.15999984741211, 0.12470000237226486],
        [0.13300000131130219, 38.439998626708984, 0.15559999644756317]
      ]
    },
    "inv_drive": {
      "columns": [{"name": "cell", "type": "string"}, {"name": "family", "type": "string"}, {"name": "drive", "type": "number", "unit": "x"}, {"name": "area", "type": "number", "unit": "library area"}, {"name": "input_cap_fF", "type": "number", "unit": "fF"}, {"name": "leakage_pW", "nullMeans": "the cell declares no numeric cell_leakage_power", "type": "number", "unit": "pW"}, {"name": "mid_slew_ns", "type": "number", "unit": "ns"}, {"name": "mid_load_fF", "type": "number", "unit": "fF"}, {"name": "mid_rise_ns", "type": "number", "unit": "ns"}, {"name": "mid_fall_ns", "type": "number", "unit": "ns"}, {"name": "fixed_load_rise_ns", "nullMeans": "the fixed load lies outside this cell's table; not extrapolated", "type": "number", "unit": "ns"}, {"name": "fixed_load_fall_ns", "nullMeans": "the fixed load lies outside this cell's table; not extrapolated", "type": "number", "unit": "ns"}],
      "rows": [
        ["SAEDRVT14_INV_0P5", "INV", 0.5, 0.17759999632835388, 0.2117999941110611, 50.5099983215332, 0.02921999990940094, 4.086999893188477, 0.03415000066161156, 0.03172999992966652, 0.03413509736391597, 0.03171648624584813],
        ["SAEDRVT14_INV_0P75", "INV", 0.75, 0.17759999632835388, 0.29649999737739563, 75.7699966430664, 0.02921999990940094, 6.00600004196167, 0.03375000134110451, 0.03135000169277191, 0.02728294563969558, 0.0255033000330558],
        ["SAEDRVT14_INV_1", "INV", 1.0, 0.17759999632835388, 0.3813000023365021, 101.0, 0.02921999990940094, 7.873000144958496, 0.03359000012278557, 0.031279999762773514, 0.023922593368304886, 0.0225317346520971],
        ["SAEDRVT14_INV_1P5", "INV", 1.5, 0.17759999632835388, 0.38190001249313354, 101.0, 0.02921999990940094, 7.875999927520752, 0.03359000012278557, 0.031279999762773514, 0.023910918530089566, 0.022520389236717574],
        ["SAEDRVT14_INV_2", "INV", 2.0, 0.22200000286102295, 0.7415000200271606, 202.0, 0.02921999990940094, 15.0, 0.03286999836564064, 0.030629999935626984, 0.01649516436366824, 0.015673405036415247],
        ["SAEDRVT14_INV_3", "INV", 3.0, 0.266400009393692, 0.9125000238418579, 227.1999969482422, 0.02921999990940094, 17.540000915527344, 0.0335099995136261, 0.031220000237226486, 0.015754650816655783, 0.015004338356735307],
        ["SAEDRVT14_INV_4", "INV", 4.0, 0.3107999861240387, 1.475000023841858, 404.0, 0.02921999990940094, 29.93000030517578, 0.03305999934673309, 0.030799999833106995, 0.012178629445582456, 0.011708977038728464],
        ["SAEDRVT14_INV_6", "INV", 6.0, 0.39959999918937683, 2.2049999237060547, 605.9000244140625, 0.02921999990940094, 45.16999816894531, 0.03303999826312065, 0.030789999291300774, 0.01045758183431526, 0.010103331566741652],
        ["SAEDRVT14_INV_8", "INV", 8.0, 0.48840001225471497, 2.940000057220459, 807.9000244140625, 0.02921999990940094, 60.5099983215332, 0.033160001039505005, 0.03084000013768673, 0.008998347425747191, 0.008694485454077475],
        ["SAEDRVT14_INV_10", "INV", 10.0, 0.5771999955177307, 3.6659998893737793, 1010.0, 0.02921999990940094, 75.8499984741211, 0.03311999887228012, 0.030859999358654022, 0.007903856643535939, 0.0076806559006290746],
        ["SAEDRVT14_INV_12", "INV", 12.0, 0.6660000085830688, 4.396999835968018, 1212.0, 0.02921999990940094, 91.72000122070312, 0.033250000327825546, 0.031039999797940254, 0.007261726714501057, 0.007050675012506279],
        ["SAEDRVT14_INV_16", "INV", 16.0, 0.8435999751091003, 5.866000175476074, 1616.0, 0.02921999990940094, 122.5999984741211, 0.033319998532533646, 0.030980000272393227, 0.006428268227710577, 0.006273961457329814],
        ["SAEDRVT14_INV_20", "INV", 20.0, 1.0211999416351318, 7.327000141143799, 2020.0, 0.02921999990940094, 152.0, 0.03319999948143959, 0.030950000509619713, 0.0059392273750880666, 0.005802975819006672],
        ["SAEDRVT14_INV_S_0P5", "INV_S", 0.5, 0.17759999632835388, 0.20669999718666077, 50.5099983215332, 0.02921999990940094, 4.084000110626221, 0.03410999849438667, 0.031700000166893005, 0.03410999849438667, 0.031700000166893005],
        ["SAEDRVT14_INV_S_0P75", "INV_S", 0.75, 0.17759999632835388, 0.29159998893737793, 75.7699966430664, 0.02921999990940094, 6.004000186920166, 0.03373999893665314, 0.03133999928832054, 0.027277828042341717, 0.02549771395729511],
        ["SAEDRVT14_INV_S_1", "INV_S", 1.0, 0.17759999632835388, 0.37880000472068787, 101.0, 0.02921999990940094, 7.877999782562256, 0.033580001443624496, 0.03133000060915947, 0.02390612224819442, 0.022510182351827532],
        ["SAEDRVT14_INV_S_1P5", "INV_S", 1.5, 0.22200000286102295, 0.5697000026702881, 151.5, 0.02921999990940094, 11.630000114440918, 0.033250000327825546, 0.030910000205039978, 0.01931871736810339, 0.018270568221083586],
        ["SAEDRVT14_INV_S_2", "INV_S", 2.0, 0.22200000286102295, 0.741599977016449, 202.0, 0.02921999990940094, 15.0, 0.03286999836564064, 0.030629999935626984, 0.01649516436366824, 0.015679019451237165],
        ["SAEDRVT14_INV_S_3", "INV_S", 3.0, 0.3107999861240387, 1.1119999885559082, 303.0, 0.02921999990940094, 22.829999923706055, 0.03322000056505203, 0.030880000442266464, 0.013763066751599516, 0.013176611746560532],
        ["SAEDRVT14_INV_S_4", "INV_S", 4.0, 0.3107999861240387, 1.475000023841858, 404.0, 0.02921999990940094, 29.93000030517578, 0.03305999934673309, 0.030799999833106995, 0.012178629445582456, 0.011708977038728464],
        ["SAEDRVT14_INV_S_5", "INV_S", 5.0, 0.39959999918937683, 1.843000054359436, 505.0, 0.02921999990940094, 37.88999938964844, 0.03311000019311905, 0.030880000442266464, 0.011211459409702564, 0.01082251548029887],
        ["SAEDRVT14_INV_S_6", "INV_S", 6.0, 0.39959999918937683, 2.2039999961853027, 605.9000244140625, 0.02921999990940094, 45.04999923706055, 0.032999999821186066, 0.030750000849366188, 0.010453934333083212, 0.010098951848298968],
        ["SAEDRVT14_INV_S_7", "INV_S", 7.0, 0.48840001225471497, 2.571000099182129, 707.0, 0.02921999990940094, 53.130001068115234, 0.03310000151395798, 0.030899999663233757, 0.009623200391685084, 0.009299892430811578],
        ["SAEDRVT14_INV_S_8", "INV_S", 8.0, 0.48840001225471497, 2.934000015258789, 807.9000244140625, 0.02921999990940094, 60.61000061035156, 0.03317999839782715, 0.030950000509619713, 0.008890532596610452, 0.00857625891946748],
        ["SAEDRVT14_INV_S_9", "INV_S", 9.0, 0.5771999955177307, 3.3010001182556152, 908.9000244140625, 0.02921999990940094, 68.5, 0.03322000056505203, 0.030889999121427536, 0.008404826390130345, 0.008140974491195182],
        ["SAEDRVT14_INV_S_10", "INV_S", 10.0, 0.5771999955177307, 3.6649999618530273, 1010.0, 0.02921999990940094, 75.87000274658203, 0.03313000127673149, 0.030859999358654022, 0.007890695708681906, 0.007667956615227364],
        ["SAEDRVT14_INV_S_12", "INV_S", 12.0, 0.6660000085830688, 4.3979997634887695, 1212.0, 0.02921999990940094, 91.77999877929688, 0.033250000327825546, 0.031039999797940254, 0.007256889443606007, 0.00704180421086301],
        ["SAEDRVT14_INV_S_16", "INV_S", 16.0, 0.8435999751091003, 5.867000102996826, 1616.0, 0.02921999990940094, 122.5999984741211, 0.033309999853372574, 0.031060000881552696, 0.006420591246415967, 0.006266284476035205],
        ["SAEDRVT14_INV_S_20", "INV_S", 20.0, 1.0211999416351318, 7.320000171661377, 2020.0, 0.02921999990940094, 152.39999389648438, 0.033250000327825546, 0.030910000205039978, 0.005946155719417883, 0.0057876470180578095]
      ]
    }
  },
  "id": "saed14-inv-drive-delay",
  "limits": ["One TT 0.8 V 25 C corner only; no other PVT corner is compared.", "Fixed-load delay is linear interpolation along the load axis between the two enclosing grid points at the mid slew row; strong cells have a coarse grid near 4.084 fF.", "Drive strength is the numeric suffix of the cell name, not a measured current."],
  "plots": [{"dataset": "inv_drive", "id": "fixed-load-rise-vs-drive", "kind": "scatter", "series": {"column": "family"}, "title": "cell_rise at 4.084 fF versus drive strength", "x": {"column": "drive", "label": "drive (x)"}, "y": {"column": "fixed_load_rise_ns", "label": "cell_rise (ns)"}}, {"dataset": "inv_drive", "id": "mid-grid-rise-vs-drive", "kind": "line", "series": {"column": "family"}, "title": "Mid-grid cell_rise versus drive strength (drive-scaled load)", "x": {"column": "drive", "label": "drive (x)"}, "y": {"column": "mid_rise_ns", "label": "cell_rise (ns)"}}, {"dataset": "inv_drive", "id": "area-by-cell", "kind": "bar", "title": "Area by inverter", "x": {"column": "cell", "label": "cell"}, "y": {"column": "area", "label": "area"}}, {"dataset": "inv1_cell_rise", "id": "inv1-rise-grid", "kind": "heatmap", "title": "SAEDRVT14_INV_1 cell_rise table", "value": {"column": "cell_rise_ns", "label": "cell_rise (ns)"}, "x": {"column": "slew_ns", "label": "input slew (ns)"}, "y": {"column": "load_fF", "label": "output load (fF)"}}, {"dataset": "inv_drive", "id": "inv-table", "kind": "table", "title": "Inverter drive facts"}],
  "question": "For SAED14 RVT TT 0.8V 25C, how does mid-grid cell_rise and cell_fall delay of the INV and INV_S inverters scale with drive strength, and what does each drive step cost in area?",
  "run": {
    "command": "/usr/bin/python3 analysis/inv_drive_delay.py --prepared /data/eda/project/hima_harness/libinsight-runs/dev/claude-r1-20261005/campaign/state/prepared-request.json --facts /data/eda/project/hima_harness/library-intelligence-prototypes/claude-libint-20260923-01/canonical/saed14/saed14rvt_tt0p8v25c.json.gz --out analysis-result.json --candidate resident-delivery.json",
    "elapsedSeconds": 1.463,
    "exitCode": 0,
    "usedQualib": false
  },
  "schema": "hima-libinsight-analysis/1",
  "sources": [{"kind": "facts", "libertySha256": "49962e1b61d08eae063633ba32ab76fc002c405d40e391e181e92ff445442571", "path": "/data/eda/project/hima_harness/library-intelligence-prototypes/claude-libint-20260923-01/canonical/saed14/saed14rvt_tt0p8v25c.json.gz", "sha256After": "ca4a9e38f4be48240938806c1737a29fea38eb34adcc645420b06e207a7236d0", "sha256Before": "ca4a9e38f4be48240938806c1737a29fea38eb34adcc645420b06e207a7236d0"}],
  "summary": "29 SAED14 RVT inverters (13 INV, 16 INV_S). The cell_rise tables are drive-scaled: the mid-grid load grows from 4.084 fF to 152.4 fF, so mid-grid cell_rise stays within 0.03287-0.03415 ns. At one fixed 4.084 fF load and 0.02922 ns input slew, INV cell_rise falls from 0.03414 ns at drive 0.5 to 0.005939 ns at drive 20 (5.7x faster, log-log slope -0.48) while area grows from 0.1776 to 1.021.",
  "version": 1
}
```
<!-- END delivery.json -->

## 7. What to copy from this example

- Check the source against the prepared sha256 first; hash before and after.
- Inspect the table indexes before choosing a comparison point; say in `limits` how values were
  read (grid point or interpolation) and never extrapolate silently (`nullMeans` instead).
- One dataset per table shape; numbers as numbers with units; one plot per question you answer.
- Write the candidate only after `check-delivery` prints `accepted`.
