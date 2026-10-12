"""Property + oracle tests for the exact scribe-lane slot planner.

The proof of correctness is cross-checking the planner's exact DP answers
against independent brute-force oracles on small random lanes:

- (a) max slots  -> `planner.brute_force_max_slots` (enumerate positions).
- (b) fewest moves -> enumerate every subset of movable items for the
  smallest set that still opens the requested slots.
- (c) least displacement -> enumerate every grid position of every item.

The oracles share only the *problem definition* (the lane/gap/slot model);
they reach the answer by exhaustive enumeration, never by the planner's DP.
"""
import itertools
import random
import sys
import time
import unittest
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core, planner


# --------------------------------------------------------------------------
# Shared problem-definition helpers (used by the oracles, not the DP).
# --------------------------------------------------------------------------

def eff_window(it):
    return (it.current, it.current) if not it.movable else tuple(it.window)


def random_lane(rng, n_items, span=400, max_limit=20):
    """A random ordered lane. Windows are kept narrow so the position-space
    oracles stay cheap (<= ~max_limit*2 wide)."""
    items, cursor = [], 0
    for i in range(n_items):
        length = rng.randint(5, 40)
        cursor += rng.randint(0, 30)
        current = cursor
        cursor += length
        limit = rng.choice([0, 3, 8, max_limit])
        movable = rng.random() > 0.2
        if movable:
            lo, hi = max(0, current - limit), min(span - length, current + limit)
            if hi < lo:
                hi = lo
        else:
            lo, hi = current, current
        items.append(planner.LaneItem(id='i%d' % i, length=length, gap_after=rng.randint(0, 4),
                                       window=(lo, hi), current=current, movable=movable, cluster=None))
    return items


def slot_span(slot):
    return slot.length + 2 * slot.clearance


def with_sentinels(items, lane_start, lane_end):
    start = planner.LaneItem(id='@start', length=0, gap_after=0, window=(lane_start, lane_start),
                             current=lane_start, movable=False)
    end = planner.LaneItem(id='@end', length=0, gap_after=0, window=(lane_end, lane_end),
                           current=lane_end, movable=False)
    return [start] + list(items) + [end]


def plan_is_feasible(items, slot, positions, slot_starts):
    """Independent verifier: positions inside windows, index order preserved,
    gaps honoured, exactly `count` non-overlapping slots that clear neighbours."""
    L, c = slot.length, slot.clearance
    span_end = max(eff_window(it)[1] + it.length for it in items)
    # windows + order + gaps between consecutive items
    prev_end = None
    for idx, it in enumerate(items):
        p = positions[it.id]
        lo, hi = eff_window(it)
        if not (lo <= p <= hi):
            return False
        if prev_end is not None and p < prev_end:
            return False
        prev_end = p + it.length + it.gap_after
    if len(slot_starts) != slot.count:
        return False
    # Each slot block [s-c, s+L+c) must sit in free lane, clear of every item
    # (by that item's gap) and of every other slot, within [0, span_end].
    blocks = sorted((s - c, s + L + c) for s in slot_starts)
    for a, b in blocks:
        if a < 0 or b > span_end:
            return False
        for it in items:
            p = positions[it.id]
            istart, iend = p, p + it.length
            # the item's required gap applies on its trailing side
            if not (iend + it.gap_after <= a or istart >= b):
                return False
    for (a1, b1), (a2, b2) in zip(blocks, blocks[1:]):
        if a2 < b1:
            return False
    return True


def min_moves_oracle(items, slot):
    """Smallest number of movable items that must be freed to open `count`
    slots: try every subset of the movable items, pin the rest."""
    movable_ids = [it.id for it in items if it.movable]
    for size in range(len(movable_ids) + 1):
        for subset in itertools.combinations(movable_ids, size):
            allowed = set(subset)
            pinned = []
            for it in items:
                if it.movable and it.id not in allowed:
                    pinned.append(planner.LaneItem(id=it.id, length=it.length, gap_after=it.gap_after,
                                                   window=(it.current, it.current), current=it.current,
                                                   movable=False, cluster=it.cluster))
                else:
                    pinned.append(it)
            if planner.brute_force_max_slots(pinned, slot) >= slot.count:
                return size
    return None


def merge_nodes_for_ld(items, slot_starts, slot):
    """Replicate the planner's slot/item interleaving (hi-pointer rule) so the
    exhaustive (c) oracle solves the exact same chain the planner solves."""
    L, c = slot.length, slot.clearance
    nodes = []  # (kind, payload)
    starts = sorted(slot_starts)
    ptr = 0
    n = len(items)
    for s in starts:
        b = s + L + c
        while ptr < n and eff_window(items[ptr])[1] < b:
            nodes.append(('item', items[ptr]))
            ptr += 1
        nodes.append(('slot', s))
    while ptr < n:
        nodes.append(('item', items[ptr]))
        ptr += 1
    return nodes


