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

Trial 28 ran the 1.0.3 fix in a real Campaign and confirmed it: `summarize-baseline` completed and
produced this Pack's first-ever real closure state (setup WNS -0.040 ns / TNS -0.120 ns / 12
violations, hold WNS -0.160 ns / TNS -8.860 ns / 221 violations, closure score 243.580, 3
unconstrained endpoints), and the `plan-fix` Workshop then produced this Pack's first-ever real
generation-1 plan (a bounded `hold-buffer` action against the three families carrying the hold
mass, evidence-linked hypotheses, opposing setup margin retained). The Run then reached `xtop` for
the first time in any Campaign and exposed a fourth, distinct boundary defect: `xtop()` passes
`-log_dir <root>/logs` to the `xtop` binary but only ever creates `<root>` itself
(`root.mkdir(...)`), never the `logs` subdirectory — and unlike the Pack's own templated tools,
`xtop` does not create that directory for itself, so it exits 1 immediately with `Directory
'.../XTOP/logs' does not exist or is not readable.` before doing any timing-fix work. This is a
pure filesystem-setup gap, deterministic and licence-free, distinct from the Innovus/StarRC
container-boundary class (trials 25–26) and the PrimeTime parser gap (trial 27) — `xtop` is simply
the first stage whose own log-directory requirement the Pack never satisfied, because no prior
Campaign ever admitted it. Version 1.0.4 adds `(root / "logs").mkdir(parents=True,
exist_ok=True)` immediately after `root.mkdir(...)`, verified against a red test that stubs
`run_eda` and asserts the directory exists at call time. The Innovus ECO/`ecoRoute` loop and the
autonomous multi-generation research loop remain unproven; the Trial 28 Run was stopped at `xtop`
as BLOCKED evidence rather than hot-patched.

Trial 29 proved the 1.0.4 fix completely: `xtop` succeeded for the first time in this Pack's
history, and the Run went on to admit the Innovus ECO for the first time too — `apply-eco`,
`extract-after` (StarRC), `analyze-after` (PrimeTime) and `compare-and-retain` all completed,
closing generation 1 with a real measured improvement (closure score 243.580 → 214.920, hold
violations 221 → 193, hold TNS −8.860 ns → −8.300 ns, setup held at its −0.040 ns/12-violation
margin exactly as the plan intended) and retaining it as the new best database over the baseline.
Generation 2's `plan-fix` correctly re-justified repeating the same `hold-buffer` action "by
measurement, not habit," citing the retained generation's own delta rather than habit. Generation
2's own XTop and Innovus ECO both succeeded again, but `compare-and-retain` then failed with
`[Errno 17] File exists` on a foundation-library LEF symlink inside `best.enc.dat/libs/lef/` — a
fifth, distinct boundary defect. `copy_database_alias` used
`shutil.copytree(..., symlinks=True, dirs_exist_ok=True)` once `best.enc.dat` already existed;
`dirs_exist_ok` lets `copytree` reuse the destination *directory*, but for each *symlink* entry it
still calls `os.symlink(target, dst)` directly, which raises `FileExistsError` when `dst` is
already there. Generation 1's retention succeeded only because `best.enc.dat` did not exist yet,
so every symlink creation was a fresh one; retention was never actually idempotent, and the second
generation ever retained was the first one to expose it. Version 1.0.5 makes `copy_database_alias`
`shutil.rmtree` the existing `best.enc.dat` before an unconditional `copytree`, verified against a
red test with two generations sharing a real symlinked LEF file across both retained databases.
HimaGuide also flagged two related, unfixed graph-level observations worth the improver's
attention: the evidence-gate's rule order may let `hold-clean` never influence routing while
`goal-met` keys only off setup, and `compare-and-retain` (an `act` node) has no declared failure
route to a Wait node, so a mechanical failure there can only ever leave the Run `retrying` rather
than recording a proper `blocked` outcome. The Trial 29 Run was cancelled at `compare-and-retain`
as BLOCKED evidence rather than hot-patched, with its first generation's real success intact in the
Ledger.

Version 1.0.5 also adopts the Site owner's route-preservation requirement. The previous XTop
`-write_atomic_cmd` mode emitted a `FORMATVERSION 2` logical file for `loadECO` and a physical Tcl
that called `dbNetFreeWires`/`editDelete -net`; XTop's reference manual says atomic output removes
the original routes of touched nets, while macro output keeps routing topology. The Pack now asks
for INNOVUS macro commands with `-keep_route`, rejects FORMATVERSION/loadECO material and
route-destructive physical commands, and sources the logical then physical Tcl before `ecoRoute`.
The next Campaign must verify both scripts on the real tool, touched-net route retention,
connectivity/DRC and refreshed STA; this record does not pre-claim those results.

## Reviews

The method preserves one visible Campaign owner and one persistent Run. AI controls the next
bounded fix hypothesis; deterministic code controls identity, command whitelist, evidence parsing,
comparison and database selection. Runtime remains domain-neutral. The source Foundation Flow is
read-only and all licensed work lands in the Campaign workspace.
