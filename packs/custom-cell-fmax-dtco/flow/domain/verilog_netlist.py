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
# portable across Site-supplied technology profiles.)
MODULE_RE = re.compile(r"(?ms)^[ \t]*module\s+(\S+?)\b(.*?)^[ \t]*endmodule")
CELL_INST_RE = re.compile(
    r"(?ms)^\s*([A-Za-z_][A-Za-z0-9_$]*)"
    r"\s+([^\s(]+)\s*\((.*?)\)\s*;"
)
CONN_RE = re.compile(r"\.(\w+)\s*\(\s*([^)]*?)\s*\)")
SIMPLE_NET_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_$]*(?:\[[0-9]+\])?\Z")

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


class VerilogNetlistError(ValueError):
    """The structural mapped netlist is incomplete or electrically ambiguous."""


@dataclass(frozen=True)
class PinEndpoint:
    instance: str
    cell_type: str
    pin: str


@dataclass(frozen=True)
class NamedNetGraph:
    instances: dict
    drivers: dict
    sinks: dict
    aliases: tuple
    canonical_nets: dict


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


def top_instances(text: str, top: str):
    """Return the one requested module instead of guessing a design top."""
    modules = parse_modules(text)
    if top not in modules:
        raise VerilogNetlistError("mapped netlist has no top module %s" % top)
    return modules[top]


def _without_verilog_comments(text):
    return re.sub(r"/\*.*?\*/|//[^\n]*", "", text, flags=re.DOTALL)


def top_assign_aliases(text: str, top: str):
    """Return validated ``(lhs, rhs)`` aliases from the selected module.

    The proxy models only zero-delay scalar net aliases. Every continuous
    ``assign`` is inspected; expressions, constants, slices, delays, strengths,
    malformed statements and repeated left-hand drivers fail closed.
    """
    bodies = {}
    for match in MODULE_RE.finditer(text):
        name, body = match.group(1), match.group(2)
        if name in bodies:
            raise VerilogNetlistError("mapped netlist has duplicate module %s" % name)
        bodies[name] = body
    if top not in bodies:
        raise VerilogNetlistError("mapped netlist has no top module %s" % top)
    body = _without_verilog_comments(bodies[top])
    aliases = []
    seen_lhs = set()
    cursor = 0
    while True:
        match = re.search(r"\bassign\b", body[cursor:])
        if match is None:
            break
        start = cursor + match.end()
        end = body.find(";", start)
        if end < 0:
            raise VerilogNetlistError("unterminated continuous assign in top %s" % top)
        statement = body[start:end].strip()
        cursor = end + 1
        if statement.count("=") != 1:
            raise VerilogNetlistError(
                "unsupported continuous assign expression %r" % statement
            )
        lhs, rhs = (re.sub(r"\s+", "", item) for item in statement.split("=", 1))
        if not SIMPLE_NET_RE.fullmatch(lhs) or not SIMPLE_NET_RE.fullmatch(rhs):
            raise VerilogNetlistError(
                "unsupported continuous assign expression %r" % statement
            )
        if lhs in seen_lhs:
            raise VerilogNetlistError(
                "continuous assign net %s has multiple assign drivers" % lhs
            )
        seen_lhs.add(lhs)
        aliases.append((lhs, rhs))
    return tuple(aliases)


def _canonical_aliases(aliases):
    outgoing = {}
    for lhs, rhs in aliases:
        if lhs in outgoing:
            raise VerilogNetlistError(
                "continuous assign net %s has multiple assign drivers" % lhs
            )
        outgoing[lhs] = rhs
    visiting = set()
    visited = set()

    def visit(net, path):
        if net in visiting:
            cycle = path[path.index(net):]
            raise VerilogNetlistError(
                "continuous assign alias cycle: %s" % " -> ".join(cycle)
            )
        if net in visited or net not in outgoing:
            return
        visiting.add(net)
        visit(outgoing[net], path + [outgoing[net]])
        visiting.remove(net)
        visited.add(net)

    for net in sorted(outgoing):
        visit(net, [net])

    parent = {}

    def root(net):
        parent.setdefault(net, net)
        while parent[net] != net:
            parent[net] = parent[parent[net]]
            net = parent[net]
        return net

    for lhs, rhs in aliases:
        left, right = root(lhs), root(rhs)
        if left != right:
            low, high = sorted((left, right))
            parent[high] = low
    return {net: root(net) for net in sorted(parent)}


