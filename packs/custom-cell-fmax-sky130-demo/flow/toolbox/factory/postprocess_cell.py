# Factory copy of celluzi generate/postprocess_cell.py (source + sha256 in factory/SOURCES.md).
# Factory additions are marked "FACTORY": 0 (edge margin + site snap), 3b (label filter), 4a (contact enclosure
# pads), 4 (min-area repair) and the JSON report.
# Run: klayout -b -rd gds=<file> [-rd report=<pp.json>] [-rd pins=A,B,Y,VDD,GND] [-rd site=460]
#      [-rd minarea=0] [-rd enclosure=0] -r postprocess_cell.py
# sky130 GDS post-process for lclayout output. Two jobs:
#   1. clean_gates(): make every gate's poly&diff a clean rectangle. The router sometimes drops a gate
#      contact (170nm licon + 50nm poly enclosure = 270nm pad) ON TOP of the diffusion; that pad makes
#      poly&diff an 8-vertex L-shape and Magic mis-extracts the FET as w=0.23 l=0.05. We trim the pad
#      material that sits over active back to the gate strip and delete the over-diff gate contact (the
#      gate stays connected through the contact in the clean channel).
#   2. implants: lclayout only draws nplus/pplus for well taps, so add explicit nsdm/psdm over the
#      transistor diffusion (needed for sky130 device typing + DRC).
# Run: klayout -b -rd gds=<file> -rm postprocess_cell.py   (edits the GDS in place)
import pya
ly = pya.Layout(); ly.read(gds); top = ly.top_cell(); dbu = ly.dbu
def R(l, d): return pya.Region(top.begin_shapes_rec(ly.layer(l, d)))
def put(reg, l, d):
    reg.merge(); s = top.shapes(ly.layer(l, d)); s.clear(); s.insert(reg)
def add(reg, l, d):
    reg.merge(); top.shapes(ly.layer(l, d)).insert(reg)

# ---- 0. FACTORY: keep metal off the cell edge, snap the cell width to the sky130hd site (0.46 um) ----
# Abutment: LibreCell routes on the x = 0 grid column, so li1/met1 can sit on (or past) the left edge
# and touch the next cell's metal. Like sky130_fd_sc_hd, every li1 / met1 / met2 / poly shape between
# the rails keeps half its layer's spacing from the left and right edges (li 0.085, met1/met2 0.07,
# poly 0.105): the layout is moved right by what the left edge lacks (rounded up to 5 nm) and the width
# is grown so the right edge has its margin too. The factory tech uses a 0.50 um gate pitch, so
# lclayout's width is generally not a site multiple either. Every full-width shape (rails, rail pins,
# n-well, boundary) is extended at both edges to the new outline.
site = int(globals().get("site", "460"))
EDGE_MARGIN = {(67, 20): 85, (68, 20): 70, (69, 20): 70, (66, 20): 105}
_bnd = pya.Region(top.begin_shapes_rec(ly.layer(235, 4))).bbox()
snap_dx = 0
shift_dx = 0


def _extend_full_width(x_lo, x_hi, new_lo, new_hi):
    """Extrude every shape spanning [x_lo, x_hi] to [new_lo, new_hi] (profile taken at each edge)."""
    for li_ in ly.layer_indexes():
        shapes = top.shapes(li_)
        ext = []
        for sh in shapes.each():
            if sh.is_text():
                continue
            b = sh.bbox()
            if b.left <= x_lo and b.right >= x_hi:
                if new_hi > b.right:
                    edge = pya.Region(sh.polygon) & pya.Region(pya.Box(x_hi - 5, b.bottom - 1, x_hi, b.top + 1))
                    ext += [pya.Box(e.bbox().left, e.bbox().bottom, new_hi, e.bbox().top) for e in edge.each()]
                if new_lo < b.left:
                    edge = pya.Region(sh.polygon) & pya.Region(pya.Box(x_lo, b.bottom - 1, x_lo + 5, b.top + 1))
                    ext += [pya.Box(new_lo, e.bbox().bottom, e.bbox().right, e.bbox().top) for e in edge.each()]
        for e in ext:
            shapes.insert(e)
        if ext:
            texts = [t.text for t in shapes.each() if t.is_text()]      # pya.Text objects
            reg = pya.Region(shapes)
            reg.merge(); shapes.clear(); shapes.insert(reg)
            for t in texts:
                shapes.insert(t)


