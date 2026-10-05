#!/usr/bin/env python3
"""Cell factory: batch Boolean cell specs -> DRC/LVS-checked, extracted SKY130 (sky130hd-style) cells.

Runs inside the IIC-OSIC-TOOLS sandbox (python3 stdlib only; calls bool2cmos, LibreCell, KLayout,
Magic and Netgen). See README.md next to this file for the spec format, commands and outputs.

    python3 factory.py run SPEC.json --out OUTDIR [--jobs N] [--only A,B] [--force]
    python3 factory.py summarize OUTDIR
    python3 factory.py check SPEC.json          # validate a spec file only (no tools)

Per cell (OUTDIR/<NAME>/): NAME.sp (sized source, sky130 devices), NAME.gds, NAME.lef (sky130hd
pins), NAME.ext.spice (Magic RC-extracted, ports VPWR/VGND/VPB/VNB), NAME.drc.xml, NAME.lvs.log,
status.json. Batch: OUTDIR/manifest.json (per-stage yield, failure classes).
"""
import argparse
import concurrent.futures
import datetime
import hashlib
import itertools
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

FACTORY_VERSION = "cellfactory/1"
HERE = os.path.dirname(os.path.abspath(__file__))

POWER_PINS = ("VGND", "VNB", "VPB", "VPWR")
RESERVED = {p.lower() for p in POWER_PINS} | {"vdd", "gnd", "vss", "vcc", "0"}
BASE_W = {"n": 0.65, "p": 1.0}          # bool2cmos sky130 profile = sky130_fd_sc_hd _1 widths
MIN_W = 0.42                            # lclayout tech minimum_gate_width_{n,p}fet
NMOS_MODEL = "sky130_fd_pr__nfet_01v8"
PMOS_MODEL = "sky130_fd_pr__pfet_01v8_hvt"
STAGES = ("netlist", "layout", "postprocess", "extract", "lvs", "drc", "lef")
NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
PIN_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,15}$")

DRC_DECKS = {
    # name: (deck path under $PDK_ROOT/$PDK, -rd switches, FEOL forced on by patching, description)
    "mr": ("libs.tech/klayout/drc/sky130A_mr.drc",
           {"feol": "true", "beol": "true", "offgrid": "true", "floating_met": "false", "seal": "false"}, False,
           "sky130A_mr.drc (PDK KLayout deck, release 2024.2.11_01.09), FEOL+BEOL+OFFGRID on, seal and "
           "floating-metal off"),
    "lydrc-feol": ("libs.tech/klayout/drc/sky130A.lydrc", {}, True,
                   "sky130A.lydrc (the deck celluzi used) with its hard-coded FEOL=false patched to true; it "
                   "codes licon.8a / licon.14 / npc rules that sky130A_mr.drc lacks and counts pin-purpose "
                   "layers (68/16) as metal"),
    "celluzi": ("libs.tech/klayout/drc/sky130A.lydrc", {}, False,
                "sky130A.lydrc exactly as celluzi ran it (FEOL off: BEOL+OFFGRID only) -- comparison only"),
}
DEFAULT_DECKS = "mr,lydrc-feol"


def merge_drc(by_deck):
    """{deck: {rule: n}} -> (count, {rule: n}) taking the max per rule across decks (two decks often
    flag the same geometry under the same rule name; summing would double count)."""
    by = {}
    for rules in by_deck.values():
        for r, n in rules.items():
            by[r] = max(by.get(r, 0), n)
    return sum(by.values()), dict(sorted(by.items(), key=lambda kv: (-kv[1], kv[0])))


class SpecError(ValueError):
    pass


# ------------------------------------------------------------------------------------------------
# Boolean expressions (same grammar and precedence as bool2cmos/expr.py: or < xor < and < not)
# ------------------------------------------------------------------------------------------------
_TOK = re.compile(r"\s*(?:(?P<id>[A-Za-z_][A-Za-z_0-9]*)|(?P<c>[01])|(?P<op>[!'^&*|+()~]))")


def parse_expr(text):
    toks, pos = [], 0
    while pos < len(text):
        if text[pos].isspace():
            pos += 1
            continue
        m = _TOK.match(text, pos)
        if not m or m.end() == pos:
            raise SpecError("cannot parse %r at offset %d" % (text, pos))
        pos = m.end()
        if m.group("id"):
            toks.append(("id", m.group("id")))
        elif m.group("c"):
            toks.append(("c", int(m.group("c"))))
        else:
            op = m.group("op")
            toks.append(("op", "!" if op == "~" else op))
    i = [0]

    def peek():
        return toks[i[0]] if i[0] < len(toks) else ("eof", None)

    def take():
        t = peek()
        i[0] += 1
        return t

    def or_e():
        n = xor_e()
        while peek() in (("op", "|"), ("op", "+")):
            take()
            n = ("or", n, xor_e())
        return n

    def xor_e():
        n = and_e()
        while peek() == ("op", "^"):
            take()
            n = ("xor", n, and_e())
        return n

    def and_e():
        n = un()
        while True:
            t = peek()
            if t in (("op", "&"), ("op", "*")):
                take()
                n = ("and", n, un())
            elif t[0] in ("id", "c") or t in (("op", "("), ("op", "!")):
                n = ("and", n, un())
            else:
                return n

    def un():
        if peek() == ("op", "!"):
            take()
            return ("not", un())
        n = prim()
        while peek() == ("op", "'"):
            take()
            n = ("not", n)
        return n

    def prim():
        t = take()
        if t[0] == "id":
            return ("var", t[1])
        if t[0] == "c":
            return ("const", t[1])
        if t == ("op", "("):
            n = or_e()
            if take() != ("op", ")"):
                raise SpecError("missing ')' in %r" % text)
            return n
        raise SpecError("unexpected token %r in %r" % (t[1], text))

    if not toks:
        raise SpecError("empty expression")
    node = or_e()
    if peek()[0] != "eof":
        raise SpecError("trailing input in %r" % text)
    return node


def expr_vars(node, acc=None):
    acc = [] if acc is None else acc
    if node[0] == "var":
        if node[1] not in acc:
            acc.append(node[1])
    elif node[0] != "const":
        for ch in node[1:]:
            expr_vars(ch, acc)
    return acc


def eval_expr(node, env):
    k = node[0]
    if k == "var":
        return env[node[1]]
    if k == "const":
        return node[1]
    if k == "not":
        return 1 - eval_expr(node[1], env)
    a, b = eval_expr(node[1], env), eval_expr(node[2], env)
    return {"and": a & b, "or": a | b, "xor": a ^ b}[k]


def truth_table(node, inputs):
    """Row r assigns inputs[j] = bit (n-1-j) of r (first input is the MSB)."""
    n = len(inputs)
    return [eval_expr(node, {inputs[j]: (r >> (n - 1 - j)) & 1 for j in range(n)}) for r in range(1 << n)]


def symmetric_groups(functions, inputs):
    """Classes of inputs that are pairwise swap-symmetric in EVERY output (safe for netgen permute)."""
    trees = [parse_expr(f) for f in functions]
    n = len(inputs)

    def invariant(a, b):
        for r in range(1 << n):
            env = {inputs[j]: (r >> (n - 1 - j)) & 1 for j in range(n)}
            sw = dict(env)
            sw[a], sw[b] = env[b], env[a]
            if any(eval_expr(t, env) != eval_expr(t, sw) for t in trees):
                return False
        return True

    groups, seen = [], set()
    for a in inputs:
        if a in seen:
            continue
        g = [a] + [b for b in inputs if b != a and b not in seen and invariant(a, b)]
        seen.update(g)
        if len(g) > 1:
            groups.append(g)
    return groups


# ------------------------------------------------------------------------------------------------
# Spec parsing
# ------------------------------------------------------------------------------------------------
_VARIANT_SHORT = re.compile(r"(PU|PD|ND)(\d+(?:\.\d+)?)")


