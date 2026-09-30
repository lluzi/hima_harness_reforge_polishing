# Example: worker request

The `worker-request` Reader of each slot (`tools/read-atcs.py`) admits these documents with zero
problems once each `"<...>"` string is replaced. They are written for slot `w01`; for slot `wNN` the
only change is `taskId`, exactly `wNN`. `candidate` is the slot's prepared package,
`state/workers.json` `workers.<slot>.workPackage` with only its `schema` and `id` removed, never edited,
narrowed or widened; `baseState` is `state/working-state.json` verbatim; `siteCapabilities` is copied
from the campaign plan. The candidate carries the plan's `cluster` unchanged: the seat's blocker
cluster, its `targets` hardest first. The Reader's refusal, one line per problem, is
`workerRequestNNProblems`.

## Active slot

`sessionPlan` is yours: the ordered typed `atcs_*` commands to try, each with its hypothesis and its
falsifier. An `atcs_size_cell` entry also names `toMaster`: one cell of this design's libraries with the
object's cell function, the name up to the drive digits of `ecoParameters.cellNominalSizingPattern` in
`state/xtop-context.json` (`BUFFD2BWP35P140` is function `BUFFD`, drive 2, so `BUFFD4BWP35P140` sizes it
up); the drive or the VT may change, the function may not. The cells are the `cell (NAME)` groups of the
Liberty files that file lists in `libraryFiles` (it holds no cell table itself);
`hima-readers/atcs-readiness/read-atcs.py masters` lists them for each instance; the Reader writes any other
`toMaster` as advice, never as a refusal. An entry's `object` may be a cell the plan does not list, such as
the driver or a load of a target pin's net: the session derives its local domain around the target pins
and plan instances, and the toolkit refuses a cell outside it. The Reader writes such an object as advice.

```json
{
  "candidate": {
    "taskId": "w01",
    "baseStateId": "<id of state/working-state.json>",
    "problem": "func_ssg_rcworst_m40 worst setup check at u_core/u_lsu/data_reg_3_/D and worst hold check at u_core/u_lsu/addr_reg_0_/D; auto-finish left both unfixed",
    "cluster": {
      "cause": "scenario-worst",
      "key": "func_ssg_rcworst_m40",
      "checks": [
        "func_ssg_rcworst_m40|setup|u_core/u_lsu/data_reg_3_/D",
        "func_ssg_rcworst_m40|hold|u_core/u_lsu/addr_reg_0_/D"
      ]
    },
    "targets": [
      "func_ssg_rcworst_m40|setup|u_core/u_lsu/data_reg_3_/D",
      "func_ssg_rcworst_m40|hold|u_core/u_lsu/addr_reg_0_/D"
    ],
    "editDomain": {
      "instances": [
        "u_core/u_lsu/data_reg_3_",
        "u_core/u_lsu/addr_reg_0_",
        "u_core/u_lsu/U2231"
      ],
      "nets": [
        "u_core/u_lsu/n4410"
      ],
      "regions": [
        [
          120.0,
          340.0,
          180.0,
          400.0
        ]
      ]
    },
    "protected": {
      "instances": [],
      "nets": []
    },
    "mayAffect": [
      "func_ssg_rcworst_m40|hold|u_core/u_lsu/data_reg_3_/D"
    ],
    "actions": [
      "size_cell",
      "insert_buffer"
    ],
    "budget": {
      "xtopMinutes": 60,
      "attempts": 3
    },
    "targetPins": [
      "u_core/u_lsu/data_reg_3_/D",
      "u_core/u_lsu/addr_reg_0_/D"
    ],
    "scope": {
      "commands": ["atcs_size_cell", "atcs_exchange_cell", "atcs_insert_buffer", "atcs_insert_dummy", "atcs_split_load", "atcs_split_net", "atcs_move_cell", "atcs_remove_buffer", "atcs_fix_hold_pins", "atcs_fix_setup_pins", "atcs_undo"],
      "maxMutations": 120
    },
    "observe": "fast"
  },
  "baseState": "<the whole JSON object in state/working-state.json, verbatim>",
  "siteCapabilities": {
    "pgVerification": false
  },
  "sessionPlan": [
    {
      "command": "atcs_size_cell",
      "object": "u_core/u_lsu/U2231",
      "toMaster": "BUFFD4BWP35P140",
      "hypothesis": "the weak driver of the data_reg_3_/D path limits setup",
      "falsifier": "atcs_gain shows no setup gain on the target, or the hold check breaks; then atcs_undo"
    },
    {
      "command": "atcs_insert_dummy",
      "object": "u_core/u_lsu/addr_reg_0_/D",
      "hypothesis": "a dummy load on the short hold path closes hold",
      "falsifier": "no hold gain on the target, or setup breaks; then atcs_undo"
    }
  ]
}
```