def least_disp_oracle(items, slot_starts, slot):
    L, c = slot.length, slot.clearance
    nodes = merge_nodes_for_ld(items, slot_starts, slot)
    item_nodes = [it for kind, it in nodes if kind == 'item']
    ranges = [range(eff_window(it)[0], eff_window(it)[1] + 1) for it in item_nodes]
    best = None
    for combo in itertools.product(*ranges):
        pos = dict(zip((it.id for it in item_nodes), combo))
        # walk the merged sequence, checking separations
        ok = True
        prev_end = None
        prev_gap = 0
        for kind, payload in nodes:
            if kind == 'item':
                p = pos[payload.id]
                if prev_end is not None and p < prev_end + prev_gap:
                    ok = False
                    break
                prev_end = p + payload.length
                prev_gap = payload.gap_after
            else:
                a = payload - c
                b = payload + L + c
                if prev_end is not None and a < prev_end + prev_gap:
                    ok = False
                    break
                prev_end = b
                prev_gap = 0
        if not ok:
            continue
        total = sum(abs(pos[it.id] - it.current) for it in item_nodes)
        if best is None or total < best:
            best = total
    return best


# --------------------------------------------------------------------------
# Property tests
# --------------------------------------------------------------------------

class MaxSlotsPropertyTest(unittest.TestCase):
    def test_max_slots_matches_brute_force(self):
        rng = random.Random(7)
        for _ in range(300):
            items = random_lane(rng, rng.randint(1, 5))
            slot = planner.SlotRequest(count=rng.randint(1, 3), length=rng.randint(10, 60),
                                       clearance=rng.randint(0, 3))
            self.assertEqual(planner.max_slots(items, slot)['slots'],
                             planner.brute_force_max_slots(items, slot), (items, slot))


class FewestMovesPropertyTest(unittest.TestCase):
    def test_fewest_moves_is_feasible_and_minimal(self):
        rng = random.Random(11)
        checked = 0
        for _ in range(400):
            items = random_lane(rng, rng.randint(1, 5))
            slot = planner.SlotRequest(count=rng.randint(1, 2), length=rng.randint(10, 50),
                                       clearance=rng.randint(0, 2))
            feasible = planner.max_slots(items, slot)['slots'] >= slot.count
            res = planner.fewest_moves(items, slot)
            if not feasible:
                self.assertFalse(res['feasible'], (items, slot))
                continue
            checked += 1
            self.assertTrue(res['feasible'], (items, slot))
            self.assertTrue(plan_is_feasible(items, slot, res['positions'], res['slotStarts']),
                            (items, slot, res))
            # reported movers actually changed position
            for it in items:
                moved = res['positions'][it.id] != it.current
                self.assertEqual(moved, it.id in res['moved'], (it.id, res))
            self.assertEqual(len(res['moved']), min_moves_oracle(items, slot), (items, slot, res))
        self.assertGreater(checked, 50)


class LeastDisplacementPropertyTest(unittest.TestCase):
    def test_least_displacement_matches_enumeration(self):
        rng = random.Random(23)
        checked = 0
        for _ in range(400):
            n = rng.randint(1, 3)
            items = random_lane(rng, n, span=120, max_limit=4)  # windows <= ~8 wide
            slot = planner.SlotRequest(count=1, length=rng.randint(4, 12), clearance=rng.randint(0, 2))
            # pick a slot start that sits in some gap of the current layout
            L, c = slot.length, slot.clearance
            ends = [0] + [it.current + it.length + it.gap_after for it in items]
            gap_bases = sorted(set(ends))
            placed = None
            for base in gap_bases:
                start = base + c
                # does this slot block fit without forcing impossible windows? let the oracle judge
                oracle = least_disp_oracle(items, [start], slot)
                if oracle is not None:
                    placed = start
                    expect = oracle
                    break
            if placed is None:
                continue
            checked += 1
            res = planner.least_displacement(items, [placed], slot)
            self.assertTrue(res['feasible'], (items, slot, placed))
            self.assertEqual(res['totalDisplacement'], expect, (items, slot, placed, res))
            # returned positions reproduce the reported total
            got = sum(abs(res['positions'][it.id] - it.current) for it in items)
            self.assertEqual(got, res['totalDisplacement'], (items, res))
        self.assertGreater(checked, 50)


