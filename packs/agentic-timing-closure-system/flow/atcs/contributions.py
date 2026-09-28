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
genuinely *unusable* inputs: `seal` raises `AtcsError` for an unreadable or
non-UTF-8 dump/script file, a script path that resolves outside its own
workspace root, a malformed operations log, a malformed `dependencies`
list, or a `base_ref` whose three parts (`stateId`, `workspaceManifest`,
`workPackage`) do not agree with each other. Everything else that can go
wrong with the *content* of an otherwise-readable trace (trace/delta
mismatch, a precondition the replayed state does not actually hold,
out-of-scope edits, an op kind the work package never declared, a buffer
name missing its workspace prefix, a `no-fix` with no diagnosis) is
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
through untouched, never stripped. Every string-shaped field above
(`instance`, `fromMaster`, `toMaster`, `net`, `newInstance`, `newNet`,
`master`, each `loadPins` entry, `action`, `detail`) must be a non-empty
string; `location` must be JSON `null` or exactly two finite numbers;
`region` must be exactly four finite numbers with `x1 <= x2` and
`y1 <= y2` (an inverted box is rejected, not silently normalized — this
module never guesses which corner the author meant); `group`, when
present, must be a plain `int` (not `bool`, not a `float`). `parse_ops_log`
rejects any violation as `AtcsError("malformed-ops-log", ...)` — a shape a
downstream consumer could not safely use is never silently passed through.

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
条件；源脚本与原生状态负责核实，不能让模型摘要替代真实 diff." Each is
read exactly once, as bytes; those same bytes are decoded (UTF-8) for
`parse_cell_dump`, and for `beforeDump` also hashed, unmodified, into
`beforeDumpSha256` on the sealed contribution — never a second, separate
read of the file — so M4 can check that two contributions claiming the
same `baseStateId` actually started from the same native state, not just
the same declared id. An unreadable or non-UTF-8 dump or script file is
`AtcsError("missing-input", ...)`.

`script`, when given, is stored on the contribution with its `path`
rewritten to be **campaign-relative** — everything from
`workspaceManifest["root"]` onward in its resolved filesystem path — so
`contribution["id"]` never depends on where the campaign happens to be
checked out on disk (see `_campaign_relative_path`). A script path that
does not resolve to somewhere under its own workspace root is
`AtcsError("script-outside-workspace", ...)`: a script from outside the
workspace the manifest describes is not evidence this contribution can
stand on.

`dependencies` (optional) is copied onto the sealed contribution as a
sorted, de-duplicated list — the *revisions this one builds on*, supplied
by the caller (e.g. a resubmission after M4/M5 asked for a revised
contribution). Absent or `None` becomes `[]`; anything else that is not a
list, or a list containing anything that is not itself a non-empty
string, is `AtcsError("malformed-input", ...)` — a dependency id is an
identifier a later lookup will use verbatim, so it is never coerced or
guessed at. `seal` never infers dependencies on its own; cross-contribution
dependency *detection* is M4's `analyze` job.

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
or outside all of them, is out of scope. Every out-of-scope object found
this way (an instance or a `pg_local_adjust` region) is collected into
`outOfScope` and turns into one `"out-of-scope"` refusal.

Independently of all of the above, **every** op's own kind must be a
member of `workPackage.actions` — this is the same gate M2's
`validate_work_package` applies to the whole package (e.g. `pg_local_adjust`
needing `siteCapabilities.pgVerification` to even be a declared action),
re-checked here per-op because a specific trace can still emit an op kind
the *package* never declared. This is a different kind of problem from an
in-scope-but-wrong-object edit — the operation itself isn't permitted,
regardless of what it touches — so it gets its own `"action-not-allowed"`
refusal (naming the disallowed op kinds) and is never added to
`outOfScope`.

Atomic groups
-------------

Every atomic group is one connected component of a union-find merge over
two independent kinds of edge — **neither suppresses the other; both
always merge into the same component** (a controller decision: an
explicit `"group"` tag adds a relationship, it never overrides one):

1. **Explicit**: every pair of ops carrying the same integer ``"group"``
   field is unioned together, wherever they sit in the trace.
2. **Creator→dependent**: every `size_cell`/`delete_buffer` operation that
   targets an instance created earlier in the *same trace* by an
   `insert_buffer` is unioned with that creating `insert_buffer` —
   regardless of how far apart they are, and regardless of whether either
   op also carries an explicit `"group"` tag.

Because the two kinds of edge merge instead of one overriding the other,
an explicit `"group"` tag connecting an `insert_buffer` to some unrelated
op, plus a later untagged op that targets that `insert_buffer`'s own new
instance, all end up in **one** merged group — the explicit edge and the
creator→dependent edge share the `insert_buffer`'s index, so union-find
joins all three regardless of which edge was recorded first.

Only connected components with **two or more** members are reported (a
lone `"group"` tag on an otherwise-unconnected op describes no actual
coupling, so it is not surfaced as a group of one). Each group is
`[opIndex, ...]`, sorted ascending, indices into the sealed `operations`
list; the list of groups is itself sorted by each group's smallest index,
so the result is deterministic regardless of dict/set iteration order.

Grouping an *upstream driver* with an insertion — e.g. resizing the
pre-existing gate that used to drive a net, once a buffer now sits
between it and its loads — is a different relationship: the operation
schema has no `driver` field connecting a `size_cell` on a pre-existing
instance to a particular `insert_buffer` on the net it drives, so this
module has no creator→dependent edge to infer there. That kind of atomic
grouping can only be expressed by both ops carrying the same explicit
`"group"` value; this is a controller decision, not an oversight.

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

