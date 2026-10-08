"""Synthetic inputs for the example insight rules: facts files, a timing report, netlists.

Every name and number here is invented (INVX1, NAND2X2, NOR3X1, DFFRX1, u1/U12, demo_top). The library uses
ns / pF / pW units so the rules' scaling to ps / fF / nW is exercised. Delay tables follow a simple model,
delay = k x (p + a x slew + R x load), so a test can compute the expected number by hand: bilinear interpolation of a
table that is linear in both axes is exact, also on the non-uniform axes used here.
"""
import gzip
import json
import os

SLEWS = [0.004, 0.008, 0.016, 0.032, 0.064, 0.128, 0.256]          # ns, non-uniform
LOADS = [0.0005, 0.001, 0.002, 0.004, 0.008, 0.016, 0.032, 0.064]   # pF, non-uniform
TEMPLATE = "delay_7x8"


def table(kind, p, a, r, k, slews=SLEWS, loads=LOADS, bump=None):
    """A cell_* or *_transition table in ns over (slew ns, load pF): k (p + a s + r c); `bump` = (i, j, ns) adds a
    glitch at one point."""
    vals = []
    for i, s in enumerate(slews):
        for j, c in enumerate(loads):
            v = k * (p + a * s + r * c)
            if bump and bump[0] == i and bump[1] == j:
                v += bump[2]
            vals.append(round(v, 9))
    return {"kind": kind, "sigma": "", "template": TEMPLATE, "index": [list(slews), list(loads)], "values": vals}


def arc(src, p, r, k=1.0, a=0.0, ttype="combinational", bump=None, when=""):
    """A timing group from `src`: delay p ns + r ns/pF x load (+ a x slew), transition 0.6 p + 1.8 r x load."""
    return {"related_pin": src, "timing_type": ttype, "timing_sense": "non_unate", "when": when, "sdf_cond": "",
            "tables": [table("cell_rise", p, a, r, k, bump=bump), table("cell_fall", 0.9 * p, a, 0.9 * r, k),
                       table("rise_transition", 0.6 * p, 0.05, 1.8 * r, k),
                       table("fall_transition", 0.5 * p, 0.05, 1.6 * r, k)]}


def pin(name, direction, cap=0.0, function=None, clock=False, timing=(), nextstate=None):
    attrs = {}
    if function:
        attrs["function"] = function
    if nextstate:
        attrs["nextstate_type"] = nextstate
    return {"name": name, "direction": direction, "is_clock": clock, "is_bus": False, "is_bus_bit": False,
            "cap": cap, "attrs": attrs, "timing": list(timing), "internal_power": []}


def comb(name, inputs, function, drive, p, k=1.0, a=0.0, r0=4.0, cap0=0.0012, area0=0.5, leak0=20.0,
         arc_p=None, out="Y", bump=None, r=None):
    """A combinational cell; R = r0 / drive (ns/pF), input cap = cap0 x drive (pF), leakage pW."""
    r = r0 / drive if r is None else r
    arcs = [arc(x, (arc_p or {}).get(x, p), r, k, a, bump=bump if x == inputs[0] else None) for x in inputs]
    return {"name": name, "area": round(area0 * (1 + drive / 2.0), 6), "footprint": name,
            "flags": {"dff": False, "latch": False, "clock_gating": False, "icg": False, "memory": False},
            "attrs": {"cell_leakage_power": leak0 * drive},
            "leakage": [{"when": "", "value": leak0 * drive, "related_pg_pin": "VDD"}],
            "pg_pins": [{"name": "VDD", "pg_type": "primary_power", "attrs": {}},
                        {"name": "VSS", "pg_type": "primary_ground", "attrs": {}}],
            "pins": [pin(x, "input", cap0 * drive) for x in inputs] + [pin(out, "output", 0.0, function, timing=arcs)],
            "sequential": [], "other_groups": {}}


