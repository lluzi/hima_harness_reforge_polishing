"""The program-task entry points of the pixel-layout-optimization Pack.

:func:`execute` is the ABI adapter the CLI's ``task-<id>`` branch calls; each
task function takes ``(workspace, inputs)`` and returns
``{"schemaVersion": "1", "value": ..., "artifacts": [...], "diagnostics": []}``.
Tasks persist their real work as ``state/*.json`` and candidate directories in
the Campaign workspace and carry only a small value document through the graph.

Numeric work (``num-*``) is driven through :func:`pixelopt.numeric.run`, which
launches it in the EDA container; this module itself imports nothing numeric
and runs on the Site host's ``python3``.
"""
from __future__ import annotations

import os
import shutil

from . import (core, goal as goal_mod, history as history_mod, judge as judge_mod,
               manifest as manifest_mod, numeric, plan as plan_mod, receipt as receipt_mod,
               reports, rounds, rules as rules_mod)
from .core import PixelError

__all__ = ["execute"]

_UNCONN = "RCE_UNCONN"
_EXTRACTION_KEYS = ("techLibOalib", "techLibTechDb", "layerMap", "etf",
                    "layerMapBool", "tclTemplate")


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _result(value, artifacts=None):
    return {"schemaVersion": "1", "value": value,
            "artifacts": list(artifacts or []), "diagnostics": []}


def _state(workspace, *parts):
    return os.path.join(os.path.abspath(workspace), "state", *parts)


def _cand_dir(workspace, cand_id):
    return os.path.join(os.path.abspath(workspace), "cands", cand_id)


def _readiness(workspace):
    return core.read_json(_state(workspace, "case-readiness.json"))


def _case_and_caps(readiness):
    paths = readiness.get("paths", {}) or {}
    case = manifest_mod.load_case(paths["manifest"], verify=False)
    sitecaps = manifest_mod.load_sitecaps(paths["sitecaps"])
    return case, sitecaps


def _timeout(sitecaps, key, extra=1800):
    t = (sitecaps.get("timeoutsS", {}) or {}).get(key)
    if not t:
        t = {"drc": 300, "lvs": 300, "gdsIn": 300, "rce": 900}.get(key, 900)
    return int(t) + extra


def _values_map(rows):
    out = {}
    unknown = {}
    for row in rows or []:
        out[row["type"]] = row.get("value")
        if row.get("value") is None and row.get("unknownReason"):
            unknown[row["type"]] = row["unknownReason"]
    return out, unknown


def _receipt_sha(workspace, cand_id):
    path = os.path.join(_cand_dir(workspace, cand_id), "receipt.json")
    if os.path.exists(path):
        return core.sha256_file(path)
    return None


def _load_totals(caps, lines):
    """Per load-limited line, the summed coupling to connected nets (fF)."""
    totals = {}
    for line in lines or []:
        total = 0.0
        for k, v in (caps or {}).items():
            parts = k.split("|")
            if len(parts) != 2 or line not in parts:
                continue
            other = parts[0] if parts[1] == line else parts[1]
            if other.startswith(_UNCONN) or line.startswith(_UNCONN):
                continue
            total += v
        totals[line] = total
    return totals


def _rce_caps_of(workspace, cand_id):
    """Parse the candidate receipt's RCE report into net-pair caps (or {})."""
    rpath = os.path.join(_cand_dir(workspace, cand_id), "receipt.json")
    if not os.path.exists(rpath):
        return {}
    receipt = core.read_json(rpath)
    for r in receipt.get("reports", []):
        if r.get("kind") == "rce":
            abspath = os.path.join(os.path.abspath(workspace), r.get("path", ""))
            if os.path.exists(abspath):
                try:
                    return reports.rce_caps(abspath)
                except PixelError:
                    return {}
    return {}


