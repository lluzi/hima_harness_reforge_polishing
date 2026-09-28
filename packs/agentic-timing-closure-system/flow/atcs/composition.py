"""M4: semantic composition analysis over sealed ECO Contributions.

This module owns the single M4 producer named in
``.superpowers/sdd/task-6-brief.md`` and the ``composition-facts`` row of
``.superpowers/sdd/global-context.md``'s "Shared data model" table:

- `analyze(base_state_id, contributions, resolutions)` -> ``composition-facts``
  — a deterministic, read-only comparison of a base state and a set of
  sealed `contribution` artifacts (see `atcs.contributions`'s module
  docstring for that exact shape). It finds duplicates, conflicts,
  interactions, stale-base contributions, a dependency-respecting replay
  order and the count of unresolved conflicts.
- `conflict_key(kind, ids, objects)` -> ``str`` — a stable, human-readable
  identity for one conflict, used both by `analyze` itself and by an
  `integration-plan`'s `resolutions[].conflictKey` (M5) to name the
  conflict a decision resolves.

Per ``AGENTIC_TIMING_CLOSURE_SYSTEM_ARCHITECTURE.zh-CN.md`` §7 ("从 Git
类比到物理设计的语义合并") this module plays the role of Git's three-way
compare, extended from text lines to circuit objects and engineering
conditions: for each touched object it is comparing the base value, what
each contribution wants, and whether other contributions want something
different. It is **not** the compose Workshop — it never picks a winner
among legacy contributions, never drops a contribution and never invents a
fix. It only produces the facts (§7.3's conflict/interaction graph) that
the Workshop's AI judgment turns into an `integration-plan`, which M5 then
replays. The one deterministic ranking it does make is the ``recipe`` over
``xtop-session`` Contributions (see that section below).

`analyze` is deterministic **with respect to which facts are found**, but
also with respect to input list order: `analyze(base_state_id,
[p, q], resolutions)` and `analyze(base_state_id, [q, p], resolutions)`
always return identical facts, including `id` — every list this module
builds is either sorted at the point of construction or built from a
per-pair id-sorted canonical form before anything order-sensitive (like an
evidence dict's labels) is derived from it. See "Determinism" below.

Fail-closed input validation
------------------------------

This module trusts sealed `contribution` artifacts for their *content*
(every field access below uses `.get()` defensively), but two shapes are
never silently tolerated because a caller wiring bug here would otherwise
surface as a raw `KeyError`/`TypeError` deep inside comparison logic
instead of a clear refusal:

- Every entry in `contributions` must carry a non-empty string `id`, and no
  two entries may share the same `id` — `AtcsError("missing-input", ...)`
  for the former, `AtcsError("duplicate-contribution", ...)` for the
  latter. Both are checked before any filtering, so they apply even to an
  inadmissible or stale-base contribution.
- Every entry in `resolutions` that is a dict must carry its `conflictKey`
  as a non-empty string when the key is present at all — anything else
  (missing dict, missing key, non-string value) is
  `AtcsError("missing-input", ...)`.

Admission into ``considered``
------------------------------

A contribution enters ``considered`` (and therefore every other list this
module produces, except ``staleBase``) only when both hold:

- ``admissible`` is true — an inadmissible contribution (a refused seal) is
  excluded from ``considered`` and appears **nowhere else** in the facts,
  not even ``staleBase``: it never got to the point of describing a real,
  usable change.
- ``baseStateId`` equals this call's ``base_state_id`` — a contribution
  sealed against a base this campaign has since moved on from is collected
  into ``staleBase`` instead (by id) and likewise excluded from every other
  list; comparing its `delta` against contributions on the current base
  would silently mix two different starting points.

``kind: "no-fix"`` contributions (a worker's diagnosis with no operations)
are considered and take part in ``duplicates``/``order``, but never in
``conflicts`` or ``interactions`` — they carry no `delta` to disagree over,
and their `beforeDumpSha256`/`touches` are not compared against anything
either, so two independent `no-fix` diagnoses are never mistaken for
duplicates or for a base-dump disagreement.

Conflict detection
-------------------

Built from each considered `fix` contribution's `delta` (the real
object-level before/after diff, never the raw operation trace — see
`atcs.contributions`'s "Delta and replay validation" section for why the
two can disagree and `delta` is always the trustworthy one) and, for the
two cross-worker kinds below, from `operations` directly:

- ``same-instance-different-master`` — the same pre-existing instance is
  resized (``delta.mastersChanged``) by two or more contributions to
  different target masters.
- ``delete-vs-modify`` — the same pre-existing instance is deleted
  (``delta.removed``) by one contribution and resized by another.
- ``shared-instance-edit`` — the same pre-existing instance is resized or
  deleted by two or more contributions in a way that is *not* already
  covered by the two more specific kinds above — most notably, two
  contributions resizing it to the **same** target master (a converging
  edit is still a conflict: the second op's own `fromMaster` precondition
  cannot hold once the first has already replayed, per this task's
  controller decision), or two contributions independently deleting it.
  **Precedence**: `same-instance-different-master` and `delete-vs-modify`
  are strictly more specific and always take that instance's conflict
  instead — at most one of these three kinds ever fires per instance, so
  a pair of contributions is never labelled with two different kinds for
  the same object.
- ``name-collision`` — two or more contributions independently create a
  new instance (``delta.added``, i.e. an `insert_buffer`'s ``newInstance``)
  under the same name. In practice this cannot happen *across* workers
  (`atcs.contributions`'s workspace `namePrefix` makes every worker's new
  names disjoint by construction) but remains possible across revisions of
  the same worker/task, so it is still checked.
- ``same-load-pin`` — `insert_buffer` operations in two different
  contributions share at least one `loadPins` entry. Because `namePrefix`
  already rules out `name-collision` and identical-operation `duplicates`
  across workers, this is the cross-worker conflict that actually catches
  two workers independently deciding to buffer load pins on the same
  driver/net from different insertion points — a real write conflict on
  the same load pin's connectivity that object-name comparison alone
  would miss. ``objects`` is the sorted set of shared pin names.
- ``missing-dependency`` — a `fix` contribution's ``dependencies`` names an
  id that is not itself in ``considered`` (wrong id, inadmissible, or
  stale-base): the atomic group or state it needs was never actually
  selected into this analysis. One entry per dependent contribution,
  aggregating every one of its unmet dependency ids into ``objects``.
- ``dependency-cycle`` — a cycle among `fix` contributions' ``dependencies``
  edges (restricted to edges landing on another considered id — a cycle
  edge that lands nowhere real is `missing-dependency`'s problem, not a
  cycle). One entry per strongly-connected cycle (including a
  self-dependency), naming its member ids; ``objects`` is empty since a
  dependency cycle is a fact about contribution identities, not about a
  circuit object.
- ``base-dump-mismatch`` — considered `fix` contributions declare the same
  ``baseStateId`` but disagree on ``beforeDumpSha256``: they did not
  actually start from the same native state, even though they claim the
  same base id. Contributions are grouped by their hash; the **majority**
  hash (most contributions; a tie broken by the lexicographically smallest
  hash) is treated as the reference, and one entry (if any hash disagrees
  at all) names only the **minority** contributions — the ones whose hash
  differs from the majority — as ``contributions``, with the sorted set of
  their distinct hashes as ``objects``. This keeps the key from churning
  every time an unrelated, agreeing fix joins the batch: adding another
  contribution that matches the existing majority never changes who is
  named in the conflict.

``missing-dependency`` and ``dependency-cycle`` are evaluated only over
`fix` contributions' own ``dependencies`` — a `no-fix` produces no
conflicts by design (see above), so a `no-fix`'s own ``dependencies`` (if
any) are not walked for these either.

Interaction detection
-----------------------

Interactions are not conflicts — they mark contributions the Workshop
should look at *together*, without saying either has to yield:

- ``shared-timing-window`` — two considered `fix` contributions whose
  ``touches.checks`` or ``touches.cones`` intersect, **even when neither
  touches an object the other does** (§7.3: "时序窗口竞争" is one of the
  things three-way object comparison alone cannot see — a shared check or
  cone is a real interaction even across disjoint objects).
- ``shared-space`` — two considered `fix` contributions each placing an
  `insert_buffer` (by its declared ``location``) or a `pg_local_adjust`
  (by its declared ``region``) close enough to interact. Per this task's
  shared-space rule: expand every such box by 1.0 on every side (so a bare
  insertion point becomes a 2x2 box) and flag an interaction when any
  expanded box from one contribution intersects any expanded box from the
  other — equivalent to a 2.0 threshold on either axis. `location`/
  `region` coordinates are DEF-derived and therefore in µm, per this
  Pack's design state units; this module assumes but does not re-verify
  that unit for every contribution it is handed. Only these two
  *op-level* geometries are compared — a contribution's ``touches.regions``
  also carries its whole work package's ``editDomain`` regions (appended
  by `atcs.contributions._touches`), which would falsely "interact" any
  two contributions sharing a work package if it were used here instead.
- ``shared-net`` — two considered `fix` contributions' ``touches.nets``
  intersect, and they do **not** already conflict on `same-load-pin`. A
  shared load pin is the sharper, write-conflict-shaped fact; a shared net
  without a shared load pin is merely something worth a joint look (e.g.
  two insertions on the same net feeding different loads).

Like conflicts, interactions are never evaluated for a `no-fix`
contribution.

Determinism
-----------

Every fact list is either globally sorted by a content-derived key once
built (``duplicates`` by `keep`, ``conflicts`` by `key`, ``interactions``
by `(kind, contributions)`), or built directly in sorted order
(``considered``, ``staleBase``, ``order``) — so none of them depend on the
order `contributions` arrives in. The one place order could otherwise leak
through is an interaction's *evidence* for a specific unordered pair (e.g.
`shared-space`'s per-box `{"a", "b"}` labels): every pairwise comparison
first canonicalizes the pair by sorting the two contributions by `id`, so
`"a"`/`"b"` always name the lower/higher id's own object regardless of
which one `analyze` happened to visit first.

Ordering
--------

``order`` is every considered id (both `fix` and `no-fix`) arranged by a
dependency-respecting topological sort of `fix` contributions'
``dependencies`` edges (again restricted to edges landing on a considered
id — an edge to a ``missing-dependency`` target is simply not a real
ordering constraint, so it is dropped for this purpose rather than
stalling the sort). Ties among simultaneously-ready ids are broken by:
first, whether the id is a `no-fix` (a `no-fix` never blocks a `fix` from
going first — see the module docstring for §17.1's "appear in `order`
last"); second, the id itself, lexicographically. A cycle (or anything
depending on a cycle member) can never become "ready" under this rule;
those ids are appended afterward using that same `(is-no-fix, id)`
ordering, so `order` stays total and deterministic even though
`dependency-cycle` also flags them as a conflict.

`xtop-session` Contributions: the ranked recipe (Issue #64)
------------------------------------------------------------

Parallel expert sessions are not code changes that must all be kept
verbatim; each is a probable repair. So a considered ``kind:
"xtop-session"`` Contribution (see `atcs.contributions.seal_session`) takes
part in none of the conflict, interaction or duplicate checks above and
instead enters ``recipe``, which ranks the sessions and never refuses the
batch:

- **Identity.** Sessions whose ``beforeDumpSha256`` differs from the
  sessions' majority hash (the ``base-dump-mismatch`` rule, applied to
  sessions only) are excluded: listed in ``recipe.excluded`` with code
  ``base-dump-mismatch`` and removed from ``considered`` and ``order``. No
  conflict is raised for them.

- **Rank.** Sessions are ordered by ``blockerCoverage`` (how many of this
  call's `worst_keys` -- the worst failing check per scenario and mode,
  see `worst_checks` -- the session targets by `covers`: check key in its
  ``targets``, or the key's endpoint or the check's raw PT endpoint
  (`worst_endpoints`, from `worst_check_endpoints`) in its ``targetPins``;
  the campaign-plan Reader applies the same rule) descending, then
  ``value`` (the predicted WNS gain of its worst target check, ns)
  descending, then ``valueDetail.rankTnsGain`` descending (the target
  checks' TNS gain plus the opposite checks' signed TNS change, so an
  opposite TNS loss lowers the rank; unknown counts as 0), then ``id``
  ascending. A session's recipe ``tnsGain`` is that ``rankTnsGain``. ``rank`` starts at 1.
- **Skip, never refuse.** Walking sessions in rank order, a command is
  marked ``skip: "shared-instance"`` (with ``sharedWith: [{"instance",
  "contribution", "rank"}]``) when any of its ``instances`` was touched by a
  non-skipped command of a higher-ranked session; the higher-ranked session
  wins. A command touching an instance that a skipped command of its own
  session created is marked ``skip: "depends-on-skipped"`` (with
  ``dependsOn``). Every other command has ``skip: null``. Nothing is
  removed: the recipe lists every kept command of every ranked session.
- **Excluded.** An inadmissible session (any Contribution carrying the
  ``session`` field) is listed under ``recipe.excluded`` with its refusal
  codes and is never ranked; it is still absent from ``considered``.

``recipe`` is ``{"rankedBy", "worstChecks", "sessions": [{"rank",
"contribution", "taskId", "blockerCoverage", "coveredChecks", "value",
"tnsGain", "commands": [{"seq", "proc", "cmd", "args", "instances",
"skip"[, "sharedWith"|"dependsOn"]}], "executedCount", "skipCount"}],
"excluded": [{"contribution", "taskId", "codes"}], "commandCount",
"skipCount"}``; with no sessions its lists are empty. ``order`` lists the
ranked sessions first, in rank order, then every other considered id in
the dependency-respecting order below.

`resolutions` and `unresolvedCount`
-------------------------------------

`resolutions` is the `integration-plan.resolutions` list:
``[{"conflictKey", "decision"}]``. A conflict counts as resolved when its
own `key` appears among the supplied `conflictKey` values, regardless of
`decision`'s content — deciding *how* to resolve a conflict is the
Workshop's job, not this module's. ``unresolvedCount`` is the count of
conflicts whose `key` has no matching resolution. A `conflictKey` that
does not match any conflict this call actually found is ignored for
counting purposes and instead collected (sorted, de-duplicated) into
``unknownResolutions`` — a stale or mistyped resolution the plan validator
(M5) should flag back to the Workshop, not something this module silently
drops.
"""
from __future__ import annotations