def flop(name, drive, clear=None, preset=None, p=0.03, k=1.0, scan=False):
    """A rising-edge flop D/CK -> Q with optional clear/preset (on RN/SN), state IQ/IQN."""
    r = 4.0 / drive
    timing = [arc("CK", p, r, k, ttype="rising_edge")]
    pins = [pin("D", "input", 0.0010), pin("CK", "input", 0.0009, clock=True)]
    attrs = {"clocked_on": "CK", "next_state": "D"}
    if scan:
        pins += [pin("SI", "input", 0.0008, nextstate="scan_in"), pin("SE", "input", 0.0009, nextstate="scan_enable")]
        attrs["next_state"] = "(D&!SE)|(SI&SE)"
    if clear:
        pins.append(pin("RN", "input", 0.0008))
        attrs["clear"] = clear
        timing.append(arc("RN", p * 0.8, r, k, ttype="clear"))
    if preset:
        pins.append(pin("SN", "input", 0.0008))
        attrs["preset"] = preset
        timing.append(arc("SN", p * 0.8, r, k, ttype="preset"))
    pins.append(pin("Q", "output", 0.0, "IQ", timing=timing))
    return {"name": name, "area": round(2.0 + drive, 6), "footprint": name,
            "flags": {"dff": True, "latch": False, "clock_gating": False, "icg": False, "memory": False},
            "attrs": {"cell_leakage_power": 50.0 * drive},
            "leakage": [{"when": "", "value": 50.0 * drive, "related_pg_pin": "VDD"}],
            "pg_pins": [], "pins": pins,
            "sequential": [{"type": "ff", "names": ["IQ", "IQN"], "attrs": attrs}], "other_groups": {}}


def write_facts(path, cells, voltage=0.9, temperature=25.0, process_name="tt", name="demo_lib"):
    record = {
        "schema": "lib-insight-facts/1",
        "source": {"path": "/synthetic/%s.lib" % name, "bytes": 1, "sha256": "cd" * 32},
        "producer": {"api": "synthetic-test", "schema": "lib-insight-facts/1"},
        "started": "2026-10-08T12:00:00+0000", "timing": {"counts": {"cells": len(cells)}}, "status": "ok",
        "library": {
            "name": name,
            "units": {"time_s": 1e-09, "cap_F": 1e-12, "res_ohm": 1000.0, "voltage_V": 1.0, "current_A": 1e-06,
                      "leakage_W": 1e-12, "dynamic_W": 1e-15},
            "attrs": {"time_unit": "1ns", "capacitive_load_unit": [1, "pf"], "leakage_power_unit": "1pW"},
            "operating_conditions": [{"name": "%s_%gv_%gc" % (process_name, voltage, temperature),
                                      "attrs": {"voltage": voltage, "temperature": temperature, "process": 1}}],
            "templates": [{"type": "lu_table_template", "name": TEMPLATE,
                           "variables": ["input_net_transition", "total_output_net_capacitance"],
                           "index": [[True, SLEWS], [True, LOADS]]}],
            "other_groups": {}, "cells": cells},
        "finished": "2026-10-08T12:00:01+0000"}
    parent = os.path.dirname(path)
    if parent and not os.path.isdir(parent):
        os.makedirs(parent)
    with gzip.open(path, "wt") as stream:
        json.dump(record, stream, separators=(",", ":"))
    return path


# ---------------------------------------------------------------- vmin

VMIN_K = {(0.81, -40.0): 1.0, (0.72, -40.0): 1.30, (0.81, 125.0): 1.0, (0.72, 125.0): 1.20}
VMIN_EXTRA = {"NOR3X1": {-40.0: 1.12, 125.0: 1.04}, "NAND2X1": {-40.0: 1.03, 125.0: 1.06}}


