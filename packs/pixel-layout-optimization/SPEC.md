# Pixel layout optimization 0.1.0 run contract

## Goal template

A Run starts from the designer's original pixel and asks for a smaller cell with a lower coupling
ratio, under every hard limit. The Goal holds seven numbers. A value of `0` means "take the case
manifest's target", so a customer answer given later is a manifest edit or a Goal value, never a
Pack change (`INTENT.md` Answers 7):

| Parameter | Unit | Default | Meaning |
|---|---|---|---|
| `outline_w_um` | µm | 0 | Target cell width (x pitch). 0: the manifest's `targets.outlineUm[0]`; if the manifest has none, the original's width (no shrink asked). |
| `outline_h_um` | µm | 0 | Target cell height (y pitch), the same way. |
| `ratio_target_pct` | % | 0 | Target for the judged coupling ratio Ct/Cs. 0: the manifest's `targets.ratioPct[<definition>]`; if neither gives one, `prepare-case` refuses (the Goal would be ambiguous). |
| `load_allowance_pct` | % | 5 | How far the total capacitance of each line the manifest lists in `loadLimitedLines` may rise above the original's. |
| `t_min_pct` | % | 0 | Lower edge of the transmittance window. 0: the manifest's `targets.transmittancePct[0]`; if neither gives one, no lower edge. |
| `t_max_pct` | % | 0 | Upper edge, the same way. |
| `cst_ceiling_ff` | fF | 0 | 0: the storage capacitor stays inside its LVS tolerance (no declared change). Above 0: a `cst-stretch` may enlarge it up to this value, and only with the declared schematic `prepare-case` writes for it. |

The Goal is met only when **both** the outline and the ratio targets are met on Reader values, with
every hard limit holding (`INTENT.md` Answers 5). Every other rule below is a hard limit.

Five Strategy knobs say how the Goal's quantities are read and how far the method may go:

| Knob | Kind | Default | Meaning |
|---|---|---|---|
| `ratioDefinition` | choice `broad`, `narrow` | `broad` | Which of the manifest's two aggressor net lists makes Ct. Both ratios are always measured and reported; this one is judged (`INTENT.md` Ambiguities: which Ct). |
| `transmittanceBasis` | choice `tiled`, `own` | `tiled` | Which transmittance the window judges. Both are always reported. |
| `extraCsOverlap` | choice `count`, `exclude` | `count` | Whether extracted storage-node-to-storage-net coupling outside the capacitor marker counts toward Cs. Both values are reported either way. |
| `topologyMoves` | choice `off`, `allowed` | `off` | Whether a plan may move a contact or reorder lines. |
| `convergeBandPct` | number, %-points, 0.001–1 | 0.02 | The Converged ending's band: how little the best judged ratio may improve over two rounds. |

Shaped by `end-honestly-in-more-than-one-way.md` (the targets and the band are what the endings
measure) and `over-constrain-and-read-the-violation.md` (the target outline is requested as given,
and the achieved outline is reported beside it, never folded into it).

## Constraints

**Frozen for the whole Run.** The circuit (schematic), the transistors, the layer stack and every
manifest file. A transistor is unchanged when its channel (gate layer over poly layer, from the
manifest's `devices` roles) is congruent by translation to the original's **and** LVS matches its
W/L; the vendor prototype's bounding-box W/L figure is not used (`INTENT.md` Ambiguities). The
storage capacitor's device value is the capacitor-marker area times the manifest's
`cst.coefficientFfPerUm2`, inside `cst.tolerancePct` of the original's, unless `cst_ceiling_ff`
declares a change.

**What a Run may change** (`INTENT.md` Answers 4): the positions of polygon edges that are not part
of a channel or of the storage capacitor, on the manifest's `gridUm`; the two pitches; and the
declared operators of a plan (`shield`, `cst-stretch`, `opening-shift`, `band-trim`, and
`contact-move` only when `topologyMoves` is `allowed`). A bounded edit moves a vertex or an edge by
at most 1 µm, never a vertex of a channel or of the storage capacitor, and is logged; a plan holds at
most 12 of them. An original that is not clean on the authority deck is legalised first: the
`legalise` front point solves the LP with every violated pair held at its full rule distance and
minimum movement, and bounded edits repair what the LP cannot reach.

**Measurement options, recorded and asserted on every judgement** (`assert-the-checker-options.md`):
the authority and reference deck sha256 and which one is the authority; the tile (1×1, 2×2, 3×3);
`layout_use_db_precision( yes )` in each generated rule file; the LVS engine, deck and schematic
sha256 and the W/L/C tolerances the deck states; the extraction set's sha256 (technology library,
layer map, ETF, boolean layer map, Tcl template); and the tool versions the logs print. A mismatch
between a receipt and the case-readiness record is a refusal, not a result.