import heapq
import itertools

from . import core


def _is_nonempty_string(value):
    return isinstance(value, str) and value != ""


def conflict_key(kind, ids, objects):
    """A stable, human-readable identity for one conflict.

    ``"<kind>|<sorted ids joined by ,>|<sorted objects joined by ,>"``.
    Inputs are sorted and de-duplicated here, so two callers naming the
    same conflict in a different order or with repeated entries always
    produce the same key.
    """
    return f"{kind}|{','.join(sorted(set(ids)))}|{','.join(sorted(set(objects)))}"


def _make_conflict(kind, ids, objects):
    ids = sorted(set(ids))
    objects = sorted(set(objects))
    return {"key": conflict_key(kind, ids, objects), "kind": kind, "contributions": ids, "objects": objects}


def _validate_contributions(contributions):
    """Raise `AtcsError` for a missing/duplicate `id` — see module docstring."""
    seen = set()
    for contribution in contributions:
        contribution_id = contribution.get("id") if isinstance(contribution, dict) else None
        if not _is_nonempty_string(contribution_id):
            raise core.AtcsError("missing-input", f"contribution.id must be a non-empty string, got {contribution_id!r}")
        if contribution_id in seen:
            raise core.AtcsError("duplicate-contribution", f"duplicate contribution id {contribution_id!r}")
        seen.add(contribution_id)


