## Goal template

The primary target of this pack is the goal parameter `minimum`, unit **count**, bounds **0..10000**, default **1**; this test explicitly requests `minimum = 1`. It means the acceptance bound on the measured sum: a generation's Goal is met when the measured `numeric_sum` reaches it. The sum is the output, and the minimum is only the bound — it is never fabricated into the result.

No further parameter rides with the goal. The strategy value `limit` (unit count) is not part of the goal; it is the one thing a generation varies, and it is bound into the Workshop's `LIMIT`.

Shaped by `over-constrain-and-read-the-violation.md`, which made the target a value the chooser reads against a measured number rather than a pass/fail flag, and by `end-honestly-in-more-than-one-way.md`, which requires the Goal to be stated together with the value that detects it.

## Constraints

Two typed, checkable constraints, applied in this order by the Judge:

1. **Validity constraint** — `numeric_sum >= 0`, unit **count**. A generation has a numeric claim only if its result could be read at all; a malformed or unreadable result has no successful numeric claim, so this constraint can never be satisfied by an absent number.
2. **Goal constraint** — `numeric_sum >= goal minimum`, unit **count**. This is the Goal's acceptance constraint, and its PASS is what makes the Goal met ending reachable.

The options the measurement is made under, declared here beside the constraints they serve:

- The rule is the symbolic **strict-bound sum**: sum only the measured values **strictly greater than** `LIMIT`, with equality to `LIMIT` excluded.
- The identified data is the actual `measured.txt` of the generation, one nonnegative integer per line, produced by preparation from `numbers.txt`.
- The reading is the integer alone in `result.txt`, emitted by the declared custom reader; the form is checked, never guessed.
- The `LIMIT` under which the measurement was made is carried with the claim.

Shaped by `assert-the-checker-options.md`: the rule, the identified data and the format are asserted as part of the claim before the number is read, so a clean-looking integer is never evidence that the right rule ran.

## Run contract

What a Site must bind and allow for this pack to run at all.

**Golden Flow, read where it lies:** `/private/tmp/hima-l4-JUuVfx/hima-home-NOrd0w/numeric-flow` — `README.md` for the rule and the interface, `prepare.sh` for the one stage, `numbers.txt` for the actual input. The flow stays read-only; the harness makes the run's own copy into the campaign workspace, and that copy carries `numbers.txt`.

**Inputs:** `flow/numbers.txt` from the flow's copy, and `flow/measured.txt` produced by the preparation tool.
**Outputs:** `result.txt`, holding the integer alone, read into `numeric_sum`.

**Tools and wrappers** — every tool this pack runs, each with the wrapper that runs it:

- `prepare` — wrapper command `sh prepare.sh <flow-directory>`, run in the private workspace copy; reads `flow/numbers.txt`, writes `flow/measured.txt`. It is the flow's one stage, and its input is carried by the flow's copy into the campaign workspace, so no earlier tool of this pack has to produce it.
- `workshop` — the one real Workshop act node; wrapper argv exactly `sh ${ENTRY} ${WORKSPACE} ${LIMIT}`; reads `$1/flow/measured.txt`, writes `$1/result.txt`.
- `observe` — the one observing act node; wrapper recomputes the strict-bound sum over `$1/flow/measured.txt` under the declared rule, as an observed calculation over identified data.
- `read_result` — the declared custom reader; wrapper reads `$1/result.txt` into `numeric_sum` in count.
- `judge` — the Judge; wrapper applies its two ordered rules over `numeric_sum`.
- `explore` — the explicit Explore node; wrapper runs the Pack-owned chooser.
- `wait` — the required hard-blocker wait node.

**The Site must allow:** a private workspace copy of the flow, and a private research directory for the Workshop's generated code. No delay is needed in this authoring test, and no EDA or licence tool is involved anywhere in this method.

Shaped by `what-a-golden-flow-is.md`: the flow is a pointer the harness copies for the run, and this pack carries no file of it.

## Semantics

Every typed value the readers, rules and choosers of this pack name:

- `numeric_sum` — unit **count** — the sum of the actual measured values **strictly greater than** the generation's `LIMIT`, equality excluded. Produced by the Workshop as `result.txt` and emitted by the declared custom reader; its claim carries the identified `measured.txt` and the `LIMIT` it was made under.
- `limit` — unit **count** — the one strategy value a generation varies; bounds **0..100**, default **16**. Produced by the strategy binding and bound into the Workshop's `LIMIT`.
- `goal minimum` — unit **count** — the goal's acceptance bound; bounds **0..10000**, default **1**, this test **1**. Produced by the run's goal binding and read by the Judge.

These three are all of them: every name the Judge rules and the chooser use appears above, and no reader of this pack produces any other value.

Shaped by `over-constrain-and-read-the-violation.md`, which made the measured value the thing the chooser reads and so required it to be typed rather than a pass, and by `assert-the-checker-options.md`, which makes the rule and the identified data part of what `numeric_sum` means.

## Judge rules

Two rules, applied in this order over the values `Semantics` declares:

1. **Constraint rule** — `numeric_sum >= 0` in count. Its PASS continues to the goal rule; its FAIL routes to the `wait` hard-blocker. A malformed or unreadable result carries no successful numeric claim and takes this FAIL.
2. **Goal rule** — `numeric_sum >= goal minimum` in count. Its PASS continues to Explore; its FAIL routes to the `wait` hard-blocker.

What each verdict cites: the rule itself, the observed `numeric_sum` together with the identified `measured.txt` it was computed over, and the `LIMIT` the generation was measured under. The observation a verdict rests on is the `observe` node's recomputation, never the mere presence of a number in `result.txt`.

Shaped by `assert-the-checker-options.md`, which requires the verdict to cite the rule and the options actually run, and by `end-honestly-in-more-than-one-way.md`, which makes each FAIL route to the wait node — the place a Campaign stops for a person.

## Choosers

One chooser, Pack-owned, at the explicit `explore` node. It reads `numeric_sum` and the Judge verdicts.

- **Clause 1 — goal met.** On constraint PASS and goal PASS, the chooser declares `goalMet: true`. This is the only clause that states the Goal is met, and it is what reaches the Goal met ending.
- **Clause 2 — next strategy.** On constraint PASS and goal FAIL, the chooser sets `limit` to a chooser parameter in **count** bound to `0` at the Explore node; the next strategy expression names that parameter, because a bare numeric next expression is not schema-valid. The revisit returns to `prepare`.

The chooser declares **no converge block**: it watches no value across generations and sets no band, so this pack has no converged ending.

Shaped by `over-constrain-and-read-the-violation.md` — the chooser reads the measured `numeric_sum` and its shortfall against `goal minimum` rather than a pass flag, and its one move is tighter (the parameter bound to `0` reaches the largest sum this input allows), never looser — and by `end-honestly-in-more-than-one-way.md`, which requires the goal-met clause to be the thing that reaches the goal-met ending.

## Endings

Every way a Campaign of this pack ends, and what reaches each one:

1. **Goal met** — reached by the chooser's clause 1, on the PASS of the rule that judges the Goal (`numeric_sum >= goal minimum`) together with the PASS of the constraint rule, and ended through the owner's explicit goal-met Explore decision. A valid, current Goal PASS ends here and never routes success to a wait.
2. **The declared next-strategy revisit, stopped by the one-generation budget** — reached by the chooser's clause 2 (constraint PASS, goal FAIL, next strategy naming the parameter bound to `0`) and the revisit of `explore` back to `prepare`; this Campaign's original generation limit of **1** stops before any second generation. That stop is a **budget, not a conclusion**, and for this positive example it is a failed test outcome.
3. **Hard-blocker** — reached by the FAIL edge of a judge rule: the constraint rule `numeric_sum >= 0` or the goal rule `numeric_sum >= goal minimum`, the former also covering a malformed or unreadable result that carries no successful numeric claim. This is where the Campaign stops for a person.

**No convergence ending is declared** by this pack: the chooser declares no converge block, so no value is watched across generations and no converged ending can be reached.

Shaped by `end-honestly-in-more-than-one-way.md`: each ending is one the pack declares in its own words, reached by a named rule outcome or chooser decision, and the generation limit is left as a budget rather than a conclusion.

## Workshops

One Workshop act node — the only place the AI writes code at run time:

- **Purpose:** write its own shell script, from the actual inputs and the pack's declared analysis knowledge, that computes the strict-bound sum and nothing else.
- **Given:** the actual `$1/flow/measured.txt` (one nonnegative integer per line), the `LIMIT` bound from strategy `limit` as `$2`, and the pack knowledge file `knowledge/numeric-strict-sum.md`.
- **Entry argv, exactly:** `sh ${ENTRY} ${WORKSPACE} ${LIMIT}`.
- **Output semantics:** it writes the integer alone to `$1/result.txt`; that integer is the value `Semantics` calls `numeric_sum` in count, emitted by the declared custom reader. It produces no other value.
- **Where the code lives:** a private research directory. No delay is needed in this authoring test. Runtime script creation is the Workshop's, and no generated script is authored into the method.

Shaped by `what-a-golden-flow-is.md`, which puts script writing at run time in the Workshop and keeps the flow out of the pack folder, and by `assert-the-checker-options.md`, which puts the rule the script must implement in the knowledge file the Workshop is given.

## Knowledge

One file to write in the pack folder's `knowledge/`, named by this pack's contract:

- `numeric-strict-sum.md` — **purpose:** the declared analysis knowledge the Workshop is given at run time. It explains the symbolic strict-bound sum (sum only the measured values strictly greater than `LIMIT`, equality excluded) and the exact input/output interface — `$1/flow/measured.txt` in, the integer alone in `$1/result.txt` out — at the symbolic level, with no invented sample total and without baking this test's answer into it. It names no stage and adds none.

That file is the only knowledge this pack declares. `one-checker-per-session.md` and `attribute-by-database-relation.md` bear on nothing in this method — there is one reader producing one value, and no tool database or adoption question — so no knowledge file arises from them.

Shaped by `what-a-golden-flow-is.md`, which keeps the declared analysis knowledge the pack's own and the flow unimported, and by `assert-the-checker-options.md`, which writes the rule down beside the constraint it serves.
