## Business

**What is explored.** One strategy knob, `limit`, unit **count**, bounds **0..100**, default **16**. The Workshop's scalar `LIMIT` binds from strategy `limit`, and nothing else in a generation moves. The Workshop writes its own shell script at Run time from the declared knowledge file; the number the business reads changes only because `LIMIT` changes.

**Actual input.** A tiny numeric-analysis method with no EDA and no licences. Each generation's actual input is one nonnegative integer per line. Preparation is the flow's `sh prepare.sh <flow-directory>`, run in the private workspace copy, producing `measured.txt` from `numbers.txt`; `measured.txt` is the measured input. The Golden Flow stays read-only, and the Pack copies only the flow inputs and scripts preparation needs into its workspace.

**What is measured.** `numeric_sum`, unit **count**, produced by the Workshop as `result.txt` and emitted by one declared custom reader. Its meaning: the sum of the actual measured values **strictly greater than LIMIT** — equality to `LIMIT` is excluded, so `LIMIT` itself is never summed. The sum itself is the output. One observing act node recomputes the sum over the identified measured data under the same declared rule, and the Judge rules on `numeric_sum`.

**Goal and acceptance.** Goal `minimum`, unit **count**, bounds **0..10000**, default **1**; this test explicitly requests `minimum = 1`. The minimum is only the acceptance bound, not the output to fabricate: acceptance is met by the measured sum reaching the bound, never by writing the bound out as a result.

**Nodes approved for this pack.** One preparation tool, one real Workshop act node, one observing act node, one Judge, one explicit Explore node with a Pack-owned chooser, and the required hard-blocker wait. The approved Workshop entry argv is exactly `sh ${ENTRY} ${WORKSPACE} ${LIMIT}`; the generated script reads `$1/flow/measured.txt` and writes the integer alone to `$1/result.txt`. Generated code lives in a private research directory. No delay is needed in this authoring test.

**Judge.** Exactly two ordered rules: first the validity constraint `numeric_sum >= 0` in **count**, then the Goal rule `numeric_sum >= goal minimum` in **count**. Its PASS edge goes to Explore; its FAIL edge goes to hard-blocker. A malformed or unreadable result has no successful numeric claim — it cannot be read as any number, least of all as a pass.

**Chooser (Pack-owned, at the Explore node).** It reads `numeric_sum`. Its first clause, on constraint PASS and goal PASS, declares `goalMet: true`. On constraint PASS and goal FAIL it proposes next strategy `limit = 0`, using a chooser parameter in **count** bound to `0` at the Explore node; the next expression names that parameter, because a bare numeric next expression is not schema-valid. The revisit goes back to preparation for that fallback. This Campaign permits exactly one generation, so this Run's original generation limit of 1 stops before any second generation.

**What ends it.**
- **Goal met** — constraint PASS then Goal PASS, ended through the owner's explicit goal-met Explore decision. A valid, current Goal PASS ends this way and never routes success to a wait.
- **The reference method's declared next-strategy revisit** — on constraint PASS and goal FAIL the chooser proposes `limit = 0` and Explore revisits preparation. It is declared so the reference method is complete; in this Run the generation limit of 1 stops before any second generation, and that stop is a **budget**, not a conclusion.
- **Hard-blocker** — Judge FAIL, which includes a malformed or unreadable result that has no successful numeric claim, routes to the required wait.
- **No convergence is declared** by this pack.

Budget and blocked endings are **failed test outcomes** for this positive example, not honest campaign conclusions.

**What a person must never have to guess.**
- Strictness: **strictly greater than LIMIT**, with equality to `LIMIT` excluded.
- That `minimum` is an acceptance bound and is never the output.
- Which `LIMIT` produced the `numeric_sum` that was judged.
- Whether `numeric_sum` was an observed calculation over identified data or merely a number that appeared in `result.txt`.
- That a malformed or unreadable result has no successful numeric claim.
- The exact interface: entry argv `sh ${ENTRY} ${WORKSPACE} ${LIMIT}`, read `$1/flow/measured.txt`, write the integer alone to `$1/result.txt`.
- That `LIMIT` comes from strategy `limit`, not from the goal `minimum`.

## Golden Flow

Where it lies: `/private/tmp/hima-l4-JUuVfx/hima-home-NOrd0w/numeric-flow`

