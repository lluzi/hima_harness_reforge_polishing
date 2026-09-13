## Goal template

One Goal parameter, bound by the Run when a Campaign starts and carried on that Run's row:

- **`target_period_ns`** — the clock period the design must close at or below, measured in **ns**.
  Type: number. Bounds 0.1 .. 5. Default 0.5. It is the threshold of the goal rule
  `clock-period-at-most`, so the goal reads *clock period at most `<target_period_ns>` ns*.

What it means: a generation satisfies the Goal when the worst setup slack over all paths is not
negative **and** the clock period the measurement states is at most this number. The two are separate
Judge verdicts; this number decides only whether the Campaign is done, never which way the graph
goes. The bounds are a plausibility bound on what a person could ask this flow for — the same bounds
the synthesis tool itself refuses outside — and not a claim that the design closes anywhere in them.
The bound lands on the verdict, so a person reading a finished Run sees exactly what was asked for.

The Run's other settable number is the strategy knob `periodNs` declared in **Run contract**; the Goal
is not a strategy value and a generation cannot widen its own Goal to manufacture a pass.

Shaped by `over-constrain-and-read-the-violation.md`: the Goal is a bound to push against and read the
violation of, not a promise, so it is kept as one typed threshold rather than folded into the
constraint. Shaped by `end-honestly-in-more-than-one-way.md`: the bound is stated with its unit and
its values are cited, so a goal-met ending can say what it was met at.

## Constraints

One constraint, checked before the Goal and deciding the edge out of the Judge:

- **`setup-wns-all-nonnegative@1`** — `setup_wns ≥ 0` ns, over analysis mode **setup** and path scope
  **all**. It is about the worst constrained setup slack across every path group of the synthesized
  design, read from the generation's hashed `metrics.tsv`. A generation that cannot meet the asked
  period reports a negative slack and FAILs this constraint.

The options the measurement was made under, asserted rather than assumed. The synthesis is
`compile_ultra -no_autoungroup` at eight cores on the Site's foundry database, with a real clock
`clk` on the design's `clk` port at the asked period and a virtual clock `vclk_clk` at the same
period, 19.7% clock latency on both, 20% input and output delay on the virtual clock,
`analyze -format verilog` / `elaborate` / `link` / `change_names -rules verilog -hierarchy`, and the
worst constrained `-delay_type max` path queried per path group. The measurement records
`asked_period_ns`, `worst_slack_ns` and `cell_area_um2`, and a run of it fails outright when any
required artefact is missing or the log holds an `Error:` line.

Those options are asserted before any value counts. The reader refuses a manifest whose `format` is
not `aes-probe/1`, whose `toolExit` is not the integer 0, whose measurement the sha256 it names does
not match, whose field set is not exactly those three names, or whose numbers are nonfinite, with a
period ≤ 0 or an area ≤ 0. The manifest also carries the sha256 of `probe.py` and `synth.tcl`, of the
private `inputs.json` binding, of the foundry database and of every RTL file, so the option set a
generation was measured under is on the record and two generations can be compared only when it
matches. A generation whose evidence does not match has no verdict at all: it is a hard blocker, not
a pass.

The scope of the measurement is stated in every manifest: foundry-only synthesis, not post-route
signoff and not a measured silicon Fmax claim. No rule of this pack reads anything else.

Shaped by `assert-the-checker-options.md`: the option list is written down beside the constraint it
serves and asserted at run time before the count is read. Shaped by `one-checker-per-session.md`: one
synthesis tool and one option set, so a slack of this design belongs to exactly one session.

## Run contract

**Inputs a Site must bind** (in its own site file; the Site is `linglong-aes`):

- **`flowRoot`** — the Site's separately staged Golden Flow root: the directory holding `probe.py`,
  `synth.tcl`, `read-probe.py` and a private `inputs.json`. Read-only to a Campaign: a generation runs
  in the Campaign's own copy of it.
- **`design`** — `aes_cipher_top`, spelled as the flow's own `inputs.json` spells it. `probe.py`
  refuses any other value.
