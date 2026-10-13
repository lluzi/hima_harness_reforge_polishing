"""Exact one-dimensional scribe-lane slot planner (exact in its model).

Forked verbatim from packs/mage-scribe-placement 0.2.0 (2026-10-12).

The planner answers lane questions in integer grid units (the caller converts
DBU -> grid units by exact division). Given items in order along a lane and a
request for ``count`` slots of length ``length`` with ``clearance`` ``c``, it
computes:

- (a) ``max_slots``       -- how many slots can be opened, and whether ``count``
                             is feasible (exact DP over items).
- (b) ``fewest_moves``    -- the plan that opens ``count`` slots while moving the
                             fewest items (exact DP, state ``(slots, moved)``).
- (c) ``least_displacement`` -- given a fixed order and fixed slot starts, the
                             item positions of least total displacement (exact
                             grid DP with a running prefix-minimum).

``plan_lane`` runs (a), then (b), then (c) and returns a ``mage.slot-plan/1``
body (the caller stamps and writes it). The module is pure -- no file I/O.

Gap / slot geometry (recorded here because the DP depends on it):

- ``gap_after`` of item ``i`` is the minimum empty distance between the end of
  item ``i`` and the start of item ``i+1`` when no slot sits between them.
- When ``j >= 1`` slots sit between items ``i`` and ``i+1`` the sequence is:
  ``item i end``, then ``gap_after``, then ``j`` blocks each spanning
  ``clearance + length + clearance`` (= ``length + 2*clearance``), then
  ``item i+1 start``. The slot's trailing clearance already separates it from
  the next item -- there is no extra gap after a slot.
- A reported slot *start* is the left edge of the ``length`` interval with
  ``clearance`` free on each side: block ``[start - c, start + length + c)``,
  reported ``start = block_start + c``.

Lane range:

- Callers express the lane range with two immovable zero-length sentinel items
  (ids ``@start`` and ``@end``) at the front and back of the list; the planner
  treats them as items (so trailing slots are counted uniformly) and excludes
  them from the reported positions / moved lists.
- Without sentinels the lane end is ``max(window_hi + length)`` over items and
  the lane start is ``0`` (as in the brief's DP).

Cyclic lanes (``cyclic_period``): the caller supplies items in lane order; the
planner rotates so an anchor is first (the first immovable item, else the
narrowest-window item), pins the anchor at its current position, treats the
lane end as ``anchor.current + period`` and enforces the wrap gap (the
last-in-order item's ``gap_after`` between its end and the anchor + period).
Sentinels and ``cyclic_period`` are mutually exclusive.

Rigid clusters: items sharing a ``cluster`` id (which must be consecutive) keep
their relative offsets; they are collapsed into one composite item (length =
span, window = intersection of the members' windows shifted by each member's
offset from the first member) and expanded back after solving.

Integer Box / interval reasoning is re-implemented here with attribution to the
ATCS/`mage_assist` prototype lineage; this module imports only ``core``.
"""
from __future__ import annotations

from dataclasses import dataclass

from .core import MageError

NEG = -(10 ** 18)
POS = 10 ** 18
_SENTINELS = ('@start', '@end')


@dataclass(frozen=True)
class LaneItem:
    """One item along a lane. Positions are integer grid units.

    ``window`` is the inclusive ``(lo, hi)`` range for the item's left edge.
    Immovable items (``movable=False``) are treated as a point window at
    ``current`` regardless of the tuple.
    """

    id: str
    length: int
    gap_after: int
    window: tuple
    current: int
    movable: bool
    cluster: str = None
    priority: bool = False
    intruder: bool = False


@dataclass(frozen=True)
class SlotRequest:
    count: int
    length: int
    clearance: int


# --------------------------------------------------------------------------
# Internal node model (after relaxations, cluster collapse and rotation).
# --------------------------------------------------------------------------