def _norm_factor_map(v, where):
    if v is None:
        return {}
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        v = {"all": v}
    if not isinstance(v, dict):
        raise SpecError("%s must be a number or an object {key: factor}" % where)
    out = {}
    for k, f in v.items():
        if isinstance(f, bool) or not isinstance(f, (int, float)) or not (0.5 <= f <= 8):
            raise SpecError("%s[%s] must be a number in [0.5, 8], got %r" % (where, k, f))
        out[str(k)] = float(f)
    return out


def parse_variant(v):
    """-> {"pullup": {key: f}, "pulldown": {key: f}}. Accepts "PU2", "ND2", "PU2ND2", {"pullup":...}."""
    if v in (None, "", {}):
        return {"pullup": {}, "pulldown": {}}
    if isinstance(v, str):
        s = v.strip().upper()
        pos, pu, pd = 0, {}, {}
        for m in _VARIANT_SHORT.finditer(s):
            if m.start() != pos:
                break
            pos = m.end()
            (pu if m.group(1) == "PU" else pd)["all"] = float(m.group(2))
        if pos != len(s) or not s:
            raise SpecError("variant string %r: use PU<k>, PD<k>/ND<k> or both, e.g. 'PU2ND2'" % v)
        return {"pullup": _norm_factor_map(pu, "variant.pullup"),
                "pulldown": _norm_factor_map(pd, "variant.pulldown")}
    if not isinstance(v, dict):
        raise SpecError("variant must be a string or an object")
    extra = set(v) - {"pullup", "pulldown"}
    if extra:
        raise SpecError("variant has unknown keys %s (use pullup / pulldown)" % sorted(extra))
    return {"pullup": _norm_factor_map(v.get("pullup"), "variant.pullup"),
            "pulldown": _norm_factor_map(v.get("pulldown"), "variant.pulldown")}


def parse_cell(raw):
    if not isinstance(raw, dict):
        raise SpecError("each cell must be an object")
    name = raw.get("name")
    if not isinstance(name, str) or not NAME_RE.match(name):
        raise SpecError("cell name %r must match %s" % (name, NAME_RE.pattern))
    outs = raw.get("outputs")
    if not isinstance(outs, dict) or not outs:
        raise SpecError("%s: outputs must be a non-empty object {pin: function}" % name)
    trees = {}
    for pin, fn in outs.items():
        if not PIN_RE.match(pin) or pin.lower() in RESERVED:
            raise SpecError("%s: bad output pin name %r" % (name, pin))
        if not isinstance(fn, str):
            raise SpecError("%s: function of %s must be a string" % (name, pin))
        try:
            trees[pin] = parse_expr(fn)
        except SpecError as e:
            raise SpecError("%s.%s: %s" % (name, pin, e))
    support = []
    for t in trees.values():
        expr_vars(t, support)
    inputs = raw.get("inputs")
    if inputs is None:
        inputs = support
    if not isinstance(inputs, list) or not all(isinstance(p, str) for p in inputs) or not inputs:
        raise SpecError("%s: inputs must be a non-empty list of pin names" % name)
    if len(set(inputs)) != len(inputs):
        raise SpecError("%s: duplicate input pins" % name)
    for p in inputs:
        if not PIN_RE.match(p) or p.lower() in RESERVED:
            raise SpecError("%s: bad input pin name %r" % (name, p))
        if p in outs:
            raise SpecError("%s: pin %s is both input and output" % (name, p))
    missing = [v for v in support if v not in inputs]
    if missing:
        raise SpecError("%s: functions use undeclared inputs %s" % (name, missing))
    unused = [p for p in inputs if p not in support]
    if unused:
        raise SpecError("%s: inputs %s do not appear in any function" % (name, unused))
    if len(inputs) > 8:
        raise SpecError("%s: at most 8 inputs" % name)
    variant = parse_variant(raw.get("variant"))
    for side in ("pullup", "pulldown"):
        for k in variant[side]:
            if k == "all" or k in inputs or (k.startswith("out:") and len(k) > 4):
                continue
            # any other key is taken as an internal gate net of the bool2cmos netlist (checked later)
    cell = {
        "name": name,
        "inputs": list(inputs),
        "outputs": dict(outs),
        "variant": variant,
        "notes": raw.get("notes", ""),
    }
    cell["truth"] = {pin: truth_table(trees[pin], cell["inputs"]) for pin in outs}
    cell["specHash"] = spec_hash(cell)
    return cell


def spec_hash(cell):
    key = {k: cell[k] for k in ("name", "inputs", "outputs", "variant")}
    key["factory"] = FACTORY_VERSION
    return hashlib.sha256(json.dumps(key, sort_keys=True).encode()).hexdigest()[:16]


def parse_spec(doc):
    if not isinstance(doc, dict) or not isinstance(doc.get("cells"), list) or not doc["cells"]:
        raise SpecError("spec must be an object with a non-empty 'cells' list")
    cells, errors, names = [], [], set()
    for i, raw in enumerate(doc["cells"]):
        try:
            c = parse_cell(raw)
            if c["name"] in names:
                raise SpecError("duplicate cell name %s" % c["name"])
            names.add(c["name"])
            cells.append(c)
        except SpecError as e:
            errors.append("cells[%d]: %s" % (i, e))
    jobs = doc.get("jobs", 8)
    if not isinstance(jobs, int) or jobs < 1:
        errors.append("jobs must be a positive integer")
    return cells, errors, jobs if isinstance(jobs, int) and jobs >= 1 else 8


# ------------------------------------------------------------------------------------------------
# SPICE: parse bool2cmos output, size it, verify at switch level, emit lclayout / LVS netlists
# ------------------------------------------------------------------------------------------------
def parse_b2c_spice(text):
    """-> {"name", "pins", "devices": [{name,d,g,s,b,model,w,l,kind}]} (sky130 X-device subckt)."""
    name, pins, devs = None, None, []
    for raw in text.splitlines():
        ln = raw.strip()
        if not ln or ln.startswith("*"):
            continue
        t = ln.split()
        lo = t[0].lower()
        if lo == ".subckt":
            name, pins = t[1], t[2:]
        elif lo == ".ends":
            break
        elif lo[0] in "xm" and name:
            params = dict(p.split("=", 1) for p in t[6:] if "=" in p)
            model = t[5]
            kind = "p" if "pfet" in model or model.lower() == "pmos" else "n"
            devs.append({"name": t[0], "d": t[1], "g": t[2], "s": t[3], "b": t[4], "model": model,
                         "w": float(params.get("w", "0").rstrip("u")),
                         "l": float(params.get("l", "0.15").rstrip("u")), "kind": kind})
    if name is None:
        raise SpecError("no .subckt in netlist")
    return {"name": name, "pins": pins, "devices": devs}


def stage_of(devices, net, rails=("VPWR", "VGND")):
    """Device indices in the channel-connected component that contains `net` (rails not crossed)."""
    seen_nets, seen_devs, todo = {net}, set(), [net]
    while todo:
        n = todo.pop()
        for i, d in enumerate(devices):
            if i in seen_devs or n not in (d["d"], d["s"]):
                continue
            seen_devs.add(i)
            for m in (d["d"], d["s"]):
                if m not in rails and m not in seen_nets:
                    seen_nets.add(m)
                    todo.append(m)
    return seen_devs


