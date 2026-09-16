#!/usr/bin/env python3
"""Timing-driven Cell opportunity route: Algorithm 1 -> 2 -> 4.

Algorithm 1 builds a mapped directed hypergraph view, annotates cell vertices
with a normalised delay proxy from the full site Liberty, computes relative
arrival/required/slack, and ranks structural transformations in deterministic
Pareto layers.  Logic depth, removable nodes/edges, cut width, reconvergence,
fanout/load, buffer/inverter pressure, timing-family coverage, mapping
feasibility and overlap remain separate raw axes.  Local proxy timing is one
axis and is never presented as a commercial QoR prediction.

Algorithm 2 losslessly unmaps each eligible mapped function into a structurally
hashed AIG and enumerates K-feasible cuts only around Algorithm-1 roots.  Each
new single-output function becomes a Standard Cell Generation Request v2.

Algorithm 4 audits roots that share the same cut leaves and an actual internal
AIG node.  Multi-output discoveries remain visible Pattern Records; the current
single-output transistor generator does not claim to build them as one Cell.
"""

from __future__ import annotations

import argparse
import fnmatch
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


def _arrivals(order, predecessors, weights, reduced=None, replacement_weights=None):
    reduced = reduced or {}
    replacement_weights = replacement_weights or {}
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
        weight = replacement_weights.get(
            name, max(0.0, weights[name] - reduced.get(name, 0.0))
        )
        arrival[name] = best_value + max(0.0, weight)
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


def _trace_path(endpoint, predecessor_choice):
    path = []
    cursor = endpoint
    while cursor is not None:
        path.append(cursor)
        cursor = predecessor_choice[cursor]
    return list(reversed(path))


def _descendants(name, successors):
    seen = set()
    stack = list(successors[name])
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        stack.extend(successors[current] - seen)
    return seen


def _ancestors(name, predecessors):
    seen = set()
    stack = list(predecessors[name])
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        stack.extend(predecessors[current] - seen)
    return seen


def _logic_depths(order, predecessors):
    depths = {}
    for name in order:
        depths[name] = 1 + max(
            (depths[predecessor] for predecessor in predecessors[name]), default=0
        )
    return depths


def _non_overlapping_type_support(names, predecessors, successors):
    """Count deterministic one-hop replacement regions that do not overlap."""
    regions = {
        name: {name} | set(predecessors[name]) | set(successors[name])
        for name in names
    }
    occupied = set()
    selected = []
    for name in sorted(names, key=lambda item: (len(regions[item]), item)):
        if regions[name] & occupied:
            continue
        selected.append(name)
        occupied.update(regions[name])
    return len(selected), regions


def _counterfactual_costs(name, local_delay, trial_reduction, overrides):
    """Build an auditable replacement-delay budget for one mapped vertex.

    This graph has Cell delay but no independently calibrated buffer or net
    model. Those terms default to zero rather than invented values. The default
    new-Cell estimate retains all but the bounded trial reduction, so the
    counterfactual never erases a cone or treats it as zero-delay.
    """
    supplied = (overrides or {}).get(name, {})
    values = {
        "removable_cell_delay_du": local_delay,
        "removable_buffer_delay_du": 0.0,
        "removable_net_delay_du": 0.0,
        "new_cell_delay_du": max(local_delay - trial_reduction, 1e-9),
        "boundary_penalty_du": 0.0,
        "fanout_penalty_du": 0.0,
        "wire_penalty_du": 0.0,
        "uncertainty_penalty_du": 0.0,
    }
    for key in values:
        if key in supplied:
            values[key] = float(supplied[key])
        if not math.isfinite(values[key]) or values[key] < 0.0:
            raise ValueError(
                "counterfactual cost %s for %s must be finite and nonnegative" %
                (key, name)
            )
    if values["new_cell_delay_du"] <= 0.0:
        raise ValueError("counterfactual new Cell delay for %s must be positive" % name)
    removable = sum(values[key] for key in (
        "removable_cell_delay_du", "removable_buffer_delay_du", "removable_net_delay_du"
    ))
    penalties = sum(values[key] for key in (
        "new_cell_delay_du", "boundary_penalty_du", "fanout_penalty_du",
        "wire_penalty_du", "uncertainty_penalty_du",
    ))
    requested_reduction = removable - penalties
    replacement = max(1e-9, local_delay - requested_reduction)
    values.update({
        "gross_removable_delay_du": removable,
        "total_replacement_and_penalty_du": penalties,
        "requested_proxy_reduction_du": requested_reduction,
        "applied_proxy_reduction_du": local_delay - replacement,
        "replacement_effective_delay_du": replacement,
        "scope": "license_free_local_graph_proxy_not_commercial_qor_prediction",
    })
    return values


