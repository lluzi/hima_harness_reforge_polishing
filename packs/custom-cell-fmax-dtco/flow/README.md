# custom Cell Fmax probe and full custom Cell method

Run `/usr/bin/python3 <workspace>/flow/probe.py --workspace <workspace> --period <ns>`.
This performs **one** DC synthesis, with a 600-second subprocess deadline and eight cores.
Each invocation gets a fresh `flow/probes/trial-<uuid>/`; no previous trial is overwritten.
Successful output updates `flow/probe.json`, retaining original reports, netlist, constraints,
input hashes, command, elapsed time and the trial manifest. Tool errors publish no new result.

The Harness copies this Pack-owned flow into the Campaign workspace. Its first `bind-inputs`
node validates the selected Site bindings and creates a private `inputs.json`; no customer flow
directory or previously prepared input object is required. The probe reads these private JSON bindings: `designTop`, `rtlGlob`, `foundryDb`,
`constraintsTcl`, `clockName`, and `edaWrapper`. Values are Site environment paths,
not Pack defaults.
RTL and the foundry database are read in place and hashed, never modified. Check those paths
and the wrapper before running. Inputs and foundry files are not redistributed with this Pack.

The Tcl method uses the selected Site's foundry-only library and `compile_ultra`. Its timing
constraints are the supplied `constraints` binding, used unchanged by both arms. This Pack does
not impose a fixed input/output-delay percentage, clock-latency ratio, clock port, or virtual
clock; those are design and Site facts rather than portable method defaults.
`metrics.tsv` contains the asked period and worst constrained setup slack from the explicit
high-weight `reg2reg` path group,
and synthesized cell area. `read-probe.py REPORT OUT` checks the manifest's measurement hash
and emits the existing `clock_period`, `setup_wns` (setup/all), and `cell_area` semantics.
It never emits a guessed closed period. Malformed, missing, nonfinite or changed evidence fails.

The declared initial strategy and Goal are bounded trial settings, not promised results. A Site
profile supplies the physical row `PLACE_SITE`, tap/filler cells and interval, and shared P&R
settings. Those technology assumptions are checked before the Campaign writes `inputs.json` and
are identical for both arms.
The probe constraint is research pressure, not closure: explicit reg2reg WNS must be `-0.1 ns` or
worse. If pressure is lighter, `maintain-reg2reg-pressure` subtracts the measured shortfall from the
next requested period. A trial already at or below the Campaign target with sufficient pressure
ends the probe immediately. Always use the current observation and both Judge verdicts. Retest under matching
conditions to assess stability. A two-generation test may honestly exhaust its budget.
No synthesized measurement is a post-route or silicon Fmax claim.

For subsequent bounded algorithm work, `timing.rpt` identifies actual path points and
`netlist.v` identifies actual instances. Both carry hashes in the manifest. Extract finite
samples with line/object provenance; verify generated candidates against these objects and
an independent enumeration. No fabricated candidate counts or copied parameter profiles.

The preserved inner probe has synthesize → read-probe → judge → next-period → synthesize (revisit),
plus the hard-blocker wait. The Judge applies reg2reg-pressure-at-least-100ps then
clock-period-at-most; PASS and FAIL both reach next-period. The
maintain-reg2reg-pressure chooser is a recommendation; the same conversational Agent explicitly
executes nodes and selects decisions. The current method converges six evidence routes into one
cross-route AI research Workshop before the physical stages after this inner probe.


## Full-method entrypoints

`/usr/bin/python3 WORKSPACE/flow/stages.py STAGE WORKSPACE [ROUTE]` runs one requested stage.
ROUTE is one of the six underscore-separated identities in knowledge/full-mining-method.md.
STAGE is mine, merge, generate, layout, characterize, compile, foundry-synth, custom-synth,
adoption, pnr-foundry, pnr-generated, verify or compare. `read-stage.py REPORT OUT STAGE` derives
observations from the retained artifacts. Selection readers use `select-timing-criticality` etc.

The physical and tool profiles additionally declare `evidenceClass: site-run` and flat bindings for the
Site's Liberty/skeleton/LEF/QRC/GDS/map, bool2cmos, layout technology/rules/rails,
characterization helpers and three learned models, LC/DC/Innovus wrapper and explicit limits.
Missing inputs are rejected. `synthetic-fixture` is exclusively for labelled local tests.
The paired physical arms use the current `periodNs`, explicitly shared and rechecked. DC applies
50% uncertainty and writes a route SDC with 25% uncertainty. The foundry arm freezes the expanded
core box and IO-pin plan for exact reuse by the generated arm. `MAX_CELLS` is a Site-declared 1..50
generation budget and `MAX_ROUTE_CANDIDATES` is at most 40 per method. Six mechanical methods build
source evidence that is folded into one Boolean/interface-unique pool before the AI sees it. One
AI-authored ranking fills the common build allocation; all selected Cells share one generated library,
one DC pair and one APR pair. Adoption is mapped back to every source method. All timeouts, eight-core
CAD setting and the Site's five-job cap remain explicit.

Current manifests are convenient pointers. Immutable attempt directories retain logs, raw files,
input snapshots and records for audit or a failed-stage retry. The root graph's read/Judge after the
join consolidates evidence before any outer decision. A failed or unknown requirement cannot be
replaced with an earlier branch or inner probe success. See SPEC.md for the complete ending contract.

Each PnR arm retains setup and hold timing, route DRC, connectivity, power, gate-count and route
summary reports. The reader emits the verified hold/DRC/connectivity values. Power, gate count and
route summary remain visible raw reports until their current vendor format passes the L4 reader
probe; this Pack does not turn an unparsed report into a numeric PPA claim.
