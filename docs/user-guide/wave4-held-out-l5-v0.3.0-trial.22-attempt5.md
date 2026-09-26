# Wave 4 held-out L5 continuation — trial.22 / attempt 5

Cycle: `hima-trial-32`. Continue the same bounded Issue #39 acceptance. Attempts 1–4 remain
immutable `INVALID_EVIDENCE`; none reached a valid matched commercial comparison, so none consumed
the one value result allowed by the Wave 4 closure contract.

## Retained failure and repaired owner

Attempt 4 passed all 24 product checks and the earlier delegation, Site-binding and compaction
repairs. It then stopped at `evaluation-baseline` because the Pack's Liberty parser rejected the
real single-pin active-low latch expression `enable : "(!EN)"` as if it were a complex expression.
No commercial EDA ran.

The existing `_sequential_pin` parser now accepts exactly one pin, at most one inversion and at most
one grouping layer, including `(!EN)`, while continuing to reject compound, double-inverted,
malformed, nested and whitespace-joined expressions. The full parser suite passed 19/19, the Pack
contract suite passed 26/26, and a real Site Pack test parsed the foundry Liberty before completing
the license-free negative-calibration qualification. Pack source notes and local run assets are
excluded from method bytes by explicit pre-release guards.

- Product fix commit: `0c02c026540505b8be015ba95d822c68a0a0b0f7`.
- Wave 4 runner identity update: `1a75424a6d84e95f03ff234ccec4c431ca84019e`.
- Sealed Pack test Run: `run-a8024034-bbf5-4288-b6c2-9e2068b57421`.
- Pack release evidence:
  `.hima-tmp/wave4-heldout/pack-5.2.17-release-attempt6/evidence.json`;
  SHA-256 `7e7f1e09be4354bf7ad13b0516865a3b61ca24ea74a43cd28e0c1915f3311119`.

## Fixed product and Site identities

- App:
  `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/pilot-release-0.3.0-trial.22-0c02c02/HimaHarness.app`.
- App version: `0.3.0-trial.22`; source SHA
  `0c02c026540505b8be015ba95d822c68a0a0b0f7`; artifact digest
  `3f0bf3abd3f25ad58508aa2d052950055ca2bcbfd908601831e5da82f8eecb2c`; manifest SHA-256
  `b1fe012ec04ce948ecc1b0a1e2dc6ed48df9d62a0b2834b4369506067405cbe4`.
- Pack: `custom-cell-fmax-dtco@5.2.17`; method digest
  `5d2cccd7d69a612bf74ba932cc0ae7d0baec97b1a158e38bee45b3cb12c454bc`.
- Site profile:
  `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/site-profile-v3.json`;
  SHA-256 `19f81227259983a1990467af54f74bfb189580eca16c8a6d330a44d941ef0cf8`;
  Site `wave4-heldout-20260926002246`.
- Held-out `ibex_core`: 37 RTL files; canonical SHA-256
  `92fa54e1491cffd3107053b6c5d6c2714f79c79b5ff0f4a6086adb29b7636cfd`.

The static preflight passed against these exact identities. The App package passed structural
verification, version-isolated Home smoke and relocated Host smoke.

## Live continuation

Preserve attempts 1–4 and every Pack qualification artifact. Verify no conflicting HimaHarness
Host/App or commercial client is active. Run exactly one fresh output:

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
  --out /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/live-attempt5
```

Use the inherited `DEEPSEEK_API_KEY` without printing it. Do not reuse old Runs/workspaces and do not
start a duplicate Campaign. Monitor the exact process to terminal evidence. If the run is invalid,
stop at its exact lowest owner and hand off; do not launch attempt 6.

For valid evidence only, run the zero-model audit:

```sh
PATH=/Users/lluzi/.local/node24/bin:$PATH \
node --experimental-strip-types scripts/audit-completed-dtco-pilot.ts \
  --evidence /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/live-attempt5/evidence.json \
  --out /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/offline-audit5
```

Only the offline audit may classify the held-out result as `PASS` or `TERMINAL_NEGATIVE`. Update the
same `Agent Trial Report v32.md`. For every terminal handoff, write checkpoint/handoff/report first,
then use the event handshake in `docs/agents/improver-tester-handshake.md`; no timer polling.
