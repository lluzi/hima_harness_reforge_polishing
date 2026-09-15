#!/usr/bin/env python3
"""Audit the retained AI discovery program and source-linked selection; no model/EDA."""
import ast
import hashlib
import json
from pathlib import Path
import sys

ROUTES = {
    "timing_criticality", "timing_context", "structure_frequency",
    "structure_compaction", "mapper_compatibility", "functional_diversity",
}


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def scaffold(raw):
    tree = ast.parse(raw)
    research = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "research"]
    assert len(research) == 1, "entry must define research() exactly once"
    assert [arg.arg for arg in research[0].args.args] == ["candidates", "context"], "research signature changed"
    body = research[0]
    names = {node.id for node in ast.walk(body) if isinstance(node, ast.Name)}
    assert {"candidates", "context"} <= names, "research algorithm must use current candidates and context"
    return tree, body


def check(manifest_path, output):
    original = manifest_path.read_bytes()
    manifest = json.loads(original)
    code_path, report_path = Path(manifest["code"]), Path(manifest["research"])
    code, report_raw = code_path.read_bytes(), report_path.read_bytes()
    assert sha(code) == manifest["codeSha256"]
    assert sha(report_raw) == manifest["researchSha256"]
    report = json.loads(report_raw)
    assert report["schema"] == "custom-cell-fmax-ai-research/1"
    assert report["algorithm"]["entrySha256"] == sha(code)
    assert report["target"]["path_group"] == "reg2reg"
    assert report["target"]["reg2reg_path_count"] > 0
    assert 3 <= len(report["hypotheses"]) <= 12
    tree, _research = scaffold(code)
    literals = {node.value for node in ast.walk(tree) if isinstance(node, ast.Constant) and isinstance(node.value, str)}
    raws, available = {}, set()
    for route, row in manifest["sources"].items():
        assert route in ROUTES
        raw = Path(row["raw"]).read_bytes()
        assert sha(raw) == row["rawSha256"] == report["sources"][route]["rawSha256"]
        document = json.loads(raw)
        assert document["strategy_id"] == route
        ids = {candidate["candidate_id"] for candidate in document["generation_requests"]}
        assert not ids.intersection(literals), "research code embeds current candidate identity"
        available.update((route, candidate) for candidate in ids)
        raws[route] = len(ids)
    selected = [(row["route"], row["candidate_id"]) for row in report["selected"]]
    assert len(selected) == len(set(selected)) and set(selected) <= available
    assert 1 <= len(selected) <= manifest["maxCells"] <= 50
    assert manifest_path.read_bytes() == original
    evidence = {
        "status": "passed",
        "scope": "retained AI code/source/selection audit; no optimality, adoption or PPA claim",
        "modelRequests": 0,
        "edaJobs": 0,
        "auditorSha256": sha(Path(__file__).read_bytes()),
        "algorithmSha256": sha(code),
        "researchSha256": sha(report_raw),
        "candidatePools": raws,
        "hypothesisCount": len(report["hypotheses"]),
        "selectedCount": len(selected),
    }
    output.write_text(json.dumps(evidence, indent=2, sort_keys=True) + "\n")
    print("retained AI research audit PASS; zero model/EDA requests")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: audit-dtco-ai-research.py <retained-manifest.json> <fresh-output.json>")
    target = Path(sys.argv[2])
    if target.exists():
        raise SystemExit("refusing to overwrite existing audit evidence")
    check(Path(sys.argv[1]), target)
