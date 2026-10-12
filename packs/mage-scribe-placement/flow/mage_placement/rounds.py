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


def decide(workspace, round_no, goal, reviews, candidate, previous_decision):
    """Join one round's four consumer reviews against its candidate.

    Returns the `mage.round-decision/1` body (also atomically written to
    `state/round-decision.json`); also (re)writes the cumulative
    `state/placement-result.json`. `goal` is accepted for interface
    stability with the frozen signature; the route rule itself only
    consults the candidate/review documents and round history — the Goal
    knobs are consulted by the Engineer and the consumers that produced
    them, and again later by `evaluate-placement`'s rule predicates.
    """
    del goal
    workspace = Path(workspace)

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

    metrics = dict(candidate.get("metrics", {}))
    metrics["hardFailCount"] = hard_fail_count
    metrics["reworkTotal"] = rework_total

    key = best_state_key(metrics, None)

    previous_best = (previous_decision or {}).get("best")
    previous_key = (
        best_state_key(previous_best["metrics"], None)
        if previous_best and previous_best.get("metrics")
        else None
    )
    # A round with no prior best to compare against (round 1, with no
    # start/incumbent native baseline wired in) cannot yet claim an actual
    # improvement -- it is recorded as `improved: False` in `history` (the
    # "no improvement for two consecutive rounds" stop rule's own baseline),
    # even though it unconditionally becomes `best` below (there being
    # nothing better yet to keep instead).
    improved = previous_key is not None and key < previous_key

    history = list((previous_decision or {}).get("history", []))
    history.append({"round": round_no, "key": list(key), "improved": improved})

    candidate_ref, review_refs = _archive_round(workspace, round_no, candidate, reviews)

    if previous_best is None or improved:
        best = {
            "snapshotSha256": candidate["snapshotSha256"],
            "candidatePath": candidate_ref["path"],
            "metrics": metrics,
            "round": round_no,
            "readerValues": candidate.get("_readerValues", []),
        }
    else:
        best = previous_best

    if unanswered_previous:
        route, stop_reason = "continue", "unanswered previous request: " + ", ".join(unanswered_previous)
    elif not hard_fail_count and not open_reqs:
        # Spec section 4, verbatim: stop when there is no consumer
        # hard-fail Finding AND no open Request this round.
        route, stop_reason = "stop", "no consumer hard failure and no open request"
    elif len(history) >= 2 and not history[-1]["improved"] and not history[-2]["improved"]:
        # Checked before the round-limit condition below: when a round
        # both hits the limit and shows no improvement over the one
        # before it, the no-improvement reason is the more informative of
        # the two (the limit is implied; the stall is the actual cause).
        route, stop_reason = "stop", "no improvement for two consecutive rounds"
    elif round_no >= MAX_ROUNDS:
        route, stop_reason = "stop", "round limit reached"
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
