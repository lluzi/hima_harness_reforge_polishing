# Source: read-only himaharness/extensions/xspace_cell_aes_tsmc28/flow/bin/verilog_netlist.py
# Original SHA-256: d205b31f7cd758d8afe0e086b991d5743417a451a2efa328cb29751d6495a2e8
# Standalone domain parser; no legacy Runtime dependency.
#!/usr/bin/env python3
"""Structural Verilog instance reader for the bounded pattern miner.

Two netlist dialects must be readable by one miner:

  MAPPED   -- the DC gate netlist: named connections only,
              ``sky130_fd_sc_hd__nand2_1 U12 (.A(a), .B(b), .Y(y));``
  UNMAPPED -- the technology-independent netlist: Verilog *primitive* gates in
              POSITIONAL form with the output first,
              ``nand g133 (n_1368, a[1], a[0]);``
              alongside named-form sequential elements
              ``CDN_flop r0 (.clk(clk), .d(n1182), ... , .q(q));``

The miner's cluster composer only understands named connections, so this module
carries the positional-primitive adapter: a positional instantiation of a known
Verilog gate primitive is rewritten to the named form ``.Y(out) .A0(in0)
.A1(in1) ...`` and retyped to a synthetic generic cell name that encodes the
observed arity (``GEN_nand2``, ``GEN_not1``, ...). ``generic_skeleton.py``
emits a Liberty skeleton using exactly the same naming and pin convention, so
the unmapped graph gets real Boolean functions without a vendor Liberty.

Nothing here is library-specific: the instance regex matches any identifier, and
the primitive table is the Verilog-1364 gate set.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass

# Library-agnostic: any identifier may be a cell type. (The upstream miner
# pinned this to a single TSMC family; that lock-in is removed.)
MODULE_RE = re.compile(r"(?ms)^module\s+(\S+?)\b(.*?)^endmodule")
CELL_INST_RE = re.compile(
    r"(?ms)^\s*([A-Za-z_][A-Za-z0-9_$]*)"
    r"\s+([^\s(]+)\s*\((.*?)\)\s*;"
)
CONN_RE = re.compile(r"\.(\w+)\s*\(\s*([^)]*?)\s*\)")

# Verilog primitive gates in the technology-independent input. Output pin first.
PRIMITIVE_GATES = ("and", "or", "nand", "nor", "xor", "xnor", "not", "buf")
SINGLE_INPUT_GATES = ("not", "buf")
GENERIC_PREFIX = "GEN_"


@dataclass(frozen=True)
class Instance:
    module: str
    cell_type: str
    name: str
    conns: dict

    @property
    def base_type(self) -> str:
        return self.cell_type


def generic_cell_name(gate: str, arity: int) -> str:
    """Synthetic generic-cell type carrying the observed input count."""
    return "%s%s%d" % (GENERIC_PREFIX, gate, arity)


def generic_pin_names(arity: int):
    """Named-form pins the adapter and the synthetic skeleton both use."""
    return ["A%d" % index for index in range(arity)], "Y"


def _split_positional(body: str):
    """Split an instantiation body on top-level commas."""
    terms = []
    depth = 0
    current = []
    for character in body:
        if character in "([{":
            depth += 1
        elif character in ")]}":
            depth -= 1
        if character == "," and depth == 0:
            terms.append("".join(current).strip())
            current = []
            continue
        current.append(character)
    tail = "".join(current).strip()
    if tail:
        terms.append(tail)
    return [re.sub(r"\s+", "", term) for term in terms if term]


def parse_modules(text: str):
    """Return {module: [Instance, ...]} for both dialects.

    Positional primitive instantiations are adapted in place; every returned
    Instance therefore carries named connections.
    """
    modules = {}
    for module_match in MODULE_RE.finditer(text):
        module, body = module_match.group(1), module_match.group(2)
        instances = []
        for inst_match in CELL_INST_RE.finditer(body):
            cell_type, name, conn_body = inst_match.groups()
            named = CONN_RE.findall(conn_body)
            if named:
                conns = {
                    pin: re.sub(r"\s+", "", net) for pin, net in named
                }
                instances.append(Instance(module, cell_type, name, conns))
                continue
            if cell_type not in PRIMITIVE_GATES:
                # A positional instantiation of something that is not a known
                # Verilog primitive has no derivable pin order. Skipping is the
                # only honest option: guessing an order would silently compose
                # the wrong Boolean function.
                continue
            terms = _split_positional(conn_body)
            if len(terms) < 2:
                continue
            arity = len(terms) - 1
            if cell_type in SINGLE_INPUT_GATES and arity != 1:
                continue
            inputs, output = generic_pin_names(arity)
            conns = {output: terms[0]}
            for pin, net in zip(inputs, terms[1:]):
                conns[pin] = net
            instances.append(
                Instance(
                    module,
                    generic_cell_name(cell_type, arity),
                    name,
                    conns,
                )
            )
        modules[module] = instances
    return modules


def generic_arity_census(modules):
    """Observed (gate, arity) mix, keyed by synthetic generic cell type."""
    counter = Counter()
    for instances in modules.values():
        for instance in instances:
            if instance.cell_type.startswith(GENERIC_PREFIX):
                counter[instance.cell_type] += 1
    return dict(sorted(counter.items()))


def cell_type_census(modules):
    counter = Counter()
    for instances in modules.values():
        for instance in instances:
            counter[instance.cell_type] += 1
    return dict(sorted(counter.items()))
