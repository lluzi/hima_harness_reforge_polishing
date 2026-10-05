#!/usr/bin/env python3
"""Fix the pin-in-OBS LEF bug that makes lclayout/northstar custom cells unroutable.

Root cause (proven on run10/fleet, 2026-07-20): the LEF generator emitted ALL cell metal as
OBS -- including the PIN pads and the VPWR/VGND rails -- so every wire the router lands on a
custom pin is a "Regular Wire vs Blockage of Cell (met1)" short (996/1000 blamed blockage
cells were custom refs; y-bands matched pin-pad positions exactly).

Fix per LEF:
  1. Drop any OBS rect that overlaps a same-layer PIN PORT rect (pin metal must not be OBS).
  2. Drop the whole `poly` OBS section (layer undefined in the routing tech LEF -> Innovus
     IMPLF-63 "ignored" warnings; pure noise).
  3. Keep genuine internal-only metal as OBS (real blockage).

Usage: fix_lef_obs.py <in.lef> [<in.lef> ...] -o <outdir>
Writes <outdir>/<basename> and prints per-file stats.
"""
import argparse
import os
import re

DROP_LAYERS = {"poly"}


def parse_pin_rects(text):
    """{layer: [(x1,y1,x2,y2), ...]} across all PINs."""
    rects = {}
    for m in re.finditer(r"\n\s*PIN\s+(\S+)(.*?)\n\s*END\s+\1\b", text, re.S):
        layer = None
        for ln in m.group(2).splitlines():
            lm = re.search(r"\bLAYER\s+(\S+)\s*;", ln)
            if lm:
                layer = lm.group(1)
            rm = re.search(r"\bRECT\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)", ln)
            if rm and layer:
                rects.setdefault(layer, []).append(tuple(float(v) for v in rm.groups()))
    return rects


def overlaps(a, b):
    return a[0] < b[2] and b[0] < a[2] and a[1] < b[3] and b[1] < a[3]


def fix_obs(text, pin_rects):
    """Rewrite the OBS block; return (new_text, stats)."""
    m = re.search(r"(\n\s*OBS\s*\n)(.*?)(\n\s*END\s*\n)", text, re.S)
    stats = {"dropped_pin_dup": 0, "dropped_layer": 0, "kept": 0}
    if not m:
        return text, stats
    out_lines = []
    layer = None
    layer_header = None  # pending LAYER line, emitted only if a rect under it survives
    for ln in m.group(2).splitlines():
        lm = re.search(r"^\s*LAYER\s+(\S+)\s*;", ln)
        if lm:
            layer = lm.group(1)
            layer_header = ln
            continue
        rm = re.search(r"\bRECT\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)", ln)
        if rm and layer:
            if layer in DROP_LAYERS:
                stats["dropped_layer"] += 1
                continue
            r = tuple(float(v) for v in rm.groups())
            if any(overlaps(r, p) for p in pin_rects.get(layer, [])):
                stats["dropped_pin_dup"] += 1
                continue
            if layer_header is not None:
                out_lines.append(layer_header)
                layer_header = None
            out_lines.append(ln)
            stats["kept"] += 1
        elif ln.strip():
            out_lines.append(ln)
    if stats["kept"] == 0:
        # nothing left to obstruct: drop the whole OBS block
        new = text[:m.start()] + "\n" + text[m.end():]
    else:
        new = text[:m.start(1)] + m.group(1) + "\n".join(out_lines) + m.group(3) + text[m.end(3):]
    return new, stats


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("lefs", nargs="+")
    ap.add_argument("-o", "--outdir", required=True)
    a = ap.parse_args()
    os.makedirs(a.outdir, exist_ok=True)
    for path in a.lefs:
        text = open(path).read()
        pins = parse_pin_rects(text)
        new, st = fix_obs(text, pins)
        out = os.path.join(a.outdir, os.path.basename(path))
        open(out, "w").write(new)
        npin = sum(len(v) for v in pins.values())
        print(f"  {os.path.basename(path):32} pins={npin:2}  obs: dropped {st['dropped_pin_dup']:2} pin-dup"
              f" + {st['dropped_layer']:2} {'/'.join(sorted(DROP_LAYERS))}, kept {st['kept']:2}")


if __name__ == "__main__":
    main()
