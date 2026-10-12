#!/usr/bin/env python3
"""Deterministic steps of the analog-ota-migrate Pack (python3 >= 3.9, stdlib only).

A two-stage Miller OTA is sized from a spec sheet in a source PDK and migrated to a target PDK.
The agents propose designs (device sizes, bias current, compensation); every performance number
this file writes comes from the Site's SPICE simulator (Cadence Spectre or ngspice), never from model text. The
method an analog designer would apply by hand (gm/Id lookup tables, mirror ratios, the zero
systematic-offset condition, the gm/Id-preserving port) is code here, so an agent runs it instead
of rediscovering it.

  bind         <WS> <SIMULATORS> <PDK_ROOT> <SOURCE_PDK> <TARGET_PDK>   simulators, PDK files, cards
  characterize <WS>                    gm/Id tables of both PDKs (DC sweeps on the simulator)
  design       <WS> <STAGE>            check state/design-<STAGE>.json (an agent's delivery)
  simulate     <WS> <STAGE> <LOAD_PF> <CM_PCT> <GAIN_DB> <GBW_MHZ> <PM_DEG> <POWER_UW>
                                       the OTA testbench at every corner of the stage's PDK, against
                                       the spec sheet (the Goal)
  record       <WS> <GAIN_DB> <GBW_MHZ> <PM_DEG> <POWER_UW>   the round record
  draft        <WS> <KIND> [<FILE>]    KIND intent (FILE = a spec sheet): a first-cut sizing intent
                                       from the spec by the textbook two-stage procedure in gm/Id form;
                                       KIND size (FILE = an intent): the source design it gives;
                                       KIND migrate [FILE = an intent]: the gm/Id-preserving port;
                                       KIND keep: last round's accepted source design, this round
  precheck     <WS> <STAGE> <FILE> [<OWN_WORKSPACE>]   an agent's own check before delivery
  sim          <WS> <STAGE> <FILE> <LOAD_PF> <CM_PCT> [<OUT_DIR>]   the same testbench on an agent's own
                                       draft, for the agent's own loop (never a delivery)

STAGE is source or target. All output goes under <WS>; the simulator and the PDK are read-only.
SIMULATORS is the Site's `spectre=<command>,ngspice=<command>`; each PDK is measured with the first
simulator its card lists that the Site has (Cadence Spectre where the PDK's decks read in Spectre).
`sim` (an agent's own loop) uses the bound simulator and pdkRoot unless OTA_SIM / OTA_PDK_ROOT are
set: an agent's sandbox names its own ngspice and PDK copy. The measurements are computed here from
each simulator's raw operating point and AC response, by one piece of arithmetic for both.
Every step leaves the reports a person reads at <WS>/reports/<node id>/r<k>/.
"""
import bisect
import hashlib
import json
import math
import os
import re
import subprocess
import sys
import time
from pathlib import Path

TOPOLOGY = "miller2"
DEVICES = ("M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8")
KIND_OF = {"M1": "nmos", "M2": "nmos", "M3": "pmos", "M4": "pmos", "M5": "nmos", "M6": "pmos", "M7": "nmos", "M8": "nmos"}
STAGES = ("source", "target")
AGENT_NODES = {"source": "size-agent", "target": "migrate-agent"}
SIM_NODES = {"source": "simulate-source", "target": "simulate-target"}
DESIGN_SCHEMA = "hima-ota-design/1"
MEASURE_SCHEMA = "hima-ota-measure/1"
TABLE_SCHEMA = "hima-gmid-table/1"
ROUND_SCHEMA = "hima-ota-round/1"
INPUTS_SCHEMA = "hima-ota-inputs/1"
CHART_SCHEMA = "hima-chart/1"
SAT_MARGIN_V = 0.05          # a device is saturated when |Vds| >= |Vdsat| + this
SWEEP_STEP_V = 0.02          # characterization VGS step
MIN_JD_UA_UM = 1e-4          # rows below this current density are leakage, not inversion
LIMITS = {"ibiasUa": (0.5, 500.0), "ccPf": (0.05, 20.0), "rzKohm": (0.0, 200.0)}
DESIGN_KEYS = {"schema", "stage", "pdk", "topology", "round", "ibiasUa", "ccPf", "rzKohm", "devices", "intent",
               "migratedFrom", "summary", "reason", "report"}
SPEC = (("gainDb", "DC gain", "dB", 1, "higher"), ("gbwMhz", "Unity-gain freq", "MHz", 2, "higher"),
        ("pmDeg", "Phase margin", "deg", 1, "higher"), ("powerUw", "Power", "uW", 1, "lower"))
CLAIM_BOUNDARY = ("Every number is the Site simulator's (Spectre or ngspice, as each measurement states) on the stated PDK models at the stated corners, schematic "
                  "level with ideal bias source, compensation and load; no layout parasitics, mismatch or Monte Carlo; "
                  "not silicon.")


class ToolError(Exception):
    pass


# ---------------------------------------------------------------- small helpers

def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def read_json(path, what=None):
    try:
        with open(path) as stream:
            return json.load(stream)
    except FileNotFoundError:
        raise ToolError("%s not found: %s" % (what or "file", path))
    except ValueError as error:
        raise ToolError("%s is not valid JSON (%s)" % (what or path, error))


def write_text(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text)
    os.replace(tmp, path)


def write_json(path, value):
    write_text(path, json.dumps(value, indent=2, sort_keys=True) + "\n")


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def state(ws, name):
    return Path(ws) / "state" / name


def report_dir(ws, node, k):
    return Path(ws) / "reports" / node / ("r%d" % k)


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def fmt(value, spec="%.2f"):
    return "n/a" if value is None else spec % value


def um(value):
    """A length in um as the netlist writes it (no float noise)."""
    return ("%.4f" % value).rstrip("0").rstrip(".")


# ---------------------------------------------------------------- inputs and PDK cards

def load_cards(ws):
    doc = read_json(Path(ws) / "flow" / "pdks.json", "the PDK cards flow/pdks.json")
    return doc["cards"]


def load_inputs(ws):
    return read_json(state(ws, "inputs.json"), "state/inputs.json (run bind first)")


def card_of(inputs, stage):
    return inputs["pdks"][stage]["card"]


def current_round(ws):
    lessons = read_json(state(ws, "lessons.json"), "state/lessons.json")
    return len(lessons["rounds"]) + 1


def parse_simulators(text):
    """The Site's simulators binding: `spectre=<command>,ngspice=<command>` (either may be absent)."""
    found = {}
    for part in [p.strip() for p in str(text).split(",") if p.strip()]:
        name, sep, command = part.partition("=")
        if not sep or name not in SIMULATORS or not command:
            raise ToolError("the simulators binding is name=command[,name=command] with names %s (found %r)" % (", ".join(SIMULATORS), part))
        found[name] = command
    if not found:
        raise ToolError("the Site binds no simulator")
    return found


def deck(card, sim):
    """The card's model files for one simulator: includes, the .lib sections per corner, OSDI models."""
    return card["decks"][sim]


def corners_of(inputs, stage):
    return list(deck(card_of(inputs, stage), inputs["pdks"][stage]["simulator"]["name"])["corners"])


def card_files(card, sim):
    d = deck(card, sim)
    files = list(d["includes"])
    for libs in d["corners"].values():
        for path, _section in libs:
            if path not in files:
                files.append(path)
    return files + list(d.get("osdi", []))


def cmd_bind(ws, simulators, pdk_root, source, target):
    ws = Path(ws)
    cards = load_cards(ws)
    if source == target:
        raise ToolError("the source and target PDK are the same (%s): a migration needs two" % source)
    available = parse_simulators(simulators)
    versions = {name: SIMULATORS[name].version(command) for name, command in available.items()}
    pdks = {}
    lines = ["# Simulators and PDKs", ""]
    for name, command in available.items():
        lines.append("Simulator: %s (%s)" % (versions[name], command))
    for stage, name in (("source", source), ("target", target)):
        card = cards.get(name)
        if card is None:
            raise ToolError("no PDK card for %s; the Pack knows %s" % (name, ", ".join(sorted(cards))))
        usable = [s for s in card["simulators"] if s in available]
        if not usable:
            raise ToolError("%s is simulated with %s, and the Site binds only %s" % (name, " or ".join(card["simulators"]), ", ".join(available)))
        files = []
        for relpath in card_files(card, usable[0]):
            path = Path(pdk_root) / relpath
            if not path.is_file():
                raise ToolError("%s: %s is not on the Site (pdkRoot %s)" % (name, relpath, pdk_root))
            files.append(dict(path=relpath, sha256=sha256_file(path)))
        sim = dict(name=usable[0], path=available[usable[0]], version=versions[usable[0]])
        pdks[stage] = dict(name=name, card=card, files=files, simulator=sim)
        lines.append("%s PDK: %s, %s; supply %.2f V; corners %s; measured with %s" % (stage.capitalize(), name, card["title"], card["vdd"],
                                                                                    ", ".join(deck(card, sim["name"])["corners"]), sim["version"]))
        for f in files:
            lines.append("  %s  %s" % (f["sha256"][:16], f["path"]))
    write_json(state(ws, "inputs.json"), dict(schema=INPUTS_SCHEMA, simulators={n: dict(path=available[n], version=versions[n]) for n in available},
                                             pdkRoot=str(pdk_root), topology=TOPOLOGY, pdks=pdks, boundAt=now()))
    if not state(ws, "lessons.json").exists():
        write_json(state(ws, "lessons.json"), dict(schema="hima-ota-lessons/1", rounds=[]))
    write_text(report_dir(ws, "bind-inputs", 1) / "tools.rpt", "\n".join(lines) + "\n")
    print("bound %s; source %s with %s, target %s with %s" % (", ".join(versions.values()), source, pdks["source"]["simulator"]["name"],
                                                              target, pdks["target"]["simulator"]["name"]))


