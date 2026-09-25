# Wave 4 held-out L5 operator manual

Cycle: `hima-trial-32`. This is an explicit user-authorized product trial. It owns the single
bounded held-out value attempt for Issue #39 under the Wave 4 closure contract in
`docs/assessment/2026-09-25/next-stage/issue-closure-plan.md`.

## Fixed identities

- Product source: `0f36bacf3d3984a35fc498de0372b277b9ee1879`, synchronized to `origin/main`.
- Clean App candidate:
  `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/pilot-release-0.3.0-trial.20-0f36bac/HimaHarness.app`.
- App version: `0.3.0-trial.20`; artifact digest
  `706e56d224ce5e5205ce2ece143e979de7cbeabaed0a165b87248965723045d2`;
  manifest SHA-256 `31d61a4205b176717ebe1f0823c4c15db020def117fb02a3aca69401e948f80e`.
- Sealed Pack: `custom-cell-fmax-dtco@5.2.16`; method digest
  `7b4a59be2a412d0052601b3384e5a2be35d2664c0ea7094206699f6e020fcbff`;
  native TEST Run `run-a148dd0c-2d2d-42b0-8c32-5179d40ad254`.
- Private Site profile:
  `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/site-profile.json`;
  SHA-256 `ecf4d01cf1be9a047d6e73657e18bbdc1eb23372b684e211067073782efae49a`.
- Held-out design: `ibex_core`, 37 exact Site RTL files; sorted canonical inventory SHA-256
  `92fa54e1491cffd3107053b6c5d6c2714f79c79b5ff0f4a6086adb29b7636cfd`.
  It was selected before reading a custom-cell result and was not used to author, tune, test or
  previously run the sealed Pack. Prior generic Site inventory does not constitute method exposure.
- Tester worktree: `/Users/lluzi/code/hima_harness_agent_trial_fix_v32`; branch
  `agent/hima-trial-bugfix-v32`. Do not modify main directly.

The App candidate was built from the fixed product source with a clean diff. Its manifest binds the
Pack version, digest and TEST Run. The acceptance runner may be newer than the App only when no
`packages/`, `profiles/`, `packs/`, root package or lockfile input changed since that App source.

## Admission and cost limit

The first cheap gate is static preflight. Run it before any SSH, Host, model or EDA action:

```sh
cd /Users/lluzi/code/hima_harness_reforge_polishing
PATH=/Users/lluzi/.local/node24/bin:$PATH \
node --experimental-strip-types scripts/live-check-dtco-pilot.ts \
  --preflight-only \
  --app .hima-tmp/pilot-release-0.3.0-trial.20-0f36bac/HimaHarness.app \
  --site-profile .hima-tmp/wave4-heldout/site-profile.json
```

Do not continue unless it reports `preflight-passed` with the identities above. Immediately before
the live operation the runner re-reads every RTL hash and rediscovers the Site. It must see
`selected=new old=inactive new=active` with no XTop, QuaLib, DC, LC, Innovus, PrimeTime or StarRC
client. Never print, copy or record credentials. Use the inherited `DEEPSEEK_API_KEY` only.

The one Campaign has a six-hour Campaign time box including a fifteen-minute closing reserve, four
generations, three retries per node, 480 total attempts, five concurrent licence-free Jobs, and one
seat each for Design Compiler, Library Compiler and Innovus. The enclosing runner is seven hours,
1,800 product request steps and 240 user turns. These are ceilings, not targets.

## One live Campaign

Use exactly this fresh output path and do not start another Campaign if it fails:

```sh
cd /Users/lluzi/code/hima_harness_reforge_polishing
PATH=/Users/lluzi/.local/node24/bin:$PATH \
node --experimental-strip-types scripts/live-check-dtco-pilot.ts \
  --app .hima-tmp/pilot-release-0.3.0-trial.20-0f36bac/HimaHarness.app \
  --site-profile .hima-tmp/wave4-heldout/site-profile.json \
  --out .hima-tmp/wave4-heldout/live-attempt1
```

The runner itself must prove, through native product receipts:

1. clean installed App profile and exact sealed Pack install;
2. product Site rediscovery and complete portable input binding;
3. independent Guide and persistent Campaign owner;
4. bounded real Research child plus independent Reviewer, candidate-only results and exact owner
   adoption under one parent budget;
5. source-linked Work Memory, native compaction, stale-summary behavior and cold Host/session
   recovery without replaying Jobs;
6. one complete current Pack graph, real DeepSeek owner algorithm, commercial LC/DC/Innovus tail,
   both matched route arms, non-zero custom-cell adoption in the final routed database and timing
   read from the same final database/report identities;
7. complete archive, immutable method/source hashes and final value-measurement receipt.

Do not create a second Run, edit the Pack, hand-substitute a stage, or turn an unknown into zero.
Preserve every failure. A reply timeout is not proof that a Job failed or ended.

## Terminal classification and handoff

If the live runner passes, run the zero-model, zero-new-Job audit against the exact evidence:

```sh
cd /Users/lluzi/code/hima_harness_reforge_polishing
PATH=/Users/lluzi/.local/node24/bin:$PATH \
node --experimental-strip-types scripts/audit-completed-dtco-pilot.ts \
  --evidence .hima-tmp/wave4-heldout/live-attempt1/evidence.json \
  --out .hima-tmp/wave4-heldout/offline-audit1
```

Use only these outcomes:

- `PASS`: valid matched evidence, non-zero final routed adoption and strictly positive final Fmax
  change. Do not publish a release; user sign-off is still required.
- `TERMINAL_NEGATIVE`: the same evidence validity gates pass, but final Fmax change is zero or
  negative. This closes #39 without any positive Fmax/product-value claim.
- `INVALID_EVIDENCE`: any tool failure, identity mismatch, incomplete route, zero final adoption,
  missing same-DB evidence, unresolved Job or product defect. It does not consume the bounded value
  attempt. Stop and hand the exact lowest-layer failure to Codex; do not retry the whole Campaign.

Write `Agent Trial Report v32.md` in the tester worktree. Name the exact Run, Campaign, owner, Guide,
children, Site, Pack/App/source identities, Jobs, tool-seat receipt, model sessions/request steps,
unmeasured token/human categories, final DB/report identities, physical findings, disposition and
claim limits. Run the repository-local tester handoff helper and send
`CODEX_HANDOFF_READY: <absolute report path>` in the same Claude session. Do not close an Issue,
publish a release or modify historical evidence.
