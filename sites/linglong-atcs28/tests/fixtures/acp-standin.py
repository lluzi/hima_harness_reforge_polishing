#!/usr/bin/env python3
"""Deterministic ACP v1 process used by resident wrapper protocol tests."""

import json
from hashlib import sha256
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time


write_lock = threading.Lock()
cancelled = threading.Event()
pending_permission = threading.Event()
survive_wrapper_crash = threading.Event()

if sys.argv[1:] == ["--version"]:
    print("1.18.34")
    raise SystemExit(0)


def send(value):
    with write_lock:
        sys.stdout.write(json.dumps(value, separators=(",", ":")) + "\n")
        sys.stdout.flush()


def complete_prompt(request_id, text):
    if "LONG_MESSAGE" in text:
        time.sleep(5.5)
    if "SURVIVE_WRAPPER_CRASH" in text:
        survive_wrapper_crash.set()
    if "FIX_DELIVERY" in text:
        result = b'{"schema":"fixture-result/1","value":"native"}\n'
        Path("result.json").write_bytes(result)
        candidate = {
            "schema": "hima-resident-engineering-candidate/1",
            "outcome": "completed",
            "summary": "deterministic repaired result",
            "stopReason": "fixture repaired",
            "artifacts": [{"path": "result.json", "sha256": sha256(result).hexdigest(), "kind": "result"}],
        }
        Path("resident-delivery.json").write_text(json.dumps(candidate, sort_keys=True, separators=(",", ":")))
    if "DELIVER_BAD_RESULT" in text:
        result = b'{"schema":"fixture-result/1","value":"bad"}\n'
        Path("result.json").write_bytes(result)
        candidate = {
            "schema": "hima-resident-engineering-candidate/1",
            "outcome": "completed",
            "summary": "deterministic reader-rejected result",
            "stopReason": "fixture needs format repair",
            "artifacts": [{"path": "result.json", "sha256": sha256(result).hexdigest(), "kind": "result"}],
        }
        Path("resident-delivery.json").write_text(json.dumps(candidate, sort_keys=True, separators=(",", ":")))
    elif "DELIVER_RESULT" in text or "DELIVER_BEST_EFFORT" in text:
        source = os.environ.get("STANDIN_RESULT_SOURCE")
        result = Path(source).read_bytes() if source else b'{"schema":"fixture-result/1","value":"native"}\n'
        Path("result.json").write_bytes(result)
        best_effort = "DELIVER_BEST_EFFORT" in text
        candidate = {
            "schema": "hima-resident-engineering-candidate/1",
            "outcome": "best-effort" if best_effort else "completed",
            "summary": "deterministic native result with residual" if best_effort else "deterministic native result",
            "stopReason": "residual remains" if best_effort else "fixture complete",
            "artifacts": [{"path": "result.json", "sha256": sha256(result).hexdigest(), "kind": "result"}],
        }
        Path("resident-delivery.json").write_text(json.dumps(candidate, sort_keys=True, separators=(",", ":")))
    if "SPAWN_DESCENDANT" in text:
        child = subprocess.Popen(["sleep", "60"], start_new_session=True)
        Path(os.environ["STANDIN_DESCENDANT_PID"]).write_text(str(child.pid))
        cancelled.wait(30)
        send({"jsonrpc": "2.0", "id": request_id, "result": {"stopReason": "cancelled"}})
        return
    if "REQUEST_UNKNOWN_PERMISSION" in text:
        send({
            "jsonrpc": "2.0",
            "id": "permission-1",
            "method": "session/request_permission",
            "params": {
                "sessionId": "native-session-1",
                "toolCall": {"toolCallId": "tool-1", "title": "outside", "status": "pending"},
                "options": [
                    {"optionId": "once", "kind": "allow_once", "name": "Allow once"},
                    {"optionId": "reject", "kind": "reject_once", "name": "Reject"},
                ],
            },
        })
        pending_permission.wait(5)
    if "REQUEST_GENERIC_READ_PERMISSION" in text:
        send({
            "jsonrpc": "2.0", "method": "session/update",
            "params": {
                "sessionId": "native-session-1",
                "update": {
                    "sessionUpdate": "tool_call_update", "toolCallId": "tool-read-1",
                    "kind": "read", "title": "read", "status": "in_progress",
                    "rawInput": {"filePath": "state/readiness.json"},
                },
            },
        })
        send({
            "jsonrpc": "2.0", "id": "permission-read-1", "method": "session/request_permission",
            "params": {
                "sessionId": "native-session-1",
                "toolCall": {
                    "toolCallId": "tool-read-1", "kind": "other", "title": "read",
                    "status": "pending", "rawInput": {"filePath": "state/readiness.json"},
                },
                "options": [
                    {"optionId": "once", "kind": "allow_once", "name": "Allow once"},
                    {"optionId": "reject", "kind": "reject_once", "name": "Reject"},
                ],
            },
        })
        pending_permission.wait(5)
    send({
        "jsonrpc": "2.0",
        "method": "session/update",
        "params": {
            "sessionId": "native-session-1",
            "update": {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "done"}},
        },
    })
    send({"jsonrpc": "2.0", "id": request_id, "result": {"stopReason": "end_turn"}})


for raw in sys.stdin:
    message = json.loads(raw)
    method = message.get("method")
    request_id = message.get("id")
    if method == "initialize":
        send({
            "jsonrpc": "2.0", "id": request_id,
            "result": {
                "protocolVersion": 1,
                "agentCapabilities": {"sessionCapabilities": {"close": {}}},
                "agentInfo": {"name": "OpenCode stand-in", "version": "1.18.34"},
            },
        })
    elif method == "session/new":
        send({"jsonrpc": "2.0", "id": request_id, "result": {"sessionId": "native-session-1", "configOptions": []}})
    elif method == "session/set_config_option":
        assert message["params"] == {
            "sessionId": "native-session-1", "configId": "model", "value": "deepseek/deepseek-flash"
        }
        send({"jsonrpc": "2.0", "id": request_id, "result": {"configOptions": []}})
    elif method == "session/prompt":
        text = "\n".join(part.get("text", "") for part in message["params"]["prompt"])
        threading.Thread(target=complete_prompt, args=(request_id, text), daemon=True).start()
    elif method == "session/cancel":
        cancelled.set()
    elif method == "session/close":
        send({"jsonrpc": "2.0", "id": request_id, "result": {}})
    elif request_id in {"permission-1", "permission-read-1"}:
        Path(os.environ["STANDIN_PERMISSION_RESPONSE"]).write_text(json.dumps(message["result"]))
        pending_permission.set()
    elif request_id is not None:
        send({"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": "unsupported"}})

if survive_wrapper_crash.is_set():
    signal.pause()
