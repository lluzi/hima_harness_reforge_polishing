#!/usr/bin/env python3
"""ACP v1 stand-in for the pixel-layout-optimization resident engineer.

Modelled on the sibling dry-route residents (``libinsight-resident-dry/acp.py``,
``mage-script-dry/acp.py``): this process is the ``native.executable`` the
resident-engineering wrapper launches. It speaks JSON-RPC over stdio
(``initialize``, ``session/new``, ``session/set_config_option``,
``session/prompt``, ``session/close``, ``session/cancel``) and, on the first
``session/prompt``, reads ``task.json`` from the parent of its own cwd (the
wrapper launches it with ``cwd=<private workspace>``).

It follows ``knowledge/plan-and-repair-playbook.md`` with no model: it copies
the envelope's committed inputs into its private workspace's ``state/`` tree,
writes a hypothesis-first ``plan/round-NN/plan.json`` (round 1: base
``original`` with one ``min-pitch`` front point at the Goal outline; later
rounds: base ``best`` with one ``min-ratio`` point at the Goal outline), checks
it with the deployed ``pixel_cli.py plan-check`` (which writes the checked copy
to ``state/round/plan.json``), then delivers ``resident-delivery.json`` naming
``state/round/plan.json`` as the single ``kind: result`` artifact and every file
under ``plan/round-NN/`` as ``kind: support``. Its completion evidence is the
``pixel-plan`` Reader's ``pixel_plan_error_count`` equal to 0.
"""
import hashlib
import json
import subprocess
import sys
import threading
from pathlib import Path

lock = threading.Lock()
state = {"prompts": 0}


def send(value):
    with lock:
        print(json.dumps(value), flush=True)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


# One state-file path per output the plan-round task is granted to read.
_INPUT_STATE_PATHS = {
    "caseReadiness": "state/case-readiness.json",
    "designSpaceCard": "state/card.json",
    "surrogateModel": "state/model.json",
    "roundDecision": "state/round-decision.json",
    "history": "state/history.jsonl",
    "repairOrders": "state/repair-orders.json",
}


def _populate_state(native, inputs):
    """Copy every granted input into the private workspace's ``state/`` tree, at
    the fixed name the resident subcommands read (``plan-check`` reads
    ``state/case-readiness.json`` and ``state/history.jsonl``)."""
    import shutil

    for item in inputs:
        name, src = item.get("name"), item.get("path")
        relative = _INPUT_STATE_PATHS.get(name)
        if not relative or not src:
            continue
        destination = native / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, destination)


def _goal_outline(native):
    """The resolved Goal outline, from the copied case readiness; falls back to
    the synthetic cell's own 20 x 40 um when a value is absent or 0."""
    readiness = json.loads((native / "state/case-readiness.json").read_text(encoding="utf-8"))
    values = (readiness.get("goal", {}) or {}).get("values", {}) or {}
    w = values.get("outline_w_um") or 20.0
    h = values.get("outline_h_um") or 40.0
    return [float(w), float(h)]


def _plan(round_no, outline):
    if round_no <= 1:
        return {
            "schema": "pixel.plan/1", "round": round_no,
            "hypothesis": "compact both pitches to the Goal outline to learn whether it is reachable",
            "base": "original", "operators": [],
            "frontPoints": [{"name": "target-pitch", "objective": "min-pitch", "outlineUm": outline}],
            "pairConstraints": [], "edits": [], "expect": "outline toward the Goal; ratio unchanged",
        }
    return {
        "schema": "pixel.plan/1", "round": round_no,
        "hypothesis": "from the best legal candidate, lower the judged ratio at the reached outline",
        "base": "best", "operators": [],
        "frontPoints": [{"name": "ratio-at-target", "objective": "min-ratio", "outlineUm": outline}],
        "pairConstraints": [], "edits": [], "expect": "judged ratio down; outline held",
    }


def _deliver(native, round_no, outcome="completed"):
    round_prefix = Path("plan") / ("round-%02d" % round_no)
    artifacts = [{"path": "state/round/plan.json",
                  "sha256": sha(native / "state/round/plan.json"), "kind": "result"}]
    for path in sorted((native / round_prefix).rglob("*")):
        if path.is_file():
            artifacts.append({"path": path.relative_to(native).as_posix(),
                              "sha256": sha(path), "kind": "support"})
    (native / "resident-delivery.json").write_text(json.dumps({
        "schema": "hima-resident-engineering-candidate/1", "outcome": outcome,
        "summary": "round %d plan checked against schema, Goal, Strategy and history" % round_no,
        "stopReason": "", "artifacts": artifacts}), encoding="utf-8")


