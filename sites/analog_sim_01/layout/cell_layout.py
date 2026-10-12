#!/usr/bin/env python3
"""Netlist-driven GF180MCU layout of a small analog cell (python3 >= 3.9, stdlib only).

Runs inside the open-source tool image (Magic, netgen, KLayout and /foss/pdks/gf180mcuD):

  cell_layout.py all <netlist.spice> <subckt> <out_dir>
  cell_layout.py draw <netlist.spice> <subckt> <out_dir>      (drawing and Magic DRC only)

The input is one SPICE subcircuit of PDK device instances, its pins on the .subckt line:

  X.. d g s b nfet_03v3|pfet_03v3 w= l= [nf=] [m=]     w is the total width; drawn as equal fingers
  X.. c b e pnp_10p00x10p00|pnp_05p00x05p00 [m=]       the PDK's fixed vertical-PNP cells (b = c = substrate)
  X.. p n sub ppolyf_u|ppolyf_u_1k r_width= r_length= [s=]   s segments of r_length in series
  X.. top bot cap_mim_2f0_m4m5_noshield|cap_mim_2f0fF c_width= c_length=   (c_width along x)

M instances of nfet_03v3/pfet_03v3 are read too. MOS are fingers of at most 20 um (two finger
widths 5 nm apart, in two diffusions, when W does not split evenly: the drawn total is exactly W);
a finger narrower than a contact (0.36 um) gets dog-bone source/drain diffusion. A differential pair
(same model, W, L, a common source that is not the bulk, different gates and drains) is
interdigitated ABBA with poly dummies at both ends; a 1:8 PNP pair is a 3x3 common-centroid block
with the 1x unit in the centre; resistors are straight segments in series (the model's s, else an
even count of at most 20 um), folded into serpentine bands of columns.

Floorplan: a stack of stripes. Each is a lower row (NMOS and resistors in a substrate-tap ring, the
PNP block beside it in the first stripe), a routing channel (one metal3 track per net the stripe
uses, as long as its terminals) and an upper row (PMOS in an n-well ring, MIM capacitors, resistors
in their own tap ring). Lower devices reach the channel on metal2, upper ones on metal4; a net used
in several stripes joins its tracks through a metal4 spine left of the stripes. Matched groups (a
device's blocks, a pair, a mirror, equal resistors) stay together; the stripe count and resistor
folding are the ones with the smallest larger side, a near-square cell.

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
  layout.json                     the facts, every step's exit code and time, and `ok`

The output folder must be new or empty. The tool exits 0 only when every step ran (exit code 0)
and wrote its product; a DRC count or an LVS mismatch is a verdict in layout.json, not a tool
failure. A failed step makes it exit 4 with the failures listed in layout.json.

Magic names every PDK PNP cell's device pnp_10p00x00p42 (its area rule does not separate them);
its LVS netlist is corrected by the PDK cell that holds the device (pnp_10p00x10p00_0 holds a
pnp_10p00x10p00). netgen's PNP size check is therefore circular (the size comes from the placed
cell's name); KLayout LVS derives each PNP from the layout geometry and is the independent check.
The MIM length marker (GDS 117/10, which the KLayout deck needs) is drawn by the capacitor block
itself as Magic's CAP_LENGTH mask hint, along the plate's bottom edge.
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
MAX_FINGER_NM = 20000
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
        self.minx = 0
        self.hints = []                                  # CAP_LENGTH mask hints (nm)

    def hint(self, x1, y1, x2, y2):
        self.hints.append((x1, y1, x2, y2))

    def hint_tcl(self):
        """The MIM length markers as Magic's mask-hint property (internal units of 5 nm), which its
        GDS writer emits as CAP_LENGTH (117/10)."""
        if not self.hints:
            return []
        values = " ".join("%d %d %d %d" % tuple(v // GRID for v in h) for h in self.hints)
        return ['property MASKHINTS_CAP_LENGTH "%s"' % values]

    def paint(self, layer, x1, y1, x2, y2):
        x1, x2 = sorted((x1, x2))
        y1, y2 = sorted((y1, y2))
        for v in (x1, y1, x2, y2):
            if v % GRID:
                raise Error("%s edge %s is off the %d nm grid" % (layer, v, GRID))
        if x2 <= x1 or y2 <= y1:
            raise Error("empty %s rectangle %s" % (layer, (x1, y1, x2, y2)))
        self.minx = min(self.minx, x1)
        self.tcl += ["box %s %s %s %s" % (um(x1), um(y1), um(x2), um(y2)), "paint %s" % layer]

    def place(self, cellname, x1, y1):
        self.minx = min(self.minx, x1)
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
NOTCH = 280                      # a narrow device's widened source/drain keeps the COMP space from its gate


def finger_plan(w_nm, n_min=1):
    """Fingers of at most MAX_FINGER_NM summing exactly to w_nm on the grid: [(count, width)], at most
    two widths 5 nm apart (each width its own diffusion)."""
    units = w_nm // GRID
    if units * GRID != w_nm:
        raise Error("W %d nm is off the %d nm grid" % (w_nm, GRID))
    n = max(n_min, -(-w_nm // MAX_FINGER_NM))
    q, r = divmod(units, n)
    if q * GRID < 220:
        raise Error("W %d nm in %d fingers is below the 0.22 um minimum" % (w_nm, n))
    return [(c, u * GRID) for c, u in ((n - r, q), (r, q + 1)) if c]


class MosBlock:
    """One diffusion of MOS fingers. gates: [(device, gate net)], strips: the source/drain net of each
    strip (len(gates) + 1). One poly bar and gate contact join the gates of a single device; an
    interdigitated pair contacts every gate on its own and gets floating poly dummies at both ends.
    A finger narrower than a contact (0.36 um) gets dog-bone source/drain diffusion, NOTCH from its
    gates. Local frame: diffusion (0, 0)-(dw, wf); gate heads toward +y; source/drain pads below."""

    def __init__(self, kind, l_nm, wf, gates, strips, merged, label):
        self.kind, self.l, self.wf, self.gates_dev, self.strips_net, self.merged, self.label = kind, l_nm, wf, gates, strips, merged, label
        self.narrow = wf < 360
        self.wfe = max(wf, 360)
        e, m = (NOTCH + 360, 2 * NOTCH + 360) if self.narrow else (440, 520)
        self.e, self.m = e, m
        n = len(gates)
        l = l_nm
        self.dw = 2 * e + n * l + (n - 1) * m
        self.gx = [e + i * (l + m) for i in range(n)]
        self.sx = [180] + [g + l + m // 2 for g in self.gx[:-1]] + [self.dw - 180]
        self.wide = self.gx[0] + l // 2 - 180 >= 660            # a gate pad fits between its strips' pads
        if merged and not self.wide:
            raise Error("%s: interdigitated gates need L >= 0.8 um" % label)
        self.pad_x = self.gx[0] + (l // 2) // GRID * GRID if self.wide else -500
        x0 = min(180 - PAD, self.pad_x - PAD)
        x1 = self.dw - 180 + PAD
        if merged:
            x0, x1 = -100 - l - 300, self.dw + 100 + l + 300
        self.x0, self.x1 = x0, x1
        self.y0, self.y1 = -self.wfe - 525, HEAD

    def draw(self, cell, ox, oy, flip):
        f = Frame(cell, ox, oy + (self.wfe if flip else -self.wfe), flip)
        n = self.kind == "nmos"
        diff, fet, dc = ("ndiff", "nfet", "ndc") if n else ("pdiff", "pfet", "pdc")
        l, wf, wfe = self.l, self.wf, self.wfe
        f.paint(diff, 0, 0, self.dw, wf)
        if self.narrow:                                     # dog-bone: widened source/drain regions
            edges = [0] + [x for g in self.gx for x in (g, g + l)] + [self.dw]
            for j in range(len(self.gx) + 1):
                a, b = edges[2 * j], edges[2 * j + 1]
                f.paint(diff, a + (NOTCH if j else 0), wf, b - (NOTCH if j < len(self.gx) else 0), wfe)
        pcs = []
        for g in self.gx:
            f.paint(fet, g, 0, g + l, wf)
            f.paint("poly", g, -220, g + l, 0)
            f.paint("poly", g, wf, g + l, wfe + 100)
            if l >= 360:
                pcs.append((g + 65, g + l - 65))
            else:
                c = g + (l // 2) // GRID * GRID
                pcs.append((c - 115, c + 115))
        pads = []
        if self.merged:
            for (a, b), g in zip(pcs, self.gx):
                f.paint("poly", g, wfe + 100, g + l, wfe + 525)
                f.paint("pc", a, wfe + 230, b, wfe + 460)
                f.paint("metal1", a - 55, wfe + 230, b + 55, wfe + 460)
                gx = g + (l // 2) // GRID * GRID
                f.paint("metal1", gx - PAD, wfe + 460, gx + PAD, wfe + 840)
                pads.append(gx)
            for x in (-100 - l, self.dw + 100):          # floating poly dummies, 100 nm off the diffusion
                f.paint("poly", x, -220, x + l, wfe + 220)
        else:
            bar_x0 = min(self.gx[0], pcs[0][0] - 65)
            bar_x1 = max(self.gx[-1] + l, pcs[-1][1] + 65)
            f.paint("poly", bar_x0, wfe + 100, bar_x1, wfe + 525)
            for a, b in pcs:
                f.paint("pc", a, wfe + 230, b, wfe + 460)
            f.paint("metal1", min(pcs[0][0] - 55, self.pad_x - PAD), wfe + 230, pcs[-1][1] + 55, wfe + 460)
            f.paint("metal1", self.pad_x - PAD, wfe + 460, self.pad_x + PAD, wfe + 840)
            pads.append(self.pad_x)
        for cx in self.sx:
            f.paint(dc, cx - 115, 65, cx + 115, wfe - 65)
            f.paint("metal1", cx - 115, -520, cx + 115, wfe - 10)
            f.paint("metal1", cx - PAD, -520, cx + PAD, -140)
        out = []
        if self.merged:
            for x, (_dev, gnet) in zip(pads, self.gates_dev):
                out.append((gnet,) + f.point(x, wfe + 650))
        else:
            out.append((self.gates_dev[0][1],) + f.point(pads[0], wfe + 650))
        for cx, net in zip(self.sx, self.strips_net):
            out.append((net,) + f.point(cx, -330))
        return out


def mos_blocks(devices):
    """The MOS devices as diffusion blocks, fingers of at most MAX_FINGER_NM (two finger widths 5 nm
    apart become two blocks, so the drawn total is exactly W). A differential pair (same model, W, L,
    a common source that is not the bulk, different gates and drains) is interdigitated ABBA within
    each block (AB-style when a block holds an odd finger count per device)."""
    mos = []
    for d in devices:
        if d["model"] not in MOS:
            continue
        p = d["params"]
        if len(d["nets"]) != 4:
            raise Error("%s: a MOS has four nets (d g s b)" % d["name"])
        w, l, m = to_nm(p["w"]), to_nm(p["l"]), int(spice_number(p.get("m", "1")))
        nf = int(spice_number(p["nf"])) if "nf" in p else 1
        plan = finger_plan(w * m, nf * m)
        mos.append(dict(dev=d, kind=MOS[d["model"]], w=w * m, l=l, plan=plan, fingers=sum(c for c, _ in plan),
                        wf=plan[0][1]))
    used, blocks = set(), []
    for i, a in enumerate(mos):
        if i in used:
            continue
        pair = None
        da = a["dev"]["nets"]
        for j in range(i + 1, len(mos)):
            b = mos[j]
            db = b["dev"]["nets"]
            if j not in used and da[2] != da[3] and a["dev"]["model"] == b["dev"]["model"] and (a["w"], a["l"], a["plan"]) == \
                    (b["w"], b["l"], b["plan"]) and da[2] == db[2] and da[3] == db[3] and da[1] != db[1] \
                    and da[0] != db[0] and a["l"] // 2 + 260 >= 660:
                pair = j
                break
        if pair is not None:
            b = mos[pair]
            used |= {i, pair}
            for k, wf in a["plan"]:
                if len(a["plan"]) == 1 and k == 1 and wf % (2 * GRID) == 0 and wf // 2 >= 400:
                    k, wf = 2, wf // 2                   # one finger each: split in two for ABBA
                order = [(a if ((g + 1) // 2) % 2 == 0 else b) for g in range(2 * k)]
                gates = [(x["dev"]["name"], x["dev"]["nets"][1]) for x in order]
                strips = []
                for s in range(2 * k + 1):
                    if s % 2:
                        strips.append(da[2])
                    else:
                        x = order[s - 1] if s else order[0]
                        strips.append(x["dev"]["nets"][0])
                pattern = "".join("A" if x is a else "B" for x in order)
                blocks.append(MosBlock(a["kind"], a["l"], wf, gates, strips, True,
                                       "%s/%s %s x %.3f um" % (a["dev"]["name"], b["dev"]["name"], pattern, wf / 1000.0)))
            continue
        used.add(i)
        d, s, g = da[0], da[2], da[1]
        for k, wf in a["plan"]:
            gates = [(a["dev"]["name"], g)] * k
            strips = [s if j % 2 == 0 else d for j in range(k + 1)]
            blocks.append(MosBlock(a["kind"], a["l"], wf, gates, strips, False,
                                   "%s %d x %.3f um" % (a["dev"]["name"], k, wf / 1000.0)))
    return mos, blocks


class ResBlock:
    """A poly resistor as straight segments in series (body along y), joined by metal1 at alternate
    ends, folded into `bands` serpentine bands of columns (every band but the last has an odd count,
    so a band ends where the next begins). The first terminal sits above the first segment's
    channel-side head; the last one, when it does not end there, is taken by a metal1 jog to a free
    column beside the block and rises from there."""

    def __init__(self, dev, bands=1):
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
        self.length = total
        self.counts = self.band_counts(len(self.segs), bands)
        self.bands = len(self.counts)
        self.pitch = self.w + self.spec["gap"]
        self.cols = self.counts[0]
        e, p0 = self.spec["end"], self.spec["pc0"]
        self.head = p0 + 230 + 75
        self.lmax = max(self.segs)
        self.band_pitch = self.lmax + 2 * self.head + 2000
        self.yt = HEAD - self.head - 2 * PAD
        self.x0, self.x1 = -1300, (self.cols - 1) * self.pitch + self.w + 1300
        self.y0 = self.yt - (self.bands - 1) * self.band_pitch - self.lmax - max(e, self.head) - 300
        self.y1 = HEAD

    @staticmethod
    def band_counts(n, bands):
        """Segments per band: the first band odd and the widest, every band but the last odd, none
        wider than the first (a band runs back over the columns the one before it used)."""
        if bands <= 1 or n < 3:
            return [n]
        c0 = -(-n // bands)
        c0 += (c0 % 2 == 0)
        if c0 >= n:
            return [n]
        counts, left = [c0], n - c0
        for _ in range(bands - 2):
            if left <= c0:
                break
            c = min(c0, left - 1)
            c -= (c % 2 == 0)
            counts.append(c)
            left -= c
        if left > c0:
            return [n]
        return counts + [left]

    def draw(self, cell, ox, oy, flip):
        w, sp = self.w, self.spec
        e, p0 = sp["end"], sp["pc0"]
        p1 = p0 + 230
        f0 = Frame(cell, ox, oy, flip)
        place = []                                       # (column, band) per segment
        col, step = 0, 1
        for band, c in enumerate(self.counts):
            for k in range(c):
                place.append((col, band))
                if k < c - 1:
                    col += step
            step = -step
        heads = []
        for (c, band), ls in zip(place, self.segs):
            x = c * self.pitch
            yt = self.yt - band * self.band_pitch
            yb = yt - ls
            f0.paint(sp["layer"], x, yb, x + w, yt)
            f0.paint("poly", x, yt, x + w, yt + e)
            f0.paint("pc", x + 65, yt + p0, x + w - 65, yt + p1)
            f0.paint("metal1", x + 10, yt + p0 - 75, x + w - 10, yt + p1 + 75)
            f0.paint("poly", x, yb - e, x + w, yb)
            f0.paint("pc", x + 65, yb - p1, x + w - 65, yb - p0)
            f0.paint("metal1", x + 10, yb - p1 - 75, x + w - 10, yb - p0 + 75)
            heads.append(dict(x=x, top=(yt + p0 - 75, yt + p1 + 75), bot=(yb - p1 - 75, yb - p0 + 75), band=band))
        # the chain: within a band, k -> k+1 at the far (bottom) end when k is even, else at the top;
        # a band's last segment (odd count, so it exits at the bottom) meets the next band's top head
        exits, k_in_band = [], 0
        for i in range(len(self.segs)):
            if i and heads[i]["band"] != heads[i - 1]["band"]:
                k_in_band = 0
            exits.append("bot" if k_in_band % 2 == 0 else "top")
            k_in_band += 1
        for i in range(len(self.segs) - 1):
            a, b = heads[i], heads[i + 1]
            if a["band"] == b["band"]:
                side = exits[i]
                lo, hi = max(a[side][0], b[side][0]), min(a[side][1], b[side][1])
                f0.paint("metal1", min(a["x"], b["x"]) + 10, lo, max(a["x"], b["x"]) + w - 10, hi)
            else:                                        # band to band, same column
                f0.paint("metal1", a["x"] + 10, b["top"][0], a["x"] + w - 10, a["bot"][1])
        cx = (w // 2) // GRID * GRID
        first, last = heads[0], heads[-1]
        out = [(self.dev["nets"][0],) + f0.point(first["x"] + cx, first["top"][1] + PAD)]
        if self.bands == 1 and exits[-1] == "top":
            out.append((self.dev["nets"][1],) + f0.point(last["x"] + cx, last["top"][1] + PAD))
            return out
        # jog to the free column on the side the last band runs toward
        going_right = (self.bands - 1) % 2 == 0
        side = exits[-1]
        y = (last[side][0] + last[side][1]) // 2
        if going_right:
            jx = (self.cols - 1) * self.pitch + w + 700
            f0.paint("metal1", last["x"] + 10, last[side][0], jx + PAD, last[side][1])
        else:
            jx = -700
            f0.paint("metal1", jx - PAD, last[side][0], last["x"] + w - 10, last[side][1])
        out.append((self.dev["nets"][1],) + f0.point(jx, y))
        return out


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
        self.y0, self.y1 = 0, self.l + 600 + 2500       # the plate above its terminal tabs

    def draw(self, cell, cx0, cy0):
        w, l = self.w, self.l
        cell.paint("metal4", cx0 - 600, cy0 - 600, cx0 + w + 600, cy0 + l + 600)
        cell.paint("mimcap", cx0, cy0, cx0 + w, cy0 + l)
        cell.paint("mimcc", cx0 + 400, cy0 + 400, cx0 + w - 400, cy0 + l - 400)
        # the length marker, as the PDK's own MIM cell draws it: 0.1 um along the plate's bottom edge,
        # the plate's full width (c_width along x, c_length along y)
        cell.hint(cx0, cy0, cx0 + w, cy0 + 100)
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
#
# A cell is a stack of stripes. Each stripe is a lower row (NMOS and resistors in a substrate-tap
# ring, the PNP block beside it in the first stripe), a routing channel (one metal3 track per net the
# stripe uses) and an upper row (PMOS in an n-well ring, MIM capacitors, resistors in their own tap
# ring). A net used in more than one stripe joins its tracks through a metal4 spine left of the
# stripes. Blocks go to stripes by a greedy packing; the stripe count and the resistor folding are
# the ones that give the smallest larger side (the most compact, near-square cell).

def block_nets(b):
    if isinstance(b, MosBlock):
        return [g for _d, g in b.gates_dev] + list(b.strips_net)
    if isinstance(b, ResBlock):
        return list(b.dev["nets"][:2])
    if isinstance(b, CapBlock):
        return list(b.dev["nets"][:2])
    if isinstance(b, PnpBlock):
        return [e for row in b.grid for _n, e in row]
    return []


def bw(b):
    return b.x1 - b.x0


def bh(b):
    return b.y1 - b.y0


RING_OVER = 2 * (RING_GAP + RING_M1) + 300
GROUP_GAP = 3000


def pack(groups, stripes, pnp):
    """groups: [([blocks], allowed sides)], each group kept together (a device's finger blocks, a
    matched pair, a mirror, matched resistors). Returns ({block: (stripe, side)}, width, height)."""
    width = {(s, side): 0 for s in range(stripes) for side in "bt"}
    kinds = {k: set() for k in width}
    height = {k: 0 for k in width}
    nets = {s: set() for s in range(stripes)}
    where = {}
    if pnp:
        width[(0, "b")] += bw(pnp) + GROUP_GAP
        height[(0, "b")] = max(height[(0, "b")], bh(pnp))
        nets[0] |= set(block_nets(pnp))
        where[pnp] = (0, "b")
    for blocks, sides in sorted(groups, key=lambda t: -sum(bw(b) for b in t[0])):
        cand = sorted(((width[(s, side)], s, side) for s in range(stripes) for side in sides))
        _w, s, side = cand[0]
        kind = type(blocks[0]).__name__ + (blocks[0].kind if isinstance(blocks[0], MosBlock) else "")
        if kind not in kinds[(s, side)]:
            kinds[(s, side)].add(kind)
            width[(s, side)] += RING_OVER + GROUP_GAP
        for b in blocks:
            width[(s, side)] += bw(b) + ROW_GAP
            height[(s, side)] = max(height[(s, side)], bh(b) + RING_OVER)
            nets[s] |= set(block_nets(b))
            where[b] = (s, side)
    w = max(width.values()) + 4000 + 1000 * len(set.union(*nets.values()))
    h = sum(height[(s, "b")] + height[(s, "t")] + 1000 * (len(nets[s]) + 4) + 2000 for s in range(stripes))
    return where, w, h


def groups_of(mblocks, res, caps):
    """Blocks that stay together: one device's blocks, a pair, MOS of one kind sharing a gate net (a
    mirror), and resistors of one model, width and segmentation."""
    parent = list(range(len(mblocks)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for i, a in enumerate(mblocks):
        for j in range(i):
            b = mblocks[j]
            devs_a, devs_b = {d for d, _g in a.gates_dev}, {d for d, _g in b.gates_dev}
            gates_a, gates_b = {g for _d, g in a.gates_dev}, {g for _d, g in b.gates_dev}
            if devs_a & devs_b or (a.kind == b.kind and gates_a & gates_b):
                parent[find(i)] = find(j)
    out = {}
    for i, b in enumerate(mblocks):
        out.setdefault(find(i), []).append(b)
    groups = [(bl, "b" if bl[0].kind == "nmos" else "t") for bl in out.values()]
    rgroups = {}
    for r in res:
        rgroups.setdefault((r.dev["model"], r.w, tuple(r.segs)), []).append(r)
    groups += [(rl, "bt") for rl in rgroups.values()]
    groups += [([c], "t") for c in caps]
    return groups


def build(pins, devices):
    known = set(MOS) | set(RES) | set(CAPS) | set(PNPS)
    for d in devices:
        if d["model"] not in known:
            raise Error("%s: model %s is not laid out (known: %s)" % (d["name"], d["model"], ", ".join(sorted(known))))
    mos, mblocks = mos_blocks(devices)
    caps = [CapBlock(d) for d in devices if d["model"] in CAPS]
    pnps = [d for d in devices if d["model"] in PNPS]
    res_devs = [d for d in devices if d["model"] in RES]
    subs = {m["dev"]["nets"][3] for m in mos if m["kind"] == "nmos"} | {d["nets"][2] for d in res_devs} | {d["nets"][0] for d in pnps}
    wells = {m["dev"]["nets"][3] for m in mos if m["kind"] == "pmos"}
    if len(subs) > 1 or len(wells) > 1:
        raise Error("one substrate net and one n-well net per cell (found %s and %s)" % (sorted(subs), sorted(wells)))
    sub = subs.pop() if subs else None
    well = wells.pop() if wells else None
    pb = PnpBlock(pnps, sub) if pnps else None

    best = None
    for bands in (1, 2, 3):
        res = [ResBlock(d, bands) for d in res_devs]
        groups = groups_of(mblocks, res, caps)
        for stripes in (1, 2, 3, 4):
            where, w, h = pack(groups, stripes, pb)
            key = (max(w, h), w * h)
            if best is None or key < best[0]:
                best = (key, bands, stripes, res, where, w, h)
    _key, bands, nstripes, res, where, est_w, est_h = best

    cell = Cell()
    facts = dict(blocks=[], pnp=None, floorplan=dict(stripes=nstripes, resistorBands=bands, estimateUm=[round(est_w / 1000.0, 1), round(est_h / 1000.0, 1)]))
    terms = []                                       # (stripe, (net, x, y), side)
    stripe_nets = []
    base = 0
    tracks_y = []
    for s in range(nstripes):
        low = [b for b, (ss, side) in where.items() if ss == s and side == "b" and b is not pb]
        up = [b for b, (ss, side) in where.items() if ss == s and side == "t"]
        nlow = [b for b in low if isinstance(b, MosBlock)] + [b for b in low if isinstance(b, ResBlock)]
        has_pnp = pb is not None and where.get(pb, (None,))[0] == s
        # nets of this stripe, the channel's tracks: substrate first, well last
        nets = []
        for b in low + up + ([pb] if has_pnp else []):
            for n in block_nets(b):
                if n not in nets:
                    nets.append(n)
        rings = bool(nlow) or any(isinstance(b, ResBlock) for b in up)
        if (rings or has_pnp) and sub and sub not in nets:
            nets.append(sub)
        if any(isinstance(b, MosBlock) for b in up) and well and well not in nets:
            nets.append(well)
        order = ([sub] if sub in nets else []) + [n for n in nets if n not in (sub, well)] + ([well] if well in nets else [])
        # lower row at y0 = 0 for its heads, shifted so the stripe starts at `base`
        lowest = 0
        if nlow:
            lowest = min(b.y0 for b in nlow) - RING_GAP - RING_M1 - 110
        ring_top = HEAD + RING_GAP + RING_M1 if nlow else HEAD
        if has_pnp:
            lowest = min(lowest, ring_top - bh(pb))
        ys = base - lowest
        x, nbox = 0, None
        for b in nlow:
            ox = x - b.x0
            for t in b.draw(cell, ox, ys, False):
                terms.append((s, t, "n"))
            nbox = merge(nbox, (x, ys + b.y0, x + bw(b), ys + b.y1))
            x += bw(b) + ROW_GAP
            facts["blocks"].append("stripe %d lower: %s" % (s, getattr(b, "label", None) or b.dev["name"]))
        low_top = ys + HEAD
        if nbox:
            ring = tap_ring(cell, grow(nbox, RING_GAP), "p", "top")
            cell.paint("pwell", ring[0] - 110, ring[1] - 110, ring[2] + 110, ring[3] + 110)
            terms.append((s, (sub, ring[0] + RING_M1 // 2, ring[3] - RING_M1 // 2), "n"))
            low_top = ring[3]
            x = ring[2] + GROUP_GAP
        if has_pnp:
            for net, tx, ty in pb.draw(cell, x, low_top):
                terms.append((s, (sub if net == "__sub__" else net, tx, ty), "n"))
            facts["pnp"] = dict(units=len(pb.units), layout=pb.layout, cell=pb.spec["cell"], placedNm=pb.placed)
            facts["blocks"].append("stripe %d lower: PNP %s" % (s, pb.layout))
        track_y = {net: low_top + TRACK_PITCH + i * TRACK_PITCH for i, net in enumerate(order)}
        chan_top = (track_y[order[-1]] if order else low_top) + TRACK_W // 2
        tracks_y.append(track_y)
        stripe_nets.append(order)
        # upper row
        yp = chan_top + 750 + RING_M1 + RING_GAP + HEAD
        top_edge = chan_top
        x, pbox = 0, None
        for b in [b for b in up if isinstance(b, MosBlock)]:
            ox = x - b.x0
            for t in b.draw(cell, ox, yp, True):
                terms.append((s, t, "p"))
            pbox = merge(pbox, (x, yp - b.y1, x + bw(b), yp - b.y0))
            x += bw(b) + ROW_GAP
            facts["blocks"].append("stripe %d upper: %s" % (s, b.label))
        if pbox:
            ring = tap_ring(cell, grow(pbox, RING_GAP), "n", "bottom")
            cell.paint("nwell", ring[0] - 130, ring[1] - 130, ring[2] + 130, ring[3] + 130)
            terms.append((s, (well, ring[0] + RING_M1 // 2, ring[1] + RING_M1 // 2), "p"))
            x = ring[2] + GROUP_GAP
            top_edge = max(top_edge, ring[3] + 130)
        for c in [b for b in up if isinstance(b, CapBlock)]:
            cy0 = chan_top + 750 + 2500
            for t, side in c.draw(cell, x + 600, cy0):
                terms.append((s, t, side))
            x += bw(c) + GROUP_GAP
            top_edge = max(top_edge, cy0 + c.l + 600)
            facts["blocks"].append("stripe %d upper: %s" % (s, c.dev["name"]))
        rbox = None
        x0r = x
        for b in [b for b in up if isinstance(b, ResBlock)]:
            ox = x - b.x0
            for t in b.draw(cell, ox, yp, True):
                terms.append((s, t, "p"))
            rbox = merge(rbox, (x, yp - b.y1, x + bw(b), yp - b.y0))
            x += bw(b) + ROW_GAP
            facts["blocks"].append("stripe %d upper: %s" % (s, b.dev["name"]))
        if rbox:
            ring = tap_ring(cell, grow(rbox, RING_GAP), "p", "bottom")
            cell.paint("pwell", ring[0] - 110, ring[1] - 110, ring[2] + 110, ring[3] + 110)
            terms.append((s, (sub, ring[0] + RING_M1 // 2, ring[1] + RING_M1 // 2), "p"))
            top_edge = max(top_edge, ring[3] + 110)
        base = top_edge + 3000

    # the vertical connections, the tracks and the spines
    xs = {}
    for s, (net, tx, ty), side in terms:
        if net not in tracks_y[s]:
            raise Error("net %s has no track in stripe %d" % (net, s))
        yt = tracks_y[s][net]
        xs.setdefault((s, net), []).append(tx)
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
    used = {}
    for (s, net) in xs:
        used.setdefault(net, []).append(s)
    spined = sorted(n for n, ss in used.items() if len(ss) > 1)
    left = cell.minx - 2000
    spine_x = {n: left - i * TRACK_PITCH for i, n in enumerate(spined)}
    labelled = set()
    track_ext = {}
    for s in range(nstripes):
        for net in stripe_nets[s]:
            if (s, net) not in xs:
                continue
            y = tracks_y[s][net]
            x0 = spine_x.get(net, min(xs[(s, net)])) - 300
            x1 = max(xs[(s, net)]) + 300
            if x1 - x0 < 1000:
                x1 = x0 + 1000
            cell.paint("metal3", x0, y - TRACK_W // 2, x1, y + TRACK_W // 2)
            track_ext[(s, net)] = (x0, x1)
            if net in spine_x:
                cell.paint("via3", spine_x[net] - 140, y - 140, spine_x[net] + 140, y + 140)
            if net in pins and net not in labelled:
                labelled.add(net)
                use = "power" if net == well else "ground" if net == sub else "signal"
                cell.label(net, "metal3", x0 + 50, y - 100, x0 + 250, y + 100, port=pins.index(net) + 1, use=use)
            elif net not in labelled:
                labelled.add(net)
                cell.label(net, "metal3", x0 + 50, y - 100, x0 + 250, y + 100)
    for net, sx in spine_x.items():
        ys = [tracks_y[s][net] for s in used[net]]
        cell.paint("metal4", sx - PAD, min(ys) - PAD, sx + PAD, max(ys) + PAD)
    missing = [p for p in pins if p not in labelled]
    if missing:
        raise Error("pins %s connect to no device" % ", ".join(missing))
    facts.update(tracks=stripe_nets, trackYNm=[{n: y for n, y in t.items()} for t in tracks_y],
                 trackXNm={"%d:%s" % k: v for k, v in track_ext.items()}, spines=spined, substrate=sub, well=well,
                 mos={m["dev"]["name"]: dict(model=m["dev"]["model"], wUm=m["w"] / 1000.0, lUm=m["l"] / 1000.0,
                                             fingers=[[c, w / 1000.0] for c, w in m["plan"]]) for m in mos},
                 resistors={r.dev["name"]: dict(model=r.dev["model"], wUm=r.w / 1000.0, lUm=r.length / 1000.0, bands=r.counts,
                                                segmentsUm=[x / 1000.0 for x in r.segs]) for r in res},
                 caps={c.dev["name"]: dict(model=c.dev["model"], wUm=c.w / 1000.0, lUm=c.l / 1000.0) for c in caps},
                 capModelAliases={d["name"]: d["model"] for d in devices if d["model"] in CAP_ALIASES})
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

MIM_CHECK = r"""
import pya
ly = pya.Layout()
ly.read(gds)
top = ly.top_cell()
fuse = [s.bbox() for s in top.shapes(ly.layer(75, 0)).each()]
marks = [s.bbox() for s in top.shapes(ly.layer(117, 10)).each()]
ok = sum(1 for m in marks if any(m.left == f.left and m.right == f.right and m.bottom == f.bottom for f in fuse))
print("MIM_CHECK %d %d %d" % (len(fuse), len(marks), ok))
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


