# MAGE scribe-line placement 0.2.0 run contract

## Goal template

The declared Goal is three knobs the final evaluation checks the best measured state against:
`target_dropped_count` (count, default 0), `max_target_distance_um` (µm, default 100), and
`max_order_deviation` (rank, default 1). A complete best-effort delivery can leave any of these
false; `goalMet` stays explicit either way. Strategy knob `incumbentComparison`
(`retained`/`native`, default `retained`) selects which incumbent basis `evaluate-placement`
compares against; it cannot change the round limit, which is fixed at `graph.yml`'s
`maxIterations: 4`.

## Constraints

The case manifest, rule file, target table, request order, and consumer models stay fixed for the
whole Run; only the Engineer's candidate PLA changes between rounds, and even then every Group's own
`targetPointDbu` is frozen input, never edited. `siteCapabilities` names the Site's MAGE executable
and environment; only `engineer-place` holds the `mage: 1` licence `capacity.licences` declares. The
manifest's optional `referenceMethod` field (a `fileRef`, digest-verified like every other manifest
file) names an external baseline/reference method's own script; it is read-only reference material
the Engineer may consult for compaction knobs and is never replayed as a result.
Units are integer DBU inside the Pack; µm only at the boundaries (vendor text, reports);
`dbuPerUm` comes from the manifest (the frame case: 10000); the placement grid is 100 DBU (0.01 µm) unless the
rule file says otherwise. Python is 3.8-compatible standard-library only (the Linglong resident
container runs 3.8.16); no numeric, YAML, or JSON-Schema dependency ships in `flow/`.

## Run contract

`graph.yml` declares one `hima-flow/1` sequence:

| Task | Inputs | Work and committed output |
|---|---|---|
| `prepare-case` | Run `mageCaseManifest`, `consumerContext`, `siteCapabilities`; Goal values | Verify every manifest digest; parse rule/pblock/block/target/request-order; build and stamp `startSnapshot`; write `case-readiness.json` and the round-0 `round-decision.json` (`route: continue`, no open Requests). |
| `measure-incumbent` | Committed `prepare-case` output; strategy `incumbentComparison` | Normalise the retained incumbent PLA into a snapshot; evaluate it with the same metrics and consumer evaluators as every candidate, labelled modelled. |
| `repeat placement-rounds` (`maxIterations: 4`, carry `roundState`, stop on `decide-round.route == stop`) | — | Runs the round `sequence` below once per iteration. |
| `engineer-place` (resident, `licences: {mage: 1}`) | `ROUND` (carry), goal values | One MAGE round via `mage-round --round <n> --pla <file> --role engineer --out-dir placement/round-NN [--fill] [--experiment <file>]` on the Site's proven native route (open-build → replay-pla → experiment, if any → fill, if `--fill` → the three native checks → export); assembles and Reader-verifies `mage.placement-candidate/1` at `state/round/placement-candidate.json`. |
| `review-litho-pie` / `review-metrology` / `review-alignment` / `review-wat` (resident, no licence) | `ROUND` (carry) | Each reads the current candidate, runs `evaluate` under its own consumer model, and assembles a Reader-verified `mage.consumer-review/1`. |
| `decide-round` (program) | Committed Reader values of the five resident tasks; `ROUND`; goal values | Checks every previous-round open Request has a Ledger answer; updates the best measured state; turns consumer conflicts into Decision Requests; routes `continue`/`stop`; writes `round-decision.json` and the cumulative `placement-result.json`. |
| `evaluate-placement` (`budget: closing`) | Committed `decide-round` value; `measure-incumbent` value; goal values | Evaluates the best state's own Reader values against the seven delivery rules; computes the completeness/fidelity/rework/legality comparison against the incumbent; `goalMet` explicit, unknowns kept separate. |
| `deliver` (`budget: closing`) | Committed evaluation | Rechecks every referenced digest; writes `delivery/report.json` and packages every round's candidate/review documents, PLAs, native verify files, session logs, scripts, and the result/evaluation JSON into `delivery/placement-artifacts.tar.gz`. |

The round-decision stop rule: `stop` when (no consumer hard failure and no open Request) or (two
consecutive rounds without improvement on any axis) or (`round == 4`, which `maxIterations` also
enforces); otherwise `continue`.

## Native route and checks

