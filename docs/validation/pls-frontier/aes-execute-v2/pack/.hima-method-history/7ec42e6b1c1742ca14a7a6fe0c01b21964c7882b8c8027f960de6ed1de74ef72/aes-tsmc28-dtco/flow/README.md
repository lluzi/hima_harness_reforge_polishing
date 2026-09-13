# AES foundry-only synthesis probe

Run `/usr/bin/python3 <workspace>/flow/probe.py --workspace <workspace> --period <ns>`.
This performs **one** DC synthesis, with a 600-second subprocess deadline and eight cores.
Each invocation gets a fresh `flow/probes/trial-<uuid>/`; no previous trial is overwritten.
Successful output updates `flow/probe.json`, retaining original reports, netlist, constraints,
input hashes, command, elapsed time and the trial manifest. Tool errors publish no new result.

The Site owner stages this directory and a private `inputs.json` as the Site's `flowRoot`.
The Pack copies `probe.py`, `synth.tcl`, `read-probe.py`, and `inputs.json` into its Campaign.
The private JSON has exactly these bindings: `design` (`aes_cipher_top`), `rtlGlob`,
`foundryDb`, and `edaWrapper`. Values are customer environment paths, not Pack defaults.
RTL and the foundry database are read in place and hashed, never modified. Check those paths
and the wrapper before running. Inputs and foundry files are not redistributed with this Pack.

The Tcl method follows the legacy AES Golden Flow's foundry-only library, compile_ultra,
20% input/output delay and 19.7% clock-latency ratio, with real and virtual clocks.
`metrics.tsv` contains the asked period, worst constrained setup slack across path groups,
and synthesized cell area. `read-probe.py REPORT OUT` checks the manifest's measurement hash
and emits the existing `clock_period`, `setup_wns` (setup/all), and `cell_area` semantics.
It never emits a guessed closed period. Malformed, missing, nonfinite or changed evidence fails.

Recommended initial strategy: periodNs=0.35 ns, bounds 0.1..5, precision 3. Recommended fixed
Goal: target_period_ns=0.5 ns with the same bounds. These are trial settings, not promised results.
After a constraint failure, asked period minus negative slack estimates a relaxed next trial;
apply a 0.01 ns over-constraining step. After a pass that misses Goal, try 0.01 ns tighter.
Always use the current observation and both Judge verdicts. A zero slack is a real zero;
never add a guard that systematically relaxes an already passing trial. Retest under matching
conditions to assess stability. A two-generation test may honestly exhaust its budget.
No synthesized measurement is a post-route or silicon Fmax claim.

For subsequent bounded algorithm work, `timing.rpt` identifies actual path points and
`netlist.v` identifies actual instances. Both carry hashes in the manifest. Extract finite
samples with line/object provenance; verify generated candidates against these objects and
an independent enumeration. No fabricated candidate counts or copied parameter profiles.

Author the Pack with synthesize → read-probe → judge → next-period → synthesize (revisit),
plus the hard-blocker wait. The Judge applies setup-wns-all-nonnegative then
clock-period-at-most; PASS and FAIL both reach next-period. The existing
over-constraining-push chooser is a recommendation; the same conversational Agent explicitly
executes nodes and selects decisions. No Workshop is needed for this first probe version;
the later analysis/mining version adds real research Workshops.
