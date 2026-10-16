"""The lever ledger: what each kind of move measured, from judged history (stdlib only).

A live Run found its two strongest levers six rounds apart because nothing told the resident what
an earlier move had measured. The ledger groups every judged candidate by its lever (the
discrete operators it carried, by kind, net, layer and role, and the plan's bounded edits, by
kind and layer, plus its objective) and states, from
receipts only, how far each moved the judged ratio and the storage node's couplings against its
base and against the plain point of the same round and base, and how often it came back legal or
a few markers short. The round decision carries it; on a warm start it also reads the earlier Runs
of the same case.
"""
from __future__ import annotations

import os

from . import rounds

__all__ = ["signature", "build"]

_KINDS = ("candidate", "repair")
_METRICS = (("dRatioPct", "pixel_ratio_judged_pct"),
            ("dAnodeFf", "pixel_ct_anode_ff"),
            ("dScanFf", "pixel_ct_lines_ff"),
            ("dTPct", "pixel_t_judged_pct"),
            ("dLoadPct", "pixel_load_increase_max_pct"))
_LIMIT = 10


def _num(x):
    if isinstance(x, bool) or not isinstance(x, (int, float)):
        return None
    return float(x)


def _op_name(op):
    kind = op.get("op")
    if kind == "shield":
        over = op.get("over") or {}
        return "shield %s on %s between %s and %s" % (op.get("net"), op.get("layer"),
                                                       over.get("victim"), over.get("aggressor"))
    if kind == "band-trim":
        return "band-trim %s on %s" % (op.get("net"), op.get("layer"))
    if kind == "contact-move":
        return "contact-move %s toward %s" % (op.get("net"), op.get("toward"))
    return str(kind)


def _op_params(op):
    out = {}
    for key in ("marginUm", "widthUm", "dxUm", "dyUm", "stepUm"):
        if key in op:
            out[key] = op[key]
    return out


def _edit_name(edit):
    """A plan's bounded edit by kind and layer: ``edit add on M2``, ``edit move on M1``."""
    kind = edit.get("op") if edit.get("op") in ("add", "cut") else "move"
    return "edit %s on %s" % (kind, edit.get("layer"))


def signature(row):
    """``(lever, objective)`` of one history row; ``None`` for rows that are no move."""
    kind = row.get("kind")
    if kind not in _KINDS or not row.get("base"):
        return None
    if kind == "repair":
        return ("bounded-edit repair", "legalise")
    fp = row.get("frontPoint") or {}
    names = sorted({_op_name(o) for o in (row.get("operators") or []) if isinstance(o, dict)}
                   | {_edit_name(e) for e in (row.get("edits") or []) if isinstance(e, dict)})
    return (" + ".join(names) if names else "no operator", fp.get("objective") or "")


def _delta(vals, ref):
    out = {}
    for name, key in _METRICS:
        a, b = _num(vals.get(key)), _num(ref.get(key))
        out[name] = round(a - b, 4) if a is not None and b is not None else None
    return out


def _rows_of(history, source):
    by_id = {r.get("id"): r for r in history}
    plain = {}
    for r in history:
        sig = signature(r)
        if sig and sig[0] == "no operator" and not r.get("exploratory"):
            plain.setdefault((r.get("round"), r.get("base"), sig[1]), r)
    out = []
    for r in history:
        sig = signature(r)
        if sig is None:
            continue
        base = by_id.get(r.get("base"))
        vals = rounds._as_map(r.get("values", {}))
        item = {"source": source, "id": r.get("id"), "round": r.get("round"), "lever": sig[0],
                "objective": sig[1], "exploratory": bool(r.get("exploratory")),
                "params": [_op_params(o) for o in (r.get("operators") or []) if isinstance(o, dict)],
                "vsBase": _delta(vals, rounds._as_map(base.get("values", {}))) if base else None,
                "vsPlain": None, "values": vals, "legal": bool(r.get("legal"))}
        ctl = plain.get((r.get("round"), r.get("base"), sig[1]))
        if ctl is not None and ctl is not r:
            item["vsPlain"] = _delta(vals, rounds._as_map(ctl.get("values", {})))
        out.append(item)
    return out


def _near_miss(vals, goal_resolved):
    fails = rounds._hard_failures(vals, goal_resolved)
    return bool(fails) and all(f in rounds._DRC_RULES for f in fails)


def build(history, goal_resolved, prior=(), limit=_LIMIT):
    """The ledger: ``[{lever, objective, n, legal, nearMiss, bestDRatioPct, ...}]``.

    ``history`` is this Run's judged history; ``prior`` holds ``(label, history)`` of earlier
    Runs of the same case (warm start). Sorted by the best ratio change measured against the plain
    point (or the base when there is none), most negative first; at most ``limit`` levers.
    """
    items = _rows_of(history, "this run")
    for label, rows in prior:
        items.extend(_rows_of(rows, label))
    groups = {}
    for it in items:
        groups.setdefault((it["lever"], it["objective"]), []).append(it)
    out = []
    for (lever, objective), its in groups.items():
        def best(field, key):
            vals = [it[field][key] for it in its if it[field] and it[field].get(key) is not None]
            return min(vals) if vals else None
        legal_n = sum(1 for it in its if it["legal"])
        near_n = sum(1 for it in its if not it["legal"] and _near_miss(it["values"], goal_resolved))
        examples = sorted(its, key=lambda it: (it["values"].get("pixel_ratio_judged_pct")
                                               if _num(it["values"].get("pixel_ratio_judged_pct"))
                                               is not None else 1e9))[:3]
        out.append({
            "lever": lever, "objective": objective, "n": len(its), "legal": legal_n,
            "nearMiss": near_n,
            "bestDRatioPctVsPlain": best("vsPlain", "dRatioPct"),
            "bestDRatioPctVsBase": best("vsBase", "dRatioPct"),
            "bestDAnodeFfVsBase": best("vsBase", "dAnodeFf"),
            "bestDScanFfVsBase": best("vsBase", "dScanFf"),
            "examples": [{"source": it["source"], "id": it["id"], "round": it["round"],
                          "params": it["params"], "legal": it["legal"],
                          "ratioPct": it["values"].get("pixel_ratio_judged_pct"),
                          "vsBase": it["vsBase"], "vsPlain": it["vsPlain"]} for it in examples],
        })

    def key(e):
        v = e["bestDRatioPctVsPlain"]
        if v is None:
            v = e["bestDRatioPctVsBase"]
        return v if v is not None else 1e9
    out.sort(key=key)
    return out[:limit]


def prior_histories(runs, history_of):
    """``[(label, rows)]`` for earlier Run directories, labelled by their directory name."""
    return [(os.path.basename(os.path.normpath(r)), history_of(r)) for r in runs]
