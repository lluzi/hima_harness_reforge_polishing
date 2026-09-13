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
    buildable = ("fusion", "cluster_compose", "boolean_synthesis")
    timing_routes = ("timing_criticality", "timing_context")
    big = 1e18

    def first_value(obj, names, depth=6):
        queue = [(obj, 0)]
        while queue:
            current, level = queue.pop(0)
            if isinstance(current, dict):
                for name in names:
                    if name in current and current[name] is not None:
                        return current[name]
                if level < depth:
                    for value in current.values():
                        if isinstance(value, (dict, list)):
                            queue.append((value, level + 1))
            elif isinstance(current, list) and level < depth:
                for value in current:
                    if isinstance(value, (dict, list)):
                        queue.append((value, level + 1))
        return None

    def number(value):
        if isinstance(value, bool) or value is None:
            return None
        if isinstance(value, (int, float)):
            return float(value) if value == value else None
        if isinstance(value, str):
            try:
                return float(value)
            except ValueError:
                return None
        return None

    def count(value):
        found = number(value)
        if found is not None:
            return found
        if isinstance(value, (list, tuple)):
            return float(len(value))
        if isinstance(value, dict):
            for name in ("count", "size", "n", "total"):
                found = number(value.get(name))
                if found is not None:
                    return found
        return None

    def normalize(request):
        if not isinstance(request, dict):
            return None
        candidate_id = first_value(request, ("candidate_id",))
        if not isinstance(candidate_id, str) or not candidate_id:
            candidate_id = first_value(request, ("request_id",))
        if not isinstance(candidate_id, str) or not candidate_id:
            return None
        implementation = first_value(request, ("implementation_route", "implementation_route_id"))
        if not isinstance(implementation, str):
            implementation = None
        evidence = first_value(request, ("discovery_evidence", "evidence"))
        if not isinstance(evidence, dict):
            evidence = request

        def field(*names):
            value = first_value(evidence, names)
            if value is None:
                value = first_value(request, names)
            return value

        interface = first_value(request, ("interface",))
        support = count(field("raw_support", "support", "occurrence_count", "occurrences"))
        coverage = count(field("non_overlapping_support", "non_overlap_support",
                               "nonoverlapping_support", "non_overlapping_occurrences"))
        if coverage is None:
            coverage = support
        impact = number(field("critical_impact_du", "impact_du", "critical_impact"))
        rank = number(field("critical_root_rank", "critical_rank", "root_rank"))
        inputs = number(field("input_count"))
        if inputs is None and isinstance(interface, dict):
            pins = interface.get("inputs")
            if isinstance(pins, list):
                inputs = float(len(pins))
        function = None
        if isinstance(interface, dict):
            outputs = interface.get("outputs")
            if isinstance(outputs, list):
                functions = sorted(output.get("liberty_function") for output in outputs
                                   if isinstance(output, dict)
                                   and isinstance(output.get("liberty_function"), str))
                if functions:
                    function = "|".join(functions)
        if function is None:
            digest = first_value(request, ("equivalence_digest", "function_digest"))
            if isinstance(digest, str):
                function = digest
        if function is None:
            function = candidate_id
        return {"id": candidate_id,
                "buildable": implementation is None or implementation in buildable,
                "support": support, "coverage": coverage, "impact": impact, "rank": rank,
                "inputs": inputs, "function": function}

    def order_key(item):
        impact = item["impact"] if item["impact"] is not None else -big
        rank = item["rank"] if item["rank"] is not None else big
        coverage = item["coverage"] if item["coverage"] is not None else -big
        support = item["support"] if item["support"] is not None else -big
        inputs = item["inputs"] if item["inputs"] is not None else big
        if route in timing_routes:
            return (-impact, rank, -coverage, -support, inputs, item["id"])
        return (-coverage, -support, -impact, rank, inputs, item["id"])

    def coverage_of(item):
        return item["coverage"] if item["coverage"] is not None else -big

    items = []
    for request in candidates:
        item = normalize(request)
        if item is not None and item["buildable"]:
            items.append(item)
    if not items:
        return []
    items.sort(key=order_key)
    first = items[0]
    chosen = [first]
    rest = [item for item in items[1:] if item["function"] != first["function"]]
    if rest:
        rest.sort(key=lambda item: (-coverage_of(item), order_key(item)))
        chosen.append(rest[0])
    return [item["id"] for item in chosen]


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
