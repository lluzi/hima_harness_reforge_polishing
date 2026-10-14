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

## What this Run is judged on (its own contribution, not the inheritance)

`max_target_distance_um` is the budget a mark *you move* may end from its requested CT target. A mark
already beyond it in the frozen start is pre-existing — reported, never counted as this Run's
regression, and never a reason to decline the whole round. Move a pre-existing-over mark closer only
when `plan-slots` finds a slot within the budget; otherwise leave it and answer its Request
`declined … pre-existing` (below). `target-limit-met` fails only on a mark this Run moved beyond the
limit, never on inherited excess.

The native checks are read the same way, against a native anchor. Round 1 replays the frozen start
with `--fill` and moves nothing: that faithful reproduction is the native anchor, so the incumbent's
own native fill (which may already carry, say, a SPACE row) is never counted as this Run's
violation — `no-native-violation` then counts only rows a later round introduces beyond the anchor.
A round that moved any mark can never be the anchor; the anchor is the first completed round that
moved nothing — round 1 in the proven workflow. If round 1 moved a mark, a later faithful
reproduction can still become the anchor; until one exists, `no-native-violation` judges the
absolute native-row total (zero rows in all).

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

**Plan and apply — the reserve-first sequence, vertical lanes then horizontal.** This is the method
the controller proved with real MAGE on the real case: it reduces the ordinary drops legally
(OVERLAP 0, BOUNDARY 0) by opening a window in a scribe lane *and* reserving the dropped long
structure into it as an ordinary Fit before the fill, so MAGE's own auto-refine lands it there
instead of dropping it. You run it in two stages — all vertical lanes first, re-snapshot, then all
horizontal lanes — because a key reserved for one axis becomes an immovable intruder the other
axis's planner must see. Take the dropped long structures and their lengths/orientations from the
incumbent export (`state/incumbent.json`'s `metrics.drops`, orientation from each item's rule fact
`scribeInc` in `state/start-snapshot.json`: `["VERT"]` → a `V:*` lane, `["HORIZ"]` → an `H:*` lane;
any other `scribeInc` is reserved by neither stage). The exact sequence, at the Goal's
`max_target_distance_um` budget (1000 um on the real case):

Stage 1 — vertical lanes, on the priority-only start. For every `V:*` lane id in the start
snapshot's `lanes[*].laneId`, plan with `--interior` (it pulls an interior lane's along range in by
one scribe width at each end so a moved mark can never enter the exterior frame-edge band, which
MAGE refuses to assign — "No assigned sl"; a shared-exterior lane or an already-occupied edge band
keeps its full range). The slot length is the key length plus 2 um; the count is the number of
dropped keys of that orientation; when a lane is infeasible at that count but reports a positive
`maxSlots`, re-plan it at `maxSlots`:

```
plan-slots --snapshot state/start-snapshot.json --lane <V lane> --length-um <key length + 2>
  --count <dropped V keys> --limit-um <Goal max_target_distance_um> --interior --out <plan>
```

Then apply every feasible V plan to the start PLA, reserving the dropped V keys into the opened
slots. `apply-plan` moves exactly the priority marks each plan names, reserves each dropped key of
the stage's orientation at a slot start with 1 um clearance and a lane-direction box (the VERT
incumbent box is transposed to a tall lane box), shifts each moved mark's Group target point by the
mark's own delta (the default `--follow-groups`; MAGE's compaction rewrites Group points when it
moves Groups, so the candidate must match), and runs the straddle guard (below):

```
apply-plan WORKSPACE --pla <manifest startState path> --plan <each V plan>
  --reserve <incumbent export.pla> --reserve-length-um <key length>
  --out placement/round-NN/stage1-v.pla
```

Stage 2 — re-snapshot, then horizontal lanes. Snapshot the V-placed PLA as a candidate, so the
reserved vertical keys appear to the horizontal planner as intruders, then repeat the plan/apply for
every `H:*` lane on that snapshot:

```
snapshot WORKSPACE --pla placement/round-NN/stage1-v.pla --stage candidate
  --out placement/round-NN/stage1-snapshot.json
plan-slots --snapshot placement/round-NN/stage1-snapshot.json --lane <H lane>
  --length-um <key length + 2> --count <dropped H keys> --limit-um <Goal max_target_distance_um>
  --interior --out <plan>
apply-plan WORKSPACE --pla placement/round-NN/stage1-v.pla --plan <each H plan>
  --reserve <incumbent export.pla> --reserve-length-um <key length>
  --out placement/round-NN/reserved.pla
```

`apply-plan` reports per stage how many keys it reserved on each axis and which remained unreserved
(keys of the other axis, or of no fixed orientation, or beyond the opened slots); it refuses a
`--reserve` whose `--plan` set spans both axes, and refuses a plan that is infeasible, moves an
unknown id or a Fixed instance, or moves the same id twice. Never edit PLA text by hand.

**Straddle guard (apply-plan's default post-pass).** A moved priority mark that straddles a lane
crossing band is overlapped by MAGE's fill, so `apply-plan` nudges each straddler clear within its
own CT window, inside the frame, without touching a lane neighbour (1 um gap); when no nudge works
it reverts the mark to its frozen-start box and removes any reserved key that then collides with it,
and reports `nudged`/`reverted`/`keysRemoved`. It is on by default; `--no-straddle-guard` disables
it and `--straddle-limit-um` overrides the per-mark window.

**Then replay, fill and assemble the candidate:**

```
mage-round --round <n> --pla placement/round-NN/reserved.pla --role engineer
  --out-dir placement/round-NN --fill
candidate --round <n> --round-dir placement/round-NN --ledger <file>
  --out state/round/placement-candidate.json
```

`--fill` is what makes MAGE's auto-refine place the ordinary structures (and land the reserved keys)
into the windows you opened; a replay without it exports no ordinary population and the Reader
refuses it (see below). Then compare this round's `metrics.drops.ordinary` against
`state/incumbent.json`.

**What MAGE does with the reserved keys, confirmed on the real case.** MAGE re-places reserved
*horizontal* keys freely during the fill but keeps the *vertical* ones where they were reserved — so
the vertical reservation is the load-bearing half of the method and must be geometrically exact. A
mark left straddling a crossing is overlapped by the fill (hence the straddle guard); a mark pushed
into the exterior band is refused outright; and a target already beyond the limit in the frozen
start stays a pre-existing condition — answer it `declined … pre-existing`, never report it as this
round's regression (see below).

**Attempts, in order.** The plain `plan-slots --interior` above is attempt 1. If a lane is
infeasible, attempt 2 adds `--relaxed` (same planner, spacing/keep-out/zone ignored, crossing
intruders removable, clusters splittable); attempt 3 adds `--movable-nonpriority <um>`, which lets
the planner shift an ordinary (non-priority) structure within that budget to open room — `apply-plan`
only accepts an ordinary-fit move from a plan produced this way. Report which attempt a plan came
from; a relaxed or movable-nonpriority plan is a weaker claim than a plain one.

**Judge** by the round's own native checks (`metrics.native_rows`, the three checks OVERLAP/SPACE/
BOUNDARY) and this round's Q1–Q4 metrics
(`metrics_mod.drops`/`target_distances`/`order_deviation`/`displacement`). Two of these measure
different things and must never be conflated: **movement from the start** (`displacement`, how far
each Fit moved from the frozen start) versus **absolute error from the CT target**
(`targetDistances`, how far a bound Fit sits from its own CT point). Report both; never rename one as
the other. Keep the new candidate
only if it is no worse than the previous best by the best-state order below; otherwise deliver it
anyway as the honest best-effort result and say why in `stopReason`.

`decide-round` ends the loop only when the Goal's six measurable rules all PASS on this round's
Reader values with no consumer hard failure and no open Request, or after two consecutive
non-improving rounds, or at round 4. It will keep spending rounds while the Goal is unmet and you
are still improving, even on a quiet round where no consumer filed a Request — the loop works toward
the Goal, not merely toward silencing consumers, so use every round you are given to close the Goal.

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
