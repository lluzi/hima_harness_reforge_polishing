#!/usr/bin/env python3
"""Accept or refuse an agent's OTA design (hima-ota-design/1) at delivery.

argv: read-design.py <REPORT> <OUT> <WORKSPACE>. The stage is named by the report file
(state/design-source.json or state/design-target.json). The checks are the Pack's own validator in
<WORKSPACE>/flow/ota_cli.py, the same one the agent's precheck runs: the topology's devices, every W
and L legal for the stage's PDK and on its grid, matched pairs, bias and compensation in range, no
performance field, a migrated design citing the accepted source design. A refused file exits non-zero
with every problem, so the same resident task can repair it. Performance is measured by the Pack's
simulate step, never read from the design.
"""
import importlib.util
import json
import os
import sys


def main(report_path, out_path, workspace):
    cli_path = os.path.join(workspace, "flow", "ota_cli.py")
    spec = importlib.util.spec_from_file_location("ota_cli", cli_path)
    cli = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cli)
    name = os.path.basename(report_path)
    stage = {"design-source.json": "source", "design-target.json": "target"}.get(name)
    if stage is None:
        raise ValueError("the report is not state/design-source.json or state/design-target.json")
    if os.path.realpath(report_path) != os.path.realpath(os.path.join(workspace, "state", name)):
        raise ValueError("the design report is not the Campaign's state/%s" % name)
    try:
        doc, facts = cli.validate_design(workspace, stage)
    except cli.ToolError as error:
        raise ValueError("%s design refused: %s" % (stage, error))
    values = [
        {"type": "design_valid", "unit": "count", "value": 1},
        {"type": "area_um2", "unit": "um2", "value": cli.area_um2(doc)},
    ]
    with open(out_path, "x") as stream:
        json.dump({"values": values}, stream)


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2], sys.argv[3])
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
