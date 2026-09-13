#!/usr/bin/env python3
"""Bounded, unseeded custom-cell pattern search over ONE netlist graph.

Adapted from the proven ``ibex_pattern_search.py`` bounded search (verified on
this design: 126,723 connected clusters -> 38,682 legal -> 345 new function
classes -> 10 emitted requests). Package-owned changes:

  * ``--source-graph mapped|unmapped``. The two graphs are mined SEPARATELY and
    their supports are never mixed: the mapped graph is the only one carrying
    delay/area/power through Liberty, the technology-independent primitive
    graph carries canonical function. Each run writes its own report.
  * Positional Verilog primitives are read through ``verilog_netlist.py``'s
    adapter, and the unmapped graph's functions come from the synthetic generic
    skeleton; sequential cells (``CDN_flop``) are declared sequential and are
    therefore mining boundaries, never mined through.
  * Deterministic ``candidate_id`` (``CAND_<GRAPH>_<KIND>_<NNNN>``) which is
    also the generated cell name. No model ever authors a cell name.
  * ``implementation_plan``: for every candidate the search derives, from the
    netlist connectivity it already parsed, whether the cluster is executable by
    the Package forge today and -- when it is -- the exact fusion spec
    ``compose_netlist.py`` consumes. This is the G4 feasibility evidence;
    unimplementable discoveries remain counted in their algorithm record but
    never enter the downstream ``generation_requests`` build set.
  * ``--top`` is the custom-cell budget (Owner value 10).

The search itself is unchanged: every connected combinational cluster within
``--max-cells``/``--max-inputs``/``--max-outputs`` is enumerated, reduced to its
exact boundary Boolean vector, grouped by replacement key, and compared against
the library under NPN/NPNP equivalence. It is exhaustive only inside that bound.
"""

from __future__ import annotations

import argparse
import itertools
import json
import os
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from cell_need_miner.generator_contract import (  # noqa: E402
    compact_liberty_function,
    equivalence_digest,
    substitute_ast,
    support_indices,
    timing_sense,
    truth_table,
    readable_truth_table,
    validate_generation_request,
)
from cell_need_miner.liberty import parse_skeleton  # noqa: E402
from cell_need_miner.npn import npn_canonical, reduce_support  # noqa: E402
from verilog_netlist import GENERIC_PREFIX, parse_modules  # noqa: E402

REPORT_SCHEMA = "xspace_cell-pattern-search/v2"
CONSTANT_NETS = ("1'b0", "1'b1", "1'h0", "1'h1")
BUILDABLE_ROUTES = {"fusion", "cluster_compose", "boolean_synthesis"}


@dataclass
class ClusterResult:
    module: str
    instances: tuple
    cell_types: tuple
    boundary_nets: tuple
    output_nets: tuple
    output_asts: tuple
    output_tables: tuple
    current_logic_levels: int
    internal_nets: int
    internal_net_names: tuple
    members: tuple
    replacement_key: tuple
    canonical_input_permutation: tuple
    canonical_output_permutation: tuple
    library_equivalence_key: tuple
    library_matches: tuple


def combinational_instances(instances, cells):
    eligible = {}
    for instance in instances:
        cell = cells.get(instance.base_type)
        if (
            cell is None
            or cell.is_seq
            or not cell.inputs
            or not cell.outputs
            or any(ast is None for ast in cell.outputs.values())
        ):
            continue
        if not all(pin in instance.conns for pin in cell.inputs):
            continue
        if not all(pin in instance.conns for pin in cell.outputs):
            continue
        eligible[instance.name] = instance
    return eligible


def connectivity(instances, cells):
    drivers = defaultdict(list)
    loads = defaultdict(list)
    for instance in instances:
        cell = cells.get(instance.base_type)
        if cell is None:
            continue
        for pin in cell.outputs:
            if pin in instance.conns:
                drivers[instance.conns[pin]].append((instance.name, pin))
        for pin in cell.inputs:
            if pin in instance.conns:
                loads[instance.conns[pin]].append((instance.name, pin))
    return drivers, loads


def enumerate_connected_clusters(eligible, drivers, loads, min_cells, max_cells):
    """Enumerate every connected instance set in a declared size interval.

    The interval lets independent strategy lanes own disjoint search spaces.
    In this Package the compact lane owns size 2 and the depth lane owns size 3,
    so parallel execution does not duplicate work.
    """
    adjacency = {name: set() for name in eligible}
    for net, net_loads in loads.items():
        net_drivers = drivers.get(net, ())
        for driver, _ in net_drivers:
            if driver not in eligible:
                continue
            for load, _ in net_loads:
                if load in eligible and load != driver:
                    adjacency[driver].add(load)
                    adjacency[load].add(driver)

    current = {
        frozenset((left, right))
        for left, neighbors in adjacency.items()
        for right in neighbors
    }
    yielded = set()
    for size in range(2, max_cells + 1):
        next_sets = set()
        for names in sorted(current, key=lambda item: tuple(sorted(item))):
            if len(names) != size or names in yielded:
                continue
            yielded.add(names)
            if size >= min_cells:
                yield names
            frontier = set()
            for name in names:
                frontier.update(adjacency[name])
            for neighbor in frontier - names:
                next_sets.add(frozenset((*names, neighbor)))
        current = next_sets


