# Example: next decision

The `next-decision` Reader (`tools/read-atcs.py`) admits this exact document with zero problems and reads `action` observe; `stateRef` and `observationRef` are the plain 20-hex `id` strings of `state/working-state.json` and `state/observation.json`, and `budgetRef` is a plain string.

```json
{
  "stateRef": "62a80a2154c907c13526",
  "observationRef": "de4af36c311de90baad2",
  "budgetRef": "budget-campaign-01",
  "question": "is one more PT query worth it before committing to a research package?",
  "action": "observe",
  "targets": [],
  "reason": "need one more PT query to separate the two competing root causes",
  "falsifier": "if slack does not move after the query, stop probing this checkpoint and escalate to research",
  "costBasis": {"queries": 1},
  "requiredArtifacts": []
}
```
