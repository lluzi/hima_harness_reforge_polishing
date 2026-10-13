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

from . import core, metrics, records


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


# The six measurable delivery rules the Goal is judged on (the seventh rule,
# `no-open-requests`, is a delivery-time composite that depends on the final
# decision's open/decision/skipped counts, so it stays in `evaluate_placement`
# and is deliberately NOT part of this per-round, values-only reading).
_GOAL_RULE_CHECKS = (
    ("placement-delivery-ready", "mage_candidate_error_count", "eq", 0),
    ("priority-all-placed", "mage_priority_unplaced_count", "eq", 0),
    ("drops-within-goal", "mage_dropped_count", "lte", "target_dropped_count"),
    # Part A: target-limit-met judges the Run-owned reading -- marks this Run
    # moved beyond the limit, never marks already beyond it in the frozen start.
    ("target-limit-met", "mage_target_over_limit_new_count", "eq", 0),
    ("order-within-goal", "mage_order_deviation_max", "lte", "max_order_deviation"),
)


def _reader_measure(reader_values, type_name):
    """`{"value": x}` for a known Reader value, or `{"unknown": reason}` when the
    type was not emitted or carries a `None` value (the Reader-value reading
    `evaluate_placement` once did inline for every delivery rule)."""
    for row in reader_values or []:
        if row.get("type") == type_name:
            if row.get("value") is None:
                return {"unknown": row.get("unknownReason")}
            return {"value": row.get("value")}
    return {"unknown": "%s was not emitted" % type_name}


def _goal_rule_report(reader_values, goal, native_anchor):
    """The six measurable delivery rules, evaluated on ONE round's Reader
    values exactly as `evaluate_placement` computes them today.

    Returns `(rules, unknowns, native_basis)`:
      * `rules` — `{rule_id: "PASS"|"FAIL"|"UNKNOWN"}` for the six measurable
        rules (`no-open-requests` is not included; it is the delivery-time
        composite `evaluate_placement` owns);
      * `unknowns` — the `{"rule","type","reason"}` records for every rule
        that read UNKNOWN, in the same order `evaluate_placement` emitted them
        (the five simple checks first, then the native composite);
      * `native_basis` — the `regressionBasis.native` block.

    `goal_rules()` is the thin public wrapper returning only `rules`; both
    `decide()` (per-round goal-met check) and `evaluate_placement()` (the
    delivered rules plus the report detail) read through this one helper, so
    the goal reading is computed in exactly one place.
    """
    goal = goal or {}
    rules = {}
    unknowns = []

    for rule_id, type_name, op, threshold_spec in _GOAL_RULE_CHECKS:
        measure = _reader_measure(reader_values, type_name)
        if "value" not in measure:
            rules[rule_id] = "UNKNOWN"
            unknowns.append({"rule": rule_id, "type": type_name, "reason": measure.get("unknown")})
            continue
        threshold = threshold_spec if op == "eq" else goal.get(threshold_spec)
        if op == "lte" and threshold is None:
            rules[rule_id] = "UNKNOWN"
            unknowns.append({"rule": rule_id, "type": type_name,
                             "reason": "%s goal threshold is unknown" % threshold_spec})
            continue
        value = measure["value"]
        passed = (value == threshold) if op == "eq" else (value <= threshold)
        rules[rule_id] = "PASS" if passed else "FAIL"

    # Part B native composite (anchor delta / absolute fallback), identical to
    # the reading `evaluate_placement` performed inline.
    def _reader_number(type_name):
        for row in reader_values or []:
            if row.get("type") == type_name:
                return row.get("value")
        return None

    best_native_rows = {t: _reader_number("mage_native_%s_rows" % t.lower()) for t in metrics.NATIVE_TYPES}
    per_type_known = all(best_native_rows[t] is not None for t in metrics.NATIVE_TYPES)
    if native_anchor and per_type_known:
        anchor_rows = native_anchor.get("rows", {})
        new_rows = sum(max(0, best_native_rows[t] - (anchor_rows.get(t) or 0)) for t in metrics.NATIVE_TYPES)
        rules["no-native-violation"] = "PASS" if new_rows == 0 else "FAIL"
        native_basis = {
            "basis": "anchor", "anchorRound": native_anchor.get("round"), "anchorRows": anchor_rows,
            "bestRows": best_native_rows, "newRows": new_rows,
        }
    elif native_anchor:
        rules["no-native-violation"] = "UNKNOWN"
        unknowns.append({"rule": "no-native-violation", "type": "mage_native_violation_total",
                         "reason": "a native per-type row is unknown; anchor delta cannot be computed"})
        native_basis = {
            "basis": "anchor", "anchorRound": native_anchor.get("round"),
            "anchorRows": native_anchor.get("rows"), "bestRows": best_native_rows, "newRows": None,
        }
    else:
        total_measure = _reader_measure(reader_values, "mage_native_violation_total")
        if "value" not in total_measure:
            rules["no-native-violation"] = "UNKNOWN"
            unknowns.append({"rule": "no-native-violation", "type": "mage_native_violation_total",
                             "reason": total_measure.get("unknown")})
            new_rows = None
        else:
            total = total_measure["value"]
            rules["no-native-violation"] = "PASS" if total == 0 else "FAIL"
            new_rows = total
        native_basis = {
            "basis": "absolute", "anchorRound": None, "anchorRows": None,
            "bestRows": best_native_rows, "newRows": new_rows,
        }

    return rules, unknowns, native_basis


