# HimaHarness Pack 5.2.10 human trial and bug-fix task

Invoke `/himaharness-human-like-tester` first. Do not proceed until the session
prints `HIMA_TESTER_SKILL_ACTIVE: hima-trial-24` and writes a fresh checkpoint.

## Mission

Operate HimaHarness as a senior chip-design user and run one new persistent
`aes_cipher_top` Custom Cell Fmax Campaign. Pack 5.2.10 retains the corrected Mock Liberty from trial.23 and fixes the generation-2 residual Research blocker: full hash-bound evaluation evidence may use the existing 8 MiB document bound before projection, while the Agent-visible context remains capped at 512 KiB. HimaHarness 0.3.0-trial.15 separately fixes the
Campaign Agent's monotonically growing ordinary progress-message queue.

Determine the first honest matched post-route result under the corrected Cell
model. The Campaign Goal remains at least 5% Fmax improvement at a requested
0.5 ns period, but a valid negative result is scientific evidence and must not
be rewritten as success. Preserve trial.13 through trial.23 unchanged.

HimaHarness and Catsights may be operated only by this Claude Desktop session.
One Pack version gets one Campaign and one persistent Run. A stopped Claude
turn never authorizes a duplicate Campaign.

## Fixed identities

| Item | Value |
| --- | --- |
| App | `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.15/HimaHarness.app` |
| Launcher | `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.15/launch-hima-trial.command` |
| App release | `https://github.com/lluzi/hima_harness_reforge_polishing/releases/tag/v0.3.0-trial.15` |
| App source | `7a054151810da8e2dbc15989a040dcc74725cbf1` |
| Notification fix | `d1dac47a6b1987f835de43634e8ad82d77e67a12` |
| Pack folder | `/Users/lluzi/code/hima_harness_reforge_polishing/packs/custom-cell-fmax-dtco` |
| Pack source main | `1bef653176e2de14ab657cd2cd72ae421ec81604` |
| Pack version | `5.2.10` |
| Pack digest | `e60bbfb6e3466872ff24e590adb31aab62f4232b5eb9c9db71db9c75dddb629c` |
| Pack release | `https://github.com/lluzi/hima_harness_reforge_polishing/releases/tag/custom-cell-fmax-dtco-v5.2.10` |
| Site | `luzi@192.168.50.41` |
| Physical profile | `/data/eda/project/hima_harness/polishing-runs/site-profiles/custom-cell-fmax-dtco-v5.2.1-physical-inputs.json` |
| Workspace root | `/data/eda/project/hima_harness/polishing-runs` |
| Design top | `aes_cipher_top` |
| Model | App-configured `DeepSeek-V4.1-Flash` / `deepseek-flash` |

The App kit bundles Pack 5.2.8. Install the released 5.2.10 Pack from the fixed
folder before creating the Campaign; do not run the bundled older Pack.

## Isolation and bug-fix boundary

Create and use only this worktree for any source fix:

```bash
git -C /Users/lluzi/code/hima_harness_reforge_polishing fetch origin
git -C /Users/lluzi/code/hima_harness_reforge_polishing worktree add \
  -b agent/hima-trial-bugfix-v24 \
  /Users/lluzi/code/hima_harness_agent_trial_fix_v24 \
  origin/main
```

Do not edit, reset, merge, rebase or push `main`. Do not create tags or
releases. Never delete Campaign or Site evidence. At the first reproducible
product blocker, pause safely, write a concise report in the v23 worktree and
send `CODEX_HANDOFF_READY: <absolute report path>`. Wait for Codex to integrate,
release and return an exact continuation identity.

## 1. Install and prepare

Launch the App on Catsights. Install Pack 5.2.10 with **Install tested method
upgrade** and confirm its version and method digest. Rediscover the existing
SSH Site and retain the fixed physical profile above. Ask HimaGuide to run
readiness and `bind-inputs` preflight. Confirm:

- `aes_cipher_top`;
- `MAX_NEW_CELLS=50`, `MAX_CELLS=400`;
- matching foundry CDL and Liberty family;
- `CCFMAX_POWER_TEMPLATE_BASE_CELL=ND2D1BWP40P140`;
- all declared commercial tools and wrappers are available.

Do not manually rewrite Pack YAML or copy evidence from an older Campaign.