class CyclicTest(unittest.TestCase):
    def test_cyclic_lane_wrap_gap(self):
        # Period 100. Immovable anchor [0,10) and immovable tail [60,70). The
        # free lane is the interior gap [10,60)=50 plus the wrap gap
        # [70,100)=30; nothing may be counted across the period boundary (100).
        period = 100
        anchor = planner.LaneItem(id='a', length=10, gap_after=0, window=(0, 0), current=0, movable=False)
        tail = planner.LaneItem(id='b', length=10, gap_after=0, window=(60, 60), current=60, movable=False)
        # span 20: floor(50/20)=2 interior + floor(30/20)=1 wrap = 3
        self.assertEqual(planner.max_slots([anchor, tail],
                         planner.SlotRequest(count=5, length=20, clearance=0),
                         cyclic_period=period)['slots'], 3)
        # span 40: 1 interior + 0 wrap = 1
        self.assertEqual(planner.max_slots([anchor, tail],
                         planner.SlotRequest(count=5, length=40, clearance=0),
                         cyclic_period=period)['slots'], 1)
        # span 55 > interior 50 and > wrap 30: 0 (would be 1 only if wrongly
        # counted across the period boundary, through the anchor)
        self.assertEqual(planner.max_slots([anchor, tail],
                         planner.SlotRequest(count=5, length=55, clearance=0),
                         cyclic_period=period)['slots'], 0)

    def test_cyclic_and_sentinels_mutually_exclusive(self):
        start = planner.LaneItem(id='@start', length=0, gap_after=0, window=(0, 0), current=0, movable=False)
        end = planner.LaneItem(id='@end', length=0, gap_after=0, window=(100, 100), current=100, movable=False)
        slot = planner.SlotRequest(count=1, length=10, clearance=0)
        with self.assertRaises(core.MageError):
            planner.max_slots([start, end], slot, cyclic_period=100)


class ClusterTest(unittest.TestCase):
    def test_rigid_cluster_moves_as_one(self):
        # Two clustered items 5 apart; an immovable blocker forces the cluster
        # to shift right as a unit to open a slot before it.
        a = planner.LaneItem(id='c1', length=10, gap_after=0, window=(0, 60), current=0, movable=True, cluster='K')
        b = planner.LaneItem(id='c2', length=10, gap_after=0, window=(0, 90), current=20, movable=True, cluster='K')
        slot = planner.SlotRequest(count=1, length=20, clearance=0)
        res = planner.fewest_moves([a, b], slot)
        self.assertTrue(res['feasible'])
        # the two members keep their 20-unit offset
        self.assertEqual(res['positions']['c2'] - res['positions']['c1'], 20)
        if 'c1' in res['moved']:
            self.assertIn('c2', res['moved'])

    def test_non_consecutive_cluster_raises(self):
        a = planner.LaneItem(id='a', length=5, gap_after=0, window=(0, 50), current=0, movable=True, cluster='K')
        mid = planner.LaneItem(id='m', length=5, gap_after=0, window=(0, 50), current=10, movable=True, cluster=None)
        b = planner.LaneItem(id='b', length=5, gap_after=0, window=(0, 50), current=20, movable=True, cluster='K')
        slot = planner.SlotRequest(count=1, length=5, clearance=0)
        with self.assertRaises(core.MageError):
            planner.max_slots([a, mid, b], slot)


class RelaxationTest(unittest.TestCase):
    def test_relaxed_bound_is_never_smaller_than_strict(self):
        rng = random.Random(31)
        keys = [{'ignoreGaps': True}, {'removeNonPriority': True},
                {'splitClusters': True}, {'intrudersMovable': True}]
        for _ in range(120):
            # real lanes carry @start/@end sentinels, which fix the lane extent
            # so a relaxation that removes interior items can only add slots.
            items = with_sentinels(random_lane(rng, rng.randint(2, 5)), 0, 400)
            slot = planner.SlotRequest(count=rng.randint(1, 3), length=rng.randint(10, 40),
                                       clearance=rng.randint(0, 2))
            strict = planner.plan_lane(items, slot)['maxSlots']
            for relax in keys:
                relaxed = planner.plan_lane(items, slot, relaxations=relax)['maxSlots']
                self.assertGreaterEqual(relaxed, strict, (items, slot, relax))

    def test_remove_non_priority_lists_removed(self):
        keep = planner.LaneItem(id='k', length=10, gap_after=0, window=(0, 40), current=0,
                                movable=True, priority=True)
        drop = planner.LaneItem(id='d', length=10, gap_after=0, window=(0, 40), current=20,
                                movable=True, priority=False)
        slot = planner.SlotRequest(count=1, length=5, clearance=0)
        plan = planner.plan_lane([keep, drop], slot, relaxations={'removeNonPriority': True})
        self.assertIn('d', plan['model']['removed'])
        self.assertNotIn('k', plan['model']['removed'])
        self.assertIn('removeNonPriority', plan['model']['relaxations'])

    def test_intruders_movable(self):
        # an intruder pinned as immovable blocks a slot; relaxing frees it.
        block = planner.LaneItem(id='x', length=10, gap_after=0, window=(0, 50), current=0,
                                 movable=False, intruder=True)
        slot = planner.SlotRequest(count=1, length=30, clearance=0)
        strict = planner.plan_lane([block], slot)
        relaxed = planner.plan_lane([block], slot, relaxations={'intrudersMovable': True})
        self.assertGreaterEqual(relaxed['maxSlots'], strict['maxSlots'])


