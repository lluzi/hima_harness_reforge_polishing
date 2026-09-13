#!/usr/bin/env python3
"""Predict NLDM scalars (and optionally full 7x7 tables) for a SPICE netlist, from model.json.

NO ML RUNTIME.  numpy + stdlib only.  model.json carries two interchangeable predictors per target:
  ridge : 19 standardised log-space coefficients -- tiny, and its exponents are readable physics
  hgb   : the gradient-boosted ensemble dumped as flat decision-tree node arrays
Both are evaluated here with plain array indexing; sklearn is never imported.  --model ridge is the
default because it is auditable; --model hgb is measurably more accurate on the drive-resistance
and load-axis targets (see fit_report.json) at the cost of being a black box.

POWER.  --power model_power.json adds the power half of the model to the same JSON, so a caller
makes ONE subprocess call and gets timing and power together.  Three granularities, because that
is how Liberty stores power:
  arc   -> output-pin internal_power rise_power/fall_power, rebuilt on the SAME axes as the delay
           tables, which is what the overwhelming majority of characterised power tables do
  pin   -> input-pin passive_power 7x1, the gate-charge attribution term
  cell  -> leakage_power, default and worst state
How an internal_power grid is rebuilt is recorded IN the model file (`arc_param`), because the
label extractor can describe the same table three ways and the fitter picks by measurement:
  anchored / L4 -> rebuild_power()       affine + corner, 4 scalars
  L6            -> rebuild_power_lsq6()  quadratic in slew, affine in load, 6 scalars
The v2 curvature rule is never used for power: measured on the held-out arcs it is 1.9x WORSE
than plain affine (37.3% vs 19.3% on fall_power).  Its quadratic is in LOAD, which is the axis
the power surface is flat in; L6 puts the quadratic on SLEW, which is the axis it is steep in.
The passive 7x1 is a straight line from the predicted q0 to q_max, so the poorly-determined slew
slope is never used.

Usage:
  predict.py --netlist cell.sp                      # scalars, TSV to stdout
  predict.py --netlist cell.sp --model hgb --json out.json
  predict.py --netlist cell.sp --tables             # also rebuild the 4 NLDM 7x7 grids

TABLE RECONSTRUCTION.  The scalars are a 6-parameter compression of a 7x7 grid, and they are turned
back into a grid by the bilinear-plus-corner rule the label extractor was designed for:

    d(s,c) = d0 + dR_slew*(s-s0) + dR_load*(c-c0)
             + X * (s-s0)(c-c0)/((smax-s0)(cmax-c0)),   X chosen so d(smax,cmax) == d_max

The slew axis is taken verbatim from the bound axes, because a characterised library shares one
slew index across nearly all of its cells.  The LOAD axis is not shared -- it scales with drive
strength -- so it is regenerated from the predicted k_load as
index_2[i] = index_2[0] + k*(base[i]-base[0]).  Predicting k_load is what stops a strong generated
cell from being characterised on a weak cell's load range; the incumbent mock does not predict it
at all.

NDA.  Both axes are MEASURED PROPERTIES OF THE REFERENCE LIBRARY, so this file holds neither.  See
load_axes() for how they are bound per run.
"""

import argparse
import json
import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import featurize as FZ                      # noqa: E402  same feature map fit.py trained on
import sys
# Site-bound helper modules (estimate_lib / mock_char / charmodel). The authoritative copy
# is unresolved -- see authoring/flow-map.json OQ-2 -- so this package refuses to choose one
# and binds the directory through the typed input XS28_CHARMODEL_HELPER_DIR instead of
# carrying a site path.
import os as _os
for _p in _os.environ.get("XS28_CHARMODEL_HELPER_DIR", "").split(":"):
    if _p:
        sys.path.insert(0, _p)
import mock_char as MC                      # noqa: E402  parse_netlist (stdlib only)
import features as FX                       # noqa: E402  cell_rows (stdlib only)

# THE CHARACTERISATION AXES ARE SITE DATA AND ARE NOT WRITTEN HERE.
#
# The slew index and the load index of a characterised library are measured properties of that
# library: they are the grid its own tables are sampled on, and the entire point of rebuilding a
# generated table on them is that it lands on the same grid. They were previously two source
# literals in this file, which made a packaged executable asset carry a verbatim extract of the
# reference library's NLDM index vectors -- the largest single piece of library data this package
# held, and invisible to any scan looking for identifiers. The library emitter now derives them
# from the site-bound reference Liberty and passes them inline; direct predictor users may still
# bind a file or a model-carried grid. A run that supplies none stops rather than silently using a
# grid from somewhere else.
#
# Only the SHAPE of the load axis is bound; the emitted axis is regenerated from the predicted
# k_load, which is what stops a strong generated cell being characterised on a weak cell's range.
AXES_KEYS = ("slew", "load_base")


