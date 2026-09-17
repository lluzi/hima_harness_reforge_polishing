#!/usr/bin/env python3
"""Build mock timing tables relative to the source cover over the full NLDM grid.

This is a deliberate optimistic mock for commercial calibration, not measured
characterization.  A two-cell/simple merge targets 5% delay reduction; a
larger cover targets 10%.  The candidate table is only scaled faster and the
most restrictive ratio over all selected Actions/arcs/grid points wins.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from cell_need_miner.liberty import parse_skeleton  # noqa: E402
from cell_need_miner.liberty_timing import (  # noqa: E402
    LibertyTimingError,
    evaluate_timing_arc_transitions,
    parse_liberty_timing,
)
from verilog_netlist import build_named_net_graph, parse_modules, top_assign_aliases  # noqa: E402
from multi_output_resynth.service import _module_pin_directions  # noqa: E402


class RelativeMockError(ValueError):
    pass


def _matching_brace(text, opening):
    depth = 0
    quote = False
    escaped = False
    for index in range(opening, len(text)):
        char = text[index]
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                quote = False
            continue
        if char == '"':
            quote = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index + 1
    raise RelativeMockError("unbalanced Liberty group")


def _group_span(text, keyword, name):
    pattern = re.compile(r"\b%s\s*\(\s*\"?%s\"?\s*\)\s*\{" % (
        re.escape(keyword), re.escape(name)))
    matches = list(pattern.finditer(text))
    if len(matches) != 1:
        raise RelativeMockError("expected one %s(%s), found %d" % (keyword, name, len(matches)))
    start = matches[0].start()
    opening = text.find("{", matches[0].start(), matches[0].end())
    return start, _matching_brace(text, opening)


def _scale_values(group, factor):
    values = re.search(r"(?s)\bvalues\s*\((.*?)\)\s*;", group)
    if values is None:
        raise RelativeMockError("NLDM table has no values")
    body = values.group(1)
    number = re.compile(r"(?<![A-Za-z_])[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?")
    scaled = number.sub(lambda match: "%.9g" % (float(match.group(0)) * factor), body)
    return group[:values.start(1)] + scaled + group[values.end(1):]


def scale_cell_tables(liberty_text, factors):
    edits = []
    for cell, factor in factors.items():
        start, end = _group_span(liberty_text, "cell", cell)
        block = liberty_text[start:end]
        for match in re.finditer(r"\b(cell_rise|cell_fall|rise_transition|fall_transition)\s*\([^)]*\)\s*\{", block):
            table_start = start + match.start()
            opening = liberty_text.find("{", start + match.start(), start + match.end())
            table_end = _matching_brace(liberty_text, opening)
            edits.append((table_start, table_end,
                          _scale_values(liberty_text[table_start:table_end], factor)))
        marker = "\n        /* Hima relative-cover mock: full-grid scale %.9g; not measured characterization. */" % factor
        first_brace = liberty_text.find("{", start, end) + 1
        edits.append((first_brace, first_brace, marker))
    output = liberty_text
    for start, end, replacement in sorted(edits, reverse=True):
        output = output[:start] + replacement + output[end:]
    return output


def _replace_values_grid(group, grid):
    values = re.search(r"(?s)\bvalues\s*\((.*?)\)\s*;", group)
    if values is None:
        raise RelativeMockError("NLDM table has no values")
    flattened = iter(value for row in grid for value in row)
    count = 0
    number = re.compile(r"(?<![A-Za-z_])[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?")

    def replace(_match):
        nonlocal count
        try:
            value = next(flattened)
        except StopIteration as exc:
            raise RelativeMockError("replacement grid is smaller than Liberty values") from exc
        count += 1
        return "%.9g" % value

    body = number.sub(replace, values.group(1))
    try:
        next(flattened)
        raise RelativeMockError("replacement grid is larger than Liberty values")
    except StopIteration:
        pass
    return group[:values.start(1)] + body + group[values.end(1):]


def _named_group_spans(text, keyword, start, end):
    pattern = re.compile(r"\b%s\s*\(\s*\"?([^\")]*?)\"?\s*\)\s*\{" % re.escape(keyword))
    rows = []
    for match in pattern.finditer(text, start, end):
        opening = text.find("{", match.start(), match.end())
        closing = _matching_brace(text, opening)
        if closing <= end:
            rows.append((match.group(1).strip(), match.start(), closing))
    return rows


def replace_arc_tables(liberty_text, overrides):
    """Replace generated timing tables keyed by (master, out, in, table)."""
    edits = []
    by_master = {}
    for (master, output_pin, input_pin, table_name), grid in overrides.items():
        by_master.setdefault(master, []).append((output_pin, input_pin, table_name, grid))
    for master, rows in by_master.items():
        cell_start, cell_end = _group_span(liberty_text, "cell", master)
        pins = _named_group_spans(liberty_text, "pin", cell_start, cell_end)
        for output_pin, input_pin, table_name, grid in rows:
            pin_rows = [row for row in pins if row[0] == output_pin]
            if len(pin_rows) != 1:
                raise RelativeMockError("expected one output pin %s/%s" % (master, output_pin))
            _pin, pin_start, pin_end = pin_rows[0]
            timing_rows = _named_group_spans(liberty_text, "timing", pin_start, pin_end)
            matches = []
            for _name, timing_start, timing_end in timing_rows:
                body = liberty_text[timing_start:timing_end]
                related = re.search(r'\brelated_pin\s*:\s*"([^"]+)"', body)
                if related and related.group(1) == input_pin:
                    matches.append((timing_start, timing_end))
            if len(matches) != 1:
                raise RelativeMockError("expected one timing arc %s:%s->%s" %
                                        (master, input_pin, output_pin))
            timing_start, timing_end = matches[0]
            table_pattern = re.compile(r"\b%s\s*\([^)]*\)\s*\{" % re.escape(table_name))
            table_matches = list(table_pattern.finditer(liberty_text, timing_start, timing_end))
            if len(table_matches) != 1:
                raise RelativeMockError("expected one %s table for %s:%s->%s" %
                                        (table_name, master, input_pin, output_pin))
            opening = liberty_text.find("{", table_matches[0].start(), table_matches[0].end())
            table_end = _matching_brace(liberty_text, opening)
            edits.append((table_matches[0].start(), table_end,
                          _replace_values_grid(
                              liberty_text[table_matches[0].start():table_end], grid)))
        marker = "\n        /* Hima relative-cover mock: per-grid source-cover target; not measured characterization. */"
        first_brace = liberty_text.find("{", cell_start, cell_end) + 1
        edits.append((first_brace, first_brace, marker))
    output = liberty_text
    for start, end, replacement in sorted(edits, reverse=True):
        output = output[:start] + replacement + output[end:]
    return output


def _directions(cells):
    return {name: {**{pin: "input" for pin in cell.inputs},
                   **{pin: "output" for pin in cell.output_pins}}
            for name, cell in cells.items()}


def _source_paths(graph, timing_model, source_names, input_net, output_net):
    source = set(source_names)
    cache = {}

    def walk(net, active):
        if net == input_net:
            return [()]
        if net in cache:
            return cache[net]
        if net in active:
            raise RelativeMockError("source cover contains a combinational cycle")
        driver = graph.drivers.get(net)
        if driver is None or driver.instance not in source:
            return []
        instance = graph.instances[driver.instance]
        cell = timing_model.cell(instance.cell_type)
        rows = []
        for pin, direction in cell.pin_directions.items():
            if direction != "input" or pin not in instance.conns:
                continue
            for prefix in walk(instance.conns[pin], active | {net}):
                rows.append(prefix + ((instance.name, instance.cell_type, pin,
                                       driver.pin, net),))
        cache[net] = rows
        return rows

    paths = walk(output_net, set())
    if not paths:
        raise RelativeMockError("no source-cover path from %s to %s" % (input_net, output_net))
    return paths


def _stage_load(graph, timing_model, source_names, output_net, external_load):
    sinks = [item for item in graph.sinks.get(output_net, ()) if item.instance in source_names]
    if not sinks:
        return float(external_load)
    return sum(timing_model.input_capacitance(graph.instances[item.instance].cell_type, item.pin)
               for item in sinks)


def _path_delay_by_transition(path, graph, timing_model, source_names,
                              initial_transition, initial_slew, external_load):
    states = [(initial_transition, float(initial_slew), 0.0)]
    for _instance_name, cell_name, input_pin, output_pin, output_net in path:
        load = _stage_load(graph, timing_model, source_names, output_net, external_load)
        updated = []
        for transition, slew, delay in states:
            for arc in evaluate_timing_arc_transitions(
                    timing_model, cell_name, input_pin, output_pin,
                    transition, slew, load):
                updated.append((arc.output_transition, arc.output_slew.value,
                                delay + arc.delay.value))
        states = updated
    result = {}
    for transition, slew, delay in states:
        row = result.setdefault(transition, {"delay": -math.inf, "slew": -math.inf})
        row["delay"] = max(delay, row["delay"])
        row["slew"] = max(slew, row["slew"])
    return result


def derive_master_factors(netlist_text, merged_liberty, resynthesis_result):
    if resynthesis_result.get("status") != "succeeded":
        raise RelativeMockError("resynthesis result did not succeed")
    opportunities = resynthesis_result.get("selectedReplacements") or []
    if not opportunities:
        raise RelativeMockError("resynthesis result has no selected replacements")
    modules = parse_modules(netlist_text)
    candidate_masters = {row["master"] for row in opportunities}
    required = set(candidate_masters)
    for row in opportunities:
        by_name = {instance.name: instance for instance in modules[row["module"]]}
        missing = sorted(set(row["sourceInstances"]) - set(by_name))
        if missing:
            raise RelativeMockError("source instances disappeared: %s" % missing)
        required.update(by_name[name].cell_type for name in row["sourceInstances"])
    skeleton = parse_skeleton(str(merged_liberty))
    timing = parse_liberty_timing(str(merged_liberty), required_cells=required)
    directions = _directions(skeleton)
    directions.update({module: _module_pin_directions(netlist_text, module)
                       for module in modules})
    graphs = {
        module: build_named_net_graph(instances, directions,
                                      top_assign_aliases(netlist_text, module),
                                      allow_missing_inputs_for=set(modules))
        for module, instances in modules.items() if any(row["module"] == module for row in opportunities)
    }
    overrides = {}
    evidence = []
    for row in opportunities:
        graph = graphs[row["module"]]
        source_names = set(row["sourceInstances"])
        gain = 0.05 if row["removedCellCount"] <= 2 else 0.10
        master = timing.cell(row["master"])
        arc_evidence = []
        for input_pin, input_net in row["inputPinToNet"].items():
            for output_pin, output_net in row["outputPinToNet"].items():
                candidate_arcs = master.arcs
                matching = [arc for arc in candidate_arcs
                            if arc.related_pin == input_pin and arc.to_pin == output_pin]
                if not matching:
                    continue
                paths = _source_paths(graph, timing, source_names, input_net, output_net)
                for candidate_arc in matching:
                    for table_name, output_transition in (("cell_rise", "rise"),
                                                          ("cell_fall", "fall")):
                        table = candidate_arc.tables[table_name]
                        delay_grid = []
                        slew_grid = []
                        transition_name = ("rise_transition" if output_transition == "rise"
                                           else "fall_transition")
                        transition_table = candidate_arc.tables[transition_name]
                        for slew in table.index_1:
                            delay_row = []
                            slew_row = []
                            for load in table.index_2:
                                source_delays = []
                                source_slews = []
                                for path in paths:
                                    for initial_transition in ("rise", "fall"):
                                        result = _path_delay_by_transition(
                                            path, graph, timing, source_names,
                                            initial_transition, slew, load)
                                        if output_transition in result:
                                            source_delays.append(result[output_transition]["delay"])
                                            source_slews.append(result[output_transition]["slew"])
                                if not source_delays:
                                    raise RelativeMockError("source cover cannot produce %s" % output_transition)
                                source_delay = max(source_delays)
                                current = table.interpolate(slew, load).value
                                target_delay = source_delay - gain * max(abs(source_delay), 1e-6)
                                delay_row.append(min(current, target_delay))
                                source_slew = max(source_slews)
                                current_slew = transition_table.interpolate(slew, load).value
                                slew_row.append(min(current_slew, source_slew * (1.0 - gain)))
                            delay_grid.append(delay_row)
                            slew_grid.append(slew_row)
                        delay_key = (row["master"], output_pin, input_pin, table_name)
                        slew_key = (row["master"], output_pin, input_pin, transition_name)
                        for key, grid in ((delay_key, delay_grid), (slew_key, slew_grid)):
                            prior = overrides.get(key)
                            overrides[key] = (grid if prior is None else [
                                [min(left, right) for left, right in zip(left_row, right_row)]
                                for left_row, right_row in zip(prior, grid)
                            ])
                        arc_evidence.append({"input_pin": input_pin, "output_pin": output_pin,
                                             "table": table_name, "source_path_count": len(paths)})
        evidence.append({"opportunity_id": row["opportunityId"], "master": row["master"],
                         "removed_cell_count": row["removedCellCount"],
                         "assumed_delay_gain": gain,
                         "arcs": arc_evidence})
    missing = candidate_masters - {key[0] for key in overrides}
    if missing:
        raise RelativeMockError("no relative-cover tables generated for %s" % sorted(missing))
    return overrides, evidence


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--netlist", required=True)
    parser.add_argument("--merged-liberty", required=True)
    parser.add_argument("--custom-liberty", required=True)
    parser.add_argument("--resynthesis-result", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--report", required=True)
    args = parser.parse_args()
    result = json.loads(Path(args.resynthesis_result).read_text())
    overrides, evidence = derive_master_factors(
        Path(args.netlist).read_text(), Path(args.merged_liberty), result
    )
    output = replace_arc_tables(Path(args.custom_liberty).read_text(), overrides)
    Path(args.output).write_text(output)
    # Parse the result as an independent structural gate.
    masters = {key[0] for key in overrides}
    parsed = parse_liberty_timing(args.output, required_cells=masters)
    for (master, output_pin, input_pin, table_name), grid in overrides.items():
        arc = parsed.arc(master, input_pin, output_pin)
        actual = arc.tables[table_name].values
        expected = tuple(tuple(float(value) for value in row) for row in grid)
        if any(not math.isclose(left, right, rel_tol=1e-7, abs_tol=1e-10)
               for actual_row, expected_row in zip(actual, expected)
               for left, right in zip(actual_row, expected_row)):
            raise RelativeMockError("emitted table differs from relative-cover target: %s" %
                                    ((master, output_pin, input_pin, table_name),))
    report = {"schema": "hima.relative-cover-mock-liberty/1", "status": "succeeded",
              "policy": {"simple_max_source_cells": 2, "simple_delay_gain": 0.05,
                         "complex_delay_gain": 0.10,
                         "grid_policy": "most-restrictive-over-all-actions-arcs-and-nldm-points",
                         "may_slow_existing_candidate": False},
              "masters": sorted(masters), "table_override_count": len(overrides),
              "action_evidence": evidence,
              "output_cells": sorted(parsed.cells),
              "claim_limits": {"measured_characterization": False,
                               "commercial_qor": False}}
    Path(args.report).write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"cells": len(masters), "table_overrides": len(overrides)}, sort_keys=True))


if __name__ == "__main__":
    main()
def build_break_even_envelope(window):
    """Build a conditional V5 Cell envelope from one closed local window.

    This does not predict route gain.  It answers how fast and how light the
    candidate must be for each boundary output after charging upstream input
    capacitance, bypass-sink and boundary-wire penalties.
    """
    required = ("boundary_inputs", "boundary_outputs", "upstream_drivers",
                "bystander_sinks", "old_output_arrival_ns")
    missing = [name for name in required if not window.get(name)]
    if missing:
        return {"schema": "hima.lfr-break-even-envelope/1", "status": "incomplete",
                "missing": missing, "decision_authority": False}
    inputs = window["boundary_inputs"]
    outputs = window["boundary_outputs"]
    old_arrivals = window["old_output_arrival_ns"]
    loads = window.get("output_load_pf") or {}
    if set(outputs) - set(old_arrivals) or set(outputs) - set(loads):
        return {"schema": "hima.lfr-break-even-envelope/1", "status": "incomplete",
                "missing": ["per-output old arrival/load"], "decision_authority": False}
    required_gain = float(window.get("required_local_gain_ns", 0.0))
    upstream_penalty = float(window.get("upstream_driver_penalty_ns", 0.0))
    bystander_penalty = float(window.get("bystander_sink_penalty_ns", 0.0))
    wire_penalty = window.get("boundary_wire_penalty_ns") or {}
    input_arrival = float(window.get("worst_boundary_input_arrival_ns", 0.0))
    if min(required_gain, upstream_penalty, bystander_penalty, input_arrival) < 0:
        raise ValueError("break-even window timing quantities must be non-negative")
    rows = []
    for output in outputs:
        allowed = (float(old_arrivals[output]) - input_arrival - required_gain
                   - upstream_penalty - bystander_penalty
                   - float(wire_penalty.get(output, 0.0)))
        rows.append({
            "output": output, "max_candidate_arc_delay_ns": max(0.0, allowed),
            "output_load_pf": float(loads[output]),
            "max_output_slew_ns": (window.get("max_output_slew_ns") or {}).get(output),
            "removed_internal_net_cap_pf": float(
                (window.get("removed_internal_net_cap_pf") or {}).get(output, 0.0)),
        })
    cap_rows = []
    baseline_caps = window.get("baseline_input_cap_pf") or {}
    driver_resistance = window.get("upstream_driver_resistance_ns_per_pf") or {}
    cap_penalty_budget = float(window.get("input_cap_penalty_budget_ns", 0.0))
    for pin in inputs:
        base = baseline_caps.get(pin)
        resistance = driver_resistance.get(pin)
        maximum = None
        if isinstance(base, (int, float)) and isinstance(resistance, (int, float)) and resistance > 0:
            maximum = float(base) + cap_penalty_budget / float(resistance)
        cap_rows.append({"input": pin, "baseline_cap_pf": base,
                         "max_candidate_input_cap_pf": maximum})
    status = "bounded" if all(row["max_candidate_arc_delay_ns"] > 0 for row in rows) else "outside"
    return {
        "schema": "hima.lfr-break-even-envelope/1", "status": status,
        "outputs": rows, "inputs": cap_rows,
        "penalties_ns": {"upstream_driver": upstream_penalty,
                         "bystander_sinks": bystander_penalty},
        "window_closed": True, "decision_authority": False,
        "claim_limits": {"commercial_qor": False, "silicon_benefit": False},
    }
