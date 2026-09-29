"""Replayed diagnose-and-observe entry (ATCS dry path, Issue #63): no model wrote this.

One bounded GBA query over every required scenario of the current working state.
"""
import json
import sys
from pathlib import Path

SCENARIOS = json.loads(r'''__SCENARIOS_JSON__''')
workspace = Path(sys.argv[1])
working = json.loads((workspace / "state" / "working-state.json").read_text(encoding="utf-8"))
request = {"designStateId": working["id"], "precision": "gba", "requiredScenarios": SCENARIOS,
           "maxPaths": 1000, "nworst": 1}
out = workspace / "research" / "requests" / "observation-request.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(request, indent=2) + "\n", encoding="utf-8")