def load_axes(model, explicit=None, inline=None):
    """(slew_axis, load_base) for this run. Never defaulted, never packaged.

    Resolution order: the caller's inline axes derived from its bound Liberty, an explicit
    --axes file, XS28_CHARMODEL_AXES, then an `axes` block inside the model that was fitted on
    them. Absent all four this is fatal, because a table
    rebuilt on the wrong grid is not a wrong number - it is a right number silently attached to
    the wrong slew and load, which nothing downstream can see.
    """
    src = None
    if inline:
        try:
            src = json.loads(inline)
        except ValueError as exc:
            sys.exit("predict: inline characterisation axes are invalid: %s" % exc)
    for path in (explicit, os.environ.get("XS28_CHARMODEL_AXES") or None):
        if src is not None:
            break
        if path:
            try:
                src = json.load(open(path))
            except (OSError, ValueError) as exc:
                sys.exit("predict: axes file %s is unreadable: %s" % (path, exc))
            break
    if src is None:
        src = model.get("axes")
    if not isinstance(src, dict) or not all(src.get(key) for key in AXES_KEYS):
        sys.exit("predict: the characterisation axes are not bound. Supply --axes FILE, or set "
                 "XS28_CHARMODEL_AXES, or bind a model carrying an `axes` block with the keys "
                 "%s. This package holds no axis of its own." % ", ".join(AXES_KEYS))
    return [float(v) for v in src["slew"]], [float(v) for v in src["load_base"]]


TABLES = [("cell_rise", "cr"), ("cell_fall", "cf"),
          ("rise_transition", "rt"), ("fall_transition", "ft")]


# ------------------------------------------------------------------ predictors -----
def ridge_eval(c, X):
    mu = np.asarray(c["mu"]); sd = np.asarray(c["sd"]); w = np.asarray(c["w"])
    return ((X - mu) / sd) @ w + c["intercept"]


def untransform(spec, yt):
    """Model space -> physical space.  The exact inverse of fit_power.fwd().

    `asinh` (y = scale*sinh(t)) exists because `log` cannot represent a negative number and the
    fitter therefore DROPPED every negative training row -- which is how the shipped fall_power
    model became structurally unable to emit negative entries at all. Negative fall_power entries
    are not an anomaly to be clipped away: a real characterised library carries them on a large
    minority of its fall_power tables, and a model that cannot express them is wrong in one
    direction everywhere.
    """
    tf = spec.get("transform")
    if tf == "log":
        return np.exp(yt)
    if tf == "asinh":
        return float(spec.get("scale", 1.0)) * np.sinh(yt)
    return yt


def hgb_eval(ex, X):
    """Sum of binary regression trees. Verified against sklearn at fit time (max dev 0.0)."""
    out = np.full(len(X), ex["baseline"], float)
    for tr in ex["trees"]:
        f = np.array(tr["f"]); t = np.array(tr["t"], float)
        l = np.array(tr["l"]); r = np.array(tr["r"])
        v = np.array(tr["v"], float); leaf = np.array(tr["leaf"], bool)
        node = np.zeros(len(X), int)
        while True:
            act = np.where(~leaf[node])[0]
            if act.size == 0:
                break
            n = node[act]
            node[act] = np.where(X[act, f[n]] <= t[n], l[n], r[n])
        out += v[node]
    return out


def predict_scalars(model, rows, which="ridge"):
    X = np.array([FZ.build_row(r) for r in rows], float)
    out = [{} for _ in rows]
    for tname, spec in model["targets"].items():
        if which == "hgb" and "hgb_full" in spec:
            yt = hgb_eval(spec["hgb_full"], X)
        elif "coef_full" in spec:
            yt = ridge_eval(spec["coef_full"], X)
        else:
            continue
        y = np.exp(yt) if spec["transform"] == "log" else yt
        for i, v in enumerate(y):
            out[i][tname] = float(v)
    return out


