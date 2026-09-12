# authored-numeric — Pack Intent

## Business

A tiny numeric-analysis method. Each generation's actual input is a list of nonnegative integers,
one per line. There is no EDA and no licence use anywhere in this business. The analysis sums only
those measured values **strictly greater than a requested LIMIT**: a value equal to LIMIT is
excluded, and the sum itself is the output. Nothing about the result is fabricated, and the
acceptance bound is never written in place of the sum.

**What is explored.** A generation varies the *authored analysis script*: how the script reads the
measured input, applies the strict comparison, accumulates, and writes the integer. The input
numbers are fixed and are not varied; preparation is fixed and is not varied. The one strategy knob
is `limit`, unit count, bounds 0..100, default 11, and the Workshop's scalar `LIMIT` binds from it —
it fixes which values the analysis includes, and so moves the expected sum.

**What is measured.** The Workshop's generated script produces `result.txt`, and the declared custom
reader emits `numeric_sum`, unit count, being the integer the script wrote alone in that file. The
Judge requires `numeric_sum >= goal minimum`, where the Goal's `minimum` is unit count, bounds
0..10000, default 1; this test Run explicitly requests `minimum = 1`. The independently expected sum
of the values strictly greater than LIMIT is stated by the declared knowledge file and carried in
the record beside the measured one, so the record can say whether a landed bound was *correct* and
not merely *satisfied*. Against the flow's actual inputs at the default `limit = 11`, the expected
sum is 119.

**What ends it.** The one way this method ends as successful analysis: the generation ran, produced
a readable integer result, and that result satisfies the acceptance bound — `numeric_sum >= goal
minimum`. Every other stop is a declared ending recorded as a fact and never as successful analysis:
a result file that is absent, empty or not an integer; a script that exits non-zero; a Run blocked
by a hard constraint; and a Run that exhausts its budget. A budget stop and a blocked stop are facts
about the Run, not conclusions about the numbers, and neither is reported as a successful analysis.
There is one generation and no chooser and no revisit, so this method's terminal ending is the
satisfied bound, and it declares the other stops rather than dressing them up as convergence.

**What a person must never have to guess.** Three readings must stay distinct on every face the pack
shows — card, decision record, report:

- the **measured sum** — what the Workshop's authored script actually wrote, in count;
- the **expected sum** — what the input and the LIMIT require, in count;
- the **minimum** — an acceptance bound, not an answer and not the output.

A reader who conflates any two of these cannot tell a correct analysis from a lucky one. Two further
points are stated in the pack's words and not left to convention: LIMIT is a **strict** boundary
equality excluded, and `result.txt` holds the integer **alone** with nothing else in the file.

## Golden Flow

- `/private/tmp/hima-l4-J5R76P/hima-home-JAqnCY/numeric-flow` — the flow's own directory, read
  (not copied) for its stages and the variables each one takes:
  - `/private/tmp/hima-l4-J5R76P/hima-home-JAqnCY/numeric-flow/README.md`
  - `/private/tmp/hima-l4-J5R76P/hima-home-JAqnCY/numeric-flow/prepare.sh`
  - `/private/tmp/hima-l4-J5R76P/hima-home-JAqnCY/numeric-flow/numbers.txt`

What was read there: `prepare.sh` is the flow's only build file and its only stage. It takes the
flow directory as its single argument (`sh prepare.sh <flow-directory>`), `cd`s to it, and copies
`numbers.txt` to `measured.txt`; it takes no LIMIT and no other variable. `numbers.txt` holds 12
lines, one nonnegative integer each (values 1..39), and the analysis stage the README describes — a
Workshop writing its own shell script from the actual inputs and the declared analysis knowledge,
producing `result.txt` holding the integer sum alone — is **not** a file in the flow: it is authored
per generation. The README states the strict-inequality rule and the no-EDA, no-licence facts.

Nothing of the flow is copied into this pack. The Campaign's private workspace copy is what the
generation reads, with the flow's inputs and preparation script laid down at `flow/` by the runner.

## Answers

1. What a generation varies: **the authored analysis script** — how it reads `measured.txt`, applies
   the strict LIMIT comparison, accumulates, and writes the sum. The input numbers and `prepare.sh`
   are fixed and are never varied.
2. Is LIMIT swept or fixed: **fixed per Campaign**, bound from the strategy knob `limit`. It is not
   swept across generations; the acceptance bound is what a generation is scored against.
3. Boundary rule at the value equal to LIMIT: **strict** — a number equal to LIMIT is excluded. The
   README says "strictly greater", so including an equal value is a wrong sum, not a rounding
   difference.
4. What the measured sum is: the **integer written by the generation's own authored script into
   `result.txt`**, read alone with nothing else in the file, emitted by the declared custom reader
   as `numeric_sum` in count.
5. What verifies that output: the **pack's own declared analysis knowledge**, the one declared
   knowledge file that explains the exact sum, held against the input and the LIMIT. There is no
   external checker and no tool database in this flow; no verification tool's licence is used.
6. What a wrong script must let the run say: the measured sum and the independently expected sum
   side by side, so a wrong result states **where** it went wrong rather than only "failed". (The
   signed-difference value is recorded for the record; there is no chooser to feed it to.)
7. The actual terminal ending, in words: **"the authored script wrote a sum that satisfies the
   acceptance bound — `numeric_sum >= goal minimum`."** The pack writes the true integer and never
   the minimum, because the minimum is an acceptance bound, not the output to fabricate.
