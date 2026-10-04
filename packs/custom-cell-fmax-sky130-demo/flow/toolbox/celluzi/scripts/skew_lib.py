#!/usr/bin/env python3
"""Grounded skew-cell Liberty: a TLO cell that boosts ONE edge (rise or fall) via extra parallel
fingers on that edge's transistors. Modeled with REAL foundry tables, not a derate wish: the boosted
edge takes the foundry 2x-drive (_2) cell's tables (that IS the 2x drive), the un-boosted edge and the
input caps stay the base (_1) cell's. This honestly captures that drive strength is LOAD-DEPENDENT --
the _2 tables are faster at heavy load and slower at light load, so the optimizer only adopts the cell
where it actually helps. (The real skew cell's input cap is between _1 and _2 since only one transistor
type is doubled; we keep _1 caps, a small optimism noted in the banner.)

Usage: skew_lib.py --base <lib> --base-cell nor2_1 --fast-cell nor2_2 --edge rise --output-pin Y
                   --name NOR2_PU2 --area <um2> -o out.lib
"""
import argparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import estimate_lib as E  # noqa: E402


def _replace_tbl_values(grp, tbl, grid):
    """Replace the values(...) of table `tbl` inside a timing group with the given grid."""
    rows = (', \\\n' + ' ' * 24).join('"%s"' % ', '.join('%.6f' % v for v in r) for r in grid)
    m = re.search(r'\b%s\s*\([^)]*\)\s*\{' % re.escape(tbl), grp)
    if not m:
        return grp
    end = E.brace_body(grp, grp.index('{', m.start()))
    tbltext = grp[m.start():end + 1]
    tbltext = re.sub(r'values\s*\(.*?\)\s*;', 'values(%s);' % rows, tbltext, flags=re.S)
    return grp[:m.start()] + tbltext + grp[end + 1:]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', required=True)
    ap.add_argument('--base-cell', required=True)
    ap.add_argument('--fast-cell', required=True, help='foundry 2x-drive cell (source of boosted edge)')
    ap.add_argument('--edge', choices=['rise', 'fall'], required=True)
    ap.add_argument('--output-pin', default='Y')
    ap.add_argument('--name', required=True)
    ap.add_argument('--area', type=float, required=True)
    ap.add_argument('-o', '--out', required=True)
    a = ap.parse_args()

    text = open(a.base).read()
    block = E.extract_cell(text, a.base_cell)
    block = re.sub(r'(cell\s*\(\s*)"?%s"?(\s*\))' % re.escape(a.base_cell),
                   r'\g<1>%s\g<2>' % a.name, block, count=1)
    block = re.sub(r'(\barea\s*:\s*)[0-9.]+', r'\g<1>%g' % a.area, block, count=1)

    fast = E.extract_cell(text, a.fast_cell)
    tbls = {'rise': ['cell_rise', 'rise_transition'], 'fall': ['cell_fall', 'fall_transition']}[a.edge]

    def fix_timing(grp):
        rp = re.search(r'related_pin\s*:\s*"?(\w+)"?', grp)
        if not rp:
            return grp
        try:
            fa = E._arc(fast, a.output_pin, rp.group(1))       # {table:(idx1,idx2,grid)} from _2 cell
        except SystemExit:
            return grp
        for tbl in tbls:
            if tbl in fa:
                grp = _replace_tbl_values(grp, tbl, fa[tbl][2])
        return grp

    block = E.transform_groups(block, ['timing'], fix_timing)
    note = ('%s edge from foundry %s (real 2x-drive tables), %s edge + caps from %s; drive is '
            'load-dependent (not a flat derate)' % (a.edge, a.fast_cell, 'fall' if a.edge == 'rise' else 'rise', a.base_cell))
    open(a.out, 'w').write(E.emit(E.library_header(text), block, note))
    print('skew: %s = %s with %s edge <- %s -> %s' % (a.name, a.base_cell, a.edge, a.fast_cell, a.out))


if __name__ == '__main__':
    main()
