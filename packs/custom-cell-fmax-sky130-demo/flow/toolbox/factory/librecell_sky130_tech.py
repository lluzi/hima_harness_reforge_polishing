# FACTORY copy of $CELLUZI_ROOT/pdk/librecell_sky130_tech.py (sha256 in factory/SOURCES.md).
# Changes are marked FACTORY below: unit_cell_width 460 -> 500 (gate pitch), and (x, y) contact
# enclosures for li.5 / m1.5 / via.5a / m2.5 (the router then reserves spacing for the pads), and
# transistor_offset_y 260 -> 255 / gate_extension_channel 280 -> 285 (licon.14: the gate licon on
# the 1.19 um track is now 0.20 from ndiff and 0.19 from pdiff). licon.9 (0.235 to pdiff) is NOT met:
# see README "Failure classes".
# Gate pitch: With a 0.46 um pitch two
# adjacent gate-contact pads (licon 0.17 + 2 x 0.05 poly enclosure = 0.27 um) are 0.19 um apart,
# below poly.2 (0.21 um), so every cell with two adjacent contacted gates of different nets failed the
# full sky130A_mr deck. postprocess_cell.py snaps the cell width back up to a 0.46 um site multiple.
# lclayout technology file for SKY130 (sky130_fd_sc_hd site).  FIRST PASS — not yet DRC-clean.
# Transcribed from the sky130 layer map + DRM, structured after examples/dummy_tech.py and the
# LibreSilicon librecell_tech.py. Plan §7 Step 2 / R1 (the integration investment).
#
# KEY MAPPING (lclayout has no local-interconnect layer; sky130 does):
#   lclayout            -> sky130
#   l_poly              -> poly    (66,20)
#   l_*_contact         -> licon1  (66,44)   [poly & diff contacts are all licon1 in sky130]
#   l_metal1            -> li1     (67,20)   [local interconnect = lclayout's "metal1"]
#   l_via1              -> mcon    (67,44)   [li1 <-> met1 via]
#   l_metal2            -> met1    (68,20)   [pins + power rails ride here]
# GAP: sky130 `npc` (95,20) must cover poly licons; lclayout can't emit it -> post-process (TODO).
# All lengths are in db_unit (1 nm). Rule numbers are first-pass from the DRM and MUST be
# tightened by iterating: generate -> run sky130A.lydrc -> adjust -> repeat.

from lclayout.layout.layers import *
from lclayout.writer.lef_writer import LefWriter
from lclayout.writer.gds_writer import GdsWriter
from lclayout.writer.magic_writer import MagWriter

db_unit = 1e-9
transistor_channel_width_sizing = 1

# ---- sky130 GDS (layer, datatype) ----
s_nwell   = (64, 20)
s_diff    = (65, 20)
s_tap     = (65, 44)
s_nsdm    = (93, 44)   # n+ implant
s_psdm    = (94, 20)   # p+ implant
s_poly    = (66, 20)
s_licon   = (66, 44)   # poly/diff -> li1 contact
s_npc     = (95, 20)   # nitride poly cut (over poly licons) -- see GAP note
s_li1     = (67, 20)
s_li1_pin = (67, 16)
s_li1_lbl = (67, 5)
s_mcon    = (67, 44)   # li1 -> met1 via
s_met1    = (68, 20)
s_met1_pin= (68, 16)
s_met1_lbl= (68, 5)
# celluzi: met2 as a third routing layer -- gives the router a third layer with no correctness cost.
s_via     = (68, 44)   # met1 -> met2 via
s_met2    = (69, 20)
s_met2_pin= (69, 16)
s_met2_lbl= (69, 5)

# lclayout internal layer  ->  sky130 GDS number(s)
output_map = {
    l_ndiffusion:   s_diff,
    l_pdiffusion:   s_diff,          # one diff layer in sky130; n/p distinguished by implant
    l_nplus:        s_nsdm,
    l_pplus:        s_psdm,
    l_nwell:        s_nwell,
    l_pwell:        (255, 0),        # sky130 sc: no drawn pwell (substrate); scratch layer, DRC ignores it -- TODO
    l_poly:         s_poly,
    l_poly_contact: s_licon,
    l_ndiff_contact:s_licon,
    l_pdiff_contact:s_licon,
    l_metal1:       s_li1,           # metal1 == li1
    l_metal1_label: s_li1_lbl,
    l_metal1_pin:   s_li1_pin,
    l_via1:         s_mcon,
    l_metal2:       s_met1,          # metal2 == met1
    l_metal2_label: s_met1_lbl,
    l_metal2_pin:   s_met1_pin,
    l_via2:         s_via,           # celluzi: met2 as a third routing layer
    l_metal3:       s_met2,
    l_metal3_label: s_met2_lbl,
    l_metal3_pin:   s_met2_pin,
    l_abutment_box: (235, 4),        # sky130 areaid.standardc
    l_border_horizontal: (236, 0),
    l_border_vertical:   (236, 1),
}

