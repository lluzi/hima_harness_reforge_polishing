"""Replayed research-worker-NN entry (ATCS dry path, Issues #63 and #64): no model wrote this.

The Pack's knowledge example-worker-request.md document for slot __SLOT__: its candidate is the
package prepare-workers prepared for the slot (state/workers.json, without schema and id), its
baseState the current working state. An active slot's sessionPlan is one size_cell of the block's
reg0 one size up from the master the working state's netlist gives it; slot w01 first trials reg1
as well, a move its Operator then undoes. A parked slot's request is the parked candidate alone.
"""
import json
import re
import sys
from pathlib import Path

EXAMPLE = json.loads(r'''__EXAMPLE_JSON__''')
SLOT = "__SLOT__"
workspace = Path(sys.argv[1])
working = json.loads((workspace / "state" / "working-state.json").read_text(encoding="utf-8"))
plan = json.loads((workspace / "research" / "requests" / "campaign-plan.json").read_text(encoding="utf-8"))
workers = json.loads((workspace / "state" / "workers.json").read_text(encoding="utf-8"))
package = {key: value for key, value in workers["workers"][SLOT]["workPackage"].items() if key not in ("schema", "id")}
request = {"candidate": package, "baseState": working, "siteCapabilities": plan["siteCapabilities"]}
if not package.get("parked"):
    block = package["editDomain"]["instances"][0].split("/")[0]
    netlist = (workspace / working["netlist"]["path"]).read_text(encoding="utf-8")
    module = re.search(rf"(?m)^\s*(\w+)\s+{block}\s*\(", netlist.split("module top", 1)[1]).group(1)
    body = re.search(rf"(?ms)^module\s+{module}\b.*?^endmodule", netlist).group(0)
    master = re.search(r"(?m)^\s*(\w+)\s+reg0\s*\(", body).group(1)
    step = {"BUFFD1BWP": "BUFFD2BWP", "BUFFD2BWP": "BUFFD4BWP", "BUFFD4BWP": "BUFFD8BWP"}[master]
    trial = EXAMPLE["sessionPlan"][0]
    request["sessionPlan"] = ([dict(trial, command="atcs_size_cell", object=f"{block}/reg1",
                                    hypothesis="a stronger reg1 may speed the path out of the block",
                                    falsifier="no setup gain at the target: undo it")] if SLOT == "w01" else []) + [
        dict(trial, command="atcs_size_cell", object=f"{block}/reg0",
             hypothesis=f"{master} at {block}/reg0 is too weak to meet setup at {block}/reg0/I; size it to {step}",
             falsifier="atcs_gain shows no setup gain at the target, or hold breaks; then atcs_undo")]
out = workspace / "research" / "requests" / f"worker-request-{SLOT}.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(request, indent=2) + "\n", encoding="utf-8")