def _history_entry(cand_id, meta, rows, goal_resolved):
    """Build one ``state/history.jsonl`` line from a candidate's Reader rows."""
    vmap, unknown = _values_map(rows)
    results = rounds.rule_results(vmap, goal_resolved)
    is_legal = rounds.legal(vmap, goal_resolved)
    hard_failures = [rid for rid in rounds.HARD_RULES
                     if results[rid] not in ("PASS", "NOT_DECLARED")]
    goal_rules = {rid: results[rid] for rid in rounds.GOAL_RULES}
    import datetime
    return {
        "id": cand_id,
        "kind": (meta or {}).get("kind", "candidate"),
        "round": (meta or {}).get("round", 0),
        "base": (meta or {}).get("base"),
        "frontPoint": (meta or {}).get("frontPoint"),
        "exploratory": bool((meta or {}).get("exploratory")),
        "operators": (meta or {}).get("operators", []),
        "values": vmap,
        "unknown": unknown,
        "receiptSha256": None,
        "predicted": (meta or {}).get("predicted"),
        "legal": is_legal,
        "hardFailures": hard_failures,
        "goalRules": goal_rules,
        "at": datetime.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
    }


def _meta_of(workspace, cand_id):
    path = os.path.join(_cand_dir(workspace, cand_id), "meta.json")
    if os.path.exists(path):
        try:
            return core.read_json(path)
        except PixelError:
            return {}
    return {}


# --------------------------------------------------------------------------- #
# prepare-case
# --------------------------------------------------------------------------- #

def prepare_case(workspace, inputs):
    workspace = os.path.abspath(workspace)
    manifest_path = inputs["PIXEL_CASE_MANIFEST"]
    sitecaps_path = inputs["SITE_CAPABILITIES"]

    case = manifest_mod.load_case(manifest_path, verify=True)
    sitecaps = manifest_mod.load_sitecaps(sitecaps_path)

    core.write_json(_state(workspace, "paths.json"),
                    {"manifest": os.path.abspath(manifest_path),
                     "sitecaps": os.path.abspath(sitecaps_path)})

    # Parse both decks and the compaction table.
    decks = case.raw.get("decks", {}) or {}
    with open(case.file(decks["authority"]), "r", encoding="utf-8") as _fh:
        authority_text = _fh.read()
    with open(case.file(decks["reference"]), "r", encoding="utf-8") as _fh:
        reference_text = _fh.read()
    authority = rules_mod.parse_deck(authority_text)
    reference = rules_mod.parse_deck(reference_text)
    table = rules_mod.compaction_table(authority, case)
    core.write_json(_state(workspace, "rules.json"),
                    {"authority": authority, "reference": reference, "table": table})
    unmodelled = list(authority.get("unmodelled", []) or [])

    # Numeric preparation: rewrite the original, measure it.
    prep = numeric.run(sitecaps, workspace, "num-prepare", [],
                       _timeout(sitecaps, "rce"))
    outline = prep.get("outlineUm")
    versions = prep.get("versions", {})

    # Resolve the Goal (refuses an unresolved ratio target).
    goal_input = {k: inputs[k] for k in (
        "outline_w_um", "outline_h_um", "ratio_target_pct", "load_allowance_pct",
        "t_min_pct", "t_max_pct", "cst_ceiling_ff") if k in inputs}
    strategy_input = {k: inputs[k] for k in (
        "ratioDefinition", "transmittanceBasis", "extraCsOverlap",
        "topologyMoves", "convergeBandPct", "maxRounds",
        "convergePatienceRounds", "outlineMode") if k in inputs}
    resolved = goal_mod.resolve(goal_input, strategy_input, case,
                                {"outlineUm": outline})

    original_state = {}
    opath = _state(workspace, "original.json")
    if os.path.exists(opath):
        original_state = core.read_json(opath)

    lvs = case.raw.get("lvs", {}) or {}
    ext = case.raw.get("extraction", {}) or {}
    extraction_sha = {}
    for key in _EXTRACTION_KEYS:
        if isinstance(ext.get(key), dict):
            extraction_sha[key] = ext[key].get("sha256")

    readiness = {
        "schema": "pixel.case-readiness/1",
        "paths": {"manifest": os.path.abspath(manifest_path),
                  "sitecaps": os.path.abspath(sitecaps_path)},
        "manifestSha256": core.sha256_file(manifest_path),
        "sitecapsSha256": core.sha256_file(sitecaps_path),
        "manifest": case.raw,
        "sitecaps": sitecaps,
        "goal": resolved,
        "options": {
            "decks": {"authority": (decks.get("authority") or {}).get("sha256"),
                      "reference": (decks.get("reference") or {}).get("sha256")},
            "lvsDeck": (lvs.get("deckTemplate") or {}).get("sha256"),
            "schematic": (lvs.get("schematic") or {}).get("sha256"),
            "extraction": extraction_sha,
        },
        "original": {
            "outlineUm": outline,
            "cstDeviceFf": original_state.get("cstDeviceFf"),
            "loads": original_state.get("loads", {}) or {},
            "tTiledPct": original_state.get("tTiledPct"),
        },
        "unmodelled": unmodelled,
        "versions": versions,
    }
    core.check(readiness, "case-readiness")
    core.write_json(_state(workspace, "case-readiness.json"), readiness)

    return _result({
        "readinessId": readiness["manifestSha256"][:20],
        "outlineUm": outline,
        "unmodelled": unmodelled,
        "versions": versions,
        "goalSources": resolved.get("sources", {}),
    }, artifacts=[{"name": "caseReadiness", "path": "state/case-readiness.json"}])