# ---------------------------------------------------------------- the simulators
#
# Each simulator writes its own netlist dialect and its own output format; both answer the same
# facts: for a characterization, per sweep point and device the drain current, gm, gds and Cgg; for
# the OTA testbench, the supply power, each device's operating point (Vds, Vdsat, Id, gm, gds) and
# the AC response of the output (frequency, real, imaginary). The measurements (gain, unity-gain
# frequency, phase margin, saturation) are computed from those facts by this file, once, so both
# simulators are judged by the same arithmetic.

def run(argv, cwd, log_path, timeout_s=600):
    try:
        out = subprocess.run(argv, capture_output=True, text=True, timeout=timeout_s, cwd=str(cwd))
    except subprocess.TimeoutExpired:
        raise ToolError("%s ran past %d s" % (argv[0], timeout_s))
    except OSError as error:
        raise ToolError("%s could not start (%s)" % (argv[0], error))
    text = out.stdout + out.stderr
    write_text(log_path, text)
    if out.returncode != 0:
        tail = "\n".join(text.strip().splitlines()[-8:])
        raise ToolError("%s failed (exit %d), log %s: %s" % (Path(argv[0]).name, out.returncode, log_path, tail))
    return text


def fresh_stem(out_dir, name, suffixes):
    """A stem in out_dir none of whose files (stem + each suffix) exist yet: name, then
    name.attempt-<n>. Every file of one run shares the stem, so a run never reads another attempt's
    output, and no attempt's files are deleted."""
    out_dir = Path(out_dir)
    taken = lambda stem: any((out_dir / (stem + suffix)).exists() for suffix in suffixes)
    stem, n = name, 2
    while taken(stem):
        stem, n = "%s.attempt-%d" % (name, n), n + 1
    return out_dir / stem


def dev_params(card, kind, w, l):
    """The instance parameters; a PDK with a per-finger width limit gets ng fingers of at most that width."""
    dev = card["devices"][kind]
    limit = dev.get("maxFingerWUm")
    ng = max(1, int(math.ceil(w / limit - 1e-9))) if limit else 1
    return dev["params"].format(w=um(w), l=um(l), ng=ng)


def lib_lines(inputs, stage, corner, sim):
    """The PDK's model includes for one simulator, in SPICE syntax (Spectre reads them under
    `simulator lang=spice`)."""
    d = deck(card_of(inputs, stage), sim)
    root = Path(inputs.get("ownPdkRoot") or inputs["pdkRoot"])
    lines = [".include \"%s\"" % (root / inc) for inc in d["includes"]]
    lines += [".lib \"%s\" %s" % (root / path, section) for path, section in d["corners"][corner]]
    return lines


def op_names(card, kind, sim):
    """The simulator's operating-point names for the Pack's id, vdsat, gm, gds, cgg, vds."""
    names = dict(SPECTRE_OP) if sim == "spectre" else {p: p for p in SPECTRE_OP}
    names.update(card["devices"][kind].get("opNames", {}).get(sim, {}))
    return names


class Ngspice:
    name = "ngspice"

    @staticmethod
    def version(command):
        try:
            out = subprocess.run([command, "--version"], capture_output=True, text=True, timeout=120)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ToolError("ngspice %s does not answer --version (%s)" % (command, error))
        match = re.search(r"ngspice-([0-9][0-9A-Za-z.+-]*)", out.stdout + out.stderr)
        if not match:
            raise ToolError("%s is not ngspice (its --version said: %s)" % (command, (out.stdout + out.stderr).strip()[:200]))
        return "ngspice-" + match.group(1)

    @staticmethod
    def device(card, kind, name, nets, w, l):
        dev = card["devices"][kind]
        inst = ("X" if dev["instance"] == "X" else "") + name
        return "%s %s %s %s" % (inst, " ".join(nets), dev["model"], dev_params(card, kind, w, l)), inst

    @staticmethod
    def op(card, kind, inst, param):
        return card["devices"][kind]["op"]["ngspice"].format(inst=inst.lower(), param=op_names(card, kind, "ngspice")[param])

    @classmethod
    def head(cls, inputs, stage, corner, title):
        card = card_of(inputs, stage)
        return ["* " + title] + lib_lines(inputs, stage, corner, "ngspice") + [".temp %g" % card["temperatureC"]]

    @classmethod
    def control(cls, inputs, stage):
        root = Path(inputs.get("ownPdkRoot") or inputs["pdkRoot"])
        return [".control", "set noaskquit", "set wr_singlescale", "set wr_vecnames"] + \
            ["pre_osdi %s" % (root / f) for f in deck(card_of(inputs, stage), "ngspice").get("osdi", [])]

    @classmethod
    def sweep(cls, command, inputs, stage, kind, out_dir, name):
        card = card_of(inputs, stage)
        dev = card["devices"][kind]
        sign = 1.0 if kind == "nmos" else -1.0
        vdd = card["vdd"]
        lines = cls.head(inputs, stage, "tt", "gm/Id characterization: %s %s" % (inputs["pdks"][stage]["name"], kind))
        lines += ["VD d 0 %g" % (sign * vdd / 2.0), "VG g 0 0"]
        insts = []
        for i, length in enumerate(dev["lengthsUm"]):
            line, inst = cls.device(card, kind, "MC%d" % i, ("d", "g", "0", "0"), dev["charWUm"], length)
            lines.append(line)
            insts.append(inst)
        lines += cls.control(inputs, stage)
        lines.append("save all " + " ".join(cls.op(card, kind, inst, p) for inst in insts for p in CHAR_PARAMS))
        lines.append("dc VG 0 %g %g" % (sign * vdd, sign * SWEEP_STEP_V))
        vectors = []
        for i, inst in enumerate(insts):
            for p in CHAR_PARAMS:
                lines.append("let c%d_%s = %s" % (i, p, cls.op(card, kind, inst, p)))
                vectors.append("c%d_%s" % (i, p))
        stem = fresh_stem(out_dir, name, (".cir", ".cir.log", ".dat"))
        data, netlist = Path(str(stem) + ".dat"), Path(str(stem) + ".cir")
        lines += ["wrdata %s v(g) %s" % (data.name, " ".join(vectors)), "quit", ".endc", ".end", ""]
        write_text(netlist, "\n".join(lines))
        run([command, "-b", str(netlist)], out_dir, Path(str(netlist) + ".log"))
        if not data.is_file():
            raise ToolError("ngspice wrote no sweep data for %s (log %s.log)" % (name, netlist))
        with open(data) as stream:
            header = stream.readline().split()
            rows = [[float(x) for x in line.split()] for line in stream if line.strip()]
        col = {h: i for i, h in enumerate(header)}
        return [dict(vgs=abs(row[col["v(g)"]]),
                     devices=[{p: abs(row[col["c%d_%s" % (i, p)]]) for p in CHAR_PARAMS} for i in range(len(insts))]) for row in rows]

    @classmethod
    def ota(cls, command, inputs, stage, netlist_lines, insts, vdd, out_dir, name):
        card = card_of(inputs, stage)
        lines = list(netlist_lines) + cls.control(inputs, stage)
        lines += ["op", "let pw = -i(vsup)*%g" % vdd, "echo HIMA power_w $&pw"]
        for dev in DEVICES:
            kind, inst = KIND_OF[dev], insts[dev]
            for p in OP_PARAMS:
                lines.append("let %s_%s = %s" % (dev.lower(), p, cls.op(card, kind, inst, p)))
            lines.append("echo HIMA op_%s %s" % (dev, " ".join("$&%s_%s" % (dev.lower(), p) for p in OP_PARAMS)))
        stem = fresh_stem(out_dir, name, (".cir", ".cir.log", "-ac.dat"))
        netlist, ac_file = Path(str(stem) + ".cir"), Path(str(stem) + "-ac.dat")
        lines += ["ac dec %d %g %g" % (AC_PER_DECADE, AC_START_HZ, AC_STOP_HZ), "wrdata %s v(out)" % ac_file.name,
                  "echo HIMA done 1", "quit", ".endc", ".end", ""]
        write_text(netlist, "\n".join(lines))
        text = run([command, "-b", str(netlist)], out_dir, Path(str(netlist) + ".log"))
        values = {}
        for line in text.splitlines():
            parts = line.split()
            if len(parts) >= 3 and parts[0] == "HIMA":
                try:
                    values[parts[1]] = [float(x) for x in parts[2:]]
                except ValueError:
                    pass
        op = {}
        for dev in DEVICES:
            v = values.get("op_" + dev)
            op[dev] = dict(zip(OP_PARAMS, v)) if v and len(v) == len(OP_PARAMS) else None
        if "done" not in values:
            raise ToolError("ngspice did not finish the testbench %s (log %s.log)" % (netlist, netlist))
        ac = []
        path = ac_file
        if path.is_file():
            with open(path) as stream:
                stream.readline()
                ac = [tuple(float(x) for x in line.split()[:3]) for line in stream if line.strip()]
        power = values.get("power_w")
        return dict(powerW=power[0] if power else None, op=op, ac=ac)


