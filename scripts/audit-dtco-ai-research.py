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
    assert report["target"]["source_phase"] in {"dc-probe", "generated-postroute"}
    assert report["target"]["target_gain_pct"] == 5
    assert 3 <= len(report["hypotheses"]) <= 12
    tree, _research = scaffold(code)
    literals = {node.value for node in ast.walk(tree) if isinstance(node, ast.Constant) and isinstance(node.value, str)}
    raws, available, identities, unique = {}, set(), {}, set()
    raw_count = 0
    for route, row in manifest["sources"].items():
        assert route in ROUTES
        raw = Path(row["raw"]).read_bytes()
        assert sha(raw) == row["rawSha256"] == report["sources"][route]["rawSha256"]
        document = json.loads(raw)
        assert document["strategy_id"] == route
        ids = {candidate["candidate_id"] for candidate in document["generation_requests"]}
        assert not ids.intersection(literals), "research code embeds current candidate identity"
        available.update((route, candidate) for candidate in ids)
        for candidate in document["generation_requests"]:
            if (candidate.get("implementation_plan") or {}).get("route") not in {
                    "fusion", "cluster_compose", "boolean_synthesis"}:
                continue
            contract = candidate.get("generator_contract") or {}
            reference = contract.get("equivalence_reference") or {}
            key = (reference.get("digest"), tuple(reference.get("output_order") or ()),
                   json.dumps(contract.get("target_library_profile") or {}, sort_keys=True, separators=(",", ":")))
            if key[0]:
                identities[(route, candidate["candidate_id"])] = key
                unique.add(key)
                raw_count += 1
        raws[route] = len(ids)
    selected = [(row["route"], row["candidate_id"]) for row in report["selected"]]
    assert len(selected) == len(set(selected)) and set(selected) <= available
    selected_keys = [identities[key] for key in selected]
    assert len(selected_keys) == len(set(selected_keys)), "research selected an equivalent Cell twice"
    retained = report.get("retainedCandidates")
    assert isinstance(retained, list) and len(retained) <= manifest["maxCells"] // 2
    retained_ids = [row.get("candidate_id") for row in retained if isinstance(row, dict)]
    assert len(retained_ids) == len(retained) == len(set(retained_ids))
    assert len(selected) == min(manifest["maxCells"] - len(retained), report["algorithm"]["candidatePoolCount"]) <= 50
    assert len(selected) <= report["algorithm"]["candidatePoolCount"] <= len(unique)
    assert report["algorithm"]["rawCandidateCount"] == raw_count
    estimates = report.get("theoreticalEstimates")
    assert isinstance(estimates, list) and len(estimates) == len(selected)
    assert [(row.get("route"), row.get("candidate_id")) for row in estimates] == selected
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
        "rawCandidateCount": raw_count,
        "uniqueCandidateCount": len(unique),
        "hypothesisCount": len(report["hypotheses"]),
        "selectedCount": len(selected),
        "retainedCandidateCount": len(retained),
        "sourcePhase": report["target"]["source_phase"],
        "targetGainPct": report["target"]["target_gain_pct"],
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