**One checker per session** (`one-checker-per-session.md`): authority DRC, reference DRC, the
connectivity rules checked in geometry, LVS and extraction are separate runs in separate
directories, each read by its own parser into separately named values. No count is summed across
decks, tiles or tools.

**Identity by relation** (`attribute-by-database-relation.md`): nets come from the connectivity the
manifest declares (a contact joins the conductor above it to the first present layer of
`connectivity.landingOrder`), named by the label that lies on the shape; transistor identity comes
from the channel relation; a coupling is attributed by the extraction tool's own net pair. Label
text or device names alone are never trusted.

**Runtime.** Pack code is Python 3.8-compatible. Orchestration, readers and report parsers use the
standard library only and run on the Site host's `python3`. The numeric method (numpy, SciPy with
HiGHS, Shapely, gdstk) runs in the Site's pinned venv inside the EDA container, launched through the
`siteCapabilities` command; `prepare-case` checks the versions before any work (`INTENT.md`
Ambiguities: numeric dependencies). Nothing of the customer case is copied into the Pack
(`what-a-golden-flow-is.md`).

## Run contract

**Inputs a Site binds.**
- `pixelCaseManifest`: Site path of one `pixel.case-manifest/1` JSON file. Every file it names
  carries a sha256 that `prepare-case` re-verifies. Fields: `caseId`; `original` (`gds`, `topCell`);
  `gridUm`; `layers` (name → GDS layer/datatype, and roles: conductor, contact, poly, gate, marker,
  optical, outline, opaque); `devices` (`polyLayer`, `gateLayer`); `connectivity` (`contactLayer`,
  `topConductor`, `landingOrder`, `labelLayers`); `nets` (`storageNode`, `storageNet`, `anode`,
  `anodeLayers`); `ratioDefinitions` (`narrow`, `broad`: aggressor net lists);
  `couplingLimits` (net pair and `maxFf`); `loadLimitedLines`; `targets` (`outlineUm`, `ratioPct`
  per definition, `transmittancePct`); `cst` (`markerLayer`, `coefficientFfPerUm2`, `tolerancePct`,
  optional `schematicTemplate` with `@CST_FF@`); `decks` (`authority`, `reference`: Argus DRC rule
  files); `interactRules` (geometry-checked connectivity rules: id, layer, the layers each of its
  shapes must touch); `lvs` (`engine`, `deckTemplate` with `@LAYOUT@` and `@SOURCE@`, `schematic`);
  `extraction` (`techLibOalib`, `techLibTechDb`, `layerMap`, `etf`, `layerMapBool`, `tclTemplate`
  with `@D@`); optional `alps` (`consistent`, testbench files); optional `opticalStack`
  (the layers whose union is opaque, the emission layers).
- `siteCapabilities`: Site path of one `pixel.site-capabilities/1` JSON file: the `edarun` argv and
  container name, the venv `python`, the FPD environment script, the `gdsIn` prefix and library
  path, the Calibre environment, `parallelJobs`, and per-tool timeouts.
- `engineeringCapabilities`: the Site's resident executor binding (Site-owned, not read by Pack code).
- `workspaceRoot`: the Campaign-private output root the Site Permit allows.

**Wrappers.** `python3` and `/usr/bin/python3` (program tasks and the Reader); the resident tool is
launched by the Site's engineering wrapper.

**Workspace.** `workspace.source: pack`, copying `pixel_cli.py`, `pixelopt` and `schemas` into
`<workspace>/flow/`.

