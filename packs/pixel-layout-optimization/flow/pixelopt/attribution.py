"""Coupling attribution: sites, visible-overlap/fringe features, and the
capacitance surrogate (numeric module).

Port of the proven day-1 method (``.scratch/pixel-agent/tools/dspace.py``,
``dspace2.py``, ``dspace_fit.py``), generalised through the manifest's roles so
no layer or net name is hard-coded. Nothing of a customer case is used.

The screening layer order is the manifest's conductor order with the derived
``PolySD`` region first (``nets.extract`` reports poly-outside-gate pieces under
that name) and the anode layer(s) last: a conductor of a third net on a layer
*strictly between* two coupling layers screens their view of each other.

Only ``sites``, ``features``, ``fit`` and ``predict`` land here. ``gradients``
and probe generation arrive after the compactor (``compact.py``) lands.
"""
from __future__ import annotations

import numpy as np
from scipy.optimize import nnls
from shapely.geometry import Polygon
from shapely.ops import unary_union

__all__ = ["sites", "features", "fit", "predict", "gradients"]

_AREA_EPS = 1e-6
_EMPTY = Polygon()


# --------------------------------------------------------------------------- #
# Net geometry and screening order
# --------------------------------------------------------------------------- #

def _netgeo(nets):
    """``{net: {layer: unioned geom}}`` from ``nets.extract`` output.

    A component named by several labels (``"A/B"``) contributes its geometry to
    each label, mirroring the day-1 ``netgeo`` split.
    """
    acc = {}
    for name, items in nets.get("nets", {}).items():
        for sub in str(name).split("/"):
            for layer, geom in items:
                acc.setdefault(sub, {}).setdefault(layer, []).append(geom)
    return {n: {L: unary_union(gs) for L, gs in d.items()} for n, d in acc.items()}


def _screen_order(case):
    """Conductor layers for screening: ``PolySD`` first, anode layer(s) last."""
    conductors = case.layers_with("conductor")
    poly = case.raw["devices"]["polyLayer"]
    anode_layers = list(case.raw.get("nets", {}).get("anodeLayers", []))
    order = ["PolySD"]
    for name in conductors:
        if name == poly or name in anode_layers:
            continue
        order.append(name)
    for name in conductors:
        if name in anode_layers and name not in order:
            order.append(name)
    for name in anode_layers:
        if name not in order:
            order.append(name)
    return order


def _screen(G, a, b, La, Lb, order):
    """Union of third-net conductors on layers strictly between ``La`` and ``Lb``."""
    if La not in order or Lb not in order:
        return _EMPTY
    lo, hi = sorted((order.index(La), order.index(Lb)))
    between = []
    for n, d in G.items():
        if n in (a, b):
            continue
        for L, g in d.items():
            if L in order and lo < order.index(L) < hi:
                between.append(g)
    return unary_union(between) if between else _EMPTY


def _fringe(vg, ag, scr, d0, d1):
    """Area of the aggressor inside the victim's fringe band ``(d0, d1]`` um,
    with the screen subtracted."""
    if d0 > 0:
        band = vg.buffer(d1).difference(vg.buffer(d0))
    else:
        band = vg.buffer(d1).difference(vg)
    return band.intersection(ag).difference(scr).area


def _lpair_key(La, Lb, order):
    pair = sorted((La, Lb), key=lambda L: order.index(L) if L in order else 1e9)
    return "%s-%s" % (pair[0], pair[1])


# --------------------------------------------------------------------------- #
# Sites
# --------------------------------------------------------------------------- #

def sites(nets, case):
    """Coupling sites of the storage node against every other net.

    One entry per (aggressor, victim-layer, aggressor-layer) with non-zero
    visible overlap or fringe, sorted by (overlap + fringe) descending.
    """
    G = _netgeo(nets)
    order = _screen_order(case)
    victim = case.raw["nets"]["storageNode"]
    out = []
    vlayers = G.get(victim, {})
    for agg in sorted(G):
        if agg == victim:
            continue
        for vL, vg in vlayers.items():
            for aL, ag in G[agg].items():
                scr = _screen(G, victim, agg, vL, aL, order)
                overlap = 0.0
                if vL != aL:
                    overlap = vg.intersection(ag).difference(scr).area
                fr1 = _fringe(vg, ag, scr, 0.0, 1.0)
                fr25 = _fringe(vg, ag, scr, 1.0, 2.5)
                if overlap <= _AREA_EPS and fr1 <= _AREA_EPS and fr25 <= _AREA_EPS:
                    continue
                inter = vg.intersection(ag)
                region = inter if not inter.is_empty else vg.buffer(2.5).intersection(ag)
                bbox = [round(v, 4) for v in region.bounds] if not region.is_empty else None
                out.append({
                    "victim": victim,
                    "aggressor": agg,
                    "victimLayer": vL,
                    "aggressorLayer": aL,
                    "overlapUm2": round(float(overlap), 6),
                    "fringe1Um2": round(float(fr1), 6),
                    "fringe25Um2": round(float(fr25), 6),
                    "bbox": bbox,
                })
    out.sort(key=lambda s: s["overlapUm2"] + s["fringe1Um2"] + s["fringe25Um2"],
             reverse=True)
    return out