class _Node:
    """A solved unit: a real item, a cluster composite, or a fixed slot.

    ``members`` is a list of ``(real_id, offset)`` so a node position expands to
    real item positions (``real_pos = node_pos + offset``). ``shift`` is the
    period added for cyclic tail nodes, subtracted on expansion.
    """

    __slots__ = ('members', 'length', 'gap_after', 'lo', 'hi', 'current',
                 'movable', 'is_slot', 'shift')

    def __init__(self, members, length, gap_after, lo, hi, current, movable,
                 is_slot=False, shift=0):
        self.members = members
        self.length = length
        self.gap_after = gap_after
        self.lo = lo
        self.hi = hi
        self.current = current
        self.movable = movable
        self.is_slot = is_slot
        self.shift = shift


def _eff_window(it):
    return (it.current, it.current) if not it.movable else (int(it.window[0]), int(it.window[1]))


def _apply_relaxations(items, relaxations):
    """Return (transformed items, applied-keys list, removed-ids list)."""
    relaxations = relaxations or {}
    applied = []
    removed = []
    out = []
    for key in ('ignoreGaps', 'removeNonPriority', 'splitClusters', 'intrudersMovable'):
        if relaxations.get(key):
            applied.append(key)
    split = relaxations.get('splitClusters')
    for it in items:
        if relaxations.get('removeNonPriority') and it.cluster is None and not it.priority \
                and it.id not in _SENTINELS:
            removed.append(it.id)
            continue
        cluster = None if split else it.cluster
        movable = it.movable
        window = it.window
        if relaxations.get('intrudersMovable') and it.intruder:
            movable = True
        gap_after = 0 if relaxations.get('ignoreGaps') else it.gap_after
        out.append(LaneItem(id=it.id, length=it.length, gap_after=gap_after, window=window,
                            current=it.current, movable=movable, cluster=cluster,
                            priority=it.priority, intruder=it.intruder))
    return out, applied, removed


def _node_from_item(it):
    lo, hi = _eff_window(it)
    return _Node(members=[(it.id, 0)], length=it.length, gap_after=it.gap_after,
                 lo=lo, hi=hi, current=it.current, movable=it.movable)


def _composite(members):
    first = members[0]
    offsets = [m.current - first.current for m in members]
    if any(off < 0 for off in offsets):
        raise MageError('planner', 'cluster members are not in non-decreasing position order')
    length = (members[-1].current + members[-1].length) - first.current
    movable = all(m.movable for m in members)
    if movable:
        los = [_eff_window(m)[0] - off for m, off in zip(members, offsets)]
        his = [_eff_window(m)[1] - off for m, off in zip(members, offsets)]
        lo, hi = max(los), min(his)
        if lo > hi:
            raise MageError('planner', 'rigid cluster window is over-constrained')
    else:
        lo = hi = first.current
    return _Node(members=[(m.id, off) for m, off in zip(members, offsets)], length=length,
                 gap_after=members[-1].gap_after, lo=lo, hi=hi, current=first.current,
                 movable=movable, is_slot=False)


def _collapse(items):
    """Collapse consecutive cluster members into composites; validate order."""
    seen = {}
    for idx, it in enumerate(items):
        if it.cluster is not None:
            seen.setdefault(it.cluster, []).append(idx)
    for cid, idxs in seen.items():
        if idxs != list(range(idxs[0], idxs[0] + len(idxs))):
            raise MageError('planner', 'cluster %r members are not consecutive' % cid)
    nodes = []
    i = 0
    n = len(items)
    while i < n:
        it = items[i]
        if it.cluster is None:
            nodes.append(_node_from_item(it))
            i += 1
        else:
            j = i
            while j < n and items[j].cluster == it.cluster:
                j += 1
            nodes.append(_composite(items[i:j]))
            i = j
    return nodes


def _has_sentinels(items):
    ids = {it.id for it in items}
    return '@start' in ids or '@end' in ids


