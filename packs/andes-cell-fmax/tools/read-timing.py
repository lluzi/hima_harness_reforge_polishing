#!/usr/bin/env python3
"""Read the HimaTime load of the build a round starts from (hima-andes-timing/1).

argv: read-timing.py <REPORT> <OUT>. timing_critical_families counts the stock families with a
positive estimated slack recovery in HimaTime's stage breakdown: the candidates for new cells.
"""
import json
import sys


def main(report_path, out_path):
    record = json.load(open(report_path))
    if record.get("schema") != "hima-andes-timing/1":
        raise ValueError("not a hima-andes-timing/1 record")
    rows = record.get("stageBreakdown") or []
    critical = sum(1 for r in rows if r.get("estRecoveryNs", 0) > 0 and not r.get("generated"))
    values = [
        {"type": "timing_loaded", "unit": "count", "value": 1},
        {"type": "timing_fmax_mhz", "unit": "mhz", "value": record["fmaxMhz"]},
        {"type": "timing_wns_ns", "unit": "ns", "value": record["wnsNs"]},
        {"type": "timing_critical_families", "unit": "count", "value": critical},
    ]
    with open(out_path, "x") as stream:
        json.dump({"values": values}, stream)


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2])
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