def build_named_net_graph(instances, pin_directions, aliases=()):
    """Index named instance connections using Library-declared pin directions.

    ``pin_directions`` is ``{cell_type: {pin: input|output}}``. Unknown cells,
    unknown connected pins, missing connections, inout pins, and multiply driven
    nets fail closed. Top-level ports and constants may appear as undriven input
    nets; the timing owner decides whether they belong to its analysis scope.
    """
    canonical_nets = _canonical_aliases(aliases)
    by_name = {}
    drivers = {}
    sinks = {}
    direct_driver_nets = set()
    for instance in sorted(instances, key=lambda item: item.name):
        if instance.name in by_name:
            raise VerilogNetlistError("duplicate mapped instance %s" % instance.name)
        directions = pin_directions.get(instance.cell_type)
        if directions is None:
            raise VerilogNetlistError(
                "mapped instance %s uses unknown cell %s"
                % (instance.name, instance.cell_type)
            )
        unknown = sorted(set(instance.conns) - set(directions))
        if unknown:
            raise VerilogNetlistError(
                "mapped instance %s connects unknown pins %s"
                % (instance.name, ", ".join(unknown))
            )
        missing = sorted(
            pin for pin, direction in directions.items()
            if direction == "input" and pin not in instance.conns
        )
        if missing:
            raise VerilogNetlistError(
                "mapped instance %s is missing named pin connections %s"
                % (instance.name, ", ".join(missing))
            )
        normalized_connections = {
            pin: canonical_nets.get(net, net)
            for pin, net in instance.conns.items()
        }
        by_name[instance.name] = Instance(
            instance.module, instance.cell_type, instance.name, normalized_connections
        )
        for pin, net in sorted(instance.conns.items()):
            direction = directions[pin]
            if not net and direction == "output":
                continue
            if not net:
                raise VerilogNetlistError(
                    "mapped instance %s pin %s is unconnected" % (instance.name, pin)
                )
            net = normalized_connections[pin]
            endpoint = PinEndpoint(instance.name, instance.cell_type, pin)
            if direction == "input":
                sinks.setdefault(net, []).append(endpoint)
            elif direction == "output":
                direct_driver_nets.add(instance.conns[pin])
                drivers.setdefault(net, []).append(endpoint)
            else:
                raise VerilogNetlistError(
                    "mapped instance %s pin %s has unsupported direction %s"
                    % (instance.name, pin, direction)
                )
    assigned_and_direct = sorted({lhs for lhs, _rhs in aliases} & direct_driver_nets)
    if assigned_and_direct:
        raise VerilogNetlistError(
            "continuous assign nets also have direct cell drivers: %s"
            % ", ".join(assigned_and_direct)
        )
    ambiguous = {
        net: endpoints for net, endpoints in drivers.items() if len(endpoints) != 1
    }
    if ambiguous:
        details = "; ".join(
            "%s=%s" % (net, ",".join(item.instance + "/" + item.pin for item in endpoints))
            for net, endpoints in sorted(ambiguous.items())
        )
        raise VerilogNetlistError("mapped netlist has ambiguous drivers: " + details)
    return NamedNetGraph(
        dict(sorted(by_name.items())),
        {net: endpoints[0] for net, endpoints in sorted(drivers.items())},
        {net: tuple(sorted(endpoints, key=lambda item: (item.instance, item.pin)))
         for net, endpoints in sorted(sinks.items())},
        tuple(aliases),
        canonical_nets,
    )


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
