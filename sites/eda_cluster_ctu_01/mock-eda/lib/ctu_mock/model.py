"""The deterministic design model behind every mock EDA number on eda_cluster_ctu_01.

One design (aes_cipher_top, 28 nm, stock library std9t_svt, clock 1.000 ns) is represented by its 20
worst register-to-register path groups. Each path is a list of stages; every stage is one cell of a
cell family (DFF clock-to-Q, BUF, XNOR3, XOR2, MUX2I, AOI21, ...) plus the net delay after it. A
generated (AndesCell) cell family makes the cell delay of every stage of that family faster by the
family's achievable speed-up; net delay never changes. Everything the mock tools print (slack, WNS,
TNS, Fmax, the per-cell-type stage breakdown, area, instance counts) is computed here, so the same
library always gives the same numbers on every tool.

Calibration (see tests/test_mock_eda.py): with the families AndesCell picks when the requirements
name the critical-path families, the new-library build is +2.50 % (XNOR3, BUF), +3.40 % (+ XOR2,
MUX2I) and +5.20 % (+ AOI21, OAI21) Fmax over the reference build. A family that is on no worst path
gains nothing.

MOCK EDA: these are model numbers for a demonstration Site; not signoff, not silicon.
"""
import hashlib

DESIGN = "aes_cipher_top"
TECHNOLOGY = "28 nm"
STOCK_LIBRARY = "std9t_svt"
CORNER = "tt0p90v25c"
CLOCK_NAME = "clk"
CLOCK_PERIOD_NS = 1.000
CLOCK_LATENCY_NS = 0.142
UNCERTAINTY_PS = 25.0
SETUP_PS = 32.0
CORE_UTILIZATION = 0.70
REFERENCE_DRC = 0

