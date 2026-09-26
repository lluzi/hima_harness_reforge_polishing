"""M5: deterministic replay and merge — the Integration Fix Session's adapter.

This module owns the six M5 producers named in
``.superpowers/sdd/task-7-brief.md`` and the ``integration-plan``,
``replay-request``, ``integration-state`` and ``merge-commit`` rows of
``.superpowers/sdd/global-context.md``'s "Shared data model" table:

- `validate_plan(obj, facts)` -> ``integration-plan`` (raises
  ``AtcsError("invalid-plan", ...)``) — a Reader-shaped gate on the compose
  Workshop's plan, mirroring `atcs.workspaces.validate_work_package`'s
  shape: collect every problem, stamp and return only when there are none.
- `plan_invalid_count(obj, facts)` -> ``int`` — the same problem count,
  never raising, for a Reader's ``tc_request_invalid_count``.
- `prepare_replay(plan, facts, contributions)` -> ``replay-request`` — turns
  a validated plan into one ordered, idempotent XTop step per operation.
- `pending_steps(request, receipts)` -> ``list[stepId]`` — the steps an
  interrupted replay still has to attempt; a step with *any* receipt
  (``ok`` or ``error``) is not re-inserted.
- `reconcile(request, receipts, edit_domains)` -> ``integration-state`` —
  folds receipts into applied/failed/pending/replayMismatch/outOfScope/
  unknownReceipts.
- `seal_batch(state, request, facts, contributions)` -> ``merge-commit`` —
  the one sealed, unified result of a batch, refusing an incomplete one.
- `xtop_tcl(op)` / `innovus_eco_tcl(operations)` -> ``str`` — the only two
  places this module turns a typed `operation` into real tool text, using
  only flags documented in ``knowledge/xtop-capabilities.md`` and
  ``knowledge/innovus-stage-interventions.md``.

Per ``AGENTIC_TIMING_CLOSURE_SYSTEM_ARCHITECTURE.zh-CN.md`` §8 ("Integration
Fix Session"), this module is the "确定性适配器" half of that session: it
never picks a winner and never invents a fix (that is the compose
Workshop's `integration-plan`, and M4's `composition-facts` it is built
against) — it only replays exactly what the plan and facts already decided,
checks every replayed effect against what was actually observed, and seals
one MergeCommit that records the union ECO, the source of every operation,
and the base every later stage (M6+) must build on. §8.4's recovery rule —
"一个操作已经应用但收据丢失时，先查实际状态，不能重复插入 buffer" — is why
`pending_steps` treats *any* receipt as final: replaying is driven off
which steps still lack a receipt, never off how many the caller thinks it
already sent.

State ids (controller decision)
--------------------------------

`plan.baseStateId`, `request.baseStateId` and `mergeCommit.parentStateId`
are all the same base design-state id: `facts.baseStateId`. `prepare_replay`
and `seal_batch` both re-check the relevant identity equalities themselves
(`plan.baseStateId == facts.baseStateId`; `request.baseStateId ==
facts.baseStateId`; `state.batchId == request.batchId`; the set of
`state.applied` keys equals the set of `request.steps` `stepId`s) and raise
`AtcsError("identity-mismatch", ...)` on any disagreement — a caller wiring
bug here would otherwise silently seal a commit against the wrong base or
an incompletely-reconciled state.

Resolutions are generic by conflict key (controller decision)
----------------------------------------------------------------

`integration-plan.resolutions` is `[{"conflictKey", "decision", ...}]` with
`decision` one of `"keep:<id>"`, `"drop:<id>"` or `"revise:<id>"`
(+ `"revisedContribution"` for `revise`, itself a **contribution id already
in `facts.considered`** — see "Revising" below). This module never
branches on a conflict's `kind` string — M4 may add or rename conflict
kinds independently (it already has, mid-development: `same-load-pin`,
`shared-instance-edit`), and every rule below is expressed purely in terms
of contribution ids and conflict membership:

- `"drop:<id>"` excludes `<id>` from replay entirely.
- `"keep:<id>"` excludes every *other* id listed in that resolution's own
  `conflictKey`'s `conflict["contributions"]` — whichever conflict kind
  that is.
- `"revise:<id>"` does not exclude `<id>`; it substitutes the considered
  contribution named by `revisedContribution` for `<id>`'s own operations
  when building replay steps. It is not, by itself, treated as resolving a
  conflict's membership count (see `unresolved-conflict` below) — the
  revised contribution may or may not actually eliminate the underlying
  disagreement, and this module has no way to re-derive that without
  re-running M4's analysis, so a conflict a `revise` was meant to settle
  still needs an explicit `keep`/`drop` on its other member(s) to actually
  clear it.

`validate_plan` additionally rejects a `keep`/`drop`/`revise` decision
whose target id is not itself a member of that resolution's own
`conflictKey`'s `contributions`. It also rejects genuinely contradictory
resolutions: two different decision kinds for the *same* (`conflictKey`,
target id) pair, or two different `keep` targets under the same
`conflictKey` (each `keep` implicitly excludes every other member, so two
different `keep` targets for one conflict can never both hold). Two
resolutions naming *different* targets under the same `conflictKey` (e.g.
`"revise:a"` alongside `"drop:b"` for a three-member conflict) are not
contradictory — they are the normal way a multi-member conflict gets
resolved piece by piece.

`prepare_replay` raises `AtcsError("unresolved-conflict", ...)` when, after
applying only `drop`/`keep` exclusion and `deferred` removal (never
`revise` substitution) to `plan.select`, any conflict in `facts.conflicts`
still has two or more of its own `contributions` remaining in the selected
set — regardless of that conflict's `kind`, and regardless of whether some
`conflictKey` in `plan.resolutions` merely *mentions* it (M4's own
`unresolvedCount`, per `atcs.composition`'s docstring, only checks that a
resolution mentions the key, not that it actually clears the collision;
this module re-derives the real answer from id membership instead of
trusting that count).

Revising (controller decision A)
------------------------------------

A stale-base or conflicted contribution is fixed by re-sealing a corrected
contribution in M3 and re-running M4's `analyze` over the enlarged
contribution set, so the fix appears fresh in `facts.considered` under its
own id (correct `baseStateId`, and conflict-free unless it still collides).
`"revise:<id>"`'s `revisedContribution` is therefore **a contribution id
string that must already be in `facts.considered`** — never an inline
contribution object. This module refuses (`AtcsError("missing-input", ...)`
from `prepare_replay`, or a `validate_plan` problem) any `revisedContribution`
that is not a considered id, because being considered is exactly M4's own
guarantee that the object is admissible and sealed against the current
base — M5 never accepts a contribution object M4 did not itself analyze.
A purely stale-base contribution (never part of any conflict — M4 excludes
`staleBase` ids from every conflict by construction) is never the target of
a `revise` resolution; its fix is simply selected directly under its own
fresh id once re-analyzed. A directly-selected id whose own sealed
`baseStateId` still disagrees with `facts.baseStateId` (only reachable by
calling `prepare_replay` without first running `validate_plan`, which
would have rejected it) raises `AtcsError("stale-base", ...)`.

Steps and ordering
--------------------

Every considered id in `facts.order` that is selected and not excluded
(`drop`, `keep`-losing, or `deferred`) contributes one step per operation
in its (possibly revised) `operations` list, in that list's own order.
`stepId = core.digest({"contributionId": <the id whose operations these
are>, "opIndex": <index>})`. A `select` id absent from `facts.order`
(only reachable by calling `prepare_replay` directly, bypassing
`validate_plan`) is processed after every ordered id, sorted by id.

`pg_local_adjust` operations are never replayed here: `prepare_replay`
raises `AtcsError("unsupported-op", ...)` the moment one is selected — PG
changes go through the implementation step later (T11/T12), not M5's XTop
replay.

Duplicates from facts — no silent empty merge
------------------------------------------------

`facts.duplicates` is `[{"keep", "dropped": [...], "sources": [...]}]`
(identical whole `operations` lists — and M4 always pairs a duplicates
group with a `shared-instance-edit`/`same-instance-different-master`-style
conflict on the same object, since two contributions with identical ops
inherently touch the same instance). This module replays **one**
representative per group, per operation — but that representative is
whichever group member actually survives the plan's own exclusions, not
always M4's own `keep` choice: if the plan selects only a `dropped` member
(e.g. because a `keep`/`drop` resolution removed the official `keep` from
this batch), that surviving member is replayed instead, so a batch is
never silently emptied just because the workshop happened not to pick
M4's arbitrary tie-break. Ties among several still-eligible members are
broken by preferring `keep`, then the smallest id. If literally no member
of a group survives selection, the group contributes nothing (correctly —
nothing was asked for). `seal_batch`'s `sourceMap` then attributes the
replayed representative's ops to the **whole group's** `sources`, so every
member still shows up as having proposed this outcome.

`prepare_replay` raises `AtcsError("selected-without-steps", ...)` when a
selected, non-excluded, non-deferred `fix`-kind contribution ends up
credited with zero steps (checked after duplicate-group resolution, so a
group correctly returning steps under a non-`keep` representative is never
flagged) — the last line of defense against a silently empty merge from
any cause this module has not otherwise been programmed to catch.

Tcl safety
------------

Every string substituted into a Tcl command by `xtop_tcl`/`innovus_eco_tcl`
(instance, net, master, generated names, load pins) is checked non-empty,
free of whitespace, free of `;`, `[`, `]`, `{`, `}`, `$`, `"`, `\` and
newline, and not starting with `-` (which a bare/positional argument
position would otherwise let a value masquerade as a flag); any violation
is `AtcsError("unsafe-name", ...)`. A malformed `location` (wrong shape or
a non-finite coordinate) is `AtcsError("malformed-input", ...)` — a
numeric-shape problem, not a string-injection one, so it gets its own
code. `innovus_eco_tcl`'s buffer-insertion line uses `ecoAddRepeater -term
<loadPins...> -cell <master> -name <newInstance> -newNetName <newNet>
[-loc {x y}]` — `-term`/`-loc` per
``knowledge/innovus-stage-interventions.md``'s documented `ecoAddRepeater`
syntax (this overrides an earlier draft's `-net`); `-newNetName` is used
because the same page documents it, so the new net's name is recorded
directly rather than needing to be read back from a receipt.

Receipts and reconciliation
------------------------------

`receipts` is `[{"stepId", "status": "ok"|"error", "observedDelta"}]`.
`pending_steps` treats a step as pending only when it has *no* receipt at
all (any receipt — `ok` or `error` — means it was attempted and is not
re-inserted, per §8.4). `reconcile` keeps the *first* receipt seen for a
given `stepId`; a **second, non-identical** receipt for the same step is
not silently accepted as a re-delivery — that step is unreliable and goes
straight to `replayMismatch`. A receipt naming a `stepId` this request
never issued is collected (sorted) into `unknownReceipts` rather than
silently ignored. `observedDelta` is normalized (missing
`mastersChanged`/`added`/`removed` keys filled with `{}`) before any
comparison. For every step with a single, known receipt:

1. `status != "ok"` -> `failed`.
2. Every instance the (normalized) observed delta touches is checked
   against the union, over every step in the request, of that step's own
   `contributionId`'s ``edit_domains`` entry applying M3's scope rule
   (`size_cell`/`delete_buffer`: instance is a member of that work
   package's `editDomain.instances`; `insert_buffer`: the new instance is
   in scope when the buffered `net` is a member of `editDomain.nets` — a
   trace-created instance inherits its own op's scope verdict, exactly as
   `atcs.contributions._scope_check` decides it at seal time). Any observed
   instance outside that union -> `outOfScope`. This check runs **before**
   the equality check below and independently of it, so an observed delta
   that is "the expected change plus one extra instance" is flagged as
   *both* `outOfScope` and `replayMismatch`.
3. The normalized observed delta does not equal the op's own expected
   delta (the `delta`-shape restricted to that one op) -> `replayMismatch`.
4. Only when neither of the above fired -> `applied[stepId] = observedDelta`.

`edit_domains` is `{contributionId: {"instances": [...], "nets": [...],
"regions": [...]}}` — each contributing contribution's own work package's
`editDomain`. A `contributionId` absent from `edit_domains` contributes
nothing to the allowed union (fail-closed: an undeclared domain never
default-permits).

`seal_batch` refuses (`AtcsError("integration-incomplete", ...)`) unless
`pending`, `failed`, `replayMismatch`, `outOfScope` and `unknownReceipts`
are all empty, and additionally raises `AtcsError("identity-mismatch",
...)` when `state.batchId != request.batchId`, `request.baseStateId !=
facts.baseStateId`, or the set of `state.applied` keys does not exactly
equal the set of `request.steps`' `stepId`s — tentative or misidentified
state is never mistaken for a deliverable (§8's step 10, "不得将 tentative
状态当交付物").

MergeCommit
-------------

`operations` is every applied step's op, in replay order. `sourceMap` maps
`opKey = core.digest({"op": op})` (the *canonical* op, so two contributions
proposing byte-identical ops always land on the same key even though they
are different Python dict instances) to the sorted set of every
contributing id — the applied representative's own id, widened to that
whole duplicate group's `sources` when it was a kept duplicate.
`contributions` lists `{id, revision}` for every id that appears somewhere
in `sourceMap`, **except** an id the plan itself `drop`ped or `deferred`
(`request.droppedOrDeferredIds`, recorded by `prepare_replay`) — a
duplicate source the workshop explicitly excluded from this batch is not
credited as part of it merely because a *different* group member happened
to carry an identical op. `newNets` is every `insert_buffer` op's
`newNet`, in first-seen order. `parentStateId` is `facts.baseStateId` per
the state-id decision above.
"""
from __future__ import annotations

