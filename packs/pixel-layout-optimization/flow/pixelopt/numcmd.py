"""The ``num-*`` numeric subcommands (numeric module).

These run inside the EDA container (launched by :mod:`pixelopt.numeric`, or
directly when ``PIXELOPT_DIRECT=1``) and are the numeric half of Task 6: every
command that needs numpy / SciPy / Shapely / gdstk lives here, while the stdlib
orchestration (``plan`` / ``history`` / ``rounds`` / ``tasks`` / ``pixel_cli``)
forwards to :func:`main`. Each command prints exactly one JSON object as its last
stdout line and exits 0; on failure it prints ``{"code","detail"}`` to stderr and
exits 2 (bad input) or 3 (a refusal).

The campaign-workspace layout and the per-command contract are frozen in the
plan's "Task 6 contract". ``cmd_markers`` / ``cmd_try_edit`` also accept an
explicit ``campaign`` root so the resident's ``pixel_cli`` can read a judged
candidate from the read-only Campaign workspace while writing into its private
one.
"""
from __future__ import annotations

import json
import os
import sys

from shapely.ops import unary_union

from . import (attribution, card, compact, core, geometry, judge, layout,
               manifest, mutants, nets, probes, reports, rules)
from .core import PixelError

__all__ = ["main"]

_REFUSAL_CODES = {"infeasible", "bad-plan", "unresolved-goal",
                  "identity-mismatch", "tool-failed"}


# --------------------------------------------------------------------------- #
# Context
# --------------------------------------------------------------------------- #

class _Ctx(object):
    def __init__(self, workspace, case, sitecaps, readiness, rules_state,
                 table, parsed):
        self.workspace = workspace
        self.case = case
        self.sitecaps = sitecaps
        self.readiness = readiness
        self.rules_state = rules_state
        self.table = table
        self.parsed = parsed


def _state_path(workspace, *parts):
    return os.path.join(workspace, "state", *parts)


def _read_json_opt(path):
    if os.path.exists(path):
        return core.read_json(path)
    return None


def _load_ctx(workspace, verify=False):
    workspace = os.path.abspath(workspace)
    paths = core.read_json(_state_path(workspace, "paths.json"))
    manifest_path = paths.get("manifest")
    sitecaps_path = paths.get("sitecaps")
    if not manifest_path or not sitecaps_path:
        raise PixelError("missing-input",
                         "state/paths.json needs 'manifest' and 'sitecaps'")
    case = manifest.load_case(manifest_path, verify=verify)
    sitecaps = manifest.load_sitecaps(sitecaps_path)
    readiness = _read_json_opt(_state_path(workspace, "case-readiness.json"))
    rules_state = _read_json_opt(_state_path(workspace, "rules.json"))
    if rules_state and isinstance(rules_state.get("table"), dict):
        table = rules_state["table"]
        parsed = rules_state.get("authority")
    else:
        ref = case.raw["decks"]["authority"]
        with open(case.file(ref), "r", encoding="utf-8", errors="replace") as fh:
            parsed = rules.parse_deck(fh.read())
        table = rules.compaction_table(parsed, case)
    return _Ctx(workspace, case, sitecaps, readiness, rules_state, table, parsed)


# --------------------------------------------------------------------------- #
# Shared helpers
# --------------------------------------------------------------------------- #

def _cand_top(case):
    return case.raw["candidateTopCell"]


def _cand_dir(root, cand):
    if os.path.isabs(cand) or os.path.exists(cand):
        return os.path.abspath(cand)
    return os.path.join(os.path.abspath(root), "cands", cand)


def _pk(a, b):
    # canonical net-pair key, as RCEResult and the model use
    return "|".join(sorted((a, b)))


def _model_pairs(case):
    nm = case.raw["nets"]
    sn, st = nm["storageNode"], nm["storageNet"]
    aggs = set()
    for lst in (case.raw.get("ratioDefinitions", {}) or {}).values():
        aggs |= set(lst)
    pairs = [_pk(sn, a) for a in sorted(aggs)]
    pairs.append(_pk(sn, st))
    return pairs


