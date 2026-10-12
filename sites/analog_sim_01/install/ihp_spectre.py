#!/usr/bin/env python3
"""Write a Spectre-readable copy of IHP SG13G2's low-voltage MOS models (open PDK, Apache-2.0).

usage: ihp_spectre.py <IHP_NGSPICE_MODELS_DIR> <OUT_DIR>

Writes <OUT_DIR>/sg13g2_lv_spectre.lib (the devices) and <OUT_DIR>/cornerMOSlv_spectre.lib (IHP's
corner file with its typical/slow/fast/skew sections, each including the Spectre device file
instead of the ngspice one; the mismatch and statistical sections are left out).

IHP ships these devices for ngspice: a subcircuit per device whose PSP 103.6 model card
(`psp103va`, an OSDI Verilog-A model) sits in sg13g2_moslv_parm.lib, and whose instance is chosen
with ngspice `.if` blocks (RF or not, given or computed diffusion areas, odd or even finger count).
Spectre has PSP 103.6 built in (`psp103`, version=103.6) and reads SPICE syntax under
`simulator lang=spice`, but has no `.if`. This writes, per device, the same subcircuit with:

- the same model card, with `psp103va` -> `psp103`, `level = 103.60` -> `level=103 version=103.6`,
  `type = +1/-1` -> `type=n/p` (Spectre's spelling; `+1` would be read as p), and the Verilog-A
  safe-operating-area limits (swsoa, v*_max), which Spectre's psp103 does not have, left out;
- one instance whose areas and perimeters use IHP's own odd/even-finger formulas as a conditional
  expression (rfmode=0, computed areas: the schematic-level case), with `trise` for the
  temperature rise (Spectre's name for the Verilog-A `dta`).

The corner sections are IHP's own `.param` lines, each including this device file instead.
Checked against IHP's OSDI deck in ngspice on 2026-10-12: the same drain currents to the printed
digit (see sites/analog_sim_01/README.md).
"""
import re
import sys
from pathlib import Path

ODD = dict(
    as_="max(w/ng,wmin)*(z1+((ng-1)/2)*z2)", ad="max(w/ng,wmin)*(z1+((ng-1)/2)*z2)",
    ps="2*(max(w/ng,wmin)*((ng-1)/2+1)+z1+(ng-1)/2*z2)", pd="2*(max(w/ng,wmin)*((ng-1)/2+1)+z1+(ng-1)/2*z2)")
EVEN = dict(
    as_="max(w/ng,wmin)*(2*z1+max(0,(ng-2)/2)*z2)", ad="max(w/ng,wmin)*z2/2*ng",
    ps="2*(max(w/ng,wmin)*(2+max(ng-2,0)/2)+2*z1+max(ng-2,0)/2*z2)", pd="(max(w/ng,wmin)+z2)*ng")


def model_card(parm_text, name):
    m = re.search(r"^\.model %s psp103va\b.*?(?=^\.model |\Z)" % re.escape(name), parm_text, re.M | re.S)
    if not m:
        raise SystemExit("no model card %s" % name)
    card = m.group(0).rstrip() + "\n"
    card = card.replace(".model %s psp103va" % name, ".model %s psp103" % name, 1)
    card, n = re.subn(r"\blevel\s*=\s*103\.60\b", "level=103 version=103.6", card)
    if n != 1:
        raise SystemExit("%s: expected level = 103.60 once" % name)
    # Spectre's psp103 states the channel type as n or p; the Verilog-A card says +1 or -1.
    card, n = re.subn(r"\btype\s*=\s*([+-]?1)\b", lambda m: "type=%s" % ("n" if m.group(1) in ("1", "+1") else "p"), card)
    if n != 1:
        raise SystemExit("%s: expected one type = +1/-1" % name)
    # Safe-operating-area check limits of the Verilog-A model; Spectre's psp103 has no such parameters.
    card = re.sub(r"\b(swsoa|vdb_max|vsb_max|vgs_max|vgd_max|vgb_max|vds_max|vbs_max)\s*=\s*\S+", "", card, flags=re.I)
    return "\n".join(l for l in card.splitlines() if not l.lstrip().startswith("*")) + "\n"


def device(mod_text, parm_text, sub, model):
    head = re.search(r"^\.subckt %s d g s b\n(\+[^\n]*\n)+" % sub, mod_text, re.M)
    if not head:
        raise SystemExit("no subckt %s" % sub)
    odd = "floor(floor(ng/2+0.501)*2+0.001) != ng"
    geom = " ".join("%s='(%s) ? %s : %s'" % (k.rstrip("_"), odd, ODD[k], EVEN[k]) for k in ODD)
    return "".join([head.group(0), model_card(parm_text, model),
                    "M%s d g s b %s w=w l=l nf=ng mult=m %s trise=trise ngcon=2 delvto=0 factuo=1\n" % (sub, model, geom),
                    ".ends %s\n" % sub])


def corners(corner_text):
    """IHP's corner sections without mismatch or statistics, each including the Spectre devices."""
    out = []
    for m in re.finditer(r"^\.LIB (mos_(?:tt|ss|ff|sf|fs))\n(.*?)^\.ENDL \1\n", corner_text, re.M | re.S):
        body = m.group(2)
        if body.count(".include sg13g2_moslv_mod.lib") != 1:
            raise SystemExit("section %s does not include sg13g2_moslv_mod.lib once" % m.group(1))
        out.append(".LIB %s\n%s.ENDL %s\n" % (m.group(1), body.replace(".include sg13g2_moslv_mod.lib", ".include sg13g2_lv_spectre.lib"), m.group(1)))
    if len(out) != 5:
        raise SystemExit("expected the five corner sections tt ss ff sf fs, found %d" % len(out))
    return "\n".join(out)


def main(models_dir, out_dir):
    d = Path(models_dir)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    mod, parm = (d / "sg13g2_moslv_mod.lib").read_text(), (d / "sg13g2_moslv_parm.lib").read_text()
    body = ["* Spectre-readable IHP SG13G2 low-voltage MOS (rfmode=0), written by ihp_spectre.py from",
            "* IHP-Open-PDK sg13g2_moslv_mod.lib and sg13g2_moslv_parm.lib (Apache-2.0). Load under",
            "* `simulator lang=spice` after a `.lib cornerMOSlv.lib mos_<corner>` section.", ""]
    body.append(device(mod, parm, "sg13_lv_nmos", "sg13g2_lv_nmos_psp"))
    body.append(device(mod, parm, "sg13_lv_pmos", "sg13g2_lv_pmos_psp"))
    (out / "sg13g2_lv_spectre.lib").write_text("\n".join(body))
    (out / "cornerMOSlv_spectre.lib").write_text("* IHP SG13G2 cornerMOSlv.lib (Apache-2.0), corners for Spectre, written by ihp_spectre.py\n\n"
                                                + corners((d / "cornerMOSlv.lib").read_text()))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
