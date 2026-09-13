# PLS-25 AES full-mining handoff

Status: PLS-25 engineering acceptance is complete. Version 3 was sealed through the native
release tool and independently checked against the current source. The bounded real result is
negative: no adoption, no setup closure, and nonzero checker-reported geometry entries.
This is not full physical-performance acceptance; PLS-18 remains future work.
PLS-23, PLS-08, PLS-09 and PLS-24 are closed, with their separate probe/research handoffs retained.

## Method and execution boundaries

The compiled `aes-tsmc28-dtco` v3 method embeds the earlier foundry probe, six mining/selection
branches under one conversational owner, a merge Judge, generated cells and library gate,
paired synthesis/P&R, independent verification/comparison and a bounded research revisit.
Business algorithms and format readers remain in the Pack. The only graph-admission extension
requires a fresh unbranched observation and a subsequent non-join Judge before a downstream
Explore; revisits cannot borrow evidence from the previous generation. Actual Host execution
continues to require the owner's next request for each business node.

The native `hima_execute` model-text renderer now omits repeated whole-contract/control history.
Its structured result is unchanged, including all data consumed by the desktop/API. Workshop
execution still requires the actual entry in argv[1]; no wrapper-runner exception was introduced.

## Actual six-route selection

The production miners consumed the retained real AES probe netlist
`587ed9678eb8135c5fe4052e771c39eaa962cdc174d1877ca4c4b02881a29f31`.
Each of timing criticality, timing context, structure frequency, structure compaction,
mapper compatibility and functional diversity produced eight candidates. The existing enumerator
identity is `0b61ec5ce0a263ad1c761be546b9f024860a3f77cfc9e1067468075d261829b1`.
The six actual mining invocations took 239.243 seconds including SSH/record retrieval; they reused
the valid probe inputs and launched no additional synthesis. See `pls25-mining-site/`.

DeepSeek V4 Flash then authored a route-aware selector in the same native owner session.
Actual selection Run: `run-9c71f6e2-1492-466d-8b4b-2b6aced68141`.
Actual owner: `session-555a3fc1-ca18-4145-8e95-a77486e36322`.
The executed algorithm is [retained here](aes-mining-selection-closure/3b8befdd3b4467bdeeee9d31d572f2f1e9aa074b42acdea858681bdb59a5a3c6.py),
SHA256 `3b8befdd3b4467bdeeee9d31d572f2f1e9aa074b42acdea858681bdb59a5a3c6`.
It ranks candidates using available impact, rank, support/coverage and function diversity.
It is a heuristic, with no optimality or measured PPA claim. Existing enumeration and I/O scaffolding
are engineering inputs; the model's contribution is the `choose()` algorithm, not those inputs.

All six actual entry launches match CodeRecords and their hashes. Six independent readers each
accepted two selections and twelve selection verdicts passed. This was an explicitly derived
finite selection slice, not the complete physical Campaign or a released substitute Pack.
Its `ended-goal-not-met` ending makes no claim about the physical method's Goal.

The original `aes-mining-selection-4/evidence.json.gz` remains **failed**: its driver exceeded the
15-minute deadline while waiting for the model's final response after the business Run had ended.
It used 89 model request steps. A separate fresh-Host audit of the already-completed Run passed,
with zero model requests and zero new research/EDA Jobs; see
[audit evidence](aes-mining-selection-closure/evidence.json). Compression preserves original bytes;
`evidence-encoding.json` identifies their SHA and the private original is retained.

The independent [subset audit](aes-mining-selection-closure/holdout.json) reproduces all original
selections, then withholds one chosen candidate from each route. The unchanged actual program
selects valid remaining candidates in all six seven-candidate subsets. Exact generator contracts
pass, and AST comparison confirms only `choose()` differs from the template. This establishes
finite input dependence and valid output, not optimality, unseen-design generalization or Fmax gain.

