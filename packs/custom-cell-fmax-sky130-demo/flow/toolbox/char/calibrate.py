#!/usr/bin/env python3
"""Calibrate the characterizer against foundry cells: extract their layouts with Magic exactly like a
custom cell, characterize them with the same method, compare every table point with the shipped
Liberty, and write per-quantity factors and the residual spread after them.

    python3 calibrate.py --reference-lib REF.lib --out OUTDIR [--jobs 16] [--tolerance 0.15]

Writes OUTDIR/calibration.json (read by characterize.py --calibration), calibration.md and
calibration-points.csv. Exit 0 when every quantity's p90 residual is within the tolerance, 3 otherwise
(the JSON is still written with pass=false; characterize.py refuses it).
"""
import argparse
import csv
import json
import os
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import charcore as cc  # noqa: E402
import characterize as ch  # noqa: E402

DEFAULT_CELLS = ["inv_1", "nand2_1", "nor2_1", "nor3_1", "nor3_2", "xor2_1", "xnor2_1", "a21oi_1",
                 "o21ai_1", "mux2i_1", "ha_1", "fa_1"]
PREFIX = "sky130_fd_sc_hd__"
GDS = "/foss/pdks/sky130A/libs.ref/sky130_fd_sc_hd/gds/sky130_fd_sc_hd.gds"
MAGICRC = "/foss/pdks/sky130A/libs.tech/magic/sky130A.magicrc"
# The same Magic sequence as flow/toolbox/celluzi/generate/extract_cell.sh (cthresh 0: all caps).
EXTRACT_TCL = """gds read {gds}
load {cell}
select top cell
port makeall
extract all
ext2spice lvs
ext2spice cthresh 0
ext2spice -o {out}
quit -noprompt
"""


def extract(cell, out_dir, gds=GDS, magicrc=MAGICRC):
    out_dir = os.path.abspath(out_dir)
    os.makedirs(out_dir, exist_ok=True)
    spice = os.path.join(out_dir, cell + ".ext.spice")
    if os.path.isfile(spice) and os.path.getsize(spice) > 0:
        return spice
    tcl = os.path.join(out_dir, "extract.tcl")
    with open(tcl, "w") as handle:
        handle.write(EXTRACT_TCL.format(gds=gds, cell=cell, out=spice))
    with open(os.path.join(out_dir, "magic.log"), "w") as log:
        subprocess.run(["magic", "-dnull", "-noconsole", "-rcfile", magicrc, tcl], cwd=out_dir,
                       stdout=log, stderr=subprocess.STDOUT, timeout=600)
    if not os.path.isfile(spice):
        raise cc.CharError("Magic did not write %s (see magic.log)" % spice)
    return spice


def job_cell(ref, spice):
    """A characterizer job entry for a foundry cell, taken from its Liberty."""
    inputs = sorted(p for p, v in ref["pins"].items() if v["direction"] == "input")
    outputs = sorted(p for p, v in ref["pins"].items() if v["direction"] == "output")
    return cc.normalize_cell({"name": ref["name"], "spice": spice, "subckt": ref["name"],
                              "pins": {"power": "VPWR", "ground": "VGND", "inputs": inputs, "outputs": outputs},
                              "functions": {o: ref["pins"][o]["function"] for o in outputs},
                              "area_um2": ref["area"], "index_ref": ref["name"]})


