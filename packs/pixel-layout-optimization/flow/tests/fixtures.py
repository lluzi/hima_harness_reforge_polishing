"""Builder for the synthetic pixel case used by every test.

Everything here is invented: no coordinate, value, layer name or net name is
copied from the customer case. The synthetic layers are ``Poly GateA GateB
CapMark Via Metal Plan Anode Bank Bound Cath`` and the nets are ``S`` (storage
node), ``VP`` (storage net / supply), ``SC`` (scan, crosses the cell boundary),
``EN``, ``R1``, ``DL`` (data) and ``AN`` (anode).

The module imports only the standard library at import time, so the stdlib
tests (``test_core`` / ``test_manifest`` / ``test_goal`` / ``test_rules``) may
import it with no numeric packages present. ``build_case`` draws a real GDS with
gdstk (imported lazily); ``build_text_case`` writes a byte-identical-interface
case with a placeholder GDS file so the stdlib tests can exercise ``load_case``.

Synthetic layout (top cell ``pix``, 20 x 40 um, grid 0.005 um):

* ``Bound``/``Cath``: the 20x40 outline and its outline copy.
* Storage capacitor, lower left: a ``GateA`` plate (net ``S``) at (3,6)-(9,12)
  under a smaller ``GateB`` plate (net ``VP``) at (3.5,6.5)-(8.5,11.5), both
  inside a ``CapMark`` marker at (3,6)-(9,12).
* Scan line ``SC``: a vertical ``GateA`` strip at x=[15.5,16.5] running y=-1..41,
  so it crosses the top and bottom cell edges (periodic copies matter).
* Two TFTs: horizontal ``Poly`` strips at y=[15,16] and y=[24,25] crossing ``SC``;
  each channel is ``Poly & GateA``.
* Contacts (``Via``) join ``Metal`` down to ``GateB`` (the VP contact), to
  ``GateA`` (the S contact, placed where no GateB covers it) and to the
  poly-outside-gate region (the data contact under the ``DL`` line).
* ``DL``: a vertical ``Metal`` data line at x=[13,14].
* Anode: a ``Metal`` pad (net ``AN``) joined up to an ``Anode`` plate through a
  ``Plan`` planarisation via, with an emission opening on ``Bank``.
* Slack: the drawn geometry stays inside ~[1,18] x [2,38], leaving >10% per axis
  for a later compactor to shrink legally.

``build_case(tmpdir)`` / ``build_text_case(tmpdir)`` both return
``{"manifest", "sitecaps", "gds", "dir"}``.
"""
from __future__ import annotations

import os
import sys

from pixelopt import core

_TESTS_DIR = os.path.dirname(os.path.abspath(__file__))
_STANDIN = os.path.join(_TESTS_DIR, "standin_eda.py")

GRID_UM = 0.005
OUTLINE = (20.0, 40.0)
TOP_CELL = "pix"

# Placeholder GDS bytes for the stdlib path (load_case only checks the digest).
_PLACEHOLDER_GDS = b"PIXELOPT-SYNTHETIC-GDS placeholder for top cell 'pix'\n"


# --------------------------------------------------------------------------- #
# Decks (Argus DRC dialect) and the other text inputs
# --------------------------------------------------------------------------- #

def build_authority_deck():
    """The synthetic authority DRC deck (uses ``precision( 100 )``, not db precision)."""
    return """///////// Synthetic DRC deck (authority) /////////
//// invented values only; no customer data ////

//// Environment ////
precision( 100 )
resolution( db 1 )
layout_input( format gds )
layout_input( path "pixel.gds" )
layout_input( top_cell "pix" )
drc_result( db "synthetic_drc.db" )
drc_summary( "synthetic_drc.sum" )
drc_tolerance( distance 0.001 )

UNIT ( LEN u )

//// Variables ////
var( metal_min_w 1.0 )
var( metal_min_space 1.5 )
var( gatea_min_w 0.8 )
var( gatea_min_space 0.7 )
var( via_min_w 0.35 )
var( poly_enc_gate 0.5 )

//// Layers ////
layer( Poly 3 )
layer( GateA 2 )
layer( GateB 19 )
layer( CapMark 7 )
layer( Via 5 )
layer( Metal 4 )
layer ( Plan 9 )
layer ( Anode 6 )
layer( Bank 14 )
layer( Bound 12 )
layer( Cath 11 )

//// Derived ////
GAB = geom_and( GateA GateB )

//// Checks ////
rule M.W {
; Metal min width is $metal_min_w um
width( Metal < 1.0 adjacent < 90 point_touch region )
}

rule M.SP {
; Metal min spacing is $metal_min_space um
space( Metal < 1.2 adjacent < 90 point_touch region )
}

rule GA.W {
; GateA min width
width( GateA < $gatea_min_w adjacent < 90 point_touch region )
}

rule GA.SP {
; GateA min spacing
space( GateA < 0.7 adjacent < 90 point_touch region )
}

rule MB.SP {
; Metal to GateB layer min spacing
space( Metal GateB < 0.6 adjacent < 90 point_touch region )
}

rule V.W {
; Via min width
width( Via < $via_min_w adjacent < 90 point_touch region )
}

rule P.ENC {
; GateA encloses Poly
enc( Poly GateA < 0.5 adjacent < 90 point_touch region )
}

rule CAP.ENC {
; GateB encloses the capacitor plate
enc( GAB GateB < 0.25 adjacent < 90 point_touch region )
}

//rule DEAD.1 {
//; this rule is commented out and must be ignored
//width( Bank < 9.9 adjacent < 90 point_touch region )
//}

rule VIA.LAND {
; a Via shape must land on Metal and a gate/poly layer
geom_interact( Via Metal )
}

rule offgrid_check {
check_original_layer( offgrid_vertex )
}
"""


