"""M7: guarded adoption and the three independent state pointers.

This module owns the M7 producers named in this Pack's task brief
(``.superpowers/sdd/task-9-brief.md``) and the ``acceptance-record`` row of
``.superpowers/sdd/global-context.md``'s "Shared data model" table, plus the
"three state pointers" Global Constraint (``workingState``,
``bestVerifiedState``, ``deliveryState`` are independent; a batch's common
base points to one concrete state, never a mutable directory name):

- `load_pointers(path)` -> the current pointers document (or an in-memory
  bootstrap default, ``version=0``/``working=best=delivery=None``/empty
  ``history``, when `path` does not exist yet — "no pointers file yet" is
  not a data problem, same convention as `atcs.experience.record`'s "no
  ledger yet").
- `publish(evaluation, expected_base, pointers_path, policy)` ->
  ``acceptance-record`` — the single guarded entry point that decides
  whether `evaluation`'s candidate may move `workingState`,
  `bestVerifiedState` and/or `deliveryState`, via compare-and-swap against
  `expected_base`.
- `artifact_ready(database_ref)` -> Measure — re-hashes the candidate's
  actual on-disk database (the `.enc` file and its `.enc.dat` sibling
  directory) against the identity `database_ref` recorded at evaluation
  time, so a delivery is only ever recorded for a database that is *still*,
  right now, byte-identical and restorable — never for one that merely had
  a matching hash at some earlier moment.

Fail-closed is the rule for every function here, same as the rest of this
Pack: a missing, truncated or partially-evidenced input yields `unknown`
with a reason or a refused `acceptance-record` — never a silently-assumed
pass and never `0` unless the data explicitly proves it.

Concurrency: `publish` is single-writer by design — exactly one graph node
in this Pack's compiled flow owns calling it, serialized the same way every
other state-mutating tool in this Pack is (one Campaign Run keeps one
owner, per ``SPEC.md``'s "Run contract"). It performs an unlocked
read-modify-write of the pointers file (`load_pointers` then
`core.write_artifact`) and takes no file lock, because it never needs one:
a second concurrent writer is a scenario this Pack's graph never creates,
not a race this module defends against.

Id namespace (controller decision, binding for this module)
-------------------------------------------------------------

State ids everywhere in this Pack — `work-package.baseStateId`,
`merge-commit.parentStateId`, `expected_base`, and every pointer in this
module's own pointers document — are **design-state ids**
(`atcs.state.design_state(...)["id"]`), never a merge-commit id. A merge
commit's own `id` (`atcs.verification`'s `candidateId`) is carried through
purely for provenance/reporting: it is never compared, CAS-checked, or
used as pointer identity anywhere in this module. Concretely:
`evaluation["stateId"]` (the post-implementation design-state's own id,
copied through by `atcs.verification.assemble` from
`receipts["designStateId"]`) is what this module stores as each pointer's
identity and what `publish`'s compare-and-swap actually protects;
`evaluation["candidateId"]` (the merge commit's id) rides along on each
pointer value only so a caller can trace a pointer back to the merge commit
that produced it.

``evaluation["database"]`` (binding for `publish`/`artifact_ready`)
---------------------------------------------------------------------

Per this task's Decisions, the evaluation to publish carries its own
database identity rather than `publish` taking a second, separately-aimed
argument that could itself go stale relative to `evaluation`. Its shape is
the same canonical `{"path", "sha256", "datDigest"}` triple
`atcs.state.design_state` already stamps onto every `design-state`
artifact's own `database` field, and `atcs.verification.assemble` copies
through onto `evaluation["database"]` unchanged::

    {
        "path": "<campaign-relative path to the .enc database file>",
        "sha256": "<64 hex — sha256 of the .enc file itself>",
        "datDigest": "<64 hex — core.tree_digest of the .enc.dat directory
                        beside it, i.e. \"<path>.dat\">",
    }

`publish` reads this via `evaluation.get("database")`, resolves `"path"`
against `policy["campaignRoot"]` (see below), and passes the resolved ref
to `artifact_ready`. A caller whose evaluation input genuinely lacks this
ref gets `artifact_ready`'s `unknown("missing-...")` back, which
fail-closed excludes that candidate from ever becoming a `delivery` (see
below) without needing a second signature shape.

`artifact_ready(database_ref)`
-----------------------------------

`database_ref` is the canonical `{"path", "sha256", "datDigest"}` triple
above, with `"path"` already resolved to something `core.file_sha256` can
actually open (an absolute path, or one already correct relative to the
process's own working directory — resolving a *campaign-relative* path is
`publish`'s job, not this function's; see "Campaign-relative path
resolution" below). Re-hashes `database_ref["path"]` via
`core.file_sha256` and `f"{database_ref['path']}.dat"` via
`core.tree_digest`, and compares both against the recorded
`sha256`/`datDigest`.

`database_ref` itself missing, or missing any of its three fields, is
`unknown` (`"we don't have enough identity to check"`, a data-completeness
problem). Once all three are actually present, any of the following is
`known(0)` — not `unknown` — because each one *proves* the database is not
currently restorable to the recorded identity, which is exactly what this
Measure exists to certify: a hash/digest mismatch; the `.enc` file or
`.enc.dat` directory no longer existing; or an `OSError` reading either one
(e.g. permission denied) — a database this process cannot currently read
is precisely as un-restorable, right now, as one that has changed or
vanished, even though the underlying bytes might in principle be fine.
Only when both the file hash and the tree digest match exactly is the
result `known(1)`.

Campaign-relative path resolution (`policy["campaignRoot"]`)
--------------------------------------------------------------

`database_ref["path"]` is campaign-relative (per `atcs.state.design_state`'s
own convention), so `publish` resolves it against `policy["campaignRoot"]`
before ever calling `artifact_ready` — exactly the same
root-plus-relative-path join `atcs.state`'s own `_resolve` helper performs
for a design-state manifest's own paths. This resolution only happens (and
`campaignRoot` is only required) when there is an actual database ref to
check: `evaluation["database"] is None` needs no root at all and reports
`artifact_ready`'s own `unknown("missing-database-ref")` untouched. When a
database ref *is* present but `policy` carries no `campaignRoot`, `publish`
never even attempts to resolve or re-hash anything: the reported
`acceptedArtifactReady` is `unknown("missing-campaign-root")`, and — since
that can never be the known `1` a `delivery` requires — this candidate can
still become `working`/`best` (subject to every other guard) but never
`delivery`.

Pointer value shape (internal to the pointers document)
-------------------------------------------------------

Each of `working`/`best`/`delivery` is either `None` (never set) or::

    {
        "stateId": "<evaluation's stateId — the design-state id this pointer
                     actually protects; see "Id namespace" above>",
        "candidateId": "<evaluation's candidateId — the merge-commit id,
                         provenance only, never compared>",
        "evaluationId": "<the evaluation artifact's own stamped id>",
        "minWns": <float> | None,        # min(finalSetupWns, finalHoldWns) when both
                                          # were known (and finite) at publish time
        "failingTimingChecks": <int> | None,   # len(comparison.remaining) + len(comparison.entrant)
                                          # + len(comparison.regressed) at publish time -- the
                                          # brief's "fewer failing checks" tie-break metric;
                                          # None (treated as +inf, never wins a tie) when
                                          # `evaluation["comparison"]` doesn't actually carry
                                          # all three lists
    }

Compare-and-swap: `evaluation["parentStateId"]` must always equal
`expected_base` — the candidate's own merge commit must agree about what
base it was built from. In addition: when `working` has been set,
`expected_base` must equal `working["stateId"]` — the design-state id
`working` currently protects. When `working` has never been set
(bootstrap), there is no `working["stateId"]` to compare against, so
`expected_base` must instead equal `policy["baselineStateId"]` — the
Campaign's declared starting design-state id, which `policy` must supply
for a bootstrap publish to ever succeed (`AtcsError("invalid-policy", ...)`
if it's missing at that point — this is a configuration error, not a
candidate that fails a guard). Either half failing refuses `"stale-base"`:
a caller cannot supply a truthful `expected_base` while handing over an
evaluation whose own candidate disagrees about what it was built on, and a
late/stale evaluation is exactly as harmless against a moved `working` as
against a bootstrap whose declared baseline it doesn't name.

Guard order in `publish`
-------------------------------

0. **Identity validation** (raises, does not refuse) — `evaluation["schema"]`
   must be `"atcs.evaluation/1"` and `evaluation["id"]` must equal
   `core.digest` of the rest of the body, exactly the check
   `core.read_artifact` performs on every artifact this Pack reads back off
   disk. A caller handing `publish` something that is not a genuine,
   unmodified `evaluation` artifact is a programming error, not a
   candidate that merely fails a guard: `AtcsError("schema-mismatch", ...)`
   for a wrong `schema`, `AtcsError("identity-mismatch", ...)` for a
   tampered/recomputed-doesn't-match `id` — the same two codes and the same
   split `core.read_artifact` uses.
1. **Idempotency** — if `evaluation["id"]` already names an entry in the
   pointers document's `history`, `publish` does no further work: it
   returns a fresh `acceptance-record` reporting the *original* `decision`
   and the *original* `pointersAfter`/`pointersBefore` snapshots exactly as
   they were the moment this evaluation was first accepted — reconstructed
   by folding `history` up to (and including, for `pointersAfter`) this
   evaluation's own entries — never the *current* pointers, which may have
   moved on since. `acceptedArtifactReady` is still re-checked live (a pure
   re-read with no state change), so a caller can tell whether a
   previously-accepted database is *still* restorable right now. Nothing is
   written: no version bump, not even a rewrite of identical bytes. This
   must run *before* every other guard below, precisely so a late replay of
   an evaluation that was already accepted keeps returning its original,
   truthful answer even after `working` has since moved on.
2. **Identity completeness and sanity** — `evaluation["stateId"]` and
   `evaluation["candidateId"]` must both be truthy. Either falsy (missing,
   `None`, or empty) refuses `"missing-identity"`: this module can never
   construct or store a pointer value it cannot actually identify, no
   matter what the rest of the evaluation claims. `stateId ==
   parentStateId` refuses `"self-parent"` — a state can never be its own
   parent, no matter how the rest of the evaluation looks. Finally,
   `stateId` must not already be spoken for: either it equals
   `policy["baselineStateId"]` itself (a candidate may not claim to *be*
   the Campaign's declared baseline state), or it already names a
   *different* evaluation's pointer entry anywhere in `history` — a state
   id claimed by two distinct evaluations is impossible if ids are
   genuinely content-derived. Either case refuses `"state-id-reused"`
   rather than silently let a second claimant ride on an id it doesn't
   actually own. (Note: the *same* evaluation reappearing here is guard 1's
   idempotency case, already returned by the time guard 2 runs — this
   check only ever sees an `evaluationId` mismatch.)
3. **Compare-and-swap** — see above; refuses `"stale-base"`.
4. **Verification** (`final-evidence-ready`'s two Judge nodes, read
   directly off the evaluation) — `missingRequiredCheckCount` and
   `finalIdentityErrorCount` must both be known Measures equal to `0`.
   Anything else (unknown, or a nonzero count) refuses
   (`"missing-required-checks"` / `"identity-errors-present"`) — an
   evaluation this Pack cannot even prove covers every required check with
   a consistent identity chain can never move any pointer, degraded or not.
5. **Constraints known** — `constraintFailureCount` and
   `constraintUnknownCount` must both be known Measures, and
   `constraintUnknownCount`'s value must be `0`. Either being unknown, or a
   nonzero `constraintUnknownCount`, refuses *every* pointer at once
   (`"constraints-not-verified"`) — unlike coverage/identity this is not
   "never becomes best", it is "never becomes anything", because
   `working` itself must never carry a candidate this Pack cannot even say
   how many of its required constraints are unproven.
6. **Constraint-failure cap** — even with `constraintUnknownCount == 0`,
   `constraintFailureCount`'s known value must be `<=
   policy["maxNewConstraintFailures"]` (default `0`). Exceeding the cap
   refuses `"constraint-failures-exceed-cap"` for *every* pointer,
   regardless of `policy["allowDegradedWorking"]` — this is a hard ceiling
   a caller cannot raise by also granting degraded-working permission; it
   only decides how many *known* failures are even eligible to be
   considered a bounded, permitted degradation (guard 8 below), not
   whether any amount is tolerable once permission is granted.
7. **WNS known** — `finalSetupWns`/`finalHoldWns` must both be known,
   *finite* Measures (a non-finite value — `inf`/`nan` — is treated
   identically to unknown: no comparison or bound below can be computed
   from it). Anything else refuses (`"wns-unknown"`): the degraded-working
   gate below bounds a *known, finite* regression — it cannot bound an
   unmeasured or infinite one, so this is refused rather than silently
   treated as either "fine" or "as bad as the limit allows".
8. **Degraded-working gate** — "degraded" here means *worse than the best
   this Pack has ever verified*, not "has not yet reached `policy['goal']`"
   — most evaluations published over a campaign have not reached the final
   goal yet, and that is the normal, expected case that never needs
   `allowDegradedWorking` at all. The anchor is: `pointers["best"]["minWns"]`
   when `best` is set; otherwise `policy["baselineMinWns"]` — the Campaign's
   declared baseline observation's `min(setup, hold)` WNS — **whenever**
   `best` is `None`, not only on a genuinely empty pointers file: this is
   deliberately *not* the current (or first-ever) `working` value, because
   bounding against a moving or once-off `working` snapshot instead of the
   fixed, externally-declared baseline is exactly what let a sequence of
   small, each-individually-within-limit steps accumulate into unbounded
   drift before `best` was ever won — every step while `best` is unset is
   now bounded against the *same* fixed baseline, not against whatever the
   last accepted step happened to leave behind.
   `policy["baselineMinWns"]` is required (as a finite number) at exactly
   this point — `AtcsError("invalid-policy", ...)` if missing — the same
   lazy pattern as `policy["baselineStateId"]`, and, like it, needed for
   every publish while `best` is unset, not merely the very first one. Two
   independent signals can trigger degradation: (a) a real step backward in
   WNS — `regression = anchor_min - min(finalSetupWns, finalHoldWns)`, only
   a trigger when `> 0`; and (b) a known, nonzero `constraintFailureCount`
   (already capped by guard 6 above) — a candidate that regresses a
   physical constraint is degraded even when its WNS alone looks fine,
   including on the very first publish. Either signal firing requires
   `policy["allowDegradedWorking"] is True`, *and* the WNS regression
   specifically (`0` when signal (a) did not fire) must be `<=
   policy["degradeLimitNs"]` — so `working` can never be pushed more than
   `degradeLimitNs` below the best `best` this Pack has ever verified, or,
   before any `best` exists, below the declared baseline: repeated small
   steps that would each individually pass a *working-relative* bound
   cannot silently accumulate into an unbounded drift, because every step
   is bounded against the same fixed anchor instead of chasing the last
   step. Otherwise: refused (`"degraded-working-not-allowed"` /
   `"degrade-limit-exceeded"`).

Once all guards pass, `working` always moves to this candidate. Two
further, independent eligibility checks then decide whether `best` and/or
`delivery` *also* move (all three pointers are independent — moving
`working` never implies moving the others, and moving `delivery` does not
require `best` to have just moved too, though in practice it usually has):

- **`best` eligibility** — always requires `constraintFailureCount == 0`
  (already known and `constraintUnknownCount == 0` by guard 5 above — this
  is exactly `required-constraints-pass`; a `constraintFailureCount` that
  is unknown or `> 0` therefore can never win `best` — the unknown case is
  already excluded entirely by guard 5, and the known-nonzero case fails
  this check directly), *and*, depending on `pointers["best"]`'s own state:
  - `best` already set — this candidate must compare as *better* per the
    brief's fixed comparison policy: higher `min(finalSetupWns,
    finalHoldWns)` wins; a tie breaks on fewer `failingTimingChecks`; a
    `None` `failingTimingChecks` (missing comparison lists) counts as
    `+inf` and so can never win a tie; a full tie on *both* metrics — the
    incumbent keeps `best`, since nothing here is a strict improvement.
  - `best` never set — this candidate must *not* be WNS-degraded relative
    to `policy["baselineMinWns"]` (`min(finalSetupWns, finalHoldWns) >=
    policy["baselineMinWns"]`, i.e. guard 8's `is_wns_degraded` is
    `False`): a worse-than-the-Campaign's-own-starting-point candidate may
    still become `working` under `allowDegradedWorking` (guard 8), but
    never `best` — `best` must always represent genuine progress over the
    Campaign's real, externally-declared starting point, never merely "the
    first candidate that happened to pass constraints" (this reasoning
    applies uniformly whether this is literally the first publish ever or
    `working` has already moved several times without `best` ever being
    won — the comparison is always against the same fixed baseline, never
    against whatever `working` currently is). A candidate that fails this
    specific check has its reason recorded as `"below-baseline"`, distinct
    from the `"not-better-than-current-best"` reason used once `best` is
    actually set — the two are different failure modes even though both
    mean "did not win `best`".
- **`delivery` eligibility** — `required-constraints-pass` *and*
  `finalSetupWns`/`finalHoldWns` both meet `policy["goal"]` *and*
  `artifact_ready` (over the campaign-root-resolved `database` ref) is the
  known Measure `1`. This does not require `best` eligibility too: a
  later, slightly-worse-but-still-goal-meeting candidate whose database is
  verified restorable may still deliver even while an earlier, better
  scoring candidate remains `best` (its own database having since gone
  stale) — the two pointers answer different questions and this Pack
  never conflates them.

`publish`'s returned `decision` is the highest tier actually reached this
call: `"delivery"` if the delivery pointer moved, else `"best"` if the best
pointer moved, else `"working-only"` (which always means `working` itself
did move — every earlier refusal path returns `"refused"` instead, so
`"working-only"` never describes a no-op).

Pointers document persistence
------------------------------

The pointers document is a single artifact (schema ``"atcs.pointers/1"``,
stamped/written like every other artifact in this Pack) with fields
`version` (an int, incremented by exactly `1` on every *accepted* publish —
`working-only`/`best`/`delivery` — and never touched by a `refused` or
idempotent-replay call), `working`, `best`, `delivery` (pointer values, see
above) and `history` (append-only list). Each accepted publish appends one
history entry per pointer it actually moved (`working` always; `best`
and/or `delivery` only when they moved too), each entry carrying
`{"pointer", "previous", "new", "evaluationId", "acceptanceRecordId"}` —
deliberately **no timestamp**, so history stays deterministic and
replayable, and the returned `acceptance-record`'s own `id` is recorded
alongside the pointer values it caused to change (per this task's
Decisions: "Record the acceptance-record id in history"). This is also
exactly what makes idempotent-replay's reconstruction possible: folding
`history` in order and keeping the latest `"new"` per pointer name, up to
and including a given `acceptanceRecordId`'s entries, reproduces that
publish's `pointersAfter` without needing any separate log. `history` also
lets `_state_id_already_used` (guard 2) scan for a state id already
claimed by a different evaluation — the degraded-working gate (guard 8),
by contrast, no longer reads `history` at all now that its anchor while
`best` is unset is always `policy["baselineMinWns"]`, never a value
derived from a prior `working` entry.

A `refused` decision — for *any* reason, not only `"stale-base"` — writes
nothing at all: the pointers file (if any) is left byte-identical, since
nothing was accepted and there is nothing new to record.
"""
from __future__ import annotations

