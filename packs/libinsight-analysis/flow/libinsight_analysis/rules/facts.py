"""Shared helpers for the example insight rules: facts loading, units, tables, naming and functions.

Standard library only; runs on Python 3.6 through 3.12 (the resident sandbox has 3.6.8 and no numpy).
Facts files are large (tens of MB compressed), so every rule loads one file at a time with
`load_facts`, keeps the few numbers it needs, and drops the record before the next file.

Units after scaling: time ps, capacitance fF, leakage nW, area as Liberty gives it (um^2).
"""
import array
import gc
import glob
import gzip
import json
import math
import os
import re

SCHEMA = "lib-insight-facts/1"
DELAY_TYPES = ("combinational", "combinational_rise", "combinational_fall", "rising_edge", "falling_edge",
               "preset", "clear")
DELAY_KINDS = ("cell_rise", "cell_fall", "rise_transition", "fall_transition")
EDGE_KIND = {"rise": ("cell_rise", "rise_transition"), "fall": ("cell_fall", "fall_transition")}


class RuleError(Exception):
    """A refusal with a sentence the person running the rule can act on."""


# ---------------------------------------------------------------- inputs and loading

def parse_inputs(specs):
    """[(label, path)] from `LABEL=PATH` specs; PATH may be a glob. Each label keeps the order given."""
    out = []
    for spec in specs or []:
        if "=" not in spec:
            raise RuleError("facts input %r must be LABEL=PATH (the variant label, then the facts file or a "
                            "glob)" % spec)
        label, pattern = spec.split("=", 1)
        paths = sorted(glob.glob(os.path.expanduser(pattern))) if any(c in pattern for c in "*?[") else [pattern]
        if not paths:
            raise RuleError("no facts file matches %s" % pattern)
        for path in paths:
            if not os.path.isfile(path):
                raise RuleError("facts file %s does not exist" % path)
            out.append((label.strip(), path))
    if not out:
        raise RuleError("no facts files given")
    return out


def _compact(kinds):
    """A json object hook that drops the groups and tables a rule does not read, and stores table values as
    packed doubles, so a large facts file needs a fraction of the memory while it is read."""
    def hook(obj):
        if "values" in obj and "kind" in obj:
            if kinds is not None and obj["kind"] not in kinds:
                return None
            try:
                obj["values"] = array.array("d", obj["values"])
            except TypeError:
                pass                                   # a non-numeric value: keep the list, grid() refuses it
            return obj
        if "internal_power" in obj and "direction" in obj:
            obj["internal_power"] = []
            obj.pop("receiver_cap_groups", None)
        if "tables" in obj and "related_pin" in obj:
            obj["tables"] = [t for t in obj["tables"] if t is not None]
            obj.pop("ccs_groups", None)
        return obj
    return hook


def load_facts(path, kinds=DELAY_KINDS):
    """The `library` of one lib-insight-facts/1 record, with `_source` added. Refuses other schemas and failed
    records. Only tables of `kinds` are kept (None keeps every table); internal power groups are dropped."""
    opener = gzip.open if path.endswith(".gz") else open
    paused = gc.isenabled()
    gc.disable()                      # parsed JSON has no reference cycles; collecting while it grows only costs time
    try:
        with opener(path, "rt") as stream:
            record = json.load(stream, object_hook=_compact(kinds))
    finally:
        if paused:
            gc.enable()
    if record.get("schema") != SCHEMA:
        raise RuleError("%s is not a lib-insight-facts/1 record" % path)
    if record.get("status") != "ok":
        raise RuleError("%s is a failed extraction (%s)" % (path, record.get("failure")))
    lib = record["library"]
    lib["_source"] = dict(record.get("source") or {}, file=path)
    return lib


def num(value):
    """A finite float from a number or numeric string, else None (never 0 in place of missing)."""
    if isinstance(value, bool) or value is None:
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if math.isfinite(out) else None


_UNIT = {"s": 1.0, "ms": 1e-3, "us": 1e-6, "ns": 1e-9, "ps": 1e-12, "fs": 1e-15,
         "f": 1e-15, "ff": 1e-15, "pf": 1e-12, "nf": 1e-9, "uf": 1e-6,
         "w": 1.0, "mw": 1e-3, "uw": 1e-6, "nw": 1e-9, "pw": 1e-12, "fw": 1e-15}