def rank_critical_subgraph(module, instances, cells, delay_units, top_paths=16, top_seeds=24,
                           observed_reg2reg=None, generated_cell_pattern=None,
                           counterfactual_costs=None):
    (eligible, _drivers, _loads, predecessors, successors,
     order, edge_nets) = _mapped_graph(instances, cells)
    if not eligible:
        return None
    weights = {
        name: float(delay_units.get(instance.base_type, 1.0))
        for name, instance in eligible.items()
    }
    arrival, predecessor_choice = _arrivals(order, predecessors, weights)
    all_endpoints = sorted(
        (name for name in order if not successors[name]),
        key=lambda name: (-arrival[name], name),
    )
    if not all_endpoints:
        return None
    baseline = arrival[all_endpoints[0]]
    baseline_worst_endpoint = all_endpoints[0]
    slack_window = max(0.05 * baseline, 0.10)
    endpoints = [
        name for name in all_endpoints[:top_paths]
        if baseline - arrival[name] <= slack_window
    ] or all_endpoints[:1]
    required = _required(order, successors, weights, baseline)
    dominators = _dominators(order, predecessors)
    logic_depths = _logic_depths(order, predecessors)

    paths = []
    for endpoint in endpoints:
        path = _trace_path(endpoint, predecessor_choice)
        paths.append({
            "endpoint": endpoint,
            "delay_du": round(arrival[endpoint], 6),
            "slack_du": round(baseline - arrival[endpoint], 6),
            "instances": path,
        })
    # Expand the one representative predecessor trace into all near-critical
    # predecessors. Otherwise equal parallel branches collapse to the lexical
    # tie winner and reconvergent masking is invisible.
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

    repeated_by_type = defaultdict(list)
    for name in subgraph_nodes:
        repeated_by_type[eligible[name].base_type].append(name)
    support_by_type = {}
    region_by_name = {}
    for cell_type, names in repeated_by_type.items():
        support, regions = _non_overlapping_type_support(names, predecessors, successors)
        support_by_type[cell_type] = support
        region_by_name.update(regions)

    ranking = []
    for name in subgraph_nodes:
        trial = min(trial_global, weights[name])
        costs = _counterfactual_costs(name, weights[name], trial, counterfactual_costs)
        perturbed, perturbed_choices = _arrivals(
            order, predecessors, weights,
            replacement_weights={name: costs["replacement_effective_delay_du"]},
        )
        new_worst_endpoint = min(
            all_endpoints, key=lambda endpoint: (-perturbed[endpoint], endpoint)
        )
        after = perturbed[new_worst_endpoint]
        impact = max(0.0, baseline - after)
        participation = sum(
            endpoint_weight[path["endpoint"]]
            for path in paths if name in path["instances"]
        )
        domination = sum(
            endpoint_weight[endpoint]
            for endpoint in endpoints if name in dominators[endpoint]
        )
        descendants = _descendants(name, successors)
        reconvergences = sorted(
            node for node in descendants if len(predecessors[node]) > 1
        )
        seen = (observed_reg2reg or {}).get(name, {})
        family_ids = sorted(seen.get("path_family_ids") or [])
        family_slacks = seen.get("path_family_worst_slacks_ns") or {}
        negative_slack_mass = sum(
            max(0.0, -float(family_slacks[family]))
            for family in family_ids if family_slacks.get(family) is not None
        )
        same_type = repeated_by_type[eligible[name].base_type]
        overlap_count = sum(
            1 for other in same_type if other != name
            and region_by_name[name] & region_by_name[other]
        )
        neighborhood = {name} | set(predecessors[name]) | set(successors[name])
        buffer_inverter_count = sum(
            1 for node in neighborhood
            if re.search(r"(?:BUF|INV)", eligible[node].base_type, re.IGNORECASE)
        )
        removable_edges = len(predecessors[name]) + len(successors[name])
        influence_vector = {
            "logic_depth_before": logic_depths[name],
            "logic_depth_after": logic_depths[name],
            "removable_node_count": 1,
            "removable_edge_count": removable_edges,
            "worst_endpoint_relief_du": round(impact, 6),
            "negative_slack_mass_coverage_ns": round(negative_slack_mass, 6),
            "path_family_ids": family_ids,
            "path_family_count": len(family_ids),
            "dominator_endpoint_coverage": round(domination / total_endpoint_weight, 6),
            "reconvergence_node_count": len(reconvergences),
            "reconvergence_nodes": reconvergences,
            "removable_depth": 1,
            "cut_boundary_input_count": len(predecessors[name]),
            "cut_boundary_output_count": len(successors[name]),
            "repeat_support": len(same_type),
            "non_overlapping_support": support_by_type[eligible[name].base_type],
            "fanout_count": len(successors[name]),
            "load_proxy": len(successors[name]),
            "fanout_load_distribution": {
                "fanout_count": len(successors[name]),
                "successor_indegree_min": min(
                    (len(predecessors[node]) for node in successors[name]), default=0
                ),
                "successor_indegree_max": max(
                    (len(predecessors[node]) for node in successors[name]), default=0
                ),
            },
            "buffer_inverter_pressure": {
                "one_hop_count": buffer_inverter_count,
                "one_hop_fraction": round(buffer_inverter_count / len(neighborhood), 6),
            },
            "overlap_count": overlap_count,
            "overlap_ratio": round(overlap_count / max(1, len(same_type) - 1), 6),
            "mapping_feasible": True,
            "mapping_adoption_status": "not_evaluated",
        }
        counterfactual = dict(costs)
        counterfactual.update({
            "baseline_worst_endpoint": baseline_worst_endpoint,
            "baseline_worst_delay_du": round(baseline, 6),
            "new_worst_endpoint": new_worst_endpoint,
            "new_worst_delay_du": round(after, 6),
            "new_worst_path": _trace_path(new_worst_endpoint, perturbed_choices),
            "path_migrated": new_worst_endpoint != baseline_worst_endpoint,
            "logic_depth_before": logic_depths[baseline_worst_endpoint],
            "logic_depth_after": logic_depths[new_worst_endpoint],
        })
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
            "influence_vector": influence_vector,
            "counterfactual": counterfactual,
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
                "reg2reg_path_family_count": seen["path_family_count"],
                "reg2reg_path_family_ids": seen["path_family_ids"],
                "reg2reg_path_family_support": seen["path_family_support"],
                "reg2reg_beginpoint_families": seen["beginpoint_families"],
                "reg2reg_endpoint_families": seen["endpoint_families"],
                "reg2reg_worst_path_slack_ns": seen["worst_path_slack_ns"],
                "reg2reg_path_family_worst_slacks_ns":
                    seen.get("path_family_worst_slacks_ns", {}),
            })
            aligned.append(row)
        ranking = aligned
    # Structural transformation is a multi-index problem. Proxy timing is one
    # axis in the Pareto vector, never a prediction of commercial QoR.
    ranking = [item[1] for item in _pareto_order(
        [(row["mapped_instance"], row) for row in ranking],
        lambda item: (
            -item[1]["influence_vector"]["removable_depth"],
            -item[1]["influence_vector"]["removable_node_count"],
            -item[1]["influence_vector"]["removable_edge_count"],
            item[1]["influence_vector"]["cut_boundary_input_count"],
            -item[1]["influence_vector"]["reconvergence_node_count"],
            -item[1]["influence_vector"]["dominator_endpoint_coverage"],
            -item[1]["influence_vector"]["path_family_count"],
            -item[1]["influence_vector"]["negative_slack_mass_coverage_ns"],
            -item[1]["influence_vector"]["worst_endpoint_relief_du"],
            item[1]["influence_vector"]["overlap_ratio"],
            -int(item[1]["influence_vector"]["mapping_feasible"]),
        ),
    )]
    for index, row in enumerate(ranking, 1):
        row["rank"] = index
    if not ranking:
        return None
    startpoints = sorted({path["instances"][0] for path in paths})
    selected = []
    if generated_cell_pattern:
        selected.extend(row for row in ranking
                        if fnmatch.fnmatchcase(row["cell_type"], generated_cell_pattern))
        selected = selected[:max(1, top_seeds // 2)]
    selected_names = {row["mapped_instance"] for row in selected}
    selected.extend(row for row in ranking if row["mapped_instance"] not in selected_names)
    selected = selected[:top_seeds]
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
            "all_endpoint_count": len(all_endpoints),
            "node_count": len(subgraph_nodes),
            "hyperedge_count": sum(
                1 for net in edge_nets
                if any(driver in subgraph_nodes for driver, _pin in _drivers.get(net, ()))
            ),
        },
        "representative_paths": paths,
        "critical_elements": selected,
        "ranking_objective": {
            "method": "deterministic_pareto_layers",
            "axes": [
                "logic_depth_and_removable_nodes_edges",
                "cut_width_and_reconvergence_dominator_coverage",
                "fanout_load_and_buffer_inverter_pressure",
                "endpoint_path_family_and_negative_slack_mass",
                "mapping_feasibility_and_overlap",
                "local_graph_proxy_before_after_and_path_migration",
            ],
            "commercial_qor_prediction": False,
        },
        "limitations": [
            "DC reg2reg path membership and incremental delay are measured; relative NLDM delay remains a search proxy.",
            "Uncalibrated buffer and net removable-delay terms default to zero; the raw counterfactual budget records every term.",
            "The current Package has no lossless mapped-to-unmapped origin map across hierarchy; "
            "Algorithm 2 therefore rebuilds a local function-preserving AIG per mapped module.",
        ],
    }


