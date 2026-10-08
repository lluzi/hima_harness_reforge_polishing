"""vmin_bottleneck: cells that slow down more than the reference inverter when the supply drops.

For every variant and temperature, each cell's delay at its own fanout-of-4 load (4x the arc's own input
capacitance, at the reference inverter's fanout-of-4 slew of that corner; the worst arc of mean rise/fall) is read
at the high and the low supply. Extra slowdown = (cell slowdown / reference inverter slowdown - 1) x 100. A cell is
flagged when its worst extra slowdown over the temperatures reaches the watch level. The worst cells get a redesign
brief for the cell designer, with the circuit location when a transistor netlist is given.

Usage (from flow/):
  python3 -m libinsight_analysis.rules.vmin_bottleneck --facts 9T-SVT='/corpus/*ssg*' --hi 0.81 --lo 0.72 \
      --temps=-40,125 --watch 5 --naming dnum [--netlist cells.spi] --out vmin_bottleneck.json
"""
import argparse
import glob
import os
import sys
import time

if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from libinsight_analysis.rules import facts as F  # noqa: E402
from libinsight_analysis.rules import netlists  # noqa: E402

RULE_ID = "vmin_bottleneck"
WATCH = 5.0
MAX_ITEMS = 40
BRIEFS = 5


def digest(label, path, naming):
    """One corner file reduced to: corner, reference inverter point, per cell its fanout-of-4 delay and per arc
    (rise, fall, inside the grid), and the cell facts the brief needs."""
    lib = F.load_facts(path)
    corner = F.corner(lib)
    name = lib.get("name") or ""
    cells = F.read_cells(lib, naming, label)
    del lib
    inv = F.reference_inverter(cells)
    if inv is None:
        raise F.RuleError("%s has no usable inverter to compare with" % path)
    ref = F.fo4_point(cells, inv)
    delays, meta = {}, {}
    for cname, rec in cells.items():
        if rec["sig"] is None or not rec["arcs"]:
            continue
        arcs, best = {}, None
        for group in F.by_pair(F.metric_arcs(rec)):
            for a in group:
                basis = F.load_basis(rec["pins"], a)
                if basis is None:
                    continue
                vals, ok = [], True
                for kind in ("cell_rise", "cell_fall"):
                    g = a["t"].get(kind)
                    if g is None:
                        vals.append(None)
                        continue
                    v, inside = F.lookup(g, ref["slew"], 4.0 * basis)
                    vals.append(v)
                    ok = ok and inside
                have = [v for v in vals if v is not None]
                if not have:
                    continue
                key = (a["from"], a["to"], a["when"])
                arcs[key] = (vals[0], vals[1], ok)
                mean = sum(have) / len(have)
                if best is None or mean > best[0]:
                    best = (mean, key, ok)
        if best is None or best[0] <= 0:
            continue
        delays[cname] = {"d": best[0], "ok": best[2], "arcs": arcs}
        meta[cname] = dict((k, rec[k]) for k in ("cls", "sig", "area", "leak", "label", "stem", "drive", "vt"))
        meta[cname]["caps"] = dict((p, v["cap"]) for p, v in rec["pins"].items() if v["dir"] == "input")
    if inv not in delays or not delays[inv]["ok"]:
        raise F.RuleError("the reference inverter %s of %s is read outside its table" % (inv, path))
    return {"corner": corner, "ref": ref, "inv": inv, "cells": delays, "meta": meta, "library": name}


def _arc_worst(hi, lo, s_ref):
    """(extra %, (from, to, when), edge) of the arc edge that slows most relative to the inverter."""
    best = None
    for key, h in hi["arcs"].items():
        l = lo["arcs"].get(key)
        if l is None:
            continue
        for k, edge in ((0, "rise"), (1, "fall")):
            if h[k] and l[k]:
                x = (l[k] / h[k] / s_ref - 1.0) * 100.0
                if best is None or x > best[0]:
                    best = (x, key, edge)
    return best


def _ordinal(n):
    return {1: "next to the output", 2: "2nd from the output", 3: "3rd from the output"}.get(n, "%sth from the output" % n)


