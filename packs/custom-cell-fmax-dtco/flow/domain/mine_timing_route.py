#!/usr/bin/env python3
"""Timing-driven Cell opportunity route: Algorithm 1 -> 2 -> 4.

Algorithm 1 builds a mapped directed hypergraph view, annotates cell vertices
with a normalised delay proxy from the full site Liberty, computes relative
arrival/required/slack, and ranks critical vertices by delay perturbation,
path participation and dominator endpoint coverage.

Algorithm 2 losslessly unmaps each eligible mapped function into a structurally
hashed AIG and enumerates K-feasible cuts only around Algorithm-1 roots.  Each
new single-output function becomes a Standard Cell Generation Request v2.

Algorithm 4 audits roots that share the same cut leaves and an actual internal
AIG node.  Multi-output discoveries remain visible Pattern Records; the current
single-output transistor generator does not claim to build them as one Cell.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import mine_patterns as mapped_core  # noqa: E402
from cell_need_miner.aig import AIG, CONST0, CONST1, lit_node  # noqa: E402
from cell_need_miner.cuts import enumerate_cuts, literal_truth_table  # noqa: E402
from cell_need_miner.generator_contract import (  # noqa: E402
    equivalence_digest,
    liberty_sop,
    readable_truth_table,
    support_indices,
    timing_sense,
    validate_generation_request,
)
from cell_need_miner.liberty import build_ast, parse_skeleton  # noqa: E402
from cell_need_miner.liberty_timing import parse_relative_delay_model  # noqa: E402
from cell_need_miner.npn import npn_canonical, reduce_support  # noqa: E402
from verilog_netlist import parse_modules  # noqa: E402


REPORT_SCHEMA = "xspace_cell-pattern-search/v2"
ALGORITHMS = (
    "critical_subgraph",
    "critical_k_input_cone",
    "multi_output_shared_logic",
)


def _pareto_order(items, metrics):
    """Return deterministic non-dominated layers for mixed search objectives."""
    remaining = list(items)
    ordered = []
    while remaining:
        front = []
        for item in remaining:
            value = metrics(item)
            dominated = False
            for other in remaining:
                if other is item:
                    continue
                candidate = metrics(other)
                if all(a <= b for a, b in zip(candidate, value)) and any(
                        a < b for a, b in zip(candidate, value)):
                    dominated = True
                    break
            if not dominated:
                front.append(item)
        front.sort(key=lambda item: metrics(item) + (repr(item[0]),))
        ordered.extend(front)
        front_ids = {id(item) for item in front}
        remaining = [item for item in remaining if id(item) not in front_ids]
    return ordered


def _sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return "sha256:" + digest.hexdigest()


def _mapped_graph(instances, cells):
    eligible = mapped_core.combinational_instances(instances, cells)
    drivers, loads = mapped_core.connectivity(instances, cells)
    predecessors = {name: set() for name in eligible}
    successors = {name: set() for name in eligible}
    edge_nets = set()
    for net, net_loads in loads.items():
        internal_drivers = [name for name, _pin in drivers.get(net, ()) if name in eligible]
        if len(internal_drivers) > 1:
            raise ValueError("mapped net %s has multiple eligible drivers" % net)
        if not internal_drivers:
            continue
        driver = internal_drivers[0]
        for load, _pin in net_loads:
            if load in eligible and load != driver:
                predecessors[load].add(driver)
                successors[driver].add(load)
                edge_nets.add(net)
    indegree = {name: len(values) for name, values in predecessors.items()}
    ready = sorted(name for name, count in indegree.items() if count == 0)
    order = []
    while ready:
        name = ready.pop(0)
        order.append(name)
        for successor in sorted(successors[name]):
            indegree[successor] -= 1
            if indegree[successor] == 0:
                ready.append(successor)
                ready.sort()
    if len(order) != len(eligible):
        raise ValueError("mapped combinational graph contains a cycle")
    return eligible, drivers, loads, predecessors, successors, order, edge_nets


def _arrivals(order, predecessors, weights, reduced=None):
    reduced = reduced or {}
    arrival = {}
    predecessor_choice = {}
    for name in order:
        best_predecessor = None
        best_value = 0.0
        if predecessors[name]:
            best_predecessor = max(
                predecessors[name], key=lambda item: (arrival[item], item)
            )
            best_value = arrival[best_predecessor]
        arrival[name] = best_value + max(0.0, weights[name] - reduced.get(name, 0.0))
        predecessor_choice[name] = best_predecessor
    return arrival, predecessor_choice


def _required(order, successors, weights, baseline):
    required = {}
    for name in reversed(order):
        if not successors[name]:
            required[name] = baseline
        else:
            required[name] = min(
                required[successor] - weights[successor]
                for successor in successors[name]
            )
    return required


def _dominators(order, predecessors):
    dominators = {}
    for name in order:
        if not predecessors[name]:
            dominators[name] = {name}
            continue
        common = None
        for predecessor in predecessors[name]:
            common = set(dominators[predecessor]) if common is None else common & dominators[predecessor]
        dominators[name] = (common or set()) | {name}
    return dominators


def rank_critical_subgraph(module, instances, cells, delay_units, top_paths=16, top_seeds=24,
                           observed_reg2reg=None):
    (eligible, _drivers, _loads, predecessors, successors,
     order, edge_nets) = _mapped_graph(instances, cells)
    if not eligible:
        return None
    weights = {
        name: float(delay_units.get(instance.base_type, 1.0))
        for name, instance in eligible.items()
    }
    arrival, predecessor_choice = _arrivals(order, predecessors, weights)
    endpoints = sorted(
        (name for name in order if not successors[name]),
        key=lambda name: (-arrival[name], name),
    )[:top_paths]
    if not endpoints:
        return None
    baseline = max(arrival[name] for name in endpoints)
    slack_window = max(0.05 * baseline, 0.10)
    endpoints = [
        name for name in endpoints if baseline - arrival[name] <= slack_window
    ] or endpoints[:1]
    required = _required(order, successors, weights, baseline)
    dominators = _dominators(order, predecessors)

    paths = []
    for endpoint in endpoints:
        path = []
        cursor = endpoint
        while cursor is not None:
            path.append(cursor)
            cursor = predecessor_choice[cursor]
        path.reverse()
        paths.append({
            "endpoint": endpoint,
            "delay_du": round(arrival[endpoint], 6),
            "slack_du": round(baseline - arrival[endpoint], 6),
            "instances": path,
        })
    # Expand the one representative predecessor trace into all near-critical
    # predecessors.  Otherwise two equal parallel branches collapse to the
    # lexical tie winner and delay perturbation can never observe masking.
    expanded = set(endpoints)
    frontier = list(endpoints)
    while frontier:
        name = frontier.pop()
        best = max((arrival[item] for item in predecessors[name]), default=0.0)
        for predecessor in predecessors[name]:
            if best - arrival[predecessor] <= slack_window and predecessor not in expanded:
                expanded.add(predecessor)
                frontier.append(predecessor)
    subgraph_nodes = sorted(expanded)
    tau = max(slack_window, 1e-9)
    endpoint_weight = {
        path["endpoint"]: math.exp(-path["slack_du"] / tau) for path in paths
    }
    total_endpoint_weight = sum(endpoint_weight.values()) or 1.0
    trial_global = max(0.05, 0.10 * sorted(weights.values())[len(weights) // 2])
    ranking = []
    for name in subgraph_nodes:
        trial = min(trial_global, weights[name])
        perturbed, _choices = _arrivals(
            order, predecessors, weights, reduced={name: trial}
        )
        after = max(perturbed[endpoint] for endpoint in endpoints)
        impact = max(0.0, baseline - after)
        participation = sum(
            endpoint_weight[path["endpoint"]]
            for path in paths if name in path["instances"]
        )
        domination = sum(
            endpoint_weight[endpoint]
            for endpoint in endpoints if name in dominators[endpoint]
        )
        ranking.append({
            "element_type": "cell_vertex",
            "mapped_instance": name,
            "cell_type": eligible[name].base_type,
            "node_slack_du": round(max(0.0, required[name] - arrival[name]), 6),
            "local_delay_du": round(weights[name], 6),
            "trial_reduction_du": round(trial, 6),
            "subgraph_delay_after_trial_du": round(after, 6),
            "impact_du": round(impact, 6),
            "sensitivity": round(impact / trial if trial else 0.0, 6),
            "path_participation": round(participation, 6),
            "dominator_endpoint_coverage": round(domination / total_endpoint_weight, 6),
        })
    if observed_reg2reg is not None:
        aligned = []
        for row in ranking:
            seen = observed_reg2reg.get(row["mapped_instance"])
            if seen is None:
                continue
            row.update({
                "reg2reg_path_hits": seen["path_hits"],
                "reg2reg_increment_ns": seen["max_increment_ns"],
                "reg2reg_path_ranks": seen["path_ranks"],
            })
            aligned.append(row)
        ranking = aligned
    ranking.sort(key=lambda row: (
        -row.get("reg2reg_path_hits", 0),
        -row.get("reg2reg_increment_ns", 0.0),
        -row["impact_du"],
        -row["sensitivity"],
        row["node_slack_du"],
        -row["path_participation"],
        -row["dominator_endpoint_coverage"],
        -row["local_delay_du"],
        row["mapped_instance"],
    ))
    for index, row in enumerate(ranking, 1):
        row["rank"] = index
    if not ranking:
        return None
    startpoints = sorted({path["instances"][0] for path in paths})
    return {
        "algorithm": "CRITICAL_SUBGRAPH",
        "critical_subgraph_id": "CSG_%s" % re.sub(r"[^A-Za-z0-9]+", "_", module).upper(),
        "module": module,
        "source_graph": "mapped",
        "timing_mode": ("explicit_dc_reg2reg_path_membership_plus_relative_internal_sta"
                        if observed_reg2reg is not None else "relative_internal_sta_from_full_liberty"),
        "baseline_delay_du": round(baseline, 6),
        "slack_window_du": round(slack_window, 6),
        "subgraph_boundary": {
            "startpoints": startpoints,
            "endpoints": endpoints,
            "node_count": len(subgraph_nodes),
            "hyperedge_count": sum(
                1 for net in edge_nets
                if any(driver in subgraph_nodes for driver, _pin in _drivers.get(net, ()))
            ),
        },
        "representative_paths": paths,
        "critical_elements": ranking[:top_seeds],
        "limitations": [
            "DC reg2reg path membership and incremental delay are measured; relative NLDM delay remains a search proxy.",
            "The current Package has no lossless mapped-to-unmapped origin map across hierarchy; "
            "Algorithm 2 therefore rebuilds a local function-preserving AIG per mapped module.",
        ],
    }


def parse_reg2reg_path_membership(report, expected_top, modules):
    """Map the actual DC reg2reg path points back to local mapped instances.

    Hierarchical occurrences such as ``us31/U157/A1`` are associated with the
    module definition containing the same leaf instance and Cell type.  A path
    contributes at most one hit per local instance even when both input and
    output pins appear in the full-path report.
    """
    text = report.read_text(encoding="utf-8", errors="replace")
    designs = re.findall(r"(?m)^Design\s*:\s*(\S+)\s*$", text)
    groups = re.findall(r"(?m)^\s*Path Group:\s*(\S+)\s*$", text)
    if designs != [expected_top] or not groups or set(groups) != {"reg2reg"}:
        raise ValueError("timing report must identify one expected design and only reg2reg paths")
    instances_by_module = {
        module: {instance.name: instance for instance in instances}
        for module, instances in modules.items()
    }
    observed = defaultdict(lambda: defaultdict(lambda: {"path_ranks": set(), "max_increment_ns": 0.0}))
    path_rank = 0
    path_seen = defaultdict(dict)
    point = re.compile(r"^\s+(\S+)/\S+\s+\(([^)]+)\)(.*)$")
    for line in text.splitlines():
        if line.lstrip().startswith("Startpoint:"):
            path_rank += 1
            continue
        match = point.match(line)
        if match is None or path_rank == 0:
            continue
        instance_path, cell_type, columns = match.groups()
        parts = instance_path.split("/")
        module = expected_top
        for hierarchy_instance in parts[:-1]:
            parent = instances_by_module.get(module, {}).get(hierarchy_instance)
            if parent is None or parent.base_type not in modules:
                module = None
                break
            module = parent.base_type
        if module is None:
            continue
        leaf = parts[-1]
        local = instances_by_module.get(module, {}).get(leaf)
        if local is None or local.base_type != cell_type:
            continue
        values = [float(value) for value in re.findall(r"-?[0-9]+(?:\.[0-9]+)?", columns)]
        increment = max(0.0, values[-2] if len(values) >= 2 else 0.0)
        current = path_seen[path_rank].get((module, leaf), 0.0)
        path_seen[path_rank][(module, leaf)] = max(current, increment)
    for rank, instances in path_seen.items():
        for (module, leaf), increment in instances.items():
            item = observed[module][leaf]
            item["path_ranks"].add(rank)
            item["max_increment_ns"] = max(item["max_increment_ns"], increment)
    result = {}
    for module, instances in observed.items():
        result[module] = {}
        for name, item in instances.items():
            result[module][name] = {
                "path_hits": len(item["path_ranks"]),
                "path_ranks": sorted(item["path_ranks"]),
                "max_increment_ns": round(item["max_increment_ns"], 6),
            }
    if not result:
        raise ValueError("timing report has no combinational instance that maps to the netlist")
    return result


def _build_aig(module, instances, cells):
    eligible, drivers, loads, _pred, _succ, order, _edges = _mapped_graph(instances, cells)
    aig = AIG()
    net_literals = {
        "1'b0": CONST0, "1'h0": CONST0,
        "1'b1": CONST1, "1'h1": CONST1,
    }
    input_nets = set()
    for instance in eligible.values():
        cell = cells[instance.base_type]
        for pin in cell.inputs:
            net = instance.conns[pin]
            if not any(driver in eligible for driver, _pin in drivers.get(net, ())):
                input_nets.add(net)
    for net in sorted(input_nets):
        net_literals[net] = aig.add_pi(net)

    roots_by_instance = defaultdict(list)
    node_origins = defaultdict(set)
    for name in order:
        instance = eligible[name]
        cell = cells[instance.base_type]
        environment = {pin: net_literals[instance.conns[pin]] for pin in cell.inputs}
        before = set(aig.and_gates)
        for output_pin, ast in cell.outputs.items():
            literal = build_ast(ast, aig, environment)
            net_literals[instance.conns[output_pin]] = literal
            roots_by_instance[name].append((output_pin, literal))
            node_origins[lit_node(literal)].add(name)
        for node in set(aig.and_gates) - before:
            node_origins[node].add(name)
    for name, outputs in roots_by_instance.items():
        for output_pin, literal in outputs:
            aig.add_po("%s/%s" % (name, output_pin), literal)
    return aig, eligible, roots_by_instance, node_origins


def _ancestor_nodes(aig, root_literal, leaves):
    leaves = set(leaves)
    seen = set()
    stack = [lit_node(root_literal)]
    while stack:
        node = stack.pop()
        if node in seen or node in leaves or node == 0 or aig.is_pi(node):
            continue
        seen.add(node)
        left, right = aig.fanins(node)
        stack.extend((lit_node(left), lit_node(right)))
    return seen


def _timing_arcs(input_order, output_order, tables):
    arcs = []
    for output in output_order:
        table = tables[output]
        for index in support_indices(table, len(input_order)):
            arcs.append({
                "related_pin": input_order[index],
                "to_pin": output,
                "timing_sense": timing_sense(table, len(input_order), index),
            })
    return arcs


def _request(candidate_id, algorithm, tables_tuple, evidence, args, buildable):
    input_order = ["I%d" % index for index in range(evidence["input_count"])]
    output_order = [
        "Y" if len(tables_tuple) == 1 else "Y%d" % index
        for index in range(len(tables_tuple))
    ]
    tables = dict(zip(output_order, tables_tuple))
    functions = {output: liberty_sop(tables[output], input_order) for output in output_order}
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
                    {"name": output, "direction": "output", "liberty_function": functions[output]}
                    for output in output_order
                ],
                "pg_pins_from_library_profile": True,
            },
            "equivalence_reference": {
                "input_order": input_order,
                "output_order": output_order,
                "output_truth_tables_hex": {output: hex(tables[output]) for output in output_order},
                "digest": equivalence_digest(input_order, output_order, tables),
            },
            "truth_table": readable_truth_table(input_order, output_order, tables),
            "implementation_request": {
                "mode": "synthesize_transistor_topology",
                "drive_strengths": list(args.drive_strength),
                "vt_classes": list(args.vt_class),
            },
            "characterization_request": {
                "profile_ref": args.characterization_profile_ref,
                "model_types": list(args.model_type),
                "timing_arcs": _timing_arcs(input_order, output_order, tables),
            },
            "deliverables": ["SPICE", "GDS", "LEF", "LIBERTY", "VERILOG"],
        },
        "discovery_evidence": dict(evidence, discovery_algorithm=algorithm),
        "gate_evidence": {
            "G0_discovery": {"status": "PASS", "evidence": "current-run mapped design"},
            "G1_boundary": {"status": "PASS", "evidence": "K-feasible AIG cut and complete output vector"},
            "G2_function": {"status": "PASS", "evidence": "complete truth table from the function-preserving AIG"},
            "G3_library_gap": {"status": "PASS", "evidence": "absent under NPN/NPNP in bound Liberty function index"},
            "G4_circuit_feasibility": {
                "status": "READY" if buildable else "NOT_IMPLEMENTABLE",
                "evidence": "boolean_synthesis" if buildable else "multi_output_generator_not_loaded",
            },
        },
        "implementation_plan": (
            {"route": "boolean_synthesis", "output_count": 1}
            if buildable else
            {"route": "unsupported", "reasons": [
                "The current transistor generator emits one output per Cell and cannot yet preserve shared multi-output logic."
            ]}
        ),
        "advisories": [{
            "severity": "warning",
            "code": "PPA_NOT_PROVEN",
            "message": "Discovery and exact Boolean equivalence do not establish mapper selection or PPA benefit.",
        }],
    }
    errors = validate_generation_request(request)
    if errors:
        raise ValueError("%s contract invalid: %s" % (candidate_id, "; ".join(errors)))
    return request


def _route_requests(modules, cells, critical_records, library, args):
    single_groups = defaultdict(list)
    multi_groups = defaultdict(list)
    statistics = Counter()
    critical_by_module = {record["module"]: record for record in critical_records}
    for module, instances in modules.items():
        critical = critical_by_module.get(module)
        if not critical:
            continue
        aig, _eligible, roots_by_instance, node_origins = _build_aig(module, instances, cells)
        cuts = enumerate_cuts(aig, k=args.max_inputs, max_cuts=args.max_cuts_per_root)
        leafset_roots = defaultdict(list)
        seed_rows = critical["critical_elements"][:args.max_critical_roots]
        for seed in seed_rows:
            for output_pin, root_literal in roots_by_instance.get(seed["mapped_instance"], ()):
                root_node = lit_node(root_literal)
                for leaves in cuts.get(root_node, ()):
                    if len(leaves) < 2 or root_node in leaves:
                        continue
                    statistics["k_feasible_cuts"] += 1
                    table, ordered_leaves, count, _mask = literal_truth_table(aig, root_literal, leaves)
                    if sorted(support_indices(table, count)) != list(range(count)):
                        statistics["unused_boundary_rejected"] += 1
                        continue
                    key = mapped_core.functional_key((table,), count)
                    if library.get(key):
                        statistics["library_covered"] += 1
                        continue
                    replacement, _input_perm, _output_perm = mapped_core.replacement_canonical((table,), count)
                    occurrence = {
                        "module": module,
                        "root_instance": seed["mapped_instance"],
                        "root_pin": output_pin,
                        "critical_rank": seed["rank"],
                        "critical_impact_du": seed["impact_du"],
                        "reg2reg_path_hits": seed.get("reg2reg_path_hits"),
                        "reg2reg_increment_ns": seed.get("reg2reg_increment_ns"),
                        "reg2reg_path_ranks": seed.get("reg2reg_path_ranks"),
                        "cut_leaf_nodes": list(ordered_leaves),
                        "mapped_origins": sorted({
                            origin for node in _ancestor_nodes(aig, root_literal, leaves)
                            for origin in node_origins.get(node, ())
                        }),
                    }
                    single_groups[(replacement, table, count)].append(occurrence)
                    leafset_roots[ordered_leaves].append((root_literal, table, occurrence))
        for leaves, rooted in leafset_roots.items():
            distinct = {}
            for root_literal, table, occurrence in rooted:
                distinct.setdefault((root_literal, table), occurrence)
            choices = list(distinct.items())[:args.max_outputs]
            if len(choices) < 2:
                continue
            shared = None
            for (root_literal, _table), _occurrence in choices:
                ancestors = _ancestor_nodes(aig, root_literal, leaves)
                shared = ancestors if shared is None else shared & ancestors
            if not shared:
                statistics["multi_output_no_shared_logic"] += 1
                continue
            tables = tuple(item[0][1] for item in choices)
            key = mapped_core.functional_key(tables, len(leaves))
            if library.get(key):
                statistics["multi_output_library_covered"] += 1
                continue
            replacement, _input_perm, _output_perm = mapped_core.replacement_canonical(tables, len(leaves))
            multi_groups[(replacement, tables, len(leaves))].append({
                "module": module,
                "cut_leaf_nodes": list(leaves),
                "root_instances": [item[1]["root_instance"] for item in choices],
                "shared_aig_nodes": sorted(shared),
            })

    def single_rank(item):
        _key, occurrences = item
        return (
            -max(row["critical_impact_du"] for row in occurrences),
            min(row["critical_rank"] for row in occurrences),
            -len(occurrences),
            repr(_key),
        )

    single_items = list(single_groups.items())
    if args.objective == "critical_context_pareto":
        single_items = _pareto_order(single_items, lambda item: (
            -max(row["critical_impact_du"] for row in item[1]),
            min(row["critical_rank"] for row in item[1]),
            -len({(row["module"], row["root_instance"]) for row in item[1]}),
        ))
    else:
        single_items = sorted(single_items, key=single_rank)

    requests = []
    for index, ((replacement, table, count), occurrences) in enumerate(
        single_items[:args.top], 1
    ):
        evidence = {
            "strategy_id": args.strategy_id,
            "search_objective": args.objective,
            "source_graph": "mapped_to_unmapped_aig",
            "replacement_key": mapped_core.key_string(replacement),
            "library_equivalence_key": mapped_core.key_string(
                mapped_core.functional_key((table,), count)
            ),
            "library_function_match": "ABSENT_UNDER_NPN_EQUIVALENCE",
            "raw_support": len(occurrences),
            "non_overlapping_support": len({
                (row["module"], row["root_instance"]) for row in occurrences
            }),
            "non_overlapping_support_method": "distinct critical roots",
            "input_count": count,
            "output_count": 1,
            "critical_root_rank": min(row["critical_rank"] for row in occurrences),
            "critical_impact_du": max(row["critical_impact_du"] for row in occurrences),
            "reg2reg_path_hits": max(row.get("reg2reg_path_hits") or 0 for row in occurrences),
            "reg2reg_increment_ns": max(row.get("reg2reg_increment_ns") or 0.0 for row in occurrences),
            "occurrences": occurrences,
            "search_bound": {
                "max_inputs": args.max_inputs,
                "max_outputs": 1,
                "max_cuts_per_root": args.max_cuts_per_root,
                "preselected_cell_families": [],
                "preselected_instances": [],
            },
            "ppa_status": "UNPROVEN",
        }
        requests.append(_request(
            "CAND_%s_A2_SINGLE_%04d" % (
                re.sub(r"[^A-Za-z0-9]+", "_", args.strategy_id).upper(), index),
            "CRITICAL_K_INPUT_CONE", (table,), evidence, args, buildable=True,
        ))

    remaining = max(0, args.top - len(requests))
    for index, ((replacement, tables, count), occurrences) in enumerate(
        sorted(multi_groups.items(), key=lambda item: (-len(item[1]), repr(item[0])))[:remaining], 1
    ):
        evidence = {
            "strategy_id": args.strategy_id,
            "search_objective": args.objective,
            "source_graph": "mapped_to_unmapped_aig",
            "replacement_key": mapped_core.key_string(replacement),
            "library_equivalence_key": mapped_core.key_string(
                mapped_core.functional_key(tables, count)
            ),
            "library_function_match": "ABSENT_UNDER_NPNP_EQUIVALENCE",
            "raw_support": len(occurrences),
            "non_overlapping_support": len(occurrences),
            "non_overlapping_support_method": "distinct shared-logic groups",
            "input_count": count,
            "output_count": len(tables),
            "occurrences": occurrences,
            "shared_logic_audit": {
                "status": "PASS",
                "condition": "all output cones share at least one internal AIG node",
            },
            "search_bound": {
                "max_inputs": args.max_inputs,
                "max_outputs": args.max_outputs,
                "max_cuts_per_root": args.max_cuts_per_root,
            },
            "ppa_status": "UNPROVEN",
        }
        requests.append(_request(
            "CAND_%s_A4_MULTI_%04d" % (
                re.sub(r"[^A-Za-z0-9]+", "_", args.strategy_id).upper(), index),
            "MULTI_OUTPUT_SHARED_LOGIC", tables, evidence, args, buildable=False,
        ))
    return requests, statistics


def arguments(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--netlist", type=Path, required=True)
    parser.add_argument("--liberty-skeleton", type=Path, required=True)
    parser.add_argument("--full-liberty", type=Path, required=True)
    parser.add_argument("--timing-report", type=Path, required=True)
    parser.add_argument("--expected-top", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--strategy-id", default="timing_criticality")
    parser.add_argument(
        "--objective",
        default="critical_impact",
        choices=("critical_impact", "critical_context_pareto"),
    )
    parser.add_argument("--top", type=int, default=40)
    parser.add_argument("--max-inputs", type=int, default=4)
    parser.add_argument("--max-outputs", type=int, default=4)
    parser.add_argument("--max-critical-roots", type=int, default=24)
    parser.add_argument("--max-cuts-per-root", type=int, default=32)
    parser.add_argument("--process-family", required=True)
    parser.add_argument("--cell-architecture-ref", required=True)
    parser.add_argument("--characterization-profile-ref", required=True)
    parser.add_argument("--drive-strength", action="append", required=True)
    parser.add_argument("--vt-class", action="append", required=True)
    parser.add_argument("--model-type", action="append", default=["NLDM"])
    args = parser.parse_args(argv)
    if not 1 <= args.top <= 40:
        parser.error("--top must be within 1..40")
    if args.max_inputs != 4 or args.max_outputs != 4:
        parser.error("Package v0.3 fixes K=4 and max_outputs=4")
    return args


def run(args):
    modules = parse_modules(args.netlist.read_text(encoding="utf-8", errors="replace"))
    cells = parse_skeleton(args.liberty_skeleton)
    required_cells = {
        instance.base_type for instances in modules.values() for instance in instances
        if instance.base_type in cells and not cells[instance.base_type].is_seq
    }
    delay_model = parse_relative_delay_model(args.full_liberty, required_cells)
    observed_reg2reg = parse_reg2reg_path_membership(args.timing_report, args.expected_top, modules)
    critical_records = []
    for module, instances in modules.items():
        record = rank_critical_subgraph(
            module, instances, cells, delay_model["delay_units"],
            top_paths=16, top_seeds=args.max_critical_roots,
            observed_reg2reg=observed_reg2reg.get(module, {}),
        )
        if record:
            critical_records.append(record)
    if not critical_records:
        raise ValueError("Algorithm 1 found no combinational critical subgraph")
    library = mapped_core.library_indexes(cells, args.max_inputs, args.max_outputs)
    requests, statistics = _route_requests(
        modules, cells, critical_records, library, args
    )
    report = {
        "report_schema": REPORT_SCHEMA,
        "strategy_id": args.strategy_id,
        "source_graph": "mapped",
        "algorithms": list(ALGORITHMS),
        "inputs": {
            "netlist": os.path.abspath(str(args.netlist)),
            "netlist_sha256": _sha256(args.netlist),
            "liberty_function_skeleton": os.path.abspath(str(args.liberty_skeleton)),
            "full_liberty_sha256": delay_model["liberty_sha256"],
            "timing_report": os.path.abspath(str(args.timing_report)),
            "timing_report_sha256": _sha256(args.timing_report),
        },
        "search_definition": {
            "route": args.strategy_id,
            "objective": args.objective,
            "max_inputs": args.max_inputs,
            "max_outputs": args.max_outputs,
            "max_critical_roots": args.max_critical_roots,
            "max_cuts_per_root": args.max_cuts_per_root,
            "custom_cell_budget": args.top,
            "preselected_cell_families": [],
            "preselected_instances": [],
            "path_group": "reg2reg",
        },
        "algorithm_records": {
            "critical_subgraph": critical_records,
            "critical_k_input_cone": {
                "candidate_count": sum(
                    1 for item in requests
                    if item["discovery_evidence"]["discovery_algorithm"] == "CRITICAL_K_INPUT_CONE"
                ),
                "k": args.max_inputs,
            },
            "multi_output_shared_logic": {
                "candidate_count": sum(
                    1 for item in requests
                    if item["discovery_evidence"]["discovery_algorithm"] == "MULTI_OUTPUT_SHARED_LOGIC"
                ),
                "requires_shared_internal_node": True,
            },
        },
        "statistics": dict(sorted(statistics.items())),
        "generation_requests": requests,
        "limitations": [
            "Algorithm 1 produces relative criticality in DU, not signoff timing.",
            "Algorithm 4 discoveries are not buildable until a shared multi-output transistor generator is loaded.",
            "G0-G4 evidence is not G6 mapper selection or G7 PPA verification.",
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return report


def main(argv=None):
    args = arguments(argv)
    report = run(args)
    print(
        "TIMING OPPORTUNITY ROUTE algorithms=1,2,4 critical_subgraphs=%d candidates=%d -> %s"
        % (len(report["algorithm_records"]["critical_subgraph"]),
           len(report["generation_requests"]), args.output)
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