def _prepare(items, cyclic_period):
    """Build the working node list and lane-end. Returns (nodes, span_end)."""
    if cyclic_period is not None and _has_sentinels(items):
        raise MageError('planner', 'sentinels and cyclic_period are mutually exclusive')
    nodes = _collapse(items)
    if not nodes:
        return nodes, 0
    if cyclic_period is not None:
        period = int(cyclic_period)
        anchor = next((k for k, nd in enumerate(nodes) if not nd.movable), None)
        if anchor is None:
            anchor = min(range(len(nodes)), key=lambda k: nodes[k].hi - nodes[k].lo)
        rotated = list(nodes[anchor:])
        for nd in nodes[:anchor]:
            rotated.append(_Node(members=nd.members, length=nd.length, gap_after=nd.gap_after,
                                 lo=nd.lo + period, hi=nd.hi + period, current=nd.current + period,
                                 movable=nd.movable, shift=period))
        # pin the anchor at its current position (the cut point)
        a = rotated[0]
        a.lo = a.hi = a.current
        a.movable = False
        span_end = a.current + period
        return rotated, span_end
    span_end = max(nd.hi + nd.length for nd in nodes)
    if _has_sentinels(items):
        for nd in nodes:
            if nd.members and nd.members[0][0] == '@end':
                span_end = nd.current
    return nodes, span_end


def _expand_positions(nodes, node_pos):
    """node_pos: dict index->position. Return real-id position dict (sentinels dropped)."""
    out = {}
    for k, nd in enumerate(nodes):
        base = node_pos[k] - nd.shift
        for rid, off in nd.members:
            if rid in _SENTINELS:
                continue
            out[rid] = base + off
    return out


# --------------------------------------------------------------------------
# (a) Maximum slots / feasibility
# --------------------------------------------------------------------------

def max_slots(items, slot, cyclic_period=None):
    """Exact maximum slots openable (capped at ``slot.count``) and feasibility.

    DP over items with state ``m -> E(m)`` = the minimal end of the last placed
    item with ``m`` slots opened; add trailing slots after the last item.
    """
    nodes, span_end = _prepare(items, cyclic_period)
    L = slot.length + 2 * slot.clearance
    if not nodes:
        trailing = max(0, span_end) // L if L > 0 else 0
        s = min(slot.count, trailing)
        return {'slots': s, 'feasible': True, 'ends': {0: NEG}}
    best = {0: NEG}
    for i, nd in enumerate(nodes):
        lo, hi = nd.lo, nd.hi
        gap_before = nodes[i - 1].gap_after if i else 0
        nxt = {}
        for m, E in best.items():
            for j in range(0, slot.count - m + 1):
                p = max(lo, E + gap_before + j * L) if i else max(lo, j * L)
                if p <= hi:
                    end = p + nd.length
                    if nxt.get(m + j, POS) > end:
                        nxt[m + j] = end
        best = nxt
        if not best:
            return {'slots': 0, 'feasible': False, 'ends': {}}
    last_gap = nodes[-1].gap_after
    result = 0
    for m, E in best.items():
        trailing = max(0, span_end - E - last_gap) // L
        result = max(result, min(slot.count, m + trailing))
    return {'slots': result, 'feasible': True, 'ends': best}


def brute_force_max_slots(items, slot):
    """Independent test oracle for (a). Enumerates every position of every item
    and counts slots in closed form per layout, as a backward recursion
    ``f(i, prev_end)`` = max slots for ``items[i:]`` given the previous item
    ended at ``prev_end`` -- a different formulation from ``max_slots``'s forward
    ``slots -> min-end`` frontier, so the two cross-check genuinely.

    Memoised on ``(i, prev_end)`` so the brief's ``{0,5,20,60}`` half-windows and
    ``n <= 6`` stay cheap. Sentinel items (zero-length immovable
    ``@start``/``@end``) need no special handling -- they are point-window items.
    """
    n = len(items)
    if n == 0:
        return 0
    L = slot.length + 2 * slot.clearance
    wins = [_eff_window(it) for it in items]
    lens = [it.length for it in items]
    gaps = [it.gap_after for it in items]
    span_end = max(wins[i][1] + lens[i] for i in range(n))
    memo = {}

    def f(i, prev_end):
        if i == n:
            return max(0, span_end - prev_end - gaps[n - 1]) // L
        key = (i, prev_end)
        cached = memo.get(key)
        if cached is not None:
            return cached
        lo, hi = wins[i]
        gap_before = 0 if i == 0 else gaps[i - 1]
        floor = prev_end + gap_before
        start = lo if i == 0 else max(lo, floor)
        best = NEG
        p = start
        while p <= hi:
            before = p // L if i == 0 else (p - floor) // L
            rest = f(i + 1, p + lens[i])
            if rest > NEG and before + rest > best:
                best = before + rest
            p += 1
        memo[key] = best
        return best

    total = f(0, 0)
    return min(slot.count, total) if total > NEG else 0


