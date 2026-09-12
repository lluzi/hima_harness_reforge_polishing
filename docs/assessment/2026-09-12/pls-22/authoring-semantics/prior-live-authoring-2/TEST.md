# authored-numeric — Test Record

## Site

The Run was made on Site **local**. The Golden Flow this pack was checked against is the one
`INTENT.md` points at: `/private/tmp/hima-l4-J5R76P/hima-home-JAqnCY/numeric-flow` — read where it
lies, never copied. Its stages are `prepare.sh` (the flow's only build file: `sh prepare.sh
<flow-directory>`, copying `numbers.txt` to `measured.txt`) and the analysis the README says a
Workshop writes for itself. The Site bound `flowRoot` to that path and `workspaceRoot` to
`/private/tmp/hima-l4-J5R76P/hima-home-JAqnCY/workspace`.

## Run

run: run-a1041ae4-9847-4cda-a673-863de8c4a0d5

Goal at start: `minimum = 1` (acceptance bound, count). Strategy at start: `limit = 11` (analysis
limit, count). The Run was marked a test (`purpose: test`), with a time box of 8 minutes, a retry
allowance of 2 per node per generation, and a generation limit of 1.

## Ending

status: ended-budget-exhausted

Beside it: that is the harness's own word for how this Run ended, and it **is** one the spec's
`Endings` section declares — in the spec's words, a Run that exhausts its budget "stops as a fact
about the Run. Neither is successful analysis". It is **not** the goal-met ending the spec prefers.
No chooser ran and no decision of goal-met exists (`decision: null`). What the ledger records: the
judge's PASS (`#000026`) was followed to the `blocked` wait node, whose record
`run-a1041ae4-9847-4cda-a673-863de8c4a0d5#000027` stands with state `blocked` and reason "this Pack
requires human clearance of hard-blocker"; the 8-minute time box then expired at 480181 ms of its
480000 ms (`stop: {reason: budget, status: confirmed}`, `endedBy: time-box`); the harness cancelled
that wait node (cancel record `#000028`, node record `#000029` state `cancelled`); and generation 1's
state is now `done`. The harness also wrote this Run's experience report (`#000030`, Markdown sha256
`82a060473d4aa3cda49aed95c02bbb5e1fa54d4d13c0100036281ffef0804ecc`, JSON sha256
`528c595eb47c5033ae2cfa2e6f67d0b0b7fab3e5386cf62c9b35fcd360fb821d`). The spec declares the goal-met
ending as the terminal one, reached by a chooser's goal-met clause, and routes only a rule's FAIL to
the wait node; this pack's compiled `graph.yml` gives the judge's **PASS** an edge to that same wait
node, so three PASS verdicts led to the blocker and the Run then ended on its budget. Neither ending
is a conclusion about the numbers: 227 is on the record as measured and independently re-derived, but
no Run of this pack reached its declared goal-met ending.

## Generations

- Generation 1 — asked for: strategy `limit = 11`, against goal `minimum = 1`. Measured:
  `numeric_sum = 227` (count), with `expected_sum = 227` (count) computed independently by the
  reader, `result_readable = 1`, `sum_correct = 1`, `options_asserted = 1` (observation
  `run-a1041ae4-9847-4cda-a673-863de8c4a0d5#000021`, `result.txt`, content sha256
  `b56797986dcb891ef0072c12ebc457b38e63b1e6d61be1547b04b88431df9465`, 4 bytes). Verdicts:
  `options-asserted@1` **PASS** (`#000023`), `sum-correct@1` **PASS** (`#000024`),
  `acceptance-bound@1` **PASS** (`#000025`, bound parameter `minimum = 1`), each citing `#000021`.
  The generation reached the `blocked` wait node (`#000027`) rather than a goal-met ending, and the
  budget stop then cancelled that node (`#000028`, node `#000029` state `cancelled`); generation 1's
  state is `done` and the Run's ending is `ended-budget-exhausted`.

## Code