# ------------------------------------------------------------------ tables -----
def rebuild_table(pref, sc, slew, load):
    d0 = sc.get(pref + "_d0")
    dl = sc.get(pref + "_dR_load")
    ds = sc.get(pref + "_dR_slew")
    dm = sc.get(pref + "_d_max")
    if None in (d0, dl, ds, dm):
        return None
    s0, sN, c0, cN = slew[0], slew[-1], load[0], load[-1]
    den = (sN - s0) * (cN - c0)
    if den == 0:                 # degenerate 1-point axis (a handful of arcs in the library)
        return [[d0 + ds * (s - s0) + dl * (c - c0) for c in load] for s in slew]
    corner = dm - (d0 + ds * (sN - s0) + dl * (cN - c0))
    g = []
    for s in slew:
        g.append([d0 + ds * (s - s0) + dl * (c - c0) + corner * (s - s0) * (c - c0) / den
                  for c in load])
    return g


def _quad(u, slope_lo, slope_lsq):
    """Coefficients (a,b) of d = a*u + b*u^2 that have LOCAL slope slope_lo at u=0 and whose
    least-squares slope over the sample points `u` equals slope_lsq.

    WHY: the affine rebuild in rebuild_table() throws away the table's curvature in load, which is
    exactly what the label extractor kept the *_lo companions for -- their RATIO to the LSQ slope
    IS the curvature.  An NLDM delay row is convex in load (the driver's effective resistance rises
    as it leaves saturation), so a straight line necessarily overshoots the middle of the row.
    """
    u = np.asarray(u, float)
    if len(u) < 3:
        return slope_lsq, 0.0
    vu = float(np.var(u))
    cv = float(np.mean((u - u.mean()) * (u ** 2 - np.mean(u ** 2))))
    if vu == 0 or cv == 0 or not np.isfinite(slope_lo) or not np.isfinite(slope_lsq):
        return (slope_lsq if np.isfinite(slope_lsq) else 0.0), 0.0
    b = (slope_lsq - slope_lo) * vu / cv
    return slope_lo, b


def rebuild_table_v2(pref, sc, slew, load):
    """Curvature-aware rebuild: quadratic in load AND in slew, then a corner term.

        d(s,c) = row0(c) + col0(s) - d0 + X*n(s)*n(c),  X set so d(smax,cmax) == d_max

    Uses 8 scalars instead of 6 (adds dR_load_lo, dR_slew_lo).  Measured against the affine rule on
    held-out foundry tables in validate_tables.py -- see table_validation.json for which one wins.
    """
    g = [sc.get(pref + "_" + k) for k in
         ("d0", "dR_load", "dR_slew", "d_max", "dR_load_lo", "dR_slew_lo")]
    if any(v is None or not np.isfinite(v) for v in g[:4]):
        return None
    d0, dl, ds, dm, dl_lo, ds_lo = g
    dl_lo = dl if (dl_lo is None or not np.isfinite(dl_lo)) else dl_lo
    ds_lo = ds if (ds_lo is None or not np.isfinite(ds_lo)) else ds_lo
    s0, sN, c0, cN = slew[0], slew[-1], load[0], load[-1]
    u = [c - c0 for c in load]
    v = [s - s0 for s in slew]
    a_c, b_c = _quad(u, dl_lo, dl)
    a_s, b_s = _quad(v, ds_lo, ds)
    row = [a_c * x + b_c * x * x for x in u]           # load contribution, zero at c0
    col = [a_s * x + b_s * x * x for x in v]           # slew contribution, zero at s0
    den = (sN - s0) * (cN - c0)
    X = 0.0 if den == 0 else dm - (d0 + row[-1] + col[-1])
    out = []
    for i, s in enumerate(slew):
        ns = 0.0 if sN == s0 else (s - s0) / (sN - s0)
        out.append([d0 + col[i] + row[j] + (X * ns * ((c - c0) / (cN - c0)) if den else 0.0)
                    for j, c in enumerate(load)])
    return out


# ------------------------------------------------------------------ power -----
POWER_TABLES = [("rise_power", "rp"), ("fall_power", "fp")]