# family -> facts used by every tool. speedup: the cell-delay reduction an AndesCell-generated cell
# of this family reaches at fanout 4 (fraction). typPs: a typical stage delay on the critical paths.
FAMILIES = {
    "DFF": dict(cells=["DFFQ_X1", "DFFQ_X2"], out="Q", typPs=82, speedup=0.10, instances=530, areaUm2=5.54, adopt=0.25, areaRatio=1.14,
                  inputs=["D", "CK"], function="IQ", describe="D flip-flop (clock-to-Q)"),
    "BUF": dict(cells=["BUF_X2", "BUF_X4", "BUF_X8"], out="Z", typPs=30, speedup=0.28, instances=1900, areaUm2=2.27, adopt=0.12, areaRatio=1.22,
                  inputs=["A"], function="A", describe="non-inverting buffer"),
    "INV": dict(cells=["INV_X1", "INV_X2", "INV_X4"], out="ZN", typPs=12, speedup=0.08, instances=1680, areaUm2=1.01, adopt=0.03, areaRatio=1.10,
                  inputs=["A"], function="!A", describe="inverter"),
    "XNOR3": dict(cells=["XNOR3_X1", "XNOR3_X2"], out="ZN", typPs=56, speedup=0.32, instances=1120, areaUm2=3.78, adopt=0.22, areaRatio=1.18,
                  inputs=["A1", "A2", "A3"], function="!(A1^A2^A3)", describe="3-input exclusive NOR"),
    "XOR2": dict(cells=["XOR2_X1", "XNOR2_X1", "XOR2_X2", "XNOR2_X2"], out="Z", typPs=38, speedup=0.24, instances=2660, areaUm2=2.77, adopt=0.14, areaRatio=1.16,
                  inputs=["A1", "A2"], function="A1^A2", describe="2-input exclusive OR / NOR"),
    "MUX2I": dict(cells=["MUX2I_X1", "MUX2I_X2"], out="ZN", typPs=34, speedup=0.24, instances=860, areaUm2=3.02, adopt=0.18, areaRatio=1.15,
                  inputs=["I0", "I1", "S"], function="!((I0&!S)|(I1&S))", describe="2:1 inverting multiplexer"),
    "MUX2": dict(cells=["MUX2_X1"], out="Z", typPs=40, speedup=0.16, instances=330, areaUm2=3.28, adopt=0.0, areaRatio=1.15,
                  inputs=["I0", "I1", "S"], function="(I0&!S)|(I1&S)", describe="2:1 multiplexer"),
    "AOI21": dict(cells=["AOI21_X1", "AOI21_X2"], out="ZN", typPs=30, speedup=0.24, instances=1250, areaUm2=1.76, adopt=0.10, areaRatio=1.17,
                  inputs=["A1", "A2", "B"], function="!((A1&A2)|B)", describe="AND-OR-invert 2-1"),
    "OAI21": dict(cells=["OAI21_X1", "OAI21_X2"], out="ZN", typPs=30, speedup=0.22, instances=1290, areaUm2=1.76, adopt=0.10, areaRatio=1.17,
                  inputs=["A1", "A2", "B"], function="!((A1|A2)&B)", describe="OR-AND-invert 2-1"),
    "AOI22": dict(cells=["AOI22_X1"], out="ZN", typPs=32, speedup=0.18, instances=640, areaUm2=2.27, adopt=0.08, areaRatio=1.16,
                  inputs=["A1", "A2", "B1", "B2"], function="!((A1&A2)|(B1&B2))", describe="AND-OR-invert 2-2"),
    "OAI22": dict(cells=["OAI22_X1"], out="ZN", typPs=32, speedup=0.18, instances=410, areaUm2=2.27, adopt=0.0, areaRatio=1.16,
                  inputs=["A1", "A2", "B1", "B2"], function="!((A1|A2)&(B1|B2))", describe="OR-AND-invert 2-2"),
    "NAND2": dict(cells=["NAND2_X1", "NAND2_X2", "NAND2_X4"], out="ZN", typPs=20, speedup=0.12, instances=1900, areaUm2=1.26, adopt=0.05, areaRatio=1.12,
                  inputs=["A1", "A2"], function="!(A1&A2)", describe="2-input NAND"),
    "NOR2": dict(cells=["NOR2_X1", "NOR2_X2"], out="ZN", typPs=24, speedup=0.14, instances=1300, areaUm2=1.26, adopt=0.06, areaRatio=1.12,
                  inputs=["A1", "A2"], function="!(A1|A2)", describe="2-input NOR"),
    "NAND3": dict(cells=["NAND3_X1"], out="ZN", typPs=26, speedup=0.14, instances=520, areaUm2=1.76, adopt=0.06, areaRatio=1.12,
                  inputs=["A1", "A2", "A3"], function="!(A1&A2&A3)", describe="3-input NAND"),
    "NOR3": dict(cells=["NOR3_X1"], out="ZN", typPs=30, speedup=0.16, instances=380, areaUm2=2.02, adopt=0.0, areaRatio=1.12,
                  inputs=["A1", "A2", "A3"], function="!(A1|A2|A3)", describe="3-input NOR"),
    "AND2": dict(cells=["AND2_X1", "AND2_X2"], out="Z", typPs=30, speedup=0.14, instances=610, areaUm2=1.76, adopt=0.05, areaRatio=1.12,
                  inputs=["A1", "A2"], function="A1&A2", describe="2-input AND"),
    "OR2": dict(cells=["OR2_X1"], out="Z", typPs=32, speedup=0.14, instances=420, areaUm2=1.76, adopt=0.05, areaRatio=1.12,
                  inputs=["A1", "A2"], function="A1|A2", describe="2-input OR"),
}

# Words a requirement may use for a family.
ALIASES = {
    "XNOR2": "XOR2", "XOR2/XNOR2": "XOR2", "XNOR2/XOR2": "XOR2", "XOR": "XOR2", "XNOR": "XOR2",
    "BUFFER": "BUF", "BUFF": "BUF", "CLKBUF": "BUF", "INVERTER": "INV",
    "DFFQ": "DFF", "FLOP": "DFF", "FLIPFLOP": "DFF", "FLIP-FLOP": "DFF", "REGISTER": "DFF", "DFFR": "DFF",
    "MXI2": "MUX2I", "MUXI2": "MUX2I", "MUX2INV": "MUX2I", "MX2": "MUX2",
}