def plan_round(native, task):
    campaign = Path(task["campaignWorkspace"])
    cli = campaign / "flow" / "pixel_cli.py"
    round_no = int(task["task"]["boundInputs"]["ROUND"])

    _populate_state(native, task.get("inputs", []))
    outline = _goal_outline(native)

    round_prefix = Path("plan") / ("round-%02d" % round_no)
    (native / round_prefix).mkdir(parents=True, exist_ok=True)
    plan_src = round_prefix / "plan.json"
    (native / plan_src).write_text(json.dumps(_plan(round_no, outline)), encoding="utf-8")

    check = subprocess.run(
        [sys.executable, str(cli), "plan-check", str(native),
         "--plan", plan_src.as_posix(), "--out", "state/round/plan.json"],
        cwd=str(native), capture_output=True, text=True, timeout=120)
    if check.returncode != 0:
        raise RuntimeError("plan-check failed (%d): %s\n%s"
                           % (check.returncode, check.stderr, check.stdout))

    _deliver(native, round_no)


def repair_round(native, task):
    """The repair engineer, following ``knowledge/repair-playbook.md`` with no model: the
    synthetic case's candidates are clean, so the orders list nothing and the plan is the playbook's
    empty repairs list, checked with ``repair-check`` and delivered like any result."""
    campaign = Path(task["campaignWorkspace"])
    cli = campaign / "flow" / "pixel_cli.py"
    round_no = int(task["task"]["boundInputs"]["ROUND"])
    _populate_state(native, task.get("inputs", []))
    orders = json.loads((native / "state/repair-orders.json").read_text(encoding="utf-8"))
    prefix = Path("repair") / ("round-%02d" % round_no)
    (native / prefix).mkdir(parents=True, exist_ok=True)
    src = prefix / "repair-plan.json"
    (native / src).write_text(json.dumps({
        "schema": "pixel.repair-plan/1", "round": round_no,
        "hypothesis": "no near-miss to repair" if not orders.get("orders") else "orders seen, none previewed",
        "repairs": []}), encoding="utf-8")
    check = subprocess.run(
        [sys.executable, str(cli), "repair-check", str(native),
         "--plan", src.as_posix(), "--out", "state/round/repair-plan.json"],
        cwd=str(native), capture_output=True, text=True, timeout=120)
    if check.returncode != 0:
        raise RuntimeError("repair-check failed (%d): %s\n%s"
                           % (check.returncode, check.stderr, check.stdout))
    artifacts = [{"path": "state/round/repair-plan.json",
                  "sha256": sha(native / "state/round/repair-plan.json"), "kind": "result"}]
    for path in sorted((native / prefix).rglob("*")):
        if path.is_file():
            artifacts.append({"path": path.relative_to(native).as_posix(),
                              "sha256": sha(path), "kind": "support"})
    (native / "resident-delivery.json").write_text(json.dumps({
        "schema": "hima-resident-engineering-candidate/1", "outcome": "completed",
        "summary": "round %d repair plan checked against the orders" % round_no,
        "stopReason": "", "artifacts": artifacts}), encoding="utf-8")


def handle_initial_prompt():
    native = Path.cwd()
    task = json.loads((native.parent / "task.json").read_text(encoding="utf-8"))
    tool_id = task["task"]["toolId"]
    if tool_id == "plan-round":
        plan_round(native, task)
    elif tool_id == "repair-round":
        repair_round(native, task)
    else:
        raise RuntimeError("unexpected toolId %r" % (tool_id,))


def prompt(request_id, initial):
    try:
        if initial:
            handle_initial_prompt()
        send({"jsonrpc": "2.0", "id": request_id, "result": {"stopReason": "end_turn"}})
    except Exception as error:  # noqa: BLE001
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
            "agentInfo": {"name": "pixel-dry stand-in resident", "version": "1.0.0"}}})
    elif method == "session/new":
        send({"jsonrpc": "2.0", "id": rid, "result": {"sessionId": "pixel-dry-session-1", "configOptions": []}})
    elif method == "session/set_config_option":
        send({"jsonrpc": "2.0", "id": rid, "result": {"configOptions": []}})
    elif method == "session/prompt":
        state["prompts"] += 1
        initial = state["prompts"] == 1
        threading.Thread(target=prompt, args=(rid, initial), daemon=True).start()
    elif method == "session/close":
        send({"jsonrpc": "2.0", "id": rid, "result": {}})
    elif method == "session/cancel":
        pass
    elif rid is not None:
        send({"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": "unsupported"}})