# --------------------------------------------------------------------------
# (b) Fewest moved items
# --------------------------------------------------------------------------

def fewest_moves(items, slot, cyclic_period=None):
    """Open ``slot.count`` slots moving the fewest items.

    State ``(m, moved) -> (min E, back-pointer)``; an item either stays (if its
    current position satisfies the chain) or moves to its leftmost feasible
    position. Recovers item positions and slot starts from back-pointers.
    """
    nodes, span_end = _prepare(items, cyclic_period)
    L = slot.length + 2 * slot.clearance
    infeasible = {'feasible': False, 'moved': [], 'positions': {}, 'slotStarts': [],
                  'reason': 'cannot open %d slot(s) of span %d' % (slot.count, L)}
    if not nodes:
        trailing = max(0, span_end) // L
        if trailing < slot.count:
            return infeasible
        starts = [k * L + slot.clearance for k in range(slot.count)]
        return {'feasible': True, 'moved': [], 'positions': {}, 'slotStarts': starts}

    # state key (m, moved) -> (E, back)   back = (prev_key, j, pos, moved_flag, slot_base)
    states = {(0, 0): (NEG, None)}
    frontier = [states]
    for i, nd in enumerate(nodes):
        lo, hi, cur = nd.lo, nd.hi, nd.current
        gap_before = nodes[i - 1].gap_after if i else 0
        nxt = {}

        def relax(key, E, back):
            cur_best = nxt.get(key)
            if cur_best is None or E < cur_best[0]:
                nxt[key] = (E, back)

        for (m, moved), (E, _back) in states.items():
            for j in range(0, slot.count - m + 1):
                base = (E + gap_before) if i else 0
                floor = base + j * L
                # stay at current position
                if lo <= cur <= hi and cur >= floor:
                    relax((m + j, moved), cur + nd.length, ((m, moved), j, cur, False, base))
                # move to leftmost feasible position
                newp = max(lo, floor)
                if newp <= hi:
                    is_move = newp != cur
                    relax((m + j, moved + (1 if is_move else 0)), newp + nd.length,
                          ((m, moved), j, newp, is_move, base))
        states = nxt
        frontier.append(states)
        if not states:
            return infeasible

    last_gap = nodes[-1].gap_after
    # choose the feasible final state with the fewest moves (then minimal E)
    chosen = None
    for (m, moved), (E, back) in states.items():
        if m > slot.count:
            continue
        t_cap = max(0, span_end - E - last_gap) // L
        if m + t_cap < slot.count:
            continue
        cand = (moved, E, (m, moved))
        if chosen is None or cand < chosen[0]:
            chosen = (cand, (m, moved), E)
    if chosen is None:
        return infeasible

    final_key = chosen[1]
    final_E = chosen[2]
    # walk back to recover positions and in-chain slot starts
    node_pos = {}
    slot_starts = []
    key = final_key
    for i in range(len(nodes) - 1, -1, -1):
        E, back = frontier[i + 1][key]
        prev_key, j, pos, _moved_flag, base = back
        node_pos[i] = pos
        for k in range(j):
            slot_starts.append(base + k * L + slot.clearance)
        key = prev_key
    m_in_chain = final_key[0]
    trailing_needed = slot.count - m_in_chain
    base = final_E + last_gap
    for k in range(trailing_needed):
        slot_starts.append(base + k * L + slot.clearance)
    slot_starts.sort()

    positions = _expand_positions(nodes, node_pos)
    moved_ids = []
    for k, nd in enumerate(nodes):
        if node_pos[k] != nd.current:
            for rid, _off in nd.members:
                if rid not in _SENTINELS:
                    moved_ids.append(rid)
    moved_ids.sort()
    return {'feasible': True, 'moved': moved_ids, 'positions': positions, 'slotStarts': slot_starts}


