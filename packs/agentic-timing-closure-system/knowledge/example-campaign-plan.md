# Example: campaign plan

The `campaign-plan` Reader (`tools/read-atcs.py`) admits this exact document with zero problems; copy its shape and change only the values, keeping every edit-domain and protected instance a full hierarchical path from `top` such as `u_a/reg0`.

```json
{
  "candidate": {
    "workPackages": {
      "w01": {
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
      "w02": {
        "taskId": "w02",
        "baseStateId": "3956975ce47374c313fc",
        "problem": "setup violation on the func_ssg_rcworst_m40 corner",
        "targets": ["func_ssg_rcworst_m40|setup|Y"],
        "editDomain": {"instances": ["u_b/reg0"], "nets": [], "regions": []},
        "protected": {"instances": ["u_b/reg1"], "nets": []},
        "mayAffect": [],
        "actions": ["size_cell", "insert_buffer"],
        "budget": {"xtopMinutes": 30, "queries": 5, "attempts": 3}
      },
      "w03": {
        "taskId": "w03",
        "baseStateId": "3956975ce47374c313fc",
        "problem": "no known-worthwhile fix at this checkpoint; diagnosis-only slot",
        "targets": ["func_ssg_rcworst_m40|hold|Z"],
        "editDomain": {"instances": ["u_c/reg0"], "nets": [], "regions": []},
        "protected": {"instances": ["u_c/reg1"], "nets": []},
        "mayAffect": [],
        "actions": ["size_cell"],
        "budget": {"xtopMinutes": 15, "queries": 3, "attempts": 2}
      }
    },
    "reason": "close the campaign's targeted setup/hold checks with three bounded packages"
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
  "siteCapabilities": {"pgVerification": false}
}
```
