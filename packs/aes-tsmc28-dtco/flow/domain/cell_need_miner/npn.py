"""
NPN canonicalization: collapse a Boolean function to a representative invariant
under input Negation, input Permutation, and output Negation.

This is what turns *structural* pattern mining into *functional* pattern mining:
every way a synthesizer happened to draw an AOI21/XOR/MUX collapses to one class.

For small k (cuts are k<=~5) we enumerate the whole NPN group
(k! * 2^k * 2 transforms) and take the lexicographic minimum truth table as the
canonical form -- exact, not heuristic.
"""
import itertools

_perm_cache = {}


def _perms(k):
    if k not in _perm_cache:
        _perm_cache[k] = list(itertools.permutations(range(k)))
    return _perm_cache[k]


def support(tt, k):
    """Return the list of variables the function actually depends on."""
    s = []
    n = 1 << k
    for v in range(k):
        dep = False
        for m in range(n):
            if (m >> v) & 1:
                continue
            if ((tt >> m) & 1) != ((tt >> (m | (1 << v))) & 1):
                dep = True
                break
        if dep:
            s.append(v)
    return s


def reduce_support(tt, k):
    """Project the function onto its true support; returns (tt2, k2)."""
    supp = support(tt, k)
    k2 = len(supp)
    n2 = 1 << k2
    res = 0
    for mm in range(n2):
        m = 0
        for j, v in enumerate(supp):
            if (mm >> j) & 1:
                m |= (1 << v)
        if (tt >> m) & 1:
            res |= (1 << mm)
    return res, k2


def _transform(tt, k, perm, nmask, o, full):
    n = 1 << k
    res = 0
    for mm in range(n):
        m = 0
        for j in range(k):
            bit = (mm >> j) & 1
            v = perm[j]
            if (nmask >> v) & 1:
                bit ^= 1
            if bit:
                m |= (1 << v)
        if (tt >> m) & 1:
            res |= (1 << mm)
    if o:
        res ^= full
    return res


def npn_canonical(tt, k):
    """Exact NPN canonical form (min truth table over the whole NPN group)."""
    if k == 0:
        return (tt & 1), 0
    full = (1 << (1 << k)) - 1
    best = None
    for perm in _perms(k):
        for nmask in range(1 << k):
            for o in (0, 1):
                t = _transform(tt, k, perm, nmask, o, full)
                if best is None or t < best:
                    best = t
    return best, k


# ---- naming of well-known classes ---------------------------------------

def _tt_from_predicate(k, pred):
    tt = 0
    for m in range(1 << k):
        bits = [(m >> i) & 1 for i in range(k)]
        if pred(bits):
            tt |= (1 << m)
    return tt


def _build_name_table():
    reps = []
    # k=1
    reps.append(("BUF/INV", 1, _tt_from_predicate(1, lambda b: b[0] == 1)))
    # k=2
    reps.append(("AND2-class (AND/OR/NAND/NOR)", 2, _tt_from_predicate(2, lambda b: b[0] and b[1])))
    reps.append(("XOR2-class (XOR/XNOR)", 2, _tt_from_predicate(2, lambda b: b[0] ^ b[1])))
    # k=3
    reps.append(("AND3-class", 3, _tt_from_predicate(3, lambda b: b[0] and b[1] and b[2])))
    reps.append(("XOR3-class  << full-adder SUM", 3, _tt_from_predicate(3, lambda b: b[0] ^ b[1] ^ b[2])))
    reps.append(("MAJ3-class  << full-adder CARRY", 3, _tt_from_predicate(3, lambda b: (b[0] + b[1] + b[2]) >= 2)))
    reps.append(("MUX2-class (s?b:a)", 3, _tt_from_predicate(3, lambda b: b[1] if b[0] == 0 else b[2])))
    reps.append(("AOI21/OAI21-class (2-1 complex gate)", 3, _tt_from_predicate(3, lambda b: not ((b[0] and b[1]) or b[2]))))
    reps.append(("XOR-AND-class ((a^b)&c)", 3, _tt_from_predicate(3, lambda b: (b[0] ^ b[1]) and b[2])))
    # k=4
    reps.append(("AOI22-class", 4, _tt_from_predicate(4, lambda b: not ((b[0] and b[1]) or (b[2] and b[3])))))
    reps.append(("XOR4-class", 4, _tt_from_predicate(4, lambda b: b[0] ^ b[1] ^ b[2] ^ b[3])))
    reps.append(("MUX4/2-of-4-class", 4, _tt_from_predicate(4, lambda b: (b[2] if b[0] == 0 else b[3]) if b[1] == 0 else (b[2] if b[0] == 0 else b[3]))))

    table = {}
    for name, k, tt in reps:
        tt2, k2 = reduce_support(tt, k)
        canon, kk = npn_canonical(tt2, k2)
        table[(kk, canon)] = name
    return table


NAME_TABLE = _build_name_table()


def name_of(k, canon):
    return NAME_TABLE.get((k, canon))
