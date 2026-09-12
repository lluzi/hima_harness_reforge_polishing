# Live check: the pack authoring pipeline, 2026-09-11

Two real stages through the product, with a key from the launching environment (35 characters, beginning "sk-b").
HimaHarness on DeepSeek Harness 0.1.5-alpha.1 (Node v24.20.0), on the booted host with **no replay overlay**: the host composed its own DeepSeek adapter.

**PASS** — 16 of 16 checks passed.

## What ran

- Golden Flow at `/var/folders/yv/b9msj2491d7fdrg2y8gr0rh00000gp/T/hima-home-wUtWjt/standin-flow`, read where it lies.
- Pack folder `/var/folders/yv/b9msj2491d7fdrg2y8gr0rh00000gp/T/hima-home-wUtWjt/hima/packs/authored-probe` (`authored-probe`), the session's own working directory.
- Tools the grill stage called: ["bash","bash","glob","glob","read /var/folders/yv/b9msj2491d7fdrg2y8gr0rh00000gp/T/hima-home-wUtWjt/standin-flow/Makefile","read /var/folders/yv/b9msj2491d7fdrg2y8gr0rh00000gp/T/hima-home-wUtWjt/standin-flow/flows/opene902/config.mk","read /var/folders/yv/b9msj2491d7fdrg2y8gr0rh00000gp/T/hima-home-wUtWjt/standin-flow/build/opene902/summary.txt","read /var/folders/yv/b9msj2491d7fdrg2y8gr0rh00000gp/T/hima-home-wUtWjt/standin-flow/manifests/designs.tsv","read /var/folders/yv/b9msj2491d7fdrg2y8gr0rh00000gp/T/hima-home-wUtWjt/standin-flow/tools/make_dc_inputs.py","read /var/folders/yv/b9msj2491d7fdrg2y8gr0rh00000gp/T/hima-home-wUtWjt/standin-flow/build/opene902/fail-remaining","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/skills/knowledge/what-a-golden-flow-is.md","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/skills/knowledge/over-constrain-and-read-the-violation.md","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/skills/knowledge/end-honestly-in-more-than-one-way.md","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/skills/knowledge/assert-the-checker-options.md","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/skills/knowledge/one-checker-per-session.md","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/skills/knowledge/attribute-by-database-relation.md"].
- Tools the spec stage called: ["bash","bash","glob","glob","read /private/var/folders/yv/b9msj2491d7fdrg2y8gr0rh00000gp/T/hima-home-wUtWjt/hima/packs/authored-probe/INTENT.md","glob","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/skills/knowledge/what-a-golden-flow-is.md","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/skills/knowledge/over-constrain-and-read-the-violation.md","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/skills/knowledge/end-honestly-in-more-than-one-way.md","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/skills/knowledge/assert-the-checker-options.md","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/skills/knowledge/one-checker-per-session.md","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/skills/knowledge/attribute-by-database-relation.md","read /var/folders/yv/b9msj2491d7fdrg2y8gr0rh00000gp/T/hima-home-wUtWjt/standin-flow/Makefile","glob","glob","read /private/var/folders/yv/b9msj2491d7fdrg2y8gr0rh00000gp/T/hima-home-wUtWjt/hima/packs/opene902-timing-probe/contract.yml","read /private/var/folders/yv/b9msj2491d7fdrg2y8gr0rh00000gp/T/hima-home-wUtWjt/hima/packs/opene902-timing-probe/graph.yml","read /private/var/folders/yv/b9msj2491d7fdrg2y8gr0rh00000gp/T/hima-home-wUtWjt/hima/packs/opene902-timing-probe/PACK.md","read /private/var/folders/yv/b9msj2491d7fdrg2y8gr0rh00000gp/T/hima-home-wUtWjt/hima/sites/local.yml","read /private/var/folders/yv/b9msj2491d7fdrg2y8gr0rh00000gp/T/hima-home-wUtWjt/hima/sites/local.permit.yml","read /private/var/folders/yv/b9msj2491d7fdrg2y8gr0rh00000gp/T/hima-home-wUtWjt/hima/packs/opene902-timing-probe/tools/synth.sh","glob","grep","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/src/readers.ts","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/rules/clock-period-at-most.yml","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/rules/setup-wns-all-nonnegative.yml","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/choosers/timing-push.yml","grep","glob","grep","grep","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/src/packs.ts","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/skills/hima-grill/SKILL.md","grep","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/src/packs.ts","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/src/packs.ts","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/src/packs.ts","grep","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/src/packs.ts","grep","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/src/rules.ts","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/src/semantics.ts","grep","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/src/node-turns.ts","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/src/choosers.ts","grep","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/src/choosers.ts","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/src/packs.ts","bash","grep","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/src/fabric.ts","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/src/fabric.ts","grep","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/src/choosers.ts","read /Users/lluzi/code/hima-harness-worktrees/task63/packages/harness/src/choosers.ts","write /private/var/folders/yv/b9msj2491d7fdrg2y8gr0rh00000gp/T/hima-home-wUtWjt/hima/packs/authored-probe/SPEC.md","grep","glob"].
- The folder's stage afterwards: `specified`.
- Files changed outside the pack folder: [].

