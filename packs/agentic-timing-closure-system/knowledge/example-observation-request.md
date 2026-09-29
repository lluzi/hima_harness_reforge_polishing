# Example: observation request

The `observation-request` Reader (`tools/read-atcs.py`) admits this document with zero problems once
`designStateId` is the plain 20-hex `id` of `state/working-state.json` (the working design-state the
query observes). `precision` is `gba` or `pba`; `requiredScenarios` lists every required scenario of
`state/policy.json`, never a subset; `maxPaths` is a positive integer the Run's `maxPaths` Strategy
knob caps; `nworst` is the paths per endpoint. The Reader's refusal, one line per problem, is
`observationRequestProblems`.

```json
{
  "designStateId": "<id of state/working-state.json>",
  "precision": "pba",
  "requiredScenarios": [
    "func_ssg_rcworst_m40"
  ],
  "maxPaths": 200,
  "nworst": 1
}
```
