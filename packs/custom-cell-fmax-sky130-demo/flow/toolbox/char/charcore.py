"""Core of the SPICE characterizer: pure Python 3 (stdlib), no ngspice needed to import or unit-test.

Pieces: Liberty function parsing and arc sensitization, extracted-netlist sanitizing, ngspice deck
building and measurement parsing, a small Liberty reader, the Liberty writer, and calibration math.
characterize.py and calibrate.py drive these; the tests in test/contract/support/cellfmax_char_test.py
exercise them directly.
"""
import hashlib
import itertools
import json
import math
import re

# ---------------------------------------------------------------- method (changing it changes the fingerprint)

METHOD = {
    "version": "cellchar/1",
    "corner": "tt",
    "models": "/foss/pdks/sky130A/libs.tech/ngspice/sky130.lib.spice",
    "vdd": 1.8,
    "tempC": 25,
    "delayThresholdPct": 50,
    "slewLowerPct": 20,
    "slewUpperPct": 80,
    "slewDerate": 1.0,
    # index_1 is the 20-80 % input transition. The input is a linear ramp whose 0-100 % time is
    # 1.4 x index_1 (a pure 20-80 ramp would be 1/0.6 = 1.67): fitted on the foundry calibration set,
    # where 1.4 removes the slew-dependent residual (1.67 and 1.25 leave -5..+4 % trends across slews).
    "rampFullOverSlew": 1.4,
    # only the device models the netlists use are loaded (identical results, ~20 s less per process)
    "modelSubset": "corner device files + all.spice parameters",
    "edgeStartNs": 0.05,
    "settleBaseNs": 0.5,
    "settleNsPerPf": 80.0,
    "settleRetryFactors": [1, 3, 9],
    "tranStepNs": 0.001,
    "tranMaxStepNs": 0.02,
    "spiceOptions": "reltol=1e-3 abstol=1e-13 vntol=1e-6 chgtol=1e-16",
    "otherOutputLoadPf": 0.0017,
    "capSlewIndex": 2,
    "capLoadIndex": 2,
    "maxVectorsPerSense": 4,
    "nonUnate": "split",  # one timing group per sense, as the sky130 foundry Liberty does
}

QUANTITIES = ("cell_rise", "cell_fall", "rise_transition", "fall_transition")
CAP_QUANTITIES = ("rise_capacitance", "fall_capacitance")

PG_PINS_TEXT = """        pg_pin ("VGND") {
            pg_type : "primary_ground";
            related_bias_pin : "VPB";
            voltage_name : "VGND";
        }
        pg_pin ("VNB") {
            pg_type : "nwell";
            physical_connection : "device_layer";
            voltage_name : "VNB";
        }
        pg_pin ("VPB") {
            pg_type : "pwell";
            physical_connection : "device_layer";
            voltage_name : "VPB";
        }
        pg_pin ("VPWR") {
            pg_type : "primary_power";
            related_bias_pin : "VNB";
            voltage_name : "VPWR";
        }
"""

BANNER = "SPICE-characterized from extracted layout, tt 1.8V 25C, calibrated"
BANNER_PRELAYOUT = ("MODELLED: SPICE-characterized from the pre-layout netlist (no layout parasitics), "
                    "tt 1.8V 25C, calibrated against foundry schematics")
BANNER_RAW = "SPICE-characterized from extracted layout, tt 1.8V 25C, UNCALIBRATED (not for measured arms)"


class CharError(Exception):
    """A failure with a message that says what must change."""


def method_fingerprint(method=None):
    data = json.dumps(method or METHOD, sort_keys=True).encode()
    return hashlib.sha256(data).hexdigest()[:16]


# ---------------------------------------------------------------- Liberty function strings

_TOKEN = re.compile(r"\s*(?:([A-Za-z_][A-Za-z0-9_\[\]]*)|([01])\b|(.))")


def _tokens(text):
    out = []
    pos = 0
    text = text.strip()
    while pos < len(text):
        match = _TOKEN.match(text, pos)
        if not match or match.end() == pos:
            break
        pos = match.end()
        if match.group(1):
            out.append(("id", match.group(1)))
        elif match.group(2):
            out.append(("const", int(match.group(2))))
        elif match.group(3) and not match.group(3).isspace():
            out.append(("op", match.group(3)))
    return out


def parse_function(text):
    """Parse a Liberty `function` string into a nested tuple.

    Operators (highest first): postfix ', prefix !, ^, & * or juxtaposition, | +.
    Nodes: ("var", name) ("const", 0|1) ("not", a) ("and", a, b) ("or", a, b) ("xor", a, b)."""
    toks = _tokens(text)
    pos = [0]

    def peek():
        return toks[pos[0]] if pos[0] < len(toks) else (None, None)

    def take():
        tok = peek()
        pos[0] += 1
        return tok

    def starts_operand(tok):
        return tok[0] in ("id", "const") or tok == ("op", "(") or tok == ("op", "!")

    def primary():
        tok = take()
        if tok[0] == "id":
            node = ("var", tok[1])
        elif tok[0] == "const":
            node = ("const", tok[1])
        elif tok == ("op", "("):
            node = or_expr()
            if take() != ("op", ")"):
                raise CharError("function %r: missing ')'" % text)
        else:
            raise CharError("function %r: unexpected %r" % (text, tok[1]))
        while peek() == ("op", "'"):
            take()
            node = ("not", node)
        return node

    def unary():
        if peek() == ("op", "!"):
            take()
            return ("not", unary())
        return primary()

    def xor_expr():
        node = unary()
        while peek() == ("op", "^"):
            take()
            node = ("xor", node, unary())
        return node

    def and_expr():
        node = xor_expr()
        while True:
            tok = peek()
            if tok in (("op", "&"), ("op", "*")):
                take()
                node = ("and", node, xor_expr())
            elif tok[0] is not None and starts_operand(tok):
                node = ("and", node, xor_expr())
            else:
                return node

    def or_expr():
        node = and_expr()
        while peek() in (("op", "|"), ("op", "+")):
            take()
            node = ("or", node, and_expr())
        return node

    if not toks:
        raise CharError("empty function")
    tree = or_expr()
    if pos[0] != len(toks):
        raise CharError("function %r: trailing %r" % (text, toks[pos[0]][1]))
    return tree


