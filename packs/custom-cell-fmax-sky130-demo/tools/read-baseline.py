#!/usr/bin/env python3
"""Read the stock baseline record (hima-cellfmax-arm/1, arm "baseline") written by the baseline tool.

argv: read-baseline.py <REPORT> <OUT>. Every value comes from the record's ORFS-derived fields; an
unfinished run states its numbers as unknown with the failure, never as zero.
"""
import json
import sys


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def main(report_path, out_path):
    record = json.load(open(report_path))
    if record.get("schema") != "hima-cellfmax-arm/1" or record.get("arm") != "baseline":
        raise ValueError("not a hima-cellfmax-arm/1 baseline record")
    finished = record.get("finished") is True
    reason = None if finished else "baseline ORFS run did not finish: %s" % record.get("failure")
    drc = record.get("routeDrc") if finished and number(record.get("routeDrc")) else None
    valid = 1 if finished and drc == 0 else 0

    def value(kind, unit, number_value):
        item = {"type": kind, "unit": unit, "value": number_value}
        if number_value is None:
            item["unknownReason"] = reason or "the ORFS metric is absent from the record"
        return item

    values = [
        {"type": "baseline_valid", "unit": "count", "value": valid},
        value("baseline_fmax_mhz", "mhz", record.get("fmaxMhz") if finished else None),
        value("baseline_wns_ns", "ns", record.get("wnsNs") if finished else None),
        value("baseline_drc", "count", drc),
    ]
    with open(out_path, "x") as stream:
        json.dump({"values": values}, stream)


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2])
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