import math
from pathlib import Path

from . import core


def _default_pointers():
    return {"version": 0, "working": None, "best": None, "delivery": None, "history": []}


def load_pointers(path):
    """Return the pointers document at `path`, or the bootstrap default if it
    does not exist yet (see module docstring)."""
    target = Path(path)
    if not target.exists():
        return _default_pointers()
    return core.read_artifact(target, "pointers")


def _resolve_database_path(campaign_root, path):
    if campaign_root and not Path(path).is_absolute():
        return str(Path(campaign_root) / path)
    return path


def artifact_ready(database_ref):
    """Re-hash `database_ref`'s `.enc`/`.enc.dat` against its recorded identity
    (see module docstring). `database_ref["path"]` must already be resolved
    to something openable — `publish` does that resolution, not this
    function. Returns a Measure."""
    if not isinstance(database_ref, dict):
        return core.unknown("missing-database-ref")

    path = database_ref.get("path")
    sha256 = database_ref.get("sha256")
    dat_digest = database_ref.get("datDigest")
    if not path or not sha256 or not dat_digest:
        return core.unknown("missing-database-identity")

    try:
        actual_sha256 = core.file_sha256(path)
    except OSError:
        return core.known(0)

    try:
        actual_dat_digest = core.tree_digest(f"{path}.dat")
    except (OSError, core.AtcsError):
        return core.known(0)

    if actual_sha256 != sha256 or actual_dat_digest != dat_digest:
        return core.known(0)
    return core.known(1)


