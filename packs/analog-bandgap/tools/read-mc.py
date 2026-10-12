#!/usr/bin/env python3
"""Read the Monte Carlo record (hima-bandgap-mc/1).

argv: read-mc.py <REPORT> <OUT>. mc_in_band is one when mean +/- 3 sigma of VBG lies inside the
reference band; then the run count, mean, sigma and the 3-sigma edges, all from the simulator's
per-run VBG.
"""
import json
import sys


def main(report_path, out_path):
    record = json.load(open(report_path))
    if record.get("schema") != "hima-bandgap-mc/1":
        raise ValueError("not a hima-bandgap-mc/1 record")
    s = record["stats"]
    values = [
        {"type": "mc_in_band", "unit": "count", "value": 1 if s["inBand"] else 0},
        {"type": "mc_runs", "unit": "count", "value": s["n"]},
        {"type": "mc_mean_v", "unit": "v", "value": round(s["meanV"], 6)},
        {"type": "mc_sigma_mv", "unit": "mv", "value": round(1e3 * s["sigmaV"], 4)},
        {"type": "mc_lo3_v", "unit": "v", "value": round(s["lo3V"], 6)},
        {"type": "mc_hi3_v", "unit": "v", "value": round(s["hi3V"], 6)},
    ]
    with open(out_path, "x") as stream:
        json.dump({"values": values}, stream)


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2])
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