output_writers = [
    GdsWriter(db_unit=db_unit, output_map=output_map),
    LefWriter(
        db_unit=1e-6,
        output_map={l_poly: 'poly', l_metal1: 'li1', l_via1: 'mcon', l_metal2: 'met1',
                    l_via2: 'via', l_metal3: 'met2'},   # celluzi: met2 as a third routing layer
        obstruction_layers=[l_poly, l_metal1, l_metal2, l_metal3],
        site="unithd",
    ),
    MagWriter(
        tech_name='sky130A', scale_factor=0.001,
        output_map={
            l_poly: 'poly', l_poly_contact: 'polycont',
            l_ndiff_contact: 'ndiffc', l_pdiff_contact: 'pdiffc',
            l_metal1: 'li', l_via1: 'mcon', l_metal2: 'm1', l_via2: 'via', l_metal3: 'm2',
            l_ndiffusion: 'ndiff', l_pdiffusion: 'pdiff', l_nwell: 'nwell',
        },
    ),
]

# Which layers can carry routing tracks.
routing_layers = {
    l_ndiffusion: '', l_pdiffusion: '',
    # celluzi: poly is DRAWN for gates, never ROUTED. A routed poly wire crossing diffusion
    # creates a second channel segment on the device ('Device has multiple lengths'), which
    # extracts as W = nominal+0.06 and L = 0.16..0.18 instead of 0.15 -> LVS FAILED on every
    # multi-transistor cell since M2. sky130 connects gates through li1; so do we.
    l_poly: '',
    l_metal1: 'hv',     # li1
    l_metal2: 'hv',     # met1
    l_metal3: 'hv',     # met2 -- celluzi: met2 as a third routing layer
}

# ---- sky130 rules (nm), first pass ----
min_spacing = {
    (l_ndiffusion, l_ndiffusion): 270,   # diff.2
    (l_pdiffusion, l_pdiffusion): 270,
    (l_pdiffusion, l_ndiffusion): 270,
    # celluzi: gate contacts must stay OFF diffusion. The poly enclosure around a licon landing on
    # active widens the gate by exactly 60nm, adding a second channel segment to the device -> the
    # extractor reports W = nominal+0.06, L = 0.16..0.18. The grid_offset_y alignment alone does NOT
    # prevent this once a cell is big enough for the router to place contacts freely (holds at 2T/4T,
    # fails at 14T). This rule was previously omitted because it "starved the pathfinder" -- true only
    # while poly was a ROUTING layer. With poly drawn-only, the router has li1/met1 and converges.
    (l_ndiffusion, l_poly_contact): 120,
    (l_pdiffusion, l_poly_contact): 120,
    (l_nwell, l_nwell): 1270,            # nwell.2
    (l_nwell, l_pwell): 0,               # nwell abuts substrate/pwell in sky130
    (l_pwell, l_pwell): 270,
    (l_poly, l_ndiffusion): 75,          # poly.4 (field poly to diff)
    (l_poly, l_pdiffusion): 75,
    (l_poly, l_poly): 210,               # poly.2
    (l_poly, l_ndiff_contact): 55,       # licon.11
    (l_poly, l_pdiff_contact): 55,
    (l_metal1, l_metal1): 170,           # li1.2
    (l_metal2, l_metal2): 140,           # met1.2
    (l_metal3, l_metal3): 140,           # m2.2 -- celluzi: met2 as a third routing layer
}

pin_layer = l_metal2          # pins on met1
power_layer = [l_metal2]      # power rails on met1
connectable_layers = {l_nwell}

