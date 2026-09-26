# Wave 4 held-out L5 continuation — trial.23 / attempt 7

Cycle: `hima-trial-32`. Continue the same bounded Issue #39 acceptance. Attempts 1–6 remain
immutable `INVALID_EVIDENCE`; none reached a valid matched commercial comparison, so none consumed
the one value result allowed by the Wave 4 closure contract.

## Attempt 6 disposition and Pack repair

Attempt 6 confirmed 25/25 pre-Campaign and recovery checks, the bounded compaction retry and Site v3
input binding. `bind-inputs` completed. At `evaluation-baseline`, the real mapped `ibex_core` netlist
then exposed a different Pack parser gap:

```text
assign \ex_block_i.genblk3.gen_multdiv_fast.multdiv_i.imd_val_q_i [31:0]
     = \ex_block_i.alu_i.g_no_alu_rvb.unused_imd_val_q [31:0];
```

The shared structural parser accepted only ordinary whole/single-bit names. Pack 5.2.18 now:

- preserves the required whitespace terminator of escaped Verilog identifiers;
- keeps an escaped name containing brackets distinct from a bit-select on an escaped name;
- expands equal-width ascending or descending ranges positionally into bounded scalar aliases;
- applies one token-aware canonicalizer to named connections, positional primitives and assigns;
- preserves prior whole↔single-bit aliases;
- rejects missing escaped terminators, width mismatch, multi-bit range↔whole, concat, literal,
  Boolean and malformed expressions.

The exact Attempt 6 form, named and positional graph paths, identity collision and negative guards
passed independent review. No commercial EDA ran in attempt 6.

- Product fix commit: `74a83dfafd7ea6f3929a2ea6ab48395bacd40f75`.
- Sealed Pack test Run: `run-fc207e67-a295-4824-8da8-19a0cfb4e386`.
- Pack release evidence:
  `.hima-tmp/wave4-heldout/pack-5.2.18-release-attempt1/evidence.json`; SHA-256
  `0fad13e1c3302a408a54c665e2e128c22b64f415b86fed1a8200b1822396589a`.
- Regression evidence: Pack contract 26/26, miner 20/20, domain 163/163, TypeScript typecheck PASS.

## Fixed product and Site identities

- App:
  `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/pilot-release-0.3.0-trial.23-74a83df/HimaHarness.app`.
- App version `0.3.0-trial.23`; source SHA
  `74a83dfafd7ea6f3929a2ea6ab48395bacd40f75`; artifact digest
  `21d58f2094bdb76f4c31db370347971e114cdb6e6b63a969c33d5a3e535200b4`; manifest SHA-256
  `d0877c01048486cc4b8b159d7c10a1341c7a45aa720cc325a87d8dd876d3eeef`.
- Pack `custom-cell-fmax-dtco@5.2.18`; method digest
  `6b0e693300b609c02064d1990fbd233c1192bd4355ec2d48a884321a009fc3e8`.
- Site profile:
  `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/site-profile-v3.json`;
  SHA-256 `19f81227259983a1990467af54f74bfb189580eca16c8a6d330a44d941ef0cf8`;
  Site `wave4-heldout-20260926002246`.
- Held-out `ibex_core`: 37 RTL files; canonical SHA-256
  `92fa54e1491cffd3107053b6c5d6c2714f79c79b5ff0f4a6086adb29b7636cfd`.

The App passed package verification, version-isolated Home smoke, relocated Host smoke and the exact
Wave 4 static preflight.

## Live continuation

Preserve attempts 1–6. Verify no conflicting HimaHarness Host/App or commercial client is active.
Run the cheap preflight, then exactly one fresh output:

```sh
cd /Users/lluzi/code/hima_harness_agent_trial_fix_v32
PATH=/Users/lluzi/.local/node24/bin:$PATH \
node --experimental-strip-types scripts/live-check-dtco-pilot.ts \
  --preflight-only \
  --app /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/pilot-release-0.3.0-trial.23-74a83df/HimaHarness.app \
  --site-profile /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/site-profile-v3.json

PATH=/Users/lluzi/.local/node24/bin:$PATH \
node --experimental-strip-types scripts/live-check-dtco-pilot.ts \
  --app /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/pilot-release-0.3.0-trial.23-74a83df/HimaHarness.app \
  --site-profile /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/site-profile-v3.json \
  --out /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/live-attempt7
```

Use the inherited `DEEPSEEK_API_KEY` without printing it. Do not reuse old Runs/workspaces and do not
start a duplicate Campaign. Monitor this exact process to terminal evidence. If invalid, stop at its
lowest owner and hand off; do not launch attempt 8.

For valid evidence only, run the zero-model audit:

```sh
PATH=/Users/lluzi/.local/node24/bin:$PATH \
node --experimental-strip-types scripts/audit-completed-dtco-pilot.ts \
  --evidence /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/live-attempt7/evidence.json \
  --out /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/offline-audit7
```

Only the offline audit may classify `PASS` or `TERMINAL_NEGATIVE`. Update the same
`Agent Trial Report v32.md`; write durable checkpoint/handoff/report before the Computer Use marker.
No timer polling.
