# Independent review of Claude Code's ATCS development and testing

Review model: GPT-6 Astra, High effort  
Method: read-only code, Issue, Ledger, report, and server evidence review  
Pinned code: `origin/main@11f20fa07dd4b6c8ac8b77d8479cd34c1c61f198`  
Primary delta: `a389e64bad1004b19dea81e39bfc0af0a58b139e..11f20fa0`  
Verdict: **recoverable systemic drift**

## Overall assessment

ATCS's tool execution and evidence controls are becoming real. Agent Teams, a confined XTop Operator, Contributions, Innovus, StarRC, PrimeTime, adoption, and experience have all produced retained evidence. The direction has not failed, and the review found no P0 requiring an immediate rollback.

The systemic problem is a moving delivery frontier. Issue #63 originally asks for an installable, executable, recoverable, evidence-consistent Pack. Issue #64 adds parallel experts, blockers-first planning, auto-finish, and numerical benefit to the same critical path. Full Campaigns still discover schema, citation, declared-output, and budget-semantics errors. Model, EDA, and human test costs are consequently much higher than the defects justify.

PR #65, Pack 0.2.0, and App `030efa9f` are newer candidate and runtime evidence than the pinned main. They are not capabilities already delivered by `main@11f20fa0`.

## Findings

### P1: #64's method experiment is displacing #63's delivery gate

ATCS-07/08 under #63 already distinguish:

- `PACK_DELIVERABLE` does not require timing improvement;
- the matched comparison may be negative or inconclusive;
- a negative result does not revoke an honest installable and recoverable Pack.

The current workflow nevertheless places native TEST, seal, release, final App, and #63 closure after the #64 A1-A6 experiment. Each method upgrade therefore regenerates Pack, wrapper, binding, App, and Campaign identities, leaving release without a stable endpoint.

Maintain two separate authorities:

1. **PACK_DELIVERABLE**: pinned scope, execution, recovery, and evidence integrity.
2. **METHOD_EFFECTIVENESS**: parallel experts, refresh count, elapsed time, and timing benefit.

Single-worker mechanics may support a limited release, but cannot be reported as completion of the intended parallel method. Closing all of #63 still needs its ATCS-08 matched record; a negative result is acceptable.

### P1: full Campaigns still discover cheap contract failures

Recent retained evidence includes:

- `run-c0d9e672`: `decide-next` wrote stdout but not its declared artifact and was marked done; recovery exposed an upstream-retry/downstream-pause deadlock and notification failure to wake the idle owner.
- `run-6de8b715-abe5-4543-b68a-5369063d7b12`: the first plan had **41 schema errors**. It ended `ended-budget-exhausted` after about 24 minutes without running a worker.
- Ledger records `#000093` and `#000170` were two `revisit-research` decisions under `generationLimit=2`. Harness generation counts Explore revisits and does not mean two physical refreshes.

Evidence:

- `.hima-tmp/hltbf/issue64-live-01/STATUS.md`
- `.hima-tmp/atcs64-live02-030efa9f/L02 Data/dsh/storages/hima_ledger.json`

Raising the next Campaign from two to six generations delays exhaustion but does not prove a two-refresh limit. Physical refreshes need a distinct reader-backed counter and cap.

Before another live Campaign, validate plan schema, citation contract, declared outputs, recovery, revisit budget, and refresh budget on one pinned candidate at lower test seams.

### P1: the Team on reviewed main remains a one-sizing approval mechanism

The pinned main contains Pack `0.1.10`, development. Its effective path remains centered on w01: Researcher analyzes existing candidates, Reviewer selects one, and Operator executes one immutable action. This proves real child sessions, adoption, permissions, and controlled mutation. It does not prove multiple experts repeatedly diagnosing blockers, trying changes, measuring gain, undoing failures, and merging retained work.

#64's reviewed scope, parallel Operators, blockers-first planning, and auto-finish are reasonable corrections. Scripted expert dry runs, a six-lane graph, and a large local suite do not establish real-model expert behavior.

Add one narrow real-model gate on a retained blocker/context. Require one Operator to diagnose, choose a legal action, measure it, and keep, undo, or refuse it. Transcript and tool evidence must show how Pack knowledge changed the action. Only then qualify parallel operation and second-generation feedback.

### P1: XTop non-worse selection is not a refreshed-PrimeTime guarantee

#64's later design compares merged expert ECO with plain auto-fix at the XTop prediction layer. This supports the bounded statement:

> The Pack selects a candidate that is no worse under the pinned XTop criteria.

It does not support:

> Refreshed PrimeTime is guaranteed not to regress.