# --------------------------------------------------------------------------- #
# judge-original
# --------------------------------------------------------------------------- #

def judge_original(workspace, inputs):
    workspace = os.path.abspath(workspace)
    readiness = _readiness(workspace)
    case, sitecaps = _case_and_caps(readiness)

    mut = numeric.run(sitecaps, workspace, "num-mutants", [],
                      _timeout(sitecaps, "rce"))
    mutant_ids = [m.get("id") for m in mut.get("mutants", [])]

    cands = [{"id": "original", "dir": _cand_dir(workspace, "original")}]
    for mid in mutant_ids:
        cands.append({"id": mid, "dir": _cand_dir(workspace, mid)})

    judge_mod.judge(cands, workspace, case, sitecaps, readiness, mode="full")

    # The original's load totals go into case readiness before its values.
    lines = case.raw.get("loadLimitedLines", []) or []
    caps = _rce_caps_of(workspace, "original")
    readiness["original"]["loads"] = _load_totals(caps, lines)
    watched = [n for n in [(case.raw.get("nets", {}) or {}).get("storageNode")] + list(lines) if n]
    readiness["original"]["floatingNets"] = len(receipt_mod.floating_nets(caps, watched))
    core.write_json(_state(workspace, "case-readiness.json"), readiness)

    orig_receipt = os.path.join(_cand_dir(workspace, "original"), "receipt.json")
    orig_rows = receipt_mod.reader_values(orig_receipt, workspace, readiness)
    orig_map, _ = _values_map(orig_rows)

    if orig_map.get("pixel_lvs_correct") != 1:
        raise PixelError("tool-failed",
                         "the original fails LVS (value %r); the judge or the "
                         "schematic is wrong" % orig_map.get("pixel_lvs_correct"))

    # The mutants must be caught.
    verdicts = {}
    for mid in mutant_ids:
        mrows = receipt_mod.reader_values(
            os.path.join(_cand_dir(workspace, mid), "receipt.json"), workspace, readiness)
        mmap, _ = _values_map(mrows)
        if mid == "mutant-contact":
            caught = mmap.get("pixel_lvs_correct") == 0
            verdicts[mid] = {"caught": caught, "by": "lvs",
                             "lvs": mmap.get("pixel_lvs_correct")}
        elif mid == "mutant-space":
            drc = max(v for v in (mmap.get("pixel_drc_authority_1x1"),
                                  mmap.get("pixel_drc_authority_2x2"),
                                  mmap.get("pixel_drc_authority_3x3")) if isinstance(v, (int, float))) \
                if any(isinstance(mmap.get(k), (int, float)) for k in
                       ("pixel_drc_authority_1x1", "pixel_drc_authority_2x2", "pixel_drc_authority_3x3")) else None
            caught = bool(drc) and drc > 0
            verdicts[mid] = {"caught": caught, "by": "authority-drc", "markers": drc}
        else:
            verdicts[mid] = {"caught": False, "by": "unknown"}
        if not verdicts[mid]["caught"]:
            raise PixelError("tool-failed",
                             "mutant %r was not caught (%r); a judge that cannot "
                             "fail is not a judge" % (mid, verdicts[mid]))

    # History entry 0 = original.
    entry = _history_entry("original", {"kind": "original", "round": 0},
                           orig_rows, readiness["goal"])
    entry["receiptSha256"] = _receipt_sha(workspace, "original")
    history_mod.append(workspace, entry)

    return _result({
        "originalValues": orig_map,
        "originalLegal": entry["legal"],
        "calibration": verdicts,
    }, artifacts=[{"name": "history", "path": "state/history.jsonl"}])


