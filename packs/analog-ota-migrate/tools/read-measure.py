#!/usr/bin/env python3
"""Read an OTA measurement (hima-ota-measure/1) written by a simulate step.

argv: read-measure.py <REPORT> <OUT>. Every value is the worst corner's: the lowest gain, unity-gain
frequency and phase margin, the highest power; saturated is one only when every device is saturated
at every corner. A measurement the simulator did not produce is unknown, never a number.
"""
import json
import sys


def values_of(worst, area, reason):
    def value(kind, unit, number):
        item = {"type": kind, "unit": unit, "value": number}
        if number is None:
            item["unknownReason"] = reason
        return item
    sat = worst.get("saturated")
    return [
        value("gain_db", "db", worst.get("gainDb")),
        value("gbw_mhz", "mhz", worst.get("gbwMhz")),
        value("pm_deg", "deg", worst.get("pmDeg")),
        value("power_uw", "uw", worst.get("powerUw")),
        value("saturated", "count", None if sat is None else (1 if sat else 0)),
        value("area_um2", "um2", area),
    ]


def main(report_path, out_path):
    record = json.load(open(report_path))
    if record.get("schema") != "hima-ota-measure/1":
        raise ValueError("not a hima-ota-measure/1 record")
    values = values_of(record["worst"], record.get("areaUm2"), "the simulator did not produce it at every corner")
    with open(out_path, "x") as stream:
        json.dump({"values": values}, stream)


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2])
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
