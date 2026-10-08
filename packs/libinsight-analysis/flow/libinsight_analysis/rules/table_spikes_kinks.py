"""table_spikes_kinks: table points that jump off the smooth curve (characterisation glitches).

Every delay and transition table (input slew x output load) is read along each axis. At each interior point the
roughness is its distance from the straight chord between its two neighbours, at the neighbours' real axis values,
in units of the tolerance there (max of an absolute floor and a share of the value: delay 2 ps / 2 %, transition
3 ps / 3 %), raised to the noise floor of the tables that share its kind and grid (5 x the median absolute
deviation of their relative roughness at that point), so a point as rough as its peers' is not flagged. A spike is
a point beyond it on the opposite side of the chord from both neighbours; a kink is two neighbouring points beyond it
on opposite sides (the curve's bend flips). The worst table of each cell family is
listed with its grid, its roughness and the slice through the flagged point.

Usage (from flow/):
  python3 -m libinsight_analysis.rules.table_spikes_kinks --facts 9T-SVT='/corpus/svt_*.json.gz' \
      --facts 9T-LVT='/corpus/lvt_*.json.gz' --naming dnum --out table_spikes_kinks.json
"""
import argparse
import array
import os
import sys
import time
from collections import Counter

if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from libinsight_analysis.rules import facts as F  # noqa: E402

RULE_ID = "table_spikes_kinks"
TOLERANCE = {"delay": (0.02, 2.0), "transition": (0.03, 3.0)}     # (share of the value, ps floor)
KINDS = {"cell_rise": "delay", "cell_fall": "delay", "rise_transition": "transition", "fall_transition": "transition"}
WORDS = {"cell_rise": "rise delay", "cell_fall": "fall delay", "rise_transition": "rise transition",
         "fall_transition": "fall transition"}
FACTOR = 1.0
MAX_ITEMS = 40


def chord(xs, ys):
    """Chord residuals of a line at its real axis values; None at both ends."""
    out = [None] * len(ys)
    for k in range(1, len(ys) - 1):
        span = xs[k + 1] - xs[k - 1]
        if span <= 0:
            continue
        w = (xs[k] - xs[k - 1]) / span
        out[k] = ys[k] - (ys[k - 1] + w * (ys[k + 1] - ys[k - 1]))
    return out


def _sign(x):
    return 0 if not x else (1 if x > 0 else -1)


def line_events(res, tol, factor):
    """[(shape, k, ratio)] of one line: spikes at interior k (2..n-3) and kinks between k and k+1 (1..n-3)."""
    n = len(res)
    big = [res[k] is not None and abs(res[k]) > factor * tol[k] for k in range(n)]
    sg = [_sign(r) if r is not None else 0 for r in res]
    out = []
    for k in range(2, n - 2):
        if big[k] and sg[k] and sg[k - 1] == -sg[k] and sg[k + 1] == -sg[k]:
            out.append(("spike", k, abs(res[k]) / tol[k]))
    for k in range(1, n - 2):
        if big[k] and big[k + 1] and sg[k] and sg[k] == -sg[k + 1]:
            out.append(("kink", k if abs(res[k]) / tol[k] >= abs(res[k + 1]) / tol[k + 1] else k + 1,
                        min(abs(res[k]) / tol[k], abs(res[k + 1]) / tol[k + 1])))
    return out


def residuals(g):
    """Chord residuals of every point along the slew axis (c0) and the load axis (c1); None where undefined."""
    S, L, V = g["s"], g["l"], g["v"]
    ni, nj = len(S), len(L)
    c0 = [[None] * nj for _ in range(ni)]
    c1 = [[None] * nj for _ in range(ni)]
    if ni >= 3:
        for j in range(nj):
            col = chord(S, [V[i][j] for i in range(ni)])
            for i in range(ni):
                c0[i][j] = col[i]
    if nj >= 3:
        for i in range(ni):
            c1[i] = chord(L, V[i])
    return c0, c1


