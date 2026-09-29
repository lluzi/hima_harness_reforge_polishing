# Example: integration plan

The `integration-plan` Reader (`tools/read-atcs.py`) admits this document with zero problems and reads
`tc_selected_contribution_count` 2 once each `"<...>"` string is replaced. `facts` is
`state/composition-facts.json` copied verbatim; `plan.baseStateId` is `facts.baseStateId`; every id in
`select`, `deferred` and a resolution's `decision` is one of `facts.considered`; each resolution names
one `facts.conflicts[].key` as `conflictKey` and decides `keep:<id>`, `drop:<id>` or `revise:<id>`
(with `revisedContribution`) for a member of that conflict. Here w01 and w02 edit the same instance,
so keeping w01 excludes w02 from the batch, and w03 is replayed with w01. A resolution exists only
for a `facts.conflicts` key and has exactly `{conflictKey, decision}`: a no-fix Contribution is in no
conflict, so it gets no resolution (leave it out of `select`, or list it in `deferred`). The Reader's
refusal, one line per problem, is `integrationPlanProblems`.

```json
{
  "plan": {
    "batchId": "batch-01",
    "baseStateId": "<facts.baseStateId>",
    "select": [
      "<id of w01's Contribution>",
      "<id of w03's Contribution>"
    ],
    "resolutions": [
      {
        "conflictKey": "<the facts.conflicts key naming w01 and w02>",
        "decision": "keep:<id of w01's Contribution>"
      }
    ],
    "deferred": [],
    "reason": "w01 and w02 edit the same instance; keep w01, whose falsifier held, and replay it with w03"
  },
  "facts": "<the whole JSON object in state/composition-facts.json, verbatim>"
}
```