def cluster_depth(names, eligible, cells, drivers):
    predecessors = {name: set() for name in names}
    for name in names:
        instance = eligible[name]
        cell = cells[instance.base_type]
        for pin in cell.inputs:
            net = instance.conns[pin]
            for driver, _ in drivers.get(net, ()):
                if driver in names:
                    predecessors[name].add(driver)
    memo = {}

    def depth(name, active):
        if name in memo:
            return memo[name]
        if name in active:
            raise ValueError("combinational cycle in cluster")
        value = 1 + max(
            (depth(pred, active | {name}) for pred in predecessors[name]),
            default=0,
        )
        memo[name] = value
        return value

    return max(depth(name, set()) for name in names)


def compose_cluster(module, names, eligible, cells, drivers, loads,
                    max_inputs, max_outputs):
    members = [eligible[name] for name in sorted(names)]
    driven_nets = set()
    input_nets = set()
    for instance in members:
        cell = cells[instance.base_type]
        driven_nets.update(instance.conns[pin] for pin in cell.outputs)
        input_nets.update(instance.conns[pin] for pin in cell.inputs)

    boundary_nets = sorted(
        net
        for net in input_nets
        if not any(driver in names for driver, _ in drivers.get(net, ()))
        and net not in CONSTANT_NETS
    )
    if not 1 <= len(boundary_nets) <= max_inputs:
        return None

    output_nets = []
    internal_net_names = []
    for net in sorted(driven_nets):
        external_load = any(load not in names for load, _ in loads.get(net, ()))
        no_load = not loads.get(net)
        if external_load or no_load:
            output_nets.append(net)
        else:
            internal_net_names.append(net)
    if not 1 <= len(output_nets) <= max_outputs:
        return None

    net_ast = {net: ("var", "I%d" % index) for index, net in enumerate(boundary_nets)}
    net_ast.update({
        "1'b0": ("const", 0),
        "1'h0": ("const", 0),
        "1'b1": ("const", 1),
        "1'h1": ("const", 1),
    })
    pending = list(members)
    while pending:
        progress = False
        remaining = []
        for instance in pending:
            cell = cells[instance.base_type]
            if not all(instance.conns[pin] in net_ast for pin in cell.inputs):
                remaining.append(instance)
                continue
            environment = {pin: net_ast[instance.conns[pin]] for pin in cell.inputs}
            for output_pin, ast in cell.outputs.items():
                net_ast[instance.conns[output_pin]] = substitute_ast(ast, environment)
            progress = True
        if not progress:
            return None
        pending = remaining

    try:
        output_asts = tuple(net_ast[net] for net in output_nets)
    except KeyError:
        return None
    input_order = ["I%d" % index for index in range(len(boundary_nets))]
    output_tables = tuple(truth_table(ast, input_order) for ast in output_asts)
    joint_support = sorted({
        index
        for table in output_tables
        for index in support_indices(table, len(input_order))
    })
    if joint_support != list(range(len(input_order))):
        return None

    return {
        "members": members,
        "boundary_nets": tuple(boundary_nets),
        "output_nets": tuple(output_nets),
        "output_asts": output_asts,
        "output_tables": output_tables,
        "current_logic_levels": cluster_depth(names, eligible, cells, drivers),
        "internal_nets": len(internal_net_names),
        "internal_net_names": tuple(internal_net_names),
    }


def transform_table(table, input_count, permutation, input_negation):
    result = 0
    for new_vector in range(1 << input_count):
        old_vector = 0
        for new_index in range(input_count):
            bit = (new_vector >> new_index) & 1
            old_index = permutation[new_index]
            if (input_negation >> old_index) & 1:
                bit ^= 1
            old_vector |= bit << old_index
        if (table >> old_vector) & 1:
            result |= 1 << new_vector
    return result


_JOINT_CANON_CACHE = {}


def joint_npnp_canonical(tables, input_count):
    """Exact NPNP key with shared input transforms and per-output inversion."""
    cache_key = (input_count, tuple(tables))
    cached = _JOINT_CANON_CACHE.get(cache_key)
    if cached is not None:
        return cached
    full = (1 << (1 << input_count)) - 1
    best = None
    for permutation in itertools.permutations(range(input_count)):
        for negation in range(1 << input_count):
            transformed = []
            for table in tables:
                value = transform_table(table, input_count, permutation, negation)
                transformed.append(min(value, value ^ full))
            signature = tuple(sorted(transformed))
            if best is None or signature < best:
                best = signature
    result = ("NPNP", input_count, len(tables), best)
    _JOINT_CANON_CACHE[cache_key] = result
    return result


def functional_key(output_tables, input_count):
    if len(output_tables) == 1:
        reduced, reduced_k = reduce_support(output_tables[0], input_count)
        canonical, canonical_k = npn_canonical(reduced, reduced_k)
        return ("NPN", canonical_k, canonical)
    return joint_npnp_canonical(output_tables, input_count)


_REPLACEMENT_CANON_CACHE = {}