import math

from . import core


_DELTA_KEYS = ("mastersChanged", "added", "removed")
_UNSAFE_TCL_CHARS = set(';[]{}$"\n\\')


# ---------------------------------------------------------------------------
# Small shared helpers
# ---------------------------------------------------------------------------


def _hashable(value):
    try:
        hash(value)
        return True
    except TypeError:
        return False


# ---------------------------------------------------------------------------
# Tcl value safety and rendering
# ---------------------------------------------------------------------------


def _validate_tcl_value(value, label):
    """Return `value` unchanged, or raise `AtcsError("unsafe-name", ...)`.

    Every string this module substitutes into a Tcl command passes through
    here: non-empty, no whitespace, none of `;[]{}$"\\` or a newline, and
    not starting with `-` (which would let it be read as a flag rather
    than the literal value it is).
    """
    if not isinstance(value, str) or value == "":
        raise core.AtcsError("unsafe-name", f"{label} must be a non-empty string, got {value!r}")
    if value.startswith("-"):
        raise core.AtcsError("unsafe-name", f"{label} must not start with '-': {value!r}")
    if any(ch.isspace() for ch in value) or any(ch in _UNSAFE_TCL_CHARS for ch in value):
        raise core.AtcsError("unsafe-name", f"{label} contains an unsafe character: {value!r}")
    return value


