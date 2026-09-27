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
