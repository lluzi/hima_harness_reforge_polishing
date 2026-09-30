"""Replayed compose-contributions entry (ATCS dry path, Issue #63): no model wrote this.

Selects every admissible session (or fix) Contribution the collector sealed that composition still
considers -- a batch it excluded for a domain collision (#66 D5) left `facts.considered` and is not
selectable -- resolves nothing, defers nothing, keeps the plan's default auto-finish, and names a batch
id no earlier replay in this workspace used.
"""
import json
import sys
from pathlib import Path

workspace = Path(sys.argv[1])
working = json.loads((workspace / "state" / "working-state.json").read_text(encoding="utf-8"))
collected = json.loads((workspace / "state" / "contributions-collected.json").read_text(encoding="utf-8"))
facts = json.loads((workspace / "state" / "composition-facts.json").read_text(encoding="utf-8"))
used = sorted(p.name for p in (workspace / "integrations").glob("*")) if (workspace / "integrations").is_dir() else []
select = [c["id"] for c in collected["contributions"]
          if c.get("kind") in ("xtop-session", "fix") and c.get("admissible") and c["id"] in facts["considered"]]
plan = {"batchId": f"batch-{len(used) + 1:02d}", "baseStateId": working["id"], "select": select,
        "resolutions": [], "deferred": [], "reason": "replay every sealed session's kept commands from the common base, then auto-finish"}
out = workspace / "research" / "requests" / "integration-plan.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps({"plan": plan, "facts": facts}, indent=2) + "\n", encoding="utf-8")