PNP_CELL_DRC = "P-diffusion and N-ohmic must be over N-well or deep N-well"


def step_draw(netlist, name, out):
    pins, devices, body = read_subckt(netlist, name)
    cell, facts = build(pins, devices)
    tcl = ["drc off", "snap internal", "load %s" % name] + cell.tcl + cell.hint_tcl() + [DRAW_TAIL % dict(cell=name)]
    (out / ("%s.tcl" % name)).write_text("\n".join(tcl))
    (out / ("%s_ref.spice" % name)).write_text("* reference: subcircuit %s of %s\n%s" % (name, netlist, body))
    rc, secs = magic("%s.tcl" % name, out, out / "magic_draw.log")
    total, in_cells, rules = None, None, {}
    if (out / "drc_magic_boxes.txt").is_file():
        # The PDK's own fixed PNP cell gives "P-diffusion and N-ohmic must be over N-well or deep
        # N-well" with the PDK's Magic tech file even alone; that rule, inside a placed PNP cell, is
        # counted apart. Every other rule, and that rule anywhere else, counts.
        cells = (facts.get("pnp") or {}).get("placedNm", [])
        total, in_cells = 0, 0
        for line in (out / "drc_magic_boxes.txt").read_text().splitlines():
            parts = line.split(None, 4)
            v, why = [float(x) for x in parts[:4]], parts[4] if len(parts) > 4 else ""
            inside = why.strip() == PNP_CELL_DRC and any(c[0] <= v[0] and c[1] <= v[1] and v[2] <= c[2] and v[3] <= c[3] for c in cells)
            in_cells += inside
            total += not inside
            if not inside:
                rules[why.strip()] = rules.get(why.strip(), 0) + 1
    mim = None
    rc2 = 0
    if (out / ("%s.gds" % name)).is_file():
        (out / "mim_check.py").write_text(MIM_CHECK)
        rc2, s2 = run(["klayout", "-b", "-r", "mim_check.py", "-rd", "gds=%s.gds" % name], out, out / "klayout_mim_check.log")
        found = re.findall(r"MIM_CHECK (\d+) (\d+) (\d+)", (out / "klayout_mim_check.log").read_text())
        if found:
            plates, marks, onplate = map(int, found[0])
            mim = dict(caps=len(facts["caps"]), plates=plates, marks=marks, marksOnPlateBottomEdge=onplate,
                       ok=plates == marks == onplate == len(facts["caps"]))
        secs = round(secs + s2, 2)
    return facts, dict(rc=rc, mimCheckRc=rc2, seconds=secs, magicDrcErrors=total, magicDrcByRule=rules,
                       magicDrcInPdkPnpCells=in_cells, magicDrcInPdkPnpCellsRule=PNP_CELL_DRC, mimLengthMarks=mim, pins=pins)


