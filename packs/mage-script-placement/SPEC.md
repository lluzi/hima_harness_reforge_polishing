# MAGE script-method test-structure placement 0.1.0 run contract

## Goal template

The declared Goal is five knobs the final evaluation checks the best measured state against:
`target_dropped_count` (count, default 0), `max_target_distance_um` (µm, default 100),
`max_order_deviation_lr` (rank, default 2), `max_order_deviation_tb` (rank, default 1), and
`max_priority_move_um` (µm, default 100 — movement of a priority mark from the frozen start, by
optimisation; explicit and Run-settable, never assumed universal). Strategy knob
`incumbentComparison` (`retained`/`native`, default `retained`) selects which incumbent basis
`evaluate-placement` compares against; it cannot change the round limit, which is fixed at
`graph.yml`'s `maxIterations: 6`.

## Constraints

The case manifest, rule file, pblock/block files, target table, and request order stay fixed for
the whole Run; only the Engineer's stage scripts and the candidate they produce change between
rounds, and even then every Group's own target point is frozen input, never edited. A documented
settings choice through Tcl (an offset-range relaxation, a converge count) is allowed; a change to
what placements the case permits is a rule edit and is prohibited. `siteCapabilities` names the
Site's MAGE executable and environment; only `engineer-script` holds the `mage: 1` licence
`licences` declares, and it is the only tool that ever opens the case. The manifest's
`referenceMethod` field (a required `fileRef`, digest-verified like every other manifest file)
names the customer's own entry script; `referenceFiles` (array) and `referenceNotes` (optional
array) are further digest-verified Site material; `referenceOrdinaryDropLengthUm` (optional number)
is the customer's retained ordinary dropped length, read only by the proof-level report. Units are
integer DBU inside the Pack; µm only at the boundaries (vendor text, reports). Python is
3.8-compatible standard-library only (the resident container runs 3.8.16); no numeric, YAML, or
JSON-Schema dependency ships in `flow/`.

## Run contract

`graph.yml` declares one `hima-flow/1` sequence:

| Task | Inputs | Work and committed output |
|---|---|---|
| `prepare-case` | Run `mageCaseManifest`, `siteCapabilities`, `workspaceRoot`; the five goal values | Verifies every manifest digest, including `referenceMethod`/`referenceFiles`/`referenceNotes`; parses rule/pblock/block/target/request-order; builds and stamps `startSnapshot`; writes `case-readiness.json` (goal, manifest, siteCapabilities, the `reference` block) and the round-0 `round-decision.json`; writes the empty `method-journal.json`. |
| `measure-incumbent` | Committed `prepare-case` output; strategy | Normalises the retained incumbent PLA into a snapshot, measures it with the same metrics used on every candidate, labelled modelled; records its ordinary population as the inventory anchor. |
| `repeat script-rounds` (`maxIterations: 6`, carry `roundState`, stop on `decide-round.route == stop`) | — | Runs the round `sequence` below once per iteration. |
| `engineer-script` (resident, `licences: {mage: 1}`) | `ROUND`, `SITE_CAPABILITIES`, the five goal values | Owns one round: writes its hypothesis, authors and runs Tcl stage scripts via `mage-stage`, reads boundaries via `stage-report`, delivers a Reader-verified `mage.script-candidate/1` at `state/round/script-candidate.json` with its journal entry. |
| `decide-round` (program) | Committed Reader value of `engineer-script`; `ROUND`; goal values | Ranks the round's candidate against the best state so far by Reader values only, appends the round's journal entry to `state/method-journal.json`, archives the candidate under `state/history/round-NN/candidate.json`, routes `continue`/`stop`, writes `round-decision.json` and `state/script-result.json`. |
| `evaluate-placement` (`budget: closing`) | Committed `decide-round` value; `measure-incumbent` value; goal | Evaluates the best state's own Reader values against the eight delivery rules; reports the proof level and the comparison against the incumbent and the reference; `goalMet` explicit, unknowns kept separate. |
| `deliver` (`budget: closing`) | Committed evaluation | Rechecks every referenced digest; writes `delivery/report.json` and packages every round's stage scripts, boundary snapshots, exports, verify files, session logs, journal and result/evaluation JSON into the final delivery with `REPORT.md`. |

