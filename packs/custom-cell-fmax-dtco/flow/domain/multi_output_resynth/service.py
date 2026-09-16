"""Versioned request/result service for bounded multi-output logical ECO."""

from __future__ import annotations

import hashlib
import itertools
import json
import resource
import re
import sys
import time
from collections import defaultdict
from pathlib import Path

from cell_need_miner.liberty import parse_skeleton
from verilog_netlist import (
    VerilogNetlistError,
    build_named_net_graph,
    parse_modules,
    top_assign_aliases,
)

from .boolean import eval_ast, format_table
from .netlist_eco import (
    EcoError,
    apply_replacement_groups,
    assert_only_allowed_masters,
    rollback_text,
    sha256_text,
)
from .proof import (
    ProofError,
    prove_hierarchical_equivalence,
    prove_top_equivalence,
)


REQUEST_SCHEMA = "hima.multi-output-resynthesis-request/1"
RESULT_SCHEMA = "hima.multi-output-resynthesis-result/1"


class ResynthesisError(ValueError):
    def __init__(self, code, message, details=None):
        super().__init__(message)
        self.code = code
        self.details = details or {}


def _digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def _bound_path(base, value, label):
    path = Path(value)
    if not path.is_absolute():
        path = base / path
    path = path.resolve()
    if path != base and base not in path.parents:
        raise ResynthesisError("path-outside-workspace", "%s is outside the request workspace" % label)
    if not path.exists():
        raise ResynthesisError("missing-input", "%s does not exist: %s" % (label, path))
    return path


def _validate_hash(path, expected, label):
    actual = _digest(path)
    if not expected or actual != expected:
        raise ResynthesisError(
            "input-hash-mismatch", "%s SHA-256 mismatch" % label,
            {"path": str(path), "expected": expected, "actual": actual},
        )
    return actual


def _validate_request(request, request_path):
    if request.get("schema") != REQUEST_SCHEMA:
        raise ResynthesisError("invalid-request", "unsupported request schema")
    if request.get("operation") not in ("discover", "directed"):
        raise ResynthesisError("invalid-request", "operation must be discover or directed")
    if request.get("action") not in ("analyze", "rewrite"):
        raise ResynthesisError("invalid-request", "action must be analyze or rewrite")
    scope = request.get("scope") or {}
    max_inputs = int(scope.get("maxInputs", 3))
    max_outputs = int(scope.get("maxOutputs", 2))
    if max_inputs > (4 if request.get("operation") == "directed" else 3) or max_outputs > (3 if request.get("operation") == "directed" else 2):
        raise ResynthesisError(
            "unsupported-scope",
            "service supports at most 3 discovered or 4 directed inputs and 2 discovered or 3 directed outputs",
        )
    for required in ("preserveRegisters", "preservePorts", "preserveHierarchy"):
        if scope.get(required) is not True:
            raise ResynthesisError("unsupported-scope", "%s must be true" % required)
    physical = request.get("physicalContext") or {}
    if physical.get("def") is not None:
        raise ResynthesisError(
            "physical-mode-not-implemented",
            "logical POC requires physicalContext.def=null",
        )
    if request["operation"] == "directed" and not request.get("targets"):
        raise ResynthesisError("invalid-request", "directed operation requires targets")
    base = Path(request_path).resolve().parent
    netlist_row = request.get("netlist") or {}
    liberty_row = (request.get("library") or {}).get("liberty") or {}
    netlist = _bound_path(base, netlist_row.get("path", ""), "netlist")
    liberty = _bound_path(base, liberty_row.get("path", ""), "library.liberty")
    netlist_hash = _validate_hash(netlist, netlist_row.get("sha256"), "netlist")
    liberty_hash = _validate_hash(liberty, liberty_row.get("sha256"), "library.liberty")
    output = Path(request.get("outputDir", "out"))
    if not output.is_absolute():
        output = base / output
    output = output.resolve()
    if output != base and base not in output.parents:
        raise ResynthesisError("path-outside-workspace", "outputDir is outside the request workspace")
    return netlist, liberty, output, netlist_hash, liberty_hash


