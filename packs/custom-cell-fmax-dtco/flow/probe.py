#!/usr/bin/env python3
"""One bounded foundry-only synthesis in a fresh directory of this Campaign.

Site inputs live in flow/inputs.json, never in Pack method files. The Tcl method uses the
selected Site bindings; runtime decisions belong to the conversational Agent. This tool performs
exactly one synthesis.
"""
import argparse
import glob
import hashlib
import json
import math
from pathlib import Path
import re
import subprocess
import time
import uuid
import sys


def sha(at):
    return hashlib.sha256(at.read_bytes()).hexdigest()


def tcl(value):
    value = str(value)
    if '\n' in value or '\r' in value:
        raise ValueError('multiline Tcl input refused')
    return '"' + re.sub(r'([\\"$\[\]])', r'\\\1', value) + '"'


def main():
    args = argparse.ArgumentParser()
    args.add_argument('--workspace', required=True)
    args.add_argument('--period', required=True, type=float)
    args.add_argument('--check-inputs', action='store_true', help='read-only identity preflight; launches no tool')
    opts = args.parse_args()
    if not math.isfinite(opts.period) or not 0.1 <= opts.period <= 5:
        args.error('period must be finite, 0.1 to 5 ns')
    root = Path(opts.workspace).resolve()
    flow = root / 'flow'
    inputs = json.loads((flow / 'inputs.json').read_text())
    required = ('designTop', 'rtlGlob', 'foundryDb', 'edaWrapper', 'constraintsTcl', 'clockName')
    missing = [name for name in required if not isinstance(inputs.get(name), str) or not inputs[name]]
    if missing:
        raise ValueError('missing Site bindings: ' + ', '.join(missing))
    rtl = sorted(Path(p).resolve() for p in glob.glob(inputs['rtlGlob']))
    db = Path(inputs['foundryDb']).resolve()
    if not rtl or any(not p.is_file() for p in rtl) or not db.is_file():
        raise ValueError('missing RTL or foundry database')
    def identity():
        return {
            'inputs': {'bindingSha256': sha(flow / 'inputs.json'),
                'designTop': inputs['designTop'],
                'foundryDb': {'path': str(db), 'sha256': sha(db)},
                'rtl': [{'path': str(p), 'sha256': sha(p)} for p in rtl],
                'constraintsTcl': {'path': inputs['constraintsTcl'], 'sha256': sha(Path(inputs['constraintsTcl']).resolve())},
                'clockName': inputs['clockName']},
            'method': {'probeSha256': sha(Path(__file__)), 'synthSha256': sha(flow / 'synth.tcl'),
                'wrapperSha256': sha(Path(inputs['edaWrapper']).resolve()),
                'pythonVersion': sys.version},
        }
    before = identity()
    pin_file = flow / 'probe-inputs.json'
    pinned = json.loads(pin_file.read_text()) if pin_file.exists() else None
    if pinned is not None and any(pinned[key] != before[key] for key in ('inputs', 'method')):
        raise ValueError('effective inputs or method changed since the first trial; start a new Campaign')
    if opts.check_inputs:
        print(json.dumps(before, sort_keys=True))
        return
    trial = flow / 'probes' / ('trial-' + uuid.uuid4().hex)
    trial.mkdir(parents=True, exist_ok=False)
    prelude = '\n'.join([
        'set DESIGN ' + tcl(inputs['designTop']),
        'set DB ' + tcl(db),
        'set CLK_NS ' + tcl(opts.period),
        'set CLOCK_NAME ' + tcl(inputs['clockName']),
        'set CONSTRAINTS_TCL ' + tcl(Path(inputs['constraintsTcl']).resolve()),
        'set RTL [list ' + ' '.join(tcl(p) for p in rtl) + ']',
        'source ' + tcl(flow / 'synth.tcl'),
    ]) + '\n'
    (trial / 'entry.tcl').write_text(prelude)
    command = [inputs['edaWrapper'], 'dc_shell', '-f', str(trial / 'entry.tcl')]
    started = time.time()
    with (trial / 'dc.log').open('w') as log:
        result = subprocess.run(command, cwd=trial, stdout=log, stderr=subprocess.STDOUT, timeout=600)
    log = (trial / 'dc.log').read_text(errors='replace')
    required = ['metrics.tsv', 'timing.rpt', 'qor.rpt', 'netlist.v', 'constraints.sdc', 'references.rpt', 'check_timing.rpt']
    if result.returncode or re.search(r'^Error:', log, re.M) or any(not (trial / n).is_file() for n in required):
        raise RuntimeError('synthesis failed or incomplete; inspect retained ' + str(trial / 'dc.log'))
    if identity() != before:
        raise ValueError('effective inputs or method changed during synthesis; no measurement published')
    versions = re.findall(r'^Version:\s*(\S+)\s*$', (trial / 'qor.rpt').read_text(), re.M)
    conditions = re.findall(r'^Operating Conditions:.*$', (trial / 'timing.rpt').read_text(), re.M)
    if len(versions) != 1 or len(conditions) != 1:
        raise ValueError('missing or ambiguous tool/operating-condition identity')
    timing_text = (trial / 'timing.rpt').read_text(errors='replace')
    timing_designs = re.findall(r'(?m)^Design\s*:\s*(\S+)\s*$', timing_text)
    timing_groups = re.findall(r'(?m)^\s*Path Group:\s*(\S+)\s*$', timing_text)
    timing_slacks = [float(value) for value in re.findall(
        r'(?m)^\s*slack \([^)]*\)\s+(-?[0-9.eE+-]+)\s*$', timing_text)]
    if (timing_designs != [inputs['designTop']] or not timing_groups
            or len(timing_groups) != len(timing_slacks) or set(timing_groups) != {'reg2reg'}
            or not math.isclose(min(timing_slacks), float((trial / 'metrics.tsv').read_text().split('worst_slack_ns\t', 1)[1].splitlines()[0]), abs_tol=1e-12)):
        raise ValueError('probe timing evidence is not the declared top reg2reg pressure report')
    effective = {'schema': 1, **before, 'tool': {'version': versions[0], 'conditions': conditions[0]}}
    if pinned is not None and pinned != effective:
        raise ValueError('tool or operating conditions changed since the first trial; no comparable measurement published')
    if pinned is None:
        with pin_file.open('x') as pin:
            pin.write(json.dumps(effective, sort_keys=True, indent=2) + '\n')
    evidence = {('metrics' if n == 'metrics.tsv' else n): {'path': str((trial / n).relative_to(flow)), 'sha256': sha(trial / n)} for n in required + ['dc.log', 'entry.tcl']}
    record = {
        'format': 'custom-cell-fmax-probe/2', 'toolExit': result.returncode, 'askedPeriodNs': opts.period,
        'elapsedSeconds': time.time() - started, 'command': command,
        'inputs': before['inputs'], 'method': before['method'], 'effectiveIdentity': effective,
        'identity': {'path': 'probe-inputs.json', 'sha256': sha(pin_file)},
        'evidence': evidence,
        'scope': 'foundry-only synthesis, not post-route signoff or measured silicon Fmax',
    }
    # The immutable trial contains its own manifest. The current pointer is atomically replaced
    # only after a complete successful tool run; the Harness still requires reader/Judge facts.
    data = json.dumps(record, indent=2, allow_nan=False) + '\n'
    (trial / 'manifest.json').write_text(data)
    staging = flow / ('probe-' + uuid.uuid4().hex + '.json')
    staging.write_text(data)
    staging.replace(flow / 'probe.json')
    print(json.dumps({'trial': str(trial), 'elapsedSeconds': record['elapsedSeconds']}))


if __name__ == '__main__':
    main()
