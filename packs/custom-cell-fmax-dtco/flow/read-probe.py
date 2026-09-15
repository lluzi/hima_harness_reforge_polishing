#!/usr/bin/env python3
"""Read the hashed DC measurement, never a predicted period or a log-only success."""
import hashlib
import json
import math
from pathlib import Path
import re
import sys


def unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError('duplicate key: ' + key)
        value[key] = item
    return value


def read(report):
    record = json.loads(report.read_text(), object_pairs_hook=unique)
    if record['format'] != 'custom-cell-fmax-probe/2' or type(record['toolExit']) is not int or record['toolExit'] != 0:
        raise ValueError('no successful custom Cell Fmax measurement')
    identity_ref = record['identity']
    if identity_ref['path'] != 'probe-inputs.json':
        raise ValueError('wrong Campaign input identity reference')
    pinned = report.parent / 'probe-inputs.json'
    if pinned.is_symlink() or not pinned.resolve().is_relative_to(report.parent.resolve()):
        raise ValueError('input identity escapes report directory')
    pinned_bytes = pinned.read_bytes()
    if hashlib.sha256(pinned_bytes).hexdigest() != identity_ref['sha256']:
        raise ValueError('Campaign input identity hash mismatch')
    baseline = json.loads(pinned_bytes, object_pairs_hook=unique)
    if baseline.get('schema') != 1 or not all(isinstance(baseline.get(k), dict) for k in ('inputs', 'method', 'tool')):
        raise ValueError('incomplete effective input identity')
    if record['effectiveIdentity'] != baseline:
        raise ValueError('effective inputs changed; observations are not comparable')
    ref = record['evidence']['metrics']
    relative = Path(ref['path'])
    if relative.is_absolute() or '..' in relative.parts:
        raise ValueError('measurement path escapes report directory')
    at = report.parent / relative
    if not at.resolve().is_relative_to(report.parent.resolve()) or at.is_symlink():
        raise ValueError('measurement path escapes report directory')
    raw = at.read_bytes()
    if hashlib.sha256(raw).hexdigest() != ref['sha256']:
        raise ValueError('measurement hash mismatch')
    fields = unique(line.split('\t') for line in raw.decode().splitlines())
    if set(fields) != {'asked_period_ns', 'worst_slack_ns', 'cell_area_um2'}:
        raise ValueError('missing or unexpected measurement')
    period, slack, area = (float(fields[k]) for k in ('asked_period_ns', 'worst_slack_ns', 'cell_area_um2'))
    if not all(math.isfinite(n) for n in (period, slack, area)) or period <= 0 or area <= 0:
        raise ValueError('nonfinite or invalid measurement')
    asked = record['askedPeriodNs']
    if type(asked) not in (int, float) or not math.isfinite(asked) or asked != period:
        raise ValueError('measured period disagrees with requested trial')
    timing_ref = record['evidence'].get('timing.rpt')
    if not isinstance(timing_ref, dict):
        raise ValueError('probe has no target timing report')
    timing_relative = Path(timing_ref.get('path', ''))
    timing_path = report.parent / timing_relative
    if timing_relative.is_absolute() or '..' in timing_relative.parts or timing_path.is_symlink() or not timing_path.is_file():
        raise ValueError('probe timing report escapes evidence directory')
    timing_raw = timing_path.read_bytes()
    if hashlib.sha256(timing_raw).hexdigest() != timing_ref.get('sha256'):
        raise ValueError('probe timing report hash mismatch')
    timing_text = timing_raw.decode(errors='replace')
    design_top = baseline['inputs'].get('designTop')
    designs = re.findall(r'(?m)^Design\s*:\s*(\S+)\s*$', timing_text)
    groups = re.findall(r'(?m)^\s*Path Group:\s*(\S+)\s*$', timing_text)
    slack_tokens = re.findall(r'(?m)^\s*slack \([^)]*\)\s+(-?[0-9.eE+-]+)\s*$', timing_text)
    slacks = [float(value) for value in slack_tokens]
    if designs != [design_top] or not groups or len(groups) != len(slacks) or set(groups) != {'reg2reg'}:
        raise ValueError('probe timing report is not exclusively the declared top reg2reg group')
    worst_token = slack_tokens[slacks.index(min(slacks))]
    decimals = len(worst_token.split('.', 1)[1]) if '.' in worst_token and 'e' not in worst_token.lower() else 12
    if not math.isclose(min(slacks), slack, abs_tol=0.5 * (10 ** -decimals) + 1e-12):
        raise ValueError('probe metric slack differs from the reg2reg report')
    return {'values': [
        {'type': 'clock_period', 'unit': 'ns', 'value': period},
        {'type': 'reg2reg_wns', 'unit': 'ns', 'mode': 'setup', 'scope': 'reg2reg', 'value': slack},
        {'type': 'cell_area', 'unit': 'um2', 'value': area},
        {'type': 'reg2reg_path_count', 'unit': 'count', 'value': len(groups)},
    ]}


if __name__ == '__main__':
    result = read(Path(sys.argv[1]))
    Path(sys.argv[2]).write_text(json.dumps(result, allow_nan=False) + '\n')
