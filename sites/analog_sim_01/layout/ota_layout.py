#!/usr/bin/env python3
"""Layout of the analog-ota-migrate Pack's two-stage Miller OTA in GF180MCU (python3 >= 3.9, stdlib).

Runs inside the open-source tool image (Magic, netgen, KLayout and /foss/pdks/gf180mcuD):

  ota_layout.py all <design.json> <out_dir> [<pack_flow_dir>]

From the Pack's design file it writes, in <out_dir>:
  ota.tcl / ota.mag / ota.gds   the cell, drawn by this script in Magic's abstract GF180 layers
                                 (every MOS at the design's W and L, split into equal fingers on the
                                 0.005 um grid; Rz as a ppolyf_u resistor; Cc as a MIM capacitor);
  ota_ref.spice                  the schematic: the Pack's own device lines (nets, models, W, L from
                                 ota_cli.py) with Rz and Cc as the PDK devices that layout draws;
  drc_magic.txt                  Magic DRC (the PDK's Magic tech file) on the drawn cell;
  drc_klayout_block.lyrdb/.txt   KLayout DRC with the PDK's own deck (gf180mcu.drc, variant D), every
                                 deck but the die-level density coverage; drc_klayout_density.* the
                                 density decks alone (a block fails them until the die is filled);
  ota_lvs.spice, lvs.out         extraction from the GDS and netgen LVS with the PDK's setup file;
  ota_pex_c.spice                extraction from the GDS with parasitic C (ext2spice cthresh 0);
  ota_pex_rc.spice               the same with parasitic R (extresist, every net, simplify off);
  ota.png                        a KLayout render with the PDK's layer colours;
  layout.json                    the facts: device sizes drawn, check counts, LVS result, step times.

Pins (metal3, at the left end of the routing channel): vdd, vss, inp, inn, out, ibias (the Pack's
nbias node, fed by the bias current source). Sizes are nm on the 5 nm manufacturing grid.
"""
import json
import math
import os
import re
import subprocess
import sys
import time
from pathlib import Path

PDK = os.environ.get("PDK_ROOT", "/foss/pdks") + "/gf180mcuD"
MAGICRC = PDK + "/libs.tech/magic/gf180mcuD.magicrc"
NETGEN_SETUP = PDK + "/libs.tech/netgen/gf180mcuD_setup.tcl"
KLAYOUT_TECH = PDK + "/libs.tech/klayout/tech"
GRID = 5                         # nm
PAD = 195                        # half width of a via landing pad (390 nm: via1 + 65 nm on m1/m2)
TRACK_W, TRACK_PITCH = 500, 1000 # channel tracks on metal3
ROW_GAP = 1000                   # between device keep-out boxes in a row
RING_GAP = 400                   # from the row's keep-out box to the inner edge of its tap ring metal
RING_DIFF, RING_M1 = 360, 380

# The Pack's OTA (ota_cli.py NETS): name -> (drain, gate, source, bulk); vss is the Pack's node 0.
NETS = {"M1": ("x", "inn", "tail", "vss"), "M2": ("y", "inp", "tail", "vss"), "M3": ("x", "x", "vdd", "vdd"),
        "M4": ("y", "x", "vdd", "vdd"), "M5": ("tail", "nbias", "vss", "vss"), "M6": ("out", "y", "vdd", "vdd"),
        "M7": ("out", "nbias", "vss", "vss"), "M8": ("nbias", "nbias", "vss", "vss")}
KIND = {"M1": "nmos", "M2": "nmos", "M3": "pmos", "M4": "pmos", "M5": "nmos", "M6": "pmos", "M7": "nmos", "M8": "nmos"}
MODEL = {"nmos": "nfet_03v3", "pmos": "pfet_03v3"}
PINS = {"vdd": "vdd", "vss": "vss", "inp": "inp", "inn": "inn", "out": "out", "nbias": "ibias"}
TRACKS = ["vss", "nbias", "tail", "inn", "inp", "x", "y", "cz", "out", "vdd"]   # bottom to top
NROW = ["M8", "M5", "M1", "M2", "M7"]
PROW = ["M3", "M4", "M6"]
MAX_FINGER_NM = 18000
RES_TOLERANCE = "0.000001"    # with simplify off: every net's resistance network, not only the large ones

