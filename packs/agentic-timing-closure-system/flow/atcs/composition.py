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
different. It is **not** the compose Workshop — it never picks a winner,
never drops a contribution and never invents a fix. It only produces the
facts (§7.3's conflict/interaction graph) that the Workshop's AI judgment
turns into an `integration-plan`, which M5 then replays.

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
two can disagree and `delta` is always the trustworthy one):

- ``same-instance-different-master`` — the same pre-existing instance is
  resized (``delta.mastersChanged``) by two or more contributions to
  different target masters. Contributions resizing it to the *same* target
  are not a conflict (converging edits) — the difference is what matters.
- ``delete-vs-modify`` — the same pre-existing instance is deleted
  (``delta.removed``) by one contribution and resized by another.
- ``name-collision`` — two or more contributions independently create a
  new instance (``delta.added``, i.e. an `insert_buffer`'s ``newInstance``)
  under the same name.
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
  same base id. One entry (if triggered) spans every considered `fix`
  contribution, since the whole point is that they should all agree;
  ``objects`` is the sorted set of distinct hashes seen.

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
- ``shared-space`` — two considered `fix` contributions each inserting a
  buffer whose declared ``location`` lies close enough to interact. Per
  this task's shared-space rule: expand each insertion's location into a
  1.0-unit box on every side (so a bare point becomes a 2x2 box) and flag
  an interaction when any such expanded box from one contribution
  intersects any expanded box from the other — equivalent to two
  insertion points within 2.0 of each other on either axis. `location`
  coordinates are DEF-derived and therefore in µm, per this Pack's design
  state units; this module assumes but does not re-verify that unit for
  every contribution it is handed. Only `insert_buffer` locations are
  compared this way — a contribution's ``touches.regions`` also carries
  its whole work package's ``editDomain`` regions (appended by
  `atcs.contributions._touches`), which would falsely "interact" any two
  contributions sharing a work package if it were used here instead.

Like conflicts, interactions are never evaluated for a `no-fix`
contribution.

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
those ids are appended afterward, sorted by id alone, so `order` stays
total and deterministic even though `dependency-cycle` also flags them as
a conflict.

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

from . import core


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
    """`same-instance-different-master` / `delete-vs-modify` / `name-collision`."""
    touchers = {}
    for contribution in fix_contributions:
        for instance, (kind, master) in _instance_outcomes(contribution).items():
            touchers.setdefault(instance, []).append((contribution["id"], kind, master))

    conflicts = []
    for instance, entries in touchers.items():
        if len(entries) < 2:
            continue
        size_entries = [(cid, master) for cid, kind, master in entries if kind == "size"]
        delete_ids = [cid for cid, kind, _ in entries if kind == "delete"]
        insert_ids = [cid for cid, kind, _ in entries if kind == "insert"]

        if len({master for _, master in size_entries}) > 1:
            conflicts.append(
                _make_conflict("same-instance-different-master", [cid for cid, _ in size_entries], [instance])
            )
        if size_entries and delete_ids:
            ids = [cid for cid, _ in size_entries] + delete_ids
            conflicts.append(_make_conflict("delete-vs-modify", ids, [instance]))
        if len(set(insert_ids)) > 1:
            conflicts.append(_make_conflict("name-collision", insert_ids, [instance]))
    return conflicts


def _base_dump_mismatch(fix_contributions):
    if len(fix_contributions) < 2:
        return []
    shas = {contribution["id"]: contribution.get("beforeDumpSha256") for contribution in fix_contributions}
    distinct = sorted({sha for sha in shas.values()})
    if len(distinct) <= 1:
        return []
    return [_make_conflict("base-dump-mismatch", list(shas.keys()), distinct)]


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
    zero and are appended afterward, sorted by id alone, per this module's
    docstring.
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

    remaining = sorted(cid for cid in considered_ids if cid not in placed_set)
    return placed + remaining


def _insertion_boxes(contribution):
    """`[(newInstance, [x0, y0, x1, y1]), ...]` for each located `insert_buffer` op.

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


def _boxes_intersect(box_a, box_b):
    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b
    return ax1 <= bx2 and bx1 <= ax2 and ay1 <= by2 and by1 <= ay2


def _interactions(fix_contributions):
    interactions = []
    for i in range(len(fix_contributions)):
        for j in range(i + 1, len(fix_contributions)):
            left, right = fix_contributions[i], fix_contributions[j]
            ids = sorted([left["id"], right["id"]])

            left_touches, right_touches = left.get("touches") or {}, right.get("touches") or {}
            shared_checks = sorted(set(left_touches.get("checks") or []) & set(right_touches.get("checks") or []))
            shared_cones = sorted(set(left_touches.get("cones") or []) & set(right_touches.get("cones") or []))
            if shared_checks or shared_cones:
                interactions.append(
                    {
                        "kind": "shared-timing-window",
                        "contributions": ids,
                        "evidence": {"sharedChecks": shared_checks, "sharedCones": shared_cones},
                    }
                )

            overlaps = []
            for left_instance, left_box in _insertion_boxes(left):
                for right_instance, right_box in _insertion_boxes(right):
                    if _boxes_intersect(left_box, right_box):
                        overlaps.append({"a": left_instance, "b": right_instance})
            if overlaps:
                interactions.append(
                    {"kind": "shared-space", "contributions": ids, "evidence": {"overlaps": overlaps}}
                )

    interactions.sort(key=lambda entry: (entry["kind"], entry["contributions"]))
    return interactions


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


def analyze(base_state_id, contributions, resolutions):
    """Deterministic three-way composition facts over `contributions` on `base_state_id`.

    `contributions` is a list of sealed `contribution` artifacts (see the
    module docstring for the admission rule). `resolutions` is an
    `integration-plan.resolutions` list, or an empty list/`None` if none
    exists yet. Returns a stamped `composition-facts` artifact; never
    raises for well-formed contributions — this module only observes and
    reports, it never refuses a contribution on its own authority.
    """
    resolutions = resolutions or []

    admissible = [contribution for contribution in contributions if contribution.get("admissible")]
    stale_base = sorted(
        contribution["id"] for contribution in admissible if contribution.get("baseStateId") != base_state_id
    )
    considered_contributions = [
        contribution for contribution in admissible if contribution.get("baseStateId") == base_state_id
    ]
    considered_ids = sorted(contribution["id"] for contribution in considered_contributions)
    kind_by_id = {contribution["id"]: contribution.get("kind") for contribution in considered_contributions}

    fix_contributions = [
        contribution for contribution in considered_contributions if contribution.get("kind") != "no-fix"
    ]

    duplicates = _duplicates(fix_contributions)

    conflicts = []
    conflicts.extend(_object_conflicts(fix_contributions))
    conflicts.extend(_base_dump_mismatch(fix_contributions))
    dependency_conflicts, dependency_graph = _dependency_conflicts(fix_contributions, considered_ids)
    conflicts.extend(dependency_conflicts)
    conflicts.sort(key=lambda conflict: conflict["key"])

    interactions = _interactions(fix_contributions)

    order = _order(considered_ids, kind_by_id, dependency_graph)

    resolution_keys = {
        resolution["conflictKey"]
        for resolution in resolutions
        if isinstance(resolution, dict) and "conflictKey" in resolution
    }
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
    }
    return core.stamp("composition-facts", body)
