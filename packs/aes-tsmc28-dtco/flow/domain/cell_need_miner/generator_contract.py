"""Build the Boolean portion of a Standard Cell Generator request.

The generator-facing function syntax is a deliberately explicit subset of
Liberty: prefix ``!`` plus ``^``, ``&`` and ``|`` binary operators.  Every
binary expression is parenthesized so a downstream Liberty parser does not
need to rely on implicit-AND or precedence conventions.
"""

from __future__ import annotations

import hashlib
import itertools
import json


def substitute_ast(ast, environment):
    """Replace variables in ``ast`` with ASTs from ``environment``."""
    op = ast[0]
    if op == "var":
        return environment.get(ast[1], ast)
    if op == "const":
        return ast
    if op == "not":
        return ("not", substitute_ast(ast[1], environment))
    return (
        op,
        substitute_ast(ast[1], environment),
        substitute_ast(ast[2], environment),
    )


def simplify_ast(ast):
    """Apply small, semantics-preserving rewrites for readable output."""
    op = ast[0]
    if op in ("var", "const"):
        return ast
    if op == "not":
        child = simplify_ast(ast[1])
        if child[0] == "const":
            return ("const", 1 - child[1])
        if child[0] == "not":
            return simplify_ast(child[1])
        return ("not", child)

    left = simplify_ast(ast[1])
    right = simplify_ast(ast[2])
    if repr(right) < repr(left):
        left, right = right, left
    if op == "and":
        if left == ("const", 0) or right == ("const", 0):
            return ("const", 0)
        if left == ("const", 1):
            return right
        if right == ("const", 1) or left == right:
            return left
    if op == "or":
        if left == ("const", 1) or right == ("const", 1):
            return ("const", 1)
        if left == ("const", 0):
            return right
        if right == ("const", 0) or left == right:
            return left
    if op == "xor":
        if left == ("const", 0):
            return right
        if right == ("const", 0):
            return left
        if left == right:
            return ("const", 0)
        if left == ("const", 1):
            return simplify_ast(("not", right))
        if right == ("const", 1):
            return simplify_ast(("not", left))
    return (op, left, right)


def liberty_function(ast):
    """Serialize an internal Boolean AST as an exact Liberty expression."""
    ast = simplify_ast(ast)
    op = ast[0]
    if op == "var":
        return ast[1]
    if op == "const":
        return str(ast[1])
    if op == "not":
        child = liberty_function(ast[1])
        if ast[1][0] in ("var", "const"):
            return f"!{child}"
        return f"!{child}"
    symbol = {"and": "&", "or": "|", "xor": "^"}[op]
    return f"({liberty_function(ast[1])} {symbol} {liberty_function(ast[2])})"


def liberty_sop(table, input_order):
    """Return a minimum implicant/literal SOP for a small truth table."""
    input_count = len(input_order)
    full = (1 << (1 << input_count)) - 1
    if table == 0:
        return "0"
    if table == full:
        return "1"

    valid = []
    for cube in itertools.product((-1, 0, 1), repeat=input_count):
        covered = 0
        for vector in range(1 << input_count):
            if all(
                state == -1 or ((vector >> index) & 1) == state
                for index, state in enumerate(cube)
            ):
                covered |= 1 << vector
        if covered and not (covered & ~table):
            valid.append((cube, covered))
    primes = [
        item
        for item in valid
        if not any(
            item[1] != other[1] and item[1] & ~other[1] == 0
            for other in valid
        )
    ]

    def cube_expression(cube):
        literals = [
            (pin if state else f"!{pin}")
            for pin, state in zip(input_order, cube)
            if state != -1
        ]
        if not literals:
            return "1"
        if len(literals) == 1:
            return literals[0]
        return "(" + " & ".join(literals) + ")"

    states = {0: (0, 0, ())}
    for cube, covered in primes:
        expression = cube_expression(cube)
        literal_count = sum(state != -1 for state in cube)
        updated = dict(states)
        for prior_cover, score in states.items():
            new_cover = prior_cover | covered
            terms = tuple(sorted((*score[2], expression)))
            candidate = (score[0] + 1, score[1] + literal_count, terms)
            current = updated.get(new_cover)
            if current is None or candidate < current:
                updated[new_cover] = candidate
        states = updated
    terms = states[table][2]
    if len(terms) == 1:
        return terms[0]
    return "(" + " | ".join(terms) + ")"


def compact_liberty_function(ast, input_order):
    """Choose the shorter exact expression from structural and minimized SOP."""
    structural = liberty_function(ast)
    minimized_sop = liberty_sop(truth_table(ast, input_order), input_order)
    return min((structural, minimized_sop), key=lambda item: (len(item), item))


def eval_ast(ast, environment):
    """Evaluate an internal Boolean AST using a 0/1 variable environment."""
    op = ast[0]
    if op == "var":
        return environment[ast[1]]
    if op == "const":
        return ast[1]
    if op == "not":
        return 1 - eval_ast(ast[1], environment)
    left = eval_ast(ast[1], environment)
    right = eval_ast(ast[2], environment)
    if op == "and":
        return left & right
    if op == "or":
        return left | right
    if op == "xor":
        return left ^ right
    raise ValueError(f"unsupported Boolean AST operation: {op}")


