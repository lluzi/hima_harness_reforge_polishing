#!/usr/bin/env python3
"""Apply the unchanged actually executed selector to held-out real candidate subsets.

Inputs remain private. This proves finite data dependence, not an optimal strategy or PPA benefit.
"""
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

source, code_path, out = map(Path, sys.argv[1:4])
code = code_path.read_bytes()
expected_code = "3b8befdd3b4467bdeeee9d31d572f2f1e9aa074b42acdea858681bdb59a5a3c6"
assert hashlib.sha256(code).hexdigest() == expected_code, "use the actually executed V4 code"
repo = Path(__file__).resolve().parent.parent
template = repo / "packs/aes-tsmc28-dtco/flow/selection-template.py"
def scaffold(raw):
    tree = ast.parse(raw)
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == "choose":
            node.body = [ast.Pass()]
    return ast.dump(tree)
assert scaffold(code) == scaffold(template.read_bytes()), "only the research choose() function changed"
spec = importlib.util.spec_from_file_location("executed_selector", code_path)
selector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(selector)
sys.path.insert(0, str(repo / "packs/aes-tsmc28-dtco/flow/domain"))
from cell_need_miner.generator_contract import validate_generation_request

results = []
before = source.read_bytes()
for route, supplied in json.loads(before).items():
    raw = json.loads(supplied["raw"])
    actual = supplied["selection"]
    raw_hash = hashlib.sha256(supplied["raw"].encode()).hexdigest()
    assert actual["sourceSha256"] == raw_hash
    requests = raw["generation_requests"]
    assert selector.choose(requests, route) == actual["selected"], "same program reproduces its actual selection"
    omitted = actual["selected"][0]
    subset = [row for row in requests if row["candidate_id"] != omitted]
    selected = selector.choose(subset, route)
    by_id = {row["candidate_id"]: row for row in subset}
    assert 0 < len(selected) <= 2 and len(selected) == len(set(selected))
    assert omitted not in selected and all(name in by_id for name in selected)
    assert all(not validate_generation_request(by_id[name]) for name in selected)
    results.append({"route": route, "sourceSha256": raw_hash, "originalCount": len(requests),
                    "withheld": omitted, "subsetCount": len(subset), "selected": selected,
                    "originalSelectionReproduced": True, "validExactContracts": True})
assert len(results) == 6
assert source.read_bytes() == before and code_path.read_bytes() == code
out.write_text(json.dumps({"passed": True, "codeSha256": expected_code,
    "scope": "unchanged selector over six real seven-candidate subsets; no optimality or PPA claim",
    "hosts": 0, "modelRequests": 0, "edaJobs": 0, "results": results}, indent=2) + "\n")
print("six-route held-out subset audit PASS; zero model/EDA requests")
