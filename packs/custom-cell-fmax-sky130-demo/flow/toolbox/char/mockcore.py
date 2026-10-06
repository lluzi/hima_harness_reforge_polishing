"""Mock characterization: an RC timing model of a transistor netlist, anchored to foundry tables. No SPICE.

The model reads only a cell's sized netlist. It splits the netlist into channel-connected stages,
finds for every stage output the worst pull-up and pull-down series resistance through each gate
input, sums node capacitances, and predicts each NLDM entry from a few features of the worst stage
path (stage count, internal R*C per edge, last-stage R*C with the load, input slew and two
slew/RC blends). The coefficients per quantity are fitted by fit_mock.py to the foundry tt Liberty.

Mixing modelled cells into a foundry library is only fair when the model's error does not favour
them, so a custom arc is ANCHORED whenever a foundry arc corresponds to it (the cell's compareTo or
layoutFrom source with the same mapped pins and sense):

    custom table = foundry table * model(custom netlist) / model(foundry netlist)

An unchanged netlist reproduces the foundry table exactly, and a 2x pull-up changes it by what the
model says 2x does. Arcs without a foundry counterpart use the model alone, scaled by the fitted
median bias. Every arc records which of the two it got. Pure stdlib.
"""
import hashlib
import json
import math
import os

import charcore as cc

RAILS_POWER = ("VPWR", "VPB")
RAILS_GROUND = ("VGND", "VNB")
L_REF_UM = 0.15
MAX_PATHS = 64

BANNER_MOCK = ("MOCK: RC model of the pre-layout netlist anchored to foundry tables, no SPICE, tt 1.8V 25C; "
               "demo-grade timing, not measured")

FEATURES = ("one", "extraStages", "internalRise", "internalFall", "rcLast", "slew", "sqrtSlewRc",
            "slewRcBlend", "slewSlewBlend")

FIT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mock-fit.json")


def load_model(path=FIT_FILE):
    """The fitted model from mock-fit.json (fit_mock.py writes it); the fit's scores travel with it."""
    with open(path) as handle:
        fit = json.load(handle)
    if fit.get("schema") != "hima-mockchar-fit/1":
        raise cc.CharError("%s is not a hima-mockchar-fit/1 file" % path)
    return fit


# Starting point for fit_mock.py; characterization uses load_model()["model"].
MODEL = {
    "version": "mockchar/1",
    "cgPfPerUm": 0.0012,
    "c0Pf": 0.0004,
    "diffOverGate": 1.0,
    "wirePerNode": 0.0,
    "coef": {q: [0.0] * len(FEATURES) for q in cc.QUANTITIES},
    "bias": {q: 1.0 for q in cc.QUANTITIES},
    "floorNs": 0.002,
}


def model_fingerprint(model):
    return hashlib.sha256(json.dumps(model, sort_keys=True).encode()).hexdigest()[:16]


# ---------------------------------------------------------------- netlist

def parse_devices(text, subckt):
    """[(drain, gate, source, kind 'n'|'p', w_um, l_um)] of one subckt; X or M device lines."""
    lines = cc._join_continuations(text.splitlines())
    inside, devices = False, []
    for line in lines:
        words = line.split()
        if not words:
            continue
        head = words[0].lower()
        if head == ".subckt":
            inside = len(words) > 1 and words[1] == subckt
            continue
        if head.startswith(".ends"):
            if inside:
                break
            continue
        if not inside or head[0] not in "xm":
            continue
        params = dict(w.split("=", 1) for w in words if "=" in w)
        positional = [w for w in words[1:] if "=" not in w]
        if len(positional) < 5:
            continue
        drain, gate, source, _body, model = positional[:5]
        kind = "n" if "nfet" in model else ("p" if "pfet" in model else None)
        if kind is None:
            raise cc.CharError("device %s model %s is neither nfet nor pfet" % (words[0], model))
        w = cc._spice_number(params.get("w", "1"))
        l = cc._spice_number(params.get("l", str(L_REF_UM)))
        mult = cc._spice_number(params.get("m", params.get("mult", "1")))
        devices.append((drain, gate, source, kind, w * mult, l))
    if not devices:
        raise cc.CharError("subckt %s has no transistors" % subckt)
    return devices


