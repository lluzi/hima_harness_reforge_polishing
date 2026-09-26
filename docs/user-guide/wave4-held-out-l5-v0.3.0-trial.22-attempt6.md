# Wave 4 held-out L5 continuation — trial.22 / attempt 6

Cycle: `hima-trial-32`. Continue the same bounded Issue #39 acceptance. Attempts 1–5 remain
immutable `INVALID_EVIDENCE`; none reached a valid matched commercial comparison, so none consumed
the one value result allowed by the Wave 4 closure contract.

## Attempt 5 disposition and runner repair

Attempt 5 used the correct App trial.22, Pack 5.2.17 and Site v3. It created no Site Job and reached
no Pack node. The owner `/compact` request settled inside the 180-second bound but the retained native
session proves its summarizer provider request failed:

- `command/run` → `compaction/start` → `compaction/end.error = "DeepSeek API request to
  https://api.deepseek.com failed"` → `command/done kind=error`;
- no `compaction/summary` and no surface replacement were published;
- the conversation prefix remained unchanged and cleanup cancelled the empty preflight Run;
- no commercial EDA ran.

The DSH public error text deliberately folds provider, empty/truncated and non-shrinking summary
failures into one fail-closed message. The runner now retains the exact `commandId`, authoritative
`sourceEventSeq` and closed `compaction/end` diagnostic. It may retry one closed summary-stage failure
once in the same owner session. The recovery gate still passes only with `Compacted N history items`,
a real `sourceEventSeq`, visible `<compacted-summary>`, the unchanged transcript prefix, stale saved
memory and a successful Host reopen. Busy, timeout, cancelled, changed, commit, persistence,
no-history and a second summary failure all stop the trial.

- Runner fix commit: `80f09d32b350291ed495279408260f544808d0b0`.
- L2 regression: `experience-files.test.ts`, 26/26 PASS.
- Real-model recovery L4: PASS in 6.124 seconds, one attempt, `sourceEventSeq=18`, zero Campaigns/Site
  Jobs; evidence `.hima-tmp/wave4-heldout/recovery-compact-retry-fix/evidence.json`, SHA-256
  `1222410c6d12c58bc9c0b20b871619491f187be7e748ca3f9f48f4aa0338ae64`.

## Fixed product and Site identities

- App:
  `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/pilot-release-0.3.0-trial.22-0c02c02/HimaHarness.app`.
- App version `0.3.0-trial.22`; source SHA
  `0c02c026540505b8be015ba95d822c68a0a0b0f7`; artifact digest
  `3f0bf3abd3f25ad58508aa2d052950055ca2bcbfd908601831e5da82f8eecb2c`; manifest SHA-256
  `b1fe012ec04ce948ecc1b0a1e2dc6ed48df9d62a0b2834b4369506067405cbe4`.
- Pack `custom-cell-fmax-dtco@5.2.17`; method digest
  `5d2cccd7d69a612bf74ba932cc0ae7d0baec97b1a158e38bee45b3cb12c454bc`; sealed test Run
  `run-a8024034-bbf5-4288-b6c2-9e2068b57421`.
- Site profile:
  `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/site-profile-v3.json`;
  SHA-256 `19f81227259983a1990467af54f74bfb189580eca16c8a6d330a44d941ef0cf8`;
  Site `wave4-heldout-20260926002246`.
- Held-out `ibex_core`: 37 RTL files; canonical SHA-256
  `92fa54e1491cffd3107053b6c5d6c2714f79c79b5ff0f4a6086adb29b7636cfd`.

## Live continuation

Preserve attempts 1–5. Verify no conflicting HimaHarness Host/App or commercial client is active.
Run the cheap preflight, then exactly one fresh output:

```sh
cd /Users/lluzi/code/hima_harness_agent_trial_fix_v32
PATH=/Users/lluzi/.local/node24/bin:$PATH \
node --experimental-strip-types scripts/live-check-dtco-pilot.ts \
  --preflight-only \
  --app /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/pilot-release-0.3.0-trial.22-0c02c02/HimaHarness.app \
  --site-profile /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/site-profile-v3.json

PATH=/Users/lluzi/.local/node24/bin:$PATH \
node --experimental-strip-types scripts/live-check-dtco-pilot.ts \
  --app /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/pilot-release-0.3.0-trial.22-0c02c02/HimaHarness.app \
  --site-profile /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/site-profile-v3.json \
  --out /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/live-attempt6
```

Use the inherited `DEEPSEEK_API_KEY` without printing it. Do not reuse old Runs/workspaces and do not
start a duplicate Campaign. Monitor this exact process to terminal evidence. If invalid, stop at its
lowest owner and hand off; do not launch attempt 7.

For valid evidence only, run the zero-model audit:

```sh
PATH=/Users/lluzi/.local/node24/bin:$PATH \
node --experimental-strip-types scripts/audit-completed-dtco-pilot.ts \
  --evidence /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/live-attempt6/evidence.json \
  --out /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/offline-audit6
```

Only the offline audit may classify `PASS` or `TERMINAL_NEGATIVE`. Update the same
`Agent Trial Report v32.md`; write durable checkpoint/handoff/report before the Computer Use marker.
No timer polling.