def _resolution_keys(resolutions):
    """`{conflictKey, ...}` from `resolutions`; raises `AtcsError` for a bad shape."""
    keys = set()
    for resolution in resolutions:
        if not isinstance(resolution, dict) or "conflictKey" not in resolution:
            raise core.AtcsError("missing-input", f"resolutions[].conflictKey is required, got {resolution!r}")
        conflict_key_value = resolution["conflictKey"]
        if not _is_nonempty_string(conflict_key_value):
            raise core.AtcsError(
                "missing-input", f"resolutions[].conflictKey must be a non-empty string, got {conflict_key_value!r}"
            )
        keys.add(conflict_key_value)
    return keys


def _instance_outcomes(contribution):
    """`{instance: ("size"|"delete"|"insert", master_or_None)}` from `delta`."""
    delta = contribution.get("delta") or {}
    outcomes = {}
    for instance, master in (delta.get("added") or {}).items():
        outcomes[instance] = ("insert", master)
    for instance, pair in (delta.get("mastersChanged") or {}).items():
        outcomes[instance] = ("size", pair[1])
    for instance, master in (delta.get("removed") or {}).items():
        outcomes[instance] = ("delete", None)
    return outcomes


def _object_conflicts(fix_contributions):
    """`same-instance-different-master` / `delete-vs-modify` / `shared-instance-edit` / `name-collision`."""
    touchers = {}
    for contribution in fix_contributions:
        for instance, (kind, master) in _instance_outcomes(contribution).items():
            touchers.setdefault(instance, []).append((contribution["id"], kind, master))

    conflicts = []
    for instance, entries in touchers.items():
        edit_entries = [(cid, kind, master) for cid, kind, master in entries if kind in ("size", "delete")]
        insert_ids = [cid for cid, kind, _ in entries if kind == "insert"]

        size_entries = [(cid, master) for cid, kind, master in edit_entries if kind == "size"]
        delete_ids = [cid for cid, kind, _ in edit_entries if kind == "delete"]

        specific_fired = False
        if len({master for _, master in size_entries}) > 1:
            conflicts.append(
                _make_conflict("same-instance-different-master", [cid for cid, _ in size_entries], [instance])
            )
            specific_fired = True
        if size_entries and delete_ids:
            ids = [cid for cid, _ in size_entries] + delete_ids
            conflicts.append(_make_conflict("delete-vs-modify", ids, [instance]))
            specific_fired = True
        if not specific_fired and len(edit_entries) >= 2:
            ids = sorted({cid for cid, _, _ in edit_entries})
            if len(ids) >= 2:
                conflicts.append(_make_conflict("shared-instance-edit", ids, [instance]))

        if len(set(insert_ids)) > 1:
            conflicts.append(_make_conflict("name-collision", insert_ids, [instance]))
    return conflicts


