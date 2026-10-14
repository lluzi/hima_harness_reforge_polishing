"""Judge rules, legality, ranking and the round decision (stdlib only).

:data:`RULES` is the SPEC Judge-rules table (id, subject value type, predicate
and whether it is a hard limit or a Goal rule). :func:`rule_results` evaluates
them against one candidate's Reader values; :func:`legal` is the hard-limit
conjunction; :func:`rank_key` orders legal candidates; :func:`decide`
implements the SPEC Choosers (trust-radius update, best legal, goal-met,
converged, blocked, round-limit) and returns a ``pixel.round-decision/1``
document.

This module imports nothing outside the standard library.
"""
from __future__ import annotations

__all__ = ["RULES", "HARD_RULES", "GOAL_RULES", "rule_results", "legal",
           "rank_key", "decide"]

_INF = float("inf")

# (rule id, subject value type, op, threshold, hard?, edge?)
#   op "eq": threshold is a literal number.
#   op "le"/"ge": threshold is a resolved-Goal value key.
#   edge True: a transmittance rule, NOT_DECLARED when its Goal edge is None.
RULES = [
    ("receipt-verified", "pixel_receipt_error_count", "eq", 0, True, False),
    ("drc-authority-1x1-clean", "pixel_drc_authority_1x1", "eq", 0, True, False),
    ("drc-authority-2x2-clean", "pixel_drc_authority_2x2", "eq", 0, True, False),
    ("drc-authority-3x3-clean", "pixel_drc_authority_3x3", "eq", 0, True, False),
    ("interact-rules-clean", "pixel_interact_violations", "eq", 0, True, False),
    ("lvs-correct", "pixel_lvs_correct", "eq", 1, True, False),
    ("channels-unchanged", "pixel_channels_changed", "eq", 0, True, False),
    ("no-undeclared-change", "pixel_undeclared_change_count", "eq", 0, True, False),
    ("couplings-within-limit", "pixel_coupling_over_limit_count", "eq", 0, True, False),
    ("loads-within-allowance", "pixel_load_over_limit_count", "eq", 0, True, False),
    ("transmittance-above-min", "pixel_t_judged_pct", "ge", "t_min_pct", True, True),
    ("transmittance-below-max", "pixel_t_judged_pct", "le", "t_max_pct", True, True),
    ("outline-width-met", "pixel_outline_w_um", "le", "outline_w_um", False, False),
    ("outline-height-met", "pixel_outline_h_um", "le", "outline_h_um", False, False),
    ("ratio-met", "pixel_ratio_judged_pct", "le", "ratio_target_pct", False, False),
]
HARD_RULES = tuple(r[0] for r in RULES if r[4])
GOAL_RULES = tuple(r[0] for r in RULES if not r[4])


def _as_map(values):
    """Accept either a ``{type: value}`` map or a list of Reader rows."""
    if isinstance(values, dict):
        return values
    out = {}
    for row in values or []:
        if isinstance(row, dict) and "type" in row:
            out[row["type"]] = row.get("value")
    return out


def _num(x):
    if isinstance(x, bool):
        return None
    if isinstance(x, (int, float)):
        return float(x)
    return None


def rule_results(values, goal_resolved):
    """Return ``{rule_id: 'PASS'|'FAIL'|'UNKNOWN'|'NOT_DECLARED'}``.

    A ``null`` subject is ``UNKNOWN`` (never a PASS); a transmittance rule
    whose Goal edge did not resolve is ``NOT_DECLARED``.
    """
    vmap = _as_map(values)
    gvalues = (goal_resolved or {}).get("values", {}) or {}
    out = {}
    for rid, type_, op, thr, _hard, edge in RULES:
        v = _num(vmap.get(type_))
        if op == "eq":
            limit = thr
        else:
            limit = _num(gvalues.get(thr))
        if edge and limit is None:
            out[rid] = "NOT_DECLARED"
            continue
        if v is None or limit is None:
            out[rid] = "UNKNOWN"
        elif op == "eq":
            out[rid] = "PASS" if v == limit else "FAIL"
        elif op == "le":
            out[rid] = "PASS" if v <= limit else "FAIL"
        else:  # ge
            out[rid] = "PASS" if v >= limit else "FAIL"
    return out


def legal(values, goal_resolved):
    """True when every hard-limit rule is PASS (a NOT_DECLARED edge is no bar)."""
    results = rule_results(values, goal_resolved)
    for rid in HARD_RULES:
        if results[rid] not in ("PASS", "NOT_DECLARED"):
            return False
    return True


def _outline_met(vmap, gvalues):
    w = _num(vmap.get("pixel_outline_w_um"))
    h = _num(vmap.get("pixel_outline_h_um"))
    tw = _num(gvalues.get("outline_w_um"))
    th = _num(gvalues.get("outline_h_um"))
    met = 0
    if w is not None and tw is not None and w <= tw:
        met += 1
    if h is not None and th is not None and h <= th:
        met += 1
    return met


def _area(vmap):
    w = _num(vmap.get("pixel_outline_w_um"))
    h = _num(vmap.get("pixel_outline_h_um"))
    if w is None or h is None:
        return _INF
    return w * h