def rebuild_power(pref, sc, slew, load):
    """Affine-plus-corner rebuild of one 7x7 internal_power grid.

    Deliberately the SAME rule as rebuild_table() and deliberately NOT rebuild_table_v2().  The
    delay surface is convex in load, which is what the v2 quadratic term is for; the power surface
    is nearly FLAT in load (the load-charging energy is not in this table -- the tool derives that
    from the net capacitance itself) and what curvature it has lives on the slew axis, where a
    fitted quadratic overshoots the last row.  Values are NOT clamped positive: foundry fall_power
    legitimately goes negative, because these tables are energy differences, not energies.
    """
    d0 = sc.get(pref + "_d0")
    dm = sc.get(pref + "_d_max")
    dl = sc.get(pref + "_dR_load")
    ds = sc.get(pref + "_dR_slew")
    if None in (d0, dm, dl, ds) or not all(np.isfinite([d0, dm, dl, ds])):
        return None
    s0, sN, c0, cN = slew[0], slew[-1], load[0], load[-1]
    den = (sN - s0) * (cN - c0)
    if den == 0:
        return [[d0 + ds * (s - s0) + dl * (c - c0) for c in load] for s in slew]
    corner = dm - (d0 + ds * (sN - s0) + dl * (cN - c0))
    return [[d0 + ds * (s - s0) + dl * (c - c0) + corner * (s - s0) * (c - c0) / den
             for c in load] for s in slew]


def rebuild_power_lsq6(pref, sc, slew, load):
    """Quadratic-in-slew, affine-in-load rebuild of one 7x7 internal_power grid.

        P(s,c) = c00 + c10*S + c20*S^2 + c01*C + c11*S*C + c21*S^2*C,   S = s-s0, C = c-c0

    Six least-squares coefficients over the whole grid instead of four numbers anchored at two
    corners.  Measured compression floor on the 455 held-out arcs: 5.7% fall_power against 19.3%
    for the anchored rule (12.5% for the same four terms fitted by least squares).  S is measured
    from the FIRST slew point and C from the FIRST load point, which are the same origins the
    labels were fitted on -- load_axis() rescales index_2 but keeps index_2[0] fixed, so the two
    agree by construction.

    NOTE the S^2 terms make this grow quadratically OUTSIDE the characterised slew range.  That
    is safe only because charlib_emit.py now declares max_transition at the top of the slew axis
    instead of the 1.5 it used to hardcode; the two changes have to stay together.
    """
    k = [sc.get(pref + "_" + n) for n in ("c00", "c10", "c20", "c01", "c11", "c21")]
    if any(v is None for v in k) or not all(np.isfinite(k)):
        return None
    c00, c10, c20, c01, c11, c21 = k
    s0, l0 = slew[0], load[0]
    out = []
    for sv in slew:
        S = sv - s0
        out.append([c00 + c10 * S + c20 * S * S
                    + (c01 + c11 * S + c21 * S * S) * (cv - l0) for cv in load])
    return out


def power_rebuilder(pm):
    """The rebuild that matches the parameterisation the model was FITTED under.

    Older model files predate the flag; they carry the anchored four scalars, so that is the
    default and an old model_power.json keeps rebuilding exactly as it always did."""
    return rebuild_power_lsq6 if pm.get("arc_param") == "L6" else rebuild_power


def rebuild_passive(pref, sc, slew):
    """The input-pin passive 7x1 as a straight line from q0 to q_max over the slew axis.

    Two predicted endpoints instead of a slope: the fitted dQ_slew is the worst target in the
    whole model (a small signed number that crosses zero), so the rebuild is built not to need it.
    """
    q0 = sc.get(pref + "_q0")
    qm = sc.get(pref + "_q_max")
    if q0 is None or qm is None or not np.isfinite([q0, qm]).all():
        return None
    s0, sN = slew[0], slew[-1]
    if sN == s0:
        return [q0] * len(slew)
    return [q0 + (qm - q0) * (s - s0) / (sN - s0) for s in slew]


def predict_power(pm, rows, which="hgb"):
    """Power scalars at all three granularities, for the arc feature rows of one cell.

    The pin and cell models were TRAINED on the mean of the relevant arc feature rows
    (fit_power.agg_rows); the same aggregation is reproduced here.  Training on one aggregation and
    serving another is a silent-skew bug, so it is written once on each side and validate_power.py
    checks the two agree.
    """
    X = np.array([FZ.build_row(r) for r in rows], float)

    def ev(section, Xm):
        out = [{} for _ in Xm]
        for tname, spec in pm.get(section, {}).items():
            if which == "hgb" and "hgb_full" in spec:
                yt = hgb_eval(spec["hgb_full"], Xm)
            elif "coef_full" in spec:
                yt = ridge_eval(spec["coef_full"], Xm)
            else:
                continue
            y = untransform(spec, yt)
            for i, v in enumerate(y):
                out[i][tname] = float(v)
        return out

    arc = ev("arc_targets", X)

    pins = {}
    for i, r in enumerate(rows):
        pins.setdefault(r["in_pin"], []).append(i)
    order = list(pins)
    Xp = np.array([X[pins[p]].mean(axis=0) for p in order], float)
    pin = dict(zip(order, ev("pin_targets", Xp))) if order else {}

    cell = ev("cell_targets", np.array([X.mean(axis=0)], float))[0]
    return arc, pin, cell