class Stages:
    """Stage graph of a static CMOS netlist."""

    def __init__(self, devices, inputs, outputs, power=RAILS_POWER, ground=RAILS_GROUND):
        self.inputs, self.outputs = list(inputs), list(outputs)
        self.power, self.ground = set(power), set(ground)
        rails = self.power | self.ground
        self.gates, self.diff = {}, {}
        edges = {}
        for d, g, s, kind, w, l in devices:
            self.gates[g] = self.gates.get(g, 0.0) + w * l / L_REF_UM
            for net in (d, s):
                if net not in rails:
                    self.diff[net] = self.diff.get(net, 0.0) + w
            a, b = sorted((d, s))
            edges[(a, b, g, kind)] = edges.get((a, b, g, kind), 0.0) + w / (l / L_REF_UM)
        self.adj = {}
        for (a, b, g, kind), weff in edges.items():
            self.adj.setdefault(a, []).append((b, g, kind, 1.0 / weff))
            self.adj.setdefault(b, []).append((a, g, kind, 1.0 / weff))
        missing = [o for o in self.outputs if o not in self.adj]
        if missing:
            raise cc.CharError("outputs %s drive no transistor" % missing)
        nodes = set(self.gates) | set(self.outputs)
        self.nodes = sorted(n for n in nodes if n not in rails and n not in self.inputs and n in self.adj)
        self.pull = {}  # (node, gate, 'rise'|'fall') -> worst series resistance
        for node in self.nodes:
            for edge, kind, rails_to in (("rise", "p", self.power), ("fall", "n", self.ground)):
                for gate, r in self._worst_paths(node, kind, rails_to).items():
                    self.pull[(node, gate, edge)] = r
        self.drivers = {}
        for (node, gate, _edge) in self.pull:
            self.drivers.setdefault(gate, set()).add(node)

    def _worst_paths(self, node, kind, rails_to):
        """{gate: max series R of a conducting path node->rail that uses a switch gated by gate}."""
        worst, stops, budget = {}, set(self.nodes) - {node}, [MAX_PATHS * 50]

        def walk(net, seen, gates, r):
            for nxt, gate, k, rr in self.adj.get(net, ()):
                if k != kind or nxt in seen or budget[0] <= 0:
                    continue
                if nxt in rails_to:
                    budget[0] -= 1
                    for g in gates | {gate}:
                        worst[g] = max(worst.get(g, 0.0), r + rr)
                elif nxt not in stops and nxt not in self.power and nxt not in self.ground:
                    walk(nxt, seen | {nxt}, gates | {gate}, r + rr)

        walk(node, {node}, frozenset(), 0.0)
        return worst

    def node_cap(self, node, model):
        """Node capacitance in gate-width equivalents (um)."""
        return self.gates.get(node, 0.0) + model["diffOverGate"] * self.diff.get(node, 0.0) + model["wirePerNode"]

    def stage_paths(self, pin, out):
        """Simple stage paths pin -> ... -> out as [(gate, node), ...]."""
        paths = []

        def walk(net, seen, acc):
            for node in sorted(self.drivers.get(net, ())):
                if node in seen or len(paths) >= MAX_PATHS:
                    continue
                step = acc + [(net, node)]
                if node == out:
                    paths.append(step)
                elif node not in self.outputs or node in self.gates:
                    walk(node, seen | {node}, step)

        walk(pin, {pin}, [])
        return paths


# ---------------------------------------------------------------- model

def _other(edge):
    return "fall" if edge == "rise" else "rise"


def path_terms(stages, path, out_edge, model):
    """(stage count, internal R*C by edge, R of the last stage) for one output edge, or None."""
    k = len(path)
    internal, r_last = {"rise": 0.0, "fall": 0.0}, None
    for i, (gate, node) in enumerate(path):
        edge = out_edge if (k - 1 - i) % 2 == 0 else _other(out_edge)
        r = stages.pull.get((node, gate, edge))
        if r is None:
            return None
        if i == k - 1:
            r_last = r
        else:
            internal[edge] += r * stages.node_cap(node, model)
    return k, internal, r_last


def features(term, slew, c_last):
    k, internal, r_last = term
    rc = r_last * c_last
    return [1.0, k - 1.0, internal["rise"], internal["fall"], rc, slew, math.sqrt(slew * rc),
            slew * rc / (slew + rc), slew * slew / (slew + rc)]