# Instance population outside the families (tie cells, clock buffers, delay cells, fillers excluded)
EXTRA_INSTANCES = 18400 - sum(f["instances"] for f in FAMILIES.values())
EXTRA_AREA_UM2 = 41200.0 - sum(f["instances"] * f["areaUm2"] for f in FAMILIES.values())

# The 20 worst path groups of the reference build. ref: reference path delay in ps from the launch
# clock edge (clock-to-Q included) plus setup and uncertainty; mix: cell delay per family in ps;
# the rest of ref is net delay. n: violating endpoints the group stands for (TNS).
PATHS = [
    dict(id="A1", n=12, start="sa12_reg_3_", end="sa21_reg_6_", via="us12", group="S-box / MixColumns", ref=1044.20,
         mix=dict(DFF=82, XNOR3=268, BUF=196, XOR2=96, MUX2I=40, AOI21=56, NAND2=44, INV=24)),
    dict(id="A2", n=11, start="sa03_reg_5_", end="sa30_reg_1_", via="us03", group="S-box / MixColumns", ref=1041.00,
         mix=dict(DFF=82, XNOR3=252, BUF=188, XOR2=104, MUX2I=40, AOI21=60, NAND2=44, INV=24)),
    dict(id="A3", n=9, start="sa21_reg_0_", end="sa12_reg_7_", via="us21", group="S-box / MixColumns", ref=1036.10,
         mix=dict(DFF=80, XNOR3=236, BUF=176, XOR2=110, MUX2I=44, AOI21=60, NAND2=48, INV=26)),
    dict(id="A4", n=8, start="sa30_reg_2_", end="sa03_reg_4_", via="us30", group="S-box / MixColumns", ref=1031.40,
         mix=dict(DFF=80, XNOR3=226, BUF=166, XOR2=104, MUX2I=50, AOI21=70, NAND2=48, INV=26)),
    dict(id="A5", n=8, start="sa11_reg_6_", end="sa22_reg_3_", via="us11", group="S-box / MixColumns", ref=1027.90,
         mix=dict(DFF=80, XNOR3=210, BUF=160, XOR2=116, MUX2I=50, AOI21=70, NAND2=44, INV=30)),
    dict(id="A6", n=7, start="sa22_reg_1_", end="sa11_reg_0_", via="us22", group="S-box / MixColumns", ref=1023.60,
         mix=dict(DFF=80, XNOR3=196, BUF=168, XOR2=120, MUX2I=45, AOI21=70, NAND2=44, INV=30)),
    dict(id="A7", n=6, start="sa00_reg_4_", end="sa33_reg_2_", via="us00", group="S-box / MixColumns", ref=1018.30,
         mix=dict(DFF=80, XNOR3=184, BUF=150, XOR2=124, MUX2I=50, AOI21=80, NAND2=44, INV=30)),
    dict(id="B1", n=7, start="u0/w_reg_3__17_", end="u0/w_reg_0__17_", via="u0/u3", group="key expansion", ref=1041.45,
         mix=dict(DFF=82, XNOR3=36, BUF=40, XOR2=272, MUX2I=208, AOI21=48, NAND2=60, INV=34)),
    dict(id="B2", n=6, start="u0/w_reg_3__9_", end="u0/w_reg_1__9_", via="u0/u1", group="key expansion", ref=1039.05,
         mix=dict(DFF=82, XNOR3=30, BUF=44, XOR2=260, MUX2I=200, AOI21=52, NAND2=60, INV=34)),
    dict(id="B3", n=5, start="u0/w_reg_3__26_", end="u0/w_reg_2__26_", via="u0/u2", group="key expansion", ref=1039.95,
         mix=dict(DFF=80, XNOR3=40, BUF=44, XOR2=248, MUX2I=188, AOI21=56, NAND2=56, INV=34)),
    dict(id="B4", n=4, start="u0/w_reg_3__2_", end="u0/w_reg_3__2_", via="u0/u0", group="key expansion", ref=1035.53,
         mix=dict(DFF=80, XNOR3=30, BUF=50, XOR2=232, MUX2I=176, AOI21=60, NAND2=56, INV=34)),
    dict(id="C1", n=5, start="ld_r_reg", end="sa13_reg_4_", via="ld_mux", group="load / round control", ref=1013.78,
         mix=dict(DFF=84, BUF=14, AOI21=262, OAI21=204, NAND2=84, NOR2=70, INV=40)),
    dict(id="C2", n=4, start="ld_r_reg", end="sa31_reg_7_", via="ld_mux", group="load / round control", ref=1012.94,
         mix=dict(DFF=84, BUF=16, AOI21=246, OAI21=196, NAND2=84, NOR2=70, INV=40)),
    dict(id="C3", n=4, start="dcnt_reg_1_", end="sa20_reg_2_", via="ld_mux", group="load / round control", ref=1012.36,
         mix=dict(DFF=82, BUF=20, AOI21=232, OAI21=184, NAND2=88, NOR2=76, INV=40)),
    dict(id="C4", n=3, start="dcnt_reg_2_", end="sa02_reg_5_", via="ld_mux", group="load / round control", ref=1009.70,
         mix=dict(DFF=82, BUF=18, AOI21=220, OAI21=172, NAND2=92, NOR2=80, INV=40)),
    dict(id="D1", n=5, start="dcnt_reg_0_", end="text_out_reg_96_", via="out_dec", group="output decode", ref=1007.07,
         mix=dict(DFF=86, BUF=22, AOI21=20, OAI21=16, NAND2=212, NOR2=196, INV=96)),
    dict(id="D2", n=4, start="dcnt_reg_3_", end="text_out_reg_33_", via="out_dec", group="output decode", ref=1005.85,
         mix=dict(DFF=86, BUF=24, AOI21=18, OAI21=16, NAND2=204, NOR2=190, INV=92)),
    dict(id="D3", n=3, start="dcnt_reg_0_", end="done_reg", via="out_dec", group="output decode", ref=1005.17,
         mix=dict(DFF=84, BUF=24, AOI21=20, OAI21=18, NAND2=192, NOR2=182, INV=88)),
    dict(id="E1", n=3, start="u0/r0/out_reg_27_", end="u0/w_reg_0__27_", via="u0/r0", group="round constant", ref=1006.00,
         mix=dict(DFF=80, BUF=80, XOR2=70, MUX2I=70, AOI21=80, OAI21=70, NAND2=100, NOR2=90, INV=50)),
    dict(id="F1", n=3, start="text_in_r_reg_5_", end="sa30_reg_5_", via="in_xbar", group="input crossbar", ref=986.00,
         mix=dict(DFF=84, BUF=10, INV=60, AND2=150, OR2=140, NAND3=120, AOI22=110)),
]