def psf_ascii(path):
    """A Spectre PSF ASCII file: (sweep points, structs). Sweep files give one dict per point
    {name: float or complex}; info files give {instance: {field: float}} by the TYPE section's order."""
    with open(path) as stream:
        lines = [l.rstrip("\n") for l in stream]
    section, structs, current, depth, skip = None, {}, None, 0, 0
    points, insts, inst, fields, values = [], {}, None, None, []
    sweep_name = None
    for line in lines:
        if line in ("HEADER", "TYPE", "SWEEP", "TRACE", "VALUE", "END"):
            section = line
            continue
        if section == "TYPE":
            # A struct's fields each carry a PROP( ... ) block; the struct itself closes with ")" or
            # with ") PROP(" followed by the struct's own properties and their ")".
            if skip:
                if line.endswith("("):
                    skip += 1
                elif line.startswith(")"):
                    skip -= 1
                continue
            m = re.match(r'^"([^"]+)" STRUCT\($', line)
            if m and current is None:
                current, depth = m.group(1), 0
                structs[current] = []
                continue
            if current is not None:
                f = re.match(r'^"([^"]+)" (FLOAT|INT|STRING|COMPLEX)', line)
                if f and depth == 0:
                    structs[current].append(f.group(1))
                if line.startswith(")") and depth == 0:
                    current = None
                    if line.endswith("PROP("):
                        skip = 1
                elif line.endswith("PROP("):
                    depth += 1
                elif line.startswith(")"):
                    depth -= 1
        elif section == "VALUE":
            if inst is not None:
                if line.strip() == ")":
                    insts[inst] = dict(zip(fields, values))
                    inst = None
                else:
                    try:
                        values.append(float(line.strip()))
                    except ValueError:
                        values.append(None)
                continue
            m = re.match(r'^"([^"]+)" "([^"]+)" \($', line)
            if m and m.group(2) in structs:
                inst, fields, values = m.group(1), structs[m.group(2)], []
                continue
            m = re.match(r'^"([^"]+)"(?: "[^"]*")? (?:\(([-+0-9.eE]+) ([-+0-9.eE]+)\)|([-+0-9.eE]+))$', line)
            if not m:
                continue
            key = m.group(1)
            value = complex(float(m.group(2)), float(m.group(3))) if m.group(2) is not None else float(m.group(4))
            if sweep_name is None:
                sweep_name = key
            if key == sweep_name:
                points.append({})
            if points:
                points[-1][key] = value
    return points, insts


class Spectre:
    name = "spectre"

    @staticmethod
    def version(command):
        try:
            out = subprocess.run([command, "-V"], capture_output=True, text=True, timeout=300)
        except (OSError, subprocess.TimeoutExpired) as error:
            raise ToolError("spectre %s does not answer -V (%s)" % (command, error))
        match = re.search(r"spectre\s+version\s+([0-9][0-9A-Za-z.+-]*)", out.stdout + out.stderr)
        if not match:
            raise ToolError("%s is not spectre (its -V said: %s)" % (command, (out.stdout + out.stderr).strip()[-200:]))
        return "spectre-" + match.group(1)

    @staticmethod
    def device(card, kind, name, nets, w, l):
        """The instance line and the name its operating point is written under (the device itself,
        or the transistor inside the PDK's subcircuit)."""
        dev = card["devices"][kind]
        return "%s (%s) %s %s" % (name, " ".join(nets), dev["model"], dev_params(card, kind, w, l)), dev["op"]["spectre"].format(inst=name)

    @classmethod
    def head(cls, inputs, stage, corner, title):
        card = card_of(inputs, stage)
        return ["// " + title, "simulator lang=spice"] + lib_lines(inputs, stage, corner, "spectre") + \
            ["simulator lang=spectre", "opts options temp=%g rawfmt=psfascii" % card["temperatureC"]]

    @classmethod
    def sweep(cls, command, inputs, stage, kind, out_dir, name):
        card = card_of(inputs, stage)
        dev = card["devices"][kind]
        sign = 1.0 if kind == "nmos" else -1.0
        vdd = card["vdd"]
        lines = cls.head(inputs, stage, "tt", "gm/Id characterization: %s %s" % (inputs["pdks"][stage]["name"], kind))
        lines += ["VD (d 0) vsource dc=%g" % (sign * vdd / 2.0), "VG (g 0) vsource dc=0"]
        insts = []
        for i, length in enumerate(dev["lengthsUm"]):
            line, inst = cls.device(card, kind, "MC%d" % i, ("d", "g", "0", "0"), dev["charWUm"], length)
            lines.append(line)
            insts.append(inst)
        names = op_names(card, kind, "spectre")
        lines.append("save " + " ".join("%s:%s" % (inst, names[p]) for inst in insts for p in CHAR_PARAMS))
        points = int(round(vdd / SWEEP_STEP_V))
        lines += ["sw dc dev=VG param=dc start=0 stop=%g lin=%d" % (sign * vdd, points), ""]
        stem = fresh_stem(out_dir, name, (".scs", ".scs.log", ".raw"))
        netlist, raw = Path(str(stem) + ".scs"), Path(str(stem) + ".raw")
        write_text(netlist, "\n".join(lines))
        run([command, "-64", str(netlist), "-raw", str(raw)], out_dir, Path(str(netlist) + ".log"))
        if not (raw / "sw.dc").is_file():
            raise ToolError("spectre wrote no sweep for %s (log %s.log)" % (name, netlist))
        return cls.sweep_rows(raw / "sw.dc", insts, names)

    @staticmethod
    def sweep_rows(path, insts, names=None):
        names = names or SPECTRE_OP
        rows, _ = psf_ascii(path)
        out = []
        for r in rows:
            keys = ["%s:%s" % (inst, names[p]) for inst in insts for p in CHAR_PARAMS]
            if "dc" not in r or any(k not in r for k in keys):
                continue                       # a point Spectre did not state is dropped, never zero-filled
            out.append(dict(vgs=abs(r["dc"]), devices=[{p: abs(r["%s:%s" % (inst, names[p])]) for p in CHAR_PARAMS} for inst in insts]))
        return out

    @classmethod
    def ota(cls, command, inputs, stage, netlist_lines, insts, vdd, out_dir, name):
        lines = list(netlist_lines) + ["dcop dc oppoint=rawfile", "opinfo info what=oppoint where=rawfile",
                                       "acan ac start=%g stop=%g dec=%d" % (AC_START_HZ, AC_STOP_HZ, AC_PER_DECADE), ""]
        stem = fresh_stem(out_dir, name, (".scs", ".scs.log", ".raw"))
        netlist, raw = Path(str(stem) + ".scs"), Path(str(stem) + ".raw")
        write_text(netlist, "\n".join(lines))
        run([command, "-64", str(netlist), "-raw", str(raw)], out_dir, Path(str(netlist) + ".log"))
        for f in ("dcop.dc", "opinfo.info", "acan.ac"):
            if not (raw / f).is_file():
                raise ToolError("spectre wrote no %s for %s (log %s.log)" % (f, name, netlist))
        card = card_of(inputs, stage)
        return cls.facts(raw, insts, vdd, {d: op_names(card, KIND_OF[d], "spectre") for d in DEVICES})

    @staticmethod
    def facts(raw, insts, vdd, names=None):
        """The testbench's facts from Spectre's PSF ASCII output directory."""
        raw = Path(raw)
        dc, _ = psf_ascii(raw / "dcop.dc")
        _, info = psf_ascii(raw / "opinfo.info")
        acp, _ = psf_ascii(raw / "acan.ac")
        supply = dc[0].get("VSUP:p") if dc else None
        op = {}
        for dev in DEVICES:
            fields = info.get(insts[dev])
            n = (names or {}).get(dev) or SPECTRE_OP
            op[dev] = None if fields is None else {p: fields.get(n[p]) for p in OP_PARAMS}
            if op[dev] is not None and any(v is None for v in op[dev].values()):
                op[dev] = None
        ac = [(p["freq"], p["out"].real, p["out"].imag) for p in acp if "freq" in p and "out" in p]
        return dict(powerW=None if supply is None else -supply * vdd, op=op, ac=ac)


SIMULATORS = {"spectre": Spectre, "ngspice": Ngspice}
CHAR_PARAMS = ("id", "gm", "gds", "cgg")
OP_PARAMS = ("vds", "vdsat", "id", "gm", "gds")
SPECTRE_OP = {"id": "ids", "gm": "gm", "gds": "gds", "cgg": "cgg", "vds": "vds", "vdsat": "vdsat"}
# The sweep starts at 0.1 Hz: below it the testbench's DC feedback (1 GH, 1 F) starts to close the loop
# (loop gain about 2.5e-9 x A at 0.1 Hz, 2.5e-5 x A at 1 mHz) and the open-loop gain reads high.
AC_START_HZ, AC_STOP_HZ, AC_PER_DECADE = 0.1, 1e10, 40
FLAT_DB, FLAT_DEG = 0.1, 5.0      # the response at the sweep start must be this flat and this close to 0 deg


def simulator_for(inputs, stage, own=False):
    """The bound simulator of the stage's PDK, or, for an agent's own run, the one OTA_SIM names
    (`ngspice=<command>` or a bare ngspice command) when the PDK's card lists it."""
    if own and os.environ.get("OTA_SIM"):
        text = os.environ["OTA_SIM"]
        name, command = text.split("=", 1) if "=" in text else ("ngspice", text)
        if name not in SIMULATORS or name not in card_of(inputs, stage)["simulators"]:
            raise ToolError("OTA_SIM names %s; %s is simulated with %s" % (name, inputs["pdks"][stage]["name"], " or ".join(card_of(inputs, stage)["simulators"])))
        return SIMULATORS[name], command
    sim = inputs["pdks"][stage]["simulator"]
    return SIMULATORS[sim["name"]], sim["path"]


# ---------------------------------------------------------------- characterization (gm/Id tables)

