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
dump/script file, a malformed operations log, or a `base_ref` whose three
parts (`stateId`, `workspaceManifest`, `workPackage`) do not agree with
each other. Everything else that can go wrong with the *content* of an
otherwise-readable trace (trace/delta mismatch, out-of-scope edits, a
buffer name missing its workspace prefix, a `no-fix` with no diagnosis) is
recorded as a sealed-but-inadmissible contribution (`admissible: False`,
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
through untouched, never stripped.

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
    }

`beforeDump`/`afterDump` are file paths because `seal` must read the
*actual* native state, not trust a summary of it — per
`knowledge/contribution-and-merge.md`: "结构化操作描述负责比较和前置
条件；源脚本与原生状态负责核实，不能让模型摘要替代真实 diff." An
unreadable dump or script file is `AtcsError("missing-input", ...)`.

``operation_trace`` is the raw ``ops.jsonl`` text (not a path) — `seal`
parses it itself via `parse_ops_log`, so a malformed trace surfaces as
whatever `AtcsError` `parse_ops_log` raises, uncaught.

Scope rule
----------

An operation's touched instance is in scope when it is a member of the
work package's ``editDomain.instances``; for `insert_buffer` there is no
existing instance to check, so scope instead asks whether the buffered
`net` is a member of ``editDomain.nets``, and the newly-created instance
inherits that op's scope verdict. `pg_local_adjust` has neither an
`instance` nor a `net` field and is deliberately not scope-checked here —
its objects are regions, not cell-dump entries, and this task's brief does
not specify a region-based scope rule for it. Every out-of-scope object
found is collected into `outOfScope` and also turns into one
`"out-of-scope"` refusal (so `admissible` is `False`).

Atomic groups
-------------

Two independent ways an atomic group is recorded, per
``knowledge/contribution-and-merge.md``'s "原子提交与部分采用" and this
task's Decisions:

1. **Explicit**: any ops carrying the same integer ``"group"`` field form
   one atomic group, regardless of position in the trace.
2. **Implicit**: an `insert_buffer` operation immediately followed (next
   line in the trace) by a `size_cell` operation on that same
   `insert_buffer`'s own `newInstance` — i.e. sizing the buffer you just
   inserted, its new driver role for the net it now drives — is one
   atomic group. This detection only applies to a pair where *neither* op
   already carries an explicit `"group"` field (an explicit annotation
   always wins over the inferred pattern).

Each group is `[opIndex, ...]`, indices into the sealed `operations` list.

Preconditions
-------------

A precondition records what the *base* state (not any intermediate,
in-trace state) must show for the whole trace to still validly apply:
`{"instance": "<inst>", "master": "<master the base dump must show>"}`.
Only the *first* time an instance is referenced by `size_cell.fromMaster`
or `delete_buffer.master` contributes a precondition — a later op on the
same instance depends on this trace's own earlier effect, not on the base
dump, so it is not a fresh precondition (that dependency is captured by
`implied_delta` replaying the trace in order instead).

Delta
-----

`delta` is always `actual_delta(before, after)` — the real object-level
diff of the two dumps, exactly as `AGENTIC_TIMING_CLOSURE_SYSTEM_ARCHITECTURE.zh-CN.md`
§5.2 requires: bounded by the common base, never inferred from log length.
`implied_delta(operations, before)` independently replays the trace
in order against `before` (`size_cell` overwrites the target's master,
`insert_buffer` adds `newInstance` with `master`, `delete_buffer` removes
`instance`; `pg_local_adjust` has no cell-master effect) and diffs the
resulting state against `before` the same way. When the two deltas
disagree, the trace does not actually explain the real change, so `seal`
records a `"trace-mismatch"` refusal.
"""
from __future__ import annotations

import json
from pathlib import Path

from . import core


OPERATION_FIELDS = {
    "size_cell": ("instance", "fromMaster", "toMaster"),
    "insert_buffer": ("net", "loadPins", "newInstance", "newNet", "master", "location"),
    "delete_buffer": ("instance", "master"),
    "pg_local_adjust": ("region", "action", "detail"),
}

PREDICTED_KEYS = ("xtopSetupWns", "xtopHoldWns", "prestaSetupWns", "prestaHoldWns")


def parse_ops_log(text):
    """Parse ``ops.jsonl`` text into a list of operation dicts.

    Each non-blank line must be a JSON object whose ``"op"`` is one of
    `OPERATION_FIELDS` and which carries every field that op kind requires
    (``"location"`` may be JSON ``null`` for `insert_buffer` — it only has
    to be *present*, not non-null). Extra fields (e.g. an optional
    ``"group"`` int) are passed through untouched.

    Raises `AtcsError`:
    - ``"malformed-ops-log"`` — a line is not valid JSON, or not a JSON
      object.
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


