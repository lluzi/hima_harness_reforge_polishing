# Placement playbook

## Source

- Spec §2, §4, §7, §7.1, §7.2, §9 ("best measured state"); `mage-frozen-interfaces.md` module
  signatures for `planner.py`, `metrics.py`, `rounds.py`; `flow/mage_placement_cli.py`.

## Workspace convention (every role)

Your task envelope names two different directories — do not confuse them. `workspace` is your own
private, writable task workspace; `identity.campaignWorkspace` is the Campaign workspace, mounted
read-only. Every CLI call's `WORKSPACE` positional argument is your private `workspace`, never
`identity.campaignWorkspace`. Before your first call, copy each file named in the envelope's
`inputs[]` from its Campaign-workspace path into your private workspace at the same
workspace-relative path (for example `state/case-readiness.json`, `state/start-snapshot.json`), and
verify each copy's sha256 against the envelope entry before trusting it — copy nothing else.
Invoke the CLI from the envelope's `task.flow` copy (the Campaign's read-only `flow/`), passing your
private workspace as `WORKSPACE`. Your result document's path and every support path in
`resident-delivery.json` are relative to that same private `WORKSPACE`; a support path must start
with your tool's own `artifactPrefix` (`placement/` or `reviews/<role>/`) — that is exactly the path
the Host gives it once copied into the Campaign workspace, which is what the Reader sees.

## Objective

Each round you receive the previous round's open Requests (from `state/round-decision.json`) and
the frozen start state. You produce one new candidate placement, run it through MAGE, measure it,
and answer every open Request in the Ledger — `satisfied`, `alternative`, or `declined` with
evidence. You are the only role in this Pack that may hold the MAGE licence, drive the one MAGE
session, or write a candidate PLA.

## Fixed boundary — you may not change

The rule file, the target table, any consumer model, or the Goal limits
(`target_dropped_count`, `max_target_distance_um`, `max_order_deviation`). Group target points
(`targetPointDbu`) never move — a Group mark may be repositioned within its own window, but its own
declared CT target is fixed input, not something you edit.

## The loop: observe, diagnose, plan, apply, judge

**Observe.** One MAGE round = `mage-round --round <n> --pla <candidate.pla> --role engineer
--out-dir placement/round-NN [--fill] [--experiment <file>]`, which runs the five templates
(`mage-capabilities.md`) and returns an exported PLA plus the three native verify files (OVERLAP,
SPACE, BOUNDARY). Pass `--fill` to run the Pack's auto-refine stage after the replay (MAGE compacts
from your move, as the proven native route does); round 1 replays the frozen start with `--fill` to
reproduce the native incumbent before you change anything. Parse the round into a snapshot with
`candidate --round <n> --round-dir <dir> --ledger <file> --out
state/round/placement-candidate.json`.

**Plan on the start snapshot — always `state/start-snapshot.json`, never a filled export's
snapshot.** The whole mechanism is: plan on the priority-only start, move the priority marks in the
start PLA, then replay that PLA with `--fill` so MAGE places the ordinary structures into the
windows you opened. In a filled export's snapshot every ordinary structure is already placed, so the
planner sees each one as an immovable intruder and correctly reports no window — plan there and you
will conclude "0 feasible slots" even when real windows exist. So the `plan-slots --snapshot`
argument is `state/start-snapshot.json` every round (round 2 included), and the PLA you apply moves
to is the manifest's `startState` path (from `state/case-readiness.json`), never last round's
export. The first live rounds failed exactly this way: round 1 reproduced the incumbent correctly,
then round 2 planned on the FILLED snapshot, found no windows, replayed the incumbent again, and
declined every Request. Plan on the start snapshot and the windows are there.

Every delivered round must carry the full ordinary population: fill it with `--fill`, or an
`--experiment` that itself places or drops every ordinary structure. A round whose export omits
ordinary structures is refused by the Reader as an inventory failure
(`ordinary population <n> != incumbent <m>`), never accepted as fewer drops — the required count is
the incumbent's own ordinary population, so a priority-only export reads as zero drops and is
rejected rather than kept as best.

**Diagnose** every drop or every target-distance/order deviation beyond the Goal limit with a
named, deterministic cause before acting on it — never guess which fix to try first:

1. **fragmentation** — the lane has enough total free space but no single contiguous window fits
   the structure (check `lane-view`/`project`'s `freeIntervals`).
2. **order-limited** — the structure's own window is feasible, but satisfying it would displace a
   higher-priority (Group/`priority: true`) item out of its window.
3. **limit-limited** — the only feasible slot is beyond the declared `max_target_distance_um`.
4. **capacity-limited** — `plan_lane`'s own feasibility check (`max_slots`) says fewer slots fit
   than the count requested, even with every relaxation.
5. **rule-unknown** — a rule fact (`gridDbu`, `spaceDbu`, `scribeInc`/`scribeExc`, `zoneRaw`) needed
   to place this item is missing or unparsed; the planner used a declared default and flagged it.
6. **identity-unknown** — the F8 class (`state-and-evidence.md`): a target cannot be bound to
   exactly one Group/Fit by exact `targetPointDbu` match.

**Action order** (try each in turn; stop at the first that resolves the issue):
reserve-first placement for priority (Group) marks → squeeze within limits with the exact slot
planner (`plan-slots`) → relocate non-priority structures to make room → only then, if no placement
resolves a genuine consumer conflict, leave it for a Decision Request (written by `decide-round`,
never by you).

**Plan — which keys, which lanes, exact commands.** Take the dropped structure ids from
`state/incumbent.json` (`metrics.drops.ids`, split by `metrics.drops.byBlockType`). For each dropped
structure, read its pending entry in `state/start-snapshot.json` and derive its long side and
orientation from `sizeDbu` (`[widthDbu, heightDbu]`): long side along x → it belongs in an `H:*`
lane; long side along y → a `V:*` lane. Then, for every lane of that orientation (list them from the
start snapshot's `lanes[*].laneId`), plan the number of such keys still dropped:

```
plan-slots --snapshot state/start-snapshot.json --lane <lane> --length-um <long side in um>
  --count <number of such keys still dropped> --limit-um <Goal max_target_distance_um> --out <plan>
```

`plan-slots` is the exact planner (`mage-capabilities.md` lists no heuristic substitute; see
`mage-frozen-interfaces.md` for `max_slots`/`fewest_moves`/`least_displacement`). Fewer than the
requested slots means "infeasible within this model at this limit", never "native infeasible": you
have not run MAGE yet at that point.

**Apply — turn the feasible plans into one candidate PLA with `apply-plan`.** Never edit PLA text by
hand. `apply-plan WORKSPACE --pla <manifest startState path from state/case-readiness.json> --plan
<each feasible plan> --out placement/round-NN/candidate.pla` moves exactly the priority marks each
plan names, along each lane's own axis, to the planned positions; it leaves every Group
`targetPointDbu`, every Fixed instance, every drop and every unmoved Fit untouched, and refuses a
plan that is infeasible, moves an unknown id or a Fixed instance, or moves the same id twice. Pass
one `--plan` per feasible plan (at least one is required). Then replay and fill:

```
mage-round --round <n> --pla placement/round-NN/candidate.pla --role engineer
  --out-dir placement/round-NN --fill
candidate --round <n> --round-dir placement/round-NN --ledger <file>
  --out state/round/placement-candidate.json
```

`--fill` is what makes MAGE drop the ordinary structures into the windows you opened; a replay
without it exports no ordinary population and the Reader refuses it (see below).

**Attempts, in order.** The plain `plan-slots` above is attempt 1. If a lane is infeasible, attempt
2 adds `--relaxed` (same planner, spacing/keep-out/zone ignored, crossing intruders removable,
clusters splittable); attempt 3 adds `--movable-nonpriority <um>`, which lets the planner shift an
ordinary (non-priority) structure within that budget to open room — `apply-plan` only accepts an
ordinary-fit move from a plan produced this way. Report which attempt a plan came from; a relaxed or
movable-nonpriority plan is a weaker claim than a plain one.

**Judge** by the round's own native checks (`metrics.native_rows`, the three checks OVERLAP/SPACE/
BOUNDARY) and this round's Q1–Q4 metrics
(`metrics_mod.drops`/`target_distances`/`order_deviation`/`displacement`). Two of these measure
different things and must never be conflated: **movement from the start** (`displacement`, how far
each Fit moved from the frozen start) versus **absolute error from the CT target**
(`targetDistances`, how far a bound Fit sits from its own CT point). Report both; never rename one as
the other. Keep the new candidate
only if it is no worse than the previous best by the best-state order below; otherwise deliver it
anyway as the honest best-effort result and say why in `stopReason`.

Compare this round's candidate `metrics.drops.ordinary` against both `state/incumbent.json` and the
previous best, and make `stopReason` say two separate things: what the planner *opened* (how many
windows `plan-slots` reported for the dropped keys, in which lanes) and what MAGE actually *filled*
(the change in `drops.ordinary` the `--fill` export produced). "Planner opened 15 windows for the 3
dropped long keys; fill placed 3, ordinary drops 26 → 23" is the shape to aim for — never report the
planner's window count as if it were a placement.

**Answer `move` Requests honestly, including about pre-existing deviations.** A target already
beyond the limit in the frozen start is a pre-existing condition, not something this round broke. If
no slot exists to bring it back toward its CT target, answer `declined` with a note of the form
`pre-existing in start state; restoring it toward its CT target requires a slot the planner reports
as <reason>` (the `<reason>` being `plan-slots`' own infeasibility: fragmentation, order-limited,
limit-limited or capacity-limited). If the move was made, answer `satisfied`. Never silently decline
a move you did not actually attempt to plan.

## Best measured state (lexicographic; natively measured only)

In order: no new native violation row versus the start → all priority marks placed → fewer consumer
hard failures → fewer dropped structures (count, then total long-side length) → fewer priority marks
beyond the limit → lower max order deviation → lower total consumer rework → fewer moved instances →
lower total displacement. Never reorder these, and never substitute a modelled number for a native
one in this comparison (`state-and-evidence.md`).

## Delivery shape

`candidate` assembles and validates `mage.placement-candidate/1` for you from the round's own export
and verify files — you never hand-build this document. Its required fields: `identity` (task/run/
execution/node + `round`), `startSnapshotSha256`, `snapshotSha256`, `buildBanner`, `files`
(`pla`/`export`/`snapshot`/`verify{TYPE}`/`sessionLog`/`scripts[]`, each `{path, sha256}`),
`metrics` (`drops`/`targetDistances`/`orderDeviation`/`displacement`/`nativeRows`), `ledger[]`
(your answers to the previous round's Requests), `remaining[]`/`blocked[]`/`unknown[]` (each an
object, never a bare string), `outcome` (`completed`/`best-effort`/`blocked`), `stopReason`,
`reproduction`.

In your own private `WORKSPACE` (never `identity.campaignWorkspace`, the read-only Campaign
workspace — see "Workspace convention" above), write
`resident-delivery.json`: `{"schema": "hima-resident-engineering-candidate/1", "outcome",
"summary", "stopReason", "artifacts": [{"path", "sha256", "kind"}]}` with exactly one
`kind: "result"` entry naming `state/round/placement-candidate.json` and **every file this round
produced under `placement/round-NN/` after `candidate` has run** as `kind: "support"`, each hashed
with its real sha256. That support set is, concretely: the candidate PLA (`candidate.pla`),
`round.tcl`, `experiment.tcl` (when you ran one), `session.jsonl` (the MAGE session log, written
inside this round directory under your own `artifactPrefix`), `round-summary.json`, and everything
under `out/` -- `out/export.pla`, `out/snapshot.json` (written by `candidate`, referenced by
`files.snapshot`), every `out/verify-<TYPE>.txt`, `out/summary.txt`, `out/stdout.log` and
`out/stderr.log`. Publishing `out/snapshot.json` is mandatory: the consumers and the Reader bind to
it, and omitting it makes the candidate Reader refuse the delivery. Never invent an artifact's hash;
recompute it from the file you just wrote. A retried attempt lives under
`placement/round-NN/attempt-K/` (K >= 2) and you deliver that attempt's own directory the same way.

List only files you yourself wrote under your own `artifactPrefix` (`placement/round-NN/…`) as
`kind: "support"`. Never list an input you merely read or copied — `state/case-readiness.json`,
`state/start-snapshot.json`, `state/round-decision.json`, or any file under `reviews/<role>/` —
as a support artifact: these already exist in the Campaign workspace under someone else's prefix
or your own read-only inputs, and the Host's `materializeEngineeringResult` refuses the whole
delivery, leaving the Run waiting with no message back to you, the moment one support path falls
outside your own `artifactPrefix`. See `review-protocol.md`'s "Delivery: list only your own
output" for a worked correct example for both the Engineer and a consumer.

## Prohibitions

Never fabricate a candidate the `candidate` subcommand did not itself assemble from an actual
`mage-round` export and verify set. Never run a mutating script under any role but `engineer`
(`mage-capabilities.md`). Never leave a previous round's open Request unanswered in the Ledger.
Never report a modelled metric where a native one is required for the best-state comparison. Never
touch the rule file, target table, consumer models, or Goal limits.