Routing and parasitic changes can alter setup and hold. If only the selected arm is physically refreshed, final non-regression cannot be established without implemented DB, new SPEF, and PT evidence for both arms.

Historical serial rounds are useful engineering references but do not satisfy ATCS-08's matched Harness/App, model, budget, input, tool, and human-intervention requirements.

### P2: candidate churn contains real convergence and one invalid qualification pattern

| Run | What it established | Stop or remaining gap |
| --- | --- | --- |
| fresh01 `run-5a5b8ba5…` | All Team roles, real XTop, honest failure | Missing target master; no-fix could not be captured without an ops log |
| fresh02 `run-14e1ec47…` | One real sizing, Contribution, replay/presta, Innovus | StarRC lacked `libtbb.so.12`; extract/PT later completed on a qualification copy |
| fresh03 `run-b9946c06…` | Operator, Innovus, StarRC | Ledger `#000350`: `${MAX_PATHS}` unbound at STA; not a complete PT loop |
| PR03 `run-1ca6cdd3…` | Real ECO, refresh, evaluate, adopt, and experience on `postroute_final` | No global convergence; archive failed |

The v8 wrapper incident was materially invalid: the installed wrapper still contained `<REPLACE-…>` placeholders. Its positive check ran the verifier only, while its negative case refused placeholders, yet this was described as wrapper qualification. v9 correctly derived from installed bytes and added positive and negative tests through the wrapper itself.

Version growth is therefore not wholly wasteful. Identity changes still cannot substitute for behavioral qualification. The candidate matrix must state which exact bytes and layer actually ran.

### P2: both Harness-core fixes have generic justification

`9f2e0bb4` fixes missing retained bytes for revision-seeded Workshop code, which prevented historical archive reproduction. The change stays within existing workspace, node-turn, and experience responsibilities.

`7e535183` settles a required Team member that ended without a result while stable child identity left execution permanently begun. Generic settlement reuses retry, budget, and Hard-blocker semantics, excluding launched Jobs, unreleased interactive intents, old generations, and advisory Teams.

The review found no ATCS-specific Runtime branch in these fixes. If #64 changes hybrid parked settlement again, tests must describe the generic factual contract rather than encode the current ATCS graph shape.

## Timing evidence

Resetting the entry to `postroute_final` was necessary. Results from fresh01/02/03 used an already optimized input and cannot be combined with the original baseline to claim benefit.

Read-only PR03 server evidence:

- Workspace: `/data/eda/project/hima_harness/atcs-runs/agentic-timing-closure-system-20260928-111631-cee9`
- Real action: `swerv_dec_tlu/g96219`, `CKAN2D2BWP35P140HVT -> CKAN2D4BWP35P140HVT`
- Contribution: `391bd34c05766b161b5a`
- Candidate: `8c9174fb5a01439ce5f3`
- Evaluation: `a1d86706715a785ee7a9`

Target `dec_tlu_perfcnt0[0]` setup slack improved:

- 125 C: `-0.0364 -> -0.0214 ns`
- m40: `-0.1179 -> -0.1002 ns`

The action was locally directionally sensible. Global setup WNS changed `-0.1567 -> -0.1576 ns`; hold WNS remained `-0.2016 ns`. Local gain did not move the global blocker. Another 1,788 parent checks exceeded the recheck bound of 200, leaving fixed and missing-prior counts unknown. `delivery=null`.

This proves a real Manual ECO and physical refresh chain. It does not prove an effective global convergence strategy.

## Instruction packet for the Claude Code owner

1. Stop using full Campaigns to discover schema, citation, binding, and budget-semantics failures.
2. Stop making #64 timing benefit a #63 release gate.
3. Stop describing XTop selection criteria as a refreshed-PT guarantee.
4. Preserve every failed Run/Home, old wrapper, both baselines, raw PT/SPEF/DB, transcript, ops log, and archive failure. Never repair historical evidence in place.
5. Freeze one candidate matrix covering source, App, Pack, flow, Site, Permit, wrapper, binding, and input digests. Re-run only changed qualification surfaces.
6. Make the next slice close live02's pre-worker contract: executable plan-schema examples, Reader/Host falsifiers, reproducible citation behavior, declared output, and distinct revisit and refresh budgets.
7. #63 M2 requires a pinned scoped Pack, complete Team/Contribution/lineage, one refresh or qualified refusal, recovery without duplicate effects, experience/archive, native TEST, seal/release, final App installation, and rollback. Timing improvement is not required.
8. Add a frozen ATCS-08 matched record to close all of #63. Report #64 A1-A6 separately.
9. Record model requests/tokens, owner and child time, Campaign count, EDA seat-time, and human interventions.

