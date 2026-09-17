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
import copy
import hashlib
import itertools
import json
import math
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
from _generation_projection import canonical_cell_name  # noqa: E402
from verilog_netlist import GENERIC_PREFIX, parse_modules  # noqa: E402

REPORT_SCHEMA = "xspace_cell-pattern-search/v2"
CONSTANT_NETS = ("1'b0", "1'b1", "1'h0", "1'h1")
BUILDABLE_ROUTES = {"fusion", "cluster_compose", "boolean_synthesis", "multi_output_resynthesis"}
PORTFOLIO_SCHEMA = "hima.library-richness.portfolio/1"
PORTFOLIO_CANDIDATE_SCHEMA = "hima.library-richness.portfolio-candidate/1"


def classify_dig_opportunity(logic_depth, physical_span_um, *, deep_threshold=8,
                             long_threshold_um=50.0, slack_harvest=False):
    """Classify one graph proposal; classification never admits an ECO."""
    if logic_depth < 0 or physical_span_um < 0:
        raise ValueError("DIG opportunity axes must be nonnegative")
    deep = logic_depth >= deep_threshold
    long_wire = physical_span_um >= long_threshold_um
    if slack_harvest and not deep and not long_wire:
        strategy = "slack-harvesting-compaction"
    elif deep and long_wire:
        strategy = "partitioned-restructure-and-drive"
    elif deep:
        strategy = "single-multi-fusion-layer-removal"
    elif long_wire:
        strategy = "drive-family-or-local-replication"
    else:
        strategy = "bounded-local-logic"
    return {
        "logic_class": "deep" if deep else "shallow",
        "physical_class": "long" if long_wire else "short",
        "quadrant": ("deep" if deep else "shallow") + "-" + ("long" if long_wire else "short"),
        "proposal_strategy": strategy,
        "admitted": False,
    }


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


def evaluate_cover_opportunity(*, opportunity_id, kind, roots, baseline_cover,
                               candidate_cover, model_uncertainty_ns=0.0,
                               physical_penalty_ns=0.0):
    """Evaluate every root of one complete single/multi-output cover."""
    if kind not in {"single-output", "multi-output", "physical-fusion"}:
        raise ValueError("unsupported opportunity kind")
    if not isinstance(roots, list) or not roots:
        raise ValueError("cover opportunity requires at least one root")
    if not isinstance(baseline_cover, dict) or not isinstance(candidate_cover, dict):
        raise ValueError("baseline and candidate cover must be objects")
    checks, deltas, reasons = [], {}, []
    for index, root in enumerate(roots):
        if not isinstance(root, dict):
            raise ValueError("root %d must be an object" % index)
        name = str(root.get("root") or "").strip()
        endpoint = str(root.get("endpoint") or "").strip()
        required = root.get("required_time_ns")
        arrival = root.get("candidate_arrival_ns")
        output_used = root.get("output_used") is True
        if not name or not endpoint or not all(
                isinstance(value, (int, float)) and not isinstance(value, bool)
                and math.isfinite(float(value)) for value in (required, arrival)):
            raise ValueError("root %d has incomplete timing identity" % index)
        required_met = float(arrival) <= float(required)
        if not output_used:
            reasons.append("unused-output:%s" % name)
        if not required_met:
            reasons.append("required-time-miss:%s" % name)
        base_delay = baseline_cover.get(name)
        candidate_delay = candidate_cover.get(name)
        if not all(isinstance(value, (int, float)) and not isinstance(value, bool)
                   and math.isfinite(float(value)) for value in (base_delay, candidate_delay)):
            raise ValueError("cover delay is missing for root %s" % name)
        delta = (float(base_delay) - float(candidate_delay)
                 - float(model_uncertainty_ns) - float(physical_penalty_ns))
        deltas[endpoint] = round(delta, 12)
        checks.append({
            "root": name, "endpoint": endpoint, "output_used": output_used,
            "required_time_met": required_met, "baseline_delay_ns": float(base_delay),
            "candidate_delay_ns": float(candidate_delay),
            "conservative_delta_ns": round(delta, 12),
        })
    if any(value <= 0 for value in deltas.values()):
        reasons.append("non-positive-conservative-root")
    return {
        "schema": "hima.lfr-cover-opportunity/1", "opportunity_id": opportunity_id,
        "kind": kind, "status": "admitted" if not reasons else "rejected",
        "root_checks": checks, "delta_slack_by_endpoint": deltas,
        "rejection_reasons": sorted(set(reasons)),
        "baseline_cover": dict(baseline_cover), "candidate_cover": dict(candidate_cover),
    }


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