def device_factors(netlist, variant):
    """Per-device multiplier. Precedence: gate-net key > 'out:<net>' key > 'all' > 1."""
    devs = netlist["devices"]
    gates = {d["g"] for d in devs}
    nets = {d[k] for d in devs for k in ("d", "s")}
    facts = [1.0] * len(devs)
    for side, kind in (("pullup", "p"), ("pulldown", "n")):
        m = variant.get(side, {})
        for k in m:
            if k == "all" or k in gates:
                continue
            if k.startswith("out:") and k[4:] in nets:
                continue
            raise SpecError("variant.%s key %r is not 'all', a gate net %s or out:<net>"
                            % (side, k, sorted(gates)))
        by_out = {}
        for k, f in m.items():
            if k.startswith("out:"):
                for i in stage_of(devs, k[4:]):
                    by_out[i] = f
        for i, d in enumerate(devs):
            if d["kind"] != kind:
                continue
            if d["g"] in m:
                facts[i] = m[d["g"]]
            elif i in by_out:
                facts[i] = by_out[i]
            elif "all" in m:
                facts[i] = m["all"]
    return facts


def apply_sizing(netlist, variant):
    """Express each factor f as ceil(f) parallel fingers of width w*f/ceil(f) (>= MIN_W, 0.01 grid).

    Fingers (not wider devices) keep every transistor inside lclayout's fixed row height; netgen
    merges parallel fingers, so LVS compares total width."""
    facts = device_factors(netlist, variant)
    out = []
    for d, f in zip(netlist["devices"], facts):
        nf = max(1, int(math.ceil(f - 1e-9)))
        w = round(d["w"] * f / nf, 2)
        if w < MIN_W:                       # factor < 1: one narrower device, clamped at MIN_W
            nf, w = 1, round(max(MIN_W, d["w"] * f), 2)
        for k in range(nf):
            nd = dict(d)
            nd["name"] = d["name"] if nf == 1 else "%s_f%d" % (d["name"], k)
            nd["w"] = w
            nd["factor"] = f
            out.append(nd)
    return {"name": netlist["name"], "pins": list(netlist["pins"]), "devices": out}


def switch_eval(devices, inputs, outputs, vec, vdd="VPWR", gnd="VGND"):
    """Switch-level evaluation of a static CMOS netlist; returns {out: 0|1|None}."""
    val = {vdd: 1, gnd: 0}
    val.update(dict(zip(inputs, vec)))
    nets = {d[k] for d in devices for k in ("d", "s", "g")}
    for _ in range(len(nets) + 2):
        changed = False
        on = [d for d in devices if val.get(d["g"]) is not None and
              (val[d["g"]] == 1) == (d["kind"] == "n")]
        adj = {}
        for d in on:
            adj.setdefault(d["d"], set()).add(d["s"])
            adj.setdefault(d["s"], set()).add(d["d"])
        for n in nets:
            if n in (vdd, gnd) or n in inputs:
                continue
            seen, todo, hit = {n}, [n], set()
            while todo:
                x = todo.pop()
                for y in adj.get(x, ()):
                    if y in (vdd, gnd):
                        hit.add(y)
                    elif y not in seen:
                        seen.add(y)
                        todo.append(y)
            v = 1 if hit == {vdd} else 0 if hit == {gnd} else None
            if val.get(n) != v:
                val[n] = v
                changed = True
        if not changed:
            break
    return {o: val.get(o) for o in outputs}


def verify_switch_level(netlist, cell):
    inputs, outs = cell["inputs"], list(cell["outputs"])
    n = len(inputs)
    for r in range(1 << n):
        vec = [(r >> (n - 1 - j)) & 1 for j in range(n)]
        got = switch_eval(netlist["devices"], inputs, outs, vec)
        for o in outs:
            if got[o] != cell["truth"][o][r]:
                return "output %s wrong for %s: got %s want %s" % (
                    o, dict(zip(inputs, vec)), got[o], cell["truth"][o][r])
    return None


def _fmt_w(w):
    return ("%.2f" % w).rstrip("0").rstrip(".")


def emit_source(netlist, cell, header=""):
    """Sized source netlist, sky130 primitives, pins <inputs> <outputs> VGND VNB VPB VPWR."""
    pins = cell["inputs"] + list(cell["outputs"]) + list(POWER_PINS)
    lines = ["* %s -- cell factory source netlist (%s)" % (cell["name"], FACTORY_VERSION)]
    for pin, fn in cell["outputs"].items():
        lines.append("* %s = %s" % (pin, fn))
    lines.append("* variant: %s" % json.dumps(cell["variant"], sort_keys=True))
    if header:
        lines += ["* " + h for h in header.splitlines()]
    lines.append(".subckt %s %s" % (cell["name"], " ".join(pins)))
    for d in netlist["devices"]:
        lines.append("%s %s %s %s %s %s w=%s l=%s" % (
            d["name"] if d["name"][0] in "Xx" else "X" + d["name"], d["d"], d["g"], d["s"],
            "VPB" if d["kind"] == "p" else "VNB", PMOS_MODEL if d["kind"] == "p" else NMOS_MODEL,
            _fmt_w(d["w"]), _fmt_w(d["l"])))
    lines.append(".ends %s" % cell["name"])
    return "\n".join(lines) + "\n"


_RAIL_LC = {"VPWR": "vdd", "VGND": "gnd", "VPB": "vdd", "VNB": "gnd"}


def emit_lclayout(netlist, cell):
    """LibreCell input (celluzi convention): M devices, nmos/pmos, rails vdd/gnd, bulks on rails."""
    pins = cell["inputs"] + list(cell["outputs"]) + ["vdd", "gnd"]
    lines = ["* %s -- lclayout input generated by the cell factory" % cell["name"],
             ".subckt %s %s" % (cell["name"], " ".join(pins))]
    for i, d in enumerate(netlist["devices"]):
        r = lambda n: _RAIL_LC.get(n, n)
        lines.append("M%d %s %s %s %s %s w=%su l=%su" % (
            i, r(d["d"]), r(d["g"]), r(d["s"]), "vdd" if d["kind"] == "p" else "gnd",
            "pmos" if d["kind"] == "p" else "nmos", _fmt_w(d["w"]), _fmt_w(d["l"])))
    lines.append(".ends %s" % cell["name"])
    return "\n".join(lines) + "\n"


def emit_lvs_ref(netlist, cell):
    """Netgen reference (celluzi lvs_ref convention): pins <sig> vdd gnd, bulks on internal VPB/VNB
    nets (lclayout cells are tapless: Magic extracts the n-well and substrate as floating nodes)."""
    pins = cell["inputs"] + list(cell["outputs"]) + ["vdd", "gnd"]
    rail = {"VPWR": "vdd", "VGND": "gnd"}
    lines = ["* %s -- LVS reference generated by the cell factory" % cell["name"],
             ".subckt %s %s" % (cell["name"], " ".join(pins))]
    for i, d in enumerate(netlist["devices"]):
        r = lambda n: rail.get(n, n)
        lines.append("X%d %s %s %s %s %s w=%s l=%s" % (
            i, r(d["d"]), r(d["g"]), r(d["s"]), "VPB" if d["kind"] == "p" else "VNB",
            PMOS_MODEL if d["kind"] == "p" else NMOS_MODEL, _fmt_w(d["w"]), _fmt_w(d["l"])))
    lines.append(".ends %s" % cell["name"])
    return "\n".join(lines) + "\n"


# ------------------------------------------------------------------------------------------------
# Tool-output parsers (pure)
# ------------------------------------------------------------------------------------------------
def parse_drc_report(path):
    """KLayout lyrdb -> (count, {rule: n})."""
    if not os.path.isfile(path):
        return None, {}
    root = ET.parse(path).getroot()
    by = {}
    for item in root.iter("item"):
        cat = (item.findtext("category") or "?").strip().strip("'\"")
        by[cat] = by.get(cat, 0) + 1
    return sum(by.values()), dict(sorted(by.items(), key=lambda kv: -kv[1]))


