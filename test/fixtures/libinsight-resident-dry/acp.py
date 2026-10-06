#!/usr/bin/env python3
"""ACP v1 stand-in resident analyst for the libinsight-analysis durable Host test.

It does what the knowledge tells a real resident to do, with no model: read the prepared request
from the read-only Campaign workspace, run the Pack's verified example script
(`inv_drive_delay.py`) on the prepared facts source in its private workspace, self-check with the
Campaign's `check-delivery`, and write the delivery candidate.

LIA_DRY_CASE=clean delivers a valid result on the first prompt. LIA_DRY_CASE=repair first delivers
a result whose code.main.sha256 is wrong; on the Reader-rejection message it reads the Reader's
problems file, keeps its completed work, and delivers the corrected result.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import threading
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
EXAMPLE = REPO / "packs/libinsight-analysis/flow/tests/fixtures/saed14-inv-drive-delay/analysis/inv_drive_delay.py"
lock = threading.Lock()
state = {"prompts": 0}


def send(value):
    with lock:
        print(json.dumps(value), flush=True)


def record(entry):
    with open(os.environ["LIA_DRY_PROMPTS"], "a") as stream:
        stream.write(json.dumps(entry) + "\n")


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def candidate(native, summary, outcome="completed"):
    artifacts = [{"path": "analysis-result.json", "sha256": sha(native / "analysis-result.json"), "kind": "result"},
                 {"path": "analysis/inv_drive_delay.py", "sha256": sha(native / "analysis/inv_drive_delay.py"), "kind": "support"}]
    (native / "resident-delivery.json").write_text(json.dumps({
        "schema": "hima-resident-engineering-candidate/1", "outcome": outcome, "summary": summary,
        "stopReason": "analysis complete", "artifacts": artifacts}))


def analyse(native, campaign):
    prepared_path = campaign / "state/prepared-request.json"
    prepared = json.loads(prepared_path.read_text())
    facts = [s["path"] for s in prepared["sources"] if s["kind"] == "facts"]
    assert len(facts) == 1, prepared["sources"]
    (native / "analysis").mkdir(exist_ok=True)
    shutil.copyfile(EXAMPLE, native / "analysis/inv_drive_delay.py")
    run = subprocess.run([sys.executable, "analysis/inv_drive_delay.py", "--prepared", str(prepared_path),
                          "--facts", facts[0], "--out", "analysis-result.json"], cwd=native,
                         capture_output=True, text=True, timeout=120)
    assert run.returncode == 0, run.stderr
    check = subprocess.run([sys.executable, str(campaign / "flow/libinsight_cli.py"), "check-delivery", str(native),
                            "analysis-result.json"], capture_output=True, text=True, timeout=60)
    assert check.returncode == 0, check.stdout + check.stderr
    return json.loads((native / "analysis-result.json").read_text())


def prompt(request_id, text):
    try:
        state["prompts"] += 1
        native = Path.cwd()
        task = json.loads((native.parent / "task.json").read_text())
        campaign = Path(task["campaignWorkspace"])
        case = os.environ["LIA_DRY_CASE"]
        initial = state["prompts"] == 1
        entry = {"initial": initial, "nodeId": task["nodeId"], "text": text[:400]}
        if initial:
            result = analyse(native, campaign)
            if case == "repair":
                result["code"]["main"]["sha256"] = "0" * 64
                (native / "analysis-result.json").write_text(json.dumps(result, sort_keys=True))
            candidate(native, result["summary"])
        else:
            problems = campaign / "state/analysis-result.problems.txt"
            entry["readerRejected"] = "Reader rejected" in text
            entry["problems"] = problems.read_text() if problems.exists() else None
            result = analyse(native, campaign)
            candidate(native, result["summary"])
        record(entry)
        send({"jsonrpc": "2.0", "id": request_id, "result": {"stopReason": "end_turn"}})
    except Exception as error:
        import traceback
        traceback.print_exc(file=sys.stderr)
        send({"jsonrpc": "2.0", "id": request_id, "error": {"code": -32000, "message": str(error)}})


if sys.argv[1:] == ["--version"]:
    print("1.18.34")
    sys.exit(0)
for line in sys.stdin:
    message = json.loads(line)
    method, rid = message.get("method"), message.get("id")
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": rid, "result": {"protocolVersion": 1, "agentCapabilities": {"sessionCapabilities": {"close": {}}},
                                                      "agentInfo": {"name": "stand-in resident analyst", "version": "1.18.34"}}})
    elif method == "session/new":
        send({"jsonrpc": "2.0", "id": rid, "result": {"sessionId": "native-session-1", "configOptions": []}})
    elif method == "session/set_config_option":
        send({"jsonrpc": "2.0", "id": rid, "result": {"configOptions": []}})
    elif method == "session/prompt":
        threading.Thread(target=prompt, args=(rid, "\n".join(p.get("text", "") for p in message["params"]["prompt"])),
                         daemon=True).start()
    elif method == "session/close":
        send({"jsonrpc": "2.0", "id": rid, "result": {}})
    elif method == "session/cancel":
        pass
    elif rid is not None:
        send({"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": "unsupported"}})
