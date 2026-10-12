# MAGE script-method placement Pack: design

| | |
|---|---|
| Date | 2026-10-12 |
| Status | Approved by the user in conversation (framing, bar, compaction ownership, MAGE access, shape, name, design sections); this document is the written record for review |
| Pack | `packs/mage-script-placement/` 0.1.0, status `development`, minimum Harness 0.3.0 |
| Branch | `feat/mage-script-placement`, worktree `.claude/worktrees/mage-script-placement`, forked from `feat/mage-scribe-placement` at `6b6699ec` |
| Sibling | `packs/mage-scribe-placement/` 0.2.0 (the planner-first, consumer-review Pack). Untouched by this work; its live Run A was in progress on the shared checkout when this spec was written |
| Brief | the MAGE research workspace (machine-local, contains customer data): the resident-agent brief directory dated 2026-10-12, and the customer-script handoff of the same date (English) with its reproduction evidence and helper tools |
| Precedent | `packs/agentic-timing-closure-system/` 0.4.7 and `packs/mage-scribe-placement/` 0.2.0 (resident engineering Task in a `hima-flow/1` sequence; one-writer MAGE driver; fail-closed Reader) |

Facts carry the brief's status letters: **V** verified on real bytes or a real run, **D** documented in
the vendor manual only, **A** assumption.

## 1. Problem and user outcome

Mask tape-out engineers place test structures in the scribe lanes of a full product Frame. The
customer's own method is a long vendor Tcl script: point-place the priority Groups at a target table
in request order (iterating the order until every Group is placed and the spatial order is close to
the requested order), **compact** the placed Groups to consolidate the adjustable gaps, **freeze**
them, and let Auto Refine **fill** the remaining structures. Whatever still finds no room is dropped.

On the MAGE build dated 2026-10-12 this method breaks in two places (**V**, handoff §4):

1. Editing the per-item `-arOffsetRange` settings after point placement invalidates every placed
   Fit while the 225 Group metadata records remain (the next snapshot holds 0 placed Fits).
2. After an explicit save/restore of the priority placement, the compaction call
   (`s_ARTestConvergePrplaced true` + converge settings + `smPFlow -autoRefine`) fails with
   `Sort sl <lane> preplaced fits failed` / `Failed at auto refinement`. The same sort message
   appears harmlessly in the successful no-compaction fill; it is fatal only in converge mode.

Reproduced native facts on that build (**V**): the no-compaction fill from the saved priority
placement drops 27 ordinary structures totalling 135,113 µm (225 priority Fits, 292 ordinary
Fits, 10 Fixed, all 319 ordinary requests accounted for). The customer's retained historical
artifact shows 18 ordinary drops / 52,453 µm plus one dropped priority Group of 616 µm; that result
has **not** been reproduced in the current environment.

Tracing a 1,000-line vendor script across its stage boundaries, isolating why a settings edit
invalidates state and why preplaced sorting fails, and re-implementing the compaction intent with
atomic commands over hundreds of cheap native iterations, is tedious for a person and routine for an
agent. **The user outcome:** a replayable, script-based placement solution demonstrated in real
MAGE, with an honest before/after comparison against the 135,113 µm baseline and the 52,453 µm
customer reference, reported at the kit's five proof levels (Reproduction, Improvement, Match,
Surpass, Customer completion), and with every number recomputed by Pack code from MAGE's own
exports. A smaller drop total obtained by deleting requests, losing Group associations, resizing
cells or relaxing rules is never an improvement.

## 2. Mechanism in one paragraph

One resident **MAGE Engineer** continues the customer's engineering pattern in real MAGE, writing
and repairing the Tcl itself. The customer's verified script is Site-bound reference material the
Engineer reads; it is never replayed by the Pack as a result. Each round, the Engineer authors one
or more Tcl **stage scripts** and runs each through the Pack's `mage-stage` driver, which wraps the
agent's Tcl in a prelude (open/build on the case, boundary snapshots, mid-script native checks), an
epilogue (the three native checks and the export with the completion marker), a refusal gate, and a
role-tagged session log. A `stage-report` tool turns every boundary snapshot into one table of
Fits, Groups, drops, order deviation, target distance, movement from the frozen start and native
counts — the stage-boundary trace the handoff asks for. The Engineer delivers its best stage as the
round's candidate together with a **method journal** entry (hypothesis, stages, native messages,
boundary metrics, conclusion). A fail-closed Reader re-derives every fact from the referenced
files. A program task ranks rounds by Reader values only, keeps the best state, and stops on goal
met, two rounds without improvement, or the round limit. The journal and the best state are the
only memory between rounds, so every round is a fresh resident session with its state in files.

## 3. Scope of this slice

