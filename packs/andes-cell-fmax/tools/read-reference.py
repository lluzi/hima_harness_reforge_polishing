#!/usr/bin/env python3
"""Read the reference build record (hima-andes-build/1, kind reference) written by reference-build.

argv: read-reference.py <REPORT> <OUT>. Values come from the sapr post-route summary the record
copies; a build that did not finish states its numbers as unknown with the failure, never as zero.
"""
import json
import sys


def main(report_path, out_path):
    record = json.load(open(report_path))
    if record.get("schema") != "hima-andes-build/1" or record.get("kind") != "reference":
        raise ValueError("not a hima-andes-build/1 reference record")
    finished = record.get("finished") is True
    reason = "the reference build did not finish: %s" % record.get("failure")

    def value(kind, unit, number):
        item = {"type": kind, "unit": unit, "value": number if finished else None}
        if item["value"] is None:
            item["unknownReason"] = reason if not finished else "the sapr summary has no %s" % kind
        return item

    drc = record.get("routeDrcErrors")
    values = [
        {"type": "reference_valid", "unit": "count", "value": 1 if finished and drc == 0 else 0},
        value("design_fmax_mhz", "mhz", record.get("fmaxMhz")),
        value("design_wns_ns", "ns", record.get("wnsNs")),
        value("design_tns_ns", "ns", record.get("tnsNs")),
        value("design_area_um2", "um2", record.get("areaUm2")),
        value("new_cell_instances", "count", 0),
        value("route_drc_errors", "count", drc),
    ]
    with open(out_path, "x") as stream:
        json.dump({"values": values}, stream)


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2])
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
