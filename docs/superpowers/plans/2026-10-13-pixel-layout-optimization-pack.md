# pixel-layout-optimization Pack: implementation plan

Date: 2026-10-13. Branch `feat/pixel-layout-optimization`, worktree
`/Users/lluzi/code/hima_harness_reforge_polishing/.claude/worktrees/pixel-layout-optimization`.
Records: `packs/pixel-layout-optimization/INTENT.md` (what the business is), `SPEC.md` (the run
contract this plan compiles). Read both before any task. When this plan and `SPEC.md` disagree,
`SPEC.md` wins; tell the coordinator.

## Ground rules for every task

1. **Public repository.** No customer data enters git: no coordinate, polygon, rule value, net
   capacitance, report text or file name copied from the customer case or from
   `.scratch/pixel-agent/`. Tests use the synthetic case of Task 1 only. You may **read**
   `.scratch/pixel-agent/tools/*.py` (our own day-1 method code, the proven algorithm) and the
   Linglong work area `/data/eda/project/hima_harness/pixel-runs/` (read-only; `ssh luzi@192.168.50.41`,
   never `ssh linglong`) to learn algorithms and report **formats**. Write synthetic fixtures in the
   same formats with invented values.
2. **No hard-coded case names.** Layer names, GDS numbers, net names, rule values and recipes come
   from the case manifest (`pixel.case-manifest/1`) or the parsed deck. The synthetic case uses
   different names from the customer's (e.g. `Poly`, `GateA`, `GateB`, `Via`, `Metal`, `Anode`,
   `Bank`, `CapMark`, `Bound`) so any hard-coding fails its tests.
3. **Python 3.8-compatible everywhere** (the EDA container runs 3.8.16): no `match`, no `X | Y`
   type unions at runtime, no `dict | dict`, `from __future__ import annotations` allowed.
   Stdlib-only modules (marked **S**) must import nothing outside the standard library, not even
   lazily, because they run on the Site host's `python3`. Numeric modules (marked **N**) may use
   numpy 1.24, scipy 1.10 (HiGHS via `scipy.optimize.linprog(method="highs")`, `nnls`), shapely 2.0,
   gdstk 0.9 — nothing else.
4. **Errors.** Raise `pixelopt.core.PixelError(code, detail)`; codes are kebab-case words
   (`missing-input`, `digest-mismatch`, `schema`, `unresolved-goal`, `infeasible`, `tool-failed`,
   `identity-mismatch`, `bad-plan`). Never print tracebacks from the CLI.
5. **Tests.** `unittest` only, under `packs/pixel-layout-optimization/flow/tests/`, one file per
   module `test_<module>.py`. Local run:
   ```bash
   cd packs/pixel-layout-optimization/flow && uv run --quiet --python 3.12 --with numpy==1.26.4 --with scipy==1.13.1 --with shapely==2.0.7 --with gdstk==0.9.52 python -m unittest discover -s tests -t .
   ```
   Stdlib modules' tests must also pass with plain `python3 -m unittest` (no numeric imports in
   those test files). The coordinator re-runs the whole suite in the Linglong container venv
   (`/data/eda/project/hima_harness/pixel-runs/env38`) before merge.
