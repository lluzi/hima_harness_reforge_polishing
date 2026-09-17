#!/usr/bin/env python3
"""SQLite authority for Pack-local Design Information Graph method facts.

The commercial checkpoint and its hash-bound exports remain design authority.
This store owns stable Hima identities, deterministic graph projections and
append-only method annotations.  It deliberately has no EDA parser and never
modifies an Innovus/OpenDB design.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path


SCHEMA_VERSION = 1


class DigStoreError(ValueError):
    pass


def canonical_json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def sha256_json(value):
    return hashlib.sha256(canonical_json(value).encode()).hexdigest()


def hima_id(snapshot_id, object_kind, canonical_native_identity):
    if not all(isinstance(value, str) and value for value in (
            snapshot_id, object_kind, canonical_native_identity)):
        raise DigStoreError("Hima identity inputs must be non-empty strings")
    payload = "\0".join((snapshot_id, object_kind, canonical_native_identity))
    return "hima:" + hashlib.sha256(payload.encode()).hexdigest()


SCHEMA = r"""
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_id TEXT PRIMARY KEY,
  phase TEXT NOT NULL CHECK (phase IN ('place', 'postroute')),
  design_name TEXT NOT NULL,
  top_module TEXT NOT NULL,
  bundle_sha256 TEXT NOT NULL,
  graph_sha256 TEXT NOT NULL,
  completeness TEXT NOT NULL CHECK (completeness IN ('sampled', 'partial', 'complete')),
  units_json TEXT NOT NULL,
  manifest_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS nodes (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  hima_id TEXT NOT NULL UNIQUE,
  snapshot_id TEXT NOT NULL REFERENCES snapshots(snapshot_id),
  kind TEXT NOT NULL,
  native_identity TEXT NOT NULL,
  attributes_json TEXT NOT NULL,
  UNIQUE(snapshot_id, kind, native_identity)
);
CREATE TABLE IF NOT EXISTS edges (
  edge_id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES snapshots(snapshot_id),
  kind TEXT NOT NULL,
  source_id TEXT NOT NULL REFERENCES nodes(hima_id),
  target_id TEXT NOT NULL REFERENCES nodes(hima_id),
  attributes_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS edges_source ON edges(snapshot_id, source_id);
CREATE INDEX IF NOT EXISTS edges_target ON edges(snapshot_id, target_id);
CREATE TABLE IF NOT EXISTS hyperedges (
  hyperedge_id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES snapshots(snapshot_id),
  kind TEXT NOT NULL,
  native_identity TEXT NOT NULL,
  attributes_json TEXT NOT NULL,
  UNIQUE(snapshot_id, kind, native_identity)
);
CREATE TABLE IF NOT EXISTS hyperedge_members (
  hyperedge_id TEXT NOT NULL REFERENCES hyperedges(hyperedge_id),
  node_id TEXT NOT NULL REFERENCES nodes(hima_id),
  role TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  PRIMARY KEY(hyperedge_id, role, ordinal),
  UNIQUE(hyperedge_id, node_id, role)
);
CREATE TABLE IF NOT EXISTS geometry_map (
  geometry_id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL UNIQUE REFERENCES nodes(hima_id)
);
CREATE VIRTUAL TABLE IF NOT EXISTS geometry_rtree USING rtree(
  geometry_id, min_x, max_x, min_y, max_y
);
CREATE TABLE IF NOT EXISTS annotations (
  annotation_id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES snapshots(snapshot_id),
  layer TEXT NOT NULL CHECK (layer IN (
    'derived-structure', 'opportunity', 'local-proxy', 'decision',
    'commercial-response', 'invalidation')),
  annotation_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  base_graph_sha256 TEXT NOT NULL,
  cross_phase_map_sha256 TEXT,
  producer_code_sha256 TEXT NOT NULL,
  method_version TEXT NOT NULL,
  phase TEXT NOT NULL,
  inputs_json TEXT NOT NULL,
  units_json TEXT NOT NULL,
  assumptions_json TEXT NOT NULL,
  value_json TEXT NOT NULL,
  uncertainty_json TEXT NOT NULL,
  status TEXT NOT NULL,
  run_id TEXT NOT NULL,
  iteration INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS annotation_scope (
  annotation_id TEXT NOT NULL REFERENCES annotations(annotation_id),
  object_id TEXT NOT NULL,
  object_kind TEXT NOT NULL CHECK (object_kind IN ('node', 'edge', 'hyperedge')),
  PRIMARY KEY(annotation_id, object_id, object_kind)
);
CREATE INDEX IF NOT EXISTS annotation_scope_object ON annotation_scope(object_id);
CREATE TABLE IF NOT EXISTS annotation_lineage (
  annotation_id TEXT NOT NULL REFERENCES annotations(annotation_id),
  source_annotation_id TEXT NOT NULL REFERENCES annotations(annotation_id),
  PRIMARY KEY(annotation_id, source_annotation_id),
  CHECK(annotation_id <> source_annotation_id)
);
CREATE TABLE IF NOT EXISTS cross_phase_maps (
  map_id TEXT PRIMARY KEY,
  place_snapshot_id TEXT NOT NULL REFERENCES snapshots(snapshot_id),
  postroute_snapshot_id TEXT NOT NULL REFERENCES snapshots(snapshot_id),
  place_graph_sha256 TEXT NOT NULL,
  postroute_graph_sha256 TEXT NOT NULL,
  map_sha256 TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS correspondences (
  map_id TEXT NOT NULL REFERENCES cross_phase_maps(map_id),
  source_id TEXT NOT NULL,
  target_id TEXT,
  relation_type TEXT NOT NULL CHECK (relation_type IN (
    'one-to-one', 'one-to-many', 'many-to-one', 'semantic-region',
    'ambiguous', 'absent')),
  confidence REAL NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
  evidence_json TEXT NOT NULL,
  unmatched_reason TEXT,
  PRIMARY KEY(map_id, source_id, target_id)
);
CREATE TABLE IF NOT EXISTS local_windows (
  window_id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES snapshots(snapshot_id),
  base_graph_sha256 TEXT NOT NULL,
  request_json TEXT NOT NULL,
  projection_json TEXT NOT NULL,
  projection_sha256 TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS annotations_no_update
BEFORE UPDATE ON annotations BEGIN SELECT RAISE(ABORT, 'annotations are append-only'); END;
CREATE TRIGGER IF NOT EXISTS annotations_no_delete
BEFORE DELETE ON annotations BEGIN SELECT RAISE(ABORT, 'annotations are append-only'); END;
"""


class DigStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.connection = sqlite3.connect(str(self.path))
        self.connection.row_factory = sqlite3.Row
        self.connection.executescript(SCHEMA)
        with self.connection:
            self.connection.execute(
                "INSERT OR IGNORE INTO schema_meta(key,value) VALUES('schema_version',?)",
                (str(SCHEMA_VERSION),),
            )

    def close(self):
        self.connection.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        self.close()

    def add_snapshot(self, snapshot):
        expected = {"snapshot_id", "phase", "design_name", "top_module",
                    "bundle_sha256", "graph_sha256", "completeness", "units", "manifest"}
        missing = expected - set(snapshot)
        if missing:
            raise DigStoreError("snapshot missing: %s" % ", ".join(sorted(missing)))
        with self.connection:
            self.connection.execute(
                "INSERT INTO snapshots VALUES(?,?,?,?,?,?,?,?,?)",
                (snapshot["snapshot_id"], snapshot["phase"], snapshot["design_name"],
                 snapshot["top_module"], snapshot["bundle_sha256"], snapshot["graph_sha256"],
                 snapshot["completeness"], canonical_json(snapshot["units"]),
                 canonical_json(snapshot["manifest"])),
            )

    def add_node(self, snapshot_id, kind, native_identity, attributes, geometry=None):
        node_id = hima_id(snapshot_id, kind, native_identity)
        with self.connection:
            cursor = self.connection.execute(
                "INSERT INTO nodes(hima_id,snapshot_id,kind,native_identity,attributes_json) VALUES(?,?,?,?,?)",
                (node_id, snapshot_id, kind, native_identity, canonical_json(attributes)),
            )
            if geometry is not None:
                values = tuple(float(geometry[key]) for key in ("min_x", "max_x", "min_y", "max_y"))
                if values[0] > values[1] or values[2] > values[3]:
                    raise DigStoreError("invalid geometry for %s" % native_identity)
                geometry_id = self.connection.execute(
                    "INSERT INTO geometry_map(node_id) VALUES(?)", (node_id,)
                ).lastrowid
                self.connection.execute(
                    "INSERT INTO geometry_rtree VALUES(?,?,?,?,?)", (geometry_id, *values)
                )
        return node_id

    def add_edge(self, snapshot_id, kind, source_id, target_id, attributes=None):
        payload = {"snapshot": snapshot_id, "kind": kind, "source": source_id,
                   "target": target_id, "attributes": attributes or {}}
        edge_id = "edge:" + sha256_json(payload)
        with self.connection:
            self.connection.execute(
                "INSERT INTO edges VALUES(?,?,?,?,?,?)",
                (edge_id, snapshot_id, kind, source_id, target_id,
                 canonical_json(attributes or {})),
            )
        return edge_id

    def add_hyperedge(self, snapshot_id, kind, native_identity, members, attributes=None):
        hyperedge_id = hima_id(snapshot_id, "hyperedge:" + kind, native_identity)
        with self.connection:
            self.connection.execute(
                "INSERT INTO hyperedges VALUES(?,?,?,?,?)",
                (hyperedge_id, snapshot_id, kind, native_identity,
                 canonical_json(attributes or {})),
            )
            for ordinal, member in enumerate(members):
                self.connection.execute(
                    "INSERT INTO hyperedge_members VALUES(?,?,?,?)",
                    (hyperedge_id, member["node_id"], member["role"], ordinal),
                )
        return hyperedge_id

    def graph_sha256(self, snapshot_id):
        snapshot = self.connection.execute(
            "SELECT graph_sha256 FROM snapshots WHERE snapshot_id=?", (snapshot_id,)
        ).fetchone()
        if snapshot is None:
            raise DigStoreError("unknown snapshot %s" % snapshot_id)
        return snapshot[0]

    def add_annotation(self, annotation):
        required = {"annotation_id", "snapshot_id", "layer", "annotation_type",
                    "base_graph_sha256", "producer_code_sha256", "method_version",
                    "phase", "inputs", "units", "assumptions", "value_vector",
                    "uncertainty", "status", "run_id", "iteration"}
        missing = required - set(annotation)
        if missing:
            raise DigStoreError("annotation missing: %s" % ", ".join(sorted(missing)))
        if annotation["base_graph_sha256"] != self.graph_sha256(annotation["snapshot_id"]):
            raise DigStoreError("annotation base graph hash does not match snapshot")
        scope = annotation.get("scope", [])
        sources = annotation.get("source_annotation_ids", [])
        with self.connection:
            self.connection.execute(
                "INSERT INTO annotations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (annotation["annotation_id"], annotation["snapshot_id"], annotation["layer"],
                 annotation["annotation_type"], int(annotation.get("schema_version", 1)),
                 annotation["base_graph_sha256"], annotation.get("cross_phase_map_sha256"),
                 annotation["producer_code_sha256"], annotation["method_version"],
                 annotation["phase"], canonical_json(annotation["inputs"]),
                 canonical_json(annotation["units"]), canonical_json(annotation["assumptions"]),
                 canonical_json(annotation["value_vector"]), canonical_json(annotation["uncertainty"]),
                 annotation["status"], annotation["run_id"], int(annotation["iteration"])),
            )
            for row in scope:
                self.connection.execute(
                    "INSERT INTO annotation_scope VALUES(?,?,?)",
                    (annotation["annotation_id"], row["object_id"], row["object_kind"]),
                )
            for source in sources:
                self.connection.execute(
                    "INSERT INTO annotation_lineage VALUES(?,?)",
                    (annotation["annotation_id"], source),
                )

    def neighborhood(self, snapshot_id, seeds, hops):
        if hops < 0 or hops > 8:
            raise DigStoreError("hops must be between 0 and 8")
        present = {row[0] for row in self.connection.execute(
            "SELECT hima_id FROM nodes WHERE snapshot_id=?", (snapshot_id,)
        )}
        seeds = set(seeds)
        missing = seeds - present
        if missing:
            raise DigStoreError("window seeds absent from snapshot: %s" % sorted(missing))
        selected = set(seeds)
        frontier = set(seeds)
        for _ in range(hops):
            if not frontier:
                break
            marks = ",".join("?" for _ in frontier)
            params = [snapshot_id, *sorted(frontier), *sorted(frontier)]
            rows = self.connection.execute(
                "SELECT source_id,target_id FROM edges WHERE snapshot_id=? "
                "AND (source_id IN (%s) OR target_id IN (%s))" % (marks, marks), params
            )
            next_frontier = {value for row in rows for value in row} - selected
            selected.update(next_frontier)
            frontier = next_frontier
        return selected

    def project_local_window(self, snapshot_id, seeds, backward_hops=1,
                             forward_hops=1, required_attributes=None,
                             endpoint_alternatives=None):
        hops = max(int(backward_hops), int(forward_hops))
        selected = self.neighborhood(snapshot_id, seeds, hops)
        marks = ",".join("?" for _ in selected)
        nodes = []
        for row in self.connection.execute(
                "SELECT hima_id,kind,native_identity,attributes_json FROM nodes "
                "WHERE hima_id IN (%s) ORDER BY hima_id" % marks, sorted(selected)):
            attrs = json.loads(row[3])
            required = (required_attributes or {}).get(row[1], [])
            missing = [name for name in required if name not in attrs]
            if missing:
                raise DigStoreError("LocalWindow missing %s attributes %s" % (row[0], missing))
            nodes.append({"hima_id": row[0], "kind": row[1],
                          "native_identity": row[2], "attributes": attrs})
        edges = [dict(row) for row in self.connection.execute(
            "SELECT edge_id,kind,source_id,target_id,attributes_json FROM edges "
            "WHERE source_id IN (%s) AND target_id IN (%s) ORDER BY edge_id" % (marks, marks),
            [*sorted(selected), *sorted(selected)],
        )]
        for row in edges:
            row["attributes"] = json.loads(row.pop("attributes_json"))
        request = {"seeds": sorted(seeds), "backward_hops": int(backward_hops),
                   "forward_hops": int(forward_hops),
                   "required_attributes": required_attributes or {},
                   "endpoint_alternatives": endpoint_alternatives or []}
        projection = {"schema": "hima.dig-local-window/1", "snapshot_id": snapshot_id,
                      "base_graph_sha256": self.graph_sha256(snapshot_id),
                      "request": request, "nodes": nodes, "edges": edges}
        projection_hash = sha256_json(projection)
        window_id = "window:" + projection_hash
        with self.connection:
            self.connection.execute(
                "INSERT OR IGNORE INTO local_windows VALUES(?,?,?,?,?,?)",
                (window_id, snapshot_id, projection["base_graph_sha256"],
                 canonical_json(request), canonical_json(projection), projection_hash),
            )
        projection["window_id"] = window_id
        projection["projection_sha256"] = projection_hash
        return projection

    def nearby_nodes(self, snapshot_id, min_x, max_x, min_y, max_y):
        rows = self.connection.execute(
            "SELECT n.hima_id FROM geometry_rtree r "
            "JOIN geometry_map m ON m.geometry_id=r.geometry_id "
            "JOIN nodes n ON n.hima_id=m.node_id "
            "WHERE n.snapshot_id=? AND r.max_x>=? AND r.min_x<=? "
            "AND r.max_y>=? AND r.min_y<=? ORDER BY n.hima_id",
            (snapshot_id, float(min_x), float(max_x), float(min_y), float(max_y)),
        )
        return [row[0] for row in rows]


def store_projection(path, projection, validated=False):
    """Create a complete store from a normalized deterministic projection."""
    from design_information_graph import validate_projection  # local import avoids a cycle

    normalized = projection if validated else validate_projection(projection)
    snapshot = normalized["snapshot"]
    with DigStore(path) as store:
        store.add_snapshot(snapshot)
        identities = {}
        # One transaction is essential at AES scale.  Public per-object helpers
        # remain useful for incremental updates, but importing a snapshot must
        # not fsync hundreds of thousands of times.
        with store.connection:
            for node in normalized["nodes"]:
                node_id = hima_id(snapshot["snapshot_id"], node["kind"], node["native_identity"])
                store.connection.execute(
                    "INSERT INTO nodes(hima_id,snapshot_id,kind,native_identity,attributes_json) VALUES(?,?,?,?,?)",
                    (node_id, snapshot["snapshot_id"], node["kind"], node["native_identity"],
                     canonical_json(node["attributes"])),
                )
                identities[(node["kind"], node["native_identity"])] = node_id
                if node.get("geometry") is not None:
                    geometry_id = store.connection.execute(
                        "INSERT INTO geometry_map(node_id) VALUES(?)", (node_id,)
                    ).lastrowid
                    geometry = node["geometry"]
                    store.connection.execute(
                        "INSERT INTO geometry_rtree VALUES(?,?,?,?,?)",
                        (geometry_id, geometry["min_x"], geometry["max_x"],
                         geometry["min_y"], geometry["max_y"]),
                    )
            for edge in normalized["edges"]:
                source = identities[(edge["source_kind"], edge["source_native_identity"])]
                target = identities[(edge["target_kind"], edge["target_native_identity"])]
                payload = {"snapshot": snapshot["snapshot_id"], "kind": edge["kind"],
                           "source": source, "target": target, "attributes": edge["attributes"]}
                store.connection.execute(
                    "INSERT INTO edges VALUES(?,?,?,?,?,?)",
                    ("edge:" + sha256_json(payload), snapshot["snapshot_id"], edge["kind"],
                     source, target, canonical_json(edge["attributes"])),
                )
            for hyperedge in normalized["hyperedges"]:
                hyperedge_id = hima_id(snapshot["snapshot_id"], "hyperedge:" + hyperedge["kind"],
                                       hyperedge["native_identity"])
                store.connection.execute(
                    "INSERT INTO hyperedges VALUES(?,?,?,?,?)",
                    (hyperedge_id, snapshot["snapshot_id"], hyperedge["kind"],
                     hyperedge["native_identity"], canonical_json(hyperedge["attributes"])),
                )
                for ordinal, row in enumerate(hyperedge["members"]):
                    store.connection.execute(
                        "INSERT INTO hyperedge_members VALUES(?,?,?,?)",
                        (hyperedge_id, identities[(row["kind"], row["native_identity"])],
                         row["role"], ordinal),
                    )
    return snapshot
