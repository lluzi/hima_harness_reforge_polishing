## Files written

The compilation adds `contract.yml`, `graph.yml`, `semantics.yml`, three Judge rules, one chooser,
five readers, the deterministic closure adapter, four tool templates, the Workshop contract and
four knowledge assets. The reference graph has separate Fabric nodes for Innovus, StarRC,
PrimeTime, XTop and comparison; no shell script owns the multi-tool loop.

## Gaps

The Pack has low-cost parser, data-contract and graph validation. Trial 25 proved installation,
Site admission, source identity and one real Innovus launch, then exposed that `edarun` strips the
Pack's custom environment values at the container boundary. Version 1.0.1 bakes only the validated
Tcl parameters into each generated script and retains the outer environment for non-containerized
use. That fix was confirmed in Trial 26: Innovus restored the checkpoint and exported a 148 MB DEF
and an 18 MB netlist in 121 s of licence time, against Trial 25's 14.7 s guard failure with no
artifacts.

Trial 26 then reached StarRC and found a second, distinct boundary defect. `StarXtract` is on `PATH`
inside the container and `libtbb.so.12` ships in the toolkit's own `linux64_starrc/lib`, but the
container's EDA init sets no StarRC library path and the Pack does not go through the Foundation
Flow's `scripts/run_starrc.sh`, which exports `LD_LIBRARY_PATH` before launching it. The extraction
stage therefore failed at load with `libtbb.so.12: cannot open shared object file`. Version 1.0.2
sets that path inside the container's own shell, as a prefix on the command `edarun` runs, because a
value set on the outer Python subprocess never crosses the boundary. The toolkit root is discovered
inside the container by walking up from the `StarXtract` binary `command -v` resolves; a Site profile
may also declare it explicitly as `starrcHome`, but none of the retained profiles do so in this trial.
The container's inherited `LD_LIBRARY_PATH` is appended rather than discarded.
`pt_shell` and `xtop` need no equivalent: their Foundation Flow wrappers set no environment beyond
what `edarun-init.sh` already provides.

Database restore/export is now proven end to end on 1.0.1. Trial 27 ran the 1.0.2 fix in a real
Campaign for the first time: `extract-baseline` (StarRC) finished with exit 0 on both declared
corners (`cworst_T`, `cbest`), each a fully clean 83 MB SPEF with zero errors across every StarRC
stage, confirming the `LD_LIBRARY_PATH` fix — Trial 26's `libtbb.so.12` failure did not recur. The
Run then reached `analyze-baseline` (PrimeTime) for the first time in any Campaign — Trial 25 died at
Innovus, Trial 26 at StarRC — and PrimeTime itself completed across all four declared scenarios. The
next node, `summarize-baseline`, then exposed a third, distinct boundary defect: `parse_global`
(`flow/closure.py`) only recognizes the dashed WNS/TNS/NUM table PrimeTime prints for a corner with
violations; when a corner has zero setup (or zero hold) violations, PrimeTime instead prints a single
line, `No setup violations found.` (three of this Run's four scenarios were setup-clean), and the
parser raised `Rejected` on that line having no table to match. This is a pure-parse defect with no
licence cost — the Pack's own fixture in `test_closure.py` had only ever exercised the
has-violations shape, so nothing caught it before a real Campaign reached a genuinely clean corner.
Version 1.0.3 makes `parse_global` recognize `No {mode} violations found.` and return an all-zero
result for that mode, verified against a synthetic fixture and against all four real
`global_timing.rpt` files this Run produced. XTop, the Innovus ECO and the autonomous Workshop loop
remain unproven; the Trial 27 Run was cancelled at `summarize-baseline` as BLOCKED evidence rather
than hot-patched, per the tester's isolation rule. The Pack remains development status and has no
TEST.md or VERSION.yml release seal.

## Reviews

The method preserves one visible Campaign owner and one persistent Run. AI controls the next
bounded fix hypothesis; deterministic code controls identity, command whitelist, evidence parsing,
comparison and database selection. Runtime remains domain-neutral. The source Foundation Flow is
read-only and all licensed work lands in the Campaign workspace.
