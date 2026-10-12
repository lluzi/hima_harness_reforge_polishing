"""Round-decision logic for the mage-scribe-placement Pack.

`decide()` is the per-round join point `flow/mage_placement_cli.py`'s
`task-decide-round` calls: given one round's candidate document and its
four consumer reviews, it checks every previous-round open Request has a
Ledger answer, computes this candidate's best-state key (`best_state_key`,
spec section 9's lexicographic order), keeps the better of the previous
best state and this one, finds consumer conflicts (`conflicts`) and turns
them into Decision Requests, decides `route: continue|stop`, archives this
round's candidate/review documents under a permanent per-round path (the
Pack's live `state/round/*.json` paths are overwritten every round; see
`_archive_round`), and writes both `state/round-decision.json` and the
cumulative `state/placement-result.json`.

`best_state_key(candidate_metrics, start_native_total)` and
`conflicts(requests)` are exposed separately (the frozen module interface)
so `test_rounds.py` can exercise each rule in isolation against small
hand-built metrics/request fixtures, without going through a whole round.
"""
from __future__ import annotations

from pathlib import Path

from . import core, records


MAX_ROUNDS = 4

# `requestedOutcome.kind` pairs this Pack treats as mutually incompatible
# when two different consumers both name an overlapping target set.
_INCOMPATIBLE_KIND_PAIRS = (
    frozenset({"move", "keep"}),
    frozenset({"place", "keep"}),
)

# A missing/unparseable number sorts as "worse than any real number seen in
# this Pack" in `best_state_key` — large enough that no legitimate count,
# length (um) or deviation could ever reach it, never a bare `0`.
_SENTINEL = 1_000_000_000.0


def _num(value):
    """`float(value)`, or `_SENTINEL` when `value` is missing/unparseable."""
    if value is None:
        return _SENTINEL
    try:
        return float(value)
    except (TypeError, ValueError):
        return _SENTINEL


def best_state_key(candidate_metrics, start_native_total):
    """Lexicographic best-state key (spec section 9); smaller sorts better.

    Order: native violation rows, unplaced priority marks, consumer hard
    failures, dropped-structure count then length, priority marks beyond
    the target-distance limit, max order deviation, total consumer
    rework, moved-instance count, total displacement. `candidate_metrics`
    is a plain dict the caller assembles from a `placement-candidate`
    document's own `metrics` plus `hardFailCount`/`reworkTotal` folded in
    from that round's consumer reviews (see `decide()`).

    `start_native_total` names the start-state native-row baseline a
    "no *new* native violation" reading would compare against. This
    Pack's candidates are rarely run through a native check of the start
    state itself (`start_native_total` is `None` on every round of a
    fresh case, by this task's own resolution), so this key instead
    always ranks a lower absolute native-row count as better — a
    candidate with the same or fewer native rows than any earlier
    candidate already satisfies "no new violation" under that ordering,
    and an unknown count (`_SENTINEL`) still always sorts worse than any
    known one, zero included. The parameter is kept for interface
    stability and so a future caller with a genuine start-state native
    count can thread it through without an interface change.
    """
    del start_native_total

    native = candidate_metrics.get("nativeRows") or {}
    priority_unplaced = candidate_metrics.get("priorityUnplaced") or {}
    drops = candidate_metrics.get("drops") or {}
    target = candidate_metrics.get("targetDistances") or {}
    order = candidate_metrics.get("orderDeviation") or {}
    disp = candidate_metrics.get("displacement") or {}

    return (
        _num(native.get("total")),
        _num(priority_unplaced.get("count")),
        _num(candidate_metrics.get("hardFailCount")),
        _num(drops.get("count")),
        _num(drops.get("lengthUm")),
        _num(target.get("overLimitCount")),
        _num(order.get("max")),
        _num(candidate_metrics.get("reworkTotal")),
        _num(disp.get("movedCount")),
        _num(disp.get("totalUm")),
    )