def _tcl_list(values):
    return "{" + " ".join(values) + "}"


def _format_number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise core.AtcsError("malformed-input", f"expected a finite number, got {value!r}")
    if math.isnan(value) or math.isinf(value):
        raise core.AtcsError("malformed-input", f"expected a finite number, got {value!r}")
    return str(value)


def _validate_location(location):
    """`(x_str, y_str)`, or `None` when `location` is `None`.

    Raises `AtcsError("malformed-input", ...)` for anything else that is
    not exactly two finite numbers.
    """
    if location is None:
        return None
    if not isinstance(location, (list, tuple)) or len(location) != 2:
        raise core.AtcsError("malformed-input", f"location must be null or [x, y], got {location!r}")
    x, y = location
    return _format_number(x), _format_number(y)


def xtop_tcl(op):
    """Render one `operation` as one line of documented XTop Tcl.

    Command spellings and flags come from ``knowledge/xtop-capabilities.md``
    (``size_cell``, ``insert_buffer -new_cell_names -new_net_names
    [-locations]``, ``remove_buffer``). Raises `AtcsError("unsafe-name",
    ...)` for any unsafe substituted value, `AtcsError("malformed-input",
    ...)` for a malformed `location`, `AtcsError("unsupported-op", ...)`
    for `pg_local_adjust` (M5 never replays PG changes in XTop — see
    module docstring), and `AtcsError("unknown-op", ...)` for anything
    else.
    """
    op_kind = op.get("op")
    if op_kind == "size_cell":
        instance = _validate_tcl_value(op.get("instance"), "instance")
        to_master = _validate_tcl_value(op.get("toMaster"), "master")
        return f"size_cell {_tcl_list([instance])} {to_master}"

    if op_kind == "insert_buffer":
        load_pins = [_validate_tcl_value(pin, "loadPins entry") for pin in (op.get("loadPins") or [])]
        master = _validate_tcl_value(op.get("master"), "master")
        new_instance = _validate_tcl_value(op.get("newInstance"), "newInstance")
        new_net = _validate_tcl_value(op.get("newNet"), "newNet")
        command = (
            f"insert_buffer {_tcl_list(load_pins)} {_tcl_list([master])} "
            f"-new_cell_names {_tcl_list([new_instance])} -new_net_names {_tcl_list([new_net])}"
        )
        formatted_location = _validate_location(op.get("location"))
        if formatted_location is not None:
            x, y = formatted_location
            command += f" -locations {{{{{x} {y}}}}}"
        return command

    if op_kind == "delete_buffer":
        instance = _validate_tcl_value(op.get("instance"), "instance")
        return f"remove_buffer {_tcl_list([instance])}"

    if op_kind == "pg_local_adjust":
        raise core.AtcsError("unsupported-op", "pg_local_adjust is not replayed by XTop in M5")

    raise core.AtcsError("unknown-op", f"unrecognized op kind {op_kind!r}")


