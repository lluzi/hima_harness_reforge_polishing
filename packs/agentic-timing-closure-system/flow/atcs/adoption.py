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
  actual on-disk database (``.enc`` file, ``.enc.dat`` directory tree)
  against the identity `database_ref` recorded at evaluation time, so a
  delivery is only ever recorded for a database that is *still*, right now,
  byte-identical and restorable — never for one that merely had a matching
  hash at some earlier moment.

Fail-closed is the rule for every function here, same as the rest of this
Pack: a missing, truncated or partially-evidenced input yields `unknown`
with a reason or a refused `acceptance-record` — never a silently-assumed
pass and never `0` unless the data explicitly proves it.

``evaluation["database"]`` (binding for `publish`/`artifact_ready`)
---------------------------------------------------------------------

Per this task's Decisions, the evaluation to publish carries its own
database identity rather than `publish` taking a second, separately-aimed
argument that could itself go stale relative to `evaluation`::

    {
        "enc": {"path": "<path to the .enc database file>", "sha256": "<64 hex>"},
        "encDat": {"path": "<path to the .enc.dat directory>", "treeDigest": "<64 hex>"},
    }

`publish` reads this via `evaluation.get("database")` and passes it straight
to `artifact_ready` — it never re-derives or defaults it. A caller whose
evaluation input genuinely lacks this ref gets `artifact_ready`'s
`unknown("missing-...")` back, which fail-closed excludes that candidate
from ever becoming a `delivery` (see below) without needing a second
signature shape.

`artifact_ready(database_ref)`
-----------------------------------

Re-hashes `database_ref["enc"]["path"]` via `core.file_sha256` and
`database_ref["encDat"]["path"]` via `core.tree_digest`, and compares both
against the recorded `sha256`/`treeDigest`. `database_ref` itself missing,
or missing either leg's `path`/identity field, is `unknown` (`"we don't
have enough identity to check"`, a data-completeness problem). Once both
legs are actually present, a mismatch, or a file/directory that no longer
exists, is `known(0)` — not `unknown` — because a bytes-changed or
now-missing database is *proven* not currently restorable to the recorded
identity, which is exactly what this Measure exists to certify. Only when
both the file hash and the tree digest match exactly is the result
`known(1)`.

Pointer value shape (internal to the pointers document)
-------------------------------------------------------

Each of `working`/`best`/`delivery` is either `None` (never set) or::

    {
        "candidateId": "<evaluation's candidateId — the merge-commit/state id>",
        "evaluationId": "<the evaluation artifact's own stamped id>",
        "minWns": <float> | None,        # min(finalSetupWns, finalHoldWns) when both
                                          # were known at publish time, else None
        "failingChecks": <int> | None,   # constraintFailureCount's value when known
    }

`expected_base` is compared against `working["candidateId"]` (`None` when
`working` has never been set) — per this task's Decisions, `working` is
"the state the candidate's batch was built on": a batch that was built on
top of an older state than the one `working` now names is late/stale and
must never overwrite anything, no matter how good its own numbers look.

Guard order in `publish`
-------------------------------

1. **Idempotency** — if `evaluation["id"]` already names an entry in the
   pointers document's `history`, `publish` does no further work: it
   returns a fresh `acceptance-record` carrying the *same* decision this
   evaluation already earned (the highest pointer tier any of its history
   entries touched: `delivery` > `best` > `working-only`), re-checks
   `artifact_ready` for the report (a pure re-read, no state change), and
   leaves the pointers file untouched — not even rewritten with identical
   bytes, and `version` is not bumped. This must run *before* the
   compare-and-swap check below, precisely so a late replay of an
   evaluation that was already accepted keeps returning its original,
   truthful answer even after `working` has since moved on.
2. **Compare-and-swap** — `expected_base != working["candidateId"]` (or
   `None` when `working` has never been set) refuses with reason
   `"stale-base"`. This is the guard that makes a genuinely late result
   (built on a base that is no longer current) harmless even though its own
   evidence might look perfectly good in isolation.
3. **Verification** (`final-evidence-ready`'s two Judge nodes, read
   directly off the evaluation) — `missingRequiredCheckCount` and
   `finalIdentityErrorCount` must both be known Measures equal to `0`.
   Anything else (unknown, or a nonzero count) refuses
   (`"missing-required-checks"` / `"identity-errors-present"`) — an
   evaluation this Pack cannot even prove covers every required check with
   a consistent identity chain can never move any pointer, degraded or not.
4. **WNS known** — `finalSetupWns`/`finalHoldWns` must both be known
   Measures. Per this task's Decisions ("'Better' ... is computed only from
   known Measures; an evaluation whose finalSetupWns or finalHoldWns is
   unknown can never become best or delivery"), this module goes one step
   further and fail-closes `working` too when WNS is unknown
   (`"wns-unknown"`): the degraded-working gate below bounds a *known*
   regression — it cannot bound an unmeasured one, so an unknown WNS is
   refused rather than silently treated as either "fine" or "as bad as the
   limit allows".
