#!/usr/bin/env python3
"""SPICE-characterize extracted standard cells into a measured, calibrated Liberty (sky130 tt 1.8 V 25 C).

    python3 characterize.py JOB.json --reference-lib REF.lib --calibration calibration.json \
        --out OUTDIR [--jobs 16]

JOB.json: {"cells": [{"name", "spice", "subckt", "pins": {"power", "ground", "inputs", "outputs"},
"functions": {"Y": "!(A|B|C)"}, "area_um2", "lef"?, "footprint"?, "index_ref"?}]}. See README.md.
Writes OUTDIR/custom.measured.lib (cell groups only, mergeable), custom.measured.standalone.lib,
characterization.json and <cell>.timing.csv. Needs ngspice and the sky130A models (run it inside the
IIC-OSIC-TOOLS container). Exit 0: every cell characterized; 1: some cells failed (the Liberty holds
only the good ones); 2: refused (bad job or calibration gate) and no Liberty written.
"""
import argparse
import concurrent.futures
import csv
import hashlib
import json
import os
import re
import subprocess
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import charcore as cc  # noqa: E402

DEFAULT_INDEX_REF = "sky130_fd_sc_hd__inv_1"
SPICEINIT = "set num_threads=1\nset ngbehavior=hsa\nset ng_nomodcheck\n"


def sha256(path):
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def lef_signal_pins(path, macro):
    with open(path, errors="replace") as handle:
        text = handle.read()
    match = re.search(r"^\s*MACRO\s+%s\s*$(.*?)^\s*END\s+%s\s*$" % (re.escape(macro), re.escape(macro)), text, re.M | re.S)
    if not match:
        raise cc.CharError("LEF %s has no MACRO %s" % (path, macro))
    pins = set()
    for pin in re.finditer(r"^\s*PIN\s+(\S+)\s*$(.*?)^\s*END\s+\1\s*$", match.group(1), re.M | re.S):
        use = re.search(r"\bUSE\s+(\w+)", pin.group(2))
        if not use or use.group(1).upper() not in ("POWER", "GROUND"):
            pins.add(pin.group(1))
    return pins


def resolve_index(cell, lib_text, ref_cache):
    """(index_1, {output: index_2}) for a cell: explicit, from index_ref, or from the default ref cell."""
    if cell.get("index_1") and cell.get("index_2"):
        index_2 = cell["index_2"]
        by_out = index_2 if isinstance(index_2, dict) else {o: index_2 for o in cell["outputs"]}
        return [float(x) for x in cell["index_1"]], {o: [float(x) for x in by_out[o]] for o in cell["outputs"]}
    ref_name = cell.get("index_ref") or DEFAULT_INDEX_REF
    if ref_name not in ref_cache:
        ref_cache[ref_name] = cc.read_cell(lib_text, ref_name)
    ref = ref_cache[ref_name]
    arcs = [a for a in ref["arcs"] if a.get("index_1") and a.get("index_2")]
    if not arcs:
        raise cc.CharError("index_ref %s has no del_1_7_7 tables" % ref_name)
    by_out = {}
    for out in cell["outputs"]:
        same = [a for a in arcs if a["output"] == out]
        by_out[out] = (same or arcs)[0]["index_2"]
    return arcs[0]["index_1"], by_out


def run_unit(task):
    """Simulate one unit; retry with a longer settle window when a crossing was not reached."""
    cell, ports, unit, index_1, index_2, include, models, work, ngspice, method = task
    uid = cc.unit_id(unit)
    started = time.time()
    attempts = []
    for factor in method["settleRetryFactors"]:
        deck, plan = cc.build_deck(cell, ports, unit, index_1, index_2, include, method, factor, models)
        deck_path = os.path.join(work, uid + ".sp")
        with open(deck_path, "w") as handle:
            handle.write(deck)
        try:
            proc = subprocess.run([ngspice, "-b", deck_path], capture_output=True, text=True,
                                  cwd=os.path.dirname(work), timeout=1800)
            output = proc.stdout + proc.stderr
        except subprocess.TimeoutExpired:
            output = "TIMEOUT after 1800 s"
        with open(os.path.join(work, uid + ".log"), "w") as handle:
            handle.write(output)
        meas = cc.parse_measures(output)
        timing = [name for name in plan["measures"] if name.startswith("m")]
        if not output.startswith("TIMEOUT") and not any(name in meas for name in timing) and "qrise" in meas:
            # the simulation ran but no output edge happened: the netlist does not implement the function
            side = ", ".join("%s=%d" % kv for kv in sorted(unit["vector"].items())) or "no side inputs"
            return {"unit": unit, "ok": False, "attempts": len(attempts) + 1, "seconds": time.time() - started,
                    "reason": "output %s never switched when %s toggled with %s; the netlist does not implement "
                              "%s = %s" % (unit["output"], unit["input"], side, unit["output"],
                                           cell["functions"][unit["output"]])}
        try:
            tables, caps = cc.reduce_unit(meas, plan, index_1, index_2, method)
            return {"unit": unit, "tables": tables, "caps": caps, "ok": True, "attempts": len(attempts) + 1,
                    "seconds": time.time() - started}
        except cc.CharError as error:
            errors = [line for line in output.splitlines() if "error" in line.lower()][:3]
            attempts.append("settle x%g: %s%s" % (factor, error, (" | " + " | ".join(errors)) if errors else ""))
    return {"unit": unit, "ok": False, "reason": "; ".join(attempts), "attempts": len(attempts),
            "seconds": time.time() - started}


