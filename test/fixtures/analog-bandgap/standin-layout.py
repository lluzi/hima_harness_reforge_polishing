#!/usr/bin/env python3
"""A STAND-IN for the Site's layout tool, for Host tests on a machine without Magic, KLayout and
netgen. It draws nothing and checks nothing: it writes the layout tool's record
(hima-cell-layout/1) with the results the test asks for, and returns the given netlist's own
`bandgap_lb` as the "extraction", so the post-layout stage re-simulates the schematic cell. Never a
Site tool; the real one is sites/analog_sim_01/layout/run_cell.sh.

argv: standin-layout.py <netlist> <subckt> <out_dir>. STANDIN_LAYOUT=clean (default) or lvs-mismatch.
"""
import json
import os
import shutil
import sys
from pathlib import Path


def main(netlist, cell, out):
    out = Path(out)
    if out.exists() and any(out.iterdir()):
        print("the output folder %s is not empty" % out, file=sys.stderr)
        return 2
    out.mkdir(parents=True, exist_ok=True)
    clean = os.environ.get("STANDIN_LAYOUT", "clean") == "clean"
    for kind in ("c", "rc"):
        shutil.copyfile(netlist, out / ("%s_pex_%s.spice" % (cell, kind)))
    (out / ("%s.gds" % cell)).write_bytes(b"stand-in, no layout")
    counts = dict(caps=0, devices=0, pnpNamed=0, res=0)
    record = dict(schema="hima-cell-layout/1", pdk="stand-in", netlist=str(Path(netlist).resolve()), cell=cell,
                  layout=dict(blocks=[]), draw=dict(rc=0, magicDrcErrors=0, magicDrcInPdkPnpCells=0, seconds=0.0),
                  klayoutDrc=dict(block=dict(rc=0, total=0, byRule={}), density=dict(rc=0, total=7, byRule={})),
                  lvs=dict(rc=[0, 0], match=clean, lines=["stand-in"], pnpNameCorrections=0, referenceNotes=[]),
                  klayoutLvs=dict(rc=0, match=clean, lines=["stand-in"]),
                  pex=dict(rc=[0, 0], netlists={"%s_pex_c.spice" % cell: counts, "%s_pex_rc.spice" % cell: counts}),
                  render=dict(rc=0, png=False, bboxUm=[100.0, 80.0]), totalSeconds=0.0)
    (out / "layout.json").write_text(json.dumps(record, indent=2, sort_keys=True) + "\n")
    print("stand-in layout of %s: %s" % (cell, "clean" if clean else "LVS mismatch"))
    return 0


if __name__ == "__main__":
    sys.exit(main(*sys.argv[1:4]))
