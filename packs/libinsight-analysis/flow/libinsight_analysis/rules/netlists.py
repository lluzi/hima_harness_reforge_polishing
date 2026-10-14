"""Netlists for the example rules: cell transistor netlists (SPICE/CDL) and gate-level Verilog designs.

`read_spice` keeps only the cells asked for; `input_devices` says where an arc's input sits in the circuit (the
devices it drives, their size and their place in the series stack, counted from the output). `Design` flattens a
structural Verilog netlist so a timing report's net can be traced to every pin it drives.
Standard library only; Python 3.6 through 3.12.
"""
import gzip
import re
from collections import deque

RAIL = re.compile(r"^(V(DD|SS|CC|PP|BB|NW|PW|DDL|DDH|DDR)\w*|GND\w*|VSSX?|VDDX?)$", re.I)
_SUFFIX = {"t": 1e12, "g": 1e9, "meg": 1e6, "k": 1e3, "m": 1e-3, "u": 1e-6, "n": 1e-9, "p": 1e-12, "f": 1e-15,
           "a": 1e-18}


def _open(path):
    return gzip.open(path, "rt") if path.endswith(".gz") else open(path)


def spice_number(text):
    m = re.match(r"^([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)(meg|[tgkmunpfa])?", text.strip().lower())
    if not m:
        return None
    return float(m.group(1)) * _SUFFIX.get(m.group(2) or "", 1.0)


def _lines(path):
    """Logical SPICE lines (continuations joined, comments dropped)."""
    pending = None
    with _open(path) as stream:
        for raw in stream:
            line = raw.rstrip("\n")
            if line.startswith("+"):
                pending = (pending or "") + " " + line[1:]
                continue
            if pending is not None:
                yield pending
            pending = None if (not line.strip() or line.lstrip().startswith("*")) else line.split("$")[0]
    if pending is not None:
        yield pending


def read_spice(paths, wanted):
    """{cell: {pins, devices}} for the cells in `wanted` found in the SPICE/CDL files. A device is
    {name, type ('n'|'p'), d, g, s, b, w (um), l (um), count}."""
    wanted = set(wanted)
    out, cur = {}, None
    for path in paths:
        for line in _lines(path):
            words = line.split()
            if not words:
                continue
            head = words[0].lower()
            if head == ".subckt":
                cur = None
                if len(words) > 1 and words[1] in wanted:
                    cur = {"pins": [w for w in words[2:] if "=" not in w], "devices": []}
                    out[words[1]] = cur
            elif head == ".ends":
                cur = None
            elif cur is not None and head.startswith("m") and len(words) >= 6:
                params = dict((k.lower(), v) for k, v in (w.split("=", 1) for w in words[6:] if "=" in w))
                model = words[5].lower()
                kind = "p" if model.startswith("p") else "n" if model.startswith("n") else (
                    "p" if words[4].upper().startswith(("VDD", "VCC", "VPP", "VNW")) else "n")
                w = spice_number(params.get("w", "")) if params.get("w") else None
                l = spice_number(params.get("l", "")) if params.get("l") else None
                count = 1
                for key in ("nf", "m"):
                    if key in params:
                        v = spice_number(params[key])
                        count *= int(round(v)) if v else 1
                cur["devices"].append({"name": words[0], "type": kind, "d": words[1], "g": words[2], "s": words[3],
                                       "b": words[4], "w": None if w is None else w * 1e6 * count,
                                       "l": None if l is None else l * 1e6, "count": count})
    return out


def _groups(devices):
    """Parallel fingers merged: one entry per (type, gate, channel ends)."""
    merged = {}
    for d in devices:
        key = (d["type"], d["g"], tuple(sorted((d["d"], d["s"]))))
        m = merged.get(key)
        if m is None:
            merged[key] = dict(d, names=[d["name"]])
        else:
            m["w"] = (m["w"] or 0) + (d["w"] or 0) if (m["w"] is not None or d["w"] is not None) else None
            m["count"] += d["count"]
            m["names"].append(d["name"])
    return list(merged.values())


