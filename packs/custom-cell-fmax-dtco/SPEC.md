## Goal template

`target_period_ns`: number, ns, min 0.1, max 5, default 0.5. It binds clock-period-at-most.
The fixed Goal is reached only if the full-evidence constraint also PASSes on the same generation.
The final comparison reports a clearly labelled STA-derived Fmax for each arm from the same
requested clock and setup slack reread after restoring that arm's final route database.

## Constraints

The nested probe uses `reg2reg-pressure-at-least-100ps` on an explicit reg2reg-only synthesis report.
It passes only when WNS is `-0.1 ns` or worse, so the probe cannot relax toward timing closure. The final
outer Judge uses comparison-evidence-valid: both restored final databases must be identity-matched,
the generated library live, a generated master physically present, and timing/census verification
complete. `fmax-improved` is a separate gate. Setup, hold, route-DRC, connectivity and Innovus
cell-checker diagnostics remain explicit findings; they limit physical-signoff scope but do not erase
an apple-to-apple Fmax comparison. Missing facts are unknown and cannot yield a valid comparison.
Tool errors or absent mandatory prerequisites stop downstream execution; rejected generated DBs
are never used. P&R/verification options and actual input/report identities are held in stage records.

## Run contract

Site inputs are the declared design root/RTL/top, constraints, library and physical profiles,
workspace, and current tool stack. contract.yml is the executable list of every tool, output,
reader, Workshop and workspace copy. The Pack-sourced `bind-inputs` node validates these Site
bindings and writes this Campaign's private `flow/inputs.json`; missing values are refused. Tools invoke the one stages.py adapter
with a fixed stage name, WORKSPACE and optional fixed route. Probe and both matched syntheses accept
PERIOD_NS. The matched P&R tools bind one Strategy floorplanUtilization fraction (0.2..0.8, formal
default 0.25, twice the former core area), freeze the foundry arm's placed IO plan, and replay its
exact pin locations and core box in the generated arm. Both DC arms apply 50% clock uncertainty and
give the explicit reg2reg path group priority over I/O groups;
their emitted P&R SDCs apply 25%. The validated physical-profile `PLACE_SITE` enters both init TCL files. The profile
also declares the tap/filler assumptions used by both arms; a Pack does not invent a row site or
technology cell names. The standalone adapter preserves 0.60 only when a human omits it.
Wrappers: /usr/bin/python3. DC, LC and Innovus tools declare one corresponding licence per Job.
The Site declares a bounded Job cap; each EDA tool still uses one licensed Job at a time. The same
owner requests all branch work.

Probe outputs: flow/probe.json plus hashed trial artifacts. Route outputs: flow/mining/ROUTE/raw.json,
research.json, selected.json and flow/records/mine-ROUTE.json. The single AI research output is
flow/research/research.json. Other records: flow/records/STAGE.json; merged requests
at flow/mining/merged.json. Immutable stage attempts and their artifacts are kept under
flow/artifacts/STAGE/run-UUID. Readers verify retained references before deriving observations.
Strategy algorithmRevision tracks discovery-algorithm revisions. Required tool/dependency identities and
predicted/synthetic/site evidence classes are carried with the results, never collapsed into PPA.

## Semantics

The probe retains clock_period, setup_wns (setup/all) and cell_area. The final compare reader uses
clock_period and setup_wns reread from each restored final route database. Other typed counts in semantics.yml
record candidates, research hypotheses, generation, layout admission/refusal, prediction, LC, visibility/adoption, P&R, verification and
matched/full-constraint status. foundry_setup_wns and setup_wns_delta are ns from the matched report
pair. The foundry/generated `*_fmax_mhz` values are STA-derived as `1000 / (clock_period - setup_wns)`
from that matched pair; `fmax_improved` must be true. The held final route database, its report hashes,
library visibility, positive adoption, and matched conditions are the Fmax evidence chain. A null reading carries its unknownReason; no numeric
default supplies a missing observation.

Each arm's PnR reader exposes retained-report hold WNS, hold violating paths, route DRC and
connectivity counts. Power, gate-count and route-summary reports are retained as raw evidence.
Their vendor-specific values remain unclaimed until a verified reader is added; absence is never
represented as zero. These secondary facts do not decide the Fmax goal.

## Judge rules

Nested probe: reg2reg-pressure-at-least-100ps, then clock-period-at-most bound to target_period_ns.
Before P&R, custom-cell-adopted requires at least one generated master in the custom synthesis netlist.
Outer final-judge: comparison-evidence-valid, fmax-improved, then clock-period-at-most bound to the same fixed Goal.
The first rule chooses the edge; both current verdicts are needed for explicit Goal met.

## Choosers

The nested probe uses `maintain-reg2reg-pressure`, bound to `pressureMagnitudeNs=0.1`. If pressure is too
light, it tightens the next requested period by the measured pressure shortfall; it never relaxes a
violating 0.5 ns trial toward closure. Its arithmetic is a next-trial hypothesis. Outer research-next suggests a selection revision after a
known constraint or Goal failure. The owner must cite actual current observations/verdicts.
It cannot alter the Goal, remove a gate or treat an incomplete previous attempt as usable evidence.

## Endings

Goal met: only next-research, with current outer comparison-evidence-valid, fmax-improved and clock-period-at-most PASS.
Converged: explicit current evidence supports no further useful change within the declared converge
rule; it is not a physical-success claim. Budget exhausted: graph/Run generation or time limits;
retain partial work and explain what was not established. Hard blocker: failed mandatory tool/reader,
missing input, refused library or UNDETERMINED Judge; blocked wait retains the cause and continuation
context. Nested probe goal-met/converged/generation-limit all continue to mining and cannot terminate
full-flow success. There is no successful terminal leaf after an earlier inner decision.

## Workshops

One `research-candidates` Workshop uses the existing owned Coding interface after all six mechanical
evidence routes converge. It reads their compact views and complete hash-bound sources, the current
probe and method knowledge. `researchTemplate` keeps the model-authored file small enough for the
configured model: the owner implements `research(candidates, context)`, while
`ai_research_runner.py` owns I/O, provenance, budgets and reader validation. The function must form
at least three evidence-linked hypotheses and choose a cross-route finite screen without embedded
candidate ids. Actual launch hashes and CodeRecords prove what executed. No helper invokes a model;
generation, synthesis and physical stages remain ordinary tool Jobs.

## Knowledge

The two declared knowledge files explain measured versus predicted/proxy evidence and route selection.
Read provenance and code materials are available in the same conversation/Run screen via PLS-24.
Existing report/export, continuation and Pack experience archive are the audit and knowledge entry
points; failed hypotheses and algorithms are assets with their conditions, not new reference methods.

### Bounded additional research

At next-research, the owner may declare an additional evidence review before concluding: record its input identities, affected decisions, required outputs, ending and return node. Preserve reference nodes and prior results; read the existing comparison and independently Judge it without repeating P&R merely to exercise the feature. Such a re-read is a consistency check, not a new physical experiment. Other growth locations remain undeclared.

The shared Campaign pool allows at most 120 act attempts, declares a two-hour wall box for the
50-Cell method, and reserves the final 60 seconds inside that box for analysis and deterministic
closing. Packs that do not declare `timeBoxMs` retain the Harness 60-minute default. Budget expiry
stops Campaign work and new analysis writes while conversation can continue.
