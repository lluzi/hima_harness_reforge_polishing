# Wave 4 held-out L5 continuation — trial.28 / attempt 10

Cycle: `hima-trial-32`. Continue the same bounded Issue #39 acceptance. Attempts 1–9 remain
immutable `INVALID_EVIDENCE`; none reached a valid matched commercial comparison and none consumed
the single value attempt.

## Attempt 9 disposition and qualified repair

Attempt 9 was the first live attempt to complete `evaluation-baseline`, all six mine/select paths,
`merge-join`, function-local evaluation and its Judge on the held-out `ibex_core`. It admitted 1,985
FFs, analyzed 1,984 complete FF-to-FF paths and produced 116 real candidates. It then stopped before
the authored `research()` function because the hash-bound `candidate-pool.json` was larger than the
Pack's dedicated raw candidate-pool admission limit.

The exact retained facts are:

- candidate pool SHA-256 `bfa741d1146795fc2a280f3af6813f7d6954207fe4ecb00b6a8b3489b9f7ac47`;
- 13,353,534 bytes and 116 candidates;
- Pack 5.2.21's candidate-pool-specific limit was 8,388,608 bytes (8 MiB), not the generic 512 KiB
  final-context limit quoted in the initial handoff interpretation;
- the file path, regular-file, SHA and JSON checks passed before the size refusal;
- no commercial EDA tool ran.

Pack 5.2.23 raises only the raw candidate-pool evidence limit to 16 MiB. It still verifies and
projects every candidate without truncation; the final model context remains independently bounded
at 512 KiB. The exact Attempt 9 corpus now loads 116/116 candidates in about 0.1 seconds and projects
to 170,470 canonical bytes. A synthetic 16 MiB+1 artifact still fails before JSON parsing. Direct
file symlinks, parent-directory symlinks, path escape, SHA drift, malformed JSON, zero/129 rows and
duplicate deterministic proposal identities remain fail-closed.

- Fix/release commit: `fd5c08ac0bf79cd0674857c909476a5511477284`.
- Pack: `custom-cell-fmax-dtco@5.2.23`; digest
  `8a20cde2fc6056152a5abe303d9a52965adeffa09507313f2c6578499173aa8b`.
- Sealed test Run: `run-afee26dd-da8c-422e-8ba1-c2be1d866650`.
- Release evidence: `.hima-tmp/wave4-heldout/pack-5.2.23-release-attempt1/evidence.json`;
  SHA-256 `7b3906579d5951b80cace2105fdaae204ab6aea38837ec9e87b9130f0e3a8efb`.
- Regression: residual-context 36/36, domain 173/173, Pack 26/26, direct TypeScript checks PASS;
  native TEST/seal PASS; commercial EDA was not run for qualification.

## Fixed identities

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

Preserve attempts 1–9. Verify no conflicting App/Host or live commercial client is active. Run
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
  --out /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/live-attempt10
```

Use the inherited `DEEPSEEK_API_KEY` without printing it. Do not reuse old Runs/workspaces or create
a duplicate Campaign. On deterministic invalid evidence, stop and hand off; do not launch attempt
11. A valid zero/negative matched result is terminal evidence, not an infrastructure defect.

For valid evidence only:

```sh
PATH=/Users/lluzi/.local/node24/bin:$PATH node --experimental-strip-types \
  scripts/audit-completed-dtco-pilot.ts \
  --evidence /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/live-attempt10/evidence.json \
  --out /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/offline-audit10
```

Only the offline audit may classify `PASS` or `TERMINAL_NEGATIVE`. Update `Agent Trial Report v32.md`,
write the durable checkpoint/handoff/report first, then send the event-driven Computer Use marker.
No timer polling.