def build_table(card, kind, rows):
    dev = card["devices"][kind]
    lengths = {}
    for i, length in enumerate(dev["lengthsUm"]):
        points = []
        for row in rows:
            d = row["devices"][i]
            ident, gm, gds, cgg = d["id"], d["gm"], d["gds"], d["cgg"]
            jd = 1e6 * ident / dev["charWUm"]          # uA per um of width
            if jd < MIN_JD_UA_UM or gm <= 0:
                continue
            points.append(dict(vgs=round(row["vgs"], 4), jdUaUm=jd, gmId=gm / ident,
                               gmGds=gm / gds if gds > 0 else None,
                               ftGhz=gm / (2 * math.pi * cgg) / 1e9 if cgg > 0 else None))
        if len(points) < 5:
            raise ToolError("%s at L=%s um: only %d usable sweep points" % (kind, um(length), len(points)))
        lengths[um(length)] = points
    return lengths


def cmd_characterize(ws):
    ws = Path(ws)
    inputs = load_inputs(ws)
    out_dir = report_dir(ws, "characterize", 1)
    out_dir.mkdir(parents=True, exist_ok=True)
    summary = []
    for stage in STAGES:
        name = inputs["pdks"][stage]["name"]
        card = card_of(inputs, stage)
        sim, command = simulator_for(inputs, stage)
        table = dict(schema=TABLE_SCHEMA, pdk=name, vdd=card["vdd"], simulator=inputs["pdks"][stage]["simulator"]["version"],
                     vdsV=card["vdd"] / 2.0, devices={})
        for kind in ("nmos", "pmos"):
            rows = sim.sweep(command, inputs, stage, kind, out_dir, "gmid-%s-%s" % (name, kind))
            lengths = build_table(card, kind, rows)
            table["devices"][kind] = dict(model=card["devices"][kind]["model"], widthUm=card["devices"][kind]["charWUm"], lengths=lengths)
            for length, points in lengths.items():
                gmid = [p["gmId"] for p in points]
                summary.append((name, kind, length, min(gmid), max(gmid), max(p["jdUaUm"] for p in points)))
        write_json(state(ws, "tables-%s.json" % stage), table)
    lines = ["# gm/Id characterization", "", "| PDK | device | L (um) | gm/Id range (1/V) | max Id/W (uA/um) |", "| --- | --- | --- | --- | --- |"]
    for name, kind, length, lo, hi, jmax in summary:
        lines.append("| %s | %s | %s | %.1f to %.1f | %.1f |" % (name, kind, length, lo, hi, jmax))
    write_text(out_dir / "gmid.rpt", "\n".join(lines) + "\n")
    expected = sum(len(card_of(inputs, s)["devices"][kind]["lengthsUm"]) for s in STAGES for kind in ("nmos", "pmos"))
    write_json(state(ws, "tables.json"), dict(schema="hima-gmid-tables/1", pdks=[inputs["pdks"][s]["name"] for s in STAGES],
                                             curves=len(summary), expected=expected,
                                             simulators=[inputs["pdks"][s]["simulator"]["version"] for s in STAGES]))
    for stage in STAGES:
        write_chart(ws, "characterize", 1, "gmid-%s" % stage, gmid_chart(read_json(state(ws, "tables-%s.json" % stage))))
    print("characterized %s and %s: %d curves" % (inputs["pdks"]["source"]["name"], inputs["pdks"]["target"]["name"], len(summary)))


# ---------------------------------------------------------------- the gm/Id method

def lookup(table, kind, length_um, gmid):
    """Current density (uA/um) and the row's other facts at gm/Id = gmid for this device and L.
    Interpolates log(Id/W) linearly in gm/Id between the two sweep points around it."""
    curves = table["devices"][kind]["lengths"]
    key = um(length_um)
    if key not in curves:
        raise ToolError("%s L=%s um is not a characterized length (%s)" % (kind, key, ", ".join(curves)))
    points = curves[key]
    lo, hi = min(p["gmId"] for p in points), max(p["gmId"] for p in points)
    if not lo <= gmid <= hi:
        raise ToolError("%s at L=%s um reaches gm/Id %.1f to %.1f, not %.1f" % (kind, key, lo, hi, gmid))
    # Walk from strong inversion (low gm/Id) upward; gm/Id rises as VGS falls.
    ordered = sorted(points, key=lambda p: p["vgs"], reverse=True)
    for a, b in zip(ordered, ordered[1:]):
        if min(a["gmId"], b["gmId"]) <= gmid <= max(a["gmId"], b["gmId"]):
            t = 0.0 if a["gmId"] == b["gmId"] else (gmid - a["gmId"]) / (b["gmId"] - a["gmId"])
            jd = math.exp(math.log(a["jdUaUm"]) + t * (math.log(b["jdUaUm"]) - math.log(a["jdUaUm"])))
            vgs = a["vgs"] + t * (b["vgs"] - a["vgs"])
            return dict(jdUaUm=jd, vgs=vgs, gmGds=a.get("gmGds"), ftGhz=a.get("ftGhz"))
    raise ToolError("%s at L=%s um: gm/Id %.1f is not bracketed by the sweep" % (kind, key, gmid))


def snap(card, kind, w):
    grid = card["devices"][kind]["gridUm"]
    return round(round(w / grid) * grid, 6)


def width_for(table, card, kind, length_um, gmid, id_ua):
    row = lookup(table, kind, length_um, gmid)
    return snap(card, kind, id_ua / row["jdUaUm"]), row


INTENT_KEYS = {"ibiasUa", "i1Ua", "i6Ua", "ccPf", "rzKohm", "input", "load", "sink"}
GROUP_KEYS = {"gmId", "lUm"}


def intent_problems(intent):
    """What is wrong with an intent's shape: only the design choices (bias, currents, Cc, Rz, and a
    gm/Id and L per device group), all numbers. An intent never carries a measurement."""
    if not isinstance(intent, dict):
        return ["intent must be an object"]
    problems = []
    extra = sorted(set(intent) - INTENT_KEYS)
    if extra:
        problems.append("intent has unknown field(s) %s: an intent states bias, currents, Cc, Rz and a gm/Id and L per group" % ", ".join(extra))
    for key in ("ibiasUa", "i1Ua", "i6Ua", "ccPf", "rzKohm"):
        if not number(intent.get(key)):
            problems.append("intent %s must be a number" % key)
    for group in ("input", "load", "sink"):
        g = intent.get(group)
        if not isinstance(g, dict) or set(g) != GROUP_KEYS or not all(number(g[k]) for k in GROUP_KEYS):
            problems.append("intent %s must be {gmId, lUm} numbers" % group)
    return problems


def size_from_intent(table, card, intent):
    """Device sizes from a sizing intent (hima-ota-intent/1), by the gm/Id method:

    - input pair M1/M2 at the intent's gm/Id and L, each carrying i1Ua;
    - load mirror M3/M4 at the load gm/Id and L, each carrying i1Ua; the second-stage device M6
      takes the load's gm/Id and L (|Vgs6| = |Vgs4| at balance: zero systematic offset) and i6Ua;
    - bias mirror M8 (ibiasUa), tail M5 (2 x i1Ua) and sink M7 (i6Ua) share one gm/Id and L, so their
      currents follow their widths."""
    for key in ("ibiasUa", "i1Ua", "i6Ua", "ccPf"):
        if not number(intent.get(key)) or intent[key] <= 0:
            raise ToolError("the intent needs a positive %s" % key)
    groups = {}
    for group in ("input", "load", "sink"):
        g = intent.get(group)
        if not isinstance(g, dict) or not number(g.get("gmId")) or not number(g.get("lUm")):
            raise ToolError("the intent needs %s: {gmId, lUm}" % group)
        groups[group] = g
    i1, i6, ib = intent["i1Ua"], intent["i6Ua"], intent["ibiasUa"]
    plan = {"M1": ("input", i1), "M2": ("input", i1), "M3": ("load", i1), "M4": ("load", i1), "M6": ("load", i6),
            "M5": ("sink", 2 * i1), "M7": ("sink", i6), "M8": ("sink", ib)}
    devices, facts = {}, {}
    for name in DEVICES:
        group, current = plan[name]
        g = groups[group]
        w, row = width_for(table, card, KIND_OF[name], g["lUm"], g["gmId"], current)
        devices[name] = dict(wUm=w, lUm=float(um(g["lUm"])))
        facts[name] = dict(gmId=g["gmId"], idUa=current, vgs=round(row["vgs"], 4))
    return devices, facts


def first_cut_intent(spec, card):
    """A first-cut sizing intent from the spec sheet: the textbook two-stage Miller procedure, written
    with gm/Id instead of square-law overdrives. Every choice is a starting point an agent refines
    against the simulator; none is a claim that the spec is met.

    - Cc = 0.3 CL keeps the second pole far enough out for about 60 degrees with the gm6 below;
    - gm1 = 2 pi GBW Cc x 1.25 (25 % headroom over the GBW line); the input pair at gm/Id 15;
    - gm6 = max(2.5 x 2 pi GBW CL, 10 gm1) puts the output pole past 2.5 GBW and the zero far out;
      the second stage at the load's gm/Id 10, Rz = 1/gm6 moves the zero toward infinity;
    - bias 10 uA; the mirrors (sink) at gm/Id 12; every L three times the minimum (gain over speed)."""
    for key in ("gbwMhz", "loadPf"):
        if not number(spec.get(key)) or spec[key] <= 0:
            raise ToolError("the spec sheet needs a positive %s" % key)
    gbw, cl = spec["gbwMhz"] * 1e6, spec["loadPf"] * 1e-12
    cc = 0.3 * cl
    gm1 = 2 * math.pi * gbw * cc * 1.25
    gm6 = max(2.5 * 2 * math.pi * gbw * cl, 10 * gm1)
    lengths = {kind: card["devices"][kind]["lengthsUm"] for kind in ("nmos", "pmos")}
    pick = lambda kind, mult: min(lengths[kind], key=lambda c: abs(c - mult * card["devices"][kind]["lMinUm"]))
    return dict(ibiasUa=10.0, i1Ua=round(1e6 * gm1 / 15.0, 2), i6Ua=round(1e6 * gm6 / 10.0, 2), ccPf=round(cc * 1e12, 3),
                rzKohm=round(1e-3 / gm6, 3), input=dict(gmId=15.0, lUm=pick("nmos", 3)), load=dict(gmId=10.0, lUm=pick("pmos", 3)),
                sink=dict(gmId=12.0, lUm=pick("nmos", 3)))