def eval_function(tree, env):
    kind = tree[0]
    if kind == "var":
        if tree[1] not in env:
            raise CharError("function uses %s, which is not an input pin" % tree[1])
        return bool(env[tree[1]])
    if kind == "const":
        return bool(tree[1])
    if kind == "not":
        return not eval_function(tree[1], env)
    a, b = eval_function(tree[1], env), eval_function(tree[2], env)
    if kind == "and":
        return a and b
    if kind == "or":
        return a or b
    return a != b


def function_vars(tree, acc=None):
    acc = set() if acc is None else acc
    if tree[0] == "var":
        acc.add(tree[1])
    elif tree[0] != "const":
        for child in tree[1:]:
            function_vars(child, acc)
    return acc


def sensitize(function, inputs, pin):
    """Side-input assignments under which `pin` toggles the output.

    Returns {"positive": [env...], "negative": [env...]}; env maps every other input to 0/1.
    positive: output follows the pin; negative: output is the pin's inverse."""
    tree = parse_function(function) if isinstance(function, str) else function
    unknown = function_vars(tree) - set(inputs)
    if unknown:
        raise CharError("function uses %s, which are not input pins %s" % (sorted(unknown), list(inputs)))
    others = [name for name in inputs if name != pin]
    result = {"positive": [], "negative": []}
    for bits in itertools.product((0, 1), repeat=len(others)):
        env = dict(zip(others, bits))
        low = eval_function(tree, dict(env, **{pin: 0}))
        high = eval_function(tree, dict(env, **{pin: 1}))
        if low != high:
            result["positive" if high else "negative"].append(env)
    return result


def timing_sense(vectors):
    pos, neg = bool(vectors["positive"]), bool(vectors["negative"])
    if pos and neg:
        return "non_unate"
    if pos:
        return "positive_unate"
    if neg:
        return "negative_unate"
    return None


def pick_vectors(envs, limit):
    """Up to `limit` assignments, evenly spread over the sorted list (deterministic)."""
    if len(envs) <= limit:
        return list(envs)
    step = (len(envs) - 1) / float(limit - 1) if limit > 1 else 0
    return [envs[int(round(i * step))] for i in range(limit)]


# ---------------------------------------------------------------- extracted netlists

def _join_continuations(lines):
    out = []
    for line in lines:
        if line.startswith("+") and out:
            out[-1] = out[-1] + " " + line[1:].strip()
        else:
            out.append(line)
    return out


def subckt_ports(text, subckt):
    for line in _join_continuations(text.splitlines()):
        tok = line.split()
        if len(tok) >= 2 and tok[0].lower() == ".subckt" and tok[1] == subckt:
            return [t for t in tok[2:] if "=" not in t]
    raise CharError("subckt %s not found in the netlist" % subckt)


def sanitize_netlist(text, subckt, power, ground):
    """Make a Magic/LibreCell extracted subckt simulate cleanly.

    - strips the ` **FLOATING` comments Magic appends to some capacitor lines (ngspice rejects them);
    - ties floating well/substrate nodes: a pfet bulk that is not a port -> `power`, an nfet bulk
      that is not a port -> `ground`, and a non-port `VSUBS` -> `ground`;
    - drops capacitors/resistors whose two terminals became one node.
    Returns (text, report)."""
    lines = _join_continuations(text.splitlines())
    stripped = 0
    clean = []
    for line in lines:
        new = re.sub(r"\s*\*\*FLOATING\s*$", "", line)
        if new != line:
            stripped += 1
        clean.append(new)
    start = end = None
    for index, line in enumerate(clean):
        tok = line.split()
        if start is None and len(tok) >= 2 and tok[0].lower() == ".subckt" and tok[1] == subckt:
            start = index
        elif start is not None and tok and tok[0].lower() == ".ends":
            end = index
            break
    if start is None or end is None:
        raise CharError("subckt %s (with .ends) not found in the netlist" % subckt)
    ports = [t for t in clean[start].split()[2:] if "=" not in t]
    for name in (power, ground):
        if name not in ports:
            raise CharError("subckt %s has no port %s (ports: %s); set pins.power/pins.ground" % (subckt, name, " ".join(ports)))
    ties = {}
    for line in clean[start + 1:end]:
        tok = line.split()
        if not tok:
            continue
        head = tok[0][0].upper()
        nodes = [t for t in tok[1:] if "=" not in t]
        if head == "X" and len(nodes) >= 5:
            model, bulk = nodes[-1].lower(), nodes[3]
        elif head == "M" and len(nodes) >= 5:
            model, bulk = nodes[4].lower(), nodes[3]
        else:
            for t in nodes:
                if t.upper() == "VSUBS" and t not in ports:
                    ties[t] = ground
            continue
        if bulk in ports:
            continue
        if "pfet" in model or "pmos" in model:
            ties[bulk] = power
        elif "nfet" in model or "nmos" in model:
            ties[bulk] = ground
    dropped = 0
    body = []
    for line in clean[start + 1:end]:
        tok = line.split()
        if not tok or tok[0].startswith("*"):
            body.append(line)
            continue
        renamed = [tok[0]] + [ties.get(t, t) for t in tok[1:]]
        if tok[0][0].upper() in ("C", "R") and len(renamed) >= 3 and renamed[1] == renamed[2]:
            dropped += 1
            continue
        body.append(" ".join(renamed))
    out = clean[:start + 1] + body + clean[end:]
    report = {"floatingCommentsStripped": stripped, "tied": dict(sorted(ties.items())),
              "selfLoopElementsDropped": dropped, "ports": ports}
    return "\n".join(out) + "\n", report