def _stable_digest(value):
    payload = json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def project_candidate_identity(request):
    """Project function, pin interface, and drive variants independently.

    Candidate names are run-local and therefore are not an identity.  This
    projection deliberately keeps the NPN/NPNP Boolean class separate from the
    ordered generator interface and from physical drive/VT variants.  The
    result is deterministic and contains enough raw material to recompute each
    key; it makes no timing, mapping-adoption, or commercial-benefit claim.
    """
    if not isinstance(request, dict):
        raise ValueError("candidate request must be an object")
    contract = request.get("generator_contract")
    if not isinstance(contract, dict):
        raise ValueError("candidate generator_contract must be an object")
    reference = contract.get("equivalence_reference")
    if not isinstance(reference, dict):
        raise ValueError("candidate equivalence_reference must be an object")
    input_order = reference.get("input_order")
    output_order = reference.get("output_order")
    encoded_tables = reference.get("output_truth_tables_hex")
    if (
        not isinstance(input_order, list)
        or not input_order
        or not all(isinstance(pin, str) and pin for pin in input_order)
    ):
        raise ValueError("candidate input_order must be a non-empty string array")
    if (
        not isinstance(output_order, list)
        or not output_order
        or not all(isinstance(pin, str) and pin for pin in output_order)
    ):
        raise ValueError("candidate output_order must be a non-empty string array")
    if not isinstance(encoded_tables, dict):
        raise ValueError("candidate output_truth_tables_hex must be an object")
    tables = []
    for output in output_order:
        encoded = encoded_tables.get(output)
        if not isinstance(encoded, str):
            raise ValueError("candidate truth table for %s must be a string" % output)
        try:
            table = int(encoded, 0)
        except ValueError as exc:
            raise ValueError(
                "candidate truth table for %s is not an integer" % output
            ) from exc
        limit = 1 << (1 << len(input_order))
        if table < 0 or table >= limit:
            raise ValueError("candidate truth table for %s exceeds its interface" % output)
        tables.append(table)

    function_class = key_string(functional_key(tuple(tables), len(input_order)))
    interface = {
        "inputs": list(input_order),
        "outputs": list(output_order),
        "input_count": len(input_order),
        "output_count": len(output_order),
    }
    implementation = contract.get("implementation_request")
    if not isinstance(implementation, dict):
        raise ValueError("candidate implementation_request must be an object")
    drives = implementation.get("drive_strengths")
    vt_classes = implementation.get("vt_classes")
    if (
        not isinstance(drives, list)
        or not drives
        or not all(isinstance(value, str) and value for value in drives)
    ):
        raise ValueError("candidate drive_strengths must be a non-empty string array")
    if (
        not isinstance(vt_classes, list)
        or not vt_classes
        or not all(isinstance(value, str) and value for value in vt_classes)
    ):
        raise ValueError("candidate vt_classes must be a non-empty string array")
    drive_variants = [
        {"drive_strength": drive, "vt_class": vt}
        for drive in sorted(set(drives))
        for vt in sorted(set(vt_classes))
    ]
    function_interface = {
        "function_class": function_class,
        "interface": interface,
    }
    function_interface_id = "LFRFI_" + _stable_digest(function_interface)[:24]
    return {
        "schema": "hima.library-richness.candidate-identity/1",
        "function_class": function_class,
        "interface": interface,
        "function_interface_id": function_interface_id,
        "drive_variants": [
            dict(
                variant,
                variant_id="LFRDV_" + _stable_digest({
                    "function_interface_id": function_interface_id,
                    **variant,
                })[:24],
            )
            for variant in drive_variants
        ],
    }


def _finite_number(value):
    return (
        not isinstance(value, bool)
        and isinstance(value, (int, float))
        and math.isfinite(float(value))
    )


def _generation_request(candidate):
    nested = candidate.get("generation_request") if isinstance(candidate, dict) else None
    if isinstance(nested, dict):
        return nested
    if isinstance(candidate, dict) and isinstance(candidate.get("generator_contract"), dict):
        return candidate
    return None


def _request_occurrence_keys(request):
    evidence = request.get("discovery_evidence") or {}
    occurrences = evidence.get("occurrences") or []
    keys = set()
    for occurrence in occurrences:
        if not isinstance(occurrence, dict):
            continue
        module = occurrence.get("module")
        if not isinstance(module, str) or not module:
            continue
        covered = occurrence.get("covered_instance_keys")
        if isinstance(covered, list):
            keys.update(
                name for name in covered if isinstance(name, str) and name
            )
        origins = occurrence.get("mapped_origins")
        if isinstance(origins, list):
            keys.update(
                "%s/%s" % (module, name)
                for name in origins if isinstance(name, str) and name
            )
        root = occurrence.get("root_instance")
        if isinstance(root, str) and root:
            keys.add("%s/%s" % (module, root))
        roots = occurrence.get("root_instances")
        if isinstance(roots, list):
            keys.update(
                "%s/%s" % (module, name)
                for name in roots if isinstance(name, str) and name
            )
    for occurrence in evidence.get("occurrence_alignments") or []:
        if not isinstance(occurrence, dict):
            continue
        module = occurrence.get("module")
        instances = occurrence.get("instances")
        if isinstance(module, str) and module and isinstance(instances, list):
            keys.update(
                "%s/%s" % (module, name)
                for name in instances if isinstance(name, str) and name
            )
    return sorted(keys)


