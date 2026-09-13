# How to read this pack's numbers

This pack measures one design — `aes_cipher_top` — one way: a single bounded foundry-only synthesis
per generation, at one asked clock period, on the Site's own foundry database and RTL. What it
produces is a small set of numbers, and the whole of this file is about what those numbers do and do
not say. None of them is a post-route signoff and none of them is a silicon Fmax claim.

## A met constraint states no margin; a violation is a measurement

A synthesis tool can report zero slack once its requested timing constraint is met. That
zero does not establish the best period the design could reach. Positive slack is also an actual
measurement and must be retained; it is not guaranteed to appear or to imply the same margin
under a new synthesis or changed timing constraints.

For a trial with asked period P and negative measured slack V, P + |V| is only a candidate
estimate for the next experiment. This method also scales IO delays and clock latency with P,
so simple period/slack arithmetic cannot certify closure at the estimate. The next trial must
actually be synthesized, read and judged. A failing first trial is possible, not guaranteed.
Never add a guard band that systematically relaxes an already passing zero-slack trial.

## The period judged on is the measured one, never a hoped-for one

`clock_period` is read from the generation's own measurement, not assumed from the number the
strategy asked for. `synth.tcl` creates the clock at the asked period, so the two agree on this flow
— but the rule is the measurement's, because a tool that clamped the period, or a generation that
reused another generation's result, would otherwise be judged as if it had honoured the request.

An estimated period has a different name and a different status. The over-constraining push computes
`clock_period + |setup_wns| - stepNs` as the next experiment's target. That is a **hypothesis** about
a period that might close, not a measurement that it does. It must never appear among measured
results, and a report that lists it as though the design had closed there is wrong.

## Matching conditions, and the hashes that establish them

Two generations are comparable only when the method, the library, the RTL and the constraints are the
same. The manifest is what makes that checkable: it carries a sha256 for `probe.py` and `synth.tcl`,
for the private `inputs.json` binding, for the foundry database, for every RTL file, and for every
artefact the trial produced. A comparison between two generations whose method or inputs hashes
differ is not a comparison of the design; it is a comparison of two different runs, and it should be
reported as such. Retesting at the same period under the same conditions is how stability is
assessed — and a repeated measurement that does not reproduce is itself a fact worth recording.

## The reading is of hashed bytes

The reader runs only over a manifest whose `format` is `aes-probe/1`, whose `toolExit` is the integer
`0`, whose measurement file's sha256 matches the hash the manifest names, whose field set is exactly
`asked_period_ns`, `worst_slack_ns` and `cell_area_um2`, and whose three numbers are finite with a
positive period and a positive area. Anything else — a malformed manifest, a missing report, a hash
that no longer matches, a nonfinite number — produces **no reading at all**. It never produces a zero
standing in for a number nobody read. A generation whose evidence fails any of these has no verdict;
it is a blocker for a person, not a pass and not a failure.

## The two constraints

- Setup closure: `setup_wns ≥ 0` ns, over analysis mode **setup** and path scope **all** — the worst
  constrained setup path of every path group, with input pins, nets, transition times and
  capacitance reported, and with real and virtual clocks at the same period, 19.7% clock latency and
  20% input/output delay.
- The Goal: `clock_period ≤ target_period_ns`. It decides only whether the Campaign is done. A
  generation that closes setup but misses the target is a real result: the design closes, but not yet
  where the Goal is.

They are applied in that order, and a valid setup failure can inform the next trial within the remaining budget.
Execution failures or incomplete evidence cannot support that inference.

## Finite timing and netlist samples, for later analysis

For subsequent bounded algorithm work, two artefacts in the manifest are the ground truth:

- `timing.rpt` names actual timing path points — real startpoints, endpoints and pins of this
  synthesis.
- `netlist.v` names the actual instances of this synthesis.

Both carry a sha256 in the manifest, so a later reader can prove it read the same bytes. Analysis
over them takes a **finite** sample and records where each sample came from — the line and the object
it names — and verifies any generated candidate against those objects and against an independent
enumeration. It does not count lines that merely look like a naming convention: a tool renames,
uniquifies, folds and buffers, so a name match is wrong in both directions and a count of such
matches is not a measurement. When a sample or an enumeration cannot be produced, that is reported as
a blocker with the reason; it is never replaced by an invented count or a copied parameter profile.

The `cell_area` of a generation is recorded beside these for the record, and is read by no rule of
this pack.
