#!/usr/bin/env python3
"""Check retained, actually executed selectors on changed candidate subsets; no EDA/model.

This proves bounded input dependence and provenance, not optimality or PPA benefit.
The input manifest is prepared from hash-verified Pack archive materials by the live audit.
"""
import ast
import hashlib
import importlib.util
import json
from pathlib import Path
import sys


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def scaffold(raw):
    tree = ast.parse(raw)
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == 'choose':
            node.body = [ast.Pass()]
    return ast.dump(tree)


def check(manifest_path, output):
    original_manifest = manifest_path.read_bytes()
    manifest = json.loads(original_manifest)
    template = Path(manifest['template']).read_bytes()
    assert sha(template) == manifest['templateSha256']
    expected_routes = {'timing_criticality', 'timing_context', 'structure_frequency',
                       'structure_compaction', 'mapper_compatibility', 'functional_diversity'}
    assert {row['route'] for row in manifest['selectors']} == expected_routes
    assert len(manifest['selectors']) == len(expected_routes)
    results = []
    changed = 0
    for index, row in enumerate(manifest['selectors']):
        code_path = Path(row['code'])
        code = code_path.read_bytes()
        raw_bytes = Path(row['raw']).read_bytes()
        selected_bytes = Path(row['selection']).read_bytes()
        assert sha(code) == row['codeSha256']
        assert sha(raw_bytes) == row['rawSha256']
        assert sha(selected_bytes) == row['selectionSha256']
        assert scaffold(code) == scaffold(template), 'only choose() may differ from the declared scaffold'
        raw = json.loads(raw_bytes)
        actual = json.loads(selected_bytes)
        assert actual['sourceSha256'] == sha(raw_bytes)
        candidates = raw['generation_requests']
        ids = {candidate['candidate_id'] for candidate in candidates}
        tree = ast.parse(code)
        choice = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'choose')
        literals = {node.value for node in ast.walk(choice) if isinstance(node, ast.Constant) and isinstance(node.value, str)}
        assert not ids.intersection(literals), 'selector embeds actual candidate identities as literals'
        module_spec = importlib.util.spec_from_file_location(f'retained_selector_{index}', code_path)
        module = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(module)
        reproduced = module.choose(candidates, row['route'])
        assert reproduced == actual['selected'], 'unchanged code must reproduce its retained selection'
        assert isinstance(reproduced, list) and len(reproduced) <= 2
        assert len(set(reproduced)) == len(reproduced) and set(reproduced) <= ids
        withheld = reproduced[:1]
        subset = [candidate for candidate in candidates if candidate['candidate_id'] not in withheld]
        alternative = module.choose(subset, row['route'])
        assert isinstance(alternative, list) and len(alternative) <= 2
        assert len(set(alternative)) == len(alternative)
        assert set(alternative) <= {candidate['candidate_id'] for candidate in subset}
        if withheld:
            assert alternative != reproduced, 'withheld evidence must change the valid selection'
            changed += 1
        assert code_path.read_bytes() == code and Path(row['raw']).read_bytes() == raw_bytes
        assert Path(row['selection']).read_bytes() == selected_bytes
        results.append({'route': row['route'], 'codeSha256': row['codeSha256'],
                        'sourceSha256': row['rawSha256'], 'originalCount': len(candidates),
                        'originalSelection': reproduced, 'withheld': withheld, 'subsetSelection': alternative})
    assert changed >= 1, 'at least one nonempty route must demonstrate changed-input behavior'
    assert manifest_path.read_bytes() == original_manifest
    output.write_text(json.dumps({'status': 'passed', 'scope': 'finite unchanged-code subset audit; no optimality or PPA claim',
                                  'modelRequests': 0, 'edaJobs': 0, 'results': results}, indent=2) + '\n')
    print('retained selector subset audit PASS; zero model/EDA requests')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('usage: audit-dtco-pilot-selectors.py <retained-input-manifest.json> <fresh-output.json>')
    output = Path(sys.argv[2])
    if output.exists():
        raise SystemExit('refusing to overwrite existing audit evidence')
    check(Path(sys.argv[1]), output)