def _directions(cells):
    return {
        name: {
            **{pin: "input" for pin in cell.inputs},
            **{pin: "output" for pin in cell.output_pins},
        }
        for name, cell in cells.items()
    }


def _constant(net):
    compact = net.replace(" ", "").lower()
    if compact in ("1'b0", "1'h0", "0", "1'd0"):
        return False
    if compact in ("1'b1", "1'h1", "1", "1'd1"):
        return True
    return None


def _eval_window(instances, cells, ordered_inputs, ordered_outputs):
    tables = {net: 0 for net in ordered_outputs}
    for assignment in range(1 << len(ordered_inputs)):
        values = {
            net: bool((assignment >> index) & 1)
            for index, net in enumerate(ordered_inputs)
        }
        pending = {instance.name: instance for instance in instances}
        while pending:
            progressed = False
            for name in sorted(tuple(pending)):
                instance = pending[name]
                cell = cells[instance.cell_type]
                env = {}
                ready = True
                for pin in cell.inputs:
                    net = instance.conns[pin]
                    const = _constant(net)
                    if const is not None:
                        env[pin] = const
                    elif net in values:
                        env[pin] = values[net]
                    else:
                        ready = False
                        break
                if not ready:
                    continue
                for pin, ast in cell.outputs.items():
                    if ast is None:
                        raise ResynthesisError(
                            "unparseable-function",
                            "cell %s output %s has no parseable function" % (cell.name, pin),
                        )
                    values[instance.conns[pin]] = eval_ast(ast, env)
                del pending[name]
                progressed = True
            if not progressed:
                raise ResynthesisError(
                    "cyclic-or-incomplete-window",
                    "target window is cyclic or depends on an undeclared input",
                    {"pendingInstances": sorted(pending)},
                )
        for net in ordered_outputs:
            if net not in values:
                raise ResynthesisError("incomplete-window", "window does not drive %s" % net)
            if values[net]:
                tables[net] |= 1 << assignment
    return tables


def _top_output_nets(text, top):
    """Read scalar output identities from ANSI and body declarations."""
    body = None
    for match in re.finditer(r"(?ms)^\s*module\s+(\S+?)\b(.*?)^\s*endmodule", text):
        if match.group(1) == top:
            body = match.group(2)
            break
    if body is None:
        return ()
    outputs = set()
    # Structural DC netlists normally use scalar declarations.  A bit-select is
    # preserved when a packed range is present so boundary identity is exact.
    for match in re.finditer(
        r"\boutput\b\s*(?:wire|logic|reg)?\s*(\[[^\]]+\])?\s*([^;\)]*)[;\)]",
        body,
    ):
        width, names = match.groups()
        for raw in names.split(","):
            name = raw.strip().split("=")[0].strip()
            if not name or re.search(r"\s", name):
                continue
            if width:
                bounds = re.findall(r"\d+", width)
                if len(bounds) == 2:
                    lo, hi = sorted(map(int, bounds))
                    outputs.update("%s[%d]" % (name, bit) for bit in range(lo, hi + 1))
                    continue
            outputs.add(name)
    return tuple(sorted(outputs))


def _module_pin_directions(text, module):
    """Return raw module port directions for hierarchical graph construction."""
    body = None
    for match in re.finditer(r"(?ms)^\s*module\s+(\S+?)\b(.*?)^\s*endmodule", text):
        if match.group(1) == module:
            body = match.group(2)
            break
    if body is None:
        return {}
    result = {}
    for match in re.finditer(
        r"\b(input|output|inout)\b\s*(?:wire|logic|reg)?\s*(?:\[[^\]]+\])?\s*([^;\)]*)[;\)]",
        body,
    ):
        direction, names = match.groups()
        for raw in names.split(","):
            name = raw.strip().split("=")[0].strip()
            if name and not re.search(r"\s", name):
                result[name] = direction
    return result