| Part | Content | Needs |
|---|---|---|
| **S1 Pack** | contract, graph, schemas, program tasks, the `mage-stage`/`stage-report`/`candidate` subcommands, Reader, rules, semantics, knowledge, synthetic-fixture tests with a stand-in MAGE that understands the prelude, a Host contract test, an L2 dry route through the real Host | no licence, no model |
| **S2 native proof** | host-side `mage-stage` probes on Linglong (baseline reproduction first), the Site manifest update (reference method directory, reference notes), one live resident Run through the in-process real Host, the kit's independent evaluation and a cold replay | the permanent MAGE licence server (`59003@localhost`, 5 seats), coordination with the sibling Pack's live Run (one Site seat declared; host-side probes use their own output directories and never touch the other Run's Home, workspace or case copy) |

The deliverable bar the user set: Pack passes L1/L2, then a live Run reports the three stages
honestly — Reproduction (135,113 µm), Improvement, Match/Surpass (52,453 µm) if reached — and stops
at an honest bounded result. A quantified failure analysis of compaction is an acceptable ending.

## 4. Architecture

```
runInput: mageCaseManifest · siteCapabilities · workspaceRoot

sequence placement
├─ prepare-case          program     verify digests (incl. referenceMethod dir + referenceNotes); build startSnapshot; round-0 decision; empty journal
├─ measure-incumbent     program     evaluate the retained incumbent (modelled); ordinaryPopulation anchor
├─ repeat script-rounds      maxIterations 6 · carry roundState · stop when decide-round.route == "stop"
│  └─ sequence round
│     ├─ engineer-script       resident  licences {mage: 1}   → scriptCandidate   (Reader mage-script-candidate)
│     └─ decide-round          program   rank by Reader values, best state, journal, route continue|stop → roundDecision, scriptResult
├─ evaluate-placement    program, budget closing   goalMet against eight rules; proof level; comparison vs incumbent
└─ deliver               program, budget closing   REPORT.md + package
```

Why this shape: it is the proven `hima-flow/1` `repeat` with a resident task, unchanged Harness
(`durable-task-adapters.ts` outsourcing wiring, Reader rejection returns to the same task as a
repair message). One role per round keeps the round cheap (one resident session and one Reader
Job per round instead of five). Every round is a fresh OpenCode session; the user's compaction-gate
rule (state outside conversational memory) is satisfied by the journal.

**Not used.** Consumer roles, Requests, Ledger, Decision Requests, `agentTeams`, Workshops, OpenCode
subagents, HimaTeam. The exact slot planner (`planner.py`) and `lanes.py` are kept as **optional**
agent tools (`plan-slots`, `lane-view` stay available) but are not the mandated method.

Ownership follows `docs/agents/polishing-discipline.md`: the Pack owns method, driver, Readers,
rules and knowledge; the Harness is unchanged; the Site owns the MAGE install, licence, case data,
sandbox and the reference material.

## 5. The Pack, file by file (fork map)

```
packs/mage-script-placement/
  INTENT.md  SPEC.md  FABRIC.md  TEST.md                      rewritten for the script method
  contract.yml  graph.yml  semantics.yml  schemas/tasks.json  rewritten (§6, §9, §10)
  flow/mage_placement_cli.py          KEEP: task-* dispatch, snapshot, lane-view, plan-slots, flow-digest, _resolve_in_workspace
                                      REMOVE: evaluate, review, consumer-review fallback, mage-round, placement-candidate fallback
                                      NEW: mage-stage, stage-report, candidate (rewritten), journal-validate, script-candidate fallback
  flow/mage_placement/
    core.py pla.py rules.py targets.py lanes.py snapshot.py planner.py   KEEP verbatim (attributed fork)
    metrics.py        KEEP + EXTEND: order_deviation gains lr/tb maxima; displacement gains a priority block (§8.1)
    records.py        REWRITE: validate stage-summary, stage-report, journal-entry, script-candidate, round-decision, script-result
    rounds.py         REWRITE: decide() without reviews/requests (§9)
    tasks.py          KEEP prepare-case/measure-incumbent (minus consumer evaluation; plus reference refs); REWRITE decide-round, evaluate-placement, deliver
    native/tcl.py     KEEP
    native/session.py REWRITE as the stage driver (§7); slice_verify/write_verify_files KEEP
    native/prelude.tcl  NEW: hima_open_build, hima_snapshot, hima_check, case variables
    native/epilogue.tcl NEW: final verify-all + export + MAGE_ROUND_END
  flow/templates/     REMOVE (replaced by prelude/epilogue; open-build/verify-all/export text folded in verbatim)
  flow/consumer_models/   REMOVE
  flow/schemas/{case-manifest,snapshot,slot-plan,stage-summary,stage-report,journal-entry,method-journal,
                script-candidate,round-decision,script-result}.json
  flow/tests/         fixtures.py KEEP+EXTEND (reference dir, notes); standin_mage.py REWRITE (§11); tests per module
  readers/mage-script-candidate.yml   tools/read-mage.py (one kind: script-candidate)
  rules/{placement-delivery-ready,priority-all-placed,no-native-violation,drops-within-goal,target-limit-met,
         order-lr-within-goal,order-tb-within-goal,priority-move-within-budget}.yml
  knowledge/script-method-playbook.md  mage-capabilities.md  state-and-evidence.md  reference-method-guide.md  role-script-engineer.md
test/contract/mage-script-placement.test.ts
test/contract/mage-script-placement-durable.host.test.ts  test/contract/support/mage-script-durable-worker.ts
test/fixtures/mage-script-dry/{prepare.py,acp.py}
test/contract-groups.json   register both
```

Every kept module keeps its docstring attribution to the sibling Pack and its tests. No customer
data enters the repository: fixtures are synthetic; the real script, case and probe notes live on
the Site.

### 5.1 `contract.yml`

- `id: mage-script-placement`, `version: 0.1.0`, `status: development`,
  `minimumHarnessVersion: 0.3.0`.
- `budget: {timeBoxMs: 21600000, closingReserveMs: 900000, minimumGenerations: 1}` (six hours; a
  round may run several MAGE stages; tune after S2).
- Inputs: `mageCaseManifest`, `siteCapabilities`, `workspaceRoot`. (`consumerContext` is not an
  input; the Site's extra binding is tolerated — asserted by the contract test.)
- Outputs:

  | name | path | reader |
  |---|---|---|
  | `caseReadiness` | `state/case-readiness.json` | |
  | `startSnapshot` | `state/start-snapshot.json` | |
  | `incumbentMeasure` | `state/incumbent.json` | |
  | `roundDecision` | `state/round-decision.json` | |
  | `methodJournal` | `state/method-journal.json` | |
  | `scriptCandidate` | `state/round/script-candidate.json` | `mage-script-candidate` |
  | `scriptResult` | `state/script-result.json` | |
  | `placementEvaluation` | `state/placement-evaluation.json` | |
  | `finalReport` | `delivery/report.json` | |

- `workspace: {source: pack, copy: [mage_placement_cli.py, mage_placement, schemas]}`.
- Goal (all `number`):

  | knob | unit | default | meaning |
  |---|---|---|---|
  | `target_dropped_count` | count | 0 | total dropped structures allowed |
  | `max_target_distance_um` | um | 100 | along-lane distance of a priority mark from its CT target |
  | `max_order_deviation_lr` | rank | 2 | customer per-side check: LR flags deviation ≥ 3 |
  | `max_order_deviation_tb` | rank | 1 | customer per-side check: TB flags deviation ≥ 2 |
  | `max_priority_move_um` | um | 100 | movement of a priority mark from the frozen start, by optimisation; explicit, Run-settable, never assumed |

- Strategy: `incumbentComparison: choice [retained, native] default retained` (as the sibling).
- Program tools on the ATCS ABI (`task-<name> ${WORKSPACE} ${TASK_INPUT} ${TASK_OUTPUT}`):
  `prepare-case`, `measure-incumbent`, `decide-round`, `evaluate-placement`, `deliver`.
- Resident tool `engineer-script`: `outsourcing.role: resident-engineering-agent`; `licences:
  {mage: 1}`; `reads: [caseReadiness, startSnapshot, incumbentMeasure, roundDecision,
  methodJournal]`; `knowledge: [script-method-playbook.md, mage-capabilities.md,
  state-and-evidence.md, reference-method-guide.md, role-script-engineer.md]`; `artifactPrefix:
  placement`; `produces: scriptCandidate`; inputs `WORKSPACE, ROUND, TARGET_DROPPED,
  MAX_TARGET_DISTANCE_UM, MAX_ORDER_DEVIATION_LR, MAX_ORDER_DEVIATION_TB, MAX_PRIORITY_MOVE_UM`;
  batch argv validates an existing candidate only (`script-candidate` fallback). Its `description`
  is the Engineer's complete brief (the Harness sends it as the task text).

### 5.2 `graph.yml`

| Task | Inputs | Output value |
|---|---|---|
| `prepare-case` | runInput manifest, capabilities; the five goal values | verifies every manifest digest including `referenceMethod` (a directory ref: every file listed with sha256) and `referenceNotes[]`; parses rule/pblock/block/targets/request order/start/incumbent PLAs; `startSnapshot`; `case-readiness.json` (goal, manifest, siteCapabilities, reference refs); round-0 `round-decision.json`; empty `method-journal.json` |
| `measure-incumbent` | committed `prepare-case`; strategy | incumbent snapshot, metrics (drops split, target distances with identity label, order deviation per side, displacement incl. priority block), `ordinaryPopulation` |
| `repeat script-rounds` | `carry.roundState` initial `{round: 1}`, next `decide-round.nextRound`; `stop` = `decide-round.route == stop`; `maxIterations: 6`; `budget: original-run` | |
| `engineer-script` | `ROUND`, goal values | Reader-verified `mage.script-candidate/1` |
| `decide-round` | committed `engineer-script` Reader value; `ROUND`; goal values | rank, best state, journal append, `route`, `nextRound`, `state/script-result.json` |
| `evaluate-placement` (`closing`) | committed `decide-round` value; `measure-incumbent` value; goal | eight rules, `goalMet`, proof level, comparison |
| `deliver` (`closing`) | committed evaluation | `delivery/report.json`, `delivery/REPORT.md`, `delivery/placement-artifacts.tar.gz` |

### 5.3 Site documents

`mage.case-manifest/1` keeps every existing field and gains:

- `referenceMethod` (**required** for this Pack): `{"dir": <abs path>, "files": [{"path", "sha256"}, ...]}` — the
  customer's `run_tcl/` directory on the Site (entry script, target CSV, generated request files,
  saved per-side placement files). `prepare-case` verifies every listed file. The Pack never
  sources any of them as a result; the Engineer reads them.
- `referenceNotes` (optional): `[{"path", "sha256", "title"}]` — Site-local reference documents
  (the handoff's compatibility patch and state-roundtrip patch, the sibling session's probe notes).
  Verified by digest, read-only.
- `referenceOrdinaryDropLengthUm` (optional number): the customer reference method's retained
  ordinary dropped length, used only by the proof-level report (§8.4). Absent → the `match` and
  `surpass` levels read `n/a`.
- `mage.autoRefineConverge` (existing optional) stays the fill's converge settings.

`siteCapabilities` is unchanged. The existing Site `linglong-mage` is reused; its manifest on the
Site gets a new stamped version with the two fields above (machine-local, customer data).

## 6. The Engineer round protocol

Each round the Engineer (fresh session) reads, from its private workspace copies:
`state/case-readiness.json`, `state/start-snapshot.json`, `state/incumbent.json`,
`state/round-decision.json` (best state so far, history, stop reasons) and
`state/method-journal.json` (every earlier round's entries). Then:

1. **Plan** one hypothesis for this round and write it down first (the journal entry's
   `hypothesis` field), choosing from the playbook's action order (§10).
2. **Author** one or more Tcl stage scripts in `placement/round-NN/stage-K.tcl` (K ≥ 1). It may
   also write helper Python under `placement/round-NN/tools/` (for example to compute explicit
   compaction moves from a boundary snapshot and emit a complete PLA or a `frbSelect`/`frbMove`
   sequence).
3. **Run** each stage with `mage-stage --round N --script <file> --out-dir placement/round-NN/stage-K
   [--timeout-s S]`, then `stage-report --stage-dir placement/round-NN/stage-K --out <file>` to read
   the boundary table.
4. **Choose** the stage whose final export is the round's candidate (usually the last completed one;
   a failed later stage does not disqualify an earlier completed one).
5. **Journal**: write `placement/round-NN/journal-entry.json` (`mage.journal-entry/1`: round,
   hypothesis, stages `[{script sha, outcome, stage error message, boundary names}]`, observations,
   conclusion, nextStep).
6. **Assemble** with `candidate --round N --stage-dir placement/round-NN/stage-K --journal
   placement/round-NN/journal-entry.json --out state/round/script-candidate.json` and write the
   resident delivery wrapper naming the candidate as the single `result` artifact and every file
   under `placement/round-NN/` as `support`.

**Round 1 is fixed**: reproduce the native baseline — `hima_open_build`, `source` the frozen start
PLA, the manifest's converge settings, `g_params ... false`, `smPFlow -autoRefine`. Its Reader
values are the Reproduction level; nothing else is attempted in round 1.

**Fixed boundary.** The Engineer never edits the rule file, the pblock/block files, the target
table, the request order, the Goal limits, or any Site file. It may change *settings* through Tcl
(a documented compaction mode is a method choice) but a change that alters what placements are
allowed is a rule edit and is prohibited; the playbook states the distinction and the Reader's
inventory conservation refuses the typical consequences (lost structures, changed footprints are
caught by `-plaCheckSize`/exact block checks and the inventory check).

## 7. The `mage-stage` driver

`native/session.py` becomes `MageSession.run_stage(stage_dir, script_path, role, timeout_s)`:

1. **Refusal gate** (before anything is written): the agent script is refused when it contains
   `\bexit\b`, `\bfrbOpen\b`, `MAGE_VERIFY`, `MAGE_ROUND_END`, `MAGE_SNAPSHOT`, `MAGE_STAGE_ERROR`
   (marker forgery), or when `role != engineer` (every stage is mutating by construction). Refusal
   codes: `experiment` (forbidden text), `writer`, `stage-exists` (`stage.tcl` already present).
2. **Assembly**: `stage.tcl` = prelude (filled with the case paths) + agent script bytes verbatim
   (also copied to `script.tcl`, sha recorded) + epilogue, wrapped in one `catch` with a stage
   variable the prelude updates at each `hima_*` call, so a failure names the last boundary passed.
3. **Run** `<executable> stage.tcl -noterm` with `cwd=stage_dir`, the Site env, a process group and
   the timeout; capture `out/stdout.log`/`out/stderr.log`.
4. **Collect**: `write_verify_files` from markers; `out/export.pla`, `out/summary.txt`; every
   `out/snap-NN-<name>/placement.pla` + `summary.txt` the prelude wrote; completion =
   returncode 0 ∧ not timed out ∧ `MAGE_ROUND_END code 0` present. `stage-summary.json`
   (`mage.stage-summary/1`): round, stage, role, scriptSha256 (agent text), stageSha256 (assembled),
   completed, returncode, timedOut, lastBoundary, stageError (the `MAGE_STAGE_ERROR` line if any),
   snapshots `[{name, index, pla path+sha, summary path}]`, exportSha256, stdoutSha256,
   verifyFiles, startedAt/endedAt.
5. **Log**: append one line to `placement/round-NN/session.jsonl` (role, scriptSha256,
   stageSha256, completed, exportSha256, stdoutSha256, timing). The log is shared by every stage
   of the round and lives under the Engineer's `artifactPrefix`.

**Prelude** (`native/prelude.tcl`, filled by `tcl.fill`, V-status commands only):

```tcl
set hima_case_frb   {@FRB@}          ;# the manifest FRB
set hima_case_dir   {@CASE_DIR@}     ;# the manifest's case directory (read-only)
set hima_start_pla  {@START_PLA@}    ;# the frozen start state
set hima_out        {@OUT@}
set hima_stage_boundary "prelude"
set hima_snap_index 0
proc hima_open_build {args} {         ;# the proven route; extra build flags pass through (e.g. -dropInWithoutExtSL)
    global hima_case_frb hima_stage_boundary
    frbOpen $hima_case_frb ; frbSetCur frame ; smPFlow -updateUsedFiles ; frbSetup -obj BuildFrame
    smPFlow -clear ; smPFlow -bindBlocks
    eval smPFlow -buildFrame frame -mchip mainchip -mblock mainchip $args
    smPFlow -sortFix ; smPFlow -sortFit
    set hima_stage_boundary "open-build"
}
proc hima_snapshot {name} {           ;# boundary snapshot: saveMark + saveSummary + marker
    global hima_out hima_snap_index hima_stage_boundary
    incr hima_snap_index
    set dir [file join $hima_out [format "snap-%02d-%s" $hima_snap_index $name]]
    file mkdir $dir
    smPInstMgr -saveMark [file join $dir placement.pla]
    smPFlow -saveSummary [file join $dir summary.txt]
    puts [list MAGE_SNAPSHOT $hima_snap_index $name] ; flush stdout
    set hima_stage_boundary $name
}
proc hima_check {} { ...the verify-all foreach with MAGE_VERIFY_* markers, tagged with the current snapshot index... }
```

The epilogue is the verify-all block (final, untagged, the one the Reader reads) followed by the
export (`smPInstMgr -saveMark {@OUT@/export.pla}`, `smPFlow -saveSummary {@OUT@/summary.txt}`,
`puts [list MAGE_ROUND_END code 0]`). On a caught error the wrapper prints
`MAGE_STAGE_ERROR boundary <last> message <msg>` to stderr and exits 2 (the vendor launcher masks
exit codes; the marker is the truth).

`hima_open_build` is the only way to open the case: `frbOpen` in agent text is refused, so a stage
can never open another file. Every other MAGE command is allowed in agent text; the knowledge
marks each as V or D and requires one passing and one failing stage before a D command is relied on.

**`stage-report`** (`mage.stage-report/1`): for each snapshot in a stage (and the final export) —
Fixed count, Group count, in-group Fits, ordinary Fits, ordinary/grouped drops (count, length),
inventory check result against the start and the incumbent population (as `pass|fail|n/a` with
the reason), target distance (max, over-limit count, identity label), order deviation per side,
priority movement from the frozen start (moved count, max, total), native counts when a
`hima_check` preceded the snapshot. A Group-less snapshot (the "Fits invalidated" state) reads
0 in-group Fits with the Group count intact — exactly the failure signature the handoff describes.

## 8. Measurement, Reader and rules

### 8.1 Metrics (`metrics.py`, kept and extended)

- `drops`: unchanged (count, lengthUm, byBlockType, ids, ordinary/grouped split, rule shortfall).
- `target_distances`: unchanged (along-lane |centre − CT|, over-limit count, identity label).
- `order_deviation`: unchanged per-side computation; **adds** `maxLr = max(LR-left, LR-right)` and
  `maxTb = max(TB-bottom, TB-top)` (each unknown when a side is unknown), keeping `max`.
- `displacement`: **adds** `priority: {movedCount, maxUm, totalUm, matched, unmatched}` over
  in-group Fits. A priority Fit is matched to its start Fit by exact id; when MAGE re-suffixed or
  re-mastered it, by `(pinstGroup)` when that Group holds exactly one in-group Fit on both sides;
  otherwise it is `unmatched` and the maximum is unknown (identity-unknown, never 0).
- `native_rows`: unchanged.

### 8.2 Reader `mage-script-candidate` (`tools/read-mage.py`, one kind)

Fail-closed as the sibling (exit 3, `OUT` unwritten on refusal). Steps: schema-validate the
candidate and its journal entry; re-hash every referenced file (agent `script.tcl`, assembled
`stage.tcl`, export, snapshot, verify files, every boundary snapshot PLA, session log, journal
entry); re-parse the export and rebuild the snapshot (sha must match); inventory conservation
(Fixed set, Group labels, per-Group in-group count, ordinary population from
`state/incumbent.json`); session-log audit — every logged stage is role `engineer`, and for a
`completed` candidate the log holds an entry whose `stageSha256` equals the delivered `stage.tcl`
sha, whose `exportSha256` equals the delivered export sha, and whose `completed` is true (the
delivered stage need not be the last one logged); recompute every emitted fact. Emits, in order:

```
mage_candidate_error_count, mage_priority_unplaced_count,
mage_dropped_count, mage_dropped_length_um, mage_dropped_ordinary_count, mage_dropped_ordinary_length_um,
mage_target_distance_max_um, mage_target_over_limit_count,
mage_order_deviation_max, mage_order_deviation_max_lr, mage_order_deviation_max_tb,
mage_priority_move_max_um, mage_priority_moved_count,
mage_native_overlap_rows, mage_native_space_rows, mage_native_boundary_rows, mage_native_violation_total
```

A blocked candidate (no completed export) reads error 0 and every other fact unknown.

### 8.3 Rules (`evaluate-placement` reads the best state's Reader values)

| Rule | Predicate |
|---|---|
| `placement-delivery-ready` | `mage_candidate_error_count` eq 0 |
| `priority-all-placed` | `mage_priority_unplaced_count` eq 0 |
| `no-native-violation` | `mage_native_violation_total` eq 0 |
| `drops-within-goal` | `mage_dropped_count` lte `target_dropped_count` |
| `target-limit-met` | `mage_target_distance_max_um` lte `max_target_distance_um` |
| `order-lr-within-goal` | `mage_order_deviation_max_lr` lte `max_order_deviation_lr` |
| `order-tb-within-goal` | `mage_order_deviation_max_tb` lte `max_order_deviation_tb` |
| `priority-move-within-budget` | `mage_priority_move_max_um` lte `max_priority_move_um` |

`goalMet` = all eight PASS. An unknown value makes its rule UNKNOWN and `goalMet` false.

### 8.4 Proof level (`evaluate-placement`, reported, never a rule)

From the best state's ordinary dropped length L and the incumbent's `ordinaryPopulation`:
`none` (no completed round), `reproduction` (L equals the incumbent's modelled ordinary length
within 0.5 µm and inventory conserved), `improvement` (L below the incumbent's, all priority placed,
inventory conserved), `match` (L ≤ the manifest's optional `referenceOrdinaryDropLengthUm` with all
priority placed), `surpass` (strictly below it with every rule PASS except possibly
`drops-within-goal`), `completion` (all rules PASS and L = 0). The reference value, when present,
is a manifest field (`referenceOrdinaryDropLengthUm`, a number), not a Pack constant.

## 9. Round decision (`rounds.py`, rewritten)

Ranking key (Reader values only; smaller is better; unknown sorts worst): native violation total →
priority unplaced → ordinary dropped count → ordinary dropped length → target over-limit count →
`max(order lr, order tb)` → priority moved count → priority move max. A candidate whose Reader
errored, is blocked, or has no values is never ranked.

Route (checked in this order): round limit reached (6) → `stop`; candidate blocked → `continue`
("round N blocked; continuing"); all eight rules PASS on the best state → `stop` ("goal met"); two
consecutive non-improving rounds after round 1 → `stop` ("no improvement for two consecutive
rounds"); else `continue`. Round 1 counts as improved over nothing.

`decide-round` also appends the round's validated journal entry (copied from the candidate's
referenced file) to `state/method-journal.json` (`mage.method-journal/1`: entries[], bestRound,
history), archives the candidate under `state/history/round-NN/candidate.json`, and writes
`state/script-result.json` (`mage.script-result/1`: best, rounds[], journal ref, outcome
`completed|best-effort|blocked`, stopReason).

## 10. Knowledge (flat `.md`; customer-neutral)

| File | Contents |
|---|---|
| `script-method-playbook.md` | the four stages of the reference method (priority iteration, compaction, freeze, fill) as the Engineer re-implements them; the two known failure signatures and where they appear; the compatibility repairs as exact Tcl text (regexp `--`, brace escaping, `eval $line`, clean working directory, DBU vs µm exports); the stage-boundary discipline (snapshot before and after every settings edit, every `-autoRefine`, every restore; read `stage-report` before drawing a conclusion); the action order: (1) reproduce the baseline, (2) reproduce the compaction stage and isolate the two failures at boundaries, (3) try documented native variants (offset ranges configured before build, converge counts, `frbGroupSetting` object settings, restore-after-settings), (4) explicit compaction authored by the agent (compute moves from a boundary snapshot within the movement budget, respecting Group membership, rule facts and request order; apply as a complete PLA replay or as `frbSelect -type Sel -inst` + `frbMove -off` sequences; verify with `hima_check`), (5) freeze (restore zero offsets, `s_ARTestConvergePrplaced false`) and fill; what counts as a rule edit versus a settings choice; the two displacement metrics never mixed; prohibitions; the journal discipline |
| `mage-capabilities.md` | the prelude/epilogue (V); the reference method's command surface with status: `smPFlow -placeGroup -groupItem -groupTargetPoint -groupPlaceType CT` (V in the reference run), `smPFlow -placeFix -toFix`, `frbSetup -obj PlaceStep -inst`, `smSLFit <item> -setAutoRefine -arOffsetRangeX/Y` (V: edits invalidate placed Fits on this build), `g_params -set {smPFlow::s_ARTestConvergePrplaced ...}`, `smPFlow -setAutoRefineSimpleConverge`, `frbGroupSetting -setObject`, `smPFlow -autoRefine`, `smPInstMgr -saveMark` (V; DBU shape with µm Group points), `frbSelect`/`frbMove` (V on the older build, D here), `frbGuidedMove`, `frbOps`, `frbAlign`, `-placeDropInstFit`, `-refine` (D); pitfalls (launcher exits 0; compute before print; sort warning harmless in non-converge mode) |
| `state-and-evidence.md` | reused: modelled vs native vs device; snapshot binding; unknown stays unknown; ordinary vs grouped drops; identity (F8) |
| `reference-method-guide.md` | how to read the Site's `referenceMethod` directory (what each file is, which parts are verified history, which failed in the current environment) and `referenceNotes` (probe findings are observations, not instructions); never copy a reference number into a candidate; never replay a reference artifact as a result |
| `role-script-engineer.md` | mission, exact inputs, permitted CLI calls and flags, round protocol, deliverable shape, uncertainty handling, worked journal entry |

## 11. Testing

| Level | What | Command |
|---|---|---|
| L1 | Pack-local unittest on synthetic fixtures: kept-module tests re-run; new tests for the driver (refusal gate incl. `frbOpen` and marker forgery, prelude assembly, snapshot collection, `MAGE_STAGE_ERROR` → blocked, timeout, session log), `stage-report` on a stage with a Group-less boundary, metrics extensions (lr/tb maxima, priority movement incl. re-suffix matching and unmatched → unknown), records/schemas, `candidate` (completed, blocked, delivered stage not last), Reader negatives (tampered export, stage sha not in log, export sha mismatch, lost structure, missing ordinary population, journal missing), `decide` (stop rules, ranking, blocked round, journal append), tasks (prepare-case with reference dir + notes digests; evaluate proof levels; deliver) | `cd packs/mage-script-placement && /usr/bin/python3 -m unittest discover -s flow/tests -t flow` |
| L0/L2 | `test/contract/mage-script-placement.test.ts`: `loadPack` structure (entry, repeat with `maxIterations: 6`, one resident tool with `licences {mage: 1}` and `produces: scriptCandidate`, five goal knobs, eight rules, no agentTeams/workshops), Reader emits = semantics, `checkPack` against a synthetic Site with `licences {mage: 1}` (fit), without (refuse), and against the real `sites/linglong-mage` files including their extra `consumerContext` binding (fit) | `pnpm run build && pnpm run test:local -- --files test/contract/mage-script-placement.test.ts` |
| L2 dry route | `test/contract/mage-script-placement-durable.host.test.ts` + worker + `test/fixtures/mage-script-dry/{prepare.py,acp.py}`: stand-in ACP Engineer writes real stage scripts and drives the deployed CLI; stand-in MAGE (`flow/tests/standin_mage.py`) interprets the prelude procs and a small Tcl subset (`source <pla>`, `smPFlow -placeGroup`, `smPFlow -autoRefine` fill, `hima_snapshot`, `hima_check`, export); three scenarios: `converge` (round 1 baseline, round 2 improved PLA, goal met → stop at round 2), `stall` (same candidate every round → stop at round 3 by two stalls), `blocked` (round 1 fails after a named boundary via `MAGE_STANDIN_FAIL_AFTER_SNAPSHOT`, round 2 completes); asserts rounds, task counts (`2 + 2·rounds + 2`), one Reader Job per resident execution, every Reader reading `error_count 0`, journal entries = rounds, `goalMet` | registered in `test/contract-groups.json` group `atcs-dry` |
| L4 host-side probes (S2) | `mage-stage` run from a scratch workspace on Linglong against the staged case with the real binary: baseline reproduction (27 / 135,113 µm, 319 inventory) and one deliberately failing stage (compaction call) to confirm `MAGE_STAGE_ERROR`, boundary snapshots and blocked handling on the real tool | manual, evidence retained machine-locally |
| L4 live (S2) | one live Run via a machine-local in-process Host worker (copy of the sibling's `live-worker.ts` with `packId` changed), real Site, real OpenCode (DeepSeek flash), fresh Home; then the kit's `evaluate.py` on the delivered export and a cold replay of the delivered `stage.tcl` through `mage-stage` in a fresh directory (export sha must match) | manual, user-watched |

No model is the first producer tested against a schema: every model-written document (stage script
gate, journal entry, candidate) has an admitted fixture, a validator and a Reader negative.

## 12. Live proof procedure (S2)

1. Confirm `lmstat -a -c 59003@localhost` shows MAGE features UP with free seats; confirm the sibling
   Pack's Run (if still active) is not in its `engineer-place` task before starting a resident Run
   (host-side probes may run concurrently; they use their own output directories).
2. Stamp a new Site manifest version with `referenceMethod` (the case's `run_tcl/` directory) and
   `referenceNotes` (the handoff's two patches and the sibling probe notes copied to the Site);
   record its sha in the Site README (no customer values in the repo).
3. Host-side probes (§11 L4) from `/home/luzi/tmp/mage-script-probe-NN/`.
4. Live Run A': goal `target_dropped_count 0`, `max_target_distance_um 100`,
   `max_order_deviation_lr 2`, `max_order_deviation_tb 1`, `max_priority_move_um 100`,
   `incumbentComparison retained`. Expected honest outcomes: round 1 Reproduction; later rounds
   reach Improvement or report a quantified compaction failure analysis in the journal.
5. Independent evaluation with the kit's `evaluate.py`; reconcile ordinary length/count, 225
   priority, 10 Fixed, 319 inventory with `state/script-result.json`.
6. Cold replay of the delivered stage.
7. Report: baseline / Run / customer reference table, proof level, open checks (SPACE instance row,
   8 exact-block mismatches, missing tech `a`), journal digest, elapsed and MAGE time.

## 13. Decisions taken in this session without the user

1. The fork commit is `6b6699ec` (the sibling branch's head at fork time); the worktree lives at
   `.claude/worktrees/mage-script-placement` because the sibling session is editing the shared
   checkout.
2. `maxIterations: 6` (the sibling uses 4): a script-method round is one resident session and one
   Reader Job, so six rounds cost about what four sibling rounds did.
3. Two order knobs (`lr`, `tb`) rather than one, following the reference script's own per-side
   thresholds; `IN` stays reported but unchecked, as in the reference.
4. `max_priority_move_um` default 100 with the knob explicit in every report; the handoff forbids
   assuming a universal 100 µm allowance, so the Run sets it and the report names it.
5. The proof level is reported by `evaluate-placement`, not enforced by a rule; the reference
   length is a manifest number, not a Pack constant.
6. `plan-slots`/`lane-view` stay as optional tools; the planner module is kept rather than deleted
   so the Engineer can still ask for exact slot feasibility.
7. Model allocation per `docs/agents/model-policy.md` and the sibling plan's user-approved tiers:
   Sonnet 5 medium for well-specified forks and tests; Opus 4.8 medium for the driver/Reader
   integration and per-task review; Opus 5.5 high for the final whole-branch review. Main agent:
   Fable 5.1 (this session). Native probes and the live Run: the main agent with the user.
8. Python 3.8-compatible standard library only (the resident container runs 3.8.16).

## 14. Risks and falsifiers

- The agent's Tcl may need commands the stand-in does not model → the stand-in ignores unknown
  lines and the live probe is the falsifier; the dry route proves wiring, not MAGE behaviour.
- Native compaction may be unfixable on this build → the ending is a journal with the isolated
  failure, the explicit-compaction attempts and their numbers; still a complete delivery.
- Explicit compaction may violate spacing rules MAGE enforces → `hima_check` after every move set;
  the Reader's native total ranks it out.
- DeepSeek flash may author weak Tcl → the playbook carries exact command text and the
  reference script is readable on the Site; mitigation is more executable method in knowledge, not a
  different product model.
- The sibling Run and this Pack share one Site seat declaration → sequence resident Runs; host
  probes use their own directories.
- A re-mastered priority Fit breaks movement matching → reported `unmatched`, rule UNKNOWN, never a
  silent 0.
