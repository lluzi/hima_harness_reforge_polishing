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

Issue #64 Task 6 adds the recipe replay (see the "Recipe replay" section at the
end of this module): `prepare_recipe_replay` (Task 4b's ranked recipe ->
``"mode": "recipe"`` `replay-request`), `parse_gba_summary` (XTop's per-scenario
`summarize_gba_violations` table), `eco_text_problems`, `reconcile_recipe` (arm
safety and the merged-vs-control choice) and `seal_batch`'s recipe branch (the
chosen ECO pair, both arms' predictions, the choice, per-session applied/skipped
lists and deltas). The legacy step replay below is unchanged.

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
resolutions: the **same contribution id** receiving two different decision
kinds anywhere in the plan — whether under the same `conflictKey` or two
different ones (e.g. `"keep:c1"` under one conflict and `"drop:c1"` under
another is exactly as contradictory as both under the same key) — or two
different `keep` targets under the same `conflictKey` (each `keep`
implicitly excludes every other member, so two different `keep` targets
for one conflict can never both hold). Two resolutions naming *different*
targets under the same `conflictKey` (e.g. `"revise:a"` alongside
`"drop:b"` for a three-member conflict) are not contradictory — they are
the normal way a multi-member conflict gets resolved piece by piece.
`validate_plan` also rejects a `revisedContribution` that is itself
directly `select`ed, `deferred`, the target of a `drop`, or the substitute
for more than one `revise` target — any of those would let the same
considered contribution's operations enter the replay under two different
identities or positions (see `prepare_replay`'s `"duplicate-step"` defense
below, which catches the same problem at replay time as a last resort).

