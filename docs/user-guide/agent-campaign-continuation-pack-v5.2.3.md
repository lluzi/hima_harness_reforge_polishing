# HimaHarness Pack 5.2.3 human trial and bug-fix task

Invoke `/himaharness-human-like-tester` first and require `HIMA_TESTER_SKILL_ACTIVE: hima-trial-18` before following this manual.

## Mission

Pack 5.2.3 keeps the validated writer-to-Reader contract and optimizes the long Mock Library layout stage found in trial.17. It reuses the validated 5.2.1 Site profile because the input contract is unchanged. Prove that 50 demands produce 250 distinct physical LEFs with only 50 placement-solver runs, 200 topology reuses and up to five concurrent families before continuing to characterization.

Operate HimaHarness as a first-time senior chip-design user and continue the
`aes_cipher_top` Custom Cell Fmax Campaign with Reference Pack 5.2.3. The
Campaign Goal remains at least 5% matched post-route Fmax improvement. This
trial must validate the new electrical drive family, topology-anchored Mock
Liberty, typed Research feedback and Cell Demand loop before spending a full
matched P&R pair.

Use HimaHarness and Catsights only from this Claude Desktop session. Keep the
previous trial.13 through trial.17 Runs immutable. One new Pack version requires one new
persistent Campaign; a stopped Claude turn never justifies another Campaign.

## Fixed identities

| Item | Value |
| --- | --- |
| App | `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.14/HimaHarness.app` |
| Launcher | `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.14/launch-hima-trial.command` |
| Pack folder | `/Users/lluzi/code/hima_harness_reforge_polishing/packs/custom-cell-fmax-dtco` |
| Pack version | `5.2.3` |
| Pack release | `https://github.com/lluzi/hima_harness_reforge_polishing/releases/tag/custom-cell-fmax-dtco-v5.2.3` |
| Site | `luzi@192.168.50.41` |
| Active physical profile | `/data/eda/project/hima_harness/polishing-runs/site-profiles/custom-cell-fmax-dtco-v5.2.1-physical-inputs.json` |
| Workspace root | `/data/eda/project/hima_harness/polishing-runs` |
| Design top | `aes_cipher_top` |
| Model | the App's configured `DeepSeek-V4.1-Flash` / `deepseek-flash` |

## Isolation and bug-fix boundary

Create and use only this worktree for source fixes:

```bash
git -C /Users/lluzi/code/hima_harness_reforge_polishing fetch origin
git -C /Users/lluzi/code/hima_harness_reforge_polishing worktree add \
  -b agent/hima-trial-bugfix-v18 \
  /Users/lluzi/code/hima_harness_agent_trial_fix_v18 \
  origin/main
```

Do not edit, reset, merge, rebase or push `main`. Do not create tags or releases.
Preserve every Campaign artifact and never delete Site files. Diagnose from the
first failing boundary, make the smallest fix in the worktree, run the cheapest
relevant test, commit and push only `agent/hima-trial-bugfix-v18`.

## Coordination protocol

Do not wait for the user to carry reports between Claude and Codex. At the first
release-blocking product defect:

1. pause the persistent Run at a safe boundary and preserve the failing bytes;
2. write the concise evidence report under your v18 worktree;
3. send `CODEX_HANDOFF_READY: <absolute report path>` in this Claude session;
4. stop expanding the fix after one red/green regression and the relevant
   low-cost subset; do not create a release or resume the sealed Run;
5. wait for Codex to return a main commit, Pack version/digest and continuation
   instruction.

Codex is checking this same session every 15 minutes. Continue healthy Campaign
work without narration; use the marker only for completion, a product decision
or an actionable blocker.

## 1. Install and prepare

Launch the App on Catsights. In **Pack & assets**, install 5.2.3 from the fixed
Pack folder. If an older `custom-cell-fmax-dtco` exists, use **Install tested
method upgrade**. Confirm version and `VERSION.yml` method digest in the UI.

