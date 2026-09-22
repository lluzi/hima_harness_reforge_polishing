# XTop Timing Closure Pack 1.0.2 human-like trial and bug-fix task

Invoke `/himaharness-human-like-tester` first. Do not continue until the Claude session prints:

```text
HIMA_TESTER_SKILL_ACTIVE: hima-trial-27
```

This is the first real HimaHarness Campaign for a compiled development Pack. It is intentionally
not release-sealed yet. The trial decides whether the Fabric-controlled algorithm can execute,
learn from endpoint feedback and iterate until timing is clean or measured progress converges.

## Mission

Operate HimaHarness as a senior timing-closure engineer. Install `xtop-timing-closure@1.0.2`, import
the `linglong-swerv28` Site, and create exactly one persistent Campaign from the already completed
SWERV28 Innovus checkpoint. Let the owning Campaign Agent drive the graph through XTop, Innovus,
StarRC and PrimeTime. Continue the same Run across Claude turns until one terminal condition is
supported by retained evidence.

Claude is the only HimaHarness and Catsights operator. Codex may inspect Claude's report and source
evidence but must not operate the App or Campaign concurrently.

## Fixed identities

| Item | Value |
| --- | --- |
| App | `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.16/HimaHarness.app` |
| Launcher | `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.16/launch-hima-trial.command` |
| App release | `https://github.com/lluzi/hima_harness_reforge_polishing/releases/tag/v0.3.0-trial.16` |
| Pack folder | `/Users/lluzi/code/hima_harness_reforge_polishing/packs/xtop-timing-closure` |
| Pack source commit | `6a58e990388426e6c2b659d15bfd48e3885a34ca` |
| Pack version | `1.0.2` |
| Pack digest | `976128443a5b80638dc844fb5e5dc0a7ad0b7d80b9c096a4e832d87c68562502` |
| Pack author status | `development` |
| Site folder | `/Users/lluzi/code/hima_harness_reforge_polishing/sites/linglong-swerv28` |
| Site profile | `/data/eda/project/hima_harness/xtop-timing-closure-inputs/swerv28-site-profile.json` |
| Input DB | `/data/eda/project/design_zoo/pr/swerv_wrapper_tsmc28/foundation/DBS/xtop_round2_eco_route.enc.dat` |
| Workspace root | `/data/eda/project/hima_harness/xtop-timing-closure-runs` |
| Design | `swerv_wrapper` |
| Display | `Catsights` |

The Pack is installed from the fixed folder because this Campaign is its release qualification.
Do not add `TEST.md`, hand-edit `VERSION.yml`, or call it released during the trial.

Trial 25/26 and Runs `run-85953ff1-ce10-4d06-9ff7-3c137e2d6a00` and
`run-7f3044b7-3343-458b-a6ba-4ef5cbe5a37b` are immutable blocked evidence. Version 1.0.1 proved
the Tcl parameter fix end to end: Innovus restored the checkpoint and exported a 148 MB DEF and an
18 MB netlist. Trial 26 then showed that StarRC's TBB `LD_LIBRARY_PATH` must be set inside the
container shell; version 1.0.2 adds that narrowly scoped environment prefix. A quarantined live
probe produced an 83 MB SPEF with `Errors: 0`, but no Campaign node has yet admitted that fix. This
trial must create a new Campaign for Pack 1.0.2 and must not resume, edit or copy either older Run.

## Isolation and bug-fix boundary

Use only the assigned tester worktree and branch from the direct `HIMA_TEST_TASK_V1` envelope. Never
edit, reset, rebase, merge or push `main`. Do not modify the installed Pack in place after the
Campaign starts. Preserve all Campaign evidence and the source Foundation Flow.

At a reproduced product blocker, stop advancement at a safe boundary, create a seconds-scale red
test in the assigned worktree, make the smallest fix, commit and push only the tester branch, write
the report, run the tester handoff command and print `CODEX_HANDOFF_READY: <absolute report path>`.
Do not hot-patch the active Run.

## 1. Human-like installation

Launch App 0.3.0-trial.16 on Catsights. Begin from the visible UI. Ask HimaGuide what the new Pack
does, then install it from the fixed Pack folder as a new development method. Confirm the visible
identity is `xtop-timing-closure@1.0.2` and the digest equals the fixed digest.

