"""Replayed plan-campaign entry (ATCS dry path, Issues #63 and #64): no model wrote this.

The Pack's knowledge example-campaign-plan.md document with its values changed: every work package
and the envelope's baseState are bound to this Campaign's current working state, and each active
slot wNN works one block of the synthetic design, blockers first: its target is the setup endpoint
u_X/reg0/I of func_ssg_rcworst (w01 u_a .. w06 u_f), its edit domain that block's two leaf cells, and
its scope the example's. The slots named in PARKED take the example's parked shape.
"""
import json
import sys
from pathlib import Path

EXAMPLE = json.loads(r'''__EXAMPLE_JSON__''')
PARKED = json.loads(r'''__PARKED_JSON__''')
workspace = Path(sys.argv[1])
working = json.loads((workspace / "state" / "working-state.json").read_text(encoding="utf-8"))
active_example = EXAMPLE["candidate"]["workPackages"]["w01"]
parked_example = EXAMPLE["candidate"]["workPackages"]["w02"]
packages = {}
for index, slot in enumerate(["w01", "w02", "w03", "w04", "w05", "w06"]):
    block = "u_" + "abcdef"[index]
    if slot in PARKED:
        packages[slot] = dict(parked_example, taskId=slot, baseStateId=working["id"],
                              problem="no blocker cluster left for this slot this generation")
        continue
    endpoint = f"{block}/reg0/I"
    packages[slot] = dict(
        active_example, taskId=slot, baseStateId=working["id"],
        problem=f"func_ssg_rcworst worst setup check of block {block} at {endpoint}",
        targets=[f"func_ssg_rcworst|setup|{endpoint}"],
        editDomain={"instances": [f"{block}/reg0", f"{block}/reg1"], "nets": [], "regions": []},
        mayAffect=[], actions=["size_cell"], targetPins=[endpoint])
plan = dict(EXAMPLE, baseState=working, candidate=dict(
    EXAMPLE["candidate"], workPackages=packages,
    reason="one blocker cluster per block: each active slot sizes its own block's setup endpoint"))
out = workspace / "research" / "requests" / "campaign-plan.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(plan, indent=2) + "\n", encoding="utf-8")
