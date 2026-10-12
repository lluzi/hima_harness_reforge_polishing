# MAGE Scribe-Line Placement Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `packs/mage-scribe-placement/` 0.1.0: a HimaPack in which a MAGE Engineer resident and four consumer-role residents run serially in a Fabric `repeat` loop to place scribe-line test structures, with all geometry, metrics and consumer costs computed by Pack code and every delivery Reader-verified.

**Architecture:** One `hima-flow/1` sequence: `prepare-case` → `measure-incumbent` → `repeat placement-rounds { engineer-place → review-litho-pie → review-metrology → review-alignment → review-wat → decide-round }` → `evaluate-placement` → `deliver`. Program tasks use the ATCS `task-<name> WORKSPACE TASK_INPUT TASK_OUTPUT` ABI; the five resident tasks use `outsourcing` on the unchanged Harness. A pure-Python package `flow/mage_placement/` owns parsing, the lane model, the exact slot planner, metrics, consumer evaluators, records, round decisions and the one-writer MAGE driver. One Reader script backs two reader declarations.

**Tech Stack:** Python 3.9 standard library only (Pack code and tests, `unittest`), YAML/JSON Pack declarations, TypeScript `node:test` contract tests through `@hima/harness`, the existing resident wrapper `sites/linglong-atcs28/templates/resident-engineering-wrapper.py` with `sandbox.kind: none, testOnly: true` for the dry route.

**Spec:** `docs/superpowers/specs/2026-10-12-mage-scribe-placement-pack-design.md` (read it first; section numbers below refer to it).

## Global Constraints

- Pack id `mage-scribe-placement`, version `0.1.0`, `status: development`, `minimumHarnessVersion: 0.3.0`.
- Budget `timeBoxMs: 21600000`, `closingReserveMs: 900000`, `minimumGenerations: 1`.
- Goal knobs: `target_dropped_count` (count, 0..100000, default 0), `max_target_distance_um` (um, 0..100000, default 100), `max_order_deviation` (rank, 0..1000, default 1). Strategy: `incumbentComparison: choice [retained, native] default retained`.
- Round loop `maxIterations: 4`, `budget: original-run`, carry key `roundState`, stop when `decide-round` output `route == "stop"`.
- Python: `/usr/bin/python3` is 3.9.6. No `match`, no `X | Y` type unions, no `zip(strict=)`, no `str.removeprefix` reliance on 3.9+ only features beyond 3.9. Standard library only (no jsonschema, no numpy, no yaml in Pack runtime code; consumer-model templates are YAML read by a tiny parser-free approach: ship them as `.yml` **and** load them through `flow/mage_placement/consumers.py` with a minimal YAML subset reader, or ship `.json` twins; see Task 5).
- Knowledge file names are flat (`^[A-Za-z0-9][A-Za-z0-9._-]*\.(md|txt|pdf)$`).
- Reader argv placeholders are only `READER`, `REPORT`, `OUT`, `WORKSPACE`; the Reader emits exactly its declared set every call; `value: null` always carries `unknownReason`.
- Resident support artifacts are immutable once published: every round writes under `placement/round-NN/` (Engineer) or `reviews/<role>/round-NN/` (consumer); the result file (`produces`) is overwritten each round.
- No customer data in the repo. All fixtures are synthetic. The machine-local P23 evaluation lives under `/Users/lluzi/code/mage_smart_conflict_resolver/research/mage-resident-agent-20261012/pack-eval/`.
- Units: integer DBU inside the Pack; µm only at the boundaries (vendor PLA text, CSV, reports). `dbuPerUm` comes from the case manifest (P23: 10000). Placement grid = 100 DBU (0.01 µm) unless the rule file says otherwise.
- Commits: `git -c user.name=lluzi -c user.email=lluzi@Luzis-MacBook-Air.local commit …`, message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; push to `origin feat/mage-scribe-placement` after every commit (pre-push runs `check:local`; allow 10 minutes).
- Model allocation: Sonnet 5 medium implements Tasks 1, 2, 4, 5, 6, 7, 8, 9, 10; Opus 4.8 medium implements Task 3 (planner) and reviews every task; Opus 5.5 high does the final whole-branch review (Task 12). Task 11 (machine-local P23 evaluation) is run by the main agent.

---

## File map

| Path | Responsibility |
|---|---|
| `packs/mage-scribe-placement/contract.yml`, `graph.yml`, `semantics.yml`, `schemas/tasks.json` | run contract, round loop, value semantics, task I/O schemas |
| `packs/mage-scribe-placement/flow/mage_placement_cli.py` | `task-*` program ABI; resident-facing subcommands `snapshot`, `lane-view`, `plan-slots`, `evaluate`, `mage-round`, `candidate`, `review`, `placement-candidate`, `consumer-review`, `flow-digest` |
| `flow/mage_placement/core.py` | canonical JSON, digest, `stamp('mage.<kind>/1')`, atomic write, `known/unknown` Measures, `MageError` |
| `flow/mage_placement/pla.py` | read vendor µm and native DBU PLAs (fixinsts, pinstGroupProperty, fitinsts, dropFitInsts); write a complete PLA |
| `flow/mage_placement/rules.py` | rule facts per item from the rule Tcl |
| `flow/mage_placement/targets.py` | CSV targets, request order, CT conversion, Group binding, TB/LR/IN partition |
| `flow/mage_placement/lanes.py` | frame/lane model, lane assignment, projection, periodic images, free intervals |
| `flow/mage_placement/snapshot.py` | `mage.layout-snapshot/2` build/load/sha |
| `flow/mage_placement/planner.py` | exact slot planner (a)(b)(c), cyclic lanes, clusters, relaxed bound |
| `flow/mage_placement/metrics.py` | drops, target distance, order deviation, displacement |
| `flow/mage_placement/consumers.py` | consumer-model templates + context, predicates, evaluator, receipts |
| `flow/mage_placement/records.py` | Finding/Request/Ledger/DecisionRequest validation |
| `flow/mage_placement/rounds.py` | decide-round: ledger check, best state, improvement, conflicts, route |
| `flow/mage_placement/native/session.py`, `native/tcl.py` | one-writer MAGE driver, Tcl templates, role-tagged session log, stand-in support |
| `flow/consumer_models/*.yml` + `*.json` | customer-neutral consumer models (JSON is the runtime copy; YAML is the human copy; a test asserts they are equal) |
| `flow/schemas/*.json` | document schemas (validated by `core.validate` subset validator) |
| `flow/templates/*.tcl` | `open-build.tcl`, `replay-pla.tcl`, `verify-all.tcl`, `export.tcl` |
| `flow/tests/` | unittest modules + `fixtures.py` synthetic case generator + `standin_mage.py` |
| `tools/read-mage.py` + `readers/*.yml` | fail-closed Readers `placement-candidate`, `consumer-review` |
| `rules/*.yml` | seven rules (§9) |
| `knowledge/*.md` | playbook, capabilities, state-and-evidence, review-protocol, five role playbooks (+ bonding) |
| `INTENT.md`, `SPEC.md`, `FABRIC.md`, `TEST.md` | Pack documents in the ATCS shape |
| `test/contract/mage-scribe-placement.test.ts` | L0/L2 Pack structure + checkPack |
| `test/contract/mage-scribe-placement-durable.host.test.ts`, `test/contract/support/mage-resident-durable-worker.ts`, `test/fixtures/mage-resident-dry/{prepare.py,acp.py,standin_mage.py}` | L2 dry route through the real Host |
| `test/contract-groups.json` | register the two new test files |

## Frozen interfaces (every task reads this section)

### Snapshot `mage.layout-snapshot/2`

```json
{
  "schema": "mage.layout-snapshot/2", "id": "<core.digest>", "stage": "start|incumbent|candidate",
  "dbuPerUm": 10000,
  "frame": {"widthDbu": 0, "heightDbu": 0, "scribeDbu": 0, "cols": 2, "rows": 2, "dieWidthDbu": 0, "dieHeightDbu": 0},
  "fixed":   [{"id": "P_X.P_X_TL", "base": "P_X", "boxDbu": [l, b, r, t]}],
  "groups":  [{"groupItem": "G1", "pinstGroup": "G1_1", "targetPointDbu": [x, y], "vertSL": true, "targetRow": 0}],
  "fits":    [{"id": "C1_B.C1_B_1", "base": "C1_B", "boxDbu": [l, b, r, t], "extraRot": "NULL", "postfix": "",
               "inGroup": "G1_1", "blockType": "OVL", "priority": true, "ruleItem": "C1_B",
               "lane": {"axis": "H", "track": 0}}],
  "pending": [{"id": "P09.P09", "base": "P09", "sizeDbu": [w, h], "blockType": "TSK/MPAD", "ruleItem": "P09",
               "inGroup": "", "placedFlag": 0}],
  "targets": [{"row": 0, "groupName": "G1", "partName": "C3", "target": "T1", "lengthUm": "135",
               "locXUm": "-12382.1", "locYUm": "-15381.9", "ctDbu": [x, y], "pinstGroup": "G1_1", "fitId": "C3.C3_1",
               "partition": "TB"}],
  "ruleFacts": {"P09": {"itemType": "SLFIT", "blockType": "TSK/MPAD", "scribeInc": ["VERT"], "scribeExc": ["NONE"],
                         "turnable": false, "priority": 51, "setNum": [0, 1, 1], "spaceDbu": {"x": 0, "y": 0},
                         "padCross": null, "zoneRaw": "-by PCT -xPos CENTER ...", "gridDbu": [100, 100],
                         "cluster": null, "qualified": {"space": true, "zone": false, "padCross": false}}},
  "lanes":   [{"laneId": "H:0", "axis": "H", "track": 0, "alongRangeDbu": [0, w], "crossRangeDbu": [c0, c1],
               "physicalLane": "H:0", "sharedExterior": true}],
  "inputs":  {"startState": {"path": "...", "sha256": "..."}},
  "snapshotSha256": "<sha256 of canonical body without snapshotSha256>"
}
```

- `priority` = the fit's `inGroup` is non-empty (a Group-placed mark).
- `targetRow` on a group = the target table row bound by exact `targetPointDbu` match, or `null`.
- `partition` per the customer `split_csv`: rows within `partitionToleranceUm` (default 2) of min/max `LOC Y` → `TB`; then within tolerance of min/max `LOC X` → `LR`; rest `IN`.