def check_tables(arcs):
    """Warnings for physically odd tables (kept, reported)."""
    warnings = []
    for arc in arcs:
        tag = "%s->%s %s" % (arc["input"], arc["output"], arc["sense"])
        for q in cc.QUANTITIES:
            rows = arc["tables"][q]
            if q.startswith("cell_") and any(v < 0 for row in rows for v in row):
                warnings.append("%s %s has negative delays" % (tag, q))
            if any(row[j + 1] < row[j] * 0.99 for row in rows for j in range(len(row) - 1)):
                warnings.append("%s %s decreases with load somewhere" % (tag, q))
    return warnings


def characterize(cells, lib_text, out_dir, jobs, ngspice="ngspice", method=cc.METHOD, full_models=False, log=print):
    """Simulate every cell. Returns {name: result}; result has status ok|failed and, when ok, raw arcs/caps."""
    work_root = os.path.join(out_dir, "work")
    os.makedirs(work_root, exist_ok=True)
    with open(os.path.join(work_root, ".spiceinit"), "w") as handle:
        handle.write(SPICEINIT)
    results, tasks, devices, ref_cache = {}, [], set(), {}
    prepared = []
    for cell in cells:
        name = cell["name"]
        result = {"name": name, "status": "failed", "sims": 0, "simCpuSeconds": 0.0, "warnings": []}
        results[name] = result
        try:
            if not cell.get("spice") or not os.path.isfile(cell["spice"]):
                raise cc.CharError("spice file %r does not exist" % cell.get("spice"))
            if cell.get("lef"):
                lef_pins = lef_signal_pins(cell["lef"], name)
                if lef_pins != set(cell["inputs"] + cell["outputs"]):
                    raise cc.CharError("LEF signal pins %s differ from inputs+outputs %s"
                                       % (sorted(lef_pins), sorted(cell["inputs"] + cell["outputs"])))
            with open(cell["spice"], errors="replace") as handle:
                raw = handle.read()
            text, report = cc.sanitize_netlist(raw, cell["subckt"], cell["power"], cell["ground"])
            work = os.path.join(work_root, name)
            os.makedirs(work, exist_ok=True)
            include = os.path.join(work, name + ".sanitized.spice")
            with open(include, "w") as handle:
                handle.write(text)
            ports = cc.subckt_ports(text, cell["subckt"])
            cc.port_roles(ports, cell)
            index_1, index_2 = resolve_index(cell, lib_text, ref_cache)
            units = cc.plan_units(cell, method)
            if not units:
                raise cc.CharError("no input sensitizes any output; check the functions")
            result.update({"spice": cell["spice"], "spiceSha256": sha256(cell["spice"]), "sanitize": report,
                           "index_1": index_1, "index_2": index_2, "units": len(units)})
            devices.update(cc.netlist_devices(text))
            prepared.append((cell, ports, units, index_1, index_2, include, work))
        except (cc.CharError, OSError) as error:
            result["reason"] = str(error)
            log("cell %s: FAILED before simulation: %s" % (name, error))
    models = None
    if not full_models and devices:
        try:
            models = os.path.join(work_root, "models_%s.spice" % method["corner"])
            with open(models, "w") as handle:
                handle.write(cc.reduced_models(method["models"], method["corner"], sorted(devices)))
        except (cc.CharError, OSError) as error:
            log("model subset unavailable (%s); loading the full library" % error)
            models = None
    for cell, ports, units, index_1, index_2, include, work in prepared:
        with open(include) as handle:
            size = len([line for line in handle if line[:1] in "XxMm"])
        for unit in units:
            cost = size * (1 + method["settleNsPerPf"] * max(index_2[unit["output"]]))
            tasks.append((cost, (cell, ports, unit, index_1, index_2[unit["output"]], include, models, work, ngspice, method)))
    tasks = [task for _, task in sorted(tasks, key=lambda item: -item[0])]  # longest first: shorter tail
    log("%d cells, %d simulation units, %d workers" % (len(prepared), len(tasks), jobs))
    by_cell = {}
    started = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, jobs)) as pool:
        for done in pool.map(run_unit, tasks):
            by_cell.setdefault(done["unit"]["cell"], []).append(done)
    wall = time.time() - started
    for cell, ports, units, index_1, index_2, include, work in prepared:
        result = results[cell["name"]]
        done = by_cell.get(cell["name"], [])
        result["sims"] = sum(d["attempts"] for d in done)
        result["simCpuSeconds"] = round(sum(d["seconds"] for d in done), 1)
        failed = [d for d in done if not d["ok"]]
        if failed:
            result["reason"] = "%d of %d units failed; first: %s: %s" % (
                len(failed), len(done), cc.unit_id(failed[0]["unit"]), failed[0]["reason"])
            log("cell %s: FAILED: %s" % (cell["name"], result["reason"]))
            continue
        arcs, caps = cc.assemble_cell(cell, [(d["unit"], d["tables"], d["caps"]) for d in done])
        result.update({"status": "ok", "rawArcs": arcs, "rawCaps": caps, "warnings": check_tables(arcs)})
        log("cell %s: ok (%d units, %.0f s cpu)" % (cell["name"], len(done), result["simCpuSeconds"]))
    return results, wall