def _base_minority(contributions):
    """Ids of `contributions` whose ``beforeDumpSha256`` is not their majority hash.

    The majority is the most common hash, ties going to the smallest; with one hash (or none)
    nobody is in the minority.
    """
    counts = {}
    for contribution in contributions:
        sha = contribution.get("beforeDumpSha256")
        counts[sha] = counts.get(sha, 0) + 1
    if len(counts) <= 1:
        return set()
    top = max(counts.values())
    majority = min((sha for sha, count in counts.items() if count == top), key=str)
    return {contribution["id"] for contribution in contributions if contribution.get("beforeDumpSha256") != majority}


def _base_dump_mismatch(fix_contributions):
    """`base-dump-mismatch`, naming only the minority hash group(s) — see module docstring."""
    minority_ids = sorted(_base_minority(fix_contributions))
    if not minority_ids:
        return []
    by_id = {contribution["id"]: contribution.get("beforeDumpSha256") for contribution in fix_contributions}
    minority_hashes = sorted({by_id[cid] for cid in minority_ids}, key=str)
    return [_make_conflict("base-dump-mismatch", minority_ids, minority_hashes)]


def _load_pins(contribution):
    pins = set()
    for op in contribution.get("operations") or []:
        if op.get("op") == "insert_buffer":
            pins.update(op.get("loadPins") or [])
    return pins