def _where(spice, cell, pin, out, siblings, label):
    sub = spice.get(cell)
    if sub is None:
        return None
    devs = netlists.input_devices(sub, pin, out)
    if not devs:
        return None
    words = []
    for d in devs[:6]:
        words.append("%s-channel %s (W %s µm, L %s µm, %d finger%s) %s in a %s-high stack" % (
            d["type"], d["device"], "?" if d["w"] is None else "%g" % d["w"], "?" if d["l"] is None else "%g" % d["l"],
            d["fingers"], "" if d["fingers"] == 1 else "s", _ordinal(d["position"]) if d["position"] else "off the path",
            d["stack"] or "?"))
    sib = []
    for s in siblings:
        if s in spice:
            sd = netlists.input_devices(spice[s], pin, out)
            if sd:
                sib.append({"cell": s, "devices": [dict((k, d[k]) for k in ("type", "w", "l", "fingers", "position"))
                                                   for d in sd]})
    text = "%s drives %d device group%s: %s." % (pin, len(devs), "" if len(devs) == 1 else "s", "; ".join(words))
    if sib:
        text += " Sibling sizes: " + "; ".join("%s %s" % (label(s["cell"]), ", ".join(
            "%s %s µm" % (d["type"], "?" if d["w"] is None else "%g" % d["w"]) for d in s["devices"])) for s in sib[:4]) + "."
    return F.clip(text, 600), devs


def _brief(item, ctx):
    v, t, name = item["v"], item["t"], item["name"]
    hi, lo = ctx["series"][(v, t)][ctx["hi"]], ctx["series"][(v, t)][ctx["lo"]]
    s_ref = ctx["sref"][(v, t)]
    worst = _arc_worst(hi["cells"][name], lo["cells"][name], s_ref)
    if worst is None:
        return None
    x, (src, dst, when), edge = worst
    arc = F.arc_words(src, dst, edge)
    meta = hi["meta"][name]
    sibs = sorted((n for n, m in hi["meta"].items() if n != name and m["sig"] == meta["sig"]),
                  key=lambda n: (hi["meta"][n]["area"] or 0, n))
    sib_x = []
    for n in sibs:
        if n in ctx["extra"].get((v, t), {}):
            sib_x.append("%s %s" % (hi["meta"][n]["label"], F.pct(ctx["extra"][(v, t)][n])))
    found = _where(ctx["spice"], name, src, dst, sibs, lambda n: hi["meta"][n]["label"]) if ctx["spice"] else None
    where, devices = found if found else (None, [])
    stack_type = "n" if edge == "fall" else "p"
    deep = None
    if devices:
        on = [d for d in devices if d["type"] == stack_type and d["stack"]] or [d for d in devices if d["stack"]]
        deep = max(on, key=lambda d: d["stack"]) if on else None
    stack_words = ("the %s-channel stack, %d high" % (deep["type"], deep["stack"])) if deep else \
        ("the %s stack" % ("pull-down" if edge == "fall" else "pull-up"))
    levers = [{"change": "Widen the devices in the deepest series stack on the %s path (%s)." % (arc, stack_words),
               "effect": "qualitative"}]
    if deep is None or (deep["position"] or 1) > 1:
        levers.append({"change": "Reorder the stack so %s, the late-arriving input, sits next to the output%s." % (
            src, " (now %s)" % _ordinal(deep["position"]) if deep else ""), "effect": "qualitative"})
    inputs = len([p for p in meta["caps"]])
    if (deep and deep["stack"] >= 3) or (deep is None and inputs >= 3):
        levers.append({"change": "Split the %s stack into two stages." % (
            "%d-high" % deep["stack"] if deep else "deep"), "effect": "qualitative"})
    bigger = sorted((n for n in sibs if (hi["meta"][n]["area"] or 0) > (meta["area"] or 0)),
                    key=lambda n: (hi["meta"][n]["stem"] != meta["stem"], hi["meta"][n]["area"] or 0, n))
    cost = []
    if bigger:
        nb = hi["meta"][bigger[0]]

        def delta(a, b):
            return "unknown" if not a or b is None else F.pct((b / a - 1.0) * 100.0, 0)
        cost = [["Area", "%s (next size %s: %s vs %s µm²)" % (delta(meta["area"], nb["area"]), nb["label"],
                                                              F.rnd(nb["area"], 3), F.rnd(meta["area"], 3))],
                ["Input capacitance on %s" % src, "%s (%s vs %s fF)" % (
                    delta(meta["caps"].get(src), nb["caps"].get(src)), F.rnd(nb["caps"].get(src), 3),
                    F.rnd(meta["caps"].get(src), 3))],
                ["Leakage", "%s (%s vs %s nW)" % (delta(meta["leak"], nb["leak"]), F.rnd(nb["leak"], 3),
                                                  F.rnd(meta["leak"], 3))],
                ["How to read it", "Widening one stack costs part of this step: upper bounds."]]
    else:
        cost = [["Area", "unknown: no larger size of this function in this variant"]]
    cls_vals = sorted(x2 for n, x2 in ctx["extra"][(v, t)].items() if hi["meta"].get(n, {}).get("cls") == meta["cls"])
    compare = "The reference inverter %s slows ×%.3f from %g V to %g V at %s °C; %s on %s slows %s more. %s median: %s." % (
        hi["meta"][ctx["inv"][(v, t)]]["label"], s_ref, ctx["hi"], ctx["lo"], t, item["label"], arc, F.pct(x),
        meta["cls"], F.pct(F.quantile(cls_vals, .5)) if cls_vals else "unknown")
    if sib_x:
        compare += " Sibling sizes: " + ", ".join(sib_x[:5]) + "."
    return {"cell": name, "arc": F.clip(arc + (" when %s" % when if when else ""), 60),
            "symptom": "Slows more than the inverter at low voltage: from %g V to %g V at %s °C the %s delay grows "
                       "%s more than the reference inverter's." % (ctx["hi"], ctx["lo"], t, arc, F.pct(x)),
            "now": F.rnd(x, 1), "target": ctx["watch"], "unit": "% extra slowdown",
            "compare": F.clip(compare, 400), "where": where, "levers": levers[:4], "cost": cost,
            "check": "Re-characterise %s at %g V and %g V at %s °C, re-run the Vmin bottleneck rule, and pass when "
                     "its extra slowdown versus the reference inverter is at most %g%%." % (
                         arc, ctx["hi"], ctx["lo"], " and ".join(ctx["temps"]), ctx["watch"])}