def replacement_canonical(tables, input_count):
    """Canonicalize only legal pin renaming, never input/output inversion."""
    cache_key = (input_count, tuple(tables))
    cached = _REPLACEMENT_CANON_CACHE.get(cache_key)
    if cached is not None:
        return cached
    best = None
    best_input_permutation = None
    best_output_permutation = None
    for permutation in itertools.permutations(range(input_count)):
        transformed_with_index = sorted(
            (transform_table(table, input_count, permutation, 0), output_index)
            for output_index, table in enumerate(tables)
        )
        transformed = tuple(value for value, _ in transformed_with_index)
        if best is None or transformed < best:
            best = transformed
            best_input_permutation = permutation
            best_output_permutation = tuple(
                output_index for _, output_index in transformed_with_index
            )
    result = ("NP", input_count, len(tables), best)
    value = (result, best_input_permutation, best_output_permutation)
    _REPLACEMENT_CANON_CACHE[cache_key] = value
    return value


def library_indexes(cells, max_inputs, max_outputs):
    index = defaultdict(set)
    for cell in cells.values():
        if (
            cell.is_seq
            or not cell.inputs
            or not cell.outputs
            or len(cell.inputs) > max_inputs
            or len(cell.outputs) > max_outputs
            or any(ast is None for ast in cell.outputs.values())
        ):
            continue
        tables = tuple(truth_table(ast, cell.inputs) for ast in cell.outputs.values())
        joint_support = sorted({
            variable
            for table in tables
            for variable in support_indices(table, len(cell.inputs))
        })
        if joint_support != list(range(len(cell.inputs))):
            continue
        index[functional_key(tables, len(cell.inputs))].add(cell.name)
    return {key: tuple(sorted(names)) for key, names in index.items()}


def greedy_nonoverlap(sites):
    selected = []
    occupied = defaultdict(set)
    for site in sorted(sites, key=lambda item: (item.module, item.instances)):
        used = occupied[site.module]
        if used.isdisjoint(site.instances):
            selected.append(site)
            used.update(site.instances)
    return selected


def replacement_alignment_valid(representative, site):
    """Check that pin permutations make a site implement the same contract."""
    input_count = len(representative.boundary_nets)
    for site_vector in range(1 << input_count):
        representative_vector = 0
        for canonical_index in range(input_count):
            representative_local = representative.canonical_input_permutation[canonical_index]
            site_local = site.canonical_input_permutation[canonical_index]
            representative_vector |= ((site_vector >> site_local) & 1) << representative_local
        for canonical_output in range(len(representative.output_tables)):
            representative_output = representative.canonical_output_permutation[canonical_output]
            site_output = site.canonical_output_permutation[canonical_output]
            expected = (representative.output_tables[representative_output]
                        >> representative_vector) & 1
            actual = (site.output_tables[site_output] >> site_vector) & 1
            if expected != actual:
                return False
    return True


def key_string(key):
    if key[0] == "NPN":
        return "NPN:k%d:0x%x" % (key[1], key[2])
    payload = ",".join("0x%x" % table for table in key[3])
    return "%s:k%d:m%d:[%s]" % (key[0], key[1], key[2], payload)


# --------------------------------------------------------------------------
# G4 feasibility: can the Package forge build this candidate today?
# --------------------------------------------------------------------------

def _cluster_net_name(net, boundary_names, output_names, internal_names):
    if net in boundary_names:
        return boundary_names[net]
    if net in output_names:
        return output_names[net]
    if net in internal_names:
        return internal_names[net]
    if net in ("1'b0", "1'h0"):
        return "gnd"
    if net in ("1'b1", "1'h1"):
        return "vdd"
    raise ValueError("cluster pin references an unclassified net %r" % net)


def _cluster_compose_spec(name, representative, cells, input_order, output_order):
    """Build a deterministic N-stage CDL-flattening contract for one cluster."""
    boundary_names = dict(zip(representative.boundary_nets, input_order))
    output_names = dict(zip(representative.output_nets, output_order))
    internal_names = {
        net: "XI%d" % index
        for index, net in enumerate(sorted(representative.internal_net_names))
    }
    stages = []
    for index, instance in enumerate(
        sorted(representative.members, key=lambda item: item.name)
    ):
        cell = cells[instance.base_type]
        connections = {}
        for pin in list(cell.inputs) + list(cell.outputs):
            net = instance.conns.get(pin)
            if net is None:
                raise ValueError(
                    "instance %s is missing required pin %s" % (instance.name, pin)
                )
            connections[pin] = _cluster_net_name(
                net, boundary_names, output_names, internal_names
            )
        stages.append({
            "stage_id": "S%d" % index,
            "cell": instance.base_type,
            "connections": dict(sorted(connections.items())),
        })
    return {
        "name": name,
        "external_inputs": list(input_order),
        "external_outputs": list(output_order),
        "internal_nets": [internal_names[key] for key in sorted(internal_names)],
        "stages": stages,
        "function": compact_liberty_function(
            representative.output_asts[0], input_order
        ),
    }