def migrate_intent(source_design, source_card, target_card):
    """The gm/Id-preserving port: keep every group's gm/Id and every current, carry Cc and Rz, and map
    each L to the target length at the same multiple of the minimum length (nearest characterized)."""
    intent = source_design.get("intent")
    if not isinstance(intent, dict):
        raise ToolError("the source design carries no intent; migrate needs the gm/Id choices it was sized with")
    port = {k: json.loads(json.dumps(v)) for k, v in intent.items() if k in INTENT_KEYS}
    for group, kind in (("input", "nmos"), ("load", "pmos"), ("sink", "nmos")):
        ratio = intent[group]["lUm"] / source_card["devices"][kind]["lMinUm"]
        want = ratio * target_card["devices"][kind]["lMinUm"]
        choices = target_card["devices"][kind]["lengthsUm"]
        port[group]["lUm"] = min(choices, key=lambda c: (abs(math.log(c / want)), c))
    port.setdefault("rzKohm", source_design.get("rzKohm", 0.0))
    return port


# ---------------------------------------------------------------- designs (agent deliveries)

def design_path(ws, stage):
    return state(ws, "design-%s.json" % stage)


def validate_design(ws, stage, path=None, files_root=None):
    """Check an OTA design (hima-ota-design/1) for STAGE against the Pack: its identity, the topology's
    devices, every size legal for the stage's PDK, matched pairs, bias and compensation in range, a
    migrated design's source. Performance is never read from the file: the simulator measures it."""
    if stage not in STAGES:
        raise ToolError("stage must be source or target")
    ws = Path(ws)
    inputs = load_inputs(ws)
    card = card_of(inputs, stage)
    k = current_round(ws)
    path = Path(path) if path else design_path(ws, stage)
    doc = read_json(path, "the design %s" % path)
    problems = []
    if not isinstance(doc, dict):
        raise ToolError("the design is not a JSON object")
    extra = sorted(set(doc) - DESIGN_KEYS)
    if extra:
        problems.append("unknown field(s) %s: a design states sizes, bias and compensation; the simulator measures performance" % ", ".join(extra))
    want = dict(schema=DESIGN_SCHEMA, stage=stage, pdk=inputs["pdks"][stage]["name"], topology=TOPOLOGY, round=k)
    for key, value in want.items():
        if doc.get(key) != value:
            problems.append("%s must be %r (found %r)" % (key, value, doc.get(key)))
    for key, (lo, hi) in LIMITS.items():
        v = doc.get(key)
        if not number(v) or not lo <= v <= hi:
            problems.append("%s must be a number in [%g, %g] (found %r)" % (key, lo, hi, v))
    devices = doc.get("devices")
    if not isinstance(devices, dict) or sorted(devices) != sorted(DEVICES):
        problems.append("devices must be exactly %s" % ", ".join(DEVICES))
        devices = {}
    for name, d in sorted(devices.items()):
        lim = card["devices"][KIND_OF[name]]
        if not isinstance(d, dict) or sorted(d) != ["lUm", "wUm"] or not number(d.get("wUm")) or not number(d.get("lUm")):
            problems.append("%s must be {wUm, lUm} numbers" % name)
            continue
        if not lim["lMinUm"] - 1e-9 <= d["lUm"] <= lim["lMaxUm"] + 1e-9:
            problems.append("%s L=%s um is outside %s's [%s, %s] um" % (name, um(d["lUm"]), doc.get("pdk"), um(lim["lMinUm"]), um(lim["lMaxUm"])))
        if not lim["wMinUm"] - 1e-9 <= d["wUm"] <= lim["wMaxUm"] + 1e-9:
            problems.append("%s W=%s um is outside %s's [%s, %s] um" % (name, um(d["wUm"]), doc.get("pdk"), um(lim["wMinUm"]), um(lim["wMaxUm"])))
        for key in ("wUm", "lUm"):
            steps = d[key] / lim["gridUm"]
            if abs(steps - round(steps)) > 1e-6:
                problems.append("%s %s=%s um is off the %s um grid" % (name, key[0].upper(), um(d[key]), um(lim["gridUm"])))
    for a, b in (("M1", "M2"), ("M3", "M4")):
        if a in devices and b in devices and devices[a] != devices[b]:
            problems.append("%s and %s are a matched pair and must have the same W and L" % (a, b))
    if "intent" in doc:
        found = intent_problems(doc["intent"])
        problems += found
        table_path = state(ws, "tables-%s.json" % stage)
        if not found and table_path.is_file():
            try:
                sized, _ = size_from_intent(read_json(table_path), card, doc["intent"])
            except ToolError as error:
                problems.append("the intent cannot be sized: %s" % error)
            else:
                if sized != devices:
                    problems.append("the devices do not follow the intent (draft size or draft migrate gives them): "
                                    "re-draft from the intent, or remove the intent to deliver a hand-sized design")
                for key in ("ibiasUa", "ccPf", "rzKohm"):
                    if number(doc.get(key)) and doc["intent"][key] != doc[key]:
                        problems.append("%s differs from the intent's" % key)
    for key in ("summary", "reason"):
        if not isinstance(doc.get(key), str) or not doc[key].strip():
            problems.append("%s must say in words what the design does and why" % key)
    report = "reports/%s/r%d/analysis.md" % (AGENT_NODES[stage], k)
    if doc.get("report") != report:
        problems.append("report must be %s" % report)
    elif files_root is not None and not (Path(files_root) / report).is_file():
        problems.append("the report %s is not in your workspace (%s)" % (report, files_root))
    if stage == "target":
        source = design_path(ws, "source")
        cited = doc.get("migratedFrom")
        if not source.is_file():
            problems.append("there is no accepted source design to migrate from")
        elif not isinstance(cited, dict) or cited.get("sha256") != sha256_file(source) or cited.get("pdk") != inputs["pdks"]["source"]["name"]:
            problems.append("migratedFrom must name the accepted source design: {pdk: %s, sha256: %s}"
                            % (inputs["pdks"]["source"]["name"], sha256_file(source)))
    elif "migratedFrom" in doc:
        problems.append("a source design is not migrated from anything")
    if problems:
        raise ToolError("design refused:\n- " + "\n- ".join(problems))
    return doc, dict(round=k, stage=stage, pdk=doc["pdk"])


def cmd_design(ws, stage):
    doc, facts = validate_design(ws, stage)
    print("%s design for round %d accepted (%s)" % (stage, facts["round"], facts["pdk"]))


def draft(ws, kind, given=None):
    ws = Path(ws)
    inputs = load_inputs(ws)
    k = current_round(ws)
    if kind == "intent":
        if given is None:
            raise ToolError("draft intent needs a spec sheet file: {gainDb, gbwMhz, pmDeg, powerUw, loadPf}")
        return first_cut_intent(read_json(given, "the spec sheet %s" % given), card_of(inputs, "source"))
    if kind == "keep":
        doc = read_json(design_path(ws, "source"), "the accepted source design state/design-source.json")
        doc.update(round=k, report="reports/%s/r%d/analysis.md" % (AGENT_NODES["source"], k),
                   summary="Kept from round %d: %s" % (doc.get("round"), doc.get("summary", "")))
        return doc
    if kind == "size":
        if given is None:
            raise ToolError("draft size needs an intent file: {ibiasUa, i1Ua, i6Ua, ccPf, rzKohm, input, load, sink}")
        intent = read_json(given, "the intent %s" % given)
        stage = "source"
    elif kind == "migrate":
        source = read_json(design_path(ws, "source"), "the accepted source design state/design-source.json")
        intent = read_json(given, "the intent %s" % given) if given else migrate_intent(source, card_of(inputs, "source"), card_of(inputs, "target"))
        stage = "target"
    else:
        raise ToolError("kind must be intent, size, keep or migrate")
    table = read_json(state(ws, "tables-%s.json" % stage), "the gm/Id tables (run characterize first)")
    devices, facts = size_from_intent(table, card_of(inputs, stage), intent)
    doc = dict(schema=DESIGN_SCHEMA, stage=stage, pdk=inputs["pdks"][stage]["name"], topology=TOPOLOGY, round=k,
               ibiasUa=float(intent["ibiasUa"]), ccPf=float(intent["ccPf"]), rzKohm=float(intent.get("rzKohm", 0.0)),
               devices=devices, intent={k: v for k, v in intent.items() if k in INTENT_KEYS}, summary="", reason="",
               report="reports/%s/r%d/analysis.md" % (AGENT_NODES[stage], k))
    if stage == "target":
        doc["migratedFrom"] = dict(pdk=inputs["pdks"]["source"]["name"], sha256=sha256_file(design_path(ws, "source")))
    return doc


def cmd_draft(ws, kind, given=None):
    print(json.dumps(draft(ws, kind, given), indent=2, sort_keys=True))