def compare(ref, arcs, caps):
    """[(cell, quantity, output, input, sense, slew, load, simulated, reference)] for every matched point."""
    rows = []
    for rarc in ref["arcs"]:
        match = [a for a in arcs if (a["output"], a["input"], a["sense"]) == (rarc["output"], rarc["input"], rarc["sense"])]
        if not match:
            raise cc.CharError("%s: no simulated arc %s->%s %s" % (ref["name"], rarc["input"], rarc["output"], rarc["sense"]))
        for q in cc.QUANTITIES:
            for i, slew in enumerate(rarc["index_1"]):
                for j, load in enumerate(rarc["index_2"]):
                    rows.append((ref["name"], q, rarc["output"], rarc["input"], rarc["sense"], slew, load,
                                 match[0]["tables"][q][i][j], rarc["tables"][q][i][j]))
    for pin, info in ref["pins"].items():
        if info["direction"] == "input":
            for q in cc.CAP_QUANTITIES:
                rows.append((ref["name"], q, "", pin, "", "", "", caps[pin][q], info[q]))
    return rows


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--reference-lib", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--cells", default=",".join(DEFAULT_CELLS), help="foundry cells without the sky130_fd_sc_hd__ prefix")
    parser.add_argument("--jobs", type=int, default=os.cpu_count() or 4)
    parser.add_argument("--tolerance", type=float, default=0.15, help="max p90 |residual| per quantity after factors")
    parser.add_argument("--ngspice", default="ngspice")
    parser.add_argument("--full-models", action="store_true")
    args = parser.parse_args(argv)
    args.out = os.path.abspath(args.out)
    os.makedirs(args.out, exist_ok=True)
    started = time.time()
    lib_text = open(args.reference_lib).read()
    refs, cells = {}, []
    for short in [c.strip() for c in args.cells.split(",") if c.strip()]:
        name = short if short.startswith(PREFIX) else PREFIX + short
        refs[name] = cc.read_cell(lib_text, name)
        spice = extract(name, os.path.join(args.out, "extract", name))
        cells.append(job_cell(refs[name], spice))
    print("extracted %d foundry cells in %.0f s" % (len(cells), time.time() - started))
    results, sim_wall = ch.characterize(cells, lib_text, args.out, args.jobs, args.ngspice, cc.METHOD, args.full_models)
    rows, failures = [], {}
    for name, result in results.items():
        if result["status"] != "ok":
            failures[name] = result.get("reason")
            continue
        rows.extend(compare(refs[name], result["rawArcs"], result["rawCaps"]))
    pairs = {}
    for row in rows:
        pairs.setdefault(row[1], []).append((row[7], row[8]))
    factors, residual = cc.calibration_factors(pairs)
    per_cell = {}
    for row in rows:
        sim, ref_value = row[7], row[8]
        if sim > 0 and ref_value > 0:
            per_cell.setdefault(row[0], {}).setdefault(row[1], []).append(abs(sim * factors[row[1]] / ref_value - 1))
    per_cell_p90 = {cell: {q: round(cc.percentile(v, 90), 4) for q, v in qs.items()} for cell, qs in per_cell.items()}
    passed = not failures and all(r["p90"] <= args.tolerance for r in residual.values())
    passed = passed and all(cc.FACTOR_BOUNDS[0] <= f <= cc.FACTOR_BOUNDS[1] for f in factors.values())
    calibration = {
        "schema": "hima-cellchar-calibration/1", "method": cc.METHOD, "methodFingerprint": cc.method_fingerprint(),
        "referenceLib": args.reference_lib, "extraction": EXTRACT_TCL.format(gds=GDS, cell="<cell>", out="<cell>.ext.spice"),
        "cells": sorted(refs), "failures": failures, "points": len(rows),
        "factors": factors, "residual": residual, "perCellP90": per_cell_p90,
        "tolerance": {"p90AbsResidual": args.tolerance}, "pass": passed,
        "wallSeconds": round(time.time() - started, 1), "simWallSeconds": round(sim_wall, 1), "jobs": args.jobs,
    }
    with open(os.path.join(args.out, "calibration.json"), "w") as handle:
        json.dump(calibration, handle, indent=2)
    with open(os.path.join(args.out, "calibration-points.csv"), "w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["cell", "quantity", "output", "input", "timing_sense", "slew_ns", "load_pf", "simulated",
                         "reference", "ratio_ref_over_sim", "residual_after_factor"])
        for row in rows:
            ratio = row[8] / row[7] if row[7] else ""
            resid = row[7] * factors[row[1]] / row[8] - 1 if row[8] else ""
            writer.writerow(list(row) + [ratio, resid])
    lines = ["# Characterizer calibration", "",
             "Method %s (%s); %d foundry cells, %d points; tolerance p90 |residual| <= %.0f%%; **%s**." % (
                 cc.METHOD["version"], cc.method_fingerprint(), len(refs), len(rows), 100 * args.tolerance,
                 "PASS" if passed else "FAIL"), "",
             "| quantity | factor (ref/sim) | raw p90 | p50 | p90 | max | bias |", "| --- | --- | --- | --- | --- | --- | --- |"]
    for q in cc.QUANTITIES + cc.CAP_QUANTITIES:
        r = residual[q]
        lines.append("| %s | %.4f | %.1f%% | %.1f%% | %.1f%% | %.1f%% | %+.1f%% |" % (
            q, factors[q], 100 * r["rawP90"], 100 * r["p50"], 100 * r["p90"], 100 * r["max"], 100 * r["bias"]))
    lines += ["", "Per-cell p90 |residual| after factors:", "", "| cell | " + " | ".join(cc.QUANTITIES + cc.CAP_QUANTITIES) + " |",
              "| --- |" + " --- |" * 6]
    for cell in sorted(per_cell_p90):
        lines.append("| %s | " % cell.replace(PREFIX, "") + " | ".join(
            "%.1f%%" % (100 * per_cell_p90[cell].get(q, float("nan"))) for q in cc.QUANTITIES + cc.CAP_QUANTITIES) + " |")
    if failures:
        lines += ["", "Failures:"] + ["- %s: %s" % kv for kv in sorted(failures.items())]
    with open(os.path.join(args.out, "calibration.md"), "w") as handle:
        handle.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    return 0 if passed else 3


if __name__ == "__main__":
    sys.exit(main())
