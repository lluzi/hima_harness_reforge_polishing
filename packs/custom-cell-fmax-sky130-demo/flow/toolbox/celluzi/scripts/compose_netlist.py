#!/usr/bin/env python3
"""Compose an lclayout transistor netlist for a fused cell from foundry CDL topologies.

Reads a generate/model_specs/*.json fusion spec, pulls the two constituent subckts out of the
sky130hd CDL, and wires cell1's output into cell2's input through an internal net. The CDL is the
authoritative foundry topology (it is what LVS golden-compares against), so cells composed from it
carry real device counts, real W/L, and real series/parallel structure.

Replaces hand-composition, which had produced exactly one netlist (fuse_xor2_nand2.sp) and did not
trace back to this CDL -- its internal nets (x35, x285) match no subckt here.

Usage: compose_netlist.py <spec.json> <sky130hd.cdl> [-o out.sp]
"""
import argparse
import json
import re
import sys

# sky130hd is built from exactly two devices: nfet_01v8 and pfet_01v8_hvt. The _lvt/plain variants
# are accepted so this survives a platform swap; an unlisted model is a hard error rather than a
# guess, since silently mapping the wrong flavour would produce a plausible but wrong cell.
MODEL_MAP = {
    'nfet_01v8': 'nmos', 'nfet_01v8_lvt': 'nmos', 'nfet_01v8_hvt': 'nmos',
    'pfet_01v8': 'pmos', 'pfet_01v8_lvt': 'pmos', 'pfet_01v8_hvt': 'pmos',
}
# Foundry bulk/supply pins collapse onto lclayout's two rails.
RAILS = {'VGND': 'gnd', 'VNB': 'gnd', 'VPWR': 'vdd', 'VPB': 'vdd'}
# The CDL names devices bare ('nfet_01v8'); Magic extracts them fully qualified. Only the qualified
# form matches netgen's sky130A_setup.tcl.
FOUNDRY_PREFIX = 'sky130_fd_pr__'


def read_subckt(cdl_text, name):
    """-> (ports, [(d, g, s, b, raw_model, w, l)]). Joins '+' continuation lines first.

    The RAW foundry model name is returned, not a translated one: the two consumers need different
    conventions (lclayout wants generic nmos/pmos, a foundry-derived layout must be compared against
    sky130_fd_pr__* names), so the translation belongs at the point of emission, not here.
    """
    m = re.search(r'^\.SUBCKT\s+%s\s+(.*?)^\.ENDS' % re.escape(name), cdl_text, re.M | re.S | re.I)
    if not m:
        sys.exit('subckt not found in CDL: %s' % name)
    body = re.sub(r'\n\+\s*', ' ', m.group(0))           # fold continuations onto their device line
    header = re.match(r'^\.SUBCKT\s+\S+\s+(.*)$', body.split('\n')[0], re.I)
    ports = header.group(1).split()
    devices = []
    for line in body.split('\n')[1:]:
        t = line.split()
        if not t or not t[0].upper().startswith('M'):
            continue
        d, g, s, b, model = t[1], t[2], t[3], t[4], t[5]
        w = re.search(r'\bw=([0-9.]+)', line)
        l = re.search(r'\bl=([0-9.]+)', line)
        if model not in MODEL_MAP:
            sys.exit('unknown device model %r in %s' % (model, name))
        # m=/mult= are multiplicity: m=2 is TWO parallel devices, not one. We emit one device per
        # card, so anything but 1 would silently understate the drive -- hard-error instead of
        # quietly producing a netlist that looks right and is not (see open task #31).
        for attr in ('m', 'mult'):
            mm = re.search(r'\b%s=([0-9.]+)' % attr, line)
            if mm and float(mm.group(1)) != 1.0:
                sys.exit('%s: device %r has %s=%s; multiplicity != 1 is not expanded by this '
                         'composer. Refusing to emit a netlist with the wrong device count.'
                         % (name, t[0], attr, mm.group(1)))
        devices.append((d, g, s, b, model, w.group(1), l.group(1)))
    return ports, devices