# --------------------------------------------------------------------------- #
# Features
# --------------------------------------------------------------------------- #

def named_pairs(nets_result):
    """Every pair of labelled nets (unnamed internal nodes excluded), as "A|B" sorted."""
    unnamed = set(nets_result.get("unnamed", []))
    names = sorted(n for n in nets_result.get("nets", {}) if n not in unnamed)
    return [(names[i], names[j]) for i in range(len(names)) for j in range(i + 1, len(names))]


def _norm_pairs(pairs):
    norm = []
    for p in pairs:
        if isinstance(p, str):
            a, b = p.split("|", 1)
        else:
            a, b = p[0], p[1]
        norm.append((a, b))
    return norm


def _pair_features(G, a, b, order):
    f = {}
    for La, ga in G.get(a, {}).items():
        for Lb, gb in G.get(b, {}).items():
            if La not in order or Lb not in order:
                continue
            scr = _screen(G, a, b, La, Lb, order)
            key = _lpair_key(La, Lb, order)
            if La != Lb:
                ov = ga.intersection(gb).difference(scr).area
                f["ov:" + key] = f.get("ov:" + key, 0.0) + float(ov)
            for d0, d1 in ((0.0, 1.0), (1.0, 2.5)):
                fr = _fringe(ga, gb, scr, d0, d1)
                name = "fr%s:" % d1 + key
                f[name] = f.get(name, 0.0) + float(fr)
    return f


def features(nets, case, pairs):
    """Per-net-pair visible-overlap and fringe-band features.

    Returns ``{"A|B": {feature: value}}``. Visible overlap subtracts any
    third-net conductor strictly between the two layers; fringe bands are
    0-1 um and 1-2.5 um.
    """
    G = _netgeo(nets)
    order = _screen_order(case)
    out = {}
    for a, b in _norm_pairs(pairs):
        out[a + "|" + b] = _pair_features(G, a, b, order)
    return out


# --------------------------------------------------------------------------- #
# Fit (NNLS surrogate with a free intercept) and predict
# --------------------------------------------------------------------------- #

_REDUCED = ["__ov__", "__fr1__", "__fr25__"]


def _reduced_features(full):
    tot_ov = sum(v for k, v in full.items() if k.startswith("ov:"))
    tot_fr1 = sum(v for k, v in full.items() if k.startswith("fr1.0:"))
    tot_fr25 = sum(v for k, v in full.items() if k.startswith("fr2.5:"))
    return {"__ov__": float(tot_ov), "__fr1__": float(tot_fr1),
            "__fr25__": float(tot_fr25)}


def _cap_of(caps, pair):
    if pair in caps:
        return caps[pair]
    a, b = pair.split("|", 1)
    alt = "|".join(sorted((a, b)))
    return caps.get(alt, 0.0)


def _nnls_predict(Arow, w, nfeat):
    # columns: features..., +1 intercept, -1 intercept
    return float(np.dot(Arow[:nfeat], w[:nfeat]) + w[nfeat] - w[nfeat + 1])


def _fit_pair(rows, pair):
    """Fit one net pair; fall back to a 3-term reduced model when short on rows."""
    nrows = len(rows)
    keys = sorted({k for feats, _ in rows for k in feats.get(pair, {})})
    reduced = nrows < len(keys) + 1 or not keys
    if reduced:
        names = list(_REDUCED)
        X = np.array([[_reduced_features(feats.get(pair, {}))[k] for k in names]
                      for feats, _ in rows], dtype=float)
    else:
        names = keys
        X = np.array([[feats.get(pair, {}).get(k, 0.0) for k in names]
                      for feats, _ in rows], dtype=float)
    y = np.array([_cap_of(caps, pair) for _, caps in rows], dtype=float)
    nfeat = len(names)

    # +1 / -1 columns let the intercept go negative under non-negative weights.
    X1 = np.hstack([X, np.ones((nrows, 1))])
    A = np.hstack([X1, -np.ones((nrows, 1))])
    w, _ = nnls(A, y)

    # Leave-one-out error.
    if nrows >= 2:
        pred = np.zeros(nrows)
        for i in range(nrows):
            mask = np.ones(nrows, bool)
            mask[i] = False
            wi, _ = nnls(A[mask], y[mask])
            pred[i] = _nnls_predict(A[i], wi, nfeat)
        err = pred - y
        rmse = float(np.sqrt((err ** 2).mean()))
        var = float(y.var())
        r2 = float(1.0 - (err ** 2).mean() / var) if var > _AREA_EPS else None
    else:
        rmse = None
        r2 = None

    coef = {names[j]: round(float(w[j]), 6) for j in range(nfeat)}
    intercept = round(float(w[nfeat] - w[nfeat + 1]), 6)
    return {
        "coef": coef,
        "intercept": intercept,
        "features": list(names),
        "reduced": bool(reduced),
        "n": int(nrows),
        "rmse": None if rmse is None else round(rmse, 6),
        "r2": None if r2 is None else round(r2, 6),
    }


