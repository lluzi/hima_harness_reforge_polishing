"""Round decision for the mage-script-placement Pack.

`decide()` joins one round's Engineer candidate (ranked only by the
Reader-confirmed values the committed output carries) against the previous
decision: it keeps the better of the previous best and this candidate,
appends the round's validated journal entry to `state/method-journal.json`,
archives the candidate under `state/history/round-NN/candidate.json`,
routes `continue|stop`, and writes `state/round-decision.json` and the
cumulative `state/script-result.json`.
"""
from __future__ import annotations

import json
from pathlib import Path

from . import core, records


MAX_ROUNDS = 6
_SENTINEL = 1_000_000_000.0

RULES = (
    ("placement-delivery-ready", "mage_candidate_error_count", "eq", 0),
    ("priority-all-placed", "mage_priority_unplaced_count", "eq", 0),
    ("no-native-violation", "mage_native_violation_total", "eq", 0),
    ("drops-within-goal", "mage_dropped_count", "lte", "target_dropped_count"),
    ("target-limit-met", "mage_target_distance_max_um", "lte", "max_target_distance_um"),
    ("order-lr-within-goal", "mage_order_deviation_max_lr", "lte", "max_order_deviation_lr"),
    ("order-tb-within-goal", "mage_order_deviation_max_tb", "lte", "max_order_deviation_tb"),
    ("priority-move-within-budget", "mage_priority_move_max_um", "lte", "max_priority_move_um"),
)
RULE_IDS = tuple(r[0] for r in RULES)


def reader_value(reader_values, type_name):
    for row in reader_values or []:
        if row.get("type") == type_name:
            return row.get("value")
    return None


def rule_results(reader_values, goal):
    results = {}
    for rule_id, fact, op, threshold in RULES:
        value = reader_value(reader_values, fact)
        limit = goal[threshold] if isinstance(threshold, str) else threshold
        if value is None:
            results[rule_id] = "UNKNOWN"
        elif op == "eq":
            results[rule_id] = "PASS" if float(value) == float(limit) else "FAIL"
        else:
            results[rule_id] = "PASS" if float(value) <= float(limit) else "FAIL"
    return results


def _num(value):
    if value is None:
        return _SENTINEL
    try:
        return float(value)
    except (TypeError, ValueError):
        return _SENTINEL


def best_state_key(reader_values):
    """Lexicographic key, smaller is better: native rows, unplaced priority marks,
    ordinary drop count, ordinary drop length, target over-limit count, max(order lr, tb),
    moved priority count, max priority move. Unknown sorts worst."""
    v = lambda t: _num(reader_value(reader_values, t))  # noqa: E731
    return (v("mage_native_violation_total"), v("mage_priority_unplaced_count"), v("mage_dropped_ordinary_count"),
            v("mage_dropped_ordinary_length_um"), v("mage_target_over_limit_count"),
            max(v("mage_order_deviation_max_lr"), v("mage_order_deviation_max_tb")),
            v("mage_priority_moved_count"), v("mage_priority_move_max_um"))


def _blocked(candidate, reader_values):
    return candidate.get("outcome") != "completed" or not reader_values or reader_value(reader_values, "mage_candidate_error_count") not in (0, 0.0)


def _archive(workspace, round_no, candidate):
    path = Path(workspace) / "state" / "history" / ("round-%02d" % round_no) / "candidate.json"
    body = {k: v for k, v in candidate.items() if not k.startswith("_")}
    core.write_artifact(path, body)
    return {"path": str(path.relative_to(Path(workspace))), "sha256": core.file_sha256(path)}


