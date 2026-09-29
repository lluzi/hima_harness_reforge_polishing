# Example: next decision

The `next-decision` Reader (`tools/read-atcs.py`) admits this document with zero problems and reads
`action` observe once `stateRef` and `observationRef` are the plain 20-hex `id` strings of
`state/working-state.json` and `state/observation.json`; `budgetRef` is a plain string. `targets` are
exact check keys of the observation. research, compose and revise also need
`state/xtop-context.json` bound to the working state, so after an adopted refresh choose observe
first. The Reader's refusal, one line per problem, is `nextDecisionProblems`.

```json
{
  "stateRef": "<id of state/working-state.json>",
  "observationRef": "<id of state/observation.json>",
  "budgetRef": "budget-campaign-01",
  "question": "is one more PT query worth it before committing to a research package?",
  "action": "observe",
  "targets": [
    "func_ssg_rcworst_m40|setup|u_core/u_lsu/data_reg_3_/D"
  ],
  "reason": "need one more PT query to separate the two competing root causes",
  "falsifier": "if slack does not move after the query, stop probing this checkpoint and escalate to research",
  "costBasis": {
    "queries": 1
  },
  "requiredArtifacts": []
}
```