def parse_lvs_verdict(text):
    """Netgen log -> "match" | "mismatch" | "pin-mismatch" | "unknown"."""
    finals = re.findall(r"Final result:\s*(.*)", text)
    final = finals[-1].strip() if finals else ""
    if re.match(r"Circuits match (uniquely|correctly)\.?\s*$", final):
        return "match"
    if "port errors" in final or "pin" in final.lower():
        return "pin-mismatch"
    if final:
        return "mismatch"
    return "unknown"


def normalize_extracted(text, cell):
    """Magic ext2spice (RC) -> characterizer netlist.

    .subckt NAME <inputs> <outputs> VGND VNB VPB VPWR. Rails VDD->VPWR, GND->VGND; the pfet bulk
    node (floating n-well, e.g. w_n15_256#) -> VPB; the nfet bulk node (VSUBS) -> VNB. '**FLOATING'
    markers are dropped. Returns (text, info) where info names the original well/substrate nodes."""
    lines = text.splitlines()
    sub_pins, nb, pb = None, set(), set()
    for ln in lines:
        t = ln.split()
        if t and t[0].lower() == ".subckt":
            sub_pins = t[2:]
        elif len(t) > 5 and t[0][:1] in "xX":
            (pb if "pfet" in t[5] else nb if "nfet" in t[5] else set()).add(t[4])
    ren = {}
    for n in list(sub_pins or []):
        if n.upper() == "VDD":
            ren[n] = "VPWR"
        elif n.upper() == "GND":
            ren[n] = "VGND"
    info = {"magicPorts": sub_pins, "nwellNodes": sorted(pb), "substrateNodes": sorted(nb)}
    for n in pb:
        if n not in ren:
            ren[n] = "VPB"
    for n in nb:
        if n not in ren:
            ren[n] = "VNB"
    want = cell["inputs"] + list(cell["outputs"])
    missing = [p for p in want if p not in (sub_pins or [])]
    info["missingPorts"] = missing
    out = []
    for ln in lines:
        t = ln.split()
        if t and t[0].lower() == ".subckt":
            out.append(".subckt %s %s" % (cell["name"], " ".join(want + list(POWER_PINS))))
            continue
        ln = ln.replace("**FLOATING", "").rstrip()
        out.append(" ".join(ren.get(tok, tok) for tok in ln.split()) if ln.strip() else ln)
    return "\n".join(out) + "\n", info


def classify_failure(stage, detail):
    """Short, stable failure class for manifest grouping."""
    d = detail or ""
    if stage == "netlist":
        return "netlist:" + ("bool2cmos" if "bool2cmos" in d else "sizing" if "variant" in d
                             else "switch-level" if "wrong" in d else "spec")
    if stage == "layout":
        if "timeout" in d:
            return "layout:timeout"
        if "LVS check failed" in d:
            return "layout:lclayout-lvs"
        if "maximum iterations" in d or "Out of placement candidates" in d:
            return "layout:routing-congestion"
        if "placement" in d.lower():
            return "layout:placement"
        if "rout" in d.lower():
            return "layout:routing"
        return "layout:error"
    if stage == "drc":
        rules = sorted(json.loads(d).keys()) if d.startswith("{") else [d]
        return "drc:" + "+".join(rules)
    return "%s:%s" % (stage, (d.split(":")[0] or "error")[:40])


def summarize(statuses):
    """Per-stage yield + state counts + failure classes for a list of status dicts."""
    total = len(statuses)
    stage_yield = {}
    for s in STAGES:
        ok = sum(1 for st in statuses if st.get("stages", {}).get(s, {}).get("ok"))
        stage_yield[s] = {"passed": ok, "of": total}
    states = {}
    for st in statuses:
        states[st.get("state", "unknown")] = states.get(st.get("state", "unknown"), 0) + 1
    classes = {}
    for st in statuses:
        for c in st.get("failureClasses", []):
            classes.setdefault(c, []).append(st["name"])
    clean = states.get("clean", 0)
    return {"cells": total, "clean": clean, "cleanYield": round(clean / total, 3) if total else 0.0,
            "states": states, "stageYield": stage_yield,
            "failureClasses": dict(sorted(classes.items(), key=lambda kv: -len(kv[1])))}


def snap_lef_width(text, dx_nm):
    """Widen SIZE and every full-width RECT (x1 <= 0, x2 == old width) by dx_nm (site snap)."""
    if not dx_nm:
        return text
    m = re.search(r"SIZE\s+([\d.]+)\s+BY\s+([\d.]+)", text)
    if not m:
        return text
    w0 = float(m.group(1))
    w1 = w0 + dx_nm / 1000.0
    text = text[:m.start()] + "SIZE %.3f BY %s" % (w1, m.group(2)) + text[m.end():]

    def fix(mm):
        x1, y1, x2, y2 = (float(v) for v in mm.groups())
        if x1 <= 1e-6 and abs(x2 - w0) < 1e-6:
            x2 = w1
        return "RECT %.3f %.3f %.3f %.3f" % (x1, y1, x2, y2)
    return re.sub(r"RECT\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)", fix, text)


LEF_LAYER = {"li1": "li1", "met1": "met1", "met2": "met2", "67/20": "li1", "68/20": "met1", "69/20": "met2"}


def lef_added_rects(pp_rep):
    """Metal the post-processor added (enclosure pads, gap fills, min-area growth) -> {lef layer: [rect]}."""
    by = {}
    for key in ("enclosure_added", "gap_filled", "min_area_added"):
        for a in pp_rep.get(key, []):
            by.setdefault(LEF_LAYER.get(a["layer"], a["layer"]), []).append([round(v, 3) for v in a["rect_um"]])
    return by


def _lef_rects(block):
    out, layer = [], None
    for ln in block.splitlines():
        m = re.search(r"\bLAYER\s+(\S+)\s*;", ln)
        if m:
            layer = m.group(1)
        m = re.search(r"\bRECT\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)", ln)
        if m and layer:
            out.append((layer, tuple(float(v) for v in m.groups())))
    return out


def _touch(a, b):
    return a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3]


def trim_lef_rects(text, strips_by_layer):
    """Shrink LEF RECTs by the via-pad overhang strips the post-processor removed: a strip that spans a
    rect's full width (or height) at one of its edges moves that edge inward."""
    if not strips_by_layer:
        return text
    out, layer = [], None
    for ln in text.splitlines(keepends=True):
        m = re.search(r"\bLAYER\s+(\S+)\s*;", ln)
        if m:
            layer = m.group(1)
        m = re.search(r"RECT\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)", ln)
        if m and layer in strips_by_layer:
            x1, y1, x2, y2 = (float(v) for v in m.groups())
            r0 = (x1, y1, x2, y2)
            e = 1e-6
            for sx1, sy1, sx2, sy2 in strips_by_layer[layer]:
                if sx1 <= x1 + e and sx2 >= x2 - e:            # spans the width
                    if sy1 <= y1 + e < sy2:
                        y1 = max(y1, sy2)
                    if sy1 < y2 - e <= sy2:
                        y2 = min(y2, sy1)
                if sy1 <= y1 + e and sy2 >= y2 - e:            # spans the height
                    if sx1 <= x1 + e < sx2:
                        x1 = max(x1, sx2)
                    if sx1 < x2 - e <= sx2:
                        x2 = min(x2, sx1)
            if (x1, y1, x2, y2) != r0 and x1 < x2 and y1 < y2:
                ln = ln[:m.start()] + "RECT %.3f %.3f %.3f %.3f" % (x1, y1, x2, y2) + ln[m.end():]
        out.append(ln)
    return "".join(out)


