# Wave 4 held-out L5 continuation — trial.21

Cycle: `hima-trial-32`. This manual continues the same bounded Issue #39 acceptance after the
retained trial.20 `INVALID_EVIDENCE`; it does not authorize a second blind value Campaign.

The complete method, evidence rules, cost ceiling and terminal vocabulary remain in
`docs/user-guide/wave4-held-out-l5-v0.3.0-trial.20.md`. This continuation overrides only the fixed
product identity, output paths and repaired delegation gate below.

## Retained invalid attempt

- Run `run-321ba9a1-f939-4e1d-80fd-0fe99ade7837`, Campaign
  `custom-cell-fmax-dtco-20260925-233130-6afd` and its complete evidence remain immutable.
- It stopped before commercial EDA because Researcher could not receive a bounded local read tool.
- No DC, LC or Innovus Job ran; it did not consume the value attempt.
- Report: `/Users/lluzi/code/hima_harness_agent_trial_fix_v32/Agent Trial Report v32.md`.

## Repaired fixed identities

- Main and `origin/main`: `f6d263aa51ceedad33569d61bf71a141e23e4dcf`.
- Repair: a Researcher may receive `read/glob/grep` only with an explicit existing `readScope`
  strictly below the parent workspace. It receives no write authority. Missing, broad, external,
  omitted-root, out-of-scope and symlink-escape reads are refused. Coding and Operator boundaries
  remain unchanged.
- Clean App candidate:
  `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/pilot-release-0.3.0-trial.21-f6d263a/HimaHarness.app`.
- App version `0.3.0-trial.21`; artifact digest
  `5636d6946103a5304589d1a8c2de083801a3f5c1a607c587f9cba25610e0bf51`;
  manifest SHA-256 `8d745911a91c9e934f83ffcf82fd49c57d97aad3f776da554f24dec3e64ee9fd`.
- Sealed Pack remains `custom-cell-fmax-dtco@5.2.16`, method digest
  `7b4a59be2a412d0052601b3384e5a2be35d2664c0ea7094206699f6e020fcbff`.
- Site profile remains
  `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/site-profile.json`,
  SHA-256 `ecf4d01cf1be9a047d6e73657e18bbdc1eb23372b684e211067073782efae49a`.
- Held-out `ibex_core` inventory remains 37 files, canonical SHA-256
  `92fa54e1491cffd3107053b6c5d6c2714f79c79b5ff0f4a6086adb29b7636cfd`.

## Cheap gate

Verify no historical App/Host or commercial client is active. Preserve every old Home and Run.
Then run:

```sh
cd /Users/lluzi/code/hima_harness_reforge_polishing
PATH=/Users/lluzi/.local/node24/bin:$PATH \
node --experimental-strip-types scripts/live-check-dtco-pilot.ts \
  --preflight-only \
  --app .hima-tmp/pilot-release-0.3.0-trial.21-f6d263a/HimaHarness.app \
  --site-profile .hima-tmp/wave4-heldout/site-profile.json
```

Continue only when every App/Pack/Site/source identity above matches. Use the inherited
`DEEPSEEK_API_KEY`; never print or record it.

## Resume the same acceptance once

```sh
cd /Users/lluzi/code/hima_harness_reforge_polishing
PATH=/Users/lluzi/.local/node24/bin:$PATH \
node --experimental-strip-types scripts/live-check-dtco-pilot.ts \
  --app .hima-tmp/pilot-release-0.3.0-trial.21-f6d263a/HimaHarness.app \
  --site-profile .hima-tmp/wave4-heldout/site-profile.json \
  --out .hima-tmp/wave4-heldout/live-attempt2
```

The runner now stages a hash-equal copy of the installed sealed research template into a private
read scope, requires the Research child to read that exact path successfully, and re-hashes it after
the turn. It must still prove the independent Guide/owner/team, memory/recovery, full Pack graph,
commercial matched routes, final routed adoption, same-DB timing, archive and value receipt.

If live evidence is valid, run:

```sh
cd /Users/lluzi/code/hima_harness_reforge_polishing
PATH=/Users/lluzi/.local/node24/bin:$PATH \
node --experimental-strip-types scripts/audit-completed-dtco-pilot.ts \
  --evidence .hima-tmp/wave4-heldout/live-attempt2/evidence.json \
  --out .hima-tmp/wave4-heldout/offline-audit2
```

Use `PASS`, `TERMINAL_NEGATIVE`, or `INVALID_EVIDENCE` exactly as defined by the trial.20 manual.
On another invalid result, stop at its lowest owning defect and hand off; do not launch a third
Campaign. Update `Agent Trial Report v32.md` in the tester worktree, preserve both attempts, run the
tester handoff helper, and print `CODEX_HANDOFF_READY: <absolute report path>` in the same Claude
session. Do not publish a release or close an Issue.
