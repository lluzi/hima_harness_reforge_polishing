# How to read this pack's numbers

This Pack measures one Site-bound design — `designTop` — one way: a single bounded foundry-only synthesis
per generation, at one asked clock period, on the Site's own foundry database and RTL. What it
produces is a small set of numbers, and the whole of this file is about what those numbers do and do
not say. None of them is a post-route signoff and none of them is a silicon Fmax claim.

## This probe seeks measured optimization pressure

A synthesis tool can report zero slack once its requested timing constraint is met. That
zero does not establish the best period the design could reach. Positive slack is also an actual
measurement and must be retained; it is not guaranteed to appear or to imply the same margin
under a new synthesis or changed timing constraints.

For this DTCO method, an explicit reg2reg WNS of `-0.1 ns` or worse is the admission target: DC must
have real pressure to remap logic into a new Cell. If WNS is less negative than `-0.1 ns`, the next
period is tightened by exactly that measured shortfall and must be synthesized, read and judged.
A violation is intended evidence here; the probe must not relax it toward timing closure.

## The period judged on is the measured one, never a hoped-for one

`clock_period` is read from the generation's own measurement, not assumed from the number the
strategy asked for. `synth.tcl` creates the clock at the asked period, so the two agree on this flow
— but the rule is the measurement's, because a tool that clamped the period, or a generation that
reused another generation's result, would otherwise be judged as if it had honoured the request.

An estimated period has a different name and a different status. The pressure chooser computes
`clock_period - pressureMagnitudeNs - reg2reg_wns`, with `pressureMagnitudeNs=0.1 ns`, only when measured pressure
is insufficient. That is a **hypothesis** about a period that might supply the missing pressure, not
a measurement. It must never appear among measured results before the next probe runs.

## Matching conditions, and the hashes that establish them

Two generations can be compared only under the same effective inputs and method. Version 2 pins
binding, RTL/database hashes, producer/constraint/wrapper hashes and Python version. It checks those
before another trial and again after synthesis. The actual reported tool version and operating
conditions must also match before a later manifest is published. The reader checks the immutable
Campaign identity reference before emitting observations for convergence.

These checks cover declared inputs, code and reported tool conditions; they are not a complete OS
snapshot or attestation of every runtime variable. The Site remains responsible for its environment.
A mismatch requires a new Campaign and leaves existing trials intact. A repeated measurement that
fails to reproduce under matching conditions remains useful evidence of that limited result.

## The reading is of hashed bytes

The reader runs only over a manifest whose `format` is `custom-cell-fmax-probe/2`, whose `toolExit` is the integer
`0`, whose measurement file's sha256 matches the hash the manifest names, whose field set is exactly
`asked_period_ns`, `worst_slack_ns` and `cell_area_um2`, and whose three numbers are finite with a
positive period and a positive area. Anything else — a malformed manifest, a missing report, a hash
that no longer matches, a nonfinite number — produces **no reading at all**. It never produces a zero
standing in for a number nobody read. A generation whose evidence fails any of these has no verdict;
it is a blocker for a person, not a pass and not a failure.

## The two constraints

- Research pressure: `reg2reg_wns ≤ -0.1` ns, over analysis mode **setup** and path scope **reg2reg** —
  the worst sequential path in the explicit high-weight reg2reg group, with input pins, nets,
  transition times and capacitance reported under the selected Site's own constraints.
- The Goal: `clock_period ≤ target_period_ns`. It decides only whether the Campaign is done. A
  generation with sufficient pressure but above the target is tightened again; it has not met the
  Campaign's requested operating point.

They are applied in that order, and a valid setup failure can inform the next trial within the remaining budget.
Execution failures or incomplete evidence cannot support that inference.

## Finite timing and netlist samples, for later analysis

For subsequent bounded algorithm work, two artefacts in the manifest are the ground truth:

- `timing.rpt` is restricted to the explicit `reg2reg` path group and names actual timing path
  points — real register startpoints, register endpoints and pins of this
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