# Pre-layout parasitic estimate for schematic netlists (no layout). Diffusion geometry follows the
# Magic extractions of the foundry sky130_fd_sc_hd cells: a diffusion shared by exactly two devices
# of one type (a series node) is 0.14 um long per side, any other diffusion (rails, outputs, parallel
# nodes) 0.265 um; plus a grounded wiring capacitance per signal net and terminal. On input pins it
# grows with the cell's device count: an input that drives gates across a bigger cell has longer wires
# (fa_1/ha_1 inputs read 20-30 % low without this). The pre-layout calibration absorbs what this leaves
# out on average.
PRELAYOUT_PARASITICS = {"version": "prelayout-3", "sharedDiffUm": 0.14, "endDiffUm": 0.265,
                        "wireCapFfPerTerminal": 0.1, "inputSizeRefDevices": 6, "inputSizeExponent": 0.65}


_SI = {"meg": 1e6, "k": 1e3, "m": 1e-3, "u": 1e-6, "n": 1e-9, "p": 1e-12, "f": 1e-15}


def _spice_number(text):
    """A SPICE number with an optional SI suffix, in netlist units (650000u -> 0.65)."""
    match = re.match(r"(?i)([0-9.]+(?:e[+-]?[0-9]+)?)(meg|k|m|u|n|p|f)?", text)
    return float(match.group(1)) * (_SI[match.group(2).lower()] if match.group(2) else 1.0)


def add_prelayout_parasitics(text, subckt, inputs=None, rails=("VPWR", "VGND", "VPB", "VNB"), model=PRELAYOUT_PARASITICS):
    """Add ad/as/pd/ps to every MOSFET that lacks them and a grounded wiring cap per signal net.

    `inputs` names the input pins; when omitted, every port that only drives gates counts as one."""
    lines = _join_continuations(text.splitlines())
    start = next((i for i, l in enumerate(lines) if l.split()[:2] and l.split()[0].lower() == ".subckt"
                  and len(l.split()) > 1 and l.split()[1] == subckt), None)
    if start is None:
        raise CharError("subckt %s not found in the netlist" % subckt)
    end = next(i for i in range(start + 1, len(lines)) if lines[i].split()[:1] and lines[i].split()[0].lower() == ".ends")
    devices = []
    for i in range(start + 1, end):
        tok = lines[i].split()
        if tok and tok[0][0].upper() in "XM" and len([t for t in tok[1:] if "=" not in t]) >= 5:
            nodes = [t for t in tok[1:] if "=" not in t]
            kind = "p" if "pfet" in nodes[4].lower() or "pmos" in nodes[4].lower() else "n"
            devices.append((i, tok, nodes, kind))
    diff = {}
    for _i, _tok, nodes, kind in devices:
        for node in (nodes[0], nodes[2]):
            diff.setdefault(node, []).append(kind)
    terminals = {}
    for _i, _tok, nodes, _kind in devices:
        for node in nodes[:3]:
            terminals[node] = terminals.get(node, 0) + 1
    for i, tok, nodes, kind in devices:
        params = {t.split("=", 1)[0].lower() for t in tok[1:] if "=" in t}
        if {"ad", "as", "pd", "ps"} & params:
            continue
        w = _spice_number(re.search(r"(?i)\bw=(\S+)", lines[i]).group(1))
        extra = []
        for key, node in (("d", nodes[0]), ("s", nodes[2])):
            shared = node not in rails and diff.get(node) in (["n", "n"], ["p", "p"])
            length = model["sharedDiffUm"] if shared else model["endDiffUm"]
            perimeter = w + 2 * length if shared else 2 * (w + length)
            extra += ["a%s=%.5g" % (key, w * length), "p%s=%.5g" % (key, perimeter)]
        lines[i] = lines[i] + " " + " ".join(extra)
    if inputs is None:
        ports = lines[start].split()[2:]
        inputs = [p for p in ports if p not in rails and p not in diff]
    scale = max(1.0, len(devices) / model["inputSizeRefDevices"]) ** model["inputSizeExponent"]
    caps = ["Cpre_%d %s %s %.4gf" % (k, net, rails[1], model["wireCapFfPerTerminal"] * count * (scale if net in inputs else 1.0))
            for k, (net, count) in enumerate(sorted(terminals.items())) if net not in rails]
    return "\n".join(lines[:end] + caps + lines[end:]) + "\n"


def netlist_devices(text):
    """Foundry device models (sky130_fd_pr__*) instantiated in a netlist."""
    return sorted(set(re.findall(r"\b(sky130_fd_pr__[A-Za-z0-9_]+)", text)))


def _abs(base_dir, rel):
    return rel if rel.startswith("/") else _norm(base_dir + "/" + rel)


def _norm(path):
    parts = []
    for part in path.split("/"):
        if part == "..":
            parts.pop()
        elif part not in ("", "."):
            parts.append(part)
    return "/" + "/".join(parts)