# ppolyf_u (sm141064.spice): R = rsh * L / (W - 2 dw) + 2 * rsh_t * 1um / (W - 2 dw), at tt
RSH_PPOLY, RSH_PPOLY_T, DW_PPOLY = 350.0, 60.0, 0.0255
# cap_mim_2f0_m4m5_noshield (sm141064_mim.spice): C = 1.99 fF/um2 * area + 0.2383 fF/um * perimeter
C_AREA, C_PERI = 1.99e-15, 0.2383e-15


class Error(Exception):
    pass


def snap(nm):
    return int(round(nm / GRID)) * GRID


def um(nm):
    return "%.3fum" % (nm / 1000.0)


# ---------------------------------------------------------------- device sizes

def fingers(w_nm):
    """Equal fingers of at most MAX_FINGER_NM, each on the grid: the smallest such count."""
    units = w_nm // GRID
    if units * GRID != w_nm:
        raise Error("W %d nm is off the %d nm grid" % (w_nm, GRID))
    for nf in range(1, units + 1):
        if units % nf == 0 and w_nm // nf <= MAX_FINGER_NM:
            return nf, w_nm // nf
    raise Error("no finger split for W %d nm" % w_nm)


def rz_geometry(r_ohm, w_nm=1000):
    """The ppolyf_u body length (on a 10 nm step) for the design's Rz at width w_nm."""
    weff = w_nm / 1000.0 - 2 * DW_PPOLY
    l_um = (r_ohm - 2 * RSH_PPOLY_T / weff) * weff / RSH_PPOLY
    l_nm = int(round(l_um * 100)) * 10
    if l_nm < 1000:
        raise Error("Rz %.1f Ohm needs a ppolyf_u shorter than 1 um" % r_ohm)
    return w_nm, l_nm, RSH_PPOLY * (l_nm / 1000.0) / weff + 2 * RSH_PPOLY_T / weff


def cc_geometry(c_f):
    """A square MIM plate (10 nm step) for the design's Cc."""
    a, b, c = C_AREA, 4 * C_PERI, -c_f
    s_um = (-b + math.sqrt(b * b - 4 * a * c)) / (2 * a)
    s_nm = max(5000, int(round(s_um * 100)) * 10)
    s = s_nm / 1000.0
    return s_nm, C_AREA * s * s + C_PERI * 4 * s


# ---------------------------------------------------------------- drawing

class Cell:
    def __init__(self):
        self.tcl = []
        self.rects = []

    def paint(self, layer, x1, y1, x2, y2):
        x1, x2 = sorted((x1, x2))
        y1, y2 = sorted((y1, y2))
        for v in (x1, y1, x2, y2):
            if v % GRID:
                raise Error("%s edge %s is off the %d nm grid" % (layer, v, GRID))
        if x2 <= x1 or y2 <= y1:
            raise Error("empty %s rectangle %s" % (layer, (x1, y1, x2, y2)))
        self.tcl.append("box %s %s %s %s" % (um(x1), um(y1), um(x2), um(y2)))
        self.tcl.append("paint %s" % layer)
        self.rects.append((layer, x1, y1, x2, y2))

    def label(self, text, layer, x1, y1, x2, y2, port=None):
        self.tcl.append("box %s %s %s %s" % (um(x1), um(y1), um(x2), um(y2)))
        self.tcl.append("label %s c %s" % (text, layer))
        if port is not None:
            self.tcl.append("port make %d" % port)
            self.tcl.append("port use %s" % ("power" if text == "vdd" else "ground" if text == "vss" else "signal"))
            self.tcl.append("port class %s" % ("output" if text == "out" else "inout" if text in ("vdd", "vss") else "input"))


