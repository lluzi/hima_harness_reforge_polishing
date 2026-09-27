# Issue #52 final component-integration acceptance — trial.31 Attempt 3

This is the successor trial for cycle `hima-issue52-final-1`. It validates the complete human-facing
HimaHarness integration matrix after the two Attempt 2 Pack defects were fixed and independently
qualified. It does not test positive PPA, timing closure, clean signoff, ROI or DTCO effectiveness.

## Exact immutable identities

- Authority main: `776fb0c66d47b5e0ca697d737a112f4a3c412d6f`.
- App: `0.3.0-trial.31`; artifact digest
  `e0a004ab2f54434ccb93b8c278c01765db1f3fc451bb1ca86ab2b22ada16766b`.
- Trial manifest SHA-256:
  `e445cc5da648f51d21e07d247e4940531f9cde2e90e8f06819e916560549f1b6`.
- Kit: `/Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/final-harness-integration-trial31`.
- Kit receipt: the kit's `acceptance-kit.json`; SHA-256
  `eec16f221b900b3ce7022c897b123ac70a007ab999b4f243793225e0bd8acd03`.
- Pack: `xtop-timing-closure@1.0.15`; method digest
  `dac4e1b9b60661de50a4863da4dfa177afff25563f28aa26b7c21d03b368e910`.
- Native TEST Run: `run-f7daabc9-3bcb-408a-875f-b82360b5cbf4`.
- Native seal SHA-256:
  `9fcbd1f49a55e79108b5198b6a0af454c2812fea3e23b51559ae9c004825c162`.
- Site: `linglong-swerv28`; private write root
  `/data/eda/project/hima_harness/xtop-timing-closure-runs`.
- Operator binding: `linglong-swerv28:xtop-operator-v2:dac4e1b9b60661de`;
  binding SHA-256 `76a5f500741969054aaa50ef6ac92a70d5590fdd1092cc09382d959a97334114`.
- Current no-commercial preflight SHA-256:
  `ae57a547ac366d06e3e457053844df8eff54ec62a1969be6f02b79739d28b464`.
- Goal: setup WNS at least `0 ns`, hold WNS at least `0 ns`.
- Campaign budget: exactly one generation, one retry allowance, 120-minute time box.
- Report destination:
  `/Users/lluzi/code/hima_harness_agent_issue52_acceptance/Issue 52 Final Acceptance Report Attempt 3.md`.

Before dispatch the exact v2 wrapper/template reached READY twice in the same retained qualification
workspace without deletion. The first start completed identity, summary, mutation, ECO-pair save and
normal close; the second reached READY and closed normally. A separate real native TEST Run completed
the full commercial chain with one production Operator child and owner adoption. These facts qualify
the release; they do not replace the GUI journey below.

## Historical Runs are immutable

Do not select, continue, cancel, repair or delete either prior acceptance Run:

- Attempt 1 trial.29/trial.30 continuation, parked at `apply-eco`;
- Attempt 2 `run-d156bd24-c1d3-4f18-9e0c-aca3b17eb240`, parked at `run-xtop-fix`.

Do not reuse their Campaigns, children, workspaces, reports or Site effects. Do not delete the leaked
Attempt 2 residue; Codex already released the exact orphan process while preserving its workspace and
logs as defect evidence.

## Authority and resource rules

Claude Code Desktop is the sole human-like operator. Use Computer Use against the visible
HimaHarness/Catsights GUI only. Do not use direct HTTP, shell-created Runs, raw SSH/Tcl, hidden Host
calls, Ledger edits, headless runners or direct filesystem changes to operate the trial. The
repository and kit may be read only to verify the manual and hashes.

Create exactly one fresh Campaign, one persistent Run and one owner after one visible confirmation.
A Claude turn ending never authorizes another Campaign. If the App or Claude session is interrupted,
recover the same Run. Do not start commercial work until the visible preparation confirms
`generationLimit: 1`, the exact Pack/Site identity and a ready proposal.

At the production interactive node, the owner must begin `run-xtop-fix`, create exactly one
`role=operator` child for that execution, inspect its retained result and adopt it explicitly. The
child alone uses `hima_interactive`; owner direct open/takeover, raw shell and raw Tcl are invalid.
The child's effective task context must show the named typed catalog:

- `hima_operator_identity()`;
- `hima_summary(mode: setup|hold)`;
- `hima_fix_hold(effort: low|medium|high, target: number [-0.2..0.2], margin: number [-0.2..0.2])`;
- `hima_save_candidate()`;
- `hima_close()`.

