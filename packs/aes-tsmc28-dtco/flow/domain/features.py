#!/usr/bin/env python3
"""Feature extractor: a SPICE deck -> one row per (cell, input_pin, output_pin) timing arc.

This is the X side of a LEARNED NLDM model. The Y side is the site-bound reference Liberty
(cell_rise/cell_fall/rise_transition/fall_transition on its own delay templates). The point of
learning instead of hand-rolling an RC formula is that topology -> delay gets fitted from real
characterised cells rather than guessed, so the features here must be things that

  (a) are computable from a NEW cell's SPICE netlist alone, with no Liberty, and
  (b) are the actual physical drivers of NLDM delay.

Deliberately NOT features: the master name, its drive-strength code, its function-family prefix.
Those exist only for masters that are already in the reference library, they encode that library's
naming convention rather than any physics, and this package does not carry naming conventions. A
newly synthesised cell has a netlist and nothing else, so the model has to be learnable from
geometry + topology alone. Drive strength is already carried, physically, by wn_out_sum/wp_out_sum.

Topology walk imported from the site-bound helper mock_char -- parse_netlist, gate_width,
gating_nets, arc_path, stack_depth. Two of those walkers are provably wrong on library-scale
topologies (see
_stack_depth and _min_stack_gates below); corrected variants live here, the originals are still run
side by side and the disagreement is counted into the summary.

Usage:
  features.py [--spice <deck>] [-o features.csv] [--summary features_summary.txt]
"""

import argparse
import csv
import os
import re
import sys
import tempfile
from collections import Counter, defaultdict, deque

import sys
# Site-bound helper modules (estimate_lib / mock_char / charmodel). The authoritative copy
# is unresolved -- see authoring/flow-map.json OQ-2 -- so this package refuses to choose one
# and binds the directory through the typed input XS28_CHARMODEL_HELPER_DIR instead of
# carrying a site path.
import os as _os
for _p in _os.environ.get("XS28_CHARMODEL_HELPER_DIR", "").split(":"):
    if _p:
        sys.path.insert(0, _p)
import mock_char as MC  # noqa: E402  parse_netlist, stack_depth, gate_width, gating_nets, arc_path

# NDA: the reference SPICE deck is never carried by this package and its site path is
# never written here. It is bound per run through the typed input FOUNDRY_CDL.
DECK = os.environ.get("FOUNDRY_CDL", "")

COLUMNS = [
    # identity / join keys against the Liberty arc (cell, related_pin, output pin)
    "cell", "in_pin", "out_pin",
    # --- the spec'd features ---------------------------------------------
    "series_n", "series_p",          # series depth output -> rail through this arc's driver
    "wn_min", "wp_min",              # narrowest device this INPUT gates, per network
    "wn_sum", "wp_sum",              # total width this INPUT gates, per network
    "gate_width_in",                 # total gate width this INPUT drives -> its input capacitance
    "n_dev_total", "n_dev_out",      # devices in the cell / touching the output net
    "fanout_internal",               # arc_path length: internal nodes the arc traverses
    "out_load_devices",              # gate width the OUTPUT drives INSIDE the cell
    "is_multistage",                 # arc_path length > 1
    # --- added, with justification ---------------------------------------
    "wn_out_sum", "wp_out_sum",
    #   Width of the devices actually ON the output net. For a multistage arc wn_sum/wp_sum describe
    #   the FIRST stage, so nothing in the spec'd set carries the output stage's drive strength --
    #   which is the single largest term in the delay. This is also how D0..D16 enters the model
    #   without ever reading the cell name.
    "n_in_pins", "n_out_pins",
    #   Cell fan-in, and whether the cell is multi-output. A second output loads shared internal
    #   nodes, which shifts every arc in the cell.
    "is_pass_gate", "pass_w_n", "pass_w_p",
    #   Transmission-gate data arcs (MUX / XOR / tristate). Such a pin gates nothing, so
    #   gate_width_in == 0 and its load is pass-device junction, not gate, capacitance. Without the
    #   flag the model sees a zero-capacitance input and learns nonsense from it.
    "arc_chain",                     # ';'-joined internal node chain, for debugging the Liberty join
]