def cmd_precheck(ws, stage, path, own_workspace=None):
    doc, facts = validate_design(ws, stage, path=path, files_root=own_workspace or os.getcwd())
    print("precheck PASS: %s design round %d (%s). Deliver %s as the result and %s (and your other reports under its folder) "
          "as support." % (stage, facts["round"], facts["pdk"], path, doc["report"]))


# ---------------------------------------------------------------- the testbench and its measurements

NETS = {"M1": ("x", "inn", "tail", "0"), "M2": ("y", "inp", "tail", "0"), "M3": ("x", "x", "vdd", "vdd"),
        "M4": ("y", "x", "vdd", "vdd"), "M5": ("tail", "nbias", "0", "0"), "M6": ("out", "y", "vdd", "vdd"),
        "M7": ("out", "nbias", "0", "0"), "M8": ("nbias", "nbias", "0", "0")}


def ota_lines(sim, inputs, stage, design, corner, load_pf, cm_pct):
    """The open-loop AC testbench in the simulator's dialect: the output feeds the inverting input
    through a 1 GH inductor (DC unity feedback sets the bias) and a 1 F capacitor grounds that
    input for AC; the non-inverting input sits at the input common mode with an AC source of 1."""
    card = card_of(inputs, stage)
    vdd = card["vdd"]
    vcm = round(vdd * cm_pct / 100.0, 4)
    d = design["devices"]
    title = "%s two-stage Miller OTA, %s corner %s, load %g pF, input common mode %g V" % (inputs["pdks"][stage]["name"], stage, corner, load_pf, vcm)
    lines = sim.head(inputs, stage, corner, title)
    insts = {}
    for name in DEVICES:
        line, inst = sim.device(card, KIND_OF[name], name, NETS[name], d[name]["wUm"], d[name]["lUm"])
        lines.append(line)
        insts[name] = inst
    cz = "cz" if design["rzKohm"] > 0 else "y"
    if sim is Spectre:
        lines += ["VSUP (vdd 0) vsource dc=%g" % vdd, "IB (vdd nbias) isource dc=%gu" % design["ibiasUa"]]
        if design["rzKohm"] > 0:
            lines.append("RZ (y cz) resistor r=%gk" % design["rzKohm"])
        lines += ["CC (%s out) capacitor c=%gp" % (cz, design["ccPf"]), "CL (out 0) capacitor c=%gp" % load_pf,
                  "VIP (inp 0) vsource dc=%g mag=1" % vcm, "LFB (out inn) inductor l=1e9", "CFB (inn 0) capacitor c=1"]
    else:
        lines += ["VSUP vdd 0 %g" % vdd, "IB vdd nbias %gu" % design["ibiasUa"]]
        if design["rzKohm"] > 0:
            lines.append("RZ y cz %gk" % design["rzKohm"])
        lines += ["CC %s out %gp" % (cz, design["ccPf"]), "CL out 0 %gp" % load_pf, "VIP inp 0 dc %g ac 1" % vcm,
                  "LFB out inn 1e9", "CFB inn 0 1"]
    return lines, insts, vdd


def ac_measures(ac):
    """DC gain, unity-gain frequency and phase margin from the AC response of the output (frequency,
    real, imaginary), the same arithmetic for every simulator. The OTA is driven non-inverting, so
    its response at the sweep start must be flat (the first two points within 0.1 dB) and in phase
    (within 5 deg of 0): otherwise the DC gain and the phase margin are unknown, never shifted.
    Gain at the first frequency; the unity-gain frequency where |H| first falls through 1,
    interpolated in log-log; the phase unwrapped along frequency from the first point; phase
    margin = 180 + phase at unity gain."""
    if len(ac) < 2:
        return None, None, None
    mags = [math.hypot(re_, im_) for _, re_, im_ in ac]
    flat = mags[0] > 0 and mags[1] > 0 and abs(20.0 * math.log10(mags[1] / mags[0])) <= FLAT_DB
    in_phase = abs(math.degrees(math.atan2(ac[0][2], ac[0][1]))) <= FLAT_DEG
    phases, prev, offset = [], None, 0.0
    for _, re_, im_ in ac:
        p = math.degrees(math.atan2(im_, re_))
        if prev is not None:
            while p + offset - prev > 180.0:
                offset -= 360.0
            while p + offset - prev < -180.0:
                offset += 360.0
        phases.append(p + offset)
        prev = p + offset
    gain = 20.0 * math.log10(mags[0]) if flat else None
    for i in range(1, len(ac)):
        if mags[i - 1] >= 1.0 > mags[i] and mags[i] > 0:
            la, lb = math.log10(mags[i - 1]), math.log10(mags[i])
            t = la / (la - lb)
            fa, fb = math.log10(ac[i - 1][0]), math.log10(ac[i][0])
            ugf = 10 ** (fa + t * (fb - fa))
            ph = phases[i - 1] + t * (phases[i] - phases[i - 1])
            return gain, ugf / 1e6, (180.0 + ph) if flat and in_phase else None
    return gain, None, None


def corner_measures(facts):
    """One corner's measurements from a simulator's facts; a measurement the simulator did not
    produce is None, never a guess."""
    gain, gbw, pm = ac_measures(facts["ac"])
    power = None if facts["powerW"] is None else facts["powerW"] * 1e6
    devices, saturated = {}, True
    for name in DEVICES:
        op = facts["op"].get(name)
        if op is None:
            devices[name] = None
            saturated = None if saturated is not False else False
            continue
        sat = abs(op["vds"]) >= abs(op["vdsat"]) + SAT_MARGIN_V
        devices[name] = dict(vdsV=round(op["vds"], 4), vdsatV=round(op["vdsat"], 4), idUa=round(1e6 * abs(op["id"]), 4),
                             gmUs=round(1e6 * abs(op["gm"]), 3), gmId=round(abs(op["gm"] / op["id"]), 2) if op["id"] else None, saturated=sat)
        if not sat:
            saturated = False
    return dict(gainDb=gain, gbwMhz=gbw, pmDeg=pm, powerUw=power, saturated=saturated, devices=devices)


def worst_of(corners):
    """The spec view of all corners: the lowest gain, GBW and PM, the highest power; None when any
    corner lacks the measurement (an unknown never improves the worst case)."""
    def pick(key, fn):
        vals = [c[key] for c in corners.values()]
        return None if any(v is None for v in vals) else fn(vals)
    sat = [c["saturated"] for c in corners.values()]
    return dict(gainDb=pick("gainDb", min), gbwMhz=pick("gbwMhz", min), pmDeg=pick("pmDeg", min), powerUw=pick("powerUw", max),
                saturated=False if False in sat else (None if None in sat else True))


def area_um2(design):
    return round(sum(d["wUm"] * d["lUm"] for d in design["devices"].values()), 4)