def _includes(text):
    return re.findall(r'(?im)^\s*\.include\s+"?([^"\s]+)"?', text)


def reduced_models(models_lib, corner, devices, read=None):
    """Text of a model file that loads only `devices` from the `corner` section of the sky130 ngspice
    library: the section's .param lines, the device files named <device>__* from corners/<corner>.spice,
    and all.spice without its own includes (it carries `.option scale` and shared parameters).
    Raises CharError when a device has no file there (use the full library then)."""
    read = read or (lambda path: open(path).read())
    root = models_lib.rsplit("/", 1)[0]
    text = read(models_lib)
    match = re.search(r"(?ims)^\.lib\s+%s\s*$(.*?)^\.endl\b" % re.escape(corner), text)
    if not match:
        raise CharError("corner %s not found in %s" % (corner, models_lib))
    section = match.group(1)
    out = ["* reduced %s models for %s" % (corner, " ".join(devices))]
    out += [line for line in section.splitlines() if line.strip().lower().startswith(".param")]
    corner_files = [_abs(root, inc) for inc in _includes(section) if inc.endswith("corners/%s.spice" % corner)]
    if not corner_files:
        raise CharError("corner file corners/%s.spice not included by %s" % (corner, models_lib))
    corner_dir = corner_files[0].rsplit("/", 1)[0]
    corner_includes = [_abs(corner_dir, inc) for inc in _includes(read(corner_files[0]))]
    for device in devices:
        short = device + "__"
        files = [p for p in corner_includes if p.rsplit("/", 1)[1].startswith(short)]
        if not files:
            raise CharError("no %s model file for %s in corners/%s.spice" % (corner, device, corner))
        out += ['.include "%s"' % p for p in files]
    all_files = [p for p in corner_includes if p.endswith("/all.spice")]
    if not all_files:
        raise CharError("corners/%s.spice does not include all.spice" % corner)
    all_dir = all_files[0].rsplit("/", 1)[0]
    for line in read(all_files[0]).splitlines():
        incs = _includes(line)
        if incs:
            if incs[0].endswith("parameters/lod.spice"):
                out.append('.include "%s"' % _abs(all_dir, incs[0]))
            continue
        out.append(line)
    return "\n".join(out) + "\n"


# ---------------------------------------------------------------- cell jobs and units

def normalize_cell(cell):
    """Validate one job entry; return a normalized dict. Raises CharError naming the field."""
    name = cell.get("name")
    if not isinstance(name, str) or not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", name):
        raise CharError("cell name %r must be an identifier" % name)
    pins = cell.get("pins") or {}
    inputs, outputs = pins.get("inputs") or [], pins.get("outputs") or []
    if not inputs or not outputs:
        raise CharError("cell %s needs pins.inputs and pins.outputs" % name)
    functions = cell.get("functions") or {}
    if not functions and isinstance(cell.get("function"), str) and len(outputs) == 1:
        functions = {outputs[0]: cell["function"]}
    if set(functions) != set(outputs):
        raise CharError("cell %s needs one function per output %s (got %s)" % (name, outputs, sorted(functions)))
    for out, text in functions.items():
        parse_function(text)
        unknown = function_vars(parse_function(text)) - set(inputs)
        if unknown:
            raise CharError("cell %s output %s function uses non-input %s" % (name, out, sorted(unknown)))
    area = cell.get("area_um2")
    if not isinstance(area, (int, float)) or area <= 0:
        raise CharError("cell %s needs a positive area_um2" % name)
    return {
        "name": name,
        "spice": cell.get("spice"),
        "subckt": cell.get("subckt") or name,
        "power": pins.get("power") or "VPWR",
        "ground": pins.get("ground") or "VGND",
        "nwell": pins.get("nwell") or "VPB",
        "pwell": pins.get("pwell") or "VNB",
        "inputs": list(inputs),
        "outputs": list(outputs),
        "functions": dict(functions),
        "area": float(area),
        "footprint": cell.get("footprint") or name,
        "lef": cell.get("lef"),
        "index_ref": cell.get("index_ref"),
        "index_1": cell.get("index_1"),
        "index_2": cell.get("index_2"),
        "anchors": cell.get("anchors") or [],
    }


def port_roles(ports, cell):
    """Top-level node for every subckt port, or CharError naming an unknown port."""
    nodes = {}
    for port in ports:
        if port in cell["inputs"] or port in cell["outputs"]:
            nodes[port] = port
        elif port in (cell["power"], cell["nwell"], "VPWR", "VPB"):
            nodes[port] = "vdd"
        elif port in (cell["ground"], cell["pwell"], "VGND", "VNB"):
            nodes[port] = "0"
        else:
            raise CharError("subckt port %s is neither a signal pin nor power/ground/well; name it in pins" % port)
    missing = [p for p in cell["inputs"] + cell["outputs"] if p not in ports]
    if missing:
        raise CharError("subckt %s lacks signal ports %s" % (cell["subckt"], missing))
    return nodes


def plan_units(cell, method=METHOD):
    """One simulation unit per (output, input, sensitizing vector)."""
    units = []
    for out in cell["outputs"]:
        tree = parse_function(cell["functions"][out])
        for pin in cell["inputs"]:
            vectors = sensitize(tree, cell["inputs"], pin)
            for sense in ("positive", "negative"):
                for k, env in enumerate(pick_vectors(vectors[sense], method["maxVectorsPerSense"])):
                    units.append({"cell": cell["name"], "output": out, "input": pin, "sense": sense,
                                  "vector": env, "vectorIndex": k})
    return units