class PlanLaneShapeTest(unittest.TestCase):
    def test_plan_lane_body_shape_and_schema(self):
        import json
        schema = json.loads((Path(__file__).resolve().parents[1] / 'schemas' / 'slot-plan.json').read_text())
        a = planner.LaneItem(id='a', length=10, gap_after=2, window=(0, 40), current=0, movable=True)
        b = planner.LaneItem(id='b', length=10, gap_after=2, window=(0, 60), current=30, movable=True)
        slot = planner.SlotRequest(count=1, length=8, clearance=1)
        plan = planner.plan_lane([a, b], slot, lane_id='V:1')
        self.assertEqual(plan['lane'], 'V:1')
        self.assertIn('maxSlots', plan)
        self.assertIn('feasible', plan)
        stamped = core.stamp('slot-plan', plan)
        self.assertEqual(core.validate(stamped, schema), [])

    def test_plan_lane_infeasible_reports_reason(self):
        a = planner.LaneItem(id='a', length=10, gap_after=0, window=(0, 0), current=0, movable=False)
        b = planner.LaneItem(id='b', length=10, gap_after=0, window=(12, 12), current=12, movable=False)
        slot = planner.SlotRequest(count=3, length=50, clearance=0)
        plan = planner.plan_lane([a, b], slot)
        self.assertFalse(plan['feasible'])
        self.assertTrue(plan['infeasibleReason'])
        self.assertEqual(plan['moves'], [])


class SentinelTest(unittest.TestCase):
    def test_sentinels_excluded_and_lane_range_honoured(self):
        # lane [0,200); one movable item at 100. Ask for 2 slots of span 20.
        items = with_sentinels(
            [planner.LaneItem(id='m', length=20, gap_after=0, window=(0, 180), current=100, movable=True)],
            0, 200)
        slot = planner.SlotRequest(count=2, length=18, clearance=1)
        res = planner.fewest_moves(items, slot)
        self.assertTrue(res['feasible'])
        self.assertNotIn('@start', res['positions'])
        self.assertNotIn('@end', res['positions'])
        self.assertEqual(set(res['positions']), {'m'})
        self.assertTrue(plan_is_feasible(
            [it for it in items],  # verifier uses the same sentinel model
            slot, dict(res['positions'], **{'@start': 0, '@end': 200}), res['slotStarts']))
        plan = planner.plan_lane(items, slot, lane_id='H:0')
        self.assertTrue(plan['feasible'])
        self.assertNotIn('@start', [m['id'] for m in plan['moves']])


class PerformanceTest(unittest.TestCase):
    def test_huge_windows_under_bound(self):
        # 60 items, windows 30,000 grid steps wide: (a)+(b)+(c) under 60 s.
        items = []
        cursor = 0
        for i in range(60):
            current = cursor + 15000
            items.append(planner.LaneItem(id='h%d' % i, length=20, gap_after=5,
                                          window=(cursor, cursor + 30000), current=current,
                                          movable=True))
            cursor += 30100
        slot = planner.SlotRequest(count=3, length=40, clearance=2)
        t0 = time.time()
        planner.plan_lane(items, slot)
        elapsed = time.time() - t0
        self.assertLess(elapsed, 60.0, 'planner took %.2fs' % elapsed)

    def test_sixty_items_wide_windows_under_bound(self):
        # 60 items, windows 2000 grid steps wide: (a)+(b)+(c) well under 10 s.
        items = []
        cursor = 0
        for i in range(60):
            length = 20
            current = cursor + 1000
            items.append(planner.LaneItem(id='w%d' % i, length=length, gap_after=5,
                                          window=(cursor, cursor + 2000), current=current,
                                          movable=True))
            cursor += 2100
        slot = planner.SlotRequest(count=3, length=40, clearance=2)
        t0 = time.time()
        plan = planner.plan_lane(items, slot)
        elapsed = time.time() - t0
        self.assertIn('maxSlots', plan)
        self.assertLess(elapsed, 10.0, 'planner took %.2fs' % elapsed)


if __name__ == '__main__':
    unittest.main()