def _unit_text(value):
    if isinstance(value, (list, tuple)) and len(value) == 2:
        factor, unit = num(value[0]), str(value[1]).strip().lower()
    else:
        m = re.match(r"^\s*([0-9.eE+-]*)\s*([A-Za-z]+)\s*$", str(value or ""))
        if not m:
            return None
        factor, unit = num(m.group(1) or 1), m.group(2).lower()
    if unit not in _UNIT or factor is None:
        return None
    return factor * _UNIT[unit]


def scales(lib):
    """Multipliers from library units to ps, fF and nW."""
    units, attrs = lib.get("units") or {}, lib.get("attrs") or {}
    time_s = num(units.get("time_s")) or _unit_text(attrs.get("time_unit")) or 1e-9
    cap_f = num(units.get("cap_F")) or _unit_text(attrs.get("capacitive_load_unit")) or 1e-12
    leak_w = num(units.get("leakage_W")) or _unit_text(attrs.get("leakage_power_unit")) or 1e-9
    return {"ps": time_s * 1e12, "ff": cap_f * 1e15, "nw": leak_w * 1e9}


def corner(lib):
    """{voltage, temperature, process, name} of the file's operating condition."""
    attrs = lib.get("attrs") or {}
    conds = lib.get("operating_conditions") or []
    want = attrs.get("default_operating_conditions")
    pick = next((c for c in conds if c.get("name") == want), conds[0] if conds else {"name": "", "attrs": {}})
    a = pick.get("attrs") or {}
    volt = num(a.get("voltage"))
    temp = num(a.get("temperature"))
    volt = volt if volt is not None else num(attrs.get("nom_voltage"))
    temp = temp if temp is not None else num(attrs.get("nom_temperature"))
    return {"voltage": None if volt is None else round(volt, 4),
            "temperature": None if temp is None else round(temp, 2),
            "process": num(a.get("process")) if num(a.get("process")) is not None else num(attrs.get("nom_process")),
            "name": pick.get("name") or ""}


def corner_words(c):
    parts = [c.get("name") or ""]
    if c.get("voltage") is not None:
        parts.append("%g V" % c["voltage"])
    if c.get("temperature") is not None:
        parts.append("%g °C" % c["temperature"])
    return " ".join(p for p in parts if p).strip()


def temp_key(t):
    return "%g" % t


# ---------------------------------------------------------------- tables

def _role(variable):
    v = (variable or "").lower()
    if "capacitance" in v:
        return "load"
    if "transition" in v:
        return "slew"
    return None


def grid(table, templates, sc):
    """A slew x load table as {s: slews ps, l: loads fF, v: rows by slew of values} with values scaled by `sc`;
    one-axis tables get a single point on the missing axis. None for scalars, other axes or unknown values."""
    tmpl = table.get("template")
    index = table.get("index") or []
    if not tmpl or not index or len(index) > 2:
        return None
    variables = list((templates.get(tmpl) or {}).get("variables") or [])[:len(index)]
    roles = [_role(v) for v in variables]
    if len(roles) != len(index) or None in roles or len(set(roles)) != len(roles):
        return None
    axes = []
    for ix in index:
        vals = [num(x) for x in ix]
        if None in vals:
            return None
        axes.append(vals)
    raw = [num(x) for x in table.get("values") or []]
    size = 1
    for ax in axes:
        size *= len(ax)
    if len(raw) != size or None in raw:
        return None
    ps, ff = scales_of(templates)
    if len(axes) == 1:
        ax = axes[0]
        if roles[0] == "slew":
            return {"s": [x * ps for x in ax], "l": [0.0], "v": [[v * sc] for v in raw]}
        return {"s": [0.0], "l": [x * ff for x in ax], "v": [[v * sc for v in raw]]}
    n1 = len(axes[1])
    rows = [[raw[i * n1 + j] * sc for j in range(n1)] for i in range(len(axes[0]))]
    if roles[0] == "load":                       # store with slew first
        rows = [list(col) for col in zip(*rows)]
        axes = [axes[1], axes[0]]
    return {"s": [x * ps for x in axes[0]], "l": [x * ff for x in axes[1]], "v": rows}


