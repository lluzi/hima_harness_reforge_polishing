#!/usr/bin/env python3
"""Layout of the analog-ota-migrate Pack's two-stage Miller OTA in GF180MCU (python3 >= 3.9, stdlib).

Runs inside the open-source tool image (Magic, netgen, KLayout and /foss/pdks/gf180mcuD):

  ota_layout.py all <design.json> <out_dir>

It writes the Pack's OTA as a subcircuit of GF180 devices, ota_ref.spice: the Pack's own device
lines (nets, models, W, L as ota_cli.py NETS gives them) with Rz as a ppolyf_u and Cc as a MIM
capacitor sized for the design's values, then lays that netlist out through cell_layout.py, the
netlist-driven route (see its products there; the cell is `ota`). Pins: vdd, vss, inp, inn, out,
ibias (the Pack's nbias node, fed by the bias current source).
"""
import hashlib
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cell_layout  # noqa: E402

NETS = {"M1": ("x", "inn", "tail", "vss"), "M2": ("y", "inp", "tail", "vss"), "M3": ("x", "x", "vdd", "vdd"),
        "M4": ("y", "x", "vdd", "vdd"), "M5": ("tail", "nbias", "vss", "vss"), "M6": ("out", "y", "vdd", "vdd"),
        "M7": ("out", "nbias", "vss", "vss"), "M8": ("nbias", "nbias", "vss", "vss")}
KIND = {"M1": "nmos", "M2": "nmos", "M3": "pmos", "M4": "pmos", "M5": "nmos", "M6": "pmos", "M7": "nmos", "M8": "nmos"}
MODEL = {"nmos": "nfet_03v3", "pmos": "pfet_03v3"}

# ppolyf_u (sm141064.spice): R = rsh * L / (W - 2 dw) + 2 * rsh_t * 1um / (W - 2 dw), at tt
RSH_PPOLY, RSH_PPOLY_T, DW_PPOLY = 350.0, 60.0, 0.0255
# cap_mim_2f0_m4m5_noshield (sm141064_mim.spice): C = 1.99 fF/um2 * area + 0.2383 fF/um * perimeter
C_AREA, C_PERI = 1.99e-15, 0.2383e-15


def rz_geometry(r_ohm, w_nm=1000):
    """The ppolyf_u body length (on a 10 nm step) for the design's Rz at width w_nm."""
    weff = w_nm / 1000.0 - 2 * DW_PPOLY
    l_nm = int(round((r_ohm - 2 * RSH_PPOLY_T / weff) * weff / RSH_PPOLY * 100)) * 10
    if l_nm < 1000:
        raise cell_layout.Error("Rz %.1f Ohm needs a ppolyf_u shorter than 1 um" % r_ohm)
    return w_nm, l_nm, RSH_PPOLY * (l_nm / 1000.0) / weff + 2 * RSH_PPOLY_T / weff


def cc_geometry(c_f):
    """A square MIM plate (10 nm step) for the design's Cc."""
    a, b = C_AREA, 4 * C_PERI
    s_nm = max(5000, int(round((-b + math.sqrt(b * b + 4 * a * c_f)) / (2 * a) * 100)) * 10)
    s = s_nm / 1000.0
    return s_nm, C_AREA * s * s + C_PERI * 4 * s


def ref_netlist(design):
    rw, rl, r_ohm = rz_geometry(design["rzKohm"] * 1000.0)
    cs, c_f = cc_geometry(design["ccPf"] * 1e-12)
    lines = ["* The Pack's two-stage Miller OTA (analog-ota-migrate ota_cli.py NETS), gf180mcuD devices",
             ".subckt ota vdd vss inp inn out ibias"]
    for name in sorted(NETS):
        d = design["devices"][name]
        nets = " ".join("ibias" if n == "nbias" else n for n in NETS[name])
        lines.append("X%s %s %s w=%gu l=%gu" % (name, nets, MODEL[KIND[name]], d["wUm"], d["lUm"]))
    lines.append("XRZ y cz vss ppolyf_u r_width=%gu r_length=%gu" % (rw / 1000.0, rl / 1000.0))
    lines.append("XCC cz out cap_mim_2f0_m4m5_noshield c_width=%gu c_length=%gu" % (cs / 1000.0, cs / 1000.0))
    lines += [".ends ota", ""]
    facts = dict(rz=dict(device="ppolyf_u", wUm=rw / 1000.0, lUm=rl / 1000.0, ohmModelTt=round(r_ohm, 2),
                         ohmDesign=design["rzKohm"] * 1000.0),
                 cc=dict(device="cap_mim_2f0_m4m5_noshield", wUm=cs / 1000.0, lUm=cs / 1000.0, pfModelTt=round(c_f * 1e12, 5),
                         pfDesign=design["ccPf"]))
    return "\n".join(lines), facts


def main(argv):
    if len(argv) < 4 or argv[1] != "all":
        print(__doc__, file=sys.stderr)
        return 2
    design_path = Path(argv[2]).resolve()
    design = json.loads(design_path.read_text())
    out = Path(argv[3]).resolve()
    if out.exists() and any(out.iterdir()):
        raise cell_layout.Error("the output folder %s is not empty: give a new one" % out)
    out.mkdir(parents=True, exist_ok=True)
    text, facts = ref_netlist(design)
    src = out / "ota_design.spice"
    src.write_text(text)
    sha = hashlib.sha256(design_path.read_bytes()).hexdigest()
    result = cell_layout.cmd_all(str(src), "ota", str(out), extra=dict(design=str(design_path), designSha256=sha, ota=facts),
                                 allowed=("ota_design.spice",))
    return 0 if result["ok"] else 4


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv))
    except cell_layout.Error as error:
        print("ota_layout: %s" % error, file=sys.stderr)
        sys.exit(3)
