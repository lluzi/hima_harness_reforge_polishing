#!/usr/bin/env python3
"""Normalize an lclayout-generated LEF abstract to the sky130hd standard-cell convention.

lclayout emits cells with generic rail names (VDD/GND) and every pin typed DIRECTION INOUT / USE
SIGNAL. That geometry is already sky130hd-native -- the tech file (pdk/librecell_sky130_tech.py) was
authored so the met1 rails land on the row template (VGND centered at y=0, VPWR at y=row_height,
each 0.48 tall, width a multiple of the 0.46 site) -- but the NAMES do not match the platform. A cell
whose LEF says VDD/GND while its (foundry-grafted) liberty declares pg_pins VPWR/VGND is unplaceable:
the router bonds the PDN on VPWR/VGND and the optimizer reconciles LEF power pins against lib pg_pins,
so the mismatch makes the cell load but never be used (the Innovus adopted=0 symptom).

This is a NAME/type normalization only -- it never moves geometry:
  VDD  -> VPWR  (USE POWER)      GND -> VGND (USE GROUND)
  add VPB (over the VPWR rail, USE POWER) and VNB (over the VGND rail, USE GROUND) so the LEF carries
    the same four pg pins the foundry liberty references (sky130hd is tapless; the well bias rides the
    rails and real ties come from separately placed tap cells, so coincident rects are faithful).
  signal inputs  -> DIRECTION INPUT ;   signal output -> DIRECTION OUTPUT ;   (USE SIGNAL kept)

Usage: fix_lef_sky130hd.py <in.lef> --inputs A,B,C --output Y[,Z...] -o <out.lef>

Factory patch (see factory/SOURCES.md): --output accepts a comma-separated list so multi-output
cells normalize too; lclayout's lowercase rail names (vdd/gnd) are matched case-insensitively.
"""
import argparse
import re
import sys


def find_pins(macro_body):
    """-> (head, [(name, start, end)], tail) for the PIN blocks inside a MACRO body."""
    pins = [(m.group(2), m.start(), m.end())
            for m in re.finditer(r'[ \t]*PIN\s+(\S+).*?END\s+(\1)\s*\n', macro_body, re.S)]
    if not pins:
        sys.exit('no PIN blocks found in MACRO')
    return macro_body[:pins[0][1]], pins, macro_body[pins[-1][2]:]


def retype(block, direction, use):
    block = re.sub(r'(DIRECTION\s+)\w+(\s*;)', r'\g<1>%s\g<2>' % direction, block, count=1)
    return re.sub(r'(USE\s+)\w+(\s*;)', r'\g<1>%s\g<2>' % use, block, count=1)


def port_body(block):
    m = re.search(r'PORT.*?END\s*\n', block, re.S)
    return m.group(0) if m else 'PORT\n        END\n'


def make_pg(name, use, rail_port):
    return ('      PIN %s\n        DIRECTION INOUT ;\n        USE %s ;\n        %sEND %s\n'
            % (name, use, rail_port, name))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('lef')
    ap.add_argument('--inputs', required=True, help='comma-separated input pin names, e.g. A,B,C')
    ap.add_argument('--output', required=True, help='comma-separated output pin names, e.g. Y or S,CO')
    ap.add_argument('--vdd', default='VDD', help='current power-rail pin name in the LEF')
    ap.add_argument('--gnd', default='GND', help='current ground-rail pin name in the LEF')
    ap.add_argument('-o', '--out', required=True)
    a = ap.parse_args()
    inputs = a.inputs.split(',')
    outputs = a.output.split(',')

    s = open(a.lef).read()
    # Anchor the closing to `END <macroname>` (group 2) -- a bare `END \S+` stops at the first pin's
    # own `END <pin>`, leaving an empty body. Greedy body extends to the true macro terminator.
    mm = re.search(r'(MACRO\s+(\S+)\s*\n)(.*)(END\s+\2\s*\n)', s, re.S)
    if not mm:
        sys.exit('no MACRO ... END block found')
    macro_open, body, macro_close = mm.group(1), mm.group(3), mm.group(4)
    head, pins, tail = find_pins(body)

    out, vpwr_port, vgnd_port = [], None, None
    for name, start, end in pins:
        block = body[start:end]
        if name.lower() == a.vdd.lower():
            block = re.sub(r'\b%s\b' % re.escape(name), 'VPWR', retype(block, 'INOUT', 'POWER'))
            vpwr_port = port_body(block)
        elif name.lower() == a.gnd.lower():
            block = re.sub(r'\b%s\b' % re.escape(name), 'VGND', retype(block, 'INOUT', 'GROUND'))
            vgnd_port = port_body(block)
        elif name in inputs:
            block = retype(block, 'INPUT', 'SIGNAL')
        elif name in outputs:
            block = retype(block, 'OUTPUT', 'SIGNAL')
        else:
            sys.exit('unclassified pin %r -- pass it in --inputs/--output' % name)
        out.append(block)

    if vpwr_port:
        out.append(make_pg('VPB', 'POWER', vpwr_port))
    if vgnd_port:
        out.append(make_pg('VNB', 'GROUND', vgnd_port))

    new_macro = macro_open + head + ''.join(out) + tail + macro_close
    open(a.out, 'w').write(s[:mm.start()] + new_macro + s[mm.end():])
    print('fix_lef_sky130hd: %s -> %s (VPWR/VGND/VPB/VNB, %d inputs + %s)'
          % (a.lef, a.out, len(inputs), a.output))


if __name__ == '__main__':
    main()