def scales_of(templates):
    """Axis multipliers (ps per time unit, fF per cap unit) stashed on the templates map by `templates_of`."""
    return templates.get("_scale", (1.0, 1.0))


def templates_of(lib):
    sc = scales(lib)
    out = dict((t.get("name"), t) for t in lib.get("templates") or [] if t.get("name"))
    out["_scale"] = (sc["ps"], sc["ff"])
    return out


def _bracket(xs, q):
    n = len(xs)
    if n == 1:
        return 0, 0.0, True
    i = 0
    while i < n - 2 and q > xs[i + 1]:
        i += 1
    dx = xs[i + 1] - xs[i]
    f = (q - xs[i]) / dx if dx else 0.0
    return i, f, xs[0] - 1e-9 <= q <= xs[-1] + 1e-9


def lookup(g, slew, load):
    """(value, inside the grid) by bilinear interpolation at the real axis values; linear extrapolation outside."""
    i, fi, ok_i = _bracket(g["s"], slew)
    j, fj, ok_j = _bracket(g["l"], load)
    v = g["v"]

    def row(r):
        if len(v[r]) == 1:
            return v[r][0]
        return v[r][j] * (1.0 - fj) + v[r][j + 1] * fj
    if len(v) == 1:
        return row(0), ok_i and ok_j
    return row(i) * (1.0 - fi) + row(i + 1) * fi, ok_i and ok_j


# ---------------------------------------------------------------- cells, pins and arcs

def pins_of(cell, ff):
    """{pin: {dir, cap fF or None, clock, function}} of a cell's signal pins."""
    out = {}
    for p in cell.get("pins") or []:
        cap = num(p.get("cap"))
        attrs = p.get("attrs") or {}
        out[p["name"]] = {"dir": p.get("direction"), "cap": None if cap is None else cap * ff,
                          "clock": bool(p.get("is_clock") or attrs.get("clock") in (True, "true")),
                          "function": attrs.get("function") if isinstance(attrs.get("function"), str) else None,
                          "nextstate": attrs.get("nextstate_type")}
    return out


def delay_arcs(cell, templates, ps):
    """Delay arcs [{from, to, type, when, t: {kind: grid}}] of a cell (combinational, clock-to-output, set/reset)."""
    out = []
    for p in cell.get("pins") or []:
        if p.get("direction") not in ("output", "inout"):
            continue
        for g in p.get("timing") or []:
            ttype = g.get("timing_type") or "combinational"
            if ttype not in DELAY_TYPES:
                continue
            tabs = {}
            for t in g.get("tables") or []:
                kind = t.get("kind")
                if kind in DELAY_KINDS and kind not in tabs:
                    gr = grid(t, templates, ps)
                    if gr is not None:
                        tabs[kind] = gr
            if "cell_rise" not in tabs and "cell_fall" not in tabs:
                continue
            for rel in (g.get("related_pin") or "").split():
                out.append({"from": rel, "to": p["name"], "type": ttype, "when": g.get("when") or "", "t": tabs})
    return out


def load_basis(pins, arc):
    """The input capacitance an arc's load scales with: the related input pin's, or the mean data input's for a
    clock arc. None when unknown (never 0)."""
    rel = pins.get(arc["from"])
    if rel is not None and not rel["clock"] and rel["cap"]:
        return rel["cap"]
    data = [p["cap"] for p in pins.values() if p["dir"] == "input" and not p["clock"] and p["cap"]]
    if data:
        return sum(data) / len(data)
    return rel["cap"] if rel is not None and rel["cap"] else None


def arc_delay(arc, slew, load, edges=("rise", "fall")):
    """(mean delay over `edges`, inside the grid) of one arc at (slew ps, load fF); None when no table."""
    vals, ok = [], True
    for e in edges:
        g = arc["t"].get(EDGE_KIND[e][0])
        if g is not None:
            v, inside = lookup(g, slew, load)
            vals.append(v)
            ok = ok and inside
    return (sum(vals) / len(vals), ok) if vals else (None, True)


def arc_transition(arc, slew, load, edge):
    g = arc["t"].get(EDGE_KIND[edge][1])
    return lookup(g, slew, load)[0] if g is not None else None


