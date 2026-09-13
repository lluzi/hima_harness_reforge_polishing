#!/usr/bin/env python3
"""Independently validate a finite AES candidate selection; never trust reported scores."""
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path


def fail(reason: str) -> None:
    raise SystemExit(f"selection reader refused: {reason}")


def no_duplicates(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            fail(f"duplicate JSON key {key!r}")
        value[key] = item
    return value


def load_json(path: Path):
    try:
        return json.loads(path.read_text(), object_pairs_hook=no_duplicates)
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        fail(f"cannot read {path.name}: {error}")


report, output = map(Path, sys.argv[1:3])
sample_path = report.parent / "sample.json"
selection = load_json(report)
sample = load_json(sample_path)
if not isinstance(sample, dict):
    fail("sample must be an object")
if not isinstance(selection, dict) or set(selection) != {"sampleSha256", "selected"}:
    fail("selection schema must contain only sampleSha256 and selected")
if not isinstance(selection["sampleSha256"], str) or not isinstance(selection["selected"], list):
    fail("selection fields have invalid types")
digest = hashlib.sha256(sample_path.read_bytes()).hexdigest()
if selection["sampleSha256"] != digest:
    fail("sampleSha256 does not match the declared sample")
candidates = sample.get("candidates") if isinstance(sample, dict) else None
budget = sample.get("budget") if isinstance(sample, dict) else None
if sample.get("schema") != "aes-path-motifs/1":
    fail("sample schema is not aes-path-motifs/1")
paths = sample.get("paths") if isinstance(sample, dict) else None
if not isinstance(candidates, list) or not isinstance(paths, list) or type(budget) is not int or budget < 0:
    fail("sample has no valid candidates and budget")
path_points = {}
for path in paths:
    if not isinstance(path, dict) or not isinstance(path.get("id"), str) or not isinstance(path.get("points"), list):
        fail("sample path has invalid id or points")
    if path["id"] in path_points:
        fail("sample has duplicate path id")
    points = path["points"]
    if not points or not all(isinstance(point, dict) and isinstance(point.get("instance"), str) and isinstance(point.get("master"), str) and type(point.get("sourceLine")) is int for point in points):
        fail(f"path {path['id']} has invalid point provenance")
    path_points[path["id"]] = points
by_id = {}
for candidate in candidates:
    if not isinstance(candidate, dict) or not isinstance(candidate.get("id"), str):
        fail("sample candidate has no valid id")
    if candidate["id"] in by_id:
        fail("sample has duplicate candidate id")
    cells, masters, occurrences = candidate.get("cells"), candidate.get("masters"), candidate.get("occurrences")
    if not isinstance(cells, list) or not cells or not all(isinstance(cell, str) for cell in cells) or len(cells) != len(set(cells)):
        fail(f"candidate {candidate['id']} has invalid cells")
    if not isinstance(masters, list) or len(masters) != len(cells) or not all(isinstance(master, str) for master in masters):
        fail(f"candidate {candidate['id']} has invalid masters")
    if not isinstance(occurrences, list) or not occurrences:
        fail(f"candidate {candidate['id']} has invalid occurrence references")
    for item in occurrences:
        if not isinstance(item, dict) or set(item) != {"path", "begin", "sourceLines"} or not isinstance(item.get("path"), str) or type(item.get("begin")) is not int or not isinstance(item.get("sourceLines"), list) or not item["sourceLines"] or not all(type(line) is int for line in item["sourceLines"]):
            fail(f"candidate {candidate['id']} has invalid occurrence references")
        points = path_points.get(item["path"])
        if points is None:
            fail(f"candidate {candidate['id']} references unknown path")
        begin = item["begin"]
        referenced = points[begin:begin + len(cells)] if begin >= 0 else []
        if (len(referenced) != len(cells)
                or [point["instance"] for point in referenced] != cells
                or [point["master"] for point in referenced] != masters
                or [point["sourceLine"] for point in referenced] != item["sourceLines"]):
            fail(f"candidate {candidate['id']} occurrence does not match the indexed path slice")
    by_id[candidate["id"]] = candidate
ids = selection["selected"]
if not all(isinstance(candidate_id, str) for candidate_id in ids):
    fail("selected ids must be strings")
if len(ids) != len(set(ids)):
    fail("selected ids are duplicated")
if len(ids) > budget:
    fail("selected ids exceed sample budget")
if any(candidate_id not in by_id for candidate_id in ids):
    fail("selected ids include an unknown candidate")
chosen = [by_id[candidate_id] for candidate_id in ids]
physical = Counter(cell for candidate in chosen for cell in candidate["cells"])
conflicts = sum(count - 1 for count in physical.values() if count > 1)
score = sum(len(candidate["cells"]) * len({item["path"] for item in candidate["occurrences"]}) for candidate in chosen)
result = {"values": [
    {"type": "selection_score", "unit": "count", "value": score},
    {"type": "selected_count", "unit": "count", "value": len(chosen)},
    {"type": "conflict_count", "unit": "count", "value": conflicts},
]}
output.write_text(json.dumps(result, separators=(",", ":")) + "\n")
