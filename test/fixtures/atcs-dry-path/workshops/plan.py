"""Replayed plan-campaign entry (ATCS dry path, Issue #63): no model wrote this.

The Pack's knowledge example-campaign-plan.md document with its values changed: every work package
and the envelope's baseState are bound to this Campaign's current working state, and w01 targets
the one failing check of the synthetic design (u_a/reg0 is already its edit domain).
"""
import json
import sys
from pathlib import Path

EXAMPLE = json.loads(r'''__EXAMPLE_JSON__''')
workspace = Path(sys.argv[1])
working = json.loads((workspace / "state" / "working-state.json").read_text(encoding="utf-8"))
packages = {slot: dict(package, baseStateId=working["id"]) for slot, package in EXAMPLE["candidate"]["workPackages"].items()}
packages["w01"].update(problem="setup violation on u_a/reg0/D in func_ssg_rcworst",
                       targets=["func_ssg_rcworst|setup|u_a/reg0/D"])
plan = dict(EXAMPLE, baseState=working, candidate=dict(EXAMPLE["candidate"], workPackages=packages))
out = workspace / "research" / "requests" / "campaign-plan.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(plan, indent=2) + "\n", encoding="utf-8")
