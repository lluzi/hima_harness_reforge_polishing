#!/usr/bin/env python3
"""Produce finite, source-held timing motifs and an independent exhaustive oracle.

This is an analysis handoff/verification CLI, not a Fabric execution engine.
The oracle file stays outside the model's input roots during PLS-09 validation.
"""
import argparse
import hashlib
import itertools
import json
from pathlib import Path
import re

from aes_probe_netlist import parse_modules


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def leaf_instances(modules, module, prefix='', ancestors=()):
    if module in ancestors:
        raise ValueError('recursive netlist hierarchy')
    found = {}
    for instance in modules[module]:
        name = prefix + instance.name.lstrip('\\')
        if name in found:
            raise ValueError('duplicate instance identity')
        if instance.cell_type in modules:
            found.update(leaf_instances(modules, instance.cell_type, name + '/', ancestors + (module,)))
        else:
            found[name] = instance
    return found


def samples(timing, netlist, max_paths):
    modules = parse_modules(netlist)
    instances = leaf_instances(modules, 'aes_cipher_top')
    paths = []
    current = None
    for line_no, line in enumerate(timing.splitlines(), 1):
        match = re.match(r'\s*Startpoint:\s+(\S+)', line)
        if match:
            if len(paths) >= max_paths:
                break
            current = {'id': 'path-' + str(len(paths) + 1), 'startpoint': match[1], 'points': [], 'sourceLine': line_no}
            paths.append(current)
        if current is None:
            continue
        match = re.match(r'\s*Endpoint:\s+(\S+)', line)
        if match:
            current['endpoint'] = match[1]
        match = re.match(r'\s*Path Group:\s+(\S+)', line)
        if match:
            current['group'] = match[1]
        match = re.match(r'\s+(\S+)\s+\((\S+)\)\s+', line)
        if not match or match[2] == 'net' or match[2] in modules or '/' not in match[1]:
            continue
        pin, master = match.groups()
        instance, port = pin.rsplit('/', 1)
        actual = instances.get(instance)
        if actual is None or actual.cell_type != master or port not in actual.conns:
            raise ValueError('timing point does not match the netlist instance/pin: ' + pin)
        # End registers are boundaries. The remaining objects are timing-path motifs;
        # Boolean/physical buildability still belongs to later library gates.
        if instance in (current['startpoint'], current.get('endpoint')):
            continue
        if not current['points'] or current['points'][-1]['instance'] != instance:
            current['points'].append({'instance': instance, 'master': master, 'pin': port, 'sourceLine': line_no})
    if not paths or any(not p.get('endpoint') or not p.get('group') for p in paths):
        raise ValueError('no complete timing paths')
    return paths


def candidates(paths, limit):
    motifs = {}
    for path in paths:
        for size in (2, 3):
            for begin in range(len(path['points']) - size + 1):
                points = path['points'][begin:begin + size]
                cells = tuple(p['instance'] for p in points)
                if len(set(cells)) != size:
                    continue
                key = sha(json.dumps(cells).encode())[:16]
                row = motifs.setdefault(key, {'id': 'motif-' + key, 'cells': list(cells),
                    'masters': [p['master'] for p in points], 'occurrences': []})
                row['occurrences'].append({'path': path['id'], 'begin': begin,
                    'sourceLines': [p['sourceLine'] for p in points]})
    for row in motifs.values():
        row['score'] = len(row['cells']) * len({o['path'] for o in row['occurrences']})
    return sorted(motifs.values(), key=lambda c: (-c['score'], c['id']))[:limit]


