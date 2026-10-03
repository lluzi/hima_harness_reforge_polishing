"""An Operator's materialized task stays inside the Harness bound (#64 T05, slot w03).

T05's slot w03 never got its Operator: the Harness refused the delegation with "A bounded non-empty
delegated task is required." (`assertContract`, packages/harness/src/delegation.ts: a task above 64 000
characters). The Host builds the task from the member's `taskTemplate`, the runtime input ids, the bound
request scope and, per `taskInputs`, the declared top-level fields of the exact admitted request
(packages/harness/src/index.ts, recipe materialization). The Pack declared `candidate`, `sessionPlan`,
`noSafeAction` and `siteCapabilities`: the admitted w03 request (83 034 bytes; 256 targets, the same 256
checks again in its cluster, and a 19 450-character noSafeAction) made an 84 607-character task.
`materialized_task` below reproduces T05's recorded w01 task byte for byte (61 030 characters).

The request now carries `operatorBrief`, a bounded summary the Reader holds to the Pack's own
projection of the request, and the Operator's task embeds that and the sessionPlan; the exact request
stays the Reader observation the task names.
"""
from __future__ import annotations

import importlib.util
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
import yaml

TESTS_DIR = Path(__file__).resolve().parent
PACK_DIR = TESTS_DIR.parents[1]
READER = PACK_DIR / "tools" / "read-atcs.py"
CONTRACT = (PACK_DIR / "legacy/0.2.10/contract.yml").read_text(encoding="utf-8")
CONTRACT_DATA = yaml.safe_load(CONTRACT)
W03 = TESTS_DIR / "live_fixtures" / "t05-worker-request-w03.json"
TASK_LIMIT = 64_000
# T05's w03 request observation and its content hash (the fixture's sha256).
RECORD_ID = "run-7e0e117f-f74d-44bd-b813-220901e4fc0b#000290"
SLOTS = ["01", "02", "03", "04", "05", "06"]


def _operator(slot):
    team = CONTRACT.split("\nagentTeams:\n", 1)[1].split("\nworkshops:\n", 1)[0]
    body = team.split(f"  - id: atcs-worker-{slot}\n", 1)[1].split("\n  - id: ", 1)[0]
    member = body.split("      - id: operator\n", 1)[1]
    declared = next(team for team in CONTRACT_DATA["agentTeams"] if team["id"] == f"atcs-worker-{slot}")
    template = next(item for item in declared["members"] if item["id"] == "operator")["taskTemplate"]
    fields = re.search(r"^        taskInputs: \[\{ input: workerRequest\d\d, fields: \[(.*)\] \}\]$", member, re.M)
    commands = re.search(r"^          commands: \[(.*)\]$", member, re.M).group(1).split(", ")
    return template, fields.group(1).split(", "), commands


def materialized_task(slot, request_bytes, record_id=RECORD_ID):
    """The task the Host materializes for slot `slot`'s Operator from the exact request bytes (index.ts)."""
    import hashlib
    template, fields, commands = _operator(slot)
    sha = hashlib.sha256(request_bytes).hexdigest()
    value = json.loads(request_bytes)
    picked = {field: value[field] for field in fields if field in value}
    scope = value["candidate"]["scope"]
    inline = {"mode": "scope", "sourceResultRecordId": record_id, "adoptionRecordId": record_id, "planSha256": sha,
              "planHashArgument": "planSha256", "scope": {"commands": scope["commands"], "maxMutations": scope["maxMutations"]}}
    compact = {"ensure_ascii": False, "separators": (",", ":")}
    return "\n".join([
        template, f"Runtime inputs: {record_id}.", f"Immutable reviewed scope: {json.dumps(inline, **compact)}.",
        f"Exact input workerRequest{slot} (Reader observation {record_id}, content SHA-256 {sha}, fields {', '.join(fields)}):\n"
        + json.dumps(picked, **compact)])


def as_the_workshop_writes_it(slot, request):
    """The request bytes the slot's Workshop writes: when the Operator's declared fields name operatorBrief,
    the Workshop runs the Reader's `brief` step on its written request (its purpose says so)."""
    _, fields, _ = _operator(slot)
    with tempfile.TemporaryDirectory() as temp:
        path = Path(temp) / f"worker-request-w{slot}.json"
        path.write_text(json.dumps(request, indent=1), encoding="utf-8")
        if "operatorBrief" in fields:
            result = subprocess.run([sys.executable, str(READER), "brief", str(path)], capture_output=True, text=True)
            assert result.returncode == 0, result.stderr
        return path.read_bytes()


class OperatorTaskBoundTest(unittest.TestCase):
    def test_the_t05_w03_request_yields_a_bounded_task_naming_its_record(self):
        request = json.loads(W03.read_text(encoding="utf-8"))
        self.assertEqual(W03.stat().st_size, 83_034)
        task = materialized_task("03", as_the_workshop_writes_it("03", request))
        self.assertLessEqual(len(task), TASK_LIMIT)
        self.assertIn(f"Runtime inputs: {RECORD_ID}.", task)
        self.assertIn(f"Exact input workerRequest03 (Reader observation {RECORD_ID}", task)

    def test_the_bound_holds_for_any_admissible_active_request(self):
        # Worst case the Reader admits: a sessionPlan at its bound, and every list and text far above the brief's.
        name = "u_" + "x" * 297
        request = json.loads(W03.read_text(encoding="utf-8"))
        candidate = request["candidate"]
        candidate["targets"] = [f"scenario|hold|{name}{i}/D" for i in range(2000)]
        candidate["cluster"] = {"cause": "c" * 5000, "key": "k" * 5000, "checks": list(candidate["targets"])}
        candidate["targetPins"] = [f"{name}{i}/D" for i in range(2000)]
        candidate["editDomain"]["instances"] = [f"{name}{i}" for i in range(2000)]
        candidate["problem"] = "p" * 50_000
        request["noSafeAction"] = "n" * 200_000
        reader = _reader()
        step = {"command": "atcs_size_cell", "object": name, "toMaster": "BUFFD4BWP35P140", "hypothesis": "h", "falsifier": "f"}
        plan = []
        while len(json.dumps(plan + [step], ensure_ascii=False, separators=(",", ":"))) <= reader.SESSION_PLAN_MAX_CHARS:
            plan.append(step)
        request["sessionPlan"] = plan
        for slot in SLOTS:
            with self.subTest(slot=slot):
                candidate["taskId"] = f"w{slot}"
                task = materialized_task(slot, as_the_workshop_writes_it(slot, request))
                self.assertLessEqual(len(task), TASK_LIMIT)


def _reader():
    spec = importlib.util.spec_from_file_location("read_atcs_task_bound", READER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


if __name__ == "__main__":
    unittest.main()