def _structural_influence_from_discovery(request, evidence):
    """Project mapped-cluster evidence into F1 without inventing timing.

    Structure miners already prove the exact boundary, function, occurrence
    set and build route.  They intentionally do not carry a timing
    counterfactual; F3 is measured later by the paired mapper/STA round.
    """
    levels = evidence.get("current_logic_levels_per_site") or {}
    cells = evidence.get("current_cells_per_site") or {}
    representative = evidence.get("representative_occurrence") or {}
    contract = request.get("generator_contract") or {}
    interface = contract.get("interface") or {}
    raw_support = _number_or_none(evidence.get("raw_support"))
    nonoverlap = _number_or_none(evidence.get("non_overlapping_support"))
    before = _number_or_none(levels.get("max"))
    cell_count = _number_or_none(cells.get("max"))
    internal_nets = _number_or_none(representative.get("internal_nets"))
    inputs = interface.get("inputs") or []
    outputs = interface.get("outputs") or []
    overlap_ratio = None
    if raw_support is not None and raw_support > 0 and nonoverlap is not None:
        overlap_ratio = max(0.0, 1.0 - nonoverlap / raw_support)
    shared = evidence.get("shared_logic_audit") or {}
    shared_instances = shared.get("shared_instances") or []
    return {
        "mapping_feasible": True,
        "logic_depth_before": before,
        "logic_depth_after": 1.0 if before is not None else None,
        "removable_node_count": (
            max(0.0, cell_count - 1.0) if cell_count is not None else None
        ),
        "removable_edge_count": internal_nets,
        "cut_boundary_input_count": len(inputs),
        "cut_boundary_output_count": len(outputs),
        "reconvergence_node_count": len(shared_instances),
        "dominator_endpoint_coverage": 0.0,
        "overlap_ratio": overlap_ratio,
        "path_family_count": 0,
        "structural_metrics": {
            "levels_removed": (
                max(0.0, before - 1.0) if before is not None else None
            ),
            "nodes_removed": (
                max(0.0, cell_count - 1.0) if cell_count is not None else None
            ),
            "edges_removed": internal_nets,
            "cut_width": len(inputs) + len(outputs),
            "reconvergence_coverage": len(shared_instances),
            "dominator_endpoint_coverage": 0.0,
            "overlap_ratio": overlap_ratio,
        },
    }


def _number_or_none(value):
    return float(value) if _finite_number(value) else None


def _counterfactual_bound(counterfactual):
    if not isinstance(counterfactual, dict):
        return {
            "status": "missing",
            "unit": "delay_unit",
            "break_even_delay": None,
            "proxy_cell_delay": None,
            "margin": None,
            "reasons": ["counterfactual evidence is absent"],
        }
    direct_break_even = _number_or_none(counterfactual.get("local_break_even_du"))
    proxy_cell = _number_or_none(counterfactual.get("new_cell_delay_du"))
    if proxy_cell is None:
        proxy_cell = _number_or_none(counterfactual.get("proxy_cell_delay_du"))
    penalty_keys = (
        "boundary_penalty_du",
        "fanout_penalty_du",
        "wire_penalty_du",
        "uncertainty_penalty_du",
    )
    penalties = [_number_or_none(counterfactual.get(key)) for key in penalty_keys]
    reasons = []
    gross = _number_or_none(counterfactual.get("gross_removable_delay_du"))
    if direct_break_even is None and gross is None:
        reasons.append("local break-even delay is missing")
    if proxy_cell is None or proxy_cell <= 0.0:
        reasons.append("proxy Cell delay must be positive")
    if direct_break_even is None and any(
        value is None or value < 0.0 for value in penalties
    ):
        reasons.append("counterfactual penalties must be finite and nonnegative")
    if reasons:
        return {
            "status": "invalid",
            "unit": "delay_unit",
            "break_even_delay": None,
            "proxy_cell_delay": proxy_cell,
            "margin": None,
            "reasons": reasons,
        }
    break_even = (
        direct_break_even if direct_break_even is not None
        else gross - sum(penalties)
    )
    margin = break_even - proxy_cell
    if margin <= 0.0:
        reasons.append("proxy Cell delay does not beat the local break-even bound")
    return {
        "status": "pass" if not reasons else "fail",
        "unit": "delay_unit",
        "break_even_delay": break_even,
        "proxy_cell_delay": proxy_cell,
        "margin": margin,
        "reasons": reasons,
    }


def _structural_projection(influence):
    if not isinstance(influence, dict):
        influence = {}
    supplied = influence.get("structural_metrics")
    if isinstance(supplied, dict):
        projection = copy.deepcopy(supplied)
    else:
        projection = {}
    before = _number_or_none(influence.get("logic_depth_before"))
    after = _number_or_none(influence.get("logic_depth_after"))
    projection.update({
        "levels_removed": projection.get("levels_removed", (
            max(0.0, before - after) if before is not None and after is not None
            else _number_or_none(influence.get("removable_depth"))
        )),
        "nodes_removed": projection.get(
            "nodes_removed", _number_or_none(influence.get("removable_node_count"))
        ),
        "edges_removed": projection.get(
            "edges_removed", _number_or_none(influence.get("removable_edge_count"))
        ),
        "cut_width": projection.get("cut_width", (
            (_number_or_none(influence.get("cut_boundary_input_count")) or 0.0)
            + (_number_or_none(influence.get("cut_boundary_output_count")) or 0.0)
        )),
        "reconvergence_coverage": projection.get(
            "reconvergence_coverage", _number_or_none(
            influence.get("reconvergence_node_count")
        )),
        "dominator_endpoint_coverage": _number_or_none(
            influence.get("dominator_endpoint_coverage")
        ),
        "fanout": _number_or_none(influence.get("fanout_count")),
        "buffer_inverter_pressure": copy.deepcopy(
            influence.get("buffer_inverter_pressure")
        ),
        "overlap_ratio": _number_or_none(influence.get("overlap_ratio")),
        "path_family_count": _number_or_none(influence.get("path_family_count")),
        "negative_slack_mass_coverage_ns": _number_or_none(
            influence.get("negative_slack_mass_coverage_ns")
        ),
    })
    return projection


def _mapped_netlist_hash(arm):
    artifacts = arm.get("artifacts") if isinstance(arm, dict) else None
    if not isinstance(artifacts, list):
        raise ValueError("mapping arm artifacts must be an array")
    rows = [
        row for row in artifacts
        if isinstance(row, dict) and row.get("role") == "mapped_netlist"
    ]
    if len(rows) != 1 or not re.fullmatch(r"[0-9a-f]{64}", str(rows[0].get("sha256"))):
        raise ValueError("mapping arm must carry one hashed mapped_netlist artifact")
    return rows[0]["sha256"]


