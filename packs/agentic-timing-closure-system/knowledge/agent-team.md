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

Operator: for an active slot whose request reading is `tc_request_invalid_count` 0 and
`tc_slot_parked` 0, the Harness materializes the slot's Operator directly from the admitted request:
the request's candidate, sessionPlan, noSafeAction and siteCapabilities are embedded in its task, and
the request's own `candidate.scope` (`commands` from the recipe list, `maxMutations` 1..600) is the
immutable scope the Host binds with the request's plan hash. The Operator owns the seat's cluster and
runs the expert loop of `xtop-expert-operator.md` as one batch in its interactive session: dump
before.dump and reference; risk-assess first (`atcs_point` on every target, `atcs_paths` on the hardest
first, `atcs_fail_reasons` after the first fix); then point to point, hardest target first, one bounded
move per trial, `atcs_point` on the target and `atcs_gain` on the opposite check, keep when the target
improved and the opposite did not break, else `atcs_undo` at once; continue through the cluster until
the list, the budget or the time is spent; dump after.dump, `atcs_export_changes` with its limitations,
close. Every kept edit is part of the one batch the merge ranks. Its share is 40 minutes, four
follow-ups and 12000 tokens a turn (Harness #66 H2a honours it). The Host admits only scope commands
carrying the plan hash and at most `maxMutations` mutations per execution (undo included), across tool
sessions. Its schema-valid result is adopted as it arrives and the node completes; a result failing its
schema, or a turn that ends without output, gets a repair follow-up. An Operator that asks the Harness
to close its session settles its node done, never a failed attempt.

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