def _apply_operations(operations, before):
    """Replay `operations` in order against `before`; return the implied final state."""
    state = dict(before)
    for op in operations:
        op_kind = op.get("op")
        if op_kind == "size_cell":
            state[op["instance"]] = op["toMaster"]
        elif op_kind == "insert_buffer":
            state[op["newInstance"]] = op["master"]
        elif op_kind == "delete_buffer":
            state.pop(op["instance"], None)
        # pg_local_adjust has no cell-master effect.
    return state


def implied_delta(operations, before):
    """The `delta` the operation trace *says* should happen, replayed from `before`."""
    return actual_delta(before, _apply_operations(operations, before))


def _require(mapping, key, label):
    if not isinstance(mapping, dict) or key not in mapping:
        raise core.AtcsError("missing-input", f"{label}.{key}")
    return mapping[key]


def _read_text(path, label):
    try:
        return Path(path).read_text(encoding="utf-8")
    except OSError as exc:
        raise core.AtcsError("missing-input", f"cannot read {label} at {path}: {exc}") from exc


def _predicted_measures(predicted_in):
    predicted_in = predicted_in if isinstance(predicted_in, dict) else {}
    predicted = {}
    for key in PREDICTED_KEYS:
        measure = predicted_in.get(key)
        if isinstance(measure, dict) and ("value" in measure or "unknown" in measure):
            predicted[key] = measure
        else:
            predicted[key] = core.unknown("not-predicted")

    has_presta = any(core.is_known(predicted[key]) for key in ("prestaSetupWns", "prestaHoldWns"))
    has_xtop = any(core.is_known(predicted[key]) for key in ("xtopSetupWns", "xtopHoldWns"))
    if has_presta:
        validation_level = "presta"
    elif has_xtop:
        validation_level = "xtop"
    else:
        validation_level = "none"
    return predicted, validation_level


def _atomic_groups(operations):
    """Explicit ``"group"``-tagged ops, plus implicit insert+size-its-driver pairs."""
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

    for index in range(len(operations) - 1):
        if index in explicit_indices or (index + 1) in explicit_indices:
            continue
        current_op = operations[index]
        next_op = operations[index + 1]
        if (
            current_op.get("op") == "insert_buffer"
            and next_op.get("op") == "size_cell"
            and next_op.get("instance") == current_op.get("newInstance")
        ):
            atomic_groups.append([index, index + 1])

    return atomic_groups


def _preconditions(operations):
    preconditions = []
    seen = set()
    for op in operations:
        op_kind = op.get("op")
        if op_kind == "size_cell" and op["instance"] not in seen:
            preconditions.append({"instance": op["instance"], "master": op["fromMaster"]})
            seen.add(op["instance"])
        elif op_kind == "delete_buffer" and op["instance"] not in seen:
            preconditions.append({"instance": op["instance"], "master": op["master"]})
            seen.add(op["instance"])
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

    edit_domain = work_package.get("editDomain") or {}
    regions.extend(edit_domain.get("regions") or [])

    return {
        "instances": sorted(instances),
        "nets": sorted(nets),
        "regions": regions,
        "checks": list(work_package.get("targets") or []),
        "cones": list(result_refs.get("cones") or []),
    }


