#!/usr/bin/env python3
"""libinsight-analysis Pack command line.

Program ABI (the Host's declared command tasks):

    libinsight_cli.py task-prepare-request WORKSPACE TASK_INPUT TASK_OUTPUT
    libinsight_cli.py task-admit-analysis  WORKSPACE TASK_INPUT TASK_OUTPUT
    libinsight_cli.py task-deliver         WORKSPACE TASK_INPUT TASK_OUTPUT

Resident self-check (the reference command of the outsourced custom-analysis tool):

    libinsight_cli.py check-delivery ROOT [RESULT] [PREPARED]

ROOT resolves `code.*.path` (the resident's private workspace before delivery, the Campaign
workspace after the Host materialized the delivery). RESULT defaults to ROOT/analysis-result.json,
then ROOT/state/analysis-result.json; PREPARED defaults to the prepared request of the Campaign
this file was deployed into. Exit 0 prints `accepted`; exit 1 prints one problem per line.

Exit codes: 0 ok, 1 delivery problems, 2 malformed input, 3 refused by a business rule.
"""
import json
import os
import sys

FLOW = os.path.dirname(os.path.abspath(__file__))
if FLOW not in sys.path:
    sys.path.insert(0, FLOW)

from libinsight_analysis import common, delivery, tasks  # noqa: E402


def _fail(code, detail, status):
    sys.stderr.write(json.dumps({"error": code, "detail": detail}) + "\n")
    return status


def check_delivery(argv):
    if not 1 <= len(argv) <= 3:
        return _fail("usage", "check-delivery ROOT [RESULT] [PREPARED]", 2)
    root = os.path.abspath(argv[0])
    if len(argv) >= 2:
        result = argv[1] if os.path.isabs(argv[1]) else os.path.join(root, argv[1])
    else:
        result = os.path.join(root, "analysis-result.json")
        if not os.path.exists(result):
            result = os.path.join(root, common.RESULT_PATH)
    prepared_path = argv[2] if len(argv) == 3 else os.path.join(os.path.dirname(FLOW), common.PREPARED_PATH)
    try:
        prepared = common.read_json_file(os.path.abspath(prepared_path), "prepared request")
        doc, data = delivery.load_result(os.path.abspath(result))
    except common.LiaError as error:
        print(error.detail)
        return 1
    found = delivery.problems(doc, root, prepared, len(data))
    if found:
        for line in found:
            print(line)
        return 1
    print("accepted %s sha256 %s: %s" % (result, common.sha256_bytes(data), json.dumps(delivery.measures(doc), sort_keys=True)))
    return 0


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv:
        return _fail("usage", __doc__.strip().splitlines()[0], 2)
    command, rest = argv[0], argv[1:]
    if command == "check-delivery":
        return check_delivery(rest)
    if command.startswith("task-") and len(rest) == 3:
        workspace, task_input, task_output = rest
        workspace = os.path.abspath(workspace)
        try:
            result = tasks.execute(command[5:], workspace, tasks.read_task_input(task_input))
            common.write_json(task_output, result)
            return 0
        except common.LiaError as error:
            return _fail(error.code, error.detail, 3)
        except (OSError, KeyError, TypeError, ValueError) as error:
            return _fail("malformed-input", "%s: %s" % (type(error).__name__, error), 2)
    return _fail("usage", "unknown command %r; see the module docstring" % command, 2)


if __name__ == "__main__":
    sys.exit(main())