def conflicts(requests):
    """Pairs of `mage.request/1` dicts from different consumers whose
    `requestedOutcome.targets` intersect and whose `kind`s are mutually
    incompatible (`move`/`keep` or `place`/`keep`)."""
    found = []
    for i in range(len(requests)):
        for j in range(i + 1, len(requests)):
            a, b = requests[i], requests[j]
            if a.get("consumer") == b.get("consumer"):
                continue
            a_targets = set(a["requestedOutcome"]["targets"])
            b_targets = set(b["requestedOutcome"]["targets"])
            if not (a_targets & b_targets):
                continue
            kinds = frozenset({a["requestedOutcome"]["kind"], b["requestedOutcome"]["kind"]})
            if kinds in _INCOMPATIBLE_KIND_PAIRS:
                found.append((a, b))
    return found


def _finding_numbers(reviews, consumer, finding_id):
    for review in reviews:
        if review.get("consumer") != consumer:
            continue
        for finding in review.get("findings", []):
            if finding.get("id") == finding_id:
                return finding.get("numbers", {})
    return {}


def _decision_requests(round_no, reviews, conflict_pairs):
    decisions = []
    for index, (a, b) in enumerate(conflict_pairs, start=1):
        shared = sorted(set(a["requestedOutcome"]["targets"]) & set(b["requestedOutcome"]["targets"]))
        question = (
            f"{a['consumer']} requests {a['requestedOutcome']['kind']} on {shared} while "
            f"{b['consumer']} requests {b['requestedOutcome']['kind']} on the same target(s)"
        )
        options = [
            {
                "id": f"D-{round_no}-{index}-{request['consumer']}",
                "description": request["requestedOutcome"].get("text", ""),
                "perConsumer": {
                    request["consumer"]: _finding_numbers(reviews, request["consumer"], request["fromFinding"])
                },
                "nativeChecked": False,
                "snapshotSha256": request["snapshotSha256"],
            }
            for request in (a, b)
        ]
        decisions.append({
            "schema": "mage.decision-request/1",
            "id": f"D-{round_no}-{index}",
            "round": round_no,
            "question": question,
            "options": options,
            "blockingRequests": [a["id"], b["id"]],
        })
    return decisions


def _archive_round(workspace, round_no, candidate, reviews):
    """Copy this round's candidate+reviews to a permanent per-round path.

    Resident support artifacts are immutable once published (global
    constraints): `state/round/placement-candidate.json` and
    `state/round/review-<role>.json` are overwritten every round, so
    `decide()` keeps its own permanent copy here for
    `placement-result.rounds[]` and for `best.candidatePath` to name.
    Returns `({"path","sha256"}, {role: {"path","sha256"}})`.
    """
    workspace = Path(workspace)
    round_dir = workspace / "state" / "history" / f"round-{round_no:02d}"
    candidate_path = round_dir / "candidate.json"
    core.write_artifact(candidate_path, candidate)
    review_paths = {}
    for review in reviews:
        role = review.get("consumer", "unknown")
        path = round_dir / f"review-{role}.json"
        core.write_artifact(path, review)
        review_paths[role] = {
            "path": str(path.relative_to(workspace)),
            "sha256": core.file_sha256(path),
        }
    return (
        {"path": str(candidate_path.relative_to(workspace)), "sha256": core.file_sha256(candidate_path)},
        review_paths,
    )


def _read_optional(path, kind):
    path = Path(path)
    if not path.is_file():
        return None
    try:
        return core.read_artifact(path, kind)
    except core.MageError:
        return None


def _reader_value(reader_values, type_name):
    for row in reader_values or []:
        if row.get("type") == type_name:
            return row.get("value")
    return None


def _ranking_metrics(reader_values, hard_fail_count, rework_total):
    """The best-state key's input, built only from the *Reader-confirmed*
    values carried in the committed candidate output (C1) -- never the
    candidate document's own self-reported `metrics`. Displacement is left
    empty (it is not a Reader-emitted fact) so it stays a neutral,
    non-discriminating final tiebreaker rather than ranking by an
    unconfirmed number."""
    return {
        "nativeRows": {"total": _reader_value(reader_values, "mage_native_violation_total")},
        "priorityUnplaced": {"count": _reader_value(reader_values, "mage_priority_unplaced_count")},
        "hardFailCount": hard_fail_count,
        "drops": {"count": _reader_value(reader_values, "mage_dropped_count"),
                  "lengthUm": _reader_value(reader_values, "mage_dropped_length_um")},
        "targetDistances": {"overLimitCount": _reader_value(reader_values, "mage_target_over_limit_count")},
        "orderDeviation": {"max": _reader_value(reader_values, "mage_order_deviation_max")},
        "reworkTotal": rework_total,
        "displacement": {},
    }