def input_devices(sub, pin, output):
    """Where input `pin` sits in the circuit: [{device, type, w, l, fingers, position, stack}], position counted in
    series devices from the stage's output node (1 = next to it), stack the series height on that path."""
    groups = _groups(sub["devices"])
    rails = set(p for p in sub["pins"] if RAIL.match(p))
    gates = set(g["g"] for g in groups)
    nodes = set([output]) | (gates - set(sub["pins"]))

    def neighbours(net, kind):
        for g in groups:
            if g["type"] == kind and net in (g["d"], g["s"]):
                yield g, g["s"] if g["d"] == net else g["d"]

    def distance(start, kind, goal, skip):
        seen, queue = set([start]), deque([(start, 0)])
        while queue:
            net, k = queue.popleft()
            if goal(net) and k:
                return k
            if net in rails and k:
                continue
            for g, other in neighbours(net, kind):
                if g is skip or other in seen:
                    continue
                seen.add(other)
                queue.append((other, k + 1))
        return None

    out = []
    for g in groups:
        if g["g"] != pin:
            continue
        best = None
        for end, far in ((g["d"], g["s"]), (g["s"], g["d"])):
            if end in rails:
                continue
            up = 0 if end in nodes else distance(end, g["type"], lambda n: n in nodes, g)
            down = 0 if far in rails else distance(far, g["type"], lambda n: n in rails, g)
            if up is None or down is None:
                continue
            cand = (up + 1, up + 1 + down)
            if best is None or cand < best:
                best = cand
        out.append({"device": "/".join(g["names"][:3]), "type": g["type"],
                    "w": None if g["w"] is None else round(g["w"], 4), "l": None if g["l"] is None else round(g["l"], 4),
                    "fingers": g["count"], "position": best[0] if best else None, "stack": best[1] if best else None})
    out.sort(key=lambda d: (d["type"], d["position"] or 99, d["device"]))
    return out


# ---------------------------------------------------------------- gate-level Verilog

_ESC = re.compile(r"\\(\S+)\s")


def _statements(text):
    text = re.sub(r"/\*.*?\*/", " ", text, flags=re.S)
    text = re.sub(r"//[^\n]*", " ", text)
    text = _ESC.sub(lambda m: m.group(1).replace("[", "\x01").replace("]", "\x02") + " ", text)
    for stmt in text.split(";"):
        stmt = " ".join(stmt.split())
        if stmt:
            yield stmt


def _unesc(name):
    return name.replace("\x01", "[").replace("\x02", "]")


