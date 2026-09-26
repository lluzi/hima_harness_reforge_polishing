"""M3: sealing a worker's real tool work into an immutable ECO Contribution.

This module owns the five M3 producers named in
``.superpowers/sdd/task-5-brief.md`` and the ``operation``/``contribution``
rows of ``.superpowers/sdd/global-context.md``'s "Shared data model" table:

- `parse_ops_log(text)` -> ``list[operation]`` — a fail-closed parser for the
  typed-procedure trace XTop logs while a worker edits (``ops.jsonl``, one
  JSON object per line).
- `parse_cell_dump(text)` -> ``{instance: master}`` — a fail-closed parser
  for a plain-text ``"<instance> <master>"`` per-line cell dump.
- `actual_delta(before, after)` -> ``delta`` — the real native
  instance-to-master change between two cell dumps.
- `implied_delta(operations, before)` -> ``delta`` — what the parsed
  operation trace *says* should have happened, replayed against `before`.
- `seal(base_ref, result_refs, operation_trace)` -> ``contribution`` — binds
  base state, the operation trace, the actual delta, predictions,
  preconditions, atomic groups and scope into one immutable artifact, per
  ``AGENTIC_TIMING_CLOSURE_SYSTEM_ARCHITECTURE.zh-CN.md`` §5-5.3 and
  ``knowledge/contribution-and-merge.md``: "提交必须携带确定的变更集合，
  而非可重新触发的搜索" — the sealed `delta` is always the actual
  before/after object-level diff, never a re-run of a search.

A contribution is the core object of the whole method (M4 composes
contributions, M5 replays them), so it must be refused — but still
returned, never raised away — when the declared operation trace, the
actual delta and the declared scope disagree. Fail-closed applies only to
genuinely *unusable* inputs: `seal` raises `AtcsError` for an unreadable
dump/script file, a malformed operations log, a script path that resolves
outside its own workspace root, or a `base_ref` whose three parts
(`stateId`, `workspaceManifest`, `workPackage`) do not agree with each
other. Everything else that can go wrong with the *content* of an
otherwise-readable trace (trace/delta mismatch, a precondition the
replayed state does not actually hold, out-of-scope edits, a buffer name
missing its workspace prefix, a `no-fix` with no diagnosis) is recorded as
a sealed-but-inadmissible contribution (`admissible: False`,
`refusals[]`), so a Reader can still count it (``tc_ready_contribution_count``
per `SPEC.md` reads `admissible`).

``operation`` shapes (binding, from global-context.md)
--------------------------------------------------------

One JSON object per ``ops.jsonl`` line, one of::

    {"op": "size_cell", "instance": "<inst>", "fromMaster": "<master>", "toMaster": "<master>"}
    {"op": "insert_buffer", "net": "<net>", "loadPins": ["<pin>", ...],
     "newInstance": "<inst>", "newNet": "<net>", "master": "<master>",
     "location": [x, y] | null}
    {"op": "delete_buffer", "instance": "<inst>", "master": "<master>"}
    {"op": "pg_local_adjust", "region": [x1, y1, x2, y2], "action": "<str>", "detail": "<str>"}

Any op may also carry an optional integer ``"group"`` field (see
"Atomic groups" below); unrecognized extra fields are otherwise passed
through untouched, never stripped. Every string-shaped field above
(`instance`, `fromMaster`, `toMaster`, `net`, `newInstance`, `newNet`,
`master`, each `loadPins` entry, `action`, `detail`) must be a non-empty
string; `location` must be JSON `null` or exactly two finite numbers;
`region` must be exactly four finite numbers; `group`, when present, must
be a plain `int` (not `bool`, not a `float`). `parse_ops_log` rejects any
violation as `AtcsError("malformed-ops-log", ...)` — a shape a downstream
consumer could not safely use is never silently passed through.

``base_ref`` shape (binding for `seal`)
------------------------------------------

::

    {
        "stateId": "<design-state id>",
        "workspaceManifest": <workspace-manifest artifact dict>,
        "workPackage": <work-package artifact dict>,
    }

`seal` cross-checks all three before doing anything else:
`workspaceManifest["baseStateId"]` and `workPackage["baseStateId"]` must
both equal `stateId`, and `workspaceManifest["workPackageId"]` must equal
`workPackage["id"]`. Any disagreement is `AtcsError("base-mismatch", ...)`
— this is a caller wiring bug, not a fact about the worker's edits, so it
is never merely recorded as a refusal.

``result_refs`` shape (binding for `seal`)
------------------------------------------

::

    {
        "beforeDump": "<path to a cell dump captured before the worker edited>",
        "afterDump": "<path to a cell dump captured after>",
        "script": "<path to the source script>" | None,
        "predicted": {
            "xtopSetupWns": Measure, "xtopHoldWns": Measure,
            "prestaSetupWns": Measure, "prestaHoldWns": Measure,
        },  # optional; any/all keys may be absent
        "diagnosis": "<str>" | None,
        "cones": [...],  # optional, default []
        "dependencies": ["<contribution id>", ...],  # optional, default []
    }

`beforeDump`/`afterDump` are file paths because `seal` must read the
*actual* native state, not trust a summary of it — per
`knowledge/contribution-and-merge.md`: "结构化操作描述负责比较和前置
条件；源脚本与原生状态负责核实，不能让模型摘要替代真实 diff." An
unreadable dump or script file is `AtcsError("missing-input", ...)`.
`beforeDump`'s own bytes are also hashed into `beforeDumpSha256` on the
sealed contribution, so M4 can check that two contributions claiming the
same `baseStateId` actually started from the same native state, not just
the same declared id.

`script`, when given, is stored on the contribution with its `path`
rewritten to be **campaign-relative** — everything from
`workspaceManifest["root"]` onward in its resolved filesystem path — so
`contribution["id"]` never depends on where the campaign happens to be
checked out on disk. A script path that does not resolve to somewhere
under its own workspace root is `AtcsError("missing-input", ...)`: a
script from outside the workspace the manifest describes is not evidence
this contribution can stand on.

`dependencies` (optional) is copied straight onto the sealed contribution
as a sorted, de-duplicated list of `str` ids — the *revisions this one
builds on*, supplied by the caller (e.g. a resubmission after M4/M5 asked
for a revised contribution). `seal` never infers dependencies on its own;
cross-contribution dependency *detection* is M4's `analyze` job.

``operation_trace`` is the raw ``ops.jsonl`` text (not a path) — `seal`
parses it itself via `parse_ops_log`, so a malformed trace surfaces as
whatever `AtcsError` `parse_ops_log` raises, uncaught.

Scope rule
----------

An operation's touched instance is in scope when it is a member of the
work package's ``editDomain.instances``; for `insert_buffer` there is no
existing instance to check, so scope instead asks whether the buffered
`net` is a member of ``editDomain.nets``, and the newly-created instance
inherits that op's scope verdict. A `pg_local_adjust`'s `region` is in
scope when it is fully contained (all four coordinates) inside at least
one of `editDomain.regions`' boxes — a region only partially overlapping,
or outside all of them, is out of scope. Independently of all of the
above, **every** op's own kind must be a member of `workPackage.actions`
— this is the same gate M2's `validate_work_package` applies to the whole
package (e.g. `pg_local_adjust` needing `siteCapabilities.pgVerification`
to even be a declared action), re-checked here per-op because a specific
trace can still emit an op kind the *package* never declared. Every
out-of-scope object found (an instance, a `pg_local_adjust` region, or an
op whose kind is not a declared action) is collected into `outOfScope`
and also turns into one `"out-of-scope"` refusal (so `admissible` is
`False`).

Atomic groups
-------------

Two independent ways an atomic group is recorded, per
``knowledge/contribution-and-merge.md``'s "原子提交与部分采用" and this
task's Decisions:

1. **Explicit**: any ops carrying the same integer ``"group"`` field form
   one atomic group, regardless of position in the trace. Explicit
   grouping always wins: an op with a `"group"` field is never also
   folded into an implicit group below.
2. **Implicit**: every `size_cell`/`delete_buffer` operation that targets
   an instance created earlier in the *same trace* by an `insert_buffer`
   joins one atomic group together with that creating `insert_buffer` —
   regardless of how far apart they are in the trace, and regardless of
   how many such later operations there are (they all join the same
   group as the one creating op). This is "sizing/deleting the buffer you
   just inserted"; it is unaffected by adjacency because a worker's trace
   may interleave unrelated operations between creating an object and
   later touching it.

Grouping an *upstream driver* with an insertion — e.g. resizing the
pre-existing gate that used to drive a net, once a buffer now sits
between it and its loads — is a different relationship: the operation
schema has no `driver` field connecting a `size_cell` on a pre-existing
instance to a particular `insert_buffer` on the net it drives, so this
module has no way to infer that relationship from the trace alone. That
kind of atomic grouping can only be expressed by both ops carrying the
same explicit `"group"` value; this is a controller decision, not an
oversight.

Each group is `[opIndex, ...]`, indices into the sealed `operations` list.

Preconditions
-------------

A precondition records what the *base* state (not any intermediate,
in-trace state) must show for the whole trace to still validly apply:
`{"instance": "<inst>", "master": "<master the base dump must show>"}`.
Only the *first* time an instance is referenced by `size_cell.fromMaster`
or `delete_buffer.master` contributes a precondition, and an instance
*created* by this trace's own `insert_buffer` never contributes one at
all (even on a later `size_cell`/`delete_buffer`) — it does not exist in
the base dump, so there is nothing there to precondition on. A later op
on an instance already seen (whether from an earlier op in this trace or
from this trace's own `insert_buffer`) depends on this trace's own
earlier effect, not on the base dump; that dependency is what
`implied_delta`'s in-order replay (and its precondition-mismatch check
below) captures instead.

Delta and replay validation
----------------------------

`delta` is always `actual_delta(before, after)` — the real object-level
diff of the two dumps, exactly as `AGENTIC_TIMING_CLOSURE_SYSTEM_ARCHITECTURE.zh-CN.md`
§5.2 requires: bounded by the common base, never inferred from log length.
`implied_delta(operations, before)` independently replays the trace in
order against `before` (`size_cell` overwrites the target's master,
`insert_buffer` adds `newInstance` with `master`, `delete_buffer` removes
`instance`; `pg_local_adjust` has no cell-master effect) and diffs the
resulting state against `before` the same way. When the two deltas
disagree, the trace does not actually explain the real change, so `seal`
records a `"trace-mismatch"` refusal — its detail text serializes both
deltas via `core.canonical` (sorted keys) so that two dumps whose lines
were merely written in a different order still produce the *same*
refusal text, and therefore the same contribution `id`.

The same in-order replay also validates each op against the state it
actually finds, not just the state it declares: a `size_cell` whose
`instance` is absent from the running state, or present with a master
other than that op's own `fromMaster`; a `delete_buffer` the same way
against `master`; or an `insert_buffer` whose `newInstance` is *already*
present in the running state. Each such disagreement adds one
`"precondition-mismatch"` refusal — the op's own declared effect is still
applied to the replayed state regardless (so `implied_delta` stays
comparable to the actual delta even for a trace with a stale
precondition), but the contribution is inadmissible.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

from . import core


OPERATION_FIELDS = {
    "size_cell": ("instance", "fromMaster", "toMaster"),
    "insert_buffer": ("net", "loadPins", "newInstance", "newNet", "master", "location"),
    "delete_buffer": ("instance", "master"),
    "pg_local_adjust": ("region", "action", "detail"),
}

STRING_FIELDS = {
    "size_cell": ("instance", "fromMaster", "toMaster"),
    "insert_buffer": ("net", "newInstance", "newNet", "master"),
    "delete_buffer": ("instance", "master"),
    "pg_local_adjust": ("action", "detail"),
}

PREDICTED_KEYS = ("xtopSetupWns", "xtopHoldWns", "prestaSetupWns", "prestaHoldWns")


def _is_nonempty_string(value):
    return isinstance(value, str) and value != ""


def _is_finite_number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    return not (math.isnan(value) or math.isinf(value))


def _is_plain_int(value):
    return isinstance(value, int) and not isinstance(value, bool)


def _validate_operation_shape(record, op_kind, line_number):
    """Type-check `record`'s fields for `op_kind`; raise `AtcsError("malformed-ops-log", ...)`."""
    for field in STRING_FIELDS.get(op_kind, ()):
        if not _is_nonempty_string(record[field]):
            raise core.AtcsError(
                "malformed-ops-log",
                f"line {line_number}: {op_kind}.{field} must be a non-empty string, got {record[field]!r}",
            )

    if op_kind == "insert_buffer":
        load_pins = record["loadPins"]
        if not isinstance(load_pins, list) or not all(_is_nonempty_string(pin) for pin in load_pins):
            raise core.AtcsError(
                "malformed-ops-log",
                f"line {line_number}: insert_buffer.loadPins must be a list of non-empty strings, "
                f"got {load_pins!r}",
            )
        location = record["location"]
        if location is not None:
            if (
                not isinstance(location, (list, tuple))
                or len(location) != 2
                or not all(_is_finite_number(coord) for coord in location)
            ):
                raise core.AtcsError(
                    "malformed-ops-log",
                    f"line {line_number}: insert_buffer.location must be null or [x, y] finite "
                    f"numbers, got {location!r}",
                )

    if op_kind == "pg_local_adjust":
        region = record["region"]
        if (
            not isinstance(region, (list, tuple))
            or len(region) != 4
            or not all(_is_finite_number(coord) for coord in region)
        ):
            raise core.AtcsError(
                "malformed-ops-log",
                f"line {line_number}: pg_local_adjust.region must be 4 finite numbers, got {region!r}",
            )

    if "group" in record and not _is_plain_int(record["group"]):
        raise core.AtcsError(
            "malformed-ops-log", f"line {line_number}: group must be an int, got {record['group']!r}"
        )