Earlier attempts remain failures: attempts 1/2 failed preflight before model use; attempt 3 used
80 model requests and failed to produce accepted selection observations (diagnostic-only code and
extra JSON fields). These are execution/interface failures, not proof the candidate strategies are
bad. The resulting fixes provide compact source-hashed research views and an exact I/O template.
The full raw miner data remains the actual program and reader authority.

## Physical tool bring-up checkpoint

The actual twelve selected candidates merge into five unique Boolean/profile classes (seven
removed duplicates), capped at two builds. Both cells have real bool2cmos SPICE and abstract
layout outputs. Characterization is a learned-model prediction, **not measured/SPICE signoff**;
abstract geometry is not tapeout qualification. The layout profile is explicitly unqualified for VT.

Library Compiler X-2025.06 returned 139 on the generated library and also on unchanged foundry
Liberty. Those failed records/DBs were never admitted. Exit-only startup worked, while multiple
bounded read/check/write probes failed; removing LD_LIBRARY_PATH did not fix the failure.
A vendor-container attempt lacked its required `.snps_container` configuration. These observations
do not identify a proven root cause; see byte-preserved `pls25-site-diagnostics/`.

The user restored T-2022.03 at `/data/eda/software/eda_tools/synopsys/lc/T-2022.03` and made it the
Site default without restarting the container. We independently passed the current generated
library through the production LC gate in 11.932 seconds (`compile-1789290006651971000`).
Root did not perform the user's vendor installation or global environment change.

An initial custom synthesis exposed a query bug: `get_lib_cells XS_*` returned zero whereas the
qualified `get_lib_cells */XS_*` returned two actual generated masters. The Pack now uses qualified
queries and `sizeof_collection` in DC and Innovus. Both synthesis arms must be freshly accepted
with complete common-condition identities before comparison. Input hashes, actual version logs,
wrapper bytes and shared scripts are reconstructed independently; generated arm additions are
explicitly separated. A subsequent real DC run exited zero but its indented version header was
rejected by the parser. That original failure is retained while the parser is corrected.

Current corrected-pair workspace:
`/data/eda/project/hima_harness/polishing-runs/dtco-conditions-1789292824885438000`.
Earlier attempts and unaffected upstream cell artifacts remain preserved in their own directories.
Actual Innovus 23.14 bootstrap established command availability only; design P&R, exported active
SDC and final geometry/paired comparison remain pending at this checkpoint. No synthetic, predicted,
synthesis-only or bootstrap result is presented as measured post-route Fmax improvement.

## Local and desktop verification

Raw logs are compressed losslessly in `pls25-final-local/` with byte hashes in its index.
The full local suite ran once: **405 passed, 2 failed of 407**, no skips, 1308.068 seconds;
47 Host processes and 362 in-process Hosts, zero Electron/SSH. The two stale assertions expected
an exactly compiled Pack (now released) and Ledger schema 20 (now 21). After updating those
expectations, the affected files passed **13/13**, 23.246 seconds, nine in-process Hosts.
The latest common-condition/domain/full-graph delta passed **10/10**, 80.068 seconds, one Host.
We did not rerun or relabel the original whole-suite result as 407/407.

The opt-in full-graph test capture retains the same actual local Run and synthetic external fixture
for native TEST/release. It adds no second research Run. All 78 contract files are assigned to exactly
one resource group. Type checking passed after the UI details update.

Desktop inspection used completed real selection evidence and launched no EDA/model jobs. The first
pass took 17.512 seconds; compact material rows plus visible-code verification passed in 15.328
seconds, one Electron each. Full paths, source session and SHA remain available in selected details
and tooltips. See [inspected screenshot](aes-mining-desktop-polished/aes-probe-light.png).
The unified chat/material test passed in 17.459 seconds with its required test-only legacy-auto
fixture environment. An earlier invocation without that environment failed before the material UI;
its original log is retained separately. No costly desktop run replaces the local failure matrix.

## Remaining acceptance

Complete corrected paired tool bring-up and independent readers, create truthful native TEST and
release v3, verify final source/release identity, then update #28. Full research conclusions and the
second knowledge-use Campaign remain PLS-18 and its dependencies, not this bounded L4 bring-up.

