# Wave 4 held-out L5 — trial.28 / attempt 12 — Computer Use only

Cycle: `hima-trial-32`. This is the first attempt in this cycle admitted specifically as a
human-like Desktop/Computer Use L5. Attempts 1–11 remain immutable engineering qualification or
invalid-test-mode evidence and do not consume the bounded value attempt.

## Mandatory preflight receipt — already PASS

Codex completed the lower-cost gates before authorizing this trial:

- packaged App static preflight: PASS; no Host, model, EDA or Desktop started;
- App bundle verification, isolated-home smoke and relocated Host smoke: PASS;
- Pack contract 26/26, residual-context 36/36, domain 173/173, runner continuation 2/2: PASS;
- complete held-out mapped-netlist structural preflight: PASS;
- exact Attempt 9 residual corpus: 13,353,534 bytes, 116/116 candidates, SHA-256
  `bfa741d1146795fc2a280f3af6813f7d6954207fe4ecb00b6a8b3489b9f7ac47`, projected context
  170,470 bytes under the unchanged 512 KiB limit: PASS;
- Site read-only status: `selected=new old=inactive new=active`, no live commercial client;
- stopped headless Attempt 11's already-launched `generate` Job settled exit 0; no process remains.

Do not repeat those gates through Desktop. If any fixed identity below differs, stop before launch.

## Fixed identities

- Main/manual: the current `main` containing this manual.
- Pack: `custom-cell-fmax-dtco@5.2.23`; digest
  `8a20cde2fc6056152a5abe303d9a52965adeffa09507313f2c6578499173aa8b`.
- Sealed test Run: `run-afee26dd-da8c-422e-8ba1-c2be1d866650`.
- App:
  `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/pilot-release-0.3.0-trial.28-fd5c08a/HimaHarness.app`.
- App version `0.3.0-trial.28`; source `fd5c08ac0bf79cd0674857c909476a5511477284`;
  artifact digest `754c2feb7ee7a3c3ec94e8a486c8e21db7d9d1f5e3657478d9c5cc4e38e393aa`;
  manifest SHA-256 `f5d65dfc8bc43447f0bab0e99ab07534f5501c98c022c0878eb66eb00eca311e`.
- Site profile:
  `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/wave4-heldout/site-profile-v3.json`;
  Site `wave4-heldout-20260926002246`.
- Held-out `ibex_core`: 37 RTL files; canonical SHA-256
  `92fa54e1491cffd3107053b6c5d6c2714f79c79b5ff0f4a6086adb29b7636cfd`.

## Prohibited substitution

Do **not** run `scripts/live-check-dtco-pilot.ts` without `--preflight-only`. Do not use shell,
HTTP, Host APIs, `hima_execute`, Ledger mutation or direct remote commands to operate the Campaign.
Those mechanisms may diagnose a UI symptom only after the symptom is preserved; they do not count
as the user journey.

HimaHarness and Catsights are the only product-control surfaces. The shell may be used once to start
the delivered App and, after a UI-visible terminal result or failure is preserved, for read-only
identity/evidence verification.

## Start the delivered App

Start a fresh, version-isolated GUI through the delivered launcher:

```sh
cd /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/pilot-release-0.3.0-trial.28-fd5c08a
zsh ./launch-hima-trial.command
```

Keep that terminal alive. Bind Claude Code Computer Use to the visible `HimaHarness` window on
Catsights. Take a screenshot before the first product action.

## Human-like journey

Perform the journey through visible controls and visible conversations:

1. In HimaGuide, ask what HimaHarness can do and what the bundled DTCO Pack requires. Record the
   visible answer; do not paste a memorized task script.
2. Use the visible Pack controls to inspect and, when offered, install/upgrade the exact Pack.
3. Use the visible Site/Preparation path to discover or review the assigned Site. Supply only the
   normal user-visible connection/profile inputs that the UI asks for. Do not copy a hidden Site
   YAML into the home.
4. Let HimaGuide prepare the held-out design and explain readiness/unknowns. Inspect Pack, Site,
   design top, constraints, limits and knowledge in the UI.
5. Confirm exactly one Campaign proposal once. Record Campaign, Run, Guide and owner identities.
6. Open the Campaign owner and observe the reference graph/current node. Continue work by speaking
   to the visible owner in HimaHarness; do not externally drive its tools.
7. Open the Agent team and at least one child transcript/artifact through the UI. Verify candidate
   output is not adopted before the owner decision. Keep Guide independently usable.
8. While the Campaign runs, use normal conversation and visible pause/continue only if the UI path
   calls for it. Do not cancel a live Job because a Claude turn ends.
9. At meaningful stage boundaries, inspect visible Job state, evidence and artifacts. Capture the
   first UI-visible failure before any source/API diagnosis.
10. If the Campaign reaches commercial stages, verify that the UI shows the actual tool/Job state;
    wait for settlement. Inspect adoption, route, final database, timing, physical checks and
    matched conditions through the product.
11. At terminal state, inspect the report/knowledge asset in the UI and record its exact claim
    limits. A valid zero/negative matched result is `TERMINAL_NEGATIVE`, not a defect.

## Evidence and handoff

Store screenshots and concise notes under
`.hima-tmp/wave4-heldout/ui-attempt12/`, named by Campaign/Run and timestamp. After a UI-visible
terminal result or preserved failure, shell/API reads are allowed only to verify immutable IDs,
hashes, tool exits and artifacts; they must not mutate or continue the Run.

Update `Agent Trial Report v32.md`. Write `tester-checkpoint.json`, report and
`tester-handoff.json` first, then send `CLAUDE_HANDOFF_READY`. Do not launch attempt 13. No timer
polling.