# ------------------------------------------------------------------ deck split -----
def split_deck(path):
    """Yield (cell_name, subckt_text).

    parse_netlist() is a single-cell parser: it keeps the LAST .subckt name it sees and accumulates
    every device in the file into one list. A production SPICE deck is a whole library in one file,
    so it has to be cut into per-cell blocks before being handed over."""
    name, buf = None, []
    for line in open(path):
        s = line.strip()
        if s.lower().startswith(".subckt"):
            name, buf = s.split()[1], [line]
        elif s.lower().startswith(".ends"):
            if name:
                buf.append(line)
                yield name, "".join(buf)
            name, buf = None, []
        elif name is not None:
            buf.append(line)


# ------------------------------------------------------------------ corrected walks -----
def _adj(devs, kind):
    """Undirected channel graph of one network: node -> [(other_node, device)]."""
    g = defaultdict(list)
    for d in devs:
        if d.kind != kind:
            continue
        g[d.d].append((d.s, d))
        g[d.s].append((d.d, d))
    return g


def _stack_depth(devs, kind, out_net, rail, pin, adj=None):
    """Series depth of the SHORTEST conducting path out_net -> rail that is gated by `pin`.

    Same contract as MC.stack_depth, but BFS instead of DFS. MC.stack_depth memoises on
    (node, used) while exploring depth-first, so whichever depth a node happens to be reached at
    first wins and a genuinely shorter route to it is then pruned. On a bool2cmos-sized gate that is
    invisible; on a library-scale AOI21 topology it reports a PMOS series depth twice the real one,
    because the DFS wandered OUT -> mid -> OUT -> mid -> supply before it tried the direct route.
    BFS visits in nondecreasing depth, which makes the (node, used) memo sound."""
    adj = adj if adj is not None else _adj(devs, kind)
    seen = {(out_net, False)}
    q = deque([(out_net, 0, False)])
    while q:
        node, depth, used = q.popleft()
        if depth > 8:
            continue
        for nxt, d in adj.get(node, ()):
            u = used or (d.g == pin)
            if nxt == rail:
                if u:
                    return depth + 1
                continue
            if (nxt, u) in seen:
                continue
            seen.add((nxt, u))
            q.append((nxt, depth + 1, u))
    return None


def _min_stack_gates(devs, net, rails, adjs):
    """Gates lying on the MINIMUM-depth conducting paths net -> rail, over both networks.

    This is the "what actually drives this node" relation, and MC.gating_nets is not it.
    MC.gating_nets floods the whole channel component and records a gate for every edge it touches,
    whether or not that branch ever reaches a rail. In a pass-transistor cell that flood walks
    sideways through a transmission gate into the neighbouring stage: on a foundry XOR2 it reports
    that the node !B is gated by !B, purely via a 3-deep sneak path through the XOR stack, when !B
    is in fact driven by its own inverter one device away from the rail. Restricting to
    minimum-depth rail paths is the physical definition of the driving stack and removes the sneak
    paths, which is what makes latch detection trustworthy."""
    out = set()
    for kind, rail in (("n", rails[0]), ("p", rails[1])):
        adj = adjs[kind]
        if net not in adj:
            continue
        df = _bfs_dist(adj, net)
        dr = _bfs_dist(adj, rail)
        dmin = df.get(rail)
        if dmin is None:
            continue
        for u, edges in adj.items():
            if u not in df:
                continue
            for v, d in edges:
                if df[u] + 1 + dr.get(v, 10 ** 6) == dmin:
                    out.add(d.g)
    return out


def _bfs_dist(adj, src):
    dist = {src: 0}
    q = deque([src])
    while q:
        u = q.popleft()
        for v, _ in adj.get(u, ()):
            if v not in dist:
                dist[v] = dist[u] + 1
                q.append(v)
    return dist