# ---- standard cell geometry (sky130_fd_sc_hd: SITE unithd 0.46 x 2.72 um) ----
unit_cell_width = 500         # FACTORY: contacted poly pitch 0.50 (poly.2 + li.5 pads); width snapped to 0.46 sites in post
unit_cell_height = 2720       # row height
gate_extension = 130          # poly endcap over diff (poly.8)
transistor_offset_y = 255   # FACTORY: 260 -> 255 so the channel gate licon keeps licon.14 (0.19) to both diffusions
routing_grid_pitch_x = unit_cell_width // 4   # 115: finer x-grid -> more routing tracks (convergence).
routing_grid_pitch_y = unit_cell_height // 8  # 340: met1 pitch -> 8 tracks in 2720
grid_offset_x = 0                             # terminals sit on 230-multiples -> aligned to a 115 grid at offset 0
grid_offset_y = routing_grid_pitch_y // 2     # 170; part of the tuned convergence — do NOT change (routing fails otherwise)
# Extra poly extension on the CHANNEL side of each gate so the gate TERMINAL (which lclayout puts at
# diff_edge + this) lands on the channel routing track 1190 instead of off-track at ~1040. Off-track
# terminals force the router to bridge with an over-diff contact that jogs the poly and breaks Magic's
# nfet W/L extraction. Consumed by our transistor.py patch (scripts/patch_lclayout_gate.sh); the outer
# side keeps the minimum endcap (gate_extension). 280 -> NMOS gate_top = 260+650+280 = 1190 (on track).
gate_extension_channel = 285   # FACTORY: 280 -> 285 keeps the NMOS gate terminal on the 1190 track (255+650+285)
grid_ys = list(range(grid_offset_y, grid_offset_y + unit_cell_height, routing_grid_pitch_y))
power_rail_width = 480        # met1 power rail
minimum_gate_width_nfet = 420
minimum_gate_width_pfet = 420
minimum_pin_width = 170

wire_width = {l_poly: 150, l_metal1: 170, l_metal2: 140, l_metal3: 140}
wire_width_horizontal = {l_poly: 150, l_metal1: 170, l_metal2: 140, l_metal3: 140}
via_size = {l_poly_contact: 170, l_pdiff_contact: 170, l_ndiff_contact: 170, l_via1: 170,
            l_via2: 150}  # via.1a = 0.15  # licon/mcon = 0.17
minimum_width = {l_poly: 150, l_metal1: 170, l_metal2: 140, l_metal3: 140, l_via2: 150, l_ndiffusion: 150, l_pdiffusion: 150, l_nwell: 840}

minimum_enclosure = {
    (l_ndiffusion, l_ndiff_contact): 40,   # licon on diff
    (l_pdiffusion, l_pdiff_contact): 40,
    (l_nplus, l_ndiff_contact): 125,       # nsdm enclosure
    (l_pplus, l_pdiff_contact): 125,
    (l_nwell, l_nplus): 0,
    (l_poly, l_poly_contact): 50,          # licon.5 poly enclosure
    (l_metal1, l_ndiff_contact): (80, 0),  # FACTORY: li.5 -- li1 over licon 0.08 on left+right
    (l_metal1, l_pdiff_contact): (80, 0),  # FACTORY: li.5
    (l_metal1, l_poly_contact): (80, 0),   # FACTORY: li.5
    (l_metal1, l_via1): 0,                 # li1 enclosure of mcon
    (l_metal2, l_via1): (60, 30),          # FACTORY: met1 over mcon m1.5 0.06 (x) / m1.4 0.03 (y)
    (l_metal2, l_via2): (85, 55),          # FACTORY: met1 over via via.5a 0.085 (x) / via.4a 0.055 (y)
    (l_metal3, l_via2): (85, 55),          # FACTORY: met2 over via m2.5 0.085 (x) / m2.4 0.055 (y)
    (l_nwell, l_pdiffusion): 180,          # nwell enclose pdiff (nwell.5-ish)
    (l_pwell, l_ndiffusion): 0,
}
minimum_notch = {l_ndiffusion: 270, l_pdiffusion: 270, l_poly: 210, l_metal1: 170, l_metal2: 140,
                 l_metal3: 140, l_nwell: 1270}
# Real sky130 min-area: li1.6 ~0.0561um^2 (56100), met1.6 ~0.083um^2 (83200). Left relaxed here because
# lclayout's SMT min-area fixer goes UNSAT trying to grow the two small met1 PINS in this tiny cell.
# Net effect: the generated INV is full-sky130-DRC-clean EXCEPT 2x m1.6 (met1 pin min-area). TODO: enlarge pins.
min_area = {l_metal1: 0, l_metal2: 0, l_metal3: 0}

# ---- routing costs ----
orientation_change_penalty = 100
weights_horizontal = {l_poly: 4, l_metal1: 2, l_metal2: 1, l_metal3: 2}
weights_vertical   = {l_poly: 4, l_metal1: 1, l_metal2: 2, l_metal3: 1}
via_weights = {
    (l_metal1, l_ndiffusion): 500, (l_metal1, l_pdiffusion): 500,
    (l_metal1, l_pplus): 1, (l_metal1, l_nplus): 1,
    (l_metal1, l_poly): 500, (l_metal1, l_metal2): 400, (l_metal2, l_metal3): 400,
}
multi_via = {(l_metal1, l_poly): 1, (l_metal1, l_metal2): 1}