def _verified_digest(value, name):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ValueError("%s must be a lowercase SHA-256 digest" % name)
    return value


def mapper_evidence_from_mapping_result(request, result_path, expected_sha256):
    """Verify one actual paired mapping result and project candidate adoption.

    Adoption is derived only from the hash-bound result's two Cell censuses.
    The reference arm must not contain any Cell generated for this candidate.
    Missing augmented counts remain verified non-adoption evidence rather than
    being converted into a caller assertion.
    """
    if not isinstance(expected_sha256, str) or not re.fullmatch(
        r"[0-9a-f]{64}", expected_sha256
    ):
        raise ValueError("expected mapping result SHA-256 must be lowercase hex")
    path = Path(result_path).expanduser().resolve()
    if not path.is_file():
        raise ValueError("mapping result does not name a regular file")
    payload = path.read_bytes()
    actual_sha256 = hashlib.sha256(payload).hexdigest()
    if actual_sha256 != expected_sha256:
        raise ValueError("mapping result SHA-256 mismatch")
    try:
        result = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("mapping result is not valid JSON") from exc
    if result.get("schema") != "lfr-proxy-mapping-result/1":
        raise ValueError("unsupported mapping result schema")
    if result.get("status") != "succeeded":
        raise ValueError("mapping result did not succeed")
    arms = result.get("arms")
    if not isinstance(arms, dict):
        raise ValueError("mapping result arms must be an object")
    normalized = {}
    for name in ("reference", "augmented"):
        arm = arms.get(name)
        if (
            not isinstance(arm, dict)
            or arm.get("status") != "succeeded"
            or arm.get("return_code") != 0
        ):
            raise ValueError("mapping %s arm did not succeed" % name)
        adoption = arm.get("adoption")
        census = adoption.get("cell_census") if isinstance(adoption, dict) else None
        if not isinstance(census, dict):
            raise ValueError("mapping %s arm has no Cell census" % name)
        checked = {}
        for cell, count in census.items():
            if (
                not isinstance(cell, str)
                or isinstance(count, bool)
                or not isinstance(count, int)
                or count < 0
            ):
                raise ValueError("mapping %s Cell census is invalid" % name)
            checked[cell] = count
        normalized[name] = {
            "census": checked,
            "plan_sha256": _verified_digest(
                arm.get("plan_sha256"), "mapping %s plan_sha256" % name
            ),
            "mapped_netlist_sha256": _mapped_netlist_hash(arm),
        }

    candidate_id = request.get("candidate_id") if isinstance(request, dict) else None
    interface = (
        (request.get("generator_contract") or {}).get("interface")
        if isinstance(request, dict) else None
    )
    outputs = interface.get("outputs") if isinstance(interface, dict) else None
    if not isinstance(candidate_id, str) or not isinstance(outputs, list) or not outputs:
        raise ValueError("generation request cannot derive candidate Cell identity")
    output_names = []
    for output in outputs:
        name = output.get("name") if isinstance(output, dict) else None
        if not isinstance(name, str) or not name:
            raise ValueError("generation request output name is invalid")
        output_names.append(name)
    candidate_cells = [
        canonical_cell_name(candidate_id, output) for output in output_names
    ]
    leaked = {
        cell: normalized["reference"]["census"].get(cell, 0)
        for cell in candidate_cells
        if normalized["reference"]["census"].get(cell, 0) > 0
    }
    if leaked:
        raise ValueError(
            "candidate Cells leaked into reference census: %s"
            % ", ".join(sorted(leaked))
        )
    augmented_counts = {
        cell: normalized["augmented"]["census"].get(cell, 0)
        for cell in candidate_cells
    }
    instance_count = sum(augmented_counts.values())
    tool_identity = result.get("tool_identity") or {}
    request_sha256 = _verified_digest(
        result.get("request_sha256"), "mapping request_sha256"
    )
    yosys_sha256 = _verified_digest(
        (tool_identity.get("yosys") or {}).get("sha256"), "Yosys sha256"
    )
    abc_sha256 = _verified_digest(
        (tool_identity.get("abc") or {}).get("sha256"), "ABC sha256"
    )
    return {
        "schema": "hima.library-richness.verified-mapper-adoption/1",
        "verified": True,
        "candidate_id": candidate_id,
        "candidate_cells": candidate_cells,
        "candidate_cell_counts": augmented_counts,
        "status": "adopted" if instance_count > 0 else "not_adopted",
        "adopted": instance_count > 0,
        "candidate_instances": instance_count,
        "source_hashes": {
            "mapping_result_sha256": actual_sha256,
            "mapping_request_sha256": request_sha256,
            "reference_plan_sha256": normalized["reference"]["plan_sha256"],
            "augmented_plan_sha256": normalized["augmented"]["plan_sha256"],
            "reference_mapped_netlist_sha256":
                normalized["reference"]["mapped_netlist_sha256"],
            "augmented_mapped_netlist_sha256":
                normalized["augmented"]["mapped_netlist_sha256"],
            "yosys_sha256": yosys_sha256,
            "abc_sha256": abc_sha256,
        },
        "result_path": str(path),
    }


