# Wave 4 held-out L5 continuation — trial.24 / attempt 8

Cycle: `hima-trial-32`. Continue the same bounded Issue #39 acceptance. Attempts 1–7 remain
immutable `INVALID_EVIDENCE`; none reached a valid matched commercial comparison.

## Attempt 7 disposition and repair

Attempt 7 confirmed the escaped vector net-to-net repair live, then stopped at
`evaluation-baseline` on a different mapped-netlist form:

```text
assign \gen_regfile_ff.register_file_i.rf_reg [31:0] = 32'd0;
```

Pack 5.2.19 models this as a bounded constant source, not as a net alias:

- sized binary/octal/decimal/hex literals with known 0/1 value only;
- declared width `1..65536`, value must fit without truncation;
- explicit bit/range LHS required and width must match;
- bits map MSB-to-LHS-position for ascending or descending ranges;
- canonical `1'b0/1'b1` tokens reuse existing resynthesis/miner constant semantics;
- bare LHS, X/Z, signed/unsized, overflow, width mismatch, expression, overlap and direct-driver
  conflicts remain fail-closed.

- Fix commit: `aaf05775481543774a9e3e53c0ee51c3b582a2e7`.
- Pack: `custom-cell-fmax-dtco@5.2.19`; digest
  `53d71733ee0441b227ec758ec91eefa6a9e723c93548650ad11c87882d8d1be2`.
- Sealed test Run: `run-24da49fc-8447-46e8-aed0-9896b819305b`.
- Release evidence: `.hima-tmp/wave4-heldout/pack-5.2.19-release-attempt1/evidence.json`;
  SHA-256 `8e5aeb0a9b7233cc05b4485afc3a5f22cda4586a68b8049f40e2a5838b78edee`.
- Regression: Pack 26/26, miner 20/20, domain 164/164, typecheck PASS; independent Sol/High review PASS.

## Fixed identities

- App:
  `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/pilot-release-0.3.0-trial.24-aaf0577/HimaHarness.app`.
- App `0.3.0-trial.24`; source `aaf05775481543774a9e3e53c0ee51c3b582a2e7`;
  artifact digest `9a49fb403b3387cc230f9d4b5e5c02d274f57a2e02c86511a542b2ebb4000712`;
  manifest SHA-256 `420e628467f42d100a5dca97e86195cf2ba6d422ce761092e28944811087cb8e`.
- Site profile:
  `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/site-profile-v3.json`;
  SHA-256 `19f81227259983a1990467af54f74bfb189580eca16c8a6d330a44d941ef0cf8`;
  Site `wave4-heldout-20260926002246`.
- Held-out `ibex_core`: 37 RTL files; canonical SHA-256
  `92fa54e1491cffd3107053b6c5d6c2714f79c79b5ff0f4a6086adb29b7636cfd`.

## Live continuation

Preserve attempts 1–7. Verify no conflicting App/Host or commercial client is active. Run exactly:

```sh
cd /Users/lluzi/code/hima_harness_agent_trial_fix_v32
PATH=/Users/lluzi/.local/node24/bin:$PATH node --experimental-strip-types scripts/live-check-dtco-pilot.ts \
  --preflight-only \
  --app /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/pilot-release-0.3.0-trial.24-aaf0577/HimaHarness.app \
  --site-profile /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/site-profile-v3.json

PATH=/Users/lluzi/.local/node24/bin:$PATH node --experimental-strip-types scripts/live-check-dtco-pilot.ts \
  --app /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/pilot-release-0.3.0-trial.24-aaf0577/HimaHarness.app \
  --site-profile /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/site-profile-v3.json \
  --out /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/live-attempt8
```

Use the inherited `DEEPSEEK_API_KEY` without printing it. Do not reuse old Runs/workspaces or create
a duplicate Campaign. On invalid evidence, stop and hand off; do not launch attempt 9.

For valid evidence only:

```sh
PATH=/Users/lluzi/.local/node24/bin:$PATH node --experimental-strip-types \
  scripts/audit-completed-dtco-pilot.ts \
  --evidence /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/live-attempt8/evidence.json \
  --out /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/offline-audit8
```

Only the offline audit may classify `PASS` or `TERMINAL_NEGATIVE`. Update `Agent Trial Report v32.md`,
write durable checkpoint/handoff/report first, then send the Computer Use marker. No timer polling.
