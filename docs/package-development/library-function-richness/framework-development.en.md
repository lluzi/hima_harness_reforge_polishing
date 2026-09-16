# Library Function Richness Optimization Framework Development Document

Status: in development

Development target: the `packs/custom-cell-fmax-dtco` HimaPack

Tracking identifiers: `LFR-FW-*` and `LFR-PACK-*`, separate from the Product Upgrade v2 PLS line

GitHub tracker: [Issue #40](https://github.com/lluzi/hima_harness_reforge_polishing/issues/40)

Chinese counterpart: [framework-development.zh-CN.md](framework-development.zh-CN.md)

## 1. Purpose and completion standard

This document specifies how to build the Library Function Richness Optimization Framework as an
independently verified method implementation and then integrate that same implementation into the
`custom-cell-fmax-dtco` HimaPack. Development has two phases:

1. **Framework construction.** The team builds the mapping proxy, timing proxy, influence graph,
   candidate portfolio, cumulative Library, calibration, optimization loop and assessment. This
   phase does not depend on HimaFabric orchestration and does not launch LC, DC or Innovus search.
2. **HimaPack development.** Only after the Framework passes its assessment is it exposed through
   the HimaPack files, contract, Readers, Judge, Workshop, test Run and release seal.

Completion means more than “the algorithm exists” or “the Pack starts.” All of the following must
hold:

- the Framework accounts for its inputs, metric definitions, applicability and stopping reason;
- frequent optimization uses license-free tools; commercial EDA observes real design QoR and is
  not the frequent trial engine;
- old Cells and deliverables are reused by hash and are not regenerated in later rounds;
- the AI changes its research algorithm from current evidence, while deterministic code owns
  identity, calculations, budgets and evidence;
- the HimaPack works for different designs, Sites and compatible tool versions that satisfy its
  contract, without carrying an AES answer;
- `/hima pack check`, a test Campaign, `TEST.md` and the Harness-generated `VERSION.yml` together
  establish that the Pack is deliverable.

## 2. Background and known failures

The existing Pack has demonstrated a technical chain from input binding, candidate Boolean
identity, Cell generation, layout, predicted characterization, Library Compiler and DC adoption to
Innovus route and matched comparison. It has not demonstrated a competitive research method:

- DC adopted 21 of 47 Cells as 307 synthesis instances, and route retained 250 custom instances,
  but matched Fmax improved only about 0.193%;
- after APR pressure and DCCK CTS were corrected, route retained 222 custom instances and matched
  Fmax fell by about 0.179%;
- the current generations rebuild old Cells and use DC/APR as frequent screens, which is expensive
  and does not explain where benefit appears or disappears;
- adoption count, one path and an ideal cone-removal bound do not predict final Fmax.

This work therefore asks a different question: before real EDA, how can the target design's logic
graph, a cumulative Library, Yosys/ABC mapping and proxy STA establish a repeatable, layered metric
system and continuously add Library functions that effectively transform logic structure?

The 5% target is a commercial-design objective and only a matched commercial flow can judge it. The
open-source evaluator does not forecast that 5% or its route delta in ps. It measures Boolean
feasibility; local levels, nodes, edges, cuts, reconvergence and domination; whole-design mapping,
depth, buffer/inverter pressure and fanout/load; proxy-STA frontier indicators; and Library cost.
Commercial results characterize how those indicators relate to real QoR on the observed design;
they do not train the proxy to imitate commercial EDA numerically.

## 3. Scope and architectural constraints

### 3.1 Included

- reproducible Yosys/ABC technology mapping;
- proxy STA over a mapped netlist and full Liberty;
- a reg2reg timing-influence graph built from RTL, mapped netlists and retained route evidence;
- K-cut, dominator, reconvergence, repeated-cone, path-family and fanout/load analysis;
- layered function, local-subgraph, whole-design mapping and proxy-STA evaluation;
- one reference/augmented batch mapping and a small amount of bounded ablation;
- append-only immutable Library shards and a cumulative manifest;
- AI-led residual-problem research with deterministic independent recomputation;
- Framework assessment, HimaPack integration, a test Campaign and release evidence.

### 3.2 Excluded

- a new Hima Runtime, second Fabric, second asset service or hidden Agent;
- commercial EDA trials per Cell, per method or per proxy round;
- making AES, TSMC28 paths or the current Site command a Pack invariant;
- automatically promoting customer results into Pack method knowledge;
- writing `comparison_valid`, final Fmax or physical adoption from a proxy;
- creating PLS-36 through PLS-38 or mixing this track's completion into the PLS line.

### 3.3 Code-location rule

Phase 1 code lives directly under the Pack's `flow/` and `flow/domain/`, but it is not wired into
`graph.yml` before the assessment passes. Phase 2 exposes the same implementation and does not copy
another algorithm. One Pack-internal `flow/domain/proxy_mapping.py` is justified because no current
module owns Yosys/ABC commands, logs and mapped-netlist parsing; it is not a new product component.
All other capabilities should deepen existing modules first.

`flow/` is the source copied into the Campaign workspace. The entry files currently duplicated in
`tools/` must remain byte-identical after edits unless the Pack loader/publishing convention is
first proven and changed. Duplication alone is not permission to remove them.

## 4. One external Framework interface

The Framework presents one deep interface: a hash-bound request produces a hash-bound evaluation.
The HimaPack stage, standalone CLI and tests all use that interface and do not assemble internal
commands themselves.

Proposed Python interface:

```python
evaluate_round(request: Mapping[str, object]) -> Mapping[str, object]
```

The CLI only performs JSON I/O:

```text
python3 flow/library_richness.py --request REQUEST.json --output EVALUATION.json
```

The request contains at least:

- the RTL file list, top, constraint summary and hashes;
- the foundry Liberty and cumulative custom-Library manifest;
- this round's candidate delta;
- Yosys, ABC and proxy-STA identities and a fixed profile;
- the target reg2reg period, metric priorities and Library/round budgets;
- optional historical DC/Innovus comparison evidence with design, conditions and applicability.

The evaluation contains at least:

- hashes of the request, scripts, tools, Library shards and outputs;
- reference and augmented mapped netlists;
- mapping adoption, instances, function classes and critical-graph coverage;
- function feasibility plus local changes in levels, nodes, edges, cut width, reconvergence and
  domination;
- whole-design mapping adoption, instances, logic-depth distribution, buffer/inverter pressure,
  fanout/load and overlap;
- reference/augmented proxy-STA frontiers, negative-slack mass and path migration, explicitly as
  indicators;
- complete metric vectors and two-arm `pairwise_relation` values under optimistic, nominal and conservative
  slew/load scenarios;
- the residual graph, unadopted candidates and reasons, and the next research question;
- metric completeness, two-arm relations and recomputable convergence/stopping reasons;
  only the FW-07 portfolio may establish a cross-candidate, cross-round Pareto frontier.

An evaluation is always structural grading and screening evidence; it does not predict commercial
benefit. Only the existing commercial `compare` Reader/Judge may produce final design-QoR facts
from held databases and reports.

## 5. Component-level development requirements

### 5.1 Yosys/ABC mapping adapter

**Location:** add `flow/domain/proxy_mapping.py`; put the thin CLI in
`flow/library_richness.py`; `flow/stages.py` becomes the eventual tool caller.

Required work:

1. Pin the Yosys/ABC commits, build flags, executable hashes, container digest and complete command
   line. The current `iic-osic-celluzi:2026.06` image is a compatibility POC, not an automatic
   product baseline.
2. Read an explicit RTL list with `read_verilog -sv`, run `hierarchy -check -top`, use a fixed and
   deterministic process/opt/memory/techmap sequence, then `dfflibmap` and `abc -liberty`. Working
   directory globs must not silently expand the RTL input.
3. Reference and augmented mappings use the same script, top, constraints, ABC profile and
   randomness settings. Only the Library set and output paths differ.
4. Supply consistent driving-cell, load and delay targets through an ABC constraint file. Record
   SDC constructs that cannot be expressed in `unsupported_constraints`; never ignore them silently.
5. Retain the complete log, ABC script, mapped Verilog, `stat -liberty`, Cell census and return code.
6. Record adoption separately by NPN function class, pin interface and drive variant. A different
   drive is a physical choice within one function class, not automatically a new Boolean function.
7. Return a structured failure for every mapping failure; never substitute an empty netlist or zero
   delay.

This adapter answers how this mapper implements logic under the current Library. It does not answer
post-route Fmax.

### 5.2 Proxy STA

**Location:** deepen `flow/domain/cell_need_miner/liberty_timing.py` first and reuse
`flow/domain/verilog_netlist.py`. Add an external OpenSTA adapter only if the POC proves the current
parser cannot reliably perform mapped-netlist STA.

Required work:

1. Parse full Liberty timing arcs, timing sense, related pins, 7 by 7 NLDM indexes/tables and pin
   capacitance.
2. Read sequential boundaries, combinational arcs, net fanout and load from the mapped netlist.
3. Perform bounded two-dimensional NLDM interpolation at the current input slew and output load;
   record every clamp or extrapolation outside the table.
4. Propagate arrival, required time, slack and slew within reg2reg scope while retaining endpoint
   families.
5. Report the cell, removable buffer/net, estimated wire/boundary penalty and unknown terms for each
   frontier path.
6. Use identical clock, I/O exclusion, load and uncertainty assumptions for reference and augmented
   timing.
7. Fail closed on a combinational loop, missing arc, unknown sequential Cell or multi-clock
   ambiguity.

If OpenSTA is selected, call it only as a Pack-internal external tool, pin its commit/version/hash,
and retain TCL, logs and reports. It is not linked into the product process and does not become a
Hima Runtime component.

### 5.3 Timing-influence graph

**Location:** deepen `_mapped_graph`, `_arrivals`, `_required`, `_dominators`,
`rank_critical_subgraph` and `parse_reg2reg_timing_graph` in `mine_timing_route.py`; reuse `aig.py`,
`cuts.py`, `npn.py` and `verilog_netlist.py`.

Every subgraph retains an explainable vector: worst-endpoint relief, negative-slack-mass coverage,
path-family coverage, dominator/reconvergence coverage, removable depth, cut boundary, repeated
non-overlapping occurrences, fanout/load, overlap with other candidates, and mapping feasibility.
Ranking may use those values, but it must keep the source values rather than emit only one opaque
score.

The counterfactual is not zero cone delay. It is:

```text
old cone cells + removable buffer/net delay
- new Cell NLDM delay
- new boundary, fanout, wire and uncertainty penalty
```

The Framework then repropagates the complete timing graph and records the new worst endpoint and
path migration.

### 5.4 Candidate functions and portfolio optimizer

**Location:** deepen cluster, canonicalization and implementation-plan logic in `mine_patterns.py`,
plus `cell_need_miner/cuts.py` and `npn.py`.

Required work:

- enumerate K-feasible cuts only in high-influence regions while retaining several research lenses
  instead of hard-coding one ranking method;
- define equivalence by at least NPN-canonical Boolean function and input/output interface, with
  drive as a separate axis;
- filter requests the current generator cannot implement while retaining the unsupported reason as
  knowledge;
- use a lexicographic portfolio objective: first reduce the worst reg2reg frontier, then reduce
  negative-slack mass after deduplicating endpoint families;
- compute overlap within one augmented mapping and never add ideal gains of intersecting cones;
- perform only the two necessary mappings, reference `Lk` and augmented `Lk + delta`, with
  license-free ablation only for a few attribution-ambiguous groups;
- report break-even delay instead of assuming an unrealized Cell has zero delay.

### 5.5 Cumulative Library and delta materialization

**Location:** deepen `_generation_projection.py` and the merge/generate/layout/characterize paths in
`stages.py`. Reuse the existing attempt, artifact and hash mechanism; do not build a second asset
service.

Workspace layout:

```text
flow/library/
  baseline-reference.json
  shards/0001/{functions.json,cells/,predicted.lib,mapping-evidence.json}
  shards/0002/...
  cumulative-manifest.json
```

Requirements:

- `L(k+1) = L(k) union delta(k)` and old shards are never rewritten;
- generation, layout and prediction create Jobs only for the new delta;
- the manifest records candidate identity, function class, drive, origin round, file hashes, proxy
  state and known failures;
- the manifest uses Pack-internal evidence states `discovered -> proxy-mapped -> materialized ->
  predicted -> cumulative -> commercially-adopted -> route-retained -> final-benefit`, retaining
  `proxy-rejected`; these states do not enter root `CONTEXT.md` or change Runtime behavior;
- Cells unused by the current design remain assets, while every round reports Library size and
  mapping cost;
- only the commercial exit assembles shards deterministically into one cumulative Liberty/LEF;
  assembly is not regeneration;
- `MAX_NEW_CELLS` means the per-round delta; `MAX_CELLS` is not silently redefined. Phase 1
  measurements determine the cumulative bound.

### 5.6 AI research controller

**Location:** deepen `ai_research_runner.py` and `research-template.py`; retain the one
`research-candidates` Workshop.

The AI receives a compact, hash-bound residual graph, proxy mapping, layered metric vector, Pareto
frontier, cumulative manifest and prior failures. It proposes research lenses, writes bounded
candidate/portfolio code, chooses the next region and explains which structural indicators should
change. It cannot change the Goal, invent measurements, delete old assets, write Judge facts or
launch the commercial flow itself.

`ai_research_runner.py` continues to own complete I/O, candidate membership, Boolean identity,
budgets, source hashes, output schema and code hash. `read-stage.py` independently recomputes the
important numbers. A second-tier model should solve a clearly stated residual problem rather than
relearn Yosys, ABC, Liberty and the whole Pack.

### 5.7 Metric system, commercial comparison and validation tiers

The Framework does not try to predict DC/Innovus numbers. Metrics have four open-source layers:

- **F0 Function:** Boolean equivalence, interface, generator feasibility and a local break-even
  bound;
- **F1 Local structure:** levels, nodes/edges, cut width, reconvergence, domination and repeated or
  non-overlapping support;
- **F2 Design mapping:** whole-design adoption, instances/area, depth distribution,
  buffer/inverter pressure and fanout/load;
- **F3 Timing indicator:** proxy-STA frontier, negative-slack mass, path-family coverage and
  migration.

F means free evaluation and E means expensive validation. F0 is the prerequisite; F1 local
structure, F2 design mapping and F3 timing are parallel factors over one candidate Library.
Commercial DC/Innovus results form **E0 Design QoR observations**. Compare them with the retained
factor vector under matched conditions to discover which factors have positive association with
commercial benefit. Future free factors may be added as F4, F5 and beyond. Precision,
recall, rank correlation, direction and numeric gaps may be recorded, but prediction accuracy is
not an optimization target and one design never creates a universal threshold.

An E0 candidate requires complete recomputable evidence, valid F0, handled overlap and current
Library-frontier membership. F1/F2/F3 are classified independently as positive, neutral, mixed or
explicitly negative. Factor direction rejects the Library only when all three are explicitly
negative. One negative factor cannot veto the others, and missing evidence is not treated as
nonnegative. “Worth validating” never means “predicted to gain X.” E0 count is an explicit
Campaign/Pack budget, not a Runtime constant.

## 6. Phase 1: independent Framework construction and assessment

### 6.1 Work items and dependencies

| ID | Depends on | Exact work | Exit evidence |
| --- | --- | --- | --- |
| LFR-FW-01 | none | Freeze a hash-bound calibration corpus: AES RTL, top, SDC summary, foundry Liberty, 47-Cell predicted Liberty, DC adoption and both route timing/census results. State that the two commercial runs used different conditions | corpus manifest, source paths, hashes, available/missing fields; no customer raw material committed |
| LFR-FW-02 | FW-01 | Implement `proxy_mapping.py` and the thin CLI; pin the Yosys/ABC profile; perform reference/augmented batch mapping | repeated-input netlist/census identity, script-difference audit, failure counterexamples |
| LFR-FW-03 | FW-01 | Extend `liberty_timing.py` for NLDM interpolation and mapped-netlist reg2reg STA; decide whether OpenSTA is necessary | hand-computed small circuits, slew/load boundaries, missing-arc and multi-clock counterexamples; one engine recomputes both arms |
| LFR-FW-04 | FW-02, FW-03 | Establish available F0/F2/F3 baselines from the 47-Cell evidence, compare them conditionally with retained E0 commercial QoR and declare missing F1 evidence | metric vectors and adoption/ordering/QoR relationship; explicit scope/root cause; zero LC/DC/Innovus Jobs |
| LFR-FW-05 | FW-04 | Deepen the influence graph, K-cuts, structural counterfactual, path migration and multi-index Pareto portfolio | synthetic reconvergence/dominator/overlap cases; Pareto layers recomputable from raw vectors |
| LFR-FW-06 | FW-01; may overlap FW-05 | Implement immutable shards, cumulative manifest, delta-only generation projection and invalidation | two synthetic Library rounds; old hashes unchanged; round two creates no old-Cell Jobs |
| LFR-FW-07 | FW-05, FW-06 | Connect AI residual research, both proxies, convergence and stopping in the standalone loop | one fixed replay and one small real second-tier-model task; recomputable output; no commercial-tool launch |
| LFR-FW-08 | FW-07 | Assess reproducibility, calibration, optimization trend, cost, generalization boundary and failure assets | a Framework assessment that chooses Pack integration, proxy correction or stop; code completion is insufficient |

FW-02 and FW-03 may run in parallel. FW-06 may overlap FW-05 late in FW-04. FW-04 is a metric-design
gate: when one timing indicator cannot explain structural change, expand the metric system rather
than turning the task into commercial-QoR prediction.

### 6.2 Framework test levels

| Level | What it verifies | What it cannot establish |
| --- | --- | --- |
| FW-T0 | Python compilation, JSON schemas, source/tool/hash provenance | algorithm correctness |
| FW-T1 | pure NPN, cut, dominator, NLDM interpolation, arrival propagation, overlap, objective and manifest logic | real mapper/tool compatibility |
| FW-T2 | real local Yosys/ABC plus proxy STA on small RTL/Libraries; two-round shard reuse | DC/Innovus correlation |
| FW-T3 | calibration and replay against retained AES evidence, with zero commercial Jobs | 5% on a new design |
| FW-T4 | one structurally different held-out RTL, second-tier-model research, cost and stopping review | commercial Fmax or Pack deliverability |

Daily changes run affected FW-T0 through FW-T2 only. FW-T3 runs when the proxy, profile or
calibration logic materially changes. FW-T4 runs once at the Phase 1 exit. Expected results come
from hand calculation, fixed tool output or retained commercial evidence, never from the
implementation under test.

### 6.3 Phase 1 exit

Phase 2 starts only when all are true:

- every input, tool, Library and result has stable identity;
- reference/augmented mapping is reproducible with zero constraint drift;
- proxy-STA indicator meaning, conservative assumptions and unknown terms are explainable;
- the comparison report states supplied-layer/E0 conditions, missing layers, observed relationships and non-extrapolation;
- on at least one held-out RTL, the loop produces new candidates from the residual graph and advances
  the multi-index Pareto frontier;
- old Cells are not regenerated, the Library only grows, and failed candidates are not retried as
  new work;
- a second-tier model completes the research program from the compact context;
- the Framework assessment explicitly approves Pack integration.

## 7. Phase 2: integration under the HimaPack standard

### 7.1 Work items and file mapping

| ID | Depends on | Fixed files | Exact work and exit evidence |
| --- | --- | --- | --- |
| LFR-PACK-01 | FW-08 | `INTENT.md`, `SPEC.md` | Rewrite the method goal, constraints, Run contract, semantics, Judge, Chooser, endings, Workshop and knowledge in the existing five/nine-section authoring formats while preserving accepted author decisions |
| LFR-PACK-02 | PACK-01 | `contract.yml`, `flow/bind-inputs.py`, `knowledge/site-profile.md` | Declare Yosys/ABC/proxy-STA identity, timeouts and resources; add `MAX_NEW_CELLS`; explicitly retire `MAX_CELLS` or retain it as a cumulative cap; HimaGuide discovers defaults instead of asking the user to fill them |
| LFR-PACK-03 | PACK-01 | `graph.yml` | Replace the opening commercial probe with an evaluation baseline; place function/local/design/timing evaluation, delta materialization, Pareto Judge and research revisit before commercial compile/DC/APR; enter the existing final chain only for a validation candidate |
| LFR-PACK-04 | PACK-02, PACK-03 | `flow/stages.py`, `flow/library_richness.py`, `flow/domain/*`, `tools/stages.py` | Wire the Phase 1 interface into existing stage dispatch; retain attempts/artifacts/hashes; synchronize published copies; do not copy the algorithm or bypass Permit/Job records |
| LFR-PACK-05 | PACK-03, PACK-04 | `contract.yml` outputs/workshop, `readers/`, `semantics.yml`, `rules/`, `choosers/`, `flow/read-stage.py`, `tools/read-stage.py` | Declare one complete proxy-evaluation output plus necessary Library manifest; independently recompute in the Reader; pass Judge only with complete evidence; Chooser changes research strategy only |
| LFR-PACK-06 | PACK-05 | `flow/ai_research_runner.py`, `flow/research-template.py`, `knowledge/full-mining-method.md`, `knowledge/manifest.yml` | Have the Workshop read residual graph, calibration, manifest and failure assets; update method knowledge and sources; never auto-promote Run results into the Pack |
| LFR-PACK-07 | PACK-06 | `FABRIC.md`, `TEST.md`, `test/contract/custom-cell-fmax-pack.test.ts` | Run `/hima pack check`, affected L0/L1/L2 and a real test Campaign; record Run status, CodeRecord hashes, refusal ids and every disagreement |
| LFR-PACK-08 | PACK-07 | Harness-generated `VERSION.yml`, candidate validation directory | After Phase 1 passes, run only the necessary commercial matched exit; after the test Pack passes, create the seal with `/hima pack release`; user sign-off remains separate |

### 7.2 Target reference-graph shape

```text
bind-inputs
  -> proxy-baseline/read
  -> high-influence mining branches
  -> research-candidates/read
  -> function-and-local-evaluation/read/judge
       FAIL -> residual research revisit
       PASS -> generate/layout/characterize only the delta
  -> design-mapping-and-timing-evaluation/read/judge
       FAIL -> residual research revisit
       PASS -> freeze cumulative Library
  -> compile -> matched foundry/custom DC -> adoption gate
  -> matched foundry/custom APR -> verify -> compare -> final Judge
       below target and commercial budget remains -> recalibrate -> proxy research revisit
       otherwise -> honest Campaign ending and archive
```

This remains one fixed reference graph. At runtime the AI may change strategy, revisit and add
bounded research only at declared Explore/Workshop locations. It cannot delete reference nodes or
create a second Run owner.

### 7.3 Pack outputs and semantics

Prefer one `proxyEvaluation` output that hides internal detail. Its Reader emits the minimum values
needed for decisions:

- `proxy_local_level_delta`, `proxy_removed_node_count`, `proxy_cut_width` and
  `proxy_reconvergence_coverage`;
- `proxy_mapped_instance_delta`, `proxy_logic_depth_p95_delta`,
  `proxy_buffer_inverter_pressure_delta` and `proxy_fanout_load_delta`;
- `proxy_worst_reg2reg_delay_indicator` and `proxy_negative_slack_mass_indicator`;
- `proxy_adopted_candidate_count`, `new_library_cell_count` and
  `cumulative_library_cell_count`;
- `proxy_metric_vector_complete`, `proxy_pairwise_relation`,
  `portfolio_frontier_membership` and `e0_library_validation_candidate`.

Every type must be emitted by a real Pack Reader and declared in `semantics.yml`; no unused type is
invented for UI convenience. Keep “metrics are complete,” “the two arms have this pairwise
relation,” “the FW-07 portfolio admits this frontier member” and “one commercial validation is
justified” separate. Never present the last value as a benefit forecast.

### 7.4 HimaPack standard gates

1. `INTENT.md`, `SPEC.md`, `FABRIC.md` and `TEST.md` retain the exact authoring-pipeline heading
   order.
2. `contract.yml` and `graph.yml` have the same id/version, and every tool, output, reader, rule,
   chooser, knowledge file and Workshop reference resolves.
3. The Pack contains only plain files/directories, with no symlink, hidden deliverable or customer
   path.
4. `/hima pack check <pack> --site <site>` reports fit and gives a specific answer for an
   incompatible Site.
5. The test Campaign is marked as a test and runs the digest of the current Pack files.
6. The Ledger verifies the Run, status, CodeRecord hashes and refusal ids in `TEST.md`.
7. Only `/hima pack release` creates `VERSION.yml`; hashes and file lists are never written by hand.
8. Any post-release file change invalidates the seal and requires another test.

### 7.5 Authoring-pipeline sequence

The Hima authoring pipeline is the Package admission sequence, not a reason to regenerate the
Framework:

1. `/hima-grill` updates only `INTENT.md`, preserves accepted interview decisions and resolves
   conflicts between the new method and the Golden Flow.
2. `/hima-spec` produces the nine-section `SPEC.md` only from the accepted Intent.
3. `/hima-fabric` compiles the Spec into Pack declarations and records anything it cannot express
   as a gap. It wraps the Phase 1 implementation through tools and does not copy or rewrite the
   optimization algorithm.
4. The Package developer closes each gap only in the existing Pack files it names, then runs pack
   check. A gap that needs new Hima Runtime capability stops and returns to product decision.
5. `/hima-test` starts a Campaign marked as a test on a real Site and produces `TEST.md` from Ledger
   facts.
6. `/hima-release` creates `VERSION.yml` for a tested folder. No person writes or repairs the seal.

## 8. Verification and cost discipline

Phase 2 continues to use repository levels L0 through L5:

- **L0/L1:** Pack schema, graph references, Python and pure proxy logic;
- **L2:** real Host, local Yosys/ABC, proxy STA, two-round shards, Reader/Judge and recovery;
- **L3:** only visibility of the Campaign graph, Library growth, layered metrics, pairwise relation,
  portfolio-frontier membership and validation-candidate reasons; every Desktop test runs on the
  Catsights secondary display;
- **L4:** one small real-model task and one retained AES indicator/E0 comparison, with no
  LC/DC/Innovus search;
- **L5:** one matched commercial QoR observation after a Pareto candidate forms. A negative result
  becomes relationship evidence and is neither rerun unchanged nor used to fit a benefit predictor.

Do not rebuild and rerun the whole Desktop for one change. Start with the cheapest test capable of
falsifying the behavior and escalate only when an interface, real dependency or user path changes.
Report pass, failure, skip and not-run separately.

## 9. Tracking, commits and decisions

- This track uses `LFR-FW-01..08` and `LFR-PACK-01..08`. GitHub uses one separate umbrella Issue and
  creates no PLS number.
- Before each work item, record the input commit, changed files and minimum test. At exit, record
  evidence, limitations and rollback.
- Phase 1 does not change `graph.yml`, `contract.yml` or release state. Phase 2 does not reimplement
  the Framework.
- A new Hima Runtime capability, second asset system, Pack-format change or product-domain change
  returns to the user for a decision. Pack-internal algorithms, Readers, tool parameters and tests
  proceed under this document.
- Every local commit is pushed immediately and the remote SHA is verified.

## 10. Current development frontier

The current frontier is **LFR-PACK-07**. PACK-01 through PACK-06 now wrap the frozen Framework in the
existing HimaPack files. Local contracts and one real Yosys/ABC integration pilot pass. A fresh AES
50-Cell standalone Framework run, with no reuse of the old candidate Library, has now reached E0.
Its F1-positive, F2-positive and F3-mixed Library produced -2.792% Fmax in the matched final
databases. It is negative factor-relationship evidence rather than a release exit. The next required
product fact remains one Harness-owned test Campaign with Ledger/CodeRecord/refusal evidence.
PACK-08 also requires a matched E0 observation with positive business benefit and a release seal
generated from that tested folder.
