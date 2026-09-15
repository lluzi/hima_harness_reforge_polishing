"""Canonical Package projection of mined generation work and attempt outcomes.

This module is materialized with ``flow/`` and is shared by the driver, record
writer, Runtime parsers, and terminal strategy projection.  Keeping the Cell
name rule and the exact request-to-attempt relation here prevents quiet
attrition from being hidden by two consumers trusting the same shortened
attempt ledger.
"""
from __future__ import annotations

import re
import unicodedata


IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]*$")
REASON_CODES = (
    "nonzero_exit", "missing_output", "invalid_netlist", "timeout",
    "unknown_refusal",
)


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
            cell_name = canonical_cell_name(candidate_id, name)
            if not IDENTIFIER.fullmatch(cell_name) or cell_name in cells:
                raise ValueError("generation requests do not produce unique legal Cell names")
            cells.add(cell_name)
            jobs.append({
                "candidate_id": candidate_id,
                "cell_name": cell_name,
                "inputs": list(input_names),
                "output_name": name,
                "liberty_function": function,
            })
        if len(output_names) != len(set(output_names)) or set(input_names) & set(output_names):
            raise ValueError("generation request %s pin names are not unique" % candidate_id)
    return jobs


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
