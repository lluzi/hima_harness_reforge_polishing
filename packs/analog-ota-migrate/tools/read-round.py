#!/usr/bin/env python3
"""Read the round record (hima-ota-round/1) written by record-round.

argv: read-round.py <REPORT> <OUT>. The judged values are round_valid and the migrated OTA's
worst-corner gain, unity-gain frequency, phase margin and power; the converge read is
best_margin_pct. When the source missed the spec the round has no migrated OTA: its values are
unknown with that reason.
"""
import json
import sys


def main(report_path, out_path):
    record = json.load(open(report_path))
    if record.get("schema") != "hima-ota-round/1":
        raise ValueError("not a hima-ota-round/1 record")
    target = record.get("target")
    reason = "no migrated OTA this round: %s" % "; ".join(record.get("problems") or ["unknown"])

    def value(kind, unit, number, why=reason):
        item = {"type": kind, "unit": unit, "value": number}
        if number is None:
            item["unknownReason"] = why
        return item

    worst = (target or {}).get("worst") or {}
    sat = worst.get("saturated")
    values = [
        {"type": "round_valid", "unit": "count", "value": 1 if record.get("roundValid") is True else 0},
        value("specs_met", "count", None if target is None else target["specsMet"]),
        value("target_margin_pct", "percent", record.get("targetMarginPct")),
        value("best_margin_pct", "percent", record.get("bestMarginPct"), "no valid round yet"),
        {"type": "round_improved", "unit": "count", "value": 1 if record.get("roundImproved") is True else 0},
        value("gain_db", "db", worst.get("gainDb")),
        value("gbw_mhz", "mhz", worst.get("gbwMhz")),
        value("pm_deg", "deg", worst.get("pmDeg")),
        value("power_uw", "uw", worst.get("powerUw")),
        value("saturated", "count", None if sat is None else (1 if sat else 0)),
        value("area_um2", "um2", None if target is None else target["areaUm2"]),
    ]
    with open(out_path, "x") as stream:
        json.dump({"values": values}, stream)


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2])
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