def _dependency_conflicts(fix_contributions, considered_ids):
    """`missing-dependency` and `dependency-cycle` conflicts, plus the
    dependency graph (edges restricted to considered ids) `_order` reuses.
    """
    considered_set = set(considered_ids)
    deps_by_id = {contribution["id"]: sorted(set(contribution.get("dependencies") or [])) for contribution in fix_contributions}

    conflicts = []
    graph = {}
    for contribution_id, deps in deps_by_id.items():
        missing = [dep for dep in deps if dep not in considered_set]
        if missing:
            conflicts.append(_make_conflict("missing-dependency", [contribution_id], missing))
        graph[contribution_id] = sorted(dep for dep in deps if dep in considered_set)

    for component in _strongly_connected_components(graph):
        is_cycle = len(component) > 1 or (len(component) == 1 and component[0] in graph.get(component[0], []))
        if is_cycle:
            conflicts.append(_make_conflict("dependency-cycle", component, []))

    return conflicts, graph


def _strongly_connected_components(graph):
    """Tarjan's algorithm over `graph` (`{node: [successor, ...]}`)."""
    index_counter = [0]
    stack = []
    on_stack = set()
    index = {}
    lowlink = {}
    components = []

    def strongconnect(node):
        index[node] = index_counter[0]
        lowlink[node] = index_counter[0]
        index_counter[0] += 1
        stack.append(node)
        on_stack.add(node)

        for successor in graph.get(node, ()):
            if successor not in index:
                strongconnect(successor)
                lowlink[node] = min(lowlink[node], lowlink[successor])
            elif successor in on_stack:
                lowlink[node] = min(lowlink[node], index[successor])

        if lowlink[node] == index[node]:
            component = []
            while True:
                member = stack.pop()
                on_stack.discard(member)
                component.append(member)
                if member == node:
                    break
            components.append(sorted(component))

    for node in graph:
        if node not in index:
            strongconnect(node)
    return components


def _order(considered_ids, kind_by_id, dependency_graph):
    """A dependency-respecting topological order; ties broken by (is-no-fix, id).

    Cycle members (or anything depending on one) can never reach in-degree
    zero and are appended afterward using that same `(is-no-fix, id)` key,
    per this module's docstring.
    """
    in_degree = {contribution_id: 0 for contribution_id in considered_ids}
    dependents = {contribution_id: [] for contribution_id in considered_ids}
    for contribution_id in considered_ids:
        deps = dependency_graph.get(contribution_id, [])
        in_degree[contribution_id] = len(deps)
        for dep in deps:
            dependents.setdefault(dep, []).append(contribution_id)

    def priority(contribution_id):
        return (kind_by_id.get(contribution_id) == "no-fix", contribution_id)

    heap = [priority(cid) for cid in considered_ids if in_degree[cid] == 0]
    heapq.heapify(heap)

    placed = []
    placed_set = set()
    while heap:
        _, contribution_id = heapq.heappop(heap)
        placed.append(contribution_id)
        placed_set.add(contribution_id)
        for dependent in dependents.get(contribution_id, []):
            in_degree[dependent] -= 1
            if in_degree[dependent] == 0:
                heapq.heappush(heap, priority(dependent))

    remaining = sorted((cid for cid in considered_ids if cid not in placed_set), key=priority)
    return placed + remaining


