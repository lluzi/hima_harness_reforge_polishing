#!/usr/bin/env python3
"""Read the device tables record (hima-bandgap-tables/1) written by characterize.

argv: read-tables.py <REPORT> <OUT>. tables_valid is one when every characterized transistor length
has a gm/Id curve and the PNP and the resistor are tabulated at the same corners.
"""
import json
import sys


def main(report_path, out_path):
    record = json.load(open(report_path))
    if record.get("schema") != "hima-bandgap-tables/1":
        raise ValueError("not a hima-bandgap-tables/1 record")
    complete = (record["curves"] == record["expected"] and record["curves"] > 0 and record["pnpCorners"]
                and record["pnpCorners"] == record["resCorners"])
    values = [{"type": "tables_valid", "unit": "count", "value": 1 if complete else 0},
              {"type": "tables_curves", "unit": "count", "value": record["curves"]}]
    with open(out_path, "x") as stream:
        json.dump({"values": values}, stream)


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2])
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
