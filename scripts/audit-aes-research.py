#!/usr/bin/env python3
"""Check an executed research program on a held-out actual-data subset; no model or EDA."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--sample', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--generation', type=int, default=2, help='actual executed generation to audit (default preserves the original two-generation check)')
    parser.add_argument('--validation', type=Path, help='optional independent native evidence revalidation, bound by source SHA256')
    args = parser.parse_args()
    evidence = json.loads(args.evidence.read_text())
    if evidence.get('status') != 'passed':
        validation = json.loads(args.validation.read_text()) if args.validation else {}
        if validation.get('status') != 'passed' or validation.get('sourceSha256') != sha(args.evidence.read_bytes()) or validation.get('checks', {}).get('research-native') is not True:
            raise ValueError('research execution must first pass its native factual checks or a source-bound independent revalidation')
    workspace = Path(evidence['observed']['workspace'])
    original_sample = (workspace / 'sample.json').read_bytes()
    original_selection = (workspace / 'selection.json').read_bytes()
    sample_raw = args.sample.read_bytes()
    if sha(sample_raw) != evidence['observed']['sample']['sha256'] or sample_raw != original_sample:
        raise ValueError('the admitted original input identity differs')
    codes = [r for r in evidence['observed']['codeFiles'] if r['generation'] == args.generation]
    if len(codes) != 1:
        raise ValueError('this bounded audit expects one self-contained executed entry in the selected generation')
    code = codes[0]
    code_bytes = Path(code['path']).read_bytes()
    if sha(code_bytes) != code['sha256']:
        raise ValueError('executed code bytes changed')
    if str(workspace).encode() in code_bytes:
        raise ValueError('hardcoded original workspace prevents isolated data-dependence validation')
    selected = json.loads(original_selection)['selected']
    if not selected:
        raise ValueError('no actual selected object to withhold')
    removed = selected[0]
    sample = json.loads(sample_raw)
    sample['candidates'] = [r for r in sample['candidates'] if r['id'] != removed]
    if len(sample['candidates']) == len(json.loads(sample_raw)['candidates']):
        raise ValueError('the selected id is not in its source sample')
    args.out.mkdir(parents=True, exist_ok=False)
    study = args.out / 'held-out'; study.mkdir()
    entry = study / 'entry.py'; entry.write_bytes(code_bytes)
    (study / 'sample.json').write_text(json.dumps(sample, indent=2) + '\n')
    env = {k: v for k, v in os.environ.items() if not any(word in k.upper() for word in ('KEY', 'TOKEN', 'SECRET', 'PASSWORD'))}
    executed = subprocess.run([sys.executable, str(entry.resolve()), str(study.resolve()), '1'],
                              cwd=study, env=env, capture_output=True, timeout=30)
    (args.out / 'program.stdout').write_bytes(executed.stdout)
    (args.out / 'program.stderr').write_bytes(executed.stderr)
    if executed.returncode:
        raise ValueError('held-out execution failed; retained stdout/stderr')
    # Use the production reader for structural validity, then a separate exhaustive oracle.
    reader = Path(__file__).resolve().parents[1] / 'packs/aes-timing-research/tools/read-selection.py'
    checked = subprocess.run([sys.executable, str(reader), str((study / 'selection.json').resolve()),
                              str((study / 'reading.json').resolve())], capture_output=True, timeout=10)
    (args.out / 'reader.stderr').write_bytes(checked.stderr)
    if checked.returncode:
        raise ValueError('held-out selection failed the real reader')
    spec = importlib.util.spec_from_file_location('aes_handoff_oracle', Path(__file__).with_name('aes-probe-handoff.py'))
    oracle_module = importlib.util.module_from_spec(spec); spec.loader.exec_module(oracle_module)
    expected = oracle_module.oracle(sample['candidates'], sample['budget'])
    values = {r['type']: r['value'] for r in json.loads((study / 'reading.json').read_text())['values']}
    if values['conflict_count'] != 0 or values['selection_score'] != expected['bestScore']:
        raise ValueError('held-out result differs from the independent exhaustive optimum')
    if (workspace / 'sample.json').read_bytes() != original_sample or (workspace / 'selection.json').read_bytes() != original_selection:
        raise ValueError('original research input or result changed during audit')
    if sha(Path(code['path']).read_bytes()) != code['sha256']:
        raise ValueError('original executed code changed during audit')
    result = {'passed': True, 'sourceRun': evidence['observed']['runId'], 'executedCode': code,
              'originalSampleSha256': sha(original_sample), 'originalSelectionSha256': sha(original_selection),
              'heldOutSampleSha256': sha((study / 'sample.json').read_bytes()), 'removedCandidate': removed,
              'candidateCount': len(sample['candidates']), 'actualValues': values, 'oracle': expected,
              'modelRequests': 0, 'edaJobs': 0, 'localProgramExecutions': 1, 'localReaderExecutions': 1,
              'scope': 'one source-held subset, not a universal optimality or Fmax improvement claim'}
    (args.out / 'evidence.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'passed': True, 'actualScore': values['selection_score'], 'oracleScore': expected['bestScore']}))


if __name__ == '__main__':
    main()