def metric_arcs(rec):
    """The arcs a cell's delay is read on: clock to output for a sequential cell, combinational otherwise
    (asynchronous set/reset arcs are not the cell's delay)."""
    seq = bool(rec["sig"]) and rec["sig"][0] == "seq"
    want = ("rising_edge", "falling_edge") if seq else ("combinational", "combinational_rise", "combinational_fall")
    return [a for a in rec["arcs"] or [] if a["type"] in want]


def by_pair(arcs):
    """Arcs per (from, to): the unconditional ones, else the conditional ones."""
    pairs = {}
    for a in arcs:
        pairs.setdefault((a["from"], a["to"]), []).append(a)
    out = []
    for group in pairs.values():
        plain = [a for a in group if not a["when"]]
        out.append(plain or group)
    return out


def cell_delay(arcs, pins, slew, h=4.0):
    """The cell's delay at its own fanout-of-h load: the worst arc of mean(rise, fall), each arc at slew ps and h x
    its own input capacitance. (delay, arc, load, inside) or None."""
    best = None
    for group in by_pair(arcs):
        for a in group:
            basis = load_basis(pins, a)
            if basis is None:
                continue
            d, ok = arc_delay(a, slew, h * basis)
            if d is not None and (best is None or d > best[0]):
                best = (d, a, h * basis, ok)
    return best


def drive_resistance(arc, slew, load):
    """d(delay)/d(load) in ps/fF around a load point (central difference)."""
    step = 0.1 * load if load > 0 else 0.1
    hi, _ = arc_delay(arc, slew, load + step)
    lo, _ = arc_delay(arc, slew, max(load - step, 0.0))
    if hi is None or lo is None:
        return None
    return (hi - lo) / (load + step - max(load - step, 0.0))


def leakage_nw(cell, nw):
    vals = [num(x.get("value")) for x in cell.get("leakage") or []]
    vals = [v for v in vals if v is not None]
    if vals:
        states = [num(x.get("value")) for x in cell.get("leakage") or [] if x.get("when")]
        states = [v for v in states if v is not None]
        use = states or vals
        return sum(use) / len(use) * nw
    v = num((cell.get("attrs") or {}).get("cell_leakage_power"))
    return None if v is None else v * nw


def dont_use(cell):
    return (cell.get("attrs") or {}).get("dont_use") in (True, "true", "TRUE")


# ---------------------------------------------------------------- Boolean functions

_TOK = re.compile(r"\s*(?:(?P<id>[A-Za-z_][A-Za-z0-9_\[\]\.]*)|(?P<op>[!~&*|+^()'])|(?P<c>[01]))")


def parse_function(text):
    """A Liberty function as a tree: ("var", n) ("const", b) ("not", x) ("and"|"or"|"xor", a, b).
    Precedence, lowest first: OR (| +), XOR (^), AND (& * or juxtaposition), NOT (! ~, postfix ')."""
    toks, pos, text = [], 0, text.strip()
    while pos < len(text):
        m = _TOK.match(text, pos)
        if not m or m.end() == pos:
            if text[pos:].strip() == "":
                break
            raise RuleError("cannot read the function %r" % text)
        pos = m.end()
        toks.append(("id", m.group("id")) if m.group("id") else ("op", m.group("op")) if m.group("op")
                    else ("c", m.group("c")))
    at = [0]

    def peek():
        return toks[at[0]] if at[0] < len(toks) else (None, None)

    def take():
        at[0] += 1
        return toks[at[0] - 1]

    def unary():
        kind, val = peek()
        if val in ("!", "~"):
            take()
            node = ("not", unary())
        elif val == "(":
            take()
            node = disj()
            if take()[1] != ")":
                raise RuleError("unbalanced parentheses in %r" % text)
        elif kind == "id":
            node = ("var", take()[1])
        elif kind == "c":
            node = ("const", take()[1] == "1")
        else:
            raise RuleError("cannot read the function %r" % text)
        while peek()[1] == "'":
            take()
            node = ("not", node)
        return node

    def conj():
        node = unary()
        while True:
            kind, val = peek()
            if val in ("&", "*"):
                take()
                node = ("and", node, unary())
            elif kind in ("id", "c") or val in ("!", "~", "("):
                node = ("and", node, unary())
            else:
                return node

    def xor():
        node = conj()
        while peek()[1] == "^":
            take()
            node = ("xor", node, conj())
        return node

    def disj():
        node = xor()
        while peek()[1] in ("|", "+"):
            take()
            node = ("or", node, xor())
        return node
    tree = disj()
    if at[0] != len(toks):
        raise RuleError("cannot read the function %r" % text)
    return tree