def augment_lef(text, by_layer):
    """Add post-process metal to the LEF: a rect touching a signal PIN's port on the same layer joins
    that pin (it is the same net); any other rect becomes an OBS rect, so the router keeps clear."""
    if not by_layer:
        return text
    pins = {m.group(1): m for m in re.finditer(r"(?ms)^[ \t]*PIN\s+(\S+)\s*\n(.*?)^[ \t]*END\s+\1\s*$", text)}
    pin_rects = {n: _lef_rects(m.group(2)) for n, m in pins.items()}
    to_pin, to_obs = {}, {}
    for layer, rects in by_layer.items():
        for r in rects:
            owner = None
            for n, prs in pin_rects.items():
                if n in POWER_PINS:
                    continue
                if any(pl == layer and _touch(r, pr) for pl, pr in prs):
                    owner = n
                    break
            (to_pin.setdefault(owner, {}) if owner else to_obs).setdefault(layer, []).append(r)

    def lines(by, indent):
        out = []
        for layer, rects in sorted(by.items()):
            out.append("%sLAYER %s ;" % (indent, layer))
            out += ["%s  RECT %.3f %.3f %.3f %.3f ;" % ((indent,) + tuple(r)) for r in rects]
        return "\n".join(out) + "\n"

    for n, by in to_pin.items():   # insert before the END of the pin's last PORT
        m = re.search(r"(?ms)^([ \t]*)PIN\s+%s\s*\n.*?^([ \t]*)END\s*$(?=.*?^[ \t]*END\s+%s\s*$)" % (
            re.escape(n), re.escape(n)), text)
        if not m:
            to_obs.update({k: to_obs.get(k, []) + v for k, v in by.items()})
            continue
        port_end = m.start(2)
        text = text[:port_end] + lines(by, "       ") + text[port_end:]
    if to_obs:
        m = re.search(r"(?ms)^[ \t]*OBS\s*\n(.*?)^[ \t]*END\s*$", text)
        if m:
            text = text[:m.end(1)] + lines(to_obs, "      ") + text[m.end(1):]
        else:
            mm = re.search(r"MACRO\s+(\S+)", text)
            end = re.search(r"(?m)^[ \t]*END\s+%s\s*$" % re.escape(mm.group(1)), text)
            text = text[:end.start()] + "  OBS\n" + lines(to_obs, "      ") + "  END\n" + text[end.start():]
    return text


# ------------------------------------------------------------------------------------------------
# Tool runner (impure)
# ------------------------------------------------------------------------------------------------
class Env:
    def __init__(self, args):
        self.celluzi = os.environ.get("CELLUZI_ROOT", "/data/eda/project/celluzi")
        self.bool2cmos = os.environ.get("BOOL2CMOS_ROOT", "/data/eda/project/bool2cmos")
        self.pdk_root = os.environ.get("PDK_ROOT", "/foss/pdks")
        self.pdk = os.environ.get("PDK", "sky130A")
        self.tech = args.tech or os.path.join(HERE, "librecell_sky130_tech.py")
        self.techs = {"strict": self.tech, "relaxed": None}    # relaxed is built in run_batch
        self.relaxed_overrides = os.path.join(HERE, "tech_relaxed_overrides.py")
        self.profiles = [x for x in args.profiles.split(",") if x]
        self.site_nm = args.site_nm
        self.attempts = max(1, args.attempts)
        self.cell_budget = args.cell_budget
        self.lc_python = os.path.join(self.celluzi, "tools/librecell_venv/bin/python3")
        self.decks = [x for x in args.drc_deck.split(",") if x]
        for x in self.decks:
            if x not in DRC_DECKS:
                raise SystemExit("unknown DRC deck %r (choose from %s)" % (x, sorted(DRC_DECKS)))
        self.deck = ",".join(self.decks)
        self.deck_dir = None
        self.timeouts = {"netlist": 120, "layout": args.layout_timeout, "postprocess": 120,
                         "extract": 300, "lvs": 300, "drc": 600, "lef": 60}
        # One rung per seed: successful cells route in <= ~25 pathfinder iterations, so a 60-iteration
        # cap over 3 placement candidates fails fast; a new seed (next attempt) is a new layout.
        self.ladder = [["--placer", "meta", "--place-max-candidates", "2", "--route-max-iter", "60"]]

    def attempt_plan(self):
        """(profile, seed) per attempt: profiles interleaved, seeds 0,1,2,..."""
        plan, seed = [], 0
        while len(plan) < self.attempts:
            for p in self.profiles:
                if len(plan) < self.attempts:
                    plan.append((p, seed))
            seed += 1
        return plan

    def deck_path(self, deck):
        rel, _sw, patch_feol, _d = DRC_DECKS[deck]
        src = os.path.join(self.pdk_root, self.pdk, rel)
        if not patch_feol:
            return src
        dst = os.path.join(self.deck_dir, deck + os.path.splitext(rel)[1])
        if not os.path.isfile(dst):
            text = open(src).read()
            new = re.sub(r"(?m)^FEOL\s*=\s*false", "FEOL    = true", text)
            if new == text:
                raise SystemExit("could not enable FEOL in %s" % src)
            tmp = dst + ".%d.tmp" % os.getpid()
            with open(tmp, "w") as fh:
                fh.write(new)
            os.replace(tmp, dst)
        return dst

    def magicrc(self):
        return os.path.join(self.pdk_root, self.pdk, "libs.tech/magic/%s.magicrc" % self.pdk)

    def netgen_setup(self):
        return os.path.join(self.pdk_root, self.pdk, "libs.tech/netgen/%s_setup.tcl" % self.pdk)


def run(cmd, cwd, log, timeout, env=None, stdin=None):
    t0 = time.time()
    e = dict(os.environ)
    e.update({"OMP_NUM_THREADS": "1", "QT_QPA_PLATFORM": "offscreen"})
    if env:
        e.update(env)
    with open(log, "a") as fh:
        fh.write("$ %s\n" % (cmd if isinstance(cmd, str) else " ".join(cmd)))
        fh.flush()
        try:
            p = subprocess.run(cmd, cwd=cwd, stdout=fh, stderr=subprocess.STDOUT, timeout=timeout,
                               env=e, input=stdin, text=True, shell=isinstance(cmd, str))
            rc = p.returncode
        except subprocess.TimeoutExpired:
            fh.write("\n[factory] timeout after %ds\n" % timeout)
            rc = "timeout"
    return rc, round(time.time() - t0, 1)


def tail(path, n=15):
    try:
        with open(path, errors="replace") as fh:
            return "".join(fh.readlines()[-n:])
    except OSError:
        return ""


DELIVER = (".gds", ".raw.gds", ".lef", ".raw.lef", ".ext.spice", ".magic.spice", ".lvs.spice",
           ".lvs.log", ".drc.xml")


def attempt_rank(stages):
    """Lower is better: (not clean, LVS failed, DRC count)."""
    lvs = stages.get("lvs", {}).get("ok", False)
    drc = stages.get("drc", {}).get("count")
    clean = all(stages.get(k, {}).get("ok", False) for k in ("layout", "postprocess", "extract", "lvs", "drc", "lef"))
    return (0 if clean else 1, 0 if lvs else 1, drc if drc is not None else 10 ** 6,
            0 if stages.get("layout", {}).get("ok") else 1)