# --------------------------------------------------------------------------
# (c) Least total displacement
# --------------------------------------------------------------------------

def _merge_slot_nodes(nodes, slot_starts, slot, period_shift=0):
    """Interleave fixed slot obstacles with item nodes (hi-pointer rule).

    A slot block ``[s-c, s+length+c)`` is placed before the first item (scanning
    in order from a monotone pointer) whose window hi can sit to its right.
    """
    L, c = slot.length, slot.clearance
    merged = []
    starts = sorted(slot_starts)
    ptr = 0
    n = len(nodes)
    for s in starts:
        b = s + L + c
        while ptr < n and nodes[ptr].hi < b:
            merged.append(nodes[ptr])
            ptr += 1
        a = s - c
        merged.append(_Node(members=[], length=L + 2 * c, gap_after=0,
                            lo=a, hi=a, current=a, movable=False, is_slot=True))
    while ptr < n:
        merged.append(nodes[ptr])
        ptr += 1
    return merged


def least_displacement(items, slot_starts, slot, cyclic_period=None):
    """Minimal total |p - current| over movable items, order and slot starts
    fixed. Exact grid DP with a running prefix-minimum."""
    nodes, _span = _prepare(items, cyclic_period)
    merged = _merge_slot_nodes(nodes, slot_starts, slot)
    M = len(merged)
    if M == 0:
        return {'feasible': True, 'positions': {}, 'totalDisplacement': 0}

    # per-node contiguous position range and own cost
    ranges = []
    costs = []
    backs = []
    for k, nd in enumerate(merged):
        lo, hi = nd.lo, nd.hi
        width = hi - lo + 1
        if k == 0:
            cost = [abs((lo + d) - nd.current) if not nd.is_slot else 0 for d in range(width)]
            back = [None] * width
        else:
            prev = merged[k - 1]
            plo = prev.lo
            pcost = costs[k - 1]
            # prefix-min (leftmost argmin) over previous node positions
            pm = [POS] * len(pcost)
            pm_arg = [-1] * len(pcost)
            run, run_arg = POS, -1
            for idx in range(len(pcost)):
                if pcost[idx] < run:
                    run, run_arg = pcost[idx], idx
                pm[idx] = run
                pm_arg[idx] = run_arg
            sep = prev.length + prev.gap_after
            cost = [POS] * width
            back = [None] * width
            qptr = -1  # highest prev index with plo+qptr <= p - sep
            for d in range(width):
                p = lo + d
                limit = p - sep
                while qptr + 1 < len(pcost) and plo + (qptr + 1) <= limit:
                    qptr += 1
                if qptr >= 0 and pm[qptr] < POS:
                    own = 0 if nd.is_slot else abs(p - nd.current)
                    cost[d] = own + pm[qptr]
                    back[d] = pm_arg[qptr]
        ranges.append((lo, hi))
        costs.append(cost)
        backs.append(back)

    # pick least-cost final position (leftmost on ties)
    last = costs[-1]
    best_d, best_c = -1, POS
    for d in range(len(last)):
        if last[d] < best_c:
            best_c, best_d = last[d], d
    if best_d < 0 or best_c >= POS:
        return {'feasible': False, 'positions': {}, 'totalDisplacement': 0}

    # walk back assigning each merged node its position
    d = best_d
    pos_by_merged = {}
    for k in range(M - 1, -1, -1):
        lo, _hi = ranges[k]
        pos_by_merged[k] = lo + d
        nxt = backs[k][d]
        d = nxt if nxt is not None else 0
    # merged keeps item nodes in their original order; re-pair them
    it_nodes_positions = {}
    orig = 0
    for k, nd in enumerate(merged):
        if nd.is_slot:
            continue
        it_nodes_positions[orig] = pos_by_merged[k]
        orig += 1
    positions = _expand_positions(nodes, it_nodes_positions)
    return {'feasible': True, 'positions': positions, 'totalDisplacement': best_c}


