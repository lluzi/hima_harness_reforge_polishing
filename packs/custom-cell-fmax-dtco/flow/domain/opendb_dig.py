#!/usr/bin/env python3
"""OpenDB adapter: LEF/DEF physical mirror -> deterministic DIG projection.

Run this file with OpenROAD's Python-enabled runtime.  It imports no Hima
runtime state and emits only public contract objects.  OpenDB OIDs never leave
the adapter.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path


def _direction(mterm):
    value = str(mterm.getIoType()).lower()
    if "output" in value:
        return "output"
    if "input" in value:
        return "input"
    return "inout"


def import_projection(lefs, def_path, snapshot, physical_odb):
    try:
        import odb
    except ImportError as error:
        raise RuntimeError("OpenDB Python bindings are unavailable") from error
    database = odb.dbDatabase.create()
    for lef in lefs:
        if odb.read_lef(database, str(lef)) is None:
            raise RuntimeError("OpenDB failed to read LEF %s" % lef)
    odb.read_def(database.getTech(), str(def_path))
    chip = database.getChip()
    if chip is None or chip.getBlock() is None:
        raise RuntimeError("OpenDB failed to read DEF")
    block = chip.getBlock()
    odb.write_db(database, str(physical_odb))
    reload_database = odb.dbDatabase.create()
    odb.read_db(reload_database, str(physical_odb))
    reload_block = reload_database.getChip().getBlock()
    if (len(reload_block.getInsts()) != len(block.getInsts())
            or len(reload_block.getNets()) != len(block.getNets())
            or len(reload_block.getBTerms()) != len(block.getBTerms())):
        raise RuntimeError("OpenDB save/reload changed object counts")
    dbu = float(block.getDbUnitsPerMicron())
    nodes, edges, hyperedges = [], [], []
    instance_nodes = {}
    instance_connections = {}
    seen_pins = set()
    issues = []
    for inst in sorted(block.getInsts(), key=lambda item: item.getName()):
        name = inst.getName()
        master = inst.getMaster()
        x, y = inst.getLocation()
        width, height = master.getWidth() / dbu, master.getHeight() / dbu
        x, y = x / dbu, y / dbu
        instance_node = {
            "kind": "Instance", "native_identity": name,
            "attributes": {"master": master.getName(), "x": x, "y": y,
                           "placement_status": str(inst.getPlacementStatus()),
                           "orientation": str(inst.getOrient())},
            "geometry": {"min_x": x, "max_x": x + width,
                         "min_y": y, "max_y": y + height},
        }
        nodes.append(instance_node)
        instance_nodes[name] = instance_node
        instance_connections[name] = []
        for iterm in sorted(inst.getITerms(), key=lambda item: item.getMTerm().getName()):
            pin_name = name + "/" + iterm.getMTerm().getName()
            direction = _direction(iterm.getMTerm())
            seen_pins.add(pin_name)
            nodes.append({"kind": "Pin", "native_identity": pin_name,
                          "attributes": {"instance": name,
                                         "pin": iterm.getMTerm().getName(),
                                         "direction": direction}})
            edges.append({"kind": "contains-pin", "source_kind": "Instance",
                          "source_native_identity": name, "target_kind": "Pin",
                          "target_native_identity": pin_name, "attributes": {}})
    for bterm in sorted(block.getBTerms(), key=lambda item: item.getName()):
        pin_name = "port/" + bterm.getName()
        seen_pins.add(pin_name)
        value = str(bterm.getIoType()).lower()
        direction = "output" if "output" in value else "input" if "input" in value else "inout"
        nodes.append({"kind": "Pin", "native_identity": pin_name,
                      "attributes": {"port": bterm.getName(), "direction": direction}})
    for net in sorted(block.getNets(), key=lambda item: item.getName()):
        if str(net.getSigType()).upper() in ("POWER", "GROUND"):
            continue
        name = net.getName()
        nodes.append({"kind": "Net", "native_identity": name,
                      "attributes": {"signal_type": str(net.getSigType()),
                                     "special": bool(net.isSpecial())}})
        members = []
        for iterm in sorted(net.getITerms(), key=lambda item: (item.getInst().getName(), item.getMTerm().getName())):
            pin_name = iterm.getInst().getName() + "/" + iterm.getMTerm().getName()
            direction = _direction(iterm.getMTerm())
            role = "driver" if direction == "output" else "sink"
            instance_connections[iterm.getInst().getName()].append(
                (iterm.getMTerm().getName(), name, role)
            )
            members.append({"kind": "Pin", "native_identity": pin_name, "role": role})
            edges.append({"kind": "pin-net", "source_kind": "Pin",
                          "source_native_identity": pin_name, "target_kind": "Net",
                          "target_native_identity": name, "attributes": {"role": role}})
        for bterm in sorted(net.getBTerms(), key=lambda item: item.getName()):
            pin_name = "port/" + bterm.getName()
            value = str(bterm.getIoType()).lower()
            role = "sink" if "output" in value else "driver"
            members.append({"kind": "Pin", "native_identity": pin_name, "role": role})
            edges.append({"kind": "pin-net", "source_kind": "Pin",
                          "source_native_identity": pin_name, "target_kind": "Net",
                          "target_native_identity": name, "attributes": {"role": role}})
        driver_count = sum(row["role"] == "driver" for row in members)
        if driver_count == 1:
            hyperedges.append({"kind": "driver-to-sinks", "native_identity": name,
                               "attributes": {"fanout": sum(row["role"] == "sink" for row in members)},
                               "members": members})
        else:
            issues.append({"net": name, "reason": "driver-count", "count": driver_count})
    for name, rows in instance_connections.items():
        boundary = sorted(rows)
        instance_nodes[name]["attributes"]["boundary_connections"] = boundary
        if boundary:
            instance_nodes[name]["attributes"]["semantic_signature"] = hashlib.sha256(
                json.dumps(boundary, separators=(",", ":")).encode()
            ).hexdigest()
    projection = {"schema": "hima.design-information-graph-projection/1",
                  "snapshot": {**snapshot, "manifest": {**snapshot.get("manifest", {}),
                                                          "opendb_issues": issues,
                                                          "dbu_per_micron": dbu}},
                  "nodes": nodes, "edges": edges, "hyperedges": hyperedges}
    return projection


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--lef", action="append", required=True)
    parser.add_argument("--def", dest="def_path", required=True)
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--physical-odb", required=True)
    parser.add_argument("--projection", required=True)
    args = parser.parse_args()
    snapshot = json.loads(Path(args.snapshot).read_text())
    projection = import_projection([Path(item) for item in args.lef], Path(args.def_path),
                                   snapshot, Path(args.physical_odb))
    Path(args.projection).write_text(json.dumps(projection, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
