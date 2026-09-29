"""Replayed research-worker-01 entry (ATCS dry path, Issue #63): no model wrote this.

The Pack's knowledge example-worker-request.md document with its values changed: slot w01's
admitted work package, the current working state, and one size_cell of u_a/reg0 one size up from
the master the working state's netlist gives it (BUF1 to BUF2, then BUF2 to BUF4).
"""
import json
import re
import sys
from pathlib import Path

EXAMPLE = json.loads(r'''__EXAMPLE_JSON__''')
workspace = Path(sys.argv[1])
working = json.loads((workspace / "state" / "working-state.json").read_text(encoding="utf-8"))
plan = json.loads((workspace / "research" / "requests" / "campaign-plan.json").read_text(encoding="utf-8"))
netlist = (workspace / working["netlist"]["path"]).read_text(encoding="utf-8")
master = re.search(r"(?m)^\s*(\w+)\s+reg0\s*\(", netlist).group(1)
request = dict(EXAMPLE, candidate=plan["candidate"]["workPackages"]["w01"], baseState=working,
               actions=[{"instance": "u_a/reg0", "toMaster": "BUF2" if master == "BUF1" else "BUF4"}])
out = workspace / "research" / "requests" / "worker-request-w01.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(request, indent=2) + "\n", encoding="utf-8")
