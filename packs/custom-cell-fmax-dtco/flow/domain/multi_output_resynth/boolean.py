"""Exact small-cut Boolean evaluation used by the logical ECO POC."""

from __future__ import annotations

import itertools


class BooleanError(ValueError):
    pass


def eval_ast(ast, values):
    op = ast[0]
    if op == "var":
        if ast[1] not in values:
            raise BooleanError("missing Boolean input %s" % ast[1])
        return bool(values[ast[1]])
    if op == "const":
        return bool(ast[1])
    if op == "not":
        return not eval_ast(ast[1], values)
    left = eval_ast(ast[1], values)
    right = eval_ast(ast[2], values)
    if op == "and":
        return left and right
    if op == "or":
        return left or right
    if op == "xor":
        return left != right
    raise BooleanError("unsupported Boolean operator %s" % op)


def truth_table(ast, ordered_inputs):
    """Return an integer whose bit N is the output for assignment N."""
    result = 0
    for assignment in range(1 << len(ordered_inputs)):
        values = {
            name: bool((assignment >> index) & 1)
            for index, name in enumerate(ordered_inputs)
        }
        if eval_ast(ast, values):
            result |= 1 << assignment
    return result


def format_table(value, width):
    digits = max(1, (1 << width) // 4)
    return "0x%0*x" % (digits, value)


def permutations(items):
    return itertools.permutations(tuple(items))