def build_reference_deck():
    """A second deck with slightly different values and real db-precision present."""
    return """///////// Synthetic DRC deck (reference) /////////
//// invented values; disagrees with the authority on spacing ////

layout_use_db_precision( yes )
resolution( db 1 )
layout_input( format gds )
layout_input( path "pixel.gds" )
layout_input( top_cell "pix" )
drc_result( db "ref_drc.db" )
drc_summary( "ref_drc.sum" )
drc_tolerance( distance 0.001 )

UNIT ( LEN u )

var( metal_min_w 1.05 )

layer( Poly 3 )
layer( GateA 2 )
layer( GateB 19 )
layer( Via 5 )
layer( Metal 4 )

rule M.W {
; Metal min width
width( Metal < 1.05 adjacent < 90 point_touch region )
}

rule M.SP {
; Metal min spacing
space( Metal < 1.25 adjacent < 90 point_touch region )
}

rule GA.SP {
; GateA min spacing
space( GateA < 0.75 adjacent < 90 point_touch region )
}
"""


def build_lvs_template():
    """Calibre-style LVS runset template with the required @LAYOUT@/@SOURCE@ only."""
    return """// synthetic Calibre LVS runset (template)
LAYOUT PATH "@LAYOUT@"
LAYOUT PRIMARY "pix"
LAYOUT SYSTEM GDS
SOURCE PATH "@SOURCE@"
SOURCE PRIMARY "pix"
SOURCE SYSTEM SPICE
LVS REPORT "lvs.rep"
LVS REPORT OPTION A
"""


def build_schematic():
    """A synthetic SPICE netlist for the pixel (device + storage capacitor)."""
    return """* synthetic pixel schematic (invented)
.subckt pix SC EN R1 DL VP S AN
mt1 DL SC S VP nch w=3u l=1u
mt2 S EN R1 VP nch w=3u l=1u
c0 S VP 12f
c1 AN VP 8f
.ends pix
"""


def build_cst_schematic_template():
    """Schematic template for a declared Cst change; carries the @CST_FF@ placeholder."""
    return """* synthetic pixel schematic with a declared storage capacitor (template)
.subckt pix SC EN R1 DL VP S AN
mt1 DL SC S VP nch w=3u l=1u
mt2 S EN R1 VP nch w=3u l=1u
c0 S VP @CST_FF@f
c1 AN VP 8f
.ends pix
"""


def _extraction_files():
    """Logical name -> (filename, placeholder contents) for the extraction set."""
    return {
        "techLibOalib": ("ext_techlib.oa", "synthetic OA tech library placeholder\n"),
        "techLibTechDb": ("ext_tech.db", "synthetic tech.db placeholder\n"),
        "layerMap": ("ext_layer.map", "Poly 3 0\nGateA 2 0\nMetal 4 0\n"),
        "etf": ("ext.etf", "synthetic ETF placeholder\n"),
        "layerMapBool": ("ext_layer_bool.map", "synthetic boolean layer map placeholder\n"),
        "tclTemplate": ("ext_rce.tcl.tmpl",
                        "# synthetic RCExplorer input (template)\n"
                        "set work_dir @D@\n"
                        "set top pix\n"
                        "extract -mode pixel -out RCEResult.sp\n"),
    }


# --------------------------------------------------------------------------- #
# GDS writers
# --------------------------------------------------------------------------- #

def _write_placeholder_gds(path):
    with open(path, "wb") as fh:
        fh.write(_PLACEHOLDER_GDS)