class Frame:
    """Local device coordinates to the cell: x + ox, and y + oy (or oy - y when flipped)."""

    def __init__(self, cell, ox, oy, flip):
        self.cell, self.ox, self.oy, self.flip = cell, ox, oy, flip

    def y(self, y):
        return self.oy - y if self.flip else self.oy + y

    def paint(self, layer, x1, y1, x2, y2):
        self.cell.paint(layer, self.ox + x1, self.y(y1), self.ox + x2, self.y(y2))

    def point(self, x, y):
        return self.ox + x, self.y(y)


def via_stack(cell, x, y, top):
    """Vias from metal1 up to `top` (2 or 4) centred at (x, y), each metal with a landing pad."""
    cell.paint("metal1", x - PAD, y - PAD, x + PAD, y + PAD)
    cell.paint("via1", x - 130, y - 130, x + 130, y + 130)
    cell.paint("metal2", x - PAD, y - PAD, x + PAD, y + PAD)
    if top >= 3:
        cell.paint("via2", x - 140, y - 140, x + 140, y + 140)
        cell.paint("metal3", x - PAD, y - PAD, x + PAD, y + PAD)
    if top >= 4:
        cell.paint("via3", x - 140, y - 140, x + 140, y + 140)
        cell.paint("metal4", x - PAD, y - PAD, x + PAD, y + PAD)