if site > 0 and not _bnd.empty():
    W0 = _bnd.right
    band = pya.Box(_bnd.left - 2000, 240, _bnd.right + 2000, 2480)     # between the rails
    lo_need, hi_edge = 0, W0
    for (l_, d_), m_ in EDGE_MARGIN.items():
        reg = pya.Region(top.begin_shapes_rec(ly.layer(l_, d_))) & pya.Region(band)
        if reg.is_empty():
            continue
        bb = reg.bbox()
        lo_need = max(lo_need, m_ - (bb.left - _bnd.left))
        hi_edge = max(hi_edge, bb.right + m_)
    if lo_need > 0:
        shift_dx = -(-lo_need // 5) * 5
        for li_ in ly.layer_indexes():
            top.shapes(li_).transform(pya.Trans(shift_dx, 0))
        _extend_full_width(_bnd.left + shift_dx, W0 + shift_dx, _bnd.left, W0 + shift_dx)
    W1 = -(-(hi_edge + shift_dx) // site) * site
    snap_dx = W1 - (W0 + shift_dx)
    if snap_dx:
        _extend_full_width(_bnd.left, W0 + shift_dx, _bnd.left, W1)
    print("edge margin: moved right %d nm; site snap: width %d -> %d (+%d nm)" % (shift_dx, W0, W1, W1 - W0))

diff  = R(65, 20)
nwell = R(64, 20)
poly  = R(66, 20)
licon = R(66, 44)
gate_w = int(round(0.150 / dbu))     # nominal gate/poly width
half   = gate_w // 2                 # gate column half-width (=75nm, on the 5nm grid; contact is gate-centered)

# ---- 1. clean the gates -------------------------------------------------------------------------
# The only jog Magic can't extract is a gate CONTACT sitting fully over the active (its 270nm poly pad
# widens poly&diff to an L). Target exactly those: for each such contact, keep the ~150nm gate column
# through it and trim the pad wings that overhang the diffusion, then delete the contact (the gate stays
# tied through its clean channel contact). Contacts merely NEAR the diff edge (pad grazes it) are left
# alone — Magic extracts those fine.
bad_pc = licon.interacting(poly).interacting(diff)   # gate contacts (on poly) sitting over active
if not bad_pc.is_empty():
    new_poly = poly.dup()
    for pc in bad_pc.each():
        b = pc.bbox(); cx = (b.left + b.right) // 2
        band = pya.Region(pya.Box(cx - half, -10**7, cx + half, 10**7))   # gate column to keep
        near = pya.Region(b.enlarged(120, 120))                            # localize to this contact
        new_poly = new_poly - ((poly & diff & near) - band)                # trim pad wings over active
    put(new_poly, 66, 20)
    put(licon - bad_pc, 66, 44)
    print("clean_gates: fixed %d over-diff gate contact(s)" % bad_pc.size())
else:
    print("clean_gates: no over-diff gate contacts (already clean)")

# ---- 2. implants --------------------------------------------------------------------------------
cell = R(235, 4)
if cell.is_empty():
    cell = pya.Region(top.bbox())
add(nwell & cell, 94, 20)      # psdm  (p+ implant, PMOS region)
add(nwell & cell, 78, 44)      # hvtp: sky130hd pfets are HIGH-VT (the CDL says pfet_01v8_hvt).
                               # Without this implant Magic extracts plain pfet_01v8, which (a)
                               # netgen's sky130A setup does not register (black-box -> LVS
                               # chaos) and (b) mis-models the device: char would use a faster
                               # pull-up than the foundry cell this was derived from.
add(cell - nwell, 93, 44)      # nsdm  (n+ implant, NMOS region)

# ---- 2b. FACTORY: poly pads (licon.8a) and npc (licon.15 / npc.1 / npc.2) ---------------------------
# lclayout draws a 0.27 x 0.27 poly pad (0.05 all round) under every gate contact; licon.8a needs 0.08
# on two opposite sides. Grow the pad vertically (then horizontally) when poly.2 (0.21) to other poly
# and poly.4 (0.075) to diffusion still hold. Then cover every poly licon with npc (0.1 enclosure),
# closing gaps below npc.2 (0.27) so neighbouring contacts share one npc shape.
# licon.14 / licon.9: a gate licon must sit >= 0.19 from ndiff and >= 0.235 from pdiff (psdm, which
# encloses pdiff by 0.125, must stay 0.11 from it). lclayout centres it on the 1.19 um channel track,
# 0.21 from the pdiff; move each channel gate licon down (5 nm grid) into the legal window and extend
# its li1 landing (x pair 0.08) to cover it; skip a move that would break li1 spacing.
licon_shift = []
_poly0 = R(66, 20); _poly0.merge()
_lic0 = R(66, 44); _lic0.merge()
_diff0 = R(65, 20); _diff0.merge()
_nw0 = R(64, 20)
_nd, _pd = _diff0 - _nw0, _diff0 & _nw0
_g5 = int(round(0.005 / dbu))
_li = R(67, 20); _li.merge()
_li_sp = int(round(0.17 / dbu))
_e08 = int(round(0.08 / dbu))
_moves = []
licon_shift_skipped = []
# Probe kept for the record, OFF by default (-rd liconshift=1): with transistor_offset_y 235 it moved
# the licons but traded licon.9 for li.3 / m1.2 / licon.5c markers (2026-10-04, runs/t9-t11).
do_shift = str(globals().get("liconshift", "0")) in ("1", "true")
for c in ((_lic0 & _poly0).each() if do_shift else []):
    cb = c.bbox()
    col = pya.Region(pya.Box(cb.left, -10**7, cb.right, 10**7))
    below = [p.bbox().top for p in (_nd & col).each() if p.bbox().top <= cb.bottom]
    above = [p.bbox().bottom for p in (_pd & col).each() if p.bbox().bottom >= cb.top]
    if not below or not above:
        continue
    ny, py = max(below), min(above)
    hi = py - int(round(0.235 / dbu))          # licon top limit
    lo = ny + int(round(0.19 / dbu))           # licon bottom limit
    if cb.top <= hi:
        continue
    dy = cb.top - hi
    dy = ((dy + _g5 - 1) // _g5) * _g5
    nb = cb.moved(0, -dy)
    if nb.bottom < lo:
        licon_shift_skipped.append({"at_um": [cb.left * dbu, cb.bottom * dbu], "why": "window too small"})
        continue
    own = _li.interacting(pya.Region(cb))
    land = pya.Box(nb.left - _e08, nb.bottom, nb.right + _e08, nb.top)
    others = _li - own
    # ignore other contacts' li1 overhang beyond their licon in y (0 is enough there when the x pair
    # has 0.08); step 4b trims that overhang if it ends up too close
    for oc in _lic0.each():
        ob = oc.bbox()
        if ob == cb:
            continue
        others -= pya.Region(pya.Box(ob.left - _e08, ob.top, ob.right + _e08, ob.top + _e08 + _g5))
        others -= pya.Region(pya.Box(ob.left - _e08, ob.bottom - _e08 - _g5, ob.right + _e08, ob.bottom))
    hit = pya.Region(land).sized(_li_sp - 1) & others
    if not hit.is_empty():
        hb = hit.bbox()
        licon_shift_skipped.append({"at_um": [cb.left * dbu, cb.bottom * dbu], "why": "li1 spacing",
                                    "near_um": [hb.left * dbu, hb.bottom * dbu, hb.right * dbu, hb.top * dbu]})
        continue
    _moves.append((cb, nb, land))
if _moves:
    lic_r = R(66, 44)
    li_r = R(67, 20)
    for cb, nb, land in _moves:
        lic_r = (lic_r - pya.Region(cb)) + pya.Region(nb)
        li_r = li_r + pya.Region(land)
        licon_shift.append({"from_um": [cb.left * dbu, cb.bottom * dbu, cb.right * dbu, cb.top * dbu],
                            "to_um": [nb.left * dbu, nb.bottom * dbu, nb.right * dbu, nb.top * dbu]})
    put(lic_r, 66, 44)
    put(li_r, 67, 20)
print("gate licon shift: moved %d" % len(licon_shift))

poly = R(66, 20); poly.merge()
licon_now = R(66, 44)
diff_now = R(65, 20)
poly_lic = licon_now & poly
e05, e08 = int(round(0.05 / dbu)), int(round(0.08 / dbu))
sp_pp, sp_pd = int(round(0.21 / dbu)), int(round(0.075 / dbu))
poly_pads, poly_unfixed = [], []
for c in poly_lic.each():
    cb = c.bbox()
    own = poly.interacting(pya.Region(cb))
    cands = [pya.Box(cb.left - e05, cb.bottom - e08, cb.right + e05, cb.top + e08),
             pya.Box(cb.left - e08, cb.bottom - e05, cb.right + e08, cb.top + e05)]
    if any((pya.Region(b) - own).is_empty() for b in cands):
        continue
    others = poly - own
    placed = False
    for b in cands:
        add_r = pya.Region(b) - own
        if not (add_r.sized(sp_pp - 1) & others).is_empty():
            continue
        if not ((add_r - diff_now).sized(sp_pd - 1) & diff_now).is_empty() or not (add_r & diff_now).is_empty():
            continue
        poly.insert(b); poly.merge()
        poly_pads.append([b.left * dbu, b.bottom * dbu, b.right * dbu, b.top * dbu])
        placed = True
        break
    if not placed:
        poly_unfixed.append([cb.left * dbu, cb.bottom * dbu, cb.right * dbu, cb.top * dbu])
if poly_pads:
    put(poly, 66, 20)
npc_d, npc_close = int(round(0.10 / dbu)), int(round(0.135 / dbu))
npc = poly_lic.sized(npc_d)
npc.merge()
npc = npc.sized(npc_close).sized(-npc_close)
if not npc.is_empty():
    put(npc, 95, 20)
# licon.9: a poly licon keeps 0.11 to psdm. psdm was drawn as n-well & cell, which starts 0.18 below the
# pdiff; cut it back to a straight edge 0.11 above the highest channel gate licon (psdm.5a, 0.125
# enclosure of pdiff, is then checked by DRC like everything else).
psdm_cut_um = None
pdiff = diff_now & nwell
if do_shift and not poly_lic.is_empty() and not pdiff.is_empty():
    cellb = R(235, 4).bbox() if not R(235, 4).is_empty() else top.bbox()
    pbot = pdiff.bbox().bottom
    tops = [c.bbox().top for c in poly_lic.each() if c.bbox().top <= pbot]
    if tops:
        ycut = min(max(tops) + int(round(0.11 / dbu)), pbot - int(round(0.125 / dbu)))  # keep psdm.5a
        band = pya.Region(pya.Box(cellb.left - 1000, cellb.bottom - 1000, cellb.right + 1000, ycut))
        put(R(94, 20) - band, 94, 20)
        psdm_cut_um = ycut * dbu
print("poly pads: grew %d, %d unfixed; npc: %d shape(s); psdm cut at %s" % (
    len(poly_pads), len(poly_unfixed), npc.count(), psdm_cut_um))

# ---- 3. strip scattered net labels ---------------------------------------------------------------
# lclayout writes the net name as a TEXT label on EVERY shape of the net (diff/poly/li1/met1). Magic's
# label->port binding then gets confused and silently drops some I/O nets (they come back as a_..._#).
# Keep only the clean single pin label per I/O net on met1_lbl (68/5) / li1_lbl (67/5); drop the rest.
# pya.Region(shapes) collects polygons/paths and ignores text, so re-inserting it erases the labels.
before = sum(1 for (l, d) in [(65,20),(66,20),(66,44),(67,20),(67,44),(68,20)]
             for s in top.shapes(ly.layer(l, d)).each() if s.is_text())
for (l, d) in [(65,20),(66,20),(66,44),(67,20),(67,44),(68,20)]:
    idx = ly.layer(l, d)
    reg = pya.Region(top.shapes(idx))
    top.shapes(idx).clear(); top.shapes(idx).insert(reg)
print("stripped %d scattered net labels (kept pin labels on 68/5,67/5)" % before)

# ---- 3b. FACTORY: keep only pin-name labels on the label layers --------------------------------
# lclayout also labels internal nets on met2 (69/20) and the label purposes; Magic's `port makeall`
# then turns e.g. n1_i0 into a subckt port and netgen fails pin matching. Keep a text only if it is
# on 67/5, 68/5 or 69/5 and names a cell pin (signal or rail).
pinset = {p.strip().upper() for p in str(globals().get("pins", "")).split(",") if p.strip()}
dropped_labels = 0
if pinset:
    for li_ in ly.layer_indexes():
        info = ly.get_info(li_)
        shapes = top.shapes(li_)
        keep_layer = (info.layer, info.datatype) in ((67, 5), (68, 5), (69, 5))
        bad = [sh for sh in shapes.each() if sh.is_text() and
               (not keep_layer or sh.text_string.upper() not in pinset)]
        for sh in bad:
            shapes.erase(sh)
        dropped_labels += len(bad)
print("label filter: dropped %d non-pin labels" % dropped_labels)

# ---- 4a. FACTORY: contact enclosure pads ---------------------------------------------------------
# sky130 needs, besides an all-round enclosure, a larger enclosure on two opposite sides of every cut:
# li.5 li1 over licon 0.08; m1.4/m1.5 met1 over mcon 0.03/0.06; via.4a/via.5a met1 over via 0.055/
# 0.085; m2.4/m2.5 met2 over via 0.055/0.085. lclayout draws li1/met1 wires exactly as wide as the
# cut. For each cut whose metal does not already cover a vertical or horizontal pad, add the smaller
# pad that keeps the layer spacing to all other polygons and stays inside the cell.
ENC_RULES = [  # cut (l,d), metal (l,d), name, all-round um, opposite-pair um, metal spacing um
    ((66, 44), (67, 20), "li1/licon", 0.0, 0.08, 0.17),
    ((67, 44), (68, 20), "met1/mcon", 0.03, 0.06, 0.14),
    ((68, 44), (68, 20), "met1/via", 0.055, 0.085, 0.14),
    ((68, 44), (69, 20), "met2/via", 0.055, 0.085, 0.14),
]
enc_added, enc_unfixed = [], []
do_enc = str(globals().get("enclosure", "1")) not in ("0", "false")
_cellb = pya.Region(top.begin_shapes_rec(ly.layer(235, 4))).bbox()
for (cut_ld, met_ld, rname, e_all, e_pair, space) in (ENC_RULES if do_enc else []):
    cuts = pya.Region(top.begin_shapes_rec(ly.layer(*cut_ld))); cuts.merge()
    midx = ly.layer(*met_ld)
    met = pya.Region(top.begin_shapes_rec(midx)); met.merge()
    ea, ep, sp = int(round(e_all / dbu)), int(round(e_pair / dbu)), int(round(space / dbu))
    pads = pya.Region()
    for c in cuts.each():
        cb = c.bbox()
        own = met.interacting(pya.Region(cb))
        if own.is_empty():
            continue                        # cut not on this metal (e.g. via1 for li1) -- other rule
        cands = [pya.Box(cb.left - ea, cb.bottom - ep, cb.right + ea, cb.top + ep),
                 pya.Box(cb.left - ep, cb.bottom - ea, cb.right + ep, cb.top + ea)]
        if any((pya.Region(b) - own).is_empty() for b in cands):
            continue
        others = (met - own) + pads.not_interacting(own)
        ok = []
        for b in cands:
            if not (_cellb.contains(b.p1) and _cellb.contains(b.p2)) and not _cellb.empty():
                # pads may not leave the cell outline except over the rails (y outside is rail metal)
                if b.left < _cellb.left or b.right > _cellb.right:
                    continue
            grown = (own + pya.Region(b)).merged()
            if not (pya.Region(b).sized(sp - 1) & others).is_empty():
                continue
            ok.append(((pya.Region(b) - own).area(), b))
        if not ok:
            enc_unfixed.append({"rule": rname, "cut_um": [cb.left * dbu, cb.bottom * dbu, cb.right * dbu, cb.top * dbu]})
            continue
        ok.sort(key=lambda t: t[0])
        b = ok[0][1]
        pads.insert(b)
        met.insert(b); met.merge()
        enc_added.append({"rule": rname, "layer": {(67, 20): "li1", (68, 20): "met1", (69, 20): "met2"}[met_ld],
                          "rect_um": [b.left * dbu, b.bottom * dbu, b.right * dbu, b.top * dbu]})
    if not pads.is_empty():
        top.shapes(midx).insert(pads)
print("enclosure: added %d pad(s), %d cut(s) unfixed" % (len(enc_added), len(enc_unfixed)))

# ---- 4a2. FACTORY: same-net gap fill ----------------------------------------------------------------
# lclayout places pin squares and via pads without the metal spacing to neighbours of the SAME net
# (e.g. a met1 pin 0.07 um from the via pad it is wired to). Bridging a same-net gap is electrically
# neutral and removes the m1.2 / m2.2 / li.3 marker. Nets are traced over poly-licon-li-mcon-met1-via-met2
# (diffusion is excluded: one diff polygon spans several devices).
MIN_WIDTH = {(67, 20): 0.17, (68, 20): 0.14, (69, 20): 0.14}
SPACE = {(67, 20): 0.17, (68, 20): 0.14, (69, 20): 0.14}
def trace_nets():
    conds = [(66, 20), (67, 20), (68, 20), (69, 20)]
    cutmap = [((66, 44), (66, 20), (67, 20)), ((67, 44), (67, 20), (68, 20)), ((68, 44), (68, 20), (69, 20))]
    polys = {}
    for ld in conds:
        r = pya.Region(top.begin_shapes_rec(ly.layer(*ld))); r.merge()
        polys[ld] = list(r.each())
    parent = {}
    def find(x):
        while parent.setdefault(x, x) != x:
            parent[x] = parent.setdefault(parent[x], parent[x]); x = parent[x]
        return x
    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb
    for (cut_ld, lo, hi) in cutmap:
        cr = pya.Region(top.begin_shapes_rec(ly.layer(*cut_ld))); cr.merge()
        for c in cr.each():
            cregion = pya.Region(c)
            los = [i for i, p in enumerate(polys[lo]) if not (pya.Region(p) & cregion).is_empty()]
            his = [i for i, p in enumerate(polys[hi]) if not (pya.Region(p) & cregion).is_empty()]
            for i in los:
                for j in his:
                    union((lo, i), (hi, j))
    return polys, find
gap_filled, gap_unfilled = [], []
do_fill = str(globals().get("gapfill", "1")) not in ("0", "false")
def gap_fill():
    polys, find = trace_nets()
    n = 0
    for ld in ((67, 20), (68, 20), (69, 20)):
        idx = ly.layer(*ld)
        sp = int(round(SPACE[ld] / dbu))
        reg = pya.Region(top.begin_shapes_rec(idx)); reg.merge()
        plist = polys[ld]
        fills = pya.Region()
        for ep_ in reg.space_check(sp).each():
            e1, e2 = ep_.first, ep_.second
            ia = [i for i, p in enumerate(plist) if not pya.Region(p).interacting(pya.Edges(e1)).is_empty()]
            ib = [i for i, p in enumerate(plist) if not pya.Region(p).interacting(pya.Edges(e2)).is_empty()]
            if not ia or not ib or find((ld, ia[0])) != find((ld, ib[0])):
                gap_unfilled.append({"layer": "%d/%d" % ld, "edge_pair_um": str(ep_.transformed(pya.ICplxTrans(dbu)))})
                continue
            fb = ep_.polygon(0).bbox()
            if fb.empty() or fb.width() <= 0 or fb.height() <= 0:
                continue
            g5 = int(round(0.005 / dbu))      # snap outward to the 5 nm manufacturing grid
            fb = pya.Box((fb.left // g5) * g5, (fb.bottom // g5) * g5,
                         -((-fb.right) // g5) * g5, -((-fb.top) // g5) * g5)
            fill = pya.Region(fb)
            pair = (pya.Region(plist[ia[0]]) + pya.Region(plist[ib[0]])).merged()
            joined = (pair + fill).merged()
            if sum(p_.holes() for p_ in joined.each()) > sum(p_.holes() for p_ in pair.each()):
                gap_unfilled.append({"layer": "%d/%d" % ld, "edge_pair_um": str(ep_.transformed(pya.ICplxTrans(dbu))),
                                     "why": "would enclose a hole"})
                continue
            others = reg - reg.interacting(pya.Region(plist[ia[0]])) - reg.interacting(pya.Region(plist[ib[0]]))
            if not (fill.sized(sp - 1) & others).is_empty():
                gap_unfilled.append({"layer": "%d/%d" % ld, "edge_pair_um": str(ep_.transformed(pya.ICplxTrans(dbu)))})
                continue
            fills.insert(fb)
            gap_filled.append({"layer": "%d/%d" % ld, "rect_um": [fb.left * dbu, fb.bottom * dbu, fb.right * dbu, fb.top * dbu]})
            n += 1
        if not fills.is_empty():
            top.shapes(idx).insert(fills.merged())
    return n
if do_fill:
    gap_fill()
print("gap fill: bridged %d same-net gap(s), %d other gap(s)" % (len(gap_filled), len(gap_unfilled)))

# ---- 4b. FACTORY: trim over-sized via pads that violate metal spacing --------------------------------
# lclayout draws a via landing pad with the x enclosure on all four sides; next to a rail or another
# pad that extra overhang breaks m1.2 / m2.2 / li.3. For each cut, an overhang strip (beyond the
# all-round enclosure) on one side is removed when it is within spacing of another polygon, provided
# the pad keeps the opposite-pair enclosure on the other axis and the polygon does not split (the
# strip is not a wire continuing past the pad).
trimmed, trim_failed = [], []
do_trim = str(globals().get("trim", "1")) not in ("0", "false")
for (cut_ld, met_ld, rname, e_all, e_pair, space) in (ENC_RULES if do_trim else []):
    cuts = pya.Region(top.begin_shapes_rec(ly.layer(*cut_ld))); cuts.merge()
    midx = ly.layer(*met_ld)
    met = pya.Region(top.begin_shapes_rec(midx)); met.merge()
    ea, ep, sp = int(round(e_all / dbu)), int(round(e_pair / dbu)), int(round(space / dbu))
    wmin = int(round(MIN_WIDTH[met_ld] / dbu))
    changed = False
    # enclosure each cut currently satisfies -- a trim for one cut must not eat into another's
    protect = {}
    for c in cuts.each():
        cb = c.bbox()
        pv = pya.Box(cb.left - ea, cb.bottom - ep, cb.right + ea, cb.top + ep)
        ph = pya.Box(cb.left - ep, cb.bottom - ea, cb.right + ep, cb.top + ea)
        got = [b for b in (pv, ph) if (pya.Region(b) - met).is_empty()]
        protect[(cb.left, cb.bottom)] = pya.Region(got[0] if got else cb.enlarged(ea, ea))
    for c in cuts.each():
        cb = c.bbox()
        own = met.interacting(pya.Region(cb))
        if own.is_empty():
            continue
        others = met - own
        if (own.sized(sp - 1) & others).is_empty():
            continue                                     # this pad has no spacing problem
        big = 10 * ep
        sides = {
            "bottom": (pya.Box(cb.left - big, cb.bottom - big, cb.right + big, cb.bottom - ea),
                       pya.Box(cb.left - ep, cb.bottom - ea, cb.right + ep, cb.top + ea)),
            "top": (pya.Box(cb.left - big, cb.top + ea, cb.right + big, cb.top + big),
                    pya.Box(cb.left - ep, cb.bottom - ea, cb.right + ep, cb.top + ea)),
            "left": (pya.Box(cb.left - big, cb.bottom - big, cb.left - ea, cb.top + big),
                     pya.Box(cb.left - ea, cb.bottom - ep, cb.right + ea, cb.top + ep)),
            "right": (pya.Box(cb.right + ea, cb.bottom - big, cb.right + big, cb.top + big),
                      pya.Box(cb.left - ea, cb.bottom - ep, cb.right + ea, cb.top + ep)),
        }
        for side, (zone, keep) in sides.items():
            # the pad's overhang on this side: own metal inside the zone, near the cut
            near = pya.Region(cb.enlarged(ep + 5, ep + 5))
            strip = own & pya.Region(zone) & near
            for k_, reg_ in protect.items():
                if k_ != (cb.left, cb.bottom):
                    strip -= reg_
            if strip.is_empty() or (strip.sized(sp - 1) & others).is_empty():
                continue
            new_own = (own - strip).merged()
            if not (pya.Region(keep) - new_own).is_empty():
                continue                                 # would lose the pair enclosure on the other axis
            if new_own.count() != own.merged().count():
                continue                                 # strip is a wire, not a pad overhang
            if sum(p_.holes() for p_ in new_own.each()) > sum(p_.holes() for p_ in own.merged().each()):
                continue                                 # would open a hole in the polygon
            if not new_own.width_check(wmin).is_empty():
                continue                                 # would leave a sliver below min width
            met = (met - strip); met.merge()
            own = new_own
            others = met - own
            changed = True
            sb = strip.bbox()
            trimmed.append({"rule": rname, "side": side,
                            "layer": {(67, 20): "li1", (68, 20): "met1", (69, 20): "met2"}[met_ld],
                            "strip_um": [sb.left * dbu, sb.bottom * dbu, sb.right * dbu, sb.top * dbu],
                            "cut_um": [cb.left * dbu, cb.bottom * dbu, cb.right * dbu, cb.top * dbu]})
        if not (own.sized(sp - 1) & others).is_empty():
            trim_failed.append({"rule": rname, "cut_um": [cb.left * dbu, cb.bottom * dbu, cb.right * dbu, cb.top * dbu]})
    if changed:
        texts = [t.text for t in top.shapes(midx).each() if t.is_text()]
        top.shapes(midx).clear(); top.shapes(midx).insert(met)
        for t in texts:
            top.shapes(midx).insert(t)
print("pad trim: trimmed %d overhang(s), %d pad(s) still too close" % (len(trimmed), len(trim_failed)))

# ---- 4. FACTORY: min-area repair ------------------------------------------------------------------
# lclayout's tech sets min_area = 0 (its SMT min-area cleaner is disabled), so small li1/met1 islands
# (contact landing pads, short jumpers) violate li.6 (0.0561 um2) / m1.6 (0.083 um2) / m2.6 (0.0676 um2).
# Mechanical fix: replace each undersized polygon by its bounding box grown in one direction (or both
# along one axis) just enough to pass the area rule, choosing the smallest growth that keeps the
# same-layer spacing (li.3 0.17, m1.2 0.14, m2.2 0.14) to every other polygon and stays inside the
# cell boundary. A polygon with no legal growth is left as is (DRC then reports it honestly).
import json as _json
GRID = int(round(0.005 / dbu))
MINAREA_RULES = [  # (layer, datatype, name, min area um2, spacing um)
    (67, 20, "li1", 0.0561, 0.17),
    (68, 20, "met1", 0.083, 0.14),
    (69, 20, "met2", 0.0676, 0.14),
]
def _snap_up(v):
    return ((v + GRID - 1) // GRID) * GRID
added = []
unfixed = []
do_minarea = str(globals().get("minarea", "1")) not in ("0", "false")
bnd = top.bbox()
if not R(235, 4).is_empty():
    bnd = R(235, 4).bbox()
for (l, d, lname, amin, space) in (MINAREA_RULES if do_minarea else []):
    idx = ly.layer(l, d)
    reg = pya.Region(top.begin_shapes_rec(idx)); reg.merge()
    need = int(amin / (dbu * dbu)) + GRID * GRID          # strictly above the rule's inclusive limit
    sp = int(round(space / dbu))
    polys = list(reg.each())
    grow_total = pya.Region()
    for p in polys:
        if p.area() > need - GRID * GRID:
            continue
        b = p.bbox()
        others = reg - pya.Region(p)
        others += grow_total                                # growth already committed this layer
        cands = []
        w, h = b.width(), b.height()
        for axis in ("v", "h"):
            span = w if axis == "v" else h
            base = w * h
            ext = _snap_up(max(0, -(-(need - base) // span)))
            if axis == "v":
                opts = [(0, ext), (ext, 0), (_snap_up(ext // 2), _snap_up(ext // 2))]
                boxes = [pya.Box(b.left, b.bottom - lo, b.right, b.top + hi) for lo, hi in opts]
            else:
                opts = [(0, ext), (ext, 0), (_snap_up(ext // 2), _snap_up(ext // 2))]
                boxes = [pya.Box(b.left - lo, b.bottom, b.right + hi, b.top) for lo, hi in opts]
            for nb in boxes:
                if nb.area() < need:
                    continue
                if not bnd.contains(nb.p1) or not bnd.contains(nb.p2):
                    continue
                grown = pya.Region(nb)
                # spacing: the grown shape must keep `space` to every other polygon on the layer
                if not (grown.sized(sp - 1) & others).is_empty():
                    continue
                cands.append((nb.area() - p.area(), nb))
        if not cands:
            unfixed.append({"layer": lname, "bbox_um": [b.left * dbu, b.bottom * dbu, b.right * dbu, b.top * dbu],
                            "area_um2": p.area() * dbu * dbu})
            continue
        cands.sort(key=lambda c: c[0])
        nb = cands[0][1]
        top.shapes(idx).insert(nb)
        grow_total.insert(nb)
        added.append({"layer": lname, "rect_um": [nb.left * dbu, nb.bottom * dbu, nb.right * dbu, nb.top * dbu],
                      "from_area_um2": round(p.area() * dbu * dbu, 5)})
    # merge so the layer stays one polygon per island
    merged = pya.Region(top.shapes(idx)); merged.merge()
    top.shapes(idx).clear(); top.shapes(idx).insert(merged)
print("min_area: grew %d polygon(s), %d left unfixed" % (len(added), len(unfixed)))
if "report" in globals() and report:
    with open(report, "w") as _fh:
        _json.dump({"gate_contacts_fixed": int(bad_pc.size()), "labels_stripped": int(before),
                    "site_snap_nm": int(snap_dx), "shift_nm": int(shift_dx), "nonpin_labels_dropped": int(dropped_labels),
                    "enclosure_added": enc_added, "enclosure_unfixed": enc_unfixed,
                    "pad_trimmed": trimmed, "pad_trim_failed": trim_failed,
                    "gap_filled": gap_filled, "gap_unfilled": gap_unfilled,
                    "licon_shift": licon_shift, "licon_shift_skipped": licon_shift_skipped, "psdm_cut_um": psdm_cut_um, "poly_pads": poly_pads, "poly_pads_unfixed": poly_unfixed, "npc_shapes": int(npc.count()),
                    "min_area_added": added, "min_area_unfixed": unfixed}, _fh, indent=1)

# ---- 5. FACTORY: pin-purpose shapes follow the final drawing ---------------------------------------
# lclayout's pin purpose layers (67/16, 68/16, 69/16) copy the raw metal; sky130A.lydrc counts them as
# metal, so a trimmed pad would still show its old overhang. Clip each to its drawing layer.
for (pl, pd), (dl, dd) in (((67, 16), (67, 20)), ((68, 16), (68, 20)), ((69, 16), (69, 20))):
    pin_r = R(pl, pd)
    if pin_r.is_empty():
        continue
    texts = [t.text for t in top.shapes(ly.layer(pl, pd)).each() if t.is_text()]
    put(pin_r & R(dl, dd), pl, pd)
    for t in texts:
        top.shapes(ly.layer(pl, pd)).insert(t)

ly.write(gds)
print("post-processed:", gds)
