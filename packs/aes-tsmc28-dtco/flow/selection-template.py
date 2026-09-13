#!/usr/bin/env python3
"""Copy as the Workshop entry and implement choose(); retain the input/output contract below.

The fixed I/O is Pack scaffolding. Research contribution belongs to the actual choose() algorithm.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import uuid


def choose(candidates, route):
    """Return at most two actual candidate_id strings, derived from this route's full evidence."""
    raise NotImplementedError("Implement a data-dependent route selection algorithm here")


def main():
    workspace = Path(sys.argv[1]).resolve()
    route, revision = sys.argv[2:4]
    routes = ("timing_criticality", "timing_context", "structure_frequency", "structure_compaction",
              "mapper_compatibility", "functional_diversity")
    if route not in routes:
        raise ValueError("unknown route")
    folder = workspace / "flow/mining" / route
    output = folder / "selected.json"
    attempt = workspace / "flow/selection-attempts" / route / uuid.uuid4().hex
    attempt.mkdir(parents=True, exist_ok=False)
    if output.is_symlink():
        raise ValueError("selection output must not be a symlink")
    if output.exists():
        output.replace(attempt / "previous-selected.json")
    raw_bytes = (folder / "raw.json").read_bytes()
    raw = json.loads(raw_bytes)
    source = json.loads((workspace / "flow/records" / ("mine-" + route + ".json")).read_text())
    selected = choose(raw["generation_requests"], route)
    if not isinstance(selected, list) or len(selected) > 2 or any(not isinstance(x, str) for x in selected):
        raise ValueError("choose() must return at most two candidate_id strings, not objects or explanations")
    document = {"sourceSha256": hashlib.sha256(raw_bytes).hexdigest(), "selected": selected,
                "codeSha256": source["facts"]["codeSha256"]}
    output.write_text(json.dumps(document, indent=2) + "\n")
    (attempt / "selected.json").write_bytes(output.read_bytes())
    checked = subprocess.run(["/usr/bin/python3", str(workspace / "flow/read-stage.py"),
                              str(output), str(attempt / "reading.json"), "select-" + route.replace("_", "-")], timeout=30)
    receipt = {"entrySha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "route": route,
               "revision": revision, "validationExit": checked.returncode, "selected": selected}
    (attempt / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    if checked.returncode:
        raise SystemExit(checked.returncode)
    print(json.dumps({"route": route, "selected": selected, "sourceSha256": document["sourceSha256"]}))


if __name__ == "__main__":
    main()