# --------------------------------------------------------------------------- #
# map-design-space
# --------------------------------------------------------------------------- #

def map_design_space(workspace, inputs):
    workspace = os.path.abspath(workspace)
    readiness = _readiness(workspace)
    _case, sitecaps = _case_and_caps(readiness)
    card = numeric.run(sitecaps, workspace, "num-map", [], _timeout(sitecaps, "rce"))
    return _result({
        "pitchBound": card.get("pitchBound"),
        "sites": card.get("sites"),
        "levers": card.get("levers"),
    }, artifacts=[{"name": "designSpaceCard", "path": "state/card.json"}])


# --------------------------------------------------------------------------- #
# learn-sensitivities
# --------------------------------------------------------------------------- #

def learn_sensitivities(workspace, inputs):
    workspace = os.path.abspath(workspace)
    readiness = _readiness(workspace)
    case, sitecaps = _case_and_caps(readiness)

    k = inputs.get("PROBES", 4)
    step = inputs.get("STEP", 0.1)
    probes = numeric.run(sitecaps, workspace, "num-probes", [str(k), str(step)],
                         _timeout(sitecaps, "rce"))
    probe_ids = list(probes.get("probes", []) or [])

    cands = [{"id": pid, "dir": _cand_dir(workspace, pid)} for pid in probe_ids]
    if cands:
        judge_mod.judge(cands, workspace, case, sitecaps, readiness, mode="full")
    for pid in probe_ids:
        rows = receipt_mod.reader_values(
            os.path.join(_cand_dir(workspace, pid), "receipt.json"), workspace, readiness)
        entry = _history_entry(pid, _meta_of(workspace, pid), rows, readiness["goal"])
        entry["receiptSha256"] = _receipt_sha(workspace, pid)
        history_mod.append(workspace, entry)

    fit = numeric.run(sitecaps, workspace, "num-fit", [], _timeout(sitecaps, "rce"))

    # Seed an initial round-decision so the first plan-round can read `roundDecision`.
    # The resident lists `roundDecision` among its reads (the last decision, if any), and the
    # Host resolves every one of a resident task's declared reads before it starts; decide-round
    # writes the real decisions from round 1 on. This mirrors the sibling mage-script-placement
    # Pack's measure-incumbent round-0 seed.
    seed_decision = {
        "schema": "pixel.round-decision/1", "round": 0, "route": "continue",
        "nextRound": {"round": 1}, "stopReason": "", "goalMet": False, "best": None,
        "front": [], "trustRadiusUm": 0.5, "predictedVsMeasured": [], "openMarkers": [],
        "rules": {},
    }
    core.check(seed_decision, "round-decision")
    core.write_json(_state(workspace, "round-decision.json"), seed_decision)

    return _result({
        "probes": probe_ids,
        "dropped": probes.get("dropped", []),
        "pairs": fit.get("pairs", {}),
    }, artifacts=[{"name": "surrogateModel", "path": "state/model.json"},
                  {"name": "roundDecision", "path": "state/round-decision.json"}])


# --------------------------------------------------------------------------- #
# solve-and-judge
# --------------------------------------------------------------------------- #