def vmin_cells(voltage, temperature, suffix=""):
    """Inverters, a NAND2 ladder and NOR3 cells. At the low supply every cell slows like the inverter, except the
    planted ones: NOR3X1 +12 % at -40 °C (+4 % at 125 °C), NAND2X1 +3 % / +6 % (below the 5 % watch level at -40 °C,
    above it at 125 °C)."""
    base = VMIN_K[(voltage, temperature)]

    def k(name):
        if voltage == 0.72 and name in VMIN_EXTRA:
            return base * VMIN_EXTRA[name][temperature]
        return base
    cells = [comb("INVX%s%s" % (d, suffix), ["A"], "!A", float(d), 0.006, k("INVX%s" % d)) for d in (1, 2, 4)]
    cells += [comb("NAND2X%s%s" % (d, suffix), ["A", "B"], "!(A&B)", float(d), 0.009, k("NAND2X%s" % d),
                   arc_p={"B": 0.010}) for d in (1, 2)]
    cells += [comb("NOR3X%s%s" % (d, suffix), ["A", "B", "C"], "!(A|B|C)", float(d), 0.012, k("NOR3X%s" % d),
                   arc_p={"A": 0.016, "B": 0.014}) for d in (1, 2)]
    return cells


def write_vmin_corpus(root):
    """Four corner files of one variant: 0.81 V and 0.72 V at -40 °C and 125 °C. Returns [(label, path)]."""
    out = []
    for (v, t) in sorted(VMIN_K):
        path = os.path.join(root, "vmin_%gv_%gc.json.gz" % (v, t))
        write_facts(path, vmin_cells(v, t), v, t, "ss")
        out.append(("9T-SVT", path))
    return out


NOR3_SPICE = """* synthetic transistor netlist
.subckt NOR3X1 A B C Y VDD VSS
MP1 n1 A VDD VDD pch w=0.4u l=0.03u
MP2 n2 B n1 VDD pch w=0.4u l=0.03u
MP3 Y C n2 VDD pch w=0.4u l=0.03u
MN1 Y A VSS VSS nch w=0.2u l=0.03u
MN2 Y B VSS VSS nch w=0.2u l=0.03u
MN3 Y C VSS VSS nch w=0.2u l=0.03u
.ends
.subckt NOR3X2 A B C Y VDD VSS
MP1 n1 A VDD VDD pch w=0.4u l=0.03u nf=2
MP2 n2 B n1 VDD pch w=0.8u l=0.03u
MP3 Y C n2 VDD pch w=0.8u
+ l=0.03u
MN1 Y A VSS VSS nch w=0.2u l=0.03u
MN1_2 Y A VSS VSS nch w=0.2u l=0.03u
MN2 Y B VSS VSS nch w=0.4u l=0.03u
MN3 Y C VSS VSS nch w=0.4u l=0.03u
.ends
"""


# ---------------------------------------------------------------- gaps

GAP_DRIVES = [1, 1.5, 2, 3, 4, 8, 10, 12]        # the missing size sits between 4 and 8


def gap_cells(suffix=""):
    cells = [comb("INVX%s%s" % (d, suffix), ["A"], "!A", float(d), 0.006) for d in (1, 2, 4)]
    for d in GAP_DRIVES:
        tok = ("%g" % d).replace(".", "P")
        cells.append(comb("NAND2X%s%s" % (tok, suffix), ["A", "B"], "!(A&B)", float(d), 0.009, cap0=0.0015))
    for d in (1, 2, 3, 4, 6, 8):                  # a complete ladder: no gap
        cells.append(comb("NOR2X%d%s" % (d, suffix), ["A", "B"], "!(A|B)", float(d), 0.010))
    return cells


# ---------------------------------------------------------------- spikes

SPIKE_AT = (3, 3, 0.012)          # NAND2X1 A->Y cell_rise: +12 ps at slew index 3, load index 3


def spike_cells():
    cells = [comb("INVX%d" % d, ["A"], "!A", float(d), 0.006) for d in (1, 2)]
    cells.append(comb("NAND2X1", ["A", "B"], "!(A&B)", 1.0, 0.009, a=0.2, bump=SPIKE_AT))
    cells.append(comb("NAND2X2", ["A", "B"], "!(A&B)", 2.0, 0.009, a=0.2))
    return cells