### Module signatures (Python)

```python
# core.py
class MageError(Exception): code: str; detail: str
def canonical(obj) -> bytes; def digest(obj) -> str  # 20 hex
def file_sha256(path) -> str; def tree_digest(path) -> str
def stamp(kind: str, obj: dict) -> dict          # schema 'mage.<kind>/1', id = digest(body without id)
def write_artifact(path, obj) -> str             # atomic; returns sha256 of bytes
def read_artifact(path, kind) -> dict            # schema + id check, raises MageError
def known(v) -> dict; def unknown(reason) -> dict; def is_known(m) -> bool
def validate(instance, schema: dict, where: str = '') -> list[str]   # JSON-Schema subset: type, required,
      # properties, additionalProperties(bool), enum, const, items, minItems, maxItems, minLength, pattern,
      # minimum, maximum, $ref within the same document ('#/$defs/x'); returns error strings
def um_to_dbu(text_or_decimal, dbu_per_um: int) -> int     # exact Decimal; raises MageError('units') if inexact
def dbu_to_um(value: int, dbu_per_um: int) -> str          # decimal string, no trailing zeros

# pla.py
class PlaDocument(TypedDict-like dict): units: 'um'|'dbu'; dbuPerUm: int
    fixed: list[{id, base, boxDbu, idTriple:[int,int,int]}]
    groups: list[{groupItem, pinstGroup, targetPointDbu:[x,y], vertSL: bool}]
    fits: list[{id, base, boxDbu, extraRot, postfix, inGroup}]
    drops: list[{id, base, boxDbu, extraRot, placedFlag:int, postfix, inGroup}]
def read_pla(text: str, dbu_per_um: int) -> dict
def write_pla(doc: dict, dbu_per_um: int, units: str = 'um') -> str     # complete replayable PLA (fixinsts,
      # pinstGroupProperty, fitinsts, dropFitInsts, with the vendor foreach blocks); round-trips through read_pla

# rules.py
def read_rule_facts(rule_text: str, dbu_per_um: int) -> dict[str, dict]   # per item, shape as ruleFacts above
def frame_from_rule(rule_text: str, pblock_text: str, dbu_per_um: int) -> dict  # the snapshot 'frame'

# targets.py
def read_targets(csv_text: str, frame: dict, dbu_per_um: int, tolerance_um='2') -> list[dict]   # rows with ctDbu, partition
def read_request_order(tcl_text: str) -> list[[x_um_str, y_um_str]]
def bind_targets(targets, groups, fits) -> list[dict]     # fills pinstGroup/fitId by exact targetPointDbu match;
      # raises MageError('identity') when a target binds to 0 or >1 groups, or a group has != 1 fit

# lanes.py
def lane_model(frame) -> list[dict]
def assign_lane(frame, box) -> dict|None            # {'axis','track'} or None when the box is not inside one scribe band
def physical_lane(frame, axis, track) -> str        # exterior opposite lanes fold to track 0
def project(frame, boxes: list[[id, box]], lane_id, along=None, cross=None) -> dict  # occupants, freeIntervals (periodic images)

# snapshot.py
def build_snapshot(stage, pla_doc, frame, rule_facts, targets, block_types: dict[str,str], inputs: dict, pending_from_rules=True) -> dict
def load_snapshot(path) -> dict                     # verifies snapshotSha256
def snapshot_sha(body: dict) -> str

# planner.py
class LaneItem: id: str; length: int; gap_after: int; window: (lo, hi); current: int; movable: bool; cluster: str|None
class SlotRequest: count: int; length: int; clearance: int
def max_slots(items: list[LaneItem], slot: SlotRequest, cyclic_period: int|None = None) -> {'slots': int, 'feasible': bool, 'ends': list}
def fewest_moves(items, slot, cyclic_period=None) -> {'feasible': bool, 'moved': list[str], 'positions': dict[id,int], 'slotStarts': list[int]}
def least_displacement(items, slot_starts: list[int], slot, cyclic_period=None) -> {'feasible': bool, 'positions': dict[id,int], 'totalDisplacement': int}
def plan_lane(items, slot, relaxations: dict = None) -> dict   # runs (a)(b)(c) and returns one 'mage.slot-plan/1' body
def brute_force_max_slots(items, slot) -> int   # test oracle, exponential, small inputs only

# metrics.py
def drops(snapshot) -> {'count': int, 'lengthUm': str, 'byBlockType': {...}, 'ids': [...]}
def target_distances(snapshot, limit_um: str) -> {'overLimitCount': int, 'maxUm': str, 'perTarget': [{row, fitId, alongUm, crossUm}]}
def order_deviation(snapshot) -> {'max': int, 'byPartition': {'TB': int, 'LR': int, 'IN': int}, 'missing': [...]}
def displacement(start_snapshot, snapshot) -> {'movedCount': int, 'totalUm': str, 'perFit': [...]}
def native_rows(verify_files: dict[str, str]) -> {'byType': {TYPE: int|None}, 'total': int|None, 'unknown': [...]}
      # TYPE in OVERLAP SPACE BOUNDARY CROSS OFFGRID DIECORNER PEPPER PADS LOCATION AUTOREFINE; row = non-empty,
      # non-comment line after the header line that starts with '#'; missing file -> None

# consumers.py
def load_consumer_model(models_dir, consumer_id) -> dict           # JSON twin; validates mage.consumer-model/1
def evaluate(consumer_model, context, candidate_snapshot, start_snapshot, verify_files, out_dir) -> {'findings': [...], 'receiptPath': str, 'receiptSha256': str}
      # one Finding per requirement x affected scope; status pass|fail|unknown; numbers dict; unknown lists missing parameters

# records.py
def validate_record(kind, doc) -> list[str]        # finding|request|ledger-entry|decision-request|placement-candidate|consumer-review|round-decision|placement-result
def open_requests(reviews: list[dict]) -> list[dict]
def ledger_covers(open_requests, ledger_entries) -> {'answered': [...], 'unanswered': [...]}

# rounds.py
def best_state_key(candidate_metrics: dict, start_native_total: int|None) -> tuple
def decide(workspace, round_no, goal, reviews: list[dict], candidate: dict, previous_decision: dict) -> dict   # mage.round-decision/1 body
def conflicts(requests: list[dict]) -> list[dict]  # overlapping targets with incompatible kinds (move/keep, place/keep)

# native/session.py
class MageSession:
    def __init__(self, executable: str, env: dict, workdir: str, log_path: str, templates_dir: str, case: dict): ...
    def run_round(self, round_dir: str, candidate_pla: str, role: str, timeout_s: int = 1800) -> dict
        # writes round_dir/round.tcl from templates; role != 'engineer' with a mutating script -> MageError('writer');
        # runs [executable, round.tcl, '-noterm']; returns {'exportPla','verifyFiles':{TYPE:path},'summary','stdout','returncode','scriptSha256'}
        # appends JSONL {round_dir, role, scriptSha256, mutating, returncode, startedAt, endedAt} to log_path
def mutating(script_text: str) -> bool   # True if it contains 'source ', '-addInstFit', '-addInstFix', '-addGroup', 'frbMove', 'frbOps', 'frbAlign', 'frbGuidedMove', '-placeDropInstFit', '-refine', '-autoRefine'
```

### CLI subcommands (`flow/mage_placement_cli.py`)

| subcommand | argv | purpose |
|---|---|---|
| `task-prepare-case` | `WORKSPACE TASK_INPUT TASK_OUTPUT` | program task |
| `task-measure-incumbent` | same | program task |
| `task-decide-round` | same | program task |
| `task-evaluate-placement` | same | program task |
| `task-deliver` | same | program task |
| `placement-candidate` | `WORKSPACE TARGET_DROPPED MAX_TARGET_DISTANCE_UM MAX_ORDER_DEVIATION` | batch fallback: validate existing `state/round/placement-candidate.json`, never fabricate |
| `consumer-review` | `WORKSPACE ROLE` | batch fallback: validate existing `state/round/review-<role>.json` |
| `snapshot` | `WORKSPACE --pla <file> --stage candidate --out <file>` | resident tool |
| `lane-view` | `WORKSPACE --snapshot <file> --lane H:0 [--along a,b] [--cross c,d]` | resident tool |
| `plan-slots` | `WORKSPACE --snapshot <file> --lane V:1 --length-um 5188 --count 1 --limit-um 100 [--relaxed] --out <file>` | resident tool |
| `evaluate` | `WORKSPACE --consumer wat --candidate <snapshot> --out-dir <dir>` | resident tool (consumers and Engineer) |
| `mage-round` | `WORKSPACE --round NN --pla <file> --role engineer --out-dir <dir>` | resident tool: one MAGE round via `MageSession` using `siteCapabilities.mage` |
| `candidate` | `WORKSPACE --round NN --round-dir <dir> --ledger <file> --out <file>` | assemble + validate `mage.placement-candidate/1` |
| `review` | `WORKSPACE --consumer wat --round NN --findings <file> --requests <file> --out <file>` | assemble + validate `mage.consumer-review/1` |
| `flow-digest` | `[flow-dir]` | admin diagnostic (as ATCS) |

Every subcommand writes `{"error": {"code", "detail"}}` to stdout and exits 2/3 on `MageError`, exactly like `atcs_cli.py:_fail`.

### Record documents (all stamped with `core.stamp`)