def _insertion_boxes(contribution):
    """`[(label, [x0, y0, x1, y1]), ...]` for each located `insert_buffer` op.

    Each box is the insertion point expanded by 1.0 on every side, per
    this task's shared-space rule.
    """
    boxes = []
    for op in contribution.get("operations") or []:
        if op.get("op") != "insert_buffer":
            continue
        location = op.get("location")
        if location is None:
            continue
        x, y = location
        boxes.append((op.get("newInstance"), [x - 1.0, y - 1.0, x + 1.0, y + 1.0]))
    return boxes


def _pg_adjust_boxes(contribution):
    """`[(label, [x0, y0, x1, y1]), ...]` for each `pg_local_adjust` op's own `region`.

    Each box is that op-level region expanded by 1.0 on every side, the
    same shared-space rule as `_insertion_boxes` — never the work
    package's `editDomain` regions (see module docstring).
    """
    boxes = []
    for op in contribution.get("operations") or []:
        if op.get("op") != "pg_local_adjust":
            continue
        region = op.get("region")
        if region is None:
            continue
        x1, y1, x2, y2 = region
        boxes.append((f"region:{[x1, y1, x2, y2]}", [x1 - 1.0, y1 - 1.0, x2 + 1.0, y2 + 1.0]))
    return boxes


def _boxes_intersect(box_a, box_b):
    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b
    return ax1 <= bx2 and bx1 <= ax2 and ay1 <= by2 and by1 <= ay2


def _pairwise(fix_contributions):
    """`(conflicts, interactions)` from every unordered pair of `fix_contributions`.

    Covers `same-load-pin` (conflict), `shared-timing-window`,
    `shared-space` and `shared-net` (interactions) — see module docstring
    for each. Every pair is canonicalized (lower id first) before any
    order-sensitive evidence is built, so the result never depends on
    `fix_contributions`' own order (see module docstring's "Determinism").
    """
    conflicts = []
    interactions = []

    for left, right in itertools.combinations(fix_contributions, 2):
        first, second = sorted((left, right), key=lambda contribution: contribution["id"])
        ids = [first["id"], second["id"]]

        first_touches, second_touches = first.get("touches") or {}, second.get("touches") or {}
        shared_checks = sorted(set(first_touches.get("checks") or []) & set(second_touches.get("checks") or []))
        shared_cones = sorted(set(first_touches.get("cones") or []) & set(second_touches.get("cones") or []))
        if shared_checks or shared_cones:
            interactions.append(
                {
                    "kind": "shared-timing-window",
                    "contributions": ids,
                    "evidence": {"sharedChecks": shared_checks, "sharedCones": shared_cones},
                }
            )

        first_boxes = _insertion_boxes(first) + _pg_adjust_boxes(first)
        second_boxes = _insertion_boxes(second) + _pg_adjust_boxes(second)
        overlaps = []
        for first_label, first_box in first_boxes:
            for second_label, second_box in second_boxes:
                if _boxes_intersect(first_box, second_box):
                    overlaps.append({"a": first_label, "b": second_label})
        if overlaps:
            overlaps.sort(key=lambda entry: (entry["a"], entry["b"]))
            interactions.append({"kind": "shared-space", "contributions": ids, "evidence": {"overlaps": overlaps}})

        shared_pins = sorted(_load_pins(first) & _load_pins(second))
        if shared_pins:
            conflicts.append(_make_conflict("same-load-pin", ids, shared_pins))
        else:
            shared_nets = sorted(set(first_touches.get("nets") or []) & set(second_touches.get("nets") or []))
            if shared_nets:
                interactions.append(
                    {"kind": "shared-net", "contributions": ids, "evidence": {"sharedNets": shared_nets}}
                )

    conflicts.sort(key=lambda conflict: conflict["key"])
    interactions.sort(key=lambda entry: (entry["kind"], entry["contributions"]))
    return conflicts, interactions


def _duplicates(fix_contributions):
    groups = {}
    for contribution in fix_contributions:
        key = core.canonical(contribution.get("operations") or [])
        groups.setdefault(key, []).append(contribution["id"])

    duplicates = []
    for ids in groups.values():
        if len(ids) < 2:
            continue
        ids_sorted = sorted(ids)
        duplicates.append({"keep": ids_sorted[0], "dropped": ids_sorted[1:], "sources": ids_sorted})
    duplicates.sort(key=lambda entry: entry["keep"])
    return duplicates