class Design(object):
    """A flattened gate-level netlist: which leaf pins each net (by its hierarchical report name) connects."""

    def __init__(self, path, top=None):
        with _open(path) as stream:
            text = stream.read()
        self.modules = {}
        cur = None
        for stmt in _statements(text):
            if stmt.startswith("endmodule"):
                stmt = stmt[len("endmodule"):].strip()
                cur = None
                if not stmt:
                    continue
            m = re.match(r"^module\s+(\S+?)\s*(\(.*\))?$", stmt)
            if m:
                cur = {"name": m.group(1), "width": {}, "dirs": {}, "ports": [], "insts": [], "assigns": []}
                if m.group(2):
                    cur["ports"] = [p.strip() for p in m.group(2).strip("()").split(",") if p.strip()]
                self.modules[cur["name"]] = cur
                continue
            if cur is None:
                continue
            m = re.match(r"^(input|output|inout|wire|tri|supply0|supply1)\s*(\[\s*(\d+)\s*:\s*(\d+)\s*\])?\s*(.*)$", stmt)
            if m:
                rng = (int(m.group(3)), int(m.group(4))) if m.group(2) else None
                for name in m.group(5).split(","):
                    name = name.strip()
                    if name:
                        cur["width"][name] = rng
                        if m.group(1) in ("input", "output", "inout"):
                            cur["dirs"][name] = m.group(1)
                continue
            m = re.match(r"^assign\s+(.+?)\s*=\s*(.+)$", stmt)
            if m:
                cur["assigns"].append((m.group(1), m.group(2)))
                continue
            m = re.match(r"^(\S+)\s+(?:#\s*\(.*?\)\s*)?(\S+)\s*\((.*)\)$", stmt)
            if m:
                conns = dict((p, e.strip()) for p, e in re.findall(r"\.(\w+)\s*\(([^()]*)\)", m.group(3)))
                cur["insts"].append((m.group(1), m.group(2), conns))
        used = set(t for mod in self.modules.values() for t, _, _ in mod["insts"])
        tops = [n for n in self.modules if n not in used]
        self.top = top if top in self.modules else (tops[-1] if tops else None)
        self.parent = {}
        self.sinks = {}                                       # net bit -> [(instance, cell, pin)]
        if self.top:
            self._flatten(self.top, "", None)
        self._grouped = {}
        for bit, conns in self.sinks.items():
            self._grouped.setdefault(self._find(bit), []).extend(conns)

    def _bits(self, mod, expr):
        expr = expr.strip()
        if not expr:
            return []
        if expr.startswith("{"):
            out = []
            for part in _split_top(expr[1:-1]):
                out += self._bits(mod, part)
            return out
        if re.match(r"^\d*'[bBhHdD]", expr):
            return [None]
        m = re.match(r"^(\S+?)\[(\d+)(?::(\d+))?\]$", expr)
        if m and m.group(1) in mod["width"]:
            a, b = int(m.group(2)), int(m.group(3) if m.group(3) is not None else m.group(2))
            step = -1 if a >= b else 1
            return ["%s[%d]" % (m.group(1), i) for i in range(a, b + step, step)]
        rng = mod["width"].get(expr)
        if rng is None:
            return [_unesc(expr)]
        a, b = rng
        step = -1 if a >= b else 1
        return ["%s[%d]" % (expr, i) for i in range(a, b + step, step)]

    def _find(self, x):
        root = x
        while self.parent.get(root, root) != root:
            root = self.parent[root]
        while x != root:
            nxt = self.parent.get(x, x)
            self.parent[x] = root
            x = nxt
        return root

    def _union(self, a, b):
        ra, rb = self._find(a), self._find(b)
        if ra != rb:
            self.parent[ra] = rb

    def _flatten(self, name, prefix, port_map):
        mod = self.modules[name]

        def local(bit):
            return prefix + bit
        if port_map:
            for port, outer in port_map:
                if outer is not None:
                    self._union(local(port), outer)
        for lhs, rhs in mod["assigns"]:
            for a, b in zip(self._bits(mod, lhs), self._bits(mod, rhs)):
                if a and b:
                    self._union(local(a), local(b))
        for cell, inst, conns in mod["insts"]:
            child = self.modules.get(cell)
            if child is not None:
                pairs = []
                for port, expr in conns.items():
                    outer = [None if b is None else local(b) for b in self._bits(mod, expr)]
                    inner = self._bits(child, port)
                    pairs += list(zip(inner, outer))
                self._flatten(cell, prefix + _unesc(inst) + "/", pairs)
                continue
            for pin, expr in conns.items():
                bits = self._bits(mod, expr)
                if len(bits) == 1 and bits[0] is not None:
                    self.sinks.setdefault(local(bits[0]), []).append((prefix + _unesc(inst), cell, pin))

    def pins_on(self, net):
        """[(instance, cell, pin)] of every leaf pin on the net named as a timing report names it; None when the
        netlist does not have that net."""
        if net not in self.parent and net not in self.sinks:
            return None
        return self._grouped.get(self._find(net), [])


def _split_top(text):
    out, depth, cur = [], 0, ""
    for ch in text:
        if ch == "," and depth == 0:
            out.append(cur)
            cur = ""
            continue
        depth += ch == "{"
        depth -= ch == "}"
        cur += ch
    if cur.strip():
        out.append(cur)
    return out
