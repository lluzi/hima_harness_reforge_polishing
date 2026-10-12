#!/usr/bin/env python3
"""Read a bandgap measurement (hima-bandgap-measure/1): the schematic's or the extracted layout's.

argv: read-measure.py <REPORT> <OUT>. meets_spec is one when every spec line meets the spec sheet at
its worst corner (unknown when a line is unknown at some corner); worst_margin_pct is the worst
normalized margin over the lines; then each line's worst value over every process corner,
temperature and supply. A loop with no unity-gain crossing or a copy that did not start is a miss,
never a pass.
"""
import json
import sys


def main(report_path, out_path):
    record = json.load(open(report_path))
    if record.get("schema") != "hima-bandgap-measure/1":
        raise ValueError("not a hima-bandgap-measure/1 record")
    worst = record["worst"]
    margins = [m for m in record["marginPct"].values()]
    why = "the simulator did not produce it at every corner"

    def value(kind, unit, number):
        item = {"type": kind, "unit": unit, "value": number}
        if number is None:
            item["unknownReason"] = why
        return item

    benches = record["benches"]
    met = record.get("meetsSpec")
    values = [
        {"type": "meets_spec", "unit": "count", "value": None if met is None else (1 if met else 0),
         **({"unknownReason": "a spec line is unknown at some corner"} if met is None else {})},
        value("worst_margin_pct", "percent", None if None in margins else round(min(margins), 2)),
        value("vbg_min_v", "v", min(b["vbgMinV"] for b in benches)),
        value("vbg_max_v", "v", max(b["vbgMaxV"] for b in benches)),
        value("iq_ua", "ua", worst["iq"]["value"]),
        value("isd_na", "na", worst["isd"]["value"]),
        value("tc_ppm", "ppm", worst["tc"]["value"]),
        value("pm_deg", "deg", worst["pm"]["value"]),
        value("tstart_us", "us", worst["start"]["value"]),
        value("psrr_db", "db", worst["psrr"]["value"]),
    ]
    with open(out_path, "x") as stream:
        json.dump({"values": values}, stream)


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2])
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