def _fanin_cone(devs, out_pins, in_pins, rail_pair, rail_set, adjs):
    """Nets that transitively gate an output's driving stack, i.e. the nets that can actually affect
    a timing arc.

    Restricting state detection to this cone matters: a characterised library's clock-delay cells
    carry a cross-coupled dummy pair that is wired only to the rails and touches neither the input
    nor the output. Scanning every net in the cell finds that loop and throws away a perfectly
    combinational inverter chain. Only feedback INSIDE the signal cone is state."""
    cone, frontier = set(out_pins), list(out_pins)
    while frontier:
        n = frontier.pop()
        for g in _min_stack_gates(devs, n, rail_pair, adjs):
            if g in rail_set or g in in_pins or g in cone:
                continue
            cone.add(g)
            frontier.append(g)
    return sorted(cone)


def _has_state(devs, nets, rails, adjs):
    """True if the min-stack gate dependency graph has a cycle.

    A cycle means a node gates a stack that (transitively) gates it back -- a keeper or a
    cross-coupled pair, i.e. state. That disqualifies the cell from this model: its Liberty arcs are
    clock->Q plus setup/hold constraints, not a combinational input->output delay, so its rows would
    be labelled with the wrong Y."""
    nets = set(nets)
    dep = {n: set(g for g in _min_stack_gates(devs, n, rails, adjs) if g in nets) for n in nets}
    WHITE, GREY, BLACK = 0, 1, 2
    color = dict.fromkeys(nets, WHITE)
    for root in nets:
        if color[root] != WHITE:
            continue
        stack = [(root, iter(dep[root]))]
        color[root] = GREY
        while stack:
            u, it = stack[-1]
            adv = False
            for v in it:
                if color.get(v) == GREY:
                    return True
                if color.get(v) == WHITE:
                    color[v] = GREY
                    stack.append((v, iter(dep[v])))
                    adv = True
                    break
            if not adv:
                color[u] = BLACK
                stack.pop()
    return False


def _gate_chain(devs, out_net, pin, in_pins, rail_pair, rail_set, adjs, limit=32):
    """Stage chain pin -> ... -> out_net, same return shape as MC.arc_path, with no depth cap.

    MC.arc_path stops recursing at 6 stages. Programmable delay cells are inverter chains deeper
    than that, so their single arc is invisible to it. Backward BFS over the minimum-depth driving
    stacks has no such cap and finds the shortest stage chain."""
    parent, q = {out_net: None}, deque([out_net])
    while q:
        node = q.popleft()
        if len(parent) > limit * 8:
            break
        for g in _min_stack_gates(devs, node, rail_pair, adjs):
            if g in rail_set:
                continue
            if g == pin:
                # parent[] points toward out_net, so walking it yields [stage..., out_net],
                # which is exactly MC.arc_path's order.
                chain, cur = [], node
                while cur is not None:
                    chain.append(cur)
                    cur = parent[cur]
                return chain
            if g in parent or g in in_pins:
                continue
            parent[g] = node
            q.append(g)
    return None


def _pass_path(devs, out_net, pin, rails, limit=6):
    """Shortest source/drain path out_net -> pin that never touches a rail.

    arc_path() only finds arcs where the input GATES the output's network. A transmission gate
    passes its data input through the channel, so that pin gates nothing and arc_path returns None --
    every MUX/XOR/tristate data arc would silently vanish from the training set. Returns
    ([devices on the path], hops) or None."""
    seen = {out_net}
    q = deque([(out_net, [])])
    while q:
        node, path = q.popleft()
        if len(path) >= limit:
            continue
        for d in devs:
            for a, b in ((d.d, d.s), (d.s, d.d)):
                if a != node or b in rails or b in seen:
                    continue
                if b == pin:
                    return path + [d], len(path) + 1
                seen.add(b)
                q.append((b, path + [d]))
    return None