def _reader_blocked(candidate, reader_values):
    """True when this candidate must never be ranked as a measured state: it
    did not complete, the Reader produced no values, or the Reader's own
    error count is non-zero (C1 -- an errored Reader's candidate is blocked
    for ranking)."""
    if candidate.get("outcome") != "completed":
        return True
    if not reader_values:
        return True
    error_count = _reader_value(reader_values, "mage_candidate_error_count")
    return error_count not in (0, 0.0)


def decide(workspace, round_no, goal, reviews, candidate, previous_decision, skipped_reviews=None):
    """Join one round's consumer reviews against its candidate.

    Returns the `mage.round-decision/1` body (also atomically written to
    `state/round-decision.json`); also (re)writes the cumulative
    `state/placement-result.json`. `goal` is accepted for interface
    stability with the frozen signature; the route rule itself only
    consults the candidate/review documents and round history.

    C1: the round is ranked by the Reader-confirmed values the committed
    candidate output carries (`candidate["_readerValues"]`), never by the
    candidate document's own `metrics`; a candidate the Reader did not pass
    clean (blocked outcome, no values, or a non-zero error count) is ranked
    worst and can never become `best`. `skipped_reviews` (optional) are the
    reviews `task-decide-round` dropped this round (wrong snapshot or wrong
    consumer slot); any review here whose `snapshotSha256` does not match the
    candidate is additionally dropped and recorded, so a mis-bound review is
    treated as "no review from that consumer this round", never a crash.
    """
    del goal
    workspace = Path(workspace)

    skipped = list(skipped_reviews or [])
    matching = []
    for review in reviews:
        if review.get("snapshotSha256") != candidate.get("snapshotSha256"):
            skipped.append({
                "consumer": review.get("consumer"),
                "reason": "review bound to a different snapshot than the candidate",
            })
        else:
            matching.append(review)
    reviews = matching

    open_reqs = records.open_requests(reviews)
    previous_open = (previous_decision or {}).get("openRequests", [])
    coverage = records.ledger_covers(previous_open, candidate.get("ledger", []))
    unanswered_previous = coverage["unanswered"]

    hard_fail_count = sum(
        1
        for review in reviews
        for finding in review.get("findings", [])
        if finding.get("severity") == "hard" and finding.get("status") == "fail"
    )
    rework_total = sum(
        1
        for review in reviews
        for finding in review.get("findings", [])
        if finding.get("severity") == "cost" and finding.get("status") == "fail"
    )

    # best["metrics"] keeps the candidate's full self-reported metrics for
    # the incumbent comparison / report (never for ranking); best["rankMetrics"]
    # is the Reader-confirmed ranking input the key is actually computed from.
    metrics = dict(candidate.get("metrics", {}))
    metrics["hardFailCount"] = hard_fail_count
    metrics["reworkTotal"] = rework_total

    reader_values = candidate.get("_readerValues", [])
    rank_metrics = _ranking_metrics(reader_values, hard_fail_count, rework_total)
    blocked_for_ranking = _reader_blocked(candidate, reader_values)
    key = (_SENTINEL,) * 10 if blocked_for_ranking else best_state_key(rank_metrics, None)

    previous_best = (previous_decision or {}).get("best")
    previous_key = (
        best_state_key(previous_best["rankMetrics"], None)
        if previous_best and previous_best.get("rankMetrics")
        else None
    )
    # I2: the first ranked round is an improvement over nothing -- a first
    # measured state beats "no state at all" -- so it is recorded as
    # `improved: True`. The "no improvement for two consecutive rounds" stop
    # rule therefore needs two genuine consecutive stalls *after* round 1,
    # never counting round 1 itself as the first of the two (the old
    # `improved: False` on round 1 stopped the Run after a single failed
    # round-2 attempt).
    improved = previous_key is None or key < previous_key

    history = list((previous_decision or {}).get("history", []))
    history.append({"round": round_no, "key": list(key), "improved": improved})

    candidate_ref, review_refs = _archive_round(workspace, round_no, candidate, reviews)

    if previous_best is None or improved:
        best = {
            "snapshotSha256": candidate["snapshotSha256"],
            "candidatePath": candidate_ref["path"],
            "metrics": metrics,
            "rankMetrics": rank_metrics,
            "round": round_no,
            "readerValues": reader_values,
            "blocked": blocked_for_ranking,
        }
    else:
        best = previous_best

    # N1: a non-completed (blocked) round is never a clean stop and is never
    # ranked best; while rounds remain it routes `continue` so the loop can
    # still produce a real candidate (and any earlier good round stays
    # deliverable). N3: a skipped (wrong-snapshot or wrong-slot) review is
    # treated as an open hard failure for routing -- never a clean stop.
    round_blocked = candidate.get("outcome") != "completed"
    has_skipped = bool(skipped)
    skipped_consumers = ", ".join(sorted(str(entry.get("consumer")) for entry in skipped))

    # C2 route order: the round limit is checked *first*, so a final round
    # that still carries an unanswered previous Request (or a blocked
    # candidate, or a skipped review) stops (and delivers the best state)
    # instead of routing `continue` into a repeat the Harness has no iteration
    # left for -- which would fail the whole Run with nothing delivered. The
    # reasons are named in the stop reason so the delivery still records them.
    if round_no >= MAX_ROUNDS:
        reasons = []
        if round_blocked:
            reasons.append(f"round {round_no} candidate is blocked ({candidate.get('stopReason') or 'no completed export'})")
        if unanswered_previous:
            reasons.append("unanswered previous request(s): " + ", ".join(unanswered_previous))
        if has_skipped:
            reasons.append("skipped review(s): " + skipped_consumers)
        route = "stop"
        stop_reason = "round limit reached" + ("; " + "; ".join(reasons) if reasons else "")
    elif round_blocked:
        route, stop_reason = "continue", f"round {round_no} candidate is blocked; continuing"
    elif unanswered_previous:
        route, stop_reason = "continue", "unanswered previous request: " + ", ".join(unanswered_previous)
    elif has_skipped:
        route, stop_reason = "continue", "skipped review(s) this round: " + skipped_consumers
    elif not hard_fail_count and not open_reqs:
        # Spec section 4, verbatim: stop when there is no consumer
        # hard-fail Finding AND no open Request this round.
        route, stop_reason = "stop", "no consumer hard failure and no open request"
    elif len(history) >= 2 and not history[-1]["improved"] and not history[-2]["improved"]:
        route, stop_reason = "stop", "no improvement for two consecutive rounds"
    else:
        route, stop_reason = "continue", ""

    conflict_pairs = conflicts(open_reqs)
    decision_requests = _decision_requests(round_no, reviews, conflict_pairs)

    decision = core.stamp(
        "round-decision",
        {
            "round": round_no,
            "route": route,
            "nextRound": {"round": round_no + 1},
            "best": best,
            "openRequests": open_reqs,
            "decisionRequests": decision_requests,
            "history": history,
            "stopReason": stop_reason,
            "skippedReviews": skipped,
        },
    )
    core.write_artifact(workspace / "state" / "round-decision.json", decision)

    previous_result = _read_optional(workspace / "state" / "placement-result.json", "placement-result")
    rounds_list = list((previous_result or {}).get("rounds", []))
    rounds_list.append({"round": round_no, "candidate": candidate_ref, "reviews": review_refs})

    outcome = (
        "blocked"
        if candidate.get("outcome") == "blocked"
        else "completed" if (route == "stop" and not open_reqs and not decision_requests) else "best-effort"
    )

    result = core.stamp(
        "placement-result",
        {
            "best": best,
            "rounds": rounds_list,
            "consumerModels": sorted({r.get("consumerModel") for r in reviews if r.get("consumerModel")}),
            "consumerContextSha256": (previous_result or {}).get("consumerContextSha256", ""),
            "decisionRequests": decision_requests,
            "metrics": metrics,
            "incumbent": (previous_result or {}).get("incumbent", {}),
            "outcome": outcome,
            "stopReason": stop_reason,
        },
    )
    core.write_artifact(workspace / "state" / "placement-result.json", result)

    return decision