def _mapper_evidence(stage, evidence, candidate_id):
    if stage == "pre_mapping":
        if evidence is not None:
            raise ValueError("pre_mapping candidates cannot carry mapper evidence")
        return {"status": "not_evaluated", "adopted": None, "candidate_instances": None}
    if not isinstance(evidence, dict):
        return {"status": "missing", "adopted": None, "candidate_instances": None}
    if (
        evidence.get("schema")
        != "hima.library-richness.verified-mapper-adoption/1"
        or evidence.get("verified") is not True
        or evidence.get("candidate_id") != candidate_id
    ):
        raise ValueError("post_mapping requires verified hash-bound mapper evidence")
    return copy.deepcopy(evidence)


def portfolio_candidate_from_generation_request(
    request, *, stage, verified_mapper_evidence=None, library_cost=None
):
    """Adapt one production generation request into the only portfolio DTO.

    ``pre_mapping`` means function/generator/structure planning only.  A
    ``post_mapping`` DTO requires a separate mapper observation; G4 generation
    readiness never counts as adoption.  Design-level family baselines and the
    paired reference/augmented proxy delta intentionally do not enter this DTO.
    """
    if stage not in {"pre_mapping", "post_mapping"}:
        raise ValueError("portfolio stage must be pre_mapping or post_mapping")
    if not isinstance(request, dict):
        raise ValueError("generation request must be an object")
    candidate_id = request.get("candidate_id")
    if not isinstance(candidate_id, str) or not candidate_id:
        raise ValueError("generation request candidate_id must be non-empty")
    identity = project_candidate_identity(request)
    gates = request.get("gate_evidence") or {}
    function_gate = gates.get("G2_function") or {}
    implementation = request.get("implementation_plan") or {}
    generation_route = implementation.get("route")
    generation_ready = (
        function_gate.get("status") == "PASS"
        and generation_route in BUILDABLE_ROUTES
    )
    evidence = request.get("discovery_evidence") or {}
    influence = evidence.get("influence_vector")
    if not isinstance(influence, dict) or not influence:
        influence = _structural_influence_from_discovery(request, evidence)
    # Exact function generation and original-cone substitution are different
    # questions.  Side outputs can make the mined occurrence unsuitable for a
    # literal local replacement while the new Boolean function remains fully
    # buildable and useful to the whole-design mapper.  Preserve the negative
    # F1 factor in raw_metrics; let F2 adoption decide actual Library use.
    counterfactual = evidence.get("counterfactual")
    if counterfactual is None:
        counterfactual = request.get("counterfactual")
    if library_cost is None:
        library_cost = {"new_library_cells": 1, "generation_units": 1}
    if not isinstance(library_cost, dict):
        raise ValueError("library_cost must be an object")
    return {
        "schema": PORTFOLIO_CANDIDATE_SCHEMA,
        "candidate_id": candidate_id,
        "stage": stage,
        "identity": identity,
        "functional_equivalence": {
            "status": "exact" if function_gate.get("status") == "PASS" else "unverified",
            "evidence": function_gate.get("evidence"),
        },
        "generation_feasibility": {
            "status": "ready" if generation_ready else "not_ready",
            "route": generation_route,
            "reasons": list(implementation.get("reasons") or []),
        },
        "mapper_evidence": _mapper_evidence(
            stage, verified_mapper_evidence, candidate_id
        ),
        "local_break_even": _counterfactual_bound(counterfactual),
        "covered_instance_keys": _request_occurrence_keys(request),
        "path_family_ids": list(influence.get("path_family_ids") or []),
        "structural_metrics": _structural_projection(influence),
        "library_cost": copy.deepcopy(library_cost),
        "raw_metrics": {
            "influence_vector": copy.deepcopy(influence),
            "counterfactual": copy.deepcopy(counterfactual),
            "occurrences": copy.deepcopy(evidence.get("occurrences") or []),
        },
        "source_generation_request": copy.deepcopy(request),
    }


def _optional_metric(group, keys, *, invert=False, allow_bool=False):
    if isinstance(keys, str):
        keys = (keys,)
    value = None
    if isinstance(group, dict):
        for key in keys:
            if key in group:
                value = group[key]
                break
    if allow_bool and isinstance(value, bool):
        value = 1.0 if value else 0.0
    if not _finite_number(value):
        return None
    value = float(value)
    return -value if invert else value


def _multi_index_projection(candidate):
    structural = candidate.get("structural_metrics") or {}
    mapping = candidate.get("mapper_evidence") or {}
    cost = candidate.get("library_cost") or {}
    definitions = (
        ("structural.levels_removed", structural, "levels_removed", False, False),
        ("structural.nodes_removed", structural, "nodes_removed", False, False),
        ("structural.edges_removed", structural, "edges_removed", False, False),
        ("structural.cut_width", structural, "cut_width", True, False),
        (
            "structural.reconvergence_coverage", structural,
            "reconvergence_coverage", False, False,
        ),
        (
            "structural.dominator_endpoint_coverage", structural,
            "dominator_endpoint_coverage", False, False,
        ),
        ("structural.fanout", structural, "fanout", False, False),
        ("structural.overlap_ratio", structural, "overlap_ratio", True, False),
        ("mapping.adopted", mapping, "adopted", False, True),
        (
            "mapping.candidate_instances", mapping,
            "candidate_instances", False, False,
        ),
        ("mapping.area_reduction", mapping, "area_reduction", False, False),
        (
            "mapping.buffer_inverter_pressure_reduction", mapping,
            "buffer_inverter_pressure_reduction", False, False,
        ),
        ("mapping.fanout_relief", mapping, "fanout_relief", False, False),
        ("cost.new_library_cells", cost, "new_library_cells", True, False),
        ("cost.generation_units", cost, "generation_units", True, False),
    )
    axes = {}
    missing = []
    for name, group, key, invert, allow_bool in definitions:
        value = _optional_metric(group, key, invert=invert, allow_bool=allow_bool)
        if value is None:
            missing.append(name)
        else:
            axes[name] = value
    return {"axes": axes, "missing_axes": missing}