def predict(model, quantity, term, slew, c_last):
    return sum(c * f for c, f in zip(model["coef"][quantity], features(term, slew, c_last)))


def out_cap(stages, out, model):
    return model["diffOverGate"] * stages.diff.get(out, 0.0) + model["wirePerNode"] + stages.gates.get(out, 0.0)


def arc_terms(stages, out, pin, sense, model):
    """{edge: [path terms]} for the stage paths of one arc whose inversion parity matches sense."""
    senses = ("positive_unate", "negative_unate") if sense == "non_unate" else (sense,)
    paths = []
    for one in senses:
        parity = 0 if one == "positive_unate" else 1
        paths += [p for p in stages.stage_paths(pin, out) if (len(p) - parity) % 2 == 0]
    result = {}
    for edge in ("rise", "fall"):
        terms = [t for t in (path_terms(stages, p, edge, model) for p in paths) if t]
        if terms:
            result[edge] = terms
    return result if len(result) == 2 else None


def model_tables(stages, out, pin, sense, index_1, index_2, model):
    """Raw model NLDM tables {quantity: rows} for one arc (worst stage path per entry), or None."""
    terms = arc_terms(stages, out, pin, sense, model)
    if terms is None:
        return None
    c_out = out_cap(stages, out, model)
    tables = {}
    for q in cc.QUANTITIES:
        edge = "rise" if "rise" in q else "fall"
        tables[q] = [[max(predict(model, q, t, slew, c_out + load / model["cgPfPerUm"]) for t in terms[edge])
                      for load in index_2] for slew in index_1]
    return tables


def pin_caps(stages, model):
    caps = {}
    for pin in stages.inputs:
        c = model["cgPfPerUm"] * stages.gates.get(pin, 0.0) + model["c0Pf"]
        caps[pin] = {"rise_capacitance": c, "fall_capacitance": c}
    return caps


def _floor(value, model):
    return value if abs(value) >= model["floorNs"] else math.copysign(model["floorNs"], value or 1.0)


def anchored(ref_tables, custom_model, ref_model, model):
    """foundry table * custom model / foundry model, entry by entry."""
    out = {}
    for q in cc.QUANTITIES:
        rows = []
        for ref_row, c_row, r_row in zip(ref_tables[q], custom_model[q], ref_model[q]):
            rows.append([ref * _floor(c, model) / _floor(r, model) for ref, c, r in zip(ref_row, c_row, r_row)])
        out[q] = rows
    return out


# ---------------------------------------------------------------- cells

def foundry_anchor(ref_cells, anchors, out, pin, sense):
    """(source name, source output, source input, liberty arc) of the first anchor that maps (pin, out)."""
    for source, mapping in anchors:
        ref = ref_cells.get(source)
        if ref is None:
            continue
        reverse = {mine: theirs for theirs, mine in mapping.items() if mine}
        src_out, src_in = reverse.get(out), reverse.get(pin)
        if not src_out or not src_in:
            continue
        for arc in ref["liberty"]["arcs"]:
            if arc["output"] == src_out and arc["input"] == src_in and arc.get("index_1") and \
                    arc["sense"] in (sense, "non_unate") and all(q in arc["tables"] for q in cc.QUANTITIES):
                return source, src_out, src_in, arc
    return None


