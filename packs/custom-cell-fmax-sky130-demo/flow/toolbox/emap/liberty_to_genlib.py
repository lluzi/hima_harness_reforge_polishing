#!/usr/bin/env python3
"""Liberty -> genlib for mockturtle emap (python3, stdlib only).

  liberty_to_genlib.py --lib BASE.lib [--lib CUSTOM.lib ...] --out OUT.genlib
                       [--exclude PATTERN ...] [--exclude-file FILE]
                       [--slew-ns 0.1] [--load-pf 0.005] [--report OUT.json]

Writes one GATE line per (cell, output pin) with the real Liberty cell and pin names, so the mapped
Verilog instantiates real cells. A multi-output cell (e.g. sky130_fd_sc_hd__fa_1 with COUT and SUM)
becomes consecutive GATE lines with the same cell name, one per output, and an identical PIN order;
emap_window --multioutput then maps it as one two-output cell.

Area: the Liberty `area` (um^2). The cell area is repeated on every output line of a multi-output
cell (mockturtle's tech_library splits it over the outputs).

Delay: each PIN line carries a single load-independent block delay per input->output arc: the
cell_rise / cell_fall table value bilinearly interpolated at input transition --slew-ns (default
0.1 ns) and output load --load-pf (default 0.005 pF, about the input capacitance of two to three x1
gates). rise_block = cell_rise, fall_block = cell_fall (max over the arcs from that pin, ns). The
fanout-delay fields carry d(delay)/d(load) in ns/pF at that point for information only; emap uses
the block delays. Pins with no arc to an output get the cell's worst arc delay. This is a coarse
mapping-time model: ORFS still sizes, buffers and times the stitched netlist with the real Liberty.

Skipped (reported in --report): cells matching --exclude / --exclude-file patterns (fnmatch on the
cell name), `dont_use : true`, sequential cells (ff/latch/statetable groups), tristate outputs
(three_state), cells with no logic output or more than 6 inputs or more than 2 outputs, constant
(tie) cells, and the name families lpflow, probe, fill, tap, decap, diode, conb, macro, clk*
(clock buffers/inverters/gates), dly* (delay cells).

The control genlib of an emap round is the same command with --exclude <each custom cell name>.
"""
import argparse
import fnmatch
import itertools
import json
import re
import sys

SKIP_FAMILY = re.compile(r"(^|__)(lpflow_|probe|fill|tap|decap|diode|conb_|macro_|clk|dly)")


# ------------------------------------------------------------------ Liberty parsing

TOKEN = re.compile(r'"(?:[^"\\]|\\.)*"|[A-Za-z0-9_.+\-!&|^*\'\[\]:<>$/]+|[{}();,]')


class Group:
    __slots__ = ("kind", "args", "attrs", "children")

    def __init__(self, kind, args):
        self.kind, self.args, self.attrs, self.children = kind, args, {}, []

    def find(self, kind):
        return [c for c in self.children if c.kind == kind]


def _strip(tok):
    return tok[1:-1] if tok.startswith('"') else tok


def parse_liberty(text):
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    text = re.sub(r"\\\r?\n", " ", text)
    toks = TOKEN.findall(text)
    root = Group("root", [])
    stack = [root]
    i, n = 0, len(toks)
    while i < n:
        t = toks[i]
        if t == "}":
            stack.pop()
            i += 1
            continue
        if t == ";":
            i += 1
            continue
        if i + 1 < n and toks[i + 1] == ":":
            # simple attribute: name : value ;  (value may be several tokens until ';')
            j = i + 2
            vals = []
            while j < n and toks[j] not in (";", "}"):
                vals.append(_strip(toks[j]))
                j += 1
            name = t
            if name.endswith(":"):
                name = name[:-1]
            stack[-1].attrs[name] = " ".join(vals)
            i = j + 1 if j < n and toks[j] == ";" else j
            continue
        if i + 1 < n and toks[i + 1] == "(":
            j = i + 2
            args = []
            while j < n and toks[j] != ")":
                if toks[j] != ",":
                    args.append(_strip(toks[j]))
                j += 1
            j += 1  # ')'
            if j < n and toks[j] == "{":
                g = Group(t, args)
                stack[-1].children.append(g)
                stack.append(g)
                j += 1
            else:
                # complex attribute: name (args) ;
                stack[-1].attrs.setdefault(t, args)
                if j < n and toks[j] == ";":
                    j += 1
            i = j
            continue
        # tokens like "name:value" without spaces
        if ":" in t and not t.startswith('"'):
            name, _, value = t.partition(":")
            stack[-1].attrs[name] = value
        i += 1
    return root


