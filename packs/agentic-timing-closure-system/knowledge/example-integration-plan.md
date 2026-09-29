# Example: integration plan

The `integration-plan` Reader (`tools/read-atcs.py`) admits this exact document with zero problems and reads `tc_selected_contribution_count` 2. `facts` is `state/composition-facts.json` copied unchanged; `plan.baseStateId` is `facts.baseStateId`; every id in `select`, `deferred` and a resolution's `decision` is one of `facts.considered`; each resolution names one `facts.conflicts[].key` as `conflictKey` and decides `keep:<id>`, `drop:<id>` or `revise:<id>` (with `revisedContribution`) for a member of that conflict. Here w01 and w02 size the same instance to different masters, so keeping w01 excludes w02 from the batch.

```json
{
  "plan": {
    "batchId": "batch-01",
    "baseStateId": "3956975ce47374c313fc",
    "select": [
      "b303b298002a6ba48d1b",
      "9984722b4f4f6e2cab6d"
    ],
    "resolutions": [
      {
        "conflictKey": "same-instance-different-master|394cbf85d75e59972790,b303b298002a6ba48d1b|u_a/reg0",
        "decision": "keep:b303b298002a6ba48d1b"
      }
    ],
    "deferred": [],
    "reason": "w01 and w02 size u_a/reg0 to different masters; keep w01, whose falsifier held, and replay it with w03"
  },
  "facts": {
    "baseStateId": "3956975ce47374c313fc",
    "considered": [
      "b303b298002a6ba48d1b",
      "394cbf85d75e59972790",
      "9984722b4f4f6e2cab6d"
    ],
    "duplicates": [],
    "conflicts": [
      {
        "key": "same-instance-different-master|394cbf85d75e59972790,b303b298002a6ba48d1b|u_a/reg0",
        "kind": "same-instance-different-master",
        "contributions": [
          "394cbf85d75e59972790",
          "b303b298002a6ba48d1b"
        ],
        "objects": [
          "u_a/reg0"
        ]
      }
    ],
    "interactions": [],
    "staleBase": [],
    "order": [
      "b303b298002a6ba48d1b",
      "394cbf85d75e59972790",
      "9984722b4f4f6e2cab6d"
    ],
    "unresolvedCount": 1,
    "unknownResolutions": [],
    "schema": "atcs.composition-facts/1",
    "id": "1684c3cc41efd3f7ae72"
  }
}
```
