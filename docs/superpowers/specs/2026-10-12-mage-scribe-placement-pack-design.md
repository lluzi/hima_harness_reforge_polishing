# MAGE scribe-line placement Pack: design

| | |
|---|---|
| Date | 2026-10-12 |
| Status | Approved for implementation under the stated assumptions (§12); the user may redirect at any time |
| Pack | `packs/mage-scribe-placement/` 0.1.0, status `development`, minimum Harness 0.3.0 |
| Branch | `feat/mage-scribe-placement` off `main` at `5d2ea5bd` |
| Brief | `/Users/lluzi/code/mage_smart_conflict_resolver/research/mage-resident-agent-20261012/` (machine-local, contains customer data): `mage-placement-pack-proposal.en.md` r2, `mage-agent-team-design.en.md`, `plan-agent-team-pack.en.md`, `evidence/` |
| User steering 2026-10-12 | Use the proven Harness that runs the ATCS Pack today. Orchestrate the roles with Hima Fabric as **serial resident Tasks in an iterative feedback loop**, one role per Task, mimicking a human engineer's single-threaded process. The HimaTeam platform is not ready and is not used. |
| Precedent | `packs/agentic-timing-closure-system/` 0.4.7 (resident engineering Task in a `hima-flow/1` sequence); `packs/libinsight-analysis/` 0.1.0 (smaller resident Pack) |

This spec is the polishing-repo design for the Pack the brief proposes, reshaped to the user's
steering above. It keeps the brief's mechanism (consumer costs, exact planner, native judge, honest
Decision Requests) and records every decision this session took without the user (§12). Facts carry
the brief's status letters: **V** verified on real bytes or a real run, **D** documented in the vendor
manual only, **A** assumption.

## 1. Problem and user outcome