def variables(tree, out=None):
    out = set() if out is None else out
    if tree[0] == "var":
        out.add(tree[1])
    for child in tree[1:]:
        if isinstance(child, tuple):
            variables(child, out)
    return out


def truth(tree, names):
    """The truth table of `tree` over `names` as an int bitmask (row r sets name k to bit k of r)."""
    rows = 1 << len(names)
    full = (1 << rows) - 1
    masks = {}
    for k, n in enumerate(names):
        m = 0
        for r in range(rows):
            if r >> k & 1:
                m |= 1 << r
        masks[n] = m

    def ev(t):
        op = t[0]
        if op == "var":
            if t[1] not in masks:
                raise RuleError("unknown input %s" % t[1])
            return masks[t[1]]
        if op == "const":
            return full if t[1] else 0
        if op == "not":
            return full & ~ev(t[1])
        a, b = ev(t[1]), ev(t[2])
        return a & b if op == "and" else a | b if op == "or" else a ^ b
    return ev(tree)


def _render(tree):
    """A canonical text of a tree (operands of commutative operators sorted)."""
    op = tree[0]
    if op == "var":
        return tree[1]
    if op == "const":
        return "1" if tree[1] else "0"
    if op == "not":
        return "!" + _render(tree[1])
    parts = []

    def flat(t):
        if t[0] == op:
            flat(t[1])
            flat(t[2])
        else:
            parts.append(_render(t))
    flat(tree)
    return "(" + {"and": "&", "or": "|", "xor": "^"}[op].join(sorted(parts)) + ")"


def _canon(text, rename=None):
    if not isinstance(text, str) or not text.strip():
        return ""
    try:
        tree = parse_function(text)
    except RuleError:
        return "?" + text.strip()
    if rename:
        def swap(t):
            if t[0] == "var":
                return ("var", rename.get(t[1], t[1]))
            return (t[0],) + tuple(swap(c) if isinstance(c, tuple) else c for c in t[1:])
        tree = swap(tree)
    return _render(tree)


def signature(cell, pins):
    """The cell's functional signature: two cells share it exactly when a tool may swap one for the other.
    Combinational: its input pins and each output's truth table over them. Sequential: the state group's
    clocked_on/enable, next_state, clear, preset and clear-preset settings, and each output's function in terms of
    the state, with the input pin names kept (a swap keeps the pins). None for cells without a function."""
    inputs = sorted(n for n, p in pins.items() if p["dir"] == "input")
    seq = cell.get("sequential") or []
    if seq:
        group = seq[0]
        a = group.get("attrs") or {}
        names = [x for x in (group.get("names") or []) if isinstance(x, str)]
        rename = dict(zip(names, ("STATE", "STATE_N")))
        state = tuple((k, _canon(a.get(k), rename)) for k in ("clocked_on", "clocked_on_also", "enable", "next_state",
                                                              "data_in", "clear", "preset")) + (
            ("clear_preset_var1", str(a.get("clear_preset_var1") or "")),
            ("clear_preset_var2", str(a.get("clear_preset_var2") or "")))
        outs = tuple(sorted((n, _canon(p["function"], rename)) for n, p in pins.items()
                            if p["dir"] in ("output", "inout")))
        scan = tuple(sorted((n, str(p["nextstate"])) for n, p in pins.items() if p["nextstate"]))
        return ("seq", str(group.get("type") or ""), tuple(inputs), state, outs, scan, len(seq))
    outs = []
    for n, p in sorted(pins.items()):
        if p["dir"] not in ("output", "inout") or not p["function"]:
            continue
        try:
            tree = parse_function(p["function"])
        except RuleError:
            return None
        if not variables(tree) <= set(inputs):
            return None                                   # refers to internal state: not a plain gate
        outs.append((n, truth(tree, inputs)))
    if not outs or not inputs:
        return None
    flags = cell.get("flags") or {}
    if flags.get("icg") or (cell.get("attrs") or {}).get("clock_gating_integrated_cell"):
        return None
    return ("comb", tuple(inputs), tuple(outs))