def _innovus_eco_line(op):
    op_kind = op.get("op")
    if op_kind == "size_cell":
        instance = _validate_tcl_value(op.get("instance"), "instance")
        to_master = _validate_tcl_value(op.get("toMaster"), "master")
        return f"ecoChangeCell -inst {_tcl_list([instance])} -cell {to_master}"

    if op_kind == "insert_buffer":
        load_pins = [_validate_tcl_value(pin, "loadPins entry") for pin in (op.get("loadPins") or [])]
        if not load_pins:
            raise core.AtcsError("malformed-input", "insert_buffer op has no loadPins")
        master = _validate_tcl_value(op.get("master"), "master")
        new_instance = _validate_tcl_value(op.get("newInstance"), "newInstance")
        new_net = _validate_tcl_value(op.get("newNet"), "newNet")
        command = (
            f"ecoAddRepeater -term {' '.join(load_pins)} -cell {master} "
            f"-name {new_instance} -newNetName {new_net}"
        )
        formatted_location = _validate_location(op.get("location"))
        if formatted_location is not None:
            x, y = formatted_location
            command += f" -loc {{{x} {y}}}"
        return command

    if op_kind == "delete_buffer":
        instance = _validate_tcl_value(op.get("instance"), "instance")
        return f"ecoDeleteRepeater -inst {_tcl_list([instance])}"

    if op_kind == "pg_local_adjust":
        raise core.AtcsError("unsupported-op", "pg_local_adjust has no Innovus ECO form in M5")

    raise core.AtcsError("unknown-op", f"unrecognized op kind {op_kind!r}")


def innovus_eco_tcl(operations):
    """Render `operations` as one unified Innovus ECO Tcl script (one line per op).

    Command spellings and flags come from
    ``knowledge/innovus-stage-interventions.md`` (``ecoChangeCell -inst
    -cell``, ``ecoAddRepeater -term -cell -name -newNetName [-loc]``,
    ``ecoDeleteRepeater -inst``). Same error contract as `xtop_tcl`.
    """
    return "\n".join(_innovus_eco_line(op) for op in operations)


# ---------------------------------------------------------------------------
# Delta helpers
# ---------------------------------------------------------------------------


def _empty_delta():
    return {"mastersChanged": {}, "added": {}, "removed": {}}


def _normalize_delta(delta):
    delta = delta if isinstance(delta, dict) else {}
    return {key: dict(delta.get(key) or {}) for key in _DELTA_KEYS}


def _merge_deltas(deltas):
    merged = _empty_delta()
    for delta in deltas:
        delta = _normalize_delta(delta)
        for key in _DELTA_KEYS:
            merged[key].update(delta[key])
    return merged