def unit_id(unit):
    vec = "".join("%s%d" % (k, v) for k, v in sorted(unit["vector"].items())) or "none"
    return "%s__%s__%s__%s__%s" % (unit["cell"], unit["input"], unit["output"], unit["sense"][:3], vec)


def edge_plan(index_1, max_load_pf, method, settle_factor=1.0):
    """Timeline: input rises at t0, falls at t1; returns dict of times in ns."""
    ramps = [s * method["rampFullOverSlew"] for s in index_1]
    settle = (method["settleBaseNs"] + method["settleNsPerPf"] * max_load_pf) * settle_factor
    t0 = method["edgeStartNs"]
    t1 = t0 + max(ramps) + settle
    tstop = t1 + max(ramps) + settle
    return {"ramps": ramps, "t0": t0, "t1": t1, "tstop": tstop}


def build_deck(cell, ports, unit, index_1, index_2, include, method=METHOD, settle_factor=1.0, models_include=None):
    """ngspice deck: 7x7 copies of the cell (one per slew x load) plus one input-capacitance copy.

    Returns (deck_text, plan) where plan carries the timeline and the measurement names."""
    vdd = method["vdd"]
    roles = port_roles(ports, cell)
    plan = edge_plan(index_1, max(index_2), method, settle_factor)
    t0, t1 = plan["t0"], plan["t1"]
    out_rises_first = unit["sense"] == "positive"
    lines = ["* cellchar %s %s" % (method["version"], unit_id(unit)),
             (".include %s" % models_include) if models_include else ".lib %s %s" % (method["models"], method["corner"]),
             ".include %s" % include,
             ".temp %g" % method["tempC"],
             ".options %s" % method["spiceOptions"],
             "vvdd vdd 0 %g" % vdd]

    def pwl(ramp):
        return "pwl(0 0 %.6gn 0 %.6gn %g %.6gn %g %.6gn 0)" % (t0, t0 + ramp, vdd, t1, vdd, t1 + ramp)

    def instance(tag, in_node, out_nodes, load):
        conn = []
        for port in ports:
            role = roles[port]
            if port == unit["input"]:
                conn.append(in_node)
            elif port in cell["inputs"]:
                conn.append("vdd" if unit["vector"][port] else "0")
            elif port in cell["outputs"]:
                conn.append(out_nodes[port])
            else:
                conn.append(role)
        text = ["x%s %s %s" % (tag, " ".join(conn), cell["subckt"])]
        for port, node in sorted(out_nodes.items()):
            cap = load if port == unit["output"] else method["otherOutputLoadPf"]
            text.append("c%s_%s %s 0 %.6gp" % (tag, port, node, cap))
        return text

    saves = []
    for i, ramp in enumerate(plan["ramps"]):
        lines.append("vin%d in%d 0 %s" % (i, i, pwl(ramp)))
        for j, load in enumerate(index_2):
            outs = {o: ("o%d_%d" % (i, j) if o == unit["output"] else "n%d_%d_%s" % (i, j, o)) for o in cell["outputs"]}
            lines.extend(instance("%d_%d" % (i, j), "in%d" % i, outs, load))
            saves.append("v(o%d_%d)" % (i, j))
    cap_ramp = index_1[method["capSlewIndex"]] * method["rampFullOverSlew"]
    lines.append("vinc inc 0 %s" % pwl(cap_ramp))
    outs = {o: ("oc" if o == unit["output"] else "nc_%s" % o) for o in cell["outputs"]}
    lines.extend(instance("c", "inc", outs, index_2[method["capLoadIndex"]]))
    saves.append("i(vinc)")
    lines.append(".save " + " ".join(saves))
    lines.append(".tran %gn %.6gn 0 %gn" % (method["tranStepNs"], plan["tstop"], method["tranMaxStepNs"]))
    levels = {"50": vdd * method["delayThresholdPct"] / 100.0,
              "lo": vdd * method["slewLowerPct"] / 100.0,
              "hi": vdd * method["slewUpperPct"] / 100.0}
    names = []
    for i in range(len(index_1)):
        for j in range(len(index_2)):
            for edge, td, rising in (("r", t0, out_rises_first), ("f", t1, not out_rises_first)):
                for key, level in levels.items():
                    name = "m%d_%d_%s_%s" % (i, j, edge, key)
                    names.append(name)
                    lines.append(".meas tran %s when v(o%d_%d)=%.6g td=%.6gn %s=1" % (
                        name, i, j, level, td, "rise" if rising else "fall"))
    lines.append(".meas tran qrise integ i(vinc) from=%.6gn to=%.6gn" % (t0, t1))
    lines.append(".meas tran qfall integ i(vinc) from=%.6gn to=%.6gn" % (t1, plan["tstop"]))
    names += ["qrise", "qfall"]
    lines.append(".end")
    plan["measures"] = names
    plan["outRisesOnInputRise"] = out_rises_first
    return "\n".join(lines) + "\n", plan


_MEAS = re.compile(r"^\s*([a-z][a-z0-9_]*)\s*=\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)", re.M)


def parse_measures(stdout):
    return {name: float(value) for name, value in _MEAS.findall(stdout.lower())}