`prepare_replay` raises `AtcsError("unresolved-conflict", ...)` when, after
applying only `drop`/`keep` exclusion and `deferred` removal (never
`revise`'s own *exclusion* effect — see below) to `plan.select`, any
conflict in `facts.conflicts` still has two or more of its own
`contributions` remaining in the selected set — regardless of that
conflict's `kind`, and regardless of whether some `conflictKey` in
`plan.resolutions` merely *mentions* it (M4's own `unresolvedCount`, per
`atcs.composition`'s docstring, only checks that a resolution mentions the
key, not that it actually clears the collision; this module re-derives
the real answer from id membership instead of trusting that count).
**Critically**, membership is checked against each surviving id's
*effective* identity — `revise_map.get(id, id)` — not the raw selected id:
a `revise:<id>` substitution changes what actually replays in that slot,
so if the *revised* contribution is itself a member of some other,
unaddressed conflict (one M4 found between it and a third contribution
that was never revised, dropped or kept-against), that conflict must still
block the batch even though the revised id was never itself listed in
`plan.select` — checking only the raw selected ids would silently miss it.

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
straight to `replayMismatch`. A receipt that is not a JSON object, lacks a
`stepId`, or whose `stepId` is not a string (so it could never be one this
request actually issued) is counted into `unknownReceipts` by its own
`repr()`, never raised over; a receipt with a well-formed but unrecognized
`stepId` is counted there by that plain string instead. `observedDelta` is
normalized (missing `mastersChanged`/`added`/`removed` keys filled with
`{}`) before any comparison. For every step with a single, known receipt:

1. `status != "ok"` -> `failed`.
2. Every instance the (normalized) observed delta touches is checked
   against the union, over every step in the request, of that step's own
   `contributionId`'s ``edit_domains`` entry: the *whole* declared
   `editDomain.instances` of every replayed contribution, plus every
   trace-created (`insert_buffer`) instance whose own op is in scope by
   its net being a member of `editDomain.nets` — the same rule
   `atcs.contributions._scope_check` applies at seal time, but read as a
   whole-domain grant rather than only the specific instances an op
   happened to name, since `editDomain` is a work package's *authorized*
   scope, not a log of what it touched. Any observed instance outside
   that union -> `outOfScope`. This check runs **before** the equality
   check below and independently of it, so an observed delta that is "the
   expected change plus one extra instance" is flagged as *both*
   `outOfScope` and `replayMismatch`.
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
in `sourceMap`, **except** an id the plan itself `drop`ped, `deferred`, or
excluded as the *losing* side of a `keep` decision
(`request.excludedFromCreditIds`, recorded by `prepare_replay` as the union
of `drop` targets, `keep`-losers and `deferred` ids) — a duplicate source
the workshop explicitly excluded from this batch, whichever mechanism did
the excluding, is not credited as part of it merely because a *different*
group member happened to carry an identical op. `newNets` is every
`insert_buffer` op's `newNet`, in first-seen order. `parentStateId` is
`facts.baseStateId` per the state-id decision above.
"""
from __future__ import annotations

import fnmatch
import math
import re

from . import contributions
from . import core


_DELTA_KEYS = ("mastersChanged", "added", "removed")
# Final review (mechanical dedupe): re-exported from `atcs.core`, the one shared
# source (`atcs.adapters._UNSAFE_TCL_CHARS` re-exports the same set, backslash included).
_UNSAFE_TCL_CHARS = core.UNSAFE_TCL_CHARS


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


def _validate_tcl_value(value, label, allow_brackets=False):
    """Return `value` unchanged, or raise `AtcsError("unsafe-name", ...)`.

    Every string this module substitutes into a Tcl command passes through
    here: non-empty, no whitespace, no control character, none of `;[]{}$"\\`
    or a newline, and not starting with `-` (which would let it be read as a
    flag rather than the literal value it is).

    I7 (final review, bus-bit-safe names): `allow_brackets=True` admits `[`/`]`
    (`core.UNSAFE_TCL_CHARS_IN_BRACES`) -- every call site in this module that
    passes it also wraps the returned value in `_tcl_list([...])` (or joins it
    into one already inside such a list) before embedding it, so a real
    bus-bit instance/pin/net name (`bus[3]`, `U/A[2]`) is never refused just
    for looking like one.
    """
    if not isinstance(value, str) or value == "":
        raise core.AtcsError("unsafe-name", f"{label} must be a non-empty string, got {value!r}")
    if value.startswith("-"):
        raise core.AtcsError("unsafe-name", f"{label} must not start with '-': {value!r}")
    if core.is_tcl_unsafe(value, allow_brackets=allow_brackets):
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
        # I7 (final review): every substituted value here is wrapped in `_tcl_list`
        # below, so a bus-bit name is safe (`allow_brackets=True`).
        instance = _validate_tcl_value(op.get("instance"), "instance", allow_brackets=True)
        to_master = _validate_tcl_value(op.get("toMaster"), "master", allow_brackets=True)
        return f"size_cell {_tcl_list([instance])} {_tcl_list([to_master])}"

    if op_kind == "insert_buffer":
        load_pins = [_validate_tcl_value(pin, "loadPins entry", allow_brackets=True) for pin in (op.get("loadPins") or [])]
        master = _validate_tcl_value(op.get("master"), "master", allow_brackets=True)
        new_instance = _validate_tcl_value(op.get("newInstance"), "newInstance", allow_brackets=True)
        new_net = _validate_tcl_value(op.get("newNet"), "newNet", allow_brackets=True)
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
        instance = _validate_tcl_value(op.get("instance"), "instance", allow_brackets=True)
        return f"remove_buffer {_tcl_list([instance])}"

    if op_kind == "pg_local_adjust":
        raise core.AtcsError("unsupported-op", "pg_local_adjust is not replayed by XTop in M5")

    raise core.AtcsError("unknown-op", f"unrecognized op kind {op_kind!r}")


def _innovus_eco_line(op):
    op_kind = op.get("op")
    if op_kind == "size_cell":
        # I7 (final review): every substituted value here is wrapped in `_tcl_list`
        # below, so a bus-bit name is safe (`allow_brackets=True`).
        instance = _validate_tcl_value(op.get("instance"), "instance", allow_brackets=True)
        to_master = _validate_tcl_value(op.get("toMaster"), "master", allow_brackets=True)
        return f"ecoChangeCell -inst {_tcl_list([instance])} -cell {_tcl_list([to_master])}"

    if op_kind == "insert_buffer":
        load_pins = [_validate_tcl_value(pin, "loadPins entry", allow_brackets=True) for pin in (op.get("loadPins") or [])]
        if not load_pins:
            raise core.AtcsError("malformed-input", "insert_buffer op has no loadPins")
        master = _validate_tcl_value(op.get("master"), "master", allow_brackets=True)
        new_instance = _validate_tcl_value(op.get("newInstance"), "newInstance", allow_brackets=True)
        new_net = _validate_tcl_value(op.get("newNet"), "newNet", allow_brackets=True)
        # I7: each load pin is its own brace group (`-term {p1} {p2}`), not a bare,
        # space-joined token list -- a bus-bit pin name (`U/A[2]`) used to be silently
        # unreachable (rejected by `_validate_tcl_value` before this point) and, if the
        # check had merely been dropped instead of fixed, a bare `-term U/A[2]` would
        # have let Tcl attempt command substitution on `[2]` when Innovus later
        # evaluates this generated Tcl text.
        command = (
            f"ecoAddRepeater -term {' '.join(_tcl_list([pin]) for pin in load_pins)} "
            f"-cell {_tcl_list([master])} -name {_tcl_list([new_instance])} -newNetName {_tcl_list([new_net])}"
        )
        formatted_location = _validate_location(op.get("location"))
        if formatted_location is not None:
            x, y = formatted_location
            command += f" -loc {{{x} {y}}}"
        return command

    if op_kind == "delete_buffer":
        instance = _validate_tcl_value(op.get("instance"), "instance", allow_brackets=True)
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
    """Every instance legitimately in scope for `request`: the *whole* declared
    `editDomain.instances` of each replayed contribution, unioned with every
    trace-created (`insert_buffer`) instance whose own op is in scope by net.

    This is deliberately broader than "only the instances some op happened to
    target": `edit_domains[contributionId]` is that contribution's whole work
    package's authorized scope, not a log of what it touched, so an
    unexpected-but-still-authorized side effect (e.g. a legalization move
    landing on a different pre-existing instance the same work package was
    allowed to touch) is in scope too. A trace-created instance is the one
    exception — it never appears in a pre-existing `editDomain.instances`
    list by definition, so it can only earn scope through its own op's net
    membership (`atcs.contributions._scope_check`'s rule, mirrored here).
    """
    edit_domains = edit_domains or {}
    allowed = set()

    contribution_ids = {step.get("contributionId") for step in request.get("steps") or []}
    for contribution_id in contribution_ids:
        domain = edit_domains.get(contribution_id) or {}
        allowed.update(domain.get("instances") or [])

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
    select_set = {contribution_id for contribution_id in select if _hashable(contribution_id)}

    deferred = obj.get("deferred")
    if not isinstance(deferred, list):
        problems.append(f"deferred must be a list, got {deferred!r}")
        deferred = []
    for contribution_id in deferred:
        if not _hashable(contribution_id) or contribution_id not in considered:
            problems.append(f"deferred id {contribution_id!r} is not in facts.considered")
    deferred_set = {contribution_id for contribution_id in deferred if _hashable(contribution_id)}

    resolutions = obj.get("resolutions")
    if not isinstance(resolutions, list):
        problems.append(f"resolutions must be a list, got {resolutions!r}")
        resolutions = []

    # First pass: per-resolution structural checks, plus collect (conflictKey, kind,
    # targetId, resolution) tuples for the cross-resolution checks below — those need
    # every `drop` target gathered first, so they cannot run inline in this loop.
    parsed = []
    drop_targets = set()
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

        if kind == "drop" and _hashable(target_id):
            drop_targets.add(target_id)

        parsed.append((conflict_key, kind, target_id, resolution))

    # Second pass: `revise`-specific checks. A `revisedContribution` must be a
    # considered id that is not itself part of this same batch any other way
    # (directly selected, deferred, or dropped), not the substitute for more
    # than one target, and a given target must not itself receive more than one
    # *distinct* `revisedContribution` (two different resolutions both saying
    # "revise:c1" but naming different substitutes is unresolvable — which one
    # would actually replay?) — any of these would let the same considered
    # contribution's operations enter the replay under two different
    # identities/positions, which is exactly what `prepare_replay`'s
    # "duplicate-step" defense also guards against at replay time.
    revise_target_counts = {}
    revised_ids_by_target = {}
    for conflict_key, kind, target_id, resolution in parsed:
        if kind != "revise":
            continue
        revised_id = resolution.get("revisedContribution")
        if _hashable(target_id) and _hashable(revised_id):
            revised_ids_by_target.setdefault(target_id, set()).add(revised_id)
        if not _hashable(revised_id) or revised_id not in considered:
            problems.append(f"revise:{target_id} revisedContribution {revised_id!r} is not in facts.considered")
            continue
        if revised_id in select_set:
            problems.append(
                f"revisedContribution {revised_id!r} (revise:{target_id}) must not also be directly selected"
            )
        if revised_id in deferred_set:
            problems.append(f"revisedContribution {revised_id!r} (revise:{target_id}) must not also be deferred")
        if revised_id in drop_targets:
            problems.append(
                f"revisedContribution {revised_id!r} (revise:{target_id}) must not also be a drop target"
            )
        revise_target_counts[revised_id] = revise_target_counts.get(revised_id, 0) + 1

    for revised_id, count in revise_target_counts.items():
        if count > 1:
            problems.append(f"revisedContribution {revised_id!r} is the target of {count} revise resolutions")

    for target_id, revised_ids in revised_ids_by_target.items():
        if len(revised_ids) > 1:
            problems.append(
                f"revise:{target_id} has {len(revised_ids)} distinct revisedContribution values: "
                f"{sorted(revised_ids)}"
            )

    # Third pass: contradiction checks.
    # - `kinds_by_target` is deliberately keyed by target id *alone* (not by
    #   (conflictKey, target)): the same contribution id getting a `keep` under
    #   one conflictKey and a `drop` under a different one is exactly as
    #   contradictory as getting both under the same key.
    # - `keep_targets_by_key` stays scoped to one conflictKey: two different
    #   `keep` targets under the *same* conflict cannot both hold (each `keep`
    #   implicitly excludes every other member of that conflict), but two
    #   different targets each with their own *different* decision under the
    #   same conflictKey (e.g. `"revise:a"` + `"drop:b"`) is the normal way a
    #   multi-member conflict is resolved piece by piece, not a contradiction.
    kinds_by_target = {}
    keep_targets_by_key = {}
    for conflict_key, kind, target_id, resolution in parsed:
        if _hashable(target_id):
            kinds_by_target.setdefault(target_id, set()).add(kind)
            if kind == "keep" and _hashable(conflict_key):
                keep_targets_by_key.setdefault(conflict_key, set()).add(target_id)

    for target_id, kinds in kinds_by_target.items():
        if len(kinds) > 1:
            problems.append(f"contribution {target_id!r} has contradictory decisions: {sorted(kinds)}")

    for conflict_key, keep_targets in keep_targets_by_key.items():
        if len(keep_targets) > 1:
            problems.append(
                f"conflictKey {conflict_key!r} has contradictory 'keep' targets: {sorted(keep_targets)}"
            )

    # Fourth pass: the same post-substitution unresolved-conflict check
    # `prepare_replay` itself would apply (via `_check_no_unresolved_conflict` —
    # shared, not duplicated, so the two can never silently drift apart). A plan
    # `prepare_replay` would refuse is therefore already counted invalid here,
    # with the conflict key named in the problem text.
    drop_ids, revise_map, keep_exclusions = _resolution_effects(obj, facts)
    excluded_ids_for_conflict_check = drop_ids | keep_exclusions | deferred_set
    try:
        _check_no_unresolved_conflict(select, excluded_ids_for_conflict_check, revise_map, facts)
    except core.AtcsError as exc:
        problems.append(f"plan leaves a conflict unresolved after substitution: {exc.detail}")

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
    never from what kind of conflict it is. Tolerant of a malformed
    `plan.resolutions` (not a list, or containing a non-object entry) —
    such an entry is simply skipped here, since `_collect_plan_problems`
    is what reports it as a real structural problem; this function is also
    reused from `plan_invalid_count`'s never-raises path (via the shared
    unresolved-conflict check), so it must not raise on untrusted input.
    """
    conflicts_by_key = {conflict["key"]: conflict for conflict in (facts.get("conflicts") or [])}

    resolutions = plan.get("resolutions")
    if not isinstance(resolutions, list):
        resolutions = []

    drop_ids = set()
    revise_map = {}
    keep_exclusions = set()
    for resolution in resolutions:
        if not isinstance(resolution, dict):
            continue
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


def _check_no_unresolved_conflict(select_ids, excluded_ids, revise_map, facts):
    """Raise `AtcsError("unresolved-conflict", ...)` per the module docstring's rule.

    Critical fix: membership is checked against the *effective* identity of
    each surviving selected id — `revise_map.get(cid, cid)` — not the raw
    selected id. A `revise:<id>` substitution changes what actually gets
    replayed in that slot, so a conflict the *revised* contribution is a
    member of (even one M4 discovered between the revised id and some other
    contribution that was never itself revised or excluded) must still block
    an unresolved batch — the original `revise:<id>` target's own conflicts
    are, conversely, no longer relevant once its slot no longer replays its
    own operations.

    Also used from `validate_plan`/`plan_invalid_count` (shared, not
    duplicated) against untrusted plan content, so `select_ids` may contain
    an unhashable entry — such an entry can never legitimately match a
    conflict's `contributions` list anyway, so it is skipped rather than
    raising `TypeError` out of a function `plan_invalid_count` promises
    never to raise from.
    """
    effective_selected = set()
    for cid in select_ids:
        if not _hashable(cid) or cid in excluded_ids:
            continue
        mapped = revise_map.get(cid, cid)
        effective_selected.add(mapped if _hashable(mapped) else cid)

    for conflict in facts.get("conflicts") or []:
        members_remaining = sorted(
            cid for cid in conflict.get("contributions") or [] if cid in effective_selected
        )
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
    - ``"duplicate-step"`` — the same `stepId` would be generated twice (a
      defensive check `validate_plan`'s own `revisedContribution`-uniqueness
      rule is meant to prevent upstream; this is the belt to that suspender).
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
    _check_no_unresolved_conflict(select_ids, excluded_ids, revise_map, facts)

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
    seen_step_ids = set()

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
            if step_id in seen_step_ids:
                raise core.AtcsError(
                    "duplicate-step",
                    f"stepId {step_id!r} (contributionId {effective_id!r}, opIndex {op_index}) "
                    f"was generated more than once",
                )
            seen_step_ids.add(step_id)
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
        "excludedFromCreditIds": sorted(drop_ids | keep_exclusions | deferred_ids),
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
        if not isinstance(receipt, dict):
            unknown_receipts.append(repr(receipt))
            continue
        step_id = receipt.get("stepId")
        if not isinstance(step_id, str):
            # Missing `stepId`, or one that is not a string (e.g. an int, or an
            # unhashable value like a list) — never a real `stepId` this request
            # could have issued, so it is counted by the whole receipt's repr
            # rather than risking an unhashable dict/set lookup on `step_id` itself.
            unknown_receipts.append(repr(receipt))
            continue
        if step_id not in steps_by_id:
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
        "unknownReceipts": sorted(set(unknown_receipts)),
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
    if state.get("mode") == "recipe" or request.get("mode") == "recipe":
        return _seal_recipe_batch(state, request, facts, contributions)
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

    not_credited = set(request.get("excludedFromCreditIds") or [])

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


# ---------------------------------------------------------------------------
# Recipe replay (Issue #64 Task 6): the generation's one XTop replay
# ---------------------------------------------------------------------------
#
# A `replay-request` with ``"mode": "recipe"`` replays Task 4b's ranked recipe
# (`composition-facts.recipe`, notes/t4b-recipe.md) in two XTop processes started
# together from the same base (`templates/xtop-replay.tcl`, one run per arm):
#
# - **merged**: `000.dump`; per ranked session, in rank order, its commands through
#   the worker toolkit's own `atcs_*` procedures, each session confined to its own
#   edit domain, `namePrefix` and plan hash as its worker session had them, then
#   `NNN.dump`; `set_dont_touch` on every
#   instance the applied commands changed; if `autoFinish`, the plain auto-fix
#   sequence (`auto_fix_tcl`); `auto.dump`; final `summarize_gba_violations` per check;
#   `write_design_changes ... -output_dir eco -keep_route`.
# - **control**: `000.dump`; the same plain auto-fix (`auto_fix_tcl`) alone;
#   `auto.dump`; the same summaries; `write_design_changes ... -output_dir
#   eco-control -keep_route`.
#
# Replay is best effort (user amendment 2026-09-28): a command the recipe marks
# `skip`, or one that errors or that the toolkit refuses, is recorded as skipped
# with its reason and the replay continues. `reconcile_recipe` then refuses an
# unsafe arm (incomplete run, tainted toolkit session, out-of-domain replay change,
# no single ECO pair, or a `FORMATVERSION`/`dbNetFreeWires`/`editDelete -net`
# line), and keeps merged only when its XTop prediction is no worse than control's
# on both worst WNS -- so the refreshed batch is never worse than plain auto-fix by
# XTop's own estimate. PrimeTime after
# the refresh stays the only convergence judge.

RECIPE_PROCS = {
    "atcs_size_cell": ("instance", "toMaster", "planSha256"),
    "atcs_exchange_cell": ("instance", "cells", "planSha256"),
    "atcs_insert_buffer": ("net", "loadPins", "masters", "newInstances", "newNets", "planSha256"),
    "atcs_insert_dummy": ("pin", "master", "newInstance", "planSha256"),
    "atcs_split_load": ("net", "pinGroups", "master", "newInstances", "newNets", "planSha256"),
    "atcs_split_net": ("net", "master", "rule", "segments", "planSha256"),
    "atcs_move_cell": ("instance", "x", "y", "planSha256"),
    "atcs_remove_buffer": ("instance", "planSha256"),
    "atcs_fix_hold_pins": ("pins", "effort", "holdTarget", "setupMargin", "sizeCellOnly", "useDummyCell",
                           "fixTimingWindow", "maxClusterLoaderCount", "maxDelayCellLength", "delayCellList",
                           "planSha256"),
    "atcs_fix_setup_pins": ("pins", "methods", "removeBufferOnly", "sizeDownOnly", "effort", "setupTarget",
                            "holdMargin", "planSha256"),
}
"""Toolkit mutation procedures a recipe command may name, with their positional argument
names (`contract.yml` `interactive.arguments`, which a test checks). `atcs_undo` is absent:
a recipe is a net kept log, so an undo never replays."""

DEFAULT_SETUP_MARGIN = 0.02
DEFAULT_HOLD_MARGIN = 0.02
MARGIN_LIMIT = 0.2
"""Qualified margins of the old serial flow (`packs/xtop-timing-closure/knowledge/source-flow.md`
Sec.7.3), bounded like its fix plans (`closure.py` `validate_plan`: -0.2..0.2 ns)."""

FAIL_REASON_TOP_N = 20
"""`summarize_gba_violations -with_top_n` of each arm's post-auto-finish fail-reason reading."""

ARMS = ("merged", "control")
ECO_PREFIX = "atcs_batch"
ECO_DIRS = {"merged": "eco", "control": "eco-control"}
_ECO_ROLES = ("netlist", "physical")
_PREFIX_RE_CHARS = frozenset("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_")


def auto_fix_tcl(setup_margin, hold_margin):
    """Plain auto-fix: the old flow's qualified sequence (source-flow.md Sec.7.3 order: setup size,
    setup buffer, hold size, hold buffer), rendered by `closure.py` `actions_tcl_text` at effort high.

    The control arm runs it alone; the merged arm runs the same lines as its auto-finish after the
    expert recipe, so the two arms differ only by the recipe.
    """
    return [
        f"fix_setup_gba_violations -methods size_cell -effort high -setup_target 0.0 -hold_margin {hold_margin}",
        f"fix_setup_gba_violations -methods insert_buffer -effort high -setup_target 0.0 -hold_margin {hold_margin}",
        f"fix_hold_gba_violations -size_cell_only -size_rule nominal_keywords -hold_target 0.0 "
        f"-setup_margin {setup_margin}",
        f"fix_hold_gba_violations -effort high -hold_target 0.0 -setup_margin {setup_margin}",
    ]


def _recipe_margin(plan, key, default):
    value = plan.get(key, default)
    if (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
            or not -MARGIN_LIMIT <= value <= MARGIN_LIMIT):
        raise core.AtcsError("invalid-recipe", f"plan.{key} must be a number in [-{MARGIN_LIMIT}, {MARGIN_LIMIT}]")
    return value


def _recipe_word(value, label):
    """One Tcl word for a toolkit argument: JSON scalars and (nested) arrays, brace-quoted.

    Strings may not hold whitespace, braces, a backslash or a control character, so every
    word is one literal inside its braces (brackets and `$` stay literal there). The toolkit
    procedure still validates the value itself.
    """
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return _format_number(value)
    if isinstance(value, str):
        if value == "":
            return "{}"
        if any(ch in "{}\\" or ch.isspace() or ord(ch) < 32 or ord(ch) == 127 for ch in value):
            raise core.AtcsError("unsafe-name", f"{label} contains an unsafe character: {value!r}")
        return "{" + value + "}"
    if isinstance(value, list):
        return "{" + " ".join(_recipe_word(item, label) for item in value) + "}"
    raise core.AtcsError("malformed-input", f"{label} must be a JSON string, number, boolean or array")


def recipe_call_tcl(proc, args):
    """One toolkit call (``atcs_size_cell {U1} {BUFX2} {<sha>}``) from a recipe command.

    Raises `AtcsError` (``invalid-recipe``, ``unsafe-name`` or ``malformed-input``) when the
    procedure is not a replayable mutation, its named arguments do not match, or a value
    cannot be one safe Tcl word.
    """
    names = RECIPE_PROCS.get(proc)
    if names is None:
        raise core.AtcsError("invalid-recipe", f"{proc!r} is not a replayable toolkit mutation")
    if not isinstance(args, dict) or set(args) != set(names):
        got = sorted(args) if isinstance(args, dict) else args
        raise core.AtcsError("invalid-recipe", f"{proc} needs arguments {list(names)}, got {got!r}")
    return " ".join([proc] + [_recipe_word(args[name], f"{proc}.{name}") for name in names])


def _safe_names(values, label):
    if not isinstance(values, list):
        raise core.AtcsError("invalid-recipe", f"{label} must be a list")
    for value in values:
        _validate_tcl_value(value, f"{label} entry", allow_brackets=True)
    return list(values)


def _session_identity(slot, session):
    if not isinstance(session, dict):
        raise core.AtcsError("invalid-recipe", f"recipe session {slot!r} has no identity (namePrefix, editDomain)")
    prefix = session.get("namePrefix")
    if not isinstance(prefix, str) or not prefix or not set(prefix) <= _PREFIX_RE_CHARS or prefix[0].isdigit():
        raise core.AtcsError("invalid-recipe", f"session {slot!r} namePrefix must be [A-Za-z_][A-Za-z0-9_]*")
    domain = session.get("editDomain") or {}
    if not isinstance(domain, dict):
        raise core.AtcsError("invalid-recipe", f"session {slot!r} editDomain must be an object")
    regions = []
    for region in domain.get("regions") or []:
        if core.region_box(region) is None:
            raise core.AtcsError("invalid-recipe", f"session {slot!r} region must be [x1, y1, x2, y2] with x1<=x2, "
                                                   "y1<=y2")
        regions.append(list(region))
    return {
        "prefix": prefix,
        "instances": _safe_names(list(domain.get("instances") or []), f"{slot} editDomain.instances"),
        "nets": _safe_names(list(domain.get("nets") or []), f"{slot} editDomain.nets"),
        "pins": _safe_names(list(session.get("targetPins") or []), f"{slot} targetPins"),
        "regions": regions,
    }


def prepare_recipe_replay(plan, base_state_id, recipe, sessions, required_scenarios=(), removable_fillers=()):
    """Build a ``"mode": "recipe"`` `replay-request` from Task 4b's ranked recipe.

    - `plan`: the admitted integration plan (``batchId``, ``baseStateId``, ``reason``; optional
      ``autoFinish`` (default true) and ``setupMargin``/``holdMargin`` (default 0.02 ns)).
    - `recipe`: `composition-facts.recipe` -- ``sessions`` in rank order (filtered by
      ``plan.select`` when the plan names one; an unselected session is recorded in
      ``excluded`` with code ``not-selected``), each ``{rank,
      contribution, taskId, commands: [{seq, proc, args, instances, skip}]}``.
    - `sessions`: ``{taskId: {contributionId, revision, namePrefix, editDomain, targetPins,
      delta}}`` -- each worker slot's admitted work package and sealed Contribution.

    A command whose procedure or arguments cannot be rendered safely is kept in the request as
    skipped (``invalid-entry: ...``) and is never sent to XTop -- replay is best effort, so one
    bad command never refuses the batch. Refusals (`AtcsError`): ``identity-mismatch`` (plan base
    or a session's contribution id differs), ``invalid-recipe`` (malformed recipe, a slot ranked
    twice, a slot without identity, margins out of range).
    """
    if not isinstance(plan, dict):
        raise core.AtcsError("invalid-recipe", "plan must be an object")
    if plan.get("baseStateId") != base_state_id:
        raise core.AtcsError("identity-mismatch", "plan.baseStateId != facts.baseStateId")
    batch_id = plan.get("batchId")
    if not isinstance(batch_id, str) or not batch_id:
        raise core.AtcsError("invalid-recipe", "plan.batchId must be a non-empty string")
    auto_finish = plan.get("autoFinish", True)
    if not isinstance(auto_finish, bool):
        raise core.AtcsError("invalid-recipe", "plan.autoFinish must be a boolean")
    setup_margin = _recipe_margin(plan, "setupMargin", DEFAULT_SETUP_MARGIN)
    hold_margin = _recipe_margin(plan, "holdMargin", DEFAULT_HOLD_MARGIN)
    if not isinstance(recipe, dict) or not isinstance(recipe.get("sessions"), list):
        raise core.AtcsError("invalid-recipe", "recipe must be an object with a sessions list")
    sessions = sessions if isinstance(sessions, dict) else {}
    select = plan.get("select")
    if select is not None and not isinstance(select, list):
        raise core.AtcsError("invalid-recipe", "plan.select must be a list of contribution ids when given")
    excluded = list(recipe.get("excluded") or [])
    ranked_sessions = []
    for ranked in recipe["sessions"]:
        if select is not None and isinstance(ranked, dict) and ranked.get("contribution") not in select:
            excluded.append({"contribution": ranked.get("contribution"), "taskId": ranked.get("taskId"),
                             "codes": ["not-selected"]})
            continue
        ranked_sessions.append(ranked)

    request_sessions = []
    steps = []
    seen_slots = set()
    for index, ranked in enumerate(ranked_sessions, start=1):
        if not isinstance(ranked, dict) or not isinstance(ranked.get("commands"), list):
            raise core.AtcsError("invalid-recipe", f"recipe session #{index} must carry a commands list")
        slot = ranked.get("taskId")
        if not isinstance(slot, str) or not slot:
            raise core.AtcsError("invalid-recipe", f"recipe session #{index} has no taskId")
        if slot in seen_slots:
            raise core.AtcsError("invalid-recipe", f"recipe ranks slot {slot!r} twice")
        seen_slots.add(slot)
        identity = sessions.get(slot)
        bound = _session_identity(slot, identity)
        contribution_id = ranked.get("contribution")
        if contribution_id != identity.get("contributionId"):
            raise core.AtcsError(
                "identity-mismatch",
                f"recipe session {slot!r} names contribution {contribution_id!r}, the slot sealed "
                f"{identity.get('contributionId')!r}",
            )
        request_sessions.append({
            "slot": slot, "rank": ranked.get("rank"), "contributionId": contribution_id,
            "revision": identity.get("revision"), "namePrefix": bound["prefix"], "dumpIndex": index,
            "domain": {key: bound[key] for key in ("instances", "nets", "pins", "regions")},
            "delta": _normalize_delta(identity.get("delta")),
        })
        for command in ranked["commands"]:
            command = command if isinstance(command, dict) else {}
            proc, args, skip = command.get("proc"), command.get("args"), command.get("skip")
            tcl = None
            if skip is not None and (not isinstance(skip, str) or not skip):
                skip = "invalid-entry: skip must be null or a reason"
            if skip is None:
                try:
                    tcl = recipe_call_tcl(proc, args)
                except core.AtcsError as exc:
                    skip = f"invalid-entry: {exc.code}: {exc.detail}"
            step_id = core.digest({"batchId": batch_id, "contributionId": contribution_id,
                                   "seq": command.get("seq"), "rank": len(steps)})
            steps.append({
                "stepId": step_id, "slot": slot, "contributionId": contribution_id, "seq": command.get("seq"),
                "proc": proc, "args": args, "skip": skip, "tcl": tcl,
            })

    safe_batch = "".join(ch if ch in _PREFIX_RE_CHARS else "_" for ch in batch_id)
    body = {
        "mode": "recipe",
        "batchId": batch_id,
        "baseStateId": base_state_id,
        "reason": plan.get("reason"),
        "autoFinish": auto_finish,
        "setupMargin": setup_margin,
        "holdMargin": hold_margin,
        "autoPrefix": f"atcs_{safe_batch}_auto_",
        "autoFinishTcl": auto_fix_tcl(setup_margin, hold_margin) if auto_finish else [],
        "controlTcl": auto_fix_tcl(setup_margin, hold_margin),
        "failReasonTopN": FAIL_REASON_TOP_N,
        "requiredScenarios": list(required_scenarios or []),
        "removableFillers": list(removable_fillers or []),
        "sessions": request_sessions,
        "steps": steps,
        "excluded": excluded,
    }
    return core.stamp("replay-request", body)


# ---- XTop prediction (summarize_gba_violations) -------------------------------

def parse_gba_summary(text, check=None):
    """One check's per-scenario `summarize_gba_violations` table -> ``{"total", "scenarios"}``.

    A thin view over Task 4b's `atcs.contributions.parse_gain_summary`, the one parser of
    XTop's summary text, pinned to real XTop 2025.09 output (plain and ``-with_reference
    -with_delta`` layouts, ``### <check> summary ###`` sections, fail closed). Rows become
    ``{"count", "wns", "tns"}`` from the current ``Count``/``Worst``/``TNS`` columns (TNS signed,
    a clean scenario reads 0). Without `check`, the only section present is read. Returns
    ``None`` when the text carries no readable section -- the caller then treats the
    prediction as unknown, never as zero.
    """
    if not isinstance(text, str) or not text:
        return None
    sections = contributions.parse_gain_summary(text)
    if check is None:
        if len(sections) != 1:
            return None
        check = next(iter(sections))
    section = sections.get(check)
    if section is None:
        return None

    def row(values):
        return {"count": values["count"], "wns": values["worst"], "tns": values["tns"]}

    return {"total": row(section["total"]),
            "scenarios": {name: row(values) for name, values in section["scenarios"].items()}}


def _prediction(predict_text, required):
    """One arm's prediction: per-scenario tables plus the comparison key, or ``{"unknown": why}``."""
    predict_text = predict_text if isinstance(predict_text, dict) else {}
    tables = {}
    for check in ("setup", "hold"):
        table = parse_gba_summary(predict_text.get(check), check)
        if table is None:
            return {"unknown": f"no readable {check} summarize_gba_violations table"}
        tables[check] = table
    prediction = {}
    for check in ("setup", "hold"):
        scenarios = tables[check]["scenarios"]
        names = list(required) if required else sorted(scenarios)
        if not names:
            if tables[check]["total"] is None:
                return {"unknown": f"{check} summary has no scenario rows"}
            rows = {"total": tables[check]["total"]}
        else:
            missing = [name for name in names if name not in scenarios]
            if missing:
                return {"unknown": f"{check} summary lacks required scenario(s) {missing}"}
            rows = {name: scenarios[name] for name in names}
        prediction[check] = rows
        prediction[f"worst{check.capitalize()}Wns"] = round(min(row["wns"] for row in rows.values()), 6)
        prediction[f"{check}Tns"] = round(sum(row["tns"] for row in rows.values()), 6)
    return prediction


PREDICTION_TOLERANCE = 1e-4
"""One rounding step of XTop's 4-decimal summary: a difference within it is no difference."""


def _compare_predictions(merged, control):
    """``(merged_chosen, detail)``: merged only if it is no worse than control on worst setup WNS
    and worst hold WNS, and strictly better on at least one of the four WNS/TNS measures or equal
    on all of them (a tie goes to merged)."""
    keys = (("worstSetupWns", "setup WNS"), ("worstHoldWns", "hold WNS"),
            ("setupTns", "setup TNS"), ("holdTns", "hold TNS"))
    diffs = {label: round(merged[key] - control[key], 6) for key, label in keys}
    detail = "; ".join(f"{label} merged {merged[key]} vs control {control[key]}" for key, label in keys)
    worse = [label for label in ("setup WNS", "hold WNS") if diffs[label] < -PREDICTION_TOLERANCE]
    if worse:
        return False, f"merged is worse on {' and '.join(worse)} ({detail})"
    better = [label for label, diff in diffs.items() if diff > PREDICTION_TOLERANCE]
    if better:
        return True, f"merged is no worse on WNS and better on {', '.join(better)} ({detail})"
    if all(abs(diff) <= PREDICTION_TOLERANCE for diff in diffs.values()):
        return True, f"tie ({detail}); merged kept"
    return False, f"merged is better on nothing and worse on TNS ({detail})"


# ---- ECO pair safety -----------------------------------------------------------

_FORMATVERSION_RE = re.compile(r"(?m)^\s*FORMATVERSION\s+")
_ROUTE_DESTRUCTIVE_RE = re.compile(r"(?m)^\s*(?:dbNetFreeWires\b|editDelete\s+-net\b)")


def eco_text_problems(role, text):
    """Why one `write_design_changes -keep_route` file cannot be `source`d as-is (empty = safe).

    The frozen serial flow's `validate_sourceable_eco` rules: an atomic `loadECO` directive file
    (`FORMATVERSION`) is not sourceable Tcl, and `dbNetFreeWires` / `editDelete -net` destroy
    routing despite `-keep_route`.
    """
    if not isinstance(text, str) or not [line for line in text.splitlines()
                                         if line.strip() and not line.lstrip().startswith("#")]:
        return [f"{role} ECO file is empty"]
    problems = []
    if _FORMATVERSION_RE.search(text):
        problems.append(f"{role} ECO is an atomic loadECO FORMATVERSION file, not sourceable Tcl")
    destructive = _ROUTE_DESTRUCTIVE_RE.findall(text)
    if destructive:
        problems.append(f"{role} ECO holds {len(destructive)} route-destructive dbNetFreeWires/editDelete -net line(s)")
    return problems


# ---- reconcile / choose ----------------------------------------------------------


def _is_filler(master, patterns):
    return bool(master) and any(fnmatch.fnmatchcase(master, pattern) for pattern in patterns)


def _delta_without_fillers(delta, patterns):
    delta = _normalize_delta(delta)
    kept = _empty_delta()
    for name, pair in delta["mastersChanged"].items():
        if not (_is_filler(pair[0], patterns) or _is_filler(pair[1], patterns)):
            kept["mastersChanged"][name] = pair
    for key in ("added", "removed"):
        for name, master in delta[key].items():
            if not _is_filler(master, patterns):
                kept[key][name] = master
    return kept


def _eco_pair(evidence_eco, arm):
    """``(pair, texts, problems, missing)`` for one arm's `write_design_changes` output."""
    evidence_eco = evidence_eco if isinstance(evidence_eco, dict) else {}
    pair, texts, problems, missing = {}, {}, [], False
    for role in _ECO_ROLES:
        files = evidence_eco.get(role) or []
        if len(files) != 1:
            missing = True
            problems.append(f"missing-eco-pair: {len(files)} {ECO_PREFIX}_{role}_* file(s) in "
                            f"{ECO_DIRS[arm]}/, need exactly one")
            continue
        entry = files[0]
        if not isinstance(entry.get("path"), str) or not isinstance(entry.get("sha256"), str):
            missing = True
            problems.append(f"missing-eco-pair: {role} file has no path/sha256")
            continue
        pair[role] = {"path": entry["path"], "sha256": entry["sha256"]}
        texts[role] = entry.get("text")
    if not missing:
        for role in _ECO_ROLES:
            problems.extend(eco_text_problems(role, texts[role]))
    return pair if not missing else None, problems, missing


def _arm_view(arm, evidence, request, session_accounts):
    evidence = evidence if isinstance(evidence, dict) else {}
    result = evidence.get("result") if isinstance(evidence.get("result"), dict) else None
    problems = []
    if result is None or result.get("complete") is not True:
        problems.append("incomplete: the XTop run did not reach its end (no complete arm-result.json)")
    elif result.get("arm") != arm:
        problems.append(f"arm-result.json names arm {result.get('arm')!r}, not {arm!r}")
    else:
        if result.get("tainted"):
            problems.append(f"tainted toolkit session: {result['tainted']}")
        if result.get("exportCode") not in (0, "0"):
            problems.append(f"write_design_changes failed: {result.get('exportResult')}")
    if evidence.get("badReceiptLines"):
        problems.append(f"{evidence['badReceiptLines']} unreadable receipts.jsonl line(s)")
    pair, eco_problems, missing = _eco_pair(evidence.get("eco"), arm)
    problems.extend(eco_problems)
    if arm == "merged":
        problems.extend(session_accounts["problems"])
    fail_text = evidence.get("failReasonText") if isinstance(evidence.get("failReasonText"), dict) else {}
    view = {
        "safe": not problems, "problems": problems, "missingPair": missing, "eco": pair,
        "prediction": _prediction(evidence.get("predictText"), request.get("requiredScenarios") or []),
        "failReasons": {check: contributions.parse_fail_reasons(fail_text[check]) for check in ("setup", "hold")
                        if isinstance(fail_text.get(check), str)},
        "toolFailure": evidence.get("toolFailure"),
        "autoFix": (result or {}).get("autoFix") or [],
    }
    if arm == "merged":
        view["protected"] = list((result or {}).get("protected") or [])
        view["protectCode"] = (result or {}).get("protectCode")
    return view


def _merged_sessions(request, evidence):
    """Per-session applied/skipped lists, replay deltas and their warnings (merged arm)."""
    evidence = evidence if isinstance(evidence, dict) else {}
    steps = request.get("steps") or []
    steps_by_id = {step["stepId"]: step for step in steps}
    fillers = request.get("removableFillers") or []
    problems, warnings = [], []

    receipts = {}
    for receipt in evidence.get("receipts") or []:
        step_id = receipt.get("stepId") if isinstance(receipt, dict) else None
        if step_id not in steps_by_id:
            problems.append(f"receipt for an unknown step: {receipt!r}")
            continue
        if step_id in receipts and receipts[step_id] != receipt:
            problems.append(f"two different receipts for step {step_id}")
            continue
        receipts[step_id] = receipt

    deltas = evidence.get("sessionDeltas") if isinstance(evidence.get("sessionDeltas"), dict) else {}
    accounts = {}
    for session in request.get("sessions") or []:
        slot = session["slot"]
        applied, skipped = [], []
        for step in steps:
            if step["slot"] != slot:
                continue
            receipt = receipts.get(step["stepId"])
            if step.get("skip") is not None:
                skipped.append({"stepId": step["stepId"], "attempted": False, "reason": f"recipe:{step['skip']}"})
            elif receipt is None:
                # Every sendable command leaves a receipt, applied or skipped; a missing one
                # means the run stopped early or its evidence is incomplete.
                skipped.append({"stepId": step["stepId"], "attempted": False, "reason": "no-receipt"})
                problems.append(f"session {slot}: no receipt for step {step['stepId']}")
            elif receipt.get("status") == "applied":
                applied.append(step["stepId"])
            else:
                skipped.append({"stepId": step["stepId"], "attempted": receipt.get("attempted", True) is not False,
                                "reason": str(receipt.get("reason") or "skipped")})
        replay_delta = deltas.get(slot)
        account = {"contributionId": session["contributionId"], "rank": session.get("rank"),
                   "applied": applied, "skipped": skipped, "delta": replay_delta,
                   "contributionDelta": session.get("delta")}
        if replay_delta is None:
            account["deltaMatches"] = False
            problems.append(f"session {slot}: no {session['dumpIndex']:03d}.dump delta")
        else:
            replay_view = _delta_without_fillers(replay_delta, fillers)
            account["deltaMatches"] = replay_view == _delta_without_fillers(session.get("delta"), fillers)
            if not account["deltaMatches"]:
                warnings.append({"kind": "replayMismatch", "slot": slot, "contributionId": session["contributionId"],
                                 "detail": "the replayed session changed the design differently from its "
                                           "Contribution's own dump delta"})
            prefix = session.get("namePrefix") or ""
            domain_instances = set((session.get("domain") or {}).get("instances") or [])
            # Confinement: an existing instance outside this session's own edit domain, or a new
            # one without its prefix. Filler masters are exempt (the Site's removable fillers).
            stray = sorted(
                name for name in _delta_instances(replay_view)
                if name not in domain_instances
                and not (name in replay_view["added"] and name.rsplit("/", 1)[-1].startswith(prefix))
            )
            if stray:
                problems.append(f"session {slot}: out-of-domain replay change(s) {stray}")
        accounts[slot] = account
    return {"accounts": accounts, "problems": problems, "warnings": warnings}


def choose_arm(merged, control):
    """``(arm, reason, evidenced)`` -- see `reconcile_recipe`. Raises when neither arm is usable.

    `evidenced` is whether XTop's own prediction shows the chosen batch is no worse than plain
    auto-fix: true when the control arm itself is chosen, or when both predictions were
    compared; false when merged is chosen only because the control arm is unusable.
    """
    if not merged["safe"] and not control["safe"]:
        code = "missing-input" if merged["missingPair"] else "eco-refused"
        raise core.AtcsError(
            code, f"no usable ECO pair: merged {merged['problems']}; control {control['problems']}",
        )
    if not control["safe"]:
        return ("merged", f"control arm unusable ({'; '.join(control['problems'])}); merged arm is safe but "
                          "not compared against plain auto-fix", False)
    if not merged["safe"]:
        return "control", f"merged arm refused ({'; '.join(merged['problems'])}); control arm is safe", True
    merged_prediction, control_prediction = merged["prediction"], control["prediction"]
    if "unknown" in merged_prediction:
        return "control", f"merged prediction unknown ({merged_prediction['unknown']}); plain auto-fix kept", True
    if "unknown" in control_prediction:
        return ("control", f"control prediction unknown ({control_prediction['unknown']}); both arms use the "
                           "same summary command, so plain auto-fix is kept", True)
    merged_chosen, detail = _compare_predictions(merged_prediction, control_prediction)
    return ("merged" if merged_chosen else "control"), detail, True


def _chosen_new_nets(chosen_arm, evidence, fillers):
    """``(newNets, unknownReason)`` for the chosen arm's refresh (presta's qualification input).

    Known only when every instance the arm added is accounted for: none added (sizing and
    removals create no net), or merged with auto-finish adding none and every added instance
    mapped to a net its own kept expert command recorded. Auto-fix names its own nets inside XTop, and this Pack does not
    read them back from the ECO files, so an arm whose auto-fix added instances has unknown
    new nets -- presta never claims a qualification it does not have.
    """
    evidence = evidence if isinstance(evidence, dict) else {}
    total = evidence.get("totalDelta")
    if not isinstance(total, dict):
        return None, f"{chosen_arm} arm has no base-to-final dump delta"
    added = _delta_without_fillers(total, fillers)["added"]
    if not added:
        return [], None
    auto = evidence.get("autoDelta")
    auto_added = _delta_without_fillers(auto, fillers)["added"] if isinstance(auto, dict) else None
    if chosen_arm == "merged" and auto_added == {}:
        # Every expert-added instance must map to a net its own kept command recorded.
        instance_nets = evidence.get("keptInstanceNets") if isinstance(evidence.get("keptInstanceNets"), dict) else {}
        unmapped = sorted(name for name in added if not instance_nets.get(name))
        if unmapped:
            return None, f"expert-added instance(s) {unmapped} have no recorded new net"
        return sorted({net for name in added for net in instance_nets[name]}), None
    return None, (f"auto-fix in the {chosen_arm} arm inserted {len(added)} instance(s); XTop named their nets "
                  "and this Pack does not read them back from the ECO files")


def reconcile_recipe(request, arms):
    """Fold both arms' evidence into a ``"mode": "recipe"`` `integration-state`.

    `arms` is ``{"merged"|"control": evidence}`` as `atcs.adapters.read_replay_arm` reads it
    (``result`` = arm-result.json, ``receipts``, ``sessionDeltas``, ``autoDelta``,
    ``totalDelta``, ``predictText``, ``eco`` = the `write_design_changes` files with their
    text, ``toolFailure``).

    An arm is unsafe when its run is incomplete, its toolkit session was tainted, its export
    failed, it has no single netlist+physical pair, a pair file is empty or holds a
    `FORMATVERSION` / `dbNetFreeWires` / `editDelete -net` line, or (merged) a receipt is
    unattributable or a session's replay changed an instance outside its own edit domain.
    Choice: a safe arm over an unsafe one; with both safe, XTop's predictions over the required
    scenarios: merged only if it is no worse than control on worst setup WNS and on worst hold
    WNS (within `PREDICTION_TOLERANCE`), and strictly better on at least one of setup/hold WNS or
    TNS (TNS summed over scenarios), else control; a tie on all four goes to merged. An unknown
    prediction of either arm keeps control (both run the same summary command, so plain auto-fix
    is the conservative pick).
    Merged chosen only because control is unusable is sealed ``guarantee.evidenced: false`` with
    a ``guaranteeUnevidenced`` warning. ``newNets`` is the chosen arm's new nets when every added
    instance is accounted for, else ``None`` with ``newNetsUnknown``. Neither arm usable raises
    ``missing-input`` (the merged pair is missing) or ``eco-refused``.

    ``failReasons`` is the chosen arm's post-auto-finish ``summarize_gba_violations
    -with_fail_reason`` reading, ``{arm, setup?: {reason: count}, hold?: {...}}`` (a check whose
    reading is missing is absent); ``arms.*.failReasons`` holds both arms'. They are what plain
    auto-fix left unfixed and why, for the residual and the next generation's research.

    Recorded, never blocking: skipped commands (per session), a session replay delta that
    differs from its Contribution's own delta (``warnings`` kind ``replayMismatch``), and an
    auto-finish change to a `set_dont_touch`-protected instance (``protectedChanged``). The
    Reader-facing lists (``pending``, ``failed``, ``replayMismatch``, ``outOfScope``,
    ``unknownReceipts``) stay empty: an unsafe arm is never the chosen one.
    """
    if not isinstance(request, dict) or request.get("mode") != "recipe":
        raise core.AtcsError("identity-mismatch", "reconcile_recipe needs a recipe-mode replay-request")
    arms = arms if isinstance(arms, dict) else {}
    sessions = _merged_sessions(request, arms.get("merged"))
    views = {arm: _arm_view(arm, arms.get(arm), request, sessions) for arm in ARMS}
    chosen_arm, reason, evidenced = choose_arm(views["merged"], views["control"])

    merged_evidence = arms.get("merged") if isinstance(arms.get("merged"), dict) else {}
    auto_delta = merged_evidence.get("autoDelta")
    protected = views["merged"].get("protected") or []
    warnings = list(sessions["warnings"])
    protected_changed = []
    if isinstance(auto_delta, dict):
        normalized = _normalize_delta(auto_delta)
        protected_changed = sorted(name for name in protected
                                   if name in normalized["mastersChanged"] or name in normalized["removed"])
    if protected_changed:
        warnings.append({"kind": "protectedChanged", "instances": protected_changed,
                         "detail": "auto-finish changed set_dont_touch-protected expert repairs"})
    if views["merged"].get("protectCode") not in (None, 0, "0"):
        warnings.append({"kind": "protectFailed", "detail": "set_dont_touch returned an error"})
    protect_missing = list(((merged_evidence.get("result") or {}).get("protectMissing")) or [])
    if protect_missing:
        warnings.append({"kind": "protectMissing", "instances": protect_missing,
                         "detail": "changed instances that no longer existed when set_dont_touch ran"})
    if not evidenced:
        warnings.append({"kind": "guaranteeUnevidenced", "reason": reason})

    chosen_evidence = arms.get(chosen_arm) if isinstance(arms.get(chosen_arm), dict) else {}
    new_nets, new_nets_unknown = _chosen_new_nets(chosen_arm, chosen_evidence, request.get("removableFillers") or [])
    applied = {step_id: slot for slot, account in sessions["accounts"].items() for step_id in account["applied"]}
    body = {
        "mode": "recipe",
        "batchId": request.get("batchId"),
        "applied": applied,
        "failed": [], "pending": [], "replayMismatch": [], "outOfScope": [], "unknownReceipts": [],
        "delta": _normalize_delta(chosen_evidence.get("totalDelta")),
        "sessions": sessions["accounts"],
        "autoDelta": _normalize_delta(auto_delta) if isinstance(auto_delta, dict) else None,
        "protected": list(protected),
        "protectedChanged": protected_changed,
        "warnings": warnings,
        "arms": views,
        "chosen": {"arm": chosen_arm, "reason": reason, "eco": views[chosen_arm]["eco"]},
        "failReasons": {"arm": chosen_arm, **views[chosen_arm]["failReasons"]},
        "guarantee": {"evidenced": evidenced, "arm": chosen_arm, "reason": reason},
        "newNets": new_nets,
    }
    if new_nets_unknown is not None:
        body["newNetsUnknown"] = new_nets_unknown
    return core.stamp("integration-state", body)


def _seal_recipe_batch(state, request, facts, contributions):
    """`seal_batch` for a recipe batch: the chosen ECO pair, both arms, the choice and sessions."""
    if request.get("mode") != "recipe" or state.get("mode") != "recipe":
        raise core.AtcsError("identity-mismatch", "a recipe integration-state needs its recipe replay-request")
    if state.get("batchId") != request.get("batchId"):
        raise core.AtcsError("identity-mismatch", "state.batchId != request.batchId")
    if request.get("baseStateId") != facts.get("baseStateId"):
        raise core.AtcsError("identity-mismatch", "request.baseStateId != facts.baseStateId")
    blocking = {key: state.get(key) or [] for key in ("pending", "failed", "replayMismatch", "outOfScope",
                                                      "unknownReceipts")}
    problems = [f"{name}={ids}" for name, ids in blocking.items() if ids]
    if problems:
        raise core.AtcsError("integration-incomplete", "; ".join(problems))
    chosen = state.get("chosen")
    eco = chosen.get("eco") if isinstance(chosen, dict) else None
    if (not isinstance(eco, dict) or chosen.get("arm") not in ARMS
            or any(not isinstance(eco.get(role), dict) or not eco[role].get("path") or not eco[role].get("sha256")
                   for role in _ECO_ROLES)):
        raise core.AtcsError("missing-input", "integration-state names no chosen ECO pair")

    contributions_by_id = {contribution["id"]: contribution for contribution in contributions}
    sessions = state.get("sessions") or {}
    credited = []
    if chosen["arm"] == "merged":
        for session in request.get("sessions") or []:
            account = sessions.get(session["slot"]) or {}
            if account.get("applied"):
                contribution = contributions_by_id.get(session["contributionId"])
                if contribution is None:
                    raise core.AtcsError(
                        "missing-input", f"no sealed contribution supplied for {session['contributionId']!r}",
                    )
                credited.append({"id": session["contributionId"], "revision": contribution.get("revision")})
    credited.sort(key=lambda entry: entry["id"])

    arms = state.get("arms") or {}
    body = {
        "parentStateId": facts.get("baseStateId"),
        "batchId": request.get("batchId"),
        "contributions": credited,
        "operations": [],
        "innovusEcoTcl": "",
        "sourceMap": {},
        "newNets": state.get("newNets"),
        "eco": {role: {"path": eco[role]["path"], "sha256": eco[role]["sha256"]} for role in _ECO_ROLES},
        "choice": {"arm": chosen["arm"], "reason": chosen.get("reason")},
        "failReasons": state.get("failReasons") or {"arm": chosen["arm"]},
        "arms": {arm: {"eco": (arms.get(arm) or {}).get("eco"), "safe": (arms.get(arm) or {}).get("safe"),
                       "problems": (arms.get(arm) or {}).get("problems"),
                       "prediction": (arms.get(arm) or {}).get("prediction")} for arm in ARMS},
        "sessions": sessions,
        "autoDelta": state.get("autoDelta"),
        "protected": state.get("protected") or [],
        "protectedChanged": state.get("protectedChanged") or [],
        "warnings": state.get("warnings") or [],
        "guarantee": state.get("guarantee"),
        "autoFinish": request.get("autoFinish"),
        "setupMargin": request.get("setupMargin"),
        "holdMargin": request.get("holdMargin"),
    }
    if state.get("newNets") is None:
        body["newNetsUnknown"] = state.get("newNetsUnknown") or "new nets were not derived"
    return core.stamp("merge-commit", body)
