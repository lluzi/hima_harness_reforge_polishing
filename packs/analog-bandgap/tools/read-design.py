#!/usr/bin/env python3
"""Accept or refuse the design agent's bandgap (hima-bandgap-design/1) at delivery.

argv: read-design.py <REPORT> <OUT> <WORKSPACE>. The checks are the Pack's own validator in
<WORKSPACE>/flow/bg_cli.py, the same one the agent's precheck runs: the template's devices, every
size legal for the PDK and on its grid, matched pairs and resistors, no performance field, sizes that
follow the intent. A refused file exits non-zero with every problem, so the same resident task can
repair it. Performance is measured by the Pack's simulate steps, never read from the design.
"""
import importlib.util
import json
import os
import sys


def main(report_path, out_path, workspace):
    sys.path.insert(0, os.path.join(workspace, "flow"))
    spec = importlib.util.spec_from_file_location("bg_cli", os.path.join(workspace, "flow", "bg_cli.py"))
    cli = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cli)
    if os.path.realpath(report_path) != os.path.realpath(os.path.join(workspace, "state", "design.json")):
        raise ValueError("the design report is not the Campaign's state/design.json")
    try:
        cli.validate_design(workspace)
    except cli.ToolError as error:
        raise ValueError("bandgap design refused: %s" % error)
    with open(out_path, "x") as stream:
        json.dump({"values": [{"type": "design_valid", "unit": "count", "value": 1}]}, stream)


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2], sys.argv[3])
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