## The stage driver and markers

`mage-stage --round <n> --script <file> --out-dir placement/round-NN/stage-K [--timeout-s <s>]`
wraps the Engineer's agent Tcl in a prelude (`hima_open_build`, `hima_snapshot`, `hima_check`, the
case path variables) and an epilogue (the three native checks, the export, the
`MAGE_ROUND_END code 0` completion marker), behind a refusal gate (`exit`, `frbOpen`, any `MAGE_*`
marker text, redefining a `hima_*` proc, or the `hima:` fence text, each refused before anything is
written; only role `engineer` may run a stage). Completion is judged by the `MAGE_ROUND_END` marker
in the captured stdout, never by the process return code alone — the Site's vendor launcher exits 0
even on a licence-checkout failure or a mid-script error. Every stage, successful or not, appends
one line to the round's `session.jsonl` log. `stage-report --stage-dir <dir> --out <file>` turns
every boundary snapshot (and the final export, when completed) into one row of Fixed/Group/Fit
counts, drops, inventory status, target distance, order deviation per side, priority movement, and
native counts.

## Semantics

A fail-closed Reader (`tools/read-mage.py`, `readers/mage-script-candidate.yml`) re-derives every
fact rather than trust the resident's own claim: schema-validates the candidate and its journal
entry, re-hashes every referenced file (script, assembled stage, export, every boundary snapshot,
session log, journal), re-parses the export and rebuilds the snapshot (its sha must match the
declared `snapshotSha256`), checks inventory conservation (Fixed set, Group labels, per-Group
in-group count, ordinary population from `state/incumbent.json`), and audits the session log (every
logged stage is role `engineer`; a completed candidate's log holds an entry whose `stageSha256` and
`exportSha256` match the delivered files). A blocked candidate (no completed export) reads error 0
and every other fact unknown — it claims no metric. Recomputed drops split into
`mage_dropped_ordinary_count`/`mage_dropped_ordinary_length_um` alongside the existing
`mage_dropped_count`/`mage_dropped_length_um` totals; the ordinary length is the comparison
objective against the incumbent or the reference, never the total.

## The eight rules

Evaluated in `evaluate-placement` from the best state's own Reader values: `placement-delivery-ready`
(candidate error count = 0), `priority-all-placed` (unplaced = 0), `no-native-violation` (native
violation total = 0), `drops-within-goal` (dropped count ≤ `target_dropped_count`),
`target-limit-met` (max target distance ≤ `max_target_distance_um`), `order-lr-within-goal` (max LR
order deviation ≤ `max_order_deviation_lr`), `order-tb-within-goal` (max TB order deviation ≤
`max_order_deviation_tb`), `priority-move-within-budget` (max priority movement from the frozen
start ≤ `max_priority_move_um`). `goalMet` = all eight PASS. An unknown value makes its rule UNKNOWN
and `goalMet` false.

## Proof levels

Reported by `evaluate-placement`, never enforced by a rule, from the best state's ordinary dropped
length L and the incumbent's `ordinaryPopulation`: `none` (no completed round), `reproduction` (L
equals the incumbent's modelled ordinary length within 0.5 µm and inventory conserved),
`improvement` (L below the incumbent's, all priority placed, inventory conserved), `match` (L ≤ the
manifest's optional `referenceOrdinaryDropLengthUm`, with all priority placed), `surpass` (strictly
below it with every rule PASS except possibly `drops-within-goal`), `completion` (all rules PASS and
L = 0).

## Endings

A valid delivery proceeds through `evaluate-placement` and `deliver` even when `goalMet` is false —
a complete best-effort result with an honestly reported quantified failure analysis of compaction
is not a Task failure. Missing inputs or evidence remain actionable Task failures; cancellation,
budget enforcement, and durable recovery stay Runtime responsibilities.

## Knowledge

`script-method-playbook.md`, `mage-capabilities.md`, `state-and-evidence.md`, and
`reference-method-guide.md` carry the mechanism the Engineer needs; `role-script-engineer.md`
carries the Engineer's own complete brief, consistent with its `contract.yml` tool description.