`mage-round` runs the Site's proven native route (the five templates in `flow/templates/`), not the
old `smVerify` family. It runs exactly three native checks — `OVERLAP` (`frbCheckOverlap`), `SPACE`
(`frbCheckSpace`) and `BOUNDARY` (`frbCheckBoundary`) — and writes one `out/verify-<TYPE>.txt` per
check from MAGE's own `MAGE_VERIFY_*` stdout markers, each headed
`# mage-verify/1 type=<T> command=<cmd> instances=<N>` (the instance count is MAGE's own; a SPACE
row is one offending instance, not a pair). `mage_native_violation_total` is the sum of the three,
unknown whenever any one is unknown; `smVerify` is D-status only. The vendor launcher returns 0
even on failure, so a round counts as `completed` only when the return code is 0, it did not time
out, and the `MAGE_ROUND_END code 0` marker is present; otherwise the candidate's outcome is
`blocked`. `--fill` appends the Pack's auto-refine stage (converge lines from the manifest's
`mage.autoRefineConverge`, then `g_params ... false`, then `smPFlow -autoRefine`); `--experiment`
sources an Engineer-authored Tcl file (refused if it contains `exit` or `frbOpen`), recording its
sha256 in the candidate.

`apply-plan WORKSPACE --pla <start.pla> --plan <plan.json> [--plan ...] --out <candidate.pla>` is
the Engineer's helper for turning one or more `plan-slots` plans into a replayable candidate PLA
(so the resident never hand-edits PLA text). It reads the start PLA and each `mage.slot-plan/1`
plan, moves exactly the Fit each plan's `moves` names along the lane's own axis (`H:*` along x,
`V:*` along y) so its along-start equals the planned position — keeping the cross coordinates and
the box size — and leaves every `pinstGroupProperty` Group target point, Fixed instance, drop and
unmoved Fit byte-for-byte equivalent. It refuses an infeasible plan, a move of an unknown id or a
Fixed instance, two plans moving the same id, and a move of an ordinary (empty-`inGroup`) Fit
unless the plan was produced with `--movable-nonpriority` (recorded as the `movableNonpriority`
token in the plan's `model.relaxations`). At least one `--plan` is required. It writes the complete
candidate in micrometres (`pla.write_pla(..., units="um")`) and prints a
`{movedCount, totalDisplacementUm, maxDisplacementUm, lanes, out}` summary to stdout; the replay
mechanism is plan on `state/start-snapshot.json` → `apply-plan` the start PLA → `mage-round
--fill`, so MAGE places the ordinary structures into the opened windows.

### Reserve-first method (2026-10-12)

The controller proved, with real MAGE on the real case, that opening a scribe-lane window *and*
reserving the dropped long structure into it as an ordinary Fit before the fill reduces the ordinary
drops legally (OVERLAP 0, BOUNDARY 0). Three flags realise it on top of the plain move, all scoped
to `plan-slots`/`apply-plan` (no new module): `plan-slots --interior` shrinks an interior lane's
along range by one scribe width (the lane model's own cross-range width) at each end so a moved mark
cannot enter the exterior frame-edge band MAGE refuses, keeping full range on a shared-exterior lane
or an already-occupied edge band and recording `model.interior`/`model.interiorShrunk`;
`apply-plan --follow-groups` (default on, `--keep-group-points` to disable) shifts each moved Fit's
Group target point by that Fit's delta, matching MAGE's own Group-point rewrite; and `apply-plan
--reserve <incumbent export.pla|snapshot.json> --reserve-length-um <um>` places every dropped long
structure of the stage's lane orientation (from each item's rule-fact `scribeInc` in the start
snapshot: `["VERT"]`→V, `["HORIZ"]`→H, else neither) into the plans' slot starts with 1 um clearance
and a lane-direction box, reporting `reserved`/`unreserved` and refusing a mixed-axis `--plan` set.
A default `--straddle-guard` post-pass nudges every moved mark clear of a lane crossing band within
its CT window, or reverts it and removes the keys it then blocks, reporting
`nudged`/`reverted`/`keysRemoved`. The full sequence is V lanes `--interior` → `apply-plan
--reserve` → `snapshot --stage candidate` → H lanes `--interior` → `apply-plan --reserve` →
`mage-round --fill` → `candidate`.

## Semantics

Two Readers (`tools/read-mage.py`, one script backing both `readers/*.yml` declarations) re-derive
every fact from the referenced files rather than trust the resident's own claim. The candidate
Reader re-hashes every referenced file, re-parses the export into a snapshot and checks its sha
against the declared `snapshotSha256`, recomputes drops/target-distance/order-deviation/native rows,
checks every previous round's open Request has a Ledger answer, and checks the session log has no
mutating round logged under any role but `engineer`. The review Reader checks the review binds to
the current candidate's snapshot sha, re-runs the evaluator under the declared consumer model
version, and refuses any Finding whose fields the code does not reproduce. Either Reader rejects a
mismatch; the rejection returns to the same resident Task as a repair message.

The candidate Reader's recomputed drops split into `mage_dropped_ordinary_count`/
`mage_dropped_ordinary_length_um` (empty `inGroup` — not Group-placed) alongside the existing
`mage_dropped_count`/`mage_dropped_length_um` totals; the ordinary length is the comparison
objective against any external baseline or `referenceMethod`, never the total (a dropped
Group-placed/priority mark is already a `priority-all-placed` failure on its own). The Reader also
emits `mage_target_over_limit_new_count` (marks this Run moved beyond the limit, from
`metrics.target_regressions` against the frozen start) and `mage_moved_count` (Fits moved from the
start, which `decide()` uses to recognise the native anchor).

Consumer severities follow the Run owner's Goal. A consumer's `target_distance` limit resolves
Goal-first (`max_target_distance_um`), then its own `consumerContext` key; a hard `target_distance`
requirement fails only on a mark this Run moved beyond the limit, while pre-existing and
moved-closer-but-still-over marks become one `cost` Finding, and a differing consumerContext limit
is kept as a further `cost` Finding. WAT's `placed` requirement is `cost` (a dropped ordinary test
key's acceptability is the Run's `target_dropped_count`, not a consumer hard veto); litho-pie's
`placed` stays hard for priority marks.