def derive_implementation_plan(name, representative, cells, input_order, output_order):
    """Derive the executable forge input for a candidate, or say why not.

    The Package owns two transistor-level routes.  The compact ``fusion`` route
    preserves the proven two-stage contract.  ``cluster_compose`` flattens a
    connected two- or three-stage mapped cluster from the same foundry CDL and
    preserves repeated boundary fanout plus every internal net explicitly.
    This function reports feasibility honestly rather than inventing a route:

      route=fusion       -> a complete fusion spec, byte-identical in shape to
                            the specs the 0.4.x catalog carried, derived from
                            this design's own connectivity.
      route=cluster_compose -> a complete multi-stage flattening specification.
      route=unsupported  -> counted by the discovery algorithm but excluded
                            from generation_requests because it cannot reach G4.
    """
    members = representative.members
    reasons = []
    generic = sorted({
        instance.base_type for instance in members
        if instance.base_type.startswith(GENERIC_PREFIX)
    })
    if generic:
        reasons.append(
            "generic gates %s have no foundry CDL topology; the unmapped graph "
            "yields canonical-function evidence, not a forge input" % ", ".join(generic))
    if len(representative.output_nets) != 1:
        reasons.append("cluster has %d outputs; current forge routes emit 1"
                       % len(representative.output_nets))
    if len(members) not in (2, 3):
        reasons.append("cluster has %d cells; current forge routes support 2 or 3"
                       % len(members))
    if representative.internal_nets < 1:
        reasons.append("cluster has no internal net and is not a connected fusion")
    if reasons:
        return {"route": "unsupported", "reasons": reasons}

    # Any mapped single-output connected cluster in the bounded 2..3-cell
    # search has a lossless CDL-flattening route.  Keep the smaller legacy
    # fusion contract when its stricter one-net/one-pin assumptions hold; use
    # cluster_compose for repeated boundary fanout or more than two stages.
    try:
        cluster_spec = _cluster_compose_spec(
            name, representative, cells, input_order, output_order
        )
    except ValueError as exc:
        return {"route": "unsupported", "reasons": [str(exc)]}

    if len(members) != 2 or representative.internal_nets != 1:
        return {"route": "cluster_compose", "cluster_spec": cluster_spec}

    internal = representative.internal_net_names[0]
    first = second = None
    c1_out = c2_in = None
    for instance in members:
        cell = cells[instance.base_type]
        for pin in cell.outputs:
            if instance.conns.get(pin) == internal:
                first, c1_out = instance, pin
        for pin in cell.inputs:
            if instance.conns.get(pin) == internal:
                second, c2_in = instance, pin
    if first is None or second is None or first is second:
        return {"route": "unsupported",
                "reasons": ["internal net %s does not connect exactly one driver "
                            "to one load inside the cluster" % internal]}

    # Every free input pin of both stages must bind to exactly one distinct
    # boundary net; a shared or constant-tied pin has no representation in the
    # fusion spec and would silently produce a different cell.
    slots = []
    for tag, instance in (("cell1", first), ("cell2", second)):
        cell = cells[instance.base_type]
        for pin in cell.inputs:
            net = instance.conns.get(pin)
            if net == internal:
                continue
            slots.append((net, tag, pin))
    nets_used = [net for net, _tag, _pin in slots]
    if len(nets_used) != len(set(nets_used)):
        return {"route": "cluster_compose", "cluster_spec": cluster_spec}
    if sorted(set(nets_used)) != sorted(representative.boundary_nets):
        return {"route": "cluster_compose", "cluster_spec": cluster_spec}

    net_to_contract_pin = {
        net: input_order[index]
        for index, net in enumerate(representative.boundary_nets)
    }
    pins = {}
    for net, tag, pin in slots:
        pins[net_to_contract_pin[net]] = [tag, pin]

    function = compact_liberty_function(representative.output_asts[0], input_order)
    return {
        "route": "fusion",
        "fusion_spec": {
            "name": name,
            "cell1": first.base_type,
            "c1_out": c1_out,
            "cell2": second.base_type,
            "c2_in": c2_in,
            "output": output_order[0],
            "pins": {pin: pins[pin] for pin in sorted(pins)},
            "function": function,
        },
    }


def shared_logic_evidence(representative, cells):
    """Prove that a multi-output mapped cluster shares an internal computation.

    Sharing input names is not sufficient.  For each boundary output this walks
    backward through the induced instance DAG and requires at least one mapped
    instance to be an ancestor of every output.
    """
    members = {instance.name: instance for instance in representative.members}
    drivers = defaultdict(list)
    predecessors = {name: set() for name in members}
    for instance in members.values():
        cell = cells[instance.base_type]
        for pin in cell.outputs:
            drivers[instance.conns[pin]].append(instance.name)
    for instance in members.values():
        cell = cells[instance.base_type]
        for pin in cell.inputs:
            for driver in drivers.get(instance.conns[pin], ()):
                if driver != instance.name:
                    predecessors[instance.name].add(driver)

    def ancestors(name):
        seen = set()
        stack = [name]
        while stack:
            current = stack.pop()
            if current in seen:
                continue
            seen.add(current)
            stack.extend(predecessors[current])
        return seen

    output_drivers = []
    for net in representative.output_nets:
        local = sorted(set(drivers.get(net, ())))
        if len(local) != 1:
            return {
                "status": "FAIL",
                "reason": "boundary output %s has %d local drivers" % (net, len(local)),
                "shared_instances": [],
            }
        output_drivers.append(local[0])
    shared = None
    for driver in output_drivers:
        current = ancestors(driver)
        shared = current if shared is None else shared & current
    return {
        "status": "PASS" if shared else "FAIL",
        "reason": (
            "all boundary output cones share mapped logic"
            if shared else "output cones share no mapped internal computation"
        ),
        "output_drivers": output_drivers,
        "shared_instances": sorted(shared or ()),
    }


