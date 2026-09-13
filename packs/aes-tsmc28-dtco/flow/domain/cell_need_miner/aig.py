"""Minimal structurally hashed And-Inverter Graph.

This module is derived from the validated IBEX Pattern Mining delivery.  AIGER
literal encoding is used: bit zero is polarity and the remaining bits are the
node index.  Node zero is the constant-zero node.
"""

CONST0 = 0
CONST1 = 1


def lit_not(literal):
    return literal ^ 1


def lit_node(literal):
    return literal >> 1


def lit_is_comp(literal):
    return literal & 1


class AIG:
    def __init__(self):
        self.and_gates = {}
        self._strash = {}
        self._n_nodes = 1
        self.pis = []
        self.pi_names = {}
        self.pos = []

    def add_pi(self, name):
        index = self._n_nodes
        self._n_nodes += 1
        self.pis.append(index)
        self.pi_names[index] = name
        return index << 1

    def add_po(self, name, literal):
        self.pos.append((name, literal))

    def mk_and(self, left, right):
        if left == CONST0 or right == CONST0:
            return CONST0
        if left == CONST1:
            return right
        if right == CONST1:
            return left
        if left == right:
            return left
        if left == lit_not(right):
            return CONST0
        key = (left, right) if left <= right else (right, left)
        hit = self._strash.get(key)
        if hit is not None:
            return hit << 1
        index = self._n_nodes
        self._n_nodes += 1
        self.and_gates[index] = key
        self._strash[key] = index
        return index << 1

    def mk_or(self, left, right):
        return lit_not(self.mk_and(lit_not(left), lit_not(right)))

    def mk_xor(self, left, right):
        return self.mk_or(
            self.mk_and(left, lit_not(right)),
            self.mk_and(lit_not(left), right),
        )

    def mk_xnor(self, left, right):
        return lit_not(self.mk_xor(left, right))

    def mk_mux(self, select, left, right):
        return self.mk_or(
            self.mk_and(lit_not(select), left),
            self.mk_and(select, right),
        )

    def is_pi(self, node):
        return node in self.pi_names

    def is_const(self, node):
        return node == 0

    def fanins(self, node):
        return self.and_gates[node]

    def num_ands(self):
        return len(self.and_gates)

    def topo_and_nodes(self):
        order = []
        seen = set()

        def visit(node):
            if node in seen or node == 0 or self.is_pi(node):
                return
            seen.add(node)
            left, right = self.and_gates[node]
            visit(lit_node(left))
            visit(lit_node(right))
            order.append(node)

        for _name, literal in self.pos:
            visit(lit_node(literal))
        for node in list(self.and_gates):
            visit(node)
        return order