- `mage.finding/1`: `id, round, snapshotSha256, consumer, consumerModel, evaluatorReceipt, targets[], predicate, status(pass|fail|unknown), severity(hard|cost|info), numbers{}, explanation`.
- `mage.request/1`: `id, fromFinding, consumer, snapshotSha256, requestedOutcome{kind(move|keep|place|restore_order|other), targets[], limitsUm{}, text}, acceptableAlternatives[], strength(hard|preference)`.
- `mage.ledger-entry/1`: `request, answer(satisfied|alternative|declined), answeredInSnapshot, evidence[], note`.
- `mage.decision-request/1`: `id, round, question, options[{id, description, perConsumer{}, nativeChecked, snapshotSha256}], blockingRequests[]`.
- `mage.placement-candidate/1`: `identity{taskId, runId, executionId, nodeId, round}, startSnapshotSha256, snapshotSha256, buildBanner, files{pla, snapshot, export, verify{TYPE}, sessionLog, scripts[]} each {path, sha256}, metrics{drops, targetDistances, orderDeviation, displacement, nativeRows}, ledger[], remaining[], blocked[], unknown[], outcome(completed|best-effort|blocked), stopReason, reproduction`.
- `mage.consumer-review/1`: `identity{taskId, runId, executionId, nodeId, round}, consumer, consumerModel, snapshotSha256, findings[], requests[], receipt{path, sha256}, summary`.
- `mage.round-decision/1`: `round, route(continue|stop), nextRound{round}, best{snapshotSha256, candidatePath, metrics, round}, openRequests[], decisionRequests[], history[{round, key, improved}], stopReason`.
- `mage.placement-result/1`: `best{...}, rounds[{round, candidate{path,sha256}, reviews{role:{path,sha256}}}], consumerModels[], consumerContextSha256, decisionRequests[], metrics, incumbent{...}, outcome, stopReason`.

---

### Task 1: Pack skeleton, `core.py`, `pla.py`, synthetic fixture generator

**Files:**
- Create: `packs/mage-scribe-placement/flow/mage_placement/__init__.py` (empty), `core.py`, `pla.py`
- Create: `packs/mage-scribe-placement/flow/tests/__init__.py` (empty), `fixtures.py`, `test_core.py`, `test_pla.py`
- Create: `packs/mage-scribe-placement/.gitignore` with `__pycache__/` and `.pytest_cache/`

**Interfaces:** Produces `core.*`, `pla.read_pla`, `pla.write_pla`, `fixtures.make_case(root) -> dict` (see Frozen interfaces). Consumed by every later task.

- [ ] **Step 1: Port `core.py` from ATCS**

Copy `packs/agentic-timing-closure-system/flow/atcs/core.py` lines 1–200 (`AtcsError`, `canonical`, `digest`, `file_sha256`, `tree_digest`, `stamp`, `write_artifact`, `read_artifact`, `known`, `unknown`, `is_known`, `value_of`) into `core.py`, renaming `AtcsError` → `MageError` and the schema prefix `atcs.` → `mage.`. Add:

```python
from decimal import Decimal, InvalidOperation

def um_to_dbu(value, dbu_per_um):
    try:
        ticks = Decimal(str(value)) * dbu_per_um
    except InvalidOperation as exc:
        raise MageError("units", f"not a decimal micrometre quantity: {value!r}") from exc
    if not ticks.is_finite() or ticks != ticks.to_integral_value():
        raise MageError("units", f"{value!r} um is not exactly representable at {dbu_per_um} DBU/um")
    return int(ticks)

def dbu_to_um(value, dbu_per_um):
    text = format(Decimal(value) / dbu_per_um, "f")
    return text.rstrip("0").rstrip(".") if "." in text else text

def validate(instance, schema, where="", root=None):
    """Small JSON-Schema subset (type, required, properties, additionalProperties, enum, const, items,
    minItems, maxItems, minLength, pattern, minimum, maximum, $ref '#/$defs/<name>'). Returns error strings."""
    root = schema if root is None else root
    errors = []
    if "$ref" in schema:
        target = root
        for part in schema["$ref"].lstrip("#/").split("/"):
            target = target[part]
        return validate(instance, target, where, root)
    kind = schema.get("type")
    kinds = kind if isinstance(kind, list) else ([kind] if kind else [])
    checks = {"object": lambda v: isinstance(v, dict), "array": lambda v: isinstance(v, list),
              "string": lambda v: isinstance(v, str), "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
              "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
              "boolean": lambda v: isinstance(v, bool), "null": lambda v: v is None}
    if kinds and not any(checks[k](instance) for k in kinds):
        return [f"{where or '$'}: expected {kind}, got {type(instance).__name__}"]
    if "enum" in schema and instance not in schema["enum"]: errors.append(f"{where or '$'}: not one of {schema['enum']}")
    if "const" in schema and instance != schema["const"]: errors.append(f"{where or '$'}: must equal {schema['const']!r}")
    if isinstance(instance, str):
        if "minLength" in schema and len(instance) < schema["minLength"]: errors.append(f"{where}: shorter than {schema['minLength']}")
        if "pattern" in schema and not re.search(schema["pattern"], instance): errors.append(f"{where}: does not match {schema['pattern']}")
    if isinstance(instance, (int, float)) and not isinstance(instance, bool):
        if "minimum" in schema and instance < schema["minimum"]: errors.append(f"{where}: below {schema['minimum']}")
        if "maximum" in schema and instance > schema["maximum"]: errors.append(f"{where}: above {schema['maximum']}")
    if isinstance(instance, dict):
        for key in schema.get("required", []):
            if key not in instance: errors.append(f"{where or '$'}: missing required {key}")
        props = schema.get("properties", {})
        for key, value in instance.items():
            if key in props: errors.extend(validate(value, props[key], f"{where}/{key}", root))
            elif schema.get("additionalProperties") is False: errors.append(f"{where or '$'}: unexpected key {key}")
    if isinstance(instance, list):
        if "minItems" in schema and len(instance) < schema["minItems"]: errors.append(f"{where}: fewer than {schema['minItems']} items")
        if "maxItems" in schema and len(instance) > schema["maxItems"]: errors.append(f"{where}: more than {schema['maxItems']} items")
        if "items" in schema:
            for index, item in enumerate(instance): errors.extend(validate(item, schema["items"], f"{where}[{index}]", root))
    return errors
```

- [ ] **Step 2: Write `test_core.py`**

```python
import sys, unittest, tempfile
from pathlib import Path
sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core

class CoreTest(unittest.TestCase):
    def test_stamp_and_read_round_trip_and_tamper_refusal(self):
        with tempfile.TemporaryDirectory() as d:
            doc = core.stamp('finding', {'x': 1}); p = Path(d) / 'f.json'
            core.write_artifact(p, doc)
            self.assertEqual(core.read_artifact(p, 'finding')['x'], 1)
            p.write_text(p.read_text().replace('"x": 1', '"x": 2'))
            with self.assertRaises(core.MageError) as caught: core.read_artifact(p, 'finding')
            self.assertEqual(caught.exception.code, 'identity-mismatch')
    def test_units_exact_only(self):
        self.assertEqual(core.um_to_dbu('5188', 10000), 51880000)
        self.assertEqual(core.um_to_dbu('30770.55', 10000), 307705500)
        self.assertEqual(core.dbu_to_um(307705500, 10000), '30770.55')
        with self.assertRaises(core.MageError): core.um_to_dbu('0.00001', 10000)
    def test_validate_subset(self):
        schema = {'type': 'object', 'required': ['a'], 'additionalProperties': False,
                  'properties': {'a': {'type': 'string', 'enum': ['x']}, 'b': {'$ref': '#/$defs/n'}},
                  '$defs': {'n': {'type': 'integer', 'minimum': 0}}}
        self.assertEqual(core.validate({'a': 'x', 'b': 2}, schema), [])
        self.assertEqual(len(core.validate({'a': 'y', 'b': -1, 'c': 0}, schema)), 3)
if __name__ == '__main__': unittest.main()
```

- [ ] **Step 3: Run `test_core.py`, expect FAIL (module missing), then make it pass**

Run: `cd packs/mage-scribe-placement/flow && /usr/bin/python3 -m unittest tests.test_core -v`

- [ ] **Step 4: Write `fixtures.py` (synthetic case generator)**

The synthetic frame: `dbuPerUm 10000`, 2 cols × 2 rows, die 1000 × 800 µm, scribe 60 µm → frame 2180 × 1780 µm (`width = scribe + cols·(die + scribe)`). Write under `root/case/`:

- `rule.tcl` containing, in the vendor command shapes seen in P23 (`smShot shot -setArea {0 0 2180 1780}`, `smShot shot -setExtScribe -min {60 60 60 60} -olap {-1 -1}`, `smFlow -addItem <name> -parent frame -itemType SLFIT|SLFIX|GROUP`, `smSLFit <name> -setBlock <name> -entityType Block -bindBlkType <type>`, `-setProp -merge 1 -turnable 0 -pri N -pri2 -1`, `-setScribe -inc HORIZ -exc NONE`, `-setFixed -xFix CENTER -yFix CENTER -alignForce 1`, `-setZone -by PCT -xPos CENTER -xPct 50 -xTgt BOUND \` continuation line, `-setGrid -gridX 0.010000 -gridY 0.010000 ...`, `-setSpace -xSpcType BOUND -xSpc 0.000000 \` + ` -ySpcType BOUND -ySpc 0.000000 -spcWithRot 0`, `-setNum 0 -setNumMin 1 -setNumMax 1`), these items: fixed `F_LC_BL` (SLFIX, 16.9 × 16.9 at the frame corner), priority OVL marks `OVL_A`, `OVL_B` (135 × 56, HORIZ, in GROUP `G1`), priority alignment `AL_X` (180 × 50, VERT, in GROUP `G2`, `bindBlkType ASML_AL`), a filler OVL `OVL_F` (100 × 56, HORIZ, `setNumMin 2`), and a long WAT key `KEY_V` (`bindBlkType TSK/MPAD`, 900 × 60, `-inc VERT`, `turnable 0`, `setNumMin 1`).
- `pblock.tcl`: `smBlockMgr -def mainchip -blkType N/A -bbox (0,0,1000,800) -noCheck 1 -gds ./out.gds -cell mainchip`.
- `block.tcl`: one `smBlockMgr -def <name> -blkType <type> -bbox (0,0,w,h) …` per item.
- `targets.csv` (BOM-prefixed header as the customer file: `﻿Group Name,Part/Cluster Name,Target,Part/Cluster Length(um),LOC X,LOC Y`) with 3 rows: `G1,OVL_A,T1,135,-900,-860`, `G1,OVL_B,T2,135,200,-860`, `G2,AL_X,T3,180,-1090,-200` (frame-centre offset = (1090, 890) µm, so CT points are (190, 30), (1290, 30), (0, 690)).
- `request.t`: three `smPFlow -placeGroup -groupItem G -groupTargetPoint (x,y) -groupPlaceType CT` lines in CSV order.
- `start.pla` (µm): `fixinsts` for `F_LC_BL`, `pinstGroupProperty` for G1_1 (190, 30, vertSL 0), G1_2 (1290, 30, 0), G2_1 (0, 690, 1), `fitinsts` for the three priority fits centred on their CT points except `OVL_B`, which is placed 150 µm right of its target (the Case-A style deviation).
- `incumbent.pla` (µm): the same plus two placed `OVL_F` filler fits in lane H:0 and a `dropFitInsts` block containing `KEY_V.KEY_V 0 0 900 60 NULL 0 "" KEY_V.KEY_V ""`.
- `manifest.json`: the `mage.case-manifest/1` document with sha256 of each file, `frameSizeUm: ["2180","1780"]`, `dbuPerUm: 10000`, `partitionRule: {toleranceUm: "2"}`, `groupPlaceCommandForm: "smPFlow -placeGroup -groupItem {g} -groupTargetPoint ({x},{y}) -groupPlaceType CT"`, `mage: {executable: "<set by caller>", setupScript: "", buildBanner: "synthetic"}`.
- `consumer-context.json`: `mage.consumer-context/1` with `stage: npi`, `limitHardness: preference`, `wat: {pad_pitch_um: {value: "100", source: "assumption", confirmedBy: "fixture", confirmedAt: "2026-10-12"}}`, and **no** `metrology.search_window_um` (so that predicate yields `unknown`).

`make_case(root, mage_executable='')` returns `{'root', 'manifest', 'consumerContext', 'files': {...paths}}`. Add `make_site_capabilities(root, mage_executable)` writing `site-capabilities.json` `{"schema":"mage.site-capabilities/1","mage":{"executable":..., "setupScript":"", "env":{}}}`.

- [ ] **Step 5: Write `test_pla.py`**

```python
class PlaTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.case = fixtures.make_case(self.tmp.name)
    def test_reads_um_pla_with_fixed_groups_fits(self):
        doc = pla.read_pla(Path(self.case['files']['startState']).read_text(), 10000)
        self.assertEqual(doc['units'], 'um'); self.assertEqual(len(doc['fixed']), 1); self.assertEqual(len(doc['groups']), 3)
        fit = next(f for f in doc['fits'] if f['base'] == 'OVL_B')
        self.assertEqual(fit['inGroup'], 'G1_2'); self.assertEqual(fit['boxDbu'][2] - fit['boxDbu'][0], 1350000)
    def test_reads_drops_and_placed_flag(self):
        doc = pla.read_pla(Path(self.case['files']['incumbentState']).read_text(), 10000)
        self.assertEqual([d['base'] for d in doc['drops']], ['KEY_V']); self.assertEqual(doc['drops'][0]['placedFlag'], 0)
    def test_dbu_header_switches_units(self):
        text = Path(self.case['files']['startState']).read_text()
        dbu = pla.write_pla(pla.read_pla(text, 10000), 10000, units='dbu')
        self.assertIn('smPInstMgr -savePlaDBU 10000', dbu)
        self.assertEqual(pla.read_pla(dbu, 10000)['fits'], pla.read_pla(text, 10000)['fits'])
    def test_write_round_trips_including_drops(self):
        text = Path(self.case['files']['incumbentState']).read_text(); doc = pla.read_pla(text, 10000)
        again = pla.read_pla(pla.write_pla(doc, 10000), 10000)
        self.assertEqual(again['fits'], doc['fits']); self.assertEqual(again['drops'], doc['drops']); self.assertEqual(again['groups'], doc['groups'])
    def test_duplicate_fit_id_refused(self):
        text = Path(self.case['files']['startState']).read_text()
        line = [l for l in text.splitlines() if 'OVL_A.OVL_A_1' in l][0]
        with self.assertRaises(core.MageError): pla.read_pla(text.replace(line, line + '\n' + line), 10000)
```

Parsing rules for `pla.read_pla`: tables are `set <name> {` … `}` blocks (`fixinsts` 8 fields, `pinstGroupProperty` 5 fields, `fitinsts` 9 fields, `dropFitInsts` 10 fields), tokenised with `shlex.split` so `""` postfix and `"G6_1"` groups parse; a `smPInstMgr -savePlaDBU <n>` line anywhere means DBU integers (require `n == dbu_per_um`), otherwise decimals are µm converted with `core.um_to_dbu`. `write_pla` emits the four tables and the vendor `foreach … smPInstMgr -addInstFix/-addGroup/-addInstFit/-addDropInstFit … -plaCheckSize` blocks exactly as in the P23 `pre_place_all.pla` tail (copy the command forms from spec §7 and the Frozen interfaces).

- [ ] **Step 6: Run, fix, run again until green; commit**

```bash
cd packs/mage-scribe-placement/flow && /usr/bin/python3 -m unittest discover -s tests -v
git add packs/mage-scribe-placement && git -c user.name=lluzi -c user.email=lluzi@Luzis-MacBook-Air.local commit -m "feat(mage): Pack core, PLA reader/writer and synthetic fixture

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" && git push origin feat/mage-scribe-placement
```

---

### Task 2: Rule facts, targets, lane model, snapshot

**Files:**
- Create: `flow/mage_placement/rules.py`, `targets.py`, `lanes.py`, `snapshot.py`, `flow/schemas/snapshot.json`, `flow/schemas/case-manifest.json`, `flow/schemas/consumer-context.json`
- Test: `flow/tests/test_rules.py`, `test_targets.py`, `test_lanes.py`, `test_snapshot.py`

**Interfaces:** Consumes Task 1. Produces the snapshot document and the module signatures in Frozen interfaces.

- [ ] **Step 1: `test_rules.py`**

```python
def test_rule_facts_for_long_key(self):
    facts = rules.read_rule_facts(Path(self.case['files']['rule']).read_text(), 10000)
    key = facts['KEY_V']
    self.assertEqual(key['itemType'], 'SLFIT'); self.assertEqual(key['blockType'], 'TSK/MPAD')
    self.assertEqual(key['scribeInc'], ['VERT']); self.assertFalse(key['turnable']); self.assertEqual(key['setNum'], [0, 1, 1])
    self.assertEqual(key['gridDbu'], [100, 100]); self.assertEqual(key['spaceDbu'], {'x': 0, 'y': 0})
    self.assertFalse(key['qualified']['zone']); self.assertTrue(key['zoneRaw'].startswith('-by PCT'))
def test_frame_from_rule(self):
    frame = rules.frame_from_rule(rule_text, pblock_text, 10000)
    self.assertEqual(frame, {'widthDbu': 21800000, 'heightDbu': 17800000, 'scribeDbu': 600000, 'cols': 2, 'rows': 2, 'dieWidthDbu': 10000000, 'dieHeightDbu': 8000000})
def test_continuation_lines_are_joined(self): ...  # a `\` continuation inside -setZone is one command
```

Implementation notes: join `\`-continued lines first; iterate commands; `smFlow -addItem <name> -parent <p> -itemType <T>` opens the item; `smSLFit|smSLFix <name> -<option> …` fills it; `-setCluster <c> -entityType Cluster -bindBlkType <t>` records cluster + block type; `-setBlock <b> -entityType Block -bindBlkType <t>`; `qualified` = `{'space': True, 'zone': False, 'padCross': False}` (zone and pad-cross semantics are **D**). `frame_from_rule`: `-setArea {0 0 W H}`, `-setExtScribe -min {s s s s}` (require uniform), die from pblock `-bbox (0,0,w,h)`; `cols = (W − s) / (w + s)` must divide exactly, else `MageError('frame')`.

- [ ] **Step 2: `test_targets.py`**

```python
def test_ct_conversion_and_partition(self):
    rows = targets.read_targets(csv_text, frame, 10000)
    self.assertEqual(rows[0]['ctDbu'], [1900000, 300000]); self.assertEqual([r['partition'] for r in rows], ['TB', 'TB', 'LR'])
def test_bind_by_exact_target_point(self):
    bound = targets.bind_targets(rows, doc['groups'], doc['fits'])
    self.assertEqual(bound[1]['pinstGroup'], 'G1_2'); self.assertEqual(bound[1]['fitId'], 'OVL_B.OVL_B_1')
def test_ambiguous_binding_refused(self): ...  # duplicate a group record -> MageError('identity')
def test_request_order_matches_csv_order(self):
    self.assertEqual(targets.read_request_order(request_text), [['190.0', '30.0'], ['1290.0', '30.0'], ['0.0', '690.0']])
```

CT: `ctDbu = um_to_dbu(LOC + frame/2)`. Partition: the customer's `split_csv` order (TB first by Y extremes within tolerance, then LR by X extremes, rest IN). Read the CSV with `utf-8-sig`.

- [ ] **Step 3: `test_lanes.py`**

```python
def test_lane_model_counts_and_shared_exterior(self):
    lanes_ = lanes.lane_model(frame)
    self.assertEqual(len(lanes_), 6)   # H:0..2, V:0..2
    self.assertEqual(lanes.physical_lane(frame, 'H', 2), 'H:0')
def test_assign_lane(self):
    self.assertEqual(lanes.assign_lane(frame, [1000000, 20000, 2350000, 580000]), {'axis': 'H', 'track': 0})
    self.assertIsNone(lanes.assign_lane(frame, [1000000, 20000, 2350000, 900000]))  # leaves the band
def test_projection_free_intervals_with_periodic_images(self):
    view = lanes.project(frame, [['a', [600000, 0, 1950000, 560000]]], 'H:2')   # image of an H:0 occupant shows in H:2
    self.assertEqual(view['occupants'][0]['sourceImage'], [0, 1])
```

Port the projection logic from `mage_assist/exchange.py:lane_view` (interval merge, ±1 period images, cross-band filter) with attribution in the module docstring.

- [ ] **Step 4: `test_snapshot.py`**

```python
def test_start_snapshot_has_priority_fits_and_pending_from_rules(self):
    snap = build_start(self.case)   # helper in the test using pla/rules/targets/snapshot
    self.assertEqual(sorted(f['base'] for f in snap['fits'] if f['priority']), ['AL_X', 'OVL_A', 'OVL_B'])
    self.assertEqual(sorted(p['base'] for p in snap['pending']), ['KEY_V', 'OVL_F', 'OVL_F'])   # setNumMin 2 for OVL_F
def test_incumbent_snapshot_pending_from_drops(self):
    self.assertEqual([p['base'] for p in snap['pending']], ['KEY_V'])
def test_sha_binds_body(self):
    snap['fits'][0]['boxDbu'][0] += 100
    with self.assertRaises(core.MageError): snapshot.load_snapshot(write(snap))
def test_schema_validates(self):
    self.assertEqual(core.validate(snap, json.load(open(SCHEMAS / 'snapshot.json'))), [])
```

`build_snapshot(..., pending_from_rules=True)`: pending = drops from the PLA plus, when `pending_from_rules`, each SLFIT item's `setNumMin − placed count` copies (ids `<base>.<base>#pending-k`, size from `block.tcl`). Lane assignment per fit via `lanes.assign_lane`; a fit with `None` lane gets `lane: null` and a `warnings` entry.

- [ ] **Step 5: Write the three schemas, run all tests green, commit**

```bash
git add -A packs/mage-scribe-placement && git -c user.name=lluzi -c user.email=lluzi@Luzis-MacBook-Air.local commit -m "feat(mage): rule facts, CT targets, lane model and layout snapshot v2

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" && git push origin feat/mage-scribe-placement
```

---

### Task 3: Exact slot planner (Opus 4.8)

**Files:**
- Create: `flow/mage_placement/planner.py`, `flow/schemas/slot-plan.json`
- Test: `flow/tests/test_planner.py`

**Interfaces:** Consumes nothing beyond `core`. Produces `LaneItem`, `SlotRequest`, `max_slots`, `fewest_moves`, `least_displacement`, `plan_lane`, `brute_force_max_slots` (Frozen interfaces). `plan_lane` output `mage.slot-plan/1`: `{lane, slot, model: {relaxations: [...], gapsQualified: bool}, maxSlots, feasible, moves: [{id, fromDbu, toDbu}], slotStarts: [...], totalDisplacementDbu, movedCount, infeasibleReason}`.

- [ ] **Step 1: Write the oracle and property tests first**

```python
import random
def random_lane(rng, n_items, span=400):
    items, cursor = [], 0
    for i in range(n_items):
        length = rng.randint(5, 40); cursor += rng.randint(0, 30); current = cursor; cursor += length
        limit = rng.choice([0, 5, 20, 60]); movable = rng.random() > 0.2
        lo, hi = (current, current) if not movable else (max(0, current - limit), min(span - length, current + limit))
        items.append(planner.LaneItem(id=f'i{i}', length=length, gap_after=rng.randint(0, 4), window=(lo, hi), current=current, movable=movable, cluster=None))
    return items

class PlannerPropertyTest(unittest.TestCase):
    def test_max_slots_matches_brute_force(self):
        rng = random.Random(7)
        for _ in range(300):
            items = random_lane(rng, rng.randint(1, 6)); slot = planner.SlotRequest(count=rng.randint(1, 3), length=rng.randint(10, 60), clearance=rng.randint(0, 3))
            self.assertEqual(planner.max_slots(items, slot)['slots'], planner.brute_force_max_slots(items, slot), (items, slot))
    def test_fewest_moves_is_feasible_and_minimal(self):
        # every reported position is inside its window, order and gaps hold, slots fit, and no plan with fewer moves exists (brute force over move subsets for n<=5)
        ...
    def test_least_displacement_keeps_positions_in_windows_and_is_minimal_on_grid(self):
        # compare with exhaustive enumeration of positions for n<=3, windows<=8 wide
        ...
    def test_cyclic_lane_wrap_gap(self):
        # period 100, items near both ends: a slot that would only fit across the wrap must not be counted
        ...
    def test_rigid_cluster_moves_as_one(self): ...
    def test_relaxed_bound_is_never_smaller_than_strict(self): ...
```

`brute_force_max_slots`: enumerate every item position in its window (grid step 1 in tests) and every slot count ≤ `count`, check the chain; exponential but fine for n ≤ 6 and windows ≤ 60.

- [ ] **Step 2: Implement (a) max slots**

```python
def max_slots(items, slot, cyclic_period=None):
    L = slot.length + 2 * slot.clearance
    best = {0: -10**18}          # m -> minimal end E
    for i, it in enumerate(items):
        lo, hi = it.window if it.movable else (it.current, it.current)
        gap_before = items[i - 1].gap_after if i else 0
        nxt = {}
        for m, E in best.items():
            for j in range(0, slot.count - m + 1):
                p = max(lo, E + gap_before + j * L) if i else max(lo, j * L)
                if p <= hi:
                    end = p + it.length
                    if nxt.get(m + j, 10**18) > end: nxt[m + j] = end
        best = nxt
        if not best: return {'slots': 0, 'feasible': False, 'ends': {}}
    span_end = max(it.window[1] + it.length for it in items)   # lane end supplied by caller via a trailing immovable sentinel
    result = max(min(slot.count, m + (max(0, (span_end - E - items[-1].gap_after)) // L)) for m, E in best.items())
    return {'slots': result, 'feasible': True, 'ends': best}
```

Callers add two immovable sentinel items of length 0 at the lane start and end (the planner treats the lane range as items), so trailing slots are counted uniformly. For `cyclic_period`, cut the cycle at the first immovable item (or the item with the smallest window), rotate the list so it is first, and add the wrap gap as `gap_after` of the last item against the first item's position.

- [ ] **Step 3: Implement (b) fewest moves and (c) least displacement**

(b): state `(m, moved) → min E`; transitions: *stay* if `it.current ≥ E + gap + j·L` and `it.current` inside the window; *move* to `max(lo, E + gap + j·L)` if `≤ hi`. Keep back-pointers; recover positions and slot starts (slot starts are `E + gap + k·L + clearance` for k in the chosen j).

(c): given fixed order and chosen slot starts (as immovable zero-length items inserted into the sequence), DP over grid positions in each movable item's window: `cost_i(p) = |p − current_i| + min_{q ≤ p − sep_{i−1}} cost_{i−1}(q)` with a running prefix-min; immovable items have one position. Grid step is 1 planner unit (callers convert DBU → grid units by dividing by the grid, asserting exact division).

- [ ] **Step 4: `plan_lane` and relaxations**

`relaxations` keys: `ignoreGaps` (all gaps 0), `removeNonPriority` (drop items with `cluster is None and not priority` — add a `priority: bool` attribute to `LaneItem`), `splitClusters` (treat cluster members individually), `intrudersMovable` (items flagged `intruder: bool` get the standard window instead of a point window). The returned plan records which were applied; strict and relaxed results are reported together by the CLI.

- [ ] **Step 5: Run green, commit**

```bash
git add -A packs/mage-scribe-placement && git -c user.name=lluzi -c user.email=lluzi@Luzis-MacBook-Air.local commit -m "feat(mage): exact slot planner with brute-force oracle tests

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" && git push origin feat/mage-scribe-placement
```

---

### Task 4: Metrics

**Files:**
- Create: `flow/mage_placement/metrics.py`
- Test: `flow/tests/test_metrics.py`

**Interfaces:** Consumes snapshots (Task 2). Produces `drops`, `target_distances`, `order_deviation`, `displacement`, `native_rows` (Frozen interfaces).

- [ ] **Step 1: Tests with hand-computed values on the fixture**

```python
def test_drops_count_and_long_side_length(self):
    d = metrics.drops(incumbent_snapshot); self.assertEqual(d['count'], 1); self.assertEqual(d['lengthUm'], '900'); self.assertEqual(d['byBlockType'], {'TSK/MPAD': 1})
def test_target_distance_flags_ovl_b(self):
    t = metrics.target_distances(start_snapshot, '100'); self.assertEqual(t['overLimitCount'], 1); self.assertEqual(t['maxUm'], '150')
    self.assertEqual(next(p for p in t['perTarget'] if p['fitId'] == 'OVL_B.OVL_B_1')['alongUm'], '150')
def test_order_deviation_uses_customer_check_dev(self):
    # swap OVL_A and OVL_B along X -> TB list deviation 1
    self.assertEqual(metrics.order_deviation(swapped)['byPartition']['TB'], 1)
def test_displacement_separate_from_target_distance(self):
    self.assertEqual(metrics.displacement(start_snapshot, start_snapshot)['movedCount'], 0)
def test_native_rows_missing_file_is_unknown(self):
    r = metrics.native_rows({'OVERLAP': overlap_file_with_two_rows}); self.assertEqual(r['byType']['OVERLAP'], 2); self.assertIsNone(r['byType']['SPACE']); self.assertIsNone(r['total'])
```

`order_deviation` reproduces `run.tcl:check_dev`: for each partition, list1 = requested order of group items (by CSV row), list2 = placed order sorted by along-lane bbox centre (TB and IN by X, LR by Y); dev = max |i − j| with duplicate names matched by occurrence index; unmatched names go to `missing`.

- [ ] **Step 2: Implement, run green, commit** (`feat(mage): placement metrics`)

---

### Task 5: Consumer models, evaluator, records

**Files:**
- Create: `flow/mage_placement/consumers.py`, `records.py`, `flow/consumer_models/{litho-pie,metrology,alignment,wat,bonding}.{yml,json}`, `flow/schemas/{consumer-model,finding,request,ledger-entry,decision-request,consumer-review}.json`
- Test: `flow/tests/test_consumers.py`, `test_records.py`

**Interfaces:** Consumes snapshots, metrics, verify files. Produces `load_consumer_model`, `evaluate`, `validate_record`, `open_requests`, `ledger_covers`.

- [ ] **Step 1: Write the five consumer models (JSON is canonical; YAML mirrors it)**

Per spec §8 and the research summary (brief). Example `wat.json`:

```json
{"schema": "mage.consumer-model/1", "id": "wat", "version": "0.1.0",
 "scope": {"blockTypes": ["TSK/MPAD"]},
 "requirements": [
  {"id": "placed", "kind": "hard", "predicate": "placed", "parameters": {}, "source": {"type": "rule-file", "ref": "-setNumMin"}, "confidence": "high"},
  {"id": "rigid-unit", "kind": "hard", "predicate": "rigid_unit", "parameters": {}, "source": {"type": "public-research", "ref": "consumer-requirements-research#6"}, "confidence": "high"},
  {"id": "no-rotation", "kind": "hard", "predicate": "orientation_unchanged", "parameters": {}, "source": {"type": "public-research", "ref": "consumer-requirements-research#6"}, "confidence": "medium"},
  {"id": "move-cost", "kind": "cost", "predicate": "move_in_pitch_units", "parameters": {"pad_pitch_um": {"from": "consumerContext", "key": "wat.pad_pitch_um"}},
   "cost": "test-program coordinate update per moved key; wrong-pad risk at >= 0.5 pitch", "source": {"type": "assumption"}, "confidence": "low"}]}
```

`litho-pie`: `placed` (hard), `target_distance` (hard when `limitHardness == hard`, else cost; `limit_um` from goal via `caseReadiness`), `order_deviation` (cost, threshold from `partitionRule`). `metrology`: `region_coverage` (hard, parameter `regions` default = 3 × 3 grid of the frame, corners + centre ≥ 1 site each), `edit_on_move` (cost, `search_window_um` from context → unknown when absent), `pair_cohesion` (cost, cluster membership). `alignment`: `orientation_unchanged` (hard), `edit_on_move` (cost, `capture_range_um` from context), `canon_side_rule` is **not** implemented in 0.1.0 (listed as `unknown` with reason). `bonding`: `pair_cohesion` only, scope `Bonding`, `enabled: false`.

- [ ] **Step 2: Tests**

```python
def test_unknown_parameter_yields_unknown_not_zero(self):
    result = consumers.evaluate(load('metrology'), context_without_window, candidate, start, {}, out)
    edit = [f for f in result['findings'] if f['predicate'] == 'edit_on_move'][0]
    self.assertEqual(edit['status'], 'unknown'); self.assertIn('metrology.search_window_um', edit['numbers']['missing'])
def test_wat_dropped_key_is_hard_fail(self):
    result = consumers.evaluate(load('wat'), context, incumbent, start, {}, out)
    placed = [f for f in result['findings'] if f['predicate'] == 'placed'][0]
    self.assertEqual((placed['status'], placed['severity']), ('fail', 'hard')); self.assertEqual(placed['targets'], ['KEY_V.KEY_V'])
def test_receipt_sha_matches_file(self): ...
def test_yaml_and_json_models_agree(self): ...   # parse the .yml with a 40-line subset reader in the test, compare to .json
def test_records_validate_and_ledger_coverage(self):
    reqs = [valid_request('R-1'), valid_request('R-2')]
    self.assertEqual(records.ledger_covers(reqs, [ledger('R-1', 'satisfied')])['unanswered'], ['R-2'])
    self.assertTrue(records.validate_record('request', {**valid_request('R-3'), 'strength': 'maybe'}))
```

- [ ] **Step 3: Implement, run green, commit** (`feat(mage): consumer models, evaluator and record validation`)

---

### Task 6: Native MAGE driver, Tcl templates, stand-in interpreter

**Files:**
- Create: `flow/mage_placement/native/__init__.py`, `session.py`, `tcl.py`, `flow/templates/{open-build,replay-pla,verify-all,export}.tcl`, `flow/tests/standin_mage.py`
- Test: `flow/tests/test_native_session.py`

**Interfaces:** Consumes `pla`, `core`. Produces `MageSession.run_round`, `mutating`, and the stand-in `standin_mage.py <script.tcl> -noterm` executable used by Tasks 7, 10.

- [ ] **Step 1: Templates**

`open-build.tcl` (from the verified `p23_startup.tcl` sequence and `native.py:_PROBE`): `frbOpen {@FRB@}`, `frbSetCur frame`, `frbSetup -obj BuildFrame`, `smPFlow -setAutoRefine -arEnabled 0`, `smPFlow -bindBlocks`, `smPFlow -buildFrame frame -mchip mainchip -mblock mainchip`. `replay-pla.tcl`: `source {@PLA@}`. `verify-all.tcl`: for each TYPE `smVerify -checkType TYPE -doCheck -save {@OUT@/verify-TYPE.txt}` (**D**; the stand-in honours it). `export.tcl`: `smPInstMgr -saveMark {@OUT@/export.pla}`, `smPInstMgr -savePlaDBU {@OUT@/export-dbu.pla}` wrapped in `catch`, `smPFlow -saveSummary {@OUT@/summary.txt}`, `puts [list MAGE_ROUND_END code 0]`, `exit 0`. `tcl.py: quote(path)` produces a brace-quoted literal and refuses `{`, `}`, newlines and `[`/`$`.

- [ ] **Step 2: Stand-in `standin_mage.py`**

Reads the script, extracts `source {X}` → copies X to every `-saveMark {Y}` target (verbatim), writes `export-dbu.pla` via `pla.write_pla(units='dbu')`, writes one `verify-TYPE.txt` per `smVerify` with header `# TYPE rows` and rows taken from env `MAGE_STANDIN_ROWS` (JSON `{TYPE: ["row", ...]}`, default none), writes `summary.txt`, prints `MAGE_ROUND_END code 0`. With `MAGE_STANDIN_FAIL=1` exits 2 after printing `MAGE_ROUND_ERROR`.

- [ ] **Step 3: Tests**

```python
def test_round_with_standin_exports_and_logs(self):
    s = MageSession(executable=sys.executable + ' ' + STANDIN, ...)  # executable may be a list in the manifest: use ["python3", standin]
    r = s.run_round(round_dir, candidate_pla, role='engineer')
    self.assertEqual(r['returncode'], 0); self.assertTrue(Path(r['verifyFiles']['OVERLAP']).exists())
    log = [json.loads(l) for l in Path(log_path).read_text().splitlines()]; self.assertTrue(log[-1]['mutating']); self.assertEqual(log[-1]['role'], 'engineer')
def test_consumer_cannot_run_mutating_round(self):
    with self.assertRaises(core.MageError) as c: s.run_round(round_dir, candidate_pla, role='metrology')
    self.assertEqual(c.exception.code, 'writer')
def test_failed_round_is_recorded_not_hidden(self): ...  # MAGE_STANDIN_FAIL=1 -> returncode 2 in result and log
```

- [ ] **Step 4: Implement, run green, commit** (`feat(mage): one-writer MAGE round driver with stand-in interpreter`)

---

### Task 7: Pack declarations, CLI program tasks, round decisions, Readers, rules, semantics

**Files:**
- Create: `contract.yml`, `graph.yml`, `semantics.yml`, `schemas/tasks.json`, `readers/mage-placement-candidate.yml`, `readers/mage-consumer-review.yml`, `rules/*.yml` (seven), `tools/read-mage.py`, `flow/mage_placement_cli.py`, `flow/mage_placement/rounds.py`, `flow/schemas/{placement-candidate,round-decision,placement-result}.json`
- Test: `flow/tests/test_rounds.py`, `test_cli_tasks.py`, `test_readers.py`

**Interfaces:** Consumes everything above. Produces the Pack as loadable by `loadPack`, the CLI table, and the Reader emits:

- `mage-placement-candidate` emits: `mage_candidate_error_count`, `mage_priority_unplaced_count`, `mage_dropped_count`, `mage_dropped_length_um`, `mage_target_distance_max_um`, `mage_target_over_limit_count`, `mage_order_deviation_max`, `mage_native_overlap_rows`, `mage_native_space_rows`, `mage_native_boundary_rows`, `mage_native_cross_rows`, `mage_native_offgrid_rows`, `mage_native_diecorner_rows`, `mage_native_pepper_rows`, `mage_native_pads_rows`, `mage_native_location_rows`, `mage_native_autorefine_rows`, `mage_native_violation_total`, `mage_open_request_count`.
- `mage-consumer-review` emits: `mage_review_error_count`, `mage_review_hard_fail_count`, `mage_review_request_count`, `mage_review_unknown_count`.

- [ ] **Step 1: `graph.yml` (complete)**

```yaml
schema: hima-flow/1
id: mage-scribe-placement
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
      CONSUMER_CONTEXT: {source: runInput, path: [consumerContext]}
      SITE_CAPABILITIES: {source: runInput, path: [siteCapabilities]}
      TARGET_DROPPED: {source: goal, path: [target_dropped_count]}
      MAX_TARGET_DISTANCE_UM: {source: goal, path: [max_target_distance_um]}
      MAX_ORDER_DEVIATION: {source: goal, path: [max_order_deviation]}
    contract:
      input: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/prepare-case-input'}}
      output: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/prepare-case-output'}}
  - kind: task
    id: measure-incumbent
    tool: measure-incumbent
    inputs:
      CASE: {source: committedOutput, taskId: prepare-case, path: []}
      INCUMBENT_COMPARISON: {source: strategy, path: [incumbentComparison]}
    contract: {input: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/measure-incumbent-input'}}, output: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/measure-incumbent-output'}}}
  - kind: repeat
    id: placement-rounds
    maxIterations: 4
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
        id: engineer-place
        tool: engineer-place
        inputs:
          ROUND: {source: carry, path: [roundState, round]}
          SITE_CAPABILITIES: {source: committedOutput, taskId: prepare-case, path: [SITE_CAPABILITIES]}
          TARGET_DROPPED: {source: goal, path: [target_dropped_count]}
          MAX_TARGET_DISTANCE_UM: {source: goal, path: [max_target_distance_um]}
          MAX_ORDER_DEVIATION: {source: goal, path: [max_order_deviation]}
        contract: {input: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/engineer-place-input'}}, output: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/resident-output'}}}
      - kind: task
        id: review-litho-pie
        tool: review-litho-pie
        inputs: {ROUND: {source: carry, path: [roundState, round]}}
        contract: {input: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/review-input'}}, output: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/resident-output'}}}
      - kind: task
        id: review-metrology
        tool: review-metrology
        inputs: {ROUND: {source: carry, path: [roundState, round]}}
        contract: {input: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/review-input'}}, output: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/resident-output'}}}
      - kind: task
        id: review-alignment
        tool: review-alignment
        inputs: {ROUND: {source: carry, path: [roundState, round]}}
        contract: {input: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/review-input'}}, output: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/resident-output'}}}
      - kind: task
        id: review-wat
        tool: review-wat
        inputs: {ROUND: {source: carry, path: [roundState, round]}}
        contract: {input: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/review-input'}}, output: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/resident-output'}}}
      - kind: task
        id: decide-round
        tool: decide-round
        inputs:
          ROUND: {source: carry, path: [roundState, round]}
          CANDIDATE: {source: committedOutput, taskId: engineer-place, path: []}
          REVIEW_LITHO_PIE: {source: committedOutput, taskId: review-litho-pie, path: []}
          REVIEW_METROLOGY: {source: committedOutput, taskId: review-metrology, path: []}
          REVIEW_ALIGNMENT: {source: committedOutput, taskId: review-alignment, path: []}
          REVIEW_WAT: {source: committedOutput, taskId: review-wat, path: []}
          TARGET_DROPPED: {source: goal, path: [target_dropped_count]}
          MAX_TARGET_DISTANCE_UM: {source: goal, path: [max_target_distance_um]}
          MAX_ORDER_DEVIATION: {source: goal, path: [max_order_deviation]}
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
      MAX_ORDER_DEVIATION: {source: goal, path: [max_order_deviation]}
    contract: {input: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/evaluate-placement-input'}}, output: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/evaluate-placement-output'}}}
  - kind: task
    id: deliver
    budget: closing
    tool: deliver
    inputs:
      EVALUATION: {source: committedOutput, taskId: evaluate-placement, path: []}
    contract: {input: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/deliver-input'}}, output: {version: '1', schema: {$schema: 'https://json-schema.org/draft/2020-12/schema', $ref: 'schemas/tasks.json#/$defs/deliver-output'}}}
```

`decide-round-output` schema must declare `route: {type: string, enum: [continue, stop]}` and `nextRound: {type: object, properties: {round: {type: integer}}}`. `resident-output` mirrors ATCS `fix-timing-output` (`observations[1]` with `contentSha256` and `values[]`, plus `engineering{outcome, summary, stopReason}`). Reading a committed output that is outside the repeat (`prepare-case`) from inside the body is allowed (the compiler tracks availability through the sequence).

- [ ] **Step 2: `contract.yml`**

Follow spec §5.1 exactly. Program tools: `prepare-case`, `measure-incumbent`, `decide-round`, `evaluate-placement`, `deliver` with `inputs: [WORKSPACE, TASK_INPUT, TASK_OUTPUT]` and `argv: [python3, ${WORKSPACE}/flow/mage_placement_cli.py, task-<name>, ${WORKSPACE}, ${TASK_INPUT}, ${TASK_OUTPUT}]`. Resident tools (descriptions are the full role briefs; write them from spec §6–§7 and the role playbooks of Task 8, 150–400 words each):

```yaml
- id: engineer-place
  file: flow/mage_placement_cli.py
  description: >
    Own one round of the MAGE test-structure placement task ... (complete brief)
  inputs: [WORKSPACE, ROUND, SITE_CAPABILITIES, TARGET_DROPPED, MAX_TARGET_DISTANCE_UM, MAX_ORDER_DEVIATION]
  licences: {mage: 1}
  argv: [python3, '${WORKSPACE}/flow/mage_placement_cli.py', placement-candidate, '${WORKSPACE}', '${TARGET_DROPPED}', '${MAX_TARGET_DISTANCE_UM}', '${MAX_ORDER_DEVIATION}']
  outsourcing:
    role: resident-engineering-agent
    reads: [caseReadiness, startSnapshot, incumbentMeasure, roundDecision]
    knowledge: [placement-playbook.md, mage-capabilities.md, state-and-evidence.md, review-protocol.md, role-mage-engineer.md]
    artifactPrefix: placement
    produces: placementCandidate
- id: review-litho-pie
  file: flow/mage_placement_cli.py
  description: >
    Act as the Litho/PIE placement owner for one review round ...
  inputs: [WORKSPACE, ROUND]
  argv: [python3, '${WORKSPACE}/flow/mage_placement_cli.py', consumer-review, '${WORKSPACE}', litho-pie]
  outsourcing:
    role: resident-engineering-agent
    reads: [caseReadiness, startSnapshot, placementCandidate]
    knowledge: [review-protocol.md, state-and-evidence.md, role-litho-pie.md]
    artifactPrefix: reviews/litho-pie
    produces: reviewLithoPie
# review-metrology, review-alignment, review-wat likewise with their role file, prefix and produces
```

`rules:` lists the seven rule ids. `knowledge:` lists every knowledge file with a `purpose`. `words:` labels for the three goal knobs and the strategy knob. `ontology.aliases.placementResult: [scribe-line placement result, test structure placement delivery]`.

- [ ] **Step 3: `rounds.py` and `test_rounds.py`**

```python
def test_stop_when_no_hard_fail_and_no_open_requests(self): self.assertEqual(decision['route'], 'stop')
def test_continue_when_open_requests(self): ...
def test_stop_after_two_rounds_without_improvement(self): ...
def test_best_state_order_prefers_fewer_native_rows_then_priority_then_hard_fails_then_drops(self): ...
def test_conflict_move_vs_keep_becomes_decision_request_with_both_consumers_numbers(self): ...
def test_unanswered_previous_request_is_a_candidate_error_not_a_decision(self): ...
```

`decide(...)` reads the candidate document and the four review documents from the workspace (paths from the committed values' observation `retainedPath`/declared output paths), verifies each review's `snapshotSha256 == candidate.snapshotSha256`, builds the ledger coverage, best state, conflicts, history and route, writes `state/round-decision.json` and `state/placement-result.json` (both stamped), and returns the decision body as the task value.

- [ ] **Step 4: `mage_placement_cli.py` program tasks**

Mirror `atcs/business_tasks.py:execute` + `atcs_cli.py:main`. `task-prepare-case`: read manifest JSON (path from `MAGE_CASE_MANIFEST`), verify every `{path, sha256}`, read PLAs/rule/pblock/block/CSV/request, build start snapshot (`stage: start`, `pending_from_rules=True`), write `state/start-snapshot.json`, `state/case-readiness.json` `{goal:{...}, manifestSha256, consumerContextSha256, siteCapabilitiesSha256, ruleFactsSummary, blockTypes}`, `state/round-decision.json` (round 0, `route: continue`, empty lists); value `{MAGE_CASE_MANIFEST, CONSUMER_CONTEXT, SITE_CAPABILITIES, readinessId, startSnapshotSha256}`; artifacts `case-readiness`, `start-snapshot`, `round-decision`. `task-measure-incumbent`: snapshot of `incumbentState` (`stage: incumbent`), metrics, evaluators for the four consumers, write `state/incumbent.json` labelled `"evidence": "modelled"`. `task-evaluate-placement`: compute `goalMet` = all seven rule predicates hold on the best state's Reader values, Q1–Q4 vs incumbent, unknown kept; `task-deliver`: recheck digests, write `delivery/report.json`, `delivery/REPORT.md`, `delivery/placement-artifacts.tar.gz`.

Resident subcommands as in the CLI table; `mage-round` constructs `MageSession` from `siteCapabilities.mage` (`executable` may be a list: `["/usr/bin/python3", "/path/standin_mage.py"]`), writes under `placement/round-NN/`.

- [ ] **Step 5: `tools/read-mage.py` and `test_readers.py`**

Structure as `read-atcs.py` (`main()` with `kind REPORT OUT WORKSPACE`, `_mage_modules()` inserting `<workspace>/flow` on `sys.path`, fail closed, emit the whole declared set). Negatives in tests: tampered PLA (sha mismatch → error count 1, every other value unknown with reason), review bound to another snapshot sha, fabricated finding number (evaluator re-run differs), unanswered open request, session log mutation with role `metrology`, missing verify file (→ that type unknown, total unknown, error count unchanged).

- [ ] **Step 6: `test_cli_tasks.py`**

Drive `task-prepare-case` → `task-measure-incumbent` → (stand-in Engineer: `snapshot`, `mage-round` with the stand-in MAGE, `candidate`) → (stand-in consumers: `evaluate`, `review`) → `task-decide-round` ×2 → `task-evaluate-placement` → `task-deliver` on the synthetic case in a temp workspace, through `subprocess.run([sys.executable, cli, ...])`. Assert the round-1 candidate (OVL_B 150 µm off) yields a litho-pie hard-fail Request, a round-2 candidate with OVL_B on target yields `route: stop`, `goalMet` false only because `KEY_V` is still pending (drops 1 > 0), and the tar contains both rounds.

- [ ] **Step 7: `semantics.yml`, readers, rules, `pnpm run build` not needed; run Python tests green; commit** (`feat(mage): Pack contract, round loop graph, program tasks, Readers and rules`)

---

### Task 8: Knowledge and Pack documents

**Files:**
- Create: `knowledge/placement-playbook.md`, `mage-capabilities.md`, `state-and-evidence.md`, `review-protocol.md`, `role-mage-engineer.md`, `role-litho-pie.md`, `role-metrology.md`, `role-alignment.md`, `role-wat.md`, `role-bonding.md`, `INTENT.md`, `SPEC.md`, `FABRIC.md`, `TEST.md`
- Test: `flow/tests/test_knowledge.py` (every file named in `contract.yml` exists, is flat-named, under 12,000 words total per resident; every CLI subcommand mentioned in a playbook exists in `mage_placement_cli.py`)

**Interfaces:** Consumes the CLI table and record shapes. Produces the files the `outsourcing.knowledge` lists reference.

- [ ] **Step 1: Write the knowledge in the ATCS playbook register** (imperative, evidence-led, no design-specific object names). `placement-playbook.md`: objective, fixed boundary, observe/diagnose/plan/apply/judge loop, the six diagnosis classes and action order, stop rules, delivery shape (the exact `mage.placement-candidate/1` fields and the `hima-resident-engineering-candidate/1` wrapper), prohibitions. `mage-capabilities.md`: spec §7 tables with V/D status and the four templates. `state-and-evidence.md`: modelled vs native vs device; snapshot binding; unknowns; identity (F8 class). `review-protocol.md`: spec §6 protocol, record shapes, one worked example round. Each `role-*.md`: mission, what to read (exact paths), permitted CLI calls, what to produce (exact file paths under its artifactPrefix and the review document), uncertainty handling, one example Finding and Request.

- [ ] **Step 2: INTENT/SPEC/FABRIC/TEST in the ATCS shape** (TEST.md records "no model, no EDA" and the dry route from Task 10 once it passes).

- [ ] **Step 3: Run `test_knowledge.py` green; commit** (`docs(mage): playbooks, role briefs and Pack documents`)

---

### Task 9: Host contract test

**Files:**
- Create: `test/contract/mage-scribe-placement.test.ts`
- Modify: `test/contract-groups.json` (`local` list, alphabetical position)

**Interfaces:** Consumes the Pack on disk. Produces an L0/L2 regression.

- [ ] **Step 1: Write the test** (model on `test/contract/agentic-timing-closure-system.test.ts:1–80`)

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { loadPack, checkPack, loadSite } from '@hima/harness';
import { createHimaHome, repoRoot } from './support/dsh-home.ts';
import { writeLocalSite } from './support/site.ts';

const packId = 'mage-scribe-placement';

test('the MAGE Pack runs five serial resident roles inside one Fabric repeat and only the Engineer holds the MAGE seat', async () => {
  const pack = loadPack(path.join(repoRoot, 'packs'), packId);
  assert.equal(pack.contract.version, '0.1.0');
  assert.equal(pack.contract.budget.timeBoxMs, 21_600_000);
  const flow = pack.flow!;
  const repeat = Object.values(flow.blocks).find(block => block.kind === 'repeat') as any;
  assert.ok(repeat, 'one repeat block'); assert.equal(repeat.maxIterations, 4);
  assert.deepEqual(repeat.stop, { output: { taskId: 'decide-round', path: ['route'] }, equals: 'stop' });
  assert.deepEqual(Object.keys(repeat.carry), ['roundState']);
  const body = flow.blocks[repeat.body] as any;
  assert.deepEqual(body.steps, ['engineer-place', 'review-litho-pie', 'review-metrology', 'review-alignment', 'review-wat', 'decide-round']);
  for (const id of ['engineer-place', 'review-litho-pie', 'review-metrology', 'review-alignment', 'review-wat']) {
    const tool = pack.contract.tools.find(item => item.id === id) as any;
    assert.equal(tool.outsourcing.role, 'resident-engineering-agent');
    assert.deepEqual(tool.licences, id === 'engineer-place' ? { mage: 1 } : {});
  }
  assert.deepEqual(pack.contract.agentTeams ?? [], []); assert.deepEqual(pack.contract.workshops ?? [], []);
  const semantics = (parse(await readFile(path.join(repoRoot, 'packs', packId, 'semantics.yml'), 'utf8')) as any).values;
  for (const file of ['mage-placement-candidate', 'mage-consumer-review']) {
    const reader = parse(await readFile(path.join(repoRoot, 'packs', packId, `readers/${file}.yml`), 'utf8')) as any;
    assert.equal(reader.file, 'tools/read-mage.py');
    for (const type of reader.emits) assert.ok(semantics[type], `${type} declared`);
  }
});

test('the MAGE Pack fits a Site that declares one MAGE seat and refuses one that declares none', async (t) => {
  const h = await createHimaHome(); t.after(() => h.dispose());
  const bindings = { mageCaseManifest: path.join(h.workspace, 'manifest.json'), consumerContext: path.join(h.workspace, 'consumer-context.json'), siteCapabilities: path.join(h.workspace, 'site-capabilities.json'), workspaceRoot: h.workspace };
  const pack = loadPack(path.join(repoRoot, 'packs'), packId);
  const fits = await writeLocalSite(h, { bindings, licences: { mage: 1 } });
  assert.equal(checkPack(pack, loadSite(fits.sitesDir, fits.name)).ok, true);
  const h2 = await createHimaHome(); t.after(() => h2.dispose());
  const none = await writeLocalSite(h2, { bindings, licences: {} });
  const check = checkPack(pack, loadSite(none.sitesDir, none.name));
  assert.equal(check.ok, false); assert.match(JSON.stringify(check.licences), /does not declare/);
});
```

(Adjust field names to the actual `PackCheck` shape in `packs.ts:3038`.)

- [ ] **Step 2: Build and run**

```bash
pnpm run build && node scripts/run-contract-tests.mjs local --files test/contract/mage-scribe-placement.test.ts
```

- [ ] **Step 3: Commit** (`test(mage): Pack structure and Site fit contract test`)

---

### Task 10: L2 dry route through the real Host

**Files:**
- Create: `test/fixtures/mage-resident-dry/prepare.py`, `acp.py`, `test/contract/support/mage-resident-durable-worker.ts`, `test/contract/mage-scribe-placement-durable.host.test.ts`
- Modify: `test/contract-groups.json` (`atcs-dry` list)

**Interfaces:** Consumes the Pack CLI and `flow/tests/standin_mage.py`. Produces proof that `repeat` + five resident tasks + two Readers + decide-round run on the real Host with zero model calls.

- [ ] **Step 1: `prepare.py`** calls `flow/tests/fixtures.py:make_case(root, mage_executable=[sys.executable, standin_path])` and `make_site_capabilities`, writing `manifest.json`, `consumer-context.json`, `site-capabilities.json` under the input root.

- [ ] **Step 2: `acp.py`** (model on `test/fixtures/atcs-resident-dry/acp.py`): on the initial prompt, read `task.json`, switch on `task['task']['toolId']`:
  - `engineer-place`: round `R = task.task.boundInputs.ROUND`; read `state/round-decision.json`; scenario `MAGE_DRY_CASE`:
    - `converge`: round 1 writes a candidate PLA equal to the start (OVL_B 150 µm off); round 2 moves OVL_B onto its CT target and answers every open request `satisfied`.
    - `conflict`: round 1 as above; round 2 answers the litho-pie request `declined` with a planner evidence file, and the WAT request `declined`; round 3 same → decide-round emits a Decision Request and stops on no improvement.
    Run `mage_placement_cli.py snapshot`, `mage-round`, `candidate` via subprocess; write `resident-delivery.json` with the result artifact `placement/round-0R/placement-candidate.json` and every support file.
  - `review-*`: run `evaluate` and `review`; file a `move` Request on `OVL_B` from litho-pie when its target distance > limit; a `place` Request on `KEY_V` from wat while it is pending; metrology and alignment file `ok`/`unknown` findings only.
- [ ] **Step 3: Worker** (copy `atcs-resident-durable-worker.ts`, rename, point at `packs/mage-scribe-placement`, bindings `mageCaseManifest`, `consumerContext`, `siteCapabilities`, `engineeringCapabilities`, `workspaceRoot`; `capacity.licences: {mage: 1}`; `startRun({pack: packId, site: 'local', test: true, goal: {target_dropped_count: 0, max_target_distance_um: 100, max_order_deviation: 1}, strategy: {incumbentComparison: 'retained'}, …})`). Assertions: for `converge`, tasks committed = 2 + 2×6 + 2 = 16 and `deliver.value.goalMet === false` with `metrics.drops.count === 1` and `openRequests === 0`; for `conflict`, 3 rounds, `decisionRequests.length >= 1`. Both: `productModelCalls 0`, every `reader-mage-*` job launched once per resident task, run status starts with `ended`.
- [ ] **Step 4: Host test** (copy `atcs-resident-durable.host.test.ts`; 180 s timeout; modes `converge`, `conflict`).
- [ ] **Step 5: Run**

```bash
pnpm run build && node scripts/run-contract-tests.mjs atcs-dry --files test/contract/mage-scribe-placement-durable.host.test.ts
```

Requires `HIMA_POSTGRES_RUNTIME` (see `test/contract/support/dbos-process.ts`). If a Harness identity check refuses the second round's rewritten result or support file, record the exact error in TEST.md and switch the candidate result path to a round-numbered path bound through the carry (spec §13 first risk) before changing anything else.

- [ ] **Step 6: Commit** (`test(mage): dry route of the serial round loop through the real Host`)

---

### Task 11: Machine-local P23 evaluation (main agent)

**Files (outside this repo):** `/Users/lluzi/code/mage_smart_conflict_resolver/research/mage-resident-agent-20261012/pack-eval/{run.sh, manifest.json, consumer-context.json, out/}`

- [ ] Build a `mage.case-manifest/1` for the unpacked P23 package (`deployment/20261012/unpacked/P23_mage_file_20260921180320/`): rule, pblock, block, clusterTcls, `run_tcl/LayoutTarget_in.csv`, `run_tcl/group_all_load.t`, `startState = pre_place_all.pla`, `incumbentState = frame_post_refine.pla`, `frameSizeUm ["25557.2","30823.8"]`, `dbuPerUm 10000`.
- [ ] Run `task-prepare-case` and `task-measure-incumbent` in a temp workspace; assert against the brief's verified counts: 225/225 targets bound, 10 fixed, 225 priority fits, 60 targets beyond 100 µm (max 2847.7), incumbent 525 fits / 19 drops / 64 beyond 100 µm (max 8314.4), drop length by long side 53,069 µm.
- [ ] Run `plan-slots` on each V lane for `--length-um 5188 --count 1 --limit-um 100` and `--limit-um 1000` (strict and `--relaxed`); compare with `evidence/slot_bound.out.txt` (2 slots at 100 µm, 11 at 1,000 µm) and record agreement or the explained difference.
- [ ] Write `pack-eval/README.md` with the commands, the Pack commit sha, and the comparison table. Nothing from this step enters the polishing repo except a one-line pointer in `TEST.md`.

---

### Task 12: Final review (Opus 5.5 high)

- [ ] Whole-branch review against the spec: identity (every Reader re-hashes), one writer (session log + Reader), unknown-never-zero, customer-neutral Pack, polishing-discipline module ownership (no Harness change), test coverage per spec §10, knowledge consistency with the CLI.
- [ ] Fix findings in place, rerun the Python suite, the two contract tests and the dry route; update `TEST.md` and `FABRIC.md`; commit and push; report local and remote SHAs.

---

## Self-review

- **Spec coverage:** §4 architecture → Task 7 graph; §5 files → Tasks 1–8; §6 roles/protocol → Tasks 7 (decide-round), 8 (knowledge), 10 (dry route); §7 mechanism → Tasks 3, 6; §8 consumers → Task 5; §9 records/Readers/rules → Tasks 5, 7; §10 testing → every task + Tasks 9, 10, 11; §11 cases → Task 11 (offline) with S2 noted; §12 decisions → Global Constraints.
- **Placeholder scan:** none of "TBD/TODO/similar to"; descriptive steps carry code or exact command forms.
- **Type consistency:** `LaneItem(id, length, gap_after, window, current, movable, cluster, priority?, intruder?)`; snapshot keys `fits/pending/targets/ruleFacts/lanes`; CLI subcommand names identical in Tasks 7, 8, 10; emits lists identical in Task 7 and Task 9.