def generator_request(candidate_id, sites, nonoverlap, cells, args):
    sites = sorted(sites, key=lambda item: (item.module, item.instances))
    representative = sites[0]
    input_order = ["I%d" % index for index in range(len(representative.boundary_nets))]
    output_order = [
        "Y" if len(representative.output_nets) == 1 else "Y%d" % index
        for index in range(len(representative.output_nets))
    ]
    output_tables = dict(zip(output_order, representative.output_tables))
    output_functions = {
        pin: compact_liberty_function(ast, input_order)
        for pin, ast in zip(output_order, representative.output_asts)
    }
    arcs = []
    for output in output_order:
        table = output_tables[output]
        for input_index in support_indices(table, len(input_order)):
            sense = timing_sense(table, len(input_order), input_index)
            if sense == "independent":
                continue
            arcs.append({
                "related_pin": input_order[input_index],
                "to_pin": output,
                "timing_sense": sense,
            })
    cell_counts = [len(site.instances) for site in sites]
    levels = [site.current_logic_levels for site in sites]
    occurrences_by_module = Counter(site.module for site in sites)

    representative_input_to_canonical = {
        local_index: canonical_index
        for canonical_index, local_index in enumerate(
            representative.canonical_input_permutation)
    }
    representative_output_to_canonical = {
        local_index: canonical_index
        for canonical_index, local_index in enumerate(
            representative.canonical_output_permutation)
    }
    occurrence_alignments = []
    for site in sites:
        if not replacement_alignment_valid(representative, site):
            raise RuntimeError(
                "Replacement Key grouped a site without a valid pin alignment")
        pin_mapping = {}
        for local_index, pin in enumerate(input_order):
            canonical_index = representative_input_to_canonical[local_index]
            pin_mapping[pin] = site.boundary_nets[
                site.canonical_input_permutation[canonical_index]]
        for local_index, pin in enumerate(output_order):
            canonical_index = representative_output_to_canonical[local_index]
            pin_mapping[pin] = site.output_nets[
                site.canonical_output_permutation[canonical_index]]
        occurrence_alignments.append({
            "module": site.module,
            "instances": list(site.instances),
            "contract_pin_mapping": pin_mapping,
        })

    implementation_plan = derive_implementation_plan(
        candidate_id, representative, cells, input_order, output_order)

    output_count = len(output_order)
    algorithm = (
        "REPEATED_CLUSTER" if output_count == 1
        else "MULTI_OUTPUT_SHARED_LOGIC"
    )
    shared_audit = (
        shared_logic_evidence(representative, cells)
        if output_count > 1 else None
    )
    return {
        "schema_version": "standard-cell-generation-request/v2",
        "candidate_id": candidate_id,
        "generator_contract": {
            "cell_kind": "combinational",
            "target_library_profile": {
                "process_family": args.process_family,
                "cell_architecture_ref": args.cell_architecture_ref,
            },
            "interface": {
                "inputs": [{"name": pin, "direction": "input"} for pin in input_order],
                "outputs": [
                    {
                        "name": pin,
                        "direction": "output",
                        "liberty_function": output_functions[pin],
                    }
                    for pin in output_order
                ],
                "pg_pins_from_library_profile": True,
            },
            "equivalence_reference": {
                "input_order": input_order,
                "output_order": output_order,
                "truth_table_indexing":
                    "vector_index=sum(input_order[i]*2^i); bit0_is_vector0",
                "output_truth_tables_hex": {
                    pin: hex(output_tables[pin]) for pin in output_order
                },
                "digest": equivalence_digest(input_order, output_order, output_tables),
            },
            "truth_table": readable_truth_table(
                input_order, output_order, output_tables
            ),
            "implementation_request": {
                "mode": "synthesize_transistor_topology",
                "drive_strengths": list(args.drive_strength),
                "vt_classes": list(args.vt_class),
            },
            "characterization_request": {
                "profile_ref": args.characterization_profile_ref,
                "model_types": list(args.model_type),
                "timing_arcs": arcs,
            },
            "deliverables": ["SPICE", "GDS", "LEF", "LIBERTY", "VERILOG"],
        },
        "discovery_evidence": {
            "discovery_algorithm": algorithm,
            "strategy_id": args.strategy_id,
            "search_objective": args.objective,
            "source_graph": args.source_graph,
            "replacement_key": key_string(representative.replacement_key),
            "library_equivalence_key": key_string(representative.library_equivalence_key),
            "library_function_match": "ABSENT_UNDER_NPN_OR_NPNP_EQUIVALENCE",
            "raw_support": len(sites),
            "non_overlapping_support": len(nonoverlap),
            "non_overlapping_support_method": "deterministic_greedy_lower_bound",
            "occurrences_by_module": dict(sorted(occurrences_by_module.items())),
            "occurrence_alignments": occurrence_alignments,
            "equivalence_status": "EXACT_TRUTH_TABLE_FROM_COMPOSED_LIBERTY_FUNCTIONS",
            "ppa_status": "UNPROVEN",
            "search_bound": {
                "min_cells": args.min_cells,
                "max_cells": args.max_cells,
                "max_inputs": args.max_inputs,
                "max_outputs": args.max_outputs,
                "cell_family_seed": None,
                "instance_seed": None,
            },
            "current_cells_per_site": {"min": min(cell_counts), "max": max(cell_counts)},
            "current_logic_levels_per_site": {"min": min(levels), "max": max(levels)},
            "representative_occurrence": {
                "module": representative.module,
                "instances": list(representative.instances),
                "cell_types": list(representative.cell_types),
                "pin_mapping": {
                    **dict(zip(input_order, representative.boundary_nets)),
                    **dict(zip(output_order, representative.output_nets)),
                },
                "internal_nets": representative.internal_nets,
            },
            "shared_logic_audit": shared_audit,
        },
        "gate_evidence": {
            "G0_discovery": {
                "status": "PASS",
                "evidence": "raw_support=%d non_overlapping_support=%d in %s"
                            % (len(sites), len(nonoverlap), args.source_graph),
            },
            "G1_boundary": {
                "status": "PASS",
                "evidence": "boundary audit: %d inputs, %d outputs, %d internal nets; "
                            "sequential cells are mining boundaries"
                            % (len(input_order), len(output_order),
                               representative.internal_nets),
            },
            "G2_function": {
                "status": "PASS",
                "evidence": "exact truth tables composed from Liberty functions; "
                            "digest re-derivable from input_order/output_order",
            },
            "G3_library_gap": {
                "status": "PASS",
                "evidence": "ABSENT_UNDER_NPN_OR_NPNP_EQUIVALENCE against the "
                            "parsed library index",
            },
            "G4_circuit_feasibility": {
                "status": "READY" if implementation_plan["route"] != "unsupported"
                          else "NOT_IMPLEMENTABLE",
                "evidence": implementation_plan["route"],
                "reasons": implementation_plan.get("reasons") or [],
            },
        },
        "implementation_plan": implementation_plan,
        "advisories": [
            {
                "severity": "warning",
                "code": "PPA_NOT_PROVEN",
                "message": "The Boolean gap and occurrences are measured; transistor, "
                           "layout, characterization, mapper selection and re-STA/PPA "
                           "have not been completed.",
                "next_action": "Run the trial: forge, mock-characterize, deploy, and "
                               "read G6 mapper selection plus G7 PPA verification.",
            },
            {
                "severity": "info",
                "code": "BOUNDED_SEARCH",
                "message": "The result is exhaustive only for connected clusters inside "
                           "the declared max_cells/max_inputs/max_outputs bound.",
            },
        ],
    }