def run(inputs, hi=None, lo=None, temps=None, watch=WATCH, naming="generic", netlist=None, briefs=BRIEFS,
        max_items=MAX_ITEMS, library=None):
    """inputs: [(variant label, facts path)] covering every variant at the compared voltages and temperatures."""
    namer = naming if isinstance(naming, F.Naming) else F.Naming(naming)
    series, variants, libname = {}, [], None
    for label, path in inputs:
        d = digest(label, path, namer)
        c = d["corner"]
        if c["voltage"] is None or c["temperature"] is None:
            raise F.RuleError("%s does not state its voltage and temperature" % path)
        key = (label, F.temp_key(c["temperature"]))
        if c["voltage"] in series.setdefault(key, {}):
            raise F.RuleError("two files of %s are at %g V and %s °C; give one file per corner" % (label, c["voltage"], key[1]))
        series[key][c["voltage"]] = d
        libname = libname or d["library"]
        if label not in variants:
            variants.append(label)
    all_temps = sorted(set(t for _, t in series), key=float)
    temps = [F.temp_key(float(t)) for t in temps] if temps else all_temps
    volts = sorted(set(v for s in series.values() for v in s))
    hi = float(hi) if hi is not None else volts[-1]
    lo = float(lo) if lo is not None else volts[0]
    if not lo < hi:
        raise F.RuleError("the low supply %g V must be below the high supply %g V" % (lo, hi))
    ctx = {"series": series, "hi": hi, "lo": lo, "watch": float(watch), "temps": temps, "sref": {}, "extra": {},
           "inv": {}, "spice": None}
    missing = [("%s at %s °C" % k) for k in ((v, t) for v in variants for t in temps)
               if hi not in series.get(k, {}) or lo not in series.get(k, {})]
    if missing:
        raise F.RuleError("no facts at both %g V and %g V for %s" % (hi, lo, ", ".join(missing)))
    excluded, judged = 0, {}
    for v in variants:
        for t in temps:
            s = series[(v, t)]
            ih, il = s[hi], s[lo]
            s_ref = il["cells"][il["inv"]]["d"] / ih["cells"][ih["inv"]]["d"]
            ctx["sref"][(v, t)], ctx["inv"][(v, t)] = s_ref, ih["inv"]
            ext = {}
            for name, ch in ih["cells"].items():
                cl = il["cells"].get(name)
                if cl is None:
                    continue
                if not (ch["ok"] and cl["ok"]):
                    excluded += 1
                    continue
                ext[name] = (cl["d"] / ch["d"] / s_ref - 1.0) * 100.0
            ctx["extra"][(v, t)] = ext
        judged[v] = sorted(set(n for t in temps for n in ctx["extra"][(v, t)]))

    rows, cands, flagged = [], [], 0
    for v in variants:
        worst = {}
        for n in judged[v]:
            vals = [(ctx["extra"][(v, t)][n], t) for t in temps if n in ctx["extra"][(v, t)]]
            worst[n] = max(vals)
        fl = sorted(((x, n, t) for n, (x, t) in worst.items() if x >= ctx["watch"]), reverse=True)
        flagged += len(fl)
        cands += [(x, v, n, t) for x, n, t in fl]
        rows.append({"v": v, "b": F.box([x for x, _ in worst.values()]), "n": len(fl),
                     "dots": [F.rnd(x, 2) for x, _, _ in fl[:60]]})
    cands.sort(key=lambda z: (-z[0], z[1], z[2]))

    fan, fan_cells = {}, {}
    for v in variants:
        for t in temps:
            s = series[(v, t)]
            vs = sorted((x for x in s if lo <= x <= hi), reverse=True)
            base = s[hi]
            ratios = {}
            for n, ch in base["cells"].items():
                ratios[n] = [(s[x]["cells"][n]["d"] / ch["d"]) if n in s[x]["cells"] else None for x in vs]
            fan_cells[(v, t)] = ratios
            inv_r = [s[x]["cells"][s[x]["inv"]]["d"] / base["cells"][base["inv"]]["d"] for x in vs]
            fan["%s|%s" % (v, t)] = {"volts": vs, "inv": [F.rnd(x) for x in inv_r],
                                     "boxes": [None if k == 0 else F.box([r[k] for n, r in ratios.items()
                                                                          if n in ctx["extra"][(v, t)]])
                                               for k in range(len(vs))]}

    if netlist:
        wanted = set()
        for x, v, n, t in cands[:briefs]:
            sig = series[(v, t)][hi]["meta"][n]["sig"]
            wanted |= set(m for m, r in series[(v, t)][hi]["meta"].items() if r["sig"] == sig)
        ctx["spice"] = netlists.read_spice(netlist if isinstance(netlist, list) else [netlist], wanted)

    items, clsbox = [], {}
    for k, (x, v, n, t) in enumerate(cands[:max_items]):
        meta = series[(v, t)][hi]["meta"][n]
        extra = dict((tt, F.rnd(ctx["extra"][(v, tt)].get(n), 2)) for tt in temps)
        item = {"name": n, "label": F.clip(meta["label"], 60), "v": v, "t": t, "x": F.rnd(x, 2), "cls": meta["cls"],
                "extra": extra,
                "fan": dict((tt, [F.rnd(r) for r in fan_cells[(v, tt)].get(n, [])] or None) for tt in temps)}
        other = [tt for tt in temps if tt != t and extra.get(tt) is not None]
        item["focus"] = F.clip(
            "From %g V to %g V at %s °C this cell slows %s more than the reference inverter (watch level %g%%)%s." % (
                hi, lo, t, F.pct(x), ctx["watch"],
                "; at %s °C %s" % (other[0], F.pct(extra[other[0]])) if other else ""), 400)
        if k < briefs:
            b = _brief(item, ctx)
            if b:
                item["brief"] = b
        items.append(item)
        for tt in temps:
            key = "%s|%s|%s" % (v, tt, meta["cls"])
            if key in clsbox:
                continue
            members = [r for m, r in fan_cells[(v, tt)].items()
                       if series[(v, tt)][hi]["meta"].get(m, {}).get("cls") == meta["cls"] and m in ctx["extra"][(v, tt)]]
            nv = len(fan["%s|%s" % (v, tt)]["volts"])
            clsbox[key] = {"n": len(members), "boxes": [None if i == 0 else F.box([m[i] for m in members])
                                                        for i in range(nv)]}

    checked = sum(len(judged[v]) for v in variants)
    worst = items[0] if items else None
    by_n = sorted(rows, key=lambda r: (-r["n"], r["v"]))
    span = "%g V to %g V" % (hi, lo)
    temp_words = " and ".join("%s °C" % t for t in temps)
    facts = [["Cells flagged", "%s of %s" % ("{:,}".format(flagged), "{:,}".format(checked))],
             ["Worst cell", "%s (%s) %s" % (worst["label"], worst["v"], F.pct(worst["x"])) if worst else "none"],
             ["Most flagged", by_n[0]["v"] if flagged else "none"],
             ["Cleanest", by_n[-1]["v"]],
             ["Watch level", "%g%% extra slowdown" % ctx["watch"]],
             ["Supplies compared", span],
             ["Temperatures", temp_words],
             ["Reference inverter", ", ".join(sorted(set(series[(v, t)][hi]["meta"][ctx["inv"][(v, t)]]["label"]
                                                         for v in variants for t in temps)))[:80]],
             ["Read outside their tables (not judged)", excluded]]
    corners = len(set((v, t, x) for (v, t), s in series.items() for x in s))
    rule = {
        "id": RULE_ID, "kind": "vmin", "title": "Vmin bottleneck",
        "summary": F.clip("Cells that slow down more than the inverter when the supply drops from %s." % span, 200),
        "result": F.clip("%s flagged · worst %s" % (F.count_words(flagged, "cell"),
                                                    F.pct(worst["x"]) if worst else "none"), 120),
        "rule": F.clip("Flag a cell when its delay grows at least %g%% more than the reference inverter's from %s "
                       "(%s), each cell at 4× its own input capacitance. Derate = the excess." % (
                           ctx["watch"], span, temp_words), 400),
        "library": F.clip(" · ".join([library or libname or "Library", F.count_words(len(variants), "variant"), F.count_words(corners, "corner"), F.count_words(checked, "cell")]), 160),
        "facts": facts[:12],
        "score": {"dimension": "robustness", "affected": flagged, "checked": checked, "weight": 6},
        "impact": [
            ["Timing", F.clip("Up to %s more delay at %g V than the inverter-based margin covers, on %s." % (
                F.pct(worst["x"]) if worst else "0%", lo, F.count_words(flagged, "cell")), 300)],
            ["Voltage scaling", "Guard bands and on-chip monitors are built from inverters, so they do not see these "
                                "cells slow down; these cells fail first when the supply is lowered."],
            ["Sign-off", "Runs below %g V need a late derate on the flagged cells, or the cells kept off "
                         "low-voltage critical paths." % hi]],
        "todo": [
            {"who": "chip_designer", "text": "For runs below %g V, load the derate file: a late derate of 1 + the "
                                             "excess on each flagged cell." % hi},
            {"who": "chip_designer", "text": "Keep the worst cells off critical paths in low-voltage blocks, or "
                                             "mark them don't-use there."},
            {"who": "cell_designer", "text": "Use the redesign brief of the worst cells: widen or reorder the "
                                             "deepest stack on the slow arc."},
            {"who": "library_provider", "text": "Confirm the flagged cells at an intermediate voltage and state "
                                                "the supply below which they need a derate."}],
        "hint": "Each box is one variant: the spread of every cell's extra slowdown versus the inverter. Red dots "
                "are the flagged cells; click a variant to filter the list.",
        "hi": hi, "lo": lo, "temps": temps, "watch": ctx["watch"], "rows": rows, "fan": fan, "clsbox": clsbox,
        "items": items}
    return rule


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--facts", action="append", required=True, help="VARIANT=PATH or VARIANT=GLOB (repeat)")
    ap.add_argument("--hi", type=float, help="the high supply in V (default: the highest found)")
    ap.add_argument("--lo", type=float, help="the low supply in V (default: the lowest found)")
    ap.add_argument("--temps", help="temperatures to compare, comma separated; write --temps=-40,125 (default: every one found)")
    ap.add_argument("--watch", type=float, default=WATCH, help="flag level, %% extra slowdown (default 5)")
    ap.add_argument("--naming", default="generic", help="naming profile: generic, dnum, or a JSON file")
    ap.add_argument("--netlist", action="append", help="cell transistor netlist (SPICE/CDL) or a glob of them, for the briefs")
    ap.add_argument("--briefs", type=int, default=BRIEFS, help="redesign briefs for the worst N cells")
    ap.add_argument("--max-items", type=int, default=MAX_ITEMS)
    ap.add_argument("--library", help="the library name for the page header")
    ap.add_argument("--out", default="-")
    args = ap.parse_args(argv)
    start = time.time()
    netlist = None
    if args.netlist:
        # A glob keeps the recorded command line short; each pattern must match at least one file.
        netlist = []
        for pattern in args.netlist:
            found = sorted(glob.glob(os.path.expanduser(pattern))) if any(c in pattern for c in "*?[") else [pattern]
            if not found:
                sys.stderr.write("%s: no netlist matches %s\n" % (RULE_ID, pattern))
                return 2
            netlist.extend(found)
    try:
        rule = run(F.parse_inputs(args.facts), args.hi, args.lo,
                   [t for t in args.temps.split(",") if t.strip()] if args.temps else None, args.watch, args.naming,
                   netlist, args.briefs, min(args.max_items, 400), args.library)
    except F.RuleError as exc:
        sys.stderr.write("%s: %s\n" % (RULE_ID, exc))
        return 2
    F.write_rule(rule, args.out)
    sys.stderr.write("%s: %s in %.1f s\n" % (RULE_ID, rule["result"], time.time() - start))
    return 0


if __name__ == "__main__":
    sys.exit(main())
