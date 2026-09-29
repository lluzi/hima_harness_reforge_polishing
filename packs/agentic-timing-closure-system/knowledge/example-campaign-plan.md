# Example: campaign plan

The `campaign-plan` Reader (`tools/read-atcs.py`) admits this document with zero problems once each
`"<...>"` string is replaced as it says: `baseState` is the whole object in `state/working-state.json`,
copied verbatim, and every `baseStateId` is its `id`. It holds all six slots keyed `w01`..`w06`, each
`taskId` exactly its key, and fills all six seats of `workerSlots` 6 with one blocker cluster each
(`observe` is optional). The fixture's observation has seven violating checks: `w01` takes the required
scenario's worst setup and worst hold check, which share the leaf cells of `u_core/u_lsu`, and `w02`..`w06`
each take the next worst violating check, in leaf cells no other slot claims.

Blockers first means every seat up to `workerSlots` works a cluster while any violating check of a
required scenario is covered by no active slot: after the worst setup and hold check of each scenario,
take the next worst checks of `state/observation.json` (and the cases of `state/residual-cases.json`),
resolve their endpoints to leaf cells (knowledge endpoint-resolution.md), and give each seat one
cluster whose cells no other active slot claims; a check whose cells an active slot already holds goes
into that slot's `targets`. The first generation has no batch fail reasons, which is no reason to park.
A slot is parked only above `workerSlots`, or when every violating check is covered; its package is
exactly `{"taskId": "w06", "baseStateId": "<id of state/working-state.json>", "parked": true, "problem":
"<why it is parked>"}` and no other key. The Reader's refusal of a plan, one line per problem, is
`campaignPlanProblems`; a parked seat while a check is uncovered is never refused, but that file names
it in an advice line with the worst uncovered check.

