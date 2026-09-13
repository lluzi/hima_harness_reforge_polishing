# PLS-25 AES full-mining handoff

Status: implementation and bounded Site bring-up in progress. PLS-25 / #28 remains open;
no v3 release or full physical-performance acceptance is claimed at this checkpoint.
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
