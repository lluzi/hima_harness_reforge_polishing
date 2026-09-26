# Wave 4 held-out L5 continuation — trial.21 / attempt 4

Cycle: `hima-trial-32`. This is the same bounded Issue #39 acceptance. Attempts 1–3 remain
immutable `INVALID_EVIDENCE`; none reached a valid matched commercial result, so none consumed the
value attempt under the Wave 4 closure plan.

Use the complete method, limits and dispositions from the earlier Wave 4 manuals. This continuation
changes only the runner identity and output path.

## Retained failures and repaired owners

- Attempt 1: Researcher scoped-read defect; repaired and verified live in attempt 2.
- Attempt 2: Site staging omitted the foundry CDL identity; repaired by Site v3 and verified by the
  exact sealed `bind-inputs.py` adapter before attempt 3.
- Attempt 3: Run `run-ecbf1668-f7f5-4f52-b3f3-4667ad833ff0` stopped before its first Job because
  the acceptance runner called model-backed `/compact` through the generic 10-second local-command
  timeout. The owner DeepSeek reply completed; the following compaction crossed that wrong bound.
- Repair commit/main: `5a59e329f18e1d430060228a286dcbc4368571b0`.
- A recovery-only real-model L4 used the same 350-line padding and App, then completed `/compact` in
  4,954 ms under an explicit 180,000 ms model-command bound. It preserved the transcript prefix,
  published the compacted summary and created zero Campaigns/Site Jobs. Evidence:
  `.hima-tmp/wave4-heldout/recovery-timeout-fix/evidence.json`.

## Fixed product and Site identities

- App:
  `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/pilot-release-0.3.0-trial.21-f6d263a/HimaHarness.app`;
  version `0.3.0-trial.21`; artifact digest
  `5636d6946103a5304589d1a8c2de083801a3f5c1a607c587f9cba25610e0bf51`;
  manifest SHA-256 `8d745911a91c9e934f83ffcf82fd49c57d97aad3f776da554f24dec3e64ee9fd`.
- Pack: `custom-cell-fmax-dtco@5.2.16`, digest
  `7b4a59be2a412d0052601b3384e5a2be35d2664c0ea7094206699f6e020fcbff`.
- Site profile:
  `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/site-profile-v3.json`,
  SHA-256 `19f81227259983a1990467af54f74bfb189580eca16c8a6d330a44d941ef0cf8`;
  Site `wave4-heldout-20260926002246`.
- Held-out `ibex_core`: 37 RTL files, canonical SHA-256
  `92fa54e1491cffd3107053b6c5d6c2714f79c79b5ff0f4a6086adb29b7636cfd`.

## Cheap gate and live continuation

Verify no HimaHarness App/Host or conflicting commercial client is active. Preserve attempts 1–3.
Run static preflight first, then exactly one fresh live output:

```sh
cd /Users/lluzi/code/hima_harness_reforge_polishing
PATH=/Users/lluzi/.local/node24/bin:$PATH \
node --experimental-strip-types scripts/live-check-dtco-pilot.ts \
  --preflight-only \
  --app .hima-tmp/pilot-release-0.3.0-trial.21-f6d263a/HimaHarness.app \
  --site-profile .hima-tmp/wave4-heldout/site-profile-v3.json

PATH=/Users/lluzi/.local/node24/bin:$PATH \
node --experimental-strip-types scripts/live-check-dtco-pilot.ts \
  --app .hima-tmp/pilot-release-0.3.0-trial.21-f6d263a/HimaHarness.app \
  --site-profile .hima-tmp/wave4-heldout/site-profile-v3.json \
  --out .hima-tmp/wave4-heldout/live-attempt4
```

Use the inherited `DEEPSEEK_API_KEY` without printing it. Do not reuse old Runs/workspaces or launch
a duplicate Campaign. Monitor the exact process to terminal evidence.

For valid evidence, run the zero-model audit:

```sh
PATH=/Users/lluzi/.local/node24/bin:$PATH \
node --experimental-strip-types scripts/audit-completed-dtco-pilot.ts \
  --evidence .hima-tmp/wave4-heldout/live-attempt4/evidence.json \
  --out .hima-tmp/wave4-heldout/offline-audit4
```

Only the offline audit may yield `PASS` or `TERMINAL_NEGATIVE`. Any new invalid evidence stops at
its exact lowest owner; do not improvise another Campaign. Update the same Agent Trial Report v32.

For every decision or terminal handoff, follow
`docs/agents/improver-tester-handshake.md`: write the durable checkpoint/handoff first, then use
Computer Use to send `CLAUDE_CHECKPOINT_READY` or `CLAUDE_HANDOFF_READY` into the open Codex task.
Remain idle until Codex returns `CODEX_HANDOFF_CONSUMED`. No timer polling is allowed.