def step_lvs(out, name):
    rc1, s1 = extract(out, name, "lvs", "extract do local", "ext2spice lvs\next2spice -o ../%s_lvs.spice" % name)
    fixed = fix_pnp_names(out / ("%s_lvs.spice" % name)) if (out / ("%s_lvs.spice" % name)).is_file() else []
    notes = lvs_reference(out / ("%s_ref.spice" % name), name, out / ("%s_ref_netgen.spice" % name))
    rc2, s2 = run(["netgen", "-batch", "lvs", "%s_lvs.spice %s" % (name, name), "%s_ref_netgen.spice %s" % (name, name), NETGEN_SETUP,
                   "lvs.out", "-json"], out, out / "netgen.log")
    text = (out / "lvs.out").read_text() if (out / "lvs.out").is_file() else ""
    match = "Circuits match uniquely." in text and "Property errors were found" not in text and "do not match" not in text
    final = re.findall(r"^(Final result:.*|Circuits match uniquely\.|Netlists do not match\.|.*Property errors.*)$", text, re.M)
    mismatch = "do not match" in text or "Property errors were found" in text
    return dict(rc=[rc1, rc2], seconds=round(s1 + s2, 2), match=match, mismatch=mismatch, verdict=match or mismatch,
                lines=sorted(set(final)), referenceNotes=notes, pnpNameCorrections=len(fixed), pnpNameCorrectionExamples=fixed[:3],
                pnpSizeCheck="circular: the PNP name comes from the placed PDK cell; see klayoutLvs for the geometric check")


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
    mismatch = "Netlists don't match" in log
    lines = sorted(set(l.split(" : ", 1)[-1].strip() for l in log.splitlines() if "Netlists" in l and ("match" in l or "don't" in l)))
    return dict(rc=rc, seconds=secs, match=match, mismatch=mismatch, verdict=match != mismatch, lines=lines,
                pnpSizeCheck="geometric: the deck extracts each PNP from the drawn layers")