## Active slot with no safe move

When research finds no safe move for an active slot, never invent one and never write a placeholder
command: state why in `noSafeAction` (the evidence that rules each move out) and leave `sessionPlan`
empty. The slot's Team then reviews no move: the Reviewer approves only `atcs_undo` with a budget of
1, the Operator reads, dumps and closes with `stopReason` `no-safe-action`, and the capture seals an
honest no-fix.

```json
{
  "candidate": {
    "taskId": "w01",
    "baseStateId": "<id of state/working-state.json>",
    "problem": "func_ssg_rcworst_m40 worst setup check at u_core/u_lsu/data_reg_3_/D and worst hold check at u_core/u_lsu/addr_reg_0_/D; auto-finish left both unfixed",
    "cluster": {
      "cause": "scenario-worst",
      "key": "func_ssg_rcworst_m40",
      "checks": [
        "func_ssg_rcworst_m40|setup|u_core/u_lsu/data_reg_3_/D",
        "func_ssg_rcworst_m40|hold|u_core/u_lsu/addr_reg_0_/D"
      ]
    },
    "targets": [
      "func_ssg_rcworst_m40|setup|u_core/u_lsu/data_reg_3_/D",
      "func_ssg_rcworst_m40|hold|u_core/u_lsu/addr_reg_0_/D"
    ],
    "editDomain": {
      "instances": [
        "u_core/u_lsu/data_reg_3_",
        "u_core/u_lsu/addr_reg_0_",
        "u_core/u_lsu/U2231"
      ],
      "nets": [
        "u_core/u_lsu/n4410"
      ],
      "regions": [
        [
          120.0,
          340.0,
          180.0,
          400.0
        ]
      ]
    },
    "protected": {
      "instances": [],
      "nets": []
    },
    "mayAffect": [
      "func_ssg_rcworst_m40|hold|u_core/u_lsu/data_reg_3_/D"
    ],
    "actions": [
      "size_cell",
      "insert_buffer"
    ],
    "budget": {
      "xtopMinutes": 60,
      "attempts": 3
    },
    "targetPins": [
      "u_core/u_lsu/data_reg_3_/D",
      "u_core/u_lsu/addr_reg_0_/D"
    ],
    "scope": {
      "commands": ["atcs_size_cell", "atcs_exchange_cell", "atcs_insert_buffer", "atcs_insert_dummy", "atcs_split_load", "atcs_split_net", "atcs_move_cell", "atcs_remove_buffer", "atcs_fix_hold_pins", "atcs_fix_setup_pins", "atcs_undo"],
      "maxMutations": 120
    },
    "observe": "fast"
  },
  "baseState": "<the whole JSON object in state/working-state.json, verbatim>",
  "siteCapabilities": {
    "pgVerification": false
  },
  "sessionPlan": [],
  "noSafeAction": "every ladder move on u_core/u_lsu/data_reg_3_/D breaks the opposite check in the cited paths; the hold path has no dummy site in the edit domain"
}
```

## Parked slot

The prepared package has `parked: true`: the candidate stays exactly that shape and there is no
`sessionPlan`. The slot's operate node is then the parked no-op; no Team member is created for it.

```json
{
  "candidate": {
    "taskId": "w01",
    "baseStateId": "<id of state/working-state.json>",
    "parked": true,
    "problem": "no blocker cluster left for this slot"
  },
  "baseState": "<the whole JSON object in state/working-state.json, verbatim>",
  "siteCapabilities": {
    "pgVerification": false
  }
}
```