Inventory conservation (`snapshot.check_inventory_conservation`, shared verbatim by the candidate
assembler and the Reader) is checked at the level real MAGE output actually conserves — the Group,
not the exact instance id or the base master. A fresh auto-refine replay fills a priority-only start
into a much larger export: it adds many new masters the start never named and re-suffixes or even
re-masters an in-group priority instance while keeping it in its Group, so an id-exact or per-base
count refuses a genuine MAGE result. Conservation therefore requires: equal Fixed instance-id set,
equal Group-label (`pinstGroup`) set, and an equal count of in-group (priority) instances per Group —
a deleted or extra priority mark breaks a Group's count. The ordinary (non-group) population is fluid
in its ids and masters but is conserved as a count (N7): a delivered round must carry the same
ordinary Fits + ordinary drops the incumbent does (`ordinaryPopulation` in `state/incumbent.json`,
measured once by `measure-incumbent`), so an export that simply omits ordinary structures — reading
as fewer drops and a shorter dropped length — is refused rather than kept as a false improvement. The
required count is the incumbent's measured ordinary population, never the start's (larger)
rule-derived pending count.

N6 — self-reported vs recomputed: the candidate document and `measure-incumbent` build their own
`metrics` (the incumbent comparison table in the final report is assembled from `best.metrics`, the
candidate's own numbers). The Reader recomputes only the *emitted facts* it ranks and rules on
(`mage_*` values), not that whole report table, and never asserts `doc.metrics` equals its
recomputation. The authoritative, model-independent check on the delivered numbers is therefore the
external evaluation in the live-proof procedure — the kit's own `tools/evaluate.py` and the cold
replay (Task 16) — which must run and reconcile before any Pack number is quoted as commercial
evidence.

## Judge rules

Seven rule files, evaluated in `evaluate-placement` from the best state's own Reader values. Three
of them judge the Run's own contribution, never conditions it inherited from the frozen start:
`placement-delivery-ready` (candidate error count = 0), `priority-all-placed` (unplaced = 0),
`no-native-violation` (a composite: when a native anchor exists — round 1's faithful reproduction of
the start, recorded by `decide()` — zero native rows *beyond* that anchor per type; with no anchor,
the absolute native-row total = 0), `drops-within-goal` (dropped count ≤ `target_dropped_count`),
`target-limit-met` (zero marks this Run *moved* beyond `max_target_distance_um`; a mark already
beyond it in the frozen start is pre-existing, reported but never counted), `order-within-goal` (max
order deviation ≤ `max_order_deviation`), `no-open-requests` (evaluated against the delivered state:
no open Request and no outstanding Decision Request in the final round-decision, and no consumer
hard-fail Finding in the best round's reviews). `evaluate-placement` reports both the absolute and
the Run-owned view under `regressionBasis`.

## Endings

A valid delivery proceeds through `evaluate-placement` and `deliver` even when `goalMet` is false —
a complete best-effort result with honestly reported residual drops, distance violations, or open
Decision Requests is not a Task failure. Missing inputs or evidence remain actionable Task failures;
cancellation, budget enforcement, and durable recovery stay Runtime responsibilities.

## Knowledge

`placement-playbook.md`, `mage-capabilities.md`, `state-and-evidence.md`, and `review-protocol.md`
carry the mechanism every role shares or needs its own slice of; the five `role-*.md` files carry
each resident's own complete brief, consistent with its `contract.yml` tool description.