def _op_expected_delta(op):
    """The `delta` shape a single op implies, restricted to that op alone.

    Raises `AtcsError("malformed-input", ...)` when `op` is missing a
    field its own kind requires, and for any unrecognized op kind.
    """
    op_kind = op.get("op")
    if op_kind == "size_cell":
        for field in ("instance", "fromMaster", "toMaster"):
            if field not in op:
                raise core.AtcsError("malformed-input", f"size_cell op missing {field!r}")
        return {"mastersChanged": {op["instance"]: [op["fromMaster"], op["toMaster"]]}, "added": {}, "removed": {}}
    if op_kind == "insert_buffer":
        for field in ("newInstance", "master"):
            if field not in op:
                raise core.AtcsError("malformed-input", f"insert_buffer op missing {field!r}")
        return {"mastersChanged": {}, "added": {op["newInstance"]: op["master"]}, "removed": {}}
    if op_kind == "delete_buffer":
        for field in ("instance", "master"):
            if field not in op:
                raise core.AtcsError("malformed-input", f"delete_buffer op missing {field!r}")
        return {"mastersChanged": {}, "added": {}, "removed": {op["instance"]: op["master"]}}
    if op_kind == "pg_local_adjust":
        return _empty_delta()
    raise core.AtcsError("malformed-input", f"unrecognized op kind {op_kind!r}")


def _delta_instances(delta):
    delta = _normalize_delta(delta)
    instances = set(delta["mastersChanged"])
    instances.update(delta["added"])
    instances.update(delta["removed"])
    return instances


def _op_target_instance(op):
    op_kind = op.get("op")
    if op_kind in ("size_cell", "delete_buffer"):
        return op.get("instance")
    if op_kind == "insert_buffer":
        return op.get("newInstance")
    return None


def _domain_allows(domain, op):
    """M3's scope rule (`atcs.contributions._scope_check`), applied to one `op`/`domain` pair."""
    domain = domain or {}
    op_kind = op.get("op")
    if op_kind in ("size_cell", "delete_buffer"):
        return op.get("instance") in set(domain.get("instances") or [])
    if op_kind == "insert_buffer":
        return op.get("net") in set(domain.get("nets") or [])
    return False


def _union_scoped_instances(request, edit_domains):
    """Every instance some step in `request` is legitimately allowed to touch.

    Per contributing step's own `contributionId`'s `edit_domains` entry —
    never a blanket union of every domain's raw `instances` list, since an
    `insert_buffer`'s new instance is legitimate by its *net*, not by
    already being a listed instance (see module docstring).
    """
    edit_domains = edit_domains or {}
    allowed = set()
    for step in request.get("steps") or []:
        op = step.get("op") or {}
        domain = edit_domains.get(step.get("contributionId"))
        if _domain_allows(domain, op):
            target = _op_target_instance(op)
            if target is not None:
                allowed.add(target)
    return allowed


# ---------------------------------------------------------------------------
# validate_plan / plan_invalid_count
# ---------------------------------------------------------------------------


def _decision_parts(decision):
    """`("keep"|"drop"|"revise"|<other>, "<target id>")`, or `(None, None)` if malformed."""
    if not isinstance(decision, str) or ":" not in decision:
        return None, None
    kind, _, target_id = decision.partition(":")
    if not target_id:
        return None, None
    return kind, target_id


def _collect_plan_problems(obj, facts):
    problems = []
    if not isinstance(obj, dict):
        return ["plan must be a JSON object"]

    facts = facts if isinstance(facts, dict) else {}
    considered = set(facts.get("considered") or [])
    conflicts_by_key = {
        conflict["key"]: conflict for conflict in (facts.get("conflicts") or []) if _hashable(conflict.get("key"))
    }
    base_state_id = facts.get("baseStateId")

    if obj.get("baseStateId") != base_state_id:
        problems.append(
            f"plan.baseStateId {obj.get('baseStateId')!r} != facts.baseStateId {base_state_id!r}"
        )

    batch_id = obj.get("batchId")
    if not isinstance(batch_id, str) or batch_id == "":
        problems.append(f"batchId must be a non-empty string, got {batch_id!r}")

    reason = obj.get("reason")
    if not isinstance(reason, str) or reason == "":
        problems.append(f"reason must be a non-empty string, got {reason!r}")

    select = obj.get("select")
    if not isinstance(select, list):
        problems.append(f"select must be a list, got {select!r}")
        select = []
    for contribution_id in select:
        if not _hashable(contribution_id) or contribution_id not in considered:
            problems.append(f"select id {contribution_id!r} is not in facts.considered")

    deferred = obj.get("deferred")
    if not isinstance(deferred, list):
        problems.append(f"deferred must be a list, got {deferred!r}")
        deferred = []
    for contribution_id in deferred:
        if not _hashable(contribution_id) or contribution_id not in considered:
            problems.append(f"deferred id {contribution_id!r} is not in facts.considered")

    resolutions = obj.get("resolutions")
    if not isinstance(resolutions, list):
        problems.append(f"resolutions must be a list, got {resolutions!r}")
        resolutions = []

    # Contradiction bookkeeping: two decisions naming DIFFERENT targets under the
    # same conflictKey are normal (a multi-member conflict is often resolved by
    # several complementary decisions, e.g. "revise:a" + "drop:b"). What is
    # contradictory is two *different kinds* for the *same* (conflictKey, target)
    # pair, or two different "keep" targets under the same conflictKey (each
    # "keep" implicitly excludes every other member, so two different "keep"
    # targets for one conflict cannot both hold).
    kinds_by_key_target = {}
    keep_targets_by_key = {}

    for resolution in resolutions:
        if not isinstance(resolution, dict):
            problems.append(f"resolution must be an object, got {resolution!r}")
            continue

        conflict_key = resolution.get("conflictKey")
        conflict = conflicts_by_key.get(conflict_key) if _hashable(conflict_key) else None
        if conflict is None:
            problems.append(f"resolution conflictKey {conflict_key!r} is not a current conflict key")

        decision = resolution.get("decision")
        kind, target_id = _decision_parts(decision)
        if kind is None:
            problems.append(f"resolution decision must be '<keep|drop|revise>:<id>', got {decision!r}")
            continue
        if kind not in ("keep", "drop", "revise"):
            problems.append(f"resolution decision kind must be keep/drop/revise, got {kind!r}")
            continue

        if conflict is not None and target_id not in (conflict.get("contributions") or []):
            problems.append(f"resolution target {target_id!r} is not a member of conflict {conflict_key!r}")

        if kind == "revise":
            revised_id = resolution.get("revisedContribution")
            if not _hashable(revised_id) or revised_id not in considered:
                problems.append(
                    f"revise:{target_id} revisedContribution {revised_id!r} is not in facts.considered"
                )

        if _hashable(conflict_key) and _hashable(target_id):
            kinds_by_key_target.setdefault((conflict_key, target_id), set()).add(kind)
            if kind == "keep":
                keep_targets_by_key.setdefault(conflict_key, set()).add(target_id)

    for (conflict_key, target_id), kinds in kinds_by_key_target.items():
        if len(kinds) > 1:
            problems.append(
                f"conflictKey {conflict_key!r} has contradictory resolutions for {target_id!r}: {sorted(kinds)}"
            )

    for conflict_key, keep_targets in keep_targets_by_key.items():
        if len(keep_targets) > 1:
            problems.append(
                f"conflictKey {conflict_key!r} has contradictory 'keep' targets: {sorted(keep_targets)}"
            )

    return problems