# The order families appear along a path of each group (round-robin), after the launching flop.
GROUP_ORDER = {
    "S-box / MixColumns": ["BUF", "XNOR3", "XOR2", "AOI21", "NAND2", "MUX2I", "INV"],
    "key expansion": ["BUF", "XOR2", "MUX2I", "XNOR3", "NAND2", "AOI21", "INV"],
    "load / round control": ["INV", "NAND2", "AOI21", "OAI21", "NOR2", "BUF"],
    "output decode": ["NAND2", "NOR2", "INV", "AOI21", "OAI21", "BUF"],
    "round constant": ["BUF", "XOR2", "MUX2I", "AOI21", "OAI21", "NAND2", "NOR2", "INV"],
    "input crossbar": ["BUF", "AND2", "OR2", "NAND3", "AOI22", "INV"],
}

OVER_PS = UNCERTAINTY_PS + SETUP_PS
CRITICAL_WINDOW_PS = 30.0   # HimaTime's estimate weights paths within this window of the worst
WEIGHT_POWER = 4
MAX_FAMILIES_PER_ROUND = 2


def canonical_family(word):
    """The family a requirement means, or None when AndesCell has no template for it."""
    if not isinstance(word, str):
        return None
    key = word.strip().upper().replace(" ", "")
    for suffix in ("_X1", "_X2", "_X4", "X1", "X2", "X4"):
        if key.endswith(suffix) and key[: -len(suffix)] in FAMILIES:
            key = key[: -len(suffix)]
    key = ALIASES.get(key, key)
    return key if key in FAMILIES else None


