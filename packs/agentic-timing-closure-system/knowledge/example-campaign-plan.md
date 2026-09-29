# Example: campaign plan

The `campaign-plan` Reader (`tools/read-atcs.py`) admits this document with zero problems once each
`"<...>"` string is replaced as it says: `baseState` is the whole object in `state/working-state.json`,
copied verbatim, and every `baseStateId` is its `id`. It holds all six slots keyed `w01`..`w06`, each
`taskId` exactly its key: one active slot with every field (`observe` is optional) and five slots in
the parked shape, exactly `{taskId, baseStateId, parked: true, problem}` and no other key. A real plan
fills active slots from `w01` up to `workerSlots`, one blocker cluster each, and parks the rest; the
Reader's refusal of a plan, one line per problem, is `campaignPlanProblems`.

```json
{
  "candidate": {
    "workPackages": {
      "w01": {
        "taskId": "w01",
        "baseStateId": "<id of state/working-state.json>",
        "problem": "func_ssg_rcworst_m40 worst setup check at u_core/u_lsu/data_reg_3_/D and worst hold check at u_core/u_lsu/addr_reg_0_/D; auto-finish left both unfixed",
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
          "commands": [
            "atcs_size_cell",
            "atcs_exchange_cell",
            "atcs_insert_buffer",
            "atcs_insert_dummy",
            "atcs_fix_setup_pins",
            "atcs_fix_hold_pins",
            "atcs_undo"
          ],
          "maxMutations": 120
        },
        "observe": "fast"
      },
      "w02": {
        "taskId": "w02",
        "baseStateId": "<id of state/working-state.json>",
        "parked": true,
        "problem": "no blocker cluster left for this slot"
      },
      "w03": {
        "taskId": "w03",
        "baseStateId": "<id of state/working-state.json>",
        "parked": true,
        "problem": "no blocker cluster left for this slot"
      },
      "w04": {
        "taskId": "w04",
        "baseStateId": "<id of state/working-state.json>",
        "parked": true,
        "problem": "no blocker cluster left for this slot"
      },
      "w05": {
        "taskId": "w05",
        "baseStateId": "<id of state/working-state.json>",
        "parked": true,
        "problem": "no blocker cluster left for this slot"
      },
      "w06": {
        "taskId": "w06",
        "baseStateId": "<id of state/working-state.json>",
        "parked": true,
        "problem": "no blocker cluster left for this slot"
      }
    },
    "reason": "one blocker cluster: the worst setup and hold checks of the only required scenario sit in u_core/u_lsu"
  },
  "baseState": "<the whole JSON object in state/working-state.json, verbatim>",
  "siteCapabilities": {
    "pgVerification": false
  }
}
```
