#!/usr/bin/env python3
"""Compose a MODELED liberty (.lib) + LEF for a fused two-cell pattern from the foundry sub-cell models.

A fused cell C1->C2 wires C1's output into one C2 input through an internal node. We synthesize its
models analytically from the FOUNDRY's own characterization of C1 and C2 (so it's grounded in real
data, not invented):
  - through-arc (an input of C1): delay = stage-1 arc @(C2 input cap) + stage-2 arc @(output load),
    slew propagated between stages. This is a 2-stage NLDM composition on C2's output grid.
  - direct-arc (another input of C2): stage-2 arc copied as-is.
  - input caps from the driving sub-cell; leakage/area composed; fusion removes the inter-cell net.
This is a MODEL for fast library-scale PPA *exploration/ranking*, not sign-off.

Usage: model_fused_cell.py <base.lib> <spec.json> <out.lib> <out.lef>
spec.json = {name, cell1, c1_out, cell2, c2_in, output, area_factor,
             pins:{FUSEDPIN:[<"cell1"|"cell2">, subpin], ...}, function}
"""
import sys, re, json
import numpy as np

base, specf, outlib, outlef = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
spec = json.load(open(specf))
T = open(base).read()
ROW_H = 2.72        # sky130hd unithd row height (um)
SITE_W = 0.46       # unithd site pitch

# ---- liberty parsing ----------------------------------------------------------------------------
def block(kind, name):
    m = re.search(r'\n *%s\s*\("%s"\)' % (kind, re.escape(name)), T)
    i = T.index('{', m.end()); d = 1; j = i + 1
    while d and j < len(T):
        d += (T[j] == '{') - (T[j] == '}'); j += 1
    return T[m.start():j]

def farr(s):
    return np.array([float(x) for x in s.replace('\\', '').replace('"', '').replace('\n', '').split(',') if x.strip()])

# default template indices (fallback if a table lacks inline index_1/index_2)
TMPL = {}
for m in re.finditer(r'lu_table_template\s*\("?(\w+)"?\)\s*\{(.*?)\n *\}', T, re.S):
    idx1 = re.search(r'index_1\s*\(\s*"([^"]+)"', m.group(2))
    idx2 = re.search(r'index_2\s*\(\s*"([^"]+)"', m.group(2))
    TMPL[m.group(1)] = (farr(idx1.group(1)) if idx1 else None, farr(idx2.group(1)) if idx2 else None)

def parse_table(txt):
    """Return (index_1_slew, index_2_load, values[len1,len2]) for one lut group text."""
    tm = re.match(r'\s*\w+\s*\("?(\w+)"?\)', txt)
    ti1, ti2 = TMPL.get(tm.group(1), (None, None)) if tm else (None, None)
    i1 = re.search(r'index_1\s*\(\s*"([^"]+)"', txt); i1 = farr(i1.group(1)) if i1 else ti1
    i2 = re.search(r'index_2\s*\(\s*"([^"]+)"', txt); i2 = farr(i2.group(1)) if i2 else ti2
    vals = re.search(r'values\s*\((.*?)\)\s*;', txt, re.S).group(1)
    rows = [farr(r) for r in re.findall(r'"([^"]+)"', vals)]
    V = np.array(rows)
    if i1 is None: i1 = np.arange(V.shape[0], dtype=float)
    if i2 is None: i2 = np.arange(V.shape[1], dtype=float)
    return i1, i2, V

def arc_tables(cellblk, out_pin, related):
    """{table_type: parsed_table} for the timing arc related->out_pin."""
    pm = re.search(r'pin\s*\("?%s"?\)\s*\{' % out_pin, cellblk)
    i = pm.end() - 1; d = 1; j = i + 1          # pm.end()-1 is the pin's own '{'
    while d and j < len(cellblk): d += (cellblk[j] == '{') - (cellblk[j] == '}'); j += 1
    pinblk = cellblk[pm.start():j]
    # split timing() groups
    out = {}
    for tm in re.finditer(r'timing\s*\(\)\s*\{', pinblk):
        i = tm.end(); d = 1; k = i
        while d and k < len(pinblk): d += (pinblk[k] == '{') - (pinblk[k] == '}'); k += 1
        tb = pinblk[tm.start():k]
        rp = re.search(r'related_pin\s*:\s*"(\w+)"', tb)
        if not rp or rp.group(1) != related: continue
        for typ in ('cell_rise', 'cell_fall', 'rise_transition', 'fall_transition'):
            gm = re.search(r'%s\s*\(' % typ, tb)
            if not gm: continue
            i2 = gm.end(); d2 = 1; k2 = i2
            while d2 and k2 < len(tb): d2 += (tb[k2] == '{') - (tb[k2] == '}'); k2 += 1
            out[typ] = parse_table(tb[gm.start():k2])
        break
    return out