def run(args):
    netlist_text = Path(args.netlist).read_text(encoding="utf-8", errors="replace")
    modules = parse_modules(netlist_text)
    cells = parse_skeleton(args.liberty_skeleton)
    library = library_indexes(cells, args.max_inputs, args.max_outputs)

    groups = defaultdict(list)
    statistics = Counter()
    for module, instances in modules.items():
        eligible = combinational_instances(instances, cells)
        drivers, loads = connectivity(instances, cells)
        for names in enumerate_connected_clusters(
                eligible, drivers, loads, args.min_cells, args.max_cells):
            statistics["connected_clusters"] += 1
            composed = compose_cluster(module, names, eligible, cells, drivers, loads,
                                       args.max_inputs, args.max_outputs)
            if composed is None:
                statistics["boundary_rejected"] += 1
                continue
            if len(composed["output_tables"]) > 1:
                temporary = ClusterResult(
                    module=module,
                    instances=tuple(instance.name for instance in composed["members"]),
                    cell_types=tuple(instance.cell_type for instance in composed["members"]),
                    boundary_nets=composed["boundary_nets"],
                    output_nets=composed["output_nets"],
                    output_asts=composed["output_asts"],
                    output_tables=composed["output_tables"],
                    current_logic_levels=composed["current_logic_levels"],
                    internal_nets=composed["internal_nets"],
                    internal_net_names=composed["internal_net_names"],
                    members=tuple(composed["members"]),
                    replacement_key=(),
                    canonical_input_permutation=(),
                    canonical_output_permutation=(),
                    library_equivalence_key=(),
                    library_matches=(),
                )
                if shared_logic_evidence(temporary, cells)["status"] != "PASS":
                    statistics["multi_output_no_shared_logic"] += 1
                    continue
            statistics["legal_clusters"] += 1
            library_key = functional_key(composed["output_tables"],
                                         len(composed["boundary_nets"]))
            (replacement_key,
             canonical_input_permutation,
             canonical_output_permutation) = replacement_canonical(
                composed["output_tables"], len(composed["boundary_nets"]))
            matches = library.get(library_key, ())
            statistics["library_covered" if matches else "library_absent"] += 1
            members = composed["members"]
            groups[replacement_key].append(ClusterResult(
                module=module,
                instances=tuple(instance.name for instance in members),
                cell_types=tuple(instance.cell_type for instance in members),
                boundary_nets=composed["boundary_nets"],
                output_nets=composed["output_nets"],
                output_asts=composed["output_asts"],
                output_tables=composed["output_tables"],
                current_logic_levels=composed["current_logic_levels"],
                internal_nets=composed["internal_nets"],
                internal_net_names=composed["internal_net_names"],
                members=tuple(members),
                replacement_key=replacement_key,
                canonical_input_permutation=canonical_input_permutation,
                canonical_output_permutation=canonical_output_permutation,
                library_equivalence_key=library_key,
                library_matches=matches,
            ))

    new_groups = [
        (key, sites, greedy_nonoverlap(sites))
        for key, sites in groups.items()
        if not sites[0].library_matches and len(sites) >= args.min_support
    ]

    def group_rank(item):
        _, sites, nonoverlap = item
        representative = sites[0]
        if args.objective == "covered_cell_compaction":
            return (
                -len(nonoverlap) * max(1, len(representative.instances) - 1),
                -sum(site.internal_nets for site in nonoverlap),
                -len(nonoverlap),
                key_string(item[0]),
            )
        if args.objective == "single_output_mapper_fit":
            return (
                len(representative.output_tables) != 1,
                len(representative.boundary_nets),
                -len(nonoverlap),
                -len(representative.instances),
                key_string(item[0]),
            )
        return (
            -len(nonoverlap),
            -sum(site.internal_nets for site in nonoverlap),
            -max(site.current_logic_levels for site in sites),
            -len(sites),
            key_string(item[0]),
        )

    single_groups = sorted(
        (item for item in new_groups if len(item[1][0].output_tables) == 1),
        key=group_rank)
    multi_groups = sorted(
        (item for item in new_groups if len(item[1][0].output_tables) > 1),
        key=group_rank)
    graph_token = args.source_graph.upper()
    strategy_token = re.sub(
        r"[^A-Za-z0-9]+", "_", args.strategy_id
    ).strip("_").upper()

    # ``generation_requests`` is the set the next stage must build in full.
    # Determine G4 feasibility before applying the shared route budget.  The
    # previous fixed half-single/half-multi split admitted NOT_IMPLEMENTABLE
    # multi-output discoveries and made the Child fail only after its real
    # search had completed.  Keep both discovery algorithms visible, then
    # round-robin only their buildable results.
    ranked_by_kind = {"SINGLE": single_groups, "MULTI": multi_groups}
    buildable_by_kind = {"SINGLE": [], "MULTI": []}
    not_buildable_by_kind = Counter()
    for kind in ("SINGLE", "MULTI"):
        for index, item in enumerate(ranked_by_kind[kind], 1):
            _key, sites, _nonoverlap = item
            representative = sorted(
                sites, key=lambda site: (site.module, site.instances)
            )[0]
            input_order = [
                "I%d" % offset
                for offset in range(len(representative.boundary_nets))
            ]
            output_order = [
                "Y" if len(representative.output_nets) == 1 else "Y%d" % offset
                for offset in range(len(representative.output_nets))
            ]
            candidate_id = "CAND_%s_%s_%s_%04d" % (
                strategy_token, graph_token, kind, index)
            plan = derive_implementation_plan(
                candidate_id, representative, cells, input_order, output_order
            )
            if plan.get("route") in BUILDABLE_ROUTES:
                buildable_by_kind[kind].append((kind, index, item))
            else:
                not_buildable_by_kind[kind] += 1

    selected_groups = []
    if args.objective == "boundary_function_diversity":
        buckets = defaultdict(list)
        for kind in ("SINGLE", "MULTI"):
            for entry in buildable_by_kind[kind]:
                _kind, _index, (_key, sites, _nonoverlap) = entry
                representative = sites[0]
                signature = (
                    len(representative.boundary_nets),
                    len(representative.output_tables),
                    len(representative.instances),
                    representative.current_logic_levels,
                )
                buckets[signature].append(entry)
        signatures = sorted(buckets)
        while len(selected_groups) < args.top and any(buckets.values()):
            for signature in signatures:
                if buckets[signature] and len(selected_groups) < args.top:
                    selected_groups.append(buckets[signature].pop(0))
    else:
        max_buildable = max(
            len(buildable_by_kind["SINGLE"]),
            len(buildable_by_kind["MULTI"]),
        )
        for offset in range(max_buildable):
            for kind in ("SINGLE", "MULTI"):
                if offset < len(buildable_by_kind[kind]):
                    selected_groups.append(buildable_by_kind[kind][offset])
                    if len(selected_groups) == args.top:
                        break
            if len(selected_groups) == args.top:
                break

    requests = []
    for kind, index, (_key, sites, nonoverlap) in selected_groups:
        candidate_id = "CAND_%s_%s_%s_%04d" % (
            strategy_token, graph_token, kind, index)
        requests.append(generator_request(candidate_id, sites, nonoverlap, cells, args))
    if len(requests) > args.top:
        raise RuntimeError("emitted %d candidates above the budget of %d"
                           % (len(requests), args.top))
    for request in requests:
        errors = validate_generation_request(request)
        if errors:
            raise RuntimeError("%s contract validation failed: %s"
                               % (request["candidate_id"], "; ".join(errors)))

    report = {
        "report_schema": REPORT_SCHEMA,
        "strategy_id": args.strategy_id,
        "source_graph": args.source_graph,
        "algorithms": ["repeated_cluster", "multi_output_shared_logic"],
        "inputs": {
            "netlist": os.path.abspath(str(args.netlist)),
            "liberty_function_skeleton": os.path.abspath(str(args.liberty_skeleton)),
        },
        "search_definition": {
            "route": args.strategy_id,
            "objective": args.objective,
            "enumeration": "all connected combinational instance sets within the bound",
            "min_cells": args.min_cells,
            "max_cells": args.max_cells,
            "max_inputs": args.max_inputs,
            "max_outputs": args.max_outputs,
            "min_support": args.min_support,
            "custom_cell_budget": args.top,
            "preselected_cell_families": [],
            "preselected_instances": [],
        },
        "statistics": dict(sorted(statistics.items())),
        "algorithm_records": {
            "repeated_cluster": {
                "candidate_count": sum(
                    1 for item in requests
                    if item["discovery_evidence"]["discovery_algorithm"] == "REPEATED_CLUSTER"
                ),
                "discovered_candidate_count": len(single_groups),
                "buildable_candidate_count": len(buildable_by_kind["SINGLE"]),
                "not_buildable_candidate_count": not_buildable_by_kind["SINGLE"],
                "support_method": "raw plus deterministic greedy non-overlap lower bound",
            },
            "multi_output_shared_logic": {
                "candidate_count": sum(
                    1 for item in requests
                    if item["discovery_evidence"]["discovery_algorithm"] == "MULTI_OUTPUT_SHARED_LOGIC"
                ),
                "discovered_candidate_count": len(multi_groups),
                "buildable_candidate_count": len(buildable_by_kind["MULTI"]),
                "not_buildable_candidate_count": not_buildable_by_kind["MULTI"],
                "requires_shared_internal_instance": True,
            },
        },
        "distinct_function_classes": len(groups),
        "new_function_classes_at_min_support": len(new_groups),
        "new_function_classes_by_output_count": dict(sorted(
            Counter(len(sites[0].output_tables) for _, sites, _ in new_groups).items())),
        "generation_requests": requests,
        "limitations": [
            "The Liberty input is a function/area skeleton, not the full "
            "characterization library.",
            "No transistor or layout feasibility, delay, area, power or mapper-"
            "selection benefit is claimed by the search itself.",
            "The greedy non-overlap count is a deterministic lower bound, not a "
            "maximum independent-set proof.",
            "Mapped and unmapped supports are separate observations and must never "
            "be summed; only the mapped graph carries delay through Liberty.",
        ],
    }
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, sort_keys=False) + "\n",
                      encoding="utf-8")
    return report