**Budget.** `timeBoxMs` 10,800,000 (3 h), `closingReserveMs` 1,200,000 (20 min, for re-judging the
delivered layout in fresh directories and packaging), at most 6 rounds (`repeat maxIterations: 6`).
Extraction parallelism is the Site's `parallelJobs` (`INTENT.md` Answers 10). The tasks that run
FPD tools hold `licences: {fpd: 1}`.

**The flow** (`graph.yml`, `schema: hima-flow/1`), one sequence:

| Task | Kind | Business input | Work and committed output |
|---|---|---|---|
| `prepare-case` | program | Run `pixelCaseManifest`, `siteCapabilities`; the seven Goal values; the five Strategy values | Verifies every manifest sha256; resolves each Goal value (`goal`, `manifest`, `original`) and refuses an unresolved ratio target; parses both decks into rule tables, listing the checks it cannot model; extracts the original's nets and freezes its channels and capacitor; checks the venv versions in the container. Writes `state/case-readiness.json`, `state/rules.json`, `state/original.json`. Output: resolved targets, digests, versions, unmodelled-rule list. |
| `judge-original` | program, `fpd: 1` | Committed `prepare-case` output | Judges the original (the same judge as every candidate) and two mutants the Pack generates: one contact removed (LVS must fail) and one space shrunk below its rule (authority DRC must fail). A wrong verdict on a mutant, or an original that fails LVS, fails the task with repair information: the judge or the schematic is wrong, and nothing after it may be trusted. Writes history entry 0. Output: the original's receipt values and the calibration verdicts. |
| `map-design-space` | program | Committed `judge-original` output | Attributes each coupling of the original to its coupling sites (victim shape, aggressor shape, layers, visible overlap, fringe bands); fits the surrogate on the receipts so far; solves the minimum-pitch LP per axis and names the binding chain from its duals; lists the lever instances with gradient and bound. Writes `state/card.json` (≤ 4 KB) and `state/card.svg`. |
| `learn-sensitivities` | program, `fpd: 1` | Committed `map-design-space` output | Judges ±1-step probes on the top levers in parallel; refits the surrogate per net pair; records the leave-one-out error per term. Writes `state/model.json` and the probes to history. |
| `repeat optimise-rounds` | `maxIterations: 6`, `budget: original-run`, carry `roundState` (initial `{round: 1}`, next `decide-round.nextRound`), stop when `decide-round.route` equals `stop` | — | One round per iteration: |
| ↳ `plan-round` | resident, outsourced, `fpd: 1` | `ROUND`; the resolved Goal | The resident engineering agent reads the card, model, history and last decision, may preview a bounded edit on the authority deck (`try-edit`, never credited), and writes `state/round/plan.json` (`pixel.plan/1`). The Reader `pixel-plan` checks it. |
| ↳ `solve-and-judge` | program, `fpd: 1` | Committed `plan-round` Reader value; `ROUND` | If the plan has errors, judges nothing and records why. Otherwise applies the plan's operators and edits, solves one LP per front point (alternating axes, metric rows, trust region from the last decision), writes each candidate's GDS set, and judges all in parallel. Appends every receipt to history. Output: the candidates with predicted and measured values. |
| ↳ `decide-round` | program | Committed `solve-and-judge` output; `ROUND`; the resolved Goal | Compares predicted with measured gain (trust radius doubles at ≥ half the predicted gain, halves otherwise); refits the surrogate with the new extractions; updates the best legal candidate, the front and the trend chart; detects the endings; routes `continue` or `stop`. Writes `state/round-decision.json`, `state/trend.json`, `state/trend.svg`. |
| `evaluate` | program, `fpd: 1`, `budget: closing` | Committed `decide-round` output | Re-judges the best candidate (and the front points the trade-off table shows) from its GDS in fresh directories; reads them with `pixel-receipt`; applies the rules; names the ending; for **Blocked**, writes the Decision Request with the trade-off table. Writes `state/evaluation.json`. |
| `deliver` | program, `budget: closing` | Committed `evaluate` output | Rechecks every referenced sha256 and packages `delivery/`: `REPORT.md`, `trend.svg`, the best layout's GDS set, its receipts and tool reports, any declared schematic, the Decision Request, `history.jsonl` and `report.json`. |