# ------------------------------------------------------------------ boolean functions

def _tokenize_fn(s):
    return re.findall(r"[A-Za-z_][A-Za-z0-9_\[\]]*|[01]|[!'&*|+^()]", s)


def parse_function(s):
    """Liberty function -> AST. Precedence: ' and ! > ^ > & * (space) > | +."""
    toks = _tokenize_fn(s)
    pos = [0]

    def peek():
        return toks[pos[0]] if pos[0] < len(toks) else None

    def take():
        t = toks[pos[0]]
        pos[0] += 1
        return t

    def primary():
        t = take()
        if t == "!":
            return ("not", primary())
        if t == "(":
            e = orexpr()
            if take() != ")":
                raise ValueError("missing ) in %r" % s)
            node = e
        elif t in ("0", "1"):
            node = ("const", int(t))
        elif re.match(r"[A-Za-z_]", t):
            node = ("var", t)
        else:
            raise ValueError("bad token %r in %r" % (t, s))
        while peek() == "'":
            take()
            node = ("not", node)
        return node

    def xorexpr():
        node = primary()
        while peek() == "^":
            take()
            node = ("xor", node, primary())
        return node

    def andexpr():
        node = xorexpr()
        while True:
            t = peek()
            if t in ("&", "*"):
                take()
                node = ("and", node, xorexpr())
            elif t is not None and (t in ("!", "(", "0", "1") or re.match(r"[A-Za-z_]", t)):
                node = ("and", node, xorexpr())  # implicit AND (space)
            else:
                return node

    def orexpr():
        node = andexpr()
        while peek() in ("|", "+"):
            take()
            node = ("or", node, andexpr())
        return node

    tree = orexpr()
    if peek() is not None:
        raise ValueError("trailing tokens in %r" % s)
    return tree


def fn_vars(node, out):
    if node[0] == "var":
        if node[1] not in out:
            out.append(node[1])
    elif node[0] != "const":
        for child in node[1:]:
            fn_vars(child, out)
    return out


def evaluate(node, env):
    kind = node[0]
    if kind == "var":
        return env[node[1]]
    if kind == "const":
        return node[1]
    if kind == "not":
        return 1 - evaluate(node[1], env)
    a, b = evaluate(node[1], env), evaluate(node[2], env)
    return {"and": a & b, "or": a | b, "xor": a ^ b}[kind]


def to_genlib(node):
    kind = node[0]
    if kind == "var":
        return node[1]
    if kind == "const":
        return "CONST%d" % node[1]
    if kind == "not":
        return "!" + to_genlib(node[1]) if node[1][0] == "var" else "!(" + to_genlib(node[1]) + ")"
    op = {"and": "*", "or": "+", "xor": "^"}[kind]
    return "(" + to_genlib(node[1]) + op + to_genlib(node[2]) + ")"


def phase(node, pins, pin):
    pos = neg = False
    others = [p for p in pins if p != pin]
    for bits in itertools.product((0, 1), repeat=len(others)):
        env = dict(zip(others, bits))
        env[pin] = 0
        lo = evaluate(node, env)
        env[pin] = 1
        hi = evaluate(node, env)
        if hi > lo:
            pos = True
        elif lo > hi:
            neg = True
    if pos and not neg:
        return "NONINV"
    if neg and not pos:
        return "INV"
    return "UNKNOWN"


# ------------------------------------------------------------------ timing tables

def _floats(value):
    if isinstance(value, list):
        value = ",".join(value)
    return [float(x) for x in re.split(r"[,\s]+", value.strip()) if x]


def _interp1(xs, x):
    if len(xs) == 1:
        return 0, 0, 0.0
    if x <= xs[0]:
        k = 0
    elif x >= xs[-1]:
        k = len(xs) - 2
    else:
        k = max(i for i in range(len(xs) - 1) if xs[i] <= x)
    t = (x - xs[k]) / (xs[k + 1] - xs[k])
    return k, k + 1, t


