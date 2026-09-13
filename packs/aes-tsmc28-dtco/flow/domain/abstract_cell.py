#!/usr/bin/env python3
"""Abstract standard cell: REAL placement, REAL size, LEGAL pins -- intra-cell routing left open.

This is deliberately NOT a made-up LEF. Everything an APR tool consumes is derived or checked:

  SIZE   from the actual transistor placement lclayout computes (column count x CPP), snapped to a
         whole number of SITEs. So cell area is real, and area-based PPA is meaningful.
  PINS   real M1 shapes at the contacted source/drain node of each device column -- which is the
         site centre, and therefore the only x phase an M2 track ever occupies -- sized to pass
         M1.W.1 (>=0.05), M1.A.1 (>=0.0115um2), M1.S.1 (>=0.05 to every neighbour) and the LEF58
         end-of-line rule (the pin is 0.070 wide, so its ends are not end-of-line edges and the
         ordinary 0.050 governs them), with an M2 landing stub and a VIA1 on top so the router can
         reach the pin from the layer above. Every edge on every layer is audited against the
         end-of-line rule before the LEF is written -- see the EOL AUDIT block.
  OBS    M1 blockage over the device band, on the M1 tracks the pin does NOT use and only those,
         held M1.S.1 away from the pins, the wide-metal 0.060 away from the rails, and M1.S.1/2
         away from the left and right cell edges. A blockage that contains its own pins is not a
         congestion model, it is a short; a blockage that reaches the cell edge is not a congestion
         model either, it is a keep-out the abutted neighbour has no way to honour.

What is NOT here: the intra-cell wiring between the pins and the transistor terminals. That is the
one step lclayout cannot yet close for these topologies, so it is left explicit rather than faked.

CONSEQUENCE, stated plainly: this LEF is correct for PLACEMENT and BLOCK-LEVEL ROUTING, and gives a
trustworthy area/congestion answer. It is NOT tape-out ready -- the cell has no internal connectivity
yet, so LVS at chip level will flag it, and it must never be streamed into a production GDS. It is a
measurement instrument, and the accompanying GDS is written with a marker layer saying so.

NDA. EVERY DIMENSION THIS FILE OBEYS IS SITE DATA AND IS READ FROM THE RULE DECK. The site width,
the row height, the track pitches and offsets, the minimum widths, spacings, areas and end-of-line
rows, the rail width, the site name and the standoff an abutted neighbour leaves are all properties
of the technology, so none of them is written here. What IS written here is this package's own
design: which tracks to block, how tall to make a pin, where to put the landing stub -- each of
which is then asserted against the deck rather than assumed to fit it.

Still understated, and known: nothing here blocks M2, while a real cell library routinely does, so
M2 congestion reads optimistic by that much.

Usage: abstract_cell.py --netlist cell.sp --tech <tech.py> --rule-deck <deck.json> -o outdir
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time

import sys
# Site-bound helper modules (estimate_lib / mock_char / charmodel). The authoritative copy
# is unresolved -- see authoring/flow-map.json OQ-2 -- so this package refuses to choose one
# and binds the directory through the typed input XS28_CHARMODEL_HELPER_DIR instead of
# carrying a site path.
import os as _os
for _p in _os.environ.get("XS28_CHARMODEL_HELPER_DIR", "").split(":"):
    if _p:
        sys.path.insert(0, _p)
import mock_char as MC  # noqa: E402  parse_netlist / rail detection


#: Every geometry constant this generator obeys, and what each one governs. All
#: are integer nanometres except `site_name` and `eol`. They are technology
#: properties, so the deck is a site input (GEOMETRY_RULE_DECK) and this package
#: neither carries a value nor supplies a default for one: a default here would
#: be a plausible-looking number from some other technology, and the LEF it
#: produced would be wrong in a way no assertion could catch.
RULE_KEYS = (
    ("site_name", "SITE name the macro declares; must match the tech LEF"),
    ("site_width_nm", "site width, i.e. the contacted poly pitch"),
    ("row_height_nm", "row height"),
    ("m1_pitch_nm", "M1 routing pitch"),
    ("m2_pitch_nm", "M2 routing pitch"),
    ("m2_offset_nm", "M2 track offset from x=0"),
    ("m1_min_width_nm", "M1 minimum width"),
    ("m2_min_width_nm", "M2 minimum width"),
    ("m1_min_spacing_nm", "M1 minimum spacing, first row of the spacing table"),
    ("m1_wide_metal_spacing_nm", "M1 spacing against a rail-width shape"),
    ("m1_min_area_nm2", "M1 minimum area"),
    ("m2_min_area_nm2", "M2 minimum area"),
    ("rail_width_nm", "power/ground rail width"),
    ("neighbour_obs_standoff_nm", "standoff a neighbouring macro leaves its own edge"),
    ("m1_m2_via_name", "VIA the LEF places between the M1 pin and its M2 stub"),
    ("eol", "per-layer end-of-line rule: space_nm, width_nm, within_nm"),
)


def load_rule_deck(path):
    """The site geometry rule deck, with every key this generator needs present.

    A missing key is fatal and named. The alternative - a default - is how a
    generated cell acquires a dimension from a technology it was not built for,
    passes every assertion in this file, and is rejected at the site months
    later, or worse, is not rejected.
    """
    try:
        with open(path) as fh:
            deck = json.load(fh)
    except (OSError, ValueError) as exc:
        sys.exit("ERROR: geometry rule deck %s is unreadable: %s" % (path, exc))
    missing = ["%s (%s)" % (key, why) for key, why in RULE_KEYS if not deck.get(key)]
    if missing:
        sys.exit("ERROR: the geometry rule deck declares no %s. This package carries no "
                 "technology dimension of its own and will not substitute one."
                 % ", no ".join(missing))
    eol = deck["eol"]
    for layer in ("M1", "M2"):
        row = eol.get(layer) or {}
        if not all(row.get(field) for field in ("space_nm", "width_nm", "within_nm")):
            sys.exit("ERROR: the geometry rule deck's end-of-line row for %s is incomplete; "
                     "space_nm, width_nm and within_nm are all required." % layer)
    return deck


def _edges(r):
    """The four edges of a rectangle: (orient, length, along0, along1, coord, outward sign).
    'H' is a horizontal edge and faces +/-y; 'V' is vertical and faces +/-x. Valid as the real
    boundary only while no two shapes on the layer touch -- which is asserted before it is used."""
    x0, y0, x1, y1 = r
    return (("H", x1 - x0, x0, x1, y1, +1), ("H", x1 - x0, x0, x1, y0, -1),
            ("V", y1 - y0, y0, y1, x1, +1), ("V", y1 - y0, y0, y1, x0, -1))


def _face(o, a0, a1, c, sign, rb, within):
    """Clearance from one edge to rectangle rb inside the end-of-line window, else None.
    The window is the edge extended `within` past each of its ends, projected `sign`-ward."""
    lo, hi = a0 - within, a1 + within
    if o == "H":
        if rb[0] >= hi or rb[2] <= lo:
            return None
        return (rb[1] - c) if sign > 0 else (c - rb[3])
    if rb[1] >= hi or rb[3] <= lo:
        return None
    return (rb[0] - c) if sign > 0 else (c - rb[2])


def placement_columns(netlist, tech, cell, timeout=900):
    """Column count from lclayout's placement -- and STOP THERE.

    Placement settles in seconds. Routing then burns up to 1000 negotiation iterations and fails on
    exactly the cells we are abstracting, so waiting for the process to exit paid minutes per cell
    for a number that was already printed. Stream stdout, take the placement grid, kill the process.
    """
    _host = os.environ["XS28_CONTAINER_HOST_ROOT"]
    _mnt = os.environ["XS28_CONTAINER_MOUNT_POINT"]
    cnet = netlist.replace(_host, _mnt)
    ctech = tech.replace(_host, _mnt)
    cmd = ("source %s && " % os.environ["XS28_LCLAYOUT_ACTIVATE"] +
           "exec lclayout --cell %s --netlist %s --tech %s --output-dir /tmp/_pl_%s "
           "--placer meta --place-max-candidates 1" % (cell, cnet, ctech, cell))
    proc = subprocess.Popen([os.environ["XS28_CONTAINER_RUNTIME"], "run", "--rm",
                             "--userns=keep-id",
                             "-v", "%s:%s:rw" % (_host, _mnt),
                             os.environ["XS28_CONTAINER_IMAGE"], "--skip",
                             "bash", "-lc", cmd],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
    rows, grab, deadline = [], False, time.time() + timeout
    try:
        for line in proc.stdout:
            if "Cell placement:" in line:
                grab = True
                continue
            if grab:
                if "|" in line:
                    rows.append(line.count("|") + 1)
                elif rows:
                    break                      # placement grid complete -- that is all we need
            if time.time() > deadline:
                break
    finally:
        proc.kill()                            # do NOT wait for the routing attempt to fail
        try:
            proc.wait(timeout=10)
        except Exception:                      # noqa: BLE001
            pass
    return max(rows) if rows else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--netlist", required=True)
    ap.add_argument("--tech", required=True, help="container path to the lclayout tech file")
    ap.add_argument("--cell")
    ap.add_argument("--rule-deck", required=True,
                    help="site geometry rule deck (JSON); see RULE_KEYS")
    # NO DEFAULTS on the rail names, for the same reason the deck has no defaults:
    # they are technology properties, and a plausible wrong one produces a LEF whose
    # supply pins do not match the rows it is placed into.
    ap.add_argument("--power-pin", required=True, help="power rail name; a site input")
    ap.add_argument("--ground-pin", required=True, help="ground rail name; a site input")
    ap.add_argument("-o", "--outdir", required=True)
    a = ap.parse_args()
    deck = load_rule_deck(a.rule_deck)

    name, ports, devs = MC.parse_netlist(a.netlist)
    cell = a.cell or name
    n_rail = MC._majority(d.b for d in devs if d.kind == "n")
    p_rail = MC._majority(d.b for d in devs if d.kind == "p")
    rails = {n_rail, p_rail}
    dp = {d.d for d in devs if d.kind == "p"} | {d.s for d in devs if d.kind == "p"}
    dn = {d.d for d in devs if d.kind == "n"} | {d.s for d in devs if d.kind == "n"}
    outs = [p for p in ports if p not in rails and p in dp and p in dn]
    ins = [p for p in ports if p not in rails and p not in outs]
    signals = ins + outs

    cols = placement_columns(a.netlist, a.tech, cell)
    if cols is None:                       # placement itself failed: fall back to the device bound
        cols = max(sum(1 for d in devs if d.kind == "n"), sum(1 for d in devs if d.kind == "p"))
        src = "device-count bound (placement unavailable)"
    else:
        src = "lclayout placement"

    # Width in whole SITEs. Compute in INTEGER site counts, never by repeatedly adding a float:
    # a site count derived by float division evaluates to 1.9999... and a `while width/cpp < n`
    # loop then over-increments, which produced half-site cells -- both an inflated area and an
    # illegal LEF, because SIZE must be a whole site multiple.
    cpp_nm = int(deck["site_width_nm"])
    sites = cols + 1                      # placed columns + one boundary column for the dummy poly
    sites = max(sites, len(signals) + 1)  # every pin needs its own CPP column (M1.S.1 to neighbours)
    W = sites * cpp_nm
    H = int(deck["row_height_nm"])
    assert W % cpp_nm == 0, "width %d nm is not a whole number of %d nm sites" % (W, cpp_nm)

    # ---- the routing grid, from the rule deck ---------------------------------------------------
    # M1 is horizontal, so its pitch and the row height fix the track set; M2 is vertical, and its
    # pitch and offset fix the x phases a wire can occupy. The load-bearing relationship, asserted
    # rather than assumed, is that the site width and the M2 pitch agree: when they do, an M2 track
    # runs through the CENTRE of every site and through no site boundary at all, which is what fixes
    # both the pin x and the OBS shape below. A technology where they do not agree needs a different
    # pin-placement rule, and this generator says so instead of emitting off-track pins.
    M1_PITCH = int(deck["m1_pitch_nm"])
    M2_PITCH = int(deck["m2_pitch_nm"])
    M2_OFF = int(deck["m2_offset_nm"])
    WIRE = int(deck["m1_min_width_nm"])   # a routed wire covers its track +/- WIRE/2
    SP = int(deck["m1_min_spacing_nm"])   # M1 minimum spacing, first row of the spacing table
    SP_RAIL = int(deck["m1_wide_metal_spacing_nm"])   # M1 against a rail-width shape
    M1_AREA = int(deck["m1_min_area_nm2"])
    M2_AREA = int(deck["m2_min_area_nm2"])
    RAIL = int(deck["rail_width_nm"])
    NEIGHBOUR_STANDOFF = int(deck["neighbour_obs_standoff_nm"])
    OBS_EDGE = SP // 2  # half of M1 min spacing at each cell edge -- derived in the OBS block below
    assert M2_PITCH == cpp_nm, (
        "this generator places one pin per site at the site centre, which is only on an M2 track "
        "when the M2 pitch (%dnm) equals the site width (%dnm)" % (M2_PITCH, cpp_nm))

    # ---- LEF58 end-of-line, from the rule deck --------------------------------------------------
    # An edge SHORTER than eolWidth is an end-of-line edge, and then the ordinary minimum spacing
    # does not apply to it: eolSpace does, inside the box that runs eolSpace forward from the edge
    # and eolWithin laterally past each of its two ends. This is checked at the bottom of the file.
    # Only the plain end-of-line row is modelled; the PARALLELEDGE rows of a real deck relax the
    # requirement, never tighten it, so auditing against the plain row is the conservative side.
    EOL = {layer: (int(deck["eol"][layer]["space_nm"]),
                   int(deck["eol"][layer]["width_nm"]),
                   int(deck["eol"][layer]["within_nm"]))
           for layer in ("M1", "M2")}                       # eolSpace, eolWidth, eolWithin

    # PIN WIDTH IS THE END-OF-LINE WIDTH, NOT THE MINIMUM WIDTH, and that distinction was the
    # defect. A minimum-width pin has minimum-width top and bottom edges; those are SHORTER than
    # eolWidth, so BOTH of them are end-of-line edges, and both face an OBS strip designed at the
    # ordinary spacing. Two designed-in end-of-line violations per pin, every pin, every cell --
    # identical across three library revisions and invisible until verify_drc was run with
    # -check_only cell, at which point the routed design produced thousands of end-of-line M1
    # records citing a generated cell and essentially none citing anything else.
    #
    # Two ways out: open the OBS gap to eolSpace, or take the pin off the end-of-line list entirely
    # by making its facing edge exactly eolWidth long. The second is taken, because a shape whose
    # edge is not an end-of-line edge is governed by the ordinary spacing everywhere and stops
    # depending on the eol geometry at all. Landing precisely ON the eolWidth threshold is the rule
    # being designed around rather than worked around.
    #
    # The knock-ons all improve or hold:
    #   area      wider and taller than minimum area demands, where minimum width sat exactly on
    #             M1 min area with no margin at all. Asserted below against the deck.
    #   spacing   the M1 spacing table picks its row on the shape's SHORT side, and eolWidth is
    #             still inside the first row, so the required spacing is unchanged.
    #   pin/pin   one pin per SITE: the in-cell gap narrows but stays >= SP, and those are the
    #             pins' long side edges, which are not end-of-line. Asserted below.
    #   abutment  pin-to-cell-edge standoff narrows; worst case against an abutted neighbour at the
    #             deck's standoff still clears SP, and again these are side edges. Asserted below.
    #   via       the landing via gains enclosure in x and keeps it in y. Strictly better.
    #   blockage  untouched -- the other remedy would have deleted OBS height from a model that
    #             already blocks far less M1 than a real cell does.
    PIN_W = EOL["M1"][1]                   # eolWidth: the pin end is no longer an end-of-line edge
    PIN_H = 230                            # OUR choice; asserted against the deck's M1 min area
    assert PIN_W * PIN_H >= M1_AREA, \
        "pin %dx%dnm is under M1 minimum area %dnm2" % (PIN_W, PIN_H, M1_AREA)
    assert cpp_nm - PIN_W >= SP, \
        "pins one site apart leave %dnm < M1 min spacing %dnm" % (cpp_nm - PIN_W, SP)
    assert (cpp_nm - PIN_W) // 2 + NEIGHBOUR_STANDOFF >= SP, \
        "a pin against an abutted neighbour leaves %dnm < M1 min spacing %dnm" \
        % ((cpp_nm - PIN_W) // 2 + NEIGHBOUR_STANDOFF, SP)
    PIN_Y0 = (H - PIN_H) // 2
    PIN_Y0 -= PIN_Y0 % 10                  # keep on the 0.01um manufacturing-friendly grid
    PIN_Y1 = PIN_Y0 + PIN_H
    rail_lo, rail_hi = RAIL // 2, H - RAIL // 2      # the two rail edges facing the device band
    # The M2 stub is deliberately NOT widened with the pin, though it used to take the pin's x0/x1
    # and so would have followed it to eolWidth for free. Two reasons, both measured:
    #   1. There is nothing on M2 to fix. The stub's minimum-width ends ARE end-of-line edges under
    #      M2's own rule, but the nearest M2 inside the end-of-line window is the next row's stub,
    #      an order of magnitude further away than the rule asks for -- zero violations, in every
    #      revision this was audited in. And the router's own M2 wire ends are minimum width and
    #      therefore end-of-line from their side no matter what we do, so a wider stub would not
    #      buy back the end-to-end allowance either.
    #   2. It is not free. A wider stub stands closer to the cell edge, and the binding neighbour
    #      is an abutted macro's own M2 end-of-line edge, which shrinks the abutment margin for no
    #      benefit on a layer that has no defect to fix.
    # So M2 keeps minimum-width pin metal and only the layer with a real defect moves.
    M2_STUB_W = int(deck["m2_min_width_nm"])
    M2_STUB_H = 290                        # OUR choice; asserted against the deck's M2 min area
    assert M2_STUB_W * M2_STUB_H >= M2_AREA, \
        "M2 stub %dx%dnm is under M2 minimum area %dnm2" % (M2_STUB_W, M2_STUB_H, M2_AREA)

    os.makedirs(a.outdir, exist_ok=True)
    pins = {}
    for i, s in enumerate(signals):
        # Pin x is the CENTRE of site i+1, not the site boundary. The old code used (i+1)*CPP -- the
        # boundary -- and called it "the gate column", but a poly gate cannot carry an M1 pin; the
        # contacted source/drain node midway between two gates does, and that node is the site
        # centre. It is also the only x phase an M2 track ever occupies, so boundary pins were
        # off-track by exactly half the M2 pitch and no on-track M2 wire could ever drop a via onto
        # one -- not one pin in the previous library covered an M2 track. Half a pitch is the
        # largest error available, and it was systematic. The assertion below is the guard.
        cx = (i + 1) * cpp_nm + cpp_nm // 2
        assert (cx - M2_OFF) % M2_PITCH == 0, "pin %s at %dnm is off the M2 track grid" % (s, cx)
        assert cx + PIN_W // 2 <= W, "pin %s at %dnm does not fit the %dnm cell" % (s, cx, W)
        pins[s] = (cx - PIN_W // 2, PIN_Y0, cx + PIN_W // 2, PIN_Y1)

    tracks = list(range(M1_PITCH, H, M1_PITCH))
    open_tr = [t for t in tracks if PIN_Y0 <= t <= PIN_Y1]     # tracks a wire can share with a pin
    assert open_tr, "pin band %d..%d covers no M1 track" % (PIN_Y0, PIN_Y1)
    via_y = min(open_tr, key=lambda t: abs(t - (PIN_Y0 + PIN_H // 2)))

    # ---- OBS -----------------------------------------------------------------------------------
    # The previous version emitted ONE rectangle across the whole device band. It looked reasonable
    # and it was wrong: it contained every pin it was supposed to sit beside -- all of them --
    # because the minimum spacing had only ever been applied pin-to-pin and the blockage was never
    # modelled as a neighbour at all. The router still has to lay its own M1 on a pin to reach it,
    # that metal lands inside the blockage, and Innovus called it what it was: dozens of shorts,
    # "Regular Wire of Net & Blockage of Cell (M1)".
    #
    # The blockage is notional -- there is no intra-cell metal yet -- so what it has to model is
    # "these M1 tracks are already spoken for". A track is spoken for as soon as a wire on it would
    # break spacing, not only when metal literally covers it. So block by TRACK, not by area: two
    # full-width strips spanning the centres of the tracks they kill, clipped to keep the minimum
    # spacing to the pins and the wide-metal spacing to the rails. The tracks the pin sits on stay
    # open, which is the entire point -- that is how the router gets in.
    #
    # Second thing that looked reasonable and was wrong: the strips ran to x=0 and x=W. Spacing is
    # not a property of a cell, it is a property of the abutment, and a shape sitting ON the
    # boundary spends the whole budget out of the NEIGHBOUR's pocket -- which the neighbour cannot
    # pay, because it was built to a convention we were ignoring. The convention is that each cell
    # owns HALF the boundary budget and insets by that much, so any two abutted macros meet at
    # half + half = the rule, on the nose. The deck states the half a neighbour leaves as
    # neighbour_obs_standoff_nm; ours is derived below and asserted against it.
    #
    # verify_drc did not see this and reported nothing. verifyGeometry did: thousands of same-net M1
    # spacing records, essentially all of them naming a generated cell, every one a parallel-run
    # violation whose actual clearance was the neighbour's own standoff and nothing else, because
    # ours was zero.
    #
    # Why half and not more: the requirement is worst-case(required_spacing - neighbour_standoff).
    # The strips are only a fraction of a micron tall, so the parallel run against anything is far
    # short of what a spacing table needs before its width-dependent rows engage -- width does not
    # matter here, only run length does, and the first row governs. Taking more than the minimum
    # would delete blockage the rules do not ask us to delete, and this abstract already blocks far
    # less M1 than a real cell does; erring wide makes the congestion model worse, not safer.
    #
    # Inset-to-inset and open-ended is not laziness, it is forced. The minimum-enclosed-area rule
    # rejects any hole cut around a pin, and the gap between adjacent pins cannot hold a
    # minimum-width sliver with clearance either side. A per-pin notch is not ugly, it is
    # unsatisfiable. Every cell gets the same strip y, so abutted cells
    # line up: the only thing between two of them is a narrow slot at the boundary, open to the
    # routing channel at both ends -- no jogs for the minimum-step rule to catch and nothing
    # enclosed for the minimum-enclosed-area rule to measure. That is also the slot any two
    # abutted macros built to the same half-budget convention leave each other.
    # The rails still run 0 to W: those are meant to abut and merge, and they carry a net.
    rail_tr = [t for t in tracks                                # tracks the rails already sterilise
               if t - WIRE // 2 - rail_lo < SP or rail_hi - (t + WIRE // 2) < SP]
    free = [t for t in tracks if t not in open_tr and t not in rail_tr]
    obs = []
    for grp, below in (([t for t in free if t < min(open_tr)], True),
                       ([t for t in free if t > max(open_tr)], False)):
        if not grp:
            continue
        y0, y1 = max(min(grp), rail_lo + SP_RAIL), min(max(grp), rail_hi - SP_RAIL)
        if below:
            y1 = min(y1, PIN_Y0 - SP)
        else:
            y0 = max(y0, PIN_Y1 + SP)
        assert y1 - y0 >= WIRE, "OBS strip %d..%d is thinner than M1 MINWIDTH" % (y0, y1)
        for t in grp:                          # every track in the group must actually be killed
            assert max(0, y0 - (t + WIRE // 2), (t - WIRE // 2) - y1) < SP, \
                "OBS strip %d..%d leaves track %d routable" % (y0, y1, t)
        for t in open_tr:                      # and every open track must stay legally routable
            assert max(0, y0 - (t + WIRE // 2), (t - WIRE // 2) - y1) >= SP, \
                "OBS strip %d..%d is within M1.S.1 of a wire on track %d" % (y0, y1, t)
        assert y0 - rail_lo >= SP_RAIL and rail_hi - y1 >= SP_RAIL, \
            "OBS strip %d..%d is within wide-metal spacing of a rail" % (y0, y1)
        assert y0 - PIN_Y1 >= SP or PIN_Y0 - y1 >= SP, \
            "OBS strip %d..%d is within M1.S.1 of the pin band" % (y0, y1)
        obs.append((y0, y1))

    # The inset is only as good as the arithmetic behind it -- assert the abutment, not the intent.
    assert OBS_EDGE % 5 == 0, "OBS inset %dnm is off the 5nm manufacturing grid" % OBS_EDGE
    assert 2 * OBS_EDGE >= SP, \
        "two abutted generated cells leave %dnm < M1 min spacing %dnm" % (2 * OBS_EDGE, SP)
    assert OBS_EDGE + NEIGHBOUR_STANDOFF >= SP, \
        "an abutted neighbour at the deck's standoff leaves %dnm < M1 min spacing %dnm" \
        % (OBS_EDGE + NEIGHBOUR_STANDOFF, SP)
    obs_x0, obs_x1 = OBS_EDGE, W - OBS_EDGE
    assert obs_x1 - obs_x0 >= WIRE, \
        "OBS strip is %dnm wide after inset, under M1 min width" % (obs_x1 - obs_x0)
    for y0, y1 in obs:                         # M1 min area still met by each strip on its own
        assert (obs_x1 - obs_x0) * (y1 - y0) >= M1_AREA, \
            "inset OBS strip %d..%d falls under M1 min area %dnm2" % (y0, y1, M1_AREA)
    for s in signals:                          # and the inset never eats into a pin's clearance
        px0, _, px1, _ = pins[s]
        assert px0 >= obs_x0 and px1 <= obs_x1, "pin %s now overhangs the inset OBS" % s

    # ---- END-OF-LINE AUDIT over every shape this file emits -------------------------------------
    # Not a spot check of the pin: the whole layer. The pin was the one that was wrong, but nothing
    # in the previous versions ever asked the question of the OBS strips, the M2 stubs or the rails,
    # which is exactly why two designed-in violations per pin went unnoticed through three library
    # revisions. The audit below answers it for every shape and reports the counts in the JSON: the
    # OBS strips and the rails have short edges at or above eolWidth and so are not end-of-line;
    # the M2 stub ends are minimum width and so ARE end-of-line, but the nearest M2 inside their
    # window is a whole pin row away, far past what the M2 rule asks for.
    m2_stub = {s: ((pins[s][0] + pins[s][2]) // 2 - M2_STUB_W // 2, via_y - M2_STUB_H // 2,
                   (pins[s][0] + pins[s][2]) // 2 + M2_STUB_W // 2, via_y + M2_STUB_H // 2)
               for s in signals}
    geom = {"M1": [("pin " + s, pins[s]) for s in signals]
                  + [("OBS %d..%d" % (y0, y1), (obs_x0, y0, obs_x1, y1)) for y0, y1 in obs]
                  + [(a.power_pin, (0, H - RAIL // 2, W, H + RAIL // 2)),
                     (a.ground_pin, (0, -RAIL // 2, W, RAIL // 2))],
            "M2": [("stub " + s, m2_stub[s]) for s in signals]}
    # A rectangle's four sides are the layer's real edges only while the rectangles stay apart; two
    # that touch would merge and the shared side would stop existing. Establish that first.
    for layer, shp in geom.items():
        for i, (na, ra) in enumerate(shp):
            for nb, rb in shp[i + 1:]:
                assert not (ra[0] <= rb[2] and rb[0] <= ra[2]
                            and ra[1] <= rb[3] and rb[1] <= ra[3]), \
                    "%s %s and %s touch: the edge audit would measure edges that do not exist " \
                    "in the merged layer" % (layer, na, nb)
    eol_bad, eol_edges = [], {}
    for layer, shp in geom.items():
        space, width, within = EOL[layer]
        eol_edges[layer] = sum(1 for _, r in shp for e in _edges(r) if e[1] < width)
        for i, (na, ra) in enumerate(shp):
            for (o, L, a0, a1, c, sign) in _edges(ra):
                if L >= width:
                    continue                   # not end-of-line: the ordinary 0.050 governs it
                for j, (nb, rb) in enumerate(shp):
                    if i == j:
                        continue
                    g = _face(o, a0, a1, c, sign, rb, within)
                    if g is not None and 0 < g < space:
                        eol_bad.append((layer, na, L, nb, g))
    assert not eol_bad, "end-of-line violations designed into %s: %s" % (
        cell, ["%s %s edge %dnm faces %s at %dnm (rule %dnm)"
               % (l, na, L, nb, g, EOL[l][0]) for l, na, L, nb, g in eol_bad[:6]])

    # ---- LEF ----
    L = ["VERSION 5.7 ;", "BUSBITCHARS \"[]\" ;", "DIVIDERCHAR \"/\" ;", "",
         "MACRO %s" % cell, "  CLASS CORE ;",
         "  FOREIGN %s 0 0 ;" % cell, "  ORIGIN 0 0 ;",
         "  SIZE %.3f BY %.3f ;" % (W / 1000.0, H / 1000.0),
         "  SYMMETRY X Y ;", "  SITE %s ;" % deck["site_name"]]
    for s in signals:
        x0, y0, x1, y1 = pins[s]
        cx = (x0 + x1) // 2
        # M1 pin, an M2 stub on the pin's own track, and a via between them. That is the standard
        # answer for a pin the router cannot land on from M1 alone, and characterised libraries use
        # it too -- usually as a horizontal M2 bar over several tracks. We cannot: these cells carry
        # one pin per SITE, so a bar wide enough to be useful would short to its neighbour. A
        # VERTICAL stub on the pin's own M2 track is the same trick at this pin density, and it
        # keeps neighbouring stubs a full site apart. The via itself is named by the rule deck,
        # because a via name is a technology identifier and this package holds none; with the pin
        # on-track the router's own default via fits the same landing, so it is not dependent on
        # the named one either.
        L += ["  PIN %s" % s,
              "    DIRECTION %s ;" % ("OUTPUT" if s in outs else "INPUT"),
              "    USE SIGNAL ;", "    PORT", "      LAYER M1 ;",
              "        RECT %.3f %.3f %.3f %.3f ;" % (x0 / 1000.0, y0 / 1000.0, x1 / 1000.0, y1 / 1000.0),
              "      LAYER M2 ;",
              "        RECT %.3f %.3f %.3f %.3f ;" % tuple(v / 1000.0 for v in m2_stub[s]),
              "      VIA %.3f %.3f %s ;" % (cx / 1000.0, via_y / 1000.0, deck["m1_m2_via_name"]),
              "    END", "  END %s" % s]
    for nm, use, y0, y1 in ((a.power_pin, "POWER", H - RAIL // 2, H + RAIL // 2),
                            (a.ground_pin, "GROUND", -RAIL // 2, RAIL // 2)):
        L += ["  PIN %s" % nm, "    DIRECTION INOUT ;", "    USE %s ;" % use,
              "    SHAPE ABUTMENT ;", "    PORT", "      LAYER M1 ;",
              "        RECT %.3f %.3f %.3f %.3f ;" % (0.0, y0 / 1000.0, W / 1000.0, y1 / 1000.0),
              "    END", "  END %s" % nm]
    L += ["  OBS", "    LAYER M1 ;"]
    for y0, y1 in obs:
        L += ["      RECT %.3f %.3f %.3f %.3f ;" % (obs_x0 / 1000.0, y0 / 1000.0,
                                                   obs_x1 / 1000.0, y1 / 1000.0)]
    L += ["  END", "END %s" % cell, "", "END LIBRARY"]
    lef = os.path.join(a.outdir, cell + ".lef")
    open(lef, "w").write("\n".join(L) + "\n")

    meta = {"cell": cell, "width_um": W / 1000.0, "height_um": H / 1000.0,
            "columns": cols, "column_source": src, "sites": W // cpp_nm,
            "devices": len(devs), "inputs": ins, "outputs": outs,
            "pin_x_um": sorted(round((p[0] + p[2]) / 2000.0, 4) for p in pins.values()),
            "m1_open_tracks_um": [t / 1000.0 for t in open_tr],
            "obs_m1_um": [[y0 / 1000.0, y1 / 1000.0] for y0, y1 in obs],
            "obs_x_um": [obs_x0 / 1000.0, obs_x1 / 1000.0],
            "obs_edge_inset_um": OBS_EDGE / 1000.0,
            "m2_landing_via_y_um": via_y / 1000.0,
            "pin_m1_um": [PIN_W / 1000.0, PIN_H / 1000.0],
            "m2_stub_um": [M2_STUB_W / 1000.0, M2_STUB_H / 1000.0],
            "eol_rule": {k: {"space_um": v[0] / 1000.0, "width_um": v[1] / 1000.0,
                             "within_um": v[2] / 1000.0} for k, v in EOL.items()},
            "eol_edges_emitted": eol_edges,          # edges shorter than eolWidth, per layer
            "eol_violations": len(eol_bad),          # must be 0 -- asserted above
            "routing_complete": False,
            "warning": "ABSTRACT: real placement-derived size and legal pins; NO intra-cell routing. "
                       "Valid for placement and block routing / area measurement. NOT tape-out ready."}
    json.dump(meta, open(os.path.join(a.outdir, cell + ".abstract.json"), "w"), indent=1)
    print("%-34s %2d cols (%s)  %6.3f x %.3f um  %2d sites  pins=%d" %
          (cell, cols, src, W / 1000.0, H / 1000.0, meta["sites"], len(signals)))


if __name__ == "__main__":
    main()
