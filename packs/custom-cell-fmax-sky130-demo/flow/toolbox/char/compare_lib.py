#!/usr/bin/env python3
"""Compare one cell between two Liberty files, point by point (ratio = B / A).

    python3 compare_lib.py A.lib CELL_A B.lib CELL_B [--json out.json]

Prints, per arc (related pin -> output, timing sense) and quantity, the min / median / max ratio over
the 7x7 table, then the input capacitances. Tables are compared by position, so both cells must use
the same index (characterize.py with index_ref = the cell A was modelled on).
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import charcore as cc  # noqa: E402


def compare_cells(a, b):
    rows = []
    for arc_a in a["arcs"]:
        key = (arc_a["output"], arc_a["input"], arc_a["sense"])
        match = [x for x in b["arcs"] if (x["output"], x["input"], x["sense"]) == key]
        if not match:
            rows.append({"arc": "%s->%s %s" % (key[1], key[0], key[2]), "missing": True})
            continue
        for q in cc.QUANTITIES:
            ta, tb = arc_a["tables"].get(q), match[0]["tables"].get(q)
            if not ta or not tb:
                continue
            ratios = [vb / va for ra, rb in zip(ta, tb) for va, vb in zip(ra, rb) if va]
            rows.append({"arc": "%s->%s %s" % (key[1], key[0], key[2]), "quantity": q,
                         "min": min(ratios), "median": cc.median(ratios), "max": max(ratios)})
    for pin, info in sorted(a["pins"].items()):
        if info["direction"] != "input" or pin not in b["pins"]:
            continue
        for q in ("capacitance",) + cc.CAP_QUANTITIES:
            if info.get(q) and b["pins"][pin].get(q):
                rows.append({"arc": pin, "quantity": q, "a": info[q], "b": b["pins"][pin][q],
                             "ratio": b["pins"][pin][q] / info[q]})
    return rows


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("lib_a")
    parser.add_argument("cell_a")
    parser.add_argument("lib_b")
    parser.add_argument("cell_b")
    parser.add_argument("--json")
    args = parser.parse_args(argv)
    a = cc.read_cell(open(args.lib_a).read(), args.cell_a)
    b = cc.read_cell(open(args.lib_b).read(), args.cell_b)
    rows = compare_cells(a, b)
    print("ratio B/A: A = %s (%s), B = %s (%s)" % (args.cell_a, args.lib_a, args.cell_b, args.lib_b))
    for row in rows:
        if row.get("missing"):
            print("%-22s missing in B" % row["arc"])
        elif "ratio" in row:
            print("%-22s %-17s A %.5f pF  B %.5f pF  ratio %.3f" % (row["arc"], row["quantity"], row["a"], row["b"], row["ratio"]))
        else:
            print("%-22s %-17s min %.3f  median %.3f  max %.3f" % (row["arc"], row["quantity"], row["min"], row["median"], row["max"]))
    if args.json:
        with open(args.json, "w") as handle:
            json.dump(rows, handle, indent=2)
    return 0


if __name__ == "__main__":
    sys.exit(main())
