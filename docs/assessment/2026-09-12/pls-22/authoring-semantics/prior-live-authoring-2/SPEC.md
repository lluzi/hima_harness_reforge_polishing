# authored-numeric — Pack Spec

## Goal template

Primary target: **`goal.minimum`** — unit **count**, bounds **0..10000**, default **1**. It is the
acceptance bound the measurable output must meet or exceed: the analysis's `numeric_sum` must be
`>= goal.minimum`. It is *only* a bound and never the output — the pack writes the true integer sum
and never the bound. This test Run explicitly requests `minimum = 1`.

Parameters that travel with the primary target, and are not values any reader produces:

- **`goal.minimum`** — the acceptance bound, unit count, 0..10000, default 1, as above.
- **`strategy.limit`** — the strict comparison bound, unit count, bounds 0..100, default 11. It binds
  the Workshop's scalar `LIMIT` for the whole Campaign; it is the requested LIMIT the analysis must
  apply, and a value equal to it is excluded. It does not change across generations.

What the plan is for: one generation authors one shell script that sums only the measured values
strictly greater than `strategy.limit` and writes that integer alone to `result.txt`; the Run ends
when the readable result satisfies `goal.minimum`.

Knowledge: `end-honestly-in-more-than-one-way.md` shaped the target's words — the bound is met, not
approached, and the pack says on every face that the minimum is not the answer.

## Constraints

Every constraint the Goal carries, typed and checkable, with the options the measurement was made
under. Since there is one generation and no revisit, these are checked on the one generation.

1. **Strict-bound constraint on `strategy.limit`** (count, 0..100, default 11) — only measured values
   *strictly* greater than it are summed; a value equal to it is excluded. Checked by rule R3.
2. **Acceptance constraint** — `numeric_sum >= goal.minimum`, unit count, measurably on the
   readable result of the one generation. Checked by rule R1.
3. **Boundary-equality constraint** — a value equal to LIMIT is excluded from the sum. A script that
   includes an equal value has produced a wrong sum, not a rounding difference. Checked by R2 (the
   sum is held against the exact declared sum) and by R3 (the comparison operator actually used).
4. **Input well-formedness constraint** — `flow/measured.txt` holds one nonnegative integer per
   line. Its only producer on the Site is the preparation stage of the Golden Flow.
5. **Output-well-formedness constraint** — `result.txt` holds the integer sum **alone**: no label, no
   count of included values, no report. A result file that is absent, empty or not an integer has no
   verdict. Checked by R1 through `result_readable`.
6. **Asserted-options constraint** — the options the measurement was made under are asserted before
   the count is read, and are the declared list, not a convention: `strategy.limit` as the bound
   actually applied; the operator `strictly greater` (`>`), equality excluded; the input
   `$1/flow/measured.txt`; and the output `$1/result.txt` holding the integer alone. If the script
   ran under any other option set, the generation has no verdict. Checked by rule R3.

Knowledge: `assert-the-checker-options.md` shaped constraints 3 and 6 — the boundary and the
interface are a declared option list asserted at run time, so a passing count obtained under the
wrong boundary is refused rather than reported. Constraint 2's wording — a bound, not an answer —
comes from `end-honestly-in-more-than-one-way.md`.

## Run contract

What a Site must bind and allow for this pack to run at all. Line kinds: the `tool` lines are the
two places the method runs something, each naming the wrapper in the same line; the `allowed` lines
are capabilities the Site must permit, not things this method runs.

- `allowed: /bin/sh` — a POSIX shell; the preparation stage and the authored script both run under
  it. This is the only stage-runner capability the method needs.
- `allowed: read and write the private Campaign workspace directory` — the preparation stage writes
  into it, the Workshop authors code into it, and the output file is written there. The Golden Flow
  is read-only and is never written.
- `bind: strategy.limit` (count, 0..100, default 11) and `bind: goal.minimum` (count, 0..10000,
  default 1) — the Run's Goal and strategy parameters.
