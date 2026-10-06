#!/usr/bin/env python3
"""Run production emitted Tcl; only vendor commands use the existing XTop fixture."""
import json
import shlex
import sys
from pathlib import Path
REPO = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(REPO/'packs/agentic-timing-closure-system/flow/tests'),str(REPO/'packs/agentic-timing-closure-system/flow')]
from test_owner_timing_lead import OwnerTimingLeadChecks

def run(tcl, cwd, log):
    case = OwnerTimingLeadChecks(); case.native_metric_trajectory = None
    # Deliberately no setUp: it prewrites authoritative Campaign state.
    case.stub_native_tool({}, ['xtop','-f',str(tcl)], Path(cwd), Path(log))
if __name__ == '__main__':
    command = shlex.split(sys.argv[1])
    assert len(command)==3 and command[:2]==['xtop','-f'], command
    tcl = Path(command[2]).resolve()
    with (tcl.parent/'site-native-calls.jsonl').open('a') as stream: stream.write(json.dumps({'argv':command})+'\n')
    run(tcl,tcl.parent,tcl.parent/'site-native.log')