# ------------------------------------------------------------------ per cell -----
def cell_rows(name, devs, ports, stats):
    """-> (rows, skip_reason). skip_reason is None when the cell produced usable rows."""
    if not devs:
        return [], "no_devices"

    nb = set(d.b for d in devs if d.kind == "n")
    pb = set(d.b for d in devs if d.kind == "p")
    if not nb or not pb:
        return [], "single_polarity"           # tie / antenna / bulk-only cells
    if len(nb) > 1 or len(pb) > 1:
        return [], "multi_rail"                # level shifters: two supplies, one stack walk is wrong

    n_rail = MC._majority(d.b for d in devs if d.kind == "n")
    p_rail = MC._majority(d.b for d in devs if d.kind == "p")
    rails = {n_rail, p_rail}
    adjs = {"n": _adj(devs, "n"), "p": _adj(devs, "p")}

    driven_p = set(d.d for d in devs if d.kind == "p") | set(d.s for d in devs if d.kind == "p")
    driven_n = set(d.d for d in devs if d.kind == "n") | set(d.s for d in devs if d.kind == "n")
    out_pins = [p for p in ports if p not in rails and p in driven_p and p in driven_n]
    in_pins = [p for p in ports if p not in rails and p not in out_pins]
    if not out_pins:
        return [], "no_cmos_output"
    if not in_pins:
        return [], "no_input_pins"

    cone = _fanin_cone(devs, out_pins, set(in_pins), (n_rail, p_rail), rails, adjs)
    if _has_state(devs, cone, (n_rail, p_rail), adjs):
        return [], "sequential_feedback"

    n_dev_total = len(devs)
    rows = []
    for out in out_pins:
        on_out = [d for d in devs if d.d == out or d.s == out]
        base = {
            "cell": name,
            "out_pin": out,
            "n_dev_total": n_dev_total,
            "n_dev_out": len(on_out),
            "out_load_devices": round(sum(d.w for d in devs if d.g == out), 6),
            "wn_out_sum": round(sum(d.w for d in on_out if d.kind == "n"), 6),
            "wp_out_sum": round(sum(d.w for d in on_out if d.kind == "p"), 6),
            "n_in_pins": len(in_pins),
            "n_out_pins": len(out_pins),
        }
        for pin in in_pins:
            wn = [d.w for d in devs if d.kind == "n" and d.g == pin]
            wp = [d.w for d in devs if d.kind == "p" and d.g == pin]
            chain = MC.arc_path(devs, out, pin, set(in_pins), n_rail, p_rail)
            if not chain:
                chain = _gate_chain(devs, out, pin, set(in_pins), (n_rail, p_rail), rails, adjs)
                if chain:
                    stats["deep_chain_fallback"] += 1
            if chain:
                drv = chain[-2] if len(chain) > 1 else pin
                sn = _stack_depth(devs, "n", out, n_rail, drv, adjs["n"])
                sp = _stack_depth(devs, "p", out, p_rail, drv, adjs["p"])
                # A tristate output stage has its pull-up and its pull-down gated by DIFFERENT
                # internal nodes (data on one, enable-complement on the other), so the arc's single
                # immediate driver only binds one of the two networks and the other comes back None.
                # Recording that as 0 would say "no stack at all", and it lands inconsistently
                # across drive strengths (sn=0/sp=1 on one BUFT, sn=1/sp=0 on the next) -- pure
                # noise to fit against. The physical quantity the feature wants is the output
                # stage's series depth, so measure it without the gating requirement.
                if sn is None:
                    sn = _bfs_dist(adjs["n"], out).get(n_rail)
                    stats["series_n_ungated_fallback"] += 1
                if sp is None:
                    sp = _bfs_dist(adjs["p"], out).get(p_rail)
                    stats["series_p_ungated_fallback"] += 1
                if sn != MC.stack_depth(devs, "n", out, n_rail, drv):
                    stats["stack_depth_fix_n"] += 1
                if sp != MC.stack_depth(devs, "p", out, p_rail, drv):
                    stats["stack_depth_fix_p"] += 1
                pw_n = pw_p = 0.0
                is_pass = 0
                stages, chain_s = len(chain), ";".join(chain)
            else:
                pp = _pass_path(devs, out, pin, rails)
                if not pp:
                    stats["no_path"] += 1
                    continue                    # pin genuinely cannot reach this output
                pdevs, hops = pp
                sn = sum(1 for d in pdevs if d.kind == "n")
                sp = sum(1 for d in pdevs if d.kind == "p")
                pw_n = round(sum(d.w for d in pdevs if d.kind == "n"), 6)
                pw_p = round(sum(d.w for d in pdevs if d.kind == "p"), 6)
                is_pass = 1
                stages, chain_s = hops, "pass:%d" % hops
            r = dict(base)
            r.update({
                "in_pin": pin,
                "series_n": sn or 0,
                "series_p": sp or 0,
                "wn_min": round(min(wn), 6) if wn else 0.0,
                "wp_min": round(min(wp), 6) if wp else 0.0,
                "wn_sum": round(sum(wn), 6),
                "wp_sum": round(sum(wp), 6),
                "gate_width_in": round(MC.gate_width(devs, pin), 6),
                "fanout_internal": stages,
                "is_multistage": 1 if stages > 1 else 0,
                "is_pass_gate": is_pass,
                "pass_w_n": pw_n,
                "pass_w_p": pw_p,
                "arc_chain": chain_s,
            })
            rows.append(r)
    if not rows:
        return [], "no_arcs_found"
    return rows, None