def judge(g, family, factor=FACTOR, noise=None):
    """Roughness and events of one slew x load table. The threshold of a point along an axis is the larger of its
    tolerance and its noise floor there (`noise`: per axis, a share of the value; None for none). Returns (res grid
    in threshold units, (threshold along slew, along load), (c0, c1), events [(shape, axis, (i, j), ratio)])."""
    rel, floor = TOLERANCE[family]
    S, L, V = g["s"], g["l"], g["v"]
    ni, nj = len(S), len(L)
    c0, c1 = residuals(g)
    tol = [[max(floor, rel * abs(V[i][j])) for j in range(nj)] for i in range(ni)]
    thr = []
    for axis in (0, 1):
        nf = noise[axis] if noise else None
        thr.append([[max(tol[i][j], abs(V[i][j]) * nf[i][j]) if nf else tol[i][j] for j in range(nj)]
                    for i in range(ni)])
    events = []
    if ni >= 4:
        for j in range(nj):
            line = [c0[i][j] for i in range(ni)]
            for shape, k, ratio in line_events(line, [thr[0][i][j] for i in range(ni)], factor):
                events.append((shape, 0, (k, j), ratio))
    if nj >= 4:
        for i in range(ni):
            for shape, k, ratio in line_events(c1[i], thr[1][i], factor):
                events.append((shape, 1, (i, k), ratio))
    res = [[max(abs(c0[i][j] or 0.0) / thr[0][i][j], abs(c1[i][j] or 0.0) / thr[1][i][j]) for j in range(nj)]
           for i in range(ni)]
    return res, thr, (c0, c1), events


def _tables(lib, templates, ps):
    """(cell, pin, timing group, table, family, grid) of every slew x load delay and transition table."""
    for cell in lib.get("cells") or []:
        for pin in cell.get("pins") or []:
            for tg in pin.get("timing") or []:
                for t in tg.get("tables") or []:
                    family = KINDS.get(t.get("kind"))
                    if family is None:
                        continue
                    g = F.grid(t, templates, ps)
                    if g is not None and max(len(g["s"]), len(g["l"])) >= 4:
                        yield cell, pin, tg, t, family, g


