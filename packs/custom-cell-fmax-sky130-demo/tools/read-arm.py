#!/usr/bin/env python3
"""Read one measured arm record (hima-cellfmax-arm/1) written by the arm tool.

argv: read-arm.py <REPORT> <OUT>. An arm that did not finish reads arm_finished 0 and states every
other value as unknown with the failure; nothing is substituted.
"""
import json
import sys


def main(report_path, out_path):
    record = json.load(open(report_path))
    if record.get("schema") != "hima-cellfmax-arm/1" or record.get("arm") not in ("custom", "control"):
        raise ValueError("not a hima-cellfmax-arm/1 custom or control record")
    finished = record.get("finished") is True
    reason = "the %s arm did not finish: %s" % (record["arm"], record.get("failure"))

    def value(kind, unit, key):
        number = record.get(key) if finished else None
        item = {"type": kind, "unit": unit, "value": number}
        if number is None:
            item["unknownReason"] = reason if not finished else "%s is absent from the arm record" % key
        return item

    values = [
        {"type": "arm_finished", "unit": "count", "value": 1 if finished else 0},
        value("arm_fmax_mhz", "mhz", "fmaxMhz"),
        value("arm_route_drc", "count", "routeDrc"),
        value("arm_custom_instances", "count", "customInstanceTotal"),
        value("arm_forbidden_instances", "count", "forbiddenInstanceTotal"),
    ]
    with open(out_path, "x") as stream:
        json.dump({"values": values}, stream)


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2])
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
