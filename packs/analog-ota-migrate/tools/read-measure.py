#!/usr/bin/env python3
"""Read an OTA measurement (hima-ota-measure/1) written by a simulate step.

argv: read-measure.py <REPORT> <OUT>. Every value is the worst corner's: the lowest gain, unity-gain
frequency and phase margin, the highest power; saturated is one only when every device is saturated
at every corner. meets_spec is one when the worst corner meets every line of the spec sheet the
simulate step was given (the Goal) with every device saturated; margin_pct is the worst normalized
margin over the four lines. A measurement the simulator did not produce is unknown, never a number.
"""
import json
import sys


def main(report_path, out_path):
    record = json.load(open(report_path))
    if record.get("schema") != "hima-ota-measure/1":
        raise ValueError("not a hima-ota-measure/1 record")
    worst = record["worst"]
    reason = "the simulator did not produce it at every corner"

    def value(kind, unit, number, why=reason):
        item = {"type": kind, "unit": unit, "value": number}
        if number is None:
            item["unknownReason"] = why
        return item

    sat, meets = worst.get("saturated"), record.get("meetsSpec")
    values = [
        value("meets_spec", "count", None if meets is None else (1 if meets else 0), "a measurement or the saturation is unknown at some corner"),
        value("margin_pct", "percent", record.get("marginPct")),
        value("gain_db", "db", worst.get("gainDb")),
        value("gbw_mhz", "mhz", worst.get("gbwMhz")),
        value("pm_deg", "deg", worst.get("pmDeg")),
        value("power_uw", "uw", worst.get("powerUw")),
        value("saturated", "count", None if sat is None else (1 if sat else 0)),
        value("area_um2", "um2", record.get("areaUm2")),
    ]
    with open(out_path, "x") as stream:
        json.dump({"values": values}, stream)


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2])
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