def validate_plan(obj, facts):
    """Validate `obj` as an `integration-plan` against `facts`; stamp and return it, or refuse it.

    Raises `AtcsError("invalid-plan", "<problem>; <problem>; ...")` listing
    every problem found (see module docstring's rules). Returns
    `core.stamp("integration-plan", obj)` when there are none.
    """
    problems = _collect_plan_problems(obj, facts)
    if problems:
        raise core.AtcsError("invalid-plan", "; ".join(problems))
    return core.stamp("integration-plan", obj)


def plan_invalid_count(obj, facts):
    """Count of `validate_plan` problems in `obj`; never raises for invalid content."""
    return len(_collect_plan_problems(obj, facts))


# ---------------------------------------------------------------------------
# prepare_replay
# ---------------------------------------------------------------------------


def _resolution_effects(plan, facts):
    """`(drop_ids, revise_map, keep_exclusions)` from `plan.resolutions`.

    Generic over conflict `kind` (controller decision) — `keep`/`drop`
    exclusion and `revise` substitution are computed purely from
    contribution ids and each named conflict's own `contributions` list,
    never from what kind of conflict it is.
    """
    conflicts_by_key = {conflict["key"]: conflict for conflict in (facts.get("conflicts") or [])}

    drop_ids = set()
    revise_map = {}
    keep_exclusions = set()
    for resolution in plan.get("resolutions") or []:
        kind, target_id = _decision_parts(resolution.get("decision"))
        if kind == "drop":
            drop_ids.add(target_id)
        elif kind == "revise":
            revise_map[target_id] = resolution.get("revisedContribution")
        elif kind == "keep":
            conflict = conflicts_by_key.get(resolution.get("conflictKey"))
            if conflict:
                keep_exclusions.update(cid for cid in conflict.get("contributions") or [] if cid != target_id)

    return drop_ids, revise_map, keep_exclusions


def _check_no_unresolved_conflict(select_ids, excluded_ids, facts):
    """Raise `AtcsError("unresolved-conflict", ...)` per the module docstring's rule."""
    remaining_selected = {cid for cid in select_ids if cid not in excluded_ids}
    for conflict in facts.get("conflicts") or []:
        members_remaining = sorted(cid for cid in conflict.get("contributions") or [] if cid in remaining_selected)
        if len(members_remaining) >= 2:
            raise core.AtcsError(
                "unresolved-conflict", f"conflict {conflict.get('key')} still selects {members_remaining}"
            )