## 2. Create one Campaign

Use target period 0.5 ns, target Fmax improvement 5%, 720 minutes, eight
generations and retry allowance two. Confirm once. Record Campaign ID, Run ID,
owner session, Pack digest, Site profile hash and remote workspace.

## 3. Verify Research and Cell Demands

At `research-candidates`, inspect the current authored program. It must use the
typed candidate fields and direct indexing. Every selected proposal needs a
source-bound key, positive required delay, current endpoints and a concrete
intervention. Confirm `merge` writes complete Cell Demands with pins, function,
truth table, target endpoints and D1/D2/D4/D6/D8 physical names.

Research may reuse methodology, but it must not copy trial.22's result or treat
its generated library as current evidence.

## 4. Verify corrected Mock Liberty before E0

Inspect `mock-liberty-calibration.json` before allowing LC/DC/P&R. Require:

1. `global_delay_scale` is exactly `0.95`.
2. `reference.reference_drive_cell` names the Site-declared D1 template.
3. Every depth anchor is built only from foundry D1 Cells; the report includes
   `drive_delay_ratios`, `drive_ratio_counts` and
   `d1_max_capacitance_pf_by_input_count`.
4. D2/D4/D6/D8 reference-point delay ratios come from matching foundry drive
   families. They must not reproduce the old synthetic ratios around 0.44 and
   0.39 for D2/D4.
5. Emitted maximum capacitance is bounded by the D1 foundry envelope times the
   requested drive, rather than the predictor's unconstrained axis.
6. A complete SPICE/LEF/Liberty family still has increasing width, area, input
   capacitance and load capacity, and decreasing output resistance.

For orientation only, the retained TSMC28 pre-release probe produced a depth-1
D1 anchor near 21.7 ps and empirical ratios near D2=1.041, D4=0.866,
D6=0.510 and D8=0.533. Treat the current Campaign report as authority. For the
previously over-optimistic `0005` family, values near 23.92/24.91/20.71 ps at
D1/D2/D4 are expected at 20 ps slew and 3 fF load; values near the old
11.25/4.39/3.96 ps indicate the wrong Pack or a regression.

If calibration is rejected, verify the existing feedback route returns to
Research. Do not start commercial validation for a rejected library.

## 5. Verify notification coalescing during the same Run

Record the composer's queued-message count at several execution boundaries.
Ordinary execution-completion notifications for this owner/Run must replace one
pending progress wake-up. They must not grow one-for-one with node executions.
After the Agent catches up, at most one ordinary progress notification may
remain, plus separately visible human pause/stop/continue/handoff messages.

Do not clear the queue manually to manufacture a pass. If it grows
monotonically again, retain the queue snapshots and Run/execution identities and
handoff the defect.

## 6. Continue the real Campaign

After calibration, LC and small DC/STA checks pass, continue the same Run
through one matched foundry/generated P&R pair. The cumulative custom library
must remain the only logical variable. Compare final-database adoption,
WNS/TNS, Fmax, area, power, DRC, connectivity and hold facts.

If improvement is below 5%, continue through the Pack's existing
`next-research` loop while budget remains. Each later generation must cite the
latest commercial response and translate the weak arc or endpoint into concrete
Cell Demands. End only on goal met, genuine convergence, budget exhaustion or a
new hard blocker.

## Generation-2 regression target

Trial.23 is immutable evidence: generation 1 produced a valid -3.92% matched Fmax result, then generation 2 blocked because `flow/library-richness/evaluation.json` was 586,571 bytes. In this trial, verify that the corresponding full evaluation remains hash-bound, projects to an Agent context below 524,288 bytes, and `research-candidates` can author a response to the prior commercial miss. A repeat of `evaluation exceeds the bound evidence file byte limit` is a release-blocking regression. Do not copy or edit trial.23 evidence into the new Run.

## 7. Report

Write the final report to:

`/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.15/Agent Trial Report v24.md`

Include exact identities, calibration anchors and ratios, representative
adopted Cell delays, queue-count observations, every model/EDA failure, matched
commercial facts and retained evidence paths. Distinguish facts from
interpretation. Use only `MILESTONE_PASS`, `LOOP_WORKS_TARGET_MISS`, `BLOCKED`
or `PARTIAL`; a non-terminal Run cannot receive a terminal verdict.