Import or rediscover `linglong-swerv28` from the fixed Site folder. Confirm the Site binds the input
database, source manifest, Site profile and workspace root. Do not hand-edit Pack YAML to make the
check pass.

## 2. Cheap admission gate

Before spending a license minute, verify through the product and retained source evidence:

1. Pack check is fit for `linglong-swerv28`.
2. The source manifest verifies all 27 calibrated Foundation files.
3. The input `.enc.dat` directory and its sibling restore script are non-empty and read-only source.
4. The deployed Site profile hash is
   `dd62bb90a310480fd082ad2e3c4268bdb0a794796df2712ba5a997a27a78ed26`.
5. `/data` is healthy, no protected Innovus/StarRC/PT/XTop job is active, and the required license
   services and EDA container are available.
6. The Campaign will write only beneath the declared Hima workspace root.

If this gate fails, do not launch commercial tools. Preserve the exact UI and backend evidence and
handoff `BLOCKED` or a product defect.

## 3. Create one Campaign

Create one Campaign with:

- target setup WNS: `0 ns`;
- target hold WNS: `0 ns`;
- time box: `1440 minutes`;
- generation limit: `12`;
- retry allowance: `2`.

Confirm once. Record Campaign ID, Run ID, owner session, Pack digest and remote workspace. A Claude
turn ending, App reopening or context compaction never authorizes another Campaign.

## 4. Verify Fabric owns the whole tool chain

Observe the graph and Ledger. Require distinct Fabric node executions for:

```text
Innovus export -> StarRC -> PrimeTime -> endpoint state
-> plan-fix Workshop -> XTop -> Innovus ECO/ecoRoute
-> StarRC -> PrimeTime -> endpoint compare -> next generation
```

No Pack script may silently run the entire multi-tool loop inside one node. A commercial tool failure
must remain attached to its own node, Job and log.

## 5. Verify each research generation

At each `plan-fix` Workshop, inspect the current `closureState`, prior `experience.jsonl` and new
`fix-plan.json`. The plan must:

- use schema `xtop-timing-fix-plan/1` and the next generation number;
- explain fixed, remaining, entrant and regressed endpoint groups from refreshed PT data;
- compare at least one evidence-linked hypothesis;
- select one through eight actions from `setup-size`, `setup-buffer`, `hold-size`, `hold-buffer`;
- retain opposing setup/hold margin;
- explain what prior action it avoids or why new evidence justifies retrying it;
- contain no arbitrary Tcl.

After XTop, treat its post-opt values only as a prediction. Require Innovus to restore the matching
database, load the netlist ECO, source the physical commands and ecoRoute. Only fresh StarRC and all
four fresh PrimeTime scenarios may decide the generation.

For every completed generation record:

- setup/hold WNS, TNS and violation counts;
- unconstrained endpoint count;
- fixed, remaining, entrant and regressed endpoints;
- closure score and whether it moved;
- XTop action count and ECO identities;
- incremental-route DRC/antenna plus full-chip DRC/connectivity boundaries;
- selected best DB generation and complete database identity.

Verify the best database is selected from refreshed commercial evidence rather than simply choosing
the latest attempt.

## 6. Continue until a terminal result

Keep the same Campaign running while a measured next generation is available and budget remains.
The correct terminal outcomes are:

- `TIMING_CLEAN`: refreshed setup and hold WNS meet 0 ns in all declared scenarios;
- `CONVERGED_WITH_VIOLATIONS`: the closure score remains within the Pack's 0.001 band for two
  generations and violations remain;
- `BLOCKED`: a product or environment blocker prevents trustworthy continuation;
- `PARTIAL`: the Run is non-terminal when the externally imposed test window ends.

Budget exhaustion is evidence about the test boundary, not convergence. A valid negative generation
is research feedback and should lead to the next plan, not a code fix.

## 7. Checkpoint and report

Write tester checkpoints after installation, Site admission, Campaign creation, every commercial
tool boundary, every completed generation and every failure. The report path is:

```text
/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/ui-trial-0.3.0-trial.16/Agent Trial Report v27.md
```

The report must separate facts from interpretation, include exact identities, terminal state,
generation table, endpoint movement, strategy changes, tool failures, evidence paths and rollback.
It must state what was not reached. At a terminal result or actionable blocker, execute the tester
handoff and print the exact `CODEX_HANDOFF_READY` marker, then stop.