def solve_and_judge(workspace, inputs):
    workspace = os.path.abspath(workspace)
    round_no = int(inputs.get("ROUND", 1))
    readiness = _readiness(workspace)
    case, sitecaps = _case_and_caps(readiness)

    plan_path = _state(workspace, "round", "plan.json")
    plan_rows = plan_mod.reader_values(plan_path, workspace, readiness)
    plan_map, _ = _values_map(plan_rows)
    if plan_map.get("pixel_plan_error_count", 1) != 0:
        return _result({
            "round": round_no,
            "judged": [],
            "skipped": True,
            "reason": "plan has %s Reader errors; nothing judged"
                      % plan_map.get("pixel_plan_error_count"),
        })

    solved = numeric.run(sitecaps, workspace, "num-solve", [str(round_no)],
                         _timeout(sitecaps, "rce"))
    cand_ids = list(solved.get("candidates", []) or [])
    cands = [{"id": cid, "dir": _cand_dir(workspace, cid)} for cid in cand_ids]
    if cands:
        judge_mod.judge(cands, workspace, case, sitecaps, readiness, mode="full")

    judged = []
    for cid in cand_ids:
        rows = receipt_mod.reader_values(
            os.path.join(_cand_dir(workspace, cid), "receipt.json"), workspace, readiness)
        meta = _meta_of(workspace, cid)
        entry = _history_entry(cid, meta, rows, readiness["goal"])
        entry["receiptSha256"] = _receipt_sha(workspace, cid)
        history_mod.append(workspace, entry)
        judged.append({"id": cid, "values": entry["values"],
                       "legal": entry["legal"], "predicted": meta.get("predicted")})

    return _result({
        "round": round_no,
        "judged": judged,
        "failed": solved.get("failed", []),
        "skipped": False,
    }, artifacts=[{"name": "history", "path": "state/history.jsonl"}])


# --------------------------------------------------------------------------- #
# decide-round
# --------------------------------------------------------------------------- #

def _read_card(workspace):
    path = _state(workspace, "card.json")
    if os.path.exists(path):
        try:
            return core.read_json(path)
        except PixelError:
            return None
    return None


def _previous_decision(workspace):
    path = _state(workspace, "round-decision.json")
    if os.path.exists(path):
        try:
            return core.read_json(path)
        except PixelError:
            return None
    return None


def decide_round(workspace, inputs):
    workspace = os.path.abspath(workspace)
    round_no = int(inputs.get("ROUND", 1))
    readiness = _readiness(workspace)
    _case, sitecaps = _case_and_caps(readiness)

    history = history_mod.load(workspace)
    card = _read_card(workspace)
    previous = _previous_decision(workspace)

    decision = rounds.decide(round_no, readiness["goal"], history, previous, card)
    core.check(decision, "round-decision")
    core.write_json(_state(workspace, "round-decision.json"), decision)

    # Refit the surrogate with the new extractions (best effort).
    try:
        numeric.run(sitecaps, workspace, "num-fit", [], _timeout(sitecaps, "rce"))
    except PixelError:
        pass

    series = history_mod.trend(history, readiness["goal"])
    core.write_json(_state(workspace, "trend.json"), series)
    with open(_state(workspace, "trend.svg"), "w", encoding="utf-8") as fh:
        fh.write(history_mod.trend_svg(series))

    return _result({
        "route": decision["route"],
        "nextRound": decision["nextRound"],
        "stopReason": decision["stopReason"],
        "goalMet": decision["goalMet"],
        "best": decision["best"],
    }, artifacts=[{"name": "roundDecision", "path": "state/round-decision.json"},
                  {"name": "history", "path": "state/history.jsonl"}])


# --------------------------------------------------------------------------- #
# evaluate
# --------------------------------------------------------------------------- #

def _copy_candidate(workspace, src_id, eval_id):
    src = _cand_dir(workspace, src_id)
    dst = _cand_dir(workspace, eval_id)
    if os.path.exists(dst):
        shutil.rmtree(dst)
    os.makedirs(dst)
    for name in ("pixel.gds", "pixel2x2.gds", "pixel3x3.gds", "geometry.json"):
        s = os.path.join(src, name)
        if os.path.exists(s):
            shutil.copy2(s, os.path.join(dst, name))
    return {"id": eval_id, "dir": dst}