def prepare_replay(plan, facts, contributions):
    """Build an idempotent `replay-request`: one step per operation, XTop Tcl per step.

    Raises `AtcsError`:
    - ``"identity-mismatch"`` — `plan.baseStateId != facts.baseStateId`.
    - ``"unresolved-conflict"`` — the selected set (after `drop`/`keep`
      exclusion and `deferred` removal) still names two or more members of
      some conflict.
    - ``"stale-base"`` — a directly-selected id's own contribution is
      sealed against a different base than `facts.baseStateId`.
    - ``"missing-input"`` — a selected, non-excluded id has no matching
      sealed contribution in `contributions`, or a `revise` resolution's
      `revisedContribution` is not a considered, correctly-based id.
    - ``"unsupported-op"`` — a selected op is `pg_local_adjust`.
    - ``"selected-without-steps"`` — a selected, non-excluded, non-deferred
      `fix`-kind contribution ends up credited with zero steps.
    - whatever `xtop_tcl` raises (`"unsafe-name"`, `"malformed-input"`,
      `"unknown-op"`) for any op it renders.

    See the module docstring for duplicate handling, ordering and the
    exact `stepId` rule.
    """
    base_state_id = facts.get("baseStateId")
    if plan.get("baseStateId") != base_state_id:
        raise core.AtcsError("identity-mismatch", "plan.baseStateId != facts.baseStateId")

    contributions_by_id = {contribution["id"]: contribution for contribution in contributions}
    considered = set(facts.get("considered") or [])

    drop_ids, revise_map, keep_exclusions = _resolution_effects(plan, facts)
    deferred_ids = set(plan.get("deferred") or [])
    excluded_ids = drop_ids | keep_exclusions | deferred_ids

    select_ids = list(dict.fromkeys(plan.get("select") or []))
    _check_no_unresolved_conflict(select_ids, excluded_ids, facts)

    selected_set = set(select_ids)

    def eligible(candidate_id):
        return candidate_id in selected_set and candidate_id not in excluded_ids

    group_by_member = {}
    for group in facts.get("duplicates") or []:
        for member in group.get("sources") or []:
            group_by_member[member] = group

    order = facts.get("order") or []
    ordered_selected = [cid for cid in order if cid in selected_set]
    leftover_selected = sorted(cid for cid in select_ids if cid not in order)
    replay_order = ordered_selected + leftover_selected

    def resolve_effective(working_id):
        if working_id in revise_map:
            revised_id = revise_map[working_id]
            if not _hashable(revised_id) or revised_id not in considered:
                raise core.AtcsError(
                    "missing-input",
                    f"revise:{working_id} revisedContribution {revised_id!r} is not in facts.considered",
                )
            effective = contributions_by_id.get(revised_id)
            if effective is None or effective.get("baseStateId") != base_state_id:
                raise core.AtcsError(
                    "missing-input", f"no valid sealed contribution supplied for revised id {revised_id!r}"
                )
            return effective

        effective = contributions_by_id.get(working_id)
        if effective is None:
            raise core.AtcsError("missing-input", f"no sealed contribution supplied for {working_id!r}")
        if effective.get("baseStateId") != base_state_id:
            raise core.AtcsError(
                "stale-base",
                f"contribution {working_id!r} baseStateId {effective.get('baseStateId')!r} "
                f"!= facts.baseStateId {base_state_id!r}",
            )
        return effective

    steps = []
    included_deltas = []
    represented_ids = set()
    processed_group_ids = set()

    for contribution_id in replay_order:
        if contribution_id in excluded_ids:
            continue

        group = group_by_member.get(contribution_id)
        if group is not None:
            group_key = id(group)
            if group_key in processed_group_ids:
                continue
            processed_group_ids.add(group_key)
            ordered_candidates = [group.get("keep")] + sorted(
                member for member in (group.get("dropped") or []) if member != group.get("keep")
            )
            representative = next((member for member in ordered_candidates if eligible(member)), None)
            if representative is None:
                continue  # no member of this group survives selection; nothing to replay
            credit_targets = [member for member in (group.get("sources") or []) if eligible(member)]
            working_id = representative
        else:
            credit_targets = [contribution_id]
            working_id = contribution_id

        effective = resolve_effective(working_id)
        operations = effective.get("operations") or []
        if operations:
            represented_ids.update(credit_targets)
        included_deltas.append(effective.get("delta"))
        effective_id = effective["id"]
        for op_index, op in enumerate(operations):
            if op.get("op") == "pg_local_adjust":
                raise core.AtcsError("unsupported-op", "pg_local_adjust is not replayed by XTop in M5")
            step_id = core.digest({"contributionId": effective_id, "opIndex": op_index})
            steps.append(
                {
                    "stepId": step_id,
                    "contributionId": effective_id,
                    "opIndex": op_index,
                    "op": op,
                    "xtopTcl": xtop_tcl(op),
                }
            )

    missing_fix_ids = sorted(
        contribution_id
        for contribution_id in select_ids
        if contribution_id not in excluded_ids
        and contribution_id not in represented_ids
        and (contributions_by_id.get(contribution_id) or {}).get("kind") == "fix"
    )
    if missing_fix_ids:
        raise core.AtcsError(
            "selected-without-steps", f"selected fix contribution(s) yielded no step: {missing_fix_ids}"
        )

    body = {
        "batchId": plan.get("batchId"),
        "baseStateId": base_state_id,
        "steps": steps,
        "expectedDelta": _merge_deltas(included_deltas),
        "droppedOrDeferredIds": sorted(drop_ids | deferred_ids),
    }
    return core.stamp("replay-request", body)


# ---------------------------------------------------------------------------
# pending_steps / reconcile
# ---------------------------------------------------------------------------


def pending_steps(request, receipts):
    """`stepId`s from `request.steps` with no receipt at all (any status counts as attempted)."""
    receipted_ids = {
        receipt.get("stepId") for receipt in (receipts or []) if isinstance(receipt, dict) and "stepId" in receipt
    }
    return [step["stepId"] for step in request.get("steps") or [] if step["stepId"] not in receipted_ids]