- **`workspaceRoot`** — where Campaign workspaces are created; the Site's Permit must allow writes
  under it.

No customer path or credential is part of this pack. The four files copied out of `flowRoot` are the
Site's, and `inputs.json` is never authored into the pack folder.

**What preparing a Campaign workspace copies out of `flowRoot`**, into `<workspace>/flow/`:
`probe.py`, `synth.tcl`, `read-probe.py`, `inputs.json`.

**Outputs a generation leaves in its workspace:**

- **`probe`** — path `flow/probe.json`, reader `aes-probe-reading`. The judged output: the manifest
  the synthesis wrote, read into HimaLedger as `clock_period`, `setup_wns` and `cell_area`.
- **`timingManifest`** — path `flow/probe.json`, no reader (unparsed), for evidence access. The same
  current manifest points to immutable trial files and names the generation's `metrics.tsv`, `timing.rpt`, `qor.rpt`, `netlist.v`,
  `constraints.sdc`, `references.rpt`, `check_timing.rpt`, `dc.log` and `entry.tcl` with a sha256 for
  each, which is what later analysis reaches actual timing points and netlist instances through.

**Wrappers the Site must allow:** `/usr/bin/python3`. It is the first word of the tool's command line
and of the reader's; no other wrapper is run.

**Tool `synthesize`:**

- File a person reads and runs by hand: `tools/probe.py`. It reads `WORKSPACE` and `PERIOD_NS` from
  its environment and performs exactly the declared command line, so a generation can be reproduced
  by hand without the harness.
- Inputs: `WORKSPACE`, `PERIOD_NS`.
- Licences: one `Design-Compiler` seat, held for as long as the Job runs.
- Command line: `/usr/bin/python3 ${WORKSPACE}/flow/probe.py --workspace ${WORKSPACE} --period ${PERIOD_NS}`.
- What it does: one bounded foundry-only synthesis of `aes_cipher_top` in a fresh
  `flow/probes/trial-<uuid>/` that never overwrites an earlier trial, with a 600-second subprocess
  deadline; on success it publishes `flow/probe.json`; on failure it publishes no new result and
  keeps the failed trial and its log.

**Reader `aes-probe-reading`:**

- Script: `tools/read-probe.py`, an exact copy of the Golden Flow's `read-probe.py`, so its argv is
  `/usr/bin/python3 ${READER} ${REPORT} ${OUT}`.
- Report kind: `aes-probe/1`. Emits `clock_period`, `setup_wns`, `cell_area`.
- What it does: checks the manifest's format, tool exit, measurement sha256, exact field set and
  finiteness, then writes those three typed values to `${OUT}`. It never emits a guessed closed
  period.

**Strategy knob:** `periodNs` — type number, unit ns, bounds 0.1 .. 5, default 0.35, precision 3. It
is the only thing that changes between generations, and it is what the `synthesize` node binds into
`PERIOD_NS`.

**Rules this pack's Judge may apply:** `setup-wns-all-nonnegative`, `clock-period-at-most`.

**Words:** `target_period_ns` reads as *clock period at most*, ns; `periodNs` reads as *clock period*,
ns.

Shaped by `what-a-golden-flow-is.md`: the Golden Flow is bound as a read-only pointer and copied out
of the Site's `flowRoot` by workspace preparation, never authored into the pack. Shaped by
`one-checker-per-session.md`: one tool, one reader and one output file, so every number belongs to one
session.

## Semantics

The three typed values this pack's reader produces. All three are the harness's existing types; the
pack declares no semantics of its own and writes no `semantics.yml`.

- **`clock_period`** — unit **ns**. The clock period the generation was synthesized at, as the
  measurement states it (`asked_period_ns`), never the number a Run hoped for and never an estimated
  next period. No `mode` and no `scope`: it is not a statement about an analysis pass or a path group.
- **`setup_wns`** — unit **ns**, mode **setup**, scope **all**. The worst constrained setup slack
  across every path group. Negative when the requirement is missed; a real 0.00 when it is met.
