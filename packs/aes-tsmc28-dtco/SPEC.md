## Goal template

`target_period_ns`: number, ns, min 0.1, max 5, default 0.5. It binds clock-period-at-most.
The fixed Goal is reached only if the full-evidence constraint also PASSes on the same generation.
The reported period is the generated arm's actual post-route clock, not an inferred closed Fmax.

## Constraints

The nested probe uses setup-wns-all-nonnegative on synthesis evidence only. The final outer Judge
uses full-evidence-valid: full_constraint_failures must be zero. Complete matched physical inputs,
actual library visibility and positive adoption, nonnegative generated setup WNS and both declared
verification gates are necessary. Missing facts are unknown and cannot yield a zero count.
Tool errors or absent mandatory prerequisites stop downstream execution; rejected generated DBs
are never used. P&R/verification options and actual input/report identities are held in stage records.

## Run contract

Site inputs: flowRoot, design and workspaceRoot. contract.yml is the executable list of every tool,
output, reader, Workshop and workspace copy. Site-private flow/inputs.json supplies explicit tool,
PDK, model and constraint bindings; missing values are refused. Tools invoke the one stages.py adapter
with a fixed stage name, WORKSPACE and optional fixed route. Only the probe accepts PERIOD_NS.
Wrappers: /usr/bin/python3. DC, LC and Innovus tools declare one corresponding licence per Job.
The Site cap admits one licensed Job at a time; the same owner requests all branch work.

Probe outputs: flow/probe.json plus hashed trial artifacts. Route outputs: flow/mining/ROUTE/raw.json,
selected.json and flow/records/mine-ROUTE.json. Other records: flow/records/STAGE.json; merged requests
at flow/mining/merged.json. Immutable stage attempts and their artifacts are kept under
flow/artifacts/STAGE/run-UUID. Readers verify retained references before deriving observations.
Strategy algorithmRevision tracks selection revisions. Required tool/dependency identities and
predicted/synthetic/site evidence classes are carried with the results, never collapsed into PPA.

## Semantics

The probe retains clock_period, setup_wns (setup/all) and cell_area. The final compare reader uses
clock_period and setup_wns for actual generated post-route timing. Other typed counts in semantics.yml
record candidates, generation/layout/prediction, LC, visibility/adoption, P&R, verification and
matched/full-constraint status. foundry_setup_wns and setup_wns_delta are ns from the matched report
pair. A null reading carries its unknownReason; no numeric default supplies a missing observation.

## Judge rules

Nested probe: setup-wns-all-nonnegative, then clock-period-at-most bound to target_period_ns.
Outer final-judge: full-evidence-valid, then clock-period-at-most bound to the same fixed Goal.
The first rule chooses the edge; both current verdicts are needed for explicit Goal met.

## Choosers

The nested probe retains over-constraining-push with 0.01 ns step and bounded convergence; its
arithmetic is a next-trial hypothesis. Outer research-next suggests a selection revision after a
known constraint or Goal failure. The owner must cite actual current observations/verdicts.
It cannot alter the Goal, remove a gate or treat an incomplete previous attempt as usable evidence.

## Endings

Goal met: only next-research, with current outer full-evidence-valid and clock-period-at-most PASS.
Converged: explicit current evidence supports no further useful change within the declared converge
rule; it is not a physical-success claim. Budget exhausted: graph/Run generation or time limits;
retain partial work and explain what was not established. Hard blocker: failed mandatory tool/reader,
missing input, refused library or UNDETERMINED Judge; blocked wait retains the cause and continuation
context. Nested probe goal-met/converged/generation-limit all continue to mining and cannot terminate
full-flow success. There is no successful terminal leaf after an earlier inner decision.

## Workshops

Six select-ROUTE Workshops use the existing owned Coding interface. Each declares only its route raw
report and miner record as reads, full-mining-method.md as knowledge, and selected.json as output.
argv: /usr/bin/python3 ENTRY WORKSPACE ROUTE REVISION. selectionTemplate supplies fixed I/O and
pre-exit reader validation; the owner implements choose() using actual candidate evidence. Actual
launch hashes and CodeRecords prove what executed. Readers and merge validate its result independently.
No helper invokes a model. Mechanical generation/synthesis/physical stages stay ordinary tool Jobs.

## Knowledge

The two declared knowledge files explain measured versus predicted/proxy evidence and route selection.
Read provenance and code materials are available in the same conversation/Run screen via PLS-24.
Existing report/export, continuation and Pack experience archive are the audit and knowledge entry
points; failed hypotheses and algorithms are assets with their conditions, not new reference methods.