def _basic(tt, n):
    rows = 1 << n
    ones = bin(tt).count("1")
    if n == 1:
        return "INV" if tt == 1 else "BUF" if tt == 2 else None
    if ones == 1 and tt >> (rows - 1) & 1:
        return "AND%d" % n
    if ones == rows - 1 and not tt >> (rows - 1) & 1:
        return "NAND%d" % n
    if ones == rows - 1 and not tt & 1:
        return "OR%d" % n
    if ones == 1 and tt & 1:
        return "NOR%d" % n
    parity = sum(1 << r for r in range(rows) if bin(r).count("1") % 2)
    if tt == parity:
        return "XOR%d" % n
    if tt == ((1 << rows) - 1) & ~parity:
        return "XNOR%d" % n
    return None


def _structural(tree):
    neg = tree[0] == "not"
    core = tree[1] if neg else tree

    def flat(t, op):
        return flat(t[1], op) + flat(t[2], op) if t[0] == op else [t]
    for outer, inner, plain, inv in (("or", "and", "AO", "AOI"), ("and", "or", "OA", "OAI")):
        terms = flat(core, outer)
        sizes = []
        for term in terms:
            lits = flat(term, inner)
            if not all(x[0] == "var" for x in lits):
                sizes = None
                break
            sizes.append(len(lits))
        if sizes and len(sizes) > 1 and max(sizes) > 1:
            return (inv if neg else plain) + "".join(str(s) for s in sorted(sizes, reverse=True))
    return None


def class_label(cell, pins, sig):
    """A short function class in plain words: NAND2, AOI21, MUX2, Flop + reset, Scan flop, Latch, ..."""
    if sig is None:
        flags = cell.get("flags") or {}
        if flags.get("icg") or (cell.get("attrs") or {}).get("clock_gating_integrated_cell"):
            return "Clock gate"
        return "Other"
    if sig[0] == "seq":
        a = ((cell.get("sequential") or [{}])[0].get("attrs") or {})
        name = "Flop" if sig[1] in ("ff", "ff_bank") else "Latch" if sig[1] in ("latch", "latch_bank") else "Sequential"
        if any(p["nextstate"] in ("scan_in", "scan_enable") for p in pins.values()):
            name = "Scan " + name.lower()
        extra = [w for k, w in (("clear", "reset"), ("preset", "set")) if a.get(k)]
        clocked = str(a.get("clocked_on") or "")
        if clocked.strip().startswith(("!", "~")) or clocked.strip().endswith("'"):
            extra.append("falling edge")
        if sig[6] > 1:
            extra.append("multi-bit")
        return name + (" + " + ", ".join(extra) if extra else "")
    inputs = list(sig[1])
    if len(sig[2]) > 1:
        return "Multi-output (%d outputs)" % len(sig[2])
    out = sig[2][0][0]
    tt = sig[2][0][1]
    label = _basic(tt, len(inputs))
    if label is None and len(inputs) == 3:
        def bit(r, x):
            return r >> inputs.index(x) & 1
        for s in inputs:
            a, b = [x for x in inputs if x != s]
            for hi, lo in ((a, b), (b, a)):
                ref = sum(1 << r for r in range(8) if (bit(r, hi) if bit(r, s) else bit(r, lo)))
                if tt == ref:
                    label = "MUX2"
                elif tt == 0xFF & ~ref:
                    label = "MUX2 inverting"
    if label is None:
        try:
            label = _structural(parse_function(pins[out]["function"]))
        except RuleError:
            label = None
    if any((p.get("attrs") or {}).get("three_state") for p in cell.get("pins") or []):
        label = "Tri-state " + (label or "logic")
    if label is None:
        # A Boolean expression is not a plain-English class; the page names the class, the cell names the rest.
        label = "Complex logic (%d inputs)" % len(inputs)
    return label


# ---------------------------------------------------------------- naming