def reduce_unit(meas, plan, index_1, index_2, method=METHOD):
    """Turn raw crossing times into Liberty quantities (ns, pF). Raises CharError on a missing measure."""
    missing = [name for name in plan["measures"] if name not in meas]
    if missing:
        raise CharError("%d measurement(s) failed, e.g. %s" % (len(missing), ", ".join(missing[:4])))
    tables = {q: [[None] * len(index_2) for _ in index_1] for q in QUANTITIES}
    for i, ramp in enumerate(plan["ramps"]):
        for j in range(len(index_2)):
            for edge, start, rising in (("r", plan["t0"], plan["outRisesOnInputRise"]),
                                        ("f", plan["t1"], not plan["outRisesOnInputRise"])):
                t_in = (start + ramp * method["delayThresholdPct"] / 100.0) * 1e-9
                t50 = meas["m%d_%d_%s_50" % (i, j, edge)]
                tlo = meas["m%d_%d_%s_lo" % (i, j, edge)]
                thi = meas["m%d_%d_%s_hi" % (i, j, edge)]
                delay = (t50 - t_in) * 1e9
                slew = abs(thi - tlo) * 1e9 / method["slewDerate"]
                tables["cell_rise" if rising else "cell_fall"][i][j] = delay
                tables["rise_transition" if rising else "fall_transition"][i][j] = slew
    vdd = method["vdd"]
    caps = {"rise_capacitance": abs(meas["qrise"]) / vdd * 1e12,
            "fall_capacitance": abs(meas["qfall"]) / vdd * 1e12}
    return tables, caps


def merge_worst(table_list):
    """Point-wise maximum of equally shaped tables."""
    out = [row[:] for row in table_list[0]]
    for table in table_list[1:]:
        for i, row in enumerate(table):
            for j, value in enumerate(row):
                out[i][j] = max(out[i][j], value)
    return out


def assemble_cell(cell, unit_results):
    """unit_results: list of (unit, tables, caps). Returns (arcs, pin_caps).

    arcs: [{output, input, sense: positive_unate|negative_unate, tables, vectors}] with worst-case over
    the vectors of each sense; a non-unate pin yields one arc per sense (foundry style)."""
    grouped = {}
    caps = {}
    for unit, tables, cap in unit_results:
        key = (unit["output"], unit["input"], unit["sense"])
        grouped.setdefault(key, []).append((unit, tables))
        entry = caps.setdefault(unit["input"], {"rise_capacitance": [], "fall_capacitance": []})
        for q in CAP_QUANTITIES:
            entry[q].append(cap[q])
    arcs = []
    for out in cell["outputs"]:
        for pin in cell["inputs"]:
            for sense in ("positive", "negative"):
                items = grouped.get((out, pin, sense))
                if not items:
                    continue
                arcs.append({"output": out, "input": pin, "sense": sense + "_unate",
                             "vectors": [u["vector"] for u, _ in items],
                             "tables": {q: merge_worst([t[q] for _, t in items]) for q in QUANTITIES}})
    pin_caps = {pin: {q: sum(v[q]) / len(v[q]) for q in CAP_QUANTITIES} for pin, v in caps.items()}
    return arcs, pin_caps


def apply_factors(arcs, pin_caps, factors):
    out_arcs = []
    for arc in arcs:
        tables = {q: [[v * factors[q] for v in row] for row in arc["tables"][q]] for q in QUANTITIES}
        out_arcs.append(dict(arc, tables=tables))
    out_caps = {pin: {q: c[q] * factors[q] for q in CAP_QUANTITIES} for pin, c in pin_caps.items()}
    return out_arcs, out_caps


# ---------------------------------------------------------------- Liberty reading

def _skip_ws(text, pos):
    while pos < len(text):
        if text[pos].isspace() or text[pos] == "\\":
            pos += 1
        elif text.startswith("/*", pos):
            end = text.find("*/", pos + 2)
            pos = len(text) if end < 0 else end + 2
        else:
            break
    return pos


def _read_until(text, pos, stop):
    """Read to the matching `stop` char (outside quotes); returns (content, index of stop)."""
    depth = 0
    quote = False
    start = pos
    while pos < len(text):
        char = text[pos]
        if char == '"':
            quote = not quote
        elif not quote:
            if char == "(":
                depth += 1
            elif char == ")" and depth:
                depth -= 1
            elif char == stop and depth == 0:
                return text[start:pos], pos
        pos += 1
    raise CharError("Liberty: missing %r" % stop)


def parse_liberty(text, pos=0, end=None):
    """Parse Liberty statements into [("group", name, args, children) | ("attr", name, value) |
    ("complex", name, args)]."""
    end = len(text) if end is None else end
    items = []
    while True:
        pos = _skip_ws(text, pos)
        if pos >= end or text[pos] == "}":
            return items, pos
        match = re.compile(r"[A-Za-z_][A-Za-z0-9_.]*").match(text, pos)
        if not match:
            raise CharError("Liberty: unexpected %r at %d" % (text[pos:pos + 20], pos))
        name = match.group(0)
        pos = _skip_ws(text, match.end())
        if text[pos] == ":":
            value, pos = _read_until(text, pos + 1, ";")
            items.append(("attr", name, value.strip().strip('"')))
            pos += 1
        elif text[pos] == "(":
            args, pos = _read_until(text, pos + 1, ")")
            pos = _skip_ws(text, pos + 1)
            if pos < end and text[pos] == "{":
                children, pos = parse_liberty(text, pos + 1, end)
                items.append(("group", name, args.strip().strip('"'), children))
                pos += 1
            else:
                items.append(("complex", name, args.strip()))
                if pos < end and text[pos] == ";":
                    pos += 1
        else:
            raise CharError("Liberty: statement %s lacks ':' or '('" % name)


def _numbers(args):
    return [float(x) for s in re.findall(r'"([^"]*)"', args) for x in s.split(",") if x.strip()]


