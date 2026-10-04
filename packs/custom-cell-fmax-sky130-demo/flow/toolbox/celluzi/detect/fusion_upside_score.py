#!/usr/bin/env python3
"""S0 — convert each fusion site's wire capacitance into the delay fusion could actually recover.

Fusion's entire timing prize is the inter-cell wire: compose_netlist.py emits both device sets
unchanged and only replaces the routed net between them with an intra-cell connection. So at each
site the driver's load falls from (Cwire + Cpin) to ~Cpin, and the saving is whatever the driver's
own NLDM table says that load reduction is worth.

Prices that saving against the alternative the resizer already has: upsizing along the foundry drive
ladder. If the ladder buys more than fusion does, fusion can only win where the resizer would not
have upsized anyway -- i.e. in positive-slack cones, where the objective is area/power, not WNS.

Usage: fusion_upside_score.py <s0_dump> <foundry.lib> [-o out.json]
"""
import argparse
import json
import re
import statistics as st
import sys


def _blocks(text, keyword):
    """Yield (name, body) for every `keyword (name) { ... }` group, at ANY indentation.

    Indentation-agnostic by construction: sky130hd writes `cell (` at 4 spaces, `pin (` at 8, and
    `index_1(` with no space at all. Regexes that hardcode indentation silently match nothing and
    report an empty result rather than an error -- which is exactly how this file's first version
    scored 0 of 61 sites while looking like it worked.
    """
    for m in re.finditer(r'\b%s\s*\(\s*"?([^")]*)"?\s*\)\s*\{' % re.escape(keyword), text):
        start = m.end() - 1
        depth, i = 0, start
        while i < len(text):
            if text[i] == '{':
                depth += 1
            elif text[i] == '}':
                depth -= 1
                if depth == 0:
                    break
            i += 1
        yield m.group(1).strip(), text[start + 1:i]


def _nums(s):
    return [float(x) for x in s.replace(',', ' ').split()]


def parse_liberty_arcs(text):
    """-> {cell: {'area': f, 'caps': {pin: f}, 'pins': {out: {rel: {table: (idx1, idx2, grid)}}}}}

    Deliberately small and self-contained: this is part of the tooling that replaces CellForge, so
    it must not import from it.
    """
    cells = {}
    for name, body in _blocks(text, 'cell'):
        if not name.startswith('sky130'):
            continue
        area = re.search(r'\barea\s*:\s*([0-9.]+)\s*;', body)
        entry = {'area': float(area.group(1)) if area else None, 'pins': {}, 'caps': {}}
        for pin, pbody in _blocks(body, 'pin'):
            cap = re.search(r'\bcapacitance\s*:\s*([0-9.]+)\s*;', pbody)
            if cap:
                entry['caps'][pin] = float(cap.group(1))
            for _, tb in _blocks(pbody, 'timing'):
                rel = re.search(r'related_pin\s*:\s*"?([A-Za-z0-9_]+)"?\s*;', tb)
                if not rel:
                    continue
                for table in ('cell_rise', 'cell_fall'):
                    for _, lb in _blocks(tb, table):
                        i1 = re.search(r'index_1\s*\(\s*"([^"]+)"', lb)
                        i2 = re.search(r'index_2\s*\(\s*"([^"]+)"', lb)
                        if not (i1 and i2 and 'values' in lb):
                            continue
                        rows = re.findall(r'"([0-9eE.+\-, ]+)"', lb[lb.find('values'):])
                        if not rows:
                            continue
                        entry['pins'].setdefault(pin, {}).setdefault(rel.group(1), {})[table] = (
                            _nums(i1.group(1)), _nums(i2.group(1)), [_nums(r) for r in rows])
                        break
        cells[name] = entry
    return cells


def interp_load(idx2, row, load):
    """1-D interpolation along the output-load axis; linear extrapolation past the last point."""
    if load <= idx2[0]:
        if len(idx2) < 2:
            return row[0]
        f = (load - idx2[0]) / (idx2[1] - idx2[0])
        return row[0] + f * (row[1] - row[0])
    for k in range(len(idx2) - 1):
        if idx2[k] <= load <= idx2[k + 1]:
            f = (load - idx2[k]) / (idx2[k + 1] - idx2[k])
            return row[k] + f * (row[k + 1] - row[k])
    f = (load - idx2[-2]) / (idx2[-1] - idx2[-2])
    return row[-2] + f * (row[-1] - row[-2])


def delay_at(cells, cell, out_pin, load, slew_row=None):
    """Max over related pins / rise+fall of the driver's delay at `load`. Returns None if unknown."""
    e = cells.get(cell)
    if not e or out_pin not in e['pins']:
        return None
    best = None
    for rel, tables in e['pins'][out_pin].items():
        for table, (idx1, idx2, grid) in tables.items():
            r = len(grid) // 2 if slew_row is None else min(slew_row, len(grid) - 1)
            v = interp_load(idx2, grid[r], load)
            best = v if best is None else max(best, v)
    return best


def ladder_price(cells, base, out_pin, load):
    """What upsizing along the foundry drive ladder buys at this load -- fusion's competition."""
    variants = sorted((c for c in cells if re.match(r'.*__%s_\d+$' % re.escape(base), c)),
                      key=lambda c: int(c.rsplit('_', 1)[1]))
    if len(variants) < 2:
        return None
    d1 = delay_at(cells, variants[0], out_pin, load)
    dn = delay_at(cells, variants[-1], out_pin, load)
    if d1 is None or dn is None:
        return None
    return {'from': variants[0], 'to': variants[-1], 'delay_1': d1, 'delay_max': dn, 'gain': d1 - dn}