def _validate_design_proxy_evidence(evidence):
    if not isinstance(evidence, dict):
        raise ValueError("design_proxy_evidence must be an object")
    evidence_id = evidence.get("evidence_id")
    if not isinstance(evidence_id, str) or not evidence_id:
        raise ValueError("design_proxy_evidence.evidence_id must be non-empty")
    baseline = evidence.get("baseline_slack_by_endpoint_family_ps")
    delta = evidence.get("paired_delta_by_endpoint_family_ps")
    if not isinstance(baseline, dict) or not baseline:
        raise ValueError("design proxy family baseline must be a non-empty object")
    if not isinstance(delta, dict):
        raise ValueError("paired family delta must be an object")
    if set(baseline) != set(delta):
        raise ValueError("paired family delta keys must exactly match the design baseline")
    normalized_baseline = {}
    normalized_delta = {}
    for family in sorted(baseline):
        if not isinstance(family, str) or not family:
            raise ValueError("endpoint family names must be non-empty strings")
        if not _finite_number(baseline[family]) or not _finite_number(delta[family]):
            raise ValueError("family baseline and paired delta must be finite")
        normalized_baseline[family] = float(baseline[family])
        normalized_delta[family] = float(delta[family])
    return {
        "evidence_id": evidence_id,
        "baseline_slack_by_endpoint_family_ps": normalized_baseline,
        "paired_delta_by_endpoint_family_ps": normalized_delta,
        "raw": copy.deepcopy(evidence),
    }


def _proxy_objective(proxy, apply_delta):
    baseline = proxy["baseline_slack_by_endpoint_family_ps"]
    delta = proxy["paired_delta_by_endpoint_family_ps"] if apply_delta else {}
    projected = {
        family: slack + delta.get(family, 0.0)
        for family, slack in baseline.items()
    }
    return {
        "proxy_worst_frontier_indicator_ps": min(projected.values()),
        "proxy_negative_slack_mass_indicator_ps": sum(
            max(0.0, -slack) for slack in projected.values()
        ),
        "proxy_slack_by_endpoint_family_ps": dict(sorted(projected.items())),
    }


def _normalize_portfolio_candidate(candidate, stage):
    if not isinstance(candidate, dict) or candidate.get("schema") != PORTFOLIO_CANDIDATE_SCHEMA:
        raise ValueError("portfolio candidates must use the canonical portfolio-candidate DTO")
    if candidate.get("stage") != stage:
        raise ValueError("portfolio candidate stage differs from selector stage")
    reasons = []
    if candidate.get("functional_equivalence", {}).get("status") != "exact":
        reasons.append("functional_equivalence_unverified")
    if candidate.get("generation_feasibility", {}).get("status") != "ready":
        reasons.append("generator_not_ready")
    # F1 structure and F3 timing are parallel free factors.  A missing or
    # negative local timing counterfactual remains visible in the DTO, but it
    # cannot veto an exact, buildable function before the one paired F2/F3
    # Library evaluation observes the complete portfolio.
    covered = candidate.get("covered_instance_keys")
    if not isinstance(covered, list) or not covered:
        reasons.append("covered_instance_keys_missing")
    if stage == "post_mapping":
        mapper = candidate.get("mapper_evidence") or {}
        if mapper.get("status") != "adopted" or not mapper.get("candidate_instances"):
            reasons.append("mapper_non_adoption")
    return {
        "candidate_id": candidate["candidate_id"],
        "candidate": copy.deepcopy(candidate),
        "multi_index": _multi_index_projection(candidate),
        "covered_instance_keys": tuple(sorted(set(covered or []))),
        "rejection_reasons": reasons,
    }


def _pareto_dominates(left, right):
    if not set(left).issuperset(right):
        return False
    strictly_better = False
    for axis, right_value in right.items():
        left_value = left[axis]
        if left_value < right_value - 1e-9:
            return False
        strictly_better |= left_value > right_value + 1e-9
    return strictly_better


def _pareto_front(proposals):
    return [
        proposal
        for index, proposal in enumerate(proposals)
        if not any(
            _pareto_dominates(other[2], proposal[2])
            for other_index, other in enumerate(proposals)
            if other_index != index
        )
    ]


_TIE_BREAK_AXES = (
    "structural.levels_removed",
    "structural.nodes_removed",
    "structural.edges_removed",
    "structural.reconvergence_coverage",
    "structural.dominator_endpoint_coverage",
    "structural.cut_width",
    "mapping.adopted",
    "mapping.candidate_instances",
    "mapping.area_reduction",
    "mapping.buffer_inverter_pressure_reduction",
    "mapping.fanout_relief",
    "cost.new_library_cells",
    "cost.generation_units",
)


