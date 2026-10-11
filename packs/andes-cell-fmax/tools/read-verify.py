#!/usr/bin/env python3
"""Accept or refuse a verify delivery and state the round's cell facts from the tools themselves.

argv: read-verify.py <REPORT> <OUT> <WORKSPACE>. The report is the Campaign's
state/himatime-verify.json (the HimaTime agent: the cell-level check, which generated cells are kept)
or state/qualib-screen.json (the Qualib agent: PASS or FAIL per kept cell with reasons). The checks
are the Pack's own validator in <WORKSPACE>/flow/andes_cli.py, the same one the agent's precheck
runs: it asks HimaTime (`himatime verify --json`) and Qualib (`qualib screen --json` on the kept
cells) for their deterministic answer on this round's cells and refuses a delivery whose numbers or
decisions disagree with it.

The values are the tools' numbers, never the agent's text, and are the same on either branch so the
join judges both branches by one rule set: cells_kept (HimaTime's kept cells) and cells_passed_screen
(kept cells that pass the Qualib screen). An accepted delivery also gets its charts from the same
tool answer: reports/himatime-verify/r<k>/cell-check.chart.json and top-cells.chart.json, or
reports/qualib-screen/r<k>/screen.chart.json (andes_cli.check_chart).
"""
import importlib.util
import json
import os
import sys

KINDS = {"himatime-verify.json": "himatime-verify", "qualib-screen.json": "qualib-screen"}


def main(report_path, out_path, workspace):
    cli_path = os.path.join(workspace, "flow", "andes_cli.py")
    spec = importlib.util.spec_from_file_location("andes_cli", cli_path)
    cli = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cli)
    name = os.path.basename(report_path)
    kind = KINDS.get(name)
    if kind is None:
        raise ValueError("the report is neither state/himatime-verify.json nor state/qualib-screen.json")
    if os.path.realpath(report_path) != os.path.realpath(os.path.join(workspace, "state", name)):
        raise ValueError("the verify report is not the Campaign's state/%s" % name)
    try:
        _, facts = cli.validate_check(workspace, kind)
    except cli.ToolError as error:
        raise ValueError("%s refused: %s" % (kind, error))
    values = [
        {"type": "verify_delivery_valid", "unit": "count", "value": 1},
        {"type": "cells_kept", "unit": "count", "value": facts["cellsKept"]},
        {"type": "cells_passed_screen", "unit": "count", "value": facts["cellsPassedScreen"]},
    ]
    try:
        print("wrote %s" % cli.check_chart(workspace, kind))
    except (cli.ToolError, OSError, ValueError, KeyError, TypeError) as error:
        print("no %s chart: %s" % (kind, error), file=sys.stderr)
    with open(out_path, "x") as stream:
        json.dump({"values": values}, stream)


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2], sys.argv[3])
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
