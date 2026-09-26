# HimaHarness final component-integration trial — Attempt 2 — Timing ECO Pack

You are the HimaHarness human-like acceptance tester. Use Claude Code Desktop with Sonnet 5 / Medium
and the installed `/himaharness-human-like-tester` skill. Operate only the visible HimaHarness App on
Catsights through Computer Use.

## Purpose

Verify that the fixed HimaHarness product components work together in one fresh, independently
reviewable Campaign. The prior Campaign remains paused immutable defect/recovery evidence and is not
reused as this acceptance. This trial does not require or claim timing improvement, PPA benefit,
clean signoff, ROI or labor saving.

## Fixed identities

- App version: `0.3.0-trial.30`.
- Prepared acceptance kit:
  `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/final-harness-integration-trial30-attempt2`.
- App artifact digest: `43f18cad28ea03d94e4f9877cc02f0cb7a60b5d6cd567b7bd21d0760614fa6b5`.
- App manifest SHA-256: `f31ac76ed6679d9da670dc690a77235d26debe68e00855acebc23680c1504754`.
- Source/fix SHA: `2ff429c69827811bed52708af88ccdc888fac6e1`.
- Acceptance authority main SHA: `1c95dcfefbf38ca914e10280d64333e8cf72b1f6`.
- Prepared-kit receipt:
  `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/final-harness-integration-trial30-attempt2/acceptance-kit.json`,
  SHA-256 `e5a77f5b4c2a5bff52b4dc8d9d761cd0055336aaaa8026bd033952f20252db79`.
- No-commercial preflight receipt:
  `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/final-harness-integration-preflight-issue52-attempt2-final/evidence.json`,
  SHA-256 `134970b237a037570d9b7fe7391b5feab9e1873743c7ab8de4d27a8335afbbdd`.
- Pack: `xtop-timing-closure@1.0.14`.
- Pack digest: `19207d78dc3b1e9f4fd80f6bd4c21df209f1dfffc5f83fa7afd3ac5c96fd2a92`.
- Site: `linglong-swerv28`.
- Site destination: `luzi@192.168.50.41`.
- Input DB: the Site-bound SWERV28 `xtop_round2_eco_route.enc.dat` checkpoint.
- Goal: setup WNS at least `0 ns`; hold WNS at least `0 ns`.
- Generation limit: one bounded acceptance generation unless the acceptance kit explicitly states a
  smaller stop boundary.

Do not start until Codex supplies a prepared acceptance kit identity proving that the Site, Permit and
production-qualified XTop interactive binding are installed in the kit's version-isolated Home. Do
not create a new Site through the GUI in this trial. Attempt 12's Site-creation defect is retained
separately.

The prior Campaign `xtop-timing-closure-20260926-131907-57fa` / Run
`run-51d7754c-5b5b-4a5e-b5db-63b9396711c3` remains paused and must never be selected, continued or
cancelled in this attempt. Before confirmation, explicitly ask Guide to set the new proposal's
generation limit to **1**; do not accept the Pack default of 12. If the visible product cannot prepare
that bounded budget, stop before creating a Campaign.

## Required visible journey

1. Send `/himaharness-human-like-tester` as its own Claude chat message and wait for the active-skill
   marker for the assigned cycle.
2. Launch the exact kit with `launch-hima-trial.command`; bind Computer Use to the visible
   HimaHarness window.
3. Ask HimaGuide in ordinary language to explain HimaHarness, the installed Timing ECO Pack, the
   installed Site, required inputs and the next action. Verify it separates facts, unknowns and
   claims.
4. Select `xtop-timing-closure`. Let Guide prepare the Pack/Site/input/Goal proposal. Verify no Run
   exists in this isolated Home before confirmation. Explicitly require `generationLimit: 1` and
   verify it in the proposal before confirming.
5. Confirm once. Verify exactly one Campaign, one persistent Run and one owner distinct from Guide.
6. Open Live Run. Zoom and pan the graph; open at least two nodes and one evidence/report detail.
7. Open an independent Side Talk or child view. Verify Guide remains usable and ownership does not
   change. Inspect one child's actual context/tools/transcript/result.
8. Let the owner advance only the new Run. At `run-xtop-fix`, verify direct owner interactive open is
   refused, then create exactly one production-qualified role=`operator` child for that fresh
   execution. The child alone uses typed identity/summary/fix/save/close controls; inspect its
   effective contract, complete transcript and candidate result. The owner explicitly adopts that
   exact result before completing the node. Do not use raw shell, PTY or raw Tcl.
9. At one safe boundary, use visible controls or Guide to pause. Record the request receipt, actual
   Run state and in-flight Job state separately. Explicitly continue once.
10. Switch sessions or reopen the App at a recoverable boundary. Verify the same Run, owner, child
    history and current facts return without a duplicate Job.
11. Open the timing/iteration report and Data Insight/report view. Perform one loaded-data filter or
    selection and return to Live Run without creating another Campaign.
12. Stop at the declared terminal/bounded state. Ask Guide to explain setup, hold, endpoints,
    physical evidence, unknowns and limitations. Numerical improvement is irrelevant to PASS.

## PASS matrix

Record PASS/FAIL with evidence for:

- exact App/Pack/Site/binding identity;
- Guide inventory and sourced explanation;
- Preparation before Run creation;
- one confirmation / one Campaign / one Run / one owner;
- Live Run graph interaction and node drill-down;
- Guide availability and independent session/child transcript;
- owner-only child adoption;
- qualified typed Operator interaction;
- durable pause/continue receipts;
- recovery without duplicate effects;
- report/Data Insight navigation;
- truthful terminal/bounded status and retained evidence.

Do not grade setup WNS, hold WNS, violation count, DRC, connectivity or closure score by direction.
Grade whether the product measured, retained and explained them correctly.

## Stop and handoff

Stop immediately on an identity mismatch, permission bypass, false completion, duplicate Run/Job,
unrecoverable UI path or missing required evidence. Preserve the App state and all prior trials.

Write the report, checkpoint and handoff before sending:

```text
CLAUDE_HANDOFF_READY: <absolute report path>
```

Use final verdicts `PASS`, `FAIL`, or `BLOCKED`. A valid negative timing result can still be PASS for
this Harness component-integration acceptance.