def evaluate(workspace, inputs):
    workspace = os.path.abspath(workspace)
    readiness = _readiness(workspace)
    case, sitecaps = _case_and_caps(readiness)
    goal_resolved = readiness["goal"]

    decision = _previous_decision(workspace)
    if decision is None:
        raise PixelError("missing-input", "no round decision to evaluate")
    history = history_mod.load(workspace)

    best = decision.get("best")
    # trade-off points: this round's judged exploratory candidates.
    tradeoff_ids = [row["id"] for row in history if row.get("exploratory")]

    eval_cands = []
    best_eval_id = None
    if best and best.get("id"):
        best_eval_id = "eval-%s" % best["id"]
        eval_cands.append(_copy_candidate(workspace, best["id"], best_eval_id))
    for tid in tradeoff_ids:
        eval_cands.append(_copy_candidate(workspace, tid, "eval-%s" % tid))

    if eval_cands:
        judge_mod.judge(eval_cands, workspace, case, sitecaps, readiness, mode="full")

    best_values = {}
    best_rules = {rid: "UNKNOWN" for rid, *_ in rounds.RULES}
    best_legal = False
    unknowns = []
    if best_eval_id is not None:
        rows = receipt_mod.reader_values(
            os.path.join(_cand_dir(workspace, best_eval_id), "receipt.json"),
            workspace, readiness)
        best_values, unknown_map = _values_map(rows)
        best_rules = rounds.rule_results(best_values, goal_resolved)
        best_legal = rounds.legal(best_values, goal_resolved)
        unknowns = sorted(unknown_map.keys())

    # Ending from the last route / stop reason, re-confirmed by the re-judge.
    route = decision.get("route")
    stop_reason = decision.get("stopReason", "")
    goal_met_fresh = best_legal and all(
        best_rules.get(rid) == "PASS" for rid in rounds.GOAL_RULES)

    disagreement = None
    if route == "continue":
        ending = "budget-reached"
        goal_met = False
    elif stop_reason == "goal-met":
        if goal_met_fresh:
            ending, goal_met = "goal-met", True
        else:
            # the re-judgement disagrees; the ending is what it supports
            ending, goal_met = ("converged", False)
            disagreement = ("decide-round stopped goal-met but the fresh "
                            "re-judgement does not confirm every Goal rule")
    elif stop_reason == "blocked":
        ending, goal_met = "blocked", False
    elif stop_reason == "converged":
        ending, goal_met = "converged", False
    elif stop_reason == "round-limit":
        ending, goal_met = "budget-reached", False
    else:
        ending, goal_met = "budget-reached", False

    decision_request = None
    if ending == "blocked":
        tradeoff = []
        for tid in tradeoff_ids:
            erows = receipt_mod.reader_values(
                os.path.join(_cand_dir(workspace, "eval-%s" % tid), "receipt.json"),
                workspace, readiness)
            emap, _ = _values_map(erows)
            eres = rounds.rule_results(emap, goal_resolved)
            broken = [rid for rid in rounds.HARD_RULES
                      if eres.get(rid) not in ("PASS", "NOT_DECLARED")]
            tradeoff.append({
                "id": tid,
                "outlineUm": [emap.get("pixel_outline_w_um"), emap.get("pixel_outline_h_um")],
                "ratioPct": emap.get("pixel_ratio_judged_pct"),
                "brokenHardLimits": broken,
            })
        decision_request = {
            "tradeOff": tradeoff,
            "bestLegal": best if best_legal else None,
            "note": "the unmet target needs a hard limit broken; the trade-off "
                    "table shows the exploratory points and the limit each breaks",
        }

    evaluation = {
        "schema": "pixel.evaluation/1",
        "ending": ending,
        "goalMet": bool(goal_met),
        "best": {"id": best.get("id"), "values": best_values, "legal": best_legal}
                if best else None,
        "rules": best_rules,
        "unknowns": unknowns,
        "decisionRequest": decision_request,
        "limitingBound": (_read_card(workspace) or {}).get("pitchBound")
                         if ending == "converged" else None,
        "disagreement": disagreement,
    }
    core.check(evaluation, "evaluation")
    core.write_json(_state(workspace, "evaluation.json"), evaluation)

    return _result({
        "ending": ending,
        "goalMet": bool(goal_met),
        "bestId": best.get("id") if best else None,
        "bestEvalId": best_eval_id,
    }, artifacts=[{"name": "evaluation", "path": "state/evaluation.json"}])


# --------------------------------------------------------------------------- #
# deliver
# --------------------------------------------------------------------------- #

def _recheck(path, sha):
    return os.path.exists(path) and (sha is None or core.sha256_file(path) == sha)