SUBSTRATE_PORTS = ("VSUBS", "vsubs", "SUB", "sub!")


def check_ports(path, name, pins, substrate):
    """The extracted subcircuit's ports must be exactly the reference pins. A substrate port Magic
    adds (VSUBS) is mapped to the substrate net, which must be a pin, and recorded; anything else is
    an error. Returns (ok, notes)."""
    text = Path(path).read_text()
    m = re.search(r"(?im)^\.subckt\s+%s\s+([^\n]*)$" % re.escape(name), text)
    if not m:
        return False, ["%s: no .subckt %s" % (Path(path).name, name)]
    ports = [t for t in m.group(1).split() if "=" not in t]
    notes = []
    extra = [p for p in ports if p not in pins]
    for p in extra:
        if p in SUBSTRATE_PORTS and substrate in pins:
            text = re.sub(r"(?<![\w.])%s(?![\w.])" % re.escape(p), substrate, text)
            notes.append("%s: Magic's substrate port %s mapped to %s" % (Path(path).name, p, substrate))
    if notes:
        m = re.search(r"(?im)^\.subckt\s+%s\s+([^\n]*)$" % re.escape(name), text)
        kept, seen = [], set()
        for t in m.group(1).split():
            if t not in seen:
                kept.append(t)
                seen.add(t)
        text = text[:m.start(1)] + " ".join(kept) + text[m.end(1):]
        Path(path).write_text(text)
        ports = [t for t in kept if "=" not in t]
    ok = sorted(ports) == sorted(pins)
    if not ok:
        notes.append("%s: ports %s, the reference pins %s" % (Path(path).name, " ".join(ports), " ".join(pins)))
    return ok, notes


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
cell_box = lv.active_cellview().layout().top_cell().dbbox()
open(png + ".bbox", "w").write("%.3f %.3f\n" % (cell_box.width(), cell_box.height()))
box = cell_box.enlarged(2.0, 2.0)
lv.zoom_box(box)
h = 2000
lv.save_image_with_options(png, int(h * box.width() / box.height()), h, 0, 0, 0, box, False)
"""


def step_render(out, name):
    (out / "render.py").write_text(RENDER)
    rc, secs = run(["klayout", "-zz", "-r", "render.py", "-rd", "gds=%s.gds" % name, "-rd", "png=%s.png" % name,
                    "-rd", "lyp=" + KLAYOUT_TECH + "/gf180mcu.lyp"], out, out / "klayout_render.log")
    bbox = out / ("%s.png.bbox" % name)
    size = [float(x) for x in bbox.read_text().split()] if bbox.is_file() else None
    return dict(rc=rc, seconds=secs, png=(out / ("%s.png" % name)).is_file(), bboxUm=size)


LIMITATIONS = [
    "netgen's PNP size check is circular: the size comes from the placed PDK cell's name (the "
    "rename of Magic's pnp_10p00x00p42); KLayout LVS derives each PNP from the layout geometry and "
    "is the independent check.",
    "A MIM capacitor named for another metal stack (cap_mim_2f0_m2m3_noshield) is compared as "
    "gf180mcuD's cap_mim_2f0_m4m5_noshield: the same 2 fF/um2 model in sm141064_mim.spice, but the "
    "reference names a stack the layout does not have.",
    "Poly-only dummies; resistors, mirrors and capacitors are not interdigitated.",
]


def cmd_all(netlist, name, out_dir, extra=None, allowed=()):
    out = Path(out_dir).resolve()
    if out.exists() and any(p.name not in allowed for p in out.iterdir()):
        raise Error("the output folder %s is not empty: give a new one" % out)
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

    failures = []
    rcs = dict(magicDraw=draw["rc"], mimCheck=draw["mimCheckRc"], klayoutDrcBlock=result["klayoutDrc"]["block"]["rc"],
               klayoutDrcDensity=result["klayoutDrc"]["density"]["rc"], magicLvsExtract=result["lvs"]["rc"][0],
               netgen=result["lvs"]["rc"][1], klayoutLvs=result["klayoutLvs"]["rc"], magicPexC=result["pex"]["rc"][0],
               magicPexRc=result["pex"]["rc"][1], klayoutRender=result["render"]["rc"])
    failures += ["%s exited %s" % (k, v) for k, v in rcs.items() if v != 0]
    products = ["%s.gds" % name, "%s_lvs.spice" % name, "lvs.out", "%s_pex_c.spice" % name, "%s_pex_rc.spice" % name,
                "%s.png" % name, "drc_klayout_block.lyrdb", "drc_klayout_density.lyrdb", "klayout_lvs/%s.cir" % name]
    failures += ["%s was not written" % p for p in products if not (out / p).is_file()]
    if draw["magicDrcErrors"] is None:
        failures.append("Magic DRC wrote no result")
    if not (draw["mimLengthMarks"] or {}).get("ok", False):
        failures.append("MIM length markers %s do not match the capacitors" % draw["mimLengthMarks"])
    if not result["lvs"]["verdict"]:
        failures.append("netgen printed no verdict")
    if not result["klayoutLvs"]["verdict"]:
        failures.append("KLayout LVS printed no verdict")
    ports = {}
    pins = draw["pins"]
    for tag, f in (("lvs", "%s_lvs.spice" % name), ("pexC", "%s_pex_c.spice" % name), ("pexRc", "%s_pex_rc.spice" % name)):
        if (out / f).is_file():
            ok, notes = check_ports(out / f, name, pins, facts.get("substrate"))
            ports[tag] = dict(ok=ok, notes=notes)
            if not ok:
                failures.append("; ".join(notes))
    result.update(rcs=rcs, ports=ports, failures=failures, ok=not failures, limitations=LIMITATIONS,
                  verdict=dict(magicDrcClean=draw["magicDrcErrors"] == 0, klayoutDrcBlockClean=result["klayoutDrc"]["block"]["total"] == 0,
                               netgenMatch=result["lvs"]["match"], klayoutLvsMatch=result["klayoutLvs"]["match"]))
    result["totalSeconds"] = round(time.time() - t0, 2)
    (out / "layout.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    brief = dict(ok=not failures, failures=failures, magicDrc=draw["magicDrcErrors"], magicDrcInPdkPnpCells=draw["magicDrcInPdkPnpCells"],
                 klayoutDrcBlock=result["klayoutDrc"]["block"]["total"], klayoutDrcDensity=result["klayoutDrc"]["density"]["total"],
                 netgenLvs=result["lvs"]["match"], pnpNameCorrections=result["lvs"]["pnpNameCorrections"],
                 klayoutLvs=result["klayoutLvs"]["match"], mim=draw["mimLengthMarks"], ports={k: v["ok"] for k, v in ports.items()},
                 pex=result["pex"]["netlists"], blocks=facts["blocks"],
                 seconds=dict(draw=draw["seconds"], klayoutDrc=result["klayoutDrc"]["block"]["seconds"],
                              netgenLvs=result["lvs"]["seconds"], klayoutLvs=result["klayoutLvs"]["seconds"],
                              pex=result["pex"]["seconds"], render=result["render"]["seconds"], total=result["totalSeconds"]))
    print(json.dumps(brief, indent=1, sort_keys=True))
    return result


def main(argv):
    if len(argv) >= 5 and argv[1] in ("all", "draw"):
        if argv[1] == "all":
            return 0 if cmd_all(argv[2], argv[3], argv[4])["ok"] else 4
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