def _load_original(workspace, case):
    return layout.load_gds(os.path.join(workspace, "cands", "original", "pixel.gds"),
                           case, top=_cand_top(case))


def _versions():
    import platform
    import numpy
    import scipy
    import shapely
    import gdstk
    return {"python": platform.python_version(), "numpy": numpy.__version__,
            "scipy": scipy.__version__, "shapely": shapely.__version__,
            "gdstk": gdstk.__version__}


def _caps_from_receipt(workspace, receipt):
    for r in receipt.get("reports", []) or []:
        if r.get("kind") == "rce":
            path = os.path.join(workspace, r.get("path", ""))
            if os.path.exists(path):
                try:
                    return reports.rce_caps(path)
                except PixelError:
                    return {}
    return {}


def _history_ids(workspace, include_original):
    ids = []
    if include_original:
        ids.append("original")
    hp = _state_path(workspace, "history.jsonl")
    if os.path.exists(hp):
        with open(hp, "r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    j = json.loads(line)
                except ValueError:
                    continue
                cid = j.get("id")
                if cid and cid not in ids:
                    ids.append(cid)
    return ids


FEATURES_VERSION = 2  # bump whenever attribution.features changes what it measures


def _candidate_features(cdir, gds, case):
    """Features of every labelled net pair of one candidate, cached beside its GDS by sha256 (the
    pooled model fits on all pairs, and a candidate's geometry never changes)."""
    sha = core.sha256_file(gds)
    cache = os.path.join(cdir, "features.json")
    if os.path.exists(cache):
        doc = core.read_json(cache)
        if doc.get("gdsSha256") == sha and doc.get("featuresVersion") == FEATURES_VERSION:
            return doc["features"]
    lay = layout.load_gds(gds, case, top=_cand_top(case))
    ne = nets.extract(lay, case)
    feats = attribution.features(ne, case, attribution.named_pairs(ne))
    core.write_json(cache, {"gdsSha256": sha, "featuresVersion": FEATURES_VERSION, "features": feats})
    return feats


def _history_rows(workspace, case, pairs, include_original=True):
    rows = []
    for cid in _history_ids(workspace, include_original):
        cdir = os.path.join(workspace, "cands", cid)
        rp = os.path.join(cdir, "receipt.json")
        gds = os.path.join(cdir, "pixel.gds")
        if not os.path.exists(rp) or not os.path.exists(gds):
            continue
        receipt = core.read_json(rp)
        caps = _caps_from_receipt(workspace, receipt)
        if not caps:
            continue
        rows.append((_candidate_features(cdir, gds, case), caps))
    return rows


# --------------------------------------------------------------------------- #
# num-prepare
# --------------------------------------------------------------------------- #

def cmd_prepare(workspace):
    ctx = _load_ctx(workspace, verify=True)
    case = ctx.case
    ws = ctx.workspace
    orig_ref = case.raw["original"]["gds"]
    lay = layout.load_gds(case.file(orig_ref), case, top=case.raw["original"]["topCell"])

    cdir = os.path.join(ws, "cands", "original")
    layout.write_set(lay, cdir, case)

    geom = geometry.measure(lay, case, lay, ctx.parsed)
    geom["declaredChanges"] = {}
    core.write_json(os.path.join(cdir, "geometry.json"), geom)
    core.write_json(os.path.join(cdir, "meta.json"), {
        "id": "original", "kind": "original", "round": 0, "base": None,
        "frontPoint": None, "exploratory": False, "operators": [], "edits": [],
        "declaredChanges": {}, "predicted": None, "solve": None})

    ne = nets.extract(lay, case)
    named = sorted(k for k in ne["nets"] if k not in set(ne["unnamed"]))
    (x0, y0), (x1, y1) = lay.outline(case)
    outline = [round(x1 - x0, 6), round(y1 - y0, 6)]
    core.write_json(_state_path(ws, "original.json"), {
        "outlineUm": outline, "cstDeviceFf": geom["cstDeviceFf"],
        "channels": len(ne["channels"]), "nets": named,
        "tTiledPct": geom["tTiledPct"], "tOwnPct": geom["tOwnPct"]})

    return {"versions": _versions(), "outlineUm": outline}


# --------------------------------------------------------------------------- #
# num-mutants
# --------------------------------------------------------------------------- #

def _mutation_text(desc):
    if desc.get("kind") == "remove-contact":
        return "removed one contact that splits net %s" % desc.get("net")
    if desc.get("kind") == "shrink-space":
        return ("shrank a %s %s-space to %g um (rule %g um)"
                % (desc.get("layer"), desc.get("axis"), desc.get("newSpace"),
                   desc.get("rule")))
    return desc.get("kind", "mutation")


def cmd_mutants(workspace):
    ctx = _load_ctx(workspace)
    case = ctx.case
    ws = ctx.workspace
    lay = _load_original(ws, case)

    makers = (("mutant-contact", lambda: mutants.remove_contact(lay, case)),
              ("mutant-space", lambda: mutants.shrink_space(lay, case, ctx.table)))
    out = []
    for cid, maker in makers:
        cand_lay, desc = maker()
        cdir = os.path.join(ws, "cands", cid)
        _rmtree(cdir)
        layout.write_set(cand_lay, cdir, case)
        geom = geometry.measure(cand_lay, case, lay, ctx.parsed)
        geom["declaredChanges"] = {}
        core.write_json(os.path.join(cdir, "geometry.json"), geom)
        core.write_json(os.path.join(cdir, "meta.json"), {
            "id": cid, "kind": "mutant", "round": 0, "base": "original",
            "frontPoint": None, "exploratory": False, "operators": [],
            "edits": [], "declaredChanges": {}, "predicted": None,
            "solve": None, "mutation": desc})
        out.append({"id": cid, "kind": desc.get("kind"),
                    "description": _mutation_text(desc)})
    return {"mutants": out}


# --------------------------------------------------------------------------- #
# num-judge-one
# --------------------------------------------------------------------------- #

def cmd_judge_one(rest):
    if len(rest) < 3:
        raise PixelError("schema", "num-judge-one needs <workspace> <candidate> <mode>")
    judge.judge_one_main(rest)
    return {"judged": os.path.basename(os.path.abspath(rest[1].rstrip(os.sep)))}


# --------------------------------------------------------------------------- #
# num-map
# --------------------------------------------------------------------------- #

def _whole(G, net):
    d = G.get(net, {})
    return unary_union(list(d.values())) if d else attribution._EMPTY


def _levers(lay, case, table, model, nets_result, pairs, trust):
    G = attribution._netgeo(nets_result)
    sn = case.raw["nets"]["storageNode"]
    st = case.raw["nets"].get("storageNet")
    aggs = set()
    for a, b in attribution._norm_pairs(pairs):
        for n in (a, b):
            if n != sn:
                aggs.add(n)
    if st:
        aggs.add(st)
    facing_parts = [_whole(G, n) for n in aggs]
    vg = _whole(G, sn)
    if not vg.is_empty:
        facing_parts.append(vg)
    facing_parts = [g for g in facing_parts if not g.is_empty]
    facing = unary_union(facing_parts).buffer(1.0) if facing_parts else None

    conductors = set(case.layers_with("conductor"))
    grad_fn = getattr(attribution, "gradients", None)
    have_model = bool((model or {}).get("pairs"))
    collected = []
    for axis in ("x", "y"):
        L = lay if axis == "x" else compact.transpose(lay)
        m = compact.build(L, case, table)
        grads = {}
        if grad_fn and have_model:
            try:
                grads = grad_fn(model, lay, case, m, list(model["pairs"].keys()),
                                axis).get("gradients", {}) or {}
            except Exception:
                grads = {}
        for cls in compact.edge_classes(m):
            if cls["layer"] not in conductors:
                continue
            cg = attribution.class_geom(m, cls, axis)
            if cg.is_empty or facing is None or facing.is_empty:
                score = 0.0
            else:
                score = float(cg.boundary.intersection(facing).length)
            g_for = {}
            for pair, dd in grads.items():
                gv = dd.get(cls["var"], dd.get(str(cls["var"])))
                if gv:
                    g_for[pair] = float(gv)
            mag = sum(abs(v) for v in g_for.values())
            collected.append({"score": score, "mag": mag, "axis": axis,
                              "layer": cls["layer"], "var": cls["var"], "grad": g_for})

    if any(c["mag"] > 0 for c in collected):
        collected.sort(key=lambda c: -c["mag"])
    else:
        collected.sort(key=lambda c: -c["score"])
    levers = []
    for c in collected:
        if c["score"] <= 1e-9 and c["mag"] <= 0:
            continue
        levers.append({"id": "lever-%d" % len(levers), "kind": "edge",
                       "axis": c["axis"], "layer": c["layer"], "net": None,
                       "gradientFfPerUm": c["grad"], "boundUm": trust})
        if len(levers) >= 12:
            break
    return levers


def _enrich_sites(sites_list, pred, case):
    sn = case.raw["nets"]["storageNode"]
    weights = []
    for s in sites_list:
        weights.append(s["overlapUm2"] + s["fringe1Um2"] + 0.4 * s["fringe25Um2"])
    total = sum(weights) or 1.0
    enriched = []
    for s, w in zip(sites_list, weights):
        est = pred.get(_pk(sn, s["aggressor"])) if pred else None
        enriched.append(dict(s, sharePct=round(w / total * 100.0, 3),
                             estFf=(round(float(est), 6) if est is not None else None)))
    return enriched


def _floor(sites_list, pred, case, nets_result):
    sn = case.raw["nets"]["storageNode"]
    channels = nets_result.get("channels", []) or []
    chan = unary_union(channels).buffer(1.0) if channels else None
    ratio_nets = set()
    for lst in (case.raw.get("ratioDefinitions", {}) or {}).values():
        ratio_nets |= set(lst)

    def is_device(layer):
        try:
            return case.layer(layer).get("stack") == "device"
        except KeyError:
            return False

    ct = 0.0
    for agg in sorted(ratio_nets):
        asites = [s for s in sites_list if s["aggressor"] == agg]
        if not asites:
            continue
        ok = True
        for s in asites:
            if not (is_device(s["victimLayer"]) and is_device(s["aggressorLayer"])):
                ok = False
                break
            bb = s.get("bbox")
            if chan is None or not bb:
                ok = False
                break
            from shapely.geometry import box as _box
            if not chan.intersects(_box(bb[0], bb[1], bb[2], bb[3])):
                ok = False
                break
        if ok and pred:
            ct += float(pred.get(_pk(sn, agg), 0.0))
    return {"ctFf": round(ct, 6), "note": "estimated: channel-adjacent device-stack coupling"}


def _open_markers(workspace, cand, cand_dir, lay, case, table, start_marks=()):
    marks = []
    out = os.path.join(cand_dir, "out")
    for tile in ("1x1", "3x3"):
        db = os.path.join(out, "drc_authority_%s" % tile, "argus_drc.db")
        if os.path.exists(db):
            with open(db, "r", encoding="utf-8", errors="replace") as fh:
                marks.extend(markers_parse(fh.read()))
    if not marks:
        return []
    folded = markers_fold(marks, lay.outline(case))
    classified = markers_classify(folded, table, start_marks, ())
    return [{"candidate": cand, "rule": m["rule"], "class": m["class"],
             "bbox": m["bbox"]} for m in classified[:8]]


# markers is an S module; import lazily to keep the dependency explicit.
def markers_parse(text):
    from . import markers as _m
    return _m.parse_db(text)


def markers_fold(marks, outline):
    from . import markers as _m
    return _m.fold(marks, outline)


def markers_classify(folded, table, start, tags):
    from . import markers as _m
    return _m.classify(folded, table, start, tags)


def cmd_map(workspace):
    ctx = _load_ctx(workspace)
    case = ctx.case
    ws = ctx.workspace
    lay = _load_original(ws, case)
    nets_result = nets.extract(lay, case)
    pairs = _model_pairs(case)

    sites_list = attribution.sites(nets_result, case)
    feats = attribution.features(nets_result, case, pairs)

    rows = _history_rows(ws, case, pairs, include_original=True)
    model = attribution.fit(rows, pairs) if rows else {"pairs": {}}
    core.write_json(_state_path(ws, "model.json"), model)
    pred = attribution.predict(model, feats) if model.get("pairs") else {}

    # The bound in the order min-pitch uses: y to its minimum, then x from that layout.
    ylay, iy = compact.compact(lay, "y", case, ctx.table, objective="pitch")
    _, ix = compact.compact(ylay if ylay is not None else lay, "x", case, ctx.table, objective="pitch")
    pitch_x = {"pitchUm": ix.get("pitch"), "binding": ix.get("binding") or []}
    pitch_y = {"pitchUm": iy.get("pitch"), "binding": iy.get("binding") or []}

    trust = ((ctx.readiness or {}).get("roundDecision", {}) or {}).get(
        "trustRadiusUm", 0.5)
    levers = _levers(lay, case, ctx.table, model, nets_result, pairs, trust)
    sites_enriched = _enrich_sites(sites_list, pred, case)
    floor = _floor(sites_list, pred, case, nets_result)
    open_markers = _open_markers(ws, "original",
                                 os.path.join(ws, "cands", "original"),
                                 lay, case, ctx.table)

    card_doc = card.make_card(sites_enriched, levers, pitch_x, pitch_y, floor,
                              [], open_markers)
    core.write_json(_state_path(ws, "card.json"), card_doc)
    with open(_state_path(ws, "card.svg"), "w", encoding="utf-8") as fh:
        fh.write(card.card_svg(case, lay, sites_enriched[:8]))

    return {"pitchBound": {"x": pitch_x["pitchUm"], "y": pitch_y["pitchUm"]},
            "sites": len(sites_enriched), "levers": len(levers)}


# --------------------------------------------------------------------------- #
# num-fit
# --------------------------------------------------------------------------- #

def cmd_fit(workspace):
    ctx = _load_ctx(workspace)
    case = ctx.case
    ws = ctx.workspace
    pairs = _model_pairs(case)
    rows = _history_rows(ws, case, pairs, include_original=True)
    model = attribution.fit(rows, pairs) if rows else {"pairs": {}}
    core.write_json(_state_path(ws, "model.json"), model)
    summary = {}
    for pair, info in model.get("pairs", {}).items():
        summary[pair] = {"n": info.get("n"), "rmse": info.get("rmse"),
                         "r2": info.get("r2")}
    return {"pairs": summary}


# --------------------------------------------------------------------------- #
# num-probes
# --------------------------------------------------------------------------- #

def cmd_probes(workspace, k, step):
    ctx = _load_ctx(workspace)
    case = ctx.case
    ws = ctx.workspace
    model = _read_json_opt(_state_path(ws, "model.json")) or {"pairs": {}}
    lay = _load_original(ws, case)
    nets_result = nets.extract(lay, case)
    pairs = _model_pairs(case)
    built = probes.make_probes(lay, case, ctx.table, model, nets_result, pairs,
                               k=k, step=step)
    ids = []
    dropped = []
    for pr in built:
        if pr.get("layout") is None:
            dropped.append({"name": pr.get("name"),
                            "reason": pr.get("meta", {}).get("dropped"),
                            "binding": pr.get("binding", [])})
            continue
        cid = "probe-%02d" % len(ids)
        out_lay = layout.clean(pr["layout"])
        out_lay = layout.sync_outline_copies(out_lay, case)
        out_lay = layout.snap(out_lay, case.grid_um)
        cdir = os.path.join(ws, "cands", cid)
        _rmtree(cdir)
        layout.write_set(out_lay, cdir, case)
        geom = geometry.measure(out_lay, case, lay, ctx.parsed)
        geom["declaredChanges"] = {}
        core.write_json(os.path.join(cdir, "geometry.json"), geom)
        w, h = out_lay.pitch(case)
        core.write_json(os.path.join(cdir, "meta.json"), {
            "id": cid, "kind": "probe", "round": 0, "base": "original",
            "frontPoint": None, "exploratory": False, "operators": [],
            "edits": [], "declaredChanges": {},
            "predicted": _predict(model, out_lay, case),
            "solve": {"status": "optimal", "pitchUm": [round(w, 6), round(h, 6)],
                      "binding": [], "pairIterations": 0, "residualMarkers": []},
            "probeMeta": pr.get("meta", {})})
        ids.append(cid)
    return {"probes": ids, "dropped": dropped}


def _predict(model, lay, case):
    if not (model or {}).get("pairs"):
        return None
    pairs = list(model["pairs"].keys())
    feats = attribution.features(nets.extract(lay, case), case, pairs)
    pred = attribution.predict(model, feats)
    if not pred:
        return None
    nm = case.raw["nets"]
    sn, st = nm["storageNode"], nm["storageNet"]
    cs = pred.get(_pk(sn, st))
    ratio = {}
    for defn in ("narrow", "broad"):
        aggs = (case.raw.get("ratioDefinitions", {}) or {}).get(defn, [])
        ct = sum(pred.get(_pk(sn, a), 0.0) for a in aggs)
        ratio[defn] = round(ct / cs * 100.0, 6) if cs and cs > 1e-9 else None
    return {"pairsFf": {k: round(float(v), 6) for k, v in pred.items()},
            "ratioPct": ratio}


# --------------------------------------------------------------------------- #
# num-solve
# --------------------------------------------------------------------------- #

def cmd_solve(workspace, round_num):
    from . import solve as _solve
    ctx = _load_ctx(workspace)
    ws = ctx.workspace
    plan = core.read_json(_state_path(ws, "round", "plan.json"))
    model = _read_json_opt(_state_path(ws, "model.json")) or {"pairs": {}}
    decision = _read_json_opt(_state_path(ws, "round-decision.json"))
    return _solve.drive(ws, round_num, ctx.case, ctx.sitecaps, ctx.readiness,
                        ctx.rules_state, model, plan, decision)


# --------------------------------------------------------------------------- #
# num-markers
# --------------------------------------------------------------------------- #

def cmd_markers(workspace, cand, out, campaign=None):
    ctx = _load_ctx(workspace)
    case = ctx.case
    ws = ctx.workspace
    root = campaign or ws
    cdir = _cand_dir(root, cand)
    gds = os.path.join(cdir, "pixel.gds")
    lay = layout.load_gds(gds, case, top=_cand_top(case)) if os.path.exists(gds) else None

    marks = []
    outdir = os.path.join(cdir, "out")
    for tile in ("1x1", "3x3"):
        db = os.path.join(outdir, "drc_authority_%s" % tile, "argus_drc.db")
        if os.path.exists(db):
            with open(db, "r", encoding="utf-8", errors="replace") as fh:
                marks.extend(markers_parse(fh.read()))
    folded = markers_fold(marks, lay.outline(case)) if (marks and lay) else []
    classified = markers_classify(folded, ctx.table, (), ())

    proposed_pairs = []
    if lay is not None and ctx.parsed is not None and folded:
        try:
            base_lay = _load_original(ws, case)
            lp = lay.pitch(case)
            bp = base_lay.pitch(case)
            for ax in ("x", "y"):
                for t in (probes.propose_pairs(lay, folded, ctx.parsed, base_lay, ax,
                                               pitch=lp, base_pitch=bp) or []):
                    proposed_pairs.append(list(t))
        except Exception:
            proposed_pairs = []

    doc = {"candidate": os.path.basename(cdir.rstrip(os.sep)),
           "markers": classified, "proposedPairs": proposed_pairs,
           "proposedEdits": []}
    out = os.path.abspath(out)
    core.write_json(out, doc)
    by_class = {}
    for m in classified:
        by_class[m["class"]] = by_class.get(m["class"], 0) + 1
    return {"markers": len(classified), "byClass": by_class, "out": out}


# --------------------------------------------------------------------------- #
# num-try-edit
# --------------------------------------------------------------------------- #

def cmd_try_edit(workspace, cand, ops_path, out_dir, campaign=None):
    from . import edits as _edits
    ctx = _load_ctx(workspace)
    case = ctx.case
    ws = ctx.workspace
    root = campaign or ws
    cdir = _cand_dir(root, cand)
    lay = layout.load_gds(os.path.join(cdir, "pixel.gds"), case, top=_cand_top(case))

    ops_doc = core.read_json(ops_path)
    if isinstance(ops_doc, dict):
        ops = ops_doc.get("edits") or ops_doc.get("ops") or []
    else:
        ops = ops_doc
    edited, _log = _edits.apply_edits(lay, ops, case)
    edited = layout.clean(edited)
    edited = layout.sync_outline_copies(edited, case)
    edited = layout.snap(edited, case.grid_um)

    out_dir = os.path.abspath(out_dir)
    _rmtree(out_dir)
    layout.write_set(edited, out_dir, case)
    geom = geometry.measure(edited, case, lay, ctx.parsed)
    geom["declaredChanges"] = {}
    core.write_json(os.path.join(out_dir, "geometry.json"), geom)

    judge.judge_one(out_dir, ws, case, ctx.sitecaps, "drc")

    counts = {}
    by_rule = {}
    for tile in ("1x1", "3x3"):
        sp = os.path.join(out_dir, "out", "drc_authority_%s" % tile, "argus_drc.sum")
        if os.path.exists(sp):
            try:
                summ = reports.argus_summary(sp)
                counts[tile] = summ["total"]
                for rid, n in summ.get("byRule", {}).items():
                    by_rule[rid] = by_rule.get(rid, 0) + n
            except PixelError:
                counts[tile] = None
        else:
            counts[tile] = None
    return {"authority": counts, "byRule": by_rule}


# --------------------------------------------------------------------------- #
# Dispatch
# --------------------------------------------------------------------------- #

def _rmtree(path):
    import shutil
    if os.path.isdir(path):
        shutil.rmtree(path)


def main(argv):
    if not argv:
        sys.stderr.write(json.dumps({"code": "schema", "detail": "no subcommand"}) + "\n")
        return 2
    cmd, rest = argv[0], list(argv[1:])
    try:
        if cmd == "num-prepare":
            result = cmd_prepare(rest[0])
        elif cmd == "num-mutants":
            result = cmd_mutants(rest[0])
        elif cmd == "num-judge-one":
            result = cmd_judge_one(rest)
        elif cmd == "num-map":
            result = cmd_map(rest[0])
        elif cmd == "num-probes":
            result = cmd_probes(rest[0], int(rest[1]), float(rest[2]))
        elif cmd == "num-fit":
            result = cmd_fit(rest[0])
        elif cmd == "num-solve":
            result = cmd_solve(rest[0], int(rest[1]))
        elif cmd == "num-markers":
            result = cmd_markers(rest[0], rest[1], rest[2])
        elif cmd == "num-try-edit":
            result = cmd_try_edit(rest[0], rest[1], rest[2], rest[3])
        else:
            raise PixelError("schema", "unknown subcommand %r" % (cmd,))
    except PixelError as exc:
        sys.stderr.write(json.dumps({"code": exc.code, "detail": exc.detail}) + "\n")
        return 3 if exc.code in _REFUSAL_CODES else 2
    except (IndexError, ValueError) as exc:
        sys.stderr.write(json.dumps(
            {"code": "schema", "detail": "%s: %s" % (cmd, exc)}) + "\n")
        return 2
    print(json.dumps(result))
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main(sys.argv[1:]))