def _rows(args):
    return [[float(x) for x in s.split(",") if x.strip()] for s in re.findall(r'"([^"]*)"', args)]


def find_cell_text(lib_text, name):
    match = re.search(r'\bcell\s*\(\s*"?%s"?\s*\)\s*\{' % re.escape(name), lib_text)
    if not match:
        raise CharError("cell %s not in the reference Liberty" % name)
    depth = 0
    for index in range(match.end() - 1, len(lib_text)):
        if lib_text[index] == "{":
            depth += 1
        elif lib_text[index] == "}":
            depth -= 1
            if depth == 0:
                return lib_text[match.start():index + 1]
    raise CharError("unbalanced cell %s" % name)


def read_cell(lib_text, name):
    """{name, area, pins:{pin:{direction, function, capacitance, rise_capacitance, fall_capacitance}},
    arcs:[{output, input, sense, index_1, index_2, tables{q: rows}}]} for one Liberty cell."""
    items, _ = parse_liberty(find_cell_text(lib_text, name))
    cell_group = items[0]
    cell = {"name": cell_group[2], "area": None, "pins": {}, "arcs": []}
    for item in cell_group[3]:
        if item[0] == "attr" and item[1] == "area":
            cell["area"] = float(item[2])
        if item[0] == "group" and item[1] == "pin":
            pin = {"direction": None, "function": None}
            for sub in item[3]:
                if sub[0] == "attr" and sub[1] in ("direction", "function"):
                    pin[sub[1]] = sub[2]
                elif sub[0] == "attr" and sub[1] in ("capacitance", "rise_capacitance", "fall_capacitance", "max_capacitance"):
                    pin[sub[1]] = float(sub[2])
                elif sub[0] == "group" and sub[1] == "timing":
                    arc = {"output": item[2], "input": None, "sense": None, "tables": {}}
                    for t in sub[3]:
                        if t[0] == "attr" and t[1] == "related_pin":
                            arc["input"] = t[2]
                        elif t[0] == "attr" and t[1] == "timing_sense":
                            arc["sense"] = t[2]
                        elif t[0] == "group" and t[1] in QUANTITIES:
                            for v in t[3]:
                                if v[0] == "complex" and v[1] == "index_1":
                                    arc["index_1"] = _numbers(v[2])
                                elif v[0] == "complex" and v[1] == "index_2":
                                    arc["index_2"] = _numbers(v[2])
                                elif v[0] == "complex" and v[1] == "values":
                                    arc["tables"][t[1]] = _rows(v[2])
                    cell["arcs"].append(arc)
            cell["pins"][item[2]] = pin
    return cell


# ---------------------------------------------------------------- Liberty writing

def _fmt(value):
    return "%.10f" % value


def _index(values):
    return '"%s"' % ", ".join(_fmt(v) for v in values)


def _table(name, index_1, index_2, rows, indent):
    pad = " " * indent
    body = (', \\\n%s    ' % pad).join('"%s"' % ", ".join(_fmt(v) for v in row) for row in rows)
    return ('%s%s ("del_1_7_7") {\n%s    index_1(%s);\n%s    index_2(%s);\n%s    values(%s);\n%s}\n'
            % (pad, name, pad, _index(index_1), pad, _index(index_2), pad, body, pad))


def liberty_cell(cell, arcs, pin_caps, index_1, index_2_by_output, banner=BANNER, extra_comment=None):
    """One Liberty `cell` group in the sky130 reference style (cell-only, mergeable)."""
    lines = ["    /* %s */" % banner]
    if extra_comment:
        lines.append("    /* %s */" % extra_comment.replace("*/", "* /"))
    lines.append('    cell ("%s") {' % cell["name"])
    lines.append("        area : %s;" % _fmt(cell["area"]))
    lines.append('        cell_footprint : "%s";' % cell["footprint"])
    text = "\n".join(lines) + "\n" + PG_PINS_TEXT
    for pin in sorted(cell["inputs"]):
        cap = pin_caps.get(pin, {"rise_capacitance": 0.0, "fall_capacitance": 0.0})
        rise, fall = cap["rise_capacitance"], cap["fall_capacitance"]
        text += ('        pin ("%s") {\n'
                 '            capacitance : %s;\n'
                 '            clock : "false";\n'
                 '            direction : "input";\n'
                 '            fall_capacitance : %s;\n'
                 '            max_transition : 1.5000000000;\n'
                 '            related_ground_pin : "VGND";\n'
                 '            related_power_pin : "VPWR";\n'
                 '            rise_capacitance : %s;\n'
                 '        }\n') % (pin, _fmt((rise + fall) / 2.0), _fmt(fall), _fmt(rise))
    for out in sorted(cell["outputs"]):
        index_2 = index_2_by_output[out]
        text += ('        pin ("%s") {\n'
                 '            direction : "output";\n'
                 '            function : "%s";\n'
                 '            max_capacitance : %s;\n'
                 '            max_transition : 1.5000000000;\n'
                 '            power_down_function : "(!VPWR + VGND)";\n'
                 '            related_ground_pin : "VGND";\n'
                 '            related_power_pin : "VPWR";\n') % (out, cell["functions"][out], _fmt(max(index_2)))
        for arc in [a for a in arcs if a["output"] == out]:
            text += "            timing () {\n"
            for q in ("cell_fall", "cell_rise", "fall_transition", "rise_transition"):
                text += _table(q, index_1, index_2, arc["tables"][q], 16)
            text += ('                related_pin : "%s";\n'
                     '                timing_sense : "%s";\n'
                     '                timing_type : "combinational";\n'
                     '            }\n') % (arc["input"], arc["sense"])
        text += "        }\n"
    return text + "    }\n"