import fnmatch
import hashlib
import json
import math
import re
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
        x1, y1, x2, y2 = region
        if x1 > x2 or y1 > y2:
            raise core.AtcsError(
                "malformed-ops-log",
                f"line {line_number}: pg_local_adjust.region must have x1<=x2 and y1<=y2, got {region!r}",
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


def _read_dump_bytes(path, label):
    try:
        return Path(path).read_bytes()
    except OSError as exc:
        raise core.AtcsError("missing-input", f"cannot read {label} at {path}: {exc}") from exc


def _decode_utf8(data, path, label):
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise core.AtcsError("missing-input", f"{label} at {path} is not valid UTF-8: {exc}") from exc


def _normalize_measure(measure):
    """A Measure with exactly one key: `value` a finite number, or `unknown` a non-empty reason.

    Anything else — not a single-key dict, an `unknown` whose reason is
    not a non-empty string, or a `value` that is not a finite number — is
    itself replaced by `unknown`, never passed through malformed.
    """
    if not isinstance(measure, dict) or len(measure) != 1:
        return core.unknown("not-predicted")
    if "unknown" in measure:
        if _is_nonempty_string(measure["unknown"]):
            return measure
        return core.unknown("malformed measure")
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
    """`result_refs["dependencies"]`, validated: absent/`None` -> `[]`, else a sorted set of ids.

    Raises `AtcsError("malformed-input", ...)` when present but not a
    list, or when any entry is not a non-empty string — a dependency id is
    used verbatim by later lookups, so it is never coerced or guessed at.
    """
    raw = result_refs.get("dependencies")
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise core.AtcsError("malformed-input", f"result_refs.dependencies must be a list, got {raw!r}")
    for entry in raw:
        if not _is_nonempty_string(entry):
            raise core.AtcsError(
                "malformed-input", f"result_refs.dependencies entries must be non-empty strings, got {entry!r}"
            )
    return sorted(set(raw))


def _uf_find(parent, item):
    root = item
    while parent[root] != root:
        root = parent[root]
    while parent[item] != root:
        parent[item], item = root, parent[item]
    return root


def _uf_union(parent, left, right):
    root_left, root_right = _uf_find(parent, left), _uf_find(parent, right)
    if root_left != root_right:
        parent[root_right] = root_left


def _atomic_groups(operations):
    """Union-find over explicit ``"group"`` membership and creator→dependent
    edges (see module docstring's "Atomic groups" section for the full rule —
    the two kinds of edge always merge, neither one suppresses the other)."""
    parent = list(range(len(operations)))

    first_index_by_group = {}
    for index, op in enumerate(operations):
        group_id = op.get("group")
        if group_id is None:
            continue
        if group_id in first_index_by_group:
            _uf_union(parent, first_index_by_group[group_id], index)
        else:
            first_index_by_group[group_id] = index

    creator_index_by_instance = {}
    for index, op in enumerate(operations):
        if op.get("op") == "insert_buffer":
            creator_index_by_instance[op["newInstance"]] = index

    for index, op in enumerate(operations):
        if op.get("op") not in ("size_cell", "delete_buffer"):
            continue
        creator_index = creator_index_by_instance.get(op.get("instance"))
        if creator_index is not None and creator_index != index:
            _uf_union(parent, creator_index, index)

    members_by_root = {}
    for index in range(len(operations)):
        root = _uf_find(parent, index)
        members_by_root.setdefault(root, []).append(index)

    groups = [sorted(members) for members in members_by_root.values() if len(members) > 1]
    groups.sort(key=lambda members: members[0])
    return groups


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

    See the module docstring's "Scope rule" section for the full contract.
    editDomain instance/net/region membership feeds `outOfScope` and one
    `"out-of-scope"` refusal. An op kind absent from `workPackage.actions`
    is a different problem — the operation itself isn't permitted,
    regardless of what it touches — so it gets its own
    `"action-not-allowed"` refusal (naming the disallowed kinds) and is
    never added to `outOfScope`.
    """
    edit_domain = work_package.get("editDomain") or {}
    edit_instances = set(edit_domain.get("instances") or [])
    edit_nets = set(edit_domain.get("nets") or [])
    edit_regions = edit_domain.get("regions") or []
    allowed_actions = set(work_package.get("actions") or [])

    out_of_scope = []
    refusals = []

    disallowed_kinds = sorted({op.get("op") for op in operations if op.get("op") not in allowed_actions})
    if disallowed_kinds:
        refusals.append(
            {
                "code": "action-not-allowed",
                "detail": f"op kinds not declared in workPackage.actions: {disallowed_kinds}",
            }
        )

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
    """Rewrite `path`'s resolved form to start at `manifest["root"]`.

    Searches the resolved (absolute, symlink-free) form of `path` for the
    *rightmost* occurrence of `manifest["root"]`'s own path components
    (e.g. `("workspaces", "w01", "r1")`) and returns everything from there
    onward, joined with `/`.

    This is a heuristic, not a guarantee: it trusts that those components
    identify *this* workspace uniquely within the path. That holds for
    every layout `workspaces.prepare` itself creates
    (`<campaign_root>/workspaces/<taskId>/r<revision>/`), but a
    pathologically nested layout (e.g. a backup of the campaign root
    copied *inside* the campaign root) could in principle contain the same
    component sequence twice; searching from the right — preferring the
    deepest/last match — is what keeps an accidental *earlier* occurrence
    from being chosen over the real workspace directory in that case, but
    it cannot detect the ambiguity itself.

    Raises `AtcsError("script-outside-workspace", ...)` when no such
    occurrence exists at all — the script does not appear to live
    anywhere under its own workspace root, which is either a caller wiring
    bug or a script whose provenance is not evidence this contribution can
    stand on.
    """
    root = (manifest.get("root") or "").strip("/")
    if not root:
        raise core.AtcsError("missing-input", "workspaceManifest.root")
    root_parts = Path(root).parts
    resolved_parts = Path(path).resolve().parts
    window = len(root_parts)
    for start in range(len(resolved_parts) - window, -1, -1):
        if resolved_parts[start : start + window] == root_parts:
            return "/".join(resolved_parts[start:])
    raise core.AtcsError(
        "script-outside-workspace", f"script path {path} is outside workspace root {root}"
    )


def _check_base(manifest, work_package, state_id):
    """`AtcsError("base-mismatch", ...)` unless the manifest, work package and state id agree."""
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


def seal(base_ref, result_refs, operation_trace):
    """Seal a worker's real tool work into a ``contribution`` artifact.

    Raises `AtcsError` only for unusable inputs: an unreadable or
    non-UTF-8 dump or script file, a script path outside its own
    workspace root, a malformed `operation_trace`, a malformed
    `dependencies` list, or a `base_ref` whose three parts disagree with
    each other. Every other problem (trace vs. actual delta mismatch, a
    stale precondition, out-of-scope edits, an undeclared op kind, a
    buffer name missing its workspace prefix, a `no-fix` with no
    diagnosis) is recorded on the returned, still-stamped contribution as
    `admissible: False` plus `refusals[]` — see the module docstring for
    the full contract.
    """
    manifest = core.require(base_ref, "workspaceManifest", "base_ref")
    work_package = core.require(base_ref, "workPackage", "base_ref")
    state_id = core.require(base_ref, "stateId", "base_ref")

    _check_base(manifest, work_package, state_id)

    task_id = core.require(manifest, "taskId", "workspaceManifest")
    revision = core.require(manifest, "revision", "workspaceManifest")
    name_prefix = core.require(manifest, "namePrefix", "workspaceManifest")

    operations = parse_ops_log(operation_trace)

    before_path = core.require(result_refs, "beforeDump", "result_refs")
    after_path = core.require(result_refs, "afterDump", "result_refs")
    dependencies = _dependencies(result_refs)
    before_bytes = _read_dump_bytes(before_path, "beforeDump")
    before_dump_sha256 = hashlib.sha256(before_bytes).hexdigest()
    before = parse_cell_dump(_decode_utf8(before_bytes, before_path, "beforeDump"))
    after_bytes = _read_dump_bytes(after_path, "afterDump")
    after = parse_cell_dump(_decode_utf8(after_bytes, after_path, "afterDump"))

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
        "dependencies": dependencies,
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


# ---------------------------------------------------------------------------
# Issue #64 Task 4: `xtop-session` Contributions (the Task 3 expert toolkit)
# ---------------------------------------------------------------------------
#
# A worker's interactive XTop session (``templates/xtop-operator.tcl``) writes
# ``ops.jsonl`` (one line per mutation that reached XTop), ``gain.jsonl``
# (``summarize_gba_violations`` readings) and, once tainted, ``tainted.json``.
# `seal_session` turns those plus the before/after cell dumps into one sealed
# Contribution. Its shape adds these fields to the legacy one:
#
# - ``commands``: the net kept command log -- every ``status == "kept"``
#   non-undo line, minus every seq a kept undo line names in ``undoes``, in
#   log order. ``discards`` seqs (empty checkpoints) were never kept. Each
#   entry is ``{"seq","proc","cmd","args","before","after","instances"
#   [,"newNets"][,"verified"][,"ecoCells"][,"fillers"]}``: a replay calls
#   ``proc`` with ``args`` (``planSha256`` included, as the Host sent it);
#   ``instances`` is every instance the line observed, which composition
#   uses for `skip: shared-instance`.
# - ``delta``: `actual_delta` of the two dumps (authoritative); removable
#   filler cells it exempts are named in ``fillerChanges``.
# - ``predicted`` / ``reference``: Measures read from the ``total`` rows of the
#   last mutation/undo gain line and the seq-0 reference line
#   (``xtop{Setup,Hold}{Wns,Tns}``); ``gainSummary`` holds both readings'
#   full per-scenario `parse_gain_summary` sections.
# - ``failReasons``: ``{check: {reason: count}}`` from the last
#   ``-with_fail_reason`` reading that reflects the final state, else ``{}``.
# - ``value`` (ns) and ``valueDetail``: the ranking value, see `_session_value`.
# - ``targets`` / ``targetPins``: the work package's own, for blocker coverage.
# - ``operations: []``, ``preconditions: []``, ``atomicGroups: []``: the
#   legacy replay has nothing to do for a session.
#
# ``kind`` is ``"xtop-session"`` when ``commands`` is non-empty, else
# ``"no-fix"`` with a deterministic diagnosis. Refusal codes (the
# Contribution is still sealed and returned, never raised away):
#
# - ``tainted``: ``tainted.json`` exists, an ``uncertain`` line exists, or the
#   XTop transcript's ``ATCS:taint:`` line is missing or not ``clean``;
# - ``missing-gain-line``: a kept line has no gain line of its kind and seq,
#   or the last gain line predates the last kept line;
# - ``missing-export``: kept commands but no ``eco_output/`` files;
# - ``trace-mismatch``: the log does not explain the dump delta (a logged
#   change the dump lacks, an untraced in-domain change, a precondition the
#   running state does not hold, a kept typed request whose logged effect
#   is not what it asked for, an undo that is not the top of the kept
#   stack, or a seq gap);
# - ``out-of-scope``: a changed object outside the domain, collected into
#   ``outOfScope``. The domain is ``editDomain.instances`` plus instances
#   this session created whose leaf name starts with ``namePrefix``;
# - ``no-predicted-gain``: kept commands whose predicted target slack got
#   worse, did not improve at all, or cannot be read;
# - ``breaks-opposite-check``: kept commands whose predicted non-target
#   check (setup for a hold repair, and so on) got worse in WNS or TNS by
#   more than one rounding step, or cannot be read.
#
# Typed requests (size/exchange/insert/remove) must show exactly their
# requested effect in their own logged delta; fixes, splits, moves and
# ``verified: "eco-actions"`` lines are accepted from their observed delta.
# Either way the whole net log, replayed over the before dump, must equal
# the after dump except for exempt fillers.

SESSION_COMMANDS = (
    "size_cell", "exchange_cell", "insert_buffer", "insert_dummy_cell", "split_load", "split_net",
    "move_cell", "remove_buffer", "fix_hold_gba_violations", "fix_setup_gba_violations", "undo",
)
SESSION_STATUSES = ("kept", "no-change", "error", "reverted", "uncertain")
GAIN_KINDS = ("reference", "mutation", "undo", "probe")
SESSION_CHECKS = ("setup", "hold")
_OPTIONAL_NAME_LISTS = ("newNets", "fillers", "ecoCells")
_NUMBER = re.compile(r"^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$")
_SUMMARY_COLUMNS = {"Count": "count", "Count0": "count0", "D_Count": "dCount", "Worst": "worst",
                    "Worst0": "worst0", "D_Worst": "dWorst", "TNS": "tns", "TNS0": "tns0", "D_TNS": "dTns"}
_SUMMARY_SECTION = re.compile(r"^###\s+(setup|hold)\s+summary\s+###\s*$")
_INT_COLUMNS = ("count", "count0", "dCount")
# Rows print 4 decimals; a delta column may differ from its own difference by one rounding step each side.
_DELTA_TOLERANCE = 1.5e-4
_FAIL_REASON_ROW = re.compile(r"^\s*([a-z][a-z0-9_]*)\s*[:=]?\s+(\d+)\s*$")


def is_session_log(text):
    """True when the first non-blank line of `text` is a Task 3 toolkit line (``seq``/``proc``, no ``op``)."""
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except ValueError:
            return False
        return isinstance(record, dict) and "op" not in record and "proc" in record and "seq" in record
    return False


def _malformed(line_number, detail, code="malformed-ops-log"):
    return core.AtcsError(code, f"line {line_number}: {detail}")


def _instance_map(value, line_number, label):
    if not isinstance(value, dict) or not isinstance(value.get("instances"), dict):
        raise _malformed(line_number, f"{label} must be {{\"instances\": {{name: master|null}}}}")
    instances = value["instances"]
    for name, master in instances.items():
        if not _is_nonempty_string(name) or not (master is None or _is_nonempty_string(master)):
            raise _malformed(line_number, f"{label}.instances[{name!r}] must map a name to a master or null")
    return dict(instances)


def parse_session_log(text):
    """Parse a Task 3 ``ops.jsonl`` into its line dicts, fail-closed on shape.

    Raises `AtcsError("malformed-ops-log", ...)` for a line that is not a
    JSON object, a ``seq`` that is not a positive int strictly above the
    previous line's, an unknown ``cmd``/``status``, a ``proc`` that is not an
    ``atcs_*`` name, non-object ``args``, a malformed ``before``/``after``,
    a non-``uncertain`` undo line without an int ``undoes`` and an int-list ``discards``, or
    a malformed optional field (``newNets``/``fillers``/``ecoCells`` string
    lists, ``matchesRequest`` bool, ``verified`` string). An ``uncertain``
    line may omit ``before``/``after`` (read as empty) and, for an undo,
    ``undoes``/``discards``: `atcs_fail_uncertain` writes it without them,
    and it taints the slot anyway. A gap in ``seq`` is content, not shape:
    `seal_session` records it as a refusal.
    """
    lines = []
    previous_seq = 0
    for line_number, raw_line in enumerate(text.splitlines(), start=1):
        stripped = raw_line.strip()
        if not stripped:
            continue
        try:
            record = json.loads(stripped)
        except ValueError as exc:
            raise _malformed(line_number, f"invalid JSON: {exc}") from exc
        if not isinstance(record, dict):
            raise _malformed(line_number, "not a JSON object")
        seq = record.get("seq")
        if not _is_plain_int(seq) or seq <= previous_seq:
            raise _malformed(line_number, f"seq must be an int above {previous_seq}, got {seq!r}")
        previous_seq = seq
        if record.get("cmd") not in SESSION_COMMANDS:
            raise _malformed(line_number, f"unknown cmd {record.get('cmd')!r}")
        proc = record.get("proc")
        if not _is_nonempty_string(proc) or not proc.startswith("atcs_"):
            raise _malformed(line_number, f"proc must be an atcs_* procedure, got {proc!r}")
        if not isinstance(record.get("args"), dict):
            raise _malformed(line_number, "args must be an object")
        if record.get("status") not in SESSION_STATUSES:
            raise _malformed(line_number, f"unknown status {record.get('status')!r}")
        uncertain = record["status"] == "uncertain"
        # `atcs_fail_uncertain` logs {seq,cmd,proc,args,status,observe,error} only: an uncertain line
        # may lack before/after (and, for an undo, undoes/discards). It taints the slot either way.
        for side in ("before", "after"):
            if uncertain and side not in record:
                record[side] = {"instances": {}}
            else:
                record[side] = {"instances": _instance_map(record.get(side), line_number, side)}
        if record["cmd"] == "undo" and not uncertain:
            discards = record.get("discards")
            if not _is_plain_int(record.get("undoes")) or not isinstance(discards, list) \
                    or not all(_is_plain_int(item) for item in discards):
                raise _malformed(line_number, "an undo line needs an int undoes and an int-list discards")
        for key in _OPTIONAL_NAME_LISTS:
            if key in record and (not isinstance(record[key], list)
                                  or not all(_is_nonempty_string(item) for item in record[key])):
                raise _malformed(line_number, f"{key} must be a list of names")
        if "matchesRequest" in record and not isinstance(record["matchesRequest"], bool):
            raise _malformed(line_number, "matchesRequest must be a bool")
        if "verified" in record and not _is_nonempty_string(record["verified"]):
            raise _malformed(line_number, "verified must be a string")
        lines.append(record)
    return lines


def parse_gain_log(text):
    """Parse ``gain.jsonl`` into its line dicts; `AtcsError("malformed-gain-log", ...)` on shape.

    Each line is ``{"seq": int >= 0, "kind": reference|mutation|undo|probe,
    "checks": {"setup"|"hold": {"command": str, "code": int, "text": str}}}``.
    """
    lines = []
    for line_number, raw_line in enumerate(text.splitlines(), start=1):
        stripped = raw_line.strip()
        if not stripped:
            continue
        try:
            record = json.loads(stripped)
        except ValueError as exc:
            raise _malformed(line_number, f"invalid JSON: {exc}", "malformed-gain-log") from exc
        if not isinstance(record, dict) or not _is_plain_int(record.get("seq")) or record["seq"] < 0:
            raise _malformed(line_number, "a gain line needs an int seq >= 0", "malformed-gain-log")
        if record.get("kind") not in GAIN_KINDS:
            raise _malformed(line_number, f"unknown gain kind {record.get('kind')!r}", "malformed-gain-log")
        checks = record.get("checks")
        if not isinstance(checks, dict) or not set(checks) <= set(SESSION_CHECKS):
            raise _malformed(line_number, "checks must map setup/hold to readings", "malformed-gain-log")
        for check, entry in checks.items():
            if (not isinstance(entry, dict) or not isinstance(entry.get("command"), str)
                    or not _is_plain_int(entry.get("code")) or not isinstance(entry.get("text"), str)):
                raise _malformed(line_number, f"checks.{check} needs command, int code and text", "malformed-gain-log")
        lines.append(record)
    return lines


def parse_gain_summary(text):
    """Parse ``summarize_gba_violations`` output into ``{check: {"total": row, "scenarios": {name: row}}}``.

    Pinned to real XTop 2025.09 output (the old flow's server run; verbatim in
    ``tests/xtop_summary_samples.py``). Each check prints one section::

        ### hold summary ###
        Scenario                  Count      Worst        TNS            (-as_reference)
        Scenario  Count Count0 D_Count | Worst Worst0 D_Worst | TNS TNS0 D_TNS   (-with_reference -with_delta)
        ------...
        total                        70    -0.1542    -3.9661
          func_ffg_cbest_125         44    -0.0764    -0.7568

    Columns map to ``count``/``count0``/``dCount`` (ints), ``worst``/``worst0``/
    ``dWorst`` and ``tns``/``tns0``/``dTns`` (ns): the plain column is the
    current design, ``...0`` is the session reference, ``D_...`` their
    difference. ``Worst`` is the worst slack (``0.0000`` when nothing
    violates) and ``TNS`` is negative when violating. ``|`` separators are
    ignored; a blank line or the next ``###`` line ends the table, and text
    outside a table (the ``summarize_eco_actions`` table) is skipped.

    Fail closed: a section is dropped (absent from the result) when any
    line of its table (after the header, before the table ends) does not
    have exactly one number per header column, a row name
    repeats, it has no ``total`` row, a ``D_`` column disagrees with its
    current minus reference by more than one rounding step, or the same
    check prints two sections. Text with no recognizable section returns
    ``{}``; callers turn that into `unknown` Measures.
    """
    sections = {}
    broken = set()
    check = header = None
    for raw_line in text.splitlines():
        line = raw_line.strip()
        match = _SUMMARY_SECTION.match(line)
        if match:
            check, header = match.group(1), None
            if check in sections or check in broken:
                broken.add(check)
            sections.setdefault(check, {"total": None, "scenarios": {}})
            continue
        if check is None or check in broken:
            continue
        tokens = [token for token in line.split() if token != "|"]
        if not tokens:
            header = None  # a blank line ends the table
            continue
        if set(line) <= set("-"):
            continue
        if tokens[0] == "Scenario":
            columns = [_SUMMARY_COLUMNS.get(token) for token in tokens[1:]]
            if header is not None or None in columns or len(set(columns)) != len(columns) \
                    or not {"worst", "tns"} <= set(columns):
                broken.add(check)
            header = columns
            continue
        if line.startswith("###"):
            check = header = None
            continue
        if header is None:
            continue
        name, values = tokens[0], tokens[1:]
        if len(values) != len(header) or not all(_NUMBER.match(value) for value in values):
            broken.add(check)
            continue
        row = {column: (int(float(value)) if column in _INT_COLUMNS else float(value))
               for column, value in zip(header, values)}
        for current, reference, delta in (("worst", "worst0", "dWorst"), ("tns", "tns0", "dTns"),
                                          ("count", "count0", "dCount")):
            if delta in row and current in row and reference in row \
                    and abs(row[current] - row[reference] - row[delta]) > _DELTA_TOLERANCE:
                broken.add(check)
        target = sections[check]
        if name == "total":
            if target["total"] is not None:
                broken.add(check)
            target["total"] = row
        elif name in target["scenarios"]:
            broken.add(check)
        else:
            target["scenarios"][name] = row
    return {name: section for name, section in sorted(sections.items())
            if name not in broken and section["total"] is not None}


def _measure(value, reason):
    return core.known(value) if value is not None else core.unknown(reason)


def _gain_reading(gain_line):
    """``(parsed, reasons)``: `parse_gain_summary` per check of one gain line, and why a check is missing."""
    parsed, reasons = {}, {}
    for check in SESSION_CHECKS:
        entry = (gain_line or {}).get("checks", {}).get(check)
        if gain_line is None or entry is None:
            reasons[check] = "no gain reading"
        elif entry["code"] != 0:
            reasons[check] = f"summarize_gba_violations failed (code {entry['code']})"
        else:
            section = parse_gain_summary(entry["text"]).get(check)
            if section is None:
                reasons[check] = f"no readable '### {check} summary ###' section in the gain text"
            else:
                parsed[check] = section
    return parsed, reasons


def _gain_measures(gain_line, column="current"):
    """``{"xtop<Check><Wns|Tns>": Measure}`` from one gain line's ``total`` rows.

    ``column="current"`` reads ``Worst``/``TNS``; ``"reference"`` reads
    ``Worst0``/``TNS0`` (present only in ``-with_reference`` readings).
    """
    parsed, reasons = _gain_reading(gain_line)
    suffix = "" if column == "current" else "0"
    measures = {}
    for check in SESSION_CHECKS:
        label = check.capitalize()
        total = (parsed.get(check) or {}).get("total") or {}
        reason = reasons.get(check) or f"no {column} column in the {check} summary"
        measures[f"xtop{label}Wns"] = _measure(total.get("worst" + suffix), reason)
        measures[f"xtop{label}Tns"] = _measure(total.get("tns" + suffix), reason)
    return measures


def parse_fail_reasons(text):
    """``{reason: count}`` from ``<snake_case_reason> <int>`` rows (best effort, informational)."""
    counts = {}
    for raw_line in text.splitlines():
        match = _FAIL_REASON_ROW.match(raw_line)
        if match:
            counts[match.group(1)] = counts.get(match.group(1), 0) + int(match.group(2))
    return counts


def _target_checks(work_package):
    kinds = set()
    for target in work_package.get("targets") or []:
        parts = target.split("|") if isinstance(target, str) else []
        if len(parts) >= 3 and parts[1] in SESSION_CHECKS:
            kinds.add(parts[1])
    return sorted(kinds) or sorted(SESSION_CHECKS)


# A check reading prints 4 decimals: a move within one rounding step is not a change.
_OPPOSITE_TOLERANCE = 1e-4


def _session_value(target_checks, reference, predicted):
    """The ranking value and the gain gates, over both checks.

    For every check ``k`` in setup/hold: ``wnsGain[k] = predicted WNS -
    reference WNS`` and ``tnsGain[k]`` likewise (positive = better; TNS is
    negative when violating). Target checks are the ``mode`` parts of the
    work package's ``targets`` (both when none is named); the others are
    opposite checks.

    - ``value`` = ``wnsGain`` of the target check whose reference WNS is
      worst (ties: hold before setup); ``targetTnsGain`` sums the target
      checks' ``tnsGain`` and breaks ranking ties. An opposite check's TNS
      never enters it.
    - ``no-predicted-gain``: a target WNS is unknown or got worse, or no
      target WNS and not ``targetTnsGain`` improved.
    - ``breaks-opposite-check``: an opposite check's WNS or TNS is unknown,
      or got worse by more than `_OPPOSITE_TOLERANCE` (one rounding step).

    Returns ``(value, detail, refusals)``, ``refusals`` a list of
    ``(code, detail)``.
    """
    wns_gain, tns_gain = {}, {}
    for check in SESSION_CHECKS:
        label = check.capitalize()
        for metric, gains in (("Wns", wns_gain), ("Tns", tns_gain)):
            ref, cur = reference[f"xtop{label}{metric}"], predicted[f"xtop{label}{metric}"]
            if core.is_known(ref) and core.is_known(cur):
                gains[check] = round(core.value_of(cur) - core.value_of(ref), 9)
    opposite = [check for check in SESSION_CHECKS if check not in target_checks]
    target_tns = [tns_gain[check] for check in target_checks if check in tns_gain]
    target_tns_gain = round(sum(target_tns), 9) if len(target_tns) == len(target_checks) else None
    known_refs = [(core.value_of(reference[f"xtop{c.capitalize()}Wns"]), c) for c in target_checks
                  if core.is_known(reference[f"xtop{c.capitalize()}Wns"])]
    worst = min(known_refs)[1] if known_refs else None
    value = wns_gain.get(worst, 0.0) if worst is not None else 0.0
    detail = {"targetChecks": list(target_checks), "oppositeChecks": opposite, "worstCheck": worst,
              "wnsGain": wns_gain, "tnsGain": tns_gain, "targetTnsGain": target_tns_gain}

    refusals = []
    missing_wns = [check for check in target_checks if check not in wns_gain]
    worsened = {check: wns_gain[check] for check in target_checks if wns_gain.get(check, 0) < 0}
    if missing_wns:
        refusals.append(("no-predicted-gain", f"predicted or reference WNS unknown for target {missing_wns}"))
    elif worsened:
        refusals.append(("no-predicted-gain", f"predicted target WNS got worse: {worsened}"))
    elif not any(wns_gain[check] > 0 for check in target_checks) \
            and not (target_tns_gain is not None and target_tns_gain > 0):
        refusals.append(("no-predicted-gain", f"no predicted target gain (WNS {wns_gain}, TNS {target_tns_gain})"))

    for check in opposite:
        unknown = [metric for metric, gains in (("WNS", wns_gain), ("TNS", tns_gain)) if check not in gains]
        broken = {metric: gains[check] for metric, gains in (("WNS", wns_gain), ("TNS", tns_gain))
                  if check in gains and gains[check] < -_OPPOSITE_TOLERANCE}
        if unknown:
            refusals.append(("breaks-opposite-check", f"opposite {check} {unknown} cannot be read"))
        elif broken:
            refusals.append(("breaks-opposite-check", f"opposite {check} got worse: {broken}"))
    return value, detail, refusals


def _leaf(name):
    return name.rsplit("/", 1)[-1]


def _filler(master, patterns):
    return master is not None and any(fnmatch.fnmatchcase(master, pattern) for pattern in patterns)


def _command_entry(line):
    before = line["before"]["instances"]
    after = line["after"]["instances"]
    entry = {
        "seq": line["seq"], "proc": line["proc"], "cmd": line["cmd"], "args": line["args"],
        "before": before, "after": after,
        "instances": sorted(set(before) | set(after) | set(line.get("ecoCells") or [])),
    }
    for key in ("newNets", "verified", "ecoCells", "fillers"):
        if key in line:
            entry[key] = line[key]
    return entry


def _net_log(lines):
    """``(kept_lines, undone, discarded, problems)``: the net kept log after undo, per the Task 3 rule."""
    stack = []
    undone = []
    discarded = []
    problems = []
    seqs = {line["seq"]: line for line in lines}
    for line in lines:
        if line["status"] != "kept":
            continue
        if line["cmd"] != "undo":
            stack.append(line["seq"])
            continue
        target = line["undoes"]
        if not stack or stack[-1] != target:
            problems.append(f"undo seq {line['seq']} names seq {target}, not the last kept edit {stack[-1:] or None}")
        if target in stack:
            stack.remove(target)
            undone.append(target)
        for seq in line["discards"]:
            checkpoint = seqs.get(seq)
            if checkpoint is None or checkpoint["status"] == "kept" or seq > line["seq"]:
                problems.append(f"undo seq {line['seq']} discards seq {seq}, which is not an empty checkpoint")
            discarded.append(seq)
    kept = [seqs[seq] for seq in stack]
    return kept, sorted(undone), sorted(set(discarded)), problems


def _request_problem(line):
    """Why a kept typed request's own logged effect is not what it asked for, or ``None``."""
    cmd, args = line["cmd"], line["args"]
    before, after = line["before"]["instances"], line["after"]["instances"]
    if cmd == "size_cell":
        instance, to_master = args.get("instance"), args.get("toMaster")
        if set(after) != {instance} or after.get(instance) != to_master or before.get(instance) is None:
            return f"size_cell asked {instance!r} -> {to_master!r}, logged {before} -> {after}"
    elif cmd == "exchange_cell":
        allowed = {args.get("instance")} | set(args.get("cells") or [])
        stray = sorted((set(before) | set(after)) - allowed)
        if stray:
            return f"exchange_cell changed {stray} outside {sorted(n for n in allowed if n)}"
    elif cmd in ("insert_buffer", "insert_dummy_cell", "split_load"):
        names = args.get("newInstances") if cmd != "insert_dummy_cell" else [args.get("newInstance")]
        missing = [name for name in names or [None]
                   if not _is_nonempty_string(name) or after.get(name) is None or before.get(name) is not None]
        if line.get("matchesRequest") is not True or missing:
            return f"{cmd} did not create its named instances {missing or names}"
    elif cmd == "remove_buffer":
        instance = args.get("instance")
        if line.get("matchesRequest") is not True or before.get(instance) is None \
                or instance not in after or after[instance] is not None:
            return f"remove_buffer did not remove {instance!r}"
    return None


def _latest_fail_reasons(gain_lines, last_kept_seq):
    for gain_line in reversed(gain_lines):
        if gain_line["seq"] < last_kept_seq:
            break
        checks = gain_line["checks"]
        if any("-with_fail_reason" in entry["command"] for entry in checks.values()):
            return ({check: parse_fail_reasons(entry["text"]) for check, entry in sorted(checks.items())
                     if entry["code"] == 0}, gain_line["seq"])
    return {}, None


def seal_session(base_ref, result_refs, ops_text, gain_text):
    """Seal one worker's Task 3 XTop session into an ``xtop-session`` (or ``no-fix``) Contribution.

    `result_refs`: ``{"beforeDump", "afterDump"`` (paths), ``"evidence":
    {"taintedJson": obj|None, "transcriptTaint": "clean"|"tainted:<why>"|None,
    "ecoOutput": bool}, "fillerPatterns": [glob, ...], "diagnosis":
    str|None}``. `ops_text`/`gain_text` are the raw ``ops.jsonl`` /
    ``gain.jsonl`` texts. Raises `AtcsError` only for unusable input (a
    ``base_ref`` whose parts disagree, an unreadable dump, a malformed log);
    every content problem is a refusal on the returned Contribution -- see
    the block comment above for the codes and the shape.
    """
    manifest = core.require(base_ref, "workspaceManifest", "base_ref")
    work_package = core.require(base_ref, "workPackage", "base_ref")
    state_id = core.require(base_ref, "stateId", "base_ref")
    _check_base(manifest, work_package, state_id)
    name_prefix = core.require(manifest, "namePrefix", "workspaceManifest")

    lines = parse_session_log(ops_text)
    gain_lines = parse_gain_log(gain_text)

    before_path = core.require(result_refs, "beforeDump", "result_refs")
    after_path = core.require(result_refs, "afterDump", "result_refs")
    before_bytes = _read_dump_bytes(before_path, "beforeDump")
    before = parse_cell_dump(_decode_utf8(before_bytes, before_path, "beforeDump"))
    after = parse_cell_dump(_decode_utf8(_read_dump_bytes(after_path, "afterDump"), after_path, "afterDump"))
    evidence = result_refs.get("evidence") if isinstance(result_refs.get("evidence"), dict) else {}
    filler_patterns = [p for p in (result_refs.get("fillerPatterns") or []) if _is_nonempty_string(p)]

    refusals = []

    def refuse(code, detail):
        refusals.append({"code": code, "detail": detail})

    # Taint: any one signal refuses the slot (notes/t3-toolkit-surface.md, capture rule 1, 2, 5).
    if evidence.get("taintedJson") is not None:
        refuse("tainted", f"tainted.json: {core.canonical(evidence['taintedJson']).decode('utf-8')}")
    for line in lines:
        if line["status"] == "uncertain":
            refuse("tainted", f"ops.jsonl seq {line['seq']} ({line['cmd']}) is uncertain: {line.get('error', '')}")
    transcript_taint = evidence.get("transcriptTaint")
    if transcript_taint is None:
        refuse("tainted", "the XTop transcript has no ATCS:taint: line (the session did not close through atcs_close)")
    elif transcript_taint != "clean":
        refuse("tainted", f"the XTop transcript says ATCS:taint:{transcript_taint}")

    if [line["seq"] for line in lines] != list(range(1, len(lines) + 1)):
        refuse("trace-mismatch", f"ops.jsonl seqs {[line['seq'] for line in lines]} are not 1..{len(lines)}")

    kept_lines, undone, discarded, undo_problems = _net_log(lines)
    for problem in undo_problems:
        refuse("trace-mismatch", problem)
    commands = [_command_entry(line) for line in kept_lines]

    # Gain lines: every kept line has its own; the reading used as `predicted` is the latest state.
    gain_keys = {(gain_line["seq"], gain_line["kind"]) for gain_line in gain_lines}
    kept_all = [line for line in lines if line["status"] == "kept"]
    for line in kept_all:
        kind = "undo" if line["cmd"] == "undo" else "mutation"
        if (line["seq"], kind) not in gain_keys:
            refuse("missing-gain-line", f"kept seq {line['seq']} has no {kind} gain line")
    last_kept_seq = max((line["seq"] for line in kept_all), default=0)
    references = [gain_line for gain_line in gain_lines if gain_line["kind"] == "reference"]
    # `predicted` comes from the last mutation/undo reading: every kept line has one (checked
    # above), no other line changes the design, and its form (`-with_delta -with_reference`) is
    # the one pinned to real output. `atcs_gain` probes (`-with_top_n -with_fail_reason`) only
    # feed `failReasons`.
    readings = [gain_line for gain_line in gain_lines if gain_line["kind"] in ("mutation", "undo")]
    reference_line = references[0] if references else None
    last_reading = readings[-1] if readings else reference_line
    if kept_all and (last_reading is None or last_reading["seq"] < last_kept_seq):
        refuse("missing-gain-line", f"no gain reading at or after the last kept seq {last_kept_seq}")

    reference = _gain_measures(reference_line)
    if last_reading is not None and last_reading is not reference_line:
        fallback = _gain_measures(last_reading, column="reference")
        reference = {key: measure if core.is_known(measure) else fallback[key] for key, measure in reference.items()}
    predicted = _gain_measures(last_reading)
    gain_summary = {"reference": _gain_reading(reference_line)[0], "predicted": _gain_reading(last_reading)[0]}
    predicted.update({"prestaSetupWns": core.unknown("not predicted by an xtop-session"),
                      "prestaHoldWns": core.unknown("not predicted by an xtop-session")})
    fail_reasons, fail_reasons_seq = _latest_fail_reasons(gain_lines, last_kept_seq)

    # Domain: editDomain instances plus instances created under this workspace's prefix.
    edit_domain = work_package.get("editDomain") or {}
    domain = set(edit_domain.get("instances") or [])

    def out_of_domain(name):
        if name in before:
            return name not in domain
        return not _leaf(name).startswith(name_prefix)

    out_of_scope = set()
    running = dict(before)
    for line, command in zip(kept_lines, commands):
        problem = _request_problem(line)
        if problem is not None:
            refuse("trace-mismatch", f"seq {command['seq']}: {problem}")
        for name in command["instances"]:
            if out_of_domain(name):
                out_of_scope.add(name)
        for name, master in command["before"].items():
            if running.get(name) != master:
                refuse("trace-mismatch", f"seq {command['seq']}: {name!r} logged as {master!r} before the "
                                         f"{command['cmd']}, the replayed state has {running.get(name)!r}")
        for name, master in command["after"].items():
            if master is None:
                running.pop(name, None)
            else:
                running[name] = master

    touched = {name for command in commands for name in command["instances"]}
    names = set(before) | set(after) | set(running)
    filler_changes = []
    untraced = []
    for name in sorted(names):
        actual, implied = (before.get(name), after.get(name)), (before.get(name), running.get(name))
        if actual == implied:
            continue
        actual_changed = actual[0] != actual[1]
        implied_changed = implied[0] != implied[1]
        if actual_changed and not implied_changed:
            if name not in touched and name not in domain and all(
                    master is None or _filler(master, filler_patterns) for master in actual):
                filler_changes.append(name)
            elif out_of_domain(name):
                out_of_scope.add(name)
            else:
                untraced.append(name)
        else:
            untraced.append(name)
    if untraced:
        refuse("trace-mismatch", "the net command log does not explain the dump delta for "
                                 f"{untraced}: logged {[(n, before.get(n), running.get(n)) for n in untraced]}, "
                                 f"dumped {[(n, before.get(n), after.get(n)) for n in untraced]}")
    if out_of_scope:
        refuse("out-of-scope", f"changes outside the edit domain: {sorted(out_of_scope)}")

    kind = "xtop-session" if commands else "no-fix"
    target_checks = _target_checks(work_package)
    if commands:
        if not evidence.get("ecoOutput"):
            refuse("missing-export", "kept commands but eco_output/ holds no exported change files")
        value, value_detail, gain_refusals = _session_value(target_checks, reference, predicted)
        for code, detail in gain_refusals:
            refuse(code, detail)
    else:
        value, value_detail = 0.0, {"targetChecks": target_checks,
                                    "oppositeChecks": [c for c in SESSION_CHECKS if c not in target_checks],
                                    "worstCheck": None, "wnsGain": {}, "tnsGain": {}, "targetTnsGain": None}

    diagnosis = result_refs.get("diagnosis")
    if not (isinstance(diagnosis, str) and diagnosis.strip()) and not commands:
        statuses = {}
        for line in lines:
            statuses[line["status"]] = statuses.get(line["status"], 0) + 1
        diagnosis = (f"XTop session kept no command: {len(lines)} ops.jsonl line(s) {statuses}, "
                     f"undone seqs {undone}, discarded checkpoints {discarded}")

    nets = set()
    for command in commands:
        nets.update(command.get("newNets") or [])
        if _is_nonempty_string(command["args"].get("net")):
            nets.add(command["args"]["net"])
    checks = set(work_package.get("targets") or []) | set(work_package.get("mayAffect") or [])
    has_prediction = any(core.is_known(predicted[key]) for key in ("xtopSetupWns", "xtopHoldWns"))

    body = {
        "taskId": core.require(manifest, "taskId", "workspaceManifest"),
        "revision": core.require(manifest, "revision", "workspaceManifest"),
        "baseStateId": state_id,
        "kind": kind,
        "commands": commands,
        "operations": [],
        "script": None,
        "beforeDumpSha256": hashlib.sha256(before_bytes).hexdigest(),
        "delta": actual_delta(before, after),
        "fillerChanges": filler_changes,
        "touches": {"instances": sorted(touched), "nets": sorted(nets), "regions": [], "checks": sorted(checks),
                    "cones": []},
        "preconditions": [],
        "dependencies": [],
        "atomicGroups": [],
        "predicted": predicted,
        "reference": reference,
        "gainSummary": gain_summary,
        "failReasons": fail_reasons,
        "value": value,
        "valueDetail": value_detail,
        "targets": sorted(work_package.get("targets") or []),
        "targetPins": sorted(work_package.get("targetPins") or []),
        "validationLevel": "xtop" if has_prediction else "none",
        "diagnosis": diagnosis,
        "session": {
            "lines": len(lines), "kept": [command["seq"] for command in commands], "undone": undone,
            "discarded": discarded, "observe": sorted({line.get("observe") for line in lines
                                                        if isinstance(line.get("observe"), str)}),
            "predictedFromSeq": last_reading["seq"] if last_reading is not None else None,
            "failReasonsFromSeq": fail_reasons_seq, "fillerPatterns": filler_patterns,
        },
        "admissible": not refusals,
        "refusals": refusals,
        "outOfScope": sorted(out_of_scope),
    }
    return core.stamp("contribution", body)