def noisy_cells():
    """Six NAND2 sizes whose tables all wobble at the same point by different amounts: their own spread sets the
    noise floor there."""
    bumps = [0.012, -0.010, 0.008, -0.006, 0.004, -0.003]
    return [comb("NAND2X%d" % (k + 1), ["A", "B"], "!(A&B)", float(k + 1), 0.009, a=0.2, bump=(3, 3, b))
            for k, b in enumerate(bumps)]


# ---------------------------------------------------------------- critical path

def path_cells(vt):
    """One VT of a 9-track library at tt. NAND2: at a heavy load the X4 cells win, at fanout-of-4 the X1 LVT wins."""
    sfx = "" if vt == "SVT" else "_" + vt
    lvt = vt == "LVT"
    cells = [comb("INVX%d%s" % (d, sfx), ["A"], "!A", float(d), 0.005 if lvt else 0.006, a=0.1) for d in (1, 2, 4)]
    # (drive, intrinsic ns, R ns/pF): X1 SVT 12 ps + 2.0 ps/fF; X1 LVT 8 + 1.8; X4 SVT 20 + 0.5; X4 LVT 17 + 0.45
    spec = {("SVT", 1): (0.012, 2.0), ("LVT", 1): (0.008, 1.8), ("SVT", 4): (0.020, 0.5), ("LVT", 4): (0.017, 0.45)}
    for d in (1, 4):
        p, r = spec[(vt, d)]
        cells.append(comb("NAND2X%d%s" % (d, sfx), ["A", "B"], "!(A&B)", float(d), p, a=0.1, r=r, cap0=0.0015))
    cells.append(flop("DFFRX1" + sfx, 1.0, clear="!RN", p=0.040 if lvt else 0.045))
    if vt == "SVT":
        cells.append(flop("DFFRX4", 4.0, clear="!RN", p=0.050))          # same function, other size: grouped
        cells.append(flop("DFFRX2", 2.0, preset="!RN", p=0.030))         # same name stem, other function: not grouped
        cells.append(flop("DFFQX1", 1.0, clear="!RN", p=0.042))          # other stem, same function: grouped
    return cells


def _report_table(rows, with_op):
    head = ["Pin", "Edge", "Net", "Cell", "Delay"] + (["Slew", "Load"] if with_op else []) + ["Arrival", "Required"]
    sub = ["", "", "", "", ""] + (["", ""] if with_op else []) + ["Time", "Time"]
    body = []
    for r in rows:
        cells = [r[0], r[1], r[2], r[3], r[4]] + ([r[5], r[6]] if with_op else []) + [r[7], r[8]]
        body.append(cells)
    widths = [max(len(str(x[k])) for x in [head, sub] + body) for k in range(len(head))]

    def line(vals):
        return "     | " + " | ".join(str(v).ljust(w) for v, w in zip(vals, widths)) + " | "
    rule = "     +" + "-".join("-" * (w + 2) for w in widths) + "+ "
    sep = "     |" + "+".join("-" * (w + 2) for w in widths) + "| "
    return [rule, line(head), line(sub), sep] + [line(b) for b in body] + [rule]


# rows: pin, edge, net, cell, delay ns, slew ns, load pF, arrival, required
PATH1 = [("clk", "^", "clk", "", "", "", "", "0.000", "-0.020"),
         ("r1/CK", "^", "clk", "DFFRX1", "0.000", "0.010", "", "0.000", "-0.020"),
         ("r1/Q", "v", "n1", "DFFRX1", "0.045", "", "0.0030", "0.045", "0.025"),
         ("U11/A", "v", "n1", "INVX1", "0.001", "0.012", "", "0.046", "0.026"),
         ("U11/Y", "^", "n2", "INVX1", "0.012", "", "0.0030", "0.058", "0.038"),
         ("U12/A", "^", "n2", "NAND2X1", "0.000", "0.020", "", "0.058", "0.038"),
         ("U12/Y", "v", "n5", "NAND2X1", "0.074", "", "0.0300", "0.132", "0.112"),
         ("u1/U13/A", "v", "u1/a", "NAND2X4", "0.001", "0.030", "", "0.133", "0.113"),
         ("u1/U13/Y", "^", "u1/y", "NAND2X4", "0.020", "", "0.0020", "0.153", "0.133"),
         ("r2/D", "^", "n6", "DFFRX1", "0.000", "0.015", "", "0.153", "0.133")]