def fit(rows, pairs):
    """Fit the capacitance model on judged candidates.

    ``rows`` is ``[(features_by_pair, caps_fF_by_pair), ...]``; the feature dicts may cover more
    net pairs than ``pairs`` (ideally every pair of named nets). The model is **pooled**: one
    non-negative coefficient per feature (layer pair and band), shared by every net pair, because
    overlap and fringe capacitance per um^2 between two layers does not depend on which nets own the
    shapes. Every extracted pair of every candidate is a row, so even one extraction determines it.
    Each net pair then gets an ``offset``: its mean residual over the candidates (what geometry does
    not explain, e.g. coupling inside a transistor), so the model reproduces the judged points.
    Gradients come from the pooled coefficients only.

    Returns a JSON-serialisable dict: ``{"pooled": {"coef": {feature: w}}, "pairs": {pair:
    {"offset", "n", "rmse", "r2", "fitRmse"}}}``. ``rmse``/``r2`` are leave-one-candidate-out when at
    least three candidates have the pair, else ``None``; ``fitRmse`` is the pooled fit's residual
    spread for the pair before its offset.
    """
    from scipy.optimize import nnls

    keys = sorted({k for feats, _ in rows for pf in feats.values() for k in pf})
    pooled_pairs = sorted({p for feats, caps in rows for p in feats if _has_cap(caps, p)})

    def design(sel):
        X, y, who = [], [], []
        for ci in sel:
            feats, caps = rows[ci]
            for p in pooled_pairs:
                if p not in feats or not _has_cap(caps, p):
                    continue
                X.append([feats[p].get(k, 0.0) for k in keys])
                y.append(_cap_of(caps, p))
                who.append((ci, p))
        return np.array(X, dtype=float).reshape(-1, len(keys)), np.array(y, dtype=float), who

    def solve(sel):
        X, y, who = design(sel)
        if len(y) == 0 or not keys:
            return np.zeros(len(keys)), {}
        w, _ = nnls(X, y)
        res = {}
        for (ci, p), r in zip(who, y - X.dot(w)):
            res.setdefault(p, []).append(float(r))
        return w, res

    allc = list(range(len(rows)))
    w, res = solve(allc)
    model = {"pooled": {"coef": {k: float(c) for k, c in zip(keys, w) if c > 0}}, "pairs": {}}
    want = set(a + "|" + b for a, b in _norm_pairs(pairs)) | set(pooled_pairs)
    for pair in sorted(want):
        r = res.get(pair, [])
        info = {"offset": float(np.mean(r)) if r else 0.0, "n": len(r),
                "fitRmse": float(np.sqrt(np.mean(np.square(r)))) if r else None,
                "rmse": None, "r2": None}
        model["pairs"][pair] = info
    # leave-one-candidate-out: refit without candidate c, offset from the others, predict c
    errs = {}
    if len(rows) >= 3:
        for c in allc:
            wc, rc = solve([i for i in allc if i != c])
            feats, caps = rows[c]
            for p in pooled_pairs:
                if p not in feats or not _has_cap(caps, p) or not rc.get(p):
                    continue
                pred = sum(wc[i] * feats[p].get(k, 0.0) for i, k in enumerate(keys)) + float(np.mean(rc[p]))
                errs.setdefault(p, []).append((pred - _cap_of(caps, p), _cap_of(caps, p)))
        for p, e in errs.items():
            if p in model["pairs"] and len(e) >= 3:
                d = np.array([x for x, _ in e]); yv = np.array([v for _, v in e])
                model["pairs"][p]["rmse"] = float(np.sqrt(np.mean(d ** 2)))
                var = float(np.var(yv))
                model["pairs"][p]["r2"] = (1.0 - float(np.mean(d ** 2)) / var) if var > 1e-12 else None
    return model


def _has_cap(caps, pair):
    if pair in caps:
        return True
    a, b = pair.split("|", 1)
    return "|".join(sorted((a, b))) in caps


