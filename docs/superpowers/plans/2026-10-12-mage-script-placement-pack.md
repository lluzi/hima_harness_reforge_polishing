# MAGE Script-Method Placement Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `packs/mage-script-placement/` 0.1.0: a HimaPack in which one resident MAGE Engineer per round writes and repairs Tcl stage scripts that continue the customer's placement workflow (priority → compaction → freeze → fill) in real MAGE, with a Pack-owned stage driver, boundary snapshots, a method journal, a fail-closed Reader and a program round decision; then prove it natively on Linglong.

**Architecture:** Fork of `packs/mage-scribe-placement` at `6b6699ec`. One `hima-flow/1` sequence: `prepare-case` → `measure-incumbent` → `repeat script-rounds (max 6) { engineer-script → decide-round }` → `evaluate-placement` → `deliver`. The kept Python modules (`core`, `pla`, `rules`, `targets`, `lanes`, `snapshot`, `planner`, `metrics`) are reused verbatim or extended; the consumer-review machinery is removed; `native/session.py` becomes the stage driver that wraps agent Tcl in a prelude/epilogue; `tools/read-mage.py` reads one document kind.

**Tech Stack:** Python 3.8-compatible standard library (`unittest`), YAML/JSON Pack declarations, TypeScript `node:test` contract tests through `@hima/harness`, the resident wrapper `sites/linglong-atcs28/templates/resident-engineering-wrapper.py` with `sandbox.kind: none, testOnly: true` for the dry route.

**Spec:** `docs/superpowers/specs/2026-10-12-mage-script-placement-pack-design.md` (read it first; section numbers below refer to it). **Spec amendment recorded here (§5.3/§4):** the sibling Pack's manifest schema is closed (`additionalProperties: false`), so the new Pack binds its **own** Site manifest file and therefore its **own Site** `sites/linglong-mage-script/` (same host, permit, capability, workspace root and seat as `linglong-mage`; only the manifest binding differs and there is no `consumerContext` binding). `referenceMethod` stays a `fileRef` (the entry script, required for this Pack); the directory's other files are `referenceFiles[]`.

## Global Constraints

- Pack id `mage-script-placement`, version `0.1.0`, `status: development`, `minimumHarnessVersion: 0.3.0`.
- Budget `timeBoxMs: 21600000`, `closingReserveMs: 900000`, `minimumGenerations: 1`.
- Goal knobs (all `type: number`): `target_dropped_count` (count, 0..100000, default 0), `max_target_distance_um` (um, 0..100000, default 100), `max_order_deviation_lr` (rank, 0..1000, default 2), `max_order_deviation_tb` (rank, 0..1000, default 1), `max_priority_move_um` (um, 0..100000, default 100). Strategy: `incumbentComparison: choice [retained, native] default retained`.
- Round loop `maxIterations: 6`, `budget: original-run`, carry key `roundState`, stop when `decide-round` output `route == "stop"`.
- Python 3.8-compatible standard library only in `flow/` and `tools/` (no `Path.is_relative_to`, no `str.removeprefix`, no `dict | dict`, no `match`, keep `from __future__ import annotations`). Test interpreter on this Mac: `/usr/bin/python3` (3.9.6).
- Knowledge file names are flat (`^[A-Za-z0-9][A-Za-z0-9._-]*\.(md|txt|pdf)$`). Reader argv placeholders are only `READER`, `REPORT`, `OUT`, `WORKSPACE`; the Reader emits exactly its declared set every call; `value: null` always carries `unknownReason`; the Reader fails closed (exit 3, `OUT` unwritten) on any refusal.
- Resident support files are immutable once published and live under the Engineer's `artifactPrefix` `placement/round-NN/`; the result file `state/round/script-candidate.json` is overwritten each round.
- No customer data in the repository: no customer names, file names, coordinates or per-mark values. The aggregate benchmark figures (27 / 135,113 µm baseline; 18 / 52,453 µm reference; 225 priority; 319 ordinary; 10 Fixed) may appear in documents. Fixtures are synthetic.
- Units: integer DBU inside the Pack; µm only at the boundaries. Native checks are exactly `OVERLAP`/`SPACE`/`BOUNDARY` (`frbCheckOverlap`/`frbCheckSpace`/`frbCheckBoundary`), counted by MAGE's own `<N> … instance(s)` line.
- Commits: `git -c user.name=lluzi -c user.email=lluzi@Luzis-MacBook-Air.local commit -F <msgfile>`; the message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; push to `origin feat/mage-script-placement` after every commit (the pre-push hook runs `check:local`, allow 15 minutes; the hook needs `PATH="$HOME/.local/node24/bin:$PATH" HIMA_POSTGRES_RUNTIME=/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/dbos-migration/u2/runtime-final CI=true` in the environment, otherwise every Host test fails with "Local PostgreSQL: the native runtime is missing"); confirm `git ls-remote origin refs/heads/feat/mage-script-placement` equals `git rev-parse HEAD`.
- Work only in the worktree `/Users/lluzi/code/hima_harness_reforge_polishing/.claude/worktrees/mage-script-placement`. Never edit `packs/mage-scribe-placement/` (the sibling session owns it).
- Model allocation (`docs/agents/model-policy.md`, user-approved tiers): Sonnet 5 medium (`tier-sonnet5-medium`) implements Tasks 1, 2, 3, 8, 9; Opus 4.8 medium (`tier-opus48-medium`) implements Tasks 4, 5, 6, 7, 10 and reviews every task; Opus 5.5 high (`tier-opus55-high`) does Task 11; the main agent (Fable 5.1) does Tasks 12 and 13 with the user.

---

## File map

| Path (under `packs/mage-script-placement/`) | Responsibility | Origin |
|---|---|---|
| `contract.yml`, `graph.yml`, `semantics.yml`, `schemas/tasks.json` | run contract, round loop, value semantics, task I/O schemas | rewritten (Task 7) |
| `flow/mage_placement_cli.py` | `task-*` ABI dispatch; resident subcommands `snapshot`, `lane-view`, `plan-slots`, `mage-stage`, `stage-report`, `candidate`, `script-candidate` (batch fallback), `flow-digest` | stripped (Task 1), new subcommands (Task 5) |
| `flow/mage_placement/{core,pla,rules,targets,lanes,snapshot,planner}.py` | unchanged kept modules | copied verbatim (Task 1) |
| `flow/mage_placement/metrics.py` | drops, target distance, order deviation (+ `maxLr`/`maxTb`), displacement (+ `priority` block), native rows | extended (Task 2) |
| `flow/mage_placement/records.py` | `validate_record` for the new document kinds | rewritten (Task 3) |
| `flow/mage_placement/rounds.py` | `rule_results`, `best_state_key`, `decide` | rewritten (Task 7) |
| `flow/mage_placement/tasks.py` | the five program tasks | rewritten (Task 7) |
| `flow/mage_placement/native/tcl.py` | Tcl quoting/filling | kept |
| `flow/mage_placement/native/session.py` | stage driver `MageSession.run_stage`, `slice_verify`, `slice_checks`, `write_verify_files`, refusal gate | rewritten (Task 4) |
| `flow/mage_placement/native/prelude.tcl`, `epilogue.tcl` | the Pack-owned Tcl around agent text | new (Task 4) |
| `flow/schemas/{case-manifest,snapshot,slot-plan,stage-summary,stage-report,journal-entry,method-journal,script-candidate,round-decision,script-result}.json` | document schemas | kept/extended/new (Task 3) |
| `flow/tests/fixtures.py` | synthetic 2×2 case (+ reference files, notes, reference length) | extended (Task 3) |
| `flow/tests/standin_mage.py` | stand-in MAGE that interprets `stage.tcl` | rewritten (Task 4) |
| `flow/tests/test_*.py` | unit tests per module | kept/rewritten per task |
| `readers/mage-script-candidate.yml`, `tools/read-mage.py` | fail-closed Reader, one kind | rewritten (Task 6) |
| `rules/*.yml` (eight) | delivery rules | rewritten (Task 6) |
| `knowledge/{script-method-playbook,mage-capabilities,state-and-evidence,reference-method-guide,role-script-engineer}.md` | Engineer knowledge | written (Task 8) |
| `INTENT.md`, `SPEC.md`, `FABRIC.md`, `TEST.md` | Pack documents | written (Task 8) |
| `sites/linglong-mage-script/{site.yml,permit.yml,README.md}` | the Site | new (Task 9) |
| `test/contract/mage-script-placement.test.ts` | L0/L2 Pack structure + `checkPack` | new (Task 9) |
| `test/contract/mage-script-placement-durable.host.test.ts`, `test/contract/support/mage-script-durable-worker.ts`, `test/fixtures/mage-script-dry/{prepare.py,acp.py}`, `test/contract-groups.json` | L2 dry route | new (Task 10) |

## Frozen interfaces (every task reads this section)

### Round directory layout (Engineer `artifactPrefix: placement`)

```
placement/round-NN/
  session.jsonl                 appended by every mage-stage call of the round (one line per stage)
  journal-entry.json            authored by the Engineer (mage.journal-entry/1)
  stage-K/                      one per mage-stage call (K >= 1)
    script.tcl                  the agent's Tcl, byte copy
    stage.tcl                   prelude + agent text + epilogue (what MAGE ran)
    stage-summary.json          mage.stage-summary/1 (written by mage-stage)
    stage-report.json           mage.stage-report/1 (written by stage-report; optional)
    out/stdout.log  out/stderr.log  out/export.pla  out/summary.txt  out/verify-<TYPE>.txt
    out/snapshot.json           candidate snapshot (written by candidate)
    out/snap-NN-<name>/placement.pla  out/snap-NN-<name>/summary.txt
state/round/script-candidate.json   the round's delivered result (mage.script-candidate/1)
```

### Stage driver (`flow/mage_placement/native/session.py`)

```python
NATIVE_TYPES = ("OVERLAP", "SPACE", "BOUNDARY")
NATIVE_COMMANDS = {"OVERLAP": "frbCheckOverlap", "SPACE": "frbCheckSpace", "BOUNDARY": "frbCheckBoundary"}
ENGINEER_ROLE = "engineer"
END_MARKER = "MAGE_ROUND_END code 0"
AGENT_BEGIN = "# hima:agent-begin"
AGENT_END = "# hima:agent-end"
FORBIDDEN_PATTERNS = (  # applied to the agent's script text, before anything is written
    r"\bexit\b", r"\bfrbOpen\b", r"MAGE_VERIFY", r"MAGE_ROUND_END", r"MAGE_SNAPSHOT",
    r"MAGE_STAGE_ERROR", r"MAGE_CHECK", r"\b(proc|rename)\s+hima_", r"hima:(prelude|agent)-(begin|end)",
)
def slice_verify(stdout_text) -> {TYPE: {"code": int|None, "instances": int|None, "lines": [str]}}   # kept
def slice_checks(stdout_text) -> {snap_index(int): {TYPE: {"code": int|None, "instances": int|None}}}  # MAGE_CHECK_* blocks
def write_verify_files(stdout_path, out_dir) -> {TYPE: path}   # kept
def snapshots_from_stdout(stdout_text, out_dir) -> [{"index": int, "name": str, "pla": path, "summary": path}]  # MAGE_SNAPSHOT lines whose dir exists
class MageSession:
    def __init__(self, executable, env, workdir, log_path, case)   # case: {"frb", "caseDir", "startPla"}
    def run_stage(self, stage_dir, script_path, role, timeout_s=1800) -> dict
    # refusals (before any write): MageError("experiment") forbidden pattern; MageError("writer") role != engineer;
    #   MageError("stage-exists") stage_dir/stage.tcl exists; MageError("timeout") timeout_s not in 60..14400
    # result: {"stageDir","scriptTcl","scriptSha256","stageTcl","stageSha256","returncode","timedOut","completed",
    #          "lastBoundary": str|None, "stageError": str|None, "exportPla": path|None, "exportSha256": str|None,
    #          "summary": path|None, "stdout": path, "stdoutSha256": str, "verifyFiles": {TYPE: path},
    #          "snapshots": [{"index","name","pla","summary","sha256"}], "checks": {str(index): {TYPE: {"code","instances"}}},
    #          "startedAt","endedAt"}
    # session log line: {"stageDir","role","scriptSha256","stageSha256","mutating": True,"returncode","timedOut",
    #                    "completed","exportSha256","stdoutSha256","startedAt","endedAt"}
```

`stage.tcl` layout (exact):

```
set mage_stage_code [catch {
<prelude.tcl filled: @FRB@ @CASE_DIR@ @START_PLA@ @OUT@>
# hima:agent-begin
<agent script bytes, verbatim>
# hima:agent-end
set hima_stage_boundary "epilogue"
<epilogue.tcl filled: @OUT@>
} mage_stage_message mage_stage_options]
if {$mage_stage_code} {
    puts stderr [list MAGE_STAGE_ERROR boundary $hima_stage_boundary message $mage_stage_message]
    exit 2
}
exit 0
```

`stageError` is the first stderr line starting with `MAGE_STAGE_ERROR`; `lastBoundary` is the token after `boundary` in it, else the last `MAGE_SNAPSHOT` name in stdout, else `None`.

### Stand-in MAGE (`flow/tests/standin_mage.py`) env knobs

`MAGE_STANDIN_ROWS` (JSON `{TYPE: [rows]}`, default none), `MAGE_STANDIN_FAIL=1` (fail before anything), `MAGE_STANDIN_VERIFY_FAIL=<TYPE>`, `MAGE_STANDIN_NO_END=1`, `MAGE_STANDIN_FAIL_AFTER_SNAPSHOT=<name>` (write that snapshot then `MAGE_STAGE_ERROR`, exit 2, no export, no end marker), `MAGE_STANDIN_CONVERGE_OK=1` (default unset: an `-autoRefine` while `s_ARTestConvergePrplaced` is `true` fails like the real build), `MAGE_STANDIN_DROP_BASES` (comma list, default `KEY_V`: fill records these pending bases as drops instead of placing them), `MAGE_STANDIN_OFFSET_INVALIDATES` (default `1`: an `smSLFit … -setAutoRefine -arOffsetRange…` line empties the placed Fits while Groups stay, like the real build).

### Document kinds (`flow/schemas/<kind>.json`; `records.validate_record(kind, doc)`)

Digest-id kinds (`core.stamp`): `stage-summary`, `stage-report`, `script-candidate`, `round-decision`, `script-result`, `method-journal`. Human-authored, schema-only: `journal-entry`.

```json
mage.journal-entry/1  {"schema","round":int>=1,"hypothesis":str(minLength 1),
  "stages":[{"stage":int>=1,"scriptSha256":str,"outcome":"completed|failed|timeout|refused","boundaries":[str],"stageError":str|null,"note":str}] (minItems 1),
  "observations":[str],"conclusion":str(minLength 1),"nextStep":str}
mage.method-journal/1 {"schema","id","entries":[journal-entry],"bestRound":int|null}
mage.stage-summary/1  {"schema","id","round":int,"stage":int,"role":str, ...every run_stage result key...}
mage.stage-report/1   {"schema","id","stageDir":str,"rows":[{"boundary":str,"index":int|null,"source":"snapshot|export",
  "fixed":int,"groups":int,"inGroupFits":int,"ordinaryFits":int,"drops":{"count","lengthUm","ordinary":{"count","lengthUm"},"grouped":{"count","lengthUm"}},
  "inventory":{"status":"pass|fail|n/a","detail":str},"targetDistances":{"maxUm":str|null,"overLimitCount":int|null,"identity":str},
  "orderDeviation":{"max":int|null,"maxLr":int|null,"maxTb":int|null,"byPartition":{}},
  "priorityMovement":{"movedCount":int|null,"maxUm":str|null,"totalUm":str|null,"unmatched":[str]},
  "nativeRows":{"byType":{},"total":int|null}|null}]}
mage.script-candidate/1 {"schema","id","identity":{"taskId","runId","executionId","nodeId","round"},
  "startSnapshotSha256","snapshotSha256","buildBanner",
  "files":{"script":{path,sha256},"stageScript":{path,sha256},"sessionLog":{path,sha256},"journal":{path,sha256},
           "export"?,"snapshot"?,"summary"?,"verify":{TYPE:{path,sha256}},"snapshots":[{"index","name","path","sha256"}]},
  "metrics":{},"remaining":[],"blocked":[],"unknown":[],"outcome":"completed|blocked","stopReason":str,
  "reproduction":{"stageDir":str,"script":"script.tcl","stageScript":"stage.tcl"}}
mage.round-decision/1 {"schema","id","round","route":"continue|stop","nextRound":{"round"},"best":{...}|null,
  "history":[{"round","key":[...],"improved":bool}],"stopReason",
  "goalMet":bool,"rules":{ruleId:"PASS|FAIL|UNKNOWN"},"blockedRound":bool}
mage.script-result/1  {"schema","id","best":{...}|null,"rounds":[{"round","candidate":{path,sha256}}],
  "journal":{path,sha256},"metrics":{},"incumbent":{},"outcome":"completed|best-effort|blocked","stopReason"}
```

`best` = `{"snapshotSha256","candidatePath","metrics","rankMetrics","round","readerValues","blocked"}` exactly as the sibling.

### Manifest additions (`flow/schemas/case-manifest.json`, all optional in the schema; `prepare-case` requires `referenceMethod`)