Pointers, each ending at its path:
- The flow's own build file: the stages it names, the strict-bound sum rule, the Workshop-written script, and the exact input/output interface — `/private/tmp/hima-l4-JUuVfx/hima-home-NOrd0w/numeric-flow/README.md`
- The flow's one stage, and the command line it takes — `/private/tmp/hima-l4-JUuVfx/hima-home-NOrd0w/numeric-flow/prepare.sh`
- The actual numeric input the stage copies, one nonnegative integer per line — `/private/tmp/hima-l4-JUuVfx/hima-home-NOrd0w/numeric-flow/numbers.txt`

What was read there: `README.md` declares the invocation `sh prepare.sh <flow-directory>` in a private copy; that it copies `numbers.txt` to `measured.txt`; that both contain one nonnegative integer per line; that analysis must sum only numbers strictly greater than the requested LIMIT; that a Workshop writes its own shell script from these actual inputs and the declared analysis knowledge; that `result.txt` contains the integer sum alone; and that there is no EDA or licence use. `prepare.sh` is `set -eu`, `cd "$1"`, `cp numbers.txt measured.txt` — it takes no variables on its command line, so a generation has no knob from the flow itself. `numbers.txt` holds 12 nonnegative integers.

No file of this flow is copied into the pack folder; the harness makes its own copy for a run. The Golden Flow stays read-only. What the Pack copies into its workspace is only the flow inputs and scripts preparation needs; runtime script creation belongs to the Workshop, not to method authoring.

## Answers

1. **What does one generation vary, and in what units?** Agreed as recommended, now with the approved contract's units: one knob, strategy `limit`, unit count, bounds 0..100, default 16; Workshop scalar `LIMIT` binds from it. The measured input is fixed and only `LIMIT` moves the read number.
2. **What is the Goal, and in what units?** The author replaced the recommended target-sum goal with the approved contract: Goal `minimum`, unit count, bounds 0..10000, default 1, and this test explicitly requests `minimum = 1`. The sum is the output; the minimum is only the acceptance bound and must not be fabricated into the output.
3. **What is measured, and what does the number mean?** `numeric_sum` in count, read from `result.txt` by one declared custom reader, meaning the sum of the actual measured values strictly greater than `LIMIT`. One observing act node recomputes it over identified data, and the Judge requires `numeric_sum >= goal minimum`.
4. **The verification disagreement.** Settled as recommended: verification is the Pack's own — one observing act node plus the Judge's two rules. The flow provides no checker.
5. **What ends it?** Goal met through the owner's explicit goal-met Explore decision; the declared next-strategy revisit (`limit = 0`) that this Run's generation limit of 1 stops before; the required hard-blocker wait for FAIL. No convergence is declared. Budget and blocked endings are failed test outcomes for this positive example.
6. **What must a person never have to guess?** Strictness with equality excluded; that `minimum` is an acceptance bound and not the output; which `LIMIT` produced the judged sum; observed calculation versus a number merely present in `result.txt`; that a malformed or unreadable result has no successful numeric claim; the exact interface and argv; that `LIMIT` comes from the strategy, not the goal.
7. **Node structure.** One preparation tool, one real Workshop act node, one observing act node, one Judge, one explicit Explore node with a Pack-owned chooser, and the required hard-blocker wait.
8. **Workshop interface and script creation.** Approved entry argv is exactly `sh ${ENTRY} ${WORKSPACE} ${LIMIT}`; the generated script reads `$1/flow/measured.txt` and writes the integer alone to `$1/result.txt`; the Workshop generates its own script during the test Run, from the declared knowledge file and the actual inputs; generated code lives in a private research directory; no delay is needed in this authoring test.
9. **Judge rules.** Exactly two, ordered: constraint `numeric_sum >= 0` in count first, then Goal `numeric_sum >= goal minimum` in count; PASS to Explore, FAIL to hard-blocker; a malformed or unreadable result has no successful numeric claim.
10. **Chooser.** It reads `numeric_sum`; first clause on constraint PASS and goal PASS declares `goalMet: true`; on constraint PASS and goal FAIL it proposes next strategy `limit = 0` through a chooser parameter in count bound to 0 at the Explore node, with the next expression naming that parameter, since a bare numeric next expression is not schema-valid; the revisit goes back to preparation.
11. **Generation limit and the revisit.** This Campaign permits exactly one generation; the reference method still declares its next-strategy revisit, and the budget stops it before any second generation.
12. **Knowledge.** One declared knowledge file explaining the exact sum — the symbolic strict-bound sum and its exact input/output interface. A worked numeric claim needs an observed calculation over identified data; no sample total is invented and this test's answer is not baked into method knowledge.
13. **Scope.** A tiny numeric-analysis method with no EDA and no licences; each generation's actual input is one nonnegative integer per line.