def _write_real_gds(path):
    import gdstk

    lib = gdstk.Library()
    cell = lib.new_cell(TOP_CELL)

    def rect(x0, y0, x1, y1, layer, datatype=0):
        cell.add(gdstk.rectangle((x0, y0), (x1, y1), layer=layer, datatype=datatype))

    def label(text, x, y, layer):
        cell.add(gdstk.Label(text, (x, y), layer=layer, texttype=0))

    # Outline and its copy.
    rect(0, 0, 20, 40, 12)        # Bound
    rect(0, 0, 20, 40, 11)        # Cath (outline copy)

    # Storage capacitor (GateA plate S under GateB plate VP, inside CapMark).
    rect(3, 6, 9, 12, 2)          # GateA plate (net S)
    rect(3.5, 6.5, 8.5, 11.5, 19) # GateB plate (net VP)
    rect(3, 6, 9, 12, 7)          # CapMark marker
    label("S", 6, 9, 2)
    label("VP", 6, 9, 19)

    # Scan line SC: vertical GateA strip crossing the top and bottom cell edges.
    rect(15.5, -1, 16.5, 41, 2)
    label("SC", 16, 20, 2)

    # Two TFT poly strips crossing SC -> channels = Poly & GateA.
    rect(13, 15, 18, 16, 3)
    rect(13, 24, 18, 25, 3)
    label("DL", 17.5, 15.5, 3)    # poly source/drain net tied to the data line

    # Enable line EN (horizontal GateA) and reset line R1 (horizontal Metal).
    rect(1, 30, 10, 31, 2)
    label("EN", 5, 30.5, 2)
    rect(1, 33, 12, 34, 4)
    label("R1", 5, 33.5, 4)

    # Data line DL (vertical Metal).
    rect(13, 2, 14, 38, 4)
    label("DL", 13.5, 20, 4)

    # VP supply metal over GateB, joined by a Via (landing order: GateB first).
    rect(3.5, 6.8, 5, 8, 4)
    rect(4, 7, 4.5, 7.5, 5)
    label("VP", 4.2, 7.2, 4)

    # S contact: Via joins a Metal pad to GateA where no GateB covers it (x>8.5).
    rect(8.5, 8.8, 9.5, 9.6, 4)
    rect(8.6, 9, 8.9, 9.3, 5)

    # Data contact: Via joins the DL metal to the poly-outside-gate region.
    rect(13.2, 15.2, 13.6, 15.6, 5)

    # Anode AN: a Metal pad joined up to an Anode plate through a Plan via.
    rect(10, 28, 12, 30, 4)       # Metal (net AN)
    label("AN", 11, 29, 4)
    rect(10.3, 28.3, 11.7, 29.7, 9)   # Plan planarisation via
    rect(9, 27, 15, 36, 6)            # Anode plate
    rect(10, 28, 14, 35, 14)          # Bank emission opening

    lib.write_gds(path)


# --------------------------------------------------------------------------- #
# Assembly
# --------------------------------------------------------------------------- #

def _manifest(ref, decks, lvs_deck, schematic, cst_schematic, extraction_refs,
              gds_ref):
    return {
        "schema": "pixel.case-manifest/1",
        "caseId": "synthetic-1",
        "candidateTopCell": TOP_CELL,
        "original": {"gds": gds_ref, "topCell": TOP_CELL},
        "gridUm": GRID_UM,
        "layers": {
            "Poly": {"gds": [3, 0], "roles": ["conductor", "poly", "opaque"], "stack": "device"},
            "GateA": {"gds": [2, 0], "roles": ["conductor", "gate", "opaque"], "stack": "device"},
            "GateB": {"gds": [19, 0], "roles": ["conductor", "opaque"], "stack": "device"},
            "CapMark": {"gds": [7, 0], "roles": ["marker"], "stack": "device"},
            "Via": {"gds": [5, 0], "roles": ["contact"], "stack": "device"},
            "Metal": {"gds": [4, 0], "roles": ["conductor", "opaque"], "stack": "device"},
            "Plan": {"gds": [9, 0], "roles": ["optical"], "stack": "top"},
            "Anode": {"gds": [6, 0], "roles": ["conductor", "optical", "opaque"], "stack": "top"},
            "Bank": {"gds": [14, 0], "roles": ["optical", "emission-opening"], "stack": "top"},
            "Bound": {"gds": [12, 0], "roles": ["outline"]},
            "Cath": {"gds": [11, 0], "roles": ["outline-copy"]},
        },
        "freePairs": [["GateB", "Poly"]],
        "devices": {"polyLayer": "Poly", "gateLayer": "GateA"},
        "connectivity": {
            "contactLayer": "Via",
            "topConductor": "Metal",
            "landingOrder": ["GateB", "GateA", "PolySD"],
            "labelLayers": {"3": "Poly", "2": "GateA", "19": "GateB", "4": "Metal"},
            "anodeVia": {"layer": "Plan", "joins": ["Metal", "Anode"]},
        },
        "nets": {"storageNode": "S", "storageNet": "VP", "anode": "AN",
                 "anodeLayers": ["Anode"]},
        "ratioDefinitions": {"narrow": ["EN", "R1"], "broad": ["EN", "R1", "SC", "AN"]},
        "couplingLimits": [{"pair": ["S", "DL"], "maxFf": 0.5}],
        "loadLimitedLines": ["SC", "AN"],
        "targets": {"outlineUm": [20.0, 40.0],
                    "ratioPct": {"broad": 9.0, "narrow": 2.0},
                    "transmittancePct": [5.0, 30.0]},
        "cst": {"markerLayer": "CapMark", "plateLayers": ["GateA", "GateB"],
                "coefficientFfPerUm2": 0.6, "tolerancePct": 2.0,
                "schematicTemplate": cst_schematic},
        "decks": {"authority": decks["authority"], "reference": decks["reference"]},
        "interactRules": [
            {"id": "VIA.LAND", "layer": "Via",
             "mustTouch": [["GateB", "Metal"], ["GateA", "Metal"], ["Poly", "Metal"]]}
        ],
        "lvs": {"engine": "calibre", "deckTemplate": lvs_deck, "schematic": schematic},
        "extraction": dict(extraction_refs, libName="pix", cellName="pix"),
        "alps": {"consistent": False},
    }


