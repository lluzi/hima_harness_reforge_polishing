# AES probe and full custom Cell method

Run `/usr/bin/python3 <workspace>/flow/probe.py --workspace <workspace> --period <ns>`.
This performs **one** DC synthesis, with a 600-second subprocess deadline and eight cores.
Each invocation gets a fresh `flow/probes/trial-<uuid>/`; no previous trial is overwritten.
Successful output updates `flow/probe.json`, retaining original reports, netlist, constraints,
input hashes, command, elapsed time and the trial manifest. Tool errors publish no new result.

The Site owner stages this directory and a private `inputs.json` as the Site's `flowRoot`.
Version 3 copies those files plus `stages.py`, `read-stage.py`, `selection-template.py` and `domain/`, as declared in contract.yml.
The probe reads these private JSON bindings: `design` (`aes_cipher_top`), `rtlGlob`,
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

The preserved inner probe has synthesize → read-probe → judge → next-period → synthesize (revisit),
plus the hard-blocker wait. The Judge applies setup-wns-all-nonnegative then
clock-period-at-most; PASS and FAIL both reach next-period. The existing
over-constraining-push chooser is a recommendation; the same conversational Agent explicitly
executes nodes and selects decisions. Version 3 adds six selection Workshops and the physical stages after this inner probe.


## Full-method entrypoints

`/usr/bin/python3 WORKSPACE/flow/stages.py STAGE WORKSPACE [ROUTE]` runs one requested stage.
ROUTE is one of the six underscore-separated identities in knowledge/full-mining-method.md.
STAGE is mine, merge, generate, layout, characterize, compile, foundry-synth, custom-synth,
adoption, pnr-foundry, pnr-generated, verify or compare. `read-stage.py REPORT OUT STAGE` derives
observations from the retained artifacts. Selection readers use `select-timing-criticality` etc.

Private inputs additionally declare `evidenceClass: site-run` and `legacy` bindings for the
Site's Liberty/skeleton/LEF/QRC/GDS/map, bool2cmos, layout container/technology/rules/rails,
characterization helpers and three learned models, LC/DC/Innovus wrapper and explicit limits.
Missing inputs are rejected. `synthetic-fixture` is exclusively for labelled local tests.
The paired physical arms use `legacy.CLOCK_NS`, explicitly shared and rechecked, while periodNs
is the initial probe's exploratory strategy. `MAX_CELLS` is 1 or 2 in this bounded pilot; six routes
share that final build allocation. All timeouts, eight-core CAD setting and Site cap remain explicit.

Current manifests are convenient pointers. Immutable attempt directories retain logs, raw files,
input snapshots and records for audit or a failed-stage retry. The root graph's read/Judge after the
join consolidates evidence before any outer decision. A failed or unknown requirement cannot be
replaced with an earlier branch or inner probe success. See SPEC.md for the complete ending contract.