- `carry: flow/numbers.txt`, `carry: flow/prepare.sh` — the inputs and the preparation script the
  contract names, copied from the Golden Flow at
  `/private/tmp/hima-l4-J5R76P/hima-home-JAqnCY/numeric-flow` into the private Campaign workspace. The
  flow stays where it lies, and this pack copies only these two files of it into its workspace.
- `tool: sh flow/prepare.sh flow` — the preparation wrapper, being the flow's own `prepare.sh` run
  unchanged on the workspace's copy of the flow directory. It produces `flow/measured.txt` from
  `flow/numbers.txt`. The Golden Flow's only variable is the flow directory itself, and that is what
  this line passes; `strategy.limit` is deliberately not passed to it because the flow does not
  encode a LIMIT.
- `tool: sh ${ENTRY} ${WORKSPACE} ${LIMIT}` — the Workshop wrapper. `${ENTRY}` is the script the
  Workshop authors during this Run, `${WORKSPACE}` is the private workspace (`$1`), and `${LIMIT}` is
  the scalar bound by `strategy.limit` (`$2`). The script reads `$1/flow/measured.txt` and writes the
  integer alone to `$1/result.txt`.
- `output: result.txt` — the readable integer result of the generation.
- No EDA tool, no licence checkout, and no verification tool is bound: this business uses neither.

Knowledge: `what-a-golden-flow-is.md` shaped the `carry` and `tool` lines — the flow is read where it
lies, only the files the contract names are copied into that workspace by the runner, and the record
carries pointers rather than contents.

## Semantics

The typed values the readers produce. One entry per value; every name a rule or a chooser reads is
one of these.

- **`numeric_sum`** — unit **count**. The integer sum the Workshop's authored script wrote alone into
  `result.txt`, being the sum of the measured values strictly greater than `strategy.limit`. It is
  the measurable output, produced by the declared custom reader over `result.txt`.
- **`result_readable`** — type **yes/no**. Whether `result.txt` held exactly one integer and nothing
  else, so a count could be taken at all. Its companion fact is the file state the reader saw
  (`absent` / `empty` / `not-an-integer` / `one-integer`). Produced by the same declared reader.
- **`workshop_exit`** — unit **status code**. The exit status of the Workshop's authored script.
  Produced by the Workshop node's own execution record.
- **`expected_sum`** — unit **count**. The sum of the values in `flow/measured.txt` strictly greater
  than `strategy.limit`, as the declared analysis knowledge states the exact sum. This is the
  correctness companion to `numeric_sum`: it is what a landed bound must equal to be called correct,
  not merely satisfied. Produced by the declared reader, which computes it from the measured input
  and the bound.
- **`analysis_options`** — a typed record asserting the options the script actually ran under: the
  bound applied, the comparison operator (`strictly greater`, equality excluded), the input path, and
  the output contract (the integer alone). Produced by the declared reader from what the run
  actually did. R3 reads it, and a generation whose options were not asserted has no verdict.

Knowledge: `assert-the-checker-options.md` shaped `analysis_options` — the asserted option list is a
typed value rather than a comment. `one-checker-per-session.md` shaped the producer rule: all count
values here come from the one Workshop session and the one declared reader, and none is a total
across producers.

## Judge rules

The rules over the Semantics values that decide how the node continues. Precedence: R2 and R3 are
checked before R1, so a bound that was met by an incorrect analysis or under the wrong boundary is
never reported as the goal met.

- **R1 — the acceptance bound.** Reads `numeric_sum`, `goal.minimum` and `result_readable`.
  - PASS when `result_readable` is yes **and** `numeric_sum >= goal.minimum`. Citation: the
    `numeric_sum` value with its unit, `result_readable` yes, and the Goal's `minimum`.
  - FAIL when `result_readable` is yes but `numeric_sum < goal.minimum` — the bound was not
    satisfied. Citation: the `numeric_sum` value and the Goal's `minimum`.
  - FAIL when `result_readable` is no — there is no count to compare, so there is no verdict to
    report. Citation: `result_readable` with the file state the reader saw, and `workshop_exit`.