If any deterministic identity, qualification, permission or argument-contract check fails, park the
Run at a safe boundary and report `BLOCKED`. Never hot-patch the sealed Pack, binding or wrapper.

## Required GUI journey

### 1. Launch and inventory

1. Verify the kit receipt and manifest hashes without opening an older App.
2. Launch only the kit's `launch-hima-trial.command`; keep its launcher terminal alive.
3. Confirm the visible App version is `0.3.0-trial.31` and the isolated workspace is
   `Trial Workspace`.
4. Confirm there are no prior sessions, Campaigns or Runs in this fresh Home.
5. In ordinary language ask HimaGuide what HimaHarness can do, what the Timing ECO Pack needs and
   what is known versus missing. It must name the installed Pack and Site without promising timing
   benefit.

### 2. Preparation and one confirmation

1. Select `xtop-timing-closure` through the visible product path.
2. Let Guide inspect the saved `linglong-swerv28` Site and rediscover only if the visible product says
   the cache is stale.
3. Inspect the proposal before confirming. It must show the exact Pack/Site, both `0 ns` Goal fields,
   `generationLimit: 1`, `campaignFile.applied: true`, and no Run yet.
4. Confirm once. Record the single Campaign, Run and owner identities. The owner must be distinct
   from Guide.

### 3. Graph, evidence and independent context

1. Open Live Run and inspect the reference graph, current state and at least two node details.
2. Exercise graph zoom/pan and open one evidence/report drill-down.
3. Open a Side Talk or other independent non-owner conversation. Verify Guide remains responsive
   and Run ownership does not change.
4. Later, open the Operator child session itself and retain its effective context, complete transcript,
   tool receipts and candidate result.

### 4. Controlled execution and Operator adoption

1. Let the Campaign owner run the one-generation reference path through baseline Innovus, StarRC,
   PrimeTime, summary and owner-authored `plan-fix`.
2. At `run-xtop-fix`, verify direct owner interactive open is unavailable and exactly one qualified
   Operator child is created.
3. Inspect the child context and confirm its named catalog and `hima_interactive`-only tool grant.
4. The child must complete open, identity, setup/hold summaries, one bounded fix, candidate save,
   typed close and session close with retained ACK/DONE or truthful FAIL receipts.
5. The owner reads the exact child result and explicitly adopts it before completing the node.
6. Continue through Innovus apply, fresh StarRC/PT, comparison, evidence gate and the one-generation
   ending. QoR may improve, remain unchanged or regress; retain the actual facts.

### 5. Human control and recovery

1. At one safe boundary, use a visible pause/hold control. Distinguish request receipt, actual Run
   state and in-flight Job state.
2. Continue explicitly. No old summary or model prose may lift the hold.
3. Switch conversation or reopen the App at a recovery boundary and verify the same Run, owner,
   current facts and child history return without a duplicate Job or mutation.

### 6. Result, Data Insight and truthful ending

1. Open the produced timing/iteration report and at least one cited source evidence item.
2. Open Data Insight/report mode and perform one loaded-data selection or filter without creating a
   Campaign or launching computation.
3. Ask Guide to explain setup, hold, endpoint and physical evidence, including non-clean, unknown or
   missing conditions. Guide, report and Data Insight must cite the same retained facts.
4. Reach the declared terminal or bounded state and inspect the archive/value-measurement receipt
   where available.

## Final matrix and verdict

The report must give `PASS`, `FAIL` or `BLOCKED` for each item:

1. exact App/Pack/Site/Permit/binding identity;
2. Guide/owner/Side Talk/child separation;
3. one confirmation / one Campaign / one Run / one owner;
4. graph, node details, zoom/pan and evidence drill-down;
5. exactly one Operator child, named typed calls, candidate result and explicit owner adoption;
6. pause/continue with request/Run/Job distinction;
7. recovery of the same Run/owner/child without duplicate effects;
8. full bounded Timing ECO evidence reached;
9. report/Data Insight/Guide factual agreement;
10. truthful ending and material limitations.

Overall `PASS` requires all ten rows. Timing closure, clean DRC/connectivity, positive PPA, ROI and
DTCO benefit are explicitly unclaimed. A valid negative or budget-limited engineering result may
still pass.

On any terminal verdict, write the report and tester checkpoint/handoff, then send exactly:

```text
CLAUDE_HANDOFF_READY: hima-issue52-final-1 /Users/lluzi/code/hima_harness_agent_issue52_acceptance/Issue 52 Final Acceptance Report Attempt 3.md
```