def critical_families():
    """Families with cell delay on at least one of the 20 worst paths."""
    seen = []
    for path in PATHS:
        for family in path["mix"]:
            if family not in seen:
                seen.append(family)
    return seen


def path_delay(path, speed):
    """Path delay (ps) with `speed` = {family: fractional cell-delay reduction}."""
    return path["ref"] - sum(speed.get(f, 0.0) * a for f, a in path["mix"].items())


def net_delay(path):
    return path["ref"] - OVER_PS - sum(path["mix"].values())


def slack_ps(path, speed):
    return CLOCK_PERIOD_NS * 1000.0 - path_delay(path, speed)


def timing(speed):
    """WNS/TNS/Fmax of the design for a library speed map."""
    slacks = [(p, slack_ps(p, speed)) for p in PATHS]
    wns = min(s for _, s in slacks)
    tns = sum(p["n"] * min(0.0, s) for p, s in slacks)
    violating = sum(p["n"] for p, s in slacks if s < 0)
    period = CLOCK_PERIOD_NS
    wns_ns = round(wns / 1000.0, 4)
    fmax = round(1000.0 / (period - wns_ns), 2)
    return dict(wnsNs=wns_ns, tnsNs=round(tns / 1000.0, 3), fmaxMhz=fmax, violatingEndpoints=violating,
                slacks={p["id"]: round(s / 1000.0, 4) for p, s in slacks})


def weights(speed):
    wns = min(slack_ps(p, speed) for p in PATHS)
    span = CRITICAL_WINDOW_PS + max(-wns, 0.0)
    out = {}
    for p in PATHS:
        s = slack_ps(p, speed)
        out[p["id"]] = max(0.0, min(1.0, (CRITICAL_WINDOW_PS - s) / span)) ** WEIGHT_POWER
    return out


def recovery_ns(speed, family, fraction=None):
    """HimaTime's estimate of endpoint-slack recovery (ns, criticality-weighted) if `family` got
    `fraction` (default: the AndesCell-class speed-up) faster, on top of `speed`."""
    if family in speed:
        return 0.0
    fraction = FAMILIES[family]["speedup"] if fraction is None else fraction
    w = weights(speed)
    total = sum(w[p["id"]] * p["n"] * fraction * p["mix"].get(family, 0.0) for p in PATHS)
    return round(total / 1000.0, 3)


def breakdown(speed):
    """Per-family stage table over the 20 worst paths."""
    rows = []
    total_path = sum(path_delay(p, speed) for p in PATHS)
    worst = min(PATHS, key=lambda p: slack_ps(p, speed))
    for family in critical_families():
        stages = sum(len(split(p["mix"][family], FAMILIES[family]["typPs"])) for p in PATHS if family in p["mix"])
        cell = sum(p["mix"][family] * (1 - speed.get(family, 0.0)) for p in PATHS if family in p["mix"])
        on = sum(1 for p in PATHS if family in p["mix"])
        worst_share = 100.0 * worst["mix"].get(family, 0.0) * (1 - speed.get(family, 0.0)) / path_delay(worst, speed)
        rows.append(dict(family=family, stages=stages, cellDelayPs=round(cell, 1), sharePct=round(100.0 * cell / total_path, 2),
                         onPaths=on, worstPathSharePct=round(worst_share, 2), generated=family in speed,
                         estRecoveryNs=recovery_ns(speed, family), achievableSpeedupPct=round(100 * FAMILIES[family]["speedup"])))
    rows.sort(key=lambda r: (-r["estRecoveryNs"], -r["cellDelayPs"]))
    net = sum(net_delay(p) for p in PATHS)
    return rows, dict(netDelayPs=round(net, 1), netSharePct=round(100.0 * net / total_path, 2),
                      overheadPs=OVER_PS * len(PATHS), worstPath=worst["id"])