- sha256 `b492c43a02c90a20623898a68dacfceb01aebc9347119177a8cf8a0d716e7ae5` — code record
  `run-a1041ae4-9847-4cda-a673-863de8c4a0d5#000007`, path
  `research/analysis/.executions/execution-f16ea6bf-e7f0-46eb-b79f-23c7b7dcf084/entry.sh`, node
  `analyze`, attempt 1, 1273 bytes, language `sh`.
- sha256 `3a7a4f301ece20c621aa499b64db7b032c416f092432bdd22acbffde2f28fae2` — code record
  `run-a1041ae4-9847-4cda-a673-863de8c4a0d5#000012`, path
  `research/analysis/.executions/execution-59a33053-4ba8-4a7d-8e1d-6ba486eb785d/entry.sh`, node
  `analyze`, attempt 2, 1849 bytes, language `sh`.

## Refusals

- `run-a1041ae4-9847-4cda-a673-863de8c4a0d5#000006` — path `@workshop-input:measuredInput`, reason:
  "this workshop may read \"measuredInput\", \"analysis\", and \"@workshop-input:measuredInput\" is
  not one of them" (writer `executor`).

## Disagreements

- **The pack's own worked sum disagrees with the Golden Flow's actual data.** `knowledge/analysis.md`
  states that the flow's 12 inputs against the default bound of 11 sum to **119**. The Run's records
  say **227**: the Workshop's authored script wrote 227 alone into `result.txt` (observation
  `#000021`), and the reader's independently computed `expected_sum` is also 227, so `sum_correct`
  is 1 and the rule is right while the pack's prose example is wrong. Both the Workshop's number and
  the reader's number were computed from the actual input, so the wrong example did not corrupt the
  Run — but the method as released carries a wrong worked number in its declared analysis knowledge.
- **The pack's declared script interface disagrees with what the harness passes.** `SPEC.md`'s Run
  contract and Workshop block say the generated script reads `$1/flow/measured.txt`. The harness
  launches `sh ${ENTRY} ${WORKSHOP} ${LIMIT}`, so `$1` is the execution's private directory
  (`research/analysis/.executions/<execution>`), not the workspace root, and no `flow/measured.txt`
  exists under it. Attempt 1 failed on exactly that: job `hima-a1041ae4-workshop-analyze-46bf8e`
  exited 2 (job record `#000010`) with `awk: can't open file
  .../research/analysis/.executions/execution-f16ea6bf-e7f0-46eb-b79f-23c7b7dcf084/flow/measured.txt`,
  and node record `#000011` set the node `retrying` — 1 failed attempt of an allowance of 2. Attempt 2
  resolved the workspace root three levels up from `$1` and succeeded (exit 0, job record `#000015`).
- **The pack's declared ending disagrees with the graph it compiled into.** `SPEC.md` declares the
  goal-met terminal ending and says convergence is unreachable; the judge's PASS is what states the
  goal is met. The compiled `graph.yml` puts the judge's **PASS** on an edge to the `blocked` wait
  node, so the Run's judge PASS (`#000026`) was followed to `#000027` `blocked` — "this Pack requires
  human clearance of hard-blocker" — where it stayed until the budget stop cancelled it (`#000028`,
  node `#000029` state `cancelled`). A generation whose analysis passed all three rules therefore
  reached a blocker, not `ended-goal-met`, and the Run ended `ended-budget-exhausted`.
- **The flow encodes no LIMIT, while its README speaks of one.** The Golden Flow's `prepare.sh` takes
  only the flow directory and carries no bound; the pack binds `LIMIT` from its strategy knob, per the
  settlement recorded in `INTENT.md`'s `Ambiguities resolved`. The Run is consistent with the flow:
  the `prepare` tool ran the flow's own script with only the flow directory (exit 0, job record
  `#000004`) and the bound travelled to the authored script as its second argument (`11`).
- **A reading form the Workshop may not use.** The Workshop's declared `reads` grant it
  `measuredInput` and `analysis` by name; the `@workshop-input:` form was refused (`#000006`). The
  declared name worked and the input was read (`39 20 25 29 22 1 21 16 11 2 26 29`, 34 bytes).