- **R2 — the sum is correct, not fabricated.** Reads `numeric_sum` and `expected_sum`, both in count.
  A passing count that is not the true sum is exactly the failure the business forbids: the minimum
  written in place of the answer.
  - PASS when `numeric_sum == expected_sum`. Citation: both values with their unit, and the declared
    analysis knowledge that states the exact sum.
  - FAIL otherwise. Citation: both values, their difference, and the declared analysis knowledge.
- **R3 — the declared options were the ones used.** Reads `analysis_options`, `strategy.limit` and
  `numeric_sum`. A sum obtained under a different bound or a non-strict comparison answers a question
  the pack never asked and has no verdict, however it compares.
  - PASS when `analysis_options` reports the operator `strictly greater` (equality excluded), a bound
    equal to `strategy.limit`, the input `$1/flow/measured.txt`, and an output holding the integer
    alone, **and** `numeric_sum` was read under those options. Citation: the recorded option list and
    `strategy.limit`.
  - FAIL otherwise. Citation: `analysis_options` as recorded and the `strategy.limit` it was held
    against.

A FAIL of R2 or R3 is a blocker: the Judge routes that generation to the wait node and the pack says
in words what was violated. A FAIL of R1 is likewise a blocker. Only R1 PASS, which requires R2 and
R3 to have passed, ends the Run as the goal met.

Knowledge: `assert-the-checker-options.md` shaped R3 and its precedence; `one-checker-per-session.md`
shaped R2's citations, which name the one count and its one producer; `end-honestly-in-more-than-one-way.md`
shaped R1's FAIL, which is reported as a fact about the Run and never as a conclusion.

## Choosers

**This pack has one generation and no chooser.** The one control block over the explore node reads
the outcome of rule **R1** — `numeric_sum` and `result_readable` in count and yes/no — and its only
clause is the goal-met clause: on **R1 PASS**, it records the decision **`goal-met`** and the loop
ends. There is no revisit and no next generation, so it never sets a new value and never moves a
target; `strategy.limit` is bound once by the Run and is not re-set.

Its **converge block** is declared empty: the value it would watch is `numeric_sum` (count), the band
is **0** and the generation count is **1**, but because the loop ends on the first generation there
is no next generation to compare against and **convergence is not an ending this pack can reach**.
If the block is ever consulted, it reads only that band and moves nothing.

Knowledge: `over-constrain-and-read-the-violation.md` is the file that shaped this section by not
applying — it would add a chooser that reads a violation, sets the next target to `asked +
|violation|`, and tightens on a pass. This business is deterministic, the exact sum is knowable from
the input and the bound, and the author asked for one generation with no chooser and no revisit, so
there is no next target to compute. That file's other effect is recorded instead: `numeric_sum` and
`expected_sum` are carried as separate typed values, so a landed bound is read as correctness rather
than as a margin.

## Endings

Every way a Campaign of this pack ends, in words.

- **The goal is met** — the authored script wrote a sum that satisfies the acceptance bound:
  `numeric_sum >= goal.minimum`, on a readable result, with the sum equal to the declared exact sum
  and obtained under the declared options. Reached by R1 PASS; the Choosers entry declares the
  goal-met clause that reads it.
- **No convergence** — this pack declares no converged ending, and states that plainly rather than
  inventing one. It has one generation, no revisit and no chooser that moves anything, so there is no
  next generation for a band to be held over; see the Choosers section's empty converge block. A
  Campaign of this pack therefore never ends as "converged", and never claims to.
