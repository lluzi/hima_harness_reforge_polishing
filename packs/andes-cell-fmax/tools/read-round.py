#!/usr/bin/env python3
"""Read the round record (hima-andes-round/2) written by compare-round.

argv: read-round.py <REPORT> <OUT>. The judged values are round_valid, new_cell_instances,
round_improved and best_gain_pct; the converge read is best_wns_ps. The design_* values are the
custom-cell build's at the end of route (reg2reg), for the table beside the reference build's.
"""
import json
import sys


def main(report_path, out_path):
    record = json.load(open(report_path))
    if record.get("schema") != "hima-andes-round/2":
        raise ValueError("not a hima-andes-round/2 record")
    valid = record.get("roundValid") is True
    build = record.get("build") or {}
    invalid = "the round is not valid: %s" % "; ".join(record.get("problems") or ["unknown"])

    def value(kind, unit, number, reason=invalid):
        item = {"type": kind, "unit": unit, "value": number}
        if number is None:
            item["unknownReason"] = reason
        return item

    wns = build.get("wnsNs")
    values = [
        {"type": "round_valid", "unit": "count", "value": 1 if valid else 0},
        value("timing_gain_pct", "percent", record.get("timingGainPct")),
        value("best_gain_pct", "percent", record.get("bestGainPct"), "no valid round yet"),
        {"type": "round_improved", "unit": "count", "value": 1 if record.get("roundImproved") is True else 0},
        {"type": "best_wns_ps", "unit": "ps", "value": record["bestWnsPs"]},
        value("design_wns_ps", "ps", None if wns is None else round(1000.0 * wns, 3)),
        value("design_tns_ns", "ns", build.get("tnsNs")),
        value("design_nvp", "count", build.get("nvp")),
        value("design_density_pct", "percent", build.get("densityPct")),
        {"type": "new_cell_instances", "unit": "count", "value": int(build.get("customCells") or 0)},
        {"type": "new_cell_pct", "unit": "percent", "value": build.get("customCellsPct") or 0.0},
    ]
    with open(out_path, "x") as stream:
        json.dump({"values": values}, stream)


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2])
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