def table_value(table, templates, slew, load):
    """Bilinear value (clamped extrapolation) and d/dload of a cell_rise/cell_fall table."""
    tmpl = templates.get(table.args[0] if table.args else "", {})
    var1 = tmpl.get("variable_1", "input_net_transition")
    idx1 = _floats(table.attrs.get("index_1", tmpl.get("index_1", "0")))
    idx2 = _floats(table.attrs.get("index_2", tmpl.get("index_2", "0")))
    values = _floats(table.attrs.get("values", "0"))
    if "capacitance" in var1:  # tables indexed load-first
        x1, x2 = load, slew
    else:
        x1, x2 = slew, load
    cols = len(idx2)
    grid = [values[r * cols:(r + 1) * cols] for r in range(len(idx1))] if cols > 1 else [[v] for v in values]

    def at(a, b):
        i0, i1, ti = _interp1(idx1, a)
        j0, j1, tj = _interp1(idx2, b) if cols > 1 else (0, 0, 0.0)
        v00, v01 = grid[i0][j0], grid[i0][j1]
        v10, v11 = grid[i1][j0], grid[i1][j1]
        return (v00 * (1 - ti) * (1 - tj) + v10 * ti * (1 - tj) + v01 * (1 - ti) * tj + v11 * ti * tj)

    value = at(x1, x2)
    eps = 1e-4
    if "capacitance" in var1:
        slope = (at(load + eps, slew) - value) / eps
    else:
        slope = (at(slew, load + eps) - value) / eps if cols > 1 else 0.0
    return value, slope


# ------------------------------------------------------------------ conversion

def convert(lib_paths, excludes, slew, load):
    gates, skipped, cells_out = [], {}, []
    seen = set()
    for path in lib_paths:
        with open(path, errors="replace") as handle:
            root = parse_liberty(handle.read())
        for library in root.find("library"):
            templates = {}
            for tmpl in library.find("lu_table_template"):
                templates[tmpl.args[0] if tmpl.args else ""] = tmpl.attrs
            for cell in library.find("cell"):
                name = cell.args[0] if cell.args else ""
                reason = classify(cell, name, excludes)
                if reason is None and name in seen:
                    reason = "duplicate cell name (first library wins)"
                if reason:
                    skipped[name] = reason
                    continue
                lines, info = cell_lines(cell, name, templates, slew, load)
                if not lines:
                    skipped[name] = info
                    continue
                seen.add(name)
                gates.extend(lines)
                cells_out.append(info)
    return gates, skipped, cells_out


def classify(cell, name, excludes):
    for pattern in excludes:
        if fnmatch.fnmatchcase(name, pattern):
            return "excluded by %s" % pattern
    if cell.attrs.get("dont_use", "").lower() == "true":
        return "dont_use"
    if SKIP_FAMILY.search(name):
        return "skipped family (tie/fill/tap/decap/diode/probe/lpflow/clock/delay/macro)"
    for kind in ("ff", "latch", "ff_bank", "latch_bank", "statetable"):
        if cell.find(kind):
            return "sequential"
    return None