def _sitecaps():
    return {
        "schema": "pixel.site-capabilities/1",
        "launcher": {"argv": [], "env": {}},
        "python": sys.executable,
        "reaperPython": sys.executable,
        "envScripts": [],
        "tools": {
            "argus": [sys.executable, _STANDIN, "argus"],
            "calibre": [sys.executable, _STANDIN, "calibre"],
            "gdsIn": [sys.executable, _STANDIN, "gdsIn"],
            "rcexplorer": [sys.executable, _STANDIN, "rcexplorer"],
        },
        "gdsInLibraryPath": "",
        "env": {"QT_QPA_PLATFORM": "offscreen"},
        "parallelJobs": 3,
        "timeoutsS": {"drc": 300, "lvs": 300, "gdsIn": 300, "rce": 900},
        "expectVersions": {"python": "3.8", "numpy": "1.24", "scipy": "1.10",
                           "shapely": "2.0", "gdstk": "0.9"},
        "drcStripFunctions": ["geom_interact"],
    }


def _assemble(tmpdir, gds_writer):
    tmpdir = os.path.abspath(tmpdir)
    if not os.path.isdir(tmpdir):
        os.makedirs(tmpdir)

    def write_text(fname, content):
        with open(os.path.join(tmpdir, fname), "w", encoding="utf-8") as fh:
            fh.write(content)

    def ref(fname):
        return {"path": fname, "sha256": core.sha256_file(os.path.join(tmpdir, fname))}

    gds_path = os.path.join(tmpdir, "pixel.gds")
    gds_writer(gds_path)

    write_text("deck_authority.drc", build_authority_deck())
    write_text("deck_reference.drc", build_reference_deck())
    write_text("lvs.svrf.tmpl", build_lvs_template())
    write_text("schematic.sp", build_schematic())
    write_text("schematic_cst.tmpl", build_cst_schematic_template())
    for _, (fname, content) in _extraction_files().items():
        write_text(fname, content)

    extraction_refs = {}
    for logical, (fname, _content) in _extraction_files().items():
        extraction_refs[logical] = ref(fname)

    manifest = _manifest(
        ref=ref,
        decks={"authority": ref("deck_authority.drc"),
               "reference": ref("deck_reference.drc")},
        lvs_deck=ref("lvs.svrf.tmpl"),
        schematic=ref("schematic.sp"),
        cst_schematic=ref("schematic_cst.tmpl"),
        extraction_refs=extraction_refs,
        gds_ref=ref("pixel.gds"),
    )

    manifest_path = os.path.join(tmpdir, "case-manifest.json")
    sitecaps_path = os.path.join(tmpdir, "site-capabilities.json")
    core.write_json(manifest_path, manifest)
    core.write_json(sitecaps_path, _sitecaps())

    return {"manifest": manifest_path, "sitecaps": sitecaps_path,
            "gds": gds_path, "dir": tmpdir}


def build_text_case(tmpdir):
    """Assemble the full synthetic case with a placeholder GDS (stdlib only)."""
    return _assemble(tmpdir, _write_placeholder_gds)


def build_case(tmpdir):
    """Assemble the full synthetic case with a real gdstk-drawn GDS."""
    return _assemble(tmpdir, _write_real_gds)