def truth_table(ast, input_order):
    """Return a Liberty-function truth table with input_order[0] as bit 0."""
    table = 0
    for vector in range(1 << len(input_order)):
        environment = {
            pin: (vector >> index) & 1
            for index, pin in enumerate(input_order)
        }
        if eval_ast(ast, environment):
            table |= 1 << vector
    return table


def support_indices(table, input_count):
    """Return input indexes on which a truth table functionally depends."""
    support = []
    for index in range(input_count):
        depends = False
        for vector in range(1 << input_count):
            if (vector >> index) & 1:
                continue
            other = vector | (1 << index)
            if ((table >> vector) & 1) != ((table >> other) & 1):
                depends = True
                break
        if depends:
            support.append(index)
    return support


def timing_sense(table, input_count, input_index):
    """Derive Liberty timing_sense for one input-to-output relation."""
    rises = False
    falls = False
    for vector in range(1 << input_count):
        if (vector >> input_index) & 1:
            continue
        low = (table >> vector) & 1
        high = (table >> (vector | (1 << input_index))) & 1
        rises |= low == 0 and high == 1
        falls |= low == 1 and high == 0
    if rises and falls:
        return "non_unate"
    if rises:
        return "positive_unate"
    if falls:
        return "negative_unate"
    return "independent"


def equivalence_digest(input_order, output_order, output_tables):
    """Hash the exact ordered truth-vector used as the equivalence oracle."""
    payload = {
        "input_order": list(input_order),
        "output_order": list(output_order),
        "output_truth_tables_hex": {
            output: hex(output_tables[output]) for output in output_order
        },
    }
    encoded = json.dumps(
        payload, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def readable_truth_table(input_order, output_order, output_tables):
    """Return the v2 row-oriented truth table used by people and generators.

    The row order is the same deterministic vector order used by the digest,
    but no consumer has to infer LSB/MSB conventions or decode a packed hex
    integer: every pin value is explicit in every row.
    """
    columns = list(input_order) + list(output_order)
    rows = []
    for vector in range(1 << len(input_order)):
        row = [int((vector >> index) & 1) for index in range(len(input_order))]
        row.extend(
            int((output_tables[output] >> vector) & 1)
            for output in output_order
        )
        rows.append(row)
    return {"columns": columns, "rows": rows}


def validate_generation_request(request):
    """Return semantic contract errors not expressible in JSON Schema alone."""
    from .liberty import parse_function

    errors = []
    if request.get("schema_version") != "standard-cell-generation-request/v2":
        errors.append("unsupported schema_version")
    contract = request.get("generator_contract", {})
    interface = contract.get("interface", {})
    inputs = interface.get("inputs", [])
    outputs = interface.get("outputs", [])
    input_order = [pin.get("name") for pin in inputs]
    output_order = [pin.get("name") for pin in outputs]
    all_pins = input_order + output_order
    if None in all_pins or len(all_pins) != len(set(all_pins)):
        errors.append("pin names must be present and unique")

    reference = contract.get("equivalence_reference", {})
    if reference.get("input_order") != input_order:
        errors.append("equivalence input_order differs from interface order")
    if reference.get("output_order") != output_order:
        errors.append("equivalence output_order differs from interface order")

    readable = contract.get("truth_table")
    if not isinstance(readable, dict):
        errors.append("truth_table must be present in the readable v2 form")

    tables = {}
    for pin in outputs:
        output = pin.get("name")
        expression = pin.get("liberty_function")
        if not expression:
            errors.append(f"{output}: missing liberty_function")
            continue
        try:
            table = truth_table(parse_function(expression), input_order)
        except Exception as exc:
            errors.append(f"{output}: invalid liberty_function: {exc}")
            continue
        tables[output] = table
        expected = reference.get("output_truth_tables_hex", {}).get(output)
        if expected is None or int(expected, 16) != table:
            errors.append(f"{output}: function/truth-table mismatch")

    if len(tables) == len(output_order):
        expected_digest = equivalence_digest(input_order, output_order, tables)
        if reference.get("digest") != expected_digest:
            errors.append("equivalence digest mismatch")
        expected_readable = readable_truth_table(input_order, output_order, tables)
        if readable != expected_readable:
            errors.append("readable truth_table differs from interface functions")

    expected_arcs = set()
    for output in output_order:
        table = tables.get(output)
        if table is None:
            continue
        for index in support_indices(table, len(input_order)):
            expected_arcs.add(
                (
                    input_order[index],
                    output,
                    timing_sense(table, len(input_order), index),
                )
            )
    actual_arcs = {
        (arc.get("related_pin"), arc.get("to_pin"), arc.get("timing_sense"))
        for arc in contract.get("characterization_request", {}).get(
            "timing_arcs", []
        )
    }
    if actual_arcs != expected_arcs:
        errors.append("timing_arcs do not exactly match Boolean support/sense")

    target = contract.get("target_library_profile", {})
    if not target.get("process_family") or not target.get(
        "cell_architecture_ref"
    ):
        errors.append("target library profile is unresolved")
    if not contract.get("characterization_request", {}).get("profile_ref"):
        errors.append("characterization profile is unresolved")
    return errors