def parse_ops_log(text):
    """Parse ``ops.jsonl`` text into a list of operation dicts.

    Each non-blank line must be a JSON object whose ``"op"`` is one of
    `OPERATION_FIELDS`, which carries every field that op kind requires
    (``"location"`` may be JSON ``null`` for `insert_buffer` — it only has
    to be *present*, not non-null), and whose fields pass
    `_validate_operation_shape` (see module docstring for the exact
    shape rules). Extra fields (e.g. an optional ``"group"`` int) are
    passed through untouched.

    Raises `AtcsError`:
    - ``"malformed-ops-log"`` — a line is not valid JSON, not a JSON
      object, or fails a field's shape/type check.
    - ``"unknown-op"`` — a line's ``"op"`` is not one of `OPERATION_FIELDS`.
    - ``"missing-input"`` — a line is missing one of its op kind's
      required fields.
    - ``"duplicate-new-instance"`` — the same ``newInstance`` appears on
      more than one `insert_buffer` line in this trace.
    """
    operations = []
    seen_new_instances = set()
    for line_number, raw_line in enumerate(text.splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except ValueError as exc:
            raise core.AtcsError("malformed-ops-log", f"line {line_number}: invalid JSON: {exc}") from exc
        if not isinstance(record, dict):
            raise core.AtcsError("malformed-ops-log", f"line {line_number}: not a JSON object")

        op_kind = record.get("op")
        required_fields = OPERATION_FIELDS.get(op_kind)
        if required_fields is None:
            raise core.AtcsError("unknown-op", f"line {line_number}: unknown op {op_kind!r}")

        missing = [field for field in required_fields if field not in record]
        if missing:
            raise core.AtcsError(
                "missing-input", f"line {line_number}: {op_kind} missing field(s) {missing}"
            )

        _validate_operation_shape(record, op_kind, line_number)

        if op_kind == "insert_buffer":
            new_instance = record["newInstance"]
            if new_instance in seen_new_instances:
                raise core.AtcsError(
                    "duplicate-new-instance", f"line {line_number}: duplicate newInstance {new_instance!r}"
                )
            seen_new_instances.add(new_instance)

        operations.append(record)
    return operations


def parse_cell_dump(text):
    """Parse a plain-text cell dump (``"<instance> <master>"`` per line) into a dict.

    Blank lines are skipped. Raises `AtcsError`:
    - ``"malformed-cell-dump"`` — a non-blank line does not split into
      exactly two whitespace-separated tokens.
    - ``"duplicate-instance"`` — the same instance appears on more than
      one line.
    """
    dump = {}
    for line_number, raw_line in enumerate(text.splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) != 2:
            raise core.AtcsError(
                "malformed-cell-dump", f"line {line_number}: expected '<instance> <master>', got {raw_line!r}"
            )
        instance, master = parts
        if instance in dump:
            raise core.AtcsError("duplicate-instance", f"line {line_number}: duplicate instance {instance!r}")
        dump[instance] = master
    return dump


def actual_delta(before, after):
    """The real instance-to-master `delta` between two cell dumps.

    ``{"mastersChanged": {inst: [fromMaster, toMaster]}, "added": {inst:
    master}, "removed": {inst: master}}``. An instance unchanged between
    `before` and `after` (present in both with the same master) never
    appears anywhere in the result — this is what keeps a base dump that
    already carries earlier, unrelated ECO instances from polluting the
    delta: only what actually differs is reported.
    """
    masters_changed = {}
    added = {}
    for instance, master in after.items():
        if instance not in before:
            added[instance] = master
        elif before[instance] != master:
            masters_changed[instance] = [before[instance], master]
    removed = {instance: master for instance, master in before.items() if instance not in after}
    return {"mastersChanged": masters_changed, "added": added, "removed": removed}


def _replay_operations(operations, before):
    """Replay `operations` in order against `before`.

    Returns `(state, precondition_mismatches)`. `state` is the implied
    final instance->master mapping, built *optimistically*: even when a
    precondition below does not hold, the op's own declared effect is
    still applied, so `implied_delta` stays comparable to the actual
    delta even for a mismatched trace. `precondition_mismatches` is a
    list of `{"opIndex", "instance", "detail"}` dicts — see the module
    docstring's "Delta and replay validation" section for the exact rule
    per op kind.
    """
    state = dict(before)
    mismatches = []
    for index, op in enumerate(operations):
        op_kind = op.get("op")
        if op_kind == "size_cell":
            instance = op["instance"]
            current = state.get(instance)
            if instance not in state or current != op["fromMaster"]:
                mismatches.append(
                    {
                        "opIndex": index,
                        "instance": instance,
                        "detail": (
                            f"size_cell op {index}: instance {instance!r} expected prior master "
                            f"{op['fromMaster']!r}, replayed state has {current!r}"
                        ),
                    }
                )
            state[instance] = op["toMaster"]
        elif op_kind == "insert_buffer":
            new_instance = op["newInstance"]
            if new_instance in state:
                mismatches.append(
                    {
                        "opIndex": index,
                        "instance": new_instance,
                        "detail": (
                            f"insert_buffer op {index}: newInstance {new_instance!r} is already "
                            f"present in the replayed state"
                        ),
                    }
                )
            state[new_instance] = op["master"]
        elif op_kind == "delete_buffer":
            instance = op["instance"]
            current = state.get(instance)
            if instance not in state or current != op["master"]:
                mismatches.append(
                    {
                        "opIndex": index,
                        "instance": instance,
                        "detail": (
                            f"delete_buffer op {index}: instance {instance!r} expected prior master "
                            f"{op['master']!r}, replayed state has {current!r}"
                        ),
                    }
                )
            state.pop(instance, None)
        # pg_local_adjust has no cell-master effect and nothing to validate here.
    return state, mismatches


def implied_delta(operations, before):
    """The `delta` the operation trace *says* should happen, replayed from `before`."""
    state, _mismatches = _replay_operations(operations, before)
    return actual_delta(before, state)


def _require(mapping, key, label):
    if not isinstance(mapping, dict) or key not in mapping:
        raise core.AtcsError("missing-input", f"{label}.{key}")
    return mapping[key]


def _read_text(path, label):
    try:
        return Path(path).read_text(encoding="utf-8")
    except OSError as exc:
        raise core.AtcsError("missing-input", f"cannot read {label} at {path}: {exc}") from exc


def _normalize_measure(measure):
    """A Measure with exactly one key and (if `value`) a finite number; `unknown` otherwise."""
    if not isinstance(measure, dict) or len(measure) != 1:
        return core.unknown("not-predicted")
    if "unknown" in measure:
        return measure
    if "value" in measure:
        value = measure["value"]
        if _is_finite_number(value):
            return measure
        return core.unknown(f"non-finite-value: {value!r}")
    return core.unknown("not-predicted")


def _predicted_measures(predicted_in):
    predicted_in = predicted_in if isinstance(predicted_in, dict) else {}
    predicted = {key: _normalize_measure(predicted_in.get(key)) for key in PREDICTED_KEYS}

    has_presta = any(core.is_known(predicted[key]) for key in ("prestaSetupWns", "prestaHoldWns"))
    has_xtop = any(core.is_known(predicted[key]) for key in ("xtopSetupWns", "xtopHoldWns"))
    if has_presta:
        validation_level = "presta"
    elif has_xtop:
        validation_level = "xtop"
    else:
        validation_level = "none"
    return predicted, validation_level


def _dependencies(result_refs):
    raw = result_refs.get("dependencies")
    raw = raw if isinstance(raw, list) else []
    return sorted({str(dependency) for dependency in raw})


def _atomic_groups(operations):
    """Explicit ``"group"``-tagged ops, plus every op on a trace-created instance
    joined with that instance's creating `insert_buffer` (see module docstring)."""
    explicit_by_group = {}
    explicit_order = []
    for index, op in enumerate(operations):
        group_id = op.get("group")
        if group_id is None:
            continue
        if group_id not in explicit_by_group:
            explicit_by_group[group_id] = []
            explicit_order.append(group_id)
        explicit_by_group[group_id].append(index)

    explicit_indices = {index for indices in explicit_by_group.values() for index in indices}
    atomic_groups = [sorted(explicit_by_group[group_id]) for group_id in explicit_order]

    creator_index_by_instance = {}
    for index, op in enumerate(operations):
        if op.get("op") == "insert_buffer" and index not in explicit_indices:
            creator_index_by_instance[op["newInstance"]] = index

    implicit_members_by_creator = {}
    for index, op in enumerate(operations):
        if index in explicit_indices:
            continue
        if op.get("op") not in ("size_cell", "delete_buffer"):
            continue
        creator_index = creator_index_by_instance.get(op.get("instance"))
        if creator_index is None or creator_index == index:
            continue
        implicit_members_by_creator.setdefault(creator_index, {creator_index}).add(index)

    for creator_index in sorted(implicit_members_by_creator):
        atomic_groups.append(sorted(implicit_members_by_creator[creator_index]))

    return atomic_groups


def _preconditions(operations):
    preconditions = []
    seen = set()
    for op in operations:
        op_kind = op.get("op")
        if op_kind == "size_cell":
            if op["instance"] not in seen:
                preconditions.append({"instance": op["instance"], "master": op["fromMaster"]})
            seen.add(op["instance"])
        elif op_kind == "delete_buffer":
            if op["instance"] not in seen:
                preconditions.append({"instance": op["instance"], "master": op["master"]})
            seen.add(op["instance"])
        elif op_kind == "insert_buffer":
            # A trace-created instance is never preconditioned on the base
            # dump — mark it seen so a later op on it adds no precondition.
            seen.add(op["newInstance"])
    return preconditions


def _touches(operations, work_package, result_refs):
    instances = set()
    nets = set()
    regions = []
    for op in operations:
        op_kind = op.get("op")
        if op_kind in ("size_cell", "delete_buffer"):
            instances.add(op["instance"])
        elif op_kind == "insert_buffer":
            instances.add(op["newInstance"])
            nets.add(op["net"])
            nets.add(op["newNet"])
            location = op.get("location")
            if location is not None:
                x, y = location
                regions.append([x, y, x, y])
        elif op_kind == "pg_local_adjust":
            regions.append(list(op["region"]))

    edit_domain = work_package.get("editDomain") or {}
    regions.extend(edit_domain.get("regions") or [])

    checks = set(work_package.get("targets") or []) | set(work_package.get("mayAffect") or [])

    return {
        "instances": sorted(instances),
        "nets": sorted(nets),
        "regions": regions,
        "checks": sorted(checks),
        "cones": list(result_refs.get("cones") or []),
    }


def _region_contained(region, container):
    x1, y1, x2, y2 = region
    cx1, cy1, cx2, cy2 = container
    return cx1 <= x1 and cy1 <= y1 and x2 <= cx2 and y2 <= cy2


def _op_identifier(op):
    """A stable, human-readable label for the object an op touches (for `outOfScope`)."""
    op_kind = op.get("op")
    if op_kind in ("size_cell", "delete_buffer"):
        return op.get("instance")
    if op_kind == "insert_buffer":
        return op.get("newInstance")
    if op_kind == "pg_local_adjust":
        return f"region:{list(op.get('region') or [])}"
    return f"op:{op_kind}"


def _scope_check(operations, work_package, name_prefix):
    """Return `(out_of_scope, refusals)` for `operations` against `work_package`.

    See the module docstring's "Scope rule" section for the full contract:
    editDomain instance/net membership, `pg_local_adjust` region
    containment, and the independent "op kind must be a declared action"
    gate.
    """
    edit_domain = work_package.get("editDomain") or {}
    edit_instances = set(edit_domain.get("instances") or [])
    edit_nets = set(edit_domain.get("nets") or [])
    edit_regions = edit_domain.get("regions") or []
    allowed_actions = set(work_package.get("actions") or [])

    out_of_scope = []
    refusals = []

    for op in operations:
        if op.get("op") not in allowed_actions:
            out_of_scope.append(_op_identifier(op))

    new_instance_in_scope = {}
    for op in operations:
        if op.get("op") != "insert_buffer":
            continue
        new_instance = op["newInstance"]
        in_scope = op["net"] in edit_nets
        new_instance_in_scope[new_instance] = in_scope
        if not in_scope:
            out_of_scope.append(new_instance)
        if not new_instance.startswith(name_prefix):
            refusals.append(
                {
                    "code": "bad-name",
                    "detail": f"newInstance {new_instance!r} does not start with namePrefix {name_prefix!r}",
                }
            )

    for op in operations:
        op_kind = op.get("op")
        if op_kind in ("size_cell", "delete_buffer"):
            instance = op["instance"]
            if instance in new_instance_in_scope:
                if not new_instance_in_scope[instance]:
                    out_of_scope.append(instance)
            elif instance not in edit_instances:
                out_of_scope.append(instance)
        elif op_kind == "pg_local_adjust":
            region = op["region"]
            if not any(_region_contained(region, container) for container in edit_regions):
                out_of_scope.append(_op_identifier(op))

    if out_of_scope:
        refusals.append(
            {"code": "out-of-scope", "detail": f"operations touch objects outside editDomain: {sorted(set(out_of_scope))}"}
        )

    return sorted(set(out_of_scope)), refusals


def _campaign_relative_path(path, manifest):
    """Rewrite `path`'s resolved form to start at `manifest["root"]`; refuse if it never does."""
    root = (manifest.get("root") or "").strip("/")
    if not root:
        raise core.AtcsError("missing-input", "workspaceManifest.root")
    root_parts = Path(root).parts
    resolved_parts = Path(path).resolve().parts
    window = len(root_parts)
    for start in range(len(resolved_parts) - window, -1, -1):
        if resolved_parts[start : start + window] == root_parts:
            return "/".join(resolved_parts[start:])
    raise core.AtcsError("missing-input", f"script path {path} is outside workspace root {root}")


def seal(base_ref, result_refs, operation_trace):
    """Seal a worker's real tool work into a ``contribution`` artifact.

    Raises `AtcsError` only for unusable inputs: an unreadable dump or
    script file, a script path outside its own workspace root, a
    malformed `operation_trace`, or a `base_ref` whose three parts
    disagree with each other. Every other problem (trace vs. actual delta
    mismatch, a stale precondition, out-of-scope edits, a buffer name
    missing its workspace prefix, a `no-fix` with no diagnosis) is
    recorded on the returned, still-stamped contribution as
    `admissible: False` plus `refusals[]` — see the module docstring for
    the full contract.
    """
    manifest = _require(base_ref, "workspaceManifest", "base_ref")
    work_package = _require(base_ref, "workPackage", "base_ref")
    state_id = _require(base_ref, "stateId", "base_ref")

    if manifest.get("baseStateId") != state_id:
        raise core.AtcsError(
            "base-mismatch",
            f"workspaceManifest.baseStateId {manifest.get('baseStateId')!r} != stateId {state_id!r}",
        )
    if work_package.get("baseStateId") != state_id:
        raise core.AtcsError(
            "base-mismatch",
            f"workPackage.baseStateId {work_package.get('baseStateId')!r} != stateId {state_id!r}",
        )
    if manifest.get("workPackageId") != work_package.get("id"):
        raise core.AtcsError(
            "base-mismatch",
            f"workspaceManifest.workPackageId {manifest.get('workPackageId')!r} != workPackage.id {work_package.get('id')!r}",
        )

    task_id = _require(manifest, "taskId", "workspaceManifest")
    revision = _require(manifest, "revision", "workspaceManifest")
    name_prefix = _require(manifest, "namePrefix", "workspaceManifest")

    operations = parse_ops_log(operation_trace)

    before_path = _require(result_refs, "beforeDump", "result_refs")
    after_path = _require(result_refs, "afterDump", "result_refs")
    before = parse_cell_dump(_read_text(before_path, "beforeDump"))
    after = parse_cell_dump(_read_text(after_path, "afterDump"))
    before_dump_sha256 = _dump_sha256(before_path, "beforeDump")

    script_path = result_refs.get("script")
    script = None
    if script_path is not None:
        script = {
            "path": _campaign_relative_path(script_path, manifest),
            "sha256": _script_sha256(script_path),
        }

    kind = "fix" if operations else "no-fix"

    out_of_scope, refusals = _scope_check(operations, work_package, name_prefix)

    delta = actual_delta(before, after)
    implied_state, precondition_mismatches = _replay_operations(operations, before)
    implied = actual_delta(before, implied_state)
    for mismatch in precondition_mismatches:
        refusals.append({"code": "precondition-mismatch", "detail": mismatch["detail"]})
    if delta != implied:
        refusals.append(
            {
                "code": "trace-mismatch",
                "detail": (
                    f"implied delta {core.canonical(implied).decode('utf-8')} != "
                    f"actual delta {core.canonical(delta).decode('utf-8')}"
                ),
            }
        )

    diagnosis = result_refs.get("diagnosis")
    diagnosis_text = diagnosis.strip() if isinstance(diagnosis, str) else ""
    if kind == "no-fix" and not diagnosis_text:
        refusals.append({"code": "no-diagnosis", "detail": "a no-fix contribution requires a diagnosis"})

    predicted, validation_level = _predicted_measures(result_refs.get("predicted"))

    body = {
        "taskId": task_id,
        "revision": revision,
        "baseStateId": state_id,
        "kind": kind,
        "operations": operations,
        "script": script,
        "beforeDumpSha256": before_dump_sha256,
        "delta": delta,
        "touches": _touches(operations, work_package, result_refs),
        "preconditions": _preconditions(operations),
        "dependencies": _dependencies(result_refs),
        "atomicGroups": _atomic_groups(operations),
        "predicted": predicted,
        "validationLevel": validation_level,
        "diagnosis": diagnosis,
        "admissible": not refusals,
        "refusals": refusals,
        "outOfScope": out_of_scope,
    }
    return core.stamp("contribution", body)


def _dump_sha256(path, label):
    try:
        return core.file_sha256(path)
    except OSError as exc:
        raise core.AtcsError("missing-input", f"cannot read {label} at {path}: {exc}") from exc


def _script_sha256(path):
    try:
        return core.file_sha256(path)
    except (OSError, core.AtcsError) as exc:
        raise core.AtcsError("missing-input", f"cannot read script at {path}: {exc}") from exc