def _derive_boundary(graph, source_names, top_output_nets=()):
    selected = set(source_names)
    inputs = set()
    outputs = set()
    internal = set()
    for name in selected:
        instance = graph.instances[name]
        for pin, net in instance.conns.items():
            direction = "output" if graph.drivers.get(net) and graph.drivers[net].instance == name and graph.drivers[net].pin == pin else "input"
            if direction == "input":
                driver = graph.drivers.get(net)
                if driver is None or driver.instance not in selected:
                    inputs.add(net)
            else:
                outside = any(sink.instance not in selected for sink in graph.sinks.get(net, ()))
                if outside or net in top_output_nets or not graph.sinks.get(net):
                    outputs.add(net)
                else:
                    internal.add(net)
    return tuple(sorted(inputs)), tuple(sorted(outputs)), tuple(sorted(internal))


def _match_master(cells, allowed, boundary_inputs, boundary_outputs, observed_tables):
    matches = []
    for name in sorted(allowed):
        cell = cells.get(name)
        if cell is None or cell.is_seq or len(cell.outputs) != len(boundary_outputs):
            continue
        if len(cell.inputs) != len(boundary_inputs) or len(cell.outputs) > 3:
            continue
        for input_nets in itertools.permutations(boundary_inputs):
            pin_to_net = dict(zip(cell.inputs, input_nets))
            master_tables = {}
            for output_pin, ast in cell.outputs.items():
                table = 0
                for assignment in range(1 << len(boundary_inputs)):
                    values = {
                        pin: bool((assignment >> boundary_inputs.index(net)) & 1)
                        for pin, net in pin_to_net.items()
                    }
                    if eval_ast(ast, values):
                        table |= 1 << assignment
                master_tables[output_pin] = table
            for output_nets in itertools.permutations(boundary_outputs):
                output_map = dict(zip(cell.outputs, output_nets))
                if all(master_tables[pin] == observed_tables[net] for pin, net in output_map.items()):
                    matches.append((cell, pin_to_net, output_map, master_tables))
    return matches[0] if matches else None


def _opportunity_id(module, instances, master, inputs, outputs):
    canonical = json.dumps([module, sorted(instances), master, list(inputs), list(outputs)])
    return "mo-" + hashlib.sha256(canonical.encode()).hexdigest()[:16]