def simulate_design(ws, inputs, stage, design, load_pf, cm_pct, out_dir, own=False):
    out_dir = Path(out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    sim, command = simulator_for(inputs, stage, own=own)
    corners = {}
    for corner in deck(card_of(inputs, stage), sim.name)["corners"]:
        lines, insts, vdd = ota_lines(sim, inputs, stage, design, corner, load_pf, cm_pct)
        corners[corner] = corner_measures(sim.ota(command, inputs, stage, lines, insts, vdd, out_dir, "ota-%s" % corner))
    return corners, sim.name


def measure_rpt(record):
    lines = ["# %s OTA in %s: simulated at every corner" % (record["stage"].capitalize(), record["pdk"]), "",
             "Load %g pF; supply %.2f V; input common mode %g %% of supply; %s." % (record["loadPf"], record["vdd"], record["cmPct"], record["simulator"]), "",
             "| corner | DC gain (dB) | unity-gain freq (MHz) | phase margin (deg) | power (uW) | all saturated |",
             "| --- | --- | --- | --- | --- | --- |"]
    for corner, c in record["corners"].items():
        lines.append("| %s | %s | %s | %s | %s | %s |" % (corner, fmt(c["gainDb"], "%.1f"), fmt(c["gbwMhz"], "%.2f"), fmt(c["pmDeg"], "%.1f"),
                                                          fmt(c["powerUw"], "%.1f"), {True: "yes", False: "no", None: "unknown"}[c["saturated"]]))
    w = record["worst"]
    lines += ["| worst | %s | %s | %s | %s | %s |" % (fmt(w["gainDb"], "%.1f"), fmt(w["gbwMhz"], "%.2f"), fmt(w["pmDeg"], "%.1f"),
                                                     fmt(w["powerUw"], "%.1f"), {True: "yes", False: "no", None: "unknown"}[w["saturated"]]), ""]
    lines += ["Device sizes and bias at the typical corner:", "", "| device | W (um) | L (um) | Id (uA) | gm/Id (1/V) | Vds (V) | Vdsat (V) |",
              "| --- | --- | --- | --- | --- | --- | --- |"]
    typical = record["corners"].get("tt") or next(iter(record["corners"].values()))
    for name in DEVICES:
        d, op = record["design"]["devices"][name], typical["devices"].get(name) or {}
        lines.append("| %s | %s | %s | %s | %s | %s | %s |" % (name, um(d["wUm"]), um(d["lUm"]), fmt(op.get("idUa"), "%.2f"),
                                                             fmt(op.get("gmId"), "%.1f"), fmt(op.get("vdsV"), "%.3f"), fmt(op.get("vdsatV"), "%.3f")))
    lines += ["", "Bias %g uA, Cc %g pF, Rz %g kOhm; active area %.1f um2." % (record["design"]["ibiasUa"], record["design"]["ccPf"],
                                                                               record["design"]["rzKohm"], record["areaUm2"]),
              "", CLAIM_BOUNDARY, ""]
    return "\n".join(lines)


def cmd_simulate(ws, stage, load_pf, cm_pct, gain_db, gbw_mhz, pm_deg, power_uw):
    ws = Path(ws)
    if stage not in STAGES:
        raise ToolError("stage must be source or target")
    inputs = load_inputs(ws)
    design, facts = validate_design(ws, stage)
    k = facts["round"]
    load, cm = float(load_pf), float(cm_pct)
    if not 20 <= cm <= 80:
        raise ToolError("the input common mode must be 20 to 80 %% of the supply (found %g)" % cm)
    out_dir = report_dir(ws, SIM_NODES[stage], k)
    corners, _ = simulate_design(ws, inputs, stage, design, load, cm, out_dir)
    record = dict(schema=MEASURE_SCHEMA, stage=stage, round=k, pdk=inputs["pdks"][stage]["name"], vdd=card_of(inputs, stage)["vdd"],
                  loadPf=load, cmPct=cm, simulator=inputs["pdks"][stage]["simulator"]["version"], designSha256=sha256_file(design_path(ws, stage)),
                  design=dict(ibiasUa=design["ibiasUa"], ccPf=design["ccPf"], rzKohm=design["rzKohm"], devices=design["devices"]),
                  areaUm2=area_um2(design), corners=corners, worst=worst_of(corners), claimBoundary=CLAIM_BOUNDARY, measuredAt=now())
    spec = spec_of(gain_db, gbw_mhz, pm_deg, power_uw)
    met = spec_met(record["worst"], spec)
    record.update(spec=spec, specMet=met, marginPct=margins(record["worst"], spec),
                  meetsSpec=None if record["worst"]["saturated"] is None or None in met.values()
                  else (record["worst"]["saturated"] is True and all(met.values())),
                  unsaturated={c: sorted(n for n, d in v["devices"].items() if d is not None and not d["saturated"]) for c, v in corners.items()})
    write_json(state(ws, "measure-%s.json" % stage), record)
    write_text(out_dir / "measure.rpt", measure_rpt(record))
    write_chart(ws, SIM_NODES[stage], k, "corners", corners_chart(record))
    w = record["worst"]
    print("%s round %d in %s: worst gain %s dB, GBW %s MHz, PM %s deg, power %s uW, saturated %s; meets the spec: %s"
          % (stage, k, record["pdk"], fmt(w["gainDb"], "%.1f"), fmt(w["gbwMhz"], "%.2f"), fmt(w["pmDeg"], "%.1f"), fmt(w["powerUw"], "%.1f"),
             w["saturated"], record["meetsSpec"]))


def cmd_sim(ws, stage, path, load_pf, cm_pct, out_dir=None):
    """The testbench on an agent's own draft (in its own workspace): the same netlist and the same
    measurements the Pack's simulate step uses, printed as JSON. Never a delivery."""
    ws = Path(ws)
    inputs = dict(load_inputs(ws))
    if os.environ.get("OTA_PDK_ROOT"):
        inputs["ownPdkRoot"] = os.environ["OTA_PDK_ROOT"]
    design = read_json(path, "the design %s" % path)
    if design.get("stage") != stage or not isinstance(design.get("devices"), dict) or sorted(design["devices"]) != sorted(DEVICES):
        raise ToolError("%s is not a %s design with devices %s" % (path, stage, ", ".join(DEVICES)))
    corners, used = simulate_design(ws, inputs, stage, design, float(load_pf), float(cm_pct), Path(out_dir or "sim-%s" % stage), own=True)
    print(json.dumps(dict(simulator=used, corners=corners, worst=worst_of(corners), areaUm2=area_um2(design)), indent=2, sort_keys=True))


# ---------------------------------------------------------------- the round record

def spec_met(worst, spec):
    """Per spec line: True, False or None (unknown)."""
    out = {}
    for key, _, _, _, better in SPEC:
        v = worst.get(key)
        out[key] = None if v is None else (v >= spec[key] if better == "higher" else v <= spec[key])
    return out


def margins(worst, spec):
    """Worst normalized margin over the four spec lines, percent (negative = short of the spec)."""
    vals = []
    for key, _, _, _, better in SPEC:
        v = worst.get(key)
        if v is None:
            return None
        vals.append(100.0 * ((v - spec[key]) if better == "higher" else (spec[key] - v)) / abs(spec[key]))
    return round(min(vals), 3)


def spec_of(gain_db, gbw_mhz, pm_deg, power_uw):
    return dict(gainDb=float(gain_db), gbwMhz=float(gbw_mhz), pmDeg=float(pm_deg), powerUw=float(power_uw))


NO_VALID_ROUND_PCT = -100.0   # the best margin before any valid round: the floor, every line fully missed


def migration_of(source_design, target_design):
    """How far the migrated design's choices moved from the source's: per group gm/Id and L, and
    the current ratios. None when either design was sized by hand (no intent)."""
    si, ti = (source_design or {}).get("intent"), (target_design or {}).get("intent")
    if not isinstance(si, dict) or not isinstance(ti, dict):
        return None
    out = {g: dict(gmId=[si[g]["gmId"], ti[g]["gmId"]], lUm=[si[g]["lUm"], ti[g]["lUm"]]) for g in ("input", "load", "sink")}
    out["currentRatios"] = {k: round(ti[k] / si[k], 4) for k in ("ibiasUa", "i1Ua", "i6Ua") if si.get(k)}
    out["ccPf"], out["rzKohm"] = [si["ccPf"], ti["ccPf"]], [si["rzKohm"], ti["rzKohm"]]
    return out


def cmd_record(ws, gain_db, gbw_mhz, pm_deg, power_uw):
    ws = Path(ws)
    inputs = load_inputs(ws)
    k = current_round(ws)
    spec = spec_of(gain_db, gbw_mhz, pm_deg, power_uw)
    stages, problems, measured = {}, [], {}
    for stage in STAGES:
        path = state(ws, "measure-%s.json" % stage)
        m = read_json(path) if path.is_file() else None
        if m is None or m.get("round") != k:
            stages[stage] = None
            if stage == "source" or (measured.get("source") or {}).get("meetsSpec") is True:
                problems.append("no %s measurement this round" % stage)
            continue
        measured[stage] = m
        if m.get("designSha256") != sha256_file(design_path(ws, stage)):
            problems.append("the %s measurement is not of the accepted %s design" % (stage, stage))
        if m.get("spec") != spec:
            problems.append("the %s measurement was judged against another spec sheet" % stage)
        met = spec_met(m["worst"], spec)
        stages[stage] = dict(pdk=m["pdk"], simulator=m["simulator"], worst=m["worst"], areaUm2=m["areaUm2"], specMet=met,
                             specsMet=sum(1 for v in met.values() if v is True), marginPct=margins(m["worst"], spec),
                             saturated=m["worst"]["saturated"], unsaturated=m.get("unsaturated") or {})
    if len({(m.get("loadPf"), m.get("cmPct")) for m in measured.values()}) > 1:
        problems.append("the source and target were simulated with different load or input common mode")
    source, target = stages["source"], stages["target"]
    if source is not None and measured["source"].get("meetsSpec") is False:
        problems.append("the source design does not meet the spec, so this round has no migration")
    elif source is not None and measured["source"].get("meetsSpec") is None:
        problems.append("whether the source design meets the spec is unknown (a measurement or the saturation is unknown at some corner)")
    if target is not None:
        if target["saturated"] is not True:
            problems.append("the target design has a device out of saturation at some corner" if target["saturated"] is False
                            else "the target design's saturation is unknown at some corner")
        if target["marginPct"] is None:
            problems.append("a target measurement is unknown at some corner")
    valid = target is not None and not problems
    lessons = read_json(state(ws, "lessons.json"))
    earlier = [r["targetMarginPct"] for r in lessons["rounds"] if r.get("roundValid") and r.get("targetMarginPct") is not None]
    # A margin is shown only for the accepted design measured under this round's conditions.
    identity = any(("not of the accepted" in p) or ("another spec sheet" in p) or ("different load" in p) for p in problems)
    margin = None if target is None or identity else target["marginPct"]
    best = max(earlier + ([margin] if valid else []), default=None)
    design = lambda stage: read_json(design_path(ws, stage)) if design_path(ws, stage).is_file() else None
    record = dict(schema=ROUND_SCHEMA, round=k, loadPf=(measured.get("source") or {}).get("loadPf"),
                  cmPct=(measured.get("source") or {}).get("cmPct"), spec=spec, source=source, target=target,
                  roundValid=valid, problems=problems, targetMarginPct=margin,
                  bestMarginPct=NO_VALID_ROUND_PCT if best is None else best, bestMarginBasis="valid rounds" if best is not None else "no valid round yet",
                  roundImproved=bool(valid and margin is not None and (not earlier or margin > max(earlier))),
                  migration=migration_of(design("source"), design("target")) if target is not None else None,
                  claimBoundary=CLAIM_BOUNDARY, recordedAt=now())
    out = report_dir(ws, "record-round", k)
    write_text(out / ("round-%d.md" % k), round_md(record, inputs))
    write_chart(ws, "record-round", k, "migration", migration_chart(record))
    write_text(Path(ws) / "derived" / ("round-%d.md" % k), round_md(record, inputs))
    lessons["rounds"].append(dict(round=k, roundValid=valid, problems=problems, targetMarginPct=margin,
                                  sourceWorst=None if source is None else source["worst"],
                                  targetWorst=None if target is None else target["worst"],
                                  sourceSpecsMet=None if source is None else source["specsMet"],
                                  targetSpecsMet=None if target is None else target["specsMet"],
                                  sourceUnsaturated=None if source is None else source["unsaturated"],
                                  targetUnsaturated=None if target is None else target["unsaturated"],
                                  migration=record["migration"]))
    write_summary(ws, inputs, lessons, spec)
    write_json(state(ws, "round.json"), record)
    write_json(state(ws, "lessons.json"), lessons)
    print("round %d recorded: valid %s, target margin %s %%" % (k, valid, fmt(margin)))


def round_md(r, inputs):
    names = {s: inputs["pdks"][s]["name"] for s in STAGES}
    lines = ["# Round %d: two-stage OTA from %s to %s" % (r["round"], names["source"], names["target"]), "",
             "Load %s pF. The spec is met when the worst corner meets every line." % fmt(r["loadPf"], "%g"), "",
             "| | spec | %s (source) | %s (target) |" % (names["source"], names["target"]), "| --- | --- | --- | --- |"]
    for key, label, unit, digits, better in SPEC:
        cells = []
        for stage in STAGES:
            s = r[stage]
            if s is None:
                cells.append("not simulated")
                continue
            ok = s["specMet"][key]
            cells.append("%s %s" % (fmt(s["worst"][key], "%%.%df" % digits), {True: "(met)", False: "(missed)", None: "(unknown)"}[ok]))
        lines.append("| %s (%s) | %s %s | %s | %s |" % (label, unit, ">=" if better == "higher" else "<=", fmt(r["spec"][key], "%%.%df" % digits), *cells))
    best = "none yet" if r.get("bestMarginBasis") == "no valid round yet" else "%s %%" % fmt(r["bestMarginPct"])
    lines += ["", "Round valid: %s. Target worst margin %s %% (best of a valid round so far: %s)." % (
        "yes" if r["roundValid"] else "no", fmt(r["targetMarginPct"]), best)]
    mig = r.get("migration")
    if mig:
        lines += ["", "How the migrated design moved from the source design:", "",
                  "| group | gm/Id (1/V) | L (um) |", "| --- | --- | --- |"]
        for g in ("input", "load", "sink"):
            lines.append("| %s | %g -> %g | %s -> %s |" % (g, mig[g]["gmId"][0], mig[g]["gmId"][1], um(mig[g]["lUm"][0]), um(mig[g]["lUm"][1])))
        lines += ["", "Current ratios (target / source): %s; Cc %g -> %g pF; Rz %g -> %g kOhm." % (
            ", ".join("%s x%g" % (k, v) for k, v in mig["currentRatios"].items()), mig["ccPf"][0], mig["ccPf"][1], mig["rzKohm"][0], mig["rzKohm"][1])]
    elif r.get("target") is not None:
        lines += ["", "The migrated design was sized by hand (no gm/Id intent to compare)."]
    for stage in STAGES:
        s_ = r.get(stage)
        bad = sorted({n for names in ((s_ or {}).get("unsaturated") or {}).values() for n in names})
        if bad:
            lines.append("%s devices out of saturation at some corner: %s." % (stage.capitalize(), ", ".join(bad)))
    if r["problems"]:
        lines += ["", "Problems: " + "; ".join(r["problems"])]
    lines += ["", CLAIM_BOUNDARY, ""]
    return "\n".join(lines)


def write_summary(ws, inputs, lessons, spec):
    names = {s: inputs["pdks"][s]["name"] for s in STAGES}
    lines = ["# Two-stage OTA from %s to %s: summary" % (names["source"], names["target"]), "",
             "Spec at the worst corner: gain >= %g dB, unity-gain frequency >= %g MHz, phase margin >= %g deg, power <= %g uW."
             % (spec["gainDb"], spec["gbwMhz"], spec["pmDeg"], spec["powerUw"]), "",
             "| round | source lines met | target lines met | target worst margin (%) | valid |", "| --- | --- | --- | --- | --- |"]
    for r in lessons["rounds"]:
        lines.append("| %d | %s | %s | %s | %s |" % (r["round"], fmt(r["sourceSpecsMet"], "%d"), fmt(r["targetSpecsMet"], "%d"),
                                                     fmt(r["targetMarginPct"]), "yes" if r["roundValid"] else "no"))
    valid = [r["targetMarginPct"] for r in lessons["rounds"] if r["roundValid"] and r["targetMarginPct"] is not None]
    lines += ["", "Best worst margin of the migrated OTA: %s %%." % fmt(max(valid) if valid else None),
              "Round reports: `derived/round-<k>.md`; every step's reports under `reports/<step>/r<k>/`.", "", CLAIM_BOUNDARY, ""]
    write_text(Path(ws) / "derived" / "summary.md", "\n".join(lines))


# ---------------------------------------------------------------- charts (hima-chart/1)

def chart(title, categories, series, source, metrics, subtitle=None, caption=None):
    doc = dict(schema=CHART_SCHEMA, title=title[:80], kind="metrics", unit="", categories=list(categories),
               series=[dict(name=n[:32], values=[None if v is None else round(float(v), 4) for v in vals], role=role) for n, vals, role in series],
               highlight=[], source=source[:160], units=[m[0] for m in metrics], digits=[m[1] for m in metrics], betterEach=[m[2] for m in metrics])
    if subtitle:
        doc["subtitle"] = subtitle[:120]
    if caption:
        doc["caption"] = caption[:200]
    return doc


def write_chart(ws, node, k, name, doc):
    path = report_dir(ws, node, k) / ("%s.chart.json" % name)
    write_text(path, json.dumps(doc, indent=2, sort_keys=True) + "\n")
    return path


def gmid_chart(table):
    """Current density needed for gm/Id 5, 10, 15 and 20 at each length, per device type."""
    targets = (5, 10, 15, 20)
    cats, units, digits, better = [], [], [], []
    series = {"nmos": [], "pmos": []}
    lengths = list(table["devices"]["nmos"]["lengths"])
    for length in lengths[:4]:
        for g in targets:
            cats.append("L %s gm/Id %d" % (length, g))
            units.append("uA/um")
            digits.append(2)
            better.append("none")
            for kind in ("nmos", "pmos"):
                # Only at the same length: a pmos curve at another length is not shown under this label.
                if length in table["devices"][kind]["lengths"]:
                    try:
                        series[kind].append(lookup(table, kind, float(length), g)["jdUaUm"])
                    except ToolError:
                        series[kind].append(None)
                else:
                    series[kind].append(None)
    return chart("gm/Id design curves, %s" % table["pdk"], cats[:16], [("nmos", series["nmos"][:16], "measured"), ("pmos", series["pmos"][:16], "measured")],
                 "%s DC sweeps of the %s device models (characterize)" % (table["simulator"], table["pdk"]), list(zip(units, digits, better))[:16],
                 subtitle="Current per um of width at a chosen gm/Id", caption="Higher gm/Id is weaker inversion: less current per um, more gain per uA.")


def corners_chart(record):
    corners = list(record["corners"])
    keys = [(k, l, u, d, b) for k, l, u, d, b in SPEC]
    cats = [l for _, l, _, _, _ in keys]
    series = [(c, [record["corners"][c][k] for k, *_ in keys], "measured" if c == "tt" else "neutral") for c in corners[:3]]
    return chart("%s OTA in %s, by corner" % (record["stage"].capitalize(), record["pdk"]), cats, series,
                 "%s testbench at each corner (simulate-%s)" % (record["simulator"], record["stage"]), [(u, d, b) for _, _, u, d, b in keys],
                 subtitle="Load %g pF, supply %.2f V, input at %g %% of supply" % (record["loadPf"], record["vdd"], record["cmPct"]))


def migration_chart(r):
    cats = [l for _, l, _, _, _ in SPEC] + ["Active area"]
    def vals(stage):
        s = r[stage]
        return [None] * len(cats) if s is None else [s["worst"][k] for k, *_ in SPEC] + [s["areaUm2"]]
    series = [("Spec", [r["spec"][k] for k, *_ in SPEC] + [None], "baseline"),
              (r["source"]["pdk"] if r["source"] else "source", vals("source"), "measured"),
              (r["target"]["pdk"] if r["target"] else "target", vals("target"), "proposed")]
    return chart("Round %d: the OTA before and after migration" % r["round"], cats, series,
                 "worst corner of each design, %s (record-round)" % " / ".join(sorted({r[s]["simulator"] for s in STAGES if r[s]})), [(u, d, b) for _, _, u, d, b in SPEC] + [("um2", 1, "lower")],
                 caption="Worst corner per line. " + CLAIM_BOUNDARY[:120])


# ---------------------------------------------------------------- entry

COMMANDS = {
    "bind": (cmd_bind, (4,)), "characterize": (cmd_characterize, (0,)), "design": (cmd_design, (1,)),
    "simulate": (cmd_simulate, (7,)), "record": (cmd_record, (4,)), "draft": (cmd_draft, (1, 2)),
    "precheck": (cmd_precheck, (2, 3)), "sim": (cmd_sim, (4, 5)),
}


def main(argv):
    if len(argv) < 3 or argv[1] not in COMMANDS:
        print("usage: ota_cli.py {%s} <WORKSPACE> ..." % "|".join(COMMANDS), file=sys.stderr)
        return 2
    command, arities = COMMANDS[argv[1]]
    if len(argv) - 3 not in arities:
        print("ota_cli.py %s takes %s argument(s) after the workspace" % (argv[1], " or ".join(map(str, arities))), file=sys.stderr)
        return 2
    try:
        command(os.path.abspath(argv[2]), *argv[3:])
    except ToolError as error:
        print("ota %s: %s" % (argv[1], error), file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
