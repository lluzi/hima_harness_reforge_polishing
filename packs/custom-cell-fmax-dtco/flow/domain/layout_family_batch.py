#!/usr/bin/env python3
"""Lay out independent Boolean families concurrently and reuse D1 placement across drives."""
from __future__ import annotations

import argparse
import concurrent.futures
import json
import subprocess
import time
from pathlib import Path

DRIVES = ("D1", "D2", "D4", "D6", "D8")


def run_cell(row, args, *, columns=None, source_cell=None):
    out = Path(row["out"])
    out.mkdir(parents=True, exist_ok=False)
    argv = [args.python, args.abstract_cell, "--netlist", row["netlist"],
            "--tech", args.tech, "--rule-deck", args.rule_deck,
            "--power-pin", args.power_pin, "--ground-pin", args.ground_pin,
            "--drive-scale", str(row["drive_scale"]),
            "--placement-timeout", str(args.placement_timeout), "-o", str(out)]
    if columns is not None:
        argv += ["--placement-columns", str(columns),
                 "--placement-source-cell", str(source_cell)]
    log = out.parent / (row["cell"] + ".layout.log")
    started = time.monotonic()
    try:
        completed = subprocess.run(argv, text=True, stdout=subprocess.PIPE,
                                   stderr=subprocess.STDOUT, timeout=args.cell_timeout,
                                   env=None, check=False)
        code, output = completed.returncode, completed.stdout or ""
    except subprocess.TimeoutExpired as error:
        code = 124
        output = (error.stdout or "") + "\nlayout cell timeout\n"
    log.write_text(output)
    meta = out / (row["cell"] + ".abstract.json")
    lef = out / (row["cell"] + ".lef")
    return {"cell_name": row["cell"], "drive": row["drive"], "family": row["family"],
            "argv": argv, "returncode": code, "elapsed_seconds": time.monotonic() - started,
            "log": str(log), "meta": str(meta), "lef": str(lef),
            "complete": code == 0 and meta.is_file() and lef.is_file()}


def run_family(rows, args):
    by_drive = {row["drive"]: row for row in rows}
    if set(by_drive) != set(DRIVES) or len(rows) != len(DRIVES):
        raise ValueError("layout family must contain exactly D1/D2/D4/D6/D8")
    base = run_cell(by_drive["D1"], args)
    results = [base]
    if not base["complete"]:
        for drive in DRIVES[1:]:
            row = by_drive[drive]
            results.append({"cell_name": row["cell"], "drive": drive,
                            "family": row["family"], "argv": [], "returncode": 125,
                            "elapsed_seconds": 0.0, "log": base["log"],
                            "meta": str(Path(row["out"]) / (row["cell"] + ".abstract.json")),
                            "lef": str(Path(row["out"]) / (row["cell"] + ".lef")),
                            "complete": False,
                            "diagnostic": "D1 topology placement failed"})
        return results
    columns = json.loads(Path(base["meta"]).read_text()).get("columns")
    if isinstance(columns, bool) or not isinstance(columns, int) or columns < 1:
        raise ValueError("D1 abstract metadata has no positive placement column count")
    for drive in DRIVES[1:]:
        results.append(run_cell(by_drive[drive], args, columns=columns,
                                source_cell=by_drive["D1"]["cell"]))
    return results


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--result", required=True)
    parser.add_argument("--abstract-cell", required=True)
    parser.add_argument("--python", default="/usr/bin/python3")
    parser.add_argument("--tech", required=True)
    parser.add_argument("--rule-deck", required=True)
    parser.add_argument("--power-pin", required=True)
    parser.add_argument("--ground-pin", required=True)
    parser.add_argument("--placement-timeout", required=True, type=int)
    parser.add_argument("--cell-timeout", required=True, type=int)
    parser.add_argument("--workers", required=True, type=int)
    args = parser.parse_args()
    if not 1 <= args.workers <= 5:
        parser.error("workers must be within 1..5")
    rows = json.loads(Path(args.manifest).read_text())
    if not isinstance(rows, list) or not rows:
        parser.error("manifest must be a nonempty array")
    families = {}
    for row in rows:
        if not isinstance(row, dict) or set(row) != {
                "cell", "drive", "drive_scale", "family", "netlist", "out"}:
            parser.error("manifest row is malformed")
        families.setdefault(row["family"], []).append(row)
    by_cell = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        pending = {executor.submit(run_family, rows, args): family
                   for family, rows in sorted(families.items())}
        for future in concurrent.futures.as_completed(pending):
            family = pending[future]
            try:
                result = future.result()
            except Exception as error:  # retain one family failure without hiding the rest
                result = []
                for row in families[family]:
                    result.append({"cell_name": row["cell"], "drive": row["drive"],
                                   "family": family, "argv": [], "returncode": 126,
                                   "elapsed_seconds": 0.0, "log": None,
                                   "meta": str(Path(row["out"]) / (row["cell"] + ".abstract.json")),
                                   "lef": str(Path(row["out"]) / (row["cell"] + ".lef")),
                                   "complete": False, "diagnostic": str(error)})
            for row in result:
                if row["cell_name"] in by_cell:
                    raise SystemExit("layout batch repeated a Cell")
                by_cell[row["cell_name"]] = row
    ordered = [by_cell[row["cell"]] for row in rows]
    Path(args.result).write_text(json.dumps({
        "schema": "hima.layout-family-batch/1", "workers": args.workers,
        "family_count": len(families), "cell_count": len(rows), "results": ordered,
    }, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