def _scope_check(operations, work_package, name_prefix):
    """Return `(out_of_scope, refusals)` for `operations` against `work_package.editDomain`.

    Two passes: the first records, for every `insert_buffer`, whether its
    new instance is in scope (its `net` is in `editDomain.nets`) — this is
    "a new instance is in scope when its op is in scope" from the module
    docstring's Scope rule. The second pass checks `size_cell`/
    `delete_buffer` targets: an instance created earlier in *this same
    trace* is judged by that recorded verdict, never by
    `editDomain.instances` membership (a freshly-inserted buffer was never
    going to be enumerated there — it did not exist in the base design).
    Any other `size_cell`/`delete_buffer` target must be in
    `editDomain.instances` directly.
    """
    edit_domain = work_package.get("editDomain") or {}
    edit_instances = set(edit_domain.get("instances") or [])
    edit_nets = set(edit_domain.get("nets") or [])

    out_of_scope = []
    refusals = []
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
        if op_kind not in ("size_cell", "delete_buffer"):
            continue
        instance = op["instance"]
        if instance in new_instance_in_scope:
            if not new_instance_in_scope[instance]:
                out_of_scope.append(instance)
        elif instance not in edit_instances:
            out_of_scope.append(instance)
        # pg_local_adjust: not scope-checked (see module docstring).

    if out_of_scope:
        refusals.append(
            {"code": "out-of-scope", "detail": f"operations touch objects outside editDomain: {sorted(set(out_of_scope))}"}
        )

    return sorted(set(out_of_scope)), refusals


def seal(base_ref, result_refs, operation_trace):
    """Seal a worker's real tool work into a ``contribution`` artifact.

    Raises `AtcsError` only for unusable inputs: an unreadable dump or
    script file, a malformed `operation_trace`, or a `base_ref` whose
    three parts disagree with each other. Every other problem (trace vs.
    actual delta mismatch, out-of-scope edits, a buffer name missing its
    workspace prefix, a `no-fix` with no diagnosis) is recorded on the
    returned, still-stamped contribution as `admissible: False` plus
    `refusals[]` — see the module docstring for the full contract.
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

    script_path = result_refs.get("script")
    script = None
    if script_path is not None:
        script = {"path": str(script_path), "sha256": _script_sha256(script_path)}

    kind = "fix" if operations else "no-fix"

    out_of_scope, refusals = _scope_check(operations, work_package, name_prefix)

    delta = actual_delta(before, after)
    implied = implied_delta(operations, before)
    if delta != implied:
        refusals.append(
            {"code": "trace-mismatch", "detail": f"implied delta {implied} != actual delta {delta}"}
        )

    diagnosis = result_refs.get("diagnosis")
    if kind == "no-fix" and not diagnosis:
        refusals.append({"code": "no-diagnosis", "detail": "a no-fix contribution requires a diagnosis"})

    predicted, validation_level = _predicted_measures(result_refs.get("predicted"))

    body = {
        "taskId": task_id,
        "revision": revision,
        "baseStateId": state_id,
        "kind": kind,
        "operations": operations,
        "script": script,
        "delta": delta,
        "touches": _touches(operations, work_package, result_refs),
        "preconditions": _preconditions(operations),
        "dependencies": [],
        "atomicGroups": _atomic_groups(operations),
        "predicted": predicted,
        "validationLevel": validation_level,
        "diagnosis": diagnosis,
        "admissible": not refusals,
        "refusals": refusals,
        "outOfScope": out_of_scope,
    }
    return core.stamp("contribution", body)


def _script_sha256(path):
    try:
        return core.file_sha256(path)
    except (OSError, core.AtcsError) as exc:
        raise core.AtcsError("missing-input", f"cannot read script at {path}: {exc}") from exc
