#!/usr/bin/env python3
"""The `synthesize` tool of the aes-tsmc28-dtco pack: one bounded foundry-only synthesis.

This script is the same command line `contract.yml` declares for the tool, written for a person.
HimaFabric launches the declared argv directly; a person reproduces a generation by hand with:

    WORKSPACE=<campaign workspace> PERIOD_NS=0.35 /usr/bin/python3 tools/probe.py

which performs exactly what the contract declares:

    /usr/bin/python3 "$WORKSPACE/flow/probe.py" --workspace "$WORKSPACE" --period "$PERIOD_NS"

WORKSPACE is the Campaign workspace, whose flow/ directory is the Campaign's own copy of the Site's
flowRoot, carrying probe.py, synth.tcl, read-probe.py and the private inputs.json. PERIOD_NS is the
clock period this generation is the strategy for, in ns. The flow's own probe.py performs exactly one
synthesis in a fresh flow/probes/trial-<uuid>/ with a 600-second deadline, and publishes
flow/probe.json only when the run completed with every required artefact present. It never writes
into the Site's flowRoot.
"""
import os
import subprocess
import sys


def main():
    workspace = os.environ.get('WORKSPACE')
    period = os.environ.get('PERIOD_NS')
    if not workspace:
        raise SystemExit('WORKSPACE is required: the Campaign workspace on the Site')
    if not period:
        raise SystemExit('PERIOD_NS is required: the clock period this generation is the strategy for')
    command = [
        '/usr/bin/python3',
        os.path.join(workspace, 'flow', 'probe.py'),
        '--workspace', workspace,
        '--period', period,
    ]
    sys.exit(subprocess.call(command))


if __name__ == '__main__':
    main()
