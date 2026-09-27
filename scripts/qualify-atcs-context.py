#!/usr/bin/env python3
"""One isolated ATCS-06 context preparation; no Campaign, mutation or historical writes."""
import json
import subprocess
import sys
from pathlib import Path

workspace = Path(sys.argv[1]).resolve()
cli = workspace / "flow/atcs_cli.py"
inputs = workspace / "inputs"
receipts = workspace / "qualification"
receipts.mkdir(exist_ok=True)

if "--prepare-worker" in sys.argv:
    import re
    sys.path.insert(0, str(workspace / "flow"))
    from atcs import core
    base = core.read_artifact(workspace / "state/working-state.json", "design-state")
    netlist = (workspace / base["netlist"]["path"]).read_text()
    top = re.search(r"(?ms)^module\s+" + re.escape(base["top"]) + r"\b.*?^endmodule", netlist)
    if top is None:
        raise SystemExit("qualified top module is missing")
    candidates = re.findall(r"(?m)^\s*(BUFFD2BWP\w*)\s+(\\?[^\s(]+)\s*\(", top.group())
    candidates = [(master, instance.lstrip("\\")) for master, instance in candidates
                  if not re.search("clk|clock", instance, re.I)]
    if not candidates:
        raise SystemExit("no bounded non-clock buffer candidate")
    master, instance = candidates[0]
    to_master = master.replace("BUFFD2", "BUFFD4", 1)
    attempt = len(list(receipts.glob("action*.json"))) + 1
    packages = {}
    for slot in ("w01", "w02", "w03"):
        packages[slot] = {"taskId": slot, "baseStateId": base["id"],
            "problem": "bounded qualification of one top-level data buffer sizing command; attempt " + str(attempt),
            "targets": [], "editDomain": {"instances": [instance] if slot == "w01" else [], "nets": [], "regions": []},
            "protected": {"instances": [], "nets": []}, "mayAffect": [], "actions": ["size_cell"],
            "budget": {"xtopMinutes": 5, "queries": 2, "attempts": 1}}
    plan = receipts / ("campaign-plan-" + str(attempt) + ".json")
    with plan.open("x") as output:
        output.write(json.dumps({"candidate": {"workPackages": packages, "reason": "one isolated L4 worker"}}))
    result = subprocess.run(["python3", str(cli), "prepare-workers", str(workspace),
        str(workspace / "state/working-state.json"), str(inputs / "siteCapabilities.json"),
        str(inputs / "siteCapabilities.json"), str(plan)], capture_output=True, text=True, timeout=120)
    (receipts / ("prepare-workers-" + str(attempt) + ".log")).write_text(result.stdout + result.stderr)
    if result.returncode:
        raise SystemExit(result.returncode)
    with (receipts / ("action-" + str(attempt) + ".json")).open("x") as output:
        output.write(json.dumps({"instance": instance, "fromMaster": master, "toMaster": to_master}))
    print(json.dumps({"gate": "prepared-worker", "instance": instance, "fromMaster": master, "toMaster": to_master}), flush=True)
    raise SystemExit(0)

def run(name, arguments):
    log = receipts / (name + ".log")
    with log.open("xb") as output:
        result = subprocess.run(["python3", str(cli), *arguments], stdout=output,
                                stderr=subprocess.STDOUT, timeout=900)
    print(json.dumps({"gate": name, "exit": result.returncode, "log": str(log)}), flush=True)
    if result.returncode:
        raise SystemExit(result.returncode)

run("baseline", ["baseline", str(workspace), str(inputs / "designStateManifest.json")])
run("observe", ["observe", str(workspace), str(inputs / "analysisContract/query-spec.json"),
                str(inputs / "siteCapabilities.json"), str(inputs / "analysisContract/scenarios.json"), "1000"])
sys.path.insert(0, str(workspace / "flow"))
from atcs import core
context = core.read_artifact(workspace / "state/xtop-context.json", "xtop-context")
print(json.dumps({"gate": "sealed-context", "id": context["id"],
                  "state": context["designStateId"], "requiredScenarios": context["requiredScenarios"]}), flush=True)