def write_timing_csv(path, arcs_raw, arcs_cal, caps_raw, caps_cal, index_1, index_2):
    with open(path, "w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["output", "input", "timing_sense", "quantity", "slew_ns", "load_pf", "raw", "calibrated"])
        for raw, cal in zip(arcs_raw, arcs_cal):
            for q in cc.QUANTITIES:
                for i, slew in enumerate(index_1):
                    for j, load in enumerate(index_2[raw["output"]]):
                        writer.writerow([raw["output"], raw["input"], raw["sense"], q, slew, load,
                                         "%.6g" % raw["tables"][q][i][j],
                                         "" if cal is None else "%.6g" % cal["tables"][q][i][j]])
        for pin in sorted(caps_raw):
            for q in cc.CAP_QUANTITIES:
                writer.writerow(["", pin, "", q, "", "", "%.6g" % caps_raw[pin][q],
                                 "" if caps_cal is None else "%.6g" % caps_cal[pin][q]])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("job")
    parser.add_argument("--reference-lib", required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--calibration", help="calibration.json from calibrate.py (required for a measured Liberty)")
    group.add_argument("--uncalibrated", action="store_true", help="diagnostics only: write custom.uncalibrated.lib")
    parser.add_argument("--out", required=True)
    parser.add_argument("--jobs", type=int, default=os.cpu_count() or 4)
    parser.add_argument("--ngspice", default="ngspice")
    parser.add_argument("--full-models", action="store_true", help="load the whole sky130 tt library (slow)")
    parser.add_argument("--library-name", default="custom_measured")
    parser.add_argument("--netlist-kind", choices=("extracted", "pre-layout"), default="extracted",
                        help="pre-layout: abstract-layout cells; needs a pre-layout calibration and writes custom.modelled.lib")
    args = parser.parse_args(argv)
    args.out = os.path.abspath(args.out)
    os.makedirs(args.out, exist_ok=True)
    summary = {"schema": "hima-cellchar-result/1", "method": cc.METHOD, "methodFingerprint": cc.method_fingerprint(),
               "job": os.path.abspath(args.job), "referenceLib": args.reference_lib, "cells": [],
               "liberty": None, "refused": None}
    out_json = os.path.join(args.out, "characterization.json")

    def refuse(reason):
        summary["refused"] = reason
        with open(out_json, "w") as handle:
            json.dump(summary, handle, indent=2)
        print("REFUSED: %s" % reason, file=sys.stderr)
        return 2

    factors = None
    if args.calibration:
        try:
            with open(args.calibration) as handle:
                calibration = json.load(handle)
        except (OSError, ValueError) as error:
            return refuse("calibration %s unreadable: %s" % (args.calibration, error))
        reason = cc.calibration_gate(calibration, cc.method_fingerprint())
        summary["calibration"] = {"file": os.path.abspath(args.calibration), "sha256": sha256(args.calibration),
                                  "factors": calibration.get("factors"), "residual": calibration.get("residual"),
                                  "tolerance": calibration.get("tolerance")}
        if reason:
            return refuse(reason)
        if calibration.get("netlistKind", "extracted") != args.netlist_kind:
            return refuse("calibration %s is for %s netlists, this job is %s" % (
                args.calibration, calibration.get("netlistKind", "extracted"), args.netlist_kind))
        if args.netlist_kind == "pre-layout" and calibration.get("prelayoutParasitics") != cc.PRELAYOUT_PARASITICS:
            return refuse("calibration %s used another pre-layout parasitic estimate; rerun calibrate.py --netlist pre-layout" % args.calibration)
        factors = calibration["factors"]
    try:
        with open(args.job) as handle:
            job = json.load(handle)
        cells = [cc.normalize_cell(c) for c in job.get("cells") or []]
    except (OSError, ValueError, cc.CharError) as error:
        return refuse("job %s: %s" % (args.job, error))
    if not cells:
        return refuse("job %s lists no cells" % args.job)
    if args.netlist_kind == "pre-layout":
        # schematic netlists get the same parasitic estimate the pre-layout calibration used
        os.makedirs(os.path.join(args.out, "prelayout"), exist_ok=True)
        for cell in cells:
            target = os.path.join(args.out, "prelayout", cell["name"] + ".sp")
            try:
                with open(cell["spice"]) as handle:
                    text = cc.add_prelayout_parasitics(handle.read(), cell["subckt"], cell["inputs"])
            except (OSError, cc.CharError) as error:
                return refuse("cell %s: %s" % (cell["name"], error))
            with open(target, "w") as handle:
                handle.write(text)
            cell["spice"] = target
    names = [c["name"] for c in cells]
    if len(set(names)) != len(names):
        return refuse("job lists a cell name twice")
    with open(args.reference_lib) as handle:
        lib_text = handle.read()
    started = time.time()
    results, sim_wall = characterize(cells, lib_text, args.out, args.jobs, args.ngspice, cc.METHOD, args.full_models)
    prelayout = args.netlist_kind == "pre-layout"
    banner = (cc.BANNER_PRELAYOUT if prelayout else cc.BANNER) if factors else cc.BANNER_RAW
    summary["netlistKind"] = args.netlist_kind
    groups = []
    for cell in cells:
        result = results[cell["name"]]
        entry = {k: v for k, v in result.items() if k not in ("rawArcs", "rawCaps")}
        if result["status"] == "ok":
            arcs_raw, caps_raw = result["rawArcs"], result["rawCaps"]
            arcs_cal, caps_cal = (cc.apply_factors(arcs_raw, caps_raw, factors) if factors else (None, None))
            write_timing_csv(os.path.join(args.out, cell["name"] + ".timing.csv"), arcs_raw,
                             arcs_cal or [None] * len(arcs_raw), caps_raw, caps_cal, result["index_1"], result["index_2"])
            entry["arcs"] = [{"output": a["output"], "input": a["input"], "timing_sense": a["sense"],
                              "vectors": a["vectors"]} for a in arcs_raw]
            entry["capacitance"] = caps_cal or caps_raw
            entry["calibrationFactorsApplied"] = factors
            entry["timingCsv"] = cell["name"] + ".timing.csv"
            comment = "cellchar %s method %s; netlist sha256 %s" % (cc.METHOD["version"], cc.method_fingerprint(),
                                                                    result["spiceSha256"][:16])
            groups.append(cc.liberty_cell(cell, arcs_cal or arcs_raw, caps_cal or caps_raw, result["index_1"],
                                          result["index_2"], banner, comment))
        summary["cells"].append(entry)
    if groups:
        stem = ("custom.modelled" if prelayout else "custom.measured") if factors else "custom.uncalibrated"
        with open(os.path.join(args.out, stem + ".lib"), "w") as handle:
            handle.write("/* %s; cell groups only: merge into the platform Liberty */\n\n" % banner)
            handle.write("\n".join(groups))
        with open(os.path.join(args.out, stem + ".standalone.lib"), "w") as handle:
            handle.write(cc.standalone_library(args.library_name, groups))
        summary["liberty"] = stem + ".lib"
    ok = sum(1 for c in summary["cells"] if c["status"] == "ok")
    summary["wallSeconds"] = round(time.time() - started, 1)
    summary["simWallSeconds"] = round(sim_wall, 1)
    summary["jobs"] = args.jobs
    summary["ok"], summary["failed"] = ok, len(cells) - ok
    with open(out_json, "w") as handle:
        json.dump(summary, handle, indent=2)
    print("characterized %d/%d cells in %.1f s (%d workers) -> %s" % (ok, len(cells), summary["wallSeconds"], args.jobs,
                                                                      summary["liberty"] or "no Liberty"))
    return 0 if ok == len(cells) else 1


if __name__ == "__main__":
    sys.exit(main())