def _endpoint_family(point):
    """Normalize indexed register endpoints into one structural timing family."""
    value = str(point or "unknown").strip()
    value = re.sub(r"/[A-Za-z0-9_$]+$", "", value)
    return re.sub(r"[0-9]+", "#", value)


def _proxy_reg2reg_timing_graph(document, expected_top, modules):
    if (document.get("schema") != "hima.lfr-proxy-reg2reg/1"
            or document.get("status") != "succeeded"
            or document.get("design") != expected_top
            or document.get("path_group") != "reg2reg"
            or document.get("claim_limits") != {
                "commercial_sta": False, "commercial_qor_predicted": False}):
        raise ValueError("proxy timing evidence has the wrong identity or claim limits")
    timing = document.get("timing")
    paths = timing.get("paths") if isinstance(timing, dict) else None
    unit_ns = document.get("time_unit_ns")
    if (not isinstance(paths, list) or not paths
            or isinstance(unit_ns, bool) or not isinstance(unit_ns, (int, float))
            or not math.isfinite(float(unit_ns)) or unit_ns <= 0):
        raise ValueError("proxy timing evidence has no finite reg2reg paths/time unit")
    instances = {module: {item.name: item for item in rows} for module, rows in modules.items()}
    observed = defaultdict(lambda: defaultdict(lambda: {
        "path_ranks": set(), "max_increment_ns": 0.0, "path_increments_ns": {},
        "path_family_ids": set(), "beginpoint_families": set(),
        "endpoint_families": set(), "worst_path_slack_ns": None,
    }))
    families = defaultdict(lambda: {"path_ranks": [], "slacks": []})
    for rank, path in enumerate(paths, 1):
        if not isinstance(path, dict) or not isinstance(path.get("stages"), list):
            raise ValueError("proxy timing path %d is malformed" % rank)
        begin = str(path.get("launchpoint") or "")
        end = str(path.get("endpoint") or "")
        begin_family, end_family = _endpoint_family(begin), _endpoint_family(end)
        family_id = begin_family + "->" + end_family
        slack = float(path.get("slack")) * float(unit_ns)
        family = families[family_id]
        family.update({"beginpoint_family": begin_family, "endpoint_family": end_family})
        family["path_ranks"].append(rank)
        family["slacks"].append(slack)
        for stage in path["stages"]:
            name, cell = stage.get("instance"), stage.get("cell")
            if not isinstance(name, str) or not isinstance(cell, str):
                raise ValueError("proxy timing stage has no instance/Cell identity")
            local = instances.get(expected_top, {}).get(name)
            if local is None or local.base_type != cell:
                raise ValueError("proxy timing stage does not map to the held netlist: %s" % name)
            delay = stage.get("delay") or {}
            increment = float(delay.get("value")) * float(unit_ns)
            item = observed[expected_top][name]
            item["path_ranks"].add(rank)
            item["max_increment_ns"] = max(item["max_increment_ns"], increment)
            item["path_increments_ns"][rank] = increment
            item["path_family_ids"].add(family_id)
            item["beginpoint_families"].add(begin_family)
            item["endpoint_families"].add(end_family)
            prior = item["worst_path_slack_ns"]
            item["worst_path_slack_ns"] = slack if prior is None else min(prior, slack)
    family_support = {name: len(row["path_ranks"]) for name, row in families.items()}
    family_rows = [{
        "family_id": name, "beginpoint_family": row["beginpoint_family"],
        "endpoint_family": row["endpoint_family"], "path_count": len(row["path_ranks"]),
        "path_ranks": row["path_ranks"], "worst_slack_ns": min(row["slacks"]),
    } for name, row in sorted(families.items())]
    result = {}
    for module, rows in observed.items():
        result[module] = {}
        for name, item in rows.items():
            ids = sorted(item["path_family_ids"])
            result[module][name] = {
                "path_hits": len(item["path_ranks"]), "path_ranks": sorted(item["path_ranks"]),
                "max_increment_ns": round(item["max_increment_ns"], 6),
                "path_increments_ns": {key: round(value, 6) for key, value in sorted(item["path_increments_ns"].items())},
                "path_family_count": len(ids), "path_family_ids": ids,
                "path_family_support": sum(family_support[value] for value in ids),
                "beginpoint_families": sorted(item["beginpoint_families"]),
                "endpoint_families": sorted(item["endpoint_families"]),
                "path_family_worst_slacks_ns": {value: round(min(families[value]["slacks"]), 6) for value in ids},
                "worst_path_slack_ns": round(item["worst_path_slack_ns"], 6),
            }
    if not result:
        raise ValueError("proxy timing evidence has no mapped combinational instance")
    return {"instances": result, "graph": {
        "path_group": "reg2reg", "path_count": len(paths),
        "path_family_count": len(family_rows), "path_families": family_rows,
        "endpoint_family_method": "remove terminal pin and replace every decimal run with #",
        "evidence_source": "license-free-proxy-sta-not-commercial-timing",
    }}