def build_netmap(ports, devices, fixed, prefix, rails=None):
    """Map this stage's nets: `fixed` pins as given, rails per `rails`, internals prefixed.

    Internal nets must be prefixed -- both stages can name a net 'inor', and merging them into one
    subckt would silently short two unrelated nodes together.
    """
    net = dict(RAILS if rails is None else rails)
    net.update(fixed)
    for dev in devices:
        for n in dev[:4]:
            if n not in net:
                net[n] = '%s_%s' % (prefix, n) if n not in ports else n
    return net


def compose(spec, cdl_text, lvs_ref=False, foundry_ref=False):
    """lvs_ref=True emits the foundry's bulk convention for netgen.

    sky130hd is a TAPLESS library: verified against the foundry GDS, sky130_fd_sc_hd__nand2_1 and
    __xnor3_1 contain no tap layer at all -- only sky130_fd_sc_hd__tapvpwrvgnd_1 does, and ORFS places
    those separately at floorplan. So a logic cell's wells are floating *by design*, and Magic extracts
    them as w_n..# (nwell) and VSUBS (substrate). Tying bulks to vdd/gnd in the LVS reference makes
    netgen see 2 fewer nets than the layout and report a mismatch that is purely a convention error.
    The foundry states them as ports instead: .SUBCKT ..._nand2_1 A B VGND VNB VPB VPWR Y
    """
    if lvs_ref and foundry_ref:
        sys.exit('--lvs-ref and --foundry-ref are different conventions; pick one')
    c1_ports, c1_dev = read_subckt(cdl_text, spec['cell1'])
    c2_ports, c2_dev = read_subckt(cdl_text, spec['cell2'])
    internal = 'XI'                                       # cell1 output -> cell2 input
    # A foundry-derived layout (scripts/abut_cells.py) is compared against a reference that keeps the
    # foundry's own names on both sides. RAILS collapses VPWR/VPB->vdd and VGND/VNB->gnd for
    # lclayout's benefit; Magic extracting a foundry cell emits VPWR/VGND/VPB/VNB, so for that flow
    # the rails must pass through untouched.
    rails = {r: r for r in RAILS} if foundry_ref else RAILS

    # Split the fused cell's external pins by which stage they drive.
    c1_fixed = {sub: pin for pin, (src, sub) in spec['pins'].items() if src == 'cell1'}
    c2_fixed = {sub: pin for pin, (src, sub) in spec['pins'].items() if src == 'cell2'}
    c1_fixed[spec['c1_out']] = internal
    c2_fixed[spec['c2_in']] = internal

    c2_out = [p for p in c2_ports if p not in RAILS and p not in c2_fixed]
    if len(c2_out) != 1:
        sys.exit('cannot identify cell2 output; unbound cell2 ports: %s' % c2_out)
    c2_fixed[c2_out[0]] = spec['output']

    m1 = build_netmap(c1_ports, c1_dev, c1_fixed, 'c1', rails)
    m2 = build_netmap(c2_ports, c2_dev, c2_fixed, 'c2', rails)

    inputs = list(spec['pins'].keys())
    if foundry_ref:
        bulk_of = {}
        lines = [
            '* %s : LVS REFERENCE for the ABUTTED foundry layout (scripts/abut_cells.py).',
            '* Y = %s' % spec['function'],
            '* Keeps the foundry convention on BOTH sides of the comparison: sky130_fd_pr__* device',
            '* names and VPWR/VGND/VPB/VNB rails, exactly as Magic extracts them from a layout built',
            '* out of foundry cells. The --lvs-ref convention (generic nmos/pmos + vdd/gnd) is for',
            '* lclayout-generated cells; against a foundry-derived layout netgen reports every device',
            '* as "(no matching element)" and then fails pin matching.',
            '.subckt %s %s %s VPWR VGND VPB VNB' % (spec['name'], ' '.join(inputs), spec['output']),
        ]
        lines[0] = lines[0] % spec['name']
    elif lvs_ref:
        bulk_of = {'gnd': 'VNB', 'vdd': 'VPB'}
        lines = [
            '* %s : LVS REFERENCE -- foundry bulk convention.' % spec['name'],
            '* sky130hd is TAPLESS: the foundry GDS shows nand2_1/xnor3_1 carry NO tap layer (only',
            '* tapvpwrvgnd_1 does, and ORFS places those at floorplan). So a logic cell\'s wells float',
            '* in-cell by design, and Magic extracts them as w_n..# (nwell) / VSUBS (substrate). Tying',
            '* the bulks to vdd/gnd here would leave the reference 2 nets short of the layout and',
            '* netgen would report a mismatch that is purely a convention error.',
            '.subckt %s %s %s vdd gnd VPB VNB' % (spec['name'], ' '.join(inputs), spec['output']),
        ]
    else:
        bulk_of = {}
        lines = [
            '* %s : Y = %s' % (spec['name'], spec['function']),
            '* Auto-composed by scripts/compose_netlist.py from foundry CDL topologies',
            '* (%s + %s) wired through internal net %s.' % (spec['cell1'], spec['cell2'], internal),
            '* Foundry bulks VGND/VNB->gnd, VPWR/VPB->vdd.',
            '.subckt %s %s %s vdd gnd' % (spec['name'], ' '.join(inputs), spec['output']),
        ]
    i = 0
    for tag, devs, nm in (('%s stage' % spec['cell1'].split('__')[-1], c1_dev, m1),
                          ('%s stage' % spec['cell2'].split('__')[-1], c2_dev, m2)):
        lines.append('* --- %s ---' % tag)
        for (d, g, s, b, raw_model, w, l) in devs:
            if foundry_ref:
                # Magic emits the PDK devices as subcircuit instances ("X0 d g s b
                # sky130_fd_pr__nfet_01v8 w=.. l=.."), and netgen's sky130A_setup.tcl is written
                # against those names. Match that form exactly or nothing binds.
                lines.append('X%-3d %-9s %-9s %-9s %-9s %s w=%s l=%s'
                             % (i, nm[d], nm[g], nm[s], nm[b], FOUNDRY_PREFIX + raw_model, w, l))
            else:
                lines.append('M%-3d %-8s %-8s %-8s %-8s %s w=%su l=%su'
                             % (i, nm[d], nm[g], nm[s], bulk_of.get(nm[b], nm[b]),
                                MODEL_MAP[raw_model], w, l))
            i += 1
    lines.append('.ends %s' % spec['name'])
    return '\n'.join(lines) + '\n', len(c1_dev) + len(c2_dev)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('spec')
    ap.add_argument('cdl')
    ap.add_argument('-o', '--out')
    ap.add_argument('--lvs-ref', action='store_true',
                    help='emit the foundry bulk convention (bulks as VPB/VNB ports) for netgen LVS, '
                         'instead of the lclayout input convention (bulks tied to vdd/gnd)')
    ap.add_argument('--foundry-ref', action='store_true',
                    help='emit an LVS reference for an ABUTTED foundry layout (scripts/abut_cells.py'
                         '): sky130_fd_pr__* device names and VPWR/VGND/VPB/VNB rails, matching what '
                         'Magic extracts from foundry cells. Use --lvs-ref for lclayout cells.')
    a = ap.parse_args()
    spec = json.load(open(a.spec))
    text, ndev = compose(spec, open(a.cdl).read(), lvs_ref=a.lvs_ref, foundry_ref=a.foundry_ref)
    if a.out:
        open(a.out, 'w').write(text)
        print('%-22s %2d devices -> %s' % (spec['name'], ndev, a.out))
    else:
        sys.stdout.write(text)


if __name__ == '__main__':
    main()
