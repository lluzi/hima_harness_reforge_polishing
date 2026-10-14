#!/usr/bin/env python3
"""ACP v1 stand-in for the andes-cell-fmax resident engineering roles.

Modelled on `test/fixtures/mage-resident-dry/acp.py` and the ATCS one: this
process is the `native.executable` the resident-engineering wrapper launches. It
speaks JSON-RPC over stdio (`initialize`, `session/new`,
`session/set_config_option`, `session/prompt`, `session/close`,
`session/cancel`) and, on the first `session/prompt`, reads `task.json` from the
parent of its own cwd (the wrapper launches it with `cwd=<private workspace>`,
so `Path.cwd().parent` is the task directory that holds `task.json`).

It never hand-writes a requirements, plan, cell-check or cell-screen document:
every delivery is drafted by running the Pack's own `flow/andes_cli.py draft`
over the Site tools' own output, exactly as each agent's playbook says and as
the pre-DBOS dry test's `drafted()` helper did. The five roles are
himatime-agent, qualib-agent, andescell-agent, himatime-verify and qualib-screen
(the toolId in `task.json`). The Site EDA root is `CTU_EDA_ROOT`; the design
data is the synthetic `CTU_OPENC910_DATA` bundle; both are set by the worker into
the resident capability environment. Every number is a mock tool's, from
synthetic data — not signoff, not silicon.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import threading

lock = threading.Lock()
first = True
_calls = 0

# toolId (graph node) -> the `andes_cli.py draft` kind.
KIND = {
    "himatime-agent": "himatime",
    "qualib-agent": "qualib",
    "andescell-agent": "andescell",
    "himatime-verify": "himatime-verify",
    "qualib-screen": "qualib-screen",
}


def send(value):
    with lock:
        print(json.dumps(value), flush=True)


def _update(update):
    # Display traffic like a real native session's: the wrapper turns it into state.json activity.
    send({"jsonrpc": "2.0", "method": "session/update",
          "params": {"sessionId": "andes-dry-session-1", "update": update}})


def _run(argv, cwd, title):
    global _calls
    _calls += 1
    _update({"sessionUpdate": "tool_call", "toolCallId": f"call-{_calls}", "kind": "execute",
             "title": title, "status": "in_progress"})
    result = subprocess.run([str(a) for a in argv], cwd=str(cwd), capture_output=True, text=True, env=os.environ)
    if result.returncode != 0:
        raise RuntimeError(f"{title} failed ({result.returncode}): {result.stderr}\n{result.stdout}")
    _update({"sessionUpdate": "tool_call", "toolCallId": f"call-{_calls}", "kind": "execute",
             "title": title, "status": "completed"})
    return result


def _tool(eda_root, name, *args, cwd):
    return _run([sys.executable, str(Path(eda_root) / "bin" / name), *args], cwd, f"{name} {args[0]}")


def _file_sha256(path):
    import hashlib
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def deliver(task, native):
    campaign = Path(task["campaignWorkspace"])
    tool_id = task["task"]["toolId"]
    kind = KIND[tool_id]
    cli = campaign / "flow" / "andes_cli.py"
    eda_root = os.environ["CTU_EDA_ROOT"]

    timing = json.loads((campaign / "state" / "timing.json").read_text(encoding="utf-8"))
    k = int(timing["round"])
    db = campaign / timing["buildDir"]

    # Per role: run the Site tools the agent's playbook runs, keep their human-readable report as
    # support, and draft the delivery from the tool's own JSON. `kept()` records a tool report under
    # the Pack artifactPrefix (reports/<node>/r<k>/) so the Reader and a person can both open it.
    report_rel = Path("reports") / tool_id / f"r{k}"
    report_dir = native / report_rel
    report_dir.mkdir(parents=True, exist_ok=True)
    support_rel = []

    def kept(src):
        destination = report_dir / Path(src).name
        destination.write_bytes(Path(src).read_bytes())
        support_rel.append((report_rel / Path(src).name).as_posix())

    tool_json = None
    if kind == "himatime":
        _tool(eda_root, "himatime", "highvalue", "--db", db, "--out", native / "hv", "--quiet", cwd=native)
        _tool(eda_root, "himatime", "whatif", "--db", db, "--scale", "0.9", "--out", native / "hw", "--quiet", cwd=native)
        tool_json = native / "hw" / "whatif.json"
        kept(native / "hv" / "high_value_cells.rpt")
    elif kind == "qualib":
        _tool(eda_root, "himatime", "whatif", "--db", db, "--scale", "0.9", "--out", native / "hw", "--quiet", cwd=native)
        _tool(eda_root, "qualib", "analyze", "--db", db, "--arcs", native / "hw" / "whatif.json", "--out", native / "ql", "--quiet", cwd=native)
        tool_json = native / "ql" / "library_analysis.json"
        kept(native / "ql" / "library_analysis.rpt")
    elif kind == "andescell":
        tool_json = None  # draft reads the two committed requirement lists from the Campaign state
    elif kind in ("himatime-verify", "qualib-screen"):
        generation = json.loads((campaign / "state" / "generation.json").read_text(encoding="utf-8"))
        _tool(eda_root, "himatime", "verify", "--cells", campaign / generation["dir"], "--db", db, "--out", native / "hv", "--quiet", cwd=native)
        if kind == "himatime-verify":
            tool_json = native / "hv" / "verify.json"
            kept(native / "hv" / "verify.rpt")
        else:
            _tool(eda_root, "qualib", "screen", "--cells", native / "hv" / "kept", "--out", native / "qs", "--quiet", cwd=native)
            tool_json = native / "qs" / "screen.json"
            kept(native / "qs" / "cell_screen.rpt")

    draft_argv = [sys.executable, str(cli), "draft", str(campaign), kind]
    if tool_json is not None:
        draft_argv.append(str(tool_json))
    doc = json.loads(_run(draft_argv, native, f"andes_cli.py draft {kind}").stdout)
    doc["summary"] = f"Round {k}: the stand-in {kind} delivery, drafted from the tool's own output."
    if "reason" in doc:
        doc["reason"] = "Every arc both lists allow, at the Site's AndesCell settings."
    analysis_rel = (report_rel / "analysis.md").as_posix()
    doc["report"] = analysis_rel
    (report_dir / "analysis.md").write_text(f"# {tool_id} round {k}\n\nStand-in analysis.\n", encoding="utf-8")
    support_rel.append(analysis_rel)

    result_path = native / "delivery-result.json"
    result_path.write_text(json.dumps(doc), encoding="utf-8")

    artifacts = [{"path": "delivery-result.json", "sha256": _file_sha256(result_path), "kind": "result"}]
    for rel in sorted(set(support_rel)):
        artifacts.append({"path": rel, "sha256": _file_sha256(native / rel), "kind": "support"})
    candidate = {
        "schema": "hima-resident-engineering-candidate/1", "outcome": "completed",
        "summary": f"{tool_id} round {k} delivery assembled", "stopReason": "", "artifacts": artifacts,
    }
    (native / "resident-delivery.json").write_text(json.dumps(candidate), encoding="utf-8")


def handle_initial_prompt():
    native = Path.cwd()
    task = json.loads((native.parent / "task.json").read_text(encoding="utf-8"))
    deliver(task, native)


def prompt(request_id, initial):
    try:
        if initial:
            _update({"sessionUpdate": "plan", "entries": [
                {"content": "read the task", "status": "completed"},
                {"content": "deliver", "status": "pending"}]})
            handle_initial_prompt()
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
    method = message.get("method")
    rid = message.get("id")
    if method == "initialize":
        send({"jsonrpc": "2.0", "id": rid, "result": {
            "protocolVersion": 1, "agentCapabilities": {"sessionCapabilities": {"close": {}}},
            "agentInfo": {"name": "andes-resident-dry stand-in", "version": "1.18.34"}}})
    elif method == "session/new":
        send({"jsonrpc": "2.0", "id": rid, "result": {"sessionId": "andes-dry-session-1", "configOptions": []}})
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