def _make_opportunity(
    module, instances, graph, cells, allowed, expected_inputs=None,
    expected_outputs=None, top_outputs=(), maximum_inputs=3, maximum_outputs=2,
):
    missing = sorted(set(instances) - set(graph.instances))
    if missing:
        raise ResynthesisError("target-instance-missing", "target instances absent", {"instances": missing})
    boundary_inputs, boundary_outputs, internal = _derive_boundary(graph, instances, top_outputs)
    if expected_inputs is not None and tuple(expected_inputs) != boundary_inputs:
        raise ResynthesisError(
            "target-boundary-mismatch", "target input boundary differs from request",
            {"expected": list(expected_inputs), "actual": list(boundary_inputs)},
        )
    if expected_outputs is not None and tuple(expected_outputs) != boundary_outputs:
        raise ResynthesisError(
            "target-boundary-mismatch", "target output boundary differs from request",
            {"expected": list(expected_outputs), "actual": list(boundary_outputs)},
        )
    if len(boundary_inputs) > maximum_inputs or not (1 <= len(boundary_outputs) <= maximum_outputs):
        raise ResynthesisError(
            "target-boundary-unsupported",
            "target must have <=%d inputs and no more than %d outputs"
            % (maximum_inputs, maximum_outputs),
            {"inputs": list(boundary_inputs), "outputs": list(boundary_outputs)},
        )
    source = [graph.instances[name] for name in sorted(instances)]
    observed = _eval_window(source, cells, boundary_inputs, boundary_outputs)
    match = _match_master(cells, allowed, boundary_inputs, boundary_outputs, observed)
    if match is None:
        raise ResynthesisError(
            "no-library-vector-match", "no allowed Library master matches the target truth vector",
            {"inputs": list(boundary_inputs), "outputs": {key: format_table(value, len(boundary_inputs)) for key, value in observed.items()}},
        )
    cell, input_map, output_map, master_tables = match
    identifier = _opportunity_id(module, instances, cell.name, boundary_inputs, boundary_outputs)
    return {
        "opportunityId": identifier,
        "module": module,
        "sourceInstances": sorted(instances),
        "sourceNets": sorted(set(internal).union(boundary_outputs)),
        "orderedLeaves": list(boundary_inputs),
        "roots": list(boundary_outputs),
        "truthTables": {key: format_table(value, len(boundary_inputs)) for key, value in observed.items()},
        "master": cell.name,
        "inputPinToNet": input_map,
        "outputPinToNet": output_map,
        "replacementInstance": "HIMA_MO_" + identifier[3:],
        "removedCellCount": len(instances),
        "removedInternalNetCount": len(internal),
        "masterArea": cell.area,
        "windowProof": {
            "status": "proved",
            "method": "exhaustive-truth-vector",
            "assignments": 1 << len(boundary_inputs),
            "masterTruthTables": {key: format_table(value, len(boundary_inputs)) for key, value in master_tables.items()},
        },
        "locality": {"status": "unknown", "reason": "no physicalContext.def"},
        "claimLimits": {"commercialTiming": False, "physicalBenefit": False, "fmaxImprovement": False},
    }


def _directed(request, graphs, cells, allowed, module_outputs):
    opportunities = []
    maximum_outputs = int((request.get("scope") or {}).get("maxOutputs", 2))
    maximum_inputs = int((request.get("scope") or {}).get("maxInputs", 3))
    for target in request.get("targets", ()):
        module = target.get("module")
        if module not in graphs:
            raise ResynthesisError("target-module-missing", "target module %s is not available" % module)
        opportunities.append(_make_opportunity(
            module, target.get("instances") or (), graphs[module], cells, allowed,
            tuple(sorted(target.get("expectedBoundaryInputs") or ())),
            tuple(sorted(target.get("expectedBoundaryOutputs") or ())),
            module_outputs[module], maximum_inputs,
            maximum_outputs,
        ))
    return opportunities, {"cuts": 0, "leafBuckets": 0, "hashHits": 0, "pairChecks": 0, "bucketOverflows": []}


def _cone_value(net, leaves, assignment, graph, cells, memo, visiting):
    if net in leaves:
        return bool((assignment >> leaves.index(net)) & 1)
    const = _constant(net)
    if const is not None:
        return const
    key = (net, leaves, assignment)
    if key in memo:
        return memo[key]
    driver = graph.drivers.get(net)
    if driver is None:
        raise ResynthesisError("cut-input-missing", "cut does not contain undriven net %s" % net)
    if net in visiting:
        raise ResynthesisError("combinational-cycle", "combinational cycle reaches %s" % net)
    instance = graph.instances[driver.instance]
    cell = cells[instance.cell_type]
    if cell.is_seq:
        raise ResynthesisError("cut-crosses-register", "cut crosses sequential cell %s" % instance.name)
    ast = cell.outputs.get(driver.pin)
    if ast is None:
        raise ResynthesisError("unparseable-function", "cell %s pin %s has no function" % (cell.name, driver.pin))
    visiting.add(net)
    env = {
        pin: _cone_value(instance.conns[pin], leaves, assignment, graph, cells, memo, visiting)
        for pin in cell.inputs
    }
    visiting.remove(net)
    value = eval_ast(ast, env)
    memo[key] = value
    return value