Every task's business input and output are JSON Schema 2020-12 definitions, version `'1'`, in
`schemas/tasks.json`; the named documents (`pixel.case-manifest/1`, `pixel.site-capabilities/1`,
`pixel.plan/1`, `pixel.receipt/1`, `pixel.card/1`, `pixel.round-decision/1`, `pixel.evaluation/1`)
are in `flow/schemas/`. Program tasks use the JSON-native operands `TASK_INPUT` and `TASK_OUTPUT`
and write `{"schemaVersion","value","artifacts","diagnostics"}`.

**The outsourced engineering task** `plan-round` (`outsourcing.role: resident-engineering-agent`):
- **Goal:** one plan that is likely to improve the judged ratio and the outline under every hard
  limit, or to repair the residual markers of a named earlier candidate.
- **Reads:** `caseReadiness`, `designSpaceCard`, `surrogateModel`, `roundDecision`, `history`.
- **Knowledge:** `plan-and-repair-playbook.md`, `pixel-design-space.md`, `optimisation-method.md`,
  `judge-protocol.md`.
- **Permitted work:** the CLI subcommands `card`, `history`, `show <candidate>`,
  `markers <candidate>`, `try-edit <candidate> <ops.json>` (authority DRC on 1×1 and 3×3 only,
  written under `state/round/preview/`, never credited) and `plan --check <plan.json>`. It writes no
  layout, judges nothing and edits no state file except its own plan and previews.
- **Delivers:** `state/round/plan.json`. **Completion evidence:** the `pixel-plan` Reader's
  `pixel_plan_error_count` equal to 0.

A `pixel.plan/1` holds `round`, `hypothesis` (written before anything is run), `base` (`original`,
`best` or a candidate id from history), `operators` (each a declared operator and its parameters),
`frontPoints` (1–6: `name`, `objective` `legalise`, `min-ratio` or `min-pitch`, optional `outlineUm`,
`loadAllowancePct`, `ratioCapPct`, and `exploratory: true` when its limits exceed the Goal's, for
the trade-off table only), `pairConstraints` (extra exact spacing constraints at a named place),
`edits` (bounded edits on a named candidate) and `expect` (which measures should move and how).

## Semantics

The task business fields are declared in `schemas/tasks.json` and need no Reader. Two Readers of
this Pack emit typed values; every value has a unit, and a value no report states is `null` with an
`unknownReason`, never a zero standing in for an unread number.

**`pixel-receipt`** reads one candidate's `pixel.receipt/1` and **re-parses the tool reports it
names** (Argus `.sum` per deck and tile, the LVS report, `RCEResult.sp`, the geometry record), each
re-verified by sha256. It never reads agent text. It emits:

| Value | Unit | Meaning |
|---|---|---|
| `pixel_receipt_error_count` | count | Missing, empty, stale or mismatched reports and option mismatches against case readiness. 0 only when every report was found, parsed and matched. |
| `pixel_drc_authority_1x1`, `_2x2`, `_3x3` | count | The authority deck's result count on that tile. A run with no summary file is `null` (counterexample 2). |
| `pixel_drc_reference_1x1`, `_2x2`, `_3x3` | count | The same for the reference deck, reported under its own name. |
| `pixel_interact_violations` | count | Shapes failing a manifest `interactRules` entry, checked in geometry. |
| `pixel_lvs_correct` | flag | 1 when the LVS report says the layout matches the declared schematic within its tolerances, 0 when it says it does not (counterexamples 3 and 4), `null` when there is no report. |
| `pixel_channels_changed` | count | Channels not congruent to the original's. |
| `pixel_outline_w_um`, `pixel_outline_h_um` | µm | The achieved cell outline. |
| `pixel_ratio_narrow_pct`, `pixel_ratio_broad_pct` | % | Ct/Cs for each manifest definition, from the extracted net pairs. |
| `pixel_ratio_judged_pct` | % | The one `ratioDefinition` names. |
| `pixel_ct_judged_ff` | fF | Its Ct. |
| `pixel_cs_ff` | fF | Cs: extracted storage node to storage net, with `extraCsOverlap` applied. |
| `pixel_cs_outside_marker_ff` | fF | The part of the extracted Cs outside the capacitor marker (estimated by the surrogate's overlap share, so marked `estimated` in the receipt). |
| `pixel_cst_device_ff` | fF | Capacitor-marker area × the manifest coefficient (geometry). |
| `pixel_coupling_over_limit_count` | count | Manifest `couplingLimits` pairs above their limit. |
| `pixel_load_increase_max_pct` | % | The largest rise of a `loadLimitedLines` total over the original's. |
| `pixel_load_over_limit_count` | count | Lines whose rise exceeds `load_allowance_pct`. |
| `pixel_t_tiled_pct`, `pixel_t_own_pct` | % | Transmittance on the 3×3 array's centre cell and on the own cell. |
| `pixel_t_judged_pct` | % | The one `transmittanceBasis` names. |
| `pixel_oled_area_um2` | µm² | Emission area. |
| `pixel_pdl_symmetry_min` | ratio | The vendor prototype's PDL-symmetry figure, kept for comparison with the customer's reports. |
| `pixel_undeclared_change_count` | count | A capacitor outside tolerance with no declared change, a declared change beyond `cst_ceiling_ff`, or a channel change. |

An extraction whose GDS import failed, or whose `RCEResult.sp` is missing or empty, gives `null`
ratios and capacitances with `unknownReason`; a library that was not freshly made for the
candidate is a receipt error (counterexample 1).

**`pixel-plan`** reads `state/round/plan.json` and checks it against `pixel.plan/1`, the resolved
Goal, `topologyMoves`, the manifest's layers and nets and the history's candidate ids. It emits
`pixel_plan_error_count` (count), `pixel_plan_front_points` (count), `pixel_plan_operator_count`
(count), `pixel_plan_edit_count` (count) and `pixel_plan_exploratory_points` (count).

**Sources of a number.** Every receipt field says `measured` (a tool report), `geometry` (Pack
geometry on the candidate's GDS), `estimated` (the surrogate) or `unknown`. Only `measured` and
`geometry` values are judged; `estimated` values only rank moves and are reported as such
(`INTENT.md` Business: what a person must never have to guess).

## Judge rules

The business judgments `evaluate` applies to the best candidate's `pixel-receipt` values, and that
`decide-round` applies to every judged candidate to find the best legal one. Each is a rule file of
this Pack; the outline and ratio rules are the Goal, every other one is a hard limit.

| Rule | Subject | Predicate |
|---|---|---|
| `receipt-verified` | `pixel_receipt_error_count` | = 0 |
| `drc-authority-1x1-clean`, `-2x2-clean`, `-3x3-clean` | `pixel_drc_authority_<tile>` | = 0 |
| `interact-rules-clean` | `pixel_interact_violations` | = 0 |
| `lvs-correct` | `pixel_lvs_correct` | = 1 |
| `channels-unchanged` | `pixel_channels_changed` | = 0 |
| `no-undeclared-change` | `pixel_undeclared_change_count` | = 0 |
| `couplings-within-limit` | `pixel_coupling_over_limit_count` | = 0 |
| `loads-within-allowance` | `pixel_load_over_limit_count` | = 0 |
| `transmittance-above-min` | `pixel_t_judged_pct` | ≥ `t_min_pct` (only when a lower edge is resolved) |
| `transmittance-below-max` | `pixel_t_judged_pct` | ≤ `t_max_pct` (only when an upper edge is resolved) |
| `outline-width-met` | `pixel_outline_w_um` | ≤ `outline_w_um` (Goal) |
| `outline-height-met` | `pixel_outline_h_um` | ≤ `outline_h_um` (Goal) |
| `ratio-met` | `pixel_ratio_judged_pct` | ≤ `ratio_target_pct` (Goal) |

A `null` subject gives `UNKNOWN`, which is never a PASS. A transmittance rule with no resolved edge
is `NOT_DECLARED` and is reported, not counted. The reference deck's counts are reported and never
judged. The executable task producing each judgment is `decide-round` (per candidate) and `evaluate`
(the delivered layout). Shaped by `one-checker-per-session.md` (a rule per deck and tile, nothing
summed) and `assert-the-checker-options.md` (`receipt-verified` comes first).

## Choosers

None as chooser files: in this versioned flow, `decide-round` is the decision task. It reads only
its committed input (the `solve-and-judge` output with every candidate's receipt values), the
committed history and the resolved Goal, and sets `route` (`continue`, `stop`), `nextRound`,
`stopReason` (`goal-met`, `converged`, `blocked`, `round-limit`) and the trust radius the next round
uses.

- **Best legal candidate.** Every hard-limit rule PASS. Ranked by: outline targets met (both before
  one, one before none), then the judged ratio, then cell area.
- **Goal met** when the best legal candidate passes `outline-width-met`, `outline-height-met` and
  `ratio-met`.
- **Converged** when the best legal candidate's judged ratio, at the best outline reached, improved
  by less than `convergeBandPct` over the last two rounds; the limiting bound (the binding pitch
  chain from `map-design-space`, or the coupling floor of the frozen-transistor terms from the
  model) is recorded with it.
- **Blocked** when, at a stop for convergence or the round limit, there is evidence that the unmet
  target needs a hard limit broken: a judged exploratory front point that meets it while failing a
  hard limit, or a minimum-pitch bound above the target outline with `topologyMoves` `off`.
- **Round limit** when the round number reaches 6 with the Goal unmet.

Shaped by `over-constrain-and-read-the-violation.md` (the target pitch is tried first; infeasibility
and residual markers are read as a measured shortfall, and a relaxed pitch is a proposed next trial,
not a result) and `end-honestly-in-more-than-one-way.md`.

## Endings

`evaluate` is the terminal decision task; `deliver` packages what it decided. Its output carries
`ending` and `goalMet`. Successful execution of the Run and Goal achievement are separate facts:
every ending below completes the Run with a valid delivery.

- **Goal met** (`ending: goal-met`, `goalMet: true`): reached when the last `decide-round` stopped
  with `stopReason: goal-met` and the fresh re-judgement in `evaluate` confirms every rule PASS. If
  the re-judgement disagrees, the ending is the one the re-judged values support, and the
  disagreement is reported.
- **Blocked by a hard limit** (`ending: blocked`, `goalMet: false`): reached from
  `stopReason: blocked`. The delivery carries a Decision Request with the trade-off table (each
  front point's outline, ratio, the hard limit it breaks and by how much) and the best legal
  layout.
- **Converged** (`ending: converged`, `goalMet: false`): reached from `stopReason: converged`, with
  the limiting bound and the best legal layout.
- **Budget reached** (`ending: budget-reached`, `goalMet: false`): reached from
  `stopReason: round-limit`, or when the repeat ended at the work deadline with the last route still
  `continue`. Stated as running out of budget, with the best layout so far and its shortfall, never
  as a conclusion (`INTENT.md` Answers 3).

When no candidate is legal at all, every ending still delivers: the best candidate by fewest hard
failures, marked not legal. A failed `prepare-case` or `judge-original` is a task failure with
repair information, not an ending: the case or the judge must be fixed first.

## Workshops

None. The resident's work is the complete engineering task `plan-round`, outsourced through its
declared tool; it writes no Pack code and no Workshop is bound.

## Knowledge

The Pack's own files under `knowledge/`, named by `contract.yml` and given to `plan-round`:

- `pixel-design-space.md`: what makes up Ct and Cs in a pixel of this kind, the coupling sites, the
  levers and what each costs (scan-line load for a shield, area for a stretch), and the bounds.
  For `plan-round` choosing operators and front points.
- `optimisation-method.md`: the LP compaction with metric rows, the Dinkelbach form of the ratio,
  the trust region, the surrogate and its error, front points, and how a measured shortfall is
  read. For `plan-round` reading the card and setting front points.
- `plan-and-repair-playbook.md`: the resident's whole brief: inputs, the CLI subcommands, the plan
  schema with an example, the marker classes and what each calls for, bounded edits, prohibitions,
  and the journal discipline (a hypothesis before anything runs; never repeat a closed one). For
  `plan-round`.
- `judge-protocol.md`: how each candidate is judged, which deck is the authority, tiles, the LVS
  engine, the fresh library per extraction, measured vs geometry vs estimated vs unknown, and the
  four counterexamples. For `plan-round` reading receipts and markers honestly.