LIBRARY_HEADER = """library ("%(name)s") {
    technology("cmos");
    delay_model : "table_lookup";
    time_unit : "1ns";
    voltage_unit : "1V";
    leakage_power_unit : "1nW";
    current_unit : "1mA";
    pulling_resistance_unit : "1kohm";
    capacitive_load_unit(1.0000000000, "pf");
    default_cell_leakage_power : 0.0000000000;
    default_fanout_load : 1.0000000000;
    default_inout_pin_cap : 0.0000000000;
    default_input_pin_cap : 0.0000000000;
    default_max_transition : 1.5000000000;
    default_output_pin_cap : 0.0000000000;
    operating_conditions ("tt_025C_1v80") {
        voltage : 1.8000000000;
        process : 1.0000000000;
        temperature : 25.000000000;
        tree_type : "balanced_tree";
    }
    lu_table_template ("del_1_7_7") {
        variable_1 : "input_net_transition";
        variable_2 : "total_output_net_capacitance";
        index_1("1, 2, 3, 4, 5, 6, 7");
        index_2("1, 2, 3, 4, 5, 6, 7");
    }
    voltage_map("VGND", 0.0000000000);
    voltage_map("VNB", 0.0000000000);
    voltage_map("VPB", 1.8000000000);
    voltage_map("VPWR", 1.8000000000);
    input_threshold_pct_fall : 50.000000000;
    input_threshold_pct_rise : 50.000000000;
    nom_process : 1.0000000000;
    nom_temperature : 25.000000000;
    nom_voltage : 1.8000000000;
    output_threshold_pct_fall : 50.000000000;
    output_threshold_pct_rise : 50.000000000;
    slew_derate_from_library : 1.0000000000;
    slew_lower_threshold_pct_fall : 20.000000000;
    slew_lower_threshold_pct_rise : 20.000000000;
    slew_upper_threshold_pct_fall : 80.000000000;
    slew_upper_threshold_pct_rise : 80.000000000;
    default_operating_conditions : "tt_025C_1v80";
"""


def standalone_library(name, cell_groups):
    return LIBRARY_HEADER % {"name": name} + "".join(cell_groups) + "}\n"


# ---------------------------------------------------------------- calibration math

def percentile(values, pct):
    """Linear-interpolated percentile (pct in 0..100) of a non-empty list."""
    data = sorted(values)
    if not data:
        raise CharError("percentile of an empty list")
    rank = (len(data) - 1) * pct / 100.0
    low, high = int(math.floor(rank)), int(math.ceil(rank))
    return data[low] + (data[high] - data[low]) * (rank - low)


def median(values):
    return percentile(values, 50)


def calibration_factors(pairs):
    """pairs: {quantity: [(simulated, reference), ...]} -> (factors, residuals).

    factor = median(reference / simulated); residual of a point = simulated * factor / reference - 1.
    residuals[q] = {n, p50, p90, max (of |residual|), bias (median signed), rawP90 (before factors)}."""
    factors, residuals = {}, {}
    for q, items in pairs.items():
        usable = [(s, r) for s, r in items if s > 0 and r > 0]
        if not usable:
            raise CharError("no usable points for %s" % q)
        factor = median([r / s for s, r in usable])
        signed = [s * factor / r - 1.0 for s, r in usable]
        absolute = [abs(x) for x in signed]
        raw = [abs(s / r - 1.0) for s, r in usable]
        factors[q] = factor
        residuals[q] = {"n": len(usable), "p50": percentile(absolute, 50), "p90": percentile(absolute, 90),
                        "max": max(absolute), "bias": median(signed), "rawP90": percentile(raw, 90)}
    return factors, residuals


FACTOR_BOUNDS = (0.75, 1.33)
MAX_TOLERANCE = 0.15


def calibration_gate(calibration, fingerprint):
    """None when the calibration may be applied, else the refusal reason."""
    if calibration.get("schema") != "hima-cellchar-calibration/1":
        return "calibration schema must be hima-cellchar-calibration/1"
    if calibration.get("methodFingerprint") != fingerprint:
        return ("calibration was made with method %s but this characterizer is %s; rerun calibrate.py"
                % (calibration.get("methodFingerprint"), fingerprint))
    tolerance = calibration.get("tolerance", {}).get("p90AbsResidual")
    if not isinstance(tolerance, (int, float)):
        return "calibration lacks tolerance.p90AbsResidual"
    if tolerance > MAX_TOLERANCE:
        return "calibration tolerance %.0f%% is looser than the allowed %.0f%%" % (100 * tolerance, 100 * MAX_TOLERANCE)
    over = ["%s p90 %.1f%%" % (q, 100 * r["p90"]) for q, r in sorted(calibration.get("residual", {}).items())
            if r["p90"] > tolerance]
    missing = [q for q in QUANTITIES + CAP_QUANTITIES if q not in calibration.get("factors", {})]
    if missing:
        return "calibration lacks factors for %s" % ", ".join(missing)
    wild = ["%s %.3f" % (q, f) for q, f in sorted(calibration["factors"].items()) if not FACTOR_BOUNDS[0] <= f <= FACTOR_BOUNDS[1]]
    if wild:
        return "calibration factors outside %.2f..%.2f (the method is broken, not miscalibrated): %s" % (
            FACTOR_BOUNDS[0], FACTOR_BOUNDS[1], ", ".join(wild))
    if over:
        return "calibration residual exceeds +-%.0f%% p90: %s" % (100 * tolerance, "; ".join(over))
    return None