def _bounded_cuts(net, graph, cells, maximum_inputs, maximum_cuts, cache, active):
    """Enumerate deterministic K-feasible cuts with source-instance provenance."""
    if net in cache:
        return cache[net]
    const = _constant(net)
    if const is not None:
        row = ({"leaves": (), "table": 1 if const else 0, "instances": frozenset()},)
        cache[net] = row
        return row
    if net in active:
        raise ResynthesisError("combinational-cycle", "combinational cycle reaches %s" % net)
    driver = graph.drivers.get(net)
    trivial = {"leaves": (net,), "table": 0x2, "instances": frozenset()}
    if driver is None:
        cache[net] = (trivial,)
        return cache[net]
    instance = graph.instances[driver.instance]
    cell = cells[instance.cell_type]
    if cell.is_seq or len(cell.outputs) != 1:
        cache[net] = (trivial,)
        return cache[net]
    active.add(net)
    fanin_cuts = [
        _bounded_cuts(instance.conns[pin], graph, cells, maximum_inputs, maximum_cuts, cache, active)
        for pin in cell.inputs
    ]
    active.remove(net)
    rows = [trivial]
    for combination in itertools.product(*fanin_cuts):
        leaves = tuple(sorted(set().union(*(set(row["leaves"]) for row in combination))))
        if len(leaves) > maximum_inputs or net in leaves:
            continue
        table = 0
        value_cache = {}
        for assignment in range(1 << len(leaves)):
            if _cone_value(net, leaves, assignment, graph, cells, value_cache, set()):
                table |= 1 << assignment
        rows.append({
            "leaves": leaves,
            "table": table,
            "instances": frozenset().union(*(row["instances"] for row in combination), {instance.name}),
        })
    unique = {}
    for row in rows:
        key = (row["leaves"], row["table"])
        current = unique.get(key)
        if current is None or (len(row["instances"]), sorted(row["instances"])) < (
            len(current["instances"]), sorted(current["instances"])
        ):
            unique[key] = row
    ordered = sorted(
        unique.values(),
        key=lambda row: (len(row["leaves"]), row["leaves"], row["table"], len(row["instances"])),
    )[:maximum_cuts]
    cache[net] = tuple(ordered)
    return cache[net]


def _discover_module(request, module, graph, cells, allowed, top_outputs):
    """Bounded multi-level cut index; never enumerates all root pairs."""
    scope = request.get("scope") or {}
    max_bucket = int(scope.get("maxBucketSize", 256))
    max_inputs = int(scope.get("maxInputs", 3))
    max_cuts = int(scope.get("maxCutsPerRoot", 32))
    candidates = set()
    support_buckets = defaultdict(lambda: defaultdict(list))
    cut_cache = {}
    cut_count = 0
    for root, driver in sorted(graph.drivers.items()):
        cell = cells[driver.cell_type]
        if cell.is_seq or len(cell.outputs) != 1:
            continue
        cuts = _bounded_cuts(root, graph, cells, max_inputs, max_cuts, cut_cache, set())
        for cut in cuts:
            if not cut["instances"]:  # the trivial root cut is not an opportunity
                continue
            cut_count += 1
            support_buckets[cut["leaves"]][cut["table"]].append({
                "root": root,
                "instances": cut["instances"],
            })
    overflows = []
    pair_checks = 0
    for support, function_buckets in sorted(support_buckets.items()):
        size = sum(len(names) for names in function_buckets.values())
        if size > max_bucket:
            overflows.append({"orderedLeaves": list(support), "size": size, "limit": max_bucket})
            continue
        admitted_pairs = set()
        for master_name in sorted(allowed):
            master = cells[master_name]
            if len(master.inputs) != len(support) or len(master.outputs) != 2:
                continue
            for input_nets in itertools.permutations(support):
                pin_to_net = dict(zip(master.inputs, input_nets))
                tables = []
                for ast in master.outputs.values():
                    table = 0
                    for assignment in range(1 << len(support)):
                        env = {
                            pin: bool((assignment >> support.index(net)) & 1)
                            for pin, net in pin_to_net.items()
                        }
                        if eval_ast(ast, env):
                            table |= 1 << assignment
                    tables.append(table)
                admitted_pairs.add(tuple(sorted(tables)))
        for left_table, right_table in sorted(admitted_pairs):
            left_rows = function_buckets.get(left_table, ())
            right_rows = function_buckets.get(right_table, ())
            pair_checks += len(left_rows) * len(right_rows)
            for left in left_rows:
                for right in right_rows:
                    if left["root"] == right["root"]:
                        continue
                    instances = tuple(sorted(set(left["instances"]).union(right["instances"])))
                    candidates.add(instances)
    opportunities = []
    refusals = []
    for cluster in sorted(candidates):
        try:
            opportunities.append(_make_opportunity(
                module, cluster, graph, cells, allowed, top_outputs=top_outputs,
                maximum_inputs=max_inputs, maximum_outputs=2,
            ))
        except ResynthesisError as error:
            refusals.append({"instances": list(cluster), "code": error.code})
    stats = {
        "cuts": cut_count,
        "leafBuckets": len(support_buckets),
        "hashHits": len(candidates),
        "pairChecks": pair_checks,
        "bucketOverflows": overflows,
        "candidateRefusals": refusals[:100],
        "maxCutsPerRoot": max_cuts,
        "parallelWorkers": 1,
    }
    return opportunities, stats