# --------------------------------------------------------------------------
# plan_lane
# --------------------------------------------------------------------------

def plan_lane(items, slot, relaxations=None, lane_id=None, cyclic_period=None):
    """Run (a), (b), (c) and return a ``mage.slot-plan/1`` body (unstamped).

    Numbers are in the integer units of the input items; the ``*Dbu`` field
    names are the frozen schema labels (the caller passes grid units).
    """
    transformed, applied, removed = _apply_relaxations(items, relaxations)
    current_by_id = {it.id: it.current for it in transformed}

    a = max_slots(transformed, slot, cyclic_period=cyclic_period)
    max_n = a['slots']
    feasible = max_n >= slot.count

    model = {'relaxations': applied, 'gapsQualified': 'ignoreGaps' not in applied}
    if relaxations and relaxations.get('removeNonPriority'):
        model['removed'] = removed

    if not feasible:
        reason = 'infeasible within model (relaxations=%s) at count %d: only %d slot(s)' % (
            applied or 'none', slot.count, max_n)
        return {'lane': lane_id, 'slot': {'count': slot.count, 'length': slot.length,
                                          'clearance': slot.clearance},
                'model': model, 'maxSlots': max_n, 'feasible': False, 'moves': [],
                'slotStarts': [], 'totalDisplacementDbu': 0, 'movedCount': 0,
                'infeasibleReason': reason}

    b = fewest_moves(transformed, slot, cyclic_period=cyclic_period)
    if not b['feasible']:
        reason = 'max_slots reports feasible but fewest_moves could not realise it'
        return {'lane': lane_id, 'slot': {'count': slot.count, 'length': slot.length,
                                          'clearance': slot.clearance},
                'model': model, 'maxSlots': max_n, 'feasible': False, 'moves': [],
                'slotStarts': [], 'totalDisplacementDbu': 0, 'movedCount': 0,
                'infeasibleReason': reason}

    slot_starts = b['slotStarts']
    moved_set = set(b['moved'])
    # Least displacement among exactly the minimal move set: pin the stayers.
    pinned = []
    for it in transformed:
        if it.movable and it.id not in moved_set:
            pinned.append(LaneItem(id=it.id, length=it.length, gap_after=it.gap_after,
                                   window=(it.current, it.current), current=it.current,
                                   movable=False, cluster=it.cluster, priority=it.priority,
                                   intruder=it.intruder))
        else:
            pinned.append(it)
    c = least_displacement(pinned, slot_starts, slot, cyclic_period=cyclic_period)
    if c['feasible']:
        final_positions = c['positions']
        total_disp = c['totalDisplacement']
    else:  # defensive: fall back to the fewest-moves assignment
        final_positions = b['positions']
        total_disp = sum(abs(final_positions[i] - current_by_id[i]) for i in final_positions)

    moves = []
    for rid in sorted(final_positions):
        frm = current_by_id[rid]
        to = final_positions[rid]
        if frm != to:
            moves.append({'id': rid, 'fromDbu': frm, 'toDbu': to})

    return {'lane': lane_id,
            'slot': {'count': slot.count, 'length': slot.length, 'clearance': slot.clearance},
            'model': model, 'maxSlots': max_n, 'feasible': True, 'moves': moves,
            'slotStarts': slot_starts, 'totalDisplacementDbu': total_disp,
            'movedCount': len(moves), 'infeasibleReason': None}
