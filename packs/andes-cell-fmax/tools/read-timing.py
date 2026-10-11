#!/usr/bin/env python3
"""Read the HimaTime load of the build a round starts from (hima-andes-timing/2).

argv: read-timing.py <REPORT> <OUT>. timing_wns_ps is that build's reg2reg worst slack at the end
of route; timing_high_value_cells the cells HimaTime's high-value analysis lists.
"""
import json
import sys


def main(report_path, out_path):
    record = json.load(open(report_path))
    if record.get("schema") != "hima-andes-timing/2":
        raise ValueError("not a hima-andes-timing/2 record")
    listed = (record.get("highValue") or {}).get("listed_cells")
    values = [
        {"type": "timing_loaded", "unit": "count", "value": 1},
        {"type": "timing_wns_ps", "unit": "ps", "value": round(1000.0 * record["wnsNs"], 3)},
        {"type": "timing_high_value_cells", "unit": "count", "value": listed},
    ]
    if listed is None:
        values[-1]["unknownReason"] = "HimaTime's high-value analysis listed no cells"
    with open(out_path, "x") as stream:
        json.dump({"values": values}, stream)


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2])
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