class Mos:
    """A MOS of nf fingers of width wf and length l, drawn with its gate contacts on one side
    (the routing channel's) and its source/drain landing pads on the other. Local frame: diffusion
    from (0, 0) to (dw, wf); the gate head grows to +y, the source/drain pads sit below y = 0."""

    def __init__(self, name, kind, w_nm, l_nm):
        self.name, self.kind, self.l = name, kind, l_nm
        self.w = w_nm
        self.nf, self.wf = fingers(w_nm)
        l, nf = l_nm, self.nf
        self.dw = 2 * 440 + nf * l + (nf - 1) * 520
        self.gates = [440 + i * (l + 520) for i in range(nf)]
        self.strips = [180] + [g + l + 260 for g in self.gates[:-1]] + [self.dw - 180]
        if l // 2 + 260 >= 660:
            self.gx = self.gates[0] + (l // 2) // GRID * GRID
        else:
            self.gx = -500                       # short gates: the gate pad left of the diffusion
        self.x0 = min(180 - PAD, self.gx - PAD)
        self.x1 = self.dw - 180 + PAD
        self.y0, self.y1 = -520, self.wf + 840

    def draw(self, frame):
        n = self.kind == "nmos"
        diff, fet, dc = ("ndiff", "nfet", "ndc") if n else ("pdiff", "pfet", "pdc")
        l, wf = self.l, self.wf
        frame.paint(diff, 0, 0, self.dw, wf)
        pcs = []
        for g in self.gates:
            frame.paint(fet, g, 0, g + l, wf)
            frame.paint("poly", g, -220, g + l, 0)
            frame.paint("poly", g, wf, g + l, wf + 100)
            if l >= 360:
                pcs.append((g + 65, g + l - 65))
            else:
                c = g + (l // 2) // GRID * GRID
                pcs.append((c - 115, c + 115))
        bar_x0 = min(self.gates[0], pcs[0][0] - 65)
        bar_x1 = max(self.gates[-1] + l, pcs[-1][1] + 65)
        frame.paint("poly", bar_x0, wf + 100, bar_x1, wf + 525)
        for a, b in pcs:
            frame.paint("pc", a, wf + 230, b, wf + 460)
        frame.paint("metal1", min(pcs[0][0] - 55, self.gx - PAD), wf + 230, pcs[-1][1] + 55, wf + 460)
        frame.paint("metal1", self.gx - PAD, wf + 460, self.gx + PAD, wf + 840)
        for cx in self.strips:
            frame.paint(dc, cx - 115, 65, cx + 115, wf - 65)
            frame.paint("metal1", cx - 115, -520, cx + 115, wf - 10)
            frame.paint("metal1", cx - PAD, -520, cx + PAD, -140)

    def terminals(self, frame):
        """(net, x, y) of every landing pad: the gate pad and each source/drain pad."""
        d, g, s, _b = NETS[self.name]
        out = [(g,) + frame.point(self.gx, wf_pad(self.wf))]
        for j, cx in enumerate(self.strips):
            out.append(((s if j % 2 == 0 else d),) + frame.point(cx, -330))
        return out


def wf_pad(wf):
    return wf + 650


class Rpoly:
    """A ppolyf_u resistor lying along x: body (0, 0)-(l, w); contact heads at both ends with their
    landing pads above the body."""

    def __init__(self, w_nm, l_nm, nets):
        self.w, self.l, self.nets = w_nm, l_nm, nets
        self.x0, self.x1 = -1300, l_nm + 1300      # PRES.3 / PP.2: 0.6 um to COMP, 0.4 um pplus space
        self.y0, self.y1 = 0, w_nm + 400

    def draw(self, frame):
        w, l = self.w, self.l
        frame.paint("rpp", 0, 0, l, w)
        for a, b, c, d in ((-510, 0, -445, -215), (l, l + 510, l + 215, l + 445)):
            frame.paint("poly", a, 0, b, w)
            frame.paint("pc", c, 65, d, w - 65)
        for cx in (-330, l + 330):
            frame.paint("metal1", cx - 190, 10, cx + 190, w + 400)

    def terminals(self, frame):
        return [(self.nets[0],) + frame.point(-330, self.w + 210), (self.nets[1],) + frame.point(self.l + 330, self.w + 210)]


def tap_ring(cell, box, kind, open_side):
    """A substrate (psd) or well (nsd) tap ring around box = (x0, y0, x1, y1), the box being the
    inner edge of the ring metal. Contacts on every side but `open_side` ('top' or 'bottom'), where
    the routing crosses and the supply via lands. Returns the outer box of the ring metal."""
    x0, y0, x1, y1 = box
    sd, sc = ("psd", "psc") if kind == "p" else ("nsd", "nsc")
    t = RING_M1
    sides = {"left": (x0 - t, y0 - t, x0, y1 + t), "right": (x1, y0 - t, x1 + t, y1 + t),
             "bottom": (x0 - t, y0 - t, x1 + t, y0), "top": (x0 - t, y1, x1 + t, y1 + t)}
    for name, (a, b, c, d) in sides.items():
        cell.paint(sd, a + 10, b + 10, c - 10, d - 10)
    for name, (a, b, c, d) in sides.items():
        if name == open_side:
            continue
        if name in ("left", "right"):
            lo = y0 + 75 if open_side == "bottom" else b + 75
            hi = y1 - 75 if open_side == "top" else d - 75
            cell.paint(sc, a + 75, lo, c - 75, hi)
        else:
            cell.paint(sc, a + 75, b + 75, c - 75, d - 75)
    for a, b, c, d in sides.values():
        cell.paint("metal1", a, b, c, d)
    return (x0 - t, y0 - t, x1 + t, y1 + t)


def build(design):
    """Draw the OTA. Returns (cell, facts)."""
    cell = Cell()
    devs = {}
    for name in NROW + PROW:
        d = design["devices"][name]
        devs[name] = Mos(name, KIND[name], snap(d["wUm"] * 1000), snap(d["lUm"] * 1000))
        if abs(devs[name].w - d["wUm"] * 1000) > 0.01 or abs(devs[name].l - d["lUm"] * 1000) > 0.01:
            raise Error("%s W/L %s/%s um is off the 5 nm grid" % (name, d["wUm"], d["lUm"]))
    rw, rl, r_ohm = rz_geometry(design["rzKohm"] * 1000.0)
    cs, c_f = cc_geometry(design["ccPf"] * 1e-12)
    rz = Rpoly(rw, rl, ("y", "cz"))

    terms = []
    # NMOS row (and Rz): gate heads up at y = 0..840, diffusion below; y grows to the channel.
    x = 0
    nrow_box = [None, None, None, None]
    for name in NROW:
        m = devs[name]
        f = Frame(cell, x - m.x0, -m.wf, False)
        m.draw(f)
        terms += [(t, "n") for t in m.terminals(f)]
        bx = (x, -m.wf + m.y0, x + m.x1 - m.x0, m.y1 - m.wf)
        nrow_box = merge(nrow_box, bx)
        x = bx[2] + ROW_GAP
    f = Frame(cell, x - rz.x0, -rw, False)
    rz.draw(f)
    terms += [(t, "n") for t in rz.terminals(f)]
    nrow_box = merge(nrow_box, (x, -rw, x + rz.x1 - rz.x0, rz.y1 - rw))
    nring_in = grow(nrow_box, RING_GAP)
    nring = tap_ring(cell, nring_in, "p", "top")
    cell.paint("pwell", nring[0] - 110, nring[1] - 110, nring[2] + 110, nring[3] + 110)

    track_y = {net: nring[3] + TRACK_PITCH + i * TRACK_PITCH for i, net in enumerate(TRACKS)}
    chan_top = track_y[TRACKS[-1]] + TRACK_W // 2

    # PMOS row: diffusion above the channel, gate heads down toward it.
    pring_in_y0 = chan_top + 750 + RING_M1
    yp = pring_in_y0 + RING_GAP + 840              # bottom edge of the PMOS diffusions
    x = 0
    prow_box = [None, None, None, None]
    for name in PROW:
        m = devs[name]
        f = Frame(cell, x - m.x0, yp + m.wf, True)
        m.draw(f)
        terms += [(t, "p") for t in m.terminals(f)]
        bx = (x, yp - 840, x + m.x1 - m.x0, yp + m.wf + 520)
        prow_box = merge(prow_box, bx)
        x = bx[2] + ROW_GAP
    pring_in = grow(prow_box, RING_GAP)
    pring = tap_ring(cell, pring_in, "n", "bottom")
    cell.paint("nwell", pring[0] - 130, pring[1] - 130, pring[2] + 130, pring[3] + 130)

    # Cc: MIM (metal4 bottom plate = out, top plate = cz via metal5), right of the PMOS row.
    cx0 = pring[2] + 3000
    cy0 = pring[1] + 2500
    cell.paint("metal4", cx0 - 600, cy0 - 600, cx0 + cs + 600, cy0 + cs + 600)
    cell.paint("mimcap", cx0, cy0, cx0 + cs, cy0 + cs)
    cell.paint("mimcc", cx0 + 400, cy0 + 400, cx0 + cs - 400, cy0 + cs - 400)
    xo = cx0 + cs - 1000                           # bottom plate tab down to the out track
    terms.append((("out", xo, cy0 - 600), "cap4"))
    xz = cx0 + 1000                                # top plate: metal5 down past the plate, via4
    yz = cy0 - 600 - 1200 - PAD - 300           # MIMTM.1: 1.2 um from the bottom plate
    cell.paint("metal5", xz - 220, yz - 220, xz + 220, cy0 + 400)
    cell.paint("via4", xz - 140, yz - 140, xz + 140, yz + 140)
    cell.paint("metal4", xz - PAD, yz - PAD, xz + PAD, yz + PAD)
    terms.append((("cz", xz, yz), "cap5"))

    # Routing: metal2 up from the NMOS side, metal4 down from the PMOS side and the capacitor,
    # metal3 tracks across; supply taps from the rings.
    vss_x = nring[0] + RING_M1 // 2
    terms.append((("vss", vss_x, nring[3] - RING_M1 // 2), "nring"))
    vdd_x = pring[0] + RING_M1 // 2
    terms.append((("vdd", vdd_x, pring[1] + RING_M1 // 2), "pring"))
    xs = []
    for (net, tx, ty), side in terms:
        if net not in track_y:
            raise Error("net %s has no track" % net)
        yt = track_y[net]
        xs.append(tx)
        if side in ("n", "nring"):
            via_stack(cell, tx, ty, 2)
            cell.paint("metal2", tx - PAD, ty, tx + PAD, yt + PAD)
            cell.paint("via2", tx - 140, yt - 140, tx + 140, yt + 140)
        elif side in ("p", "pring"):
            via_stack(cell, tx, ty, 4)
            cell.paint("metal4", tx - PAD, yt - PAD, tx + PAD, ty)
            cell.paint("via3", tx - 140, yt - 140, tx + 140, yt + 140)
        else:
            cell.paint("metal4", tx - PAD, yt - PAD, tx + PAD, ty + PAD)
            cell.paint("via3", tx - 140, yt - 140, tx + 140, yt + 140)
    tx0 = min(nring[0], pring[0]) - 2000
    tx1 = max(xs) + 1000
    for i, net in enumerate(TRACKS):
        y = track_y[net]
        cell.paint("metal3", tx0, y - TRACK_W // 2, tx1, y + TRACK_W // 2)
    port = 1
    for net in TRACKS:
        y = track_y[net]
        if net in PINS:
            cell.label(PINS[net], "metal3", tx0 + 100, y - 100, tx0 + 300, y + 100, port=port)
            port += 1
        else:
            cell.label(net, "metal3", tx0 + 100, y - 100, tx0 + 300, y + 100)
    facts = dict(
        devices={n: dict(kind=m.kind, model=MODEL[m.kind], wUm=m.w / 1000.0, lUm=m.l / 1000.0, fingers=m.nf,
                         fingerWUm=m.wf / 1000.0) for n, m in devs.items()},
        rz=dict(device="ppolyf_u", wUm=rw / 1000.0, lUm=rl / 1000.0, ohmModelTt=round(r_ohm, 2), ohmDesign=design["rzKohm"] * 1000.0),
        cc=dict(device="cap_mim_2f0_m4m5_noshield", wUm=cs / 1000.0, lUm=cs / 1000.0, pfModelTt=round(c_f * 1e12, 5), pfDesign=design["ccPf"]),
        pins=[PINS[n] for n in TRACKS if n in PINS])
    return cell, facts


def merge(a, b):
    if a[0] is None:
        return list(b)
    return [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]


def grow(b, d):
    return (b[0] - d, b[1] - d, b[2] + d, b[3] + d)


# ---------------------------------------------------------------- the schematic

def ref_netlist(design, facts):
    """The Pack's OTA as a subcircuit: its MOS lines (model, W, L, nets) and Rz, Cc as the PDK
    devices the layout draws, in the X-device form Magic extracts."""
    lines = ["* The Pack's two-stage Miller OTA (analog-ota-migrate ota_cli.py NETS), gf180mcuD devices",
             ".subckt ota vdd vss inp inn out ibias"]
    for name in sorted(NETS):
        d = design["devices"][name]
        nets = " ".join("ibias" if n == "nbias" else n for n in NETS[name])
        lines.append("X%s %s %s w=%gu l=%gu" % (name, nets, MODEL[KIND[name]], d["wUm"], d["lUm"]))
    rz, cc = facts["rz"], facts["cc"]
    lines.append("XRZ y cz vss ppolyf_u r_width=%gu r_length=%gu" % (rz["wUm"], rz["lUm"]))
    lines.append("XCC cz out cap_mim_2f0_m4m5_noshield c_width=%gu c_length=%gu" % (cc["wUm"], cc["lUm"]))
    lines += [".ends ota", ""]
    return "\n".join(lines)


# ---------------------------------------------------------------- the tools

def run(argv, cwd, log, timeout=1800):
    t0 = time.time()
    with open(log, "w") as out:
        p = subprocess.run(argv, cwd=str(cwd), stdout=out, stderr=subprocess.STDOUT, timeout=timeout)
    return p.returncode, round(time.time() - t0, 2)


def magic(script, cwd, log):
    return run(["magic", "-dnull", "-noconsole", "-rcfile", MAGICRC, script], cwd, log)


DRAW_TAIL = """
save ota
select top cell
drc style drc(full)
drc on
drc check
drc catchup
set errs [drc listall why]
set f [open drc_magic.txt w]
set total 0
foreach {why boxes} $errs {
    puts $f "[llength $boxes] $why"
    incr total [llength $boxes]
}
puts $f "TOTAL $total"
close $f
gds write ota.gds
quit -noprompt
"""

EXTRACT = """
gds read ../ota.gds
load ota
select top cell
%(pre)s
extract all
%(post)s
quit -noprompt
"""

PEX_SPICE = "ext2spice hierarchy off\next2spice format ngspice\next2spice scale off\next2spice subcircuit top on\next2spice cthresh 0\n"


def extract(out, tag, pre, post):
    """One Magic extraction of the GDS (not of the drawn cell), in its own directory."""
    d = out / ("ext_" + tag)
    d.mkdir(exist_ok=True)
    (d / "extract.tcl").write_text(EXTRACT % dict(pre=pre, post=post))
    return magic("extract.tcl", d, d / "magic.log")


def step_draw(design, out):
    cell, facts = build(design)
    tcl = ["drc off", "snap internal", "load ota"]
    tcl += cell.tcl + [DRAW_TAIL]
    (out / "ota.tcl").write_text("\n".join(tcl))
    (out / "ota_ref.spice").write_text(ref_netlist(design, facts))
    rc, secs = magic("ota.tcl", out, out / "magic_draw.log")
    total = None
    if (out / "drc_magic.txt").is_file():
        m = re.search(r"TOTAL (\d+)", (out / "drc_magic.txt").read_text())
        total = int(m.group(1)) if m else None
    return facts, dict(rc=rc, seconds=secs, magicDrcErrors=total)


def step_lvs(out):
    rc1, s1 = extract(out, "lvs", "extract do local", "ext2spice lvs\next2spice -o ../ota_lvs.spice")
    rc2, s2 = run(["netgen", "-batch", "lvs", "ota_lvs.spice ota", "ota_ref.spice ota", NETGEN_SETUP, "lvs.out", "-json"],
                  out, out / "netgen.log")
    text = (out / "lvs.out").read_text() if (out / "lvs.out").is_file() else ""
    log = (out / "netgen.log").read_text()
    match = "Circuits match uniquely." in text and "Property errors were found" not in text
    final = re.findall(r"^(Final result:.*|Circuits match uniquely\.|Netlists do not match\.|.*Property errors.*)$", text + "\n" + log, re.M)
    return dict(rc=[rc1, rc2], seconds=round(s1 + s2, 2), extractSeconds=s1, netgenSeconds=s2, match=match,
                lines=sorted(set(final)))


def step_pex(out):
    rc1, s1 = extract(out, "pexc", "", PEX_SPICE + "ext2spice -o ../ota_pex_c.spice")
    rc2, s2 = extract(out, "pexrc", "extract do resistance",
                      "ext2sim labels on\next2sim\nextresist tolerance %s\nextresist simplify off\nextresist all\n" % RES_TOLERANCE +
                      PEX_SPICE + "ext2spice extresist on\next2spice -o ../ota_pex_rc.spice")
    counts = {}
    for name in ("ota_pex_c.spice", "ota_pex_rc.spice"):
        p = out / name
        if p.is_file():
            t = p.read_text().splitlines()
            counts[name] = dict(caps=sum(1 for l in t if re.match(r"^C\d", l)), res=sum(1 for l in t if re.match(r"^R\d", l)),
                                devices=sum(1 for l in t if l.startswith("X")))
    return dict(rc=[rc1, rc2], seconds=round(s1 + s2, 2), cSeconds=s1, rcSeconds=s2, netlists=counts)


def klayout_drc(out, tag, decks):
    rc, secs = run(["klayout", "-b", "-r", KLAYOUT_TECH + "/drc/gf180mcu.drc", "-rd", "input=ota.gds",
                    "-rd", "report=drc_klayout_%s.lyrdb" % tag, "-rd", "variant=D", "-rd", "topcell=ota",
                    "-rd", "run_mode=flat", "-rd", "decks=" + decks], out, out / ("klayout_drc_%s.log" % tag))
    cats = lyrdb_counts(out / ("drc_klayout_%s.lyrdb" % tag))
    lines = ["%d %s" % (n, c) for c, n in sorted(cats.items())] + ["TOTAL %d" % sum(cats.values())]
    (out / ("drc_klayout_%s.txt" % tag)).write_text("\n".join(lines) + "\n")
    return dict(decks=decks, rc=rc, seconds=secs, total=sum(cats.values()), byRule=cats)


def step_klayout_drc(out):
    """The PDK's KLayout deck on the cell: every deck but the die-level density coverage (PL.8, Mn.4,
    MT.3, which a die meets with fill), then the density decks alone for the record."""
    return dict(block=klayout_drc(out, "block", "all,-density"), density=klayout_drc(out, "density", "density"))


def lyrdb_counts(path):
    if not path.is_file():
        return {"(no report)": 1}
    import xml.etree.ElementTree as ET
    root = ET.parse(str(path)).getroot()
    counts = {}
    for item in root.iter("item"):
        cat = item.findtext("category", "").strip().strip("'")
        counts[cat] = counts.get(cat, 0) + 1
    return counts


RENDER = r"""
import pya
lv = pya.LayoutView()
lv.load_layout(gds, 0)
lv.load_layer_props(lyp)
lv.max_hier()
lv.set_config("background-color", "#ffffff")
lv.set_config("grid-visible", "false")
lv.set_config("text-visible", "true")
box = lv.active_cellview().layout().top_cell().dbbox().enlarged(2.0, 2.0)
lv.zoom_box(box)
h = 2000
lv.save_image_with_options(png, int(h * box.width() / box.height()), h, 0, 0, 0, box, False)
"""


def step_render(out):
    (out / "render.py").write_text(RENDER)
    rc, secs = run(["klayout", "-zz", "-r", "render.py", "-rd", "gds=ota.gds", "-rd", "png=ota.png",
                    "-rd", "lyp=" + KLAYOUT_TECH + "/gf180mcu.lyp"], out, out / "klayout_render.log")
    return dict(rc=rc, seconds=secs, png=(out / "ota.png").is_file())


def cmd_all(design_path, out_dir):
    design = json.loads(Path(design_path).read_text())
    out = Path(out_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    facts, draw = step_draw(design, out)
    result = dict(schema="hima-ota-layout/1", pdk="gf180mcuD", design=str(design_path), layout=facts, draw=draw)
    result["klayoutDrc"] = step_klayout_drc(out)
    result["lvs"] = step_lvs(out)
    result["pex"] = step_pex(out)
    result["render"] = step_render(out)
    result["totalSeconds"] = round(time.time() - t0, 2)
    (out / "layout.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    print(json.dumps({k: result[k] for k in ("draw", "klayoutDrc", "lvs", "pex", "render", "totalSeconds")}, indent=1, sort_keys=True))


def main(argv):
    if len(argv) >= 4 and argv[1] == "all":
        cmd_all(argv[2], argv[3])
        return 0
    if len(argv) >= 4 and argv[1] == "draw":
        out = Path(argv[3]).resolve()
        out.mkdir(parents=True, exist_ok=True)
        facts, draw = step_draw(json.loads(Path(argv[2]).read_text()), out)
        print(json.dumps(dict(layout=facts, draw=draw), indent=1))
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv))
    except Error as error:
        print("ota_layout: %s" % error, file=sys.stderr)
        sys.exit(3)
