#!/usr/bin/env python3
"""Raw occurrence-frequency reference for a staged finite sample; no result is baked in."""
import hashlib
import json
import sys
from pathlib import Path

workspace = Path(sys.argv[1]).resolve()
sample_path = workspace / "sample.json"
sample = json.loads(sample_path.read_text())
candidates = sample["candidates"]
budget = sample["budget"]
ranked = sorted(candidates, key=lambda candidate: (-len({item["path"] for item in candidate["occurrences"]}), candidate["id"]))
selection = {
    "sampleSha256": hashlib.sha256(sample_path.read_bytes()).hexdigest(),
    "selected": [candidate["id"] for candidate in ranked[:budget]],
}
target = workspace / "selection.json"
target.write_text(json.dumps(selection, separators=(",", ":")) + "\n")