def _discover(request, graphs, cells, allowed, module_outputs):
    opportunities = []
    totals = {
        "cuts": 0,
        "leafBuckets": 0,
        "hashHits": 0,
        "pairChecks": 0,
        "bucketOverflows": [],
        "candidateRefusals": [],
        "maxCutsPerRoot": int((request.get("scope") or {}).get("maxCutsPerRoot", 32)),
        "parallelWorkers": 1,
        "modules": [],
    }
    for module in sorted(graphs):
        found, stats = _discover_module(
            request, module, graphs[module], cells, allowed, module_outputs[module]
        )
        opportunities.extend(found)
        totals["modules"].append({
            "module": module,
            "cuts": stats["cuts"],
            "leafBuckets": stats["leafBuckets"],
            "hashHits": stats["hashHits"],
            "pairChecks": stats["pairChecks"],
        })
        for key in ("cuts", "leafBuckets", "hashHits", "pairChecks"):
            totals[key] += stats[key]
        totals["bucketOverflows"].extend(stats["bucketOverflows"])
        totals["candidateRefusals"].extend(stats["candidateRefusals"])
    totals["candidateRefusals"] = totals["candidateRefusals"][:100]
    return opportunities, totals


def _select(opportunities, maximum, selected_ids=None):
    occupied = set()
    selected = []
    by_id = {row["opportunityId"]: row for row in opportunities}
    if selected_ids is not None:
        if (not isinstance(selected_ids, list) or not selected_ids
                or any(not isinstance(value, str) for value in selected_ids)
                or len(set(selected_ids)) != len(selected_ids)):
            raise ResynthesisError("invalid-request", "selectedOpportunityIds must be unique strings")
        missing = sorted(set(selected_ids) - set(by_id))
        if missing:
            raise ResynthesisError(
                "selected-opportunity-missing",
                "the Action Portfolio names opportunities absent from this bound input",
                {"opportunityIds": missing},
            )
        ranked = [by_id[value] for value in selected_ids]
    else:
        ranked = sorted(
            opportunities,
            key=lambda row: (-row["removedCellCount"], -row["removedInternalNetCount"], row["masterArea"], row["opportunityId"]),
        )
    for row in ranked:
        if len(selected) >= maximum:
            break
        source = {
            (row["module"], instance)
            for instance in row["sourceInstances"]
        }
        if source.intersection(occupied):
            if selected_ids is not None:
                raise ResynthesisError(
                    "selected-opportunity-conflict",
                    "the Action Portfolio contains overlapping source instances",
                    {"opportunityId": row["opportunityId"]},
                )
            continue
        occupied.update(source)
        selected.append(row)
    return selected