def _compute_ready(database_ref, policy):
    """`artifact_ready` over `database_ref`, resolving its `"path"` against
    `policy["campaignRoot"]` first (see module docstring's "Campaign-relative
    path resolution")."""
    if database_ref is None:
        return artifact_ready(None)
    campaign_root = policy.get("campaignRoot")
    path = database_ref.get("path")
    if path and not campaign_root:
        return core.unknown("missing-campaign-root")
    resolved = dict(database_ref)
    if path:
        resolved["path"] = _resolve_database_path(campaign_root, path)
    return artifact_ready(resolved)


def _validate_evaluation_identity(evaluation):
    """Raise `AtcsError` unless `evaluation` is a genuine, unmodified
    ``atcs.evaluation/1`` artifact (see module docstring's guard 0) — the
    same `"schema-mismatch"`/`"identity-mismatch"` split
    `core.read_artifact` uses."""
    schema = evaluation.get("schema")
    if schema != "atcs.evaluation/1":
        raise core.AtcsError("schema-mismatch", f"expected atcs.evaluation/1, got {schema!r}")
    body = dict(evaluation)
    stored_id = body.pop("id", None)
    if stored_id != core.digest(body):
        raise core.AtcsError("identity-mismatch", "evaluation id does not match recomputed digest")


def _is_verified(evaluation):
    missing = evaluation.get("missingRequiredCheckCount")
    identity = evaluation.get("finalIdentityErrorCount")
    if not core.is_known(missing) or core.value_of(missing) != 0:
        return False, "missing-required-checks"
    if not core.is_known(identity) or core.value_of(identity) != 0:
        return False, "identity-errors-present"
    return True, None