8. When the bound is not satisfied, or `result.txt` is absent, empty or non-numeric, or the script
   exits non-zero: **declared endings in the pack's own words** — "the Workshop's script could not
   produce a readable result" — recorded as blocker facts, explicitly not successful analysis.
9. Is the expected sum needed at all: **yes, it is recorded.** The knowledge file states the exact
   sum; carrying measured versus expected lets the record say a landed bound was correct rather than
   merely satisfied.
10. Where preparation writes and what the script sees: preparation is `sh prepare.sh
    <workspace>/flow`, writing `<workspace>/flow/measured.txt` from `<workspace>/flow/numbers.txt`.
    Workshop entry argv is `sh ${ENTRY} ${WORKSPACE} ${LIMIT}`; the generated script reads
    `$1/flow/measured.txt` and writes the integer alone to `$1/result.txt`.
11. Where generated code lives: in a **private research directory** inside the workspace. Runtime
    script creation belongs to the Workshop, not to method authoring.
12. What a person must never have to guess: the **measured sum** (count, what the script wrote), the
    **expected sum** (count, what the input and LIMIT require) and the **minimum** (a bound, not an
    answer) stay distinct on every face; the boundary is strict; `result.txt` holds the integer
    alone.
13. Structure: one preparation tool, one real Workshop act node, one observing act node, one Judge,
    and the required hard-blocker wait. **One generation, no chooser, no revisit.**
14. Scope: no EDA, no licences. Nothing in this business needs either.
15. Knowledge applicability: `attribute-by-database-relation.md` is **inapplicable** — this flow has
    no tool database and asks no adoption question; no name-matching reader exists here.

## Ambiguities resolved

1. **The flow has no LIMIT; the contract has one.** The author's words and the flow disagree: the
   README speaks of "the requested LIMIT" that the analysis must apply, but `prepare.sh` — the flow's
   only stage — takes only the flow directory and no LIMIT, and no file of the flow carries the
   value. Settled by the author: **the strategy knob is the authority.** `limit` (count, 0..100,
   default 11) binds into the Workshop's scalar `LIMIT`, and Workshop entry argv carries it as
   `${LIMIT}`. The flow simply does not encode it; this is recorded as the author's settlement, not
   as a defect in the flow.
2. **Where the analysis stage lives.** The README describes an analysis stage, but the flow contains
   no such script. Settled: the analysis is **authored per generation by the Workshop** from the
   actual inputs and the declared analysis knowledge, and produces `result.txt` at run time. It is
   deliberately not a file of the pack.
3. **The sum is the output, and nothing else is.** Settled: `result.txt` contains the integer sum
   alone — no labels, no counts of included values, no report. The measured value is one number.
4. **The minimum does not stand in for the answer.** Settled: the Judge requires
   `numeric_sum >= goal minimum`, while the reader reports what the script actually wrote. The test
   request of `minimum = 1` is deliberately loose, and the pack must still write the true sum; a pack
   that leaned on the bound would be fabricating its output.
5. **Preparation's layout in the private copy.** Settled: the run's private workspace holds the
   flow's inputs and preparation script at `flow/`, so preparation is `sh prepare.sh
   <workspace>/flow` and the generated script reads `$1/flow/measured.txt`. Preparation itself is
   read-only with respect to the Golden Flow.
6. **No EDA and no licence.** The README states it and the author confirms it. Settled: no EDA stage
   and no licence checkout exists in this method, and none is authored.

## Knowledge applied

- `over-constrain-and-read-the-violation.md` — **inapplicable here, and marked so.** It demands a
  chooser that reads a violation and targets `asked + |violation|`, and one-step-tighter first
  generations. This business is a deterministic, one-generation method with no chooser and no
  revisit, so there is no next target to compute. What it changed: it forced the explicit statement
  that the method cannot converge and does not pretend to; and it fixed that the measured and
  expected sums are carried apart, so a landed bound is read as correctness, not as a margin.
- `end-honestly-in-more-than-one-way.md` — made the endings the first thing written rather than the
  last: one terminal ending in the pack's own words (a readable result satisfying
  `numeric_sum >= goal minimum`), plus declared endings for an absent, empty or non-numeric result
  file, a non-zero script exit, a blocked Run, and an exhausted budget — the last two recorded as
  facts and never as successful analysis, since a generation limit is a budget and not an ending.
- `assert-the-checker-options.md` — turned the boundary rule and the interface into declared options
  asserted before the count is read: the LIMIT value actually used, the **strict** comparison
  (equality excluded), the input `$1/flow/measured.txt` and the `result.txt`-holds-the-integer-alone
  contract are written down in the pack and asserted at read time, so a generation that ran under a
  different boundary has no verdict rather than a passing number.
- `one-checker-per-session.md` — kept the count attached to one producer: the one Workshop act node
  runs the one authored script, the one declared reader produces the one count `numeric_sum`, and the
  Judge takes its verdict from a rule over that named value. No second tool is run in that session
  and no totals are taken across producers.
- `attribute-by-database-relation.md` — **inapplicable.** It concerns reading adoption through a tool
  database's instance-to-master relation; this flow has no tool database, no master relation and no
  adoption question. It changed nothing, and it is recorded as inapplicable rather than cited as if
  it had.
- `what-a-golden-flow-is.md` — kept the flow where it lies: this record carries the path and what was
  read there as pointers, no file of the flow was copied into the pack folder, and the pack copies
  only the flow inputs and preparation script the contract names into its own workspace at run time.
  It also made every disagreement between the author's words and the flow its own question, which is
  how the missing LIMIT in `prepare.sh` was surfaced and settled rather than silently assumed.