def split(total, typ):
    """Stage delays (ps) a family's total on one path is made of: deterministic, summing to total."""
    k = max(1, int(round(total / float(typ))))
    raw = [1.0 + 0.10 * (((j * 7 + int(total)) % 5) - 2) / 2.0 for j in range(k)]
    scale = total / sum(raw)
    out = [round(r * scale, 2) for r in raw]
    out[-1] = round(total - sum(out[:-1]), 2)
    return out


def _num(seed, mod):
    return int(hashlib.sha256(seed.encode()).hexdigest()[:8], 16) % mod


def stages(path, speed, new_cells=None):
    """The path as a list of stage dicts, launching flop first. new_cells: family -> cell name."""
    new_cells = new_cells or {}
    order = GROUP_ORDER[path["group"]]
    queues = {f: split(path["mix"][f], FAMILIES[f]["typPs"]) for f in path["mix"] if f != "DFF"}
    seq = [("DFF", path["mix"]["DFF"])]
    while any(queues.values()):
        for family in order:
            if queues.get(family):
                seq.append((family, queues[family].pop(0)))
    net_total = net_delay(path)
    weights_ = [1.0 + 0.6 * ((i * 5 + len(path["id"])) % 4) / 3.0 for i in range(len(seq))]
    nets = [net_total * w / sum(weights_) for w in weights_]
    out = []
    nets = [round(n, 2) for n in nets]
    cells_total = sum(round(d * (1 - speed.get(f, 0.0)), 2) for f, d in seq)
    nets[-1] = round(path_delay(path, speed) - OVER_PS - cells_total - sum(nets[:-1]), 2)
    for i, ((family, delay), net) in enumerate(zip(seq, nets)):
        info = FAMILIES[family]
        stock_cell = info["cells"][(i + _num(path["id"], 3)) % len(info["cells"])]
        if family == "DFF":
            inst = path["start"]
        else:
            inst = "%s/U%d" % (path["via"], 100 + _num(path["id"] + str(i), 9000))
        cell = new_cells.get(family, stock_cell) if family in speed else stock_cell
        d = delay * (1 - speed.get(family, 0.0))
        fanout = 1 + _num(path["id"] + "fo" + str(i), 4) + (3 if family == "BUF" else 0)
        out.append(dict(instance=inst, pin=info["out"], cell=cell, family=family, cellDelayPs=round(d, 2),
                        netDelayPs=round(net, 2), fanout=fanout, transPs=round(12 + 4.5 * fanout + d * 0.18, 1),
                        capFf=round(0.9 + 0.75 * fanout, 2), edge="r" if (i + _num(path["id"], 2)) % 2 == 0 else "f"))
    return out


def area(speed, families_used):
    """Cell area (um^2), instance count and new-cell instances for a build that may use the
    generated families in `families_used` (family -> list of usable new cell names)."""
    a = sum(f["instances"] * f["areaUm2"] for f in FAMILIES.values()) + EXTRA_AREA_UM2
    inst = 18400
    by_cell = {}
    for family, cells in families_used.items():
        info = FAMILIES[family]
        used = int(round(info["instances"] * info["adopt"]))
        if used == 0 or not cells:
            continue
        a += used * info["areaUm2"] * (info["areaRatio"] - 1.0)
        if family == "BUF":
            inst -= int(round(used * 0.15))
        # split the adopted instances over the usable variants (the higher drive gets the rest)
        share = used // len(cells)
        for j, cell in enumerate(sorted(cells)):
            by_cell[cell] = share + (used - share * len(cells) if j == len(cells) - 1 else 0)
    return round(a, 1), inst, by_cell
