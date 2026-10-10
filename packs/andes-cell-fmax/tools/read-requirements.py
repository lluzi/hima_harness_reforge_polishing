#!/usr/bin/env python3
"""Accept or refuse one agent's cell requirements (hima-andes-requirements/1) at delivery.

argv: read-requirements.py <REPORT> <OUT> <WORKSPACE>. The agent is named by the report file
(state/himatime-requirements.json or state/qualib-requirements.json). The checks are the Pack's own
validator in <WORKSPACE>/flow/andes_cli.py, the same one the agent's precheck runs. A refused file
exits non-zero with every problem, so the same resident task can repair it.
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
    name = os.path.basename(report_path)
    agent = name.split("-requirements.json")[0] if name.endswith("-requirements.json") else None
    if agent not in cli.AGENTS:
        raise ValueError("the report is not state/<agent>-requirements.json for an agent of %s" % ", ".join(cli.AGENTS))
    expected = os.path.realpath(os.path.join(workspace, "state", name))
    if os.path.realpath(report_path) != expected:
        raise ValueError("the requirements report is not the Campaign's state/%s" % name)
    try:
        doc, facts = cli.validate_requirements(workspace, agent)
    except cli.ToolError as error:
        raise ValueError("%s requirements refused: %s" % (agent, error))
    values = [
        {"type": "requirements_valid", "unit": "count", "value": 1},
        {"type": "requirements_count", "unit": "count", "value": facts["count"]},
        {"type": "requirements_on_critical_path", "unit": "count", "value": facts["onCriticalPath"]},
    ]
    with open(out_path, "x") as stream:
        json.dump({"values": values}, stream)


if __name__ == "__main__":
    try:
        main(sys.argv[1], sys.argv[2], sys.argv[3])
    except (OSError, ValueError, TypeError, KeyError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