def goal_rules(reader_values, goal, native_anchor):
    """`{rule_id: "PASS"|"FAIL"|"UNKNOWN"}` for the six measurable delivery
    rules on ONE round's Reader values. UNKNOWN whenever a needed Reader value
    was not emitted (or carries `None`) or a Goal threshold is missing. See
    `_goal_rule_report` for the shared computation."""
    return _goal_rule_report(reader_values, goal, native_anchor)[0]


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
    `state/placement-result.json`. `goal` carries the Run owner's three
    knobs (`target_dropped_count`, `max_target_distance_um`,
    `max_order_deviation`); the route rule reads it through `goal_rules()`
    so the loop keeps working toward the Goal even when no consumer is
    asking for anything -- a round whose Goal is not yet met (UNKNOWN
    counts as not met) routes `continue` even with no hard failure and no
    open Request, and only a Goal-met round with nothing open stops clean.

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

    # Part B: the native anchor is round 1's faithful reproduction of the
    # frozen start -- a completed, cleanly-read round that moved nothing and
    # whose three native row counts are all known. The incumbent's own native
    # fill may already carry a row (e.g. a SPACE row); reproducing it is this
    # Run's anchor, so the no-native-violation composite can later count only
    # rows introduced BEYOND it. Once set it is carried forward unchanged; a
    # round-1 that moved any mark forfeits the anchor for the whole Run.
    native_anchor = (previous_decision or {}).get("nativeAnchor")
    if not native_anchor:
        moved_count = _reader_value(reader_values, "mage_moved_count")
        anchor_rows = {
            "OVERLAP": _reader_value(reader_values, "mage_native_overlap_rows"),
            "SPACE": _reader_value(reader_values, "mage_native_space_rows"),
            "BOUNDARY": _reader_value(reader_values, "mage_native_boundary_rows"),
        }
        if (candidate.get("outcome") == "completed" and not blocked_for_ranking
                and moved_count == 0 and all(v is not None for v in anchor_rows.values())):
            native_anchor = {
                "round": round_no,
                "snapshotSha256": candidate["snapshotSha256"],
                "rows": dict(anchor_rows),
                "total": sum(anchor_rows.values()),
            }
        else:
            native_anchor = None

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

    # The Run's purpose is the Goal, not a quiet consumer set. `goal_rules`
    # reads THIS round's Reader values (UNKNOWN counts as not met); a blocked
    # round that produced no measured state is never goal-met regardless of
    # what it read. So the loop keeps going while the Goal is unmet and rounds
    # remain, instead of stopping the moment no consumer is filing a Request.
    goal_rules_result = goal_rules(reader_values, goal, native_anchor)
    goal_met_this_round = (not blocked_for_ranking) and all(
        value == "PASS" for value in goal_rules_result.values()
    )

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
    elif len(history) >= 2 and not history[-1]["improved"] and not history[-2]["improved"]:
        # Two consecutive non-improving rounds after round 1 (I2): the
        # Engineer has stopped making progress, so the loop ends on the best
        # state even if the Goal is still unmet or a Request is still open.
        route, stop_reason = "stop", "no improvement for two consecutive rounds"
    elif hard_fail_count or open_reqs:
        # A consumer is still asking for something: keep the loop open.
        route, stop_reason = "continue", ""
    elif not goal_met_this_round:
        # No consumer is asking, but the Goal is not yet met on this round's
        # values -- the Run's purpose is the Goal, so keep improving toward it
        # (this is the defect fix: the Run no longer stops at the first quiet
        # round with the Goal unmet and rounds still to spend).
        route, stop_reason = ("continue",
                              "Goal not yet met on this round's values; no consumer hard failure "
                              "or open Request; continuing to improve")
    else:
        # Goal met and nothing open: the clean stop.
        route, stop_reason = "stop", "Goal met; no consumer hard failure and no open request"

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
            "nativeAnchor": native_anchor,
            "goalRules": goal_rules_result,
            "goalMetThisRound": goal_met_this_round,
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
            "nativeAnchor": native_anchor,
        },
    )
    core.write_artifact(workspace / "state" / "placement-result.json", result)

    return decision
