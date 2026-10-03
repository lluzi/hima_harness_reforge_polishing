# Bounded post-route worker Team

Source: current Harness Agent Team interface qualified by Issue #52 at
`58a92850d2d95525110ae1537fc64726d6872295`; ATCS-02 retained-dependency Host test.

Applies when: operate-worker-01 has one current workerRequest01 Reader observation.

The existing worker Workshop produces an admitted plan with top-level `actions`, one to three
`{instance, toMaster}` sizing candidates confined to the prepared work package. Researcher reviews
that exact plan and returns hypotheses and falsifiers. The owner observes and adopts its exact
result; Reviewer reads that retained dependency and selects one candidate. After exact Reviewer
adoption, Host checks the plan SHA and typed arguments and gives Operator one immutable action.
The owner never rewrites Researcher or Reviewer bytes into a second plan.

Operator dumps before/after, queries the falsifier, mutates once, exports, finalizes and closes.
Owner adopts the exact Operator result and completes the execution. Host then runs capture-worker-01,
read-worker-result-01 and collect. The bounded path does not schedule w02 or w03; their imported
definitions are parked until a separate multi-worker qualification. Missing or unsafe plans, and
refusals that remain after the one format repair below, return to a person; they never manufacture a
no-fix Contribution. No safe action requires explicit
diagnosis and a revised Workshop plan or an honest stop.

Format repair: a `result` refusal that says the Researcher or Reviewer "must return one JSON object"
or "does not satisfy" its schema is a formatting refusal, not a plan refusal. The recipe allows one
follow-up to the same child: send it at once, quoting the refusal reason and asking for the corrected
single JSON object, then call `result` again with a new request id. The follow-up must land inside the
member's original 10-minute window (a follow-up does not extend it), so read each member result as soon
as its turn completes. Escalate to a person only when that one repair is refused again or the refusal is
substantive (missing-current-evidence, unsafe-action, stale-execution, outcome-unknown).

Changes this decision: only Reader-admitted actions are executable. New hypotheses require a
Workshop/Reader revision. A complete local mechanism test does not qualify XTop or establish QoR.

Counterexample: a Reviewer action with another plan hash or an instance absent from actions is refused
before an Operator child is created. A repeated mutation command returns duplicate and adds no effect.