def physical(cell, w, env, seed, profile="strict"):
    """One layout attempt in directory w (LibreCell with PYTHONHASHSEED=seed, then post-process,
    extraction, LVS, DRC, LEF). Returns (stages, extra) -- stages as in status.json."""
    name = cell["name"]
    os.makedirs(w, exist_ok=True)
    stages, extra = {}, {}
    log = lambda s: os.path.join(w, "%s.log" % s)

    def done(stage, ok, secs, detail="", **kw):
        stages[stage] = dict({"ok": ok, "seconds": secs, "detail": detail[-1500:]}, **kw)

    # ---- layout (LibreCell), placement/router ladder ------------------------------------------------
    # Routed cells converge in <= ~25 pathfinder iterations; more means the placement is congested, so
    # each rung caps the iterations and tries several placement candidates. PYSMT_CYTHON=false: pysmt
    # otherwise Cython-compiles its parser into ~/.pyxbld at import and parallel lclayout processes race
    # on that .so. PYTHONHASHSEED makes a run reproducible; a different seed gives a different layout.
    t0 = time.time()
    raw_gds = raw_lef = None
    rungs = []
    for extra_args in env.ladder:
        lcdir = os.path.join(w, "lclayout")
        shutil.rmtree(lcdir, ignore_errors=True)
        os.makedirs(lcdir)
        cmd = [env.lc_python, "-c",
               "import sys; from lclayout.standalone import main; sys.argv=['lclayout']+sys.argv[1:]; main()",
               "--cell", name, "--netlist", os.path.join(w, "..", name + ".lclayout.sp"), "--tech", env.techs[profile],
               "--output-dir", lcdir] + extra_args
        rc, secs = run(cmd, w, log("layout"), env.timeouts["layout"],
                       env={"PYSMT_CYTHON": "false", "PYTHONHASHSEED": str(seed)})
        g, l = os.path.join(lcdir, name + ".gds"), os.path.join(lcdir, name + ".lef")
        ok = os.path.isfile(g) and os.path.isfile(l)
        rungs.append({"args": " ".join(extra_args), "rc": rc, "seconds": secs, "ok": ok})
        if ok:
            raw_gds, raw_lef = g, l
            break
    if raw_gds is None:
        last = rungs[-1]["rc"] if rungs else "?"
        done("layout", False, round(time.time() - t0, 1),
             ("timeout " if last == "timeout" else "rc=%s " % last) + tail(log("layout"), 25), rungs=rungs)
        return stages, extra
    shutil.copy(raw_gds, os.path.join(w, name + ".raw.gds"))
    shutil.copy(raw_lef, os.path.join(w, name + ".raw.lef"))
    done("layout", True, round(time.time() - t0, 1), "", rungs=rungs, seed=seed, profile=profile)

    # ---- postprocess -------------------------------------------------------------------------------
    gds = os.path.join(w, name + ".gds")
    shutil.copy(raw_gds, gds)
    pp_json = os.path.join(w, "postprocess.json")
    pins = cell["inputs"] + list(cell["outputs"]) + ["VDD", "GND"]
    rc, secs = run(["klayout", "-b", "-rd", "gds=" + gds, "-rd", "report=" + pp_json,
                    "-rd", "pins=" + ",".join(pins), "-rd", "site=%d" % env.site_nm,
                    "-r", os.path.join(HERE, "postprocess_cell.py")], w, log("postprocess"),
                   env.timeouts["postprocess"])
    if rc != 0 or not os.path.isfile(pp_json):
        done("postprocess", False, secs, "klayout rc=%s: %s" % (rc, tail(log("postprocess"), 8)))
        return stages, extra
    pp_rep = json.load(open(pp_json))
    done("postprocess", True, secs, "", gateContactsFixed=pp_rep["gate_contacts_fixed"],
         siteSnapNm=pp_rep.get("site_snap_nm", 0), nonPinLabelsDropped=pp_rep.get("nonpin_labels_dropped", 0),
         enclosurePads=len(pp_rep.get("enclosure_added", [])), gapFills=len(pp_rep.get("gap_filled", [])),
         padTrims=len(pp_rep.get("pad_trimmed", [])), minAreaGrown=len(pp_rep["min_area_added"]),
         unfixed=len(pp_rep.get("enclosure_unfixed", [])) + len(pp_rep["min_area_unfixed"]))

    # ---- extract (Magic: RC netlist for characterization + device-only netlist for LVS) -------------
    rc_sp, lvs_sp = name + ".magic.spice", name + ".lvs.spice"
    tcl = "\n".join([
        "gds read %s" % gds, "load %s" % name, "select top cell", "port makeall",
        "extract all",
        "ext2spice lvs", "ext2spice cthresh 0", "ext2spice -o %s" % rc_sp,
        "ext2spice lvs", "ext2spice cthresh infinite", "ext2spice -o %s" % lvs_sp,
        "drc style drc(full)", "drc check", "drc catchup",
        "set mdrc [drc listall why]",
        "set f [open magic_drc.txt w]",
        "set n 0",
        "foreach {why boxes} $mdrc { set c [llength $boxes]; incr n $c; puts $f \"$c\\t$why\" }",
        "puts $f \"TOTAL\\t$n\"", "close $f",
        "quit -noprompt", ""])
    with open(os.path.join(w, "extract.tcl"), "w") as fh:
        fh.write(tcl)
    rc, secs = run(["magic", "-dnull", "-noconsole", "-rcfile", env.magicrc(), "extract.tcl"], w,
                   log("extract"), env.timeouts["extract"], stdin="")
    if not (os.path.isfile(os.path.join(w, rc_sp)) and os.path.isfile(os.path.join(w, lvs_sp))):
        done("extract", False, secs, "magic rc=%s: %s" % (rc, tail(log("extract"), 10)))
    else:
        norm, info = normalize_extracted(open(os.path.join(w, rc_sp)).read(), cell)
        with open(os.path.join(w, name + ".ext.spice"), "w") as fh:
            fh.write(norm)
        try:
            for ln in open(os.path.join(w, "magic_drc.txt")):
                if ln.startswith("TOTAL"):
                    extra["magicDrcCount"] = int(ln.split()[1])
        except OSError:
            pass
        extra["wellNodes"] = info
        ncap = sum(1 for ln in norm.splitlines() if ln[:1] in "Cc")
        if info["missingPorts"]:
            done("extract", False, secs, "port-missing: %s not ports of the Magic subckt %s"
                 % (info["missingPorts"], info["magicPorts"]), capacitors=ncap)
        else:
            done("extract", True, secs, "", capacitors=ncap)

    # ---- LVS (netgen; permute only pins every output function is symmetric in) ----------------------
    if os.path.isfile(os.path.join(w, lvs_sp)):
        groups = symmetric_groups(list(cell["outputs"].values()), cell["inputs"])
        setup = env.netgen_setup()
        if groups:
            wrap = os.path.join(w, "netgen_setup.tcl")
            with open(setup) as src, open(wrap, "w") as fh:
                fh.write(src.read())
                for g in groups:
                    for p in g[1:]:
                        fh.write('\npermute "%s" %s %s' % (name, g[0], p))
                fh.write("\n")
            setup = wrap
        lvs_log = os.path.join(w, name + ".lvs.log")
        rc, secs = run(["netgen", "-batch", "lvs", "%s %s" % (lvs_sp, name),
                        "%s %s" % (os.path.join("..", name + ".lvsref.sp"), name), setup, lvs_log], w,
                       log("lvs"), env.timeouts["lvs"])
        text = open(lvs_log, errors="replace").read() if os.path.isfile(lvs_log) else ""
        verdict = parse_lvs_verdict(text)
        final = (re.findall(r"Final result:.*", text) or ["(no final result)"])[-1]
        done("lvs", verdict == "match", secs, "" if verdict == "match" else "%s: %s" % (verdict, final),
             verdict=verdict, permuted=groups)

    # ---- DRC (KLayout; every deck in env.decks must report zero) -----------------------------------
    by_deck, secs_all, missing = {}, 0.0, []
    for deck in env.decks:
        rep = os.path.join(w, "%s.drc.%s.xml" % (name, deck))
        cmd = ["klayout", "-b", "-r", env.deck_path(deck), "-rd", "input=" + gds, "-rd", "topcell=" + name,
               "-rd", "top_cell=" + name, "-rd", "report=" + rep, "-rd", "thr=1"]
        for k, v in DRC_DECKS[deck][1].items():
            cmd += ["-rd", "%s=%s" % (k, v)]
        rc, secs = run(cmd, w, log("drc"), env.timeouts["drc"])
        secs_all += secs
        count, by_rule = parse_drc_report(rep)
        if count is None:
            missing.append("%s rc=%s" % (deck, rc))
        else:
            by_deck[deck] = by_rule
    if by_deck:
        shutil.copy(os.path.join(w, "%s.drc.%s.xml" % (name, env.decks[0])), os.path.join(w, name + ".drc.xml"))
    if missing:
        done("drc", False, round(secs_all, 1), "no report: %s %s" % (missing, tail(log("drc"), 6)),
             decks=env.decks, byDeck=by_deck)
    else:
        count, by_rule = merge_drc(by_deck)
        done("drc", count == 0, round(secs_all, 1), "" if count == 0 else json.dumps(by_rule), decks=env.decks,
             count=count, byRule=by_rule, byDeck=by_deck)

    # ---- LEF (sky130hd pins, pin-free OBS, post-process metal added to its pin or to OBS) ----------
    t0 = time.time()
    lef_tmp = os.path.join(w, "lef.tmp")
    shutil.rmtree(lef_tmp, ignore_errors=True)
    os.makedirs(lef_tmp)
    step1 = os.path.join(lef_tmp, name + ".lef")
    rc1, _ = run([sys.executable, os.path.join(HERE, "fix_lef_sky130hd.py"), os.path.join(w, name + ".raw.lef"),
                  "--inputs", ",".join(cell["inputs"]), "--output", ",".join(cell["outputs"]),
                  "--vdd", "vdd", "--gnd", "gnd", "-o", step1], w, log("lef"), env.timeouts["lef"])
    obs_dir = os.path.join(lef_tmp, "obs")
    rc2, _ = run([sys.executable, os.path.join(HERE, "fix_lef_obs.py"), step1, "-o", obs_dir], w, log("lef"),
                 env.timeouts["lef"]) if rc1 == 0 else (rc1, 0)
    if rc1 != 0 or rc2 != 0 or not os.path.isfile(os.path.join(obs_dir, name + ".lef")):
        done("lef", False, round(time.time() - t0, 1), "lef normalize failed: %s" % tail(log("lef"), 6))
    else:
        text = open(os.path.join(obs_dir, name + ".lef")).read()
        text = snap_lef_width(text, pp_rep.get("site_snap_nm", 0))
        strips = {}
        for t_ in pp_rep.get("pad_trimmed", []):
            if "strip_um" in t_:
                strips.setdefault(LEF_LAYER.get(t_["layer"], t_["layer"]), []).append(t_["strip_um"])
        text = trim_lef_rects(text, strips)
        text = augment_lef(text, lef_added_rects(pp_rep))
        with open(os.path.join(w, name + ".lef"), "w") as fh:
            fh.write(text)
        lpins = set(re.findall(r"^\s*PIN\s+(\S+)", text, re.M))
        want = set(cell["inputs"]) | set(cell["outputs"]) | set(POWER_PINS)
        ok = lpins == want
        done("lef", ok, round(time.time() - t0, 1), "" if ok else "pins %s != %s" % (sorted(lpins), sorted(want)))
    shutil.rmtree(lef_tmp, ignore_errors=True)
    return stages, extra


