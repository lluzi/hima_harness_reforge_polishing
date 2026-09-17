#!/usr/bin/env python3
"""Generate audited Innovus apply/rollback Tcl for anchored CCEI windows."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

from verilog_netlist import parse_modules


class CceiError(ValueError):
    pass


def _tcl(value):
    value = str(value)
    if any(character in value for character in ("{", "}", "\x00", "\n", "\r")):
        raise CceiError("unsafe Tcl identity %r" % value)
    return "{" + value + "}"


def _contexts(netlist_text, top):
    modules = parse_modules(netlist_text)
    if top not in modules:
        raise CceiError("netlist has no top module %s" % top)
    result = {}

    def walk(module, prefix, parent=None):
        result.setdefault(module, []).append({"module": module, "prefix": prefix,
                                               "parent": parent})
        for instance in modules[module]:
            if instance.cell_type in modules:
                child_prefix = "/".join(value for value in (prefix, instance.name) if value)
                walk(instance.cell_type, child_prefix, {
                    "module": module, "prefix": prefix, "instance": instance,
                })

    walk(top, "")
    return modules, result


def _context_for(contexts, module, hierarchy_path=None):
    rows = contexts.get(module, [])
    if hierarchy_path is not None:
        rows = [row for row in rows if row["prefix"] == hierarchy_path]
    if len(rows) != 1:
        raise CceiError("module %s needs one explicit hierarchy path, found %d" % (module, len(rows)))
    return rows[0]


def _resolve_net(contexts, modules, context, net):
    if re.fullmatch(r"(?:1'[bdho][0-9a-fA-FxXzZ]+|[01])", net):
        return net
    parent = context["parent"]
    if parent is not None and net in parent["instance"].conns:
        parent_context = _context_for(contexts, parent["module"], parent["prefix"])
        return _resolve_net(contexts, modules, parent_context, parent["instance"].conns[net])
    return "/".join(value for value in (context["prefix"], net) if value)


def build_ccei_plan(*, netlist_text, top, checkpoint, output_checkpoint,
                    opportunities, place_instances, power_net=None, ground_net=None,
                    power_pin=None, ground_pin=None):
    modules, contexts = _contexts(netlist_text, top)
    occupied, actions = set(), []
    for opportunity in opportunities:
        module = opportunity["module"]
        context = _context_for(contexts, module, opportunity.get("hierarchyPath"))
        prefix = context["prefix"]
        sources = ["/".join(value for value in (prefix, name) if value)
                   for name in opportunity["sourceInstances"]]
        overlap = occupied.intersection(sources)
        if overlap:
            raise CceiError("CCEI windows overlap: %s" % sorted(overlap))
        occupied.update(sources)
        source_facts = []
        for full_name, local_name in zip(sources, opportunity["sourceInstances"]):
            fact = place_instances.get(full_name)
            if fact is None or not all(isinstance(fact.get(key), (int, float)) for key in ("x", "y")):
                raise CceiError("place DIG lacks source location for %s" % full_name)
            original = next((row for row in modules[module] if row.name == local_name), None)
            if original is None:
                raise CceiError("source instance %s is absent from module %s" % (local_name, module))
            source_facts.append({
                "full_name": full_name, "local_name": local_name,
                "master": original.cell_type,
                "connections": {pin: _resolve_net(contexts, modules, context, net)
                                for pin, net in original.conns.items()},
                "x": float(fact["x"]), "y": float(fact["y"]),
                "orientation": str(fact.get("orientation", "R0")),
            })
        centroid = {
            "x": sum(row["x"] for row in source_facts) / len(source_facts),
            "y": sum(row["y"] for row in source_facts) / len(source_facts),
        }
        replacement = opportunity["replacementInstance"]
        full_replacement = "/".join(value for value in (prefix, replacement) if value)
        pin_map = {
            **{pin: _resolve_net(contexts, modules, context, net)
               for pin, net in opportunity["inputPinToNet"].items()},
            **{pin: _resolve_net(contexts, modules, context, net)
               for pin, net in opportunity["outputPinToNet"].items()},
        }
        actions.append({
            "opportunity_id": opportunity["opportunityId"], "module": module,
            "hierarchy_path": prefix, "source_instances": source_facts,
            "master": opportunity["master"], "replacement_instance": replacement,
            "full_replacement_instance": full_replacement, "pin_to_net": pin_map,
            "seed": centroid, "proof": opportunity.get("windowProof"),
            "anchor_evidence": opportunity.get("anchorEvidence"),
        })
    payload = {"schema": "hima.innovus-ccei-plan/1", "top": top,
               "checkpoint": str(checkpoint), "output_checkpoint": str(output_checkpoint),
               "actions": actions, "power": {"net": power_net, "pin": power_pin},
               "ground": {"net": ground_net, "pin": ground_pin}}
    payload["plan_sha256"] = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return payload


def render_apply_tcl(plan, placement_report):
    lines = [
        "# Hima CCEI apply plan %s" % plan["plan_sha256"],
        "restoreDesign %s %s" % (_tcl(plan["checkpoint"]), _tcl(plan["top"])),
    ]
    for action in plan["actions"]:
        lines.append("# opportunity %s anchored local resynthesis" % action["opportunity_id"])
        for source in action["source_instances"]:
            lines.append("if {[dbGet -p1 top.insts.name %s] eq \"0x0\"} { error \"CCEI source missing: %s\" }" %
                         (_tcl(source["full_name"]), source["full_name"]))
        for source in action["source_instances"]:
            lines.append("deleteInst %s" % _tcl(source["full_name"]))
        add = "addInst -cell %s -inst %s -loc {%0.6f %0.6f} -place_status unplaced" % (
            _tcl(action["master"]), _tcl(action["replacement_instance"]),
            action["seed"]["x"], action["seed"]["y"])
        if action["hierarchy_path"]:
            add += " -moduleBased %s" % _tcl(action["hierarchy_path"])
        lines.append(add)
        for pin, net in sorted(action["pin_to_net"].items()):
            lines.append("attachTerm %s %s %s" % (
                _tcl(action["full_replacement_instance"]), _tcl(pin), _tcl(net)))
        lines.append("set_dont_touch [get_cells %s] true" % _tcl(action["full_replacement_instance"]))
        for kind in ("power", "ground"):
            identity = plan[kind]
            if identity["net"] and identity["pin"]:
                lines.append("globalNetConnect %s -type pgpin -pin %s -inst %s" % (
                    _tcl(identity["net"]), _tcl(identity["pin"]),
                    _tcl(action["full_replacement_instance"])))
    lines.extend([
        "ecoPlace -fixPlacedInsts true -timing_driven true",
        "checkPlace %s" % _tcl(placement_report),
        "saveDesign %s" % _tcl(plan["output_checkpoint"]),
        "puts \"=== HIMA CCEI APPLY DONE %s ===\"" % plan["plan_sha256"],
        "exit", "",
    ])
    return "\n".join(lines)


def render_rollback_tcl(plan, rollback_checkpoint, placement_report):
    lines = ["# Hima CCEI rollback plan %s" % plan["plan_sha256"],
             "restoreDesign %s %s" % (_tcl(plan["output_checkpoint"]), _tcl(plan["top"]))]
    for action in reversed(plan["actions"]):
        lines.append("deleteInst %s" % _tcl(action["full_replacement_instance"]))
        for source in action["source_instances"]:
            add = "addInst -cell %s -inst %s -loc {%0.6f %0.6f} -ori %s -place_status placed" % (
                _tcl(source["master"]), _tcl(source["local_name"]), source["x"], source["y"],
                _tcl(source["orientation"]))
            if action["hierarchy_path"]:
                add += " -moduleBased %s" % _tcl(action["hierarchy_path"])
            lines.append(add)
            for pin, net in sorted(source["connections"].items()):
                lines.append("attachTerm %s %s %s" % (
                    _tcl(source["full_name"]), _tcl(pin), _tcl(net)))
    lines.extend(["ecoPlace -fixPlacedInsts true -timing_driven false",
                  "checkPlace %s" % _tcl(placement_report),
                  "saveDesign %s" % _tcl(rollback_checkpoint),
                  "puts \"=== HIMA CCEI ROLLBACK DONE %s ===\"" % plan["plan_sha256"],
                  "exit", ""])
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--netlist", required=True)
    parser.add_argument("--resynthesis-result", required=True)
    parser.add_argument("--database", required=True)
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--top", required=True)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--output-checkpoint", required=True)
    parser.add_argument("--rollback-checkpoint", required=True)
    parser.add_argument("--plan", required=True)
    parser.add_argument("--apply-tcl", required=True)
    parser.add_argument("--rollback-tcl", required=True)
    parser.add_argument("--placement-report", required=True)
    parser.add_argument("--rollback-placement-report", required=True)
    parser.add_argument("--max-actions", type=int, default=1)
    parser.add_argument("--power-net")
    parser.add_argument("--ground-net")
    parser.add_argument("--power-pin")
    parser.add_argument("--ground-pin")
    args = parser.parse_args()
    if args.max_actions < 1:
        raise CceiError("max-actions must be positive")
    result = json.loads(Path(args.resynthesis_result).read_text())
    if result.get("status") != "succeeded":
        raise CceiError("resynthesis result did not succeed")
    opportunities = result.get("selectedReplacements", [])[:args.max_actions]
    if not opportunities or not all((row.get("windowProof") or {}).get("status") == "proved"
                                    for row in opportunities):
        raise CceiError("CCEI requires selected, proved anchored windows")
    from dig_store import DigStore
    with DigStore(args.database) as store:
        snapshot = store.connection.execute(
            "SELECT graph_sha256 FROM snapshots WHERE snapshot_id=?", (args.snapshot,)
        ).fetchone()
        if snapshot is None:
            raise CceiError("place snapshot is absent")
        place_instances = {
            row[0]: json.loads(row[1]) for row in store.connection.execute(
                "SELECT native_identity,attributes_json FROM nodes "
                "WHERE snapshot_id=? AND kind='Instance'", (args.snapshot,)
            )
        }
    plan = build_ccei_plan(
        netlist_text=Path(args.netlist).read_text(), top=args.top,
        checkpoint=args.checkpoint, output_checkpoint=args.output_checkpoint,
        opportunities=opportunities, place_instances=place_instances,
        power_net=args.power_net, ground_net=args.ground_net,
        power_pin=args.power_pin, ground_pin=args.ground_pin,
    )
    plan["place_graph_sha256"] = snapshot[0]
    plan["resynthesis_result_sha256"] = hashlib.sha256(
        Path(args.resynthesis_result).read_bytes()
    ).hexdigest()
    # Rebind the plan identity after adding its input provenance.
    plan["plan_sha256"] = hashlib.sha256(
        json.dumps({key: value for key, value in plan.items() if key != "plan_sha256"},
                   sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    Path(args.plan).write_text(json.dumps(plan, indent=2, sort_keys=True) + "\n")
    Path(args.apply_tcl).write_text(render_apply_tcl(plan, args.placement_report))
    Path(args.rollback_tcl).write_text(render_rollback_tcl(
        plan, args.rollback_checkpoint, args.rollback_placement_report
    ))
    print(json.dumps({"plan_sha256": plan["plan_sha256"], "actions": len(plan["actions"]),
                      "place_graph_sha256": plan["place_graph_sha256"]}, sort_keys=True))


if __name__ == "__main__":
    main()