def load_axis(k, load_base):
    """This cell's load index: the bound shape, stretched by the predicted k_load about its first
    point. `load_base` is passed in rather than read from a module constant, because it is site
    data with a per-run lifetime."""
    return [load_base[0] + k * (v - load_base[0]) for v in load_base]


# ------------------------------------------------------------------ main -----
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--netlist", required=True, help="bool2cmos / foundry-dialect .subckt SPICE")
    ap.add_argument("--model", default=os.path.join(HERE, "model.json"))
    ap.add_argument("--which", choices=("ridge", "hgb"), default="ridge")
    ap.add_argument("--tables", action="store_true", help="also rebuild the 4 NLDM 7x7 grids")
    ap.add_argument("--rebuild", choices=("v2", "affine"), default="v2",
                    help="v2 = curvature-aware (default; halves the compression error)")
    ap.add_argument("--power", nargs="?", const=os.path.join(HERE, "model_power.json"),
                    help="also predict internal_power and leakage (default model_power.json)")
    ap.add_argument("--axes", help="characterisation axes (JSON with `slew` and `load_base`); "
                                   "site data, also accepted via XS28_CHARMODEL_AXES or an "
                                   "`axes` block in the model")
    ap.add_argument("--axes-json", help="internal inline axes derived from the bound Liberty")
    ap.add_argument("--json", help="write full result here instead of TSV to stdout")
    a = ap.parse_args()

    model = json.load(open(a.model))
    name, ports, devs = MC.parse_netlist(a.netlist)
    from collections import Counter
    rows, why = FX.cell_rows(name, devs, ports, Counter())
    if why:
        sys.exit("predict: cannot featurise %s (%s)" % (name, why))
    if not rows:
        sys.exit("predict: no timing arcs found in %s" % name)

    # Bound once per run, threaded explicitly. Only resolved when tables are actually rebuilt:
    # a scalars-only call does not touch the axes and must not be made to require them.
    slew_axis, load_base = load_axes(model, a.axes, a.axes_json) if a.tables else (None, None)

    sc = predict_scalars(model, rows, a.which)
    pw_arc = pw_pin = pw_cell = None
    if a.power:
        pm = json.load(open(a.power))
        pw_arc, pw_pin, pw_cell = predict_power(pm, rows, a.which)
    res = {"cell": name, "model": a.which, "arcs": []}
    for r, s in zip(rows, sc):
        e = {"in_pin": r["in_pin"], "out_pin": r["out_pin"], "scalars": s}
        if a.tables:
            k = max(s.get("k_load", 1.0), 1.0)
            la = load_axis(k, load_base)
            e["index_1"] = slew_axis
            e["index_2"] = la
            rb = rebuild_table_v2 if a.rebuild == "v2" else rebuild_table
            e["tables"] = {full: rb(p, s, slew_axis, la) for full, p in TABLES}
        res["arcs"].append(e)

    if pw_arc is not None:
        rbp = power_rebuilder(pm)
        res["power_param"] = pm.get("arc_param", "anchored")
        for e, ps in zip(res["arcs"], pw_arc):
            e["power_scalars"] = ps
            if a.tables:
                e["power_tables"] = {full: rbp(p, ps, slew_axis, e["index_2"])
                                     for full, p in POWER_TABLES}
        res["leakage"] = pw_cell
        res["pins"] = {}
        for p, ps in pw_pin.items():
            d = {"scalars": ps}
            if a.tables:
                d["index_1"] = slew_axis
                d["passive"] = {full: rebuild_passive(ab, ps, slew_axis)
                                for full, ab in POWER_TABLES}
            res["pins"][p] = d

    if a.json:
        json.dump(res, open(a.json, "w"), indent=1)
        print("wrote %s (%d arcs)" % (a.json, len(res["arcs"])))
    else:
        keys = [t for t in model["targets"]]
        print("\t".join(["in_pin", "out_pin"] + keys))
        for e in res["arcs"]:
            print("\t".join([e["in_pin"], e["out_pin"]]
                            + ["%.6g" % e["scalars"].get(k, float("nan")) for k in keys]))


if __name__ == "__main__":
    main()