`referenceMethod: fileRef` (the reference method's entry script), `referenceFiles: [fileRef]`, `referenceNotes: [{"path","sha256","title"}]`, `referenceOrdinaryDropLengthUm: number`. `prepare-case` digest-verifies every one and copies `{"referenceMethod","referenceFiles","referenceNotes","referenceOrdinaryDropLengthUm"}` into `case-readiness.reference`.

### Reader emits (`readers/mage-script-candidate.yml`, exact order)

```
mage_candidate_error_count, mage_priority_unplaced_count,
mage_dropped_count, mage_dropped_length_um, mage_dropped_ordinary_count, mage_dropped_ordinary_length_um,
mage_target_distance_max_um, mage_target_over_limit_count,
mage_order_deviation_max, mage_order_deviation_max_lr, mage_order_deviation_max_tb,
mage_priority_move_max_um, mage_priority_moved_count,
mage_native_overlap_rows, mage_native_space_rows, mage_native_boundary_rows, mage_native_violation_total
```

### Rules (`rules/<id>.yml`) and `rounds.rule_results(reader_values, goal) -> {ruleId: "PASS"|"FAIL"|"UNKNOWN"}`

| id | fact | op | threshold |
|---|---|---|---|
| `placement-delivery-ready` | `mage_candidate_error_count` | eq | 0 |
| `priority-all-placed` | `mage_priority_unplaced_count` | eq | 0 |
| `no-native-violation` | `mage_native_violation_total` | eq | 0 |
| `drops-within-goal` | `mage_dropped_count` | lte | `target_dropped_count` |
| `target-limit-met` | `mage_target_distance_max_um` | lte | `max_target_distance_um` |
| `order-lr-within-goal` | `mage_order_deviation_max_lr` | lte | `max_order_deviation_lr` |
| `order-tb-within-goal` | `mage_order_deviation_max_tb` | lte | `max_order_deviation_tb` |
| `priority-move-within-budget` | `mage_priority_move_max_um` | lte | `max_priority_move_um` |

`goal` is `{"target_dropped_count","max_target_distance_um","max_order_deviation_lr","max_order_deviation_tb","max_priority_move_um"}`.

### Metrics extensions (`flow/mage_placement/metrics.py`)

- `order_deviation(snapshot)` adds `"maxLr"` = max of `LR-left`/`LR-right` (None if either None; -1 sides ignored unless both -1 → -1) and `"maxTb"` likewise for `TB-bottom`/`TB-top`.
- `displacement(start_snapshot, snapshot)` adds `"priority": {"movedCount": int, "maxUm": str|None, "totalUm": str, "matched": int, "unmatched": [start fit ids], "perFit": [{"id","startId","dxUm","dyUm","distanceUm"}]}` over start fits with non-empty `inGroup`. Match by exact id; else by `inGroup` when that Group holds exactly one in-group fit on both sides; else unmatched. `distanceUm` = `|dx| + |dy|` (L1, along + cross). `maxUm` is `None` when `unmatched` is non-empty (identity-unknown), else the max `distanceUm` (`"0"` when nothing moved).

### CLI subcommands (`flow/mage_placement_cli.py`)

| subcommand | argv | purpose |
|---|---|---|
| `task-prepare-case` / `task-measure-incumbent` / `task-decide-round` / `task-evaluate-placement` / `task-deliver` | `WORKSPACE TASK_INPUT TASK_OUTPUT` | program tasks |
| `script-candidate` | `WORKSPACE TARGET_DROPPED MAX_TARGET_DISTANCE_UM MAX_ORDER_DEVIATION_LR MAX_ORDER_DEVIATION_TB MAX_PRIORITY_MOVE_UM` | batch fallback: validate existing `state/round/script-candidate.json`, never fabricate |
| `snapshot`, `lane-view`, `plan-slots` | as the sibling | kept |
| `mage-stage` | `WORKSPACE --round N --script <file> --out-dir placement/round-NN/stage-K [--timeout-s S]` | run one stage via `MageSession.run_stage(role="engineer")`; writes `stage-summary.json` |
| `stage-report` | `WORKSPACE --stage-dir <dir> --out <file>` | `mage.stage-report/1` over every boundary snapshot and the export |
| `candidate` | `WORKSPACE --round N --stage-dir <dir> --journal <file> --out state/round/script-candidate.json` | assemble + validate `mage.script-candidate/1` |
| `flow-digest` | `[flow-dir]` | admin |

Every relative path flag resolves against `WORKSPACE` (`_resolve_in_workspace`, kept). `--stage-dir` must lie under `placement/round-NN/` for the given `--round` (else `MageError("invalid-input")`).

### Program task I/O (`schemas/tasks.json`, `graph.yml`)

| task | bound inputs | value |
|---|---|---|
| `prepare-case` | `MAGE_CASE_MANIFEST`, `SITE_CAPABILITIES`, `TARGET_DROPPED`, `MAX_TARGET_DISTANCE_UM`, `MAX_ORDER_DEVIATION_LR`, `MAX_ORDER_DEVIATION_TB`, `MAX_PRIORITY_MOVE_UM` | `{MAGE_CASE_MANIFEST, SITE_CAPABILITIES, readinessId, startSnapshotSha256}` |
| `measure-incumbent` | `CASE` (prepare-case value), `INCUMBENT_COMPARISON` | `{incumbentId, snapshotSha256, metrics, ordinaryPopulation, evidence, nativeRequested}` |
| `engineer-script` (resident) | `ROUND` (carry), `SITE_CAPABILITIES` (prepare-case value), the five goal values | resident-output |
| `decide-round` | `ROUND`, `CANDIDATE` (engineer-script committed output), the five goal values | `{route, nextRound, best, stopReason, goalMet, rules, journalEntries}` |
| `evaluate-placement` | `DECISION`, `INCUMBENT`, the five goal values | `{goalMet, metrics, incumbent, comparison, rules, unknowns, proofLevel, domainReport}` |
| `deliver` | `EVALUATION` | `{goalMet, proofLevel, reportPath, packagePath}` |

### Proof level (`tasks.proof_level(best_ordinary_len, incumbent_ordinary_len, reference_len, rules, inventory_ok) -> str`)

`none` (no completed best), `reproduction` (|best − incumbent| ≤ 0.5), `improvement` (best < incumbent and `priority-all-placed` PASS), `match` (reference known and best ≤ reference and `priority-all-placed` PASS), `surpass` (reference known, best < reference, every rule except `drops-within-goal` PASS), `completion` (all eight PASS and best == 0). Highest applicable wins; `n/a` is never emitted — `referenceLengthUm: null` in the output says the reference was absent.

---

### Task 1: Fork the Pack skeleton and keep the method-neutral modules green (Sonnet 5 medium)

**Files:**
- Create: `packs/mage-script-placement/` by copying `packs/mage-scribe-placement/` then deleting the consumer-review surface
- Modify: `packs/mage-script-placement/flow/mage_placement_cli.py` (strip), `flow/mage_placement/tasks.py` (strip consumer evaluation), `flow/mage_placement/rounds.py` and `records.py` (stubs)
- Delete: `flow/mage_placement/consumers.py`, `flow/consumer_models/`, `flow/templates/`, the removed schemas, both `readers/*.yml`, `knowledge/*.md`, `rules/no-open-requests.yml`, `rules/order-within-goal.yml`, the removed tests, `flow/tests/standin_mage.py`
- Test: the kept suites `test_core`, `test_pla`, `test_rules`, `test_targets`, `test_lanes`, `test_snapshot`, `test_planner`, `test_metrics`, `test_cli_plan_slots`

**Interfaces:** Produces the fork with `core`, `pla`, `rules`, `targets`, `lanes`, `snapshot`, `planner`, `metrics` unchanged and importable as `mage_placement.*`; `mage_placement_cli.py` keeps `task-*` dispatch, `snapshot`, `lane-view`, `plan-slots`, `flow-digest`, and the helpers `_read_plain`, `_identity`, `_priority_unplaced`, `_incumbent_ordinary_population`, `_check_inventory_conservation`, `_case_readiness`, `_resolve_in_workspace`, `_fail`, `main`. Later tasks add to this file.

- [ ] **Step 1: Copy the sibling Pack and delete the removed surface**

```bash
cd /Users/lluzi/code/hima_harness_reforge_polishing/.claude/worktrees/mage-script-placement
cp -R packs/mage-scribe-placement packs/mage-script-placement
cd packs/mage-script-placement
find . -name __pycache__ -type d -prune -exec rm -rf {} +
rm -f flow/.DS_Store
rm -rf flow/consumer_models flow/templates knowledge/*.md
rm -f flow/mage_placement/consumers.py readers/mage-consumer-review.yml readers/mage-placement-candidate.yml
rm -f rules/no-open-requests.yml rules/order-within-goal.yml
rm -f flow/schemas/consumer-context.json flow/schemas/consumer-model.json flow/schemas/consumer-review.json \
      flow/schemas/finding.json flow/schemas/request.json flow/schemas/ledger-entry.json \
      flow/schemas/decision-request.json flow/schemas/placement-candidate.json flow/schemas/placement-result.json
rm -f flow/tests/test_consumers.py flow/tests/test_readers.py flow/tests/test_rounds.py flow/tests/test_native_session.py \
      flow/tests/test_cli_tasks.py flow/tests/test_knowledge.py flow/tests/test_schemas.py flow/tests/test_records.py \
      flow/tests/test_incumbent_identity.py flow/tests/standin_mage.py
ls flow/mage_placement flow/schemas flow/tests rules readers
```

Expected remaining: `flow/mage_placement/{__init__,core,pla,rules,targets,lanes,snapshot,planner,metrics,records,rounds,tasks}.py`, `native/{__init__,session,tcl}.py`; `flow/schemas/{case-manifest,snapshot,slot-plan,round-decision}.json`; `rules/{placement-delivery-ready,priority-all-placed,no-native-violation,drops-within-goal,target-limit-met}.yml`; `readers/` empty.

- [ ] **Step 2: Strip `flow/mage_placement_cli.py`**

Keep exactly: the module docstring (rewrite its two bullet lists to name only the surviving subcommands), the imports with `consumers` removed and `native_session` kept, `NATIVE_TYPES`, `_read_plain`, `_identity`, `_priority_unplaced`, `_incumbent_ordinary_population`, `_check_inventory_conservation`, `_case_readiness`, `_resolve_in_workspace`, `_cmd_snapshot`, `_cmd_lane_view`, `_grid_dbu_for_lane`, `_to_grid`, `_crosses_band`, `_cmd_plan_slots`, `flow_digest`, `_fail`, `main`. Delete `_cmd_evaluate`, `_cmd_mage_round`, `_native_verify_refs`, `_cmd_candidate`, `_cmd_review`, `_cmd_placement_candidate_fallback`, `_cmd_consumer_review_fallback`. Set:

```python
RESIDENT_SUBCOMMANDS = {
    "snapshot": _cmd_snapshot,
    "plan-slots": _cmd_plan_slots,
}
PRINTING_SUBCOMMANDS = {
    "lane-view": _cmd_lane_view,
}
```

- [ ] **Step 3: Strip `flow/mage_placement/tasks.py`**

Keep `_artifact`, `_verify_file`, `_load_case`, `_incumbent_target_identity`, `_priority_unplaced`, `prepare_case`, `measure_incumbent`, `TASKS`, `execute`. Delete `_reader_values`, `_load_committed_document`, `_REVIEW_INPUT_NAMES`, `decide_round`, `_measure`, `_rule_measure`, `evaluate_placement`, `_collect_round_files`, `deliver` (Task 7 rewrites them). In `measure_incumbent` delete the `consumers` import, the `models_dir`/`eval_dir`/`consumer_findings` loop and the `"consumerFindings"` key. In `prepare_case` delete every `consumer_context*` line and the `"consumerContextSha256"`/`"consumerContext"` keys so `inputs["CONSUMER_CONTEXT"]` is no longer read; drop `CONSUMER_CONTEXT` from the returned `value`. Set `TASKS = {"prepare-case": prepare_case, "measure-incumbent": measure_incumbent}` and `RULE_IDS = ()` (Task 7 fills it). First docstring line: "The program-task ABI adapters of the mage-script-placement Pack".

- [ ] **Step 4: Stub `rounds.py` and `records.py`**

Replace `flow/mage_placement/rounds.py` with:

```python
"""Round-decision logic for the mage-script-placement Pack (rewritten in Task 7)."""
from __future__ import annotations

MAX_ROUNDS = 6
```

Replace `flow/mage_placement/records.py` with:

```python
"""Record validation for the mage-script-placement Pack.

`validate_record(kind, doc)` checks a document against `flow/schemas/<kind>.json`
through `core.validate`. Kinds in `DIGEST_ID_KINDS` are stamped with
`core.stamp` and their `id` is re-derived here; `journal-entry` is authored by
the Engineer and is schema-checked only.
"""
from __future__ import annotations

import json
from pathlib import Path

from . import core


SCHEMAS_DIR = Path(__file__).resolve().parents[1] / "schemas"
DIGEST_ID_KINDS = {
    "stage-summary", "stage-report", "script-candidate", "round-decision", "script-result", "method-journal",
}
_SCHEMA_CACHE = {}


def _load_schema(kind):
    if kind not in _SCHEMA_CACHE:
        path = SCHEMAS_DIR / f"{kind}.json"
        try:
            text = path.read_text(encoding="utf-8")
        except OSError as exc:
            raise core.MageError("missing-input", f"no schema for record kind {kind!r}: {exc}") from exc
        _SCHEMA_CACHE[kind] = json.loads(text)
    return _SCHEMA_CACHE[kind]


def validate_record(kind, doc):
    """Validate `doc` against `flow/schemas/<kind>.json`; return error strings (empty = valid)."""
    schema = _load_schema(kind)
    errors = core.validate(doc, schema)
    if kind in DIGEST_ID_KINDS and isinstance(doc, dict) and "id" in doc:
        body = {key: value for key, value in doc.items() if key != "id"}
        if doc["id"] != core.digest(body):
            errors.append(f"$: id does not match recomputed digest for kind {kind!r}")
    return errors
```

- [ ] **Step 5: Rename the Pack identity in the surviving declarations**

In `contract.yml` set `id: mage-script-placement`, `version: 0.1.0`, `title: MAGE script-method test-structure placement`; in `graph.yml` set `id: mage-script-placement`, `version: 0.1.0` (Task 7 rewrites both files completely; this keeps `loadPack` from confusing the two Packs meanwhile). Then:

```bash
cd packs/mage-script-placement
grep -rl "mage-scribe-placement" flow tools | xargs sed -i '' 's/mage-scribe-placement/mage-script-placement/g'
```

Add one line to the top docstring of each kept module (`core`, `pla`, `rules`, `targets`, `lanes`, `snapshot`, `planner`, `metrics`): `Forked verbatim from packs/mage-scribe-placement 0.2.0 (2026-10-12).`

- [ ] **Step 6: Run the kept suites; expect green**

```bash
cd packs/mage-script-placement && /usr/bin/python3 -m unittest discover -s flow/tests -t flow -v 2>&1 | tail -5
```

Expected: `OK` (about 120 tests). If `test_cli_plan_slots` imports a removed symbol, fix the import, never re-add the symbol.

- [ ] **Step 7: Commit and push**

Write the message to a file, commit with the fixed identity, push, and confirm the remote SHA:

```bash
cd /Users/lluzi/code/hima_harness_reforge_polishing/.claude/worktrees/mage-script-placement
git add packs/mage-script-placement
printf 'feat(mage-script): fork mage-scribe-placement into the script-method Pack skeleton\n\nKeeps core/pla/rules/targets/lanes/snapshot/planner/metrics verbatim; removes the\nconsumer-review surface, templates and their tests.\n\nCo-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>\n' > /tmp/mage-script-msg.txt
git -c user.name=lluzi -c user.email=lluzi@Luzis-MacBook-Air.local commit -q -F /tmp/mage-script-msg.txt
PATH="$HOME/.local/node24/bin:$PATH" git push origin feat/mage-script-placement
test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/feat/mage-script-placement | cut -f1)" && echo SYNCED
```

Every later task's "Commit and push" step means exactly this sequence with its own message.

---

### Task 2: Metrics extensions: per-side order maxima and priority movement (Sonnet 5 medium)

**Files:**
- Modify: `packs/mage-script-placement/flow/mage_placement/metrics.py` (`order_deviation`, `displacement`)
- Test: `packs/mage-script-placement/flow/tests/test_metrics.py` (append a class)

**Interfaces:** Produces `order_deviation(...)["maxLr"|"maxTb"]` and `displacement(...)["priority"]` exactly as in Frozen interfaces. Consumed by Tasks 5, 6, 7.

- [ ] **Step 1: Append the failing tests to `flow/tests/test_metrics.py`**

```python
class PerSideOrderAndPriorityMovementTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.case = fixtures.make_case(self.tmp.name)
        manifest = self.case["manifest"]
        self.dbu = manifest["dbuPerUm"]
        rule_text = Path(manifest["rule"]["path"]).read_text(encoding="utf-8")
        pblock_text = Path(manifest["pblock"]["path"]).read_text(encoding="utf-8")
        block_text = Path(manifest["block"]["path"]).read_text(encoding="utf-8")
        self.frame = rules.frame_from_rule(rule_text, pblock_text, self.dbu)
        self.rule_facts = rules.read_rule_facts(rule_text, self.dbu)
        self.block_types = rules.read_block_types(block_text, self.dbu)
        csv_text = Path(manifest["targetTable"]["path"]).read_text(encoding="utf-8")
        targets_raw = targets.read_targets(csv_text, self.frame, self.dbu, "2")
        self.start_doc = pla.read_pla(Path(manifest["startState"]["path"]).read_text(encoding="utf-8"), self.dbu)
        self.targets = targets.bind_targets(targets_raw, self.start_doc["groups"], self.start_doc["fits"])
        self.start = snapshot.build_snapshot("start", self.start_doc, self.frame, self.rule_facts, self.targets,
                                             self.block_types, {}, pending_from_rules=True)

    def tearDown(self):
        self.tmp.cleanup()

    def _candidate(self, doc):
        return snapshot.build_snapshot("candidate", doc, self.frame, self.rule_facts, self.targets,
                                       self.block_types, {}, pending_from_rules=False)

    def _copy_doc(self):
        return pla.read_pla(pla.write_pla(self.start_doc, self.dbu), self.dbu)

    def test_order_deviation_reports_lr_and_tb_maxima(self):
        result = metrics.order_deviation(self.start)
        self.assertEqual(result["maxLr"], max(result["byPartition"]["LR-left"], result["byPartition"]["LR-right"]))
        self.assertEqual(result["maxTb"], max(result["byPartition"]["TB-bottom"], result["byPartition"]["TB-top"]))
        self.assertEqual(result["max"], max(result["maxLr"], result["maxTb"]))

    def test_order_deviation_side_unknown_makes_that_axis_unknown_only(self):
        doc = self._copy_doc()
        doc["fits"] = [f for f in doc["fits"] if f["base"] != "AL_X"]   # the only LR target is now unbound
        result = metrics.order_deviation(self._candidate(doc))
        self.assertIsNone(result["maxLr"])
        self.assertIsNotNone(result["maxTb"])
        self.assertIsNone(result["max"])

    def test_priority_movement_by_id(self):
        doc = self._copy_doc()
        for fit in doc["fits"]:
            if fit["base"] == "OVL_B":
                l, b, r, t = fit["boxDbu"]
                fit["boxDbu"] = [l - 1500000, b, r - 1500000, t]   # 150 um left
        priority = metrics.displacement(self.start, self._candidate(doc))["priority"]
        self.assertEqual(priority["movedCount"], 1)
        self.assertEqual(priority["maxUm"], "150")
        self.assertEqual(priority["totalUm"], "150")
        self.assertEqual(priority["unmatched"], [])
        self.assertEqual(priority["perFit"][0]["id"], "OVL_B.OVL_B_1")
        self.assertEqual(priority["perFit"][0]["distanceUm"], "150")

    def test_priority_movement_matches_a_resuffixed_fit_by_group(self):
        doc = self._copy_doc()
        for fit in doc["fits"]:
            if fit["base"] == "OVL_A":
                fit["id"] = "OVL_A.OVL_A_9"
                fit["inst"] = "OVL_A.OVL_A_9"
                l, b, r, t = fit["boxDbu"]
                fit["boxDbu"] = [l + 200000, b, r + 200000, t]   # 20 um right
        priority = metrics.displacement(self.start, self._candidate(doc))["priority"]
        self.assertEqual(priority["unmatched"], [])
        self.assertEqual(priority["movedCount"], 1)
        self.assertEqual(priority["maxUm"], "20")
        self.assertEqual(priority["perFit"][0]["startId"], "OVL_A.OVL_A_1")
        self.assertEqual(priority["perFit"][0]["id"], "OVL_A.OVL_A_9")

    def test_priority_movement_unmatched_makes_max_unknown(self):
        doc = self._copy_doc()
        doc["fits"] = [f for f in doc["fits"] if f["base"] != "AL_X"]
        priority = metrics.displacement(self.start, self._candidate(doc))["priority"]
        self.assertEqual(priority["unmatched"], ["AL_X.AL_X_1"])
        self.assertIsNone(priority["maxUm"])

    def test_priority_movement_zero_when_nothing_moved(self):
        priority = metrics.displacement(self.start, self._candidate(self.start_doc))["priority"]
        self.assertEqual(priority["movedCount"], 0)
        self.assertEqual(priority["maxUm"], "0")
```

Add `rules`, `targets`, `snapshot`, `pla` to the test module's `from mage_placement import ...` line if they are not already imported.

- [ ] **Step 2: Run; expect the six new tests to FAIL** with `KeyError: 'maxLr'` / `KeyError: 'priority'`:

`cd packs/mage-script-placement && /usr/bin/python3 -m unittest discover -s flow/tests -t flow -p 'test_metrics.py' 2>&1 | tail -15`

- [ ] **Step 3: Implement**

In `order_deviation`, after `by_partition["IN"] = None`, add:

```python
    def _axis_max(sides):
        values = [by_side[s] for s in sides]
        if any(v is None for v in values):
            return None
        return max(values)

    max_lr = _axis_max(("LR-left", "LR-right"))
    max_tb = _axis_max(("TB-bottom", "TB-top"))
```

and add `"maxLr": max_lr, "maxTb": max_tb,` to the returned dict (keep every existing key). In `displacement`, before the `return`, add `priority = _priority_displacement(start_snapshot, snapshot, dbu_per_um)` and `"priority": priority` to the returned dict. Add above `displacement`:

```python
def _single_in_group_fit(fits, group_label):
    members = [f for f in fits if f.get("inGroup") == group_label]
    return members[0] if len(members) == 1 else None


def _priority_displacement(start_snapshot, snapshot, dbu_per_um):
    """Movement of every start priority (in-group) Fit, matched by exact id,
    else by its Group when that Group holds exactly one in-group Fit on both
    sides; otherwise `unmatched` (identity-unknown: `maxUm` is None).
    `distanceUm` is |dx| + |dy| of the box centre."""
    current_by_id = {f["id"]: f for f in snapshot["fits"]}
    per_fit, unmatched = [], []
    total_doubled = max_doubled = 0
    matched = 0
    for start_fit in start_snapshot["fits"]:
        if not start_fit.get("inGroup"):
            continue
        current = current_by_id.get(start_fit["id"])
        if current is None:
            start_single = _single_in_group_fit(start_snapshot["fits"], start_fit["inGroup"])
            current_single = _single_in_group_fit(snapshot["fits"], start_fit["inGroup"])
            if start_single is not None and current_single is not None and start_single["id"] == start_fit["id"]:
                current = current_single
        if current is None:
            unmatched.append(start_fit["id"])
            continue
        matched += 1
        l0, b0, r0, t0 = start_fit["boxDbu"]
        l1, b1, r1, t1 = current["boxDbu"]
        dx_doubled, dy_doubled = (l1 + r1) - (l0 + r0), (b1 + t1) - (b0 + t0)
        if dx_doubled == 0 and dy_doubled == 0:
            continue
        distance_doubled = abs(dx_doubled) + abs(dy_doubled)
        per_fit.append({
            "id": current["id"], "startId": start_fit["id"],
            "dxUm": _signed_half_um(dx_doubled, dbu_per_um), "dyUm": _signed_half_um(dy_doubled, dbu_per_um),
            "distanceUm": _half_um(distance_doubled, dbu_per_um),
        })
        total_doubled += distance_doubled
        max_doubled = max(max_doubled, distance_doubled)
    return {
        "movedCount": len(per_fit),
        "maxUm": None if unmatched else _half_um(max_doubled, dbu_per_um),
        "totalUm": _half_um(total_doubled, dbu_per_um),
        "matched": matched,
        "unmatched": unmatched,
        "perFit": per_fit,
    }
```

Update the module docstring's `displacement` bullet and the function docstring to describe the `priority` block and `maxLr`/`maxTb`.

- [ ] **Step 4: Run the whole Pack suite; expect `OK`**, then **commit and push** (`feat(mage-script): per-side order maxima and priority movement metrics`).

---

### Task 3: Schemas, records and the extended fixture (Sonnet 5 medium)

**Files:**
- Create: `flow/schemas/{stage-summary,stage-report,journal-entry,method-journal,script-candidate,script-result}.json`
- Modify: `flow/schemas/round-decision.json`, `flow/schemas/case-manifest.json`, `flow/tests/fixtures.py`
- Test: `flow/tests/test_records.py` (new)

**Interfaces:** Produces the document schemas in Frozen interfaces; `fixtures.make_case(root, mage_executable="", auto_refine_converge=None, reference=True)` writes `case/reference/run.tcl`, `case/reference/request-order.t`, `case/reference/notes.md` and sets `referenceMethod`, `referenceFiles`, `referenceNotes`, `referenceOrdinaryDropLengthUm: 450` (pass `reference=False` to omit them all); `fixtures.journal_entry(round_no, script_sha256, outcome="completed", conclusion="baseline reproduced")` returns a valid `mage.journal-entry/1` dict.

- [ ] **Step 1: Write the failing tests, `flow/tests/test_records.py`**

```python
import sys, tempfile, unittest
from pathlib import Path
sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core, records  # noqa: E402
from tests import fixtures  # noqa: E402


class RecordSchemaTest(unittest.TestCase):
    def test_journal_entry_valid_and_invalid(self):
        entry = fixtures.journal_entry(1, "a" * 64)
        self.assertEqual(records.validate_record("journal-entry", entry), [])
        bad = dict(entry); bad["stages"] = []
        self.assertTrue(records.validate_record("journal-entry", bad))
        bad2 = dict(entry); bad2["hypothesis"] = ""
        self.assertTrue(records.validate_record("journal-entry", bad2))

    def test_method_journal_digest_id(self):
        doc = core.stamp("method-journal", {"entries": [fixtures.journal_entry(1, "b" * 64)], "bestRound": 1})
        self.assertEqual(records.validate_record("method-journal", doc), [])
        doc["bestRound"] = 2
        self.assertIn("digest", "".join(records.validate_record("method-journal", doc)))

    def test_script_candidate_requires_journal_and_session_log(self):
        ref = {"path": "placement/round-01/x", "sha256": "c" * 64}
        body = {
            "identity": {"taskId": "t", "runId": "r", "executionId": "e", "nodeId": "n", "round": 1},
            "startSnapshotSha256": "s" * 64, "snapshotSha256": "s" * 64, "buildBanner": "",
            "files": {"script": ref, "stageScript": ref, "sessionLog": ref, "journal": ref, "verify": {}, "snapshots": []},
            "metrics": {}, "remaining": [], "blocked": [], "unknown": [], "outcome": "blocked",
            "stopReason": "x", "reproduction": {"stageDir": "placement/round-01/stage-1", "script": "script.tcl", "stageScript": "stage.tcl"},
        }
        self.assertEqual(records.validate_record("script-candidate", core.stamp("script-candidate", body)), [])
        del body["files"]["journal"]
        self.assertTrue(records.validate_record("script-candidate", core.stamp("script-candidate", body)))

    def test_round_decision_and_result_shapes(self):
        decision = core.stamp("round-decision", {
            "round": 1, "route": "continue", "nextRound": {"round": 2}, "best": None, "history": [],
            "stopReason": "", "goalMet": False, "rules": {}, "blockedRound": False,
        })
        self.assertEqual(records.validate_record("round-decision", decision), [])
        result = core.stamp("script-result", {
            "best": None, "rounds": [], "journal": {"path": "state/method-journal.json", "sha256": "d" * 64},
            "metrics": {}, "incumbent": {}, "outcome": "blocked", "stopReason": "",
        })
        self.assertEqual(records.validate_record("script-result", result), [])

    def test_stage_summary_and_report_minimal(self):
        summary = core.stamp("stage-summary", {
            "round": 1, "stage": 1, "role": "engineer", "stageDir": "placement/round-01/stage-1",
            "scriptTcl": "a", "scriptSha256": "a" * 64, "stageTcl": "b", "stageSha256": "b" * 64,
            "returncode": 0, "timedOut": False, "completed": True, "lastBoundary": "filled", "stageError": None,
            "exportPla": "e", "exportSha256": "e" * 64, "summary": "s", "stdout": "o", "stdoutSha256": "o" * 64,
            "verifyFiles": {}, "snapshots": [], "checks": {}, "startedAt": "t", "endedAt": "t",
        })
        self.assertEqual(records.validate_record("stage-summary", summary), [])
        report = core.stamp("stage-report", {"stageDir": "placement/round-01/stage-1", "rows": []})
        self.assertEqual(records.validate_record("stage-report", report), [])


class ManifestReferenceTest(unittest.TestCase):
    def test_fixture_manifest_carries_reference_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = fixtures.make_case(tmp)["manifest"]
            self.assertTrue(Path(manifest["referenceMethod"]["path"]).is_file())
            self.assertEqual(len(manifest["referenceFiles"]), 2)
            self.assertEqual(manifest["referenceNotes"][0]["title"], "synthetic probe notes")
            self.assertEqual(manifest["referenceOrdinaryDropLengthUm"], 450)
            self.assertEqual(records.validate_record("case-manifest", manifest), [])

    def test_fixture_without_reference_still_validates(self):
        with tempfile.TemporaryDirectory() as tmp:
            manifest = fixtures.make_case(tmp, reference=False)["manifest"]
            self.assertNotIn("referenceMethod", manifest)
            self.assertEqual(records.validate_record("case-manifest", manifest), [])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run; expect FAIL** (`/usr/bin/python3 -m unittest discover -s flow/tests -t flow -p 'test_records.py'`): missing schema files raise `MageError('missing-input')`; `fixtures.journal_entry` raises `AttributeError`.

- [ ] **Step 3: Write the schemas**

`flow/schemas/journal-entry.json`:

```json
{
  "type": "object",
  "required": ["schema", "round", "hypothesis", "stages", "observations", "conclusion", "nextStep"],
  "additionalProperties": false,
  "properties": {
    "schema": {"type": "string", "const": "mage.journal-entry/1"},
    "round": {"type": "integer", "minimum": 1},
    "hypothesis": {"type": "string", "minLength": 1},
    "stages": {
      "type": "array", "minItems": 1,
      "items": {
        "type": "object",
        "required": ["stage", "scriptSha256", "outcome", "boundaries", "stageError", "note"],
        "additionalProperties": false,
        "properties": {
          "stage": {"type": "integer", "minimum": 1},
          "scriptSha256": {"type": "string", "minLength": 1},
          "outcome": {"type": "string", "enum": ["completed", "failed", "timeout", "refused"]},
          "boundaries": {"type": "array", "items": {"type": "string"}},
          "stageError": {"type": ["string", "null"]},
          "note": {"type": "string"}
        }
      }
    },
    "observations": {"type": "array", "items": {"type": "string"}},
    "conclusion": {"type": "string", "minLength": 1},
    "nextStep": {"type": "string"}
  }
}
```

`flow/schemas/method-journal.json`:

```json
{
  "type": "object",
  "required": ["schema", "id", "entries", "bestRound"],
  "additionalProperties": false,
  "properties": {
    "schema": {"type": "string", "const": "mage.method-journal/1"},
    "id": {"type": "string", "minLength": 1},
    "entries": {"type": "array", "items": {"type": "object"}},
    "bestRound": {"type": ["integer", "null"]}
  }
}
```

`flow/schemas/script-candidate.json`:

```json
{
  "type": "object",
  "required": ["schema", "id", "identity", "startSnapshotSha256", "snapshotSha256", "buildBanner", "files",
               "metrics", "remaining", "blocked", "unknown", "outcome", "stopReason", "reproduction"],
  "additionalProperties": false,
  "$defs": {
    "ref": {"type": "object", "required": ["path", "sha256"],
            "properties": {"path": {"type": "string", "minLength": 1}, "sha256": {"type": "string", "minLength": 1}}}
  },
  "properties": {
    "schema": {"type": "string", "const": "mage.script-candidate/1"},
    "id": {"type": "string", "minLength": 1},
    "identity": {"type": "object", "required": ["taskId", "runId", "executionId", "nodeId", "round"],
                 "properties": {"round": {"type": "integer", "minimum": 1}}},
    "startSnapshotSha256": {"type": "string", "minLength": 1},
    "snapshotSha256": {"type": "string", "minLength": 1},
    "buildBanner": {"type": "string"},
    "files": {
      "type": "object",
      "required": ["script", "stageScript", "sessionLog", "journal", "verify", "snapshots"],
      "properties": {
        "script": {"$ref": "#/$defs/ref"}, "stageScript": {"$ref": "#/$defs/ref"},
        "sessionLog": {"$ref": "#/$defs/ref"}, "journal": {"$ref": "#/$defs/ref"},
        "export": {"$ref": "#/$defs/ref"}, "snapshot": {"$ref": "#/$defs/ref"}, "summary": {"$ref": "#/$defs/ref"},
        "verify": {"type": "object"},
        "snapshots": {"type": "array", "items": {"type": "object", "required": ["index", "name", "path", "sha256"]}}
      }
    },
    "metrics": {"type": "object"},
    "remaining": {"type": "array"}, "blocked": {"type": "array"}, "unknown": {"type": "array"},
    "outcome": {"type": "string", "enum": ["completed", "blocked"]},
    "stopReason": {"type": "string"},
    "reproduction": {"type": "object", "required": ["stageDir", "script", "stageScript"]}
  }
}
```

`flow/schemas/round-decision.json` (replace the file):

```json
{
  "type": "object",
  "required": ["schema", "id", "round", "route", "nextRound", "best", "history", "stopReason", "goalMet", "rules", "blockedRound"],
  "additionalProperties": false,
  "properties": {
    "schema": {"type": "string", "const": "mage.round-decision/1"},
    "id": {"type": "string", "minLength": 1},
    "round": {"type": "integer", "minimum": 0},
    "route": {"type": "string", "enum": ["continue", "stop"]},
    "nextRound": {"type": "object", "required": ["round"], "additionalProperties": false,
                  "properties": {"round": {"type": "integer", "minimum": 0}}},
    "best": {"type": ["object", "null"]},
    "history": {"type": "array"},
    "stopReason": {"type": "string"},
    "goalMet": {"type": "boolean"},
    "rules": {"type": "object"},
    "blockedRound": {"type": "boolean"}
  }
}
```

`flow/schemas/script-result.json`:

```json
{
  "type": "object",
  "required": ["schema", "id", "best", "rounds", "journal", "metrics", "incumbent", "outcome", "stopReason"],
  "additionalProperties": false,
  "properties": {
    "schema": {"type": "string", "const": "mage.script-result/1"},
    "id": {"type": "string", "minLength": 1},
    "best": {"type": ["object", "null"]},
    "rounds": {"type": "array"},
    "journal": {"type": "object", "required": ["path", "sha256"]},
    "metrics": {"type": "object"},
    "incumbent": {"type": "object"},
    "outcome": {"type": "string", "enum": ["completed", "best-effort", "blocked"]},
    "stopReason": {"type": "string"}
  }
}
```

`flow/schemas/stage-summary.json`:

```json
{
  "type": "object",
  "required": ["schema", "id", "round", "stage", "role", "stageDir", "scriptTcl", "scriptSha256", "stageTcl", "stageSha256",
               "returncode", "timedOut", "completed", "lastBoundary", "stageError", "exportPla", "exportSha256",
               "summary", "stdout", "stdoutSha256", "verifyFiles", "snapshots", "checks", "startedAt", "endedAt"],
  "additionalProperties": false,
  "properties": {
    "schema": {"type": "string", "const": "mage.stage-summary/1"},
    "id": {"type": "string", "minLength": 1},
    "round": {"type": "integer", "minimum": 1}, "stage": {"type": "integer", "minimum": 1},
    "role": {"type": "string"}, "stageDir": {"type": "string"},
    "scriptTcl": {"type": "string"}, "scriptSha256": {"type": "string"},
    "stageTcl": {"type": "string"}, "stageSha256": {"type": "string"},
    "returncode": {"type": "integer"}, "timedOut": {"type": "boolean"}, "completed": {"type": "boolean"},
    "lastBoundary": {"type": ["string", "null"]}, "stageError": {"type": ["string", "null"]},
    "exportPla": {"type": ["string", "null"]}, "exportSha256": {"type": ["string", "null"]},
    "summary": {"type": ["string", "null"]}, "stdout": {"type": "string"}, "stdoutSha256": {"type": ["string", "null"]},
    "verifyFiles": {"type": "object"},
    "snapshots": {"type": "array", "items": {"type": "object", "required": ["index", "name", "pla", "summary", "sha256"]}},
    "checks": {"type": "object"},
    "startedAt": {"type": "string"}, "endedAt": {"type": "string"}
  }
}
```

`flow/schemas/stage-report.json`:

```json
{
  "type": "object",
  "required": ["schema", "id", "stageDir", "rows"],
  "additionalProperties": false,
  "properties": {
    "schema": {"type": "string", "const": "mage.stage-report/1"},
    "id": {"type": "string", "minLength": 1},
    "stageDir": {"type": "string"},
    "rows": {"type": "array", "items": {"type": "object", "required": ["boundary", "index", "source", "fixed", "groups",
             "inGroupFits", "ordinaryFits", "drops", "inventory", "targetDistances", "orderDeviation", "priorityMovement", "nativeRows"]}}
  }
}
```

In `flow/schemas/case-manifest.json` add to `properties` (keep `referenceMethod` as it is):

```json
    "referenceFiles": {"type": "array", "items": {"$ref": "#/$defs/fileRef"}},
    "referenceNotes": {"type": "array", "items": {"type": "object", "required": ["path", "sha256", "title"], "additionalProperties": false,
                       "properties": {"path": {"type": "string", "minLength": 1}, "sha256": {"type": "string", "minLength": 1}, "title": {"type": "string", "minLength": 1}}}},
    "referenceOrdinaryDropLengthUm": {"type": "number", "minimum": 0},
```

- [ ] **Step 4: Extend `flow/tests/fixtures.py`**

Change the signature to `def make_case(root, mage_executable="", auto_refine_converge=None, reference=True):`, delete the old `reference_method` parameter and block, and before the manifest body is assembled add:

```python
    reference_refs = {}
    if reference:
        reference_dir = case_dir / "reference"
        run_tcl = _write(reference_dir / "run.tcl", _reference_run_tcl())
        request_copy = _write(reference_dir / "request-order.t", _request_t())
        notes = _write(reference_dir / "notes.md",
                       "# synthetic probe notes\n\nObservation only: the converge call failed at boundary `priority-restored`.\n")
        reference_refs = {
            "referenceMethod": _file_ref(run_tcl),
            "referenceFiles": [_file_ref(run_tcl), _file_ref(request_copy)],
            "referenceNotes": [dict(_file_ref(notes), title="synthetic probe notes")],
            "referenceOrdinaryDropLengthUm": 450,
        }
```

and merge `**reference_refs` into the manifest body before `core.stamp`. Add at module level:

```python
def _reference_run_tcl():
    """A customer-neutral stand-in for a reference method's entry script:
    the four stages in order, in the command forms the playbook names."""
    return "\n".join([
        "# synthetic reference method (fixture; no customer values)",
        "proc openFrb {} { frbOpen ../synthetic.frb }",
        "proc buildFrame {} { smPFlow -updateUsedFiles; frbSetup -obj BuildFrame; smPFlow -clear; smPFlow -bindBlocks",
        "    smPFlow -buildFrame frame -mchip mainchip -mblock mainchip; smPFlow -sortFix; smPFlow -sortFit }",
        "openFrb", "buildFrame",
        "source request-order.t",
        "smPInstMgr -saveMark pre_place_all.pla",
        "g_params -set {smPFlow::s_ARTestConvergePrplaced true}",
        "smPFlow -setAutoRefineSimpleConverge -arSLType VERT -arConvergeNum 7",
        "smPFlow -setAutoRefineSimpleConverge -arSLType HORZ -arConvergeNum 5",
        "smPFlow -autoRefine",
        "g_params -set {smPFlow::s_ARTestConvergePrplaced false}",
        "smPFlow -autoRefine", "",
    ])


def journal_entry(round_no, script_sha256, outcome="completed", conclusion="baseline reproduced"):
    return {
        "schema": "mage.journal-entry/1", "round": round_no,
        "hypothesis": "replaying the frozen start and filling reproduces the incumbent",
        "stages": [{"stage": 1, "scriptSha256": script_sha256, "outcome": outcome,
                    "boundaries": ["open-build", "priority-start", "filled"], "stageError": None, "note": ""}],
        "observations": ["ordinary drops equal the incumbent"],
        "conclusion": conclusion, "nextStep": "try explicit compaction",
    }
```

Also add the workspace-state helper every later test uses (what `prepare-case`/`measure-incumbent` will write in Task 7, hand-built here so Tasks 4–6 are testable alone):

```python
def write_workspace_state(workspace, case, site_caps_path, goal):
    """Write state/start-snapshot.json, state/case-readiness.json and state/incumbent.json
    (ordinaryPopulation only) into `workspace` for the synthetic case. Returns the start snapshot."""
    from mage_placement import pla, rules, snapshot, targets  # local import: fixtures is imported by tests that patch sys.path
    import json as _json
    workspace = Path(workspace)
    m = case["manifest"]; dbu = m["dbuPerUm"]
    rule_text = Path(m["rule"]["path"]).read_text(encoding="utf-8")
    frame = rules.frame_from_rule(rule_text, Path(m["pblock"]["path"]).read_text(encoding="utf-8"), dbu)
    facts = rules.read_rule_facts(rule_text, dbu)
    blocks = rules.read_block_types(Path(m["block"]["path"]).read_text(encoding="utf-8"), dbu)
    raw = targets.read_targets(Path(m["targetTable"]["path"]).read_text(encoding="utf-8"), frame, dbu, "2")
    start_doc = pla.read_pla(Path(m["startState"]["path"]).read_text(encoding="utf-8"), dbu)
    bound = targets.bind_targets(raw, start_doc["groups"], start_doc["fits"])
    start = snapshot.build_snapshot("start", start_doc, frame, facts, bound, blocks,
                                    {"startState": dict(m["startState"])}, pending_from_rules=True)
    core.write_artifact(workspace / "state" / "start-snapshot.json", start)
    site_caps = _json.loads(Path(site_caps_path).read_text(encoding="utf-8"))
    reference = {k: m.get(k) for k in ("referenceMethod", "referenceFiles", "referenceNotes", "referenceOrdinaryDropLengthUm")}
    core.write_artifact(workspace / "state" / "case-readiness.json",
                        core.stamp("case-readiness", {"goal": goal, "manifest": m, "siteCapabilities": site_caps, "reference": reference}))
    inc_doc = pla.read_pla(Path(m["incumbentState"]["path"]).read_text(encoding="utf-8"), dbu)
    inc = snapshot.build_snapshot("incumbent", inc_doc, frame, facts, bound, blocks, {}, pending_from_rules=False)
    core.write_artifact(workspace / "state" / "incumbent.json",
                        core.stamp("incumbent-measure", {"ordinaryPopulation": snapshot.ordinary_population(inc)}))
    return start
```

Update `make_case`'s docstring. `grep -rn reference_method flow/tests` must return nothing afterwards.

- [ ] **Step 5: Run the full suite; expect `OK`; commit and push** (`feat(mage-script): document schemas, record validation and the reference-bearing fixture`).

---

### Task 4: The stage driver, prelude/epilogue, and the stand-in MAGE (Opus 4.8 medium)

**Files:**
- Create: `flow/mage_placement/native/prelude.tcl`, `flow/mage_placement/native/epilogue.tcl`
- Rewrite: `flow/mage_placement/native/session.py`
- Rewrite: `flow/tests/standin_mage.py`
- Test: `flow/tests/test_native_session.py` (new)

**Interfaces:**
- Consumes: `core`, `pla`, `native/tcl.py` (`quote`, `fill`), `fixtures.make_case`.
- Produces: `MageSession(executable, env, workdir, log_path, case).run_stage(stage_dir, script_path, role, timeout_s=1800)`, `slice_verify`, `slice_checks`, `write_verify_files`, `snapshots_from_stdout`, `FORBIDDEN_PATTERNS`, `AGENT_BEGIN`/`AGENT_END`, `END_MARKER`, `NATIVE_TYPES`, `NATIVE_COMMANDS` — exactly as the Frozen interfaces; the stand-in's env knobs as listed there.

- [ ] **Step 1: Write the prelude and epilogue**

`flow/mage_placement/native/prelude.tcl`:

```tcl
# hima:prelude-begin  (Pack-owned; the only way a stage opens the case or writes a boundary)
set hima_case_frb {@FRB@}
set hima_case_dir {@CASE_DIR@}
set hima_start_pla {@START_PLA@}
set hima_out {@OUT@}
set hima_stage_boundary "prelude"
set hima_snap_index 0
proc hima_open_build {args} {
    global hima_case_frb hima_stage_boundary
    frbOpen $hima_case_frb
    frbSetCur frame
    smPFlow -updateUsedFiles
    frbSetup -obj BuildFrame
    smPFlow -clear
    smPFlow -bindBlocks
    eval [concat [list smPFlow -buildFrame frame -mchip mainchip -mblock mainchip] $args]
    smPFlow -sortFix
    smPFlow -sortFit
    set hima_stage_boundary "open-build"
}
proc hima_snapshot {name} {
    global hima_out hima_snap_index hima_stage_boundary
    if {![regexp {^[A-Za-z0-9][A-Za-z0-9_-]{0,40}$} $name]} { error "hima_snapshot: invalid boundary name $name" }
    incr hima_snap_index
    set dir [file join $hima_out [format "snap-%02d-%s" $hima_snap_index $name]]
    file mkdir $dir
    smPInstMgr -saveMark [file join $dir placement.pla]
    smPFlow -saveSummary [file join $dir summary.txt]
    puts [list MAGE_SNAPSHOT $hima_snap_index $name]
    flush stdout
    set hima_stage_boundary $name
}
proc hima_check {} {
    global hima_snap_index
    foreach {hima_t hima_c} {OVERLAP frbCheckOverlap SPACE frbCheckSpace BOUNDARY frbCheckBoundary} {
        puts [list MAGE_CHECK_BEGIN $hima_snap_index $hima_t]
        flush stdout
        set hima_code1 [catch {$hima_c} hima_m1]
        set hima_code2 [catch {$hima_c -print} hima_m2]
        flush stdout
        puts [list MAGE_CHECK_CODE $hima_snap_index $hima_t [expr {$hima_code1 || $hima_code2}]]
        puts [list MAGE_CHECK_END $hima_snap_index $hima_t]
        flush stdout
    }
}
# hima:prelude-end
```

`flow/mage_placement/native/epilogue.tcl`:

```tcl
foreach {mage_verify_type mage_verify_cmd} {OVERLAP frbCheckOverlap SPACE frbCheckSpace BOUNDARY frbCheckBoundary} {
    puts [list MAGE_VERIFY_BEGIN $mage_verify_type]
    flush stdout
    set mage_verify_code [catch {$mage_verify_cmd} mage_verify_msg]
    set mage_verify_code2 [catch {$mage_verify_cmd -print} mage_verify_msg2]
    flush stdout
    puts [list MAGE_VERIFY_CODE $mage_verify_type [expr {$mage_verify_code || $mage_verify_code2}]]
    puts [list MAGE_VERIFY_END $mage_verify_type]
    flush stdout
}
smPInstMgr -saveMark {@OUT@/export.pla}
smPFlow -saveSummary {@OUT@/summary.txt}
puts [list MAGE_ROUND_END code 0]
```

- [ ] **Step 2: Write the failing tests, `flow/tests/test_native_session.py`**

```python
import json, os, sys, tempfile, unittest
from pathlib import Path
sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core, pla  # noqa: E402
from mage_placement.native import session  # noqa: E402
from tests import fixtures  # noqa: E402

STANDIN = str(Path(__file__).resolve().parent / "standin_mage.py")
BASELINE = (
    "hima_open_build\n"
    "source $hima_start_pla\n"
    "hima_snapshot priority-start\n"
    "hima_check\n"
    "g_params -set {smPFlow::s_ARTestConvergePrplaced false}\n"
    "smPFlow -autoRefine\n"
    "hima_snapshot filled\n"
)


class StageDriverTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        exe = [sys.executable, STANDIN]
        self.case = fixtures.make_case(self.tmp.name, mage_executable=exe)
        caps = fixtures.make_site_capabilities(self.tmp.name, exe)
        self.workspace = self.root / "ws"
        (self.workspace / "placement" / "round-01").mkdir(parents=True)
        goal = {"target_dropped_count": 0, "max_target_distance_um": 100, "max_order_deviation_lr": 2,
                "max_order_deviation_tb": 1, "max_priority_move_um": 200}
        fixtures.write_workspace_state(self.workspace, self.case, caps, goal)   # the stand-in's fill reads state/start-snapshot.json
        self.log = self.workspace / "placement" / "round-01" / "session.jsonl"
        self.env = dict(os.environ)

    def tearDown(self):
        self.tmp.cleanup()

    def _session(self, env=None):
        m = self.case["manifest"]
        return session.MageSession(
            executable=[sys.executable, STANDIN], env=env or self.env, workdir=str(self.workspace),
            log_path=str(self.log),
            case={"frb": m["frb"]["path"], "caseDir": str(Path(m["frb"]["path"]).parent), "startPla": m["startState"]["path"]},
        )

    def _script(self, text, name="s.tcl"):
        path = self.root / name
        path.write_text(text, encoding="utf-8")
        return str(path)

    def _stage(self, k=1):
        return str(self.workspace / "placement" / "round-01" / f"stage-{k}")

    def test_baseline_stage_completes_with_snapshots_checks_export_and_log(self):
        result = self._session().run_stage(self._stage(), self._script(BASELINE), "engineer")
        self.assertTrue(result["completed"]); self.assertEqual(result["returncode"], 0)
        self.assertEqual([s["name"] for s in result["snapshots"]], ["priority-start", "filled"])
        self.assertTrue(Path(result["snapshots"][0]["pla"]).is_file())
        self.assertEqual(result["checks"]["1"]["OVERLAP"]["instances"], 0)
        self.assertEqual(sorted(result["verifyFiles"]), ["BOUNDARY", "OVERLAP", "SPACE"])
        doc = pla.read_pla(Path(result["exportPla"]).read_text(encoding="utf-8"), 10000)
        self.assertEqual(doc["units"], "dbu")
        self.assertTrue(any(f["base"] == "OVL_F" for f in doc["fits"]), "fill placed ordinary structures")
        self.assertEqual([d["base"] for d in doc["drops"]], ["KEY_V"])
        stage_text = Path(result["stageTcl"]).read_text(encoding="utf-8")
        self.assertIn(session.AGENT_BEGIN, stage_text); self.assertIn("MAGE_ROUND_END", stage_text)
        self.assertEqual(result["lastBoundary"], "filled"); self.assertIsNone(result["stageError"])
        lines = [json.loads(l) for l in self.log.read_text(encoding="utf-8").splitlines()]
        self.assertEqual(len(lines), 1)
        self.assertEqual(lines[0]["stageSha256"], result["stageSha256"])
        self.assertEqual(lines[0]["exportSha256"], result["exportSha256"]); self.assertTrue(lines[0]["completed"])

    def test_forbidden_patterns_are_refused_before_any_write(self):
        for text in ("exit 0\n", "frbOpen ../x.frb\n", "puts MAGE_ROUND_END\n", "puts {MAGE_SNAPSHOT 1 x}\n",
                     "puts MAGE_CHECK_BEGIN\n", "proc hima_snapshot {n} {}\n", "rename hima_check old\n",
                     "# hima:agent-end\n"):
            with self.assertRaises(core.MageError) as caught:
                self._session().run_stage(self._stage(), self._script(text), "engineer")
            self.assertEqual(caught.exception.code, "experiment", text)
            self.assertFalse(Path(self._stage()).exists(), text)

    def test_non_engineer_role_is_refused(self):
        with self.assertRaises(core.MageError) as caught:
            self._session().run_stage(self._stage(), self._script(BASELINE), "reviewer")
        self.assertEqual(caught.exception.code, "writer")

    def test_existing_stage_is_refused(self):
        self._session().run_stage(self._stage(), self._script(BASELINE), "engineer")
        with self.assertRaises(core.MageError) as caught:
            self._session().run_stage(self._stage(), self._script(BASELINE), "engineer")
        self.assertEqual(caught.exception.code, "stage-exists")

    def test_timeout_out_of_range_is_refused(self):
        with self.assertRaises(core.MageError) as caught:
            self._session().run_stage(self._stage(), self._script(BASELINE), "engineer", timeout_s=10)
        self.assertEqual(caught.exception.code, "timeout")

    def test_failure_after_a_boundary_is_blocked_with_the_boundary_named(self):
        env = dict(self.env); env["MAGE_STANDIN_FAIL_AFTER_SNAPSHOT"] = "priority-start"
        result = self._session(env).run_stage(self._stage(), self._script(BASELINE), "engineer")
        self.assertFalse(result["completed"]); self.assertEqual(result["returncode"], 2)
        self.assertEqual(result["lastBoundary"], "priority-start")
        self.assertIn("MAGE_STAGE_ERROR", result["stageError"]); self.assertIsNone(result["exportPla"])
        self.assertEqual([s["name"] for s in result["snapshots"]], ["priority-start"])

    def test_converge_autorefine_fails_like_the_real_build(self):
        text = BASELINE.replace("s_ARTestConvergePrplaced false", "s_ARTestConvergePrplaced true")
        result = self._session().run_stage(self._stage(), self._script(text), "engineer")
        self.assertFalse(result["completed"]); self.assertIn("Failed at auto refinement", result["stageError"])

    def test_offset_range_edit_invalidates_fits_in_the_snapshot(self):
        text = ("hima_open_build\nsource $hima_start_pla\n"
                "smSLFit {OVL_A} -setAutoRefine -arOffsetRangeX -1.000000 -arOffsetRangeY -1.000000\n"
                "hima_snapshot after-offsets\n")
        result = self._session().run_stage(self._stage(), self._script(text), "engineer")
        snap = pla.read_pla(Path(result["snapshots"][0]["pla"]).read_text(encoding="utf-8"), 10000)
        self.assertEqual(snap["fits"], []); self.assertEqual(len(snap["groups"]), 3)

    def test_no_end_marker_is_not_completed(self):
        env = dict(self.env); env["MAGE_STANDIN_NO_END"] = "1"
        result = self._session(env).run_stage(self._stage(), self._script(BASELINE), "engineer")
        self.assertFalse(result["completed"]); self.assertEqual(result["returncode"], 0)

    def test_slice_checks_and_snapshots_from_stdout(self):
        text = "MAGE_SNAPSHOT 1 a\nMAGE_CHECK_BEGIN 1 SPACE\n2 spacing overlapped instance(s)\nMAGE_CHECK_CODE 1 SPACE 0\nMAGE_CHECK_END 1 SPACE\n"
        checks = session.slice_checks(text)
        self.assertEqual(checks["1"]["SPACE"]["instances"], 2)
        with tempfile.TemporaryDirectory() as out:
            (Path(out) / "snap-01-a").mkdir()
            self.assertEqual(session.snapshots_from_stdout(text, out)[0]["name"], "a")
            self.assertEqual(session.snapshots_from_stdout("MAGE_SNAPSHOT 2 b\n", out), [])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 3: Run; expect FAIL** (`/usr/bin/python3 -m unittest discover -s flow/tests -t flow -p 'test_native_session.py'`): `AttributeError: run_stage` / the old constructor signature.

- [ ] **Step 4: Rewrite `flow/mage_placement/native/session.py`**

Keep `slice_verify` and `write_verify_files` and `_INSTANCE_RE` and `_iso_now` and `_unbraced` from the sibling verbatim; delete `TEMPLATE_FILES`, `MUTATING_MARKERS`, `mutating`, `_converge_lines`, `_EXPERIMENT_FORBIDDEN`, `_build_script`, `run_round`. Add:

```python
NATIVE_TYPES = ("OVERLAP", "SPACE", "BOUNDARY")
NATIVE_COMMANDS = {"OVERLAP": "frbCheckOverlap", "SPACE": "frbCheckSpace", "BOUNDARY": "frbCheckBoundary"}
ENGINEER_ROLE = "engineer"
END_MARKER = "MAGE_ROUND_END code 0"
AGENT_BEGIN = "# hima:agent-begin"
AGENT_END = "# hima:agent-end"
FORBIDDEN_PATTERNS = tuple(re.compile(p) for p in (
    r"\bexit\b", r"\bfrbOpen\b", r"MAGE_VERIFY", r"MAGE_ROUND_END", r"MAGE_SNAPSHOT",
    r"MAGE_STAGE_ERROR", r"MAGE_CHECK", r"\b(proc|rename)\s+hima_", r"hima:(prelude|agent)-(begin|end)",
))
_PRELUDE = Path(__file__).resolve().parent / "prelude.tcl"
_EPILOGUE = Path(__file__).resolve().parent / "epilogue.tcl"
_SNAPSHOT_RE = re.compile(r"^MAGE_SNAPSHOT (\d+) (\S+)$")
_STAGE_ERROR_RE = re.compile(r"^MAGE_STAGE_ERROR boundary (\S+) message (.*)$")
MIN_TIMEOUT_S, MAX_TIMEOUT_S = 60, 14400


def refuse_forbidden(script_text):
    for pattern in FORBIDDEN_PATTERNS:
        if pattern.search(script_text):
            raise core.MageError("experiment", f"stage script contains forbidden text {pattern.pattern!r}")


def slice_checks(stdout_text):
    """`{str(snap_index): {TYPE: {"code", "instances"}}}` from the prelude's MAGE_CHECK_* blocks."""
    blocks, current = {}, None
    for raw in stdout_text.splitlines():
        s = raw.strip()
        if s.startswith("MAGE_CHECK_BEGIN "):
            _, idx, t = s.split(" ", 2); current = (idx, t)
            blocks.setdefault(idx, {})[t] = {"code": None, "instances": None, "lines": []}
        elif s.startswith("MAGE_CHECK_CODE "):
            parts = s.split()
            if len(parts) == 4 and parts[1] in blocks and parts[2] in blocks[parts[1]]:
                blocks[parts[1]][parts[2]]["code"] = int(parts[3]) if parts[3].isdigit() else None
        elif s.startswith("MAGE_CHECK_END "):
            current = None
        elif current is not None:
            blocks[current[0]][current[1]]["lines"].append(raw)
    for idx in blocks:
        for t, block in blocks[idx].items():
            for line in block["lines"]:
                m = _INSTANCE_RE.match(line.strip())
                if m:
                    block["instances"] = int(m.group(1)); break
            del block["lines"]
    return blocks


def snapshots_from_stdout(stdout_text, out_dir):
    found = []
    for raw in stdout_text.splitlines():
        m = _SNAPSHOT_RE.match(raw.strip())
        if not m:
            continue
        index, name = int(m.group(1)), m.group(2)
        d = Path(out_dir) / ("snap-%02d-%s" % (index, name))
        if (d / "placement.pla").is_file():
            found.append({"index": index, "name": name, "pla": str(d / "placement.pla"),
                          "summary": str(d / "summary.txt") if (d / "summary.txt").is_file() else None})
    return found


class MageSession:
    """Drives one Site's MAGE binary, one agent-authored stage at a time."""

    def __init__(self, executable, env, workdir, log_path, case):
        self.executable, self.env, self.workdir, self.log_path, self.case = executable, env, workdir, log_path, case

    def _resolve(self, path):
        p = Path(path)
        return p if p.is_absolute() or not self.workdir else Path(self.workdir) / p

    def _assemble(self, agent_text, out_dir):
        prelude = tcl.fill(_PRELUDE.read_text(encoding="utf-8"), {
            "FRB": _unbraced(self.case["frb"]), "CASE_DIR": _unbraced(self.case["caseDir"]),
            "START_PLA": _unbraced(self.case["startPla"]), "OUT": _unbraced(str(out_dir)),
        })
        epilogue = tcl.fill(_EPILOGUE.read_text(encoding="utf-8"), {"OUT": _unbraced(str(out_dir))})
        body = "\n".join([prelude.rstrip("\n"), AGENT_BEGIN, agent_text.rstrip("\n"), AGENT_END,
                          'set hima_stage_boundary "epilogue"', epilogue.rstrip("\n")])
        return ("set mage_stage_code [catch {\n" + body + "\n} mage_stage_message mage_stage_options]\n"
                "if {$mage_stage_code} {\n"
                "    puts stderr [list MAGE_STAGE_ERROR boundary $hima_stage_boundary message $mage_stage_message]\n"
                "    exit 2\n}\nexit 0\n")

    def _append_log(self, entry):
        Path(self.log_path).parent.mkdir(parents=True, exist_ok=True)
        with open(self.log_path, "a", encoding="utf-8") as h:
            h.write(json.dumps(entry, sort_keys=True) + "\n")

    def run_stage(self, stage_dir, script_path, role, timeout_s=1800):
        if not (MIN_TIMEOUT_S <= int(timeout_s) <= MAX_TIMEOUT_S):
            raise core.MageError("timeout", f"timeout_s must be within {MIN_TIMEOUT_S}..{MAX_TIMEOUT_S}")
        stage_dir = self._resolve(stage_dir)
        if (stage_dir / "stage.tcl").exists():
            raise core.MageError("stage-exists", f"{stage_dir} already holds a stage.tcl")
        agent_bytes = Path(script_path).read_bytes()
        agent_text = agent_bytes.decode("utf-8", errors="replace")
        refuse_forbidden(agent_text)
        if role != ENGINEER_ROLE:
            raise core.MageError("writer", f"role {role!r} may not run a MAGE stage")

        out_dir = stage_dir / "out"
        out_dir.mkdir(parents=True, exist_ok=True)
        script_copy = stage_dir / "script.tcl"; script_copy.write_bytes(agent_bytes)
        stage_tcl = stage_dir / "stage.tcl"; stage_tcl.write_text(self._assemble(agent_text, out_dir), encoding="utf-8")
        script_sha, stage_sha = core.file_sha256(script_copy), core.file_sha256(stage_tcl)

        stdout_path, stderr_path = out_dir / "stdout.log", out_dir / "stderr.log"
        prefix = self.executable if isinstance(self.executable, list) else [self.executable]
        started = _iso_now(); timed_out = False
        with open(stdout_path, "wb") as o, open(stderr_path, "wb") as e:
            proc = subprocess.Popen(list(prefix) + [str(stage_tcl), "-noterm"], cwd=str(stage_dir), env=self.env,
                                    stdout=o, stderr=e, start_new_session=True)
            try:
                rc = proc.wait(timeout=int(timeout_s))
            except subprocess.TimeoutExpired:
                timed_out = True
                try: os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
                except (ProcessLookupError, PermissionError, OSError): proc.kill()
                proc.wait(); rc = -9
        ended = _iso_now()

        stdout_text = stdout_path.read_text(encoding="utf-8", errors="replace")
        stderr_text = stderr_path.read_text(encoding="utf-8", errors="replace")
        completed = rc == 0 and not timed_out and any(l.strip() == END_MARKER for l in stdout_text.splitlines())
        stage_error, last_boundary = None, None
        for line in stderr_text.splitlines():
            m = _STAGE_ERROR_RE.match(line.strip())
            if m:
                stage_error, last_boundary = line.strip(), m.group(1); break
        snapshots = snapshots_from_stdout(stdout_text, out_dir)
        for s in snapshots:
            s["sha256"] = core.file_sha256(s["pla"])
        if last_boundary is None and snapshots:
            last_boundary = snapshots[-1]["name"]
        if timed_out and stage_error is None:
            stage_error = f"timeout after {int(timeout_s)} s"
        verify_files = write_verify_files(stdout_path, out_dir)
        export = out_dir / "export.pla"
        result = {
            "stageDir": str(stage_dir), "scriptTcl": str(script_copy), "scriptSha256": script_sha,
            "stageTcl": str(stage_tcl), "stageSha256": stage_sha, "returncode": rc, "timedOut": timed_out,
            "completed": completed, "lastBoundary": last_boundary, "stageError": stage_error,
            "exportPla": str(export) if export.is_file() else None,
            "exportSha256": core.file_sha256(export) if export.is_file() else None,
            "summary": str(out_dir / "summary.txt") if (out_dir / "summary.txt").is_file() else None,
            "stdout": str(stdout_path), "stdoutSha256": core.file_sha256(stdout_path),
            "verifyFiles": verify_files, "snapshots": snapshots, "checks": slice_checks(stdout_text),
            "startedAt": started, "endedAt": ended,
        }
        self._append_log({"stageDir": str(stage_dir), "role": role, "scriptSha256": script_sha, "stageSha256": stage_sha,
                          "mutating": True, "returncode": rc, "timedOut": timed_out, "completed": completed,
                          "exportSha256": result["exportSha256"], "stdoutSha256": result["stdoutSha256"],
                          "startedAt": started, "endedAt": ended})
        return result
```

Imports at the top: `json, os, re, signal, subprocess`, `Path`, `datetime`, `from .. import core`, `from . import tcl`. Rewrite the module docstring to describe the stage driver (one agent-authored stage per call, prelude/epilogue, refusal gate, markers, completion by `MAGE_ROUND_END code 0` never by return code).

- [ ] **Step 5: Rewrite `flow/tests/standin_mage.py`**

```python
#!/usr/bin/env python3
"""Stand-in MAGE for the mage-script-placement Pack (tests only, no licence).

Invoked as the real binary: `<this> <stage.tcl> -noterm`. It reads the
Pack-assembled stage.tcl, takes the case paths from the prelude's `set
hima_*` lines, and interprets ONLY the lines between `# hima:agent-begin`
and `# hima:agent-end` with a tiny line-based state machine:

  hima_open_build [...]            state <- fixed instances of the start PLA, no Groups/Fits/drops
  source <pla>                     state <- that PLA ($hima_start_pla is substituted)
  smPFlow -placeGroup -groupItem G -groupTargetPoint (x,y) ...
                                   add the start PLA's Group(s) G at (x,y) um and their in-group Fits
  g_params -set {smPFlow::s_ARTestConvergePrplaced true|false}
  smPFlow -autoRefine              converge mode true -> fail like the real build (unless MAGE_STANDIN_CONVERGE_OK=1);
                                   else fill: top ordinary bases up to the start snapshot's rule-derived pending,
                                   recording MAGE_STANDIN_DROP_BASES (default KEY_V) as drops
  smSLFit ... -arOffsetRange...    empty the placed Fits, keep Groups (MAGE_STANDIN_OFFSET_INVALIDATES=0 disables)
  hima_snapshot <name>             write out/snap-NN-<name>/placement.pla (DBU shape) + summary; print marker
  hima_check                       print MAGE_CHECK_* blocks (rows from MAGE_STANDIN_ROWS)

Every other agent line is ignored. The epilogue is hard-coded: MAGE_VERIFY_*
blocks, out/export.pla (DBU shape), out/summary.txt, `MAGE_ROUND_END code 0`.
Failure knobs: MAGE_STANDIN_FAIL=1, MAGE_STANDIN_FAIL_AFTER_SNAPSHOT=<name>,
MAGE_STANDIN_VERIFY_FAIL=<TYPE>, MAGE_STANDIN_NO_END=1.
"""
from __future__ import annotations

import json, os, re, sys
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core, pla  # noqa: E402

DBU = 10000
_SET_RE = re.compile(r"^set (hima_case_frb|hima_case_dir|hima_start_pla|hima_out) \{(.*)\}$", re.M)
_PLACE_GROUP_RE = re.compile(r"smPFlow\s+-placeGroup\s+-groupItem\s+(\S+)\s+-groupTargetPoint\s+\(([-\d.]+),([-\d.]+)\)")
_PHRASE = {"OVERLAP": "overlapped", "SPACE": "spacing overlapped", "BOUNDARY": "outside-frame-boundary"}


def _fail(boundary, message):
    sys.stderr.write("MAGE_STAGE_ERROR boundary %s message {%s}\n" % (boundary, message))
    sys.exit(2)


def _find_start_snapshot(path):
    for ancestor in [path.parent, *path.parents]:
        f = ancestor / "state" / "start-snapshot.json"
        if f.is_file():
            try: return json.loads(f.read_text(encoding="utf-8"))
            except (OSError, ValueError): return None
    return None


def _fill(state, start_snapshot, drop_bases):
    needed = {}
    for item in (start_snapshot or {}).get("pending", []):
        if item.get("inGroup"): continue
        needed.setdefault(item["base"], {"count": 0, "sizeDbu": item.get("sizeDbu")})["count"] += 1
    have = {}
    for f in state["fits"] + state["drops"]:
        if not f.get("inGroup"): have[f["base"]] = have.get(f["base"], 0) + 1
    for base, info in sorted(needed.items()):
        size = info["sizeDbu"] or [1000000, 560000]
        for k in range(1, info["count"] - have.get(base, 0) + 1):
            if base in drop_bases:
                state["drops"].append({"id": "%s.%s" % (base, base), "base": base, "inst": "%s.%s" % (base, base),
                                       "boxDbu": [0, 0, size[0], size[1]], "extraRot": "NULL", "placedFlag": 0,
                                       "postfix": "", "inGroup": ""})
            else:
                left = 5500000 + (k - 1) * 11000000
                state["fits"].append({"id": "%s.%s_fill%d" % (base, base, k), "base": base, "inst": "%s.%s_fill%d" % (base, base, k),
                                      "boxDbu": [left, 20000, left + size[0], 20000 + size[1]],
                                      "extraRot": "NULL", "postfix": "", "inGroup": ""})


def _print_check_block(kind, idx, t, rows, verify_fail):
    tag = "MAGE_VERIFY" if kind == "verify" else "MAGE_CHECK"
    head = "%s_BEGIN %s%s" % (tag, (idx + " ") if idx else "", t)
    print(head)
    for r in rows: print(r)
    print("%d %s instance(s)" % (len(rows), _PHRASE[t]))
    print("%s_CODE %s%s %d" % (tag, (idx + " ") if idx else "", t, 1 if verify_fail == t else 0))
    print("%s_END %s%s" % (tag, (idx + " ") if idx else "", t))


def main(argv):
    if not argv:
        sys.stderr.write("usage: standin_mage.py <stage.tcl> -noterm\n"); return 2
    if os.environ.get("MAGE_STANDIN_FAIL") == "1":
        _fail("prelude", "forced")
    stage_path = Path(argv[0]); text = stage_path.read_text(encoding="utf-8")
    vars_ = dict(_SET_RE.findall(text))
    out = Path(vars_["hima_out"]); start_pla_path = vars_["hima_start_pla"]
    out.mkdir(parents=True, exist_ok=True)
    start_doc = pla.read_pla(Path(start_pla_path).read_text(encoding="utf-8"), DBU)
    start_snapshot = _find_start_snapshot(stage_path)
    rows_by_type = json.loads(os.environ.get("MAGE_STANDIN_ROWS") or "{}")
    verify_fail = os.environ.get("MAGE_STANDIN_VERIFY_FAIL")
    drop_bases = set(filter(None, os.environ.get("MAGE_STANDIN_DROP_BASES", "KEY_V").split(",")))
    begin, end = text.index("# hima:agent-begin"), text.index("# hima:agent-end")
    agent_lines = text[begin:end].splitlines()[1:]

    state = {"units": "dbu", "dbuPerUm": DBU, "fixed": [], "groups": [], "fits": [], "drops": []}
    converge, snap_index, boundary = False, 0, "prelude"
    for raw in agent_lines:
        line = raw.strip()
        if not line or line.startswith("#"): continue
        if line.startswith("hima_open_build"):
            state = {"units": "dbu", "dbuPerUm": DBU, "fixed": [dict(f) for f in start_doc["fixed"]],
                     "groups": [], "fits": [], "drops": []}; boundary = "open-build"
        elif line.startswith("source "):
            target = line[len("source "):].strip().strip("{}").replace("$hima_start_pla", start_pla_path)
            state = pla.read_pla(Path(target).read_text(encoding="utf-8"), DBU)
        elif _PLACE_GROUP_RE.search(line):
            g, x, y = _PLACE_GROUP_RE.search(line).groups()
            point = [core.um_to_dbu(x, DBU), core.um_to_dbu(y, DBU)]
            for grp in start_doc["groups"]:
                if grp["groupItem"] == g and grp["targetPointDbu"] == point and grp not in state["groups"]:
                    state["groups"].append(dict(grp))
                    state["fits"].extend(dict(f) for f in start_doc["fits"] if f["inGroup"] == grp["pinstGroup"])
        elif "s_ARTestConvergePrplaced" in line:
            converge = "true" in line
        elif "-autoRefine" in line and "-setAutoRefine" not in line:
            if converge and os.environ.get("MAGE_STANDIN_CONVERGE_OK") != "1":
                print("Sort sl SCRIBE_V_1 preplaced fits failed"); print("Failed at auto refinement"); sys.stdout.flush()
                _fail(boundary, "Failed at auto refinement")
            _fill(state, start_snapshot, drop_bases)
        elif line.startswith("smSLFit") and "-arOffsetRange" in line:
            if os.environ.get("MAGE_STANDIN_OFFSET_INVALIDATES", "1") == "1":
                state["fits"] = []
        elif line.startswith("hima_snapshot "):
            name = line.split(None, 1)[1].strip(); snap_index += 1
            d = out / ("snap-%02d-%s" % (snap_index, name)); d.mkdir(parents=True, exist_ok=True)
            (d / "placement.pla").write_text(pla.write_pla(state, DBU, units="dbu"), encoding="utf-8")
            (d / "summary.txt").write_text("fits: %d\n" % len(state["fits"]), encoding="utf-8")
            print("MAGE_SNAPSHOT %d %s" % (snap_index, name)); sys.stdout.flush(); boundary = name
            if os.environ.get("MAGE_STANDIN_FAIL_AFTER_SNAPSHOT") == name:
                _fail(name, "forced after snapshot")
        elif line.startswith("hima_check"):
            for t in ("OVERLAP", "SPACE", "BOUNDARY"):
                _print_check_block("check", str(snap_index), t, rows_by_type.get(t, []), None)
    for t in ("OVERLAP", "SPACE", "BOUNDARY"):
        _print_check_block("verify", "", t, rows_by_type.get(t, []), verify_fail)
    (out / "export.pla").write_text(pla.write_pla(state, DBU, units="dbu"), encoding="utf-8")
    (out / "summary.txt").write_text("fits: %d\ndrops: %d\n" % (len(state["fits"]), len(state["drops"])), encoding="utf-8")
    if os.environ.get("MAGE_STANDIN_NO_END") != "1":
        print("MAGE_ROUND_END code 0")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
```

Note: `pla.write_pla` needs `fixed` rows with `idTriple`; when `hima_open_build` copies `start_doc["fixed"]` the field is already present. Run `chmod +x flow/tests/standin_mage.py`.

- [ ] **Step 6: Run the driver tests and the whole suite; expect `OK`**, then **commit and push** (`feat(mage-script): stage driver with prelude/epilogue, refusal gate and stand-in MAGE`).

---

### Task 5: Resident subcommands `mage-stage`, `stage-report`, `candidate`, `script-candidate` (Opus 4.8 medium)

**Files:**
- Modify: `flow/mage_placement_cli.py`
- Test: `flow/tests/test_cli_stage.py` (new)

**Interfaces:**
- Consumes: `MageSession.run_stage`, `metrics.*`, `snapshot.build_snapshot`, `snapshot.check_inventory_conservation`, `records.validate_record`, `_resolve_in_workspace`, `_case_readiness` (reads `state/case-readiness.json`, written by `prepare-case`; until Task 7 lands, tests write that file by hand as shown below).
- Produces: the CLI rows in Frozen interfaces; `mage.stage-summary/1` at `<stage-dir>/stage-summary.json`; `mage.stage-report/1`; `mage.script-candidate/1`.

- [ ] **Step 1: Write the failing tests, `flow/tests/test_cli_stage.py`**

```python
import json, os, subprocess, sys, tempfile, unittest
from pathlib import Path
sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core, pla, rules, snapshot, targets  # noqa: E402
from tests import fixtures  # noqa: E402

FLOW = Path(__file__).resolve().parents[1]
CLI, STANDIN = FLOW / "mage_placement_cli.py", FLOW / "tests" / "standin_mage.py"
BASELINE = ("hima_open_build\nsource $hima_start_pla\nhima_snapshot priority-start\nhima_check\n"
            "g_params -set {smPFlow::s_ARTestConvergePrplaced false}\nsmPFlow -autoRefine\nhima_snapshot filled\n")


def run_cli(args, env=None, expect=0):
    r = subprocess.run([sys.executable, str(CLI)] + [str(a) for a in args], capture_output=True, text=True, env=env)
    assert r.returncode == expect, f"{args}: rc={r.returncode}\n{r.stderr}\n{r.stdout}"
    return r


write_readiness_and_start = fixtures.write_workspace_state   # Task 3's helper; kept under this name for test_readers

GOAL = {"target_dropped_count": 0, "max_target_distance_um": 100, "max_order_deviation_lr": 2,
        "max_order_deviation_tb": 1, "max_priority_move_um": 200}


class CliStageTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        self.workspace = self.root / "ws"; self.workspace.mkdir()
        os.symlink(FLOW, self.workspace / "flow")
        exe = [sys.executable, str(STANDIN)]
        self.case = fixtures.make_case(self.tmp.name, mage_executable=exe)
        caps = fixtures.make_site_capabilities(self.tmp.name, exe)
        self.start = write_readiness_and_start(self.workspace, self.case, caps, GOAL)
        self.round_dir = Path("placement/round-01")
        (self.workspace / self.round_dir).mkdir(parents=True)
        self.env = dict(os.environ)

    def tearDown(self):
        self.tmp.cleanup()

    def _stage(self, k, text, env=None, expect=0):
        script = self.workspace / self.round_dir / f"script-{k}.tcl"; script.write_text(text, encoding="utf-8")
        run_cli(["mage-stage", self.workspace, "--round", 1, "--script", script, "--out-dir", self.round_dir / f"stage-{k}"],
                env=env or self.env, expect=expect)
        return self.workspace / self.round_dir / f"stage-{k}"

    def _journal(self, stage_dir):
        summary = json.loads((stage_dir / "stage-summary.json").read_text(encoding="utf-8"))
        path = self.workspace / self.round_dir / "journal-entry.json"
        path.write_text(json.dumps(fixtures.journal_entry(1, summary["scriptSha256"])), encoding="utf-8")
        return path

    def test_mage_stage_writes_summary_and_session_log(self):
        stage_dir = self._stage(1, BASELINE)
        summary = json.loads((stage_dir / "stage-summary.json").read_text(encoding="utf-8"))
        self.assertEqual(summary["schema"], "mage.stage-summary/1"); self.assertTrue(summary["completed"])
        self.assertEqual(summary["round"], 1); self.assertEqual(summary["stage"], 1)
        self.assertTrue((self.workspace / self.round_dir / "session.jsonl").is_file())

    def test_mage_stage_refuses_a_stage_dir_outside_the_round(self):
        script = self.workspace / self.round_dir / "s.tcl"; script.write_text(BASELINE, encoding="utf-8")
        r = run_cli(["mage-stage", self.workspace, "--round", 1, "--script", script, "--out-dir", "placement/round-02/stage-1"], expect=3)
        self.assertIn("invalid-input", r.stderr)

    def test_stage_report_rows_cover_every_boundary_and_the_export(self):
        stage_dir = self._stage(1, BASELINE)
        out = self.workspace / self.round_dir / "report.json"
        run_cli(["stage-report", self.workspace, "--stage-dir", stage_dir, "--out", out])
        report = json.loads(out.read_text(encoding="utf-8"))
        self.assertEqual([r["boundary"] for r in report["rows"]], ["priority-start", "filled", "export"])
        self.assertEqual(report["rows"][0]["inGroupFits"], 3); self.assertEqual(report["rows"][0]["ordinaryFits"], 0)
        self.assertEqual(report["rows"][2]["drops"]["ordinary"]["count"], 1)
        self.assertEqual(report["rows"][0]["nativeRows"]["total"], 0)
        self.assertIsNone(report["rows"][1]["nativeRows"])
        self.assertEqual(report["rows"][2]["inventory"]["status"], "pass")
        self.assertEqual(report["rows"][0]["inventory"]["status"], "fail")   # priority-only: ordinary population 0

    def test_stage_report_names_the_invalidated_state(self):
        text = ("hima_open_build\nsource $hima_start_pla\n"
                "smSLFit {OVL_A} -setAutoRefine -arOffsetRangeX -1.000000 -arOffsetRangeY -1.000000\n"
                "hima_snapshot after-offsets\ng_params -set {smPFlow::s_ARTestConvergePrplaced false}\nsmPFlow -autoRefine\n")
        stage_dir = self._stage(1, text)
        out = self.workspace / self.round_dir / "report.json"
        run_cli(["stage-report", self.workspace, "--stage-dir", stage_dir, "--out", out])
        row = json.loads(out.read_text(encoding="utf-8"))["rows"][0]
        self.assertEqual(row["groups"], 3); self.assertEqual(row["inGroupFits"], 0)

    def test_candidate_completed_carries_metrics_and_files(self):
        stage_dir = self._stage(1, BASELINE)
        journal = self._journal(stage_dir)
        out = self.workspace / "state" / "round" / "script-candidate.json"
        run_cli(["candidate", self.workspace, "--round", 1, "--stage-dir", stage_dir, "--journal", journal, "--out", out])
        doc = core.read_artifact(out, "script-candidate")
        self.assertEqual(doc["outcome"], "completed")
        self.assertEqual(doc["metrics"]["drops"]["ordinary"]["count"], 1)
        self.assertEqual(doc["metrics"]["displacement"]["priority"]["maxUm"], "0")
        self.assertEqual(doc["metrics"]["orderDeviation"]["maxLr"], 0)
        self.assertEqual(len(doc["files"]["snapshots"]), 2)
        for key in ("script", "stageScript", "sessionLog", "journal", "export", "snapshot"):
            ref = doc["files"][key]
            self.assertEqual(core.file_sha256(self.workspace / ref["path"]), ref["sha256"], key)
            self.assertTrue(ref["path"].startswith("placement/round-01/"), key)
        self.assertTrue((stage_dir / "out" / "snapshot.json").is_file())

    def test_candidate_from_a_failed_stage_is_blocked_with_the_boundary(self):
        env = dict(self.env); env["MAGE_STANDIN_FAIL_AFTER_SNAPSHOT"] = "priority-start"
        stage_dir = self._stage(1, BASELINE, env=env)
        journal = self._journal(stage_dir)
        out = self.workspace / "state" / "round" / "script-candidate.json"
        run_cli(["candidate", self.workspace, "--round", 1, "--stage-dir", stage_dir, "--journal", journal, "--out", out])
        doc = core.read_artifact(out, "script-candidate")
        self.assertEqual(doc["outcome"], "blocked"); self.assertIn("priority-start", doc["stopReason"])
        self.assertNotIn("export", doc["files"]); self.assertEqual(doc["metrics"], {})

    def test_candidate_with_lost_inventory_is_blocked_not_an_improvement(self):
        text = "hima_open_build\nsource $hima_start_pla\nhima_snapshot priority-only\n"   # no fill: ordinary population 0
        stage_dir = self._stage(1, text)
        journal = self._journal(stage_dir)
        out = self.workspace / "state" / "round" / "script-candidate.json"
        run_cli(["candidate", self.workspace, "--round", 1, "--stage-dir", stage_dir, "--journal", journal, "--out", out])
        doc = core.read_artifact(out, "script-candidate")
        self.assertEqual(doc["outcome"], "blocked"); self.assertIn("ordinary population", doc["stopReason"])

    def test_candidate_refuses_an_invalid_journal(self):
        stage_dir = self._stage(1, BASELINE)
        bad = self.workspace / self.round_dir / "journal-entry.json"
        bad.write_text(json.dumps({"schema": "mage.journal-entry/1", "round": 1}), encoding="utf-8")
        r = run_cli(["candidate", self.workspace, "--round", 1, "--stage-dir", stage_dir, "--journal", bad,
                     "--out", self.workspace / "state" / "round" / "script-candidate.json"], expect=3)
        self.assertIn("schema", r.stderr)

    def test_script_candidate_fallback_validates_never_fabricates(self):
        r = run_cli(["script-candidate", self.workspace, 0, 100, 2, 1, 200], expect=3)
        self.assertIn("engineering-required", r.stderr)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run; expect FAIL** (`unknown subcommand: 'mage-stage'`).

- [ ] **Step 3: Implement the subcommands in `flow/mage_placement_cli.py`**

Add after `_cmd_plan_slots`:

```python
_ROUND_DIR_RE = re.compile(r"^placement/round-(\d{2})$")


def _round_dir_of(workspace, stage_dir, round_no):
    """`stage_dir` must be `placement/round-NN/<stage>` for this round; returns the round dir."""
    try:
        rel = Path(stage_dir).resolve().relative_to(Path(workspace).resolve()).as_posix()
    except ValueError:
        raise core.MageError("invalid-input", f"stage dir {stage_dir} is outside the workspace")
    parent = rel.rsplit("/", 1)[0] if "/" in rel else ""
    match = _ROUND_DIR_RE.match(parent)
    if not match or int(match.group(1)) != int(round_no):
        raise core.MageError("invalid-input", f"stage dir {rel!r} is not under placement/round-{int(round_no):02d}/")
    return Path(workspace) / parent


def _stage_session(workspace, readiness, log_path):
    site_mage = readiness["siteCapabilities"]["mage"]
    manifest = readiness["manifest"]
    env = dict(os.environ); env.update(site_mage.get("env", {}))
    return native_session.MageSession(
        executable=site_mage["executable"], env=env, workdir=str(Path(workspace)), log_path=str(log_path),
        case={"frb": manifest["frb"]["path"], "caseDir": str(Path(manifest["frb"]["path"]).parent),
              "startPla": manifest["startState"]["path"]},
    )


def _cmd_mage_stage(workspace, args):
    parser = argparse.ArgumentParser(prog="mage-stage")
    parser.add_argument("--round", required=True, type=int)
    parser.add_argument("--script", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--timeout-s", type=int, default=1800)
    opts = parser.parse_args(args)
    readiness = _case_readiness(workspace)
    stage_dir = _resolve_in_workspace(workspace, opts.out_dir)
    round_dir = _round_dir_of(workspace, stage_dir, opts.round)
    round_dir.mkdir(parents=True, exist_ok=True)
    sess = _stage_session(workspace, readiness, round_dir / "session.jsonl")
    result = sess.run_stage(str(stage_dir), str(_resolve_in_workspace(workspace, opts.script)),
                            native_session.ENGINEER_ROLE, timeout_s=opts.timeout_s)
    stage_no = int(re.sub(r"\D", "", stage_dir.name) or 0) or 1
    summary = core.stamp("stage-summary", {"round": opts.round, "stage": stage_no, "role": native_session.ENGINEER_ROLE, **result})
    errors = records.validate_record("stage-summary", summary)
    if errors:
        raise core.MageError("schema", "; ".join(errors))
    return str(stage_dir / "stage-summary.json"), summary


def _snapshot_from_pla(workspace, start, pla_path, stage, inputs):
    doc = pla.read_pla(Path(pla_path).read_text(encoding="utf-8"), start["dbuPerUm"])
    return snapshot.build_snapshot(stage, doc, start["frame"], start["ruleFacts"], start["targets"], {},
                                   inputs, pending_from_rules=False)


def _report_row(workspace, start, snap, boundary, index, source, goal, native):
    try:
        snapshot.check_inventory_conservation(start, snap, _incumbent_ordinary_population(workspace))
        inventory = {"status": "pass", "detail": ""}
    except core.MageError as exc:
        inventory = {"status": "fail", "detail": exc.detail}
    target = metrics_mod.target_distances(snap, str(goal["max_target_distance_um"]))
    order = metrics_mod.order_deviation(snap)
    moved = metrics_mod.displacement(start, snap)["priority"]
    return {
        "boundary": boundary, "index": index, "source": source,
        "fixed": len(snap["fixed"]), "groups": len(snap["groups"]),
        "inGroupFits": sum(1 for f in snap["fits"] if f.get("inGroup")),
        "ordinaryFits": sum(1 for f in snap["fits"] if not f.get("inGroup")),
        "drops": metrics_mod.drops(snap), "inventory": inventory,
        "targetDistances": {"maxUm": target["maxUm"], "overLimitCount": target["overLimitCount"],
                            "identity": "known" if not target["unplaced"] else "identity-unknown"},
        "orderDeviation": {"max": order["max"], "maxLr": order["maxLr"], "maxTb": order["maxTb"], "byPartition": order["byPartition"]},
        "priorityMovement": {"movedCount": moved["movedCount"], "maxUm": moved["maxUm"], "totalUm": moved["totalUm"], "unmatched": moved["unmatched"]},
        "nativeRows": native,
    }


def _cmd_stage_report(workspace, args):
    parser = argparse.ArgumentParser(prog="stage-report")
    parser.add_argument("--stage-dir", required=True)
    parser.add_argument("--out", required=True)
    opts = parser.parse_args(args)
    stage_dir = _resolve_in_workspace(workspace, opts.stage_dir)
    summary = json.loads((stage_dir / "stage-summary.json").read_text(encoding="utf-8"))
    readiness = _case_readiness(workspace)
    start = snapshot.load_snapshot(Path(workspace) / "state" / "start-snapshot.json")
    rows = []
    for snap_ref in summary["snapshots"]:
        snap = _snapshot_from_pla(workspace, start, snap_ref["pla"], "candidate", {})
        checks = summary.get("checks", {}).get(str(snap_ref["index"]))
        native = None
        if checks:
            by_type = {t: checks.get(t, {}).get("instances") for t in NATIVE_TYPES}
            native = {"byType": by_type, "total": None if any(v is None for v in by_type.values()) else sum(by_type.values())}
        rows.append(_report_row(workspace, start, snap, snap_ref["name"], snap_ref["index"], "snapshot", readiness["goal"], native))
    if summary.get("completed") and summary.get("exportPla"):
        snap = _snapshot_from_pla(workspace, start, summary["exportPla"], "candidate", {})
        native = metrics_mod.native_rows({t: p for t, p in summary.get("verifyFiles", {}).items()})
        rows.append(_report_row(workspace, start, snap, "export", None, "export", readiness["goal"],
                                {"byType": native["byType"], "total": native["total"]}))
    body = core.stamp("stage-report", {"stageDir": str(stage_dir.resolve().relative_to(Path(workspace).resolve())), "rows": rows})
    errors = records.validate_record("stage-report", body)
    if errors:
        raise core.MageError("schema", "; ".join(errors))
    return str(_resolve_in_workspace(workspace, opts.out)), body


def _ref(workspace, path):
    path = Path(path)
    return {"path": str(path.resolve().relative_to(Path(workspace).resolve())), "sha256": core.file_sha256(path)}


def _cmd_candidate(workspace, args):
    parser = argparse.ArgumentParser(prog="candidate")
    parser.add_argument("--round", required=True, type=int)
    parser.add_argument("--stage-dir", required=True)
    parser.add_argument("--journal", required=True)
    parser.add_argument("--out", required=True)
    opts = parser.parse_args(args)
    ws = Path(workspace).resolve()
    stage_dir = _resolve_in_workspace(workspace, opts.stage_dir)
    round_dir = _round_dir_of(workspace, stage_dir, opts.round)
    out_path = str(_resolve_in_workspace(workspace, opts.out))
    summary = json.loads((stage_dir / "stage-summary.json").read_text(encoding="utf-8"))
    readiness = _case_readiness(workspace)
    start = snapshot.load_snapshot(ws / "state" / "start-snapshot.json")

    journal_path = _resolve_in_workspace(workspace, opts.journal)
    try:
        entry = json.loads(journal_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise core.MageError("missing-input", f"cannot read journal entry {journal_path}: {exc}") from exc
    errors = records.validate_record("journal-entry", entry)
    if errors or entry.get("round") != opts.round:
        raise core.MageError("schema", "; ".join(errors) or "journal entry round does not match --round")

    files = {
        "script": _ref(ws, stage_dir / "script.tcl"), "stageScript": _ref(ws, stage_dir / "stage.tcl"),
        "sessionLog": _ref(ws, round_dir / "session.jsonl"), "journal": _ref(ws, journal_path),
        "verify": {t: _ref(ws, p) for t, p in summary.get("verifyFiles", {}).items()},
        "snapshots": [{"index": s["index"], "name": s["name"], **_ref(ws, s["pla"])} for s in summary.get("snapshots", [])],
    }
    reproduction = {"stageDir": str(stage_dir.resolve().relative_to(ws)), "script": "script.tcl", "stageScript": "stage.tcl"}
    build_banner = readiness["manifest"].get("mage", {}).get("buildBanner", "")
    identity = {**_identity(), "round": opts.round}

    def _blocked(reason):
        body = core.stamp("script-candidate", {
            "identity": identity, "startSnapshotSha256": start["snapshotSha256"], "snapshotSha256": start["snapshotSha256"],
            "buildBanner": build_banner, "files": files, "metrics": {}, "remaining": [], "blocked": [{"reason": reason}],
            "unknown": [], "outcome": "blocked", "stopReason": reason, "reproduction": reproduction,
        })
        errs = records.validate_record("script-candidate", body)
        if errs:
            raise core.MageError("schema", "; ".join(errs))
        return out_path, body

    export = stage_dir / "out" / "export.pla"
    if not summary.get("completed") or not export.is_file():
        boundary = summary.get("lastBoundary") or "prelude"
        detail = summary.get("stageError") or ("no export.pla" if not export.is_file() else "no MAGE_ROUND_END marker")
        return _blocked(f"stage did not complete after boundary {boundary}: {detail}")

    candidate_snapshot = _snapshot_from_pla(workspace, start, export, "candidate", {"exportPla": _ref(ws, export)})
    try:
        _check_inventory_conservation(workspace, start, candidate_snapshot)
    except core.MageError as exc:
        return _blocked(f"inventory not conserved: {exc.detail}")
    snapshot_path = stage_dir / "out" / "snapshot.json"
    core.write_artifact(snapshot_path, candidate_snapshot)
    files["export"] = _ref(ws, export); files["snapshot"] = _ref(ws, snapshot_path)
    if summary.get("summary") and Path(summary["summary"]).is_file():
        files["summary"] = _ref(ws, summary["summary"])
    goal = readiness["goal"]
    verify_files = {t: str(ws / r["path"]) for t, r in files["verify"].items()}
    computed = {
        "drops": metrics_mod.drops(candidate_snapshot),
        "targetDistances": metrics_mod.target_distances(candidate_snapshot, str(goal["max_target_distance_um"])),
        "orderDeviation": metrics_mod.order_deviation(candidate_snapshot),
        "displacement": metrics_mod.displacement(start, candidate_snapshot),
        "nativeRows": metrics_mod.native_rows(verify_files),
        "priorityUnplaced": _priority_unplaced(candidate_snapshot),
    }
    body = core.stamp("script-candidate", {
        "identity": identity, "startSnapshotSha256": start["snapshotSha256"],
        "snapshotSha256": candidate_snapshot["snapshotSha256"], "buildBanner": build_banner,
        "files": files, "metrics": computed, "remaining": [p["id"] for p in candidate_snapshot["pending"]],
        "blocked": [], "unknown": computed["nativeRows"].get("unknown", []),
        "outcome": "completed", "stopReason": "", "reproduction": reproduction,
    })
    errors = records.validate_record("script-candidate", body)
    if errors:
        raise core.MageError("schema", "; ".join(errors))
    return out_path, body


def _cmd_script_candidate_fallback(workspace, args):
    """Batch fallback for `engineer-script`: validate the existing delivery, never fabricate one."""
    del args
    path = Path(workspace) / "state" / "round" / "script-candidate.json"
    if not path.is_file():
        raise core.MageError("engineering-required", "no script-candidate delivered for this round")
    body = core.read_artifact(path, "script-candidate")
    errors = records.validate_record("script-candidate", body)
    if errors:
        raise core.MageError("schema", "; ".join(errors))
    return path, body
```

Register `"mage-stage": _cmd_mage_stage, "stage-report": _cmd_stage_report, "candidate": _cmd_candidate, "script-candidate": _cmd_script_candidate_fallback` in `RESIDENT_SUBCOMMANDS`; add `import re` and `from mage_placement import records` at the top. `_case_readiness` must read `state/case-readiness.json` as kind `case-readiness` (unchanged).

- [ ] **Step 4: Run the new tests and the whole suite; expect `OK`**, then **commit and push** (`feat(mage-script): mage-stage, stage-report and candidate subcommands`).

---

### Task 6: The fail-closed Reader, rules and semantics (Opus 4.8 medium)

**Files:**
- Rewrite: `tools/read-mage.py`
- Create: `readers/mage-script-candidate.yml`, `rules/order-lr-within-goal.yml`, `rules/order-tb-within-goal.yml`, `rules/priority-move-within-budget.yml`
- Modify: `semantics.yml` (replace the `values:` map), the five kept `rules/*.yml` (unchanged text; verify they exist)
- Test: `flow/tests/test_readers.py` (new)

**Interfaces:**
- Consumes: Task 5's `candidate` output and stage layout; `metrics.*`; `snapshot.*`; `records.validate_record`.
- Produces: `readers/mage-script-candidate.yml` with `argv: [/usr/bin/python3, '${READER}', script-candidate, '${REPORT}', '${OUT}', '${WORKSPACE}']`, `reportKind: mage.script-candidate/1`, the 17 emits in Frozen-interface order; `read-mage.py` exit codes 0 (values written) / 3 (refusal, `OUT` unwritten) / 2 (usage).

- [ ] **Step 1: Write the failing tests, `flow/tests/test_readers.py`**

```python
import json, os, subprocess, sys, tempfile, unittest
from pathlib import Path
sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core  # noqa: E402
from tests import fixtures  # noqa: E402
from tests.test_cli_stage import BASELINE, GOAL, run_cli, write_readiness_and_start  # noqa: E402

FLOW = Path(__file__).resolve().parents[1]
READER = FLOW.parent / "tools" / "read-mage.py"
READERS_DIR = FLOW.parent / "readers"
STANDIN = FLOW / "tests" / "standin_mage.py"


def reader_emits():
    lines = (READERS_DIR / "mage-script-candidate.yml").read_text(encoding="utf-8").splitlines()
    start = next(i for i, l in enumerate(lines) if l.strip() == "emits:")
    out = []
    for l in lines[start + 1:]:
        if not l.strip().startswith("- "): break
        out.append(l.strip()[2:])
    return out


class ReaderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.root = Path(self.tmp.name)
        self.workspace = self.root / "ws"; self.workspace.mkdir(); os.symlink(FLOW, self.workspace / "flow")
        exe = [sys.executable, str(STANDIN)]
        self.case = fixtures.make_case(self.tmp.name, mage_executable=exe)
        caps = fixtures.make_site_capabilities(self.tmp.name, exe)
        write_readiness_and_start(self.workspace, self.case, caps, GOAL)
        (self.workspace / "placement" / "round-01").mkdir(parents=True)
        self.report = self.workspace / "state" / "round" / "script-candidate.json"
        self.out = self.root / "reader-out.json"

    def tearDown(self):
        self.tmp.cleanup()

    def _deliver(self, text=BASELINE, env=None):
        script = self.workspace / "placement" / "round-01" / "script.tcl"; script.write_text(text, encoding="utf-8")
        stage_dir = Path("placement/round-01/stage-1")
        run_cli(["mage-stage", self.workspace, "--round", 1, "--script", script, "--out-dir", stage_dir], env=env)
        summary = json.loads((self.workspace / stage_dir / "stage-summary.json").read_text(encoding="utf-8"))
        journal = self.workspace / "placement" / "round-01" / "journal-entry.json"
        journal.write_text(json.dumps(fixtures.journal_entry(1, summary["scriptSha256"])), encoding="utf-8")
        run_cli(["candidate", self.workspace, "--round", 1, "--stage-dir", stage_dir, "--journal", journal, "--out", self.report])
        return self.workspace / stage_dir

    def _read(self, expect=0):
        r = subprocess.run([sys.executable, str(READER), "script-candidate", str(self.report), str(self.out), str(self.workspace)],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, expect, r.stderr)
        if expect == 0:
            return {v["type"]: v for v in json.loads(self.out.read_text(encoding="utf-8"))["values"]}
        self.assertFalse(self.out.exists(), "OUT must stay unwritten on refusal")
        return json.loads(r.stderr.strip().splitlines()[-1])

    def test_emits_declared_set_in_order_with_known_values(self):
        self._deliver()
        self._read()
        values = json.loads(self.out.read_text(encoding="utf-8"))["values"]
        self.assertEqual([v["type"] for v in values], reader_emits())
        by = {v["type"]: v["value"] for v in values}
        self.assertEqual(by["mage_candidate_error_count"], 0)
        self.assertEqual(by["mage_dropped_ordinary_count"], 1); self.assertEqual(by["mage_dropped_ordinary_length_um"], 900.0)
        self.assertEqual(by["mage_priority_move_max_um"], 0.0); self.assertEqual(by["mage_priority_moved_count"], 0)
        self.assertEqual(by["mage_order_deviation_max_lr"], -1)   # the synthetic case has no LR side: the customer sentinel -1
        self.assertEqual(by["mage_order_deviation_max_tb"], 0); self.assertEqual(by["mage_native_violation_total"], 0)
        self.assertEqual(by["mage_target_over_limit_count"], 1)   # OVL_B starts 150 um off target

    def test_tampered_export_is_refused(self):
        stage_dir = self._deliver()
        export = stage_dir / "out" / "export.pla"
        export.write_text(export.read_text(encoding="utf-8").replace("\n", "\n", 1) + "# tamper\n", encoding="utf-8")
        self.assertEqual(self._read(expect=3)["code"], "identity-mismatch")

    def test_stage_script_not_in_session_log_is_refused(self):
        stage_dir = self._deliver()
        log = self.workspace / "placement" / "round-01" / "session.jsonl"
        entry = json.loads(log.read_text(encoding="utf-8").splitlines()[0]); entry["stageSha256"] = "0" * 64
        log.write_text(json.dumps(entry) + "\n", encoding="utf-8")
        doc = json.loads(self.report.read_text(encoding="utf-8"))
        doc["files"]["sessionLog"]["sha256"] = core.file_sha256(log)
        body = {k: v for k, v in doc.items() if k != "id"}; doc["id"] = core.digest(body)
        self.report.write_text(json.dumps(doc), encoding="utf-8")
        self.assertEqual(self._read(expect=3)["code"], "identity-mismatch")

    def test_missing_verify_file_reads_unknown_not_error(self):
        env = dict(os.environ); env["MAGE_STANDIN_VERIFY_FAIL"] = "SPACE"
        self._deliver(env=env)
        values = self._read()
        self.assertIsNone(values["mage_native_space_rows"]["value"]); self.assertIn("unknownReason", values["mage_native_space_rows"])
        self.assertIsNone(values["mage_native_violation_total"]["value"]); self.assertEqual(values["mage_candidate_error_count"]["value"], 0)

    def test_blocked_candidate_reads_all_unknown_without_error(self):
        env = dict(os.environ); env["MAGE_STANDIN_FAIL_AFTER_SNAPSHOT"] = "priority-start"
        self._deliver(env=env)
        values = self._read()
        self.assertEqual(values["mage_candidate_error_count"]["value"], 0)
        self.assertTrue(all(values[t]["value"] is None for t in values if t != "mage_candidate_error_count"))

    def test_deleted_priority_fit_in_export_is_refused(self):
        stage_dir = self._deliver()
        export = stage_dir / "out" / "export.pla"
        lines = export.read_text(encoding="utf-8").splitlines()
        kept = [l for l in lines if "AL_X.AL_X_1" not in l]
        export.write_text("\n".join(kept) + "\n", encoding="utf-8")
        doc = json.loads(self.report.read_text(encoding="utf-8"))
        doc["files"]["export"]["sha256"] = core.file_sha256(export)
        body = {k: v for k, v in doc.items() if k != "id"}; doc["id"] = core.digest(body)
        self.report.write_text(json.dumps(doc), encoding="utf-8")
        self.assertIn(self._read(expect=3)["code"], ("identity-mismatch", "inventory"))

    def test_missing_journal_file_is_refused(self):
        self._deliver()
        (self.workspace / "placement" / "round-01" / "journal-entry.json").unlink()
        self.assertEqual(self._read(expect=3)["code"], "identity-mismatch")

    def test_session_log_outside_round_prefix_is_refused(self):
        self._deliver()
        doc = json.loads(self.report.read_text(encoding="utf-8"))
        doc["files"]["sessionLog"]["path"] = "state/session.jsonl"
        body = {k: v for k, v in doc.items() if k != "id"}; doc["id"] = core.digest(body)
        self.report.write_text(json.dumps(doc), encoding="utf-8")
        self.assertEqual(self._read(expect=3)["code"], "identity-mismatch")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run; expect FAIL** (the Reader rejects kind `script-candidate` with usage error 2 / missing reader yml).

- [ ] **Step 3: Write `readers/mage-script-candidate.yml`**

```yaml
id: mage-script-candidate
version: "1"
file: tools/read-mage.py
argv: [/usr/bin/python3, '${READER}', script-candidate, '${REPORT}', '${OUT}', '${WORKSPACE}']
reportKind: mage.script-candidate/1
emits:
  - mage_candidate_error_count
  - mage_priority_unplaced_count
  - mage_dropped_count
  - mage_dropped_length_um
  - mage_dropped_ordinary_count
  - mage_dropped_ordinary_length_um
  - mage_target_distance_max_um
  - mage_target_over_limit_count
  - mage_order_deviation_max
  - mage_order_deviation_max_lr
  - mage_order_deviation_max_tb
  - mage_priority_move_max_um
  - mage_priority_moved_count
  - mage_native_overlap_rows
  - mage_native_space_rows
  - mage_native_boundary_rows
  - mage_native_violation_total
```

- [ ] **Step 4: Replace `semantics.yml`'s `values:` map** with exactly the 17 emitted types. Keep the sibling's text for the eleven it already defines (`mage_candidate_error_count` — reword "session-log-role" to "session-log/stage-binding"; `mage_priority_unplaced_count`; `mage_dropped_count`; `mage_dropped_length_um`; `mage_dropped_ordinary_count`; `mage_dropped_ordinary_length_um`; `mage_target_distance_max_um`; `mage_target_over_limit_count`; `mage_order_deviation_max`; the three `mage_native_*_rows`; `mage_native_violation_total`) and add:

```yaml
  mage_order_deviation_max_lr:
    unit: rank
    description: Maximum placement-order deviation over the two LR sides (left, right) by the customer's per-side check_dev; the reference script flags a deviation of 3 or more.
  mage_order_deviation_max_tb:
    unit: rank
    description: Maximum placement-order deviation over the two TB sides (bottom, top) by the customer's per-side check_dev; the reference script flags a deviation of 2 or more.
  mage_priority_move_max_um:
    unit: um
    description: Largest movement (|dx| + |dy| of the box centre) of any priority (Group-placed) mark from the frozen start state, i.e. movement introduced by optimisation; never the distance from the CT target. Unknown when a start priority mark cannot be matched to exactly one candidate mark (identity-unknown).
  mage_priority_moved_count:
    unit: count
    description: Count of priority marks whose box moved from the frozen start state.
```

Delete the removed types (`mage_open_request_count`, every `mage_review_*`).

- [ ] **Step 5: Write the three new rules and keep the five others**

`rules/order-lr-within-goal.yml`:

```yaml
id: order-lr-within-goal
version: "1"
title: The best state's LR-side placement order deviation meets the Run target
parameter: { name: max_order_deviation_lr, unit: rank }
requires: [{ type: mage_order_deviation_max_lr }]
subject: { type: mage_order_deviation_max_lr }
predicate: { op: lte, threshold: { parameter: max_order_deviation_lr }, unit: rank }
```

`rules/order-tb-within-goal.yml`: same with `tb`/`max_order_deviation_tb`/`mage_order_deviation_max_tb` and title "TB-side". `rules/priority-move-within-budget.yml`:

```yaml
id: priority-move-within-budget
version: "1"
title: No priority mark moved further from the frozen start than the declared movement budget
parameter: { name: max_priority_move_um, unit: um }
requires: [{ type: mage_priority_move_max_um }]
subject: { type: mage_priority_move_max_um }
predicate: { op: lte, threshold: { parameter: max_priority_move_um }, unit: um }
```

- [ ] **Step 6: Rewrite `tools/read-mage.py`**

Keep the sibling's module structure (`_mage_modules`, `_known`, `_unknown`, `_resolve_ref`, `main` with the fail-closed `except Exception` → exit 3). Replace `_UNITS`, `CANDIDATE_EMITS`, remove every review path, and set:

```python
_UNITS = {
    "mage_candidate_error_count": "count", "mage_priority_unplaced_count": "count",
    "mage_dropped_count": "count", "mage_dropped_length_um": "um",
    "mage_dropped_ordinary_count": "count", "mage_dropped_ordinary_length_um": "um",
    "mage_target_distance_max_um": "um", "mage_target_over_limit_count": "count",
    "mage_order_deviation_max": "rank", "mage_order_deviation_max_lr": "rank", "mage_order_deviation_max_tb": "rank",
    "mage_priority_move_max_um": "um", "mage_priority_moved_count": "count",
    "mage_native_overlap_rows": "rows", "mage_native_space_rows": "rows", "mage_native_boundary_rows": "rows",
    "mage_native_violation_total": "rows",
}
_NATIVE_TYPE_FACT = {"OVERLAP": "mage_native_overlap_rows", "SPACE": "mage_native_space_rows", "BOUNDARY": "mage_native_boundary_rows"}
CANDIDATE_EMITS = [
    "mage_candidate_error_count", "mage_priority_unplaced_count", "mage_dropped_count", "mage_dropped_length_um",
    "mage_dropped_ordinary_count", "mage_dropped_ordinary_length_um", "mage_target_distance_max_um",
    "mage_target_over_limit_count", "mage_order_deviation_max", "mage_order_deviation_max_lr",
    "mage_order_deviation_max_tb", "mage_priority_move_max_um", "mage_priority_moved_count",
] + list(_NATIVE_TYPE_FACT.values()) + ["mage_native_violation_total"]


def _check_ref(workspace, ref, label, mods):
    path = _resolve_ref(workspace, ref)
    if not path.is_file() or mods["core"].file_sha256(path) != ref["sha256"]:
        raise mods["core"].MageError("identity-mismatch", f"{label} changed or missing: {path}")
    return path


def _check_session_log(workspace, doc, mods):
    files = doc["files"]
    round_no = doc.get("identity", {}).get("round")
    prefix = f"placement/round-{round_no:02d}/" if isinstance(round_no, int) else None
    for key in ("script", "stageScript", "sessionLog", "journal"):
        if prefix is None or not files[key]["path"].startswith(prefix):
            raise mods["core"].MageError("identity-mismatch", f"{key} path {files[key]['path']!r} is not under this round's artifact prefix")
    log_path = _check_ref(workspace, files["sessionLog"], "session log", mods)
    entries = [json.loads(l) for l in log_path.read_text(encoding="utf-8").splitlines() if l.strip()]
    if not entries:
        raise mods["core"].MageError("writer", "session log is empty; no logged stage backs this candidate")
    for entry in entries:
        if entry.get("role") != "engineer":
            raise mods["core"].MageError("writer", f"stage logged under role {entry.get('role')!r}")
    if doc.get("outcome") == "completed":
        stage_sha = files["stageScript"]["sha256"]; export_sha = files["export"]["sha256"]
        if not any(e.get("completed") and e.get("stageSha256") == stage_sha and e.get("exportSha256") == export_sha for e in entries):
            raise mods["core"].MageError("identity-mismatch", "no completed logged stage matches the delivered stage.tcl and export")


def _candidate_unknowns(reason):
    return [_known(t, 0) if t == "mage_candidate_error_count" else _unknown(t, reason) for t in CANDIDATE_EMITS]


def _read_candidate(report_path, workspace, mods):
    core, metrics, snapshot, pla, records = mods["core"], mods["metrics"], mods["snapshot"], mods["pla"], mods["records"]
    doc = core.read_artifact(report_path, "script-candidate")
    errors = records.validate_record("script-candidate", doc)
    if errors:
        raise core.MageError("schema", "; ".join(errors))
    files = doc["files"]
    for key in ("script", "stageScript", "journal"):
        _check_ref(workspace, files[key], key, mods)
    journal = json.loads(_resolve_ref(workspace, files["journal"]).read_text(encoding="utf-8"))
    journal_errors = records.validate_record("journal-entry", journal)
    if journal_errors or journal.get("round") != doc["identity"]["round"]:
        raise core.MageError("schema", "; ".join(journal_errors) or "journal entry round does not match the candidate")
    for snap_ref in files.get("snapshots", []):
        _check_ref(workspace, snap_ref, f"boundary snapshot {snap_ref.get('name')}", mods)
    _check_session_log(workspace, doc, mods)
    if doc.get("outcome") != "completed":
        return _candidate_unknowns(f"candidate outcome is {doc.get('outcome')!r}; no metrics claimed")

    export_path = _check_ref(workspace, files["export"], "export", mods)
    _check_ref(workspace, files["snapshot"], "snapshot", mods)
    start = snapshot.load_snapshot(Path(workspace) / "state" / "start-snapshot.json")
    export_doc = pla.read_pla(export_path.read_text(encoding="utf-8"), start["dbuPerUm"])
    rebuilt = snapshot.build_snapshot("candidate", export_doc, start["frame"], start["ruleFacts"], start["targets"], {},
                                      {"exportPla": files["export"]}, pending_from_rules=False)
    if rebuilt["snapshotSha256"] != doc["snapshotSha256"]:
        raise core.MageError("identity-mismatch", "rebuilt candidate snapshot does not match the declared snapshotSha256")
    snapshot.check_inventory_conservation(start, rebuilt, _incumbent_ordinary_population(workspace, mods))
    goal = core.read_artifact(Path(workspace) / "state" / "case-readiness.json", "case-readiness")["goal"]
    verify_files = {t: str(_check_ref(workspace, ref, f"verify {t}", mods)) for t, ref in files.get("verify", {}).items()}

    drops = metrics.drops(rebuilt)
    target = metrics.target_distances(rebuilt, str(goal["max_target_distance_um"]))
    order = metrics.order_deviation(rebuilt)
    moved = metrics.displacement(start, rebuilt)["priority"]
    native = metrics.native_rows(verify_files)
    unplaced = [p["id"] for p in rebuilt["pending"] if p.get("inGroup")]
    t_reason = target.get("unknownReason") or "target distance is unknown"
    o_reason = order.get("unknownReason") or "order deviation is unknown"

    def kn(name, value, reason):
        return _known(name, value) if value is not None else _unknown(name, reason)

    values = [_known("mage_candidate_error_count", 0), _known("mage_priority_unplaced_count", len(unplaced)),
              _known("mage_dropped_count", drops["count"]), _known("mage_dropped_length_um", float(drops["lengthUm"])),
              _known("mage_dropped_ordinary_count", drops["ordinary"]["count"]),
              _known("mage_dropped_ordinary_length_um", float(drops["ordinary"]["lengthUm"])),
              kn("mage_target_distance_max_um", None if target["maxUm"] is None else float(target["maxUm"]), t_reason),
              kn("mage_target_over_limit_count", target["overLimitCount"], t_reason),
              kn("mage_order_deviation_max", order["max"], o_reason),
              kn("mage_order_deviation_max_lr", order["maxLr"], o_reason),
              kn("mage_order_deviation_max_tb", order["maxTb"], o_reason),
              kn("mage_priority_move_max_um", None if moved["maxUm"] is None else float(moved["maxUm"]),
                 "a start priority mark could not be matched: " + ", ".join(moved["unmatched"])),
              _known("mage_priority_moved_count", moved["movedCount"])]
    for type_name, fact in _NATIVE_TYPE_FACT.items():
        values.append(kn(fact, native["byType"].get(type_name), f"no verify file for {type_name}"))
    values.append(kn("mage_native_violation_total", native["total"], "one or more native verify types is unknown"))
    return values
```

`_incumbent_ordinary_population(workspace)` is the sibling's helper, kept. `main` accepts only kind `script-candidate`. Rewrite the module docstring for one kind.

- [ ] **Step 7: Run the Reader tests and the whole suite; expect `OK`; commit and push** (`feat(mage-script): fail-closed script-candidate Reader, rules and semantics`).

---

### Task 7: Program tasks, round decision, contract and graph (Opus 4.8 medium)

**Files:**
- Rewrite: `flow/mage_placement/rounds.py`, `flow/mage_placement/tasks.py` (`prepare_case` additions, `decide_round`, `evaluate_placement`, `proof_level`, `deliver`), `contract.yml`, `graph.yml`, `schemas/tasks.json`
- Test: `flow/tests/test_rounds.py` (new), `flow/tests/test_cli_tasks.py` (new end-to-end route)

**Interfaces:**
- Consumes: Tasks 2–6.
- Produces: `rounds.rule_results(reader_values, goal)`, `rounds.best_state_key(reader_values)`, `rounds.decide(workspace, round_no, goal, candidate, previous_decision)`; `tasks.proof_level(...)`; the task I/O in Frozen interfaces; `contract.yml`/`graph.yml` consumed by Tasks 8–10.

- [ ] **Step 1: Write the failing round tests, `flow/tests/test_rounds.py`**

```python
import sys, tempfile, unittest
from pathlib import Path
sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core, rounds  # noqa: E402

GOAL = {"target_dropped_count": 0, "max_target_distance_um": 100, "max_order_deviation_lr": 2,
        "max_order_deviation_tb": 1, "max_priority_move_um": 100}


def values(**over):
    base = {"mage_candidate_error_count": 0, "mage_priority_unplaced_count": 0, "mage_dropped_count": 1,
            "mage_dropped_length_um": 900.0, "mage_dropped_ordinary_count": 1, "mage_dropped_ordinary_length_um": 900.0,
            "mage_target_distance_max_um": 150.0, "mage_target_over_limit_count": 1, "mage_order_deviation_max": 0,
            "mage_order_deviation_max_lr": 0, "mage_order_deviation_max_tb": 0, "mage_priority_move_max_um": 0.0,
            "mage_priority_moved_count": 0, "mage_native_overlap_rows": 0, "mage_native_space_rows": 0,
            "mage_native_boundary_rows": 0, "mage_native_violation_total": 0}
    base.update(over)
    return [{"type": k, "unit": "x", "value": v} for k, v in base.items()]


def candidate(round_no, reader_values, outcome="completed"):
    return {"id": f"c{round_no}", "identity": {"round": round_no}, "snapshotSha256": f"s{round_no}", "outcome": outcome,
            "metrics": {}, "files": {"journal": {"path": "placement/round-%02d/journal-entry.json" % round_no, "sha256": "j"}},
            "_readerValues": reader_values}


class RuleResultsTest(unittest.TestCase):
    def test_all_pass_when_within_goal(self):
        r = rounds.rule_results(values(mage_dropped_count=0, mage_target_distance_max_um=50.0, mage_target_over_limit_count=0), GOAL)
        self.assertTrue(all(v == "PASS" for v in r.values())); self.assertEqual(len(r), 8)

    def test_unknown_value_is_unknown_rule(self):
        vals = values(); vals[-1]["value"] = None
        self.assertEqual(rounds.rule_results(vals, GOAL)["no-native-violation"], "UNKNOWN")

    def test_move_budget_rule(self):
        self.assertEqual(rounds.rule_results(values(mage_priority_move_max_um=150.0), GOAL)["priority-move-within-budget"], "FAIL")


class BestStateKeyTest(unittest.TestCase):
    def test_native_rows_first_then_unplaced_then_ordinary_drops(self):
        self.assertLess(rounds.best_state_key(values()), rounds.best_state_key(values(mage_native_violation_total=1)))
        self.assertLess(rounds.best_state_key(values()), rounds.best_state_key(values(mage_priority_unplaced_count=1)))
        self.assertLess(rounds.best_state_key(values(mage_dropped_ordinary_length_um=500.0)), rounds.best_state_key(values()))

    def test_unknown_sorts_worst(self):
        vals = values(); vals[0]["value"] = 0
        for v in vals:
            if v["type"] == "mage_dropped_ordinary_count": v["value"] = None
        self.assertGreater(rounds.best_state_key(vals), rounds.best_state_key(values(mage_dropped_ordinary_count=99)))


class DecideTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.ws = Path(self.tmp.name)
        (self.ws / "placement" / "round-01").mkdir(parents=True)
        (self.ws / "placement" / "round-01" / "journal-entry.json").write_text(
            '{"schema":"mage.journal-entry/1","round":1,"hypothesis":"h","stages":[{"stage":1,"scriptSha256":"a","outcome":"completed","boundaries":[],"stageError":null,"note":""}],"observations":[],"conclusion":"c","nextStep":""}', encoding="utf-8")
        core.write_artifact(self.ws / "state" / "method-journal.json", core.stamp("method-journal", {"entries": [], "bestRound": None}))
        self.round0 = core.stamp("round-decision", {"round": 0, "route": "continue", "nextRound": {"round": 1}, "best": None,
                                                     "history": [], "stopReason": "", "goalMet": False, "rules": {}, "blockedRound": False})

    def tearDown(self):
        self.tmp.cleanup()

    def _journal_for(self, round_no):
        d = self.ws / "placement" / ("round-%02d" % round_no); d.mkdir(parents=True, exist_ok=True)
        src = (self.ws / "placement" / "round-01" / "journal-entry.json").read_text(encoding="utf-8").replace('"round":1', '"round":%d' % round_no)
        (d / "journal-entry.json").write_text(src, encoding="utf-8")

    def test_round_one_continues_and_is_best_and_journal_appended(self):
        d = rounds.decide(self.ws, 1, GOAL, candidate(1, values()), self.round0)
        self.assertEqual(d["route"], "continue"); self.assertEqual(d["best"]["round"], 1); self.assertTrue(d["history"][0]["improved"])
        journal = core.read_artifact(self.ws / "state" / "method-journal.json", "method-journal")
        self.assertEqual(len(journal["entries"]), 1); self.assertEqual(journal["bestRound"], 1)

    def test_goal_met_stops(self):
        d = rounds.decide(self.ws, 1, GOAL, candidate(1, values(mage_dropped_count=0, mage_dropped_ordinary_count=0,
                          mage_dropped_ordinary_length_um=0.0, mage_dropped_length_um=0.0, mage_target_distance_max_um=50.0,
                          mage_target_over_limit_count=0)), self.round0)
        self.assertEqual(d["route"], "stop"); self.assertTrue(d["goalMet"]); self.assertEqual(d["stopReason"], "goal met")

    def test_two_stalls_after_round_one_stop(self):
        d1 = rounds.decide(self.ws, 1, GOAL, candidate(1, values()), self.round0)
        self._journal_for(2); d2 = rounds.decide(self.ws, 2, GOAL, candidate(2, values()), d1)
        self.assertEqual(d2["route"], "continue")
        self._journal_for(3); d3 = rounds.decide(self.ws, 3, GOAL, candidate(3, values()), d2)
        self.assertEqual(d3["route"], "stop"); self.assertIn("two consecutive", d3["stopReason"]); self.assertEqual(d3["best"]["round"], 1)

    def test_blocked_round_continues_and_never_becomes_best(self):
        d = rounds.decide(self.ws, 1, GOAL, candidate(1, [], outcome="blocked"), self.round0)
        self.assertEqual(d["route"], "continue"); self.assertIsNone(d["best"]); self.assertTrue(d["blockedRound"])
        self._journal_for(2); d2 = rounds.decide(self.ws, 2, GOAL, candidate(2, values()), d)
        self.assertEqual(d2["best"]["round"], 2)

    def test_round_limit_stops(self):
        prev = self.round0
        for n in range(1, 7):
            self._journal_for(n); prev = rounds.decide(self.ws, n, GOAL, candidate(n, values(mage_dropped_ordinary_length_um=900.0 - n)), prev)
        self.assertEqual(prev["route"], "stop"); self.assertIn("round limit", prev["stopReason"])

    def test_improvement_resets_the_stall_counter(self):
        d1 = rounds.decide(self.ws, 1, GOAL, candidate(1, values()), self.round0)
        self._journal_for(2); d2 = rounds.decide(self.ws, 2, GOAL, candidate(2, values()), d1)
        self._journal_for(3); d3 = rounds.decide(self.ws, 3, GOAL, candidate(3, values(mage_dropped_ordinary_length_um=800.0)), d2)
        self.assertEqual(d3["route"], "continue"); self.assertEqual(d3["best"]["round"], 3)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run; expect FAIL** (`AttributeError: rule_results`).

- [ ] **Step 3: Write `flow/mage_placement/rounds.py`**

```python
"""Round decision for the mage-script-placement Pack.

`decide()` joins one round's Engineer candidate (ranked only by the
Reader-confirmed values the committed output carries) against the previous
decision: it keeps the better of the previous best and this candidate,
appends the round's validated journal entry to `state/method-journal.json`,
archives the candidate under `state/history/round-NN/candidate.json`,
routes `continue|stop`, and writes `state/round-decision.json` and the
cumulative `state/script-result.json`.
"""
from __future__ import annotations

import json
from pathlib import Path

from . import core, records


MAX_ROUNDS = 6
_SENTINEL = 1_000_000_000.0

RULES = (
    ("placement-delivery-ready", "mage_candidate_error_count", "eq", 0),
    ("priority-all-placed", "mage_priority_unplaced_count", "eq", 0),
    ("no-native-violation", "mage_native_violation_total", "eq", 0),
    ("drops-within-goal", "mage_dropped_count", "lte", "target_dropped_count"),
    ("target-limit-met", "mage_target_distance_max_um", "lte", "max_target_distance_um"),
    ("order-lr-within-goal", "mage_order_deviation_max_lr", "lte", "max_order_deviation_lr"),
    ("order-tb-within-goal", "mage_order_deviation_max_tb", "lte", "max_order_deviation_tb"),
    ("priority-move-within-budget", "mage_priority_move_max_um", "lte", "max_priority_move_um"),
)
RULE_IDS = tuple(r[0] for r in RULES)


def reader_value(reader_values, type_name):
    for row in reader_values or []:
        if row.get("type") == type_name:
            return row.get("value")
    return None


def rule_results(reader_values, goal):
    results = {}
    for rule_id, fact, op, threshold in RULES:
        value = reader_value(reader_values, fact)
        limit = goal[threshold] if isinstance(threshold, str) else threshold
        if value is None:
            results[rule_id] = "UNKNOWN"
        elif op == "eq":
            results[rule_id] = "PASS" if float(value) == float(limit) else "FAIL"
        else:
            results[rule_id] = "PASS" if float(value) <= float(limit) else "FAIL"
    return results


def _num(value):
    if value is None:
        return _SENTINEL
    try:
        return float(value)
    except (TypeError, ValueError):
        return _SENTINEL


def best_state_key(reader_values):
    """Lexicographic key, smaller is better: native rows, unplaced priority marks,
    ordinary drop count, ordinary drop length, target over-limit count, max(order lr, tb),
    moved priority count, max priority move. Unknown sorts worst."""
    v = lambda t: _num(reader_value(reader_values, t))  # noqa: E731
    return (v("mage_native_violation_total"), v("mage_priority_unplaced_count"), v("mage_dropped_ordinary_count"),
            v("mage_dropped_ordinary_length_um"), v("mage_target_over_limit_count"),
            max(v("mage_order_deviation_max_lr"), v("mage_order_deviation_max_tb")),
            v("mage_priority_moved_count"), v("mage_priority_move_max_um"))


def _blocked(candidate, reader_values):
    return candidate.get("outcome") != "completed" or not reader_values or reader_value(reader_values, "mage_candidate_error_count") not in (0, 0.0)


def _archive(workspace, round_no, candidate):
    path = Path(workspace) / "state" / "history" / ("round-%02d" % round_no) / "candidate.json"
    body = {k: v for k, v in candidate.items() if not k.startswith("_")}
    core.write_artifact(path, body)
    return {"path": str(path.relative_to(Path(workspace))), "sha256": core.file_sha256(path)}


def _append_journal(workspace, round_no, candidate, best_round):
    workspace = Path(workspace)
    journal_ref = candidate.get("files", {}).get("journal")
    if not journal_ref:
        raise core.MageError("missing-input", "candidate names no journal entry")
    entry_path = workspace / journal_ref["path"]
    entry = json.loads(entry_path.read_text(encoding="utf-8"))
    errors = records.validate_record("journal-entry", entry)
    if errors or entry.get("round") != round_no:
        raise core.MageError("schema", "; ".join(errors) or "journal entry round mismatch")
    path = workspace / "state" / "method-journal.json"
    journal = core.read_artifact(path, "method-journal") if path.is_file() else {"entries": []}
    entries = [e for e in journal.get("entries", []) if e.get("round") != round_no] + [entry]
    doc = core.stamp("method-journal", {"entries": entries, "bestRound": best_round})
    core.write_artifact(path, doc)
    return {"path": "state/method-journal.json", "sha256": core.file_sha256(path)}, len(entries)


def decide(workspace, round_no, goal, candidate, previous_decision):
    workspace = Path(workspace)
    reader_values = candidate.get("_readerValues", [])
    blocked = _blocked(candidate, reader_values)
    key = (_SENTINEL,) * 8 if blocked else best_state_key(reader_values)
    previous_best = (previous_decision or {}).get("best")
    previous_key = tuple(previous_best["key"]) if previous_best else None
    improved = (not blocked) and (previous_key is None or key < previous_key)
    history = list((previous_decision or {}).get("history", [])) + [{"round": round_no, "key": list(key), "improved": improved}]
    candidate_ref = _archive(workspace, round_no, candidate)
    if improved:
        best = {"snapshotSha256": candidate["snapshotSha256"], "candidatePath": candidate_ref["path"],
                "metrics": dict(candidate.get("metrics", {})), "rankMetrics": {}, "key": list(key), "round": round_no,
                "readerValues": reader_values, "blocked": False}
    else:
        best = previous_best
    rules = rule_results(best["readerValues"], goal) if best else {r: "UNKNOWN" for r in RULE_IDS}
    goal_met = bool(best) and all(v == "PASS" for v in rules.values())
    journal_ref, entry_count = _append_journal(workspace, round_no, candidate, best["round"] if best else None)

    stalls = 0
    for item in reversed(history[1:]):
        if item["improved"]:
            break
        stalls += 1
    if round_no >= MAX_ROUNDS:
        route, reason = "stop", "round limit reached" + ("; round %d candidate is blocked" % round_no if blocked else "")
    elif blocked:
        route, reason = "continue", "round %d candidate is blocked (%s); continuing" % (round_no, candidate.get("stopReason", ""))
    elif goal_met:
        route, reason = "stop", "goal met"
    elif stalls >= 2:
        route, reason = "stop", "no improvement for two consecutive rounds"
    else:
        route, reason = "continue", ""

    decision = core.stamp("round-decision", {
        "round": round_no, "route": route, "nextRound": {"round": round_no + 1}, "best": best, "history": history,
        "stopReason": reason, "goalMet": goal_met, "rules": rules, "blockedRound": blocked,
    })
    core.write_artifact(workspace / "state" / "round-decision.json", decision)

    result_path = workspace / "state" / "script-result.json"
    previous_result = core.read_artifact(result_path, "script-result") if result_path.is_file() else {}
    rounds_list = list(previous_result.get("rounds", [])) + [{"round": round_no, "candidate": candidate_ref}]
    outcome = "blocked" if best is None else ("completed" if goal_met else "best-effort")
    result = core.stamp("script-result", {
        "best": best, "rounds": rounds_list, "journal": journal_ref, "metrics": (best or {}).get("metrics", {}),
        "incumbent": previous_result.get("incumbent", {}), "outcome": outcome, "stopReason": reason,
    })
    core.write_artifact(result_path, result)
    decision["_journalEntries"] = entry_count
    return decision
```

(`stalls` counts consecutive non-improving rounds at the tail of history excluding round 1; two stalls → stop. `decision["_journalEntries"]` is a transient for the task value, not part of the stamped document — strip it before validation in tests if needed.)

- [ ] **Step 4: Rewrite the program tasks in `flow/mage_placement/tasks.py`**

`_load_case`: after the `referenceMethod` check add, for `referenceFiles` and `referenceNotes`, a `_verify_file` per entry; require `referenceMethod` with `raise core.MageError("missing-input", "manifest names no referenceMethod")` when absent. `prepare_case`: read the five goal values; write `case_readiness` with `"reference": {k: manifest.get(k) for k in ("referenceMethod", "referenceFiles", "referenceNotes", "referenceOrdinaryDropLengthUm")}`; write round-0 as `core.stamp("round-decision", {"round": 0, "route": "continue", "nextRound": {"round": 1}, "best": None, "history": [], "stopReason": "", "goalMet": False, "rules": {}, "blockedRound": False})` and an empty journal `core.stamp("method-journal", {"entries": [], "bestRound": None})` at `state/method-journal.json`; artifacts list gains `method-journal`. `measure_incumbent`: unchanged except it also stores `"incumbent": {...}` into `state/script-result.json`? No — keep `script-result.json` owned by `decide`; instead `evaluate_placement` reads the incumbent from its own `INCUMBENT` input. Add:

```python
def _committed_document(workspace, resident_output, path, kind):
    observations = resident_output.get("observations", [])
    if len(observations) != 1:
        raise core.MageError("identity-mismatch", f"expected exactly one observation for {kind}")
    full = Path(workspace) / path
    if not full.is_file() or core.file_sha256(full) != observations[0]["contentSha256"]:
        raise core.MageError("identity-mismatch", f"{kind} bytes at {full} do not match the committed observation")
    doc = dict(core.read_artifact(full, kind))
    doc["_readerValues"] = observations[0].get("values", [])
    return doc


def _goal(inputs):
    return {"target_dropped_count": inputs["TARGET_DROPPED"], "max_target_distance_um": inputs["MAX_TARGET_DISTANCE_UM"],
            "max_order_deviation_lr": inputs["MAX_ORDER_DEVIATION_LR"], "max_order_deviation_tb": inputs["MAX_ORDER_DEVIATION_TB"],
            "max_priority_move_um": inputs["MAX_PRIORITY_MOVE_UM"]}


def decide_round(workspace, inputs):
    workspace = Path(workspace)
    round_no = int(inputs["ROUND"])
    candidate = _committed_document(workspace, inputs["CANDIDATE"], "state/round/script-candidate.json", "script-candidate")
    previous = core.read_artifact(workspace / "state" / "round-decision.json", "round-decision")
    decision = rounds.decide(workspace, round_no, _goal(inputs), candidate, previous)
    value = {"route": decision["route"], "nextRound": decision["nextRound"], "best": decision["best"],
             "stopReason": decision["stopReason"], "goalMet": decision["goalMet"], "rules": decision["rules"],
             "journalEntries": decision.get("_journalEntries", 0)}
    artifacts = [_artifact("round-decision", "state/round-decision.json"), _artifact("script-result", "state/script-result.json"),
                 _artifact("method-journal", "state/method-journal.json")]
    return {"schemaVersion": "1", "value": value, "artifacts": artifacts, "diagnostics": []}


def proof_level(best_ordinary_um, incumbent_ordinary_um, reference_um, rules, inventory_ok):
    if best_ordinary_um is None or not inventory_ok:
        return "none"
    best, incumbent = float(best_ordinary_um), float(incumbent_ordinary_um)
    all_pass = all(v == "PASS" for v in rules.values())
    priority_ok = rules.get("priority-all-placed") == "PASS"
    others_pass = all(v == "PASS" for k, v in rules.items() if k != "drops-within-goal")
    if all_pass and best == 0:
        return "completion"
    if reference_um is not None and best < float(reference_um) and others_pass:
        return "surpass"
    if reference_um is not None and best <= float(reference_um) and priority_ok:
        return "match"
    if best < incumbent and priority_ok:
        return "improvement"
    if abs(best - incumbent) <= 0.5:
        return "reproduction"
    return "none"


def evaluate_placement(workspace, inputs):
    workspace = Path(workspace)
    decision, incumbent = inputs["DECISION"], inputs["INCUMBENT"]
    best = decision.get("best") or {}
    reader_values = best.get("readerValues", [])
    goal = _goal(inputs)
    rules_result = rounds.rule_results(reader_values, goal) if best else {r: "UNKNOWN" for r in rounds.RULE_IDS}
    unknowns = [{"rule": r, "reason": "no measured best state" if not best else "fact unknown"} for r, v in rules_result.items() if v == "UNKNOWN"]
    goal_met = bool(best) and all(v == "PASS" for v in rules_result.values())
    readiness = core.read_artifact(workspace / "state" / "case-readiness.json", "case-readiness")
    reference_um = (readiness.get("reference") or {}).get("referenceOrdinaryDropLengthUm")
    best_ordinary = rounds.reader_value(reader_values, "mage_dropped_ordinary_length_um")
    incumbent_ordinary = incumbent.get("metrics", {}).get("drops", {}).get("ordinary", {}).get("lengthUm")
    level = proof_level(best_ordinary, incumbent_ordinary, reference_um, rules_result, inventory_ok=bool(best)) if incumbent_ordinary is not None else "none"
    comparison = {
        "ordinaryLengthUm": {"best": best_ordinary, "incumbent": incumbent_ordinary, "reference": reference_um},
        "ordinaryCount": {"best": rounds.reader_value(reader_values, "mage_dropped_ordinary_count"),
                          "incumbent": incumbent.get("metrics", {}).get("drops", {}).get("ordinary", {}).get("count")},
        "priorityMoveMaxUm": rounds.reader_value(reader_values, "mage_priority_move_max_um"),
        "targetOverLimitCount": {"best": rounds.reader_value(reader_values, "mage_target_over_limit_count"),
                                 "incumbent": incumbent.get("metrics", {}).get("targetDistances", {}).get("overLimitCount")},
    }
    value = {"goalMet": goal_met, "metrics": best.get("metrics", {}), "incumbent": incumbent, "comparison": comparison,
             "rules": rules_result, "unknowns": unknowns, "proofLevel": level,
             "domainReport": {"round": best.get("round"), "candidatePath": best.get("candidatePath"), "stopReason": decision.get("stopReason")}}
    core.write_artifact(workspace / "state" / "placement-evaluation.json", value)
    return {"schemaVersion": "1", "value": value, "artifacts": [_artifact("placement-evaluation", "state/placement-evaluation.json")], "diagnostics": []}
```

`deliver`: keep the sibling's shape, but collect files from `state/script-result.json`: every `rounds[].candidate` (verified), every `{path, sha256}` reachable from each archived candidate's `files` (walk as the sibling does), plus `state/method-journal.json`, `state/script-result.json`, `state/placement-evaluation.json`; `REPORT.md` prints `Goal met`, `Proof level`, the rules table, `comparison` (ordinary length best / incumbent / reference, counts, max priority move, over-limit counts), the stop reason, and the journal's per-round `hypothesis` → `conclusion` lines; `report["proofLevel"]` is carried through; artifacts as the sibling. `TASKS` lists all five; `RULE_IDS = rounds.RULE_IDS`.

- [ ] **Step 5: Write `contract.yml`**

```yaml
id: mage-script-placement
version: 0.1.0
title: MAGE script-method test-structure placement
status: development
minimumHarnessVersion: 0.3.0
ontology:
  aliases:
    scriptResult:
    - script-method placement result
    - test structure placement delivery
budget:
  timeBoxMs: 21600000
  closingReserveMs: 900000
  minimumGenerations: 1
inputs:
- name: mageCaseManifest
  description: Site path of one mage.case-manifest/1 JSON file naming the rule, pblock, block, cluster,
    target-table, request-order, start-state, incumbent-state and reference-method files for this case, each
    with a sha256 the Pack re-verifies, plus frameSizeUm, dbuPerUm, partitionRule and the mage executable/
    setupScript/buildBanner. No customer data is copied into this Pack; every file stays on the Site.
- name: siteCapabilities
  description: Site path of one mage.site-capabilities/1 JSON file naming the Site's MAGE executable
    (string or list), setup script and environment. Only the Engineer's resident tool holds the mage licence.
- name: workspaceRoot
  description: Campaign-private output root allowed by the Site Permit.
outputs:
- name: caseReadiness
  path: state/case-readiness.json
  description: Verified case digests, Goal values, reference-method references and the siteCapabilities/manifest
    documents later resident subcommands read.
- name: startSnapshot
  path: state/start-snapshot.json
  description: The case's frozen start-state mage.layout-snapshot/2.
- name: incumbentMeasure
  path: state/incumbent.json
  description: Modelled metrics of the retained incumbent state and its ordinary population anchor.
- name: roundDecision
  path: state/round-decision.json
  description: The latest round's route, best measured state, rule results and history. Round 0 is written by prepare-case.
- name: methodJournal
  path: state/method-journal.json
  description: Every round's validated journal entry (hypothesis, stages, observations, conclusion, next step) and the best round.
- name: scriptCandidate
  path: state/round/script-candidate.json
  reader: mage-script-candidate
  description: The current round's Engineer delivery (mage.script-candidate/1) -- stage scripts, boundary snapshots,
    export, verify files, session log and journal entry with sha256, metrics, outcome. Overwritten every round.
- name: scriptResult
  path: state/script-result.json
  description: Cumulative best measured state, every round's archived candidate, the journal reference and outcome.
- name: placementEvaluation
  path: state/placement-evaluation.json
  description: goalMet against the eight delivery rules, the proof level, and the comparison against the incumbent and reference.
- name: finalReport
  path: delivery/report.json
  description: Final goalMet, proof level, rules, metrics and report/package paths.
environment:
  wrappers:
  - python3
  - /usr/bin/python3
workspace:
  source: pack
  copy:
  - mage_placement_cli.py
  - mage_placement
  - schemas
tools:
- id: prepare-case
  file: flow/mage_placement_cli.py
  description: Verify every case-manifest file digest (including the reference method files), parse the case, build
    and stamp the frozen start-state snapshot, and write the round-0 decision and the empty method journal.
  inputs: [WORKSPACE, TASK_INPUT, TASK_OUTPUT]
  argv: [python3, "${WORKSPACE}/flow/mage_placement_cli.py", task-prepare-case, "${WORKSPACE}", "${TASK_INPUT}", "${TASK_OUTPUT}"]
- id: measure-incumbent
  file: flow/mage_placement_cli.py
  description: Normalise the retained incumbent PLA into a snapshot and measure it with the same metrics used on every
    candidate, labelled modelled; record its ordinary population as the inventory anchor.
  inputs: [WORKSPACE, TASK_INPUT, TASK_OUTPUT]
  argv: [python3, "${WORKSPACE}/flow/mage_placement_cli.py", task-measure-incumbent, "${WORKSPACE}", "${TASK_INPUT}", "${TASK_OUTPUT}"]
- id: engineer-script
  file: flow/mage_placement_cli.py
  description: >
    <the Engineer's complete brief, written in Task 8; placeholder text is refused by test_knowledge.py>
  inputs: [WORKSPACE, ROUND, SITE_CAPABILITIES, TARGET_DROPPED, MAX_TARGET_DISTANCE_UM, MAX_ORDER_DEVIATION_LR, MAX_ORDER_DEVIATION_TB, MAX_PRIORITY_MOVE_UM]
  licences:
    mage: 1
  argv: [python3, "${WORKSPACE}/flow/mage_placement_cli.py", script-candidate, "${WORKSPACE}", "${TARGET_DROPPED}", "${MAX_TARGET_DISTANCE_UM}", "${MAX_ORDER_DEVIATION_LR}", "${MAX_ORDER_DEVIATION_TB}", "${MAX_PRIORITY_MOVE_UM}"]
  outsourcing:
    role: resident-engineering-agent
    reads: [caseReadiness, startSnapshot, incumbentMeasure, roundDecision, methodJournal]
    knowledge: [script-method-playbook.md, mage-capabilities.md, state-and-evidence.md, reference-method-guide.md, role-script-engineer.md]
    artifactPrefix: placement
    produces: scriptCandidate
- id: decide-round
  file: flow/mage_placement_cli.py
  description: Rank the round's Reader-verified candidate against the best state so far, append its journal entry,
    evaluate the eight rules, and route continue or stop.
  inputs: [WORKSPACE, TASK_INPUT, TASK_OUTPUT]
  argv: [python3, "${WORKSPACE}/flow/mage_placement_cli.py", task-decide-round, "${WORKSPACE}", "${TASK_INPUT}", "${TASK_OUTPUT}"]
- id: evaluate-placement
  file: flow/mage_placement_cli.py
  description: Evaluate the best state's Reader values against the eight delivery rules, report the proof level and the
    comparison against the incumbent and the reference, keeping unknowns separate from Goal.
  inputs: [WORKSPACE, TASK_INPUT, TASK_OUTPUT]
  argv: [python3, "${WORKSPACE}/flow/mage_placement_cli.py", task-evaluate-placement, "${WORKSPACE}", "${TASK_INPUT}", "${TASK_OUTPUT}"]
- id: deliver
  file: flow/mage_placement_cli.py
  description: Recheck every referenced digest and package every round's stage scripts, boundary snapshots, exports,
    verify files, session logs, journal and result/evaluation JSON into the final delivery with REPORT.md.
  inputs: [WORKSPACE, TASK_INPUT, TASK_OUTPUT]
  argv: [python3, "${WORKSPACE}/flow/mage_placement_cli.py", task-deliver, "${WORKSPACE}", "${TASK_INPUT}", "${TASK_OUTPUT}"]
rules:
- placement-delivery-ready
- priority-all-placed
- no-native-violation
- drops-within-goal
- target-limit-met
- order-lr-within-goal
- order-tb-within-goal
- priority-move-within-budget
goal:
  target_dropped_count: {type: number, unit: count, min: 0, max: 100000, default: 0}
  max_target_distance_um: {type: number, unit: um, min: 0, max: 100000, default: 100}
  max_order_deviation_lr: {type: number, unit: rank, min: 0, max: 1000, default: 2}
  max_order_deviation_tb: {type: number, unit: rank, min: 0, max: 1000, default: 1}
  max_priority_move_um: {type: number, unit: um, min: 0, max: 100000, default: 100}
strategy:
  incumbentComparison: {type: choice, options: [retained, native], default: retained}
knowledge:
- {file: script-method-playbook.md, purpose: The Engineer's whole method -- the four stages, the known failures, the action order, the journal discipline and prohibitions.}
- {file: mage-capabilities.md, purpose: The prelude/epilogue the Pack runs and the reference method's MAGE command surface with V/D status and pitfalls.}
- {file: state-and-evidence.md, purpose: Modelled versus native versus device facts, snapshot binding, unknown stays unknown, ordinary versus grouped drops, identity.}
- {file: reference-method-guide.md, purpose: How to read the Site's reference method files and probe notes as evidence, never as results.}
- {file: role-script-engineer.md, purpose: The Engineer's own role brief -- inputs, permitted CLI calls, round protocol, deliverable shape.}
```

In Task 8 the `engineer-script` description is replaced by the full brief (the Harness sends it as the task text; the knowledge test refuses the placeholder).

- [ ] **Step 6: Write `graph.yml`**

```yaml
schema: hima-flow/1
id: mage-script-placement
version: 0.1.0
flow:
  kind: sequence
  id: placement
  steps:
  - kind: task
    id: prepare-case
    tool: prepare-case
    inputs:
      MAGE_CASE_MANIFEST: {source: runInput, path: [mageCaseManifest]}
      SITE_CAPABILITIES: {source: runInput, path: [siteCapabilities]}
      TARGET_DROPPED: {source: goal, path: [target_dropped_count]}
      MAX_TARGET_DISTANCE_UM: {source: goal, path: [max_target_distance_um]}
      MAX_ORDER_DEVIATION_LR: {source: goal, path: [max_order_deviation_lr]}
      MAX_ORDER_DEVIATION_TB: {source: goal, path: [max_order_deviation_tb]}
      MAX_PRIORITY_MOVE_UM: {source: goal, path: [max_priority_move_um]}
    contract: {input: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/prepare-case-input'}}, output: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/prepare-case-output'}}}
  - kind: task
    id: measure-incumbent
    tool: measure-incumbent
    inputs:
      CASE: {source: committedOutput, taskId: prepare-case, path: []}
      INCUMBENT_COMPARISON: {source: strategy, path: [incumbentComparison]}
    contract: {input: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/measure-incumbent-input'}}, output: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/measure-incumbent-output'}}}
  - kind: repeat
    id: script-rounds
    maxIterations: 6
    budget: original-run
    carry:
      roundState:
        initial: {source: literal, value: {round: 1}}
        next: {taskId: decide-round, path: [nextRound]}
    stop: {output: {taskId: decide-round, path: [route]}, equals: stop}
    body:
      kind: sequence
      id: round
      steps:
      - kind: task
        id: engineer-script
        tool: engineer-script
        inputs:
          ROUND: {source: carry, path: [roundState, round]}
          SITE_CAPABILITIES: {source: committedOutput, taskId: prepare-case, path: [SITE_CAPABILITIES]}
          TARGET_DROPPED: {source: goal, path: [target_dropped_count]}
          MAX_TARGET_DISTANCE_UM: {source: goal, path: [max_target_distance_um]}
          MAX_ORDER_DEVIATION_LR: {source: goal, path: [max_order_deviation_lr]}
          MAX_ORDER_DEVIATION_TB: {source: goal, path: [max_order_deviation_tb]}
          MAX_PRIORITY_MOVE_UM: {source: goal, path: [max_priority_move_um]}
        contract: {input: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/engineer-script-input'}}, output: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/resident-output'}}}
      - kind: task
        id: decide-round
        tool: decide-round
        inputs:
          ROUND: {source: carry, path: [roundState, round]}
          CANDIDATE: {source: committedOutput, taskId: engineer-script, path: []}
          TARGET_DROPPED: {source: goal, path: [target_dropped_count]}
          MAX_TARGET_DISTANCE_UM: {source: goal, path: [max_target_distance_um]}
          MAX_ORDER_DEVIATION_LR: {source: goal, path: [max_order_deviation_lr]}
          MAX_ORDER_DEVIATION_TB: {source: goal, path: [max_order_deviation_tb]}
          MAX_PRIORITY_MOVE_UM: {source: goal, path: [max_priority_move_um]}
        contract: {input: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/decide-round-input'}}, output: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/decide-round-output'}}}
  - kind: task
    id: evaluate-placement
    budget: closing
    tool: evaluate-placement
    inputs:
      DECISION: {source: committedOutput, taskId: decide-round, path: []}
      INCUMBENT: {source: committedOutput, taskId: measure-incumbent, path: []}
      TARGET_DROPPED: {source: goal, path: [target_dropped_count]}
      MAX_TARGET_DISTANCE_UM: {source: goal, path: [max_target_distance_um]}
      MAX_ORDER_DEVIATION_LR: {source: goal, path: [max_order_deviation_lr]}
      MAX_ORDER_DEVIATION_TB: {source: goal, path: [max_order_deviation_tb]}
      MAX_PRIORITY_MOVE_UM: {source: goal, path: [max_priority_move_um]}
    contract: {input: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/evaluate-placement-input'}}, output: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/evaluate-placement-output'}}}
  - kind: task
    id: deliver
    budget: closing
    tool: deliver
    inputs:
      EVALUATION: {source: committedOutput, taskId: evaluate-placement, path: []}
    contract: {input: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/deliver-input'}}, output: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/deliver-output'}}}
```

- [ ] **Step 7: Rewrite `schemas/tasks.json`**

Keep `artifactRef`, `readerValue`, `observation`, `resident-output` verbatim. Define the five goal properties once as `$defs/goal-fields` (an object with the five `{"type": "number"}` properties) and spell them out in each input's `required`/`properties` (the subset validator has no `allOf`): `prepare-case-input` (`MAGE_CASE_MANIFEST`, `SITE_CAPABILITIES`, the five), `prepare-case-output` (`MAGE_CASE_MANIFEST`, `SITE_CAPABILITIES`, `readinessId`, `startSnapshotSha256`), `measure-incumbent-input`/`-output` (unchanged shapes), `engineer-script-input` (`ROUND` integer ≥ 1, `SITE_CAPABILITIES`, the five), `decide-round-input` (`ROUND`, `CANDIDATE` → `resident-output`, the five), `decide-round-output` (`route` enum, `nextRound{round}`, `best` object|null, `stopReason`, `goalMet` boolean, `rules` object, `journalEntries` integer ≥ 0), `evaluate-placement-input` (`DECISION` → `decide-round-output`, `INCUMBENT` → `measure-incumbent-output`, the five), `evaluate-placement-output` (`goalMet`, `metrics`, `incumbent`, `comparison`, `rules`, `unknowns`, `proofLevel` enum `none|reproduction|improvement|match|surpass|completion`, `domainReport`), `deliver-input` (`EVALUATION`), `deliver-output` (`goalMet`, `proofLevel`, `reportPath`, `packagePath`).

- [ ] **Step 8: Write the end-to-end CLI route test, `flow/tests/test_cli_tasks.py`**

Model it on `test_cli_stage.py`'s setup but drive the program tasks: `task-prepare-case` (inputs: the manifest, the site capabilities, the five goal values with `max_priority_move_um: 200`) → `task-measure-incumbent` (`CASE` = prepare value, `INCUMBENT_COMPARISON: retained`) → round 1 (stage `BASELINE`, journal, `candidate`, Reader subprocess as `test_readers.py` does, build the `resident-output` dict `{"observations": [{"contentSha256": sha of the candidate file, "values": reader values}], "engineering": {"outcome": "completed", "summary": "", "stopReason": ""}}`) → `task-decide-round` → round 2 with an improved stage (write a PLA with `OVL_B` centred on `(1290, 30)` µm and `KEY_V` placed as in the sibling's `_candidate_pla_text`, then the stage text `hima_open_build\nsource {<that pla>}\nhima_snapshot improved\ng_params -set {smPFlow::s_ARTestConvergePrplaced false}\nsmPFlow -autoRefine\nhima_snapshot filled\n`) → `task-decide-round` → `task-evaluate-placement` → `task-deliver`. Assert: round 1 `route == "continue"`, `rules["drops-within-goal"] == "FAIL"`; round 2 `route == "stop"`, `goalMet` true; evaluation `proofLevel == "completion"` (ordinary length 0, all rules PASS); `measure-incumbent` value `ordinaryPopulation == 3`; the delivery tarball lists `state/method-journal.json` and both rounds' `script.tcl`; `REPORT.md` contains `Proof level: completion`. Add a second test where round 2 repeats round 1 and round 3 repeats again → round 3 `route == "stop"` with the two-stall reason and `proofLevel == "reproduction"`. Add a third test where round 1's stage fails (`MAGE_STANDIN_FAIL_AFTER_SNAPSHOT=priority-start`) → decision `blockedRound` true, `route == "continue"`, `best` null; round 2 baseline → `best.round == 2`.

- [ ] **Step 9: Run the whole suite; expect `OK`; commit and push** (`feat(mage-script): program tasks, round decision, contract and graph`).

---

### Task 8: Knowledge, the Engineer brief and the Pack documents (Sonnet 5 medium)

**Files:**
- Create: `knowledge/script-method-playbook.md`, `knowledge/mage-capabilities.md`, `knowledge/state-and-evidence.md`, `knowledge/reference-method-guide.md`, `knowledge/role-script-engineer.md`
- Modify: `contract.yml` (`engineer-script.description`), `INTENT.md`, `SPEC.md`, `FABRIC.md`, `TEST.md`
- Test: `flow/tests/test_knowledge.py` (port the sibling's checks: every contract-named knowledge file exists with a flat name, no placeholder text, the Engineer's five files total under 12,000 words, every CLI subcommand/flag a file names is real (`mage-stage --round --script --out-dir --timeout-s`, `stage-report --stage-dir --out`, `candidate --round --stage-dir --journal --out`, `snapshot`, `lane-view`, `plan-slots`), every `state/...` path is a declared output or `state/history/round-NN/...`; `RESIDENT_TOOL_IDS = ("engineer-script",)`; placeholder marker `<the Engineer's complete brief`)

**Interfaces:** Consumes the CLI of Task 5, the Reader of Task 6, the contract of Task 7. Produces the five knowledge files the contract names and the resident brief.

- [ ] **Step 1: Port `test_knowledge.py`** from the sibling with the changes above and run it; expect FAIL (files missing, placeholder present).

- [ ] **Step 2: Write `knowledge/script-method-playbook.md`** with these sections, in this order, each written out (no bullets that defer to another document):
  1. *Source* (spec §6, §7, §10; `mage_placement_cli.py`; `native/prelude.tcl`).
  2. *Workspace convention* (copy verbatim from the sibling's `placement-playbook.md` "Workspace convention", with `placement/` as the only artifact prefix).
  3. *Objective and the three proof stages* (Reproduction = the native fill from the frozen start reproduces the incumbent's ordinary dropped length; Improvement; Match/Surpass against `case-readiness.reference.referenceOrdinaryDropLengthUm` when present; Customer completion = every rule PASS and zero drops). State that a quantified failure analysis in the journal is a complete round.
  4. *Fixed boundary* (never edit the rule file, pblock/block files, target table, request order, Goal limits or any Site file; a settings change through Tcl is a method choice, a change to what placements are allowed is a rule edit — give the `-arOffsetRange` relaxation as the allowed example and `-setScribe`/`-setNum`/`-setSpace` edits as the forbidden ones).
  5. *The four stages of the reference method*, each with its verified command text: priority point placement (`smPFlow -placeGroup -groupItem <G> -groupTargetPoint (<x>,<y>) -groupPlaceType CT` per request line, CT = LOC + frame size / 2; the request order files on the Site; the customer's own order-deviation check per side), compaction (`smSLFit <item> -setAutoRefine -arOffsetRangeX -1.000000 -arOffsetRangeY -1.000000` for items whose offsets are `0`, `g_params -set {smPFlow::s_ARTestConvergePrplaced true}`, the two `-setAutoRefineSimpleConverge` lines from `case-readiness.manifest.mage.autoRefineConverge`, `frbGroupSetting -setObject -objectType {GROUP} -objectV {1}` and `-objectX {1}`, `smPFlow -autoRefine`), freeze (restore the zero offsets exactly as the rule file states them, `g_params -set {smPFlow::s_ARTestConvergePrplaced false}`), fill (`smPFlow -autoRefine`).
  6. *The two known failure signatures on this build* (verbatim: a settings edit after point placement leaves 0 placed Fits with every Group record intact; `Sort sl <lane> preplaced fits failed` + `Failed at auto refinement` in converge mode, while the same sort line is harmless in a non-converge fill) and the compatibility repairs as exact Tcl (`regexp -- {…\}…}` with escaped closing braces; `eval $line`; `-arOffsetRangeX -1.000000` without braces; a clean working directory; the export is DBU with µm Group points).
  7. *Stage-boundary discipline*: `hima_snapshot` before and after every settings edit, every `-autoRefine`, every restore; `hima_check` after every move set; run `stage-report` and read the row for each boundary before drawing a conclusion; a boundary whose `inGroupFits` is 0 while `groups` is intact is the invalidation signature; a boundary whose `inventory.status` is `fail` cannot be delivered.
  8. *Action order* (exactly spec §10 items 1–5), with round 1 fixed to the baseline reproduction script given verbatim:
     ```
     hima_open_build
     source $hima_start_pla
     hima_snapshot priority-start
     hima_check
     smPFlow -setAutoRefineSimpleConverge -arSLType VERT -arConvergeNum <VERT>
     smPFlow -setAutoRefineSimpleConverge -arSLType HORZ -arConvergeNum <HORZ>
     g_params -set {smPFlow::s_ARTestConvergePrplaced false}
     smPFlow -autoRefine
     hima_snapshot filled
     ```
  9. *Explicit compaction by the agent*: compute moves from a boundary snapshot (`snapshot --pla <boundary pla> --stage candidate --out <file>`, `lane-view`, optional `plan-slots`), keep every Group's target point, respect request order per side and the movement budget `max_priority_move_um` measured from the frozen start, write a complete PLA (`pla.write_pla` through a helper Python file under `placement/round-NN/tools/`), replay it with `source`, `hima_check`, then freeze and fill; or apply `frbSelect -type Sel -inst <FULLID>` + `frbMove -off (<dx>,<dy>)` sequences (D status: qualify with one passing and one failing stage first).
  10. *Two displacement metrics never mixed* (distance from the CT target vs movement from the frozen start).
  11. *Journal discipline* (one hypothesis per round written before the first stage; every stage listed with its sha, outcome, boundaries and native message; conclusion and next step; the next round's Engineer reads the journal first and never repeats a hypothesis the journal already closed).
  12. *Delivery shape and prohibitions* (never fabricate a candidate; never deliver a stage whose export lost inventory as if it were an improvement; never run MAGE outside `mage-stage`; never edit the rule file).

- [ ] **Step 3: Write `knowledge/mage-capabilities.md`**: the prelude procs and variables (`hima_open_build ?buildFlags?`, `hima_snapshot <name>`, `hima_check`, `$hima_case_frb`, `$hima_case_dir`, `$hima_start_pla`, `$hima_out`), the epilogue, the refusal gate (the exact forbidden list), the stage result files, then the command surface table with status: V — everything in the prelude/epilogue, `source <pla>`, `smPFlow -placeGroup … -groupPlaceType CT`, `smPFlow -placeFix -toFix <n>` with `frbSetup -obj PlaceStep -inst <name>`, `smSLFit <item> -setAutoRefine -arOffsetRangeX/Y` (V: invalidates placed Fits on this build), `g_params -set {smPFlow::s_ARTestConvergePrplaced …}`, `smPFlow -setAutoRefineSimpleConverge …`, `frbGroupSetting -setObject …`, `smPFlow -autoRefine`, `smPInstMgr -saveMark` (DBU shape, µm Group points); D — `frbSelect`/`frbMove`, `frbGuidedMove -targetPos`, `frbOps Aln*`, `frbAlign`, `smPInstMgr -placeDropInstFit`, `smPFlow -refine -refineRegion -refineLocation`, `smPFlow -placeFitList`, `frbUndo`; pitfalls (vendor launcher exits 0; `MAGE_ROUND_END` is the truth; compute before print; the sort warning is harmless in non-converge mode; `-savePlaDBU` is a header not a command; `hima_open_build` may be called many times in one stage as the reference method does; each stage is one MAGE process and one licence checkout).

- [ ] **Step 4: Write `knowledge/state-and-evidence.md`** by copying the sibling's file and replacing the "Snapshot binding" paragraph's document names with `mage.script-candidate/1`, the "Counterexample" with a stage-report counterexample (a boundary table reads 0 in-group Fits; reporting the stage's export as "all priority placed" because the Group records are intact would be a stronger claim than the evidence supports), and deleting every consumer/Ledger reference.

- [ ] **Step 5: Write `knowledge/reference-method-guide.md`**: what `case-readiness.reference.referenceMethod` is (the reference method's entry script on the Site, read-only; the digest proves it is the frozen customer script), what `referenceFiles` holds (the target CSV, the generated request files, the saved per-side placement files), what `referenceNotes` are (observations from earlier sessions and probes: facts about what failed where, never instructions to follow blindly), how to read the entry script in stage order and map each stage to a `hima_snapshot` boundary, what in it is verified history (the point placement completed; the retained historical artifact's figures) versus unreproduced on this build (the compaction), and three rules: never source a reference artifact as a candidate, never copy a reference number into a journal observation without re-measuring it with `stage-report`, cite the reference file path and line when a stage reproduces one of its steps.

- [ ] **Step 6: Write `knowledge/role-script-engineer.md`**: mission; exact inputs (`state/case-readiness.json`, `state/start-snapshot.json`, `state/incumbent.json`, `state/round-decision.json`, `state/method-journal.json`); permitted CLI calls with exact flags (the table in Frozen interfaces); the round protocol (spec §6 steps 1–6); round 1 fixed; what to produce (`state/round/script-candidate.json` via `candidate`, `placement/round-NN/journal-entry.json`, every file under `placement/round-NN/` as support in `resident-delivery.json` with `kind: result` on the candidate); uncertainty handling (blocked stage → deliver the blocked candidate with the boundary named; lost inventory → never deliver as completed; identity-unknown movement → say so); a worked journal entry (the `fixtures.journal_entry` shape filled with a compaction-failure example: hypothesis "configuring offsets before build avoids the invalidation", stages 1–2 with boundaries and the native message, conclusion, next step).

- [ ] **Step 7: Replace the `engineer-script` description in `contract.yml`** with the complete brief (one YAML `>` block, 25–40 lines): own one round end to end; read the five state files; write the hypothesis first; author stage scripts and run each through `mage-stage`; read `stage-report`; round 1 is the baseline reproduction; later rounds follow the playbook's action order; never edit rule/target/request/Goal files; deliver the best completed stage (or a blocked one) through `candidate` with the journal entry; never fabricate a candidate; you alone hold the MAGE licence.

- [ ] **Step 8: Write `INTENT.md`, `SPEC.md`, `FABRIC.md`, `TEST.md`** in the sibling's four-document shape, for this Pack: INTENT (business, golden flow, answers, ambiguities resolved — the user's five decisions: script-method, agent-authored Tcl with the customer script as reference, round loop with fresh sessions, name, own Site), SPEC (goal template with the five knobs, constraints, run contract table, the stage driver and markers, semantics, the eight rules, proof levels, endings, knowledge), FABRIC (files written; gaps: no model, no EDA, stand-in only; what the dry route proves), TEST (L1 command and count, L0/L2 command, L2 dry route command, L4 pending). No customer identifiers; the aggregate benchmark figures are allowed.

- [ ] **Step 9: Run `test_knowledge.py` and the whole suite; expect `OK`; commit and push** (`docs(mage-script): knowledge, Engineer brief and Pack documents`).

---

### Task 9: Host contract test and the Site (Sonnet 5 medium)

**Files:**
- Create: `test/contract/mage-script-placement.test.ts`, `sites/linglong-mage-script/site.yml`, `sites/linglong-mage-script/permit.yml`, `sites/linglong-mage-script/README.md`
- Modify: `test/contract-groups.json` (add the test to the `local` group right after `test/contract/mage-scribe-placement.test.ts`)

**Interfaces:** Consumes `contract.yml`/`graph.yml` (Task 7), the Reader yml (Task 6). Produces the Site the live Run uses.

- [ ] **Step 1: Write the Site**

`sites/linglong-mage-script/site.yml`:

```yaml
name: linglong-mage-script
kind: ssh
workspaceRoot: /data/eda/project/hima_harness/mage-runs
permit: ./permit.yml
bindings:
  mageCaseManifest: /data/eda/project/hima_harness/mage-inputs/scribe-case-v1/manifest-script.json
  siteCapabilities: /data/eda/project/hima_harness/mage-inputs/scribe-case-v1/site-capabilities.json
  engineeringCapabilities: /data/eda/project/hima_harness/operator-admin/resident-engineering-v1/engineering-capabilities-mage-v1.json
  workspaceRoot: /data/eda/project/hima_harness/mage-runs
ssh:
  destination: luzi@192.168.50.41
  jumps: []
  controlPersistSeconds: 60
capacity:
  cores: 16
  memoryGiB: 64
  parallelJobs: 2
  licences:
    mage: 1
```

`permit.yml`: byte-identical to `sites/linglong-mage/permit.yml`. `README.md`: the Site's purpose (the `mage-script-placement` Pack), the layout table (same roots as `linglong-mage`; `manifest-script.json` is a Site-local stamped manifest carrying `referenceMethod` = the case's reference entry script, `referenceFiles` = the reference directory's files, `referenceNotes` = Site-local notes, `referenceOrdinaryDropLengthUm` = the retained reference figure; its sha is recorded here after Task 12 stamps it), the licence/parallelJobs/round-end/Python constraints copied from `linglong-mage/README.md`, and "What is not installed" (nothing new on Linglong except the manifest file and the notes directory).

- [ ] **Step 2: Write the contract test** `test/contract/mage-script-placement.test.ts`, modelled on the sibling's test:
  - test 1: `loadPack` → `contract.version === '0.1.0'`, budget 21_600_000 / 900_000; one `repeat` with `maxIterations 6`, `budget 'original-run'`, `stop` on `decide-round.route == stop`, `carry` keys `['roundState']`; body steps `['engineer-script', 'decide-round']`; top steps `['prepare-case', 'measure-incumbent', repeat.id, 'evaluate-placement', 'deliver']`; `evaluate-placement`/`deliver` budget `closing`; exactly one tool with `outsourcing` (`engineer-script`, role `resident-engineering-agent`, `licences {mage: 1}`, `produces 'scriptCandidate'`, `artifactPrefix 'placement'`, five knowledge files); `agentTeams`/`workshops` empty; the Reader yml's `emits` all declared in `semantics.yml` and equal to the 17 types in order; the eight rule files exist and `contract.rules` sorted equals the eight ids; `goal` keys are the five knobs with the exact `{type, unit, min, max, default}` objects; `strategy` equals `{incumbentComparison: {type: 'choice', options: ['retained', 'native'], default: 'retained'}}`.
  - test 2: `checkPack` fits a `writeLocalSite` with `licences: {mage: 1}` and bindings `{mageCaseManifest, siteCapabilities, workspaceRoot, engineeringCapabilities, consumerContext}` (the extra `consumerContext` binding is tolerated), and refuses the same Site with `licences: {}` (`/does not declare/`).
  - test 3: `checkPack` fits the real `sites/linglong-mage-script/{site.yml,permit.yml}` copied into a Home as `linglong-mage-script.yml` + `permit.yml`, and refuses a copy whose `licences:\n    mage: 1\n` is replaced by `licences: {}\n`.

- [ ] **Step 3: Register and run**

```bash
cd /Users/lluzi/code/hima_harness_reforge_polishing/.claude/worktrees/mage-script-placement
export PATH="$HOME/.local/node24/bin:$PATH" HIMA_POSTGRES_RUNTIME=/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/dbos-migration/u2/runtime-final CI=true
pnpm run build && pnpm run test:local -- --files test/contract/mage-script-placement.test.ts
```

Expected: 3 passing tests. Then **commit and push** (`feat(mage-script): Host contract test and Site linglong-mage-script`).

---

### Task 10: L2 dry route through the real Host (Opus 4.8 medium)

**Files:**
- Create: `test/fixtures/mage-script-dry/prepare.py`, `test/fixtures/mage-script-dry/acp.py` (both `chmod +x`), `test/contract/support/mage-script-durable-worker.ts`, `test/contract/mage-script-placement-durable.host.test.ts`
- Modify: `test/contract-groups.json` (`atcs-dry` group gains the new host test)

**Interfaces:** Consumes the whole Pack. Produces the three scripted scenarios `converge`, `stall`, `blocked` selected by env `MAGE_SCRIPT_DRY_CASE`.

- [ ] **Step 1: `prepare.py`** — copy the sibling's `test/fixtures/mage-resident-dry/prepare.py`, pointing `PACK_FLOW` at `packs/mage-script-placement/flow`; print two lines (manifest path, site-capabilities path); no consumer context.

- [ ] **Step 2: `acp.py`** — copy the sibling's ACP skeleton (JSON-RPC loop, `send`, `_run_cli`, `_inputs_by_name`) and replace the role functions with one `engineer(task, workspace, campaign, cli)`:
  - `_populate_state` copies `caseReadiness`, `startSnapshot`, `incumbentMeasure`, `roundDecision`, `methodJournal` into `state/…` of the private workspace (`methodJournal` → `state/method-journal.json`).
  - `round_no = int(task["task"]["boundInputs"]["ROUND"])`; `scenario = os.environ["MAGE_SCRIPT_DRY_CASE"]`.
  - Stage text: round 1 (every scenario), or any round in `stall` → the baseline script (Frozen interfaces `BASELINE` plus the two converge lines read from `case_readiness["manifest"]["mage"].get("autoRefineConverge")`, omitted when absent); round ≥ 2 in `converge` or `blocked` → write `placement/round-NN/improved.pla` (OVL_B centred on (1290, 30) µm and KEY_V placed as a Fit at x 1060–1120, y 300–1200 µm, drops emptied, via `pla.read_pla`/`write_pla` on the start PLA) and the script `hima_open_build\nsource {<abs improved.pla>}\nhima_snapshot improved\ng_params -set {smPFlow::s_ARTestConvergePrplaced false}\nsmPFlow -autoRefine\nhima_snapshot filled\n`.
  - In `blocked` round 1, set `os.environ["MAGE_STANDIN_FAIL_AFTER_SNAPSHOT"] = "priority-start"` before `mage-stage` and delete it afterwards.
  - Run `mage-stage --round N --script <file> --out-dir placement/round-NN/stage-1`, then `stage-report`, write `placement/round-NN/journal-entry.json` from the stage summary (`fixtures.journal_entry`-shaped dict built inline: hypothesis per scenario, `outcome` `completed`/`failed` from the summary), run `candidate --round N --stage-dir … --journal … --out placement/round-NN/script-candidate.json`, and write `resident-delivery.json` listing every file under `placement/round-NN/` (the candidate as `result`, the rest `support`).
  - `handle_initial_prompt` dispatches only `engineer-script`.

- [ ] **Step 3: Worker** — copy `test/contract/support/mage-resident-durable-worker.ts`, set `packId='mage-script-placement'`, `fixture=path.join(repoRoot,'test/fixtures/mage-script-dry')`, env `MAGE_SCRIPT_DRY_CASE: mode`, bindings `{workspaceRoot, mageCaseManifest, siteCapabilities, engineeringCapabilities}` from `prepare.py`'s two lines, goal `{target_dropped_count:0, max_target_distance_um:100, max_order_deviation_lr:2, max_order_deviation_tb:1, max_priority_move_um:200}`, `expectedTasks = 2 + rounds*2 + 2`, engineering job name `engineering-engineer-script`, reader job name `reader-mage-script-candidate`, reader error fact `mage_candidate_error_count` only, `readerReadingsSeen >= rounds`, proof fields `{mode, runId, tasks, rounds, readerJobs, engineeringJobs, productModelCalls: 0, goalState, goalMet, proofLevel: deliverValue.proofLevel, journalEntries: <final decide-round value>.journalEntries, elapsedMs}`; write the proof JSON under `.hima-tmp/dbos-migration/u8/dry/mage-script-<mode>-proof.json` (create the directory first).

- [ ] **Step 4: Host test** — copy `test/contract/mage-scribe-placement-durable.host.test.ts`; loop over `['converge','stall','blocked']`; assertions: `ok`, `productModelCalls === 0`, `readerJobs === engineeringJobs === rounds`; `converge`: rounds 2, tasks 8, goalMet true, proofLevel `completion`, journalEntries 2; `stall`: rounds 3, tasks 10, goalMet false, proofLevel `reproduction`; `blocked`: rounds 2, tasks 8, goalMet true (round 2 delivers the improved PLA), journalEntries 2. Register in `test/contract-groups.json` under `atcs-dry`.

- [ ] **Step 5: Run**

```bash
cd /Users/lluzi/code/hima_harness_reforge_polishing/.claude/worktrees/mage-script-placement
export PATH="$HOME/.local/node24/bin:$PATH" HIMA_POSTGRES_RUNTIME=/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/dbos-migration/u2/runtime-final CI=true
mkdir -p .hima-tmp/dbos-migration/u8/dry
pnpm run build && node scripts/run-contract-tests.mjs atcs-dry --files test/contract/mage-script-placement-durable.host.test.ts
```

Expected: 3 passing. Record the three proof lines in `TEST.md`'s L2 section and `FABRIC.md`. **Commit and push** (`test(mage-script): L2 dry route through the real Host`).

---

### Task 11: Final whole-branch review (Opus 5.5 high)

Review the diff `6b6699ec..HEAD` restricted to `packs/mage-script-placement/`, `sites/linglong-mage-script/`, `test/contract/mage-script-placement*.ts`, `test/contract/support/mage-script-durable-worker.ts`, `test/fixtures/mage-script-dry/`, `docs/superpowers/specs/2026-10-12-mage-script-placement-pack-design.md` against the spec. Checklist: every Reader value re-derived from files (never trusted from the candidate); the session-log binding (stage sha + export sha) cannot be satisfied by a stage that did not complete; a blocked candidate can never become `best`; inventory conservation refuses a lost structure and a missing ordinary population; the refusal gate blocks `frbOpen`, `exit`, marker forgery and `proc hima_`; no customer identifier anywhere in the tracked tree (`grep -rn` for the frozen case's file-name stem, product code and company names returns nothing under `packs/mage-script-placement`, `sites/linglong-mage-script`, `test/`, `docs/superpowers`); Python 3.8 compatibility (`grep` for `is_relative_to`, `removeprefix`, `removesuffix`, `match `); knowledge names every real CLI flag and no removed one. Deliver GO / NO-GO with numbered findings; fixes go through one more Opus 4.8 fix round and a re-review of the changed files only.

---

### Task 12: Native probes on Linglong (main agent)

Pre-conditions: `lmstat -a -c 59003@localhost` shows free MAGE seats; the sibling Pack's Run (if active) is not in `engineer-place`. Work under `/home/luzi/tmp/mage-script-probe-NN/`; never touch `/data/eda/project/hima_harness/mage-runs` or the sibling's Home.

1. **Stamp the Site manifest**: copy the staged `scribe-case-v1/manifest.json` to `manifest-script.json`, add `referenceMethod` (the case's `run_tcl/run.tcl` with sha), `referenceFiles` (every file under `run_tcl/`, each with sha), `referenceNotes` (copy the handoff's two patches and the sibling probe directory's `*.tcl`/`*.gdb` probe files into `scribe-case-v1/reference-notes/`, each with sha and a title), `referenceOrdinaryDropLengthUm: 52453`; stamp with `core.stamp("case-manifest", body)` from the Pack's `flow/`; record the sha in `sites/linglong-mage-script/README.md` (no customer values).
2. **Baseline probe**: rsync `packs/mage-script-placement/flow` and `tools` to the probe directory; on the Linglong host run `task-prepare-case` and `task-measure-incumbent` against the new manifest, then `mage-stage --round 1 --script baseline.tcl --out-dir placement/round-01/stage-1` with the playbook's round-1 script, `stage-report`, `candidate`, and the Reader. Expected: completed; ordinary drops 27 / 135,113 µm; 319 inventory; native 0/1/0; Reader error 0.
3. **Failure probe**: a stage that reproduces the reference compaction call after a restore (`hima_open_build; source $hima_start_pla; hima_snapshot priority-start; <offset -1 lines for the zero-offset items>; hima_snapshot after-offsets; <converge true + converge lines + autoRefine>`). Expected: `MAGE_STAGE_ERROR` with the boundary named, a `blocked` candidate whose `stopReason` carries `Failed at auto refinement`, `stage-report` showing the invalidation at `after-offsets` (0 in-group Fits, Groups intact).
4. Record both probes' commands, outputs and shas in `.superpowers/sdd/native-probes.md` (machine-local, untracked) and the pass/fail facts in `TEST.md`'s L4 section (no customer values).

---

### Task 13: Live Run, independent evaluation, cold replay, report (main agent with the user)

1. Copy `.hima-tmp/mage-live/live-worker.ts` to `.hima-tmp/mage-script-live/live-worker.ts` in the main checkout (machine-local), set `packId='mage-script-placement'`, default `siteName='linglong-mage-script'`, strategy `{incumbentComparison:'retained'}`; start with a fresh Home and goal `{"target_dropped_count":0,"max_target_distance_um":100,"max_order_deviation_lr":2,"max_order_deviation_tb":1,"max_priority_move_um":100}` and `timeBoxMs 21600000`; watch the Host web UI with the user.
2. After the Run ends: read `delivery/report.json`, `state/method-journal.json`, every round's `stage-report.json`.
3. Run the kit's `tools/evaluate.py` on the delivered export (with `--binding` if identities changed); reconcile ordinary length/count, 225 priority, 10 Fixed, 319 inventory with `state/script-result.json`.
4. Cold replay: copy the delivered `stage.tcl`'s agent text to a fresh probe directory and re-run it through `mage-stage`; the export sha must match the delivered export sha (if the agent's method is randomized, record that and the repeat outcome instead).
5. Report (machine-local, then a customer-neutral summary into `TEST.md` L4 and `FABRIC.md`): baseline / Run / customer reference table (ordinary drops count+length, grouped, priority placed, Fixed, max target error, max priority movement, order deviation per side, native counts, elapsed, MAGE time, human interventions), the proof level reached, the journal digest (what the Engineer tried and concluded), open checks (SPACE instance row, 8 exact-block mismatches, missing tech `a`).