## Ambiguities resolved

1. **"Verifies the output" versus a flow with no verification stage.** The author's words said the pack verifies the output; `README.md` declares only script generation and `result.txt`, with no checker. Settled: verification is the Pack's own — one observing act node recomputing over identified data plus the Judge's two ordered rules; the flow contributes the rule and the interface, not a verdict.
2. **"AI-written script" versus "a Workshop writes its own shell script".** Settled: runtime script creation belongs to the Workshop, not to method authoring; the Pack declares the knowledge file, the Workshop generates the script during the test Run, and no generated script is authored into the method.
3. **The flow's "requested LIMIT" versus the approved strategy knob.** The flow never says who requests `LIMIT`. Settled: `LIMIT` binds from strategy `limit` (count, 0..100, default 16); the goal `minimum` is a separate acceptance bound and never supplies `LIMIT`.
4. **A flow with no acceptance bound versus the approved Goal minimum.** The flow's sum rule is unconditional; the contract adds `minimum` (count, 0..10000, default 1, this test 1). Settled: `minimum` is the Pack's acceptance bound, the sum remains the output, and the bound is never fabricated as the result.
5. **`result.txt` holding "the integer sum alone" versus the custom reader and the Judge rules.** Settled: the declared custom reader reads that one integer into `numeric_sum` in count, the Judge's ordered rules read `numeric_sum`, and the strictness of the sum rule is declared rather than inferred from the number.
6. **"Exactly one generation" and "no convergence" versus the reference method's declared revisit.** Settled: the chooser's next-strategy revisit to preparation is declared so the reference method is complete, but this Campaign's generation limit of 1 stops before a second generation; no convergence is declared, and budget and blocked endings are failed test outcomes for this positive example rather than conclusions.
7. **`sh ${ENTRY} ${WORKSPACE} ${LIMIT}` reading `$1/flow/measured.txt` versus `prepare.sh` writing `measured.txt` in its own directory.** `prepare.sh` does `cd "$1"` and copies there. Settled: the private workspace copy holds the flow at `flow/`, so the declared read path is `$1/flow/measured.txt`; the Pack copies only the needed flow inputs and scripts, and the Golden Flow itself stays read-only.
8. **A malformed or unreadable result versus the flow's silence about malformed output.** The flow says nothing about a malformed result. Settled: such a result has no successful numeric claim and takes the Judge FAIL edge to the required hard-blocker wait.

## Knowledge applied

- `over-constrain-and-read-the-violation.md` — turned the chooser's input from a passed/failed flag into the measured `numeric_sum` and its shortfall against goal `minimum`, and made the next expression name a chooser parameter in count bound to 0 rather than a bare number; this Run exercises the positive path at `minimum = 1` and carries the violation arithmetic in the next-strategy clause.
- `end-honestly-in-more-than-one-way.md` — made every ending one the Pack declares in its own words: the owner's explicit goal-met Explore decision, the declared next-strategy revisit, and the hard-blocker wait; stated that the one-generation limit is a budget and not a conclusion, and that no convergence is declared.
- `assert-the-checker-options.md` — made the observing act node assert the rule it ran under, the symbolic strict-bound sum with `LIMIT` excluded, and the identified data it computed over, as a typed claim instead of inferring a correct-looking `numeric_sum` from `result.txt`; the Judge's constraint rule is what makes a malformed or unreadable result no numeric claim at all.
- `what-a-golden-flow-is.md` — kept the flow where it lies: the record carries the path and what was read there, not one copied file; the Golden Flow stays read-only, and only the flow inputs and scripts preparation needs are copied into the workspace.
- `one-checker-per-session.md` — not applied, and marked inapplicable to this numerical business: this method runs one measurement with one reader producing one named value, `numeric_sum`, and one Judge, so there is no second verification tool's count to keep separate.
- `attribute-by-database-relation.md` — not applied, and marked inapplicable to this numerical business: there is no tool database, no instance-to-master relation, and no adoption question in this method.