def oracle(rows, budget):
    # Independent exhaustive test oracle, not supplied to the research model.
    best_score, best_ids, checked = 0, [], 0
    for count in range(1, budget + 1):
        for group in itertools.combinations(rows, count):
            checked += 1
            all_cells = [c for row in group for c in row['cells']]
            if len(all_cells) != len(set(all_cells)):
                continue
            score = sum(row['score'] for row in group)
            ids = sorted(row['id'] for row in group)
            if score > best_score or score == best_score and ids < best_ids:
                best_score, best_ids = score, ids
    greedy, used = [], set()
    for row in rows:
        if not used.intersection(row['cells']):
            greedy.append(row); used.update(row['cells'])
        if len(greedy) == budget:
            break
    return {'bestScore': best_score, 'bestIds': best_ids, 'combinationsChecked': checked,
            'greedyScore': sum(row['score'] for row in greedy), 'greedyIds': [row['id'] for row in greedy]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--flow', type=Path, required=True)
    parser.add_argument('--sample-out', type=Path, required=True)
    parser.add_argument('--oracle-out', type=Path, required=True)
    parser.add_argument('--max-paths', type=int, default=24, choices=range(4, 65))
    parser.add_argument('--max-candidates', type=int, default=64, choices=range(8, 97))
    parser.add_argument('--budget', type=int, default=2, choices=(2, 3))
    args = parser.parse_args()
    evidence = json.loads(args.evidence.read_text())
    if evidence.get('status') != 'passed':
        raise ValueError('handoff requires a validated real probe record')
    manifest_bytes = args.manifest.read_bytes()
    manifest = json.loads(manifest_bytes)
    if manifest.get('format') not in ('aes-probe/1', 'aes-probe/2') or type(manifest.get('toolExit')) is not int or manifest['toolExit'] != 0:
        raise ValueError('manifest is not a successful versioned AES probe')
    source = [(r['run'], row) for r in evidence['runs'] for row in r['records']
              if row['type'] == 'observation' and row.get('contentSha256') == sha(manifest_bytes)]
    if len(source) != 1:
        raise ValueError('manifest is not the observed bytes of exactly one validated Run')
    run, observation = source[0]
    digest = run.get('packDigest')
    reader = observation.get('reader', {})
    observed = evidence.get('observed', {})
    if (run.get('packId') != 'aes-tsmc28-dtco' or not re.fullmatch(r'[a-f0-9]{64}', str(digest))
            or observed.get('methodBeforeTest') != digest or observed.get('methodDigest') != digest
            or not str(run.get('status', '')).startswith('ended-')
            or observation.get('runId') != run.get('id') or observation.get('siteId') != run.get('siteId')
            or not str(observation.get('id', '')).startswith(str(run.get('id')) + '#')
            or reader.get('id') != 'aes-probe-reading' or reader.get('reportKind') != manifest['format']
            or reader.get('version') != manifest['format'].split('/')[1]
            or not re.fullmatch(r'[a-f0-9]{64}', str(reader.get('sha256', '')))):
        raise ValueError('Pack, method, Run or reader identity does not match the validated probe')
    data = {}
    for name in ('timing.rpt', 'netlist.v'):
        ref = manifest['evidence'][name]
        at = (args.flow / ref['path']).resolve()
        if not at.is_relative_to(args.flow.resolve()):
            raise ValueError('input escapes flow root')
        raw = at.read_bytes()
        if sha(raw) != ref['sha256']:
            raise ValueError('input hash mismatch: ' + name)
        data[name] = raw.decode()
    paths = samples(data['timing.rpt'], data['netlist.v'], args.max_paths)
    rows = candidates(paths, args.max_candidates)
    if len(rows) < 8:
        raise ValueError('insufficient verified motifs for a nontrivial bounded analysis')
    sample = {'schema': 'aes-path-motifs/1', 'source': {'run': run['id'], 'observation': observation['id'],
        'generation': observation['generation'], 'methodDigest': run['packDigest'], 'manifestSha256': sha(manifest_bytes),
        'timingSha256': manifest['evidence']['timing.rpt']['sha256'], 'netlistSha256': manifest['evidence']['netlist.v']['sha256']},
        'scope': 'finite reported timing-path motifs; no Boolean buildability or PPA improvement claim',
        'objective': 'maximize sum of cell-count times distinct reported-path incidences; selected motifs may share no physical cell',
        'budget': args.budget, 'paths': paths, 'candidates': rows}
    args.sample_out.parent.mkdir(parents=True, exist_ok=True)
    args.oracle_out.parent.mkdir(parents=True, exist_ok=True)
    sample_bytes = (json.dumps(sample, indent=2) + '\n').encode()
    result = oracle(rows, args.budget)
    ranked = sorted(rows, key=lambda r: (-len({o['path'] for o in r['occurrences']}), r['id']))[:args.budget]
    counted_cells = [cell for row in ranked for cell in row['cells']]
    result['frequencyBaseline'] = {'ids': [row['id'] for row in ranked],
        'claimedScore': sum(row['score'] for row in ranked),
        'sharedCellCount': len(counted_cells) - len(set(counted_cells)),
        'valid': len(counted_cells) == len(set(counted_cells))}
    args.sample_out.write_bytes(sample_bytes)
    args.oracle_out.write_text(json.dumps({'sampleSha256': sha(sample_bytes), **result}, indent=2) + '\n')
    print(json.dumps({'paths': len(paths), 'candidates': len(rows), 'sampleSha256': sha(sample_bytes), **result}))


if __name__ == '__main__':
    main()
