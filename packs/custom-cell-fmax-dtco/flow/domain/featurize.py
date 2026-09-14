#!/usr/bin/env python3
"""Shared feature map for the learned timing model.

Kept in its own module so fit.py (needs sklearn) and predict.py (must run with numpy+stdlib only)
build EXACTLY the same design matrix. If these two ever drift the model silently mispredicts, so
there is deliberately no second copy of this logic anywhere.

DESIGN CHOICE -- WHY LOGS.  A CMOS delay is d ~ R*C with R ~ series_depth/W and C ~ sum(W).  Both
are PRODUCTS of the raw netlist quantities, so a model that is linear in the RAW features cannot
express them: it would have to approximate 1/W with a straight line.  Taking logs turns the product
into a sum, so an ordinary ridge in log space IS the power law

    y = exp(b0) * prod_i x_i^{b_i}

and the fitted exponent b_i is directly readable physics: b(series_n) should come out near +1 and
b(wn_out_sum) near -1 for a fall delay if first-order RC is right.  Ratios like series_n/wn_out_sum
are therefore NOT added as separate columns -- they are already exactly representable as a
difference of two log columns, and adding them would only make the design matrix rank-deficient.
"""

import math

EPS = 1e-6

# (output column name, source column, transform)
#   log  : strictly-positive physical quantity -> natural log
#   log1p: count that can legitimately be zero
#   raw  : indicator / small integer used as-is
FEATURE_SPEC = [
    # --- resistance side: how many devices in series, and how wide they are ---------------
    ("l_series_n",     "series_n",         "log"),
    ("l_series_p",     "series_p",         "log"),
    ("l_wn_min",       "wn_min",           "log"),
    ("l_wp_min",       "wp_min",           "log"),
    ("l_wn_sum",       "wn_sum",           "log"),
    ("l_wp_sum",       "wp_sum",           "log"),
    # --- the OUTPUT stage: for a multistage arc this, not wn_sum, is the drive that matters -
    ("l_wn_out_sum",   "wn_out_sum",       "log"),
    ("l_wp_out_sum",   "wp_out_sum",       "log"),
    ("l_n_dev_out",    "n_dev_out",        "log"),
    # --- capacitance side ------------------------------------------------------------------
    ("l_gate_width_in", "gate_width_in",   "log"),
    ("l_n_dev_total",  "n_dev_total",      "log"),
    ("l_fanout_int",   "fanout_internal",  "log"),
    ("l_out_load_dev", "out_load_devices", "log1p"),
    # --- structure -------------------------------------------------------------------------
    ("is_multistage",  "is_multistage",    "raw"),
    ("l_n_in_pins",    "n_in_pins",        "log"),
    ("l_n_out_pins",   "n_out_pins",       "log"),
    ("is_pass_gate",   "is_pass_gate",     "raw"),
    ("l_pass_w_n",     "pass_w_n",         "log1p"),
    ("l_pass_w_p",     "pass_w_p",         "log1p"),
]

FEATURES = [f[0] for f in FEATURE_SPEC]


def build_row(rec):
    """rec: dict of raw feature columns (str or numeric) -> list[float] in FEATURES order."""
    out = []
    for name, src, tf in FEATURE_SPEC:
        v = rec[src]
        v = float(v) if not isinstance(v, float) else v
        if tf == "log":
            out.append(math.log(v if v > EPS else EPS))
        elif tf == "log1p":
            out.append(math.log1p(max(v, 0.0)))
        else:
            out.append(v)
    return out
