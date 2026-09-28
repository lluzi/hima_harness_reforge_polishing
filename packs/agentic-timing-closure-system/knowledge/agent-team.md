# Worker Teams: an expert Operator inside a reviewed scope

Source: current Harness Agent Team interface qualified by Issue #52 at
`58a92850d2d95525110ae1537fc64726d6872295`; ATCS-02 retained-dependency Host test; Issue #64 Task 1
(Harness scope mode) and Task 4 (`atcs-worker-NN` version 4).

Applies when: operate-worker-NN has one current workerRequestNN Reader observation (slots w01..w06;
a Team exists for every operate-worker node the graph declares).

The slot's Workshop produces an admitted request whose candidate carries the blockers' `targetPins`,
the edit domain and `scope` (the toolkit mutations the slot may need, always with `atcs_undo`). There
is no pinned action list. Researcher reads that exact request and returns, per blocker cluster, the
suspected mechanism, the first ladder move and its falsifier. The owner observes and adopts its exact
result; Reviewer reads that retained dependency and returns `{planSha256, scope: {commands,
maxMutations}}`: commands from the recipe list, a budget from 1 to the recipe cap 120. Host refuses a
scope outside the recipe at the Reviewer result (one follow-up repairs it) and checks it again, with
the plan SHA, when the Operator is created. The owner never rewrites Researcher or Reviewer bytes into
a second plan.

Operator runs the expert loop of `xtop-expert-operator.md` in its interactive session: dump before,
reference, diagnose, trial one move, read the gain, keep or undo, stop at the budget or when nothing
gains, dump after, export, close. Host admits only scope commands carrying the reviewed plan hash and
at most the approved number of mutations per execution (undo included), across tool sessions. Owner
adopts the exact Operator result and completes the execution; capture seals the session's kept log.
Missing or unsafe plans, and refusals that remain after the one format repair below, return to a
person; they never manufacture a no-fix Contribution. No safe hypothesis requires explicit diagnosis
and a revised Workshop plan or an honest stop.

Format repair: a `result` refusal that says the Researcher or Reviewer "must return one JSON object"
or "does not satisfy" its schema is a formatting refusal, not a plan refusal. The recipe allows one
follow-up to the same child: send it at once, quoting the refusal reason and asking for the corrected
single JSON object, then call `result` again with a new request id. The follow-up must land inside the
member's original 10-minute window (a follow-up does not extend it), so read each member result as soon
as its turn completes. Escalate to a person only when that one repair is refused again or the refusal is
substantive (missing-current-evidence, unsafe-action, stale-execution, outcome-unknown).
A Reviewer scope refused at `result` (a command outside the recipe, duplicates, or a budget outside
1..120) is repaired the same way: one follow-up quoting the reason, asking for the corrected object.

Changes this decision: only Reader-admitted requests reach a Team, and only a Reviewer-approved
scope reaches the Operator. New hypotheses require a Workshop/Reader revision. A complete local
mechanism test does not qualify XTop or establish QoR.

Counterexample: a Reviewer scope naming a command outside the recipe, a budget above 120, or another
plan hash is refused before an Operator child is created. An Operator mutation outside the approved
commands, with another plan hash, or past the approved budget is refused by the Host and never reaches
XTop. A repeated mutation command returns duplicate and adds no effect.