def _constraints_known(evaluation):
    """`constraintFailureCount` and `constraintUnknownCount` both known, and
    the unknown-count itself is `0` (see module docstring's guard 5)."""
    failure = evaluation.get("constraintFailureCount")
    unknown_count = evaluation.get("constraintUnknownCount")
    if not core.is_known(failure) or not core.is_known(unknown_count):
        return False
    return core.value_of(unknown_count) == 0


def _wns_status(evaluation, goal):
    setup = evaluation.get("finalSetupWns")
    hold = evaluation.get("finalHoldWns")
    if not (core.is_known(setup) and core.is_known(hold)):
        return {"known": False, "goalMet": False, "min": None}

    setup_v = core.value_of(setup)
    hold_v = core.value_of(hold)
    if not (math.isfinite(setup_v) and math.isfinite(hold_v)):
        return {"known": False, "goalMet": False, "min": None}

    goal_met = setup_v >= goal.get("setup", 0.0) and hold_v >= goal.get("hold", 0.0)
    return {"known": True, "goalMet": goal_met, "min": min(setup_v, hold_v)}


def _timing_failure_count(evaluation):
    """`len(comparison.remaining) + len(comparison.entrant) + len(comparison.regressed)`
    — the brief's "fewer failing checks" tie-break metric, read from the
    evaluation's own `check-comparison`. Returns `None` (treated as `+inf` —
    never wins a tie — by `_is_better`) when `evaluation["comparison"]` isn't
    a dict carrying all three lists; a genuinely empty list still counts as
    `0`, only an actually-missing list is `+inf`."""
    comparison = evaluation.get("comparison")
    if not isinstance(comparison, dict):
        return None
    keys = ("remaining", "entrant", "regressed")
    if not all(key in comparison for key in keys):
        return None
    return sum(len(comparison[key]) for key in keys)