6. **Commits.** Commit only your files, message `feat(pixel): ...` / `test(pixel): ...` ending with
   `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (or your model's line). The pre-commit
   hook builds and runs Host unit tests (~2 min); run `git commit` with
   `PATH=$HOME/.local/node24/bin:$PATH`. Then `git push --no-verify` (the pre-push gate has 5
   failures already on `origin/main`, unrelated to this Pack) and check
   `git ls-remote origin refs/heads/feat/pixel-layout-optimization` equals `git rev-parse HEAD`.
   Never use bare `git stash`. Heredocs mentioning git may be refused by the worktree guard: write
   files with the Write tool.
7. **Do not touch** anything outside `packs/pixel-layout-optimization/` and this plan, except where a
   task says so.

## Package layout (frozen)

```
packs/pixel-layout-optimization/
  INTENT.md SPEC.md FABRIC.md TEST.md          records (FABRIC/TEST written later)
  contract.yml graph.yml semantics.yml         Task 6
  schemas/tasks.json                           Task 6 (task business I/O, JSON Schema 2020-12)
  readers/pixel-receipt.yml readers/pixel-plan.yml   Task 6
  tools/read-pixel.py                          Task 6 (S, the Reader script)
  rules/*.yml                                  Task 6 (16 rule files, SPEC Judge rules)
  knowledge/*.md                               Task 7 (4 files, SPEC Knowledge)
  flow/pixel_cli.py                            Task 6 (S entry; numeric subcommands import N lazily)
  flow/schemas/*.json                          Task 1 (case-manifest, site-capabilities), Task 5 (receipt), Task 6 (plan, card, round-decision, evaluation)
  flow/pixelopt/__init__.py                    Task 1
  flow/pixelopt/core.py            S  Task 1
  flow/pixelopt/manifest.py        S  Task 1
  flow/pixelopt/goal.py            S  Task 1
  flow/pixelopt/rules.py           S  Task 1
  flow/pixelopt/layout.py          N  Task 2
  flow/pixelopt/nets.py            N  Task 2
  flow/pixelopt/geometry.py        N  Task 2
  flow/pixelopt/mutants.py         N  Task 2
  flow/pixelopt/compact.py         N  Task 3
  flow/pixelopt/euclid.py          N  Task 3
  flow/pixelopt/attribution.py     N  Task 4
  flow/pixelopt/operators.py       N  Task 4
  flow/pixelopt/edits.py           N  Task 4
  flow/pixelopt/markers.py         S  Task 4 (fold/classify; pair proposals take a Layout via N callers)
  flow/pixelopt/reports.py         S  Task 5
  flow/pixelopt/judge.py           S  Task 5
  flow/pixelopt/reaper.py          S  Task 5
  flow/pixelopt/receipt.py         S  Task 5
  flow/pixelopt/plan.py            S  Task 6
  flow/pixelopt/history.py         S  Task 6
  flow/pixelopt/rounds.py          S  Task 6
  flow/pixelopt/card.py            N  Task 6
  flow/pixelopt/numeric.py         S  Task 6 (launch numeric subcommands in the container)
  flow/pixelopt/tasks.py           S  Task 6
  flow/tests/fixtures.py           N  Task 1 (synthetic case builder)
  flow/tests/standin_eda.py        S  Task 5 (stand-in argus/calibre/gdsIn/rcexplorer)
```

## Frozen interfaces

### core (S)

```python
class PixelError(Exception):
    def __init__(self, code: str, detail: str): ...
    code: str; detail: str
def sha256_file(path) -> str
def read_json(path) -> object                      # PixelError("missing-input") when absent/unparseable
def write_json(path, doc) -> str                   # atomic (tmp + os.replace), sorted keys, indent 1; returns sha256
def validate(doc, schema) -> list                  # error strings; subset: type, enum, const, required,
                                                   # properties, additionalProperties(false), items, minItems,
                                                   # maxItems, minimum, maximum, minLength, $ref (#/$defs/..), anyOf, oneOf
def load_schema(name) -> dict                      # flow/schemas/<name>.json
def check(doc, name) -> None                       # validate against load_schema(name); PixelError("schema", ...)
def snap(value: float, grid: float) -> float       # round to grid, then to 6 decimals
```

### manifest (S)

`flow/schemas/case-manifest.json` describes `pixel.case-manifest/1` (SPEC Run contract, Inputs).
Every file reference is `{"path": str, "sha256": str}`. Concretely:

```json
{
 "schema": "pixel.case-manifest/1",
 "caseId": "synthetic-1",
 "original": {"gds": {"path": "...", "sha256": "..."}, "topCell": "pix_orig"},
 "candidateTopCell": "pix",
 "gridUm": 0.005,
 "layers": {
   "Poly":   {"gds": [3, 0],  "roles": ["conductor", "poly", "opaque"], "stack": "device"},
   "GateA":  {"gds": [2, 0],  "roles": ["conductor", "gate", "opaque"], "stack": "device"},
   "GateB":  {"gds": [19, 0], "roles": ["conductor", "opaque"], "stack": "device"},
   "CapMark":{"gds": [7, 0],  "roles": ["marker"], "stack": "device"},
   "Via":    {"gds": [5, 0],  "roles": ["contact"], "stack": "device"},
   "Metal":  {"gds": [4, 0],  "roles": ["conductor", "opaque"], "stack": "device"},
   "Plan":   {"gds": [9, 0],  "roles": ["optical"], "stack": "top"},
   "Anode":  {"gds": [6, 0],  "roles": ["conductor", "optical", "opaque"], "stack": "top"},
   "Bank":   {"gds": [14, 0], "roles": ["optical", "emission-opening"], "stack": "top"},
   "Bound":  {"gds": [12, 0], "roles": ["outline"]},
   "Cath":   {"gds": [11, 0], "roles": ["outline-copy"]}
 },
 "freePairs": [["GateB", "Poly"]],
 "devices": {"polyLayer": "Poly", "gateLayer": "GateA"},
 "connectivity": {"contactLayer": "Via", "topConductor": "Metal",
                   "landingOrder": ["GateB", "GateA", "PolySD"],
                   "labelLayers": {"3": "Poly", "2": "GateA", "19": "GateB", "4": "Metal"},
                   "anodeVia": {"layer": "Plan", "joins": ["Metal", "Anode"]}},
 "nets": {"storageNode": "S", "storageNet": "VP", "anode": "AN", "anodeLayers": ["Anode"]},
 "ratioDefinitions": {"narrow": ["EN", "R1"], "broad": ["EN", "R1", "SC", "AN"]},
 "couplingLimits": [{"pair": ["S", "DL"], "maxFf": 0.5}],
 "loadLimitedLines": ["SC", "AN"],
 "targets": {"outlineUm": [20.0, 40.0], "ratioPct": {"broad": 9.0, "narrow": 2.0}, "transmittancePct": [5.0, 30.0]},
 "cst": {"markerLayer": "CapMark", "plateLayers": ["GateA", "GateB"], "coefficientFfPerUm2": 0.6, "tolerancePct": 2.0,
         "schematicTemplate": {"path": "...", "sha256": "..."}},
 "decks": {"authority": {"path": "...", "sha256": "..."}, "reference": {"path": "...", "sha256": "..."}},
 "interactRules": [{"id": "VIA.LAND", "layer": "Via", "mustTouch": [["GateB", "Metal"], ["GateA", "Metal"], ["Poly", "Metal"]]}],
 "lvs": {"engine": "calibre", "deckTemplate": {"path": "...", "sha256": "..."}, "schematic": {"path": "...", "sha256": "..."}},
 "extraction": {"techLibOalib": {...}, "techLibTechDb": {...}, "layerMap": {...}, "etf": {...}, "layerMapBool": {...}, "tclTemplate": {...}, "libName": "pix", "cellName": "pix"},
 "alps": {"consistent": false}
}
```

`PolySD` in `landingOrder` is the derived poly-outside-gate region (poly minus gate), the only
derived name allowed there. `labelLayers` maps a GDS label layer number (as a string) to the layer
whose shape the label names. `anodeVia` (optional) says shapes of `joins` touching inside the via
layer are one net (the anode joined to its driving metal).

```python
class Case:                                   # thin read-only wrapper over the manifest dict
    raw: dict; root: str                      # manifest's directory (relative paths resolve from it)
    def file(self, ref: dict) -> str          # absolute path of a file reference
    def layer(self, name) -> dict
    def layers_with(self, role) -> list       # names in manifest order
    def gds_map(self) -> dict                 # (layer, datatype) -> name
def load_case(path, verify=True) -> Case      # schema check + every sha256 re-verified (PixelError digest-mismatch names the field)
def load_sitecaps(path) -> dict               # pixel.site-capabilities/1, schema-checked
```

`flow/schemas/site-capabilities.json` (`pixel.site-capabilities/1`):

```json
{"schema": "pixel.site-capabilities/1",
 "launcher": {"argv": ["/usr/local/bin/edarun"], "env": {"EDA_CONTAINER": "eda-runner-pixel"}},
 "python": "/data/eda/project/hima_harness/pixel-runs/env38/bin/python",
 "reaperPython": "/usr/libexec/platform-python",
 "envScripts": ["/data/eda/env/empyrean-fpd-env.sh"],
 "tools": {"argus": ["argus", "-fpd", "-drc"], "calibre": ["calibre", "-lvs", "-hier", "-turbo", "2"],
           "gdsIn": ["setarch", "x86_64", "--uname-2.6", "gdsIn"], "rcexplorer": ["rcexplorer", "-fpd", "-autoexit", "-nowin", "-replay"]},
 "gdsInLibraryPath": "$AETHER_OA_HOME/lib/linux_rhel60_64/opt",
 "env": {"IGNORE_FLEX_RC_FILE": "1", "QT_QPA_PLATFORM": "offscreen"},
 "parallelJobs": 3,
 "drcStripFunctions": ["geom_interact"],
 "timeoutsS": {"drc": 300, "lvs": 300, "gdsIn": 300, "rce": 900},
 "expectVersions": {"python": "3.8", "numpy": "1.24", "scipy": "1.10", "shapely": "2.0", "gdstk": "0.9"}}
```

An empty `launcher.argv` runs commands directly (tests). The environment variable
`PIXELOPT_DIRECT=1` (set in the resident sandbox, which already is the EDA image) also runs
commands directly, ignoring the launcher. On linglong the launcher env names the dedicated
container `eda-runner-pixelpack` (PID 1 `podman-init`, so no reaper is needed there). `tools.*` are argv prefixes, so tests
substitute `[sys.executable, "standin_eda.py", "argus"]`.

### goal (S)

```python
def resolve(goal: dict, strategy: dict, case: Case, original: dict) -> dict
```
`goal` keys are the SPEC Goal names; `strategy` the five knobs; `original` holds
`outlineUm: [w, h]`. Returns `{"values": {...resolved numbers...}, "sources": {name: "goal"|"manifest"|"original"|"none"},
"ratioDefinition", "ratioNets": [...], "transmittanceBasis", "extraCsOverlap", "topologyMoves", "convergeBandPct"}`.
`t_min_pct`/`t_max_pct` resolve to `None` when neither gives one. Unresolved ratio target →
`PixelError("unresolved-goal", ...)`.

### rules (S): the Argus deck parser

```python
def parse_deck(text: str) -> dict
# {"vars": {name: float}, "layers": {name: gds_number}, "derived": {name: expr_text},
#  "checks": [{"rule": "M.1", "kind": "width"|"space"|"space2"|"enc"|"other",
#              "layers": [..], "value": float|None, "modelled": bool, "derivedFrom": {...}|None, "text": str}],
#  "unmodelled": ["rule id: reason", ...], "options": {"db_precision": bool, "tolerance": float|None}}
def compaction_table(parsed: dict, case: Case) -> dict
# {"width": {L: v}, "space": {L: v}, "xspace": [[La, Lb, v]], "enc": [[outer, inner, v]], "unmodelled": [...]}
def make_rule_file(deck_text, gds_path, top_cell, strip_functions=()) -> (str, dict)
# replaces layout_input( path ...) / ( top_cell ...); forces drc_result/drc_summary to argus_drc.db / argus_drc.sum;
# ensures exactly one layout_use_db_precision( yes ) (replacing a precision( N ) line, or inserting it);
# removes whole rule blocks using any strip_functions (e.g. geom_interact, the licence cannot run it).
# record = {"precision": "replaced precision( 100 )"|"inserted"|"present", "stripped": [rule ids]}.
# The judge refuses when a stripped id has no manifest interactRules entry of the same id.
```
Dialect (read the customer deck format on Linglong `pixel-runs/tools/drc_case.base`, never copy it):
`var( name value )`, `layer( Name n )` and `layer ( Name n )`, `rule ID { ; comment\n check }`,
`//` comments (commented-out rules are ignored), case-insensitive layer names, derived layers
`X = geom_and( A B )`, `geom_not( A B )`, nested, and `geom_get_boundaries( A )`.
Checks: `width( L < v ...)`, `space( L < v ...)`, `space( La Lb < v ...)` (two-layer), `enc( inner outer < v ...)`,
where `v` is a literal or `$var`. The value is the literal in the check (the deck's `var`
comments may disagree with it; the check's literal is what Argus applies). A derived layer used in
a check resolves to its first base operand for compaction (`derivedFrom` records the expression;
this is conservative). Any other construct (`geom_interact`, unknown functions) is `kind: "other"`,
`modelled: false`, and listed in `unmodelled`.

### layout (N)

```python
class Layout:
    polys: dict      # layer name -> list[np.ndarray (n, 2) float], closed implicitly, no repeated last point
    labels: list     # [(text, gds_layer:int, x, y)]
    def copy(self) -> "Layout"
    def outline(self, case) -> ((x0, y0), (x1, y1))     # bbox of the outline-role layer
    def geom(self, name)                                # shapely union (buffer(0)) of a layer
def load_gds(path, case, top=None) -> Layout            # layers by case.gds_map(); unknown layers dropped, recorded
def save_gds(lay, path, case, top) -> None
def write_set(lay, directory, case) -> dict             # pixel.gds, pixel2x2.gds, pixel3x3.gds at the outline pitch, tops
                                                         # case candidateTopCell, <top>2x2, <top>3x3; returns {"1x1": [path, top], ...}
def transpose(lay) -> Layout
def merge_layers(lay, layers) -> Layout
def clean(lay) -> Layout                                # drop repeated and collinear vertices, snap to 4 decimals
def add_jogs(lay, axis, levels, layers) -> Layout
def sync_outline_copies(lay, case) -> Layout            # outline-copy layers = outline polygon
```

### nets (N)

```python
def extract(lay, case) -> dict
# {"nets": {name: [(layer, shapely_geom)]}, "channels": [shapely_geom], "unnamed": [net ids]}
```
Contacts join the `topConductor` to the first present layer of `landingOrder` under the contact.
Names come from labels (`labelLayers`); a net with several labels is named by the sorted labels
joined with `/`. `anodeVia` joins its layers. Channels are `polyLayer ∧ gateLayer`.

### geometry (N)

```python
def measure(lay, case, original_lay, rules_parsed) -> dict
# {"outlineUm": [w, h], "channelsChanged": int, "channelNotes": [...],
#  "tTiledPct": float, "tOwnPct": float, "oledAreaUm2": float, "pdlSymmetryMin": float|None,
#  "interactViolations": {rule_id: count}, "cstDeviceFf": float, "cstMarkerAreaUm2": float,
#  "offGridVertices": int, "badAngleEdges": int, "nets": [names]}
```
Transmittance: opaque = union of `opaque`-role layers; tiled = centre cell of the 3×3 array.
Channel congruence: per channel sorted by (area, w), normalised translation-invariant comparison
within 0.002 µm; count changed. `cstDeviceFf` = area(marker ∧ plate layers) × coefficient.
PDL symmetry is the vendor prototype's figure (mirror overlap of each conductor inside the
emission-opening polygon, min over layers and both axes); `None` when no opening polygon exists.

### mutants (N)

```python
def remove_contact(lay, case) -> (Layout, dict)       # drops the contact whose removal splits a labelled net; describes it
def shrink_space(lay, case, table) -> (Layout, dict)  # moves one polygon edge so one same-layer space is 0.5 * rule; describes it
```

### compact (N) and euclid (N)

Port of `.scratch/pixel-agent/tools/compact.py` + `euclid.py`, driven by `rules.compaction_table`
and the case roles instead of the module constants (`W`, `S`, `XSPACE`, `ENC`, `LAYERS`,
`FREE_PAIRS`, the `TOP` stack, `labmap`, the Cst heuristics). Keep the algorithm.

```python
def build(lay, case, table, *, rigid_extra=(), protect=(), pairs=(), metric_rows=(), trust=None, use_euclid=True) -> dict
def solve(model, *, target_pitch=None, objective="pitch"|"movement"|"metric"|"legalise", metric_weights=None) -> dict
# {"status": "optimal"|"infeasible"|"error", "x": list|None, "pitch": float|None, "binding": [constraint tags with nonzero dual, by |dual| desc]}
def apply(lay, model, x, case) -> Layout
def compact(lay, axis, case, table, *, target_pitch=None, **kw) -> (Layout|None, dict)
def edge_classes(model) -> list        # [{"var": j, "layer": L, "polys": [...], "orient": "x"}] for gradients
```
`metric_rows`: `[{"name", "coef": {var_index: g}, "const": c0, "op": "le", "rhs": r}]` (linear
rows in the displacement variables; Task 4 produces `coef` per edge class from the surrogate).
`trust`: `{"radius": d, "vars": [j...]}` adds `|dx_j| ≤ d`. `objective="legalise"`: every
same-layer, two-layer and enclosure pair that violates its rule in the input is constrained at the
full rule distance instead of `min(rule, original)`, pitch fixed at the input pitch, minimum total
movement; infeasible → `status: "infeasible"` with the binding tags. Constraint tags name the rule, the
layers and the place (as today), so the duals give the binding chain.

### attribution (N)

```python
def sites(nets, case) -> list          # coupling sites: {"victim", "aggressor", "victimLayer", "aggressorLayer", "overlapUm2", "fringe1Um2", "fringe25Um2", "bbox"}
def features(nets, case, pairs) -> dict  # {pair "A|B": {feature: value}}; visible overlap with other nets' conductors between the layers subtracted; fringe bands 0–1 and 1–2.5 µm
def fit(rows, pairs) -> dict           # rows = [(features_by_pair, caps_fF_by_pair)]; NNLS with free intercept; leave-one-out RMSE and R² per pair
def predict(model, feats) -> dict      # pair -> fF
def gradients(model, lay, case, comp_model, pairs) -> dict  # pair -> {var_index: dfF/dµm} by finite difference of features
```
Layer order for screening is the manifest's conductor order (`layers` order with role
`conductor`, `PolySD` first).

### operators (N) and edits (N)

```python
OPERATORS = ("shield", "cst-stretch", "opening-shift", "band-trim", "contact-move")
def apply_operator(lay, op: dict, case, nets) -> (Layout, dict)   # dict = what changed, declared changes (e.g. {"cstFf": new})
def apply_edits(lay, edits: list, case) -> (Layout, list)        # each edit moves vertices or an edge by ≤ 1 µm, never a channel or Cst vertex, ≤ 12 per call; refuses otherwise
```
Operator parameters are by net/layer/role, never by coordinate: `shield {net, layer, over: {victim, aggressor}, marginUm}`,
`cst-stretch {dyUm, cutAt: "marker-top"|"marker-bottom"}` (smart cut through the marker, everything beyond moves),
`opening-shift {dxUm, dyUm}` (emission-opening layer, anode and outline-copy layers that follow it),
`band-trim {net, layer, widthUm}`, `contact-move {net, toward: "left"|"right"|"up"|"down", stepUm}`.
Edits: `{"layer", "polygon": index, "vertices": [indices] | "edge": index, "dx", "dy"}`.

### markers (S)

```python
def parse_db(text) -> list                         # Argus .db -> [(rule, [[x, y], ...])] (µm; read the format on Linglong)
def fold(marks, outline) -> list                   # fold tile markers into the unit cell, dedupe by rule + rounded bbox
def classify(marks, parsed_rules, start_marks) -> list
# each: {"rule", "bbox", "class": "model-gap"|"exact-pair"|"bounded-edit"|"binding-chain"}
```
Classes per SPEC knowledge `optimisation-method.md`: a whole rule family absent from the
compaction table → `model-gap`; a single place legal in the start layout → `exact-pair`; ≤ 3 left →
`bounded-edit`; at the binding chain → `binding-chain`.

### reports (S)

```python
def argus_summary(path) -> dict     # {"total": int, "byRule": {rule: count}}; PixelError when unreadable
def calibre_lvs(path) -> dict       # {"correct": bool, "lines": [...]}; INCORRECT anywhere → False
def rce_caps(path) -> dict          # {"A|B" (sorted): fF}; sums parallel C cards; empty → {}
def tool_versions(log_text) -> dict
```

### judge (S), reaper (S), receipt (S)

```python
def judge(cands: list, workspace, case, sitecaps, readiness, mode="full"|"drc") -> list
# cands = [{"id", "dir"}] where dir holds pixel.gds/pixel2x2.gds/pixel3x3.gds and geometry.json;
# runs, per candidate, in its own out/ directory: argus authority × 3 tiles, argus reference × 3 tiles
# (rule files from rules.make_rule_file), LVS (manifest deck template, @LAYOUT@/@SOURCE@), gdsIn into a
# fresh library (only the two tech files copied in), rcexplorer with the manifest Tcl template (@D@);
# up to sitecaps.parallelJobs candidates at once; each command an argv list, never a shell string.
# Writes <dir>/receipt.json (pixel.receipt/1) and returns the receipts.
```
`pixel.receipt/1` (`flow/schemas/receipt.json`): `candidate`, `mode`, `reports` (each
`{"kind": "drc"|"lvs"|"rce"|"gdsin"|"geometry", "deck": "authority"|"reference"|null, "tile", "path", "sha256", "rc"}`),
`options` (deck sha256s, db precision, LVS deck/schematic sha256, extraction set sha256s, tool
versions), `freshLibrary` (true only when the library directory was created for this candidate),
`declaredChanges`, `seconds`.

```python
def reader_values(receipt_path, workspace, readiness) -> list   # the pixel-receipt Reader: list of
# {"type", "unit", "value", "unknownReason"?} for every value type of SPEC Semantics (pixel-receipt)
```
It re-parses every report by path and checks sha256, the options against `readiness`, and
`freshLibrary`; each problem adds 1 to `pixel_receipt_error_count`. No summary file → that DRC value
`null`. Empty/missing `RCEResult.sp` or gdsIn failure → ratio/capacitance values `null`.
`reaper.py`: `python reaper.py -- argv...` sets `PR_SET_CHILD_SUBREAPER` via ctypes and reaps until
the child exits (port of `.scratch/pixel-agent/tools/reap.py` if present on Linglong `pixel-runs/tools/reap.py`).

`standin_eda.py` (test-only, S): `python standin_eda.py argus|calibre|gdsIn|rcexplorer <args>`
writes report files in the real formats into the working directory the real tool would, computed
from the synthetic case with simple rules (DRC: same-layer space/width from the rule file by
geometry is optional — a deterministic stand-in that reports violations for a marker env var or
for any space below the rule found via a stdlib bbox check is enough; LVS: CORRECT unless a contact
is missing; RCE: capacitances from an analytic overlap model). It must make the mutants fail.

### plan, history, rounds, card, numeric, tasks, CLI (Task 6)

Specified in Task 6.

## Tasks

Waves run in order; tasks in one wave run in parallel. Each task: implement, test, commit, push,
report changed files, test command and result, risks.

### Wave A

**Task 1: foundation** (Sonnet 5 medium). `core.py`, `manifest.py`, `goal.py`, `rules.py`,
`__init__.py`, `flow/schemas/case-manifest.json`, `flow/schemas/site-capabilities.json`,
`flow/tests/fixtures.py`, tests. `fixtures.py` builds, into a temp dir, a complete synthetic case:
a 20 × 40 µm-ish cell with two TFTs (poly strips under a gate line), a storage capacitor (GateA plate
under a GateB plate inside `CapMark`, net `S` over `VP`), a scan line `SC` (GateA, crossing), an
enable line `EN`, a reset line `R1`, a data line `DL` (Metal), a supply `VP` (Metal + GateB), an anode
`AN` (Anode over a via in `Plan` to Metal), an emission opening (`Bank` hexagon or rectangle), the
outline `Bound`, labels, and some slack so a shrink is possible. Plus a synthetic Argus-dialect deck
(width/space/space2/enc checks, one derived layer, one commented-out rule, one `geom_interact`
rule), a reference deck with different values, an LVS deck template, a schematic file, extraction
placeholder files, the manifest with real sha256s, and a site-capabilities file pointing at the
stand-in tools. API: `build_case(tmpdir) -> {"manifest": path, "sitecaps": path, "gds": path}`.
Acceptance: parse_deck on the synthetic deck gives the expected table, refuses missing db precision;
load_case refuses a changed byte; goal.resolve covers goal/manifest/original/none and refuses an
unresolved ratio.

### Wave B (after Task 1)

**Task 2: geometry** (Opus 4.8 medium). `layout.py`, `nets.py`, `geometry.py`, `mutants.py`, tests on
the synthetic case: nets named as labelled; channels count; transmittance tiled ≤ own when
neighbours overhang; congruence detects a reshaped channel with an unchanged bbox (the vendor
prototype's blind spot); interact rule violation counted; mutants change exactly one thing.

**Task 5: judge** (Opus 4.8 medium). `reports.py`, `judge.py`, `reaper.py`, `receipt.py`,
`flow/schemas/receipt.json`, `flow/tests/standin_eda.py`, tests. Read real report formats on Linglong
(`pixel-runs/cands/*/out/drc_case_pixel/argus_drc.sum`, `argus_drc.db`, `out/lvs/lvs.rep`,
`out/rce/RCEResult.sp`, logs) and write synthetic fixtures with invented values. Counterexamples as
tests: no `.sum` → `null` + error; empty `RCEResult.sp` → `null` ratios; stale library
(`freshLibrary: false`) → error; LVS INCORRECT → 0; a sha256 mismatch → error.
Depends only on Task 1 plus `geometry.json` as an input file (do not import Task 2 modules).

### Wave C (after Task 2)

**Task 3: compactor** (Opus 4.8 medium). `compact.py`, `euclid.py`, tests: synthetic case
compacts to a known minimum pitch; duals name the planted binding chain; a metric row pulls a
planted conductor to its minimum width; trust region bounds movement; channels and Cst stay rigid
and congruent; periodic copies (a line crossing the cell boundary) keep continuity; labels follow.

**Task 4: attribution, operators, edits, markers** (Opus 4.8 medium). Tests: features grow with the
overlap; a screened overlap counts zero; NNLS fit recovers planted coefficients on synthetic rows
with R² > 0.95; gradients have the sign of the facing length; each operator changes only what it
declares (shield adds a polygon on the named net; cst-stretch raises the device value and declares
it); edits refuse more than 1 µm, a channel or Cst vertex, or more than 12 edits; markers fold tile copies into one.

### Wave D (after Waves B and C)

**Task 6: orchestration and the Pack declarations** (Opus 4.8 medium, review by Opus 5.5 high).
`plan.py` (`check(plan, readiness, history) -> errors`, reader values), `history.py`
(`append`, `load`, `trend(history, goal) -> series`, `trend_svg(series) -> str`: stdlib SVG, each
measure normalised to its target, 1.0 line, per-candidate points and best-so-far step line, like the
vendor report's trend chart), `rounds.py` (`rule_results(values, goal)`, `rank`, `decide(...)` with
the SPEC Choosers logic and stop reasons), `card.py`, `numeric.py`, `tasks.py` (the seven program
task entry points of SPEC Run contract), `pixel_cli.py` (`task-<id> <workspace> <in> <out>`; the
resident subcommands exactly as `knowledge/plan-and-repair-playbook.md` section 3 names them:
`card WORKSPACE`, `history WORKSPACE [--last N]`, `show WORKSPACE --campaign CW CANDIDATE`,
`markers WORKSPACE --campaign CW CANDIDATE --out FILE`, `try-edit WORKSPACE --campaign CW CANDIDATE --ops FILE --out-dir DIR`,
`plan-check WORKSPACE --plan FILE --out state/round/plan.json`; plus internal `num-*` subcommands run
in the container). The resident output follows the MAGE pattern: `resident-delivery.json` with
`state/round/plan.json` as the single result and `plan/round-NN/*` as support; the contract outputs
the resident reads are `caseReadiness` (`state/case-readiness.json`), `designSpaceCard`
(`state/card.json`), `surrogateModel` (`state/model.json`), `roundDecision`
(`state/round-decision.json`) and `history` (`state/history.jsonl`); candidates live under
`cands/<id>/` in the Campaign workspace, `contract.yml`, `graph.yml`, `schemas/tasks.json`,
`flow/schemas/{plan,card,round-decision,evaluation}.json`, `semantics.yml`, `readers/*.yml`,
`tools/read-pixel.py`, `rules/*.yml`. Shape reference: `git show origin/feat/mage-script-placement:packs/mage-script-placement/<file>`
(contract, graph, schemas/tasks.json, readers, rules, flow/mage_placement_cli.py, flow/mage_placement/tasks.py)
and `packages/harness/skills/knowledge/pack-anatomy.md`. L1 route test: the whole flow on the
synthetic case with the stand-in EDA and a scripted resident (writes a fixed plan) reaches each of the
four endings under four goal settings.

### Wave E

**Task 7: knowledge**: the four files are written by the coordinator (`knowledge/*.md`). Task 6
adds `flow/tests/test_knowledge.py`: every CLI subcommand and option the files name exists in
`pixel_cli.py`, every `state/...` path is a declared contract output or a documented path, no case
numbers.

**Task 8: Site** (coordinator): `sites/linglong-pixel/` (site.yml, permit.yml, README), the Linglong
manifest and site-capabilities under `/data/eda/project/hima_harness/pixel-inputs/case-v1/`
(outside git), `engineering-capabilities-pixel-v1.json`, container with raised pids limit.

**Task 9: reviews and L2** : Opus 5.5 high whole-Pack review; `hima_pack_check`; L2 dry route
through the real Host with stand-ins (pattern: `test/contract/mage-script-placement-durable.host.test.ts`
on the MAGE branch); FABRIC.md.

**Task 10: L4** (coordinator, user switches the licence to `fpd`): `judge-original` on the real
case, then one live Run in the App; TEST.md.
