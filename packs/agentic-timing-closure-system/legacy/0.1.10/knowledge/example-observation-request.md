# Example: observation request

The `observation-request` Reader (`tools/read-atcs.py`) admits this exact document with zero problems. `designStateId` is the plain 20-hex `id` of `state/working-state.json` (the working design-state the query observes); `precision` is `gba` or `pba`; `requiredScenarios` lists every required scenario, never a subset; `maxPaths` is a positive integer the Run's `maxPaths` Strategy knob caps; `nworst` is the paths per endpoint.

```json
{
  "designStateId": "3956975ce47374c313fc",
  "precision": "pba",
  "requiredScenarios": [
    "func_ssg_rcworst_m40"
  ],
  "maxPaths": 200,
  "nworst": 1
}
```