5. **Degraded-working gate** — "degraded" here means *worse than the
   candidate `working` itself already names*, not "has not yet reached
   `policy['goal']`" — most evaluations published over a campaign have not
   reached the final goal yet, and that is the normal, expected case that
   never needs `allowDegradedWorking` at all. Concretely: when `working` has
   never been set (bootstrap), there is nothing to regress against, so this
   gate never fires. Otherwise, `regression = working["minWns"] -
   min(finalSetupWns, finalHoldWns)`; `regression <= 0` (this candidate is
   at least as good as current `working`) always passes. `regression > 0`
   (a real step backward) requires `policy["allowDegradedWorking"] is True`
   *and* `regression <= policy["degradeLimitNs"]`, else refused
   (`"degraded-working-not-allowed"` / `"degrade-limit-exceeded"`). This is
   the one guard about *how far backward* `working` may be pushed, not about
   evidence quality — a controlled, bounded regression `working` may carry
   per `SPEC.md`'s "workingState 可以指向受控的暂时退化实现", never an
   unbounded one.

Once all five guards pass, `working` always moves to this candidate. Two
further, independent eligibility checks then decide whether `best` and/or
`delivery` *also* move (all three pointers are independent — moving
`working` never implies moving the others, and moving `delivery` does not
require `best` to have just moved too, though in practice it usually has):