def rank_key(values, goal_resolved):
    """Sort key (smaller is better): legal first, then outline targets met
    (more first), then the judged ratio, then the cell area."""
    vmap = _as_map(values)
    gvalues = (goal_resolved or {}).get("values", {}) or {}
    is_legal = legal(vmap, goal_resolved)
    met = _outline_met(vmap, gvalues)
    ratio = _num(vmap.get("pixel_ratio_judged_pct"))
    return (0 if is_legal else 1, -met, ratio if ratio is not None else _INF, _area(vmap))


def _hard_failures(vmap, goal_resolved):
    results = rule_results(vmap, goal_resolved)
    return [rid for rid in HARD_RULES if results[rid] not in ("PASS", "NOT_DECLARED")]


def _best_legal(history, goal_resolved):
    """The best legal, non-exploratory candidate across all judged history."""
    best = None
    best_key = None
    for row in history:
        if row.get("exploratory"):
            continue
        vmap = _as_map(row.get("values", {}))
        if not legal(vmap, goal_resolved):
            continue
        key = rank_key(vmap, goal_resolved)
        if best_key is None or key < best_key:
            best, best_key = row, key
    return best


def _best_effort(history, goal_resolved):
    """When nothing is legal: the candidate with the fewest hard failures."""
    best = None
    best_key = None
    for row in history:
        if row.get("exploratory"):
            continue
        vmap = _as_map(row.get("values", {}))
        failures = len(_hard_failures(vmap, goal_resolved))
        ratio = _num(vmap.get("pixel_ratio_judged_pct"))
        key = (failures, ratio if ratio is not None else _INF, _area(vmap))
        if best_key is None or key < best_key:
            best, best_key = row, key
    return best


def _running_best_ratio_by_round(history, goal_resolved):
    """Running minimum legal, non-exploratory judged ratio after each round.

    The running best carries forward across rounds, so once a legal candidate
    is found every later round records at least that ratio.
    """
    by_round = {}
    running = None
    for row in history:
        rnd = row.get("round")
        if not row.get("exploratory"):
            vmap = _as_map(row.get("values", {}))
            ratio = _num(vmap.get("pixel_ratio_judged_pct"))
            if ratio is not None and legal(vmap, goal_resolved):
                running = ratio if running is None else min(running, ratio)
        if rnd is not None:
            by_round[rnd] = running
    return by_round


def _best_as_of(by_round, round_no):
    """The running best legal ratio as of ``round_no``: the value recorded at
    the latest round at or before it (the running best carries forward)."""
    best = None
    best_round = None
    for rnd, value in by_round.items():
        if rnd <= round_no and (best_round is None or rnd > best_round):
            best_round, best = rnd, value
    return best


def _goal_met(best, goal_resolved):
    if best is None:
        return False
    results = rule_results(best.get("values", {}), goal_resolved)
    return all(results[rid] == "PASS" for rid in GOAL_RULES)


def _blocked_evidence(history, goal_resolved, best, card):
    """Evidence that the unmet target needs a hard limit broken.

    (a) a judged exploratory front point that meets an unmet Goal target while
    failing a hard limit; or (b) a minimum-pitch bound above the target
    outline with ``topologyMoves`` off.
    """
    gvalues = (goal_resolved or {}).get("values", {}) or {}
    tw = _num(gvalues.get("outline_w_um"))
    th = _num(gvalues.get("outline_h_um"))
    tr = _num(gvalues.get("ratio_target_pct"))

    # which Goal targets are unmet on the best legal candidate?
    best_results = rule_results(best.get("values", {}), goal_resolved) if best else {}
    ratio_unmet = best is None or best_results.get("ratio-met") != "PASS"
    width_unmet = best is None or best_results.get("outline-width-met") != "PASS"
    height_unmet = best is None or best_results.get("outline-height-met") != "PASS"

    # (a) an exploratory point meeting an unmet target while illegal.
    for row in history:
        if not row.get("exploratory"):
            continue
        vmap = _as_map(row.get("values", {}))
        if legal(vmap, goal_resolved):
            continue
        ratio = _num(vmap.get("pixel_ratio_judged_pct"))
        w = _num(vmap.get("pixel_outline_w_um"))
        h = _num(vmap.get("pixel_outline_h_um"))
        if ratio_unmet and ratio is not None and tr is not None and ratio <= tr:
            return True
        if width_unmet and w is not None and tw is not None and w <= tw \
                and height_unmet and h is not None and th is not None and h <= th:
            return True

    # (b) a minimum-pitch bound above the target outline, topology frozen.
    if (goal_resolved or {}).get("topologyMoves", "off") == "off" and isinstance(card, dict):
        pb = card.get("pitchBound", {}) or {}
        px = _num((pb.get("x") or {}).get("pitchUm"))
        py = _num((pb.get("y") or {}).get("pitchUm"))
        if width_unmet and px is not None and tw is not None and px > tw + 1e-9:
            return True
        if height_unmet and py is not None and th is not None and py > th + 1e-9:
            return True
    return False


