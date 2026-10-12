#!/usr/bin/env python3
"""Netlist-driven GF180MCU layout of a small analog cell (python3 >= 3.9, stdlib only).

Runs inside the open-source tool image (Magic, netgen, KLayout and /foss/pdks/gf180mcuD):

  cell_layout.py all <netlist.spice> <subckt> <out_dir>
  cell_layout.py draw <netlist.spice> <subckt> <out_dir>      (drawing and Magic DRC only)

The input is one SPICE subcircuit of PDK device instances, its pins on the .subckt line:

  X.. d g s b nfet_03v3|pfet_03v3 w= l= [nf=] [m=]     w is the total width; drawn as equal fingers
  X.. c b e pnp_10p00x10p00|pnp_05p00x05p00 [m=]       the PDK's fixed vertical-PNP cells (b = c = substrate)
  X.. p n sub ppolyf_u|ppolyf_u_1k r_width= r_length= [m=]   straight segments in series (even count)
  X.. top bot cap_mim_2f0_m4m5_noshield|cap_mim_2f0fF c_width= c_length= [m=]

M instances of nfet_03v3/pfet_03v3 are read too. Floorplan: a substrate-tap ring holding the NMOS
devices and the resistors, the PNP block beside it, a routing channel (one metal3 track per net),
then an n-well ring holding the PMOS devices and the MIM capacitors beside it. Lower devices reach
the channel on metal2, upper ones on metal4. Two matched MOS (same model, W, L, source and bulk,
different gate and drain) are interdigitated ABBA (AB when a finger count is odd) with poly dummies
at both ends; a 1:8 PNP pair is a 3x3 common-centroid block with the 1x unit in the centre.

Writes, in <out_dir> (cell = the subcircuit name):
  <cell>.tcl / .mag / .gds        the drawing (Magic abstract layers; the PNPs are the PDK's cells)
  <cell>_ref.spice                the reference: the input subcircuit as given
  drc_magic.txt                   Magic DRC with the PDK's tech file
  drc_klayout_block.* / _density.* KLayout DRC with the PDK's deck (variant D), without and with
                                  only the die-level density decks
  <cell>_lvs.spice, lvs.out       Magic extraction of the GDS and netgen LVS (PDK setup file)
  klayout_lvs/                    KLayout LVS with the PDK's deck (run_lvs.py, --combine), the
                                  BJT-aware check
  <cell>_pex_c.spice / _rc.spice  extraction with parasitic C, and with R (extresist)
  <cell>.png                      a KLayout render
  layout.json                     the facts and the step times

Magic names every PDK PNP cell's device pnp_10p00x00p42 (its area rule does not separate them);
its LVS netlist is corrected by the PDK cell that holds the device (pnp_10p00x10p00_0 holds a
pnp_10p00x10p00), and KLayout LVS checks the same devices from the layout geometry independently.
Sizes in this file are nm on the 5 nm manufacturing grid.
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
GRID = 5
PAD = 195                        # half width of a via landing pad
TRACK_W, TRACK_PITCH = 500, 1000
ROW_GAP = 1000
RING_GAP = 400
RING_M1 = 380
MAX_FINGER_NM = 18000
MAX_SEGMENT_NM = 20000
RES_TOLERANCE = "0.000001"

MOS = {"nfet_03v3": "nmos", "pfet_03v3": "pmos"}
RES = {"ppolyf_u": dict(layer="rpp", end=510, pc0=215, wmin=800, gap=1000),
       "ppolyf_u_1k": dict(layer="hires", end=610, pc0=315, wmin=1000, gap=1400)}   # HRES.1: the marker grows 0.4 um
CAPS = ("cap_mim_2f0_m4m5_noshield", "cap_mim_2f0fF", "cap_mim_2f0_m2m3_noshield")
# The PDK's fixed PNP cells (libs.ref/gf180mcu_fd_pr/mag), nm from the cell centre: half size,
# emitter half size, base and collector metal1 bands (inner, outer).
PNPS = {"pnp_10p00x10p00": dict(cell="pnp_10p00x10p00_0", half=6480, emit=5000, base=(5320, 5740), coll=(6060, 6480)),
        "pnp_05p00x05p00": dict(cell="pnp_05p00x05p00_0", half=3980, emit=2500, base=(2820, 3240), coll=(3560, 3980))}
MAGIC_PNP_NAMES = ("pnp_10p00x00p42", "pnp_05p00x00p42", "pnp_10p00x10p00", "pnp_05p00x05p00")
SUFFIX = {"t": 1e12, "g": 1e9, "meg": 1e6, "k": 1e3, "m": 1e-3, "u": 1e-6, "n": 1e-9, "p": 1e-12, "f": 1e-15}


class Error(Exception):
    pass


def snap(nm):
    return int(round(nm / GRID)) * GRID


def um(nm):
    return "%.3fum" % (nm / 1000.0)


def spice_number(text):
    m = re.match(r"^([-+]?[0-9.]+(?:e[-+]?\d+)?)(meg|[tgkmunpf])?", text.strip().lower())
    if not m:
        raise Error("not a number: %r" % text)
    return float(m.group(1)) * SUFFIX.get(m.group(2) or "", 1.0)


def to_nm(text):
    return snap(spice_number(text) * 1e9)


# ---------------------------------------------------------------- the netlist

def read_subckt(path, name):
    """(pins, devices, text) of subcircuit `name`: each device a dict(name, model, nets, params)."""
    lines, joined = Path(path).read_text().splitlines(), []
    for line in lines:
        if line.startswith("+") and joined:
            joined[-1] += " " + line[1:]
        else:
            joined.append(line)
    pins, devices, body, inside = None, [], [], False
    for line in joined:
        tok = line.split()
        if not tok or tok[0].startswith("*"):
            continue
        low = tok[0].lower()
        if low == ".subckt" and tok[1].lower() == name.lower():
            pins, inside = [t for t in tok[2:] if "=" not in t], True
            body.append(line)
            continue
        if not inside:
            continue
        body.append(line)
        if low.startswith(".ends"):
            break
        if low[0] not in "xm":
            raise Error("%s: only X/M instances of PDK devices are laid out (%s)" % (name, tok[0]))
        params = dict(t.split("=", 1) for t in tok[1:] if "=" in t)
        plain = [t for t in tok[1:] if "=" not in t]
        model, nets = plain[-1], plain[:-1]
        devices.append(dict(name=tok[0], model=model, nets=nets, params={k.lower(): v for k, v in params.items()}))
    if pins is None:
        raise Error("no subcircuit %s in %s" % (name, path))
    return pins, devices, "\n".join(body) + "\n"


# ---------------------------------------------------------------- drawing primitives

class Cell:
    def __init__(self):
        self.tcl = []

    def paint(self, layer, x1, y1, x2, y2):
        x1, x2 = sorted((x1, x2))
        y1, y2 = sorted((y1, y2))
        for v in (x1, y1, x2, y2):
            if v % GRID:
                raise Error("%s edge %s is off the %d nm grid" % (layer, v, GRID))
        if x2 <= x1 or y2 <= y1:
            raise Error("empty %s rectangle %s" % (layer, (x1, y1, x2, y2)))
        self.tcl += ["box %s %s %s %s" % (um(x1), um(y1), um(x2), um(y2)), "paint %s" % layer]

    def place(self, cellname, x1, y1):
        self.tcl += ["box %s %s %s %s" % (um(x1), um(y1), um(x1), um(y1)), "getcell %s" % cellname]

    def label(self, text, layer, x1, y1, x2, y2, port=None, use="signal"):
        self.tcl += ["box %s %s %s %s" % (um(x1), um(y1), um(x2), um(y2)), "label %s c %s" % (text, layer)]
        if port is not None:
            self.tcl += ["port make %d" % port, "port use %s" % use]


class Frame:
    """Local coordinates to the cell: x + ox, and y + oy (or oy - y when flipped)."""

    def __init__(self, cell, ox, oy, flip):
        self.cell, self.ox, self.oy, self.flip = cell, ox, oy, flip

    def y(self, y):
        return self.oy - y if self.flip else self.oy + y

    def paint(self, layer, x1, y1, x2, y2):
        self.cell.paint(layer, self.ox + x1, self.y(y1), self.ox + x2, self.y(y2))

    def point(self, x, y):
        return self.ox + x, self.y(y)


def via_stack(cell, x, y, top):
    """Vias from metal1 up to metal `top` (2 or 4) centred at (x, y), with landing pads."""
    cell.paint("metal1", x - PAD, y - PAD, x + PAD, y + PAD)
    cell.paint("via1", x - 130, y - 130, x + 130, y + 130)
    cell.paint("metal2", x - PAD, y - PAD, x + PAD, y + PAD)
    if top >= 3:
        cell.paint("via2", x - 140, y - 140, x + 140, y + 140)
        cell.paint("metal3", x - PAD, y - PAD, x + PAD, y + PAD)
    if top >= 4:
        cell.paint("via3", x - 140, y - 140, x + 140, y + 140)
        cell.paint("metal4", x - PAD, y - PAD, x + PAD, y + PAD)


# ---------------------------------------------------------------- blocks
#
# Every block draws in a local frame whose +y points at the routing channel, keeps everything inside
# (x0, y0)-(x1, y1), and lists its landing pads as (net, x, y). The top edge of its keep-out box is
# HEAD (845 nm) for the devices that sit beside each other in a tap ring.

HEAD = 845


def finger_split(w_nm, nf=None):
    units = w_nm // GRID
    if units * GRID != w_nm:
        raise Error("W %d nm is off the %d nm grid" % (w_nm, GRID))
    if nf:
        if units % nf:
            raise Error("W %d nm does not split into %d fingers on the grid" % (w_nm, nf))
        return nf, w_nm // nf
    for n in range(1, units + 1):
        if units % n == 0 and w_nm // n <= MAX_FINGER_NM:
            return n, w_nm // n
    raise Error("no finger split for W %d nm" % w_nm)


class MosBlock:
    """One diffusion of MOS fingers. gates: [(device, gate net)], strips: the source/drain net of each
    strip (len(gates) + 1). One poly bar and gate contact join the gates of a single device; an
    interdigitated pair contacts every gate on its own and gets floating poly dummies at both ends.
    Local frame: diffusion (0, 0)-(dw, wf); gate heads toward +y; source/drain pads below y = 0."""

    def __init__(self, kind, l_nm, wf, gates, strips, merged, label):
        self.kind, self.l, self.wf, self.gates_dev, self.strips_net, self.merged, self.label = kind, l_nm, wf, gates, strips, merged, label
        n = len(gates)
        l = l_nm
        self.dw = 2 * 440 + n * l + (n - 1) * 520
        self.gx = [440 + i * (l + 520) for i in range(n)]
        self.sx = [180] + [g + l + 260 for g in self.gx[:-1]] + [self.dw - 180]
        self.wide = l // 2 + 260 >= 660                 # a gate pad fits between its strips' pads
        if merged and not self.wide:
            raise Error("%s: interdigitated gates need L >= 0.8 um" % label)
        self.pad_x = self.gx[0] + (l // 2) // GRID * GRID if self.wide else -500
        x0 = min(180 - PAD, self.pad_x - PAD)
        x1 = self.dw - 180 + PAD
        if merged:
            x0, x1 = -100 - l - 300, self.dw + 100 + l + 300
        self.x0, self.x1 = x0, x1
        self.y0, self.y1 = -wf - 525, HEAD
        self.oy = -wf                                   # the diffusion's own frame sits wf below HEAD's 0

    def draw(self, cell, ox, oy, flip):
        f = Frame(cell, ox, oy + (self.wf if flip else -self.wf), flip)
        n = self.kind == "nmos"
        diff, fet, dc = ("ndiff", "nfet", "ndc") if n else ("pdiff", "pfet", "pdc")
        l, wf = self.l, self.wf
        f.paint(diff, 0, 0, self.dw, wf)
        pcs = []
        for g in self.gx:
            f.paint(fet, g, 0, g + l, wf)
            f.paint("poly", g, -220, g + l, 0)
            f.paint("poly", g, wf, g + l, wf + 100)
            if l >= 360:
                pcs.append((g + 65, g + l - 65))
            else:
                c = g + (l // 2) // GRID * GRID
                pcs.append((c - 115, c + 115))
        pads = []
        if self.merged:
            for (a, b), g in zip(pcs, self.gx):
                f.paint("poly", g, wf + 100, g + l, wf + 525)
                f.paint("pc", a, wf + 230, b, wf + 460)
                f.paint("metal1", a - 55, wf + 230, b + 55, wf + 460)
                gx = g + (l // 2) // GRID * GRID
                f.paint("metal1", gx - PAD, wf + 460, gx + PAD, wf + 840)
                pads.append(gx)
            for x in (-100 - l, self.dw + 100):          # floating poly dummies, 100 nm off the diffusion
                f.paint("poly", x, -220, x + l, wf + 220)
        else:
            bar_x0 = min(self.gx[0], pcs[0][0] - 65)
            bar_x1 = max(self.gx[-1] + l, pcs[-1][1] + 65)
            f.paint("poly", bar_x0, wf + 100, bar_x1, wf + 525)
            for a, b in pcs:
                f.paint("pc", a, wf + 230, b, wf + 460)
            f.paint("metal1", min(pcs[0][0] - 55, self.pad_x - PAD), wf + 230, pcs[-1][1] + 55, wf + 460)
            f.paint("metal1", self.pad_x - PAD, wf + 460, self.pad_x + PAD, wf + 840)
            pads.append(self.pad_x)
        for cx in self.sx:
            f.paint(dc, cx - 115, 65, cx + 115, wf - 65)
            f.paint("metal1", cx - 115, -520, cx + 115, wf - 10)
            f.paint("metal1", cx - PAD, -520, cx + PAD, -140)
        out = []
        if self.merged:
            for x, (_dev, gnet) in zip(pads, self.gates_dev):
                out.append((gnet,) + f.point(x, wf + 650))
        else:
            out.append((self.gates_dev[0][1],) + f.point(pads[0], wf + 650))
        for cx, net in zip(self.sx, self.strips_net):
            out.append((net,) + f.point(cx, -330))
        return out


def mos_blocks(devices):
    """The MOS devices as diffusion blocks: matched pairs (a differential pair: same model, W, L and
    fingers, a common source that is not the bulk, different gates and drains) interdigitated, the
    rest one block each."""
    mos = []
    for d in devices:
        if d["model"] not in MOS:
            continue
        p = d["params"]
        if len(d["nets"]) != 4:
            raise Error("%s: a MOS has four nets (d g s b)" % d["name"])
        w, l, m = to_nm(p["w"]), to_nm(p["l"]), int(spice_number(p.get("m", "1")))
        nf = int(spice_number(p["nf"])) if "nf" in p else None
        fingers, wf = finger_split(w, nf)
        mos.append(dict(dev=d, kind=MOS[d["model"]], w=w, l=l, fingers=fingers * m, wf=wf))
    used, blocks = set(), []
    for i, a in enumerate(mos):
        if i in used:
            continue
        pair = None
        for j in range(i + 1, len(mos)):
            b = mos[j]
            da, db = a["dev"]["nets"], b["dev"]["nets"]
            if j not in used and da[2] != da[3] and a["dev"]["model"] == b["dev"]["model"] and (a["w"], a["l"], a["wf"], a["fingers"]) == \
                    (b["w"], b["l"], b["wf"], b["fingers"]) and da[2] == db[2] and da[3] == db[3] and da[1] != db[1] \
                    and da[0] != db[0] and a["l"] // 2 + 260 >= 660:
                pair = j
                break
        if pair is not None:
            b = mos[pair]
            used |= {i, pair}
            k, wf = a["fingers"], a["wf"]
            if k % 2 and (a["w"] // GRID) % (2 * k) == 0 and wf // 2 >= 400:
                k, wf = 2 * k, wf // 2               # ABBA needs an even finger count per device
            order = [(a if ((g + 1) // 2) % 2 == 0 else b) for g in range(2 * k)]
            gates = [(x["dev"]["name"], x["dev"]["nets"][1]) for x in order]
            strips = []
            for s in range(2 * k + 1):
                if s % 2:
                    strips.append(a["dev"]["nets"][2])
                else:
                    x = order[s - 1] if s else order[0]
                    strips.append(x["dev"]["nets"][0])
            blocks.append(MosBlock(a["kind"], a["l"], wf, gates, strips, True,
                                   "%s/%s %s" % (a["dev"]["name"], b["dev"]["name"], "ABBA" if k % 2 == 0 and k > 1 else "AB" if k == 1 else "AB-interdigitated")))
            continue
        used.add(i)
        d, s, g = a["dev"]["nets"][0], a["dev"]["nets"][2], a["dev"]["nets"][1]
        gates = [(a["dev"]["name"], g)] * a["fingers"]
        strips = [s if j % 2 == 0 else d for j in range(a["fingers"] + 1)]
        blocks.append(MosBlock(a["kind"], a["l"], a["wf"], gates, strips, False, a["dev"]["name"]))
    return mos, blocks


class ResBlock:
    """A poly resistor as an even number of straight segments in series (body along y), joined by
    metal1 at alternate ends, both terminals at the channel-side ends."""

    def __init__(self, dev):
        p = dev["params"]
        self.dev, self.spec = dev, RES[dev["model"]]
        self.w = to_nm(p.get("r_width", p.get("w")))
        total = to_nm(p.get("r_length", p.get("l")))
        m = int(spice_number(p.get("m", "1")))
        if m != 1:
            raise Error("%s: m > 1 resistors are not laid out yet" % dev["name"])
        if self.w < self.spec["wmin"]:
            raise Error("%s: width %d nm below the PDK minimum %d" % (dev["name"], self.w, self.spec["wmin"]))
        if "s" in p:                                     # the model's s: s segments of r_length in series
            n = int(spice_number(p["s"]))
            self.segs = [total] * n
            total *= n
        else:
            n = max(2, 2 * math.ceil(total / (2.0 * MAX_SEGMENT_NM)))
            base = (total // GRID // n) * GRID
            extra = (total - base * n) // GRID
            self.segs = [base + (GRID if i < extra else 0) for i in range(n)]
        self.pitch = self.w + self.spec["gap"]
        self.length = total
        e, p0 = self.spec["end"], self.spec["pc0"]
        self.head = p0 + 230 + 75                       # body end to the far edge of its contact head
        self.yt = HEAD - self.head - 2 * PAD            # the body tops; a terminal pad sits above its head
        self.x0, self.x1 = -1300, (n - 1) * self.pitch + self.w + 1300
        self.y0, self.y1 = self.yt - max(self.segs) - max(e, self.head) - 300, HEAD

    def draw(self, cell, ox, oy, flip):
        w, sp = self.w, self.spec
        e, p0 = sp["end"], sp["pc0"]
        p1 = p0 + 230
        heads = []
        for i, ls in enumerate(self.segs):
            x = i * self.pitch
            yt = self.yt
            yb = yt - ls
            f = Frame(cell, ox + x, oy, flip)
            f.paint(sp["layer"], 0, yb, w, yt)
            f.paint("poly", 0, yt, w, yt + e)
            f.paint("pc", 65, yt + p0, w - 65, yt + p1)
            f.paint("metal1", 10, yt + p0 - 75, w - 10, yt + p1 + 75)
            f.paint("poly", 0, yb - e, w, yb)
            f.paint("pc", 65, yb - p1, w - 65, yb - p0)
            f.paint("metal1", 10, yb - p1 - 75, w - 10, yb - p0 + 75)
            heads.append((x, yt + p1 + 75 + PAD, None, yt + p0 - 75, yt + p1 + 75, yb - p1 - 75, yb - p0 + 75))
        f0 = Frame(cell, ox, oy, flip)
        for i in range(len(self.segs) - 1):
            a, b = heads[i], heads[i + 1]
            if i % 2 == 0:       # bottom jumper
                f0.paint("metal1", a[0] + 10, max(a[5], b[5]), b[0] + w - 10, min(a[6], b[6]))
            else:                # top jumper
                f0.paint("metal1", a[0] + 10, max(a[3], b[3]), b[0] + w - 10, min(a[4], b[4]))
        cx = (w // 2) // GRID * GRID
        first, last = heads[0], heads[-1]
        if len(self.segs) % 2 == 0:
            return [(self.dev["nets"][0],) + f0.point(first[0] + cx, first[1]), (self.dev["nets"][1],) + f0.point(last[0] + cx, last[1])]
        # an odd count ends at the far end: a metal1 jog beside the last segment takes it to its pad
        jx = last[0] + w + 700
        f0.paint("metal1", last[0] + 10, last[5], jx + PAD, last[6])
        return [(self.dev["nets"][0],) + f0.point(first[0] + cx, first[1]), (self.dev["nets"][1],) + f0.point(jx, (last[5] + last[6]) // 2)]


class PnpBlock:
    """The PNP units: a 3x3 common centroid for a 1x and an 8x device (the 1x in the centre), else a
    row. Bases are strapped to the collector rings; every emitter rises on its own metal2 track."""

    GAP = 1000

    def __init__(self, devices, substrate):
        self.units = []
        models = {d["model"] for d in devices}
        if len(models) != 1:
            raise Error("one PNP size per cell (found %s)" % ", ".join(sorted(models)))
        self.spec = PNPS[models.pop()]
        for d in devices:
            c, b, e = d["nets"]
            if c != substrate or b != substrate:
                raise Error("%s: the vertical PNP's collector and base must be the substrate net %s" % (d["name"], substrate))
            m = int(spice_number(d["params"].get("m", d["params"].get("par", "1"))))
            self.units += [(d["name"], e)] * m
        count = {}
        for _n, e in self.units:
            count[e] = count.get(e, 0) + 1
        if sorted(count.values()) == [1, 8]:
            one = [e for e, c in count.items() if c == 1][0]
            eight = [e for e, c in count.items() if c == 8][0]
            u1 = [u for u in self.units if u[1] == one]
            u8 = [u for u in self.units if u[1] == eight]
            self.grid = [u8[0:3], [u8[3], u1[0], u8[4]], u8[5:8]]
            self.layout = "3x3 common centroid, the 1x unit (%s, emitter %s) in the centre" % (u1[0][0], one)
        else:
            self.grid = [self.units]
            self.layout = "one row"
        h = self.spec["half"]
        self.pitch = 2 * h + self.GAP
        self.cols, self.rows = len(self.grid[0]), len(self.grid)
        self.x0, self.x1 = 0, self.cols * self.pitch - self.GAP
        self.y1 = 0
        self.y0 = -(self.rows * self.pitch - self.GAP)

    def draw(self, cell, ox, oy):
        """ox, oy: the block's top-left corner (channel above)."""
        s = self.spec
        h = s["half"]
        self.placed = []
        offs = [-2500, 0, 2500] if s["emit"] >= 5000 else [-1500, 0, 1500]
        out = []
        for r, row in enumerate(self.grid):
            for c, (name, enet) in enumerate(row):
                cx = ox + c * self.pitch + h
                cy = oy - r * self.pitch - h
                cell.place(s["cell"], cx - h, cy - h)
                self.placed.append((cx - h, cy - h, cx + h, cy + h))
                # base to collector strap on the right side, inside the cell's own bands
                cell.paint("metal1", cx + s["base"][1] - 40, cy - 500, cx + s["coll"][0] + 40, cy + 500)
                if c + 1 < self.cols:
                    cell.paint("metal1", cx + h, cy - 400, cx + h + self.GAP, cy + 400)
                if r + 1 < self.rows:
                    cell.paint("metal1", cx - 400, cy - h - self.GAP, cx + 400, cy - h)
                off = offs[r % len(offs)] if self.rows > 1 else 0
                out.append((enet, cx + off, cy))
        # the substrate tap: on the top-left unit's collector band
        cx, cy = ox + h, oy - h
        out.append(("__sub__", cx - h + 2000 if s["emit"] >= 5000 else cx - h + 1200, cy + (s["coll"][0] + s["coll"][1]) // 2))
        return out


class CapBlock:
    """A MIM capacitor (metal4 bottom plate, top plate to metal5): both terminals reach the channel on
    metal4 below the plate; the top plate's via island keeps 1.2 um from the bottom plate (MIMTM.1)."""

    def __init__(self, dev):
        p = dev["params"]
        self.dev = dev
        self.w, self.l = to_nm(p.get("c_width", p.get("w"))), to_nm(p.get("c_length", p.get("l")))
        if int(spice_number(p.get("m", "1"))) != 1:
            raise Error("%s: m > 1 capacitors are not laid out yet" % dev["name"])
        self.x0, self.x1 = -600, self.w + 600

    def draw(self, cell, cx0, cy0):
        w, l = self.w, self.l
        cell.paint("metal4", cx0 - 600, cy0 - 600, cx0 + w + 600, cy0 + l + 600)
        cell.paint("mimcap", cx0, cy0, cx0 + w, cy0 + l)
        cell.paint("mimcc", cx0 + 400, cy0 + 400, cx0 + w - 400, cy0 + l - 400)
        top, bot = self.dev["nets"][0], self.dev["nets"][1]
        xo = cx0 + w - 1000
        xz = cx0 + 1000
        yz = cy0 - 600 - 1200 - PAD - 300
        cell.paint("metal5", xz - 220, yz - 220, xz + 220, cy0 + 400)
        cell.paint("via4", xz - 140, yz - 140, xz + 140, yz + 140)
        cell.paint("metal4", xz - PAD, yz - PAD, xz + PAD, yz + PAD)
        return [((bot, xo, cy0 - 600), "cap4"), ((top, xz, yz), "cap5")]


def tap_ring(cell, box, kind, open_side):
    """A substrate (psd) or well (nsd) tap ring around box (the inner edge of the ring metal);
    contacts on every side but `open_side`. Returns the outer box of the ring metal."""
    x0, y0, x1, y1 = box
    sd, sc = ("psd", "psc") if kind == "p" else ("nsd", "nsc")
    t = RING_M1
    sides = {"left": (x0 - t, y0 - t, x0, y1 + t), "right": (x1, y0 - t, x1 + t, y1 + t),
             "bottom": (x0 - t, y0 - t, x1 + t, y0), "top": (x0 - t, y1, x1 + t, y1 + t)}
    for a, b, c, d in sides.values():
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


def merge(a, b):
    if a is None:
        return list(b)
    return [min(a[0], b[0]), min(a[1], b[1]), max(a[2], b[2]), max(a[3], b[3])]


def grow(b, d):
    return (b[0] - d, b[1] - d, b[2] + d, b[3] + d)


# ---------------------------------------------------------------- the floorplan

def build(pins, devices):
    known = set(MOS) | set(RES) | set(CAPS) | set(PNPS)
    for d in devices:
        if d["model"] not in known:
            raise Error("%s: model %s is not laid out (known: %s)" % (d["name"], d["model"], ", ".join(sorted(known))))
    mos, blocks = mos_blocks(devices)
    nmos = [b for b in blocks if b.kind == "nmos"]
    pmos = [b for b in blocks if b.kind == "pmos"]
    res = [ResBlock(d) for d in devices if d["model"] in RES]
    caps = [CapBlock(d) for d in devices if d["model"] in CAPS]
    pnps = [d for d in devices if d["model"] in PNPS]
    subs = {m["dev"]["nets"][3] for m in mos if m["kind"] == "nmos"} | {r.dev["nets"][2] for r in res} | \
        {d["nets"][0] for d in pnps}
    wells = {m["dev"]["nets"][3] for m in mos if m["kind"] == "pmos"}
    if len(subs) > 1 or len(wells) > 1:
        raise Error("one substrate net and one n-well net per cell (found %s and %s)" % (sorted(subs), sorted(wells)))
    sub = subs.pop() if subs else None
    well = wells.pop() if wells else None

    cell = Cell()
    terms = []                                     # ((net, x, y), side)
    facts = dict(blocks=[], pnp=None)

    # lower row: NMOS and resistors in the substrate-tap ring
    x, nbox = 0, None
    for b in nmos + res:
        ox = x - b.x0
        for t in b.draw(cell, ox, 0, False):
            terms.append((t, "n"))
        nbox = merge(nbox, (x, b.y0, x + b.x1 - b.x0, b.y1))
        x = x + b.x1 - b.x0 + ROW_GAP
        facts["blocks"].append(getattr(b, "label", None) or b.dev["name"])
    low_top = HEAD
    nring = None
    if nbox:
        nring = tap_ring(cell, grow(nbox, RING_GAP), "p", "top")
        cell.paint("pwell", nring[0] - 110, nring[1] - 110, nring[2] + 110, nring[3] + 110)
        terms.append(((sub, nring[0] + RING_M1 // 2, nring[3] - RING_M1 // 2), "n"))
        low_top = nring[3]
        x = nring[2] + 3000
    if pnps:
        pb = PnpBlock(pnps, sub)
        for net, tx, ty in pb.draw(cell, x, low_top):
            terms.append(((sub if net == "__sub__" else net, tx, ty), "n"))
        facts["pnp"] = dict(units=len(pb.units), layout=pb.layout, cell=pb.spec["cell"], placedNm=pb.placed)

    nets = []
    for n in pins + [t[0][0] for t in terms] + [d["nets"][0] for d in devices if d["model"] in CAPS] + \
            [d["nets"][1] for d in devices if d["model"] in CAPS] + [m["dev"]["nets"][i] for m in mos for i in range(3)]:
        if n not in nets:
            nets.append(n)
    order = ([sub] if sub in nets else []) + [n for n in nets if n not in (sub, well)] + ([well] if well in nets else [])
    track_y = {net: low_top + TRACK_PITCH + i * TRACK_PITCH for i, net in enumerate(order)}
    chan_top = track_y[order[-1]] + TRACK_W // 2

    # upper row: PMOS in the n-well ring, capacitors beside it
    yp = chan_top + 750 + RING_M1 + RING_GAP + HEAD   # the PMOS gate heads' far edge sits at yp - HEAD ... yp
    x, pbox = 0, None
    for b in pmos:
        ox = x - b.x0
        for t in b.draw(cell, ox, yp, True):
            terms.append((t, "p"))
        pbox = merge(pbox, (x, yp - b.y1, x + b.x1 - b.x0, yp - b.y0))
        x = x + b.x1 - b.x0 + ROW_GAP
        facts["blocks"].append(b.label)
    x = 0
    up_bottom = chan_top + 750
    if pbox:
        pring = tap_ring(cell, grow(pbox, RING_GAP), "n", "bottom")
        cell.paint("nwell", pring[0] - 130, pring[1] - 130, pring[2] + 130, pring[3] + 130)
        terms.append(((well, pring[0] + RING_M1 // 2, pring[1] + RING_M1 // 2), "p"))
        x = pring[2] + 3000
    for c in caps:
        for t, side in c.draw(cell, x + 600, up_bottom + 2500):
            terms.append((t, side))
        x += c.x1 - c.x0 + 3000
        facts["blocks"].append(c.dev["name"])

    xs = []
    for (net, tx, ty), side in terms:
        yt = track_y[net]
        xs.append(tx)
        if side == "n":
            via_stack(cell, tx, ty, 2)
            cell.paint("metal2", tx - PAD, min(ty, yt), tx + PAD, max(ty, yt) + PAD)
            cell.paint("via2", tx - 140, yt - 140, tx + 140, yt + 140)
        elif side == "p":
            via_stack(cell, tx, ty, 4)
            cell.paint("metal4", tx - PAD, yt - PAD, tx + PAD, ty)
            cell.paint("via3", tx - 140, yt - 140, tx + 140, yt + 140)
        else:
            cell.paint("metal4", tx - PAD, yt - PAD, tx + PAD, ty + PAD)
            cell.paint("via3", tx - 140, yt - 140, tx + 140, yt + 140)
    tx0 = min(xs + [nring[0] if nring else 0]) - 2000
    tx1 = max(xs) + 1000
    for net in order:
        y = track_y[net]
        cell.paint("metal3", tx0, y - TRACK_W // 2, tx1, y + TRACK_W // 2)
    for i, net in enumerate(order):
        y = track_y[net]
        if net in pins:
            use = "power" if net == well else "ground" if net == sub else "signal"
            cell.label(net, "metal3", tx0 + 100, y - 100, tx0 + 300, y + 100, port=pins.index(net) + 1, use=use)
        else:
            cell.label(net, "metal3", tx0 + 100, y - 100, tx0 + 300, y + 100)
    facts.update(tracks=order, substrate=sub, well=well,
                 mos={m["dev"]["name"]: dict(model=m["dev"]["model"], wUm=m["w"] / 1000.0, lUm=m["l"] / 1000.0,
                                             fingers=m["fingers"], fingerWUm=m["wf"] / 1000.0) for m in mos},
                 resistors={r.dev["name"]: dict(model=r.dev["model"], wUm=r.w / 1000.0, lUm=r.length / 1000.0,
                                                segmentsUm=[s / 1000.0 for s in r.segs]) for r in res},
                 caps={c.dev["name"]: dict(model=c.dev["model"], wUm=c.w / 1000.0, lUm=c.l / 1000.0) for c in caps})
    return cell, facts


# ---------------------------------------------------------------- tools and checks

def run(argv, cwd, log, timeout=1800):
    t0 = time.time()
    with open(log, "w") as out:
        p = subprocess.run(argv, cwd=str(cwd), stdout=out, stderr=subprocess.STDOUT, timeout=timeout)
    return p.returncode, round(time.time() - t0, 2)


def magic(script, cwd, log):
    return run(["magic", "-dnull", "-noconsole", "-rcfile", MAGICRC, script], cwd, log)


DRAW_TAIL = """
save %(cell)s
select top cell
drc style drc(full)
drc on
drc check
drc catchup
set errs [drc listall why]
set f [open drc_magic.txt w]
set g [open drc_magic_boxes.txt w]
set total 0
foreach {why boxes} $errs {
    puts $f "[llength $boxes] $why"
    foreach b $boxes { puts $g "[lmap v $b {expr {$v * 5}}] $why" }
    incr total [llength $boxes]
}
puts $f "TOTAL $total"
close $f
close $g
gds write %(cell)s.gds
quit -noprompt
"""

EXTRACT = """
gds read ../%(cell)s.gds
load %(cell)s
select top cell
%(pre)s
extract all
%(post)s
quit -noprompt
"""

PEX_SPICE = "ext2spice hierarchy off\next2spice format ngspice\next2spice scale off\next2spice subcircuit top on\next2spice cthresh 0\n"

MIM_MARK = r"""
import pya
ly = pya.Layout()
ly.read(gds)
top = ly.top_cell()
fuse = ly.layer(75, 0)
mark = ly.layer(117, 10)
n = 0
for shape in top.shapes(fuse).each():
    b = shape.bbox()
    top.shapes(mark).insert(pya.Box(b.left, b.bottom, b.right, b.bottom + int(round(0.1 / ly.dbu))))
    n += 1
ly.write(gds)
print("MIM_L_MK %d" % n)
"""


def extract(out, cell, tag, pre, post):
    d = out / ("ext_" + tag)
    d.mkdir(exist_ok=True)
    (d / "extract.tcl").write_text(EXTRACT % dict(cell=cell, pre=pre, post=post))
    return magic("extract.tcl", d, d / "magic.log")


def fix_pnp_names(path):
    """Magic names the device inside every PDK PNP cell pnp_10p00x00p42: name it by the PDK cell
    that holds it (pnp_10p00x10p00_0 holds a pnp_10p00x10p00). Returns the corrections made."""
    text, cur, fixed, out = Path(path).read_text().splitlines(), None, [], []
    for line in text:
        tok = line.split()
        if tok and tok[0].lower() == ".subckt":
            cur = tok[1]
        elif tok and tok[0].lower().startswith(".ends"):
            cur = None
        elif cur and tok and tok[0].upper().startswith("X"):
            holder = re.match(r"^(pnp_\d\dp\d\dx\d\dp\d\d)_0$", cur)
            model = [t for t in tok if "=" not in t][-1]
            if holder and model in MAGIC_PNP_NAMES and model != holder.group(1):
                line = line.replace(" %s" % model, " %s" % holder.group(1), 1)
                fixed.append("%s in %s: %s -> %s" % (tok[0], cur, model, holder.group(1)))
        out.append(line)
    Path(path).write_text("\n".join(out) + "\n")
    return fixed


def step_draw(netlist, name, out):
    pins, devices, body = read_subckt(netlist, name)
    cell, facts = build(pins, devices)
    tcl = ["drc off", "snap internal", "load %s" % name] + cell.tcl + [DRAW_TAIL % dict(cell=name)]
    (out / ("%s.tcl" % name)).write_text("\n".join(tcl))
    (out / ("%s_ref.spice" % name)).write_text("* reference: subcircuit %s of %s\n%s" % (name, netlist, body))
    rc, secs = magic("%s.tcl" % name, out, out / "magic_draw.log")
    total, in_cells = None, None
    if (out / "drc_magic_boxes.txt").is_file():
        # Errors inside the PDK's own fixed PNP cells are the cells' (the bare cell gives the same
        # "P-diffusion and N-ohmic must be over N-well" with the PDK's Magic tech): counted apart.
        cells = (facts.get("pnp") or {}).get("placedNm", [])
        total, in_cells = 0, 0
        for line in (out / "drc_magic_boxes.txt").read_text().splitlines():
            v = [float(x) for x in line.split()[:4]]
            inside = any(c[0] <= v[0] and c[1] <= v[1] and v[2] <= c[2] and v[3] <= c[3] for c in cells)
            in_cells += inside
            total += not inside
    marks = None
    if (out / ("%s.gds" % name)).is_file():
        (out / "mim_mark.py").write_text(MIM_MARK)
        rc2, s2 = run(["klayout", "-b", "-r", "mim_mark.py", "-rd", "gds=%s.gds" % name], out, out / "klayout_mim_mark.log")
        marks = re.findall(r"MIM_L_MK (\d+)", (out / "klayout_mim_mark.log").read_text())
        secs = round(secs + s2, 2)
    return facts, dict(rc=rc, seconds=secs, magicDrcErrors=total, magicDrcInPdkPnpCells=in_cells, mimLengthMarks=int(marks[0]) if marks else None, pins=pins)


def step_lvs(out, name):
    rc1, s1 = extract(out, name, "lvs", "extract do local", "ext2spice lvs\next2spice -o ../%s_lvs.spice" % name)
    fixed = fix_pnp_names(out / ("%s_lvs.spice" % name)) if (out / ("%s_lvs.spice" % name)).is_file() else []
    notes = lvs_reference(out / ("%s_ref.spice" % name), name, out / ("%s_ref_netgen.spice" % name))
    rc2, s2 = run(["netgen", "-batch", "lvs", "%s_lvs.spice %s" % (name, name), "%s_ref_netgen.spice %s" % (name, name), NETGEN_SETUP,
                   "lvs.out", "-json"], out, out / "netgen.log")
    text = (out / "lvs.out").read_text() if (out / "lvs.out").is_file() else ""
    match = "Circuits match uniquely." in text and "Property errors were found" not in text and "do not match" not in text
    final = re.findall(r"^(Final result:.*|Circuits match uniquely\.|Netlists do not match\.|.*Property errors.*)$", text, re.M)
    return dict(rc=[rc1, rc2], seconds=round(s1 + s2, 2), match=match, lines=sorted(set(final)), referenceNotes=notes, pnpNameCorrections=len(fixed),
                pnpNameCorrectionExamples=fixed[:3])


CAP_ALIASES = {"cap_mim_2f0_m2m3_noshield": "the same 2 fF/um2 model (sm141064_mim.spice); gf180mcuD's 5-metal stack puts the MIM between metal4 and metal5"}


def lvs_reference(src, name, dst):
    """The reference netgen compares: the subcircuit as given, except MOS M elements written in the X
    form Magic extracts, a resistor's series count s folded into its length (s segments of r_length
    are drawn; netgen adds series lengths) and a MIM under another stack's name renamed to the one
    this stack draws. Returns the notes."""
    pins, devices, body = read_subckt(src, name)
    notes, out = [], []
    for line in body.splitlines():
        tok = line.split()
        if tok and tok[0][0].lower() in "xm" and not tok[0].startswith("."):
            params = dict(t.split("=", 1) for t in tok[1:] if "=" in t)
            plain = [t for t in tok if "=" not in t]
            model = plain[-1]
            if model in RES and "s" in {k.lower() for k in params}:
                sk = [k for k in params if k.lower() == "s"][0]
                lk = [k for k in params if k.lower() in ("r_length", "l")][0]
                sv = int(spice_number(params.pop(sk)))
                params[lk] = "%gu" % (spice_number(params[lk]) * 1e6 * sv)
                notes.append("%s: s=%d folded into %s=%s" % (tok[0], sv, lk, params[lk]))
            if model in MOS and plain[0][0] in "Mm":
                plain[0] = "X" + plain[0]                 # the X form Magic extracts (the PDK's device subcircuit)
            if model in CAP_ALIASES:
                notes.append("%s: %s read as cap_mim_2f0_m4m5_noshield (%s)" % (tok[0], model, CAP_ALIASES[model]))
                plain[-1] = "cap_mim_2f0_m4m5_noshield"
            line = " ".join(plain + ["%s=%s" % kv for kv in params.items()])
        out.append(line)
    Path(dst).write_text("* netgen reference of %s (from %s)\n" % (name, src) + "\n".join(out) + "\n")
    return notes


def klayout_reference(src, name, dst):
    """The reference in the form the PDK's KLayout deck reads (its SubcircuitModelsReader): MOS as
    M elements with W (times m) and L, resistors as R elements with W and L, the MIM as a C element
    under the deck's name cap_mim_2f0fF, and each PNP unit as one Q element (m expanded)."""
    pins, devices, _ = read_subckt(src, name)
    lines = ["* KLayout LVS reference of %s (from %s)" % (name, src), ".SUBCKT %s %s" % (name, " ".join(pins))]
    for d in devices:
        p, n = d["params"], d["nets"]
        m = int(spice_number(p.get("m", p.get("par", "1"))))
        base = re.sub(r"^[XxMm]", "", d["name"])
        if d["model"] in MOS:
            lines.append("M%s %s %s W=%gU L=%gU" % (base, " ".join(n), d["model"], spice_number(p["w"]) * 1e6 * m, spice_number(p["l"]) * 1e6))
        elif d["model"] in RES:
            lines.append("R%s %s %s W=%gU L=%gU" % (base, " ".join(n), d["model"], spice_number(p.get("r_width", p.get("w"))) * 1e6,
                                                    spice_number(p.get("r_length", p.get("l"))) * 1e6 * spice_number(p.get("s", "1"))))
        elif d["model"] in CAPS:
            lines.append("C%s %s cap_mim_2f0fF W=%gU L=%gU" % (base, " ".join(n), spice_number(p.get("c_width", p.get("w"))) * 1e6,
                                                               spice_number(p.get("c_length", p.get("l"))) * 1e6))
        elif d["model"] in PNPS:
            for i in range(m):
                lines.append("Q%s_%d %s %s" % (base, i + 1, " ".join(n), d["model"]))
    lines += [".ENDS %s" % name, ""]
    Path(dst).write_text("\n".join(lines))


def step_klayout_lvs(out, name, ref=None):
    d = out / "klayout_lvs"
    d.mkdir(exist_ok=True)
    klayout_reference(ref or (out / ("%s_ref.spice" % name)), name, d / ("%s_ref.spice" % name))
    rc, secs = run(["python3", KLAYOUT_TECH + "/lvs/run_lvs.py", "--layout=../%s.gds" % name, "--netlist=%s_ref.spice" % name,
                    "--variant=D", "--topcell=%s" % name, "--run_dir=.", "--run_mode=flat", "--combine"], d, d / "run_lvs.log")
    log = (d / "run_lvs.log").read_text()
    match = "Congratulations! Netlists match" in log
    lines = sorted(set(l.split(" : ", 1)[-1].strip() for l in log.splitlines() if "Netlists" in l and ("match" in l or "don't" in l)))
    return dict(rc=rc, seconds=secs, match=match, lines=lines)


def fix_flat_pnp_names(path, model):
    """In a flat extraction every PNP is Magic's pnp_10p00x00p42; a cell holds one PNP size (the
    generator refuses two), so each is that size's model."""
    text = Path(path).read_text()
    fixed = len(re.findall(r" (%s)\b" % "|".join(MAGIC_PNP_NAMES), text))
    Path(path).write_text(re.sub(r" (%s)\b" % "|".join(MAGIC_PNP_NAMES), " " + model, text))
    return fixed


def step_pex(out, name, pnp_model=None):
    rc1, s1 = extract(out, name, "pexc", "", PEX_SPICE + "ext2spice -o ../%s_pex_c.spice" % name)
    rc2, s2 = extract(out, name, "pexrc", "extract do resistance",
                      "ext2sim labels on\next2sim\nextresist tolerance %s\nextresist simplify off\nextresist all\n" % RES_TOLERANCE +
                      PEX_SPICE + "ext2spice extresist on\next2spice -o ../%s_pex_rc.spice" % name)
    counts = {}
    for tag in ("c", "rc"):
        p = out / ("%s_pex_%s.spice" % (name, tag))
        if p.is_file():
            t = p.read_text().splitlines()
            counts[p.name] = dict(caps=sum(1 for l in t if re.match(r"^C\d", l)), res=sum(1 for l in t if re.match(r"^R\d", l)),
                                  devices=sum(1 for l in t if l.startswith("X")),
                                  pnpNamed=fix_flat_pnp_names(p, pnp_model) if pnp_model else 0)
    return dict(rc=[rc1, rc2], seconds=round(s1 + s2, 2), netlists=counts)


def klayout_drc(out, name, tag, decks):
    rc, secs = run(["klayout", "-b", "-r", KLAYOUT_TECH + "/drc/gf180mcu.drc", "-rd", "input=%s.gds" % name,
                    "-rd", "report=drc_klayout_%s.lyrdb" % tag, "-rd", "variant=D", "-rd", "topcell=%s" % name,
                    "-rd", "run_mode=flat", "-rd", "decks=" + decks], out, out / ("klayout_drc_%s.log" % tag))
    cats = lyrdb_counts(out / ("drc_klayout_%s.lyrdb" % tag))
    lines = ["%d %s" % (n, c) for c, n in sorted(cats.items())] + ["TOTAL %d" % sum(cats.values())]
    (out / ("drc_klayout_%s.txt" % tag)).write_text("\n".join(lines) + "\n")
    return dict(decks=decks, rc=rc, seconds=secs, total=sum(cats.values()), byRule=cats)


def lyrdb_counts(path):
    if not path.is_file():
        return {"(no report)": 1}
    import xml.etree.ElementTree as ET
    counts = {}
    for item in ET.parse(str(path)).getroot().iter("item"):
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


def step_render(out, name):
    (out / "render.py").write_text(RENDER)
    rc, secs = run(["klayout", "-zz", "-r", "render.py", "-rd", "gds=%s.gds" % name, "-rd", "png=%s.png" % name,
                    "-rd", "lyp=" + KLAYOUT_TECH + "/gf180mcu.lyp"], out, out / "klayout_render.log")
    return dict(rc=rc, seconds=secs, png=(out / ("%s.png" % name)).is_file())


def cmd_all(netlist, name, out_dir, extra=None):
    out = Path(out_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    facts, draw = step_draw(netlist, name, out)
    result = dict(schema="hima-cell-layout/1", pdk="gf180mcuD", netlist=str(netlist), cell=name, layout=facts, draw=draw)
    result.update(extra or {})
    result["klayoutDrc"] = dict(block=klayout_drc(out, name, "block", "all,-density"), density=klayout_drc(out, name, "density", "density"))
    result["lvs"] = step_lvs(out, name)
    result["klayoutLvs"] = step_klayout_lvs(out, name)
    pnp = facts.get("pnp")
    result["pex"] = step_pex(out, name, pnp["cell"][:-2] if pnp else None)
    result["render"] = step_render(out, name)
    result["totalSeconds"] = round(time.time() - t0, 2)
    (out / "layout.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    brief = dict(magicDrc=draw["magicDrcErrors"], magicDrcInPdkPnpCells=draw["magicDrcInPdkPnpCells"], klayoutDrcBlock=result["klayoutDrc"]["block"]["total"],
                 klayoutDrcDensity=result["klayoutDrc"]["density"]["total"], netgenLvs=result["lvs"]["match"],
                 pnpNameCorrections=result["lvs"]["pnpNameCorrections"], klayoutLvs=result["klayoutLvs"]["match"],
                 pex=result["pex"]["netlists"], blocks=facts["blocks"], pnp=facts["pnp"],
                 seconds=dict(draw=draw["seconds"], klayoutDrc=result["klayoutDrc"]["block"]["seconds"],
                              netgenLvs=result["lvs"]["seconds"], klayoutLvs=result["klayoutLvs"]["seconds"],
                              pex=result["pex"]["seconds"], render=result["render"]["seconds"], total=result["totalSeconds"]))
    print(json.dumps(brief, indent=1, sort_keys=True))
    return result


def main(argv):
    if len(argv) >= 5 and argv[1] in ("all", "draw"):
        if argv[1] == "all":
            cmd_all(argv[2], argv[3], argv[4])
        else:
            out = Path(argv[4]).resolve()
            out.mkdir(parents=True, exist_ok=True)
            facts, draw = step_draw(argv[2], argv[3], out)
            print(json.dumps(dict(layout=facts, draw=draw), indent=1))
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv))
    except Error as error:
        print("cell_layout: %s" % error, file=sys.stderr)
        sys.exit(3)