def interp2(tab, s, l):
    i1, i2, V = tab
    s = float(np.clip(s, i1[0], i1[-1])); l = float(np.clip(l, i2[0], i2[-1]))
    col = np.array([np.interp(l, i2, V[k]) for k in range(len(i1))])
    return float(np.interp(s, i1, col))

# ---- load sub-cells -----------------------------------------------------------------------------
b1 = block('cell', spec['cell1']); b2 = block('cell', spec['cell2'])
area1 = float(re.search(r'area\s*:\s*([0-9.]+)', b1).group(1))
area2 = float(re.search(r'area\s*:\s*([0-9.]+)', b2).group(1))
def caps(b):
    out = {}
    for pm in re.finditer(r'\n *pin\s*\("?(\w+)"?\)\s*\{', b):
        i = b.index('{', pm.end() - 1); d = 1; j = i + 1
        while d and j < len(b): d += (b[j] == '{') - (b[j] == '}'); j += 1
        cm = re.search(r'\n *capacitance\s*:\s*([0-9.]+)', b[pm.start():j])
        if cm: out[pm.group(1)] = float(cm.group(1))
    return out
c1caps, c2caps = caps(b1), caps(b2)
Cint = c2caps.get(spec['c2_in'], 0.005)             # internal-node load = fed C2 input cap
def leak(b):
    m = re.search(r'cell_leakage_power\s*:\s*([0-9.eE+-]+)', b)
    return float(m.group(1)) if m else 0.0

fused_area = round((area1 + area2) * spec.get('area_factor', 0.9), 4)

# arcs we need
c1_through = {p: arc_tables(b1, spec['c1_out'], sub[1]) for p, sub in spec['pins'].items() if sub[0] == 'cell1'}
c2_arc_int = arc_tables(b2, spec['output'], spec['c2_in'])          # internal -> Y (stage 2)
c2_direct = {p: arc_tables(b2, spec['output'], sub[1]) for p, sub in spec['pins'].items() if sub[0] == 'cell2'}

# grids for the fused output: input-slew grid from stage-1, output-load grid from stage-2
SLEW = list(c1_through.values())[0]['cell_rise'][0] if c1_through else c2_arc_int['cell_rise'][0]
LOAD = c2_arc_int['cell_rise'][1]

def fmt_row(a): return '"' + ', '.join('%.6f' % x for x in a) + '"'
def emit_lut(typ, tmpl, grid):     # grid[len(SLEW)][len(LOAD)]
    rows = ',\\\n          '.join(fmt_row(r) for r in grid)
    return (f'        {typ} ({tmpl}) {{\n'
            f'          index_1 ({fmt_row(SLEW)});\n'
            f'          index_2 ({fmt_row(LOAD)});\n'
            f'          values ({rows});\n        }}')

TMPL_NAME = f'fuse_template_{len(SLEW)}x{len(LOAD)}'

def compose_through(arc1):
    """2-stage: stage1(input->Xint @Cint) then stage2(Xint->Y @load). Symmetric avg-edge model."""
    def avg(d, typ_r, typ_f): return (d[typ_r], d[typ_f])
    g_delay = np.zeros((len(SLEW), len(LOAD))); g_trans = np.zeros_like(g_delay)
    for i, s in enumerate(SLEW):
        # stage 1 @ (s, Cint): avg rise/fall
        d1 = 0.5 * (interp2(arc1['cell_rise'], s, Cint) + interp2(arc1['cell_fall'], s, Cint))
        t1 = 0.5 * (interp2(arc1['rise_transition'], s, Cint) + interp2(arc1['fall_transition'], s, Cint))
        for j, l in enumerate(LOAD):
            d2 = 0.5 * (interp2(c2_arc_int['cell_rise'], t1, l) + interp2(c2_arc_int['cell_fall'], t1, l))
            t2 = 0.5 * (interp2(c2_arc_int['rise_transition'], t1, l) + interp2(c2_arc_int['fall_transition'], t1, l))
            g_delay[i, j] = d1 + d2; g_trans[i, j] = t2
    return g_delay, g_trans

# ---- emit liberty -------------------------------------------------------------------------------
pin_lines = []
for p, sub in spec['pins'].items():
    cap = (c1caps if sub[0] == 'cell1' else c2caps).get(sub[1], 0.004)
    pin_lines.append(f'    pin ("{p}") {{\n      direction : input;\n      capacitance : {cap:.6f};\n    }}')

