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
  folds receipts into applied/failed/pending/replayMismatch/outOfScope.
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
are all the same base design-state id: `facts.baseStateId`. This module
never mixes that with a contribution's own possibly-stale
`baseStateId` — that comparison is exactly what the stale-base check below
exists for.

Resolutions are generic by conflict key (controller decision)
----------------------------------------------------------------

`integration-plan.resolutions` is `[{"conflictKey", "decision", ...}]` with
`decision` one of `"keep:<id>"`, `"drop:<id>"` or `"revise:<id>"`
(+ `"revisedContribution"` for `revise`). This module never branches on a
conflict's `kind` string — M4 may add or rename conflict kinds
independently, and every rule below is expressed purely in terms of
contribution ids and conflict membership:

- `"drop:<id>"` excludes `<id>` from replay entirely.
- `"keep:<id>"` excludes every *other* id listed in that resolution's own
  `conflictKey`'s `conflict["contributions"]` — whichever conflict kind
  that is.
- `"revise:<id>"` does not exclude `<id>`; it substitutes
  `revisedContribution`'s own operations (and identity) for `<id>`'s when
  building replay steps. It is not, by itself, treated as resolving a
  conflict's membership count (see `unresolved-conflict` below) — the
  revised contribution may or may not actually eliminate the underlying
  disagreement, and this module has no way to re-derive that without
  re-running M4's analysis, so a conflict a `revise` was meant to settle
  still needs an explicit `keep`/`drop` on its other member(s) to actually
  clear it.

`prepare_replay` raises `AtcsError("unresolved-conflict", ...)` when, after
applying only the `drop`/`keep` exclusions above to `plan.select`, any
conflict in `facts.conflicts` still has two or more of its own
`contributions` remaining in the selected set — regardless of that
conflict's `kind` and regardless of whether some `conflictKey` in
`plan.resolutions` merely *mentions* it (M4's own `unresolvedCount`, per
`atcs.composition`'s docstring, only checks that a resolution mentions the
key, not that it actually clears the collision; this module re-derives the
real answer from id membership instead of trusting that count).

Stale-base handling
--------------------

A selected id whose own sealed contribution's `baseStateId` does not equal
`facts.baseStateId` cannot be replayed as-is (comparing its `delta` against
this batch's other contributions would silently mix two different starting
points — see `atcs.composition`'s admission rule). `prepare_replay` accepts
it only when a `"revise:<id>"` resolution supplies a `revisedContribution`
that is itself `admissible` and sealed against `facts.baseStateId`;
otherwise it raises `AtcsError("stale-base", ...)`. This check runs after
drop/keep exclusion (an excluded stale contribution is simply never
replayed, so its staleness is moot) and does not require the stale id to
appear in `facts.order`/`facts.considered` — M4 excludes a stale-base
contribution from both, so this module's own defense here is the only
thing standing between a stale contribution and a corrupted replay.

Steps and ordering
--------------------

Every considered id in `facts.order` that is selected, not excluded and not
a duplicate-dropped id (see below) contributes one step per operation in
its (possibly revised) `operations` list, in that list's own order.
`stepId = core.digest({"contributionId": <the id whose operations these
are — the revised contribution's own id when substituted>, "opIndex":
<index>})`. A `select` id absent from `facts.order` (i.e. not
`considered` — only possible for a stale-base id being revised) is
processed after every ordered id, sorted by id, since M4 gives this
module no ordering information for it.

`pg_local_adjust` operations are never replayed here: `prepare_replay`
raises `AtcsError("unsupported-op", ...)` the moment one is selected — PG
changes go through the implementation step later (T11/T12), not M5's XTop
replay.

Duplicates from facts
------------------------

`facts.duplicates` is `[{"keep", "dropped": [...], "sources": [...]}]`
(identical whole `operations` lists). This module replays only the kept
id's operations — every id in some group's `dropped` list is skipped
entirely when building steps, whether or not it was itself selected, so an
identical fix is never replayed twice. `seal_batch`'s `sourceMap` then
attributes the kept id's ops to that whole group's `sources` (keep +
dropped), so the dropped contributions still show up as having proposed
this outcome even though they contributed no separate step.

Tcl safety
------------

Every string substituted into a Tcl command by `xtop_tcl`/`innovus_eco_tcl`
(instance, net, master, generated names, load pins) is checked non-empty
and free of whitespace and of `;`, `[`, `]`, `{`, `}`, `$`, `"` and newline
before being substituted; any violation is `AtcsError("unsafe-name", ...)`.
This is re-checked here rather than trusted from `atcs.contributions`'s own
shape validation, because these values are about to be embedded literally
in a script this Pack will actually run.

Receipts and reconciliation
------------------------------

`receipts` is `[{"stepId", "status": "ok"|"error", "observedDelta"}]`.
`pending_steps` treats a step as pending only when it has *no* receipt at
all (any receipt — `ok` or `error` — means it was attempted and is not
re-inserted, per §8.4). `reconcile` keeps the *first* receipt seen for a
given `stepId` (duplicate delivery of the same step's receipt is
idempotent) and, for each step:

1. No receipt -> `pending`.
2. `status != "ok"` -> `failed`.
3. `observedDelta` does not equal the op's own expected delta (the
   `delta`-shape restricted to that one op — `{"mastersChanged": {inst:
   [from, to]}}` for `size_cell`, `{"added": {inst: master}}` for
   `insert_buffer`, `{"removed": {inst: master}}` for `delete_buffer`,
   each with the other two keys empty) -> `replayMismatch`.
