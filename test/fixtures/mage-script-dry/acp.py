#!/usr/bin/env python3
"""ACP v1 stand-in for the mage-script-placement resident Engineer.

Modelled on `test/fixtures/mage-resident-dry/acp.py`: this process is the
`native.executable` the resident-engineering wrapper launches. It speaks
JSON-RPC over stdio (`initialize`, `session/new`,
`session/set_config_option`, `session/prompt`, `session/close`,
`session/cancel`) and, on the first `session/prompt`, reads `task.json`
from the parent of its own cwd (the wrapper always launches it with
`cwd=<private workspace>`, so `Path.cwd().parent` is the task directory
that holds `task.json`).

It never hand-writes a candidate: it authors a real Tcl stage script and
drives the deployed `mage_placement_cli.py` (found via
`task['campaignWorkspace']`) through the exact
`mage-stage`/`stage-report`/`candidate` sequence `flow/tests/test_cli_tasks.py`
drives, with the stand-in MAGE (`flow/tests/standin_mage.py`) in place of
the licensed binary.

Scenario selection is `MAGE_SCRIPT_DRY_CASE` in the environment
(`converge`, `stall` or `blocked`), set by the worker into the resident
capability's `environment.set`:

- `converge`: round 1 baseline (reproduces the incumbent, one ordinary drop
  left -> goal not met -> continue), round 2 the improved PLA (OVL_B on its
  CT target, KEY_V placed -> goal met -> stop at 2).
- `stall`: the baseline every round -> the best state never improves ->
  decide-round stops at round 3 by two consecutive stalls (goal not met).
- `blocked`: round 1 fails after boundary `priority-start`
  (`MAGE_STANDIN_FAIL_AFTER_SNAPSHOT`), so its candidate is blocked and the
  round continues with no best; round 2 the improved PLA -> goal met -> stop
  at 2.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import threading

lock = threading.Lock()
first = True

# Frozen baseline stage script (the playbook's round-1 reproduction), given
# verbatim in `flow/tests/test_cli_stage.py:BASELINE`: open the build, source
# the frozen start, snapshot/check at the priority-start boundary, set
# s_ARTestConvergePrplaced false and auto-refine (the fill), snapshot filled.
_BASELINE_HEAD = ["hima_open_build", "source $hima_start_pla", "hima_snapshot priority-start", "hima_check"]
_BASELINE_TAIL = ["g_params -set {smPFlow::s_ARTestConvergePrplaced false}", "smPFlow -autoRefine", "hima_snapshot filled"]


def send(value):
    with lock:
        print(json.dumps(value), flush=True)


def _run_cli(cli, workspace, args):
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
    """Copy the Campaign-committed inputs this round's resident task was
    granted (`task.inputs`) into the private workspace's own `state/` tree,
    under the fixed names the resident subcommands read. Every CLI
    invocation below passes this private workspace as its own `WORKSPACE`
    argument, so every path the CLI computes with `.relative_to(workspace)`
    resolves against it."""
    import shutil

    names = {
        "caseReadiness": "state/case-readiness.json",
        "startSnapshot": "state/start-snapshot.json",
        "incumbentMeasure": "state/incumbent.json",
        "roundDecision": "state/round-decision.json",
        "methodJournal": "state/method-journal.json",
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


def _baseline_script(case_readiness):
    """BASELINE, plus the two `smPFlow -setAutoRefineSimpleConverge` lines
    only when the manifest names `mage.autoRefineConverge` (the fixture does
    not, so they are omitted and the script is exactly BASELINE)."""
    converge = case_readiness["manifest"]["mage"].get("autoRefineConverge")
    lines = list(_BASELINE_HEAD)
    if converge:
        lines.append("smPFlow -setAutoRefineSimpleConverge -arSLType VERT -arConvergeNum %d" % int(converge["VERT"]))
        lines.append("smPFlow -setAutoRefineSimpleConverge -arSLType HORZ -arConvergeNum %d" % int(converge["HORZ"]))
    lines.extend(_BASELINE_TAIL)
    return "\n".join(lines) + "\n"


def _improved_script(core, pla, manifest, dbu, improved_path):
    """Round >= 2 (converge/blocked): read the frozen start PLA, centre
    OVL_B on its CT target (1290, 30) um, place KEY_V as an ordinary Fit so
    the fill never re-drops it, empty the drops, and source the written
    improved.pla (absolute path) before the fill."""
    start_text = Path(manifest["startState"]["path"]).read_text(encoding="utf-8")
    doc = pla.read_pla(start_text, dbu)
    centre_x = core.um_to_dbu("1290", dbu)
    for fit in doc["fits"]:
        if fit["base"] == "OVL_B":
            l, b, r, t = fit["boxDbu"]
            width = r - l
            fit["boxDbu"] = [centre_x - width // 2, b, centre_x + width // 2, t]
    doc["fits"].append({
        "id": "KEY_V.KEY_V_1", "base": "KEY_V", "inst": "KEY_V.KEY_V_1",
        "boxDbu": [
            core.um_to_dbu("1060", dbu), core.um_to_dbu("300", dbu),
            core.um_to_dbu("1120", dbu), core.um_to_dbu("1200", dbu),
        ],
        "extraRot": "NULL", "postfix": "", "inGroup": "",
    })
    doc["drops"] = []
    improved_path.write_text(pla.write_pla(doc, dbu, units="um"), encoding="utf-8")
    return ("hima_open_build\nsource {%s}\nhima_snapshot improved\n"
            "g_params -set {smPFlow::s_ARTestConvergePrplaced false}\nsmPFlow -autoRefine\nhima_snapshot filled\n"
            % improved_path)


def _hypothesis(scenario, round_no):
    if round_no < 2:
        return "round 1 replays the frozen start and fills to reproduce the incumbent baseline"
    if scenario == "stall":
        return "re-running the frozen baseline fill reproduces the same incumbent population"
    return "centring OVL_B on its CT target and placing KEY_V as an ordinary fit clears the only ordinary drop"


def engineer(task, workspace, campaign, cli):
    core, pla = _mage_modules(campaign / "flow")

    inputs = _inputs_by_name(task)
    _populate_state(workspace, inputs)

    round_no = int(task["task"]["boundInputs"]["ROUND"])
    scenario = os.environ["MAGE_SCRIPT_DRY_CASE"]
    case_readiness = json.loads(Path(inputs["caseReadiness"]).read_text(encoding="utf-8"))
    manifest = case_readiness["manifest"]
    dbu = manifest["dbuPerUm"]

    round_prefix = Path("placement") / ("round-%02d" % round_no)
    round_dir = workspace / round_prefix
    round_dir.mkdir(parents=True, exist_ok=True)

    use_improved = round_no >= 2 and scenario in ("converge", "blocked")
    if use_improved:
        stage_text = _improved_script(core, pla, manifest, dbu, round_dir / "improved.pla")
    else:
        stage_text = _baseline_script(case_readiness)

    script_path = round_dir / "script.tcl"
    script_path.write_text(stage_text, encoding="utf-8")
    stage_dir = round_prefix / "stage-1"

    fail_knob = scenario == "blocked" and round_no == 1
    if fail_knob:
        os.environ["MAGE_STANDIN_FAIL_AFTER_SNAPSHOT"] = "priority-start"
    try:
        _run_cli(cli, workspace, [
            "mage-stage", str(workspace), "--round", str(round_no), "--script", str(script_path),
            "--out-dir", str(stage_dir),
        ])
    finally:
        if fail_knob:
            del os.environ["MAGE_STANDIN_FAIL_AFTER_SNAPSHOT"]

    report_path = round_prefix / "stage-report.json"
    _run_cli(cli, workspace, ["stage-report", str(workspace), "--stage-dir", str(stage_dir), "--out", str(report_path)])

    summary = json.loads((workspace / stage_dir / "stage-summary.json").read_text(encoding="utf-8"))
    completed = bool(summary.get("completed"))
    boundaries = [snap["name"] for snap in summary.get("snapshots", [])]
    outcome = "completed" if completed else "failed"
    conclusion = "stage completed; candidate assembled" if completed else (
        "stage failed at boundary %s" % (summary.get("lastBoundary") or "prelude"))
    journal_entry = {
        "schema": "mage.journal-entry/1", "round": round_no,
        "hypothesis": _hypothesis(scenario, round_no),
        "stages": [{
            "stage": 1, "scriptSha256": summary["scriptSha256"], "outcome": outcome,
            "boundaries": boundaries, "stageError": summary.get("stageError"), "note": "",
        }],
        "observations": ["ordinary drops equal the incumbent"],
        "conclusion": conclusion, "nextStep": "advance to decide-round",
    }
    journal_path = round_dir / "journal-entry.json"
    journal_path.write_text(json.dumps(journal_entry), encoding="utf-8")

    candidate_out = round_dir / "script-candidate.json"
    _run_cli(cli, workspace, [
        "candidate", str(workspace), "--round", str(round_no), "--stage-dir", str(stage_dir),
        "--journal", str(round_prefix / "journal-entry.json"), "--out", str(round_prefix / "script-candidate.json"),
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
    delivery = {
        "schema": "hima-resident-engineering-candidate/1", "outcome": "completed",
        "summary": "round %d script candidate assembled" % round_no,
        "stopReason": "", "artifacts": artifacts,
    }
    (workspace / "resident-delivery.json").write_text(json.dumps(delivery), encoding="utf-8")


def handle_initial_prompt():
    native = Path.cwd()
    task = json.loads((native.parent / "task.json").read_text(encoding="utf-8"))
    campaign = Path(task["campaignWorkspace"])
    cli = campaign / "flow" / "mage_placement_cli.py"
    tool_id = task["task"]["toolId"]
    if tool_id == "engineer-script":
        engineer(task, native, campaign, cli)
    else:
        raise RuntimeError(f"unexpected toolId {tool_id!r}")


def prompt(request_id, initial):
    try:
        if initial:
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
            "agentInfo": {"name": "mage-script-dry stand-in", "version": "1.0.0"},
        }})
    elif method == "session/new":
        send({"jsonrpc": "2.0", "id": rid, "result": {"sessionId": "mage-script-dry-session-1", "configOptions": []}})
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
