#!/usr/bin/env python3
"""Rank buildable generation-request candidates by numeric discovery_evidence.

Usage: python3 selector.py INPUT_JSON OUTPUT_JSON

Reads a JSON file holding {"generation_requests": [...]} and writes
{"selected": [best_id], "reason": "..."} for the best buildable candidate.

Candidate ids are never hardcoded: the winner is whichever candidate the
numeric evidence ranks highest.  "Buildable" means the request carries a
usable implementation_plan and numeric discovery_evidence.  Ranking weighs
non_overlapping_support (more support is better) above critical_impact_du
(smaller impact is better), using cross-candidate min-max normalization so
the program behaves the same on any input file.
"""

import json
import sys

SUPPORT_WEIGHT = 0.75
IMPACT_WEIGHT = 0.25
EPSILON = 1e-12


def as_number(value):
    """Return value as float if it is a real finite number, else None."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        if number == number and abs(number) != float("inf"):
            return number
    elif isinstance(value, str):
        try:
            number = float(value.strip())
        except ValueError:
            return None
        if number == number and abs(number) != float("inf"):
            return number
    return None


def normalize(value, low, high):
    """Min-max normalize into [0, 1]; a degenerate range maps to 1.0."""
    if value is None:
        return 0.0
    if high - low <= EPSILON:
        return 1.0
    return (value - low) / (high - low)


def buildable(request):
    """A candidate is buildable when its plan is usable and evidence is numeric."""
    if not isinstance(request, dict):
        return False
    candidate_id = request.get("candidate_id")
    if not isinstance(candidate_id, str) or not candidate_id.strip():
        return False
    plan = request.get("implementation_plan")
    if not isinstance(plan, dict) or not plan:
        return False
    evidence = request.get("discovery_evidence")
    if not isinstance(evidence, dict) or not evidence:
        return False
    return any(as_number(value) is not None for value in evidence.values())


def extract_evidence(request, key):
    return as_number(request.get("discovery_evidence", {}).get(key))


def rank(candidates):
    supports = [c["support"] for c in candidates]
    impacts = [c["impact"] for c in candidates]

    support_low, support_high = min(supports), max(supports)
    impact_low, impact_high = min(impacts), max(impacts)

    for candidate in candidates:
        support_score = normalize(candidate["support"], support_low, support_high)
        # Smaller critical impact is better, so score the inverse direction.
        impact_score = 1.0 - normalize(candidate["impact"], impact_low, impact_high)
        candidate["score"] = SUPPORT_WEIGHT * support_score + IMPACT_WEIGHT * impact_score

    # Highest score wins; ties break on id for a deterministic, id-agnostic order.
    return sorted(candidates, key=lambda c: (-c["score"], c["candidate_id"]))


def main(argv):
    if len(argv) != 3:
        print("usage: selector.py INPUT_JSON OUTPUT_JSON", file=sys.stderr)
        return 2

    with open(argv[1], "r", encoding="utf-8") as handle:
        data = json.load(handle)

    requests = data.get("generation_requests", []) if isinstance(data, dict) else []
    requests = [r for r in requests if isinstance(r, dict)]

    candidates = []
    for request in requests:
        if not buildable(request):
            continue
        candidates.append(
            {
                "candidate_id": request["candidate_id"],
                "support": extract_evidence(request, "non_overlapping_support"),
                "impact": extract_evidence(request, "critical_impact_du"),
            }
        )

    if not candidates:
        result = {
            "selected": [],
            "reason": "No buildable candidate: every generation request lacked a usable "
            "implementation_plan or numeric discovery_evidence.",
        }
    else:
        ranked = rank(candidates)
        best = ranked[0]
        reason = (
            "Ranked %d buildable candidate(s) by numeric discovery_evidence "
            "(weight %.2f on non_overlapping_support, %.2f on smaller critical_impact_du, "
            "min-max normalized across the candidate set). Best: candidate_id=%s with "
            "non_overlapping_support=%s, critical_impact_du=%s, score=%.4f."
            % (
                len(ranked),
                SUPPORT_WEIGHT,
                IMPACT_WEIGHT,
                best["candidate_id"],
                best["support"],
                best["impact"],
                best["score"],
            )
        )
        result = {"selected": [best["candidate_id"]], "reason": reason}

    with open(argv[2], "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2)
        handle.write("\n")

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