- **`cell_area`** — unit **um2**. The total cell area of the generation's synthesized netlist. Emitted
  for the record and for later analysis, and read by no rule or chooser of this pack.

Nothing is defaulted: the reader emits these values only from a manifest whose measurement hash
matched, and a manifest that fails any assertion produces no reading at all rather than a zero.

Shaped by `one-checker-per-session.md`: each value is named after the measurement that produced it and
carries the mode and scope it is a statement about, so two slacks can never be compared as if they
were the same number. Shaped by `assert-the-checker-options.md`: the units and qualifiers are held
against the declared list before an observation exists.

## Judge rules

Applied in this order by the Judge node; the outgoing edge is chosen by the outcome of the first.

- **`setup-wns-all-nonnegative@1`** — requires and is about `setup_wns` (mode setup, scope all);
  predicate `setup_wns ≥ 0` ns. **PASS** means setup closes at the period this generation asked for.
  **FAIL** means it does not, and the negative slack is the measured shortfall. Both outcomes route to
  the `next-period` explore node: a failure is a measurement, not the end of the Campaign. The verdict
  cites the observation id and the `setup_wns` value it read.
- **`clock-period-at-most@1`** — parameter `target_period_ns` (ns), bound from the Run's Goal;
  requires and is about `clock_period`; predicate `clock_period ≤ target_period_ns`. Its outcome
  decides only whether the Campaign is done: the chooser may state goal-met only when this rule and
  the setup rule are both PASS on the current generation. It never chooses an edge. The verdict cites
  the observation id, the `clock_period` value and the bound it was held against.

Both rules read one observation produced by one synthesis, so a verdict is always about one session
and one option set. When a rule's required value is absent or unknown, the rule is UNDETERMINED; the
pack labels no edge for UNDETERMINED, so the fabric routes the Run to the `blocked` wait node rather
than to a next period.

Shaped by `one-checker-per-session.md`: the constraint rule and the goal rule are two opinions about
the same tool's single measurement, never a fold over two sessions. Shaped by
`assert-the-checker-options.md`: a verdict is written only over evidence the reader asserted.

## Choosers

One chooser, `over-constraining-push@1`, taken from the reference `opene902-timing-probe` pack with
the step re-bound. The `next-period` explore node binds its one parameter **`stepNs` = 0.01 ns**.

- Reads out of the Run's latest observation: **`period`** (`clock_period`, ns) and **`slack`**
  (`setup_wns`, ns). It reads the period the measurement states, never the period the Run asked for.
- Decides by the first matching clause, where `constraint` is the `setup-wns-all-nonnegative` verdict
  and `goal` the `clock-period-at-most` verdict:
  - `{constraint: PASS, goal: PASS}` → **goalMet: true**. There is no next strategy.
  - `{constraint: PASS}` → next `periodNs = period − stepNs`. A met constraint states no margin, so
    this clause reads none and tightens by one step.
  - `{constraint: FAIL}` → next `periodNs = period + |slack| − stepNs`. The shortfall is a
    measurement; `period + |slack|` is only an estimated next-trial target, and the next experiment asks one step
    inside that estimate. Actual closure must be remeasured. A knob the clause does not name carries over.
- Converge block, declared on the same explore node: read **`period`**, band **0.005 ns**,
  **1** successive generation, **generationLimit 2**.

A deliberately tight first period may reveal a violation; it is not guaranteed to fail. A
passing trial is also useful evidence. The move `period + |slack| - stepNs` is a hypothesis,
not a guaranteed reachable period: IO delays and clock latency change with the period here.
Convergence is the declared comparison of observed periods at matching conditions, limited to
reporting resolution. It does not prove global optimality or Goal attainment.

Shaped by `over-constrain-and-read-the-violation.md`: the PASS clause never reads a margin, so a
zero-slack met constraint cannot make the exploration walk away from the frontier, and the violation
is the value the next target is computed from. Shaped by `end-honestly-in-more-than-one-way.md`:
convergence is stated in the chooser's own vocabulary, over a read it actually takes.