def _result_base(netlist_hash, elapsed_ms, opportunities, selected, stats):
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if sys.platform == "darwin":
        rss //= 1024
    return {
        "schema": RESULT_SCHEMA,
        "status": "succeeded",
        "inputNetlistSha256": netlist_hash,
        "rewrittenNetlist": None,
        "patchManifest": None,
        "equivalenceProof": None,
        "opportunities": opportunities,
        "selectedReplacements": selected,
        "mapping": {
            "area": sum(row["masterArea"] for row in selected),
            "delayIndicator": None,
            "multioutputGates": len(selected),
            "runtimeMs": elapsed_ms,
            "peakRssKb": rss,
            **stats,
        },
        "claimLimits": {"commercialTiming": False, "physicalBenefit": False, "fmaxImprovement": False},
    }


def run_request(request_path, result_path):
    started = time.monotonic()
    request_path = Path(request_path).resolve()
    result_path = Path(result_path).resolve()
    request = json.loads(request_path.read_text())
    output = None
    try:
        netlist, liberty, output, netlist_hash, _liberty_hash = _validate_request(request, request_path)
        output.mkdir(parents=True, exist_ok=True)
        cells = parse_skeleton(str(liberty))
        allowed = tuple((request.get("library") or {}).get("allowedMultiOutputMasters") or ())
        unknown = sorted(set(allowed) - set(cells))
        if unknown:
            raise ResynthesisError("unknown-library-master", "allowed masters missing from Liberty", {"masters": unknown})
        text = netlist.read_text()
        modules = parse_modules(text)
        if request["top"] not in modules:
            raise ResynthesisError("missing-top", "netlist has no top module %s" % request["top"])
        if request["operation"] == "directed":
            subject_modules = sorted({target.get("module") for target in request.get("targets", ())})
        else:
            subject_modules = list((request.get("scope") or {}).get("modules") or [request["top"]])
        missing_modules = sorted(set(subject_modules) - set(modules))
        if missing_modules:
            raise ResynthesisError(
                "target-module-missing", "netlist is missing subject modules",
                {"modules": missing_modules},
            )
        directions = _directions(cells)
        directions.update({module: _module_pin_directions(text, module) for module in modules})
        graphs = {
            module: build_named_net_graph(
                modules[module], directions, top_assign_aliases(text, module)
            )
            for module in subject_modules
        }
        module_outputs = {
            module: _top_output_nets(text, module) for module in subject_modules
        }
        if request["operation"] == "directed":
            opportunities, stats = _directed(request, graphs, cells, allowed, module_outputs)
        else:
            opportunities, stats = _discover(request, graphs, cells, allowed, module_outputs)
        maximum = int((request.get("scope") or {}).get("maxReplacements", 50))
        selected = _select(opportunities, maximum, request.get("selectedOpportunityIds"))
        result = _result_base(
            netlist_hash, round((time.monotonic() - started) * 1000, 3), opportunities, selected, stats
        )
        if request["action"] == "rewrite":
            if not selected:
                rewritten = text
                manifest = {
                    "schema": "hima.multi-output-eco-patches/1", "top": request["top"],
                    "originalSha256": netlist_hash, "rewrittenSha256": netlist_hash, "edits": [],
                }
                proof = {"schema": "hima.multi-output-equivalence-proof/1", "backend": "identity-sha256", "status": "proved"}
            else:
                selected_modules = sorted({row["module"] for row in selected})
                rewritten, manifest = apply_replacement_groups(text, selected)
                for subject_module in selected_modules:
                    assert_only_allowed_masters(rewritten, subject_module, set(allowed))
                if sha256_text(rollback_text(rewritten, manifest)) != netlist_hash:
                    raise ResynthesisError("rollback-proof-failed", "patch rollback did not reconstruct input")
                candidate = output / "rewritten.candidate.v"
                candidate.write_text(rewritten)
                proof_args = {
                    "yosys": ((request.get("tools") or {}).get("yosys") or "yosys"),
                    "timeout": int((request.get("tools") or {}).get("proofTimeoutSeconds", 120)),
                }
                top = request["top"]
                top_has_sequential_boundaries = any(
                    cells.get(instance.base_type) is not None
                    and cells[instance.base_type].is_seq
                    for instance in modules[top]
                )
                leaf_modules = [module for module in selected_modules if module != top]
                if top in selected_modules and top_has_sequential_boundaries:
                    leaf_proof = (
                        prove_hierarchical_equivalence(
                            netlist, candidate, top, leaf_modules,
                            cells, output / "proof", allowed_changed_modules=(top,),
                            **proof_args,
                        ) if leaf_modules else None
                    )
                    top_windows = [row["windowProof"] for row in selected if row["module"] == top]
                    proof = {
                        "schema": "hima.multi-output-equivalence-proof/1",
                        "backend": "yosys-hierarchical-plus-exhaustive-top-windows",
                        "status": "proved" if (
                            (leaf_proof is None or leaf_proof.get("status") == "proved")
                            and top_windows
                            and all(row.get("status") == "proved" for row in top_windows)
                        ) else "failed",
                        "top": top,
                        "leafProof": leaf_proof,
                        "topWindowProofs": top_windows,
                        "compositionClaim": (
                            "Every changed combinational leaf is Yosys-equivalent; each top-level "
                            "replacement is exhaustively truth-vector equivalent at the exact "
                            "boundary; the structural patch and byte-exact rollback bind those "
                            "local proofs into the unchanged sequential design."
                        ),
                    }
                    if proof["status"] != "proved":
                        raise ProofError("mixed hierarchical/window equivalence failed")
                elif top in selected_modules:
                    proof = prove_top_equivalence(
                        netlist, candidate, top, cells, output / "proof", **proof_args,
                    )
                else:
                    proof = prove_hierarchical_equivalence(
                        netlist, candidate, top, leaf_modules,
                        cells, output / "proof", **proof_args,
                    )
            rewritten_path = output / "rewritten.v"
            patch_path = output / "patches.json"
            proof_path = output / "equivalence.json"
            rewritten_path.write_text(rewritten)
            _write_json(patch_path, manifest)
            _write_json(proof_path, proof)
            result["rewrittenNetlist"] = {"path": str(rewritten_path), "sha256": _digest(rewritten_path)}
            result["patchManifest"] = {"path": str(patch_path), "sha256": _digest(patch_path)}
            result["equivalenceProof"] = {"path": str(proof_path), "sha256": _digest(proof_path)}
        result["mapping"]["runtimeMs"] = round((time.monotonic() - started) * 1000, 3)
        result_path.parent.mkdir(parents=True, exist_ok=True)
        _write_json(result_path, result)
        return result
    except (
        ResynthesisError,
        EcoError,
        ProofError,
        VerilogNetlistError,
        KeyError,
        OSError,
        TypeError,
        json.JSONDecodeError,
    ) as error:
        code = error.code if isinstance(error, ResynthesisError) else type(error).__name__
        details = error.details if isinstance(error, ResynthesisError) else {}
        result = {
            "schema": RESULT_SCHEMA,
            "status": "refused",
            "refusal": {"code": code, "message": str(error), "details": details},
            "rewrittenNetlist": None,
            "patchManifest": None,
            "equivalenceProof": None,
            "claimLimits": {"commercialTiming": False, "physicalBenefit": False, "fmaxImprovement": False},
        }
        result_path.parent.mkdir(parents=True, exist_ok=True)
        _write_json(result_path, result)
        return result
