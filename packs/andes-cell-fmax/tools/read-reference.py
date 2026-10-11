#!/usr/bin/env python3
"""Read the reference build record (hima-andes-build/2, kind reference) written by reference-build.

argv: read-reference.py <REPORT> <OUT>. Values come from the sapr summary the record copies: the
build's timing at the end of route, path group reg2reg. A build that did not finish states its
numbers as unknown with the failure, never as zero.
"""
import json
import sys


def main(report_path, out_path):
    record = json.load(open(report_path))
    if record.get("schema") != "hima-andes-build/2" or record.get("kind") != "reference":
        raise ValueError("not a hima-andes-build/2 reference record")
    finished = record.get("finished") is True and record.get("wnsNs") is not None
    reason = "the reference build did not finish: %s" % record.get("failure")

    def value(kind, unit, number):
        item = {"type": kind, "unit": unit, "value": number if finished else None}
        if item["value"] is None:
            item["unknownReason"] = reason if not finished else "the sapr summary has no %s" % kind
        return item

    wns = record.get("wnsNs")
    values = [
        {"type": "reference_valid", "unit": "count", "value": 1 if finished else 0},
        value("design_wns_ps", "ps", None if wns is None else round(1000.0 * wns, 3)),
        value("design_tns_ns", "ns", record.get("tnsNs")),
        value("design_nvp", "count", record.get("nvp")),
        value("design_density_pct", "percent", record.get("densityPct")),
        value("new_cell_instances", "count", int(record.get("customCells") or 0)),
        value("new_cell_pct", "percent", record.get("customCellsPct") or 0.0),
    ]
    with open(out_path, "x") as stream:
        json.dump({"values": values}, stream)


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2])
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
