#!/usr/bin/env python3
"""Auditable correspondence between immutable place and post-route DIGs."""

from __future__ import annotations

import json
import argparse
from pathlib import Path

from dig_store import DigStore, canonical_json, sha256_json


class CrossPhaseError(ValueError):
    pass


MAX_AMBIGUOUS_CANDIDATES = 16


def project_opportunity_region(mapping, opportunity):
    """Project a post-route subgraph to candidate place IDs, never ECO targets."""
    if mapping.get("schema") != "hima.dig-cross-phase-map/1":
        raise CrossPhaseError("unsupported CrossPhaseMap")
    source_ids = list(opportunity.get("cone_instance_ids") or opportunity.get("scope_nodes") or ())
    if not source_ids:
        raise CrossPhaseError("opportunity has no post-route source region")
    by_source = {}
    for row in mapping.get("correspondences", []):
        by_source.setdefault(row["source_id"], []).append(row)
    targets, absent, ambiguous = set(), [], []
    evidence = []
    for source in source_ids:
        rows = by_source.get(source, [])
        admitted = [row for row in rows if row["relation_type"] in {
            "one-to-one", "one-to-many", "many-to-one", "semantic-region"
        } and row.get("target_id")]
        uncertain = [row for row in rows if row["relation_type"] == "ambiguous"]
        if len(admitted) == 1:
            targets.add(admitted[0]["target_id"])
            evidence.append(admitted[0])
        elif uncertain or len(admitted) > 1:
            ambiguous.append(source)
        else:
            absent.append(source)
    return {
        "schema": "hima.dig-place-candidate-region/1",
        "postroute_opportunity_id": opportunity.get("opportunity_id") or opportunity.get("endpoint_id"),
        "cross_phase_map_sha256": mapping["map_sha256"],
        "source_node_count": len(source_ids), "mapped_node_count": len(evidence),
        "candidate_region_hima_ids": sorted(targets),
        "absent_source_ids": sorted(absent), "ambiguous_source_ids": sorted(ambiguous),
        "coverage": len(evidence) / len(source_ids),
        "status": "projected" if targets and not ambiguous else "partial",
        "claim_limits": {"exact_eco_target": False, "place_revalidation_required": True},
    }


def _nodes(connection, snapshot_id):
    return [{"hima_id": row[0], "kind": row[1], "native_identity": row[2],
             "attributes": json.loads(row[3])}
            for row in connection.execute(
                "SELECT hima_id,kind,native_identity,attributes_json FROM nodes "
                "WHERE snapshot_id=? ORDER BY kind,native_identity", (snapshot_id,))]