def _median(xs):
    v = sorted(xs)
    n = len(v)
    return v[n // 2] if n % 2 else 0.5 * (v[n // 2 - 1] + v[n // 2])


def noise_floors(lib, templates, ps):
    """Per group of tables sharing a kind and a grid (five or more tables): the noise floor of each point along
    each axis, as a share of the value: 5 x the median absolute deviation, across the group, of the chord residual
    relative to the value (at least 1e-5). Smooth curvature that every cell shares does not count as roughness."""
    groups = {}
    for cell, pin, tg, t, family, g in _tables(lib, templates, ps):
        key = (t["kind"], tuple(g["s"]), tuple(g["l"]))
        entry = groups.get(key)
        if entry is None:
            entry = groups[key] = {"family": family, "n": 0, "absv": array.array("d"), "rho": {}}
        entry["n"] += 1
        for row in g["v"]:
            entry["absv"].extend(abs(x) for x in row)
        c = residuals(g)
        for axis in (0, 1):
            for i, line in enumerate(c[axis]):
                for j, r in enumerate(line):
                    if r is not None:
                        entry["rho"].setdefault((axis, i, j), array.array("d")).append(r)
                        entry["rho"][(axis, i, j)].append(g["v"][i][j])
    out = {}
    for key, e in groups.items():
        ni, nj = len(key[1]), len(key[2])
        if e["n"] < 5:
            out[key] = None
            continue
        scale = max(TOLERANCE[e["family"]][1], 1e-3 * _median(e["absv"]))
        nf = [[[1e-5] * nj for _ in range(ni)] for _ in (0, 1)]
        for (axis, i, j), pairs in e["rho"].items():
            rho = [pairs[k] / max(abs(pairs[k + 1]), scale) for k in range(0, len(pairs), 2)]
            med = _median(rho)
            nf[axis][i][j] = max(1e-5, 5.0 * _median([abs(x - med) for x in rho]))
        out[key] = nf
    return out


def _item(rec, family_count):
    g, res, tol, (c0, c1) = rec["g"], rec["res"], rec["tol"], rec["c"]
    shape, axis, (pi, pj), ratio = rec["event"]
    S, L, V = g["s"], g["l"], g["v"]
    dev = (c0 if axis == 0 else c1)[pi][pj]
    obs = V[pi][pj]
    if axis == 0:
        sx, sy, k = S, [V[i][pj] for i in range(len(S))], pi
        at = "load %.4g fF" % L[pj]
        others = [{"label": "load %.4g fF" % L[j], "y": [F.rnd(V[i][j]) for i in range(len(S))]}
                  for j in (pj - 1, pj + 1) if 0 <= j < len(L)]
    else:
        sx, sy, k = L, V[pi], pj
        at = "slew %.4g ps" % S[pi]
        others = [{"label": "slew %.4g ps" % S[i], "y": [F.rnd(x) for x in V[i]]} for i in (pi - 1, pi + 1)
                  if 0 <= i < len(S)]
    verdict = ("Spike: this point sits %.1f× the tolerance off the line between its neighbours, on the opposite side "
               "from both." % ratio) if shape == "spike" else (
        "Kink: the curve's bend flips here, %.1f× the tolerance on each side." % ratio)
    corners = "flagged at %d of %d corners" % (len(family_count), rec["n_corners"])
    return {
        "name": rec["cell"], "label": F.clip(rec["label"], 60), "v": rec["v"], "ratio": F.rnd(ratio, 3),
        "corner": rec["corner"], "corners": corners, "kind": rec["kind"],
        "arc": F.arc_words(rec["from"], rec["to"]), "when": rec["when"], "pos": [pi, pj],
        "label_pos": "slew %.4g ps × load %.4g fF" % (S[pi], L[pj]),
        "xname": "input slew (ps)" if axis == 0 else "output load (fF)",
        "axes": [[F.rnd(x) for x in S], [F.rnd(x) for x in L]],
        "vals": [[F.rnd(x) for x in row] for row in V], "res": [[F.rnd(x, 3) for x in row] for row in res],
        "tol": F.rnd(tol[pi][pj]),
        "slice": {"x": [F.rnd(x) for x in sx], "y": [F.rnd(x) for x in sy], "k": k, "at": at, "others": others},
        "observed": F.rnd(obs), "expected": F.rnd(obs - dev), "tolx": F.rnd(abs(dev) / tol[pi][pj], 3),
        "verdict": verdict,
        "focus": F.clip("The %s table of %s at slew %.4g ps and load %.4g fF (%s) reads %.4g ps where the line "
                        "between its neighbours gives %.4g ps: %.1f× the %.3g ps tolerance." % (
                            WORDS[rec["kind"]], F.arc_words(rec["from"], rec["to"]), S[pi], L[pj],
                            rec["corner"], obs, obs - dev, abs(dev) / tol[pi][pj], tol[pi][pj]), 400)}


def run(inputs, naming="generic", factor=FACTOR, max_items=MAX_ITEMS, library=None, noise=True):
    """inputs: [(variant label, facts path)], any number of corners per variant."""
    namer = naming if isinstance(naming, F.Naming) else F.Naming(naming)
    checked, flagged, shapes = 0, 0, Counter()
    by_variant, by_family, cells_hit, cells_all = Counter(), Counter(), set(), set()
    best, where, variants, corners, libname = {}, {}, [], {}, None
    for label, path in inputs:
        lib = F.load_facts(path)
        corner = F.corner_words(F.corner(lib))
        libname = libname or lib.get("name")
        corners.setdefault(label, set()).add(corner)
        if label not in variants:
            variants.append(label)
        templates = F.templates_of(lib)
        ps = F.scales(lib)["ps"]
        floors = noise_floors(lib, templates, ps) if noise else {}
        for cell in lib.get("cells") or []:
            cells_all.add((label, cell.get("name")))
        for cell, pin, tg, t, family, g in _tables(lib, templates, ps):
            name = cell.get("name")
            checked += 1
            res, thr, c, events = judge(g, family, factor, floors.get((t["kind"], tuple(g["s"]), tuple(g["l"]))))
            if not events:
                continue
            ev = max(events, key=lambda e: (e[0] == "spike", e[3]))
            stem = namer.parse(name)
            flagged += 1
            shapes[ev[0]] += 1
            by_variant[label] += 1
            fam = stem["stem"] or name
            by_family[fam] += 1
            cells_hit.add((label, name))
            for rel in (tg.get("related_pin") or "").split() or [""]:
                key = (label, name, rel, pin["name"], tg.get("when") or "", t["kind"])
                where.setdefault(key, set()).add(corner)
                fk = (label, fam)
                if fk not in best or ev[3] > best[fk]["event"][3]:
                    best[fk] = {"g": g, "res": res, "tol": thr[ev[1]], "c": c, "event": ev, "cell": name,
                                "label": stem["label"], "v": label, "corner": corner, "kind": t["kind"], "from": rel,
                                "to": pin["name"], "when": tg.get("when") or "", "key": key}
        del lib
    recs = sorted(best.values(), key=lambda r: (-r["event"][3], r["v"], r["cell"]))[:max_items]
    items = []
    for r in recs:
        r["n_corners"] = len(corners[r["v"]])
        items.append(_item(r, where[r["key"]]))
    worst = items[0] if items else None
    ncorners = len(set(c for s in corners.values() for c in s))
    rule = {
        "id": RULE_ID, "kind": "spike", "title": "Table spikes and kinks",
        "summary": "Table points that jump off the smooth curve: characterisation glitches the tools will read as real.",
        "result": F.clip("%s · %s · worst %.1f× tolerance" % (
            F.count_words(len(cells_hit), "cell"), F.count_words(flagged, "table"), worst["ratio"] if worst else 0.0), 120),
        "rule": F.clip("Along each table axis, a point must not sit on the wrong side of the chord between its "
                       "neighbours (spike), nor flip the curve's bend (kink), by more than the tolerance: delay %g ps "
                       "or %g%%, transition %g ps or %g%%, whichever is larger, raised to the noise of tables on "
                       "the same grid." % (
                           TOLERANCE["delay"][1], TOLERANCE["delay"][0] * 100, TOLERANCE["transition"][1],
                           TOLERANCE["transition"][0] * 100), 400),
        "library": F.clip(" · ".join([library or libname or "Library", F.count_words(len(variants), "variant"), F.count_words(ncorners, "corner"), F.count_words(len(cells_all), "cell")]), 160),
        "facts": [["Cells affected", len(cells_hit)], ["Tables affected", flagged], ["Tables checked", checked],
                  ["Spikes", shapes["spike"]], ["Kinks", shapes["kink"]],
                  ["Most affected", "%s (%d)" % by_variant.most_common(1)[0] if by_variant else "none"],
                  ["Tables read", "delay and transition, input slew × output load"]],
        "score": {"dimension": "quality", "affected": flagged, "checked": checked, "weight": 6},
        "impact": [
            ["Timing", "Delay calculators interpolate between table points, so a glitch near a common slew and load "
                       "changes the arc's delay wherever a design operates there."],
            ["Optimisation", "A spike can make a cell look faster or slower than its siblings and steer sizing the "
                             "wrong way."],
            ["Sign-off", "Tools trust the tables; a glitch is read as real silicon behaviour until the table is "
                         "re-characterised."]],
        "todo": [
            {"who": "library_provider", "text": "Re-characterise the listed tables at the flagged points (the request "
                                                "file names each one)."},
            {"who": "chip_designer", "text": "Until fixed, check paths that use the flagged arcs near the flagged "
                                             "slew and load."},
            {"who": "note", "text": "Each item is the worst table of one cell family; the counts cover every table."}],
        "hint": "Counts of flagged tables by variant, by kind (spike or kink) and by cell family.",
        "by_variant": [[k, n] for k, n in by_variant.most_common()],
        "by_kind": [[k, n] for k, n in shapes.most_common()],
        "by_family": [[k, n] for k, n in by_family.most_common(8)],
        "items": items}
    return rule


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--facts", action="append", required=True, help="VARIANT=PATH or VARIANT=GLOB (repeat)")
    ap.add_argument("--naming", default="generic", help="naming profile: generic, dnum, or a JSON file")
    ap.add_argument("--factor", type=float, default=FACTOR, help="flag beyond this multiple of the tolerance")
    ap.add_argument("--no-noise-floor", action="store_true",
                    help="judge against the tolerance alone, without each table group's noise floor")
    ap.add_argument("--max-items", type=int, default=MAX_ITEMS)
    ap.add_argument("--library", help="the library name for the page header")
    ap.add_argument("--out", default="-")
    args = ap.parse_args(argv)
    start = time.time()
    try:
        rule = run(F.parse_inputs(args.facts), args.naming, args.factor, min(args.max_items, 400), args.library,
                   not args.no_noise_floor)
    except F.RuleError as exc:
        sys.stderr.write("%s: %s\n" % (RULE_ID, exc))
        return 2
    F.write_rule(rule, args.out)
    sys.stderr.write("%s: %s in %.1f s\n" % (RULE_ID, rule["result"], time.time() - start))
    return 0


if __name__ == "__main__":
    sys.exit(main())
