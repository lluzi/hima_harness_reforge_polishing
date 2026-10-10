#!/usr/bin/env python3
"""Accept or refuse the AndesCell agent's generation plan (hima-andes-plan/1) at delivery.

argv: read-plan.py <REPORT> <OUT> <WORKSPACE>. The report is the Campaign's
state/generation-plan.json. The checks are the Pack's own validator in
<WORKSPACE>/flow/andes_cli.py, the same one the agent's precheck and generate-cells run: the round,
1-2 families that both agents' lists requested and the library does not hold yet, each with a reason
and HimaTime's estimated recovery, every other requested family skipped with a reason. A refused
file exits non-zero with every problem, so the same resident task can repair it.
"""
import importlib.util
import json
import os
import sys


def main(report_path, out_path, workspace):
    cli_path = os.path.join(workspace, "flow", "andes_cli.py")
    spec = importlib.util.spec_from_file_location("andes_cli", cli_path)
    cli = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cli)
    expected = os.path.realpath(os.path.join(workspace, "state", "generation-plan.json"))
    if os.path.realpath(report_path) != expected:
        raise ValueError("the generation plan is not the Campaign's state/generation-plan.json")
    try:
        _, facts = cli.validate_plan(workspace)
    except cli.ToolError as error:
        raise ValueError("generation plan refused: %s" % error)
    values = [
        {"type": "plan_valid", "unit": "count", "value": 1},
        {"type": "plan_families", "unit": "count", "value": len(facts["families"])},
        {"type": "plan_follows_ranking", "unit": "count", "value": 1 if facts["followsRanking"] else 0},
    ]
    with open(out_path, "x") as stream:
        json.dump({"values": values}, stream)


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2], sys.argv[3])
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
