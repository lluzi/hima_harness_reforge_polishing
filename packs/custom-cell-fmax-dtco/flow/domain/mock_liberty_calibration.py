#!/usr/bin/env python3
"""Topology-anchored Mock Liberty calibration for the V5 Reference Pack.

This is a calibration instrument, not measured characterization.  D1 delay is
anchored to foundry CDL topology depth and the corresponding foundry Liberty
delay distribution, then adjusted for the generated pull-up/pull-down stack.
Larger drives are deterministic electrical scalings of that calibrated D1.
"""
from __future__ import annotations

import copy
import json
import math
import re
import statistics
import tempfile
from collections import defaultdict
from pathlib import Path

from drive_family import drive_scale


DRIVE_SUFFIX = re.compile(r"^(?P<base>.+)_(?P<drive>D1|D2|D4|D6|D8)$")
_VALUES = re.compile(r'\bvalues\s*\((.*?)\)\s*;', re.S)
_NUMBER = re.compile(r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?")
_DRIVE_ORDER = ("D1", "D2", "D4", "D6", "D8")


def load_policy(path):
    document = json.loads(Path(path).read_text())
    required = {
        "schema", "global_delay_scale", "p_series_penalty_per_extra",
        "n_series_penalty_per_extra", "drive_intrinsic_exponent",
        "per_stage_anchor_cap",
        "reference_slew_ns", "reference_load_pf",
        "max_reference_cells", "min_anchor_cells",
    }
    if set(document) != required or document["schema"] != "hima.mock-liberty-policy/1":
        raise ValueError("Mock Liberty policy has an unsupported schema")
    for name in ("global_delay_scale", "p_series_penalty_per_extra",
                 "n_series_penalty_per_extra", "drive_intrinsic_exponent",
                 "per_stage_anchor_cap", "reference_slew_ns", "reference_load_pf"):
        value = document[name]
        if (isinstance(value, bool) or not isinstance(value, (int, float))
                or not math.isfinite(float(value)) or float(value) <= 0):
            raise ValueError("Mock Liberty policy %s must be positive and finite" % name)
    for name in ("max_reference_cells", "min_anchor_cells"):
        value = document[name]
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise ValueError("Mock Liberty policy %s must be a positive integer" % name)
    return document


def _named_group(text, kind, name):
    match = re.search(r"\b%s\s*\(\s*\"?%s\"?\s*\)\s*\{" % (
        re.escape(kind), re.escape(name)), text)
    if not match:
        return None
    depth = 1
    for index in range(match.end(), len(text)):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1
            if depth == 0:
                return text[match.start():index + 1]
    return None


def _cell_blocks(liberty):
    """Index all Liberty Cell groups once; repeated whole-file regex is quadratic."""
    blocks = {}
    pattern = re.compile(r"\bcell\s*\(\s*\"?([A-Za-z_][A-Za-z0-9_$]*)\"?\s*\)\s*\{")
    for match in pattern.finditer(liberty):
        depth = 1
        for index in range(match.end(), len(liberty)):
            if liberty[index] == "{":
                depth += 1
            elif liberty[index] == "}":
                depth -= 1
                if depth == 0:
                    blocks[match.group(1)] = liberty[match.start():index + 1]
                    break
    return blocks


def _table_reference_value(block, slew_ns, load_pf):
    axis_1 = re.search(r'\bindex_1\s*\(\s*"([^"]+)"\s*\)', block)
    axis_2 = re.search(r'\bindex_2\s*\(\s*"([^"]+)"\s*\)', block)
    values = _VALUES.search(block)
    if not (axis_1 and axis_2 and values):
        return None
    first = [float(value) for value in _NUMBER.findall(axis_1.group(1))]
    second = [float(value) for value in _NUMBER.findall(axis_2.group(1))]
    table = [float(value) for value in _NUMBER.findall(values.group(1))]
    if len(table) != len(first) * len(second):
        return None
    row = min(range(len(first)), key=lambda index: abs(first[index] - slew_ns))
    column = min(range(len(second)), key=lambda index: abs(second[index] - load_pf))
    return table[row * len(second) + column]


def _cell_nominal_delay(liberty, cell, *, blocks=None, slew_ns=0.02, load_pf=0.003):
    block = blocks.get(cell) if blocks is not None else _named_group(liberty, "cell", cell)
    if not block:
        return None
    values = []
    for match in re.finditer(r"\b(?:cell_rise|cell_fall)\s*\([^)]*\)\s*\{", block):
        depth = 1
        end = None
        for index in range(match.end(), len(block)):
            if block[index] == "{": depth += 1
            elif block[index] == "}":
                depth -= 1
                if depth == 0:
                    end = index + 1
                    break
        if end is None:
            continue
        value = _table_reference_value(block[match.start():end], slew_ns, load_pf)
        if value is not None:
            values.append(value)
    positive = [value for value in values if math.isfinite(value) and value > 0]
    return statistics.median(positive) if positive else None


def _reference_drive_signature(cell):
    """Infer the Site library's drive token from its declared D1 template Cell.

    The suffix remains Site data: for ``ND2D1BWP40P140`` this returns the
    marker ``D`` and suffix ``BWP40P140`` without carrying either name in the
    Pack.  A Site whose naming convention cannot be inferred must fail closed
    instead of silently mixing drive strengths into the D1 anchor.
    """
    match = re.fullmatch(
        r"(?P<prefix>.*)(?P<marker>[A-Za-z_])1(?P<suffix>[A-Za-z_][A-Za-z0-9_$]*)",
        cell,
    )
    if match is None:
        raise ValueError(
            "CCFMAX_POWER_TEMPLATE_BASE_CELL must identify an inferable D1 drive variant"
        )
    return match.group("marker"), match.group("suffix")


def _drive_member(cell, signature):
    marker, suffix = signature
    match = re.fullmatch(
        r"(?P<family>.+)%s(?P<drive>\d+(?:P\d+)?)%s"
        % (re.escape(marker), re.escape(suffix)),
        cell,
    )
    if match is None:
        return None
    value = float(match.group("drive").replace("P", "."))
    label = "D%d" % int(value) if value.is_integer() else "D%s" % match.group("drive")
    return match.group("family"), label


def _groups(text, kind):
    pattern = re.compile(r'\b%s\s*\(\s*"?([^"\s)]+)"?\s*\)\s*\{' % re.escape(kind))
    for match in pattern.finditer(text):
        depth = 1
        for index in range(match.end(), len(text)):
            if text[index] == "{":
                depth += 1
            elif text[index] == "}":
                depth -= 1
                if depth == 0:
                    yield match.group(1), text[match.start():index + 1]
                    break


def _input_count_and_max_capacitance(block):
    inputs = 0
    output_caps = []
    for _pin, pin_block in _groups(block, "pin"):
        direction = re.search(r'\bdirection\s*:\s*"?([A-Za-z]+)', pin_block)
        if direction is None:
            continue
        if direction.group(1) == "input":
            inputs += 1
        elif direction.group(1) == "output":
            maximum = re.search(
                r"\bmax_capacitance\s*:\s*([-+0-9.eE]+)", pin_block
            )
            if maximum is not None:
                output_caps.append(float(maximum.group(1)))
    return inputs, min(output_caps) if output_caps else None


def build_reference_depth_anchors(
        cdl_path, liberty_path, policy, *, reference_drive_cell):
    """Return D1-only foundry anchors and empirical drive-family behaviour."""
    import features
    liberty = Path(liberty_path).read_text(errors="replace")
    blocks = _cell_blocks(liberty)
    signature = _reference_drive_signature(reference_drive_cell)
    members = {cell: _drive_member(cell, signature) for cell in blocks}
    d1_cells = {cell for cell, member in members.items()
                if member is not None and member[1] == "D1"}
    if reference_drive_cell not in d1_cells:
        raise ValueError("reference drive Cell is absent from the foundry Liberty")
    delay_cache = {}

    def reference_delay(cell):
        if cell not in delay_cache:
            delay_cache[cell] = _cell_nominal_delay(
                liberty, cell, blocks=blocks,
                slew_ns=policy["reference_slew_ns"],
                load_pf=policy["reference_load_pf"])
        return delay_cache[cell]

    samples = defaultdict(list)
    accepted = 0
    with tempfile.TemporaryDirectory(prefix="hima-cdl-anchor-") as folder:
        cell_path = Path(folder) / "cell.sp"
        for cell, text in features.split_deck(cdl_path):
            if accepted >= policy["max_reference_cells"]:
                break
            if cell not in d1_cells:
                continue
            delay = reference_delay(cell)
            if delay is None:
                continue
            cell_path.write_text(text)
            try:
                name, ports, devices = features.MC.parse_netlist(str(cell_path))
                rows, reason = features.cell_rows(name, devices, ports, defaultdict(int))
            except (Exception, SystemExit):
                continue
            if reason or not rows:
                continue
            depth = max(max(1, int(row["fanout_internal"])) for row in rows)
            samples[depth].append(delay)
            accepted += 1
    minimum = policy["min_anchor_cells"]
    anchors = {depth: statistics.median(values) for depth, values in samples.items()
               if len(values) >= minimum}
    if not anchors:
        raise ValueError("foundry D1 CDL/Liberty produced no sufficiently populated depth anchor")

    family_delays = defaultdict(dict)
    d1_max_caps = defaultdict(list)
    for cell, member in members.items():
        if member is None:
            continue
        family, drive = member
        delay = reference_delay(cell)
        if delay is not None:
            family_delays[family][drive] = delay
        if drive == "D1":
            input_count, maximum = _input_count_and_max_capacitance(blocks[cell])
            if input_count > 0 and maximum is not None and maximum > 0:
                d1_max_caps[input_count].append(maximum)
    drive_delay_ratios = {"D1": 1.0}
    drive_ratio_counts = {"D1": sum("D1" in rows for rows in family_delays.values())}
    for drive in _DRIVE_ORDER[1:]:
        ratios = [rows[drive] / rows["D1"] for rows in family_delays.values()
                  if "D1" in rows and drive in rows]
        if len(ratios) < minimum:
            raise ValueError("foundry Liberty has too few %s/D1 drive-family anchors" % drive)
        drive_delay_ratios[drive] = statistics.median(ratios)
        drive_ratio_counts[drive] = len(ratios)
    max_caps = {str(count): statistics.median(values)
                for count, values in sorted(d1_max_caps.items()) if len(values) >= minimum}
    if not max_caps:
        raise ValueError("foundry D1 Liberty produced no max-capacitance anchors")
    return {
        "anchors_ns": dict(sorted(anchors.items())),
        "sample_counts": {depth: len(samples[depth]) for depth in sorted(samples)},
        "reference_cells": accepted,
        "reference_drive_cell": reference_drive_cell,
        "drive_delay_ratios": drive_delay_ratios,
        "drive_ratio_counts": drive_ratio_counts,
        "d1_max_capacitance_pf_by_input_count": max_caps,
        "reference_point": {"slew_ns": policy["reference_slew_ns"],
                            "load_pf": policy["reference_load_pf"]},
    }


def generated_arc_topology(spice_path):
    import features
    name, ports, devices = features.MC.parse_netlist(str(spice_path))
    rows, reason = features.cell_rows(name, devices, ports, defaultdict(int))
    if reason or not rows:
        raise ValueError("generated SPICE has no calibratable timing arcs: %s" % reason)
    return {(row["in_pin"], row["out_pin"]): row for row in rows}


def _nearest_anchor(depth, anchors):
    selected = min(anchors, key=lambda candidate: (abs(int(candidate) - depth), int(candidate)))
    return int(selected), float(anchors[selected])


def _scale_grid(grid, factor):
    return [[max(1e-9, float(value) * factor) for value in row] for row in grid]


def _drive_grid(grid, factor, exponent):
    result = []
    for row in grid:
        intrinsic = min(float(value) for value in row) / (factor ** exponent)
        source_intrinsic = min(float(value) for value in row)
        result.append([max(1e-9, intrinsic + (float(value) - source_intrinsic) / factor)
                       for value in row])
    return result


def _grid_median(grid):
    return statistics.median(float(value) for row in grid for value in row)


def _grid_at(arc, grid, slew_ns, load_pf):
    first, second = arc["index_1"], arc["index_2"]
    row = min(range(len(first)), key=lambda index: abs(float(first[index]) - slew_ns))
    column = min(range(len(second)), key=lambda index: abs(float(second[index]) - load_pf))
    return float(grid[row][column])


def _output_resistance(arcs):
    result = {}
    for arc in arcs:
        slopes = []
        loads = arc.get("index_2") or []
        if len(loads) >= 2 and loads[-1] > loads[0]:
            for kind in ("cell_rise", "cell_fall"):
                grid = (arc.get("tables") or {}).get(kind)
                if grid:
                    slopes.extend(max(0.0, (row[-1] - row[0]) / (loads[-1] - loads[0]))
                                  for row in grid)
        result.setdefault(arc["out_pin"], []).extend(slopes)
    return {pin: statistics.median(values) for pin, values in result.items() if values}


def calibrate_prediction(prediction, spice_path, policy, reference, d1_cache):
    match = DRIVE_SUFFIX.fullmatch(Path(spice_path).stem)
    if not match:
        raise ValueError("generated Cell name has no D1/D2/D4/D6/D8 suffix")
    base, drive = match.group("base"), match.group("drive")
    factor = drive_scale(drive)
    if drive == "D1":
        pred = copy.deepcopy(prediction)
        topology = generated_arc_topology(spice_path)
        arc_rows = []
        anchors = reference["anchors_ns"]
        for arc in pred.get("arcs") or []:
            key = (arc.get("in_pin"), arc.get("out_pin"))
            if key not in topology:
                raise ValueError("prediction arc is absent from generated SPICE topology")
            row = topology[key]
            depth = max(1, int(row["fanout_internal"]))
            anchor_depth, raw_anchor_delay = _nearest_anchor(depth, anchors)
            stage_one = float(anchors[min(anchors, key=lambda item: int(item))])
            anchor_cap = stage_one * depth * policy["per_stage_anchor_cap"]
            anchor_delay = min(raw_anchor_delay, anchor_cap)
            p_weak = 1.0 + policy["p_series_penalty_per_extra"] * max(
                0, int(row["series_p"]) - 1)
            n_weak = 1.0 + policy["n_series_penalty_per_extra"] * max(
                0, int(row["series_n"]) - 1)
            targets = {"cell_rise": anchor_delay * p_weak * policy["global_delay_scale"],
                       "cell_fall": anchor_delay * n_weak * policy["global_delay_scale"]}
            applied = {}
            for kind, target in targets.items():
                grid = (arc.get("tables") or {}).get(kind)
                if not grid:
                    continue
                observed = _grid_at(
                    arc, grid, policy["reference_slew_ns"], policy["reference_load_pf"])
                scale = target / observed
                arc["tables"][kind] = _scale_grid(grid, scale)
                applied[kind] = {"pre_ns": observed, "target_ns": target, "scale": scale}
            arc_rows.append({"input": key[0], "output": key[1], "logic_depth": depth,
                             "anchor_depth": anchor_depth,
                             "raw_anchor_delay_ns": raw_anchor_delay,
                             "anchor_cap_ns": anchor_cap,
                             "anchor_delay_ns": anchor_delay,
                             "series_n": row["series_n"], "series_p": row["series_p"],
                             "applied": applied})
        pred["mock_calibration"] = {"drive": drive, "drive_scale": factor,
                                    "reference_delay_ratio": 1.0,
                                    "arc_topology": arc_rows}
        d1_cache[base] = copy.deepcopy(pred)
    else:
        if base not in d1_cache:
            raise ValueError("drive family must be calibrated in D1-to-D8 order")
        source = d1_cache[base]
        pred = copy.deepcopy(source)
        exponent = policy["drive_intrinsic_exponent"]
        try:
            reference_ratio = float(reference["drive_delay_ratios"][drive])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError("foundry reference has no empirical %s/D1 delay ratio" % drive) from exc
        for arc_index, arc in enumerate(pred.get("arcs") or []):
            source_arc = source["arcs"][arc_index]
            arc["index_2"] = [float(value) * factor for value in arc["index_2"]]
            for kind in ("cell_rise", "cell_fall", "rise_transition", "fall_transition"):
                grid = (arc.get("tables") or {}).get(kind)
                if grid:
                    driven = _drive_grid(grid, factor, exponent)
                    source_grid = source_arc["tables"][kind]
                    source_reference = _grid_at(
                        source_arc, source_grid,
                        policy["reference_slew_ns"], policy["reference_load_pf"])
                    observed = _grid_at(
                        arc, driven,
                        policy["reference_slew_ns"], policy["reference_load_pf"])
                    arc["tables"][kind] = _scale_grid(
                        driven, source_reference * reference_ratio / observed)
            for kind, grid in (arc.get("power_tables") or {}).items():
                arc["power_tables"][kind] = _scale_grid(grid, factor)
            if "cap" in (arc.get("scalars") or {}):
                arc["scalars"]["cap"] = float(arc["scalars"]["cap"]) * factor
        for pin in (pred.get("pins") or {}).values():
            for kind, values in (pin.get("passive") or {}).items():
                pin["passive"][kind] = [float(value) * factor for value in values]
        leakage = pred.get("leakage") or {}
        for key, value in list(leakage.items()):
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                leakage[key] = float(value) * factor
        pred["mock_calibration"] = {"drive": drive, "drive_scale": factor,
                                    "reference_delay_ratio": reference_ratio,
                                    "derived_from": base + "_D1"}
    input_count = len({arc.get("in_pin") for arc in pred.get("arcs") or []
                       if isinstance(arc.get("in_pin"), str)})
    cap_anchors = reference.get("d1_max_capacitance_pf_by_input_count") or {}
    if not cap_anchors:
        raise ValueError("foundry reference has no D1 max-capacitance anchors")
    counts = [int(value) for value in cap_anchors]
    selected_count = min(counts, key=lambda value: (abs(value - input_count), value))
    pred["mock_calibration"]["max_capacitance_limit_pf"] = (
        float(cap_anchors[str(selected_count)]) * factor
    )
    pred["mock_calibration"]["max_capacitance_anchor_input_count"] = selected_count
    pred["mock_calibration"]["output_resistance_ns_per_pf"] = _output_resistance(
        pred.get("arcs") or [])
    return pred, base, drive, factor


def calibrated_max_capacitance(prediction, arcs):
    predicted = min(float(arc["index_2"][-1]) for arc in arcs)
    limit = (prediction.get("mock_calibration") or {}).get("max_capacitance_limit_pf")
    if not isinstance(limit, (int, float)) or isinstance(limit, bool) or limit <= 0:
        raise ValueError("calibrated prediction has no positive max-capacitance limit")
    return min(predicted, float(limit))


def demand_result(cell_name, pred, required_delay_ns, *, slew_ns=0.02, load_pf=0.003):
    observed = max(_grid_at(arc, grid, slew_ns, load_pf)
                   for arc in pred.get("arcs") or []
                   for kind, grid in (arc.get("tables") or {}).items()
                   if kind in {"cell_rise", "cell_fall"})
    return {"cell": cell_name, "required_delay_ns": required_delay_ns,
            "model_delay_ns": observed, "meets": observed <= required_delay_ns}


def validate_electrical_families(rows):
    by_family = defaultdict(list)
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("family"), str):
            raise ValueError("drive calibration row is malformed")
        by_family[row["family"]].append(row)
    accepted = []
    order = ("D1", "D2", "D4", "D6", "D8")
    for family, variants in sorted(by_family.items()):
        by_drive = {row.get("drive"): row for row in variants}
        if set(by_drive) != set(order) or len(variants) != len(order):
            raise ValueError("drive family %s is incomplete" % family)
        variants = [by_drive[drive] for drive in order]
        increasing = {
            "area_um2": [row["area_um2"] for row in variants],
            "input_capacitance_pf": [sum(row["input_capacitance_pf"].values())
                                      for row in variants],
            "max_load_pf": [sum(row["max_load_pf"].values()) for row in variants],
        }
        for name, values in increasing.items():
            if any(not right > left for left, right in zip(values, values[1:])):
                raise ValueError("drive family %s does not strictly increase %s" % (family, name))
        resistance = [statistics.median(row["output_resistance_ns_per_pf"].values())
                      for row in variants]
        if any(not right < left for left, right in zip(resistance, resistance[1:])):
            raise ValueError("drive family %s does not strictly decrease output resistance" % family)
        accepted.append({"family": family, "drives": list(order),
                         "area_um2": increasing["area_um2"],
                         "input_capacitance_pf": increasing["input_capacitance_pf"],
                         "max_load_pf": increasing["max_load_pf"],
                         "output_resistance_ns_per_pf": resistance})
    if not accepted:
        raise ValueError("no complete drive family was calibrated")
    return accepted