def predict(model, feats):
    """Predicted coupling (fF) per net pair for one candidate's ``features``."""
    out = {}
    if "pooled" in model:
        coef = model["pooled"].get("coef", {})
        for pair, info in model.get("pairs", {}).items():
            f = feats.get(pair)
            if f is None:
                continue
            val = info.get("offset", 0.0)
            for name, c in coef.items():
                val += c * f.get(name, 0.0)
            out[pair] = float(val)
        return out
    for pair, info in model.get("pairs", {}).items():  # per-pair model (older state files)
        if info.get("reduced"):
            f = _reduced_features(feats.get(pair, {}))
        else:
            f = feats.get(pair, {})
        val = info.get("intercept", 0.0)
        for name, c in info.get("coef", {}).items():
            val += c * f.get(name, 0.0)
        out[pair] = float(val)
    return out


# --------------------------------------------------------------------------- #
# Gradients of the surrogate in the compactor's displacement variables
# --------------------------------------------------------------------------- #

def _whole_net(G, net):
    d = G.get(net, {})
    return unary_union(list(d.values())) if d else _EMPTY


def class_geom(comp_model, cls, axis):
    """The geometry of one compactor edge class in the *layout's* coordinates.

    For an ``axis="y"`` model the compactor built the transposed layout, so its
    polygon coordinates are swapped back here.
    """
    polys = comp_model["polys"]
    gs = []
    for pi in cls["polys"]:
        p = polys[pi][2]
        if axis == "y":
            p = p[:, ::-1]
        if len(p) >= 3:
            gs.append(Polygon(p).buffer(0))
    return unary_union(gs) if gs else _EMPTY


def gradients(model, lay, case, comp_model, pairs, axis="x", delta=0.05,
              reach_um=3.0):
    """Finite-difference gradients of each pair's predicted coupling in the
    compactor's displacement variables.

    ``comp_model`` is a :func:`compact.build` model of ``lay`` for ``axis`` (for
    ``"y"`` it is a model of the transposed layout). For every edge class that
    touches a shape of either net of a pair and lies within ``reach_um`` of that
    pair's coupling region, the class is displaced by ``+-delta`` (``compact.apply``
    on a zero vector with just that variable set), the features are recomputed
    (``nets.extract`` + :func:`features`) and the prediction central-differenced.
    Classes with no feature change are skipped.

    Returns ``{"gradients": {pair: {var: dfF/um}}, "base": {pair: fF},
    "considered": int, "differenced": int, "axis": axis}``.
    """
    from . import nets as _nets
    from . import compact as _compact

    norm = _norm_pairs(pairs)
    keys = [a + "|" + b for a, b in norm]

    base_extract = _nets.extract(lay, case)
    base_feats = features(base_extract, case, norm)
    base_pred = predict(model, base_feats)

    G = _netgeo(base_extract)
    pair_geoms = {}
    pair_region = {}
    for (a, b), key in zip(norm, keys):
        gA, gB = _whole_net(G, a), _whole_net(G, b)
        pair_geoms[key] = (gA, gB)
        parts = []
        if not gA.is_empty and not gB.is_empty:
            parts.append(gA.intersection(gB.buffer(reach_um)))
            parts.append(gB.intersection(gA.buffer(reach_um)))
        pair_region[key] = unary_union([p for p in parts if not p.is_empty]) if parts else _EMPTY

    L = lay if axis == "x" else _compact.transpose(lay)
    nv = comp_model["nv"]
    grads = {key: {} for key in keys}
    considered = 0
    differenced = 0

    for cls in _compact.edge_classes(comp_model):
        j = cls["var"]
        cg = class_geom(comp_model, cls, axis)
        if cg.is_empty:
            continue
        relevant = []
        cgb = cg.buffer(1e-4)
        for key in keys:
            gA, gB = pair_geoms[key]
            region = pair_region[key]
            touches = (not gA.is_empty and cgb.intersects(gA)) or \
                      (not gB.is_empty and cgb.intersects(gB))
            near = (not region.is_empty) and cg.distance(region) <= reach_um
            if touches and near:
                relevant.append(key)
        if not relevant:
            continue
        considered += 1

        xp = [0.0] * nv
        xm = [0.0] * nv
        xp[j] = delta
        xm[j] = -delta
        lp = _compact.apply(L, comp_model, xp, case)
        lm = _compact.apply(L, comp_model, xm, case)
        if axis == "y":
            lp = _compact.transpose(lp)
            lm = _compact.transpose(lm)
        fp = features(_nets.extract(lp, case), case, norm)
        fm = features(_nets.extract(lm, case), case, norm)
        pp = predict(model, fp)
        pm = predict(model, fm)

        moved = False
        for key in relevant:
            if fp.get(key) == fm.get(key):
                continue  # this class does not change the pair's features
            grads[key][j] = float((pp[key] - pm[key]) / (2.0 * delta))
            moved = True
        if moved:
            differenced += 1

    return {"gradients": grads,
            "base": {k: float(base_pred.get(k, 0.0)) for k in keys},
            "considered": considered, "differenced": differenced, "axis": axis}