# ------------------------------------------------------------------ main -----
def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument("--spice", default=DECK)
    ap.add_argument("-o", "--out", default=os.path.join(here, "features.csv"))
    ap.add_argument("--summary", default=os.path.join(here, "features_summary.txt"))
    a = ap.parse_args()

    tmpdir = tempfile.mkdtemp(prefix="featx_")
    tmp = os.path.join(tmpdir, "cell.sp")
    rows, skipped, ok_cells = [], defaultdict(list), []
    stats = Counter()
    n_subckt = 0
    for name, text in split_deck(a.spice):
        n_subckt += 1
        open(tmp, "w").write(text)
        cname, ports, devs = MC.parse_netlist(tmp)     # proven parser, used unmodified
        if cname != name:
            skipped["parse_name_mismatch"].append(name)
            continue
        try:
            r, why = cell_rows(name, devs, ports, stats)
        except Exception as e:                          # one pathological cell must not kill the run
            skipped["error:%s" % type(e).__name__].append(name)
            continue
        if why:
            skipped[why].append(name)
        else:
            rows.extend(r)
            ok_cells.append(name)
    os.remove(tmp)
    os.rmdir(tmpdir)

    with open(a.out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS)
        w.writeheader()
        for r in rows:
            w.writerow(r)

    def fam(n):
        return re.sub(r"(BWP\d+P\d+.*|D\d+$|\d+$)", "", n) or n

    lines = ["subckts read       : %d" % n_subckt,
             "cells with rows    : %d" % len(ok_cells),
             "arc rows written   : %d" % len(rows),
             "  pass-gate arcs   : %d" % sum(r["is_pass_gate"] for r in rows),
             "  multistage arcs  : %d" % sum(r["is_multistage"] for r in rows),
             "  deep-chain fallback (>6 stages, past MC.arc_path's cap) : %d"
             % stats["deep_chain_fallback"],
             "arcs dropped (pin cannot reach output) : %d" % stats["no_path"],
             "MC.stack_depth disagreements  n=%d p=%d (BFS shortest-path fix)"
             % (stats["stack_depth_fix_n"], stats["stack_depth_fix_p"]),
             "ungated output-stage depth fallback (tristate) n=%d p=%d"
             % (stats["series_n_ungated_fallback"], stats["series_p_ungated_fallback"]),
             "", "SKIPPED CELLS:"]
    for why in sorted(skipped, key=lambda k: -len(skipped[k])):
        c = Counter(fam(n) for n in skipped[why])
        lines.append("  %-20s %4d   families: %s"
                     % (why, len(skipped[why]),
                        ", ".join("%s(%d)" % kv for kv in c.most_common(10))))
    txt = "\n".join(lines)
    open(a.summary, "w").write(txt + "\n")
    print(txt)


if __name__ == "__main__":
    main()
