#!/usr/bin/env python3
"""Read the round record (hima-ota-round/1) written by record-round.

argv: read-round.py <REPORT> <OUT>. The judged values are round_valid (the constraint) and
target_margin_pct (the Goal: the migrated OTA's worst normalized margin over the four spec lines,
at least zero when every line is met), then the per-line values. The converge read
best_margin_pct is the best margin of a valid round so far, and -100 (every line fully missed)
before the first valid round. A value the round does not have is unknown with its own reason.
"""
import json
import sys


def main(report_path, out_path):
    record = json.load(open(report_path))
    if record.get("schema") != "hima-ota-round/1":
        raise ValueError("not a hima-ota-round/1 record")
    target = record.get("target")
    problems = "; ".join(record.get("problems") or []) or "unknown"
    absent = "no migrated OTA this round: %s" % problems

    def value(kind, unit, number, why):
        item = {"type": kind, "unit": unit, "value": number}
        if number is None:
            item["unknownReason"] = why
        return item

    worst = (target or {}).get("worst") or {}
    measured = absent if target is None else "the simulator did not produce it at every target corner"
    sat = worst.get("saturated")
    values = [
        {"type": "round_valid", "unit": "count", "value": 1 if record.get("roundValid") is True else 0},
        value("target_margin_pct", "percent", record.get("targetMarginPct"), measured),
        value("specs_met", "count", None if target is None else target["specsMet"], absent),
        {"type": "best_margin_pct", "unit": "percent", "value": record["bestMarginPct"]},
        {"type": "round_improved", "unit": "count", "value": 1 if record.get("roundImproved") is True else 0},
        value("gain_db", "db", worst.get("gainDb"), measured),
        value("gbw_mhz", "mhz", worst.get("gbwMhz"), measured),
        value("pm_deg", "deg", worst.get("pmDeg"), measured),
        value("power_uw", "uw", worst.get("powerUw"), measured),
        value("saturated", "count", None if sat is None else (1 if sat else 0), measured),
        value("area_um2", "um2", None if target is None else target["areaUm2"], absent),
    ]
    with open(out_path, "x") as stream:
        json.dump({"values": values}, stream)


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2])
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
