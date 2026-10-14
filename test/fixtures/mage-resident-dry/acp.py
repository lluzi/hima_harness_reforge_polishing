#!/usr/bin/env python3
"""ACP v1 stand-in for the mage-scribe-placement resident Engineer and the
four resident consumers (litho-pie, metrology, alignment, wat).

Modelled on `test/fixtures/atcs-resident-dry/acp.py`: this process is the
`native.executable` the resident-engineering wrapper launches. It speaks
JSON-RPC over stdio (`initialize`, `session/new`,
`session/set_config_option`, `session/prompt`, `session/close`,
`session/cancel`) and, on the first `session/prompt`, reads `task.json`
from the parent of its own cwd (the wrapper always launches it with
`cwd=<private workspace>`, so `Path.cwd().parent` is the task directory
that holds `task.json`).

It never hand-writes a Finding, Request, placement-candidate or
consumer-review document: every one of those is produced by running the
deployed `mage_placement_cli.py` (found via `task['campaignWorkspace']`)
through the exact `snapshot`/`mage-round`/`candidate` (Engineer) or
`evaluate`/`review` (consumer) subcommand sequence
`flow/tests/test_cli_tasks.py` already drives.

Scenario selection is `MAGE_DRY_CASE` in the environment (`converge` or
`conflict`), set by the worker into the resident capability's
`environment.set`, exactly as ATCS's fixture sets `ATCS_DRY_CASE`.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading

lock = threading.Lock()
first = True
_calls = 0


def send(value):
    with lock:
        print(json.dumps(value), flush=True)


def _update(update):
    # Display traffic like a real native session's: the wrapper turns it into state.json activity.
    send({"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": "mage-dry-session-1", "update": update}})


def _run_cli(cli, workspace, args):
    global _calls
    _calls += 1
    _update({"sessionUpdate": "tool_call", "toolCallId": f"call-{_calls}", "kind": "execute",
             "title": f"python3 {cli} {args[0]}", "status": "in_progress"})
    result = subprocess.run(
        [sys.executable, str(cli)] + [str(a) for a in args],
        cwd=str(workspace), capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"mage_placement_cli.py {args[0]} failed ({result.returncode}): {result.stderr}\n{result.stdout}"
        )
    return result


def _inputs_by_name(task):
    return {item["name"]: item["path"] for item in task.get("inputs", [])}


def _populate_state(workspace, inputs):
    """Copy whatever Campaign-committed inputs this round's resident task
    was granted (`task.inputs`) into the private workspace's own
    `state/` tree, under the fixed names `mage_placement_cli.py`'s
    subcommands read (`state/case-readiness.json`,
    `state/start-snapshot.json`, `state/incumbent.json`,
    `state/round-decision.json`, `state/round/placement-candidate.json`).
    Every resident CLI invocation below passes this private workspace as
    its own `WORKSPACE` argument, so every path the CLI computes with
    `.relative_to(workspace)` resolves against it."""
    names = {
        "caseReadiness": "state/case-readiness.json",
        "startSnapshot": "state/start-snapshot.json",
        "incumbentMeasure": "state/incumbent.json",
        "roundDecision": "state/round-decision.json",
        "placementCandidate": "state/round/placement-candidate.json",
    }
    for name, relative in names.items():
        if name not in inputs:
            continue
        destination = workspace / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(inputs[name], destination)


def _mage_modules(flow_dir):
    sys.path[:0] = [str(flow_dir)]
    from mage_placement import core, pla  # noqa: E402

    return core, pla


def engineer(task, workspace, campaign, cli):
    core, pla = _mage_modules(campaign / "flow")

    inputs = _inputs_by_name(task)
    _populate_state(workspace, inputs)

    round_no = int(task["task"]["boundInputs"]["ROUND"])
    case_readiness = json.loads(Path(inputs["caseReadiness"]).read_text(encoding="utf-8"))
    manifest = case_readiness["manifest"]
    dbu_per_um = manifest["dbuPerUm"]
    round_decision = json.loads(Path(inputs["roundDecision"]).read_text(encoding="utf-8"))

    scenario = os.environ["MAGE_DRY_CASE"]
    ovl_b_on_target = round_no >= 2
    place_key_v = scenario == "converge" and round_no >= 2

    start_text = Path(manifest["startState"]["path"]).read_text(encoding="utf-8")
    doc = pla.read_pla(start_text, dbu_per_um)
    if ovl_b_on_target:
        for fit in doc["fits"]:
            if fit["base"] == "OVL_B":
                l, b, r, t = fit["boxDbu"]
                width = r - l
                centre_x = core.um_to_dbu("1290", dbu_per_um)
                fit["boxDbu"] = [centre_x - width // 2, b, centre_x + width // 2, t]
    if place_key_v:
        doc["fits"].append({
            "id": "KEY_V.KEY_V_1", "base": "KEY_V", "inst": "KEY_V.KEY_V_1",
            "boxDbu": [
                core.um_to_dbu("1060", dbu_per_um), core.um_to_dbu("300", dbu_per_um),
                core.um_to_dbu("1120", dbu_per_um), core.um_to_dbu("1200", dbu_per_um),
            ],
            "extraRot": "NULL", "postfix": "", "inGroup": "",
        })
        doc["drops"] = []
    else:
        doc["drops"] = [{
            "id": "KEY_V.KEY_V", "base": "KEY_V", "inst": "KEY_V.KEY_V",
            "boxDbu": [0, 0, core.um_to_dbu("900", dbu_per_um), core.um_to_dbu("60", dbu_per_um)],
            "extraRot": "NULL", "placedFlag": 0, "postfix": "", "inGroup": "",
        }]

    round_prefix = Path("placement") / f"round-{round_no:02d}"
    round_dir = workspace / round_prefix
    round_dir.mkdir(parents=True, exist_ok=True)
    pla_path = round_dir / "candidate-input.pla"
    pla_path.write_text(pla.write_pla(doc, dbu_per_um, units="um"), encoding="utf-8")

    # N7: a delivered round must carry the full ordinary population, so the
    # Engineer replays with the fill stage (`--fill`); the stand-in tops the
    # export's ordinary structures up to the incumbent's measured population,
    # which the candidate assembler and the Reader both enforce.
    _run_cli(cli, workspace, [
        "mage-round", str(workspace), "--round", str(round_no), "--pla", str(pla_path),
        "--role", "engineer", "--out-dir", str(round_dir), "--fill",
    ])

    ledger = []
    for index, request in enumerate(round_decision.get("openRequests", []), start=1):
        entry_id = f"L-{round_no}-{index}"
        kind = request.get("requestedOutcome", {}).get("kind")
        consumer_id = request.get("consumer")
        if kind == "move" and consumer_id == "litho-pie":
            resolved = ovl_b_on_target
        elif kind == "place" and consumer_id == "wat":
            resolved = place_key_v
        else:
            resolved = False
        if resolved:
            ledger.append({
                "schema": "mage.ledger-entry/1", "id": entry_id, "request": request["id"],
                "answer": "satisfied", "answeredInSnapshot": "pending", "evidence": [],
                "note": "resolved in round %d" % round_no,
            })
        else:
            evidence_path = round_dir / f"planner-evidence-{index}.json"
            evidence_path.write_text(
                json.dumps({"note": "capacity-limited; KEY_V stays dropped this round"}), encoding="utf-8",
            )
            ledger.append({
                "schema": "mage.ledger-entry/1", "id": entry_id, "request": request["id"],
                "answer": "declined", "answeredInSnapshot": "pending",
                "evidence": [{
                    "path": str(evidence_path.relative_to(workspace)), "sha256": core.file_sha256(evidence_path),
                }],
                "note": "capacity-limited; see this round's own findings",
            })
    ledger_path = round_dir / "ledger.json"
    ledger_path.write_text(json.dumps(ledger), encoding="utf-8")

    candidate_out = round_dir / "placement-candidate.json"
    _run_cli(cli, workspace, [
        "candidate", str(workspace), "--round", str(round_no), "--round-dir", str(round_dir),
        "--ledger", str(ledger_path), "--out", str(candidate_out),
    ])

    artifacts = []
    for path in sorted(round_dir.rglob("*")):
        if not path.is_file():
            continue
        artifacts.append({
            "path": path.relative_to(workspace).as_posix(),
            "sha256": core.file_sha256(path),
            "kind": "result" if path == candidate_out else "support",
        })
    candidate = {
        "schema": "hima-resident-engineering-candidate/1", "outcome": "completed",
        "summary": "round %d candidate assembled" % round_no,
        "stopReason": "", "artifacts": artifacts,
    }
    (workspace / "resident-delivery.json").write_text(json.dumps(candidate), encoding="utf-8")


_ROLE_BY_TOOL = {
    "review-litho-pie": "litho-pie", "review-metrology": "metrology",
    "review-alignment": "alignment", "review-wat": "wat",
}


def consumer(task, workspace, campaign, cli, role):
    core, _pla = _mage_modules(campaign / "flow")

    inputs = _inputs_by_name(task)
    _populate_state(workspace, inputs)

    round_no = int(task["task"]["boundInputs"]["ROUND"])
    scenario = os.environ["MAGE_DRY_CASE"]
    candidate_path = workspace / "state" / "round" / "placement-candidate.json"
    candidate_doc = json.loads(candidate_path.read_text(encoding="utf-8"))

    role_prefix = Path("reviews") / role / f"round-{round_no:02d}"
    role_dir = workspace / role_prefix
    role_dir.mkdir(parents=True, exist_ok=True)

    # `candidate_doc["files"]["snapshot"]["path"]` was computed relative to
    # the Engineer's own private workspace when `candidate` assembled it;
    # by construction (support files live under the shared `placement/`
    # artifactPrefix) that same relative path is where the Harness
    # materializes it in the Campaign workspace, which is the only place
    # a *different* resident task (this consumer) can read it from.
    candidate_snapshot = campaign / candidate_doc["files"]["snapshot"]["path"]
    eval_result = json.loads(_run_cli(cli, workspace, [
        "evaluate", str(workspace), "--consumer", role, "--candidate", str(candidate_snapshot),
        "--out-dir", str(role_dir),
    ]).stdout)
    findings = eval_result["findings"]
    ovl_b_on_target = round_no >= 2

    requests = []
    # A reasonable consumer files a Request from the first Finding it fails on,
    # whether that fail is hard (a regression it will not accept) or cost (a
    # trade-off it would still like improved, e.g. WAT's now-cost dropped key
    # or litho-pie's pre-existing over-limit mark). Severity governs the
    # Finding; it does not gate whether the consumer asks.
    fail_finding = next((f for f in findings if f.get("status") == "fail"), None)
    if role == "wat" and fail_finding is not None:
        requests.append({
            "fromFinding": fail_finding["id"], "consumer": role,
            "requestedOutcome": {
                "kind": "place", "targets": fail_finding["targets"], "limitsUm": {}, "text": "place KEY_V",
            },
            "acceptableAlternatives": [], "strength": "hard",
        })
    elif role == "litho-pie":
        if not ovl_b_on_target and fail_finding is not None:
            # Round 1 (both scenarios): OVL_B is off its CT target. After the
            # Run-owned severity change this is a pre-existing `cost` fail (an
            # inherited over-limit mark), but litho-pie still asks for it to be
            # moved onto target, using the Finding's own targets.
            requests.append({
                "fromFinding": fail_finding["id"], "consumer": role,
                "requestedOutcome": {
                    "kind": "move", "targets": fail_finding["targets"], "limitsUm": {},
                    "text": "move OVL_B onto its CT target",
                },
                "acceptableAlternatives": [], "strength": "hard",
            })
        elif ovl_b_on_target and scenario == "conflict" and findings:
            # OVL_B is already on target (no hard fail left for litho-pie
            # to raise), but this consumer still wants KEY_V's own lane
            # left undisturbed -- a preference Request whose targets
            # deliberately intersect WAT's own `place` Request on the
            # same target, a genuine cross-consumer conflict every round
            # from here on (never a converge-scenario behaviour).
            requests.append({
                "fromFinding": findings[0]["id"], "consumer": role,
                "requestedOutcome": {
                    "kind": "keep", "targets": ["KEY_V.KEY_V"], "limitsUm": {},
                    "text": "keep the current layout; do not disturb it for KEY_V",
                },
                "acceptableAlternatives": [], "strength": "preference",
            })

    findings_path = role_dir / "findings.json"
    findings_path.write_text(json.dumps(eval_result), encoding="utf-8")
    requests_path = role_dir / "requests.json"
    requests_path.write_text(json.dumps(requests), encoding="utf-8")

    review_out = role_dir / "review.json"
    _run_cli(cli, workspace, [
        "review", str(workspace), "--consumer", role, "--round", str(round_no),
        "--findings", str(findings_path), "--requests", str(requests_path), "--out", str(review_out),
    ])

    artifacts = []
    for path in sorted(role_dir.rglob("*")):
        if not path.is_file():
            continue
        artifacts.append({
            "path": path.relative_to(workspace).as_posix(),
            "sha256": core.file_sha256(path),
            "kind": "result" if path == review_out else "support",
        })
    candidate = {
        "schema": "hima-resident-engineering-candidate/1", "outcome": "completed",
        "summary": "%s round %d review assembled" % (role, round_no),
        "stopReason": "", "artifacts": artifacts,
    }
    (workspace / "resident-delivery.json").write_text(json.dumps(candidate), encoding="utf-8")


def handle_initial_prompt():
    native = Path.cwd()
    task = json.loads((native.parent / "task.json").read_text(encoding="utf-8"))
    campaign = Path(task["campaignWorkspace"])
    cli = campaign / "flow" / "mage_placement_cli.py"
    tool_id = task["task"]["toolId"]
    if tool_id == "engineer-place":
        engineer(task, native, campaign, cli)
    else:
        role = _ROLE_BY_TOOL[tool_id]
        consumer(task, native, campaign, cli, role)


def prompt(request_id, initial):
    try:
        if initial:
            _update({"sessionUpdate": "plan", "entries": [{"content": "read the task", "status": "completed"}, {"content": "deliver", "status": "pending"}]})
            handle_initial_prompt()
        send({"jsonrpc": "2.0", "id": request_id, "result": {"stopReason": "end_turn"}})
    except Exception as error:
        import traceback

        traceback.print_exc(file=sys.stderr)
        send({"jsonrpc": "2.0", "id": request_id, "error": {"code": -32000, "message": str(error)}})


if sys.argv[1:] == ["--version"]:
    print("1.0.0")
    sys.exit(0)

for line in sys.stdin:
    message = json.loads(line)
    method = message.get("method")
    rid = message.get("id")
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": rid, "result": {
            "protocolVersion": 1, "agentCapabilities": {"sessionCapabilities": {"close": {}}},
            "agentInfo": {"name": "mage-resident-dry stand-in", "version": "1.0.0"},
        }})
    elif method == "session/new":
        send({"jsonrpc": "2.0", "id": rid, "result": {"sessionId": "mage-dry-session-1", "configOptions": []}})
    elif method == "session/set_config_option":
        send({"jsonrpc": "2.0", "id": rid, "result": {"configOptions": []}})
    elif method == "session/prompt":
        initial = first
        first = False
        threading.Thread(target=prompt, args=(rid, initial), daemon=True).start()
    elif method == "session/close":
        send({"jsonrpc": "2.0", "id": rid, "result": {}})
    elif method == "session/cancel":
        pass
    elif rid is not None:
        send({"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": "unsupported"}})
