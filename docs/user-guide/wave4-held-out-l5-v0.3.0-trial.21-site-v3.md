# Wave 4 held-out L5 continuation — trial.21 / Site v3

Cycle: `hima-trial-32`. The Wave 4 closure plan states that tool failure or invalid evidence returns
to the lowest owning layer and does not consume the bounded value attempt. This manual therefore
continues the same acceptance after two retained pre-commercial `INVALID_EVIDENCE` Runs; it does
not authorize repeated value exploration.

The complete method, budgets, evidence rules and terminal vocabulary remain in
`wave4-held-out-l5-v0.3.0-trial.20.md`. The trial.21 delegation repair remains governed by
`wave4-held-out-l5-v0.3.0-trial.21.md`.

## Retained attempts

- Attempt 1: Run `run-321ba9a1-f939-4e1d-80fd-0fe99ade7837`; Researcher had no scoped local read
  capability. No commercial EDA ran.
- Attempt 2: Run `run-31b83856-7a03-4f9a-a3a4-3b12ab90bc9d`; the repaired Research/Reviewer/team
  path passed live, then `bind-inputs` correctly rejected a physical profile missing
  `FOUNDRY_CDL_SHA256`. No commercial EDA ran.
- Both Runs, output directories, tester checkpoint and `Agent Trial Report v32.md` remain immutable.

## Fixed identities

- Main and `origin/main`: `e54cf8cda74b27c616f8b4e5b4fa82df55be4a93`.
- App remains the clean, product-identical trial.21 candidate built from
  `f6d263aa51ceedad33569d61bf71a141e23e4dcf`:
  `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/pilot-release-0.3.0-trial.21-f6d263a/HimaHarness.app`.
  No packaged product input changed after that source.
- App artifact digest `5636d6946103a5304589d1a8c2de083801a3f5c1a607c587f9cba25610e0bf51`;
  manifest SHA-256 `8d745911a91c9e934f83ffcf82fd49c57d97aad3f776da554f24dec3e64ee9fd`.
- Pack remains `custom-cell-fmax-dtco@5.2.16`, method digest
  `7b4a59be2a412d0052601b3384e5a2be35d2664c0ea7094206699f6e020fcbff`.
- New private Site profile:
  `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/site-profile-v3.json`;
  SHA-256 `19f81227259983a1990467af54f74bfb189580eca16c8a6d330a44d941ef0cf8`;
  Site `wave4-heldout-20260926002246`.
- Held-out `ibex_core` identity is unchanged: 37 RTL files, canonical SHA-256
  `92fa54e1491cffd3107053b6c5d6c2714f79c79b5ff0f4a6086adb29b7636cfd`.
- Foundry CDL: version `tsmc28-hpcplus-110a`, SHA-256
  `519cc78c10e21868274dd92b96e70be360599cc3f87a35c4c55f4e8e70a11cd6`.
- The staging helper executed the exact sealed `bind-inputs.py` bytes, SHA-256
  `f88793f51d39fbe1c0d94d3c4673bf1325484ca6f800e64542f69fabeafb7f7f`, against the new real
  profile. It passed for 37 RTL files and produced `inputs.json` SHA-256
  `646a24e499346a19054e518e2c7c23eb458fa7d333e287f34d768dc06b5815c4` with zero commercial Jobs.

## Cheap gate

Verify no HimaHarness App/Host or commercial client remains active, preserve all prior evidence, then:

```sh
cd /Users/lluzi/code/hima_harness_reforge_polishing
PATH=/Users/lluzi/.local/node24/bin:$PATH \
node --experimental-strip-types scripts/live-check-dtco-pilot.ts \
  --preflight-only \
  --app .hima-tmp/pilot-release-0.3.0-trial.21-f6d263a/HimaHarness.app \
  --site-profile .hima-tmp/wave4-heldout/site-profile-v3.json
```

Continue only if App, Pack, Site, RTL and CDL identities match exactly and the final environment is
`selected=new old=inactive new=active` with no conflicting commercial client. Use the inherited
`DEEPSEEK_API_KEY`; never print or record it.

## Continue the same acceptance

```sh
cd /Users/lluzi/code/hima_harness_reforge_polishing
PATH=/Users/lluzi/.local/node24/bin:$PATH \
node --experimental-strip-types scripts/live-check-dtco-pilot.ts \
  --app .hima-tmp/pilot-release-0.3.0-trial.21-f6d263a/HimaHarness.app \
  --site-profile .hima-tmp/wave4-heldout/site-profile-v3.json \
  --out .hima-tmp/wave4-heldout/live-attempt3
```

Do not reuse attempt1/attempt2 workspaces, Runs or partial outputs. Do not create a duplicate Run.
Monitor this exact process to terminal evidence. If the live result is valid, run:

```sh
cd /Users/lluzi/code/hima_harness_reforge_polishing
PATH=/Users/lluzi/.local/node24/bin:$PATH \
node --experimental-strip-types scripts/audit-completed-dtco-pilot.ts \
  --evidence .hima-tmp/wave4-heldout/live-attempt3/evidence.json \
  --out .hima-tmp/wave4-heldout/offline-audit3
```

Only the offline-audited matched result may yield `PASS` or `TERMINAL_NEGATIVE`. Any further
`INVALID_EVIDENCE` must stop at its exact lowest-layer cause; do not improvise another Campaign.
Update the same `Agent Trial Report v32.md` with all three attempts, run the handoff helper and print
`CODEX_HANDOFF_READY: <absolute report path>`. Do not publish a release or close an Issue.