timing_groups = []
for p, sub in spec['pins'].items():
    if sub[0] == 'cell1':
        gd, gt = compose_through(c1_through[p])
        luts = '\n'.join([emit_lut('cell_rise', TMPL_NAME, gd), emit_lut('cell_fall', TMPL_NAME, gd),
                          emit_lut('rise_transition', TMPL_NAME, gt), emit_lut('fall_transition', TMPL_NAME, gt)])
        sense = 'non_unate'
    else:
        a = c2_direct[p]
        luts = '\n'.join(emit_lut(t, TMPL_NAME, a[t][2]) for t in ('cell_rise', 'cell_fall', 'rise_transition', 'fall_transition'))
        sense = 'negative_unate'
    timing_groups.append(f'      timing () {{\n        related_pin : "{p}";\n        timing_sense : {sense};\n{luts}\n      }}')

lib = f'''library (celluzi_modeled) {{
  delay_model : table_lookup;
  time_unit : "1ns"; voltage_unit : "1V"; current_unit : "1mA";
  capacitive_load_unit (1,pf); leakage_power_unit : "1nW";
  default_max_transition : 1.5;
  lu_table_template ({TMPL_NAME}) {{
    variable_1 : input_net_transition; variable_2 : total_output_net_capacitance;
    index_1 ({fmt_row(SLEW)}); index_2 ({fmt_row(LOAD)});
  }}
  cell ("{spec['name']}") {{
    area : {fused_area};
    /* MODELED: composed from {spec['cell1']} + {spec['cell2']} (foundry NLDM). Exploration, not sign-off. */
{chr(10).join(pin_lines)}
    pin ("{spec['output']}") {{
      direction : output;
      function : "{spec['function']}";
      max_capacitance : {LOAD[-1]:.4f};
{chr(10).join(timing_groups)}
    }}
    cell_leakage_power : {leak(b1) + leak(b2):.6f};
  }}
}}
'''
open(outlib, 'w').write(lib)

# ---- emit LEF -----------------------------------------------------------------------------------
W = np.ceil(fused_area / ROW_H / SITE_W) * SITE_W
sig = [p for p in spec['pins']] + [spec['output']]
def pin_rect(x): return f'    PORT\n      LAYER met1 ;\n        RECT {x:.3f} 1.200 {x+0.170:.3f} 1.480 ;\n    END'
lef_pins = []
for k, p in enumerate(sig):
    x = round((k + 1) * W / (len(sig) + 1), 3)
    d = 'OUTPUT' if p == spec['output'] else 'INPUT'
    lef_pins.append(f'  PIN {p}\n    DIRECTION {d} ;\n    USE SIGNAL ;\n{pin_rect(x)}\n  END {p}')
for pw, y0, y1 in [('VPWR', ROW_H - 0.24, ROW_H + 0.24), ('VGND', -0.24, 0.24)]:
    lef_pins.append(f'  PIN {pw}\n    DIRECTION INOUT ;\n    USE {"POWER" if pw=="VPWR" else "GROUND"} ;\n'
                    f'    PORT\n      LAYER met1 ;\n        RECT 0.000 {y0:.3f} {W:.3f} {y1:.3f} ;\n    END\n  END {pw}')
lef = (f'MACRO {spec["name"]}\n  CLASS CORE ;\n  ORIGIN 0.000 0.000 ;\n  FOREIGN {spec["name"]} 0.000 0.000 ;\n'
       f'  SIZE {W:.3f} BY {ROW_H:.3f} ;\n  SITE unithd ;\n' + '\n'.join(lef_pins) + f'\nEND {spec["name"]}\n')
open(outlef, 'w').write(lef)

print(f'{spec["name"]}: area={fused_area}um2 (={area1}+{area2} x{spec.get("area_factor",0.9)})  '
      f'width={W:.2f}um  grid={len(SLEW)}x{len(LOAD)}  Cint={Cint}')
# sanity: report a representative through-arc delay + a direct-arc delay
for p, sub in spec['pins'].items():
    if sub[0] == 'cell1':
        gd, _ = compose_through(c1_through[p]); print(f'  {p}->Y (through) mid-grid delay ~ {gd[len(SLEW)//2][len(LOAD)//2]:.4f} ns')
    else:
        a = c2_direct[p]; print(f'  {p}->Y (direct)  mid-grid delay ~ {0.5*(a["cell_rise"][2][len(SLEW)//2][len(LOAD)//2]+a["cell_fall"][2][len(SLEW)//2][len(LOAD)//2]):.4f} ns')