def mock_cell(cell, text, index_1, index_2_by_output, ref_cells, anchors, model):
    """(arcs, caps, basis) for a normalized cell.

    ref_cells: {foundry name: {"stages": Stages, "liberty": charcore.read_cell(...)}}.
    anchors: [(foundry name, {foundry pin: custom pin or None})] in priority order.
    basis: {"anchored": [...arc tags], "model": [...arc tags]}."""
    stages = Stages(parse_devices(text, cell["subckt"]), cell["inputs"], cell["outputs"],
                    (cell["power"], cell["nwell"]), (cell["ground"], cell["pwell"]))
    arcs, basis = [], {"anchored": [], "model": []}
    for out in cell["outputs"]:
        tree = cc.parse_function(cell["functions"][out])
        for pin in cell["inputs"]:
            vectors = cc.sensitize(tree, cell["inputs"], pin)
            for sense in ("positive_unate", "negative_unate"):
                if not vectors[sense.split("_")[0]]:
                    continue
                tag = "%s->%s %s" % (pin, out, sense)
                anchor = foundry_anchor(ref_cells, anchors, out, pin, sense)
                tables = None
                if anchor:
                    source, src_out, src_in, ref_arc = anchor
                    i1, i2 = ref_arc["index_1"], ref_arc["index_2"]
                    mine = model_tables(stages, out, pin, sense, i1, i2, model)
                    theirs = model_tables(ref_cells[source]["stages"], src_out, src_in, sense, i1, i2, model)
                    if mine and theirs:
                        tables = anchored(ref_arc["tables"], mine, theirs, model)
                        tables = _resample(tables, i1, i2, index_1, index_2_by_output[out])
                        basis["anchored"].append("%s (%s %s->%s)" % (tag, source, src_in, src_out))
                if tables is None:
                    raw = model_tables(stages, out, pin, sense, index_1, index_2_by_output[out], model)
                    if raw is None:
                        raise cc.CharError("no %s stage path from %s to %s in the netlist" % (sense, pin, out))
                    tables = {q: [[v * model["bias"][q] for v in row] for row in raw[q]] for q in cc.QUANTITIES}
                    basis["model"].append(tag)
                tables = {q: _monotone_in_load(rows, model["floorNs"] if "transition" in q else None)
                          for q, rows in tables.items()}
                arcs.append({"output": out, "input": pin, "sense": sense, "vectors": vectors[sense.split("_")[0]][:1],
                             "tables": tables})
    return arcs, pin_caps(stages, model), basis


def _monotone_in_load(rows, floor=None):
    """Every row non-decreasing along the load axis (and at least `floor`), as STA expects of NLDM."""
    out = []
    for row in rows:
        fixed, last = [], None
        for value in row:
            value = value if floor is None else max(value, floor)
            last = value if last is None else max(value, last)
            fixed.append(last)
        out.append(fixed)
    return out


def _interp(xs, x):
    if x <= xs[0]:
        return 0, 1, (x - xs[0]) / (xs[1] - xs[0])
    for i in range(len(xs) - 1):
        if x <= xs[i + 1]:
            return i, i + 1, (x - xs[i]) / (xs[i + 1] - xs[i])
    n = len(xs) - 1
    return n - 1, n, (x - xs[n - 1]) / (xs[n] - xs[n - 1])


def _resample(tables, i1, i2, n1, n2):
    """Bilinear resample from the foundry arc's axes to the target axes (identity when equal)."""
    if list(i1) == list(n1) and list(i2) == list(n2):
        return tables
    out = {}
    for q, rows in tables.items():
        new = []
        for s in n1:
            a, b, fa = _interp(i1, s)
            row = []
            for l in n2:
                c, d, fc = _interp(i2, l)
                top = rows[a][c] + (rows[a][d] - rows[a][c]) * fc
                bot = rows[b][c] + (rows[b][d] - rows[b][c]) * fc
                row.append(top + (bot - top) * fa)
            new.append(row)
        out[q] = new
    return out


def anchor_list(entry):
    """[(foundry cell, {foundry pin: custom pin})] from a recipe entry: layoutFrom sources, then compareTo."""
    anchors = []
    for source in entry.get("layoutFrom") or []:
        name = source["cell"] if source["cell"].startswith("sky130_") else "sky130_fd_sc_hd__" + source["cell"]
        anchors.append((name, dict(source.get("pins") or {})))
    if entry.get("compareTo"):
        pins = list(entry["inputs"]) + list(entry["outputs"])
        anchors.append((entry["compareTo"], {p: p for p in pins}))
    return anchors


def foundry_stages(spice_text, lib_text, name):
    """{"stages", "liberty"} of one foundry cell, or None when it is not a usable combinational cell."""
    try:
        ref = cc.read_cell(lib_text, name)
        outputs = [p for p, v in ref["pins"].items() if v["direction"] == "output" and v["function"]]
        inputs = [p for p, v in ref["pins"].items() if v["direction"] == "input"]
        if not outputs or not inputs:
            return None
        return {"stages": Stages(parse_devices(spice_text, name), inputs, outputs), "liberty": ref}
    except cc.CharError:
        return None