4. Every instance the observed delta touches is not a member of the union
   of `edit_domains`' `instances` (a list of `touches`/`editDomain`-shaped
   dicts the caller supplies — normally every contributing effective
   contribution's own `touches`) -> `outOfScope`.
5. Otherwise -> `applied[stepId] = observedDelta`.

An empty/omitted `edit_domains` is not treated as "no restriction" — with
nothing declared in scope, every observed touch is outside it, per this
Pack's fail-closed rule (never default-permit an undeclared scope).

`seal_batch` refuses (`AtcsError("integration-incomplete", ...)`) unless
`pending`, `failed`, `replayMismatch` and `outOfScope` are all empty —
tentative state is never mistaken for a deliverable (§8's step 10, "不得将
tentative 状态当交付物").

MergeCommit
-------------

`operations` is every applied step's op, in replay order. `sourceMap` maps
`opKey = core.digest({"op": op})` (the *canonical* op, so two contributions
proposing byte-identical ops always land on the same key even though they
are different Python dict instances) to the sorted set of every
contributing id — the applied contribution's own id, widened to that
whole duplicate group's `sources` when it was a kept duplicate.
`contributions` lists `{id, revision}` for exactly the ids that appear
somewhere in `sourceMap` (i.e. every id that actually produced or was
deduplicated into a replayed op) — a stale-base id superseded by
`revise` is not separately listed here; its lineage is already recorded on
the revised contribution's own `dependencies` field (`atcs.contributions`
is the module that owns dependency bookkeeping, not this one).
`newNets` is every `insert_buffer` op's `newNet`, in first-seen order.
`parentStateId` is `facts.baseStateId` per the state-id decision above.
"""
from __future__ import annotations

from . import core


_DELTA_KEYS = ("mastersChanged", "added", "removed")
_UNSAFE_TCL_CHARS = set(';[]{}$"\n')


# ---------------------------------------------------------------------------
# Tcl value safety and rendering
# ---------------------------------------------------------------------------


def _validate_tcl_value(value, label):
    """Return `value` unchanged, or raise `AtcsError("unsafe-name", ...)`.

    Every string this module substitutes into a Tcl command passes through
    here: non-empty, no whitespace, none of `;[]{}$"` or a newline.
    """
    if not isinstance(value, str) or value == "":
        raise core.AtcsError("unsafe-name", f"{label} must be a non-empty string, got {value!r}")
    if any(ch.isspace() for ch in value) or any(ch in _UNSAFE_TCL_CHARS for ch in value):
        raise core.AtcsError("unsafe-name", f"{label} contains an unsafe character: {value!r}")
    return value


def _tcl_list(values):
    return "{" + " ".join(values) + "}"


def _format_number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise core.AtcsError("unsafe-name", f"expected a finite number, got {value!r}")
    return str(value)


def xtop_tcl(op):
    """Render one `operation` as one line of documented XTop Tcl.

    Command spellings and flags come from ``knowledge/xtop-capabilities.md``
    (``size_cell``, ``insert_buffer -new_cell_names -new_net_names
    [-locations]``, ``remove_buffer``). Raises `AtcsError("unsafe-name",
    ...)` for any unsafe substituted value, `AtcsError("unsupported-op",
    ...)` for `pg_local_adjust` (M5 never replays PG changes in XTop — see
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
        location = op.get("location")
        if location is not None:
            x, y = location
            command += f" -locations {{{{{_format_number(x)} {_format_number(y)}}}}}"
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
        net = _validate_tcl_value(op.get("net"), "net")
        master = _validate_tcl_value(op.get("master"), "master")
        new_instance = _validate_tcl_value(op.get("newInstance"), "newInstance")
        new_net = _validate_tcl_value(op.get("newNet"), "newNet")
        return f"ecoAddRepeater -net {net} -cell {master} -name {new_instance} -newNetName {new_net}"

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
    -cell``, ``ecoAddRepeater -net -cell -name -newNetName``,
    ``ecoDeleteRepeater -inst``). Same error contract as `xtop_tcl`.
    """
    return "\n".join(_innovus_eco_line(op) for op in operations)


# ---------------------------------------------------------------------------
# Delta helpers
# ---------------------------------------------------------------------------


def _empty_delta():
    return {"mastersChanged": {}, "added": {}, "removed": {}}


def _merge_deltas(deltas):
    merged = _empty_delta()
    for delta in deltas:
        delta = delta or {}
        for key in _DELTA_KEYS:
            merged[key].update(delta.get(key) or {})
    return merged


def _op_expected_delta(op):
    """The `delta` shape a single op implies, restricted to that op alone."""
    op_kind = op.get("op")
    if op_kind == "size_cell":
        return {"mastersChanged": {op["instance"]: [op["fromMaster"], op["toMaster"]]}, "added": {}, "removed": {}}
    if op_kind == "insert_buffer":
        return {"mastersChanged": {}, "added": {op["newInstance"]: op["master"]}, "removed": {}}
    if op_kind == "delete_buffer":
        return {"mastersChanged": {}, "added": {}, "removed": {op["instance"]: op["master"]}}
    return _empty_delta()


def _delta_instances(delta):
    delta = delta or {}
    instances = set((delta.get("mastersChanged") or {}).keys())
    instances.update((delta.get("added") or {}).keys())
    instances.update((delta.get("removed") or {}).keys())
    return instances


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
    conflict_keys = {conflict["key"] for conflict in (facts.get("conflicts") or [])}
    base_state_id = facts.get("baseStateId")

    if obj.get("baseStateId") != base_state_id:
        problems.append(
            f"plan.baseStateId {obj.get('baseStateId')!r} != facts.baseStateId {base_state_id!r}"
        )

    select = obj.get("select")
    if not isinstance(select, list):
        problems.append(f"select must be a list, got {select!r}")
        select = []
    for contribution_id in select:
        if contribution_id not in considered:
            problems.append(f"select id {contribution_id!r} is not in facts.considered")

    resolutions = obj.get("resolutions")
    if not isinstance(resolutions, list):
        problems.append(f"resolutions must be a list, got {resolutions!r}")
        resolutions = []
    for resolution in resolutions:
        if not isinstance(resolution, dict):
            problems.append(f"resolution must be an object, got {resolution!r}")
            continue

        conflict_key = resolution.get("conflictKey")
        if conflict_key not in conflict_keys:
            problems.append(f"resolution conflictKey {conflict_key!r} is not a current conflict key")

        kind, target_id = _decision_parts(resolution.get("decision"))
        if kind is None:
            problems.append(f"resolution decision must be '<keep|drop|revise>:<id>', got {resolution.get('decision')!r}")
            continue
        if kind not in ("keep", "drop", "revise"):
            problems.append(f"resolution decision kind must be keep/drop/revise, got {kind!r}")
            continue

        if kind == "revise":
            revised = resolution.get("revisedContribution")
            if not isinstance(revised, dict):
                problems.append(f"revise:{target_id} requires a revisedContribution object")
            else:
                if not revised.get("admissible"):
                    problems.append(f"revise:{target_id} revisedContribution is not admissible")
                if revised.get("baseStateId") != base_state_id:
                    problems.append(
                        f"revise:{target_id} revisedContribution.baseStateId "
                        f"{revised.get('baseStateId')!r} != plan.baseStateId {base_state_id!r}"
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


def _check_no_unresolved_conflict(select_ids, drop_ids, keep_exclusions, facts):
    """Raise `AtcsError("unresolved-conflict", ...)` per the module docstring's rule.

    A conflict is unresolved when, after only `drop`/`keep` exclusion
    (never `revise` substitution — see module docstring), two or more of
    its own `contributions` remain in the selected set.
    """
    excluded = drop_ids | keep_exclusions
    remaining_selected = {cid for cid in select_ids if cid not in excluded}
    for conflict in facts.get("conflicts") or []:
        members_remaining = sorted(cid for cid in conflict.get("contributions") or [] if cid in remaining_selected)
        if len(members_remaining) >= 2:
            raise core.AtcsError(
                "unresolved-conflict",
                f"conflict {conflict.get('key')} still selects {members_remaining}",
            )


def prepare_replay(plan, facts, contributions):
    """Build an idempotent `replay-request`: one step per operation, XTop Tcl per step.

    Raises `AtcsError`:
    - ``"unresolved-conflict"`` — the selected set (after `drop`/`keep`
      exclusion) still names two or more members of some conflict.
    - ``"stale-base"`` — a selected, non-excluded id's own contribution is
      sealed against a different base than `facts.baseStateId`, and no
      admissible, correctly-based `revise:<id>` resolution covers it.
    - ``"unsupported-op"`` — a selected op is `pg_local_adjust`.
    - ``"missing-input"`` — a selected, non-excluded id has no matching
      sealed contribution in `contributions`.
    - whatever `xtop_tcl` raises (`"unsafe-name"`, `"unknown-op"`) for any
      op it renders.

    See the module docstring for duplicate handling, ordering and the
    exact `stepId` rule.
    """
    base_state_id = facts.get("baseStateId")
    contributions_by_id = {contribution["id"]: contribution for contribution in contributions}

    drop_ids, revise_map, keep_exclusions = _resolution_effects(plan, facts)

    select_ids = list(dict.fromkeys(plan.get("select") or []))
    _check_no_unresolved_conflict(select_ids, drop_ids, keep_exclusions, facts)

    duplicate_dropped_ids = set()
    for group in facts.get("duplicates") or []:
        duplicate_dropped_ids.update(group.get("dropped") or [])

    order = facts.get("order") or []
    ordered_selected = [cid for cid in order if cid in select_ids]
    leftover_selected = sorted(cid for cid in select_ids if cid not in order)
    replay_order = ordered_selected + leftover_selected

    excluded_ids = drop_ids | keep_exclusions | duplicate_dropped_ids

    steps = []
    included_deltas = []
    for contribution_id in replay_order:
        if contribution_id in excluded_ids:
            continue

        effective = contributions_by_id.get(contribution_id)
        if contribution_id in revise_map:
            revised = revise_map[contribution_id]
            if not isinstance(revised, dict) or not revised.get("admissible") or revised.get("baseStateId") != base_state_id:
                raise core.AtcsError(
                    "stale-base",
                    f"revised contribution for {contribution_id!r} does not resolve staleness",
                )
            effective = revised
        else:
            if effective is None:
                raise core.AtcsError("missing-input", f"no sealed contribution supplied for {contribution_id!r}")
            if effective.get("baseStateId") != base_state_id:
                raise core.AtcsError(
                    "stale-base",
                    f"contribution {contribution_id!r} baseStateId {effective.get('baseStateId')!r} "
                    f"!= facts.baseStateId {base_state_id!r}",
                )

        included_deltas.append(effective.get("delta"))
        effective_id = effective["id"]
        for op_index, op in enumerate(effective.get("operations") or []):
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

    body = {
        "batchId": plan.get("batchId"),
        "baseStateId": base_state_id,
        "steps": steps,
        "expectedDelta": _merge_deltas(included_deltas),
    }
    return core.stamp("replay-request", body)


# ---------------------------------------------------------------------------
# pending_steps / reconcile
# ---------------------------------------------------------------------------


def pending_steps(request, receipts):
    """`stepId`s from `request.steps` with no receipt at all (any status counts as attempted)."""
    receipted_ids = {receipt.get("stepId") for receipt in (receipts or []) if isinstance(receipt, dict)}
    return [step["stepId"] for step in request.get("steps") or [] if step["stepId"] not in receipted_ids]


def reconcile(request, receipts, edit_domains):
    """Fold `receipts` into an `integration-state`. See module docstring for the per-step rule."""
    steps_by_id = {step["stepId"]: step for step in request.get("steps") or []}

    receipts_by_step = {}
    for receipt in receipts or []:
        step_id = receipt.get("stepId") if isinstance(receipt, dict) else None
        if step_id not in steps_by_id:
            continue
        receipts_by_step.setdefault(step_id, receipt)

    union_instances = set()
    for domain in edit_domains or []:
        union_instances.update((domain or {}).get("instances") or [])

    applied = {}
    failed = []
    pending = []
    replay_mismatch = []
    out_of_scope = []
    applied_deltas = []

    for step_id, step in steps_by_id.items():
        receipt = receipts_by_step.get(step_id)
        if receipt is None:
            pending.append(step_id)
            continue
        if receipt.get("status") != "ok":
            failed.append(step_id)
            continue

        observed_delta = receipt.get("observedDelta") or {}
        expected_delta = _op_expected_delta(step["op"])
        if observed_delta != expected_delta:
            replay_mismatch.append(step_id)
            continue
        if not _delta_instances(observed_delta) <= union_instances:
            out_of_scope.append(step_id)
            continue

        applied[step_id] = observed_delta
        applied_deltas.append(observed_delta)

    body = {
        "batchId": request.get("batchId"),
        "applied": applied,
        "failed": sorted(failed),
        "pending": sorted(pending),
        "replayMismatch": sorted(replay_mismatch),
        "outOfScope": sorted(out_of_scope),
        "delta": _merge_deltas(applied_deltas),
    }
    return core.stamp("integration-state", body)


# ---------------------------------------------------------------------------
# seal_batch
# ---------------------------------------------------------------------------


def seal_batch(state, request, facts, contributions):
    """Seal one `merge-commit` from a fully-reconciled `integration-state`.

    Raises `AtcsError("integration-incomplete", ...)` when `state.pending`,
    `state.failed`, `state.replayMismatch` or `state.outOfScope` is
    non-empty — a batch with any of these is tentative, never a
    deliverable (architecture §8's step 10).
    """
    blocking = {
        "pending": state.get("pending") or [],
        "failed": state.get("failed") or [],
        "replayMismatch": state.get("replayMismatch") or [],
        "outOfScope": state.get("outOfScope") or [],
    }
    problems = [f"{name}={ids}" for name, ids in blocking.items() if ids]
    if problems:
        raise core.AtcsError("integration-incomplete", "; ".join(problems))

    contributions_by_id = {contribution["id"]: contribution for contribution in contributions}
    duplicate_group_by_source = {}
    for group in facts.get("duplicates") or []:
        for source_id in group.get("sources") or []:
            duplicate_group_by_source[source_id] = group

    applied_ids = state.get("applied") or {}
    ordered_steps = [step for step in request.get("steps") or [] if step["stepId"] in applied_ids]

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

    contribution_ids = sorted({cid for sources in source_map.values() for cid in sources})
    contributions_list = []
    for contribution_id in contribution_ids:
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
