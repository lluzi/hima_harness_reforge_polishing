#!/usr/bin/env python3
"""Read the gm/Id characterization summary (hima-gmid-tables/1) written by characterize.

argv: read-tables.py <REPORT> <OUT>. tables_valid is one when both PDKs have a usable curve for
every device type and characterized length; tables_curves counts the curves.
"""
import json
import sys


def main(report_path, out_path):
    doc = json.load(open(report_path))
    if doc.get("schema") != "hima-gmid-tables/1":
        raise ValueError("not a hima-gmid-tables/1 summary")
    expected, curves = doc["expected"], doc["curves"]
    values = [
        {"type": "tables_valid", "unit": "count", "value": 1 if curves == expected and curves > 0 else 0},
        {"type": "tables_curves", "unit": "count", "value": curves},
    ]
    with open(out_path, "x") as stream:
        json.dump({"values": values}, stream)


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2])
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
