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

__all__ = ["sites", "features", "fit", "predict"]

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
    """Fit the per-pair capacitance surrogate on judged candidates.

    ``rows`` is ``[(features_by_pair, caps_fF_by_pair), ...]``. Returns a plain
    JSON-serialisable dict (written to ``state/model.json``) with, per pair, the
    NNLS coefficients by feature name, the free intercept, the leave-one-out
    RMSE and R^2, the row count and whether the reduced feature set was used.
    """
    model = {"pairs": {}}
    for a, b in _norm_pairs(pairs):
        pair = a + "|" + b
        model["pairs"][pair] = _fit_pair(rows, pair)
    return model


def predict(model, feats):
    """Predicted coupling (fF) per net pair for one candidate's ``features``."""
    out = {}
    for pair, info in model.get("pairs", {}).items():
        if info.get("reduced"):
            f = _reduced_features(feats.get(pair, {}))
        else:
            f = feats.get(pair, {})
        val = info.get("intercept", 0.0)
        for name, c in info.get("coef", {}).items():
            val += c * f.get(name, 0.0)
        out[pair] = float(val)
    return out