- **`best` eligibility** — `required-constraints-pass`
  (`constraintFailureCount == 0` and `constraintUnknownCount == 0`, both
  known) *and* this candidate compares as better than the current `best`
  per the brief's fixed comparison policy: higher `min(finalSetupWns,
  finalHoldWns)` wins; a tie breaks on fewer `constraintFailureCount`
  failures; a `None` current `best` always loses (anything admissible
  becomes the first `best`). A `constraintUnknownCount` that is unknown or
  `> 0` therefore can never win `best`, exactly per this task's Decisions,
  regardless of how good its WNS is.
- **`delivery` eligibility** — `required-constraints-pass` *and*
  `finalSetupWns`/`finalHoldWns` both meet `policy["goal"]` *and*
  `artifact_ready(evaluation.get("database"))` is the known Measure `1`.
  This does not require `best` eligibility too: a later, slightly-worse-but
  still goal-meeting candidate whose database is verified restorable may
  still deliver even while an earlier, better-scoring candidate remains
  `best` (its own database having since gone stale) — the two pointers
  answer different questions and this Pack never conflates them.

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
Decisions: "Record the acceptance-record id in history").

A `refused` decision — for *any* reason, not only `"stale-base"` — writes
nothing at all: the pointers file (if any) is left byte-identical, since
nothing was accepted and there is nothing new to record.
"""
from __future__ import annotations

from pathlib import Path

from . import core


def _require(mapping, key, label):
    """Return `mapping[key]`, or raise `AtcsError("missing-input", ...)` if absent."""
    if key not in mapping:
        raise core.AtcsError("missing-input", f"{label}.{key}")
    return mapping[key]


def _default_pointers():
    return {"version": 0, "working": None, "best": None, "delivery": None, "history": []}


def load_pointers(path):
    """Return the pointers document at `path`, or the bootstrap default if it
    does not exist yet (see module docstring)."""
    target = Path(path)
    if not target.exists():
        return _default_pointers()
    return core.read_artifact(target, "pointers")


def artifact_ready(database_ref):
    """Re-hash `database_ref`'s `.enc`/`.enc.dat` against its recorded identity
    (see module docstring). Returns a Measure."""
    if not isinstance(database_ref, dict):
        return core.unknown("missing-database-ref")

    enc = database_ref.get("enc") or {}
    enc_dat = database_ref.get("encDat") or {}
    enc_path, enc_sha = enc.get("path"), enc.get("sha256")
    dat_path, dat_digest = enc_dat.get("path"), enc_dat.get("treeDigest")

    if not enc_path or not enc_sha:
        return core.unknown("missing-enc-identity")
    if not dat_path or not dat_digest:
        return core.unknown("missing-encDat-identity")

    try:
        actual_enc_sha = core.file_sha256(enc_path)
    except OSError:
        return core.known(0)

    try:
        actual_dat_digest = core.tree_digest(dat_path)
    except core.AtcsError:
        return core.known(0)

    if actual_enc_sha != enc_sha or actual_dat_digest != dat_digest:
        return core.known(0)
    return core.known(1)


def _is_verified(evaluation):
    missing = evaluation.get("missingRequiredCheckCount")
    identity = evaluation.get("finalIdentityErrorCount")
    if not core.is_known(missing) or core.value_of(missing) != 0:
        return False, "missing-required-checks"
    if not core.is_known(identity) or core.value_of(identity) != 0:
        return False, "identity-errors-present"
    return True, None


def _wns_status(evaluation, goal):
    setup = evaluation.get("finalSetupWns")
    hold = evaluation.get("finalHoldWns")
    if not (core.is_known(setup) and core.is_known(hold)):
        return {"known": False, "goalMet": False, "min": None}

    setup_v = core.value_of(setup)
    hold_v = core.value_of(hold)
    goal_met = setup_v >= goal.get("setup", 0.0) and hold_v >= goal.get("hold", 0.0)
    return {"known": True, "goalMet": goal_met, "min": min(setup_v, hold_v)}


def _constraints_pass(evaluation):
    failure = evaluation.get("constraintFailureCount")
    unknown_count = evaluation.get("constraintUnknownCount")
    if not core.is_known(failure) or core.value_of(failure) != 0:
        return False
    if not core.is_known(unknown_count) or core.value_of(unknown_count) != 0:
        return False
    return True


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
    candidate_fail = candidate.get("failingChecks")
    current_fail = current_best.get("failingChecks")
    candidate_fail = candidate_fail if candidate_fail is not None else float("inf")
    current_fail = current_fail if current_fail is not None else float("inf")
    return candidate_fail < current_fail


def _measure_value_or_none(measure):
    if measure is not None and core.is_known(measure):
        return core.value_of(measure)
    return None


def _normalize_policy(policy):
    policy = dict(policy or {})
    policy.setdefault("allowDegradedWorking", False)
    policy.setdefault("degradeLimitNs", 0.0)
    goal = dict(policy.get("goal") or {})
    goal.setdefault("setup", 0.0)
    goal.setdefault("hold", 0.0)
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


def publish(evaluation, expected_base, pointers_path, policy):
    """Publish `evaluation` into the three state pointers at `pointers_path`,
    guarded by compare-and-swap on `expected_base` (see module docstring).

    Returns an ``acceptance-record``. Never raises for a candidate that
    simply fails a guard — those are reported as a `"refused"` decision with
    a `reason`, not an `AtcsError`. `AtcsError("missing-input", ...)` is
    only raised when `evaluation` itself lacks the identity fields
    (`id`/`candidateId`) this module cannot proceed without at all.
    """
    policy = _normalize_policy(policy)
    evaluation_id = _require(evaluation, "id", "evaluation")
    candidate_id = _require(evaluation, "candidateId", "evaluation")
    database_ref = evaluation.get("database")

    pointers = load_pointers(pointers_path)

    prior_entries = [entry for entry in pointers["history"] if entry.get("evaluationId") == evaluation_id]
    if prior_entries:
        snapshot = _snapshot(pointers)
        body = {
            "decision": _decision_for_history(prior_entries),
            "pointersBefore": snapshot,
            "pointersAfter": snapshot,
            "acceptedArtifactReady": artifact_ready(database_ref),
            "reason": "idempotent-replay",
        }
        return core.stamp("acceptance-record", body)

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

    working_ptr = pointers["working"]
    working_candidate = working_ptr["candidateId"] if working_ptr else None
    if expected_base != working_candidate:
        return _refuse("stale-base")

    verified, verify_reason = _is_verified(evaluation)
    if not verified:
        return _refuse(verify_reason)

    wns = _wns_status(evaluation, policy["goal"])
    if not wns["known"]:
        return _refuse("wns-unknown")

    current_working_min = working_ptr.get("minWns") if working_ptr else None
    is_degraded = current_working_min is not None and (current_working_min - wns["min"]) > 0
    if is_degraded:
        regression = current_working_min - wns["min"]
        if not policy["allowDegradedWorking"]:
            return _refuse("degraded-working-not-allowed")
        if regression > policy["degradeLimitNs"]:
            return _refuse("degrade-limit-exceeded")

    constraints_ok = _constraints_pass(evaluation)
    new_ptr_value = {
        "candidateId": candidate_id,
        "evaluationId": evaluation_id,
        "minWns": wns["min"],
        "failingChecks": _measure_value_or_none(evaluation.get("constraintFailureCount")),
    }

    best_eligible = constraints_ok and _is_better(new_ptr_value, pointers["best"])

    ready_measure = artifact_ready(database_ref)
    delivery_eligible = (
        constraints_ok
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
    if not constraints_ok:
        notes.append("constraints-not-verified")
    if is_degraded:
        notes.append("degraded-working-within-limit")
    if constraints_ok and not best_eligible:
        notes.append("not-better-than-current-best")
    if constraints_ok and wns["goalMet"] and not delivery_eligible:
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