def build_cross_phase_map(store, place_snapshot_id, postroute_snapshot_id, post_store=None,
                          persist=True):
    place_connection = store.connection
    post_connection = (post_store or store).connection
    place_snapshot = place_connection.execute(
        "SELECT phase,graph_sha256 FROM snapshots WHERE snapshot_id=?", (place_snapshot_id,)
    ).fetchone()
    post_snapshot = post_connection.execute(
        "SELECT phase,graph_sha256 FROM snapshots WHERE snapshot_id=?", (postroute_snapshot_id,)
    ).fetchone()
    if place_snapshot is None or place_snapshot[0] != "place":
        raise CrossPhaseError("place snapshot identity is invalid")
    if post_snapshot is None or post_snapshot[0] != "postroute":
        raise CrossPhaseError("post-route snapshot identity is invalid")
    place = _nodes(place_connection, place_snapshot_id)
    post = _nodes(post_connection, postroute_snapshot_id)
    exact = {(row["kind"], row["native_identity"]): row for row in place}
    signatures = {}
    for row in place:
        signature = row["attributes"].get("semantic_signature")
        if signature:
            signatures.setdefault((row["kind"], signature), []).append(row)

    correspondences = []
    matched_place = set()
    for source in post:
        target = exact.get((source["kind"], source["native_identity"]))
        if target is not None:
            matched_place.add(target["hima_id"])
            correspondences.append({
                "source_id": source["hima_id"], "target_id": target["hima_id"],
                "relation_type": "one-to-one", "confidence": 1.0,
                "evidence": {"native_identity": source["native_identity"]},
                "unmatched_reason": None,
            })
            continue
        signature = source["attributes"].get("semantic_signature")
        candidates = signatures.get((source["kind"], signature), []) if signature else []
        if len(candidates) == 1:
            matched_place.add(candidates[0]["hima_id"])
            correspondences.append({
                "source_id": source["hima_id"], "target_id": candidates[0]["hima_id"],
                "relation_type": "semantic-region", "confidence": 0.75,
                "evidence": {"semantic_signature": signature}, "unmatched_reason": None,
            })
        elif 1 < len(candidates) <= MAX_AMBIGUOUS_CANDIDATES:
            for candidate in candidates:
                correspondences.append({
                    "source_id": source["hima_id"], "target_id": candidate["hima_id"],
                    "relation_type": "ambiguous", "confidence": 1.0 / len(candidates),
                    "evidence": {"semantic_signature": signature,
                                 "candidate_count": len(candidates)},
                    "unmatched_reason": "multiple-semantic-regions",
                })
        else:
            correspondences.append({
                "source_id": source["hima_id"], "target_id": None,
                "relation_type": "absent", "confidence": 0.0,
                "evidence": ({"semantic_signature": signature,
                              "candidate_count": len(candidates)} if candidates else {}),
                "unmatched_reason": ("semantic-signature-nonunique"
                                     if len(candidates) > MAX_AMBIGUOUS_CANDIDATES
                                     else "no-identity-or-semantic-match"),
            })

    target_sources = {}
    for row in correspondences:
        if row["target_id"] and row["relation_type"] != "ambiguous":
            target_sources.setdefault(row["target_id"], []).append(row)
    for rows in target_sources.values():
        if len(rows) > 1:
            for row in rows:
                row["relation_type"] = "many-to-one"
                row["evidence"]["source_count"] = len(rows)

    payload = {"schema": "hima.dig-cross-phase-map/1",
               "place_snapshot_id": place_snapshot_id,
               "postroute_snapshot_id": postroute_snapshot_id,
               "place_graph_sha256": place_snapshot[1],
               "postroute_graph_sha256": post_snapshot[1],
               "correspondences": sorted(correspondences, key=canonical_json)}
    payload["map_sha256"] = sha256_json(payload)
    payload["map_id"] = "cross-phase:" + payload["map_sha256"]
    if persist and post_store is not None:
        raise CrossPhaseError("cross-database maps must be persisted as their hash-bound projection")
    if persist:
        with place_connection:
            place_connection.execute(
                "INSERT INTO cross_phase_maps VALUES(?,?,?,?,?,?)",
                (payload["map_id"], place_snapshot_id, postroute_snapshot_id,
                 place_snapshot[1], post_snapshot[1], payload["map_sha256"]),
            )
            for row in payload["correspondences"]:
                place_connection.execute(
                    "INSERT INTO correspondences VALUES(?,?,?,?,?,?,?)",
                    (payload["map_id"], row["source_id"], row["target_id"],
                     row["relation_type"], row["confidence"], canonical_json(row["evidence"]),
                     row["unmatched_reason"]),
                )
    return payload


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--place-database", required=True)
    parser.add_argument("--postroute-database", required=True)
    parser.add_argument("--place-snapshot", required=True)
    parser.add_argument("--postroute-snapshot", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    with DigStore(args.place_database) as place, DigStore(args.postroute_database) as post:
        mapping = build_cross_phase_map(place, args.place_snapshot, args.postroute_snapshot,
                                        post_store=post, persist=False)
    Path(args.output).write_text(json.dumps(mapping, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"map_id": mapping["map_id"], "map_sha256": mapping["map_sha256"],
                      "correspondence_count": len(mapping["correspondences"])}, sort_keys=True))


if __name__ == "__main__":
    main()