def worst_checks(observation):
    """The worst failing check key per ``(scenario, mode)`` in an observation's ``checks``, sorted.

    A check counts only with a known, negative ``slack``; a key that is not
    ``"<scenario>|<mode>|<endpoint>"`` is ignored. Ties go to the smaller key.
    """
    worst = {}
    checks = observation.get("checks") if isinstance(observation, dict) else None
    for key, entry in (checks or {}).items():
        slack = entry.get("slack") if isinstance(entry, dict) else None
        parts = key.split("|", 2) if isinstance(key, str) else []
        if len(parts) != 3 or not core.is_known(slack):
            continue
        value = core.value_of(slack)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value >= 0:
            continue
        group = (parts[0], parts[1])
        if group not in worst or (value, key) < worst[group]:
            worst[group] = (value, key)
    return sorted(key for _value, key in worst.values())


def _number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else 0.0


def worst_check_endpoints(observation):
    """``{key: raw PT endpoint or None}`` for each `worst_checks` key of `observation`.

    A check in a reserved PT path group is keyed ``<endpoint>@<group>``
    (`atcs.reports.parse_path_report`); its raw ``endpoint`` is the pin a
    work package's ``targetPins`` names.
    """
    checks = observation.get("checks") if isinstance(observation, dict) else None
    checks = checks if isinstance(checks, dict) else {}
    endpoints = {}
    for key in worst_checks(observation):
        entry = checks.get(key)
        raw = entry.get("endpoint") if isinstance(entry, dict) else None
        endpoints[key] = raw if isinstance(raw, str) and raw else None
    return endpoints


def covers(key, raw_endpoint, targets, target_pins):
    """Whether a slot with `targets` and `target_pins` works the blocker check `key` (Issue #64 Task 5).

    The one coverage rule the campaign-plan Reader (blockers first) and the
    recipe's ``blockerCoverage`` both apply: the check key is in ``targets``
    (which is how a check ending at a top-level port, with no pin path, is
    named), or the key's endpoint or the check's raw PT endpoint is in
    ``targetPins``.
    """
    pins = set(target_pins or [])
    if key in set(targets or []):
        return True
    endpoint = key.split("|", 2)[-1] if isinstance(key, str) else None
    return endpoint in pins or (raw_endpoint is not None and raw_endpoint in pins)


def _coverage(contribution, worst, endpoints=None):
    endpoints = endpoints or {}
    targets = contribution.get("targets") or []
    pins = contribution.get("targetPins") or []
    return sorted(key for key in worst if covers(key, endpoints.get(key), targets, pins))


def _recipe(sessions, excluded, worst, identity_excluded=(), endpoints=None):
    """The ranked recipe over admitted `xtop-session` Contributions -- see the module docstring."""
    ranked = []
    for contribution in sessions:
        covered = _coverage(contribution, worst, endpoints)
        tns_gain = (contribution.get("valueDetail") or {}).get("rankTnsGain")
        ranked.append((len(covered), _number(contribution.get("value")), _number(tns_gain), contribution, covered))
    ranked.sort(key=lambda item: (-item[0], -item[1], -item[2], item[3]["id"]))

    changed_by = {}
    entries = []
    command_count = skip_count = 0
    for rank, (coverage, value, tns_gain, contribution, covered) in enumerate(ranked, start=1):
        own_changed = set()
        skipped_created = set()
        commands = []
        for command in contribution.get("commands") or []:
            instances = list(command.get("instances") or [])
            before = command.get("before") or {}
            entry = {key: command.get(key) for key in ("seq", "proc", "cmd", "args")}
            entry["instances"] = instances
            shared = [{"instance": name, "contribution": changed_by[name][0], "rank": changed_by[name][1]}
                      for name in instances if name in changed_by]
            dependent = [name for name in instances if name in skipped_created]
            if shared:
                entry["skip"] = "shared-instance"
                entry["sharedWith"] = shared
            elif dependent:
                entry["skip"] = "depends-on-skipped"
                entry["dependsOn"] = dependent
            else:
                entry["skip"] = None
            if entry["skip"] is None:
                own_changed.update(instances)
            else:
                skipped_created.update(name for name in instances if name in before and before[name] is None)
            commands.append(entry)
        for name in own_changed:
            changed_by.setdefault(name, (contribution["id"], rank))
        skipped = sum(1 for entry in commands if entry["skip"] is not None)
        command_count += len(commands)
        skip_count += skipped
        entries.append({
            "rank": rank, "contribution": contribution["id"], "taskId": contribution.get("taskId"),
            "blockerCoverage": coverage, "coveredChecks": covered, "value": value, "tnsGain": tns_gain,
            "commands": commands, "executedCount": len(commands) - skipped, "skipCount": skipped,
        })

    return {
        "rankedBy": ["blockerCoverage desc", "value desc", "rankTnsGain desc", "id asc"],
        "worstChecks": sorted(worst),
        "sessions": entries,
        "excluded": sorted(
            [{"contribution": contribution["id"], "taskId": contribution.get("taskId"),
              "codes": sorted({refusal.get("code") for refusal in contribution.get("refusals") or []
                               if isinstance(refusal, dict)})} for contribution in excluded]
            + [{"contribution": contribution["id"], "taskId": contribution.get("taskId"),
                "codes": ["base-dump-mismatch"]} for contribution in identity_excluded],
            key=lambda item: item["contribution"]),
        "commandCount": command_count,
        "skipCount": skip_count,
    }