def reconcile(request, receipts, edit_domains):
    """Fold `receipts` into an `integration-state`. See module docstring for the per-step rule."""
    steps_by_id = {step["stepId"]: step for step in request.get("steps") or []}

    receipts_by_step = {}
    conflicting_step_ids = set()
    unknown_receipts = []
    for receipt in receipts or []:
        step_id = receipt.get("stepId") if isinstance(receipt, dict) else None
        if step_id not in steps_by_id:
            if step_id is not None:
                unknown_receipts.append(step_id)
            continue
        existing = receipts_by_step.get(step_id)
        if existing is None:
            receipts_by_step[step_id] = receipt
        elif existing != receipt:
            conflicting_step_ids.add(step_id)

    allowed_instances = _union_scoped_instances(request, edit_domains)

    applied = {}
    failed = []
    pending = []
    replay_mismatch = []
    out_of_scope = []
    applied_deltas = []

    for step_id, step in steps_by_id.items():
        if step_id in conflicting_step_ids:
            replay_mismatch.append(step_id)
            continue

        receipt = receipts_by_step.get(step_id)
        if receipt is None:
            pending.append(step_id)
            continue
        if receipt.get("status") != "ok":
            failed.append(step_id)
            continue

        observed_delta = _normalize_delta(receipt.get("observedDelta"))

        is_out_of_scope = not (_delta_instances(observed_delta) <= allowed_instances)
        if is_out_of_scope:
            out_of_scope.append(step_id)

        expected_delta = _op_expected_delta(step["op"])
        is_mismatch = observed_delta != expected_delta
        if is_mismatch:
            replay_mismatch.append(step_id)

        if not is_out_of_scope and not is_mismatch:
            applied[step_id] = observed_delta
            applied_deltas.append(observed_delta)

    body = {
        "batchId": request.get("batchId"),
        "applied": applied,
        "failed": sorted(failed),
        "pending": sorted(pending),
        "replayMismatch": sorted(set(replay_mismatch)),
        "outOfScope": sorted(out_of_scope),
        "unknownReceipts": sorted(set(unknown_receipts), key=str),
        "delta": _merge_deltas(applied_deltas),
    }
    return core.stamp("integration-state", body)


# ---------------------------------------------------------------------------
# seal_batch
# ---------------------------------------------------------------------------


def seal_batch(state, request, facts, contributions):
    """Seal one `merge-commit` from a fully-reconciled `integration-state`.

    Raises `AtcsError("identity-mismatch", ...)` when `state.batchId !=
    request.batchId`, `request.baseStateId != facts.baseStateId`, or the
    set of `state.applied` keys does not equal the set of `request.steps`'
    `stepId`s. Raises `AtcsError("integration-incomplete", ...)` when
    `state.pending`, `state.failed`, `state.replayMismatch`,
    `state.outOfScope` or `state.unknownReceipts` is non-empty — a batch
    with any of these is tentative, never a deliverable (architecture §8's
    step 10).
    """
    if state.get("batchId") != request.get("batchId"):
        raise core.AtcsError("identity-mismatch", "state.batchId != request.batchId")
    if request.get("baseStateId") != facts.get("baseStateId"):
        raise core.AtcsError("identity-mismatch", "request.baseStateId != facts.baseStateId")

    blocking = {
        "pending": state.get("pending") or [],
        "failed": state.get("failed") or [],
        "replayMismatch": state.get("replayMismatch") or [],
        "outOfScope": state.get("outOfScope") or [],
        "unknownReceipts": state.get("unknownReceipts") or [],
    }
    problems = [f"{name}={ids}" for name, ids in blocking.items() if ids]
    if problems:
        raise core.AtcsError("integration-incomplete", "; ".join(problems))

    applied = state.get("applied") or {}
    request_step_ids = {step["stepId"] for step in request.get("steps") or []}
    if set(applied.keys()) != request_step_ids:
        raise core.AtcsError("identity-mismatch", "state.applied keys != request step ids")

    contributions_by_id = {contribution["id"]: contribution for contribution in contributions}
    duplicate_group_by_source = {}
    for group in facts.get("duplicates") or []:
        for source_id in group.get("sources") or []:
            duplicate_group_by_source[source_id] = group

    not_credited = set(request.get("droppedOrDeferredIds") or [])

    ordered_steps = [step for step in request.get("steps") or [] if step["stepId"] in applied]

    operations = []
    source_map = {}
    new_nets = []
    for step in ordered_steps:
        op = step["op"]
        operations.append(op)

        op_key = core.digest({"op": op})
        contribution_id = step["contributionId"]
        group = duplicate_group_by_source.get(contribution_id)
        sources = group["sources"] if group else [contribution_id]
        merged_sources = set(source_map.get(op_key, [])) | set(sources)
        source_map[op_key] = sorted(merged_sources)

        if op.get("op") == "insert_buffer":
            new_net = op.get("newNet")
            if new_net is not None and new_net not in new_nets:
                new_nets.append(new_net)

    credited_ids = sorted({cid for sources in source_map.values() for cid in sources} - not_credited)
    contributions_list = []
    for contribution_id in credited_ids:
        contribution = contributions_by_id.get(contribution_id)
        if contribution is None:
            raise core.AtcsError("missing-input", f"no sealed contribution supplied for {contribution_id!r}")
        contributions_list.append({"id": contribution_id, "revision": contribution.get("revision")})

    body = {
        "parentStateId": facts.get("baseStateId"),
        "contributions": contributions_list,
        "operations": operations,
        "innovusEcoTcl": innovus_eco_tcl(operations),
        "sourceMap": source_map,
        "newNets": new_nets,
    }
    return core.stamp("merge-commit", body)