def _is_better(candidate, current_best):
    if current_best is None:
        return True
    candidate_min, current_min = candidate.get("minWns"), current_best.get("minWns")
    if candidate_min is None:
        return False
    if current_min is None:
        return True
    if candidate_min != current_min:
        return candidate_min > current_min
    candidate_fail = candidate.get("failingTimingChecks")
    current_fail = current_best.get("failingTimingChecks")
    candidate_fail = candidate_fail if candidate_fail is not None else float("inf")
    current_fail = current_fail if current_fail is not None else float("inf")
    if candidate_fail != current_fail:
        return candidate_fail < current_fail
    return False  # a full tie (minWns and failingTimingChecks both equal): incumbent wins


def _normalize_policy(policy):
    policy = dict(policy or {})
    policy.setdefault("allowDegradedWorking", False)
    policy.setdefault("degradeLimitNs", 0.0)
    policy.setdefault("maxNewConstraintFailures", 0)

    allow_degraded = policy["allowDegradedWorking"]
    if not isinstance(allow_degraded, bool):
        raise core.AtcsError("invalid-policy", "allowDegradedWorking must be a bool")

    degrade_limit = policy["degradeLimitNs"]
    if isinstance(degrade_limit, bool) or not isinstance(degrade_limit, (int, float)) \
            or not math.isfinite(degrade_limit) or degrade_limit < 0:
        raise core.AtcsError("invalid-policy", "degradeLimitNs must be a finite number >= 0")

    max_new_failures = policy["maxNewConstraintFailures"]
    if isinstance(max_new_failures, bool) or not isinstance(max_new_failures, int) or max_new_failures < 0:
        raise core.AtcsError("invalid-policy", "maxNewConstraintFailures must be an int >= 0")

    goal = dict(policy.get("goal") or {})
    goal.setdefault("setup", 0.0)
    goal.setdefault("hold", 0.0)
    for key in ("setup", "hold"):
        value = goal[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise core.AtcsError("invalid-policy", f"goal.{key} must be a finite number")
    policy["goal"] = goal

    return policy


def _snapshot(pointers):
    return {
        "version": pointers.get("version", 0),
        "working": pointers.get("working"),
        "best": pointers.get("best"),
        "delivery": pointers.get("delivery"),
    }


def _decision_for_history(entries):
    pointers_touched = {entry.get("pointer") for entry in entries}
    if "delivery" in pointers_touched:
        return "delivery"
    if "best" in pointers_touched:
        return "best"
    return "working-only"


def _require_baseline_min_wns(policy):
    """`policy["baselineMinWns"]` as a finite number, or raise
    `AtcsError("invalid-policy", ...)` — required whenever `pointers["best"]`
    is `None`, not only on a genuinely empty pointers file (see module
    docstring's guard 8)."""
    value = policy.get("baselineMinWns")
    if value is None or isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise core.AtcsError(
            "invalid-policy", "policy.baselineMinWns is required (as a finite number) while best is unset"
        )
    return value


def _state_id_already_used(history, state_id, evaluation_id, baseline_state_id=None):
    """True when `state_id` is already spoken for by something other than
    this evaluation: either it names the Campaign's own declared
    `baseline_state_id` (a candidate may not claim to *be* the baseline), or
    some *other* evaluation (a different `evaluationId`) already recorded it
    as a pointer's `"new"` value — a real state id must never be claimed by
    two distinct evaluations (see module docstring's guard 2's
    `"state-id-reused"` reason)."""
    if baseline_state_id is not None and state_id == baseline_state_id:
        return True
    for entry in history:
        new_value = entry.get("new")
        if new_value and new_value.get("stateId") == state_id and entry.get("evaluationId") != evaluation_id:
            return True
    return False


def _fold_history_up_to(history, last_index):
    """Fold `history[:last_index + 1]` into the pointers state as of right
    after that index's entry, plus the count of distinct acceptance records
    seen (== the pointers document's `version` at that point)."""
    state = {"working": None, "best": None, "delivery": None}
    seen_records = []
    for entry in history[: last_index + 1]:
        state[entry["pointer"]] = entry["new"]
        record_id = entry["acceptanceRecordId"]
        if record_id not in seen_records:
            seen_records.append(record_id)
    return state, len(seen_records)


def _reconstruct_after_snapshot(history, record_id):
    """The pointers snapshot exactly as it was right after `record_id`'s
    entries were appended (see module docstring's idempotency guard)."""
    last_index = max(i for i, entry in enumerate(history) if entry["acceptanceRecordId"] == record_id)
    state, version = _fold_history_up_to(history, last_index)
    return {"version": version, "working": state["working"], "best": state["best"], "delivery": state["delivery"]}


def _replay_record(pointers, prior_entries, database_ref, policy):
    """The `acceptance-record` this evaluation originally earned, replayed
    from `history` — never derived from `pointers`' *current* state, which
    may have moved on since (see module docstring's idempotency guard)."""
    record_id = prior_entries[0]["acceptanceRecordId"]
    after_snapshot = _reconstruct_after_snapshot(pointers["history"], record_id)
    before_snapshot = dict(after_snapshot)
    before_snapshot["version"] = after_snapshot["version"] - 1
    for entry in prior_entries:
        before_snapshot[entry["pointer"]] = entry["previous"]

    body = {
        "decision": _decision_for_history(prior_entries),
        "pointersBefore": before_snapshot,
        "pointersAfter": after_snapshot,
        "acceptedArtifactReady": _compute_ready(database_ref, policy),
        "reason": "idempotent-replay",
    }
    return core.stamp("acceptance-record", body)


def publish(evaluation, expected_base, pointers_path, policy):
    """Publish `evaluation` into the three state pointers at `pointers_path`,
    guarded by compare-and-swap on `expected_base` (see module docstring).

    Returns an ``acceptance-record``. Never raises for a candidate that
    simply fails a guard — those are reported as a `"refused"` decision with
    a `reason`, not an `AtcsError`. `AtcsError` is only raised for
    structural problems `publish` cannot proceed past at all:
    `"schema-mismatch"`/`"identity-mismatch"` when `evaluation` is not a
    genuine, unmodified ``atcs.evaluation/1`` artifact, and
    `"invalid-policy"` when `policy` itself is malformed (including a
    missing/non-finite `policy["baselineStateId"]`, required whenever
    `working` is unset, or `policy["baselineMinWns"]`, required whenever
    `best` is unset — see module docstring).
    """
    policy = _normalize_policy(policy)
    _validate_evaluation_identity(evaluation)
    evaluation_id = evaluation["id"]
    candidate_id = evaluation.get("candidateId")
    state_id = evaluation.get("stateId")
    database_ref = evaluation.get("database")

    pointers = load_pointers(pointers_path)

    prior_entries = [entry for entry in pointers["history"] if entry.get("evaluationId") == evaluation_id]
    if prior_entries:
        return _replay_record(pointers, prior_entries, database_ref, policy)

    before_snapshot = _snapshot(pointers)

    def _refuse(reason):
        body = {
            "decision": "refused",
            "pointersBefore": before_snapshot,
            "pointersAfter": before_snapshot,
            "acceptedArtifactReady": core.unknown("not-accepted"),
            "reason": reason,
        }
        return core.stamp("acceptance-record", body)

    if not state_id or not candidate_id:
        return _refuse("missing-identity")

    if state_id == evaluation.get("parentStateId"):
        return _refuse("self-parent")

    if _state_id_already_used(pointers["history"], state_id, evaluation_id, policy.get("baselineStateId")):
        return _refuse("state-id-reused")

    if evaluation.get("parentStateId") != expected_base:
        return _refuse("stale-base")

    working_ptr = pointers["working"]
    if working_ptr is not None:
        if expected_base != working_ptr.get("stateId"):
            return _refuse("stale-base")
    else:
        baseline_state_id = policy.get("baselineStateId")
        if not baseline_state_id:
            raise core.AtcsError("invalid-policy", "policy.baselineStateId is required for bootstrap")
        if expected_base != baseline_state_id:
            return _refuse("stale-base")

    verified, verify_reason = _is_verified(evaluation)
    if not verified:
        return _refuse(verify_reason)

    if not _constraints_known(evaluation):
        return _refuse("constraints-not-verified")
    constraint_failure_value = core.value_of(evaluation["constraintFailureCount"])
    if constraint_failure_value > policy["maxNewConstraintFailures"]:
        return _refuse("constraint-failures-exceed-cap")

    wns = _wns_status(evaluation, policy["goal"])
    if not wns["known"]:
        return _refuse("wns-unknown")

    best_ptr = pointers["best"]
    baseline_min = best_ptr.get("minWns") if best_ptr is not None else _require_baseline_min_wns(policy)
    wns_regression = baseline_min - wns["min"]
    is_wns_degraded = wns_regression > 0
    is_constraint_degraded = constraint_failure_value > 0
    is_degraded = is_wns_degraded or is_constraint_degraded

    if is_degraded:
        if not policy["allowDegradedWorking"]:
            return _refuse("degraded-working-not-allowed")
        bound = wns_regression if is_wns_degraded else 0.0
        if bound > policy["degradeLimitNs"]:
            return _refuse("degrade-limit-exceeded")

    new_ptr_value = {
        "stateId": state_id,
        "candidateId": candidate_id,
        "evaluationId": evaluation_id,
        "minWns": wns["min"],
        "failingTimingChecks": _timing_failure_count(evaluation),
    }

    constraints_pass = constraint_failure_value == 0
    if best_ptr is not None:
        best_eligible = constraints_pass and _is_better(new_ptr_value, best_ptr)
    else:
        # No `best` has ever been won: winning it requires actually clearing
        # the Campaign's declared baseline, not merely beating a nonexistent
        # incumbent (see module docstring's guard 8 and the "whenever best is
        # None, best-eligibility requires minWns >= baselineMinWns" rule).
        best_eligible = constraints_pass and not is_wns_degraded

    ready_measure = _compute_ready(database_ref, policy)
    delivery_eligible = (
        constraints_pass
        and wns["goalMet"]
        and core.is_known(ready_measure)
        and core.value_of(ready_measure) == 1
    )

    updates = [("working", pointers["working"], new_ptr_value)]
    if best_eligible:
        updates.append(("best", pointers["best"], new_ptr_value))
    if delivery_eligible:
        updates.append(("delivery", pointers["delivery"], new_ptr_value))

    decision = "delivery" if delivery_eligible else ("best" if best_eligible else "working-only")

    notes = []
    if is_constraint_degraded:
        notes.append("constraint-failures-degraded-working")
    if is_wns_degraded:
        notes.append("degraded-working-within-limit")
    if constraints_pass and not best_eligible:
        notes.append("below-baseline" if best_ptr is None else "not-better-than-current-best")
    if constraints_pass and wns["goalMet"] and not delivery_eligible:
        notes.append("artifact-not-ready-for-delivery")
    reason = "; ".join(notes) if notes else "accepted"

    new_version = pointers.get("version", 0) + 1
    updated_values = {name: value for name, _prev, value in updates}
    after_pointers = {
        "version": new_version,
        "working": updated_values.get("working", pointers["working"]),
        "best": updated_values.get("best", pointers["best"]),
        "delivery": updated_values.get("delivery", pointers["delivery"]),
    }

    record = core.stamp("acceptance-record", {
        "decision": decision,
        "pointersBefore": before_snapshot,
        "pointersAfter": after_pointers,
        "acceptedArtifactReady": ready_measure,
        "reason": reason,
    })

    new_history_entries = [
        {
            "pointer": name,
            "previous": previous,
            "new": value,
            "evaluationId": evaluation_id,
            "acceptanceRecordId": record["id"],
        }
        for name, previous, value in updates
    ]

    pointers_body = {
        "version": new_version,
        "working": after_pointers["working"],
        "best": after_pointers["best"],
        "delivery": after_pointers["delivery"],
        "history": list(pointers["history"]) + new_history_entries,
    }
    stamped_pointers = core.stamp("pointers", pointers_body)
    core.write_artifact(pointers_path, stamped_pointers)

    return record