## What the grill stage said

```
I'll start by orienting: what directory I'm in, whether it's a real pack folder, and what the Golden Flow looks like.

No shell in this session — read tools only. Let me orient with glob.

Pack folder is empty (correct for a new pack). Now let me read the Golden Flow, starting with its build file.

Now the rest of the flow: the existing build, the manifest, the report, and the input generator.

Now the six knowledge files the skill requires me to read.

I have the flow and the knowledge files. Before writing anything, let me grill you. Here's what I read and what I need settled.

**What I found:** the flow is `.../standin-flow`, and its `Makefile` (476 lines, no default target — stages run one at a time: `synth mine netlist abstract charlib lc synth-custom pnr verify`). It takes `CLOCK_PERIOD_NS` on the command line, rounds it to two decimals (`%.2f`), and writes timing to two places: `results/$(DESIGN)/syn/report$(TAG_SUFFIX)/qor.rpt` (from `synth`/`synth-custom`: `Critical Path Slack`, `Critical Path Clk Period`, `Total Negative Slack`, `Worst Hold Violation`) and `results/$(DESIGN)/pnr-$(ARM)/postroute.json` (from `pnr`: `criticalPathNs`, `wnsNs`). The `verify` stage writes `verify_drc.rpt` and `liveness.json` — a **violation count, not a slack**. That last point is already a disagreement with your words, and it has its own question below.

## Round 1

1. **What does a generation vary, and how finely?** I read your words as: exactly one knob, `CLOCK_PERIOD_NS`, everything else left at the flow's defaults. I'd also recommend a hard box of **0.10–10.00 ns** so a generation can never ask the flow something absurd, and stepping in **0.01 ns**, because the flow's report rounds to two decimals (`%.2f`) and a move smaller than that is a move no report can show. Agree?

2. **Which report do you read the setup slack out of?** You said "its verification report", but the flow's `verify` stage reports a DRC violation count and no slack — the only setup slack numbers are `Critical Path Slack` in `<flowRoot>/results/opene902/syn/report/qor.rpt` and `wnsNs` in `.../pnr-<ARM>/postroute.json`. I recommend the `qor.rpt` `Critical Path Slack` line, since that is the pre-route number your flow writes after `synth` and re-writes after `synth-custom`. Confirm, or tell me it is the pnr WNS you actually read.

3. **Does the number disagree with itself?** The flow has `ACHIEVABLE_NS ?= 2.20` — spelled out in its own comment as "what this flow can actually close at" — but `ACHIEVABLE_NS` is a caller-settable command-line variable, so the flow will print whatever you tell it there, and `synth-custom`/`pnr` scale it by adopted masters (`a * (1 - m*0.015)`). I recommend the pack reads the **reported slack from the report as a found fact**, and treats the `ACHIEVABLE_NS` the flow was handed as a pack-declared constant that is never varied — so the measurement is the flow's own arithmetic read back, never an echo of what we asked. Is that right for your business, or do you want the pack to vary `ACHIEVABLE_NS` too?

4. **What is the one number that decides better-or-worse, and in what unit?** I recommend exactly one measured value: **setup slack in ns**, as printed by the flow (two decimals, negative when short). The other three report lines would be recorded but not optimized on. Agree — or is `Total Negative Slack` the number you steer by?

5. **What ends a Campaign of this pack?** I recommend three declared endings: (a) **goal met** — a passing generation at the tightest period the step still resolves; (b) **converged** — the pass/fail frontier stops moving for 2 consecutive generations; (c) **an ending you declare** — the flow stops a generation for a reason that is not timing, which in this flow means the library gate (`LC_FAIL=1` → exit 4) or a stage that cannot run. A generation limit stays only as a budget that is never reported as a conclusion. Agree, or is there a fourth stop you know about?

Answer in one word where you agree, and tell me where I've got it wrong.
```

## What the spec stage said

