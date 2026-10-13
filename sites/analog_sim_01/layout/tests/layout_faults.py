#!/usr/bin/env python3
"""Layout-side negative LVS tests: the drawing is changed, the reference is not (in the tool image).

  layout_faults.py <netlist.spice> <subckt> <new out_dir> <fault>

  drop-pnp      one PNP unit (the first placed, a unit of the 8x device) is not placed
  wrong-pnp     the centre PNP unit is the PDK's 5x5 cell instead of the 10x10 one
  short         two neighbouring signal tracks of the first stripe joined by a metal3 strap
  cap-wl:<dev>  capacitor <dev> drawn 1.25 x wider and 0.8 x shorter (about the same area)
  drop-ladder-unit[:<n>]   the ladder's unit segment in column n (default 50, counted along the chain) is not drawn
  swap-taps:<a>:<b>        the ladder's pin labels a and b trade places (each on the other's strap)

The whole cell_layout.py run is repeated with the fault injected. A fault counts as caught only
when every step ran (all exit codes 0) and both LVS checks printed a mismatch (netgen "Netlists do
not match", "Property errors were found" or "failed pin matching"; KLayout "Netlists don't match" or
a reference pin on a layout net of another name). This shows that the
PNP rename and the MIM marker cannot hide a drawing fault. Writes <out_dir>/fault.json; exit 0 when
caught.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import cell_layout as cl  # noqa: E402


def inject(fault):
    note = {}
    if fault in ("drop-pnp", "wrong-pnp"):
        orig = cl.Cell.place
        calls = {"n": 0}

        def place(self, cellname, x1, y1):
            i = calls["n"]
            calls["n"] += 1
            if fault == "drop-pnp" and i == 0:
                note["dropped"] = "%s at (%d, %d) nm" % (cellname, x1, y1)
                self.minx = min(self.minx, x1)
                return None
            if fault == "wrong-pnp" and i == 4 and cellname == "pnp_10p00x10p00_0":
                d = cl.PNPS["pnp_10p00x10p00"]["half"] - cl.PNPS["pnp_05p00x05p00"]["half"]
                note["replaced"] = "centre unit: pnp_05p00x05p00_0 instead of %s" % cellname
                return orig(self, "pnp_05p00x05p00_0", x1 + d, y1 + d)
            return orig(self, cellname, x1, y1)
        cl.Cell.place = place
    elif fault == "short":
        orig = cl.build

        def build(pins, devices):
            cell, facts = orig(pins, devices)
            order = [n for n in facts["tracks"][0] if n not in (facts["substrate"], facts["well"])]
            ys = facts["trackYNm"][0]
            a, b = order[0], order[1]
            xa, xb = facts["trackXNm"]["0:%s" % a], facts["trackXNm"]["0:%s" % b]
            x = max(xa[0], xb[0]) + 600
            cell.paint("metal3", x, min(ys[a], ys[b]), x + 400, max(ys[a], ys[b]))
            note["shorted"] = "%s and %s (metal3 strap at x %d nm)" % (a, b, x)
            return cell, facts
        cl.build = build
    elif fault.startswith("cap-wl:"):
        dev = fault.split(":", 1)[1]
        orig = cl.CapBlock.__init__

        def init(self, d):
            orig(self, d)
            if d["name"] == dev:
                w, l = self.w, self.l
                self.w, self.l = cl.snap(w * 1.25), cl.snap(l * 0.8)
                self.x1 = self.w + 600
                self.y1 = self.l + 600 + 2500
                note["capacitor"] = "%s drawn %d x %d nm instead of %d x %d nm" % (dev, self.w, self.l, w, l)
        cl.CapBlock.__init__ = init
    elif fault.startswith("drop-ladder-unit"):
        n = int(fault.split(":", 1)[1]) if ":" in fault else 50
        orig = cl.LadderBlock.segment
        calls = {"n": 0}

        def segment(self, f, x, yt, yb):
            i = calls["n"]
            calls["n"] += 1
            if i == n:
                el = self.ladder["elements"][self.columns[i][2]]
                note["dropped"] = "ladder unit %d (%s, %s-%s)" % (n, el["devs"][0]["name"], el["a"], el["b"])
                head = self.spec["pc0"] + 230 + 75
                return dict(x=x, top=(yt + head - 380, yt + head), bot=(yb - head, yb - head + 380))
            return orig(self, f, x, yt, yb)
        cl.LadderBlock.segment = segment
    elif fault.startswith("swap-taps:"):
        _f, a, b = fault.split(":")
        orig = cl.LadderBlock.draw

        def draw(self, cell, ox, oy, flip):
            label = cell.label

            def swapped(text, layer, x1, y1, x2, y2, port=None, use="signal"):
                if text in (a, b) and port is not None:
                    text = b if text == a else a
                    port = self.pins.index(text) + 1
                    note.setdefault("swapped", []).append(text)
                return label(text, layer, x1, y1, x2, y2, port=port, use=use)
            cell.label = swapped
            try:
                return orig(self, cell, ox, oy, flip)
            finally:
                cell.label = label
        cl.LadderBlock.draw = draw
    else:
        raise SystemExit("layout_faults: unknown fault %s" % fault)
    return note


def main(argv):
    if len(argv) < 5:
        print(__doc__, file=sys.stderr)
        return 2
    netlist, name, out, fault = argv[1], argv[2], Path(argv[3]).resolve(), argv[4]
    if out.exists():
        raise SystemExit("layout_faults: %s exists; every case runs in a new folder" % out)
    note = inject(fault)
    r = cl.cmd_all(netlist, name, str(out))
    ran = all(v == 0 for v in r["rcs"].values())
    result = dict(fault=fault, injected=note, ran=ran, rcs=r["rcs"], netgenMismatch=r["lvs"]["mismatch"], netgenLines=r["lvs"]["lines"],
                  klayoutMismatch=r["klayoutLvs"]["mismatch"], klayoutLines=r["klayoutLvs"]["lines"],
                  caught=ran and bool(note) and r["lvs"]["mismatch"] and r["klayoutLvs"]["mismatch"])
    (out / "fault.json").write_text(json.dumps(result, indent=2) + "\n")
    print("FAULT " + json.dumps(result))
    return 0 if result["caught"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