def analyze(base_state_id, contributions, resolutions, worst_keys=None, worst_endpoints=None):
    """Deterministic three-way composition facts over `contributions` on `base_state_id`.

    `contributions` is a list of sealed `contribution` artifacts (see the
    module docstring for the admission rule and the fail-closed shape
    checks run on it up front). `resolutions` is an
    `integration-plan.resolutions` list, or an empty list/`None` if none
    exists yet. Returns a stamped `composition-facts` artifact; raises
    `AtcsError` only for the malformed-shape cases documented at the top
    of this module — every other problem with a contribution's *content*
    (a real conflict, interaction, or stale base) is reported as data,
    never raised, since this module only observes, it never refuses a
    contribution on its own authority. `worst_keys` (optional, a list of
    check keys, e.g. from `worst_checks(observation)`) drives the recipe's
    blocker coverage; without it every session's coverage is 0.
    """
    resolutions = resolutions or []
    worst = worst_keys if worst_keys is not None else []
    if not isinstance(worst, list) or not all(_is_nonempty_string(key) for key in worst):
        raise core.AtcsError("missing-input", f"worst_keys must be a list of check keys, got {worst_keys!r}")

    _validate_contributions(contributions)
    resolution_keys = _resolution_keys(resolutions)

    admissible = [contribution for contribution in contributions if contribution.get("admissible")]
    stale_base = sorted(
        contribution["id"] for contribution in admissible if contribution.get("baseStateId") != base_state_id
    )
    considered_contributions = [
        contribution for contribution in admissible if contribution.get("baseStateId") == base_state_id
    ]
    # A session that did not start from the sessions' common native state is excluded from the
    # recipe (and from `considered`/`order`), recorded under `recipe.excluded`.
    mismatched_ids = _base_minority(
        [contribution for contribution in considered_contributions if contribution.get("kind") == "xtop-session"])
    identity_excluded = [contribution for contribution in considered_contributions
                         if contribution["id"] in mismatched_ids]
    considered_contributions = [contribution for contribution in considered_contributions
                                if contribution["id"] not in mismatched_ids]
    considered_ids = sorted(contribution["id"] for contribution in considered_contributions)
    kind_by_id = {contribution["id"]: contribution.get("kind") for contribution in considered_contributions}

    fix_contributions = [
        contribution for contribution in considered_contributions
        if contribution.get("kind") not in ("no-fix", "xtop-session")
    ]
    session_contributions = [
        contribution for contribution in considered_contributions if contribution.get("kind") == "xtop-session"
    ]
    excluded_sessions = [
        contribution for contribution in contributions
        if "session" in contribution and not contribution.get("admissible")
    ]

    duplicates = _duplicates(fix_contributions)

    conflicts = []
    conflicts.extend(_object_conflicts(fix_contributions))
    conflicts.extend(_base_dump_mismatch(fix_contributions))
    dependency_conflicts, dependency_graph = _dependency_conflicts(fix_contributions, considered_ids)
    conflicts.extend(dependency_conflicts)
    pairwise_conflicts, interactions = _pairwise(fix_contributions)
    conflicts.extend(pairwise_conflicts)
    conflicts.sort(key=lambda conflict: conflict["key"])

    endpoints = worst_endpoints if isinstance(worst_endpoints, dict) else {}
    recipe = _recipe(session_contributions, excluded_sessions, worst, identity_excluded, endpoints)
    ranked_ids = [entry["contribution"] for entry in recipe["sessions"]]
    ranked_set = set(ranked_ids)
    other_ids = [contribution_id for contribution_id in considered_ids if contribution_id not in ranked_set]
    order = ranked_ids + _order(other_ids, kind_by_id, dependency_graph)

    conflict_keys = {conflict["key"] for conflict in conflicts}
    unresolved_count = sum(1 for conflict in conflicts if conflict["key"] not in resolution_keys)
    unknown_resolutions = sorted(resolution_keys - conflict_keys)

    body = {
        "baseStateId": base_state_id,
        "considered": considered_ids,
        "duplicates": duplicates,
        "conflicts": conflicts,
        "interactions": interactions,
        "staleBase": stale_base,
        "order": order,
        "unresolvedCount": unresolved_count,
        "unknownResolutions": unknown_resolutions,
        "recipe": recipe,
    }
    return core.stamp("composition-facts", body)