def select_candidate_portfolio(
    candidates, max_candidates, *, stage, design_proxy_evidence
):
    """Select a gated Pareto portfolio from canonical production DTOs.

    Family baselines and the paired augmented-mapping delta have one independent
    design-level authority.  The delta is applied once to the resulting
    portfolio, never once per candidate or occurrence.  Pre-mapping planning
    cannot claim whole-design mapping evidence; post-mapping selection requires
    explicit candidate adoption from the mapper.
    """
    if stage not in {"pre_mapping", "post_mapping"}:
        raise ValueError("portfolio stage must be pre_mapping or post_mapping")
    if not isinstance(candidates, list):
        raise ValueError("portfolio candidates must be an array")
    if (
        isinstance(max_candidates, bool)
        or not isinstance(max_candidates, int)
        or max_candidates < 1
    ):
        raise ValueError("max_candidates must be a positive integer")
    proxy = _validate_design_proxy_evidence(design_proxy_evidence)
    evaluations = [
        _normalize_portfolio_candidate(candidate, stage)
        for candidate in sorted(candidates, key=lambda row: str(row.get("candidate_id")))
    ]
    candidate_ids = [row["candidate_id"] for row in evaluations]
    duplicate_ids = sorted({value for value in candidate_ids if candidate_ids.count(value) > 1})
    if duplicate_ids:
        raise ValueError("duplicate candidate_id values: %s" % ", ".join(duplicate_ids))

    baseline_objective = _proxy_objective(proxy, apply_delta=False)
    paired_objective = _proxy_objective(proxy, apply_delta=True)
    selected = []
    trace = []
    while len(selected) < max_candidates:
        proposals = []
        selected_ids = {row["candidate_id"] for row in selected}
        for evaluation in evaluations:
            if evaluation["candidate_id"] in selected_ids or evaluation["rejection_reasons"]:
                continue
            axes = dict(evaluation["multi_index"]["axes"])
            axes["proxy.worst_frontier_indicator"] = paired_objective[
                "proxy_worst_frontier_indicator_ps"
            ]
            axes["proxy.negative_slack_mass_reduction"] = (
                baseline_objective["proxy_negative_slack_mass_indicator_ps"]
                - paired_objective["proxy_negative_slack_mass_indicator_ps"]
            )
            proposals.append((evaluation, evaluation["covered_instance_keys"], axes))
        if not proposals:
            break
        front = _pareto_front(proposals)
        front.sort(key=lambda proposal: (
            *tuple(-proposal[2].get(axis, float("-inf")) for axis in _TIE_BREAK_AXES),
            proposal[0]["candidate_id"],
        ))
        evaluation, covered, axes = front[0]
        selected.append({
            "candidate_id": evaluation["candidate_id"],
            "identity": evaluation["candidate"]["identity"],
            "covered_instance_keys": list(covered),
            "pareto_axes": axes,
        })
        trace.append({
            "rank": len(selected),
            "candidate_id": evaluation["candidate_id"],
            "pareto_front_candidate_ids": sorted(
                proposal[0]["candidate_id"] for proposal in front
            ),
            "pareto_axes": axes,
        })

    selected_ids = {row["candidate_id"] for row in selected}
    for evaluation in evaluations:
        if evaluation["candidate_id"] in selected_ids or evaluation["rejection_reasons"]:
            continue
        if len(selected) >= max_candidates:
            evaluation["rejection_reasons"].append("portfolio_budget_reached")
        else:
            evaluation["rejection_reasons"].append("not_selected_from_pareto_front")

    overlap_advisories = []
    for left_index, left in enumerate(evaluations):
        for right in evaluations[left_index + 1:]:
            overlap = sorted(
                set(left["covered_instance_keys"])
                & set(right["covered_instance_keys"])
            )
            if overlap:
                overlap_advisories.append({
                    "candidate_ids": [left["candidate_id"], right["candidate_id"]],
                    "discovery_overlap_instance_keys": overlap,
                    "effect": (
                        "advisory_only_pre_mapping_include_both_in_one_augmented_mapping"
                        if stage == "pre_mapping" else
                        "discovery_overlap_does_not_override_actual_mapper_adoption"
                    ),
                })

    mapping_observed = stage == "post_mapping" and bool(selected)
    return {
        "schema": PORTFOLIO_SCHEMA,
        "status": (
            "PRE_MAPPING_PLANNING" if stage == "pre_mapping"
            else "POST_MAPPING_SELECTION"
        ),
        "stage": stage,
        "claims": {
            "commercial_qor_prediction": False,
            "commercial_adoption": False,
            "post_route_benefit": False,
            "fmax_improvement": False,
        },
        "evidence_layers": {
            "F0_function_equivalence": bool(selected),
            "F1_local_structure": bool(selected),
            "F2_whole_design_mapping": mapping_observed,
            "F3_proxy_sta_indicator": True,
        },
        "selection_method": (
            "functional and generation gates; post-mapping adoption gate; "
            "deterministic Pareto selection over separate structure, mapper and "
            "Library-cost axes; one design-level paired proxy delta; discovery "
            "cone overlap is advisory and never drops a distinct function"
        ),
        "max_candidates": max_candidates,
        "design_proxy_evidence": proxy,
        "baseline": baseline_objective,
        "paired_augmented_indicator": paired_objective,
        "family_delta_application": (
            "once_for_the_paired_augmented_mapping_not_per_candidate_or_occurrence"
        ),
        "selected": selected,
        "objective_trace": trace,
        "overlap_advisories": overlap_advisories,
        "candidate_evaluations": evaluations,
    }


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
        "function": compact_liberty_function(representative.output_asts[0], input_order),
        "functions": {
            pin: compact_liberty_function(ast, input_order)
            for pin, ast in zip(output_order, representative.output_asts)
        },
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

    if len(representative.output_nets) > 1:
        return {
            "route": "multi_output_resynthesis",
            "cluster_spec": cluster_spec,
            "eco_only": True,
            "output_count": len(representative.output_nets),
        }

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
    affected_endpoints = set()
    frontier_site_count = 0
    endpoint_by_instance = getattr(args, "timing_frontier_by_instance", {})
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
        site_endpoints = set()
        for instance in site.instances:
            site_endpoints.update(endpoint_by_instance.get("%s/%s" % (site.module, instance), ()))
        if site_endpoints:
            frontier_site_count += 1
            affected_endpoints.update(site_endpoints)

    implementation_plan = derive_implementation_plan(
        candidate_id, representative, cells, input_order, output_order)
    physical_variant_id = None
    if args.objective == "endpoint_frontier_coverage":
        physical_variant_id = "sha256:" + hashlib.sha256(json.dumps(
            implementation_plan, sort_keys=True, separators=(",", ":")
        ).encode()).hexdigest()

    output_count = len(output_order)
    algorithm = (
        "REPEATED_CLUSTER" if output_count == 1
        else "MULTI_OUTPUT_SHARED_LOGIC"
    )
    shared_audit = (
        shared_logic_evidence(representative, cells)
        if output_count > 1 else None
    )
    request = {
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
            "library_function_match": (
                "PRESENT_PHYSICAL_VARIANT_TARGET"
                if representative.library_matches
                else "ABSENT_UNDER_NPN_OR_NPNP_EQUIVALENCE"
            ),
            "raw_support": len(sites),
            "non_overlapping_support": len(nonoverlap),
            "non_overlapping_support_method": "deterministic_greedy_lower_bound",
            "occurrences_by_module": dict(sorted(occurrences_by_module.items())),
            "occurrence_alignments": occurrence_alignments,
            "endpoint_frontier_influence": {
                "affected_endpoints": sorted(affected_endpoints),
                "affected_endpoint_count": len(affected_endpoints),
                "affected_occurrence_count": frontier_site_count,
                "source": "exact-endpoint-membership-from-bound-timing-frontier"
                          if endpoint_by_instance else "not-supplied",
            },
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
                "evidence": (
                    "function exists but the endpoint-bound fused physical variant is absent"
                    if representative.library_matches
                    else "ABSENT_UNDER_NPN_OR_NPNP_EQUIVALENCE against the parsed library index"
                ),
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
    if physical_variant_id is not None:
        request["generator_contract"]["implementation_request"][
            "physical_variant_id"
        ] = physical_variant_id
    request["candidate_identity"] = project_candidate_identity(request)
    return request


def run(args):
    netlist_text = Path(args.netlist).read_text(encoding="utf-8", errors="replace")
    modules = parse_modules(netlist_text)
    cells = parse_skeleton(args.liberty_skeleton)
    library = library_indexes(cells, args.max_inputs, args.max_outputs)
    args.timing_frontier_by_instance = {}
    if args.timing_frontier is not None:
        timing_document = json.loads(Path(args.timing_frontier).read_text())
        frontier = timing_document
        if timing_document.get("schema") != "hima.lfr-endpoint-frontier/1":
            frontier = (((timing_document.get("algorithm_records") or {})
                         .get("observed_timing_graph") or {}).get("endpoint_frontier") or {})
        if frontier.get("schema") != "hima.lfr-endpoint-frontier/1":
            raise ValueError("--timing-frontier has no endpoint-frontier/1 document")
        for endpoint in frontier.get("endpoints", []):
            if not endpoint.get("frontier"):
                continue
            for instance in endpoint.get("instances", []):
                args.timing_frontier_by_instance.setdefault(str(instance), set()).add(
                    str(endpoint["endpoint"])
                )

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

    def touches_frontier(sites):
        return any(
            "%s/%s" % (site.module, instance) in args.timing_frontier_by_instance
            for site in sites for instance in site.instances
        )

    new_groups = [
        (key, sites, greedy_nonoverlap(sites))
        for key, sites in groups.items()
        if len(sites) >= args.min_support and (
            not sites[0].library_matches
            or (args.objective == "endpoint_frontier_coverage" and touches_frontier(sites))
        )
    ]

    def group_rank(item):
        _, sites, nonoverlap = item
        representative = sites[0]
        if args.objective == "endpoint_frontier_coverage":
            endpoints, hit_sites = set(), 0
            for site in sites:
                local = set()
                for instance in site.instances:
                    local.update(args.timing_frontier_by_instance.get(
                        "%s/%s" % (site.module, instance), ()))
                if local:
                    hit_sites += 1
                    endpoints.update(local)
            return (
                -len(endpoints), -hit_sites,
                -len(nonoverlap) * max(1, len(representative.instances) - 1),
                -sum(site.internal_nets for site in nonoverlap), key_string(item[0]),
            )
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
            "liberty_function_skeleton": [os.path.abspath(str(path)) for path in args.liberty_skeleton],
            "timing_frontier": (os.path.abspath(str(args.timing_frontier))
                                if args.timing_frontier is not None else None),
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
    parser.add_argument("--liberty-skeleton", type=Path, action="append", required=True)
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
            "endpoint_frontier_coverage",
        ),
    )
    parser.add_argument("--min-cells", type=int, default=2)
    parser.add_argument("--max-cells", type=int, default=3)
    parser.add_argument("--max-inputs", type=int, default=4)
    parser.add_argument("--max-outputs", type=int, default=4)
    parser.add_argument("--min-support", type=int, default=2)
    parser.add_argument("--timing-frontier", type=Path,
                        help="endpoint-frontier/1 document or timing-route report")
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
    if not 1 <= args.top <= 100:
        parser.error("--top must be within 1..100")
    if args.objective == "endpoint_frontier_coverage" and args.timing_frontier is None:
        parser.error("--timing-frontier is required for endpoint_frontier_coverage")
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