Test structures (overlay targets, CD-SEM targets, scanner alignment marks, WAT test keys, bonding
marks) must be placed in the scribe lanes of a reticle Frame. Nobody can write the complete
requirement down: each downstream engineer has an unwritten target ("keep my marks where my recipe
expects them", "put every key somewhere, in one straight row", "do not empty a field corner"), and
the targets conflict over a few lanes of 60 µm. Today the customer runs a vendor script flow: place
the priority Group marks at the Litho/PIE target table, compact, let MAGE Auto Refine fill the rest,
and accept the drops. On the reference case (P23, **V**) that leaves 19 structures dropped (13 WAT
keys, 4 L marks, 1 overlay, 1 bonding) and 60 to 64 priority marks more than 100 µm from their
target.

The user wants a HimaPack in which **several agents** play the roles: one MAGE Engineer operates
MAGE, and consumer agents stand in for the downstream engineers, evaluate each candidate placement
from their own working perspective and send concrete revision requests, until no issue remains or a
real trade-off reaches a human with every consumer's numbers attached.

The product claim to prove (brief §0): on the same frozen inputs, the team's placement is at least
as good as the incumbent on completeness (Q1), fidelity (Q2) and consumer rework (Q3), never worse on
native legality (Q4), and the delivery is natively verified. A quantified trade-off request is a
complete engineering delivery with `goalMet` false.

## 2. Mechanism in one paragraph

Requirements that cannot be modelled as rules are modelled as **costs with sources**. Every
consumer role owns a versioned *consumer model*: per structure class, hard predicates (placed,
orientation unchanged, rigid unit intact) and cost predicates (recipe edits per move beyond a search
window, job edits per moved alignment mark, test-program updates in pad-pitch units, coverage loss
per field region). Parameters the customer has not supplied stay **unknown** and produce `unknown`,
never zero. Deterministic code evaluates every candidate against every model and returns numbers.
The agents argue only about the models, priorities and exceptions, never about arithmetic. The
Engineer's moves come from an exact **slot planner** on a one-dimensional lane model, are applied in
MAGE by replaying a complete placement (the verified path), and are judged by MAGE's own checks.
Fabric runs the roles one after another in rounds; a deterministic round decision stops on no open
requests, two rounds without improvement, or the declared round limit; the best natively measured
state is always delivered, with any open Decision Requests.

## 3. Scope: two sub-projects

| Sub-project | Content | Needs | Status |
|---|---|---|---|
| **S1 (this spec, this session)** | The Pack: contract, graph with the round loop, schemas, program tasks, the offline mechanism (normaliser, rule facts, target binding, snapshot, planner, consumer evaluators, records and ledger), the native session driver with a stand-in interpreter, Readers, rules, semantics, knowledge and role playbooks, synthetic-fixture tests, a Host contract test, an L2 dry route with stand-in residents through the real Host; plus a machine-local offline evaluation of the real P23 case (Case A and Case B numbers under stated models) | no licence, no Site, no model | implement now |
| **S2 (next)** | Site `linglong-mage` (capability JSON, licence-mode guard, display, case copy), native qualification of the D commands and `smVerify`, one model run on frozen inputs, resident runs of Cases A and B through the App | a user-opened MAGE licence window; Site work agreed with the user | blocked on the user |

S1 is complete when the Pack loads and checks against a synthetic local Site, all Pack-local and
Host tests pass including the dry route, and the offline P23 evaluation reproduces the brief's
verified counts on the real bytes. S1 does not claim native legality, model behaviour or
effectiveness.

## 4. Architecture: serial roles in a Fabric round loop

```
runInput: mageCaseManifest · consumerContext · siteCapabilities · workspaceRoot

sequence placement
├─ prepare-case          program     verify digests; build startSnapshot; rule facts; round-0 decision
├─ measure-incumbent     program     evaluate the retained incumbent (modelled)
├─ repeat placement-rounds   maxIterations 4 · carry roundState · stop when decide-round.route == "stop"
│  └─ sequence round
│     ├─ engineer-place        resident  licences {mage: 1}   → placementCandidate   (Reader mage-placement-candidate)
│     ├─ review-litho-pie      resident  no licence           → reviewLithoPie       (Reader mage-consumer-review)
│     ├─ review-metrology      resident  no licence           → reviewMetrology      (Reader mage-consumer-review)
│     ├─ review-alignment      resident  no licence           → reviewAlignment      (Reader mage-consumer-review)
│     ├─ review-wat            resident  no licence           → reviewWat            (Reader mage-consumer-review)
│     └─ decide-round          program   ledger, best state, route continue|stop → roundDecision, placementResult
├─ evaluate-placement    program, budget closing   goalMet; Q1–Q4 vs incumbent
└─ deliver               program, budget closing   report + package
```

Why this shape fits the user's steering and the existing Harness:

- `hima-flow/1` already has `repeat` with `carry`, a `stop` output comparison and `maxIterations`
  (`flow-definition.ts:51`, `flow-workflow.ts:350–375`), and a resident task is an ordinary task
  with `outsourcing` (`durable-task-adapters.ts:139`). No Harness change.
- Every role is one resident Task with its own fresh OpenCode session, its own role knowledge
  (`outsourcing.knowledge`), its own inputs (`outsourcing.reads`) and its own Reader-verified output.
  Roles are therefore **enforced by the Harness**, not instructed: a consumer Task holds no MAGE
  licence and its Reader refuses any claim the evaluator code does not reproduce.
- Single-threaded by construction: Engineer → four consumers → decision → next round. The Engineer
  of round k reads the round-(k−1) decision and every consumer's requests; each consumer reads only
  the current candidate.
- Only the Engineer holds the MAGE seat, so the Site needs `capacity.licences: {mage: 1}` and
  `parallelJobs: 1` suffices.

Ownership follows `docs/agents/polishing-discipline.md`: the Pack owns method, tools, templates,
role playbooks, Readers and rules; the Harness is unchanged; the Site owns MAGE install, licence,
case data, sandbox and `consumerContext`.

**Not used.** `agentTeams` (ADR-0016 fixed seats), Workshops, Judge/Explore nodes, OpenCode
subagents inside one Task (the brief's R1/R2), HimaTeam.

## 5. The Pack, file by file

```
packs/mage-scribe-placement/
  INTENT.md  SPEC.md  FABRIC.md  TEST.md
  contract.yml  graph.yml  semantics.yml
  schemas/tasks.json                       task I/O schemas (JSON Schema 2020-12)
  flow/mage_placement_cli.py               program-task ABI + resident-facing subcommands
  flow/mage_placement/
    core.py        canonical JSON, digest, stamp (`mage.<kind>/1`), write/read artifact, Measure helpers
    pla.py         parse vendor µm PLAs and native DBU PLAs: fixinsts, pinstGroupProperty, fitinsts, dropFitInsts;
                   write a complete PLA from a snapshot
    rules.py       rule facts per SLFIT/SLFIX item from the rule Tcl (scribe inc/exc, turnable, pri, setNum,
                   setSpace, setPadCross, setZone raw, setGrid, bindBlkType, cluster), each with `qualified`
    targets.py     target table (CSV) + request order (generated Tcl) → CT targets; bind to Groups by target point;
                   TB/LR/IN partition (customer split_csv)
    lanes.py       frame/lane model: H/V lanes, exterior lanes as one cyclic physical scribe, projection,
                   periodic images, free intervals
    snapshot.py    mage.layout-snapshot/2 builder and loader (Fixed/Group/Fit/Pending, DBU boxes, targets,
                   rule facts, block types, lane model, digests, snapshotSha256)
    planner.py     exact slot planner: (a) max slots / feasibility, (b) fewest moved items, (c) least total
                   displacement, cyclic lanes, rigid clusters, mixed lengths, relaxed bound
    metrics.py     drops (count, long-side length), target distance, order deviation (customer check_dev),
                   displacement from start, per-lane statistics
    consumers.py   consumer-model loader (templates + consumerContext), predicate library, evaluator → Findings
    records.py     Finding / Request / Ledger entry / Decision Request validation; round ledger consistency
    rounds.py      decide-round: collect reviews, answer check, best-measured-state order, improvement test,
                   route continue|stop, placement-result assembly
    native/session.py   one-writer MAGE driver: per-round Tcl script from templates, run `mage-frb <script> -noterm`,
                        collect exports and check files, role-tagged session log; stand-in interpreter for tests
    native/tcl.py       Tcl literal quoting and template filling (no user text reaches Tcl unquoted)
  flow/consumer_models/{litho-pie,metrology,alignment,wat,bonding}.yml     customer-neutral templates
  flow/schemas/{case-manifest,consumer-context,snapshot,finding,request,ledger-entry,decision-request,
                placement-candidate,consumer-review,round-decision,placement-result}.json
  flow/templates/{open-build,replay-pla,verify-all,export}.tcl
  flow/tests/        unittest modules on synthetic fixtures (no customer data)
  readers/mage-placement-candidate.yml  readers/mage-consumer-review.yml   tools/read-mage.py
  rules/{placement-delivery-ready,priority-all-placed,no-native-violation,drops-within-goal,
         target-limit-met,order-within-goal,no-open-requests}.yml
  knowledge/placement-playbook.md  mage-capabilities.md  state-and-evidence.md  review-protocol.md
  knowledge/role-mage-engineer.md  role-litho-pie.md  role-metrology.md  role-alignment.md  role-wat.md  role-bonding.md
```

Knowledge file names are flat (`packs.ts:92`). Customer values never enter the Pack; tests use
synthetic fixtures. `role-bonding.md` and the bonding template ship for a later version; 0.1.0 has
no bonding Task because the reference case has no partner-wafer data.

### 5.1 `contract.yml`

- `budget: {timeBoxMs: 21600000, closingReserveMs: 900000, minimumGenerations: 1}` (six hours: up to
  four rounds of five resident sessions plus MAGE rounds; the Site Permit and the Run hard limit still
  apply; tune after S2 measurements).
- Inputs: `mageCaseManifest`, `consumerContext`, `siteCapabilities`, `workspaceRoot`.
- Outputs (campaign-relative paths; a repeated task rewrites the same path each round and the file
  carries its round number and the previous version's sha):

  | name | path | reader |
  |---|---|---|
  | `caseReadiness` | `state/case-readiness.json` | |
  | `startSnapshot` | `state/start-snapshot.json` | |
  | `incumbentMeasure` | `state/incumbent.json` | |
  | `roundDecision` | `state/round-decision.json` | |
  | `placementCandidate` | `state/round/placement-candidate.json` | `mage-placement-candidate` |
  | `reviewLithoPie` | `state/round/review-litho-pie.json` | `mage-consumer-review` |
  | `reviewMetrology` | `state/round/review-metrology.json` | `mage-consumer-review` |
  | `reviewAlignment` | `state/round/review-alignment.json` | `mage-consumer-review` |
  | `reviewWat` | `state/round/review-wat.json` | `mage-consumer-review` |
  | `placementResult` | `state/placement-result.json` | |
  | `placementEvaluation` | `state/placement-evaluation.json` | |
  | `finalReport` | `delivery/report.json` | |

- `workspace: {source: pack, copy: [mage_placement_cli.py, mage_placement, consumer_models, schemas, templates]}`.
- Goal: `target_dropped_count` (count, 0..100000, default 0), `max_target_distance_um` (um, 0..100000,
  default 100), `max_order_deviation` (rank, 0..1000, default 1).
- Strategy: `incumbentComparison: choice [retained, native] default retained`. The round limit is the
  graph's `maxIterations: 4`; strategy knobs cannot feed it.
- Program tools on the ATCS ABI (`task-<name> ${WORKSPACE} ${TASK_INPUT} ${TASK_OUTPUT}`), none
  holding a licence: `prepare-case`, `measure-incumbent`, `decide-round`, `evaluate-placement`, `deliver`.
- Resident tools (each `outsourcing.role: resident-engineering-agent`; the batch argv only validates an
  existing result, as ATCS `engineering-result` does):

  | tool | licences | reads | knowledge | artifactPrefix | produces |
  |---|---|---|---|---|---|
  | `engineer-place` | `{mage: 1}` | caseReadiness, startSnapshot, incumbentMeasure, roundDecision | placement-playbook, mage-capabilities, state-and-evidence, review-protocol, role-mage-engineer | `placement` | placementCandidate |
  | `review-litho-pie` | none | caseReadiness, startSnapshot, placementCandidate | review-protocol, state-and-evidence, role-litho-pie | `reviews/litho-pie` | reviewLithoPie |
  | `review-metrology` | none | same | review-protocol, state-and-evidence, role-metrology | `reviews/metrology` | reviewMetrology |
  | `review-alignment` | none | same | review-protocol, state-and-evidence, role-alignment | `reviews/alignment` | reviewAlignment |
  | `review-wat` | none | same | review-protocol, state-and-evidence, role-wat | `reviews/wat` | reviewWat |

  Each resident tool's `description` is that role's complete brief, because the Harness sends it as the
  task text (`engineering-executor.ts:planEngineeringTask`). Inputs: `WORKSPACE`, `ROUND` (carry),
  goal values for the Engineer; `WORKSPACE`, `ROUND` for consumers. `prepare-case` writes the round-0
  `roundDecision` file so the first Engineer read succeeds.

### 5.2 `graph.yml`

One `hima-flow/1` sequence containing one `repeat`. Every declared tool input is bound.

| Task | Inputs | Output value |
|---|---|---|
| `prepare-case` | runInput manifest, context, capabilities; goal values | verifies every manifest digest; parses PLAs, rule, targets, request order; builds `startSnapshot`; writes rule facts and consumer block types; writes goal values into `case-readiness.json`; writes `state/round-decision.json` for round 0 (`route: continue`, no requests); value = paths + ids |
| `measure-incumbent` | committed `prepare-case` | normalises the incumbent PLA; evaluates it with the same metrics and evaluators (labelled `modelled`); value = incumbent numbers |
| `repeat placement-rounds` | `carry.roundState` initial `{source: literal, value: {round: 1}}`, next = `decide-round` value `.nextRound`; `stop` = `decide-round` value `.route` equals `stop`; `maxIterations: 4`; `budget: original-run` | |
| `engineer-place` | `ROUND` from carry; goal values | Reader-verified `mage.placement-candidate/1` |
| `review-*` (four) | `ROUND` from carry | Reader-verified `mage.consumer-review/1` each |
| `decide-round` | committed Reader values of the five resident tasks (`source: committedOutput`); `ROUND` from carry; goal values | checks every round-(k−1) Request has a Ledger answer in the candidate; computes improvement over the best state so far; selects the best measured state (§9); `route: continue|stop`; `nextRound: {round: k+1}`; writes `state/placement-result.json` (cumulative best state, records, decision requests) |
| `evaluate-placement` (`budget: closing`) | committed `decide-round` value; goal | `goalMet`; Q1–Q4 versus the incumbent; unknowns kept separate |
| `deliver` (`budget: closing`) | committed evaluation | recheck digests; `delivery/report.json`, `delivery/REPORT.md`, `delivery/placement-artifacts.tar.gz` (final PLA, replay Tcl, native check files, snapshots, every round's candidate and reviews, ledger, decision requests, scripts, session logs) |

Stop rule inside `decide-round`: `stop` when (no consumer hard failure and no open Request) or (two
consecutive rounds without improvement in any of Q1–Q4) or (`round == 4`, which `maxIterations` also
enforces). Otherwise `continue`.

### 5.3 Site documents (schemas ship in `flow/schemas/`, instances live on the Site)

`mage.case-manifest/1`: `frb`, `prj`, `rule`, `pblock`, `block`, `clusterTcl[]`, `targetTable`,
`requestOrder`, `startState` (PLA), `incumbentState` (PLA), each `{path, sha256}`; `frameSizeUm`,
`dbuPerUm`, `partitionRule` (TB/LR/IN tolerances, default 2 µm), `groupPlaceCommandForm`,
`mage: {setupScript, executable, buildBanner}`.

`mage.consumer-context/1`: `stage: npi|frozen`, `limitHardness: hard|preference|unknown`, per consumer a
map of named values each `{value, source, confirmedBy, confirmedAt}`; a missing value makes the
evaluator return `unknown` for predicates that need it.

## 6. The roles and the round protocol

| Role (Task) | Evaluates | Hard | Numbers | May / may not |
|---|---|---|---|---|
| MAGE Engineer (`engineer-place`) | everything | native checks clean; all required structures placed; rules unchanged | drops, target distances, moves | read inputs, write private code, drive the one MAGE session, propose/apply/measure candidates, answer every open Request in the Ledger, deliver / edit rule files, targets, consumer models, limits |
| Litho/PIE Placement Owner (`review-litho-pie`) | priority Group marks | every Group mark placed | marks beyond the declared limit; order deviation | file Findings and Requests / change the layout |
| Overlay & CD Metrology (`review-metrology`) | OVL, IBO_CDSEM_DBO, markCluster members | region coverage minimum (A) | recipe edits; coverage delta; broken pairs | same |
| Scanner Alignment (`review-alignment`) | ASML_AL, CANON_AL | no rotation; side and separation rules (A) | job edits; spread margin | same |
| WAT / Parametric Test (`review-wat`) | TSK/MPAD | placed; rigid unit; no rotation | dropped keys (count, length); test-program updates; moves in pad pitches; card re-make yes/no | same |

Round protocol (`knowledge/review-protocol.md`):

1. The Engineer reads `state/round-decision.json` (round k−1: open Requests, best state so far,
   Decision Requests), produces candidate k, runs the native checks, and writes a Ledger answer for
   every open Request: `satisfied | alternative | declined` with evidence (native rows or a planner
   result). Delivery = `mage.placement-candidate/1`.
2. Each consumer reads the candidate's snapshot and native check files, runs the Pack evaluator under
   its consumer model version, and files Findings (`fail | cost-up | unknown | ok`) and Requests
   (requested outcome, acceptable alternatives, strength). Every record names `snapshotSha256`, full
   native instance IDs, `consumerModel` (`id@version`) and an `evaluatorReceipt`. Consumers never
   change the layout or any model. Delivery = `mage.consumer-review/1`.
3. `decide-round` (code) joins the four reviews, verifies the Ledger, updates the best measured state,
   detects conflicts between consumers (a Request one consumer makes that another consumer's hard
   requirement forbids) and turns them into Decision Request options with every consumer's numbers,
   decides `continue | stop`, and carries the round forward.
4. No voting; hard requirements are never traded; `unknown` stays `unknown`. Decision Requests
   travel in the delivery; there is no mid-task ask-the-user verb. A user message naming a Decision
   Request ID during the Run counts as its decision.

## 7. The Engineer's mechanism

**Observe.** One MAGE round = generate one Tcl script from templates (open the case, build the Frame
with `smPFlow -setAutoRefine -arEnabled 0`, source the candidate PLA, run every `smVerify` type to a
file, `smPInstMgr -saveMark`, `-savePlaDBU` if available, `smPFlow -saveSummary`, `-saveFrame`), run
`mage-frb <script> -noterm` in the Site environment, parse the exports into a snapshot. Replaying a
complete PLA is the **V** path (vendor `pre_place_all.pla`, 225 Fit / 10 Fixed exact on the Oct-12
build). Everything else in MAGE is **D** until S2 qualifies it.

**Diagnose** each drop or deviation with a named deterministic test (brief §6.2): fragmentation,
order-limited, limit-limited, capacity-limited, rule-unknown, identity-unknown. Action order:
reserve-first, squeeze within limits, relocate non-priority structures, Decision Request.

**Plan** with the slot planner (§7.1). **Apply** by writing a new complete PLA (translated boxes,
Group target points unchanged, pending structures added as Fit records with `-plaCheckSize`).
**Judge** by the native checks; keep or revert; record the candidate.

### 7.1 Slot planner (exact in its model)

Units are integer placement-grid steps (rule `-setGrid -gridX 0.010000` µm = 100 DBU at
10,000 DBU/µm); never snap after solving. Per lane: items in order with length ℓ, required gap to the
next item (from rule facts; unknown → `rule-unknown` flag and the declared default), a left-edge
window from the CT target `[t − limit − ℓ/2, t + limit − ℓ/2]` intersected with any baseline budget,
the empty-window rule for marks already beyond the limit (never made worse), point windows for
immovable items (fixed, locked, crossing intruders), rigid clusters as one item with the
intersection of shifted member windows, and k requested slots of length L with clearance c.

- **(a) Maximum slots / feasibility.** DP over items; state `m → E(m)` = minimal end of the last placed
  item with `m` slots opened; for item i try `j = 0 … k − m` slots before it,
  `p = max(lo, E + g + j·(L + 2c))`, feasible iff `p ≤ hi`; keep minimal E per m; add trailing slots.
- **(b) Fewest moved items.** State `(m, moved) → min E`; an item either stays (allowed iff its current
  position satisfies the chain and its window) or moves to the leftmost feasible position.
- **(c) Least total displacement.** With order and slot positions fixed by (b), an exact DP over grid
  positions in each item's window with prefix-min transitions,
  `cost_i(p) = |p − current_i| + min_{q ≤ p − sep_i} cost_{i−1}(q)`. This replaces the brief's LP so
  the Pack needs no numeric library; it is exact on the grid.
- Cyclic lanes: cut at an immovable item, else at a pinned item, with the wrap gap constraint.
- Mixed lengths: longest pending structure first, its slot then immovable; a declared heuristic
  across lengths, exact per length.
- **Relaxed bound**: the same planner with listed relaxations (spacing/keep-out/zone ignored, crossing
  intruders removable within the limit, non-priority structures removable, clusters split). Fewer
  than k slots → "infeasible within relaxed model M at limit X", never "native infeasible".
- Tests: brute force on small random lanes for (a), (b) and (c); the P23 evidence counts
  (`slot_bound.out.txt`: 2 slots at tol 0/100 µm, 11 at 1,000 µm on the outer-bbox model) are
  reproduced machine-locally, not in the repo.

### 7.2 Metrics (`metrics.py`)

- **CT target**: the Group's centre alignment point, `LOC + Frame size / 2` (**V**).
- **Target distance**: along-lane |bbox centre − CT target|; cross-lane reported separately.
- **Order deviation**: the customer's `check_dev` (max |requested position − placed position| per
  list; lists TB, LR, IN by the customer's `split_csv` with the manifest's tolerance); thresholds are
  separate sourced preferences (deck `<2`; script LR ≥3, TB ≥2 flagged).
- **Drops**: count and total long-side length; per consumer class.
- **Displacement from the frozen start**: separate from target distance, never mixed.

## 8. Consumer models and evaluators

Templates (`flow/consumer_models/*.yml`, schema `mage.consumer-model/1`): `id`, `version`, `scope`
(block types or name classes), `requirements[]` each `{id, kind: hard|cost, predicate, parameters,
cost, source: {type: rule-file|customer|public-research|assumption, ref}, confidence}`.

Predicates (`consumers.py`): `placed`, `target_distance`, `order_deviation`, `region_coverage`,
`pair_cohesion`, `orientation_unchanged`, `rigid_unit`, `move_in_pitch_units`, `edit_on_move`,
`native_rows_for`. Each returns numbers + `pass|fail|unknown` + the inputs it used; the evaluator
writes one file per (candidate, consumer) and its sha256 is the `evaluatorReceipt`. A parameter
missing from `consumerContext` yields `unknown`, never zero.

Per-class content comes from the consumer research (brief; `consumer-requirements-research.en.md`
§10): overlay (recipes to regenerate per layer pair; coverage per region, corners + centre ≥5;
search window unknown), CD-SEM (addressing pair cohesion; coordinate file), ASML/Canon alignment
(job edits; no rotation; Canon side rules and TVPA separation ≥4,000 µm, unusable <1,000 µm), WAT
(rigid unit; Δ in pad pitches with 0.5-pitch wrong-pad risk; card re-make on rotation or pitch/count
change), bonding (mirror consistency; enabled only with partner data).

## 9. Records, Readers and rules

Record schemas as in the brief §5.2: `mage.finding/1`, `mage.request/1`, `mage.ledger-entry/1`,
`mage.decision-request/1`.

`mage.placement-candidate/1` (Engineer delivery, per round): identity (task, run, execution, node,
round), start and candidate snapshot sha, build banner, candidate files with sha256 (PLA, native
verify files per type, export, snapshot), Q1–Q4 metrics, Ledger answers to the previous round's
Requests, scripts and reproduction instructions, session log sha, remaining/blocked/unknown items as
objects, `outcome: completed|best-effort|blocked`, `stopReason`.

`mage.consumer-review/1` (consumer delivery, per round): identity, `consumer`, `consumerModel`,
`snapshotSha256` of the reviewed candidate, Findings, Requests, evaluator receipt files, `summary`.

`mage.round-decision/1` (program): round, best state so far (candidate sha and metrics), open
Requests, Decision Requests, improvement history, `route`, `nextRound`.

`mage.placement-result/1` (program, cumulative): best measured state with its files, every round's
records, consumer models used and `consumerContext` sha, Decision Requests, Q1–Q4, outcome.

**Best measured state** (lexicographic, natively measured only): no new native violation rows versus
the start; all priority marks placed; fewer consumer hard failures; fewer dropped structures by count
then long-side length; fewer priority marks beyond the limit; lower max order deviation; lower total
consumer rework; fewer moved instances; lower total displacement.

Readers (`tools/read-mage.py`, argv `${READER} <kind> ${REPORT} ${OUT} ${WORKSPACE}`; imports
`<workspace>/flow/mage_placement` exactly as ATCS's Reader imports its flow copy; fail closed; emit the
whole declared set with `unknown()` where a fact is not established):

- `mage-placement-candidate`: re-hashes every referenced file; re-parses the export and rebuilds the
  snapshot sha; recomputes drops, target distances (limit from `state/case-readiness.json`), order
  deviation and native rows per type; checks every open Request of the previous round has a Ledger
  answer; checks the session log has no mutation not tagged by the Engineer. Emits
  `mage_candidate_error_count`, `mage_priority_unplaced_count`, `mage_dropped_count`,
  `mage_dropped_length_um`, `mage_target_distance_max_um`, `mage_target_over_limit_count`,
  `mage_order_deviation_max`, ten `mage_native_<type>_rows`, `mage_native_violation_total`,
  `mage_open_request_count`.
- `mage-consumer-review`: checks the review binds to the current candidate's snapshot sha; re-runs the
  evaluator under the declared consumer model version and refuses any Finding number the code does
  not reproduce; checks Requests reference Findings. Emits `mage_review_error_count`,
  `mage_review_hard_fail_count`, `mage_review_request_count`, `mage_review_unknown_count`.

Any mismatch rejects, and the rejection returns to the same resident Task as a repair message
(`durable-task-adapters.ts:152`).

Rules (bound in `evaluate-placement` from the committed `decide-round` value and the final
candidate's Reader values): `placement-delivery-ready` (candidate error count eq 0),
`priority-all-placed` (unplaced eq 0), `no-native-violation` (total eq 0), `drops-within-goal` (lte
parameter `target_dropped_count`), `target-limit-met` (lte parameter `max_target_distance_um`),
`order-within-goal` (lte parameter `max_order_deviation`), `no-open-requests` (eq 0).

## 10. Testing (per `docs/testing-strategy.md` and `docs/agents/fast-convergence-testing.md`)

| Level | What | Command |
|---|---|---|
| L1 | Pack-local unittest on synthetic fixtures: PLA parsing µm and DBU with drops and round-trip writing; rule facts; target binding and TB/LR/IN partition; snapshot round trip and sha; planner vs brute force; metrics vs hand values; evaluator `unknown` on missing parameters; records/ledger consistency; decide-round stop rule and best-state order; stand-in MAGE round; Reader negatives (tampered PLA, untagged mutation, unanswered request, fabricated review number, wrong snapshot binding) | `cd packs/mage-scribe-placement/flow && /usr/bin/python3 -m unittest discover -s tests -v` |
| L0/L2 | Host contract test `test/contract/mage-scribe-placement.test.ts`: `loadPack` structure (entry, the repeat block with carry/stop/maxIterations, five resident tools with their outsourcing blocks and licences, goal/strategy knobs, no agentTeams/workshops), `checkPack` against a synthetic local Site with `licences: {mage: 1}`, reader argv and emits equal semantics, rules resolve; registered in `test/contract-groups.json` `local` | `pnpm run test:local -- --files test/contract/mage-scribe-placement.test.ts` (after `pnpm run build`) |
| L2 dry route | `test/contract/mage-scribe-placement-durable.host.test.ts` + worker, modelled on `atcs-resident-durable-worker.ts`: synthetic case files, stand-in ACP residents (`test/fixtures/mage-resident-dry/`) that run the Pack CLI to produce admitted deliveries, `sandbox.kind: none, testOnly: true`; two scripted scenarios: converge in round 2 (`route: stop`), and conflict → Decision Request with `goalMet` false; asserts the repeat ran the expected rounds, every Reader admitted, evaluation and delivery committed | registered in `test/contract-groups.json` `atcs-dry`-style group `mage-dry` |
| L1 machine-local | Offline evaluation of the real P23 package through the Pack CLI: start snapshot from `pre_place_all.pla`, incumbent from `frame_post_refine.pla`, reproduce 225/225 target binding, 60 beyond 100 µm, 19 drops, 2 V-lane slots at ±100 µm; Case A candidate list and Case B relaxed-model result | script and outputs under `/Users/lluzi/code/mage_smart_conflict_resolver/research/mage-resident-agent-20261012/pack-eval/` (not in this repo) |
| L4 (S2) | native qualification, model run, resident runs through the App | user-opened licence window |

No model is the first producer tested against a schema: every model-written document has an admitted
example fixture, a validator and a Reader negative.

## 11. Acceptance cases carried by the Pack (run in S2)

- **Case A** priority-fidelity repair within declared limits on the real full Frame: fewer priority
  marks beyond the limit than the incumbent, zero new drops, zero new native rows, no consumer hard
  failure, consumer costs reported.
- **Case B** nine 5,188 µm VERT-only WAT keys: either natively verified placement within the declared
  limits, or "infeasible within relaxed model M at limit X" plus Decision Request options carrying every
  consumer's numbers.

## 12. Decisions taken in this session without the user

1. **Branch.** `feat/mage-scribe-placement`, pushed after every commit; the Pack is additive, so the
   merge to `main` is the user's call.
2. **Serial resident roles in a `repeat` block** (user steering) rather than OpenCode subagents inside
   one Task (the brief's R1/R2). Four consumer roles in 0.1.0; bonding ships as template and playbook
   only. Round limit fixed at 4 in the graph.
3. **Fresh `mage_placement` package, not a vendored `mage_assist`.** The prototype's `Case` model is
   baseline-relative and P23-bound and its loader fails on the new package (**V**); the Pack's snapshot
   needs pending structures, drops, CT targets and rule facts. Proven pieces (integer Box, interval
   merge, lane projection with periodic images, PLA table parsing) are re-implemented with attribution
   in the module docstrings.
4. **Exact grid DP for least displacement instead of an LP.** No numeric dependency; exact on the
   placement grid.
5. **Batch-per-round MAGE scripts (`mage-frb <script> -noterm`) rather than a long-lived queue-fed
   session.** The per-script invocation is the verified shape; a long-lived session is an S2
   optimisation to qualify. The driver still enforces one writer and role tags.
6. **Model allocation** (`docs/agents/model-policy.md`, user tiers 2026-09-26): Sonnet 5 medium for
   well-specified modules (PLA/rules/targets/snapshot, metrics, consumers, records, rounds, CLI,
   knowledge, contract test, dry-route fixtures); Opus 4.8 medium for the planner and per-task review;
   Opus 5.5 high for the final whole-branch review. Main agent: Fable 5.1 (this session).
7. **Customer data** stays machine-local. The offline P23 evaluation script and outputs live in the
   MAGE research directory, not in this repo. Site `linglong-mage` files are S2 work with the user.
8. **Python 3.9** on this Mac is the test interpreter; the Pack code must not use 3.10+ syntax.
9. **Budget** six hours time box, fifteen-minute closing reserve; to be tuned after S2.

## 13. Risks and falsifiers

- A repeated resident task rewriting a fixed output path trips a Harness identity check → the L2 dry
  route shows it in minutes; fall back to round-numbered paths bound through the carry.
- New-build `-plaCheckSize`, spacing or zone rules reject Case A moves → S2 shows it within an hour.
- DeepSeek flash cannot play a role reliably → S2 model run on frozen inputs; mitigation is more
  executable method in tools, not a different product model.
- Twenty resident sessions per Run are slow → measure in S2; reduce rounds or merge consumers whose
  models never conflict.
- Consumer models stay assumption-heavy → labelled; the demo shows the mechanism, not qualification.
- One real case only → derived variants are labelled synthetic; generality is not claimed.
- F8 identity anomaly (a Group label changes across stages) → `identity-unknown` class; never claim
  preservation across stages without the binding.