def parse_reg2reg_timing_graph(report, expected_top, modules):
    """Map full reg2reg paths onto routed instances and endpoint families.

    A path report is a sample from a timing graph, not an independent object.
    The returned graph therefore retains shared beginpoint/endpoint families,
    per-family path support and per-instance coverage across those families.
    Innovus launch/capture clock-tree rows are excluded: mining begins only
    after the reported data beginpoint and stops before ``Other End Path``.
    """
    text = report.read_text(encoding="utf-8", errors="replace")
    try:
        document = json.loads(text)
    except json.JSONDecodeError:
        document = None
    if isinstance(document, dict) and document.get("schema") == "hima.lfr-proxy-reg2reg/1":
        return _proxy_reg2reg_timing_graph(document, expected_top, modules)
    designs = re.findall(r"(?m)^\s*#?\s*Design\s*:\s*(\S+)\s*$", text)
    groups = re.findall(r"(?m)^\s*Path Group:\s*(\S+)\s*$", text)
    groups.extend(re.findall(r"(?m)^Path Groups:\s*\{([^}]+)\}\s*$", text))
    normalized_groups = {"reg2reg" if group in {"reg2reg", "flop2flop"} else group
                         for group in groups}
    if set(designs) != {expected_top} or not groups or normalized_groups != {"reg2reg"}:
        raise ValueError("timing report must identify one expected design and only reg2reg paths")
    instances_by_module = {
        module: {instance.name: instance for instance in instances}
        for module, instances in modules.items()
    }
    observed = defaultdict(lambda: defaultdict(lambda: {
        "path_ranks": set(), "max_increment_ns": 0.0,
        "path_increments_ns": {},
        "path_family_ids": set(), "beginpoint_families": set(),
        "endpoint_families": set(), "worst_path_slack_ns": None,
    }))
    path_rank = 0
    path_seen = defaultdict(dict)
    path_meta = defaultdict(dict)
    dc_point = re.compile(r"^\s+(\S+)/\S+\s+\(([^)]+)\)(.*)$")
    innovus_point = re.compile(
        r"^\s*\|\s*([^|\s]+/[^|\s]+)\s*\|[^|]*\|[^|]*\|\s*([^|\s]+)\s*\|\s*(-?[0-9.eE+-]+)\s*\|"
    )
    innovus_data_path = False
    innovus_beginpoint_seen = False
    for line in text.splitlines():
        if line.lstrip().startswith("Startpoint:"):
            path_rank += 1
            path_meta[path_rank]["beginpoint"] = line.split(":", 1)[1].strip().split()[0]
            innovus_data_path = False
            continue
        if re.match(r"^Path\s+\d+:\s*", line):
            path_rank += 1
            innovus_data_path = False
            innovus_beginpoint_seen = False
            continue
        beginpoint = re.match(r"^Beginpoint:\s*(\S+)", line)
        if beginpoint and path_rank:
            path_meta[path_rank]["beginpoint"] = beginpoint.group(1)
            continue
        endpoint = re.match(r"^\s*Endpoint:\s*(\S+)", line)
        if endpoint and path_rank:
            path_meta[path_rank]["endpoint"] = endpoint.group(1)
            continue
        slack = re.match(r"^\s*(?:=\s*Slack Time|slack\s+\([^)]*\))\s+(-?[0-9.eE+-]+)\s*$", line)
        if slack and path_rank:
            path_meta[path_rank]["slack_ns"] = float(slack.group(1))
            continue
        if line.strip() == "Timing Path:":
            innovus_data_path = True
            innovus_beginpoint_seen = False
            continue
        if line.strip() == "Other End Path:":
            innovus_data_path = False
            continue
        match = dc_point.match(line)
        if match is not None:
            instance_path, cell_type, columns = match.groups()
            values = [float(value) for value in re.findall(r"-?[0-9]+(?:\.[0-9]+)?", columns)]
            increment = max(0.0, values[-2] if len(values) >= 2 else 0.0)
        else:
            physical = innovus_point.match(line) if innovus_data_path else None
            if physical is None:
                continue
            point_path, cell_type, delay = physical.groups()
            beginpoint_pin = path_meta[path_rank].get("beginpoint")
            if not innovus_beginpoint_seen:
                if point_path != beginpoint_pin:
                    continue
                innovus_beginpoint_seen = True
                continue
            instance_path = point_path.rsplit("/", 1)[0]
            increment = max(0.0, float(delay))
        if path_rank == 0:
            continue
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
        current = path_seen[path_rank].get((module, leaf), 0.0)
        path_seen[path_rank][(module, leaf)] = max(current, increment)
    families = defaultdict(lambda: {"path_ranks": [], "slacks": []})
    for rank in sorted(path_seen):
        meta = path_meta[rank]
        begin_family = _endpoint_family(meta.get("beginpoint"))
        end_family = _endpoint_family(meta.get("endpoint"))
        family_id = begin_family + "->" + end_family
        family = families[family_id]
        family["beginpoint_family"] = begin_family
        family["endpoint_family"] = end_family
        family["path_ranks"].append(rank)
        if isinstance(meta.get("slack_ns"), float):
            family["slacks"].append(meta["slack_ns"])
        for (module, leaf), increment in path_seen[rank].items():
            item = observed[module][leaf]
            item["path_ranks"].add(rank)
            item["max_increment_ns"] = max(item["max_increment_ns"], increment)
            item["path_increments_ns"][rank] = increment
            item["path_family_ids"].add(family_id)
            item["beginpoint_families"].add(begin_family)
            item["endpoint_families"].add(end_family)
            if isinstance(meta.get("slack_ns"), float):
                current = item["worst_path_slack_ns"]
                item["worst_path_slack_ns"] = (meta["slack_ns"] if current is None
                                                else min(current, meta["slack_ns"]))
    family_rows = []
    family_support = {}
    for family_id, item in families.items():
        family_support[family_id] = len(item["path_ranks"])
        family_rows.append({
            "family_id": family_id,
            "beginpoint_family": item["beginpoint_family"],
            "endpoint_family": item["endpoint_family"],
            "path_count": len(item["path_ranks"]),
            "path_ranks": item["path_ranks"],
            "worst_slack_ns": min(item["slacks"]) if item["slacks"] else None,
        })
    family_rows.sort(key=lambda row: (
        row["worst_slack_ns"] is None,
        row["worst_slack_ns"] if row["worst_slack_ns"] is not None else 0.0,
        -row["path_count"], row["family_id"],
    ))
    result = {}
    for module, instances in observed.items():
        result[module] = {}
        for name, item in instances.items():
            family_ids = sorted(item["path_family_ids"])
            result[module][name] = {
                "path_hits": len(item["path_ranks"]),
                "path_ranks": sorted(item["path_ranks"]),
                "max_increment_ns": round(item["max_increment_ns"], 6),
                "path_increments_ns": {rank: round(value, 6)
                                       for rank, value in sorted(item["path_increments_ns"].items())},
                "path_family_count": len(family_ids),
                "path_family_ids": family_ids,
                "path_family_support": sum(family_support[value] for value in family_ids),
                "beginpoint_families": sorted(item["beginpoint_families"]),
                "endpoint_families": sorted(item["endpoint_families"]),
                "path_family_worst_slacks_ns": {
                    family_id: (round(min(families[family_id]["slacks"]), 6)
                                if families[family_id]["slacks"] else None)
                    for family_id in family_ids
                },
                "worst_path_slack_ns": (round(item["worst_path_slack_ns"], 6)
                                        if item["worst_path_slack_ns"] is not None else None),
            }
    if not result:
        raise ValueError("timing report has no combinational instance that maps to the netlist")
    return {
        "instances": result,
        "graph": {
            "path_group": "reg2reg",
            "path_count": len(path_seen),
            "path_family_count": len(family_rows),
            "path_families": family_rows,
            "endpoint_family_method": "remove terminal pin and replace every decimal run with #",
        },
    }