def cell_lines(cell, name, templates, slew, load):
    try:
        area = float(cell.attrs.get("area", "0"))
    except ValueError:
        area = 0.0
    pins = cell.find("pin")
    for bus in cell.find("bus"):
        return [], "bus pins unsupported"
    inputs = [p for p in pins if p.attrs.get("direction") == "input"]
    outputs = [p for p in pins if p.attrs.get("direction") == "output" and p.attrs.get("function")]
    if any("three_state" in p.attrs for p in outputs):
        return [], "tristate output"
    if not outputs:
        return [], "no logic output"
    if len(outputs) > 2:
        return [], "more than 2 outputs (emap multi-output limit)"
    in_names = [p.args[0] for p in inputs]
    if not in_names:
        return [], "constant (tie) cell"
    if len(in_names) > 6:
        return [], "more than 6 inputs"
    lines, arcs_info = [], {}
    for out in outputs:
        out_name = out.args[0]
        try:
            tree = parse_function(out.attrs["function"])
        except (ValueError, IndexError) as error:
            return [], "function parse error: %s" % error
        used = fn_vars(tree, [])
        if any(v not in in_names for v in used):
            return [], "function uses a non-input pin"
        if not used:
            return [], "constant output"
        arcs = {}
        for timing in out.find("timing"):
            related = timing.attrs.get("related_pin", "")
            if timing.attrs.get("timing_type", "combinational") not in ("combinational", "combinational_rise", "combinational_fall"):
                continue
            rise = fall = None
            rise_slope = fall_slope = 0.0
            for table in timing.find("cell_rise"):
                rise, rise_slope = table_value(table, templates, slew, load)
            for table in timing.find("cell_fall"):
                fall, fall_slope = table_value(table, templates, slew, load)
            for pin in related.split():
                old = arcs.get(pin, (0.0, 0.0, 0.0, 0.0))
                arcs[pin] = (max(old[0], rise or 0.0), max(old[1], rise_slope), max(old[2], fall or 0.0), max(old[3], fall_slope))
        worst = max([max(a[0], a[2]) for a in arcs.values()] or [1.0])
        pin_lines = []
        for p in inputs:
            pin = p.args[0]
            cap = float(p.attrs.get("capacitance", "0") or 0)
            rise, rise_slope, fall, fall_slope = arcs.get(pin, (worst, 0.0, worst, 0.0))
            ph = phase(tree, used, pin) if pin in used else "UNKNOWN"
            pin_lines.append("  PIN %s %s %.5f 999 %.5f %.5f %.5f %.5f" % (pin, ph, cap, rise, rise_slope, fall, fall_slope))
        lines.append("GATE %s %.4f %s=%s;\n%s" % (name, area, out_name, to_genlib(tree), "\n".join(pin_lines)))
        arcs_info[out_name] = {pin: round(max(v[0], v[2]), 5) for pin, v in arcs.items()}
    return lines, {"name": name, "area": area, "inputs": in_names, "outputs": [o.args[0] for o in outputs], "delayNs": arcs_info}


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lib", action="append", required=True, help="Liberty file (repeat: base first, then custom)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--exclude", action="append", default=[], help="fnmatch pattern on cell names (repeatable)")
    ap.add_argument("--exclude-file", action="append", default=[], help="file with patterns, whitespace separated")
    ap.add_argument("--slew-ns", type=float, default=0.1)
    ap.add_argument("--load-pf", type=float, default=0.005)
    ap.add_argument("--report", help="JSON report of kept and skipped cells")
    args = ap.parse_args(argv)
    excludes = list(args.exclude)
    for path in args.exclude_file:
        with open(path) as handle:
            excludes += [tok for tok in re.split(r"[\s\\]+", handle.read()) if tok and not tok.startswith("#")]
    gates, skipped, cells = convert(args.lib, excludes, args.slew_ns, args.load_pf)
    names = {c["name"] for c in cells}
    if not any(re.search(r"(^|__)inv_\d", n) or n.endswith("inv") for n in names):
        print("liberty_to_genlib: warning: no inverter kept; emap needs one", file=sys.stderr)
    header = ("# genlib for mockturtle emap, generated by liberty_to_genlib.py\n# libs: %s\n"
              "# delay = cell_rise/cell_fall at slew %.3f ns, load %.4f pF; area = Liberty area\n"
              "# excludes: %s\n" % (" ".join(args.lib), args.slew_ns, args.load_pf, " ".join(excludes) or "-"))
    with open(args.out, "w") as handle:
        handle.write(header + "\n".join(gates) + "\n")
    multi = [c["name"] for c in cells if len(c["outputs"]) > 1]
    if args.report:
        with open(args.report, "w") as handle:
            json.dump({"schema": "hima-emap-genlib-report/1", "libs": args.lib, "slewNs": args.slew_ns,
                       "loadPf": args.load_pf, "excludes": excludes, "kept": len(cells), "multiOutput": multi,
                       "cells": cells, "skipped": skipped}, handle, indent=1)
    print("liberty_to_genlib: %d cells (%d multi-output: %s), %d GATE lines, %d skipped -> %s" % (
        len(cells), len(multi), " ".join(multi[:8]) + (" ..." if len(multi) > 8 else ""), len(gates), len(skipped), args.out))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
