#!/usr/bin/env python3
"""Read the round record (hima-andes-round/1) written by compare-round.

argv: read-round.py <REPORT> <OUT>. The judged values are round_valid, new_cell_instances,
round_improved and best_gain_pct; the converge read is best_fmax_mhz. The design_* values are the
new-library build's, for the before/after table beside the reference build's.
"""
import json
import sys


def main(report_path, out_path):
    record = json.load(open(report_path))
    if record.get("schema") != "hima-andes-round/1":
        raise ValueError("not a hima-andes-round/1 record")
    valid = record.get("roundValid") is True
    build = record.get("build") or {}
    invalid = "the round is not valid: %s" % "; ".join(record.get("problems") or ["unknown"])

    def value(kind, unit, number, reason=invalid):
        item = {"type": kind, "unit": unit, "value": number}
        if number is None:
            item["unknownReason"] = reason
        return item

    values = [
        {"type": "round_valid", "unit": "count", "value": 1 if valid else 0},
        value("fmax_gain_pct", "percent", record.get("fmaxGainPct")),
        value("best_gain_pct", "percent", record.get("bestGainPct"), "no valid round yet"),
        {"type": "round_improved", "unit": "count", "value": 1 if record.get("roundImproved") is True else 0},
        {"type": "best_fmax_mhz", "unit": "mhz", "value": record["bestFmaxMhz"]},
        value("design_fmax_mhz", "mhz", build.get("fmaxMhz")),
        value("design_wns_ns", "ns", build.get("wnsNs")),
        value("design_tns_ns", "ns", build.get("tnsNs")),
        value("design_area_um2", "um2", build.get("areaUm2")),
        {"type": "new_cell_instances", "unit": "count", "value": int(build.get("newCellInstances") or 0)},
        value("route_drc_errors", "count", build.get("routeDrcErrors")),
        {"type": "new_families_used", "unit": "count", "value": len(record.get("newFamiliesUsed") or [])},
    ]
    with open(out_path, "x") as stream:
        json.dump({"values": values}, stream)


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2])
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