## Review delta: complete input constraints and real zero adoption

The indented DC header correction passed 8/8 focused cases, the exact retained Site log parse,
and another 1/1 full-graph Host run (75.217 seconds). Two earlier test selections omitted the
required full repository-relative filename and failed preflight before starting a Host; those
logs are retained. A further review found that equal clocks alone did not establish equal P&R
input constraints. The producer and independent reader now compare complete synthesis-output SDC
bytes after normalizing exactly the observed `# Created by write_sdc on ...` comment. The
same-clock/different-input-delay counterexample fails matching; this delta passed 8/8 focused
cases. Actual accepted Site SDCs have equal canonical SHA
`2b34257c010c06292b920a97795fc169f626db19c4ad5db8cd313762a7d12d77`.
No semantic constraint is removed by this canonicalization.

Both actual synthesis arms now pass: foundry 84.613 seconds; custom 81.911 seconds. The custom
DC session saw both generated masters, but the independent instance-to-master projection reports
**zero adopted generated instances** among 10,017 instances and 151 reference types. This proves
zero adoption for these two offered candidates under these settings, not a cause, an Fmax gain
or a general verdict on the six search strategies. Target/link library injection is present in
the recorded Tcl; nothing forces adoption merely to make a check green. Raw stage receipts and
tool logs, including rejected earlier attempts, are held in `pls25-physical-site/`.

P&R begins from these accepted artifacts in isolated workspace
`/data/eda/project/hima_harness/polishing-runs/dtco-sdc-1789294144262648000`; the SDC comparison
change does not rerun unchanged synthesis. The selected-material row also now uses the existing
secondary-fill theme token, fixing the review's dark-theme contrast concern.

The final SDC identity full-graph test passed 1/1 in 75.350 seconds (one Host, no model/EDA).
The first real P&R attempt then stopped after placement at clock-tree optimization: Innovus
reported IMPCCOPT-2440, requiring `clock_opt_design` for the PODv2 database produced by its
`place_opt_design`. Exit code zero was correctly rejected because of tool error lines. The
124.993-second failed attempt is retained (`pnr-foundry-1789294145060443000`); this is an
unsupported-command compatibility failure, not an accepted routed result. The common template
needs the current tool's supported clock optimization command before another attempt.

With `clock_opt_design`, Innovus completed actual routing, GDS export and activity SDC output
with zero error lines in 386.460 seconds, but the adapter rejected the stage because
`postroute.enc.dat` is a directory, not the single-file fixture used previously. Its rejected
record is preserved (`pnr-foundry-1789294495638669000`). Format calibration also established
that `post.summary.gz` is compressed and has no embedded view line; the companion
`post_all.tarpt.gz` records the actual analysis view. The retained unadmitted outputs are under
`pls25-physical-site/unadmitted-pnr-output/`. They are calibration evidence, not an accepted
physical comparison. The actual active SDC parses to 0.5 ns. No result has been resealed.

Checkpoint/gzip calibration `4be1cc4` passed 9/9 focused cases, type checking and actual retained
report parsing. A scoped independent review found no Standards/Spec issues in that delta.
The full Host fixture initially stopped before Host boot because its import marker had not
followed the new gzip import; aligning the fixture retained the production behavior and passed
1/1 (`final-checkpoint-host-aligned.tap`). A new real init attempt then stopped in 20.776 seconds
because Innovus links checkpoint libraries to declared Site inputs (LEF, Liberty, QRC and SDC).
The strict all-symlink rejection therefore needs a narrowly bound linked-input contract. The
rejected record `pnr-foundry-1789295447091904000` is retained; routing was not launched.

## Final v3 acceptance and negative-result asset

Method digest: `54dced57bbf26eff2d3ff5f832bb4a07ebe39ac5b8bdac44434015650ec438ed`.
The native TEST/release uses original local Run `run-8d564e1f-b71e-495f-a3b3-9b3886558dde`,
which explicitly labels its external boundaries synthetic. Its full graph passed 1/1 in 61.197
seconds, one Host, zero model/EDA/SSH/Electron calls. A fresh native Host sealed the unchanged
method with zero model requests and no new business Jobs; its duration was not separately timed.
See `aes-full-method-release/` for exact TEST, VERSION, release receipt and original local Run.
The local fixture's `ended-goal-met` is not the real Site trial's result.