def parse_reg2reg_path_membership(report, expected_top, modules):
    """Backward-compatible per-instance view of ``parse_reg2reg_timing_graph``."""
    return parse_reg2reg_timing_graph(report, expected_top, modules)["instances"]


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
    mapping_feasible = bool(buildable) and bool(
        (evidence.get("influence_vector") or {}).get("mapping_feasible", True)
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
        "influence_vector": evidence.get("influence_vector"),
        "mapping_feasibility": {
            "status": "FEASIBLE" if mapping_feasible else "INFEASIBLE",
            "reasons": [] if mapping_feasible else [
                "one or more proposed cut regions have side outputs or no supported generator"
            ],
        },
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


def _cone_depth(cone, order, predecessors):
    depths = {}
    for name in order:
        if name not in cone:
            continue
        depths[name] = 1 + max(
            (depths[pred] for pred in predecessors[name] if pred in cone),
            default=0,
        )
    return max(depths.values(), default=0)


def _topological_order(predecessors, successors):
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
    if len(order) != len(predecessors):
        raise ValueError("collapsed counterfactual graph contains a cycle")
    return order


def _candidate_counterfactual(module, occurrence_id, cone_names, root_instance,
                              eligible, predecessors, successors, order, weights,
                              cut_boundary_input_count=None,
                              cut_boundary_output_count=1):
    """Collapse one proposed Cell's full mapped-origin cone and repropagate.

    The replacement delay is a license-free structural indicator: the largest
    constituent Cell DU. It is not a characterized candidate delay and is not
    exported in ps. The raw basis remains on the occurrence so a later proxy
    stage can replace it with evidenced candidate timing.
    """
    cone = set(cone_names) | {root_instance}
    unknown = sorted(cone - set(eligible))
    if unknown:
        raise ValueError("candidate cone contains unknown mapped origins: %s" % unknown)
    incoming = sorted({
        predecessor for name in cone for predecessor in predecessors[name]
        if predecessor not in cone
    })
    outgoing = sorted({
        successor for name in cone for successor in successors[name]
        if successor not in cone
    })
    exit_nodes = sorted(
        name for name in cone
        if not successors[name] or any(node not in cone for node in successors[name])
    )
    side_output_nodes = sorted(name for name in exit_nodes if name != root_instance)
    cut_region = cone | set(incoming) | set(outgoing)
    qualified = lambda values: ["%s/%s" % (module, name) for name in sorted(values)]
    if cut_boundary_input_count is None:
        cut_boundary_input_count = len(incoming)
    if cut_boundary_input_count < 1 or cut_boundary_output_count < 1:
        raise ValueError("candidate Boolean cut must have input and output boundaries")

    baseline_arrival, baseline_choices = _arrivals(order, predecessors, weights)
    baseline_endpoints = sorted(
        (name for name in order if not successors[name]),
        key=lambda name: (-baseline_arrival[name], name),
    )
    baseline_worst = baseline_endpoints[0]
    baseline_delay = baseline_arrival[baseline_worst]

    replacement = "@candidate:%s" % occurrence_id
    collapsed_nodes = [name for name in order if name not in cone] + [replacement]
    collapsed_predecessors = {name: set() for name in collapsed_nodes}
    collapsed_successors = {name: set() for name in collapsed_nodes}
    for name in order:
        if name in cone:
            continue
        for predecessor in predecessors[name]:
            collapsed_predecessors[name].add(
                replacement if predecessor in cone else predecessor
            )
    collapsed_predecessors[replacement] = set(incoming)
    for name, values in collapsed_predecessors.items():
        for predecessor in values:
            collapsed_successors[predecessor].add(name)
    collapsed_order = _topological_order(collapsed_predecessors, collapsed_successors)
    proxy_delay = max(weights[name] for name in cone)
    collapsed_weights = {
        name: (proxy_delay if name == replacement else weights[name])
        for name in collapsed_order
    }
    collapsed_arrival, collapsed_choices = _arrivals(
        collapsed_order, collapsed_predecessors, collapsed_weights
    )
    collapsed_endpoints = sorted(
        (name for name in collapsed_order if not collapsed_successors[name]),
        key=lambda name: (-collapsed_arrival[name], name),
    )
    new_worst = collapsed_endpoints[0]
    new_delay = collapsed_arrival[new_worst]
    proposed_paths = {
        endpoint: _trace_path(endpoint, collapsed_choices)
        for endpoint in collapsed_endpoints
        if replacement in _trace_path(endpoint, collapsed_choices)
    }
    proposed_endpoint = min(
        proposed_paths,
        key=lambda endpoint: (-collapsed_arrival[endpoint], endpoint),
    ) if proposed_paths else None

    cone_depth_before = _cone_depth(cone, order, predecessors)
    cone_depth_after = 1
    internal_edges = sum(
        1 for name in cone for predecessor in predecessors[name] if predecessor in cone
    )
    original_cone_delay = {}
    for name in order:
        if name not in cone:
            continue
        original_cone_delay[name] = weights[name] + max(
            (original_cone_delay[pred] for pred in predecessors[name] if pred in cone),
            default=0.0,
        )
    break_even_delay = max(
        (original_cone_delay[name] for name in exit_nodes), default=0.0
    )
    return {
        "occurrence_id": occurrence_id,
        "mapped_origin_instance_keys": qualified(cone),
        "covered_instance_keys": qualified(cut_region),
        "cut_region_instance_keys": qualified(cut_region),
        "cut_boundary_input_count": cut_boundary_input_count,
        "cut_boundary_output_count": cut_boundary_output_count,
        "side_output_instance_keys": qualified(side_output_nodes),
        "mapping_feasible": not side_output_nodes,
        # A structurally legal cut can be hidden by a reconvergent predecessor
        # at every endpoint.  Keep the exact buildable function in the broad
        # Library screen, but expose that its local timing factor is inactive;
        # the paired mapper/STA stage, rather than F0, decides actual use.
        "timing_path_active": proposed_endpoint is not None,
        "logic_depth_before": cone_depth_before,
        "logic_depth_after": cone_depth_after,
        "logic_depth_delta": cone_depth_before - cone_depth_after,
        "removable_node_count": max(0, len(cone) - 1),
        "removable_edge_count": internal_edges,
        "local_break_even_du": round(break_even_delay, 6),
        "proxy_cell_delay_du": round(proxy_delay, 6),
        "proxy_frontier_indicator_du": round(break_even_delay - proxy_delay, 6),
        "removable_cell_delay_du": round(break_even_delay, 6),
        "removable_buffer_delay_du": 0.0,
        "removable_net_delay_du": 0.0,
        "new_cell_delay_du": round(proxy_delay, 6),
        "boundary_penalty_du": 0.0,
        "fanout_penalty_du": 0.0,
        "wire_penalty_du": 0.0,
        "uncertainty_penalty_du": 0.0,
        "proxy_delay_basis": "max_constituent_cell_delay_from_full_liberty_relative_DU",
        "baseline_worst_endpoint": baseline_worst,
        "baseline_worst_delay_du": round(baseline_delay, 6),
        "baseline_worst_path": _trace_path(baseline_worst, baseline_choices),
        "new_worst_endpoint": new_worst,
        "new_worst_delay_du": round(new_delay, 6),
        "new_worst_path": _trace_path(new_worst, collapsed_choices),
        "path_migrated": new_worst != baseline_worst,
        "proposed_cell_node": replacement,
        "proposed_cell_endpoint": proposed_endpoint,
        "proposed_cell_path": (
            proposed_paths[proposed_endpoint] if proposed_endpoint is not None else []
        ),
        "worst_endpoint_relief_du": round(max(0.0, baseline_delay - new_delay), 6),
        "scope": "license_free_structural_proxy_not_commercial_qor_prediction",
    }


def _greedy_non_overlapping_occurrences(occurrences):
    """Select disjoint globally-qualified cut regions and report every clash."""
    selected = []
    occupied = set()
    overlap_pairs = []
    ordered = sorted(
        occurrences,
        key=lambda row: (-row["logic_depth_delta"], row["occurrence_id"]),
    )
    for row in ordered:
        region = set(row["cut_region_instance_keys"])
        overlap = sorted(region & occupied)
        if overlap:
            overlap_pairs.append({
                "occurrence_id": row["occurrence_id"],
                "overlap_instance_keys": overlap,
            })
            continue
        selected.append(row)
        occupied.update(region)
    return selected, overlap_pairs


def _aggregate_candidate_influence(occurrences, buildable=True):
    """Aggregate occurrence vectors without counting a timing family twice."""
    family_slacks = {}
    for row in occurrences:
        for family, slack in (row.get("reg2reg_path_family_worst_slacks_ns") or {}).items():
            if slack is None:
                continue
            family_slacks[family] = min(float(slack), family_slacks.get(family, float("inf")))
    vectors = [row.get("influence_vector") or {} for row in occurrences]
    family_ids = sorted({
        family for vector in vectors for family in vector.get("path_family_ids", [])
    })
    selected, overlap_pairs = _greedy_non_overlapping_occurrences(occurrences)
    depth_distribution = [{
        "occurrence_id": row["occurrence_id"],
        "before": row["logic_depth_before"],
        "after": row["logic_depth_after"],
        "delta": row["logic_depth_delta"],
    } for row in sorted(occurrences, key=lambda item: item["occurrence_id"])]
    reconvergence_nodes = sorted({
        "%s/%s" % (row["module"], node)
        for row in occurrences
        for node in (row.get("influence_vector") or {}).get("reconvergence_nodes", [])
    })
    return {
        "structural_metrics": {
            "levels_removed": sum(row["logic_depth_delta"] for row in selected),
            "nodes_removed": sum(row["removable_node_count"] for row in selected),
            "edges_removed": sum(row["removable_edge_count"] for row in selected),
            "cut_width": max(
                (row["cut_boundary_input_count"] + row["cut_boundary_output_count"]
                 for row in selected), default=0
            ),
            "reconvergence_coverage": len(reconvergence_nodes),
        },
        "logic_depth_delta_distribution": depth_distribution,
        "logic_depth_delta_nonoverlap_sum": sum(
            row["logic_depth_delta"] for row in selected
        ),
        "logic_depth_delta_max": max(
            (row["logic_depth_delta"] for row in occurrences), default=0
        ),
        "removable_node_count": sum(row["removable_node_count"] for row in selected),
        "removable_edge_count": sum(row["removable_edge_count"] for row in selected),
        "worst_endpoint_relief_du": max(
            (float(row["counterfactual"]["worst_endpoint_relief_du"])
             for row in occurrences),
            default=0.0,
        ),
        "negative_slack_mass_coverage_ns": round(sum(
            max(0.0, -slack) for slack in family_slacks.values()
        ), 6),
        "path_family_ids": family_ids,
        "path_family_count": len(family_ids),
        "dominator_endpoint_coverage": max(
            (float(vector.get("dominator_endpoint_coverage", 0.0)) for vector in vectors),
            default=0.0,
        ),
        "reconvergence_node_count": len(reconvergence_nodes),
        "reconvergence_nodes": reconvergence_nodes,
        "removable_depth": max(
            (row["logic_depth_delta"] for row in occurrences), default=0
        ),
        "cut_boundary_input_count": max(
            (row["cut_boundary_input_count"] for row in occurrences), default=0
        ),
        "cut_boundary_output_count": max(
            (row["cut_boundary_output_count"] for row in occurrences), default=0
        ),
        "repeat_support": len(occurrences),
        "non_overlapping_support": len(selected),
        "non_overlapping_occurrence_ids": [row["occurrence_id"] for row in selected],
        "overlap_pairs": overlap_pairs,
        "fanout_count": max(
            (int(vector.get("fanout_count", 0)) for vector in vectors), default=0
        ),
        "load_proxy": max(
            (int(vector.get("load_proxy", 0)) for vector in vectors), default=0
        ),
        "fanout_load_distribution": max(
            (vector.get("fanout_load_distribution", {}) for vector in vectors),
            key=lambda value: (value.get("fanout_count", 0),
                               value.get("successor_indegree_max", 0)),
            default={},
        ),
        "buffer_inverter_pressure": max(
            (vector.get("buffer_inverter_pressure", {}) for vector in vectors),
            key=lambda value: (value.get("one_hop_fraction", 0.0),
                               value.get("one_hop_count", 0)),
            default={},
        ),
        "overlap_count": len(overlap_pairs),
        "overlap_ratio": round(
            len(overlap_pairs) / max(1, len(occurrences)), 6
        ),
        "mapping_feasible": bool(buildable) and all(
            row["counterfactual"]["mapping_feasible"] for row in occurrences
        ),
        "mapping_adoption_status": "not_evaluated",
        "whole_design_mapping": {"status": "not_evaluated"},
        "library_cost": {"new_library_cells": 1, "generation_units": 1},
        "occurrences": [
            {
                key: row[key] for key in (
                    "occurrence_id", "endpoint_family", "baseline_indicator",
                    "baseline_slack_ps", "covered_instance_keys",
                    "cut_region_instance_keys",
                    "logic_depth_before", "logic_depth_after", "logic_depth_delta",
                    "local_break_even_du", "proxy_cell_delay_du",
                    "proxy_frontier_indicator_du",
                ) if key in row
            }
            for row in sorted(occurrences, key=lambda item: item["occurrence_id"])
        ],
    }


def _aggregate_precomputed_influence(rows, buildable):
    vectors = [row["influence_vector"] for row in rows]
    strongest = max(
        vectors,
        key=lambda vector: (
            vector["worst_endpoint_relief_du"],
            vector["negative_slack_mass_coverage_ns"],
            repr(vector.get("path_family_ids", [])),
        ),
    )
    result = dict(strongest)
    result["path_family_ids"] = sorted({
        family for vector in vectors for family in vector.get("path_family_ids", [])
    })
    result["path_family_count"] = len(result["path_family_ids"])
    result["reconvergence_nodes"] = sorted({
        node for vector in vectors for node in vector.get("reconvergence_nodes", [])
    })
    result["reconvergence_node_count"] = len(result["reconvergence_nodes"])
    result["repeat_support"] = len(rows)
    result["non_overlapping_support"] = len({
        (row["module"], tuple(row.get("root_instances", ()))) for row in rows
    })
    result["overlap_count"] = max(0, len(rows) - result["non_overlapping_support"])
    result["overlap_ratio"] = round(result["overlap_count"] / max(1, len(rows)), 6)
    result["mapping_feasible"] = bool(buildable)
    return result


def _route_requests(modules, cells, critical_records, observed_reg2reg, library,
                    delay_units, args):
    single_groups = defaultdict(list)
    multi_groups = defaultdict(list)
    statistics = Counter()
    critical_by_module = {record["module"]: record for record in critical_records}
    for module, instances in modules.items():
        critical = critical_by_module.get(module)
        if not critical:
            continue
        (mapped_eligible, _mapped_drivers, _mapped_loads, mapped_predecessors,
         mapped_successors, mapped_order, _mapped_edges) = _mapped_graph(instances, cells)
        mapped_weights = {
            name: float(delay_units.get(instance.base_type, 1.0))
            for name, instance in mapped_eligible.items()
        }
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
                    mapped_root_region = (
                        _ancestors(seed["mapped_instance"], mapped_predecessors)
                        | {seed["mapped_instance"]}
                    )
                    mapped_origins = sorted({
                        origin for node in _ancestor_nodes(aig, root_literal, leaves)
                        for origin in node_origins.get(node, ())
                        if origin in mapped_root_region
                    } | {seed["mapped_instance"]})
                    cone_delay_by_path = {
                        rank: round(sum(
                            (observed_reg2reg.get(module, {}).get(origin, {})
                             .get("path_increments_ns", {}).get(rank, 0.0))
                            for origin in mapped_origins
                        ), 6)
                        for rank in (seed.get("reg2reg_path_ranks") or [])
                    }
                    occurrence_key = json.dumps([
                        module, seed["mapped_instance"], output_pin,
                        list(ordered_leaves), mapped_origins,
                    ], separators=(",", ":"), sort_keys=True)
                    occurrence_id = "OCC_%s" % hashlib.sha256(
                        occurrence_key.encode("utf-8")
                    ).hexdigest()[:16].upper()
                    counterfactual = _candidate_counterfactual(
                        module, occurrence_id, mapped_origins,
                        seed["mapped_instance"], mapped_eligible,
                        mapped_predecessors, mapped_successors, mapped_order,
                        mapped_weights,
                        cut_boundary_input_count=len(ordered_leaves),
                        cut_boundary_output_count=1,
                    )
                    family_slacks = seed.get("reg2reg_path_family_worst_slacks_ns", {})
                    family_ids = sorted(seed.get("reg2reg_path_family_ids") or [])
                    endpoint_family = min(
                        family_ids,
                        key=lambda family: (
                            family_slacks.get(family) is None,
                            family_slacks.get(family) or 0.0,
                            family,
                        ),
                    ) if family_ids else "relative-internal/%s" % seed["mapped_instance"]
                    baseline_slack = family_slacks.get(endpoint_family)
                    influence = dict(
                        seed["influence_vector"],
                        logic_depth_before=counterfactual["logic_depth_before"],
                        logic_depth_after=counterfactual["logic_depth_after"],
                        removable_depth=counterfactual["logic_depth_delta"],
                        removable_node_count=counterfactual["removable_node_count"],
                        removable_edge_count=counterfactual["removable_edge_count"],
                        cut_boundary_input_count=counterfactual["cut_boundary_input_count"],
                        cut_boundary_output_count=counterfactual["cut_boundary_output_count"],
                        worst_endpoint_relief_du=counterfactual["worst_endpoint_relief_du"],
                        mapping_feasible=counterfactual["mapping_feasible"],
                    )
                    occurrence = {
                        "occurrence_id": occurrence_id,
                        "module": module,
                        "root_instance": seed["mapped_instance"],
                        "root_pin": output_pin,
                        "critical_rank": seed["rank"],
                        "critical_impact_du": seed["impact_du"],
                        "reg2reg_path_hits": seed.get("reg2reg_path_hits"),
                        "reg2reg_increment_ns": seed.get("reg2reg_increment_ns"),
                        "reg2reg_path_ranks": seed.get("reg2reg_path_ranks"),
                        "reg2reg_path_family_count": seed.get("reg2reg_path_family_count"),
                        "endpoint_family": endpoint_family,
                        "baseline_indicator": ({
                            "kind": "observed_reg2reg_worst_slack",
                            "value_ns": baseline_slack,
                        } if baseline_slack is not None else {
                            "kind": "relative_internal_proxy",
                            "value_du": -seed["node_slack_du"],
                        }),
                        "reg2reg_path_family_ids": family_ids,
                        "reg2reg_path_family_support": seed.get("reg2reg_path_family_support"),
                        "reg2reg_beginpoint_families": seed.get("reg2reg_beginpoint_families"),
                        "reg2reg_endpoint_families": seed.get("reg2reg_endpoint_families"),
                        "reg2reg_worst_path_slack_ns": seed.get("reg2reg_worst_path_slack_ns"),
                        "reg2reg_path_family_worst_slacks_ns":
                            seed.get("reg2reg_path_family_worst_slacks_ns", {}),
                        "cut_leaf_nodes": list(ordered_leaves),
                        "mapped_origins": mapped_origins,
                        "mapped_origin_instance_keys":
                            counterfactual["mapped_origin_instance_keys"],
                        "covered_instance_keys": counterfactual["covered_instance_keys"],
                        "cut_region_instance_keys": counterfactual["cut_region_instance_keys"],
                        "observed_cone_delay_by_path_ns": cone_delay_by_path,
                        "observed_cone_delay_upper_ns": max(cone_delay_by_path.values(), default=0.0),
                        "logic_depth_before": counterfactual["logic_depth_before"],
                        "logic_depth_after": counterfactual["logic_depth_after"],
                        "logic_depth_delta": counterfactual["logic_depth_delta"],
                        "removable_node_count": counterfactual["removable_node_count"],
                        "removable_edge_count": counterfactual["removable_edge_count"],
                        "cut_boundary_input_count": counterfactual["cut_boundary_input_count"],
                        "cut_boundary_output_count": counterfactual["cut_boundary_output_count"],
                        "local_break_even_du": counterfactual["local_break_even_du"],
                        "proxy_cell_delay_du": counterfactual["proxy_cell_delay_du"],
                        "proxy_frontier_indicator_du":
                            counterfactual["proxy_frontier_indicator_du"],
                        "influence_vector": influence,
                        "counterfactual": counterfactual,
                    }
                    if baseline_slack is not None:
                        occurrence["baseline_slack_ps"] = round(
                            float(baseline_slack) * 1000.0, 6
                        )
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
                "influence_vector": _aggregate_candidate_influence(
                    [item[1] for item in choices], buildable=False
                ),
            })

    def single_rank(item):
        _key, occurrences = item
        influence = _aggregate_candidate_influence(occurrences)
        structural = influence["structural_metrics"]
        return (
            -structural["levels_removed"],
            -structural["nodes_removed"],
            -structural["edges_removed"],
            structural["cut_width"],
            -structural["reconvergence_coverage"],
            -influence["path_family_count"],
            -influence["negative_slack_mass_coverage_ns"],
            -influence["worst_endpoint_relief_du"],
            min(row["critical_rank"] for row in occurrences),
            -influence["non_overlapping_support"],
            repr(_key),
        )

    single_items = list(single_groups.items())
    if args.objective == "critical_context_pareto":
        single_items = _pareto_order(single_items, lambda item: (
            -_aggregate_candidate_influence(item[1])["removable_node_count"],
            _aggregate_candidate_influence(item[1])["cut_boundary_input_count"],
            -_aggregate_candidate_influence(item[1])["reconvergence_node_count"],
            -_aggregate_candidate_influence(item[1])["path_family_count"],
            -_aggregate_candidate_influence(item[1])["negative_slack_mass_coverage_ns"],
            -_aggregate_candidate_influence(item[1])["worst_endpoint_relief_du"],
            min(row["critical_rank"] for row in item[1]),
            -len({(row["module"], row["root_instance"]) for row in item[1]}),
        ))
    else:
        single_items = sorted(single_items, key=single_rank)

    requests = []
    for index, ((replacement, table, count), occurrences) in enumerate(
        single_items[:args.top], 1
    ):
        aggregate_influence = _aggregate_candidate_influence(occurrences)
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
            "non_overlapping_support": aggregate_influence["non_overlapping_support"],
            "non_overlapping_support_method":
                "deterministic greedy disjoint globally-qualified cut regions",
            "input_count": count,
            "output_count": 1,
            "critical_root_rank": min(row["critical_rank"] for row in occurrences),
            "critical_impact_du": max(row["critical_impact_du"] for row in occurrences),
            "influence_vector": aggregate_influence,
            "counterfactual": max(
                (row["counterfactual"] for row in occurrences),
                key=lambda row: (row["baseline_worst_delay_du"] - row["new_worst_delay_du"],
                                 row["new_worst_endpoint"]),
            ),
            "reg2reg_path_hits": max(row.get("reg2reg_path_hits") or 0 for row in occurrences),
            "reg2reg_increment_ns": max(row.get("reg2reg_increment_ns") or 0.0 for row in occurrences),
            "reg2reg_cone_delay_upper_ns": max(
                (row.get("observed_cone_delay_upper_ns") or 0.0 for row in occurrences), default=0.0),
            "reg2reg_path_family_ids": sorted({
                family for row in occurrences
                for family in (row.get("reg2reg_path_family_ids") or [])
            }),
            "reg2reg_path_family_count": len({
                family for row in occurrences
                for family in (row.get("reg2reg_path_family_ids") or [])
            }),
            "reg2reg_path_family_support": max(
                (row.get("reg2reg_path_family_support") or 0 for row in occurrences), default=0),
            "reg2reg_worst_path_slack_ns": min(
                (row["reg2reg_worst_path_slack_ns"] for row in occurrences
                 if row.get("reg2reg_worst_path_slack_ns") is not None), default=None),
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
            "influence_vector": _aggregate_precomputed_influence(
                occurrences, buildable=False
            ),
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
    parser.add_argument("--liberty-skeleton", type=Path, action="append", required=True)
    parser.add_argument("--full-liberty", type=Path, required=True)
    parser.add_argument("--timing-report", type=Path, required=True)
    parser.add_argument("--expected-top", required=True)
    parser.add_argument("--generated-cell-pattern", required=True)
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
    timing_graph = parse_reg2reg_timing_graph(args.timing_report, args.expected_top, modules)
    observed_reg2reg = timing_graph["instances"]
    critical_records = []
    for module, instances in modules.items():
        record = rank_critical_subgraph(
            module, instances, cells, delay_model["delay_units"],
            top_paths=16, top_seeds=args.max_critical_roots,
            observed_reg2reg=observed_reg2reg.get(module, {}),
            generated_cell_pattern=args.generated_cell_pattern,
        )
        if record:
            critical_records.append(record)
    if not critical_records:
        raise ValueError("Algorithm 1 found no combinational critical subgraph")
    library = mapped_core.library_indexes(cells, args.max_inputs, args.max_outputs)
    requests, statistics = _route_requests(
        modules, cells, critical_records, observed_reg2reg, library,
        delay_model["delay_units"], args
    )
    report = {
        "report_schema": REPORT_SCHEMA,
        "strategy_id": args.strategy_id,
        "source_graph": "mapped",
        "algorithms": list(ALGORITHMS),
        "inputs": {
            "netlist": os.path.abspath(str(args.netlist)),
            "netlist_sha256": _sha256(args.netlist),
            "liberty_function_skeleton": [os.path.abspath(str(path)) for path in args.liberty_skeleton],
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
            "observed_timing_graph": timing_graph["graph"],
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
            "Timing paths are sampled members of a shared reg2reg timing graph; endpoint-family coverage is evidence, not exhaustive graph enumeration.",
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