def arguments(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--netlist", type=Path, required=True)
    parser.add_argument("--liberty-skeleton", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--source-graph", choices=("mapped", "unmapped"), required=True)
    parser.add_argument("--strategy-id", default="structure_frequency",
                        help="stable strategy identity used in provenance and candidate ids")
    parser.add_argument(
        "--objective",
        default="nonoverlap_frequency",
        choices=(
            "nonoverlap_frequency",
            "covered_cell_compaction",
            "single_output_mapper_fit",
            "boundary_function_diversity",
        ),
    )
    parser.add_argument("--min-cells", type=int, default=2)
    parser.add_argument("--max-cells", type=int, default=3)
    parser.add_argument("--max-inputs", type=int, default=4)
    parser.add_argument("--max-outputs", type=int, default=4)
    parser.add_argument("--min-support", type=int, default=2)
    parser.add_argument("--top", type=int, default=10,
                        help="custom-cell budget: the maximum candidates emitted")
    # Technology-driven defaults; still overridable per run. XSPACE_TECH selects the profile.
    parser.add_argument("--process-family", required=True)
    parser.add_argument("--cell-architecture-ref", required=True)
    parser.add_argument("--characterization-profile-ref", required=True)
    # A drive-strength code and a threshold-voltage class are naming conventions of the target
    # library, so this package holds neither: both come from the site-bound technology profile,
    # and an unfilled profile yields an EMPTY request rather than a plausible-looking wrong one.
    # The implementation request that carries them is read by a person and by the transistor
    # synthesiser, and a code from the wrong library there is worse than no code at all.
    parser.add_argument("--drive-strength", action="append", required=True)
    parser.add_argument("--vt-class", action="append", required=True)
    parser.add_argument("--model-type", action="append", default=["NLDM"])
    args = parser.parse_args(argv)
    if not re.fullmatch(r"[a-z][a-z0-9_]{2,47}", args.strategy_id):
        parser.error("--strategy-id must match [a-z][a-z0-9_]{2,47}")
    if args.min_cells < 2 or args.min_cells > args.max_cells:
        parser.error("--min-cells must be >= 2 and <= --max-cells")
    if not 1 <= args.top <= 40:
        parser.error("--top must be within 1..40")
    return args


# Owner ceiling (PLAN Q3): the Agent may tighten inside this bound, never widen.
OWNER_CEILING = {"max_cells": 3, "max_inputs": 4, "max_outputs": 4}


def main(argv=None):
    args = arguments(argv)
    for key, ceiling in OWNER_CEILING.items():
        value = getattr(args, key)
        if value > ceiling:
            print("ERROR: %s=%d exceeds the Owner ceiling %d" % (key, value, ceiling),
                  file=sys.stderr)
            return 2
    report = run(args)
    print("PATTERN SEARCH strategy=%s graph=%s: %d connected, %d legal, %d new classes, "
          "%d candidates (budget %d) -> %s"
          % (args.strategy_id,
             args.source_graph,
             report["statistics"].get("connected_clusters", 0),
             report["statistics"].get("legal_clusters", 0),
             report["new_function_classes_at_min_support"],
             len(report["generation_requests"]),
             args.top,
             args.output))
    return 0


if __name__ == "__main__":
    sys.exit(main())
