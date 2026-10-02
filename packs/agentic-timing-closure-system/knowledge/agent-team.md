# Worker Teams: an expert Operator inside its request's own scope

Source: current Harness Agent Team interface qualified by Issue #52 at
`58a92850d2d95525110ae1537fc64726d6872295`; Issue #64 Task 1 (Harness scope mode), Task 5 (six
parallel branches) and the 2026-09-29 reshape (ADR-0016, `atcs-worker-NN` version 5: fork branches
drive themselves); #66 D7 (version 6: a seat's Operator works its cluster as one point-to-point batch).

Applies when: operate-worker-NN has one current workerRequestNN Reader observation (slots w01..w06;
a Team exists for every operate-worker node the graph declares).

Six self-driving branches: `prepare-workers` forks the six slots into branches, each
`research-worker-NN -> read-worker-request-NN -> operate-worker-NN -> capture-worker-NN ->
read-worker-result-NN`, joined at `check-worker-results`. The graph declares the fork `autopilot`:
the Harness takes every node turn inside it, and the owner takes none. The owner is told once, when
the Run leaves the region, with each branch's last node, adopted Team result, final reading and
Contribution id in one summary.

Research: each branch's own child Agent authors the branch's research Workshop entry (in a later
generation the retained code runs again). When the slot's Reader refuses the request, the Harness
restarts the branch at its Workshop and asks the same author again with the itemized problems written
beside the request, at most the fork's declared number of revisions, in the same generation and
without a person.

What the author reads (#66 D7). An author turn is 48000 tokens (`graph.yml` autopilot fork) and must end
in one Workshop entry, so the author reads only what its request needs: its own slot's package
(`state/workers.json` `workers.wNN.workPackage`, with the cluster and its checks), the residual cases
(`state/residual-cases.json`, the prior batch's fail reasons) and knowledge `example-worker-request.md`,
plus the two values the request copies verbatim (`state/working-state.json`, and `siteCapabilities` from
the campaign plan) and the Pack helpers it calls (`read-atcs.py masters`, `resolve-instances`). It never
reads `riskAtlas`, another slot's package or the whole observation: none of them changes its request, and
they spend the turn before the entry is written. A turn that still ends without output gets one repair
follow-up (Harness #66 H2b).

Clusters (#66 D1): each active slot's package names one blocker cluster, `cluster {cause, key, checks}`
(knowledge example-campaign-plan.md), and its `targets` are the cluster's checks, hardest first. The plan
Workshop starts from `read-atcs.py seat-clusters`, which partitions the violating checks into at most
`workerSlots` disjoint clusters by shared startpoint, hierarchy and fail-reason pattern. The seat's work is
the cluster, worked hardest first, not one endpoint. `workerSlots` 0 parks every seat: the full-auto
control arm, whose branches all run the batch no-op.

Operator: for a Reader-admitted active request, the existing recipe materializes its expert tool hand. The task carries the bounded operatorBrief/sessionPlan; use granted input windows rather than read the whole request. All six receive the same concise topology/placement/margin playbook in xtop-expert-operator.md and one expertise prior, while their actual disjoint clusters come from the current residuals.

The planner supplies CURRENT analysis-derived fixpoints, resolved drivers and physical regions in the existing WorkPackage; no design object is hard-coded in prompts or helpers. Each Operator works the common R1 and cycles native Path/GBA/rank -> root-cause hypothesis -> coherent insert/split/move/detour batch -> holdWNS-first measurement plusTNS/setup/transition/legality -> keep/undo -> next useful mechanism/range. Standalone sizing is not expert evidence; size/exchange only enables a paired margin/transition repair. One operation is not task completion. Stop on cluster clear/material improvement, evidence of useful-ladder exhaustion, or actual Host closing budget.

Scope, plan hash, 600-mutation cap and existing recipe budget remain authoritative (40min,4followups,12000tokens per turn, subject to actual Host returns). The two rank/legalization setting commands change session state, require the same reviewed scope/hash and spend allowance; their reports use existing reads evidence rather than fake physical ECO. Carry settings in the exact script; the Lead rechecks them in its fresh integration session and continues manual collateral repair. Never use unaccounted direct-child messages to evade an exhausted follow-up share. Output exact script, metrics, legal state, failed mechanisms and recommendation; then current export, typed close, adopted result and completed node. No native prediction is refreshed PrimeTime/physical signoff.

Reviewer: optional and advisory. Nothing waits for it and nothing is gated on it; its absence never
blocks a branch.

Parked and refused slots: a parked slot (`parked: true`) or an active slot whose request reading is
not 0 creates no Team member; the operate node's batch path `operate-parked` opens no XTop session and
the capture seals a `parked` no-fix that names why no session ran. For a skipped active slot that
no-fix carries the refusal `inadmissible-request`, so its branch's `check-worker-results` verdict is
FAIL (the join still leads to `collect`).

Recovery: when the Operator ends without an observed result -- cancelled, expired, refused or
uncertain -- the Host settles that operate execution `failed` and it spends one Retry; the Harness
begins the node again with a fresh Operator. A branch that cannot go on settles refused at the join;
the other branches keep their places. A person's pause holds the branches; continuing lets them go on.

Changes this decision: only Reader-admitted requests reach an Operator. New hypotheses require a
Workshop revision. A complete local mechanism test does not qualify XTop or establish QoR.

Counterexample: a request scope naming a command outside the recipe or a budget above 600 is refused
before an Operator child is created. An Operator mutation outside the scope's commands, with another
plan hash, or past the budget is refused by the Host and never reaches XTop. A repeated mutation
command returns duplicate and adds no effect.
