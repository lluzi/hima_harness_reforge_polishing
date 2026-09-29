"""Replayed evaluate-next-investment entry (ATCS dry path, Issue #63): no model wrote this.

The Pack's knowledge example-next-decision.md document, re-pointed at this Campaign's current working state and
current observation (the two references the Reader resolves), with the action the dry path takes.
"""
import json
import sys
from pathlib import Path

EXAMPLE = json.loads(r'''__EXAMPLE_JSON__''')
workspace = Path(sys.argv[1])
working = json.loads((workspace / "state" / "working-state.json").read_text(encoding="utf-8"))
observation = json.loads((workspace / "state" / "observation.json").read_text(encoding="utf-8"))
decision = dict(EXAMPLE, stateRef=working["id"], observationRef=observation["id"])
out = workspace / "research" / "requests" / "next-decision.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(decision, indent=2) + "\n", encoding="utf-8")