def build_cell(cell, outdir, env):
    name = cell["name"]
    d = os.path.join(outdir, name)
    status_path = os.path.join(d, "status.json")
    if os.path.isdir(d):
        shutil.rmtree(d)
    os.makedirs(d)
    st = {"schema": FACTORY_VERSION, "name": name, "specHash": cell["specHash"],
          "inputs": cell["inputs"], "outputs": cell["outputs"], "variant": cell["variant"],
          "notes": cell["notes"], "started": datetime.datetime.now().isoformat(timespec="seconds"),
          "drcDeck": env.deck, "factoryHash": getattr(env, "fhash", None),
          "stages": {}, "attempts": [], "failureClasses": [], "files": {}}
    t_cell = time.time()

    def finish():
        stg = st["stages"]
        if all(stg.get(k, {}).get("ok", False) for k in STAGES):
            st["state"] = "clean"
        elif stg.get("layout", {}).get("ok"):
            st["state"] = "layout-not-clean"
        else:
            st["state"] = "failed"
        st["failureClasses"] = [classify_failure(k, stg[k].get("detail", "")) for k in STAGES
                                if k in stg and not stg[k].get("ok")]
        if st["failureClasses"]:
            k = next(k for k in STAGES if k in stg and not stg[k].get("ok"))
            st["failure"] = {"stage": k, "class": st["failureClasses"][0], "detail": stg[k].get("detail", "")[-600:]}
        st["seconds"] = round(time.time() - t_cell, 1)
        for k, f in (("source", name + ".sp"), ("gds", name + ".gds"), ("lef", name + ".lef"),
                     ("extracted", name + ".ext.spice"), ("drcReport", name + ".drc.xml"),
                     ("lvsLog", name + ".lvs.log")):
            if os.path.isfile(os.path.join(d, f)):
                st["files"][k] = f
        with open(status_path, "w") as fh:
            json.dump(st, fh, indent=1)
            fh.write("\n")
        return st

    # ---- netlist: bool2cmos -> switch-level check -> sizing -> switch-level check ----------------
    t0 = time.time()
    nlog = os.path.join(d, "netlist.log")
    b2c = os.path.join(d, name + ".b2c.sp")
    cmd = [sys.executable, "-m", "bool2cmos", "--inputs", ",".join(cell["inputs"]),
           "--pdk", "sky130", "--cell-name", name, "--out", b2c, "--meta", b2c[:-3] + ".json"]
    for pin, fn in cell["outputs"].items():
        cmd += ["--function", fn, "--output", pin]
    pp = os.environ.get("PYTHONPATH", "")
    rc, _ = run(cmd, d, nlog, env.timeouts["netlist"], env={"PYTHONPATH": env.bool2cmos + (":" + pp if pp else "")})
    if rc != 0 or not os.path.isfile(b2c):
        st["stages"]["netlist"] = {"ok": False, "seconds": round(time.time() - t0, 1),
                                   "detail": "bool2cmos rc=%s: %s" % (rc, tail(nlog, 6))}
        return finish()
    try:
        base = parse_b2c_spice(open(b2c).read())
        err = verify_switch_level(base, cell)
        if err:
            raise SpecError("bool2cmos netlist wrong at switch level: " + err)
        sized = apply_sizing(base, cell["variant"])
        err = verify_switch_level(sized, cell)
        if err:
            raise SpecError("sized netlist wrong at switch level: " + err)
    except SpecError as e:
        st["stages"]["netlist"] = {"ok": False, "seconds": round(time.time() - t0, 1), "detail": str(e)}
        return finish()
    with open(os.path.join(d, name + ".sp"), "w") as fh:
        fh.write(emit_source(sized, cell))
    with open(os.path.join(d, name + ".lclayout.sp"), "w") as fh:
        fh.write(emit_lclayout(sized, cell))
    with open(os.path.join(d, name + ".lvsref.sp"), "w") as fh:
        fh.write(emit_lvs_ref(sized, cell))
    nP = sum(1 for x in sized["devices"] if x["kind"] == "p")
    st["stages"]["netlist"] = {"ok": True, "seconds": round(time.time() - t0, 1), "detail": "",
                               "devices": len(sized["devices"]), "nmos": len(sized["devices"]) - nP,
                               "pmos": nP, "b2cDevices": len(base["devices"])}

    # ---- physical attempts: seeds 0..N-1, keep the best (clean > LVS ok > fewest DRC items) -------
    best = None
    t_phys = time.time()
    for k, (profile, seed) in enumerate(env.attempt_plan()):
        if k > 0 and time.time() - t_phys > env.cell_budget:
            st["budgetExhausted"] = True        # no new attempt after --cell-budget seconds
            break
        w = os.path.join(d, "try%d" % k)
        stages, extra = physical(cell, w, env, seed, profile)
        rank = attempt_rank(stages)
        st["attempts"].append({"try": k, "profile": profile, "seed": seed, "rank": list(rank),
                               "drc": stages.get("drc", {}).get("byRule"),
                               "lvs": stages.get("lvs", {}).get("verdict"),
                               "layoutOk": stages.get("layout", {}).get("ok", False),
                               "seconds": round(sum(v.get("seconds", 0) or 0 for v in stages.values()), 1)})
        if best is None or rank < best[0]:
            best = (rank, k, stages, extra)
        if rank[0] == 0:
            break
    _, k, stages, extra = best
    st["stages"].update(stages)
    st.update(extra)
    st["bestTry"] = st["attempts"][k]
    w = os.path.join(d, "try%d" % k)
    for suf in DELIVER:
        f = os.path.join(w, name + suf)
        if os.path.isfile(f):
            shutil.copy(f, os.path.join(d, name + suf))
    for f in ("postprocess.json", "magic_drc.txt"):
        if os.path.isfile(os.path.join(w, f)):
            shutil.copy(os.path.join(w, f), os.path.join(d, f))
    return finish()


