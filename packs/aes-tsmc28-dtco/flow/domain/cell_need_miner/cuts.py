"""K-feasible cut enumeration and exact truth-table evaluation on an AIG.

Derived from the validated IBEX Pattern Mining delivery.  The implementation
keeps the classic bottom-up merge and makes polarity explicit at the output so
an inverted mapped output cannot silently become a different function.
"""

from .aig import lit_node


def enumerate_cuts(aig, k=4, max_cuts=32):
    cuts = {0: [frozenset((0,))]}
    for primary_input in aig.pis:
        cuts[primary_input] = [frozenset((primary_input,))]

    def prune(candidates):
        kept = []
        for candidate in sorted(set(candidates), key=lambda item: (len(item), tuple(sorted(item)))):
            if any(previous <= candidate for previous in kept):
                continue
            kept.append(candidate)
            if len(kept) >= max_cuts:
                break
        return kept

    for node in aig.topo_and_nodes():
        left, right = aig.fanins(node)
        merged = [frozenset((node,))]
        for left_cut in cuts[lit_node(left)]:
            for right_cut in cuts[lit_node(right)]:
                candidate = left_cut | right_cut
                if len(candidate) <= k:
                    merged.append(candidate)
        cuts[node] = prune(merged)
    return cuts


def _elementary(count):
    columns = []
    for index in range(count):
        value = 0
        for vector in range(1 << count):
            if (vector >> index) & 1:
                value |= 1 << vector
        columns.append(value)
    return columns


def literal_truth_table(aig, root_literal, leaves):
    ordered = tuple(sorted(leaves))
    count = len(ordered)
    mask = (1 << (1 << count)) - 1
    leaf_tables = dict(zip(ordered, _elementary(count)))
    memo = {}

    def evaluate(literal):
        node = literal >> 1
        complement = literal & 1
        if node in leaf_tables:
            base = leaf_tables[node]
        elif node == 0:
            base = 0
        elif node in memo:
            base = memo[node]
        else:
            left, right = aig.fanins(node)
            base = evaluate(left) & evaluate(right) & mask
            memo[node] = base
        return base ^ mask if complement else base

    return evaluate(root_literal), ordered, count, mask