```json
{
  "candidate": {
    "workPackages": {
      "w01": {
        "taskId": "w01",
        "baseStateId": "<id of state/working-state.json>",
        "problem": "func_ssg_rcworst_m40 worst setup check at u_core/u_lsu/data_reg_3_/D and worst hold check at u_core/u_lsu/addr_reg_0_/D; auto-finish left both unfixed",
        "targets": ["func_ssg_rcworst_m40|setup|u_core/u_lsu/data_reg_3_/D", "func_ssg_rcworst_m40|hold|u_core/u_lsu/addr_reg_0_/D"],
        "editDomain": {
          "instances": ["u_core/u_lsu/data_reg_3_", "u_core/u_lsu/addr_reg_0_", "u_core/u_lsu/U2231"],
          "nets": ["u_core/u_lsu/n4410"],
          "regions": [[120.0, 340.0, 180.0, 400.0]]
        },
        "protected": {
          "instances": [],
          "nets": []
        },
        "mayAffect": ["func_ssg_rcworst_m40|hold|u_core/u_lsu/data_reg_3_/D"],
        "actions": ["size_cell", "insert_buffer"],
        "budget": {
          "xtopMinutes": 60,
          "attempts": 3
        },
        "targetPins": ["u_core/u_lsu/data_reg_3_/D", "u_core/u_lsu/addr_reg_0_/D"],
        "scope": {
          "commands": ["atcs_size_cell", "atcs_exchange_cell", "atcs_insert_buffer", "atcs_insert_dummy", "atcs_split_load", "atcs_split_net", "atcs_move_cell", "atcs_remove_buffer", "atcs_fix_hold_pins", "atcs_fix_setup_pins", "atcs_undo"],
          "maxMutations": 120
        },
        "observe": "fast"
      },
      "w02": {
        "taskId": "w02",
        "baseStateId": "<id of state/working-state.json>",
        "problem": "func_ssg_rcworst_m40 next worst setup check at u_core/u_ifu/pc_reg_1_/D, in u_core/u_ifu",
        "targets": ["func_ssg_rcworst_m40|setup|u_core/u_ifu/pc_reg_1_/D"],
        "editDomain": {
          "instances": ["u_core/u_ifu/pc_reg_1_", "u_core/u_ifu/U880"],
          "nets": ["u_core/u_ifu/n212"],
          "regions": [[200.0, 340.0, 240.0, 380.0]]
        },
        "protected": {
          "instances": [],
          "nets": []
        },
        "mayAffect": ["func_ssg_rcworst_m40|hold|u_core/u_ifu/pc_reg_1_/D"],
        "actions": ["size_cell", "insert_buffer"],
        "budget": {
          "xtopMinutes": 60,
          "attempts": 3
        },
        "targetPins": ["u_core/u_ifu/pc_reg_1_/D"],
        "scope": {
          "commands": ["atcs_size_cell", "atcs_exchange_cell", "atcs_insert_buffer", "atcs_insert_dummy", "atcs_split_load", "atcs_split_net", "atcs_move_cell", "atcs_remove_buffer", "atcs_fix_hold_pins", "atcs_fix_setup_pins", "atcs_undo"],
          "maxMutations": 120
        },
        "observe": "fast"
      },
      "w03": {
        "taskId": "w03",
        "baseStateId": "<id of state/working-state.json>",
        "problem": "func_ssg_rcworst_m40 setup check at u_core/u_dec/ins_reg_7_/D, in u_core/u_dec",
        "targets": ["func_ssg_rcworst_m40|setup|u_core/u_dec/ins_reg_7_/D"],
        "editDomain": {
          "instances": ["u_core/u_dec/ins_reg_7_", "u_core/u_dec/U517"],
          "nets": ["u_core/u_dec/n98"],
          "regions": [[260.0, 340.0, 300.0, 380.0]]
        },
        "protected": {
          "instances": [],
          "nets": []
        },
        "mayAffect": ["func_ssg_rcworst_m40|hold|u_core/u_dec/ins_reg_7_/D"],
        "actions": ["size_cell", "insert_buffer"],
        "budget": {
          "xtopMinutes": 60,
          "attempts": 3
        },
        "targetPins": ["u_core/u_dec/ins_reg_7_/D"],
        "scope": {
          "commands": ["atcs_size_cell", "atcs_exchange_cell", "atcs_insert_buffer", "atcs_insert_dummy", "atcs_split_load", "atcs_split_net", "atcs_move_cell", "atcs_remove_buffer", "atcs_fix_hold_pins", "atcs_fix_setup_pins", "atcs_undo"],
          "maxMutations": 120
        },
        "observe": "fast"
      },
      "w04": {
        "taskId": "w04",
        "baseStateId": "<id of state/working-state.json>",
        "problem": "func_ssg_rcworst_m40 hold check at u_core/u_exu/mul_reg_2_/D, in u_core/u_exu",
        "targets": ["func_ssg_rcworst_m40|hold|u_core/u_exu/mul_reg_2_/D"],
        "editDomain": {
          "instances": ["u_core/u_exu/mul_reg_2_"],
          "nets": [],
          "regions": [[320.0, 340.0, 360.0, 380.0]]
        },
        "protected": {
          "instances": [],
          "nets": []
        },
        "mayAffect": ["func_ssg_rcworst_m40|setup|u_core/u_exu/mul_reg_2_/D"],
        "actions": ["size_cell"],
        "budget": {
          "xtopMinutes": 60,
          "attempts": 3
        },
        "targetPins": ["u_core/u_exu/mul_reg_2_/D"],
        "scope": {
          "commands": ["atcs_size_cell", "atcs_exchange_cell", "atcs_insert_buffer", "atcs_insert_dummy", "atcs_split_load", "atcs_split_net", "atcs_move_cell", "atcs_remove_buffer", "atcs_fix_hold_pins", "atcs_fix_setup_pins", "atcs_undo"],
          "maxMutations": 120
        },
        "observe": "fast"
      },
      "w05": {
        "taskId": "w05",
        "baseStateId": "<id of state/working-state.json>",
        "problem": "func_ssg_rcworst_m40 hold check at u_dma/fifo_reg_0_/D, in u_dma",
        "targets": ["func_ssg_rcworst_m40|hold|u_dma/fifo_reg_0_/D"],
        "editDomain": {
          "instances": ["u_dma/fifo_reg_0_"],
          "nets": [],
          "regions": [[40.0, 120.0, 80.0, 160.0]]
        },
        "protected": {
          "instances": [],
          "nets": []
        },
        "mayAffect": ["func_ssg_rcworst_m40|setup|u_dma/fifo_reg_0_/D"],
        "actions": ["size_cell"],
        "budget": {
          "xtopMinutes": 60,
          "attempts": 3
        },
        "targetPins": ["u_dma/fifo_reg_0_/D"],
        "scope": {
          "commands": ["atcs_size_cell", "atcs_exchange_cell", "atcs_insert_buffer", "atcs_insert_dummy", "atcs_split_load", "atcs_split_net", "atcs_move_cell", "atcs_remove_buffer", "atcs_fix_hold_pins", "atcs_fix_setup_pins", "atcs_undo"],
          "maxMutations": 120
        },
        "observe": "fast"
      },
      "w06": {
        "taskId": "w06",
        "baseStateId": "<id of state/working-state.json>",
        "problem": "func_ssg_rcworst_m40 hold check at u_dbg/dmactive_reg_0_/D, in u_dbg",
        "targets": ["func_ssg_rcworst_m40|hold|u_dbg/dmactive_reg_0_/D"],
        "editDomain": {
          "instances": ["u_dbg/dmactive_reg_0_"],
          "nets": [],
          "regions": [[40.0, 360.0, 80.0, 400.0]]
        },
        "protected": {
          "instances": [],
          "nets": []
        },
        "mayAffect": ["func_ssg_rcworst_m40|setup|u_dbg/dmactive_reg_0_/D"],
        "actions": ["size_cell"],
        "budget": {
          "xtopMinutes": 60,
          "attempts": 3
        },
        "targetPins": ["u_dbg/dmactive_reg_0_/D"],
        "scope": {
          "commands": ["atcs_size_cell", "atcs_exchange_cell", "atcs_insert_buffer", "atcs_insert_dummy", "atcs_split_load", "atcs_split_net", "atcs_move_cell", "atcs_remove_buffer", "atcs_fix_hold_pins", "atcs_fix_setup_pins", "atcs_undo"],
          "maxMutations": 120
        },
        "observe": "fast"
      }
    },
    "reason": "six blocker clusters for six seats, worst first: w01 holds the scenario's worst setup and hold checks in u_core/u_lsu; w02..w06 take the next worst violating checks, each in leaf cells no other slot claims"
  },
  "baseState": "<the whole JSON object in state/working-state.json, verbatim>",
  "siteCapabilities": {
    "pgVerification": false
  }
}
```