Rediscover the existing SSH Site. Change only its `physicalInputs` binding to
the 5.2.3 active profile above. The profile is already present and retains the
5.1.9 values while adding the matching foundry CDL:

`.../Back_End/spice/tcbn28hpcplusbwp40p140_110a/tcbn28hpcplusbwp40p140_110a.spi`

Ask HimaGuide to run readiness and Pack `bind-inputs` preflight. Confirm
`MAX_NEW_CELLS=50`, `MAX_CELLS=400`, top `aes_cipher_top`, and that
`FOUNDRY_CDL` and `FOUNDRY_LIB` name the same foundry library family. Do not
manually rewrite Pack YAML.

## 2. Create one Campaign

Use target period 0.5 ns, target Fmax improvement 5%, 720 minutes, 8
generations and retry allowance 2. Confirm once and record Campaign ID, Run ID,
owner session, Pack digest, Site profile SHA and remote workspace.

## 3. Verify Research before E0

At `research-candidates`, inspect the current context and authored `entry.py`.
The candidate program must use exact typed fields and direct indexing; use of
`dict.get` for candidate or commercial feedback is a product failure. Every
selected proposal must state:

- a source-bound `proposal_key`;
- `required_delay_ns` as a positive number;
- concrete `target_endpoints` from the current Campaign;
- one intervention: `new-function`, `sizing`, `stack-optimization`,
  `alternative-topology`, or `physical-fusion`.

When prior commercial feedback exists, `research.json.feedback_ab` must contain
the exact selected proposal keys with and without that response. A changed
selection needs a causal explanation. An unchanged selection needs an explicit
evidence-based explanation; a silent unchanged ranking fails.

Confirm `merge` publishes `flow/mining/cell-demands.json`. For each demand,
verify input pins, output pins, Boolean functions, truth table, required delay,
target endpoints and all five physical Cell names.

## 4. Verify the electrical family and calibration gate

Before LC or P&R, inspect one complete demanded family:

1. SPICE contains D1/D2/D4/D6/D8 with strictly increasing MOS widths.
2. LEF width/area increases with drive; five renamed copies with equal geometry fail.
3. `mock-liberty-calibration.json` contains foundry CDL/Liberty depth anchors at
   20 ps input slew and 3 fF output load.
4. Input capacitance, area and maximum load increase with drive; output
   resistance decreases.
5. D1 arc delay shows logic depth and P/N stack factors plus the single
   `global_delay_scale` from `mock_liberty_policy.json`.
6. At least one drive meets each Cell Demand. A miss must return to Research
   before commercial validation.

Then allow one bounded real LC compile and one small DC STA check. Preserve the
logs, generated `.lib/.db`, demand ledger and calibration report. These checks
prove format and timing visibility, not design-level benefit.

## 5. Continue the real Campaign

After the low-level gates pass, continue the same Run through one matched
foundry/generated P&R pair. The cumulative custom Library remains the only
logical variable. Compare adoption, route retention, WNS/TNS, Fmax, area,
power, DRC/connectivity and Active Frontier migration from final databases.

If Fmax improvement is below 5%, continue through `next-research` in the same
Run. The next Research turn must cite the latest commercial response and turn
the concrete weak arc or endpoint into sizing, stack, topology or fusion
Demands. Continue until Goal met, genuine convergence, budget exhaustion or a
new hard blocker.

## 6. Report

Write the report to:

`/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.14/Agent Trial Report v18.md`

Include exact identities, each gate, every model/EDA failure, the feedback A/B,
Cell Demands, five-drive electrical facts, E0 results, retained evidence paths,
and every bug-fix commit/test. Distinguish observed facts from interpretation.
Use only `MILESTONE_PASS`, `LOOP_WORKS_TARGET_MISS`, `BLOCKED`, or `PARTIAL` as
the final verdict; a non-terminal Run cannot receive a terminal verdict.