def _append_journal(workspace, round_no, candidate, best_round):
    workspace = Path(workspace)
    journal_ref = candidate.get("files", {}).get("journal")
    if not journal_ref:
        raise core.MageError("missing-input", "candidate names no journal entry")
    entry_path = workspace / journal_ref["path"]
    entry = json.loads(entry_path.read_text(encoding="utf-8"))
    errors = records.validate_record("journal-entry", entry)
    if errors or entry.get("round") != round_no:
        raise core.MageError("schema", "; ".join(errors) or "journal entry round mismatch")
    path = workspace / "state" / "method-journal.json"
    journal = core.read_artifact(path, "method-journal") if path.is_file() else {"entries": []}
    entries = [e for e in journal.get("entries", []) if e.get("round") != round_no] + [entry]
    doc = core.stamp("method-journal", {"entries": entries, "bestRound": best_round})
    core.write_artifact(path, doc)
    return {"path": "state/method-journal.json", "sha256": core.file_sha256(path)}, len(entries)


def decide(workspace, round_no, goal, candidate, previous_decision):
    workspace = Path(workspace)
    reader_values = candidate.get("_readerValues", [])
    blocked = _blocked(candidate, reader_values)
    key = (_SENTINEL,) * 8 if blocked else best_state_key(reader_values)
    previous_best = (previous_decision or {}).get("best")
    previous_key = tuple(previous_best["key"]) if previous_best else None
    improved = (not blocked) and (previous_key is None or key < previous_key)
    history = [h for h in (previous_decision or {}).get("history", []) if h.get("round") != round_no] + [
        {"round": round_no, "key": list(key), "improved": improved, "blocked": blocked}]
    candidate_ref = _archive(workspace, round_no, candidate)
    if improved:
        best = {"snapshotSha256": candidate["snapshotSha256"], "candidatePath": candidate_ref["path"],
                "metrics": dict(candidate.get("metrics", {})), "rankMetrics": {}, "key": list(key), "round": round_no,
                "readerValues": reader_values, "blocked": False}
    else:
        best = previous_best
    rules = rule_results(best["readerValues"], goal) if best else {r: "UNKNOWN" for r in RULE_IDS}
    goal_met = bool(best) and all(v == "PASS" for v in rules.values())
    journal_ref, entry_count = _append_journal(workspace, round_no, candidate, best["round"] if best else None)

    # Plan amendment 2026-10-13 (final review, finding 1): only completed,
    # ranked rounds count toward the two-stall rule. A blocked round neither
    # counts as a stall nor resets the counter -- it is transparent, so that
    # (for example) a blocked round 2 that reached explicit compaction does
    # not conspire with a non-improving round 3 to end the Run before the
    # method has been tried. The round limit (MAX_ROUNDS) stays the hard cap.
    stalls = 0
    for item in reversed(history[1:]):
        if item.get("blocked"):
            continue
        if item["improved"]:
            break
        stalls += 1
    if round_no >= MAX_ROUNDS:
        route, reason = "stop", "round limit reached" + ("; round %d candidate is blocked" % round_no if blocked else "")
    elif blocked:
        route, reason = "continue", "round %d candidate is blocked (%s); continuing" % (round_no, candidate.get("stopReason", ""))
    elif goal_met:
        route, reason = "stop", "goal met"
    elif stalls >= 2:
        route, reason = "stop", "no improvement for two consecutive rounds"
    else:
        route, reason = "continue", ""

    decision = core.stamp("round-decision", {
        "round": round_no, "route": route, "nextRound": {"round": round_no + 1}, "best": best, "history": history,
        "stopReason": reason, "goalMet": goal_met, "rules": rules, "blockedRound": blocked,
    })
    core.write_artifact(workspace / "state" / "round-decision.json", decision)

    result_path = workspace / "state" / "script-result.json"
    previous_result = core.read_artifact(result_path, "script-result") if result_path.is_file() else {}
    rounds_list = [r for r in previous_result.get("rounds", []) if r.get("round") != round_no] + [
        {"round": round_no, "candidate": candidate_ref}]
    outcome = "blocked" if best is None else ("completed" if goal_met else "best-effort")
    result = core.stamp("script-result", {
        "best": best, "rounds": rounds_list, "journal": journal_ref, "metrics": (best or {}).get("metrics", {}),
        "incumbent": previous_result.get("incumbent", {}), "outcome": outcome, "stopReason": reason,
    })
    core.write_artifact(result_path, result)
    decision["_journalEntries"] = entry_count
    return decision
