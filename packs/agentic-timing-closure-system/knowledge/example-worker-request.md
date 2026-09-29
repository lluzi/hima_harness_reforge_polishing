# Example: worker request

The `worker-request` Reader (`tools/read-atcs.py`) admits this exact document for slot w01 (and, with only `taskId` changed, for w02 and w03): its `candidate` is the w01 package of `example-campaign-plan.md` unchanged, and every action `instance` is a full hierarchical path from `top` (`u_a/reg0`, never the bare leaf `reg0`) listed in `candidate.editDomain.instances`. Each `toMaster` is a library cell with the same function and VT as the instance's current cell, differing only in drive strength (`DFQD1BWP35P140` to `DFQD2BWP35P140`, never a buffer, another VT or a cell outside the Liberty files `state/xtop-context.json` seals). If no safe size_cell action can be resolved, exit non-zero printing the reason; never write an empty or placeholder actions list. A non-zero exit is a coding diagnostic you revise in the same Workshop; an empty list is a refused request.

```json
{
  "candidate": {
    "taskId": "w01",
    "baseStateId": "3956975ce47374c313fc",
    "problem": "hold violation on endpoint X after post-route ECO",
    "targets": ["func_ssg_rcworst_m40|hold|X"],
    "editDomain": {"instances": ["u_a/reg0"], "nets": [], "regions": []},
    "protected": {"instances": ["u_a/reg1"], "nets": []},
    "mayAffect": [],
    "actions": ["size_cell"],
    "budget": {"xtopMinutes": 30, "queries": 5, "attempts": 3}
  },
  "baseState": {
    "database": {
      "datDigest": "0bf6cd9868f2a748f3737c293188356ead474e315dc7e8d9621287eaf507d7c3",
      "path": "inputs/baseline/top.enc",
      "sha256": "8b46fe69ebc1002226688c1b4b4346e2d505430561242a3470c8651c3970831c"
    },
    "def": null,
    "id": "3956975ce47374c313fc",
    "netlist": {
      "path": "inputs/baseline/top.v",
      "sha256": "c0051d99a9a0331b5a51aceb08d54b0eb267823ecc54238c738beff3574ba778"
    },
    "parentId": null,
    "scenarios": ["func_ssg_rcworst_m40"],
    "schema": "atcs.design-state/1",
    "sdc": [
      {
        "path": "inputs/baseline/top.sdc",
        "sha256": "e2fad3e0c7f042d8b2ca2a53cf6b7a9586d4439b566eaa11894ee21941012b19"
      }
    ],
    "spef": {
      "m40": {
        "path": "inputs/baseline/func_ssg_rcworst_m40.spef",
        "sha256": "4f48dac61bfcc6af1354010fb7f7d9bd1a2c19cae0a8d69ef0421086912979e8"
      }
    },
    "stage": "postroute",
    "tools": {},
    "top": "top"
  },
  "siteCapabilities": {"pgVerification": false},
  "actions": [
    {"instance": "u_a/reg0", "toMaster": "DFQD2BWP35P140"}
  ]
}
```