def factory_hash(env):
    h = hashlib.sha256()
    for f in ("factory.py", "postprocess_cell.py", "fix_lef_sky130hd.py", "fix_lef_obs.py"):
        h.update(open(os.path.join(HERE, f), "rb").read())
    for t in sorted(env.techs.values()):
        h.update(open(t, "rb").read())
    h.update(",".join(env.profiles).encode())
    h.update(("%s|%d|%s" % (env.deck, env.site_nm, env.ladder)).encode())
    return h.hexdigest()[:16]


def run_batch(cells, outdir, jobs, env, force=False):
    os.makedirs(outdir, exist_ok=True)
    env.deck_dir = os.path.join(outdir, ".factory")
    os.makedirs(env.deck_dir, exist_ok=True)
    relaxed = os.path.join(env.deck_dir, "librecell_sky130_tech_relaxed.py")
    text = open(env.tech).read() + "\n\n" + open(env.relaxed_overrides).read()
    tmp = relaxed + ".%d.tmp" % os.getpid()
    with open(tmp, "w") as fh:
        fh.write(text)
    os.replace(tmp, relaxed)
    env.techs["relaxed"] = relaxed
    env.fhash = factory_hash(env)
    for deck in env.decks:
        env.deck_path(deck)
    results, todo = {}, []
    for c in cells:
        sp = os.path.join(outdir, c["name"], "status.json")
        if not force and os.path.isfile(sp):
            try:
                old = json.load(open(sp))
                if (old.get("specHash") == c["specHash"] and old.get("factoryHash") == env.fhash
                        and old.get("state") == "clean"):
                    old["reused"] = True
                    results[c["name"]] = old
                    continue
            except (OSError, ValueError):
                pass
        todo.append(c)
    t0 = time.time()
    print("[factory] %d cells (%d reused clean), jobs=%d, deck=%s" % (len(cells), len(cells) - len(todo), jobs, env.deck),
          flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as ex:
        futs = {ex.submit(build_cell, c, outdir, env): c for c in todo}
        for f in concurrent.futures.as_completed(futs):
            c = futs[f]
            try:
                st = f.result()
            except Exception as e:  # a factory bug must not kill the batch
                st = {"name": c["name"], "state": "failed", "stages": {},
                      "failureClasses": ["factory:exception"], "failure": {"stage": "factory", "detail": repr(e)}}
            results[c["name"]] = st
            print("[factory] %-24s %-17s %6.1fs %s" % (st["name"], st["state"], st.get("seconds", 0),
                                                     st.get("failure", {}).get("class", "")), flush=True)
    wall = round(time.time() - t0, 1)
    ordered = [results[c["name"]] for c in cells]
    man = {"schema": FACTORY_VERSION, "finished": datetime.datetime.now().isoformat(timespec="seconds"),
           "wallSeconds": wall, "jobs": jobs, "drcDeck": env.deck, "drcDeckDescription": {k: DRC_DECKS[k][3] for k in env.decks},
           "cleanPolicy": "clean = Magic extraction with all signal ports + netgen 'Circuits match uniquely' "
                          "+ zero DRC items in the deck above + LEF pins == spec pins + power pins",
           "summary": summarize(ordered),
           "cells": [{"name": s["name"], "state": s.get("state"), "seconds": s.get("seconds"),
                      "reused": s.get("reused", False),
                      "drcCount": s.get("stages", {}).get("drc", {}).get("count"),
                      "drcByRule": s.get("stages", {}).get("drc", {}).get("byRule"),
                      "magicDrcCount": s.get("magicDrcCount"),
                      "lvs": s.get("stages", {}).get("lvs", {}).get("verdict"),
                      "devices": s.get("stages", {}).get("netlist", {}).get("devices"),
                      "failure": s.get("failure")} for s in ordered]}
    with open(os.path.join(outdir, "manifest.json"), "w") as fh:
        json.dump(man, fh, indent=1)
        fh.write("\n")
    return man


def print_summary(man):
    s = man["summary"]
    print("clean %d/%d (%.0f%%), wall %.1fs, jobs %s, deck %s" % (
        s["clean"], s["cells"], 100 * s["cleanYield"], man.get("wallSeconds", 0), man.get("jobs"), man.get("drcDeck")))
    print("stage yield: " + "  ".join("%s %d/%d" % (k, v["passed"], v["of"]) for k, v in s["stageYield"].items()))
    for c, names in s["failureClasses"].items():
        print("  %-40s %2d  %s" % (c, len(names), ",".join(names[:8])))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="build every cell of a spec")
    r.add_argument("spec")
    r.add_argument("--out", required=True)
    r.add_argument("--jobs", type=int)
    r.add_argument("--only", help="comma-separated cell names")
    r.add_argument("--force", action="store_true", help="rebuild cells already clean with the same spec")
    r.add_argument("--drc-deck", default=DEFAULT_DECKS,
                   help="comma list of DRC decks that must all report zero (%s)" % ", ".join(sorted(DRC_DECKS)))
    r.add_argument("--layout-timeout", type=int, default=240, help="seconds per LibreCell run")
    r.add_argument("--tech", help="LibreCell tech file (default: factory/librecell_sky130_tech.py, 0.48 um gate pitch)")
    r.add_argument("--site-nm", type=int, default=460, help="snap cell width up to this site (0 = off)")
    r.add_argument("--attempts", type=int, default=6, help="layout attempts (profile x seed) until a cell is clean")
    r.add_argument("--profiles", default="strict,relaxed", help="LibreCell tech profiles to interleave")
    r.add_argument("--cell-budget", type=int, default=300,
                   help="seconds after which no new layout attempt starts for a cell")
    c = sub.add_parser("check", help="validate a spec file")
    c.add_argument("spec")
    s = sub.add_parser("summarize", help="print a batch manifest")
    s.add_argument("out")
    a = ap.parse_args(argv)
    if a.cmd == "summarize":
        print_summary(json.load(open(os.path.join(a.out, "manifest.json"))))
        return 0
    cells, errors, jobs = parse_spec(json.load(open(a.spec)))
    for e in errors:
        print("spec error: " + e, file=sys.stderr)
    if a.cmd == "check":
        print("%d cells valid, %d errors" % (len(cells), len(errors)))
        return 1 if errors else 0
    if errors:
        return 2
    if a.only:
        keep = set(a.only.split(","))
        cells = [x for x in cells if x["name"] in keep]
    man = run_batch(cells, os.path.abspath(a.out), a.jobs or jobs, Env(a), a.force)
    print_summary(man)
    return 0 if man["summary"]["clean"] == man["summary"]["cells"] else 3


if __name__ == "__main__":
    sys.exit(main())