PATH2 = [("clk", "^", "clk", "", "", "", "", "0.000", "0.000"),
         ("r3/CK", "^", "clk", "DFFRX1", "0.000", "0.010", "", "0.000", "0.000"),
         ("r3/Q", "^", "n7", "DFFRX1", "0.045", "", "0.0030", "0.045", "0.035"),
         ("U16/A", "^", "n7", "INVX1", "0.000", "0.012", "", "0.045", "0.035"),
         ("U16/Y", "v", "n8", "INVX1", "0.010", "", "0.0020", "0.055", "0.045"),
         ("r4/D", "v", "n8", "DFFRX1", "0.000", "0.010", "", "0.055", "0.045")]


def write_report(path, with_op=True):
    """A timing report in the report_timing table format (ns, pF), two violating paths, worst first."""
    out = ["###############################################################",
           "#  Generated by:      Demo Timer 1.0",
           "#  Design:            demo_top",
           "#  Command:           report_timing",
           "###############################################################"]
    for n, (rows, slack, start, end) in enumerate(((PATH1, "-0.020", "r1/Q", "r2/D"),
                                                   (PATH2, "-0.010", "r3/Q", "r4/D")), 1):
        out += ["Path %d: VIOLATED Setup Check with Pin %s/CK " % (n, end.split("/")[0]),
                "Endpoint:   %s (^) checked with  leading edge of 'clk'" % end,
                "Beginpoint: %s (v) triggered by  leading edge of 'clk'" % start,
                "Path Groups: {reg2reg}", "Analysis View: view_demo",
                "Other End Arrival Time          0.000", "- Setup                         0.010",
                "+ Phase Shift                   0.150", "= Required Time                 0.140",
                "- Arrival Time                  0.160", "= Slack Time                   %s" % slack,
                "     Clock Rise Edge                      0.000", "     Timing Path:"]
        out += _report_table(rows, with_op)
        out += ["     Other End Path:"] + _report_table(rows[:2], with_op)
    with gzip.open(path, "wt") as stream:
        stream.write("\n".join(out) + "\n")
    return path


NETLIST = """// synthetic gate-level netlist
module blk ( a, y, b );
  input a;
  output y;
  input [1:0] b;
  NAND2X4 U13 ( .A(a), .B(b[0]), .Y(y) );
  INVX4 U17 ( .A(b[1]), .Y() );
endmodule

module demo_top ( clk, rn, out );
  input clk, rn;
  output out;
  wire n1, n2, n5, n6, n7, n8;
  wire [3:0] bus;
  DFFRX1 r1 ( .D(n6), .CK(clk), .RN(rn), .Q(n1) );
  INVX1 U11 ( .A(n1), .Y(n2) );
  NAND2X1 U12 ( .A(n2), .B(rn), .Y(n5) );
  assign bus[2] = n5;
  blk u1 ( .a(n5), .y(n6), .b({bus[2], rn}) );
  INVX4 U14 ( .A(n5), .Y(out) );
  DFFRX1 r2 ( .D(n6), .CK(clk), .RN(rn), .Q() );
  DFFRX1 r3 ( .D(n8), .CK(clk), .RN(rn), .Q(n7) );
  INVX1 U16 ( .A(n7), .Y(n8) );
  DFFRX1 r4 ( .D(n8), .CK(clk), .RN(rn), .Q() );
endmodule
"""
# n5 drives: u1/U13.A (NAND2X4, 6.0 fF), u1/U17.A through b[1] = bus[2] (INVX4, 4.8 fF), U14.A (INVX4, 4.8 fF)
NETLIST_N5_LOAD = 6.0 + 4.8 + 4.8


def write_text(path, text):
    with open(path, "w") as stream:
        stream.write(text)
    return path