PROFILES = {
    # INVX1, NAND2X2, DFFRX1, NOR3X1_LVT: drive "X<n>" at the end, optional VT suffix
    "generic": {"vt": r"[_-]?(?P<vt>ULVT|LVT|HVT|SVT|RVT)$", "drive": r"X(?P<drive>\d+(?:P\d+)?)$",
                "track": r"(?P<track>\d+(?:P\d+)?T)", "variant_vt": r"(?P<vt>ULVT|LVT|HVT|SVT|RVT)",
                "clock": r"^(CK|CLK)"},
    # <function>D<n><library tag>[VT]: drive "D<n>" (0P5 = 0.5) as the last D-number followed by the tag
    "dnum": {"vt": r"(?P<vt>ULVT|LVT|HVT)$", "drive": r"D(?P<drive>\d+(?:P\d+)?)(?=[A-Z]|$)",
             "track": r"(?P<track>\d+(?:P\d+)?T)", "variant_vt": r"(?P<vt>ULVT|LVT|HVT|SVT|RVT)",
             "clock": r"^CK"},
}


class Naming(object):
    """How cell names encode drive and VT, and how variant labels encode track and VT (a small profile of regexes)."""

    def __init__(self, profile="generic"):
        if isinstance(profile, dict):
            spec = profile
        elif profile in PROFILES:
            spec = PROFILES[profile]
        elif os.path.isfile(str(profile)):
            with open(profile) as stream:
                spec = json.load(stream)
        else:
            raise RuleError("unknown naming profile %r (generic, dnum, or a JSON file of regexes)" % (profile,))
        self.vt = re.compile(spec["vt"]) if spec.get("vt") else None
        self.drive = re.compile(spec["drive"])
        self.track = re.compile(spec.get("track") or r"(?P<track>\d+(?:P\d+)?T)")
        self.variant_vt = re.compile(spec.get("variant_vt") or r"(?P<vt>ULVT|LVT|HVT|SVT|RVT)")
        self.clock = re.compile(spec["clock"]) if spec.get("clock") else None
        self._cache = {}

    def parse(self, name):
        """{stem, drive (float or None), token, vt (or None), label} of a cell name."""
        if name in self._cache:
            return self._cache[name]
        body, vt = name, None
        m = self.vt.search(name) if self.vt else None
        if m:
            vt, body = m.group("vt"), name[:m.start()]
        last = None
        for last in self.drive.finditer(body):
            pass
        if last is None:
            out = {"stem": body, "drive": None, "token": "", "vt": vt, "label": body + (" " + vt if vt else "")}
        else:
            token = last.group(0)
            drive = float(last.group("drive").replace("P", "."))
            stem = body[:last.start()]
            out = {"stem": stem, "drive": drive, "token": token, "vt": vt,
                   "label": stem + token + (" " + vt if vt else "")}
        self._cache[name] = out
        return out

    def variant(self, label):
        """(track, vt) of a variant label such as 9T-SVT; None for a part the label does not carry."""
        t = self.track.search(label or "")
        v = self.variant_vt.search(label or "")
        return (t.group("track") if t else None, v.group("vt") if v else None)


# ---------------------------------------------------------------- one file, digested

def read_cells(lib, naming, variant, keep=None):
    """Digest one facts library into compact cell records {name: rec}; `keep(rec)` limits which cells keep their
    delay arcs (every cell keeps pins, signature, class, area and leakage). rec: name, pins, sig, cls, area, leak,
    arcs, dont_use, vt, label, stem, drive."""
    sc = scales(lib)
    templates = templates_of(lib)
    track, vvt = naming.variant(variant)
    out = {}
    paused = gc.isenabled()
    gc.disable()
    try:
        _read_cells(lib, naming, variant, keep, sc, templates, track, vvt, out)
    finally:
        if paused:
            gc.enable()
    return out


def _read_cells(lib, naming, variant, keep, sc, templates, track, vvt, out):
    for cell in lib.get("cells") or []:
        name = cell.get("name")
        pins = pins_of(cell, sc["ff"])
        sig = signature(cell, pins)
        nm = naming.parse(name)
        attrs = cell.get("attrs") or {}
        clock = attrs.get("is_clock_cell") in (True, "true") or bool(naming.clock and naming.clock.search(name))
        rec = {"name": name, "pins": pins, "sig": sig, "cls": class_label(cell, pins, sig), "clock": clock,
               "area": num(cell.get("area")), "leak": leakage_nw(cell, sc["nw"]), "dont_use": dont_use(cell),
               "vt": nm["vt"] or vvt or "standard", "track": track, "label": nm["label"], "stem": nm["stem"],
               "drive": nm["drive"], "variant": variant, "arcs": None}
        if keep is None or keep(rec):
            rec["arcs"] = delay_arcs(cell, templates, sc["ps"])
        out[name] = rec