## Endings

Every way a Campaign of this pack stops, and what reaches it:

- **Goal met** — reached by the `over-constraining-push` clause `{constraint: PASS, goal: PASS}`,
  which states `goalMet: true` when both current Judge verdicts are PASS: setup closed and the
  measured `clock_period` is at most the bound `target_period_ns`. It is stated with the measured
  values, the bound and the observation and verdict ids. No other path reaches it: a PASS on the goal
  rule alone, with setup FAIL, is not goal-met and goes on to `next-period`.
- **Converged** — reached by the `next-period` explore node's converge block: the value it watches is
  the `period` read, the band 0.005 ns, over 1 successive generation. It says only that consecutive
  measured periods stopped moving. It is an honest negative or incomplete result: it does not prove
  setup closed, does not prove the Goal was met, and a repeated violation may converge. A person reads
  the recorded verdicts to tell that apart from a measured closed result.
- **Budget exhausted** — reached when the Loop's `generationLimit` of 2 is spent (the revisit that
  would open generation three does not happen, with the period it would have tried still on record)
  or when the Run's own time box expires. This is a budget, not a conclusion: it is reported as an
  honest incomplete result, never as performance success. A two-generation probe may honestly exhaust
  its budget.
- **Waiting on a hard blocker** — reached at the one `blocked` wait node, for a person. The fabric
  routes a Run there when a node's Retry allowance is spent, and when a Judge rule is UNDETERMINED —
  a required value absent or unknown, which includes a synthesis that published no new
  `flow/probe.json` and a reading the reader refused for a malformed, missing, nonfinite or
  hash-changed measurement. That refusal is one of this pack's declared blockers: it names the rule
  (`setup-wns-all-nonnegative` or `clock-period-at-most`) that could not be given an opinion, and it
  is never rounded into a pass.

Shaped by `end-honestly-in-more-than-one-way.md`: the endings were written as the business can
actually stop, each with the value that detects it, and the generation limit is kept as a Budget that
ends honestly rather than being dressed up as a result.

## Workshops

None. This initial probe version declares no Workshop: one synthesis, one reading, two rules and one
chooser are the whole method, and no step of it needs code written at run time. The later PLS09
analysis version will add the AI-written research work of extracting and checking candidate timing
points and netlist instances from the manifest's hashed reports, and that is a different pack.

No knowledge file shaped this section, because there is nothing here for one to shape. A knowledge
file shapes how a business is pursued and never adds a stage, so reading one is not a reason to write
a Workshop the author did not ask for.

## Knowledge

One file, written under the pack folder's `knowledge/` and declared by its contract:

- **`aes-probe-method.md`** — purpose: how to read this pack's numbers and what they do not say. It
  preserves actual zero or positive slack and treats a negative shortfall as evidence for a proposed
  next trial, not a guarantee of achievable period; that the period a generation
  is judged on is the measured `clock_period` (the period asked for and synthesized), never an
  estimated or reused next period; that two generations are comparable only under matching conditions,
  which the manifest's sha256 entries for the method scripts, the inputs binding, the foundry database,
  the RTL and every evidence file are there to establish; that the reading is of hashed bytes whose
  format, exit status, field set and finiteness are asserted; that the constraints are `setup_wns ≥ 0`
  over setup/all and `clock_period ≤ target_period_ns`; and that `timing.rpt` and `netlist.v` are
  finite, hashed samples of actual path points and actual instances for subsequent bounded analysis,
  to be taken with line/object provenance and checked against an independent enumeration.

Shaped by `over-constrain-and-read-the-violation.md`: the file's central point is the zero-slack and
violation reading, so a person cannot mistake a met constraint for a measurement of margin. Shaped by
`attribute-by-database-relation.md`: the file says later analysis reaches actual timing points and
instances through the hashed reports and an independent enumeration, and that a failed extraction is
reported rather than replaced by a name-matched or fabricated count.