```
I'll start by reading the intent record and checking what's in this pack folder.

No shell in this session — I'll use read/glob/grep as the skill requires.

INTENT.md has all five sections, each with content. Now the six knowledge files and the flow at its pointer.

All six knowledge files read. Now the Golden Flow at the pointer the record gives, and a look at any sibling pack for contract vocabulary.

The neighboring pack and the Site are the vocabulary I must compile into. Reading them.

Now I have the vocabulary a spec must compile into. Let me verify what rules, readers and choosers actually exist, so I name only real ones and invent no numbers.

The stand-in's `timing-push` is exactly the chooser the knowledge file warns against. Let me see what a spec is actually validated against, and whether an over-constraining chooser already exists.

`packs.ts` holds the compiler. Let me read how it treats `SPEC.md` — that's the contract my file must satisfy.

Now the framing is clear: the intent resolves to an over-constraining chooser (the opposite of the shipped `timing-push`). Let me check the intent and spec skills' sibling for the compile contract, and how derived values/workshops are declared.

Two hard constraints are emerging: pack-declared readers are unrunnable, and convergence must be a chooser read. Let me read the graph schema and how explore/goal/rules bind.

The design is nearly settled. Two implementation facts remain that decide how endings are written: how a Run ends when nothing draws an edge, and how the goal verdict maps to `ended-goal-not-met`.

I have the full picture now. Writing the one file this stage produces.

Written. Let me verify the file validates — exactly the nine sections, in order, none empty.

`SPEC.md` is written, and it is the only file created — `INTENT.md` is untouched.

It holds exactly the nine sections, in order, each in this pack's own words and each naming the knowledge file that shaped it:

- **Goal template** — the target `target_period_ns` and the strategy's `periodNs`, with the asked / reported / achievable distinction the whole method turns on.
- **Constraints** — the achievable period against the target, setup and hold non-negative, and the options the measurement was made under.
- **Run contract** — the three Site bindings, the judged report, the `make` wrapper, the workspace copy, the `synth` and `compile-library` tools with their seats, the three strategy knobs, and the words for the faces.
- **Semantics** — the five values `dc-qor-report` actually emits, and the one reading that must never be guessed: `setup_wns == 0.00` is the absence of margin, not a margin of zero.
- **Judge rules** — the setup constraint the graph branches on, and the goal rule over the *derived* achievable period.
- **Choosers** — `over-constraining-push`: `asked + |violation|` on a fail, one step tighter than the period believed possible, and never looser on a pass.
- **Endings** — goal met, converged on the achievable period, the answer found above the target, the flow's refusals and unreadable reports as declared blockers — with the generation limit kept a budget.
- **Workshops** — none at run time, with the reason and the one case that would earn one.
- **Knowledge** — three files to write into the pack's `knowledge/`.

Two constraints I found in the compiler shaped the wording rather than the method: a pack's own reader is unrunnable, so every value in `Semantics` is one the bundled reader produces and the achievable period is stated as derivation over them; and convergence must be a value the chooser actually reads, so it is declared on `boundary`, the measured achievable period.
```

## The sections the spec stage wrote

```json
[
  "Goal template",
  "Constraints",
  "Run contract",
  "Semantics",
  "Judge rules",
  "Choosers",
  "Endings",
  "Workshops",
  "Knowledge"
]
```

## The home, read afterwards

- 27 files read under `$DSH_HOME` and the workspace.
- Files that could not be read: [].
- Files holding the key: [].

The key came from the launching environment. HimaHarness writes no credentials file and no env file, reads a key by no path of its own, and no record above carries one.

## Checks

| Claim | Predicate | Saw | |
|---|---|---|---|
| the person's own message injected the grill skill | `the session holds a skill-invocation for hima-grill` | `["hima-grill"]` | PASS |
| the grill stage answered at all | `the model said something` | `4020 characters` | PASS |
| the grill stage asked rather than improvised | `the answer holds at least two numbered questions` | `5 numbered lines` | PASS |
| the grill stage wrote no record before the author had answered | `the pack folder is still empty` | `[]` | PASS |
| the person's own message injected the spec skill | `the session holds a skill-invocation for hima-spec` | `["hima-spec"]` | PASS |
| the spec stage wrote the pack spec | `SPEC.md is in the pack folder` | `/var/folders/yv/b9msj2491d7fdrg2y8gr0rh00000gp/T/hima-home-wUtWjt/hima/packs/authored-probe/SPEC.md` | PASS |
| the pack spec holds exactly the nine sections, in order | `Goal template, Constraints, Run contract, Semantics, Judge rules, Choosers, Endings, Workshops, Knowledge` | `["Goal template","Constraints","Run contract","Semantics","Judge rules","Choosers","Endings","Workshops","Knowledge"]` | PASS |
| the spec stage wrote one file in the pack folder and touched nothing else in it | `the only change under the pack folder is a new SPEC.md` | `["/var/folders/yv/b9msj2491d7fdrg2y8gr0rh00000gp/T/hima-home-wUtWjt/hima/packs/authored-probe/SPEC.md (new)"]` | PASS |
| the folder stands at specified | `packStage says specified` | `specified` | PASS |
| neither stage wrote outside the pack folder | `no file under the Golden Flow, the workspace or the other packs changed` | `[]` | PASS |
| the intent record is exactly the one written into the folder | `INTENT.md is unchanged` | `2499 characters` | PASS |
| the intent record still holds its five sections | `Business, Golden Flow, Answers, Ambiguities resolved, Knowledge applied` | `["Business","Golden Flow","Answers","Ambiguities resolved","Knowledge applied"]` | PASS |
| the scan read the home rather than nothing | `the seeded intent record and the spec the model wrote are among the files read` | `27 files, records read: ["/var/folders/yv/b9msj2491d7fdrg2y8gr0rh00000gp/T/hima-home-wUtWjt/hima/packs/authored-probe/INTENT.md","/var/folders/yv/b9msj2491d7fdrg2y8gr0rh00000gp/T/hima-home-wUtWjt/hima/packs/authored-probe/SPEC.md"]` | PASS |
| the scan read every file it found | `no file under the home was unreadable` | `[]` | PASS |
| the key reached no file the run wrote | `no file under the home holds the key` | `[]` | PASS |
| the harness wrote no env file | `no .env exists under the home` | `[]` | PASS |