def is_inverter(rec):
    sig = rec["sig"]
    return bool(sig) and sig[0] == "comb" and len(sig[1]) == 1 and len(sig[2]) == 1 and sig[2][0][1] == 1


def reference_inverter(cells):
    """The median-input-capacitance inverter that is not a clock cell, not dont_use, and has 2-D delay and
    transition tables."""
    cands = []
    for rec in cells.values():
        if not is_inverter(rec) or rec["dont_use"] or rec.get("clock") or not rec["arcs"]:
            continue
        cap = rec["pins"][rec["sig"][1][0]]["cap"]
        arc = rec["arcs"][0]
        if cap and all(k in arc["t"] and len(arc["t"][k]["l"]) > 1 for k in DELAY_KINDS):
            cands.append((cap, rec["name"]))
    if not cands:
        return None
    cands.sort()
    return cands[(len(cands) - 1) // 2][1]


def fo4_point(cells, inverter):
    """{inverter, cap, slew} of the reference inverter's fanout-of-4 fixed point: the slew at which its own output
    transition at 4x its input capacitance equals its input slew."""
    rec = cells[inverter]
    cap = rec["pins"][rec["sig"][1][0]]["cap"]
    arc = rec["arcs"][0]
    slews = [x for x in arc["t"]["rise_transition"]["s"] if x > 0]
    s = math.exp(sum(math.log(x) for x in slews) / len(slews)) if slews else 10.0
    for _ in range(100):
        rise = lookup(arc["t"]["rise_transition"], s, 4 * cap)[0]
        fall = lookup(arc["t"]["fall_transition"], s, 4 * cap)[0]
        new = (rise + fall) / 2.0
        if abs(new - s) <= 1e-3 * s:
            s = new
            break
        s = new
    return {"inverter": inverter, "cap": cap, "slew": s}


# ---------------------------------------------------------------- numbers and output

def quantile(vals, p):
    v = sorted(vals)
    k = (len(v) - 1) * p
    f = int(math.floor(k))
    return v[f] + (v[min(f + 1, len(v) - 1)] - v[f]) * (k - f)


def box(vals):
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    return {"p5": rnd(quantile(vals, .05)), "p25": rnd(quantile(vals, .25)), "p50": rnd(quantile(vals, .5)),
            "p75": rnd(quantile(vals, .75)), "p95": rnd(quantile(vals, .95)), "mn": rnd(min(vals)),
            "mx": rnd(max(vals)), "n": len(vals)}


def rnd(x, digits=4):
    if x is None:
        return None
    if not math.isfinite(x):
        return None
    return round(float(x), digits)


def gm(a, b):
    return math.sqrt(a * b)


def check_finite(obj, where="rule"):
    if isinstance(obj, float) and not math.isfinite(obj):
        raise RuleError("%s holds a non-finite number" % where)
    if isinstance(obj, dict):
        for k, v in obj.items():
            check_finite(v, "%s.%s" % (where, k))
    elif isinstance(obj, (list, tuple)):
        for i, v in enumerate(obj):
            check_finite(v, "%s[%d]" % (where, i))


def write_rule(rule, path):
    check_finite(rule)
    text = json.dumps(rule, ensure_ascii=False, indent=1, allow_nan=False)
    if path in (None, "-"):
        print(text)
        return
    parent = os.path.dirname(os.path.abspath(path))
    if not os.path.isdir(parent):
        os.makedirs(parent)
    with open(path, "w") as stream:
        stream.write(text + "\n")


def clip(text, n):
    text = " ".join(str(text).split())
    return text if len(text) <= n else text[:n - 1].rstrip() + "…"


def pct(x, digits=1):
    """A signed percentage; a value that rounds to zero reads 0, never -0."""
    if x is None:
        return "unknown"
    x = round(x, digits)
    return ("%+." + str(digits) + "f%%") % x if x else ("%." + str(digits) + "f%%") % 0.0


def count_words(n, one, many=None):
    return "%s %s" % ("{:,}".format(n), one if n == 1 else (many or one + "s"))


def arc_words(arc_from, arc_to, edge=None):
    return "%s→%s%s" % (arc_from, arc_to, (" " + edge) if edge else "")
