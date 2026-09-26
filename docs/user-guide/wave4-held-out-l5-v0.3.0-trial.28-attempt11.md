# Wave 4 held-out L5 continuation — trial.28 / attempt 11

Cycle: `hima-trial-32`. Continue the same bounded Issue #39 acceptance. Attempts 1–10 remain
immutable `INVALID_EVIDENCE`; none consumed the single value attempt.

## Attempt 10 disposition and runner repair

Attempt 10 confirmed the Pack 5.2.23 capacity repair live: the real 13,353,534-byte, 116-candidate
pool passed residual-context assembly; `research-candidates` completed after bounded revisions; the
Run advanced through merge, generate, layout, characterize, design-mapping-timing evaluation and
`portfolio-gate`. No commercial EDA tool ran.

It stopped at `freeze-cumulative-library` after the remote Job had already exited 0 and the Ledger
had recorded the node done. The owning model began and worked execution
`execution-374fa9d5-5432-4f3e-8e14-748546bc135f`, then repeatedly read context instead of sending
`hima_execute complete`. The generic runner continuation text did not name the settled execution;
the three-continuation stall guard therefore cancelled the Run correctly.

Runner commit `b28ee98509049e1778d839a9dd0117f3d53c2eae` adds a deterministic continuation seam:

- when the current node has exactly one `ready + settled` execution, the owner is told the exact
  node and execution ID and must call `hima_execute complete` after one current-context read;
- it must not begin/work the node again, grep a spill, or create another Run;
- working, unstarted, ambiguous and non-current executions retain the normal continuation path;
- focused runner regression 2/2 and the 130-file contract inventory pass.

This is a test-runner change only. The released App and Pack bytes remain unchanged.

## Fixed identities

- Main/runner: `b28ee98509049e1778d839a9dd0117f3d53c2eae`.
- Pack: `custom-cell-fmax-dtco@5.2.23`; digest
  `8a20cde2fc6056152a5abe303d9a52965adeffa09507313f2c6578499173aa8b`.
- Sealed test Run: `run-afee26dd-da8c-422e-8ba1-c2be1d866650`.
- App:
  `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/pilot-release-0.3.0-trial.28-fd5c08a/HimaHarness.app`.
- App `0.3.0-trial.28`; source `fd5c08ac0bf79cd0674857c909476a5511477284`;
  artifact digest `754c2feb7ee7a3c3ec94e8a486c8e21db7d9d1f5e3657478d9c5cc4e38e393aa`;
  manifest SHA-256 `f5d65dfc8bc43447f0bab0e99ab07534f5501c98c022c0878eb66eb00eca311e`.
- Site profile:
  `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/site-profile-v3.json`;
  SHA-256 `19f81227259983a1990467af54f74bfb189580eca16c8a6d330a44d941ef0cf8`;
  Site `wave4-heldout-20260926002246`.
- Held-out `ibex_core`: 37 RTL files; canonical SHA-256
  `92fa54e1491cffd3107053b6c5d6c2714f79c79b5ff0f4a6086adb29b7636cfd`.

## Live continuation

Preserve attempts 1–10. Verify no conflicting App/Host or live commercial client is active. Run
exactly:

```sh
cd /Users/lluzi/code/hima_harness_agent_trial_fix_v32
PATH=/Users/lluzi/.local/node24/bin:$PATH node --experimental-strip-types scripts/live-check-dtco-pilot.ts \
  --preflight-only \
  --app /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/pilot-release-0.3.0-trial.28-fd5c08a/HimaHarness.app \
  --site-profile /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/site-profile-v3.json

PATH=/Users/lluzi/.local/node24/bin:$PATH node --experimental-strip-types scripts/live-check-dtco-pilot.ts \
  --app /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/pilot-release-0.3.0-trial.28-fd5c08a/HimaHarness.app \
  --site-profile /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/site-profile-v3.json \
  --out /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/live-attempt11
```

Use the inherited `DEEPSEEK_API_KEY` without printing it. Do not reuse old Runs/workspaces or create
a duplicate Campaign. On deterministic invalid evidence, stop and hand off; do not launch attempt
12. A valid zero/negative matched result is terminal evidence, not an infrastructure defect.

For valid evidence only, run the offline auditor against `live-attempt11/evidence.json` and write
its output to `.hima-tmp/wave4-heldout/offline-audit11`. Only that audit may classify `PASS` or
`TERMINAL_NEGATIVE`.

Update `Agent Trial Report v32.md`, write the durable checkpoint/handoff/report first, then send the
event-driven Computer Use marker. No timer polling.