- **Declared endings this pack stops at** — each reached by a named rule's FAIL routing to the wait
  node where a Campaign stops for a person:
  - R1 FAIL — the bound was not satisfied, or no readable count could be taken: this is the pack's
    words "the Workshop's script could not produce a readable result" when `result_readable` is no,
    and "the acceptance bound was not satisfied" when it is yes and the sum is short.
  - R2 FAIL — "the script wrote a sum that is not the sum this input and this declared limit
    require": an incorrect or fabricated result, including one produced by including a value equal to
    LIMIT.
  - R3 FAIL — "the script ran under options other than the declared ones": a different bound, a
    non-strict comparison, or a result file that was not the integer alone. The generation has no
    verdict.
- **Budget exhausted, and hard-blocked facts** — a Run that exhausts its generation budget, or that
  the Site blocks before the one generation can run, stops as a fact about the Run. Neither is
  successful analysis and neither is dressed up as one; no reader produces a number for them, so
  they are not endings this pack's rules detect.

Knowledge: `end-honestly-in-more-than-one-way.md` shaped this whole section — every stop above is one
this pack declares in its own words, each is reachable by a named rule's outcome or is explicitly
declared unreachable, and the budget is kept a budget rather than reported as a conclusion.

## Workshops

One Workshop act node, **numeric-analysis**, is where the AI may write code at run time. Nothing else
in this pack writes code.

- **Purpose** — author the analysis itself: one shell script that reads the measured input, applies
  the strict LIMIT comparison, accumulates the sum of the values strictly greater than the bound, and
  writes that integer alone to the result file. The script is created during the test Run and is not
  authored as a file of this method.
- **Inputs it is given** — the private workspace (`$1`), the scalar `LIMIT` bound from
  `strategy.limit` (`$2`), the measured input at `$1/flow/measured.txt` (produced by the preparation
  tool), and the one declared knowledge file named in the Knowledge section below. It writes and
  keeps its generated code in a private research directory inside the workspace.
- **What it must produce, in the Semantics' terms** — `result.txt` holding the integer alone, from
  which the declared reader obtains **`numeric_sum`** (count) and **`result_readable`** (yes/no); the
  script's exit status, recorded as **`workshop_exit`**; and the options it actually ran under, which
  the reader records as **`analysis_options`**. The reader additionally produces **`expected_sum`**
  (count), the declared exact sum for this input and bound. Every one of these is a value declared in
  the Semantics section, and the Workshop produces no value that section does not declare.
- **Not in scope** — no EDA stage, no licence checkout, no second tool, and no delay: this authoring
  test needs none of them.

Knowledge: `what-a-golden-flow-is.md` shaped the boundary between this node and the method — runtime
script creation belongs to the Workshop, so no analysis script is authored into the pack folder; the
flow's README and `prepare.sh` are the reference the generated script is learned from.
`one-checker-per-session.md` shaped the single-producer rule for the counts.

## Knowledge

The pack's own knowledge files, to sit in the pack folder's `knowledge/` and be named by its
contract. This pack declares one.

- **`knowledge/analysis.md`** — the declared analysis knowledge for this numeric business. It states
  the rule by which the exact sum is computed, so the Workshop can author a correct script and the
  reader can obtain `expected_sum` without asking anybody: the measured input holds one nonnegative
  integer per line; only values **strictly greater than** the bound are summed; a value equal to the
  bound is **excluded**; the bound is the scalar `LIMIT` the Workshop is handed, bound from
  `strategy.limit`; and `result.txt` holds the integer sum **alone**. It also states what the sum
  must not be: never the acceptance bound `goal.minimum`, and never a number the analysis did not
  compute. Its worked state — the flow's 12 inputs against the default bound of 11 give an exact sum
  of 119 — is named as an example of the rule, not as a constant of the pack.

It is read by: the Workshops entry above, as the declared analysis knowledge the script is authored
from; and rule R2, as the citation stating the exact sum. No other knowledge file is declared, and no
section of this spec names a knowledge file beyond this one.

Knowledge: `assert-the-checker-options.md` shaped this file's content — the boundary and the options
live in one declared place both the Workshop and the rules can read, rather than in a convention.
