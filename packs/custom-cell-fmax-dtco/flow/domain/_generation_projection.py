"""Canonical Package projection of mined generation work and attempt outcomes.

This module is materialized with ``flow/`` and is shared by the driver, record
writer, Runtime parsers, and terminal strategy projection.  Keeping the Cell
name rule and the exact request-to-attempt relation here prevents quiet
attrition from being hidden by two consumers trusting the same shortened
attempt ledger.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import unicodedata
from pathlib import Path


IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]*$")
REASON_CODES = (
    "nonzero_exit", "missing_output", "invalid_netlist", "timeout",
    "unknown_refusal",
)

CUMULATIVE_LIBRARY_SCHEMA = "custom-cell-cumulative-library/1"
SHARD_SCHEMA = "custom-cell-library-shard/1"
EVIDENCE_STATES = (
    "discovered", "proxy-mapped", "materialized", "predicted", "cumulative",
    "commercially-adopted", "route-retained", "final-benefit", "proxy-rejected",
)
EVIDENCE_TRANSITIONS = {
    "discovered": {"proxy-mapped", "proxy-rejected"},
    "proxy-mapped": {"materialized", "proxy-rejected"},
    "materialized": {"predicted"},
    "predicted": {"cumulative"},
    "cumulative": {"commercially-adopted"},
    "commercially-adopted": {"route-retained"},
    "route-retained": {"final-benefit"},
    "final-benefit": set(),
    "proxy-rejected": set(),
}


def canonical_cell_name(candidate_id, output_name):
    """Return the exact name used by ``run_bool2cmos.py`` since Package @1.

    ``replace`` intentionally removes every ``CAND_`` occurrence.  Changing it
    here would be a business-contract migration, so all producers and verifiers
    call this one implementation.
    """
    return "XS_%s_%s" % (str(candidate_id).replace("CAND_", ""), output_name)


def expected_generation_jobs(patterns):
    if not isinstance(patterns, dict):
        raise ValueError("patterns ledger must be an object")
    requests = patterns.get("generation_requests")
    if not isinstance(requests, list):
        raise ValueError("patterns generation_requests must be an array")
    jobs, candidates, cells = [], set(), set()
    for request_index, request in enumerate(requests):
        if not isinstance(request, dict):
            raise ValueError("generation request %d must be an object" % request_index)
        candidate_id = request.get("candidate_id")
        if not isinstance(candidate_id, str) or not IDENTIFIER.fullmatch(candidate_id):
            raise ValueError("generation request %d has an invalid candidate_id" % request_index)
        if candidate_id in candidates:
            raise ValueError("generation requests repeat candidate_id %s" % candidate_id)
        candidates.add(candidate_id)
        interface = (request.get("generator_contract") or {}).get("interface")
        if not isinstance(interface, dict):
            raise ValueError("generation request %s has no interface" % candidate_id)
        inputs = interface.get("inputs")
        outputs = interface.get("outputs")
        if not isinstance(inputs, list) or not isinstance(outputs, list) or not outputs:
            raise ValueError(
                "generation request %s must carry input and nonempty output arrays"
                % candidate_id)
        input_names = []
        for pin in inputs:
            name = pin.get("name") if isinstance(pin, dict) else None
            if not isinstance(name, str) or not IDENTIFIER.fullmatch(name):
                raise ValueError("generation request %s has an invalid input" % candidate_id)
            input_names.append(name)
        if len(input_names) != len(set(input_names)):
            raise ValueError("generation request %s repeats an input" % candidate_id)
        output_names = []
        route = (request.get("implementation_plan") or {}).get("route")
        vector_outputs = []
        for output in outputs:
            name = output.get("name") if isinstance(output, dict) else None
            function = output.get("liberty_function") if isinstance(output, dict) else None
            if not isinstance(name, str) or not IDENTIFIER.fullmatch(name):
                raise ValueError("generation request %s has an invalid output" % candidate_id)
            if not isinstance(function, str) or not function.strip():
                raise ValueError(
                    "generation request %s output %s has no liberty_function"
                    % (candidate_id, name))
            output_names.append(name)
            vector_outputs.append({"output_name": name, "liberty_function": function})
        if len(output_names) != len(set(output_names)) or set(input_names) & set(output_names):
            raise ValueError("generation request %s pin names are not unique" % candidate_id)
        if route == "multi_output_resynthesis":
            cell_name = "XS_%s_MO" % str(candidate_id).replace("CAND_", "")
            projected = [{
                "candidate_id": candidate_id, "cell_name": cell_name,
                "inputs": list(input_names), "outputs": vector_outputs,
                "multi_output": True,
            }]
        else:
            projected = [{
                "candidate_id": candidate_id,
                "cell_name": canonical_cell_name(candidate_id, row["output_name"]),
                "inputs": list(input_names), "outputs": [row], "multi_output": False,
                **row,
            } for row in vector_outputs]
        for job in projected:
            if not IDENTIFIER.fullmatch(job["cell_name"]) or job["cell_name"] in cells:
                raise ValueError("generation requests do not produce unique legal Cell names")
            cells.add(job["cell_name"])
            jobs.append(job)
    return jobs


def _canonical_json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def function_identity(request):
    """Return the stable function/interface/profile identity of one request.

    Candidate ids are per-search labels and can change across rounds.  Library
    growth therefore keys reuse to the Boolean equivalence digest plus the
    interface and requested physical variants.  The full identity remains in
    the manifest; the digest is only its compact key.
    """
    if not isinstance(request, dict):
        raise ValueError("generation request must be an object")
    contract = request.get("generator_contract")
    if not isinstance(contract, dict):
        raise ValueError("generation request has no generator_contract")
    reference = contract.get("equivalence_reference")
    interface = contract.get("interface")
    profile = contract.get("target_library_profile")
    implementation = contract.get("implementation_request")
    if not all(isinstance(value, dict) for value in (
            reference, interface, profile, implementation)):
        raise ValueError("generation request lacks identity-bearing contract fields")
    digest = reference.get("digest")
    inputs = interface.get("inputs")
    outputs = interface.get("outputs")
    if not isinstance(digest, str) or not digest:
        raise ValueError("generation request equivalence digest is missing")
    if not isinstance(inputs, list) or not isinstance(outputs, list) or not outputs:
        raise ValueError("generation request interface is incomplete")
    input_pins = []
    for pin in inputs:
        if not isinstance(pin, dict) or not isinstance(pin.get("name"), str):
            raise ValueError("generation request has an invalid input pin")
        input_pins.append(pin["name"])
    output_pins = []
    for pin in outputs:
        if (not isinstance(pin, dict) or not isinstance(pin.get("name"), str)
                or not isinstance(pin.get("liberty_function"), str)):
            raise ValueError("generation request has an invalid output pin")
        output_pins.append({
            "name": pin["name"],
            "liberty_function": pin["liberty_function"].strip(),
        })
    drives = implementation.get("drive_strengths")
    vt_classes = implementation.get("vt_classes")
    if not isinstance(drives, list) or not drives or not all(
            isinstance(value, str) and value for value in drives):
        raise ValueError("generation request drive variants are missing")
    if not isinstance(vt_classes, list) or not vt_classes or not all(
            isinstance(value, str) and value for value in vt_classes):
        raise ValueError("generation request VT variants are missing")
    identity = {
        "equivalenceDigest": digest,
        "inputPins": input_pins,
        "outputPins": output_pins,
        "targetLibraryProfile": profile,
        "driveStrengths": sorted(set(drives)),
        "vtClasses": sorted(set(vt_classes)),
    }
    physical_variant_id = implementation.get("physical_variant_id")
    if physical_variant_id is not None:
        if (not isinstance(physical_variant_id, str)
                or not re.fullmatch(r"sha256:[0-9a-f]{64}", physical_variant_id)):
            raise ValueError("generation request physical_variant_id is invalid")
        identity["physicalVariantId"] = physical_variant_id
    return {
        "key": "sha256:" + hashlib.sha256(_canonical_json(identity).encode()).hexdigest(),
        **identity,
    }


def empty_cumulative_manifest(baseline_reference):
    """Create an empty append-only manifest bound to one baseline Library."""
    if not isinstance(baseline_reference, dict):
        raise ValueError("baseline reference must be an object")
    required = ("sha256", "bytes", "source")
    if (not isinstance(baseline_reference.get("sha256"), str)
            or not re.fullmatch(r"[0-9a-f]{64}", baseline_reference["sha256"])
            or isinstance(baseline_reference.get("bytes"), bool)
            or not isinstance(baseline_reference.get("bytes"), int)
            or baseline_reference["bytes"] < 1
            or not isinstance(baseline_reference.get("source"), str)
            or not baseline_reference["source"]):
        raise ValueError("baseline reference must carry source, bytes and a SHA-256")
    return {
        "schema": CUMULATIVE_LIBRARY_SCHEMA,
        "baselineReference": {key: baseline_reference[key] for key in required},
        "shards": [],
        "functions": [],
    }


def validate_cumulative_manifest(manifest):
    """Fail closed unless a manifest is internally append-safe and unique."""
    if not isinstance(manifest, dict) or manifest.get("schema") != CUMULATIVE_LIBRARY_SCHEMA:
        raise ValueError("cumulative Library manifest schema is unsupported")
    empty_cumulative_manifest(manifest.get("baselineReference"))
    shards = manifest.get("shards")
    functions = manifest.get("functions")
    if not isinstance(shards, list) or not isinstance(functions, list):
        raise ValueError("cumulative Library manifest arrays are missing")
    shard_ids, keys, candidate_ids, physical_cell_names = set(), set(), set(), set()
    for index, shard in enumerate(shards):
        if not isinstance(shard, dict):
            raise ValueError("Library shard %d is not an object" % index)
        shard_id = shard.get("id")
        if (not isinstance(shard_id, str) or not re.fullmatch(r"[0-9]{4}", shard_id)
                or shard_id in shard_ids):
            raise ValueError("Library shard ids must be unique four-digit strings")
        shard_ids.add(shard_id)
        if not isinstance(shard.get("manifestSha256"), str) or not re.fullmatch(
                r"[0-9a-f]{64}", shard["manifestSha256"]):
            raise ValueError("Library shard %s has no manifest SHA-256" % shard_id)
        if not isinstance(shard.get("functionKeys"), list):
            raise ValueError("Library shard %s has no function key list" % shard_id)
    for index, row in enumerate(functions):
        if not isinstance(row, dict):
            raise ValueError("Library function %d is not an object" % index)
        key = row.get("functionKey")
        candidate_id = row.get("candidateId")
        state = row.get("state")
        if (not isinstance(key, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", key)
                or key in keys):
            raise ValueError("Library function identities must be unique SHA-256 keys")
        scoped_candidate_id = (row.get("shardId"), candidate_id)
        if (not isinstance(candidate_id, str) or not IDENTIFIER.fullmatch(candidate_id)
                or scoped_candidate_id in candidate_ids):
            raise ValueError(
                "Library function candidate ids must be unique identifiers within a shard")
        if state not in EVIDENCE_STATES:
            raise ValueError("Library function %s has an invalid evidence state" % candidate_id)
        history = row.get("stateHistory")
        failures = row.get("knownFailures")
        if (not isinstance(history, list) or not history or history[0] != "discovered"
                or history[-1] != state or any(item not in EVIDENCE_STATES for item in history)):
            raise ValueError("Library function %s has an invalid state history" % candidate_id)
        if any(after not in EVIDENCE_TRANSITIONS[before]
               for before, after in zip(history, history[1:])):
            raise ValueError("Library function %s has an invalid state transition" % candidate_id)
        if not isinstance(failures, list) or any(
                not isinstance(item, str) or not item for item in failures):
            raise ValueError("Library function %s has invalid failure evidence" % candidate_id)
        if state == "proxy-rejected" and not failures:
            raise ValueError("proxy-rejected Library function %s has no failure reason" % candidate_id)
        physical = row.get("physicalCellNames")
        if (not isinstance(physical, list) or not physical
                or any(not isinstance(name, str) or not IDENTIFIER.fullmatch(name)
                       for name in physical)
                or len(set(physical)) != len(physical)
                or physical_cell_names.intersection(physical)):
            raise ValueError(
                "Library function %s has missing, invalid or colliding physical Cell names"
                % candidate_id)
        if row.get("shardId") not in shard_ids:
            raise ValueError("Library function %s refers to an unknown shard" % candidate_id)
        keys.add(key)
        candidate_ids.add(scoped_candidate_id)
        physical_cell_names.update(physical)
    declared = {key for shard in shards for key in shard["functionKeys"]}
    if declared != keys:
        raise ValueError("Library shard function keys disagree with function rows")
    return manifest


def delta_generation_requests(patterns, manifest):
    """Return only requests absent from the cumulative function inventory."""
    validate_cumulative_manifest(manifest)
    requests = patterns.get("generation_requests") if isinstance(patterns, dict) else None
    if not isinstance(requests, list):
        raise ValueError("patterns generation_requests must be an array")
    existing = {row["functionKey"] for row in manifest["functions"]}
    selected, seen = [], set()
    for request in requests:
        identity = function_identity(request)
        key = identity["key"]
        if key in seen:
            raise ValueError("generation requests repeat a function identity")
        seen.add(key)
        if key not in existing:
            selected.append(request)
    return selected


def expected_delta_generation_jobs(patterns, manifest):
    """Project generation Jobs only for functions absent from the cumulative Library."""
    return expected_generation_jobs({
        "generation_requests": delta_generation_requests(patterns, manifest),
    })


def patterns_from_cell_demands(cell_demands, manifest=None):
    """Project selected v3 Cell Demands into the existing generation seam."""
    if (not isinstance(cell_demands, dict)
            or cell_demands.get("schema") != "hima.lfr-cell-demand/1"):
        raise ValueError("cell_demands must use hima.lfr-cell-demand/1")
    demands = cell_demands.get("demands")
    if not isinstance(demands, list):
        raise ValueError("cell_demands.demands must be an array")
    requests, seen = [], set()
    for index, demand in enumerate(demands):
        if not isinstance(demand, dict):
            raise ValueError("cell demand %d must be an object" % index)
        demand_id = demand.get("demand_id")
        request = demand.get("generation_request")
        if not isinstance(demand_id, str) or not demand_id or not isinstance(request, dict):
            raise ValueError("cell demand %d has no identity/generation request" % index)
        request = json.loads(json.dumps(request))
        candidate_id = request.get("candidate_id")
        if not isinstance(candidate_id, str) or candidate_id in seen:
            raise ValueError("Cell Demand generation requests need unique candidate_id")
        seen.add(candidate_id)
        requests.append(request)
    selected = (delta_generation_requests({"generation_requests": requests}, manifest)
                if manifest is not None else requests)
    patterns = {
        "report_schema": "hima.lfr-demanded-patterns/1",
        "source_cell_demand_sha256": hashlib.sha256(
            _canonical_json(cell_demands).encode()
        ).hexdigest(),
        "generation_requests": selected,
        "accounting": {
            "selected_demand_count": len(demands),
            "selected_generation_request_count": len(selected),
            "reused_cumulative_request_count": len(requests) - len(selected),
        },
    }
    expected_generation_jobs(patterns)
    return patterns


def advance_function_state(manifest, function_key, next_state, failure=None):
    """Return a new manifest with one monotonic, evidence-backed state change."""
    validate_cumulative_manifest(manifest)
    if not isinstance(function_key, str) or not re.fullmatch(
            r"sha256:[0-9a-f]{64}", function_key):
        raise ValueError("function_key must be a SHA-256 identity")
    if next_state not in EVIDENCE_STATES:
        raise ValueError("next Library function state is invalid")
    matches = [row for row in manifest["functions"] if row["functionKey"] == function_key]
    if len(matches) != 1:
        raise ValueError("function_key does not identify one cumulative function")
    current = matches[0]["state"]
    if next_state not in EVIDENCE_TRANSITIONS[current]:
        raise ValueError(
            "Library function state cannot advance from %s to %s" % (current, next_state)
        )
    if next_state == "proxy-rejected":
        if not isinstance(failure, str) or not failure.strip():
            raise ValueError("proxy rejection requires a failure reason")
    elif failure is not None:
        raise ValueError("failure reason is only valid for proxy rejection")
    updated = json.loads(json.dumps(manifest))
    row = next(item for item in updated["functions"] if item["functionKey"] == function_key)
    row["state"] = next_state
    row["stateHistory"].append(next_state)
    if failure is not None:
        row["knownFailures"].append(failure.strip())
    validate_cumulative_manifest(updated)
    return updated


def _file_reference(path):
    path = Path(path)
    if not path.is_file() or path.is_symlink():
        raise ValueError("shard artifact must be a regular non-symlink file: %s" % path)
    raw = path.read_bytes()
    return {"path": path.name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def _verify_existing_shards(root, manifest):
    """Verify every retained shard before extending the cumulative Library."""
    root = Path(root)
    for shard in manifest["shards"]:
        shard_id = shard["id"]
        directory = root / "shards" / shard_id
        manifest_path = directory / "manifest.json"
        if (directory.is_symlink() or not directory.is_dir()
                or manifest_path.is_symlink() or not manifest_path.is_file()):
            raise ValueError("Library shard %s is unavailable or unsafe" % shard_id)
        manifest_bytes = manifest_path.read_bytes()
        if hashlib.sha256(manifest_bytes).hexdigest() != shard["manifestSha256"]:
            raise ValueError("Library shard %s manifest hash mismatch" % shard_id)
        try:
            retained = json.loads(manifest_bytes)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError("Library shard %s manifest is invalid" % shard_id) from error
        if (not isinstance(retained, dict) or retained.get("schema") != SHARD_SCHEMA
                or retained.get("id") != shard_id
                or retained.get("functionKeys") != shard["functionKeys"]):
            raise ValueError("Library shard %s manifest disagrees with cumulative state" % shard_id)
        artifacts = retained.get("artifacts")
        if not isinstance(artifacts, list) or not artifacts:
            raise ValueError("Library shard %s has no artifact inventory" % shard_id)
        names = set()
        for reference in artifacts:
            if not isinstance(reference, dict):
                raise ValueError("Library shard %s has an invalid artifact reference" % shard_id)
            name = reference.get("path")
            size = reference.get("bytes")
            digest = reference.get("sha256")
            if (not isinstance(name, str) or not name or Path(name).name != name
                    or name == "manifest.json" or name in names
                    or isinstance(size, bool) or not isinstance(size, int) or size < 0
                    or not isinstance(digest, str)
                    or not re.fullmatch(r"[0-9a-f]{64}", digest)):
                raise ValueError("Library shard %s has an invalid artifact reference" % shard_id)
            names.add(name)
            artifact = directory / name
            if artifact.is_symlink() or not artifact.is_file():
                raise ValueError("Library shard %s artifact %s is unavailable or unsafe" % (shard_id, name))
            raw = artifact.read_bytes()
            if len(raw) != size or hashlib.sha256(raw).hexdigest() != digest:
                raise ValueError("Library shard %s artifact %s hash mismatch" % (shard_id, name))


def append_cumulative_shard(root, manifest, shard_id, requests, artifacts=None):
    """Atomically append one immutable shard and return the updated manifest.

    Existing shard paths are never opened for writing.  A caller can retry a
    failed write safely because the final directory only appears after every
    file and its manifest have been written in a sibling temporary path.
    """
    validate_cumulative_manifest(manifest)
    if not isinstance(shard_id, str) or not re.fullmatch(r"[0-9]{4}", shard_id):
        raise ValueError("shard id must be a four-digit string")
    if any(row["id"] == shard_id for row in manifest["shards"]):
        raise ValueError("Library shard %s already exists" % shard_id)
    expected_id = "%04d" % (len(manifest["shards"]) + 1)
    if shard_id != expected_id:
        raise ValueError("next Library shard must be %s" % expected_id)
    if not isinstance(requests, list) or not requests:
        raise ValueError("a Library shard must add at least one function")
    root = Path(root)
    _verify_existing_shards(root, manifest)
    shards_root = root / "shards"
    final = shards_root / shard_id
    temporary = shards_root / (".%s.tmp" % shard_id)
    if final.exists() or temporary.exists():
        raise ValueError("Library shard path already exists")
    existing = {row["functionKey"] for row in manifest["functions"]}
    existing_physical = {
        name for row in manifest["functions"] for name in row["physicalCellNames"]
    }
    rows, keys = [], set()
    for request in requests:
        identity = function_identity(request)
        if identity["key"] in existing or identity["key"] in keys:
            raise ValueError("Library shard repeats an existing function identity")
        candidate_id = request.get("candidate_id")
        if not isinstance(candidate_id, str) or not IDENTIFIER.fullmatch(candidate_id):
            raise ValueError("Library shard has an invalid candidate id")
        interface = request["generator_contract"]["interface"]
        physical = [
            canonical_cell_name(candidate_id, output["name"])
            for output in interface["outputs"]
        ]
        if existing_physical.intersection(physical) or any(
                name in prior["physicalCellNames"] for prior in rows for name in physical):
            raise ValueError(
                "Library shard physical Cell name collision; candidate labels must be "
                "collision-safe before materialization")
        keys.add(identity["key"])
        rows.append({
            "functionKey": identity["key"],
            "candidateId": candidate_id,
            "shardId": shard_id,
            "state": "discovered",
            "stateHistory": ["discovered"],
            "knownFailures": [],
            "physicalCellNames": physical,
            "identity": {key: value for key, value in identity.items() if key != "key"},
        })
    artifact_refs = []
    artifacts = artifacts or []
    if not isinstance(artifacts, list):
        raise ValueError("shard artifacts must be a list")
    try:
        temporary.mkdir(parents=True, exist_ok=False)
        functions_path = temporary / "functions.json"
        functions_bytes = (_canonical_json({
            "schema": SHARD_SCHEMA,
            "id": shard_id,
            "functions": rows,
        }) + "\n").encode()
        functions_path.write_bytes(functions_bytes)
        artifact_refs.append(_file_reference(functions_path))
        for source_value in artifacts:
            source = Path(source_value)
            if not source.is_file() or source.is_symlink():
                raise ValueError("shard source artifact is not a regular file")
            target = temporary / source.name
            if target.name in {"functions.json", "manifest.json"} or target.exists():
                raise ValueError("shard artifact names must be unique")
            target.write_bytes(source.read_bytes())
            artifact_refs.append(_file_reference(target))
        shard_manifest = {
            "schema": SHARD_SCHEMA,
            "id": shard_id,
            "functionKeys": sorted(keys),
            "artifacts": sorted(artifact_refs, key=lambda row: row["path"]),
        }
        shard_bytes = (_canonical_json(shard_manifest) + "\n").encode()
        (temporary / "manifest.json").write_bytes(shard_bytes)
        os.rename(temporary, final)
    except Exception:
        if temporary.exists():
            for child in temporary.iterdir():
                child.unlink()
            temporary.rmdir()
        raise
    updated = json.loads(json.dumps(manifest))
    updated["shards"].append({
        "id": shard_id,
        "manifestSha256": hashlib.sha256(shard_bytes).hexdigest(),
        "functionKeys": sorted(keys),
    })
    updated["functions"].extend(rows)
    validate_cumulative_manifest(updated)
    return updated


def retained_candidate_ids(candidate_rows, budget):
    """Keep the strongest actually adopted half-library for the next generation."""
    if isinstance(budget, bool) or not isinstance(budget, int) or budget < 1:
        raise ValueError("retention budget must be a positive integer")
    if not isinstance(candidate_rows, list):
        raise ValueError("adoption candidate_rows must be an array")
    eligible = []
    seen = set()
    for row in candidate_rows:
        if not isinstance(row, dict):
            raise ValueError("adoption candidate row must be an object")
        candidate = row.get("candidate_id")
        instances = row.get("adopted_instance_count")
        rank = row.get("generation_rank")
        if (not isinstance(candidate, str) or not IDENTIFIER.fullmatch(candidate) or candidate in seen
                or isinstance(instances, bool) or not isinstance(instances, int) or instances < 0
                or isinstance(rank, bool) or not isinstance(rank, int) or rank < 1):
            raise ValueError("adoption candidate row has invalid identity, rank or instance count")
        seen.add(candidate)
        if instances > 0:
            eligible.append((candidate, instances, rank))
    eligible.sort(key=lambda row: (-row[1], row[2], row[0]))
    return [row[0] for row in eligible[:budget // 2]]


def validate_attempt_coverage(patterns, attempts):
    """Validate and return attempts in canonical generation-job order."""
    jobs = expected_generation_jobs(patterns)
    if not isinstance(attempts, list) or any(not isinstance(row, dict) for row in attempts):
        raise ValueError("generation attempts must be an array of objects")
    actual = {}
    for index, attempt in enumerate(attempts):
        key = (attempt.get("candidate_id"), attempt.get("cell_name"))
        if not all(isinstance(value, str) and value for value in key):
            raise ValueError("generation attempt %d has no candidate/Cell identity" % index)
        if key in actual:
            raise ValueError("generation attempts repeat %s/%s" % key)
        actual[key] = attempt
    expected = [(job["candidate_id"], job["cell_name"]) for job in jobs]
    if set(actual) != set(expected) or len(actual) != len(expected):
        missing = sorted(set(expected) - set(actual))
        extra = sorted(set(actual) - set(expected))
        raise ValueError(
            "attempt ledger does not exactly cover generation outputs; missing=%r extra=%r"
            % (missing, extra))
    return jobs, [actual[key] for key in expected]


def validate_diagnostic(value):
    if value is None:
        return
    if not isinstance(value, str) or len(value) > 300:
        raise ValueError("attempt diagnostic must be at most 300 Unicode code points")
    if any(unicodedata.category(character).startswith("C") for character in value):
        raise ValueError("attempt diagnostic contains a prohibited Unicode code point")


def bounded_diagnostic(text):
    """Sanitize one dependency diagnostic for non-claim technical provenance."""
    line = (str(text or "").strip().splitlines() or [""])[-1]
    safe = "".join(
        " " if unicodedata.category(character).startswith("C") else character
        for character in line
    ).strip()
    return safe[:300] or None


def spice_netlist_is_structural(text, cell_name):
    if not isinstance(text, str) or not text:
        return False
    opens = re.findall(r"(?mi)^\s*\.subckt\s+([^\s]+)\b", text)
    closes = re.findall(r"(?mi)^\s*\.ends(?:\s+([^\s]+))?\s*$", text)
    return opens == [cell_name] and len(closes) == 1 and closes[0] in ("", cell_name)


def derive_attempt_outcome(attempt, netlist_text):
    name = attempt.get("cell_name")
    if not isinstance(attempt.get("ok"), bool):
        raise ValueError("attempt %s ok must be a boolean" % name)
    returncode = attempt.get("returncode")
    if not isinstance(returncode, int) or isinstance(returncode, bool):
        raise ValueError("attempt %s returncode must be an integer" % name)
    validate_diagnostic(attempt.get("diagnostic"))
    structural = spice_netlist_is_structural(netlist_text, name)
    derived_ok = returncode == 0 and structural
    if attempt["ok"] is not derived_ok:
        raise ValueError("attempt %s success disagrees with returncode/netlist evidence" % name)
    if derived_ok:
        expected_reason = None
    elif returncode == 124:
        expected_reason = "timeout"
    elif returncode != 0:
        expected_reason = "nonzero_exit"
    elif not netlist_text:
        expected_reason = "missing_output"
    else:
        expected_reason = "invalid_netlist"
    reason_code = attempt.get("reason_code")
    if reason_code != expected_reason or (
            reason_code is not None and reason_code not in REASON_CODES):
        raise ValueError("attempt %s reason_code disagrees with raw evidence" % name)
    return "synthesized" if derived_ok else "refused", expected_reason
