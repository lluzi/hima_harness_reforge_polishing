# HimaHarness final component-integration trial — Timing ECO Pack

You are the HimaHarness human-like acceptance tester. Use Claude Code Desktop with Sonnet 5 / Medium
and the installed `/himaharness-human-like-tester` skill. Operate only the visible HimaHarness App on
Catsights through Computer Use.

## Purpose

Verify that the current HimaHarness product components work together. This trial does not require or
claim timing improvement, PPA benefit, clean signoff, ROI or labor saving.

## Fixed identities

- App version: `0.3.0-trial.28`.
- Existing kit: `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/pilot-release-0.3.0-trial.28-fd5c08a`.
- App artifact digest: `754c2feb7ee7a3c3ec94e8a486c8e21db7d9d1f5e3657478d9c5cc4e38e393aa`.
- App manifest SHA-256: `f5d65dfc8bc43447f0bab0e99ab07534f5501c98c022c0878eb66eb00eca311e`.
- Source SHA: `fd5c08ac0bf79cd0674857c909476a5511477284`.
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

## Required visible journey

1. Send `/himaharness-human-like-tester` as its own Claude chat message and wait for the active-skill
   marker for the assigned cycle.
2. Launch the exact kit with `launch-hima-trial.command`; bind Computer Use to the visible
   HimaHarness window.
3. Ask HimaGuide in ordinary language to explain HimaHarness, the installed Timing ECO Pack, the
   installed Site, required inputs and the next action. Verify it separates facts, unknowns and
   claims.
4. Select `xtop-timing-closure`. Let Guide prepare the Pack/Site/input/Goal proposal. Verify no Run
   exists before confirmation.
5. Confirm once. Verify exactly one Campaign, one persistent Run and one owner distinct from Guide.
6. Open Live Run. Zoom and pan the graph; open at least two nodes and one evidence/report detail.
7. Open an independent Side Talk or child view. Verify Guide remains usable and ownership does not
   change. Inspect one child's actual context/tools/transcript/result.
8. Let the owner advance only the existing Run. At `run-xtop-fix`, use the qualified Operator child
   and typed interactive controls. Do not use raw shell or raw Tcl.
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