def parse_sites(raw):
    sites = []
    for blk in raw.split('FUSION_SITE ')[1:]:
        head, _, rest = blk.partition('\n')
        d = dict(re.findall(r'(\w+)=(\S+)', head))
        w = re.search(r'Wire capacitance:\s*([0-9.]+)', rest)
        p = re.search(r'Pin capacitance:\s*([0-9.]+)', rest)
        if not (w and p):
            continue
        d['cwire'] = float(w.group(1))
        d['cpin'] = float(p.group(1))
        try:
            d['slack'] = float(d.get('slack', 'nan'))
        except ValueError:
            d['slack'] = float('nan')
        sites.append(d)
    return sites


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dump')
    ap.add_argument('lib')
    ap.add_argument('-o', '--out')
    a = ap.parse_args()

    sites = parse_sites(open(a.dump).read())
    cells = parse_liberty_arcs(open(a.lib).read())
    if not sites:
        sys.exit('no fusion sites in dump: %s' % a.dump)
    if not cells:
        sys.exit('liberty parse found 0 cells in %s -- parser is broken, not the data' % a.lib)

    out_pin_of = {'xor2': 'X', 'xnor2': 'Y', 'xnor3': 'X', 'mux2i': 'Y', 'nand2': 'Y', 'nor2': 'Y'}
    scored, skipped = [], 0
    for s in sites:
        c1 = s['c1_master']
        base = c1.split('__')[-1].rsplit('_', 1)[0]
        op = out_pin_of.get(base)
        if not op:
            skipped += 1
            continue
        load_now = s['cwire'] + s['cpin']
        load_fused = s['cpin']                       # fusion removes the routed wire, keeps the gate
        d_now = delay_at(cells, c1, op, load_now)
        d_fused = delay_at(cells, c1, op, load_fused)
        if d_now is None or d_fused is None:
            skipped += 1
            continue
        s['delay_now'] = d_now
        s['delay_fused'] = d_fused
        s['saving_ns'] = d_now - d_fused
        lp = ladder_price(cells, base, op, load_now)
        s['ladder'] = lp
        s['beats_ladder'] = bool(lp and s['saving_ns'] > lp['gain'])
        scored.append(s)

    if not scored:
        sys.exit('scored 0 of %d sites -- liberty lookup failed for every driver.\n'
                 '  parsed %d cells; sample: %s\n'
                 '  first driver sought: %s'
                 % (len(sites), len(cells), sorted(cells)[:3],
                    sites[0].get('c1_master')))

    sav = [s['saving_ns'] for s in scored]
    neg = [s for s in scored if s['slack'] == s['slack'] and s['slack'] < 0]
    pos = [s for s in scored if s['slack'] == s['slack'] and s['slack'] >= 0]

    print("=" * 78)
    print("S0 — FUSION UPSIDE BOUND  (golden aes/sky130hd, real routed SPEF)")
    print("=" * 78)
    print("sites scored: %d   (skipped %d)" % (len(scored), skipped))
    print()
    print("--- per-site delay fusion can recover (removing the routed wire) ---")
    print("  median %.4f ns   mean %.4f ns   min %.4f   max %.4f"
          % (st.median(sav), st.mean(sav), min(sav), max(sav)))
    print()
    print("--- vs the resizer's alternative (upsize along the foundry ladder) ---")
    lad = [s['ladder']['gain'] for s in scored if s['ladder']]
    if lad:
        print("  ladder gain at these loads: median %.4f ns   (fusion median %.4f ns)"
              % (st.median(lad), st.median(sav)))
        print("  sites where FUSION BEATS THE LADDER: %d of %d"
              % (sum(1 for s in scored if s['beats_ladder']), len(scored)))
    print()
    print("--- where the sites live (does the saving reach WNS?) ---")
    print("  negative-slack (critical) sites: %d   positive-slack: %d" % (len(neg), len(pos)))
    if neg:
        print("  best saving among critical sites: %.4f ns (worst slack %.4f)"
              % (max(s['saving_ns'] for s in neg), min(s['slack'] for s in neg)))
    print()
    print("--- the verdict this stage exists to force ---")
    tot_crit = sum(s['saving_ns'] for s in neg)
    print("  total recoverable delay on NEGATIVE-slack sites: %.4f ns" % tot_crit)
    print("  (these sites are NOT necessarily on the same path; this is an upper bound)")

    res = {'n_sites': len(scored), 'saving_median_ns': st.median(sav), 'saving_max_ns': max(sav),
           'ladder_median_ns': st.median(lad) if lad else None,
           'n_beat_ladder': sum(1 for s in scored if s['beats_ladder']),
           'n_negative_slack': len(neg), 'n_positive_slack': len(pos),
           'total_saving_negative_slack_ns': tot_crit,
           'sites': [{k: v for k, v in s.items() if k != 'ladder'} for s in scored]}
    if a.out:
        json.dump(res, open(a.out, 'w'), indent=2)
        print("\n  -> %s" % a.out)


if __name__ == '__main__':
    main()
