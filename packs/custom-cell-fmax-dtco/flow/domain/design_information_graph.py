#!/usr/bin/env python3
"""Normalized, hash-bound Design Information Graph projection contract."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from dig_store import canonical_json, sha256_json


PROJECTION_SCHEMA = "hima.design-information-graph-projection/1"
REQUIRED_UNITS = ("distance", "time", "capacitance", "resistance")
NODE_KINDS = {"Instance", "Pin", "Net", "TimingArc", "EndpointState",
              "PathAlternative", "PhysicalRegion"}


class DesignInformationGraphError(ValueError):
    pass


def file_sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_bundle(bundle_dir):
    bundle_dir = Path(bundle_dir).resolve()
    manifest_path = bundle_dir / "manifest.json"
    if not manifest_path.is_file() or manifest_path.is_symlink():
        raise DesignInformationGraphError("bundle requires a regular manifest.json")
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("schema") != "hima.innovus-dig-export/1":
        raise DesignInformationGraphError("unsupported Innovus export manifest")
    if manifest.get("phase") not in ("place", "postroute"):
        raise DesignInformationGraphError("bundle phase must be place or postroute")
    roles = {}
    for row in manifest.get("artifacts", []):
        role = row.get("role")
        relative = row.get("path")
        if not role or not isinstance(relative, str) or role in roles:
            raise DesignInformationGraphError("bundle artifact roles must be unique")
        candidate = (bundle_dir / relative).resolve()
        if bundle_dir not in candidate.parents or not candidate.is_file() or candidate.is_symlink():
            raise DesignInformationGraphError("bundle artifact is missing or escapes bundle: %s" % role)
        actual = file_sha256(candidate)
        if actual != row.get("sha256"):
            raise DesignInformationGraphError("bundle artifact hash mismatch: %s" % role)
        roles[role] = candidate
    required = {"netlist", "def", "sdc", "timing_facts", "clock_facts", "census"}
    if manifest["phase"] == "postroute":
        required.add("spef")
    missing = required - set(roles)
    completeness = "complete" if not missing else "partial"
    declared = manifest.get("completeness")
    if declared == "complete" and missing:
        raise DesignInformationGraphError("complete bundle is missing roles: %s" % sorted(missing))
    manifest_hash = sha256_json({
        "manifest": {key: value for key, value in manifest.items() if key != "manifest_sha256"},
        "artifact_hashes": sorted((role, file_sha256(path)) for role, path in roles.items()),
    })
    return {"directory": str(bundle_dir), "manifest": manifest, "roles": roles,
            "bundle_sha256": manifest_hash, "completeness": completeness,
            "missing_roles": sorted(missing)}


def _require_string(row, name):
    value = row.get(name)
    if not isinstance(value, str) or not value:
        raise DesignInformationGraphError("%s must be a non-empty string" % name)
    return value


def validate_projection(projection):
    if projection.get("schema") != PROJECTION_SCHEMA:
        raise DesignInformationGraphError("unsupported DIG projection schema")
    raw_snapshot = projection.get("snapshot") or {}
    snapshot_id = _require_string(raw_snapshot, "snapshot_id")
    phase = raw_snapshot.get("phase")
    if phase not in ("place", "postroute"):
        raise DesignInformationGraphError("snapshot phase must be place or postroute")
    units = raw_snapshot.get("units") or {}
    missing_units = [name for name in REQUIRED_UNITS if not isinstance(units.get(name), str)]
    if missing_units:
        raise DesignInformationGraphError("snapshot missing units: %s" % missing_units)
    completeness = raw_snapshot.get("completeness")
    if completeness not in ("sampled", "partial", "complete"):
        raise DesignInformationGraphError("invalid completeness")

    nodes = []
    identities = set()
    for raw in projection.get("nodes", []):
        kind = _require_string(raw, "kind")
        identity = _require_string(raw, "native_identity")
        if kind not in NODE_KINDS:
            raise DesignInformationGraphError("unsupported node kind %s" % kind)
        key = (kind, identity)
        if key in identities:
            raise DesignInformationGraphError("duplicate node identity %r" % (key,))
        identities.add(key)
        attrs = raw.get("attributes")
        if not isinstance(attrs, dict):
            raise DesignInformationGraphError("node attributes must be an object")
        row = {"kind": kind, "native_identity": identity, "attributes": attrs}
        if raw.get("geometry") is not None:
            geometry = raw["geometry"]
            if set(geometry) != {"min_x", "max_x", "min_y", "max_y"}:
                raise DesignInformationGraphError("geometry requires four bbox coordinates")
            row["geometry"] = {key: float(value) for key, value in geometry.items()}
        nodes.append(row)

    edges = []
    for raw in projection.get("edges", []):
        row = {key: _require_string(raw, key) for key in (
            "kind", "source_kind", "source_native_identity",
            "target_kind", "target_native_identity")}
        if (row["source_kind"], row["source_native_identity"]) not in identities:
            raise DesignInformationGraphError("edge source is absent")
        if (row["target_kind"], row["target_native_identity"]) not in identities:
            raise DesignInformationGraphError("edge target is absent")
        row["attributes"] = raw.get("attributes") or {}
        edges.append(row)

    hyperedges = []
    for raw in projection.get("hyperedges", []):
        row = {"kind": _require_string(raw, "kind"),
               "native_identity": _require_string(raw, "native_identity"),
               "attributes": raw.get("attributes") or {}, "members": []}
        roles = set()
        for member in raw.get("members", []):
            item = {key: _require_string(member, key)
                    for key in ("kind", "native_identity", "role")}
            if (item["kind"], item["native_identity"]) not in identities:
                raise DesignInformationGraphError("hyperedge member is absent")
            if item["role"] in roles and item["role"] == "driver":
                raise DesignInformationGraphError("hyperedge has multiple drivers")
            roles.add(item["role"])
            row["members"].append(item)
        if not row["members"]:
            raise DesignInformationGraphError("hyperedge requires members")
        hyperedges.append(row)

    canonical_graph = {"nodes": sorted(nodes, key=lambda row: (row["kind"], row["native_identity"])),
                       "edges": sorted(edges, key=canonical_json),
                       "hyperedges": sorted(hyperedges, key=canonical_json)}
    graph_hash = sha256_json(canonical_graph)
    declared_hash = raw_snapshot.get("graph_sha256")
    if declared_hash is not None and declared_hash != graph_hash:
        raise DesignInformationGraphError("declared graph hash does not match projection")
    snapshot = {
        "snapshot_id": snapshot_id, "phase": phase,
        "design_name": _require_string(raw_snapshot, "design_name"),
        "top_module": _require_string(raw_snapshot, "top_module"),
        "bundle_sha256": _require_string(raw_snapshot, "bundle_sha256"),
        "graph_sha256": graph_hash, "completeness": completeness,
        "units": units, "manifest": raw_snapshot.get("manifest") or {},
    }
    return {"schema": PROJECTION_SCHEMA, "snapshot": snapshot, **canonical_graph}


def write_projection(path, projection):
    normalized = validate_projection(projection)
    Path(path).write_text(json.dumps(normalized, indent=2, sort_keys=True) + "\n")
    return normalized


def augment_timing_projection(physical_projection, timing_facts, clock_facts):
    """Join bounded Innovus timing summaries to one physical projection.

    Raw path tables stay in the hash-bound report.  The graph retains ordered
    pin identity and a digest, rather than duplicating every formatted column.
    """
    if timing_facts.get("schema") != "hima.innovus-timing-facts/1":
        raise DesignInformationGraphError("unsupported timing fact schema")
    if clock_facts.get("schema") != "hima.innovus-clock-facts/1":
        raise DesignInformationGraphError("unsupported clock fact schema")
    result = json.loads(json.dumps(physical_projection))
    snapshot = result.setdefault("snapshot", {})
    completeness = timing_facts.get("completeness")
    if completeness != "complete":
        snapshot["completeness"] = "partial"
    manifest = snapshot.setdefault("manifest", {})
    manifest["timing_coverage_scope"] = timing_facts.get("coverage_scope")
    manifest["timing_path_count"] = timing_facts.get("path_count")
    manifest["timing_endpoint_count"] = timing_facts.get("endpoint_count")
    known = {(row["kind"], row["native_identity"]) for row in result.get("nodes", [])}
    endpoint_names = {row["endpoint"] for row in timing_facts.get("paths", [])}
    for endpoint in sorted(endpoint_names):
        rows = [row for row in timing_facts["paths"] if row["endpoint"] == endpoint]
        identity = endpoint
        result["nodes"].append({
            "kind": "EndpointState", "native_identity": identity,
            "attributes": {
                "path_group": "internal-setup",
                "worst_slack_ns": min(row["slack_ns"] for row in rows),
                "path_alternative_count": len(rows),
                "coverage_complete": completeness == "complete",
            },
        })
        known.add(("EndpointState", identity))
    for row in timing_facts.get("paths", []):
        identity = "path:%s" % row["path_id"]
        ordered_pins = list(row.get("ordered_pins", []))
        result["nodes"].append({
            "kind": "PathAlternative", "native_identity": identity,
            "attributes": {
                "beginpoint": row["beginpoint"], "endpoint": row["endpoint"],
                "analysis_view": row["analysis_view"], "slack_ns": row["slack_ns"],
                "arrival_time_ns": row["arrival_time_ns"],
                "required_time_ns": row["required_time_ns"],
                "launch_clock_latency_ns": row.get("launch_clock_latency_ns"),
                "capture_clock_arrival_ns": row.get("capture_clock_arrival_ns"),
                "ordered_pins": ordered_pins,
                "ordered_pin_digest": sha256_json(ordered_pins),
                "coverage_scope": timing_facts.get("coverage_scope"),
            },
        })
        result["edges"].append({
            "kind": "timing-alternative", "source_kind": "PathAlternative",
            "source_native_identity": identity, "target_kind": "EndpointState",
            "target_native_identity": row["endpoint"], "attributes": {},
        })
    return result
