#!/usr/bin/env python3
"""Plain-python3 second step of a live QuaLib analysis: turn the vendor child's out/tables.json into a
hima-libinsight-analysis/1 result (mid-grid cell_rise/cell_fall per matching cell).

  python3 analysis/live_inv_delivery.py --prepared <campaign>/state/prepared-request.json \
      --tables out/tables.json --command "<the exact live command>" --out analysis-result.json
"""
import argparse
import hashlib
import json
import os


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepared", required=True)
    parser.add_argument("--tables", required=True)
    parser.add_argument("--command", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--id", default="saed14-inv-live-tables")
    args = parser.parse_args()
    prepared = json.load(open(args.prepared))
    live = json.load(open(args.tables))
    if live["status"] != "ok":
        raise SystemExit("live child did not succeed: %s" % live.get("failure"))
    source = live["source"]
    bound = [s for s in prepared["sources"] if s["path"] == source["path"]]
    if len(bound) != 1 or bound[0]["sha256"] != source["sha256"]:
        raise SystemExit("the live source is not the prepared source bytes")
    to_ns, to_ff = live["units"]["time_s"] / 1e-9, live["units"]["cap_F"] / 1e-15
    rows = []
    for cell in live["cells"]:
        for pin in cell["pins"]:
            for arc in pin["arcs"]:
                kinds = dict((t["kind"], t) for t in arc["tables"])
                if "cell_rise" not in kinds or "cell_fall" not in kinds:
                    continue
                rise, fall = kinds["cell_rise"], kinds["cell_fall"]
                i, j = len(rise["index"][0]) // 2, len(rise["index"][1]) // 2
                at = i * len(rise["index"][1]) + j
                rows.append([cell["name"], pin["name"], arc["related_pin"], cell["area"],
                             rise["index"][0][i] * to_ns, rise["index"][1][j] * to_ff,
                             rise["values"][at] * to_ns, fall["values"][at] * to_ns])
    rows.sort()
    script = os.path.abspath(__file__)
    text = open(script, "rb").read().decode("utf-8")
    tables_path = os.path.relpath(os.path.abspath(args.tables), os.getcwd()).replace(os.sep, "/")
    result = {
        "schema": "hima-libinsight-analysis/1", "id": args.id, "version": 1,
        "question": prepared["request"]["question"],
        "summary": "%d combinational arcs of %d cells read live through the QuaLib 2026 Liberty API from %s; "
                   "mid-grid cell_rise ranges %.4g-%.4g ns." % (len(rows), len(live["cells"]), live["library"],
                                                                min(r[6] for r in rows), max(r[6] for r in rows)),
        "sources": [{"path": source["path"], "kind": "liberty", "sha256Before": source["sha256"],
                     "sha256After": source["sha256After"]}],
        "datasets": {"live_mid_grid": {"columns": [
            {"name": "cell", "type": "string"}, {"name": "pin", "type": "string"}, {"name": "related_pin", "type": "string"},
            {"name": "area", "type": "number", "unit": "library area"}, {"name": "slew_ns", "type": "number", "unit": "ns"},
            {"name": "load_fF", "type": "number", "unit": "fF"}, {"name": "cell_rise_ns", "type": "number", "unit": "ns"},
            {"name": "cell_fall_ns", "type": "number", "unit": "ns"}], "rows": rows}},
        "plots": [{"id": "live-rise-by-cell", "title": "Mid-grid cell_rise by cell (live QuaLib)", "kind": "bar",
                   "dataset": "live_mid_grid", "x": {"column": "cell"}, "y": {"column": "cell_rise_ns", "label": "cell_rise (ns)"}},
                  {"id": "live-table", "title": "Live QuaLib mid-grid tables", "kind": "table", "dataset": "live_mid_grid"}],
        "code": {"main": {"path": os.path.relpath(script, os.getcwd()).replace(os.sep, "/"),
                          "sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(), "text": text},
                 "files": [{"path": "analysis/qualib_inv_tables.py", "sha256": hashlib.sha256(open("analysis/qualib_inv_tables.py", "rb").read()).hexdigest()},
                           {"path": tables_path, "sha256": hashlib.sha256(open(args.tables, "rb").read()).hexdigest()}]},
        "run": {"command": args.command, "exitCode": 0, "elapsedSeconds": live["elapsedSeconds"], "usedQualib": True},
        "assumptions": ["Mid grid is the middle index of each table axis; the grids are not normalized across cells."],
        "limits": ["One TT corner; values are read at one table point, not interpolated."],
    }
    with open(args.out, "w") as stream:
        json.dump(result, stream, sort_keys=True, allow_nan=False)
    print(json.dumps({"out": args.out, "rows": len(rows)}))


if __name__ == "__main__":
    main()
