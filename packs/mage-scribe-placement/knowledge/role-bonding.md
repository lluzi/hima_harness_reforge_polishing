# Role: Bonding mark consistency owner

## Status in 0.1.0

This role is **not run** in this Pack version. `contract.yml` declares no `review-bonding` tool,
`graph.yml`'s round `sequence` has no bonding step, and no `state/round/review-bonding.json` output
path exists. This file ships only so a later version has a ready-made brief; do not treat its
presence as evidence the role is active, and do not invent a bonding review step in the graph or
contract — that is a later version's decision, not something a resident agent should improvise.

## Why it is disabled

The reference frame case carries no partner-wafer data, so bonding mirror-pair consistency cannot
be evaluated: the consumer model `flow/consumer_models/bonding.json` declares `"enabled": false`,
and `consumers.evaluate()` would run it exactly like any other model if a caller ever handed it in
— nothing in the predicate code itself refuses a disabled model. What is missing is partner-wafer
data and a Task that reads it, not an evaluator capability.

## What would enable it

A future version needs: a case manifest field naming the partner wafer's own PLA/snapshot, a
`review-bonding` resident tool in `contract.yml` with `outsourcing.reads` covering both wafers'
candidates, a `reviewBonding` output path and Reader declaration, and a `review-bonding` step added
to the round `sequence` in `graph.yml`. Until all of that exists, `bonding.json`'s `pair_cohesion`
requirement stays theoretical.

## Mission (once enabled)

You would own every Bonding-typed mark on both wafers of a bonded pair. You would evaluate
mirror-pair consistency — the cost-tracked `pair_cohesion` predicate, shared with the metrology
role's own pair-cohesion check for CD-SEM pairs — reporting addressing-pattern rework whenever a
mark and its mirror-pair counterpart move independently. You would never change the layout; you
would file Findings and Requests exactly as the four active consumer roles do today
(`review-protocol.md`), reading `state/case-readiness.json`, `state/start-snapshot.json`, and the
current `state/round/placement-candidate.json` for your own wafer, plus whatever the enabling
version adds for the partner wafer.

## Example Finding shape (illustrative only; not runnable in 0.1.0)

```json
{"schema": "mage.finding/1", "id": "F-bonding-9", "round": 1, "snapshotSha256": "<candidate sha>",
 "consumer": "bonding", "consumerModel": "bonding@0.1.0", "evaluatorReceipt": "<receipt sha256>",
 "targets": ["BOND_A.BOND_A_1", "BOND_A.BOND_A_2"], "predicate": "pair_cohesion", "status": "fail",
 "severity": "cost", "numbers": {"cluster": "BOND_A_PAIR", "memberCount": 2},
 "explanation": "cluster 'BOND_A_PAIR' did not move together"}
```

`pair_cohesion` is a pure geometric check (the same predicate the metrology role uses for its own
CD-SEM pairs); it does not itself go `unknown` for a missing parameter. What is actually missing
today is the partner-wafer snapshot this role would need as its own second candidate input — that
gap belongs in a Task's `remaining`/`unknown` list, not in this predicate's own Finding.