def deliver(workspace, inputs):
    workspace = os.path.abspath(workspace)
    readiness = _readiness(workspace)
    case, _caps = _case_and_caps(readiness)
    evaluation = core.read_json(_state(workspace, "evaluation.json"))

    delivery = os.path.join(workspace, "delivery")
    if not os.path.isdir(delivery):
        os.makedirs(delivery)

    best = evaluation.get("best") or {}
    best_eval_id = "eval-%s" % best.get("id") if best.get("id") else None

    copied = []
    # best GDS set, receipts and tool reports of the delivered layout
    if best_eval_id:
        src = _cand_dir(workspace, best_eval_id)
        dst = os.path.join(delivery, "best")
        if os.path.isdir(src):
            if os.path.exists(dst):
                shutil.rmtree(dst)
            shutil.copytree(src, dst)
            copied.append("best")
        # recheck the receipt's referenced reports
        receipt_path = os.path.join(src, "receipt.json")
        if os.path.exists(receipt_path):
            receipt = core.read_json(receipt_path)
            for r in receipt.get("reports", []):
                abspath = os.path.join(workspace, r.get("path", ""))
                if not _recheck(abspath, r.get("sha256")):
                    raise PixelError("digest-mismatch",
                                     "delivered report changed or missing: %s" % r.get("path"))

    # declared schematic, if any
    schematic_ref = (case.raw.get("lvs", {}) or {}).get("schematic")
    if isinstance(schematic_ref, dict):
        try:
            shutil.copy2(case.file(schematic_ref), os.path.join(delivery, "schematic"))
            copied.append("schematic")
        except OSError:
            pass

    # trend.svg, history.jsonl, decision-request.json
    for name, src in (("trend.svg", _state(workspace, "trend.svg")),
                      ("history.jsonl", _state(workspace, "history.jsonl"))):
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(delivery, name))
            copied.append(name)
    if evaluation.get("decisionRequest"):
        core.write_json(os.path.join(delivery, "decision-request.json"),
                        evaluation["decisionRequest"])
        copied.append("decision-request.json")

    report = {
        "schema": "pixel.report/1",
        "caseId": case.case_id,
        "ending": evaluation.get("ending"),
        "goalMet": evaluation.get("goalMet"),
        "best": best,
        "rules": evaluation.get("rules", {}),
        "unknowns": evaluation.get("unknowns", []),
        "goal": readiness.get("goal", {}).get("values", {}),
        "delivered": copied,
    }
    report_path = os.path.join(delivery, "report.json")
    core.write_json(report_path, report)

    _write_report_md(os.path.join(delivery, "REPORT.md"), report, readiness)

    return _result({
        "goalMet": evaluation.get("goalMet"),
        "ending": evaluation.get("ending"),
        "reportPath": "delivery/report.json",
        "packagePath": "delivery",
    }, artifacts=[{"name": "finalReport", "path": "delivery/report.json"}])


def _write_report_md(path, report, readiness):
    lines = []
    lines.append("# Pixel layout optimization delivery")
    lines.append("")
    lines.append("- Case: `%s`" % report.get("caseId"))
    lines.append("- Ending: **%s**" % report.get("ending"))
    lines.append("- Goal met: **%s**" % report.get("goalMet"))
    best = report.get("best") or {}
    lines.append("- Best candidate: `%s` (legal: %s)"
                 % (best.get("id"), best.get("legal")))
    lines.append("")
    lines.append("## Judge rules")
    lines.append("")
    lines.append("| Rule | Result |")
    lines.append("|---|---|")
    for rid, result in sorted((report.get("rules") or {}).items()):
        lines.append("| %s | %s |" % (rid, result))
    unknowns = report.get("unknowns") or []
    if unknowns:
        lines.append("")
        lines.append("## Unknown values")
        lines.append("")
        for u in unknowns:
            lines.append("- %s" % u)
    lines.append("")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))


# --------------------------------------------------------------------------- #
# dispatch
# --------------------------------------------------------------------------- #

_TASKS = {
    "prepare-case": prepare_case,
    "judge-original": judge_original,
    "map-design-space": map_design_space,
    "learn-sensitivities": learn_sensitivities,
    "solve-and-judge": solve_and_judge,
    "decide-round": decide_round,
    "evaluate": evaluate,
    "deliver": deliver,
}


def execute(task, workspace, inputs):
    """Run one program task; return its ``{schemaVersion,value,artifacts,diagnostics}``."""
    handler = _TASKS.get(task)
    if handler is None:
        raise PixelError("schema", "unknown program task %r" % (task,))
    return handler(workspace, inputs)