def _reference_ratio(history, previous_decision, goal_resolved):
    """The ratio the round's predicted/measured gains are measured from:
    the previous best legal, else the original (history entry 0)."""
    prev_best = (previous_decision or {}).get("best")
    if prev_best:
        r = _num(_as_map(prev_best.get("values", {})).get("pixel_ratio_judged_pct"))
        if r is not None:
            return r
    for row in history:
        if row.get("id") == "original":
            return _num(_as_map(row.get("values", {})).get("pixel_ratio_judged_pct"))
    return None


def _trust_radius(round_no, history, previous_decision, goal_resolved):
    """Double the trust radius when measured gain reached at least half the
    predicted gain, else halve it; bound to [0.05, 2.0] um."""
    prev = _num((previous_decision or {}).get("trustRadiusUm")) or 0.5
    ref = _reference_ratio(history, previous_decision, goal_resolved)
    rows = []
    for row in history:
        if row.get("round") != round_no or row.get("exploratory"):
            continue
        predicted = (row.get("predicted") or {})
        pr = _num((predicted.get("ratioPct") or {}).get("broad")) \
            if isinstance(predicted.get("ratioPct"), dict) else _num(predicted.get("ratioPct"))
        measured = _num(_as_map(row.get("values", {})).get("pixel_ratio_judged_pct"))
        if pr is None or measured is None or ref is None:
            continue
        rows.append((ref - pr, ref - measured, row.get("id")))

    pv_list = [{"id": rid, "predictedGain": pg, "measuredGain": mg} for pg, mg, rid in rows]

    rep = None
    for pg, mg, rid in rows:
        if rep is None or pg > rep[0]:
            rep = (pg, mg, rid)
    if rep is not None and rep[0] > 0:
        new = prev * 2.0 if rep[1] >= 0.5 * rep[0] else prev * 0.5
    else:
        new = prev
    new = max(0.05, min(2.0, new))
    return round(new, 6), pv_list


def _front(history, round_no):
    out = []
    for row in history:
        if row.get("round") != round_no:
            continue
        vmap = _as_map(row.get("values", {}))
        out.append({
            "id": row.get("id"),
            "outlineUm": [vmap.get("pixel_outline_w_um"), vmap.get("pixel_outline_h_um")],
            "ratioPct": vmap.get("pixel_ratio_judged_pct"),
            "legal": bool(row.get("legal")),
            "exploratory": bool(row.get("exploratory")),
        })
    return out


def decide(round_no, goal_resolved, history, previous_decision=None, card=None):
    """Return a ``pixel.round-decision/1`` document for one round.

    ``history`` is every judged candidate so far (the Task 6 history lines);
    ``card`` (optional) carries the minimum-pitch bound used for blocked
    evidence. The document names the route, the next round, the stop reason,
    the best legal candidate and its values, the front, the next trust radius,
    the predicted-vs-measured gains and the open markers.
    """
    band = _num((goal_resolved or {}).get("convergeBandPct")) or 0.02

    best = _best_legal(history, goal_resolved)
    if best is None:
        best = _best_effort(history, goal_resolved)
        best_is_legal = False
    else:
        best_is_legal = True

    goal_met = best_is_legal and _goal_met(best, goal_resolved)

    # Converged: the best legal judged ratio barely improved over the last two
    # rounds. The best-so-far carries forward, so a round that produced no new
    # legal candidate is no improvement, not a gap: we read the best legal ratio
    # as of round_no and as of round_no-1 (each the running best over every
    # earlier round, carried across rounds that added nothing).
    by_round = _running_best_ratio_by_round(history, goal_resolved)
    converged = False
    if round_no >= 2:
        now = _best_as_of(by_round, round_no)
        earlier = _best_as_of(by_round, round_no - 1)
        if earlier is not None and now is not None and (earlier - now) < band:
            converged = True

    trust, pv_list = _trust_radius(round_no, history, previous_decision, goal_resolved)

    at_limit = round_no >= 6
    blocked = False
    if not goal_met and (converged or at_limit):
        blocked = _blocked_evidence(history, goal_resolved, best if best_is_legal else None, card)

    if goal_met:
        route, reason = "stop", "goal-met"
    elif blocked:
        route, reason = "stop", "blocked"
    elif at_limit:
        route, reason = "stop", "round-limit"
    elif converged:
        route, reason = "stop", "converged"
    else:
        route, reason = "continue", ""

    best_doc = None
    if best is not None:
        best_doc = {
            "id": best.get("id"),
            "values": _as_map(best.get("values", {})),
            "legal": best_is_legal,
        }

    open_markers = []
    if isinstance(card, dict):
        open_markers = list(card.get("openMarkers", []) or [])

    return {
        "schema": "pixel.round-decision/1",
        "round": round_no,
        "route": route,
        "nextRound": {"round": round_no + 1},
        "stopReason": reason,
        "goalMet": bool(goal_met),
        "best": best_doc,
        "front": _front(history, round_no),
        "trustRadiusUm": trust,
        "predictedVsMeasured": pv_list,
        "openMarkers": open_markers,
        "rules": rule_results(best.get("values", {}) if best else {}, goal_resolved),
    }