All twelve downstream production-stage readers independently accepted the actual held Site
records and derived non-null values. See [reader audit](pls25-physical-site/readers.json),
[raw reports and stage index](pls25-physical-site/index.json), and
[checker breakdown](pls25-physical-site/verification-breakdown.json). These were finite
standalone bring-up calls, not an invented full native Site Campaign.

| Observation | Foundry arm | Generated-library arm |
| --- | ---: | ---: |
| Asked and active clock period | 0.5 ns | 0.5 ns |
| Actual post-route setup/all WNS | −0.015 ns | −0.015 ns |
| Generated masters visible in synthesis/P&R | 0 (expected) | 2 |
| Adopted generated instances | not applicable | 0 |
| Cell-mode checker-reported entries | 35,540 | 37,019 |

Declared common conditions match, with P&R condition identity
`c8a42fe054922162b3d6de8ccc632ab93a989c2989374680cafcf66a9935fe3c`.
The measured WNS delta is 0.000 ns; it is not a measured Fmax gain. The independent comparison
returns `full_constraint_failures=3`: setup did not close, no generated cell was adopted, and
the declared geometry check reported violations. Its `eq 0` final validity rule therefore cannot
pass. No real Goal-met verdict or full native Site ending is fabricated.

Successful tool timings: foundry P&R 393.219 seconds, generated P&R 419.445 seconds; two fresh
verification sessions together 54.275 seconds; final comparison 1.309 seconds. The physical
bring-up index retains 20 stage invocations including failed/superseded attempts, totaling
2,244.493 seconds including wrapper/SSH overhead; the six original mining invocations are
separately retained and total 239.243 seconds. Additional version/library diagnostics have their
own retained commands and logs. Stage success means the command/evidence contract completed;
it does not mean its scientific constraints or geometry check passed.

Both P&R arms ran code snapshot `0d8dd24a160e...`. The final comparison/reader snapshot
`b5c6e3c2389e...` adds only the setup-violation-count validity check and keeps the same physical
method. It executes from a fresh immutable staged-code directory against the original accepted
workspace, preserving checkpoint link targets and reusing the raw results without rerouting.
Every receipt names its actual argv/code snapshot. Large DB/GDS and licensed inputs stay on the
Site with hashes; checkpoint manifests, relevant raw reports, algorithms and evidence are retained
here. Both prior snapshots and every failed record remain intact.

### What this failure teaches, and what remains a hypothesis

The library was accepted and seen by DC and Innovus, so invisibility is ruled out for these two
offered cells in this trial. The exact netlist-to-master projection proves they were not adopted.
It does not identify why: mapping eligibility, estimated cell cost/timing and the relationship
between mined opportunities and the validation constraints need separate experiments. More
physical runs alone would not distinguish these hypotheses.

The foundry-only arm already reports 35,540 cell-mode checker entries. 21,297 of those refer to
two objects on the same instance; the principal categories are SHORT, minimum area and via
enclosure. The generated arm shows the same dominant categories and zero adopted generated
cells. These are checker-reported entries, not established manufacturing defects. Before drawing
geometry or algorithm conclusions, PLS-18 should establish a known-good baseline interpretation
of the technology LEF, cell abstracts and checker mode. No automatic waiver or classification of
these entries as harmless has been made. Neither report reached the configured 1,000,000-entry
limit or indicated truncation.

This bounded trial therefore does not establish that the campaign premise is wrong or that the
six search strategies are generally ineffective. It provides reproducible negative evidence and
a concrete next validation order: calibrate the baseline geometry check, investigate mapping of
the admitted candidate cells, then spend a larger budget on measured performance exploration.
The layout VT profile remains unqualified and Liberty characterization remains a learned-model
prediction. Full pilot/second knowledge use remains PLS-18 and its dependencies.
