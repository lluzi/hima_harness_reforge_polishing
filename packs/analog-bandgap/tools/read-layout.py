#!/usr/bin/env python3
"""Read the layout record (hima-bandgap-layout/1) written by the layout step.

argv: read-layout.py <REPORT> <OUT>. layout_clean is one when both DRC decks report zero errors and
both LVS checks match; then the counts and the cell area. The die-level density rules need fill and
are reported in the record, not judged.
"""
import json
import sys


def main(report_path, out_path):
    r = json.load(open(report_path))
    if r.get("schema") != "hima-bandgap-layout/1":
        raise ValueError("not a hima-bandgap-layout/1 record")
    clean = r["drcMagic"] == 0 and r["drcKlayout"] == 0 and r["lvsNetgen"] is True and r["lvsKlayout"] is True
    values = [
        {"type": "layout_clean", "unit": "count", "value": 1 if clean else 0},
        {"type": "drc_errors", "unit": "count", "value": r["drcMagic"] + r["drcKlayout"]},
        {"type": "lvs_match", "unit": "count", "value": int(r["lvsNetgen"] is True) + int(r["lvsKlayout"] is True)},
        {"type": "layout_area_um2", "unit": "um2", "value": r.get("areaUm2"),
         **({} if r.get("areaUm2") is not None else {"unknownReason": "the layout tool reported no cell size"})},
    ]
    with open(out_path, "x") as stream:
        json.dump({"values": values}, stream)


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2])
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
