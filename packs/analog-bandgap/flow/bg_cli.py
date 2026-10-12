#!/usr/bin/env python3
"""Deterministic steps of the analog-bandgap Pack (python3 >= 3.9, stdlib only).

A Kuijk bandgap reference (two vertical PNPs n:1, three poly resistors, a PMOS-input
five-transistor OTA driving a PMOS output device, directly or through a current mirror (TEMPLATES),
a bias mirror, a start-up path and an enable) is
sized from a spec sheet in one PDK and verified at every process corner, temperature and supply,
then by Monte Carlo mismatch. The agents choose a sizing intent; every number this file writes
comes from the Site's SPICE simulator (Cadence Spectre or ngspice). The designer's method (the
Kuijk equations on the characterized PNP, gm/Id lookup, the Pelgrom input-pair area) is code here.

  bind         <WS> <SIMULATORS> <PDK_ROOT> <PDK> [<TOPOLOGY>]   simulators, PDK files, the PDK card and
                                       the template (kuijk-p5t, the default, or kuijk-p5t-mirror)
  characterize <WS>                    gm/Id tables, PNP VBE(I, T) and resistor R(W, L, T) per corner
  design       <WS>                    check state/design.json (an agent's delivery)
  draft        <WS> <KIND> [<FILE>]    KIND intent (FILE = a spec sheet): the first cut from the spec;
                                       KIND size (FILE = an intent): the design it gives;
                                       KIND mc [FILE = an intent]: the intent with the input pair and
                                       load areas scaled by Pelgrom to the measured Monte Carlo sigma;
                                       KIND keep: last round's accepted design, this round
  precheck     <WS> <FILE> [<OWN_WORKSPACE>]   an agent's own check before delivery
  sim          <WS> <FILE> <SCOPE> <SPEC_FILE> [<OUT_DIR>]   an agent's own try: SCOPE is pvt, one
                                       process corner (tt, ss, ...) or mc:<N>; never a delivery
  simulate     <WS> <STAGE> <VBG_V> <VBG_TOL_PCT> <IQ_MAX_UA> <ISD_MAX_NA> <TC_MAX_PPM> <PM_MIN_DEG>
               <TSTART_MAX_US> <PSRR_MIN_DB>   the full PVT set of the accepted design (STAGE
                                       schematic) or of its extracted netlist (STAGE post)
  mc           <WS> <N> <VBG_V> <VBG_TOL_PCT> [<SEED>]   Monte Carlo mismatch, tt, 27 C, top supply
  record       <WS> <VBG_V> <VBG_TOL_PCT> <IQ_MAX_UA> <ISD_MAX_NA> <TC_MAX_PPM> <PM_MIN_DEG>
               <TSTART_MAX_US> <PSRR_MIN_DB>   the round record
  cell         <WS> [<FILE>]           the cell netlist (SPICE: bandgap_lb with the loop pins go/g, and
                                       bandgap) of the accepted design (checked) or of a design file

The simulator adapters, the PSF ASCII reader, the gm/Id tables and the file helpers are the OTA
Pack's (`ota_cli.py`, a byte-identical copy). `sim` uses OTA_SIM / OTA_PDK_ROOT as the OTA Pack's
does. Every output carries the design's SHA-256; no simulator output is ever deleted (each run
takes a fresh stem). Reports land at <WS>/reports/<node id>/r<k>/.
"""
import json
import math
import os
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ota_cli as ota  # noqa: E402  (the shared adapters; a byte-identical copy of the OTA Pack's)

ToolError = ota.ToolError
read_json, write_json, write_text, sha256_file = ota.read_json, ota.write_json, ota.write_text, ota.sha256_file
number, fmt, um, now, state, report_dir = ota.number, ota.fmt, ota.um, ota.now, ota.state, ota.report_dir

PDK_KEY = "design"                       # the one PDK, under inputs["pdks"]["design"] (the OTA helpers' shape)
STAGES = ("schematic", "post")
AGENT_NODE = "size-agent"
SIM_NODES = {"schematic": "simulate-pvt", "post": "simulate-post"}
DESIGN_SCHEMA = "hima-bandgap-design/1"
INTENT_SCHEMA = "hima-bandgap-intent/1"
MEASURE_SCHEMA = "hima-bandgap-measure/1"
MC_SCHEMA = "hima-bandgap-mc/1"
ROUND_SCHEMA = "hima-bandgap-round/1"
INPUTS_SCHEMA = "hima-bandgap-inputs/1"
DEVICES_SCHEMA = "hima-bandgap-devices/1"
TEMPS = (-40, 27, 125)                   # the PVT temperatures; the DC sweep covers -40..125 in 5 C steps
SWEEP = (-40, 125, 5)
K_Q = 8.617333262e-5                     # Boltzmann / q, V/K
T0K = 273.15
AC_START_HZ, AC_STOP_HZ, AC_PER_DECADE = 0.1, 1e9, 40
PSRR_HZ = 1e3
TRAN_STOP_US, TRAN_STEP_US = 300.0, 0.2
# Spectre 23.1 on the lab server crashed (segmentation fault, at a random point well into the run)
# whenever it had just compiled the AHDL code it generates for the PDK's poly resistor (a
# voltage-dependent `r=` expression becomes a compiled `bsource`); a run that found that code already
# compiled in its <netlist>.ahdlSimDB never crashed. It also crashed in transients that held several
# copies of the cell (and see CMIN_F). So every Spectre run starts from a copy of the compiled code of
# the runs before it (AHDL_SEED, merged after each run), runs single-threaded (+mt=1), holds one copy
# of the cell, and is retried on a crash, up to SPECTRE_ATTEMPTS times, each attempt with its own
# files; the measurement records the attempts.
SPECTRE_ATTEMPTS = 5
SPECTRE_TRAN = "maxstep=1u errpreset=moderate"
# Spectre crashed in transients on a node with almost no capacitance (the start-up path's sux, between
# two off switches); a 10 fF floor on every node (cmin; ngspice: cshunt) ended that (1 fF did not), and moves no
# measurement of this cell (its start-up nodes are a few fF, the rest tens of fF and more).
CMIN_F = 1e-14
RAMPS = {"powerUp": ("vdd", 0.0, 10.0), "en1us": ("en", 10.0, 1.0), "en50us": ("en", 10.0, 50.0)}   # what ramps, start, ramp time (us)
START_BAND_PCT = 2.0                     # start-up ends when VBG is within this of its final value and stays
STARTED_PCT = 1.0                        # the final value must be this close to the DC solution, or it did not start
LIMITS = {"ibiasUa": (0.05, 10.0), "n": (2, 24)}
CLAIM_BOUNDARY = ("Every number is the Site simulator's (Spectre or ngspice, as each measurement states) on the stated PDK's "
                  "open models at the stated corners, schematic level unless the stage says post-layout, with an ideal "
                  "reference current; Monte Carlo covers device mismatch only (global process spread is the corners); "
                  "no package stress, no trimming; not silicon.")

# The templates: MOS name -> (kind, group, drain, gate, source, bulk). Groups take their gm/Id and L
# from the intent ("drive": the load's gm/Id and L); the switches are fixed small devices (SWITCH_UM).
#
# kuijk-p5t (the spec's template): the five-transistor OTA's output drives the output device's gate.
# kuijk-p5t-mirror: the same OTA drives an NMOS transconductor M5 into a PMOS diode M6 that the output
# device mirrors (MO = driveRatio x M6), so the output device's gate sits at vdd - |VGS| at any supply
# and the OTA's output at about one NMOS VGS; the pair's inputs swap to keep the feedback negative.
_COMMON = {
    "MB0": ("pmos", "mirror", "ibias", "ibias", "vdd", "vdd"),    # reference diode (the ibias pin)
    "MT": ("pmos", "mirror", "tail", "ibias", "vdd", "vdd"),      # OTA tail
    "M3": ("nmos", "load", "d1", "d1", "ls", "vss"),              # mirror load, its foot switched by MEN3
    "MO": ("pmos", "out", "vbg", "g", "vdd", "vdd"),              # output device
    "MSU1": ("pmos", "startup", "su", "ibias", "vdd", "vdd"),     # start-up: weak pull-up of su from the bias mirror
    "MSU2": ("nmos", "switch", "su", "vbg", "vss", "vss"),        # ... released once vbg is well above the
                                                                  #     near-zero state (weak: long, narrow)
    "MSU3": ("nmos", "switch", "g", "su", "sux", "vss"),          # ... pulls the output device's gate down while su is high
    "MSU4": ("nmos", "switch", "sux", "en", "vss", "vss"),        # ... only when enabled
    "MEN1": ("pmos", "switch", "ibias", "en", "vdd", "vdd"),      # en low: the bias mirror off
    "MEN2": ("pmos", "switch", "g", "en", "vdd", "vdd"),          # en low: the output device's gate to vdd
    "MEN3": ("nmos", "switch", "ls", "en", "vss", "vss"),         # en low: the load's foot open, so the gate
}                                                                 # pulled to vdd cannot drain back through the pair
TEMPLATES = {
    "kuijk-p5t": dict(
        mos=dict(_COMMON, M1=("pmos", "pair", "d1", "b", "tail", "vdd"),   # b (the R1 side) is the non-inverting input
                 M2=("pmos", "pair", "go", "a", "tail", "vdd"), M4=("nmos", "load", "go", "d1", "ls", "vss")),
        caps={"CC": ("g", "vdd"), "CO": ("vbg", "vss")}, extra=set(),
        about="PMOS-input five-transistor OTA whose output drives the PMOS output device's gate"),
    "kuijk-p5t-mirror": dict(
        mos=dict(_COMMON, M1=("pmos", "pair", "d1", "a", "tail", "vdd"),   # a is the non-inverting input here
                 M2=("pmos", "pair", "o1", "b", "tail", "vdd"), M4=("nmos", "load", "o1", "d1", "ls", "vss"),
                 M5=("nmos", "drive", "go", "o1", "ls", "vss"),           # transconductor, matched to the load's density
                 M6=("pmos", "drive", "go", "go", "vdd", "vdd")),         # diode the output device mirrors
        caps={"CC": ("o1", "vss"), "CO": ("vbg", "vss")}, extra={"driveRatio"},
        about="PMOS-input five-transistor OTA, then an NMOS transconductor into a PMOS diode that the output device mirrors"),
}
TOPOLOGY = "kuijk-p5t"                   # the spec's template, the default


def template(topology):
    if topology not in TEMPLATES:
        raise ToolError("the topology must be one of %s (found %r)" % (", ".join(TEMPLATES), topology))
    return TEMPLATES[topology]


def intent_keys(topology):
    return INTENT_KEYS | template(topology)["extra"]


def switch_um(name):
    return SWITCH_UM.get(name, (1.0, 1.0))
SWITCH_UM = {"MSU2": (0.5, 20.0)}         # W, L of the switches (others 1 x 1 um)
RESISTORS = {"R1": ("b", "c"), "R2a": ("vbg", "a"), "R2b": ("vbg", "b")}
CAP_KEYS = {"CC": "ccPf", "CO": "coutPf"}
DESIGN_KEYS = {"schema", "pdk", "topology", "round", "n", "ibiasUa", "devices", "resistors", "caps", "intent", "summary", "reason", "report"}
INTENT_KEYS = {"n", "ibiasUa", "itailUa", "iCoreUa", "r2r1", "isuNa", "resWUm", "resSegMaxUm", "ccPf", "coutPf", "mcBandSharePct",
               "pair", "load", "mirror", "out"}
GROUPS = ("pair", "load", "mirror", "out")
GROUP_KEYS = {"gmId", "lUm"}
# Spec lines: key, label, unit, digits, better
LINES = (("vbg", "VBG (all corners)", "V", 4, "band"), ("iq", "Quiescent current", "uA", 2, "lower"),
         ("isd", "Shutdown current at 27 C", "nA", 3, "lower"), ("tc", "Temperature coefficient (box)", "ppm/C", 1, "lower"),
         ("pm", "Loop phase margin", "deg", 1, "higher"), ("start", "Start-up time", "us", 1, "lower"),
         ("psrr", "PSRR at 1 kHz", "dB", 1, "higher"))
SPEC_KEYS = ("vbgV", "vbgTolPct", "iqMaxUa", "isdMaxNa", "tcMaxPpm", "pmMinDeg", "tStartMaxUs", "psrrMinDb")


# ---------------------------------------------------------------- inputs and the card

def load_inputs(ws):
    return read_json(state(ws, "inputs.json"), "state/inputs.json (run bind first)")


def card_of(inputs):
    return inputs["pdks"][PDK_KEY]["card"]


def deck_of(inputs, sim):
    return ota.deck(card_of(inputs), sim)


def corners_of(inputs, sim):
    return list(deck_of(inputs, sim)["corners"])


def card_files(card, sim):
    files = ota.card_files(card, sim)
    for path, _section in ota.deck(card, sim).get("mismatch", []):
        if path not in files:
            files.append(path)
    return files


def pdk_root(inputs):
    return Path(inputs.get("ownPdkRoot") or inputs["pdkRoot"])


def cmd_bind(ws, simulators, root, name, topology=TOPOLOGY):
    ws = Path(ws)
    template(topology)
    cards = ota.load_cards(ws)
    card = cards.get(name)
    if card is None:
        raise ToolError("no PDK card for %s; the Pack knows %s" % (name, ", ".join(sorted(cards))))
    available = ota.parse_simulators(simulators)
    usable = [s for s in card["simulators"] if s in available]
    if not usable:
        raise ToolError("%s is simulated with %s, and the Site binds only %s" % (name, " or ".join(card["simulators"]), ", ".join(available)))
    versions = {n: ota.SIMULATORS[n].version(c) for n, c in available.items()}
    sim = usable[0]
    files = []
    for relpath in card_files(card, sim):
        path = Path(root) / relpath
        if not path.is_file():
            raise ToolError("%s: %s is not on the Site (pdkRoot %s)" % (name, relpath, root))
        files.append(dict(path=relpath, sha256=sha256_file(path)))
    for kind in ("nmos", "pmos", "pnp", "res", "cap"):
        if kind not in card["devices"]:
            raise ToolError("the %s card has no %s device; the bandgap needs MOS, a vertical PNP, a resistor and a capacitor" % (name, kind))
    pdk = dict(name=name, card=card, files=files, simulator=dict(name=sim, path=available[sim], version=versions[sim]))
    write_json(state(ws, "inputs.json"), dict(schema=INPUTS_SCHEMA, simulators={n: dict(path=available[n], version=versions[n]) for n in available},
                                             pdkRoot=str(root), topology=topology, pdks={PDK_KEY: pdk}, boundAt=now()))
    if not state(ws, "lessons.json").exists():
        write_json(state(ws, "lessons.json"), dict(schema="hima-bandgap-lessons/1", rounds=[]))
    lines = ["# Simulators, PDK and template", ""] + ["Simulator: %s (%s)" % (versions[n], c) for n, c in available.items()]
    lines += ["Template: %s (%s)" % (topology, template(topology)["about"])]
    lines += ["PDK: %s, %s; supplies %s V; process corners %s; measured with %s" % (
        name, card["title"], ", ".join("%g" % v for v in card["supplies"]), ", ".join(ota.deck(card, sim)["corners"]), versions[sim])]
    lines += ["  %s  %s" % (f["sha256"][:16], f["path"]) for f in files]
    write_text(report_dir(ws, "bind-inputs", 1) / "tools.rpt", "\n".join(lines) + "\n")
    print("bound %s; %s measured with %s; template %s" % (", ".join(versions.values()), name, sim, topology))


def simulator_for(inputs, own=False):
    return ota.simulator_for(inputs, PDK_KEY, own=own)


# ---------------------------------------------------------------- netlists (SPICE syntax for the cell, each dialect for the bench)

def inst(card, kind, name):
    """The instance name in SPICE syntax: the device letter, or X for a subcircuit."""
    prefix = card["devices"][kind]["instance"]
    return name if name[0].upper() == prefix.upper() else prefix + name


def mos_line(card, kind, name, nets, w, l, mismatch=False):
    dev = card["devices"][kind]
    prefix = card["mismatch"]["mosInstance"] if mismatch else dev["instance"]
    label = name if name[0].upper() == prefix.upper() else prefix + name
    return "%s %s %s %s" % (label, " ".join(nets), dev["model"], ota.dev_params(card, kind, w, l))


def cell_spice(card, design, mismatch=False):
    """The bandgap cell in SPICE syntax (both simulators read it): `bandgap_lb` with the loop broken
    between the OTA output (go) and the output device's gate (g), and `bandgap` with them joined."""
    pnp, res, cap = card["devices"]["pnp"], card["devices"]["res"], card["devices"]["cap"]
    tpl = template(design.get("topology", TOPOLOGY))
    lines = ["* Kuijk bandgap, topology %s, PDK %s, round %s" % (design.get("topology", TOPOLOGY), design.get("pdk"), design.get("round")),
             ".subckt bandgap_lb vdd vss en ibias vbg go g"]
    lines.append("%s vss vss a %s %s" % (inst(card, "pnp", "Q1"), pnp["model"], pnp["params"]))
    for k in range(1, int(design["n"]) + 1):
        lines.append("%s vss vss c %s %s" % (inst(card, "pnp", "Q2_%d" % k), pnp["model"], pnp["params"]))
    for name, (p, q) in RESISTORS.items():
        r = design["resistors"][name]
        lines.append("%s %s %s vss %s %s" % (inst(card, "res", name), p, q, res["model"],
                                             res["params"].format(w=um(r["wUm"]), l=um(r["lUm"]), s=int(r["s"]))))
    for name, (kind, _group, d, g, s, b) in tpl["mos"].items():
        dv = design["devices"][name]
        lines.append(mos_line(card, kind, name, (d, g, s, b), dv["wUm"], dv["lUm"], mismatch))
    for name, (p, q) in tpl["caps"].items():
        c = (design.get("caps") or {}).get(name)
        for k in range(1, int(c["m"]) + 1) if c else ():
            label = name if int(c["m"]) == 1 else "%s_%d" % (name, k)
            lines.append("%s %s %s %s %s" % (inst(card, "cap", label), p, q, cap["model"], cap["params"].format(w=um(c["wUm"]), l=um(c["lUm"]))))
    lines += [".ends bandgap_lb", "", ".subckt bandgap vdd vss en ibias vbg", "xlb vdd vss en ibias vbg g g bandgap_lb", ".ends bandgap", ""]
    return "\n".join(lines)


def lib_lines(inputs, corner, sim, mismatch=False):
    lines = ota.lib_lines(inputs, PDK_KEY, corner, sim)
    if mismatch:
        root = pdk_root(inputs)
        lines += [".lib \"%s\" %s" % (root / path, section) for path, section in deck_of(inputs, sim).get("mismatch", [])]
    return lines


# The bench: one netlist per (process corner, supply) holds seven copies of the cell, each with its own
# supply, so one DC sweep, one AC and one transient analysis per temperature measure everything:
#   1 nominal (en high; vdd carries the AC source: PSRR; the DC sweep: VBG(T), IQ(T))
#   2, 3 the loop broken at the OTA output: series voltage injection (2), shunt current injection (3)
#   4 en low (shutdown current)
#   5 power-up: vdd ramps from 0 with en tied to vdd; 6, 7 en ramps in 1 us and 50 us
# The reference current is an ideal sink from the ibias pin, on while en is high (a VCCS on en).
DUTS = (1, 2, 3, 4, 5, 6, 7)
NODES = ("g", "tail", "d1", "a", "b", "su")      # the nominal copy's nodes reported at each temperature (g is the pin)


def node_name(sim, x):
    if x == "g":
        return "g1"
    return ("X1.%s" if sim == "spectre" else "x1.%s") % x


def tag(t):
    return ("m%d" % -t) if t < 0 else ("p%d" % t)


def ramp_points(vdd):
    """The PWL points (time us, value) of copy 5's vdd and copies 6 and 7's en."""
    out = {}
    for key, (what, start, dur) in RAMPS.items():
        out[key] = [(0.0, 0.0), (start, 0.0), (start + dur, vdd)] if start > 0 else [(0.0, 0.0), (dur, vdd)]
    return out


SPECTRE_PARTS = (("nominal", 1), ("loopv", 2), ("loopi", 3), ("off", 4), ("powerUp", 5), ("en1us", 6), ("en50us", 7))


def bench_spectre(inputs, corner, vdd, ibias_ua, cell_path, temps, part, tran_opts=SPECTRE_TRAN):
    """Spectre's bench for one copy of the cell (SPECTRE_PARTS): Spectre 23.1 crashed when several
    copies shared a transient, never with one."""
    card = card_of(inputs)
    k = dict(SPECTRE_PARTS)[part]
    g = ibias_ua * 1e-6 / vdd
    ramps = ramp_points(vdd)
    pwl = lambda pts: "type=pwl wave=[%s]" % " ".join("%gu %g" % (t, v) if t else "0 %g" % v for t, v in pts)
    lines = ["// Kuijk bandgap bench: %s corner %s, vdd %g V, copy %d (%s)" % (inputs["pdks"][PDK_KEY]["name"], corner, vdd, k, part),
             "simulator lang=spectre", "global 0", "simulator lang=spice"] + lib_lines(inputs, corner, "spectre") + \
            [".include \"%s\"" % cell_path, "simulator lang=spectre",
             "opts options temp=%g tnom=%g rawfmt=psfascii save=selected cmin=%g" % (card["temperatureC"], card["temperatureC"], CMIN_F)]
    en = "en%d" % k
    if k == 5:
        lines.append("VDD5 (vdd5 0) vsource %s" % pwl(ramps["powerUp"]))
        en = "vdd5"
    else:
        lines.append("VDD%d (vdd%d 0) vsource dc=%g%s" % (k, k, vdd, " mag=1" if k == 1 else ""))
    if k in (6, 7):
        lines.append("VEN%d (en%d 0) vsource %s" % (k, k, pwl(ramps[part])))
    elif k != 5:
        lines.append("VEN%d (en%d 0) vsource dc=%g" % (k, k, 0.0 if k == 4 else vdd))
    lines.append("GIB%d (ib%d 0 %s 0) vccs gm=%.6g" % (k, k, en, g))
    vk = "vdd5" if k == 5 else "vdd%d" % k
    if k in (2, 3):
        lines.append("X%d (%s 0 %s ib%d vbg%d go%d g%d) bandgap_lb" % (k, vk, en, k, k, k, k))
        lines.append("VI%d (g%d go%d) vsource dc=0%s" % (k, k, k, " mag=1" if k == 2 else ""))
        if k == 3:
            lines.append("II3 (0 g3) isource dc=0 mag=1")
    else:
        lines.append("X%d (%s 0 %s ib%d vbg%d g%d g%d) bandgap_lb" % (k, vk, en, k, k, k, k))
    saves = {"nominal": ["vbg1", "VDD1:p"] + [node_name("spectre", x) for x in NODES], "loopv": ["go2", "g2"], "loopi": ["VI3:p"],
             "off": ["VDD4:p"]}.get(part, ["vbg%d" % k])
    lines.append("save " + " ".join(saves))
    if part == "nominal":
        lines.append("dcT dc param=temp start=%g stop=%g step=%g" % SWEEP)
    for t in temps:
        lines.append("al_%s alter param=temp value=%g" % (tag(t), t))
        if part in ("nominal", "off"):
            lines.append("op_%s dc" % tag(t))
        if part in ("nominal", "loopv", "loopi"):
            lines.append("ac_%s ac start=%g stop=%g dec=%d" % (tag(t), AC_START_HZ, AC_STOP_HZ, AC_PER_DECADE))
        if k >= 5:
            lines.append("tr_%s tran stop=%gu %s" % (tag(t), TRAN_STOP_US, tran_opts))
    return lines + [""]


def bench_ngspice(inputs, corner, vdd, ibias_ua, cell_path, temps, stem):
    card = card_of(inputs)
    g = ibias_ua * 1e-6 / vdd
    ramps = ramp_points(vdd)
    pwl = lambda pts: "pwl(%s)" % " ".join("%gu %g" % (t, v) for t, v in pts)
    lines = ["* Kuijk bandgap bench: %s corner %s, vdd %g V" % (inputs["pdks"][PDK_KEY]["name"], corner, vdd)]
    lines += lib_lines(inputs, corner, "ngspice") + [".include \"%s\"" % cell_path, ".temp %g" % card["temperatureC"],
                                                     ".options tnom=%g cshunt=%g" % (card["temperatureC"], CMIN_F)]
    for k in DUTS:
        en = "en%d" % k
        if k == 5:
            lines.append("VDD5 vdd5 0 dc 0 %s" % pwl(ramps["powerUp"]))
            en = "vdd5"
        else:
            lines.append("VDD%d vdd%d 0 dc %g%s" % (k, k, vdd, " ac 1" if k == 1 else ""))
        if k in (6, 7):
            lines.append("VEN%d en%d 0 dc 0 %s" % (k, k, pwl(ramps["en1us" if k == 6 else "en50us"])))
        elif k != 5:
            lines.append("VEN%d en%d 0 dc %g" % (k, k, 0.0 if k == 4 else vdd))
        lines.append("GIB%d ib%d 0 %s 0 %.6g" % (k, k, en, g))
        vk = "vdd5" if k == 5 else "vdd%d" % k
        if k in (2, 3):
            lines.append("X%d %s 0 %s ib%d vbg%d go%d g%d bandgap_lb" % (k, vk, en, k, k, k, k))
            lines.append("VI%d g%d go%d dc 0%s" % (k, k, k, " ac 1" if k == 2 else ""))
            if k == 3:
                lines.append("II3 0 g3 dc 0 ac 1")
        else:
            lines.append("X%d %s 0 %s ib%d vbg%d g%d g%d bandgap_lb" % (k, vk, en, k, k, k, k))
    files = {"dc": stem.name + "-dc.dat"}
    lines += [".control", "set noaskquit", "set wr_singlescale", "set wr_vecnames", "option numdgt=10",
              "dc temp %g %g %g" % SWEEP, "wrdata %s v(vbg1) i(vdd1)" % files["dc"]]
    for t in temps:
        files["ac_" + tag(t)] = "%s-ac-%s.dat" % (stem.name, tag(t))
        files["tr_" + tag(t)] = "%s-tr-%s.dat" % (stem.name, tag(t))
        lines += ["option temp=%g" % t, "op",
                  "let hv = v(vbg1)", "let hq = -i(vdd1)", "let hs = -i(vdd4)"] + \
                 ["let hn%d = v(%s)" % (i, node_name("ngspice", x)) for i, x in enumerate(NODES)] + \
                 ["echo HIMA op %s $&hv $&hq $&hs %s" % (tag(t), " ".join("$&hn%d" % i for i in range(len(NODES)))),
                  "ac dec %d %g %g" % (AC_PER_DECADE, AC_START_HZ, AC_STOP_HZ),
                  "wrdata %s v(vbg1) v(go2) v(g2) i(vi3)" % files["ac_" + tag(t)],
                  "tran %gu %gu 0 %gu" % (TRAN_STEP_US, TRAN_STOP_US, TRAN_STEP_US),
                  "wrdata %s v(vbg5) v(vbg6) v(vbg7)" % files["tr_" + tag(t)]]
    lines += ["echo HIMA done 1", "quit", ".endc", ".end", ""]
    return lines, files


def read_wrdata(path, complex_cols=False):
    """ngspice wrdata with one scale column: rows of floats; complex vectors give (re, im) pairs."""
    with open(path) as stream:
        stream.readline()
        rows = [[float(x) for x in line.split()] for line in stream if line.strip()]
    if not complex_cols:
        return rows
    return [[r[0]] + [complex(r[i], r[i + 1]) for i in range(1, len(r) - 1, 2)] for r in rows]


def run_spectre(command, netlist, raw, out_dir, timeout_s=1800):
    """Spectre on one netlist. Spectre 23.1 has exited with a segmentation fault (exit 139) after
    finishing and writing every result ("spectre completes with 0 errors"); such a run is accepted
    when every PSF file it wrote is complete, and the log says so. Any other failure is refused."""
    log = Path(str(netlist) + ".log")
    try:
        return ota.run([command, "-64", "+mt=1", str(netlist), "-raw", str(raw)], out_dir, log, timeout_s=timeout_s)
    except ToolError:
        text = log.read_text(errors="replace") if log.is_file() else ""
        done = re.search(r"spectre completes with 0 errors", text) and "Internal error" not in text
        files = [f for f in Path(raw).glob("*") if f.is_file() and f.name != "logFile"] if Path(raw).is_dir() else []
        complete = files and all(f.read_text(errors="replace").rstrip().endswith("END") for f in files)
        if not (done and complete):
            raise
        with open(log, "a") as stream:
            stream.write("\n[bg_cli] spectre exited non-zero after completing with 0 errors; all %d results are complete and are used\n" % len(files))
        return text


AHDL_SEED = [None]          # the directory holding the compiled AHDL code of this workspace's runs


def ahdl_seed(path):
    AHDL_SEED[0] = Path(path)


def spectre_retry(command, out_dir, name, lines, timeout_s=1800):
    """Write the netlist under a fresh stem and run Spectre; on a crash, again under a new stem (the
    crashed attempt's files stay). Returns the raw directory, the netlist and the attempts used."""
    import shutil
    seed = AHDL_SEED[0] or (Path(out_dir) / ".spectre-ahdl")
    for attempt in range(1, SPECTRE_ATTEMPTS + 1):
        stem = ota.fresh_stem(out_dir, name, (".scs", ".scs.log", ".raw", ".ahdlSimDB"))
        netlist, raw, db = Path(str(stem) + ".scs"), Path(str(stem) + ".raw"), Path(str(stem) + ".ahdlSimDB")
        write_text(netlist, "\n".join(lines))
        if seed.is_dir():
            shutil.copytree(str(seed), str(db))
        try:
            try:
                run_spectre(command, netlist, raw, out_dir, timeout_s=timeout_s)
            finally:
                if db.is_dir():
                    shutil.copytree(str(db), str(seed), dirs_exist_ok=True)
            return raw, netlist, attempt
        except ToolError:
            log = Path(str(netlist) + ".log")
            text = log.read_text(errors="replace") if log.is_file() else ""
            if "Segmentation fault" not in text or attempt == SPECTRE_ATTEMPTS:
                raise
            print("spectre crashed on %s (segmentation fault); attempt %d of %d" % (netlist.name, attempt + 1, SPECTRE_ATTEMPTS), file=sys.stderr)


def run_bench(sim, command, inputs, corner, vdd, ibias_ua, cell_path, out_dir, name, temps=TEMPS):
    """One (process corner, supply) bench: the facts every measurement is computed from."""
    out_dir = Path(out_dir)
    started = time.time()
    if sim.name == "spectre":
        raws, attempts = {}, 0
        for part, _k in SPECTRE_PARTS:
            lines = bench_spectre(inputs, corner, vdd, ibias_ua, cell_path, temps, part)
            raws[part], netlist, n = spectre_retry(command, out_dir, "%s-%s" % (name, part), lines)
            attempts += n
        facts = spectre_facts(raws, temps)
        facts["spectreAttempts"] = attempts
    else:
        stem = ota.fresh_stem(out_dir, name, (".cir", ".cir.log", "-dc.dat"))
        netlist = Path(str(stem) + ".cir")
        lines, files = bench_ngspice(inputs, corner, vdd, ibias_ua, cell_path, temps, stem)
        write_text(netlist, "\n".join(lines))
        text = ota.run([command, "-b", str(netlist)], out_dir, Path(str(netlist) + ".log"), timeout_s=1800)
        facts = ngspice_facts(text, out_dir, files, temps, netlist)
    facts.update(process=corner, vdd=vdd, elapsedS=round(time.time() - started, 2), netlist=netlist.name)
    return facts


def ngspice_facts(text, out_dir, files, temps, netlist):
    if "HIMA done" not in text:
        raise ToolError("ngspice did not finish the bench %s (log %s.log)" % (netlist, netlist))
    ops = {}
    for line in text.splitlines():
        parts = line.split()
        if len(parts) >= 3 and parts[0] == "HIMA" and parts[1] == "op":
            ops[parts[2]] = [float(x) for x in parts[3:]]
    dc = read_wrdata(Path(out_dir) / files["dc"])
    facts = dict(dc=dict(temp=[r[0] for r in dc], vbg=[r[1] for r in dc], iq=[-r[2] for r in dc]), temps={})
    for t in temps:
        v = ops.get(tag(t))
        if not v or len(v) != 3 + len(NODES):
            raise ToolError("ngspice gave no operating point at %g C (%s)" % (t, netlist))
        ac = read_wrdata(Path(out_dir) / files["ac_" + tag(t)], complex_cols=True)
        tr = read_wrdata(Path(out_dir) / files["tr_" + tag(t)])
        facts["temps"][str(t)] = dict(
            vbg=v[0], iq=v[1], isd=v[2], nodes=dict(zip(NODES, v[3:])),
            ac=dict(freq=[r[0].real if isinstance(r[0], complex) else r[0] for r in ac], vbg=[r[1] for r in ac],
                    vl=[r[2] for r in ac], vr=[r[3] for r in ac], s=[-r[4] for r in ac]),
            tran={key: dict(time=[r[0] for r in tr], v=[r[1 + i] for r in tr]) for i, key in enumerate(("powerUp", "en1us", "en50us"))})
    return facts


def psf_file(raw, *names):
    for name in names:
        if (Path(raw) / name).is_file():
            return Path(raw) / name
    raise ToolError("spectre wrote no %s in %s" % (names[0], raw))


def spectre_facts(raws, temps):
    """The bench's facts from Spectre's PSF ASCII output, one directory per copy of the cell (Spectre
    names a transient result <name>.tran.tran or <name>.tran)."""
    psf = lambda part, *names: ota.psf_ascii(psf_file(raws[part], *names))[0]
    dc = psf("nominal", "dcT.dc")
    facts = dict(dc=dict(temp=[p["temp"] for p in dc], vbg=[p["vbg1"] for p in dc], iq=[-p["VDD1:p"] for p in dc]), temps={})
    c = lambda p, k: complex(p[k]) if k in p else complex(0.0)
    for t in temps:
        op, off = psf("nominal", "op_%s.dc" % tag(t)), psf("off", "op_%s.dc" % tag(t))
        if not op or not off:
            raise ToolError("spectre gave no operating point at %g C" % t)
        op = op[0]
        ac, acv, aci = (psf(part, "ac_%s.ac" % tag(t)) for part in ("nominal", "loopv", "loopi"))
        if not (len(ac) == len(acv) == len(aci)):
            raise ToolError("spectre's AC sweeps at %g C have different lengths" % t)
        tran = {}
        for key, k in (("powerUp", 5), ("en1us", 6), ("en50us", 7)):
            tr = psf(key, "tr_%s.tran.tran" % tag(t), "tr_%s.tran" % tag(t))
            tran[key] = dict(time=[p["time"] for p in tr], v=[p["vbg%d" % k] for p in tr])
        facts["temps"][str(t)] = dict(
            vbg=op["vbg1"], iq=-op["VDD1:p"], isd=-off[0]["VDD4:p"], nodes={x: op.get(node_name("spectre", x)) for x in NODES},
            ac=dict(freq=[p["freq"] for p in ac], vbg=[c(p, "vbg1") for p in ac], vl=[c(p, "go2") for p in acv],
                    vr=[c(p, "g2") for p in acv], s=[-c(p, "VI3:p") for p in aci]),
            tran=tran)
    return facts


# ---------------------------------------------------------------- the measurements (one arithmetic for both simulators)

def interp_loglog(freq, mags, f0):
    for i in range(1, len(freq)):
        if freq[i - 1] <= f0 <= freq[i]:
            a, b = mags[i - 1], mags[i]
            if a <= 0 or b <= 0:
                return None
            t = (math.log10(f0) - math.log10(freq[i - 1])) / (math.log10(freq[i]) - math.log10(freq[i - 1]))
            return 10 ** (math.log10(a) + t * (math.log10(b) - math.log10(a)))
    return None


def psrr_db(freq, h, f0=PSRR_HZ):
    """PSRR at f0: -20 log10 |vbg / vdd| with a unit AC source on vdd."""
    m = interp_loglog(freq, [abs(x) for x in h], f0)
    return None if m is None or m <= 0 else -20.0 * math.log10(m)


def unwrap(phases):
    out, offset, prev = [], 0.0, None
    for p in phases:
        if prev is not None:
            while p + offset - prev > 180.0:
                offset -= 360.0
            while p + offset - prev < -180.0:
                offset += 360.0
        out.append(p + offset)
        prev = p + offset
    return out


def loop_gain(vl, vr, s):
    """The loop gain T by Middlebrook's double injection at the break between the OTA output (L) and
    the output device's gate (R): Tv = -vL/vR with a series unit voltage (vR - vL = 1); Ti = -s/(s + 1)
    with a unit current injected into R, s the current through the series source from L to R;
    T = (Tv Ti - 1) / (Tv + Ti + 2). Negative feedback is T > 0 at low frequency."""
    out = []
    for a, b, c in zip(vl, vr, s):
        if b == 0 or (c + 1) == 0:
            out.append(None)
            continue
        tv, ti = -a / b, -c / (c + 1)
        den = tv + ti + 2
        out.append(None if den == 0 else (tv * ti - 1) / den)
    return out


def phase_margins(freq, t):
    """Every unity crossing of |T| with its phase margin. The phase is unwrapped from the lowest
    frequency, where it must be near 0 (negative feedback); the margin at a crossing is 180 + phase
    for a lagging phase and 180 - phase for a leading one, so a phase past -180 gives a negative margin."""
    if not t or any(x is None for x in t):
        return dict(crossings=[], pmDeg=None, note="the loop gain is not defined at every frequency")
    ph = unwrap([math.degrees(math.atan2(x.imag, x.real)) for x in t])
    if abs(ph[0]) > 90.0:
        return dict(crossings=[], pmDeg=None, dcGainDb=round(20 * math.log10(abs(t[0])), 2) if abs(t[0]) > 0 else None,
                    note="positive feedback at %g Hz (loop phase %.0f deg)" % (freq[0], ph[0]))
    ph = [p - 360.0 * round(ph[0] / 360.0) for p in ph]
    mags = [abs(x) for x in t]
    crossings = []
    for i in range(1, len(freq)):
        a, b = mags[i - 1], mags[i]
        if a <= 0 or b <= 0 or (a - 1.0) * (b - 1.0) > 0 or a == b:
            continue
        la, lb = math.log10(a), math.log10(b)
        u = la / (la - lb)
        f = 10 ** (math.log10(freq[i - 1]) + u * (math.log10(freq[i]) - math.log10(freq[i - 1])))
        p = ph[i - 1] + u * (ph[i] - ph[i - 1])
        crossings.append(dict(freqHz=f, phaseDeg=round(p, 2), pmDeg=round(180.0 + p if p <= 0 else 180.0 - p, 2),
                              falling=a > b))
    dc_db = 20 * math.log10(mags[0]) if mags[0] > 0 else None
    if not crossings:
        return dict(crossings=[], pmDeg=None, dcGainDb=dc_db, note="|T| never crosses 1 between %g Hz and %g Hz" % (freq[0], freq[-1]))
    return dict(crossings=crossings, pmDeg=min(c["pmDeg"] for c in crossings), dcGainDb=dc_db,
                ugfHz=[c for c in crossings if c["falling"]][-1]["freqHz"] if any(c["falling"] for c in crossings) else None)


def start_time_us(time_s, v, t0_us, vref):
    """The start-up time from the trigger at 50 % (t0) until VBG enters +/-2 % of its final value and
    stays; None when the final value is more than 1 % away from the DC solution vref (it did not start)."""
    if not time_s or not v:
        return None, None
    final = v[-1]
    if vref is None or abs(final - vref) > STARTED_PCT / 100.0 * abs(vref):
        return None, final
    band = START_BAND_PCT / 100.0 * abs(final)
    last_out = None
    for i in range(len(v)):
        if abs(v[i] - final) > band:
            last_out = i
    if last_out is None:
        return 0.0, final
    if last_out + 1 >= len(v):
        return None, final
    # Interpolate the entry into the band between the last outside point and the next one.
    a, b = abs(v[last_out] - final), abs(v[last_out + 1] - final)
    u = 0.0 if a == b else (a - band) / (a - b)
    t = time_s[last_out] + u * (time_s[last_out + 1] - time_s[last_out])
    return max(0.0, t * 1e6 - t0_us), final


def tc_ppm(temps, vbg, vref):
    """Box method: (max - min) / (VBG at 27 C x (125 - (-40)))."""
    if not vbg or not vref:
        return None
    return 1e6 * (max(vbg) - min(vbg)) / (abs(vref) * (max(temps) - min(temps)))


def interp(xs, ys, x):
    for i in range(1, len(xs)):
        if xs[i - 1] <= x <= xs[i] or xs[i - 1] >= x >= xs[i]:
            if xs[i] == xs[i - 1]:
                return ys[i]
            u = (x - xs[i - 1]) / (xs[i] - xs[i - 1])
            return ys[i - 1] + u * (ys[i] - ys[i - 1])
    return None


def bench_measures(facts):
    """One (process corner, supply)'s measurements from a simulator's facts. A measurement the
    simulator did not produce is None, never a guess."""
    dc = facts["dc"]
    v27 = interp(dc["temp"], dc["vbg"], 27.0)
    out = dict(process=facts["process"], vdd=facts["vdd"], elapsedS=facts.get("elapsedS"), spectreAttempts=facts.get("spectreAttempts"),
               tcPpm=tc_ppm(dc["temp"], dc["vbg"], v27), vbgMinV=min(dc["vbg"]), vbgMaxV=max(dc["vbg"]),
               iqMaxUa=1e6 * max(dc["iq"]), sweep=dict(temp=dc["temp"], vbg=[round(x, 6) for x in dc["vbg"]]), temps={})
    for t, f in facts["temps"].items():
        tf = loop_gain(f["ac"]["vl"], f["ac"]["vr"], f["ac"]["s"])
        loop = phase_margins(f["ac"]["freq"], tf)
        if all(x is not None for x in tf):
            t1k = interp_loglog(f["ac"]["freq"], [abs(x) for x in tf], PSRR_HZ)
            loop["gainAt1kHzDb"] = None if not t1k else round(20 * math.log10(t1k), 2)
        starts = {}
        for key, (_what, start, dur) in RAMPS.items():
            t0 = start + dur / 2.0
            value, final = start_time_us(f["tran"][key]["time"], f["tran"][key]["v"], t0, f["vbg"])
            starts[key] = dict(us=None if value is None else round(value, 3), finalV=None if final is None else round(final, 6))
        h0 = abs(f["ac"]["vbg"][0]) if f["ac"]["vbg"] else 0.0
        out["temps"][t] = dict(vbgV=f["vbg"], iqUa=1e6 * f["iq"], isdNa=1e9 * f["isd"], psrrDb=psrr_db(f["ac"]["freq"], f["ac"]["vbg"]),
                               psrrDcDb=None if h0 <= 0 else round(-20 * math.log10(h0), 2),
                               pmDeg=loop["pmDeg"], loop=dict((k, v) for k, v in loop.items() if k != "pmDeg"),
                               startUs=None if any(s["us"] is None for s in starts.values()) else max(s["us"] for s in starts.values()),
                               starts=starts, nodes={k: (None if v is None else round(v, 4)) for k, v in f["nodes"].items()})
    return out


def label(b, t=None):
    return "%s %gV%s" % (b["process"], b["vdd"], "" if t is None else " %sC" % t)


def worst_of(benches, vbg_target):
    """The spec view of all benches: each line's worst value and where. None when any bench lacks the
    measurement (an unknown never improves the worst case)."""
    w = {}
    ext = []
    for b in benches:
        ext += [(b["vbgMinV"], label(b)), (b["vbgMaxV"], label(b))]
    v, where = max(ext, key=lambda e: abs(e[0] - vbg_target))
    w["vbg"] = dict(value=v, where=where, devPct=100.0 * (v - vbg_target) / vbg_target)
    w["iq"] = dict(zip(("value", "where"), max(((b["iqMaxUa"], label(b)) for b in benches), key=lambda e: e[0])))
    isd = [(b["temps"]["27"]["isdNa"], label(b, 27)) for b in benches if "27" in b["temps"]]
    w["isd"] = dict(zip(("value", "where"), max(isd, key=lambda e: e[0]))) if isd else dict(value=None, where=None)
    w["isdAllTempsNa"] = max(tt["isdNa"] for b in benches for tt in b["temps"].values())
    w["tc"] = dict(zip(("value", "where"), max(((b["tcPpm"], label(b)) for b in benches), key=lambda e: e[0])))
    for key, field, fn in (("pm", "pmDeg", min), ("start", "startUs", max), ("psrr", "psrrDb", min)):
        vals = [(tt[field], label(b, t)) for b in benches for t, tt in b["temps"].items()]
        missing = [where for value, where in vals if value is None]
        if missing:
            w[key] = dict(value=None, where=missing[0], missing=missing)
        else:
            w[key] = dict(zip(("value", "where"), fn(vals, key=lambda e: e[0])))
    return w


def spec_of(args):
    vals = [float(a) for a in args]
    return dict(zip(SPEC_KEYS, vals))


def spec_from_sheet(sheet):
    missing = [k for k in SPEC_KEYS if not number(sheet.get(k))]
    if missing:
        raise ToolError("the spec sheet needs numbers %s" % ", ".join(missing))
    return {k: float(sheet[k]) for k in SPEC_KEYS}


def line_met(worst, spec):
    """Per line: True, False or None (unknown). A loop with no unity crossing, or a copy that did not
    start, is a miss, not an unknown."""
    tol = spec["vbgV"] * spec["vbgTolPct"] / 100.0
    v = lambda k: worst[k]["value"]
    out = dict(vbg=None if v("vbg") is None else abs(v("vbg") - spec["vbgV"]) <= tol,
               iq=None if v("iq") is None else v("iq") < spec["iqMaxUa"],
               isd=None if v("isd") is None else v("isd") <= spec["isdMaxNa"],
               tc=None if v("tc") is None else v("tc") < spec["tcMaxPpm"],
               pm=False if v("pm") is None else v("pm") > spec["pmMinDeg"],
               start=False if v("start") is None else v("start") < spec["tStartMaxUs"],
               psrr=None if v("psrr") is None else v("psrr") > spec["psrrMinDb"])
    return out


def margins_pct(worst, spec):
    """Per line, the normalized margin in percent (negative = short of the spec); VBG's against its band."""
    tol = spec["vbgV"] * spec["vbgTolPct"] / 100.0
    v = lambda k: worst[k]["value"]
    m = {}
    m["vbg"] = None if v("vbg") is None else 100.0 * (tol - abs(v("vbg") - spec["vbgV"])) / tol
    for key, sk, better in (("iq", "iqMaxUa", "lower"), ("isd", "isdMaxNa", "lower"), ("tc", "tcMaxPpm", "lower"),
                            ("pm", "pmMinDeg", "higher"), ("start", "tStartMaxUs", "lower"), ("psrr", "psrrMinDb", "higher")):
        x = v(key)
        m[key] = None if x is None else 100.0 * ((x - spec[sk]) if better == "higher" else (spec[sk] - x)) / abs(spec[sk])
    return {k: None if x is None else round(x, 2) for k, x in m.items()}


# ---------------------------------------------------------------- characterization

def devices_bench(sim, inputs, corner):
    """PNP VBE at each characterization current and resistor R at each width and length, over the DC
    temperature sweep, in one netlist per process corner."""
    card = card_of(inputs)
    pnp, res = card["devices"]["pnp"], card["devices"]["res"]
    body = []
    for i, cur in enumerate(pnp["charCurrentsUa"]):
        body.append(("I", "iq%d" % i, ("0", "e%d" % i), cur))
        body.append(("X", "%s 0 0 e%d %s %s" % (inst(card, "pnp", "Q%d" % i), i, pnp["model"], pnp["params"])))
    pairs = [(w, l) for w in res["charWidthsUm"] for l in res["charLengthsUm"]]
    for j, (w, l) in enumerate(pairs):
        body.append(("V", "vr%d" % j, ("r%d" % j, "0"), 1.0))
        body.append(("X", "%s r%d 0 0 %s %s" % (inst(card, "res", "R%d" % j), j, res["model"], res["params"].format(w=um(w), l=um(l), s=1))))
    return body, pairs


def characterize_devices(sim, command, inputs, out_dir):
    card = card_of(inputs)
    pnp = card["devices"]["pnp"]
    out = dict(schema=DEVICES_SCHEMA, pdk=inputs["pdks"][PDK_KEY]["name"], simulator=inputs["pdks"][PDK_KEY]["simulator"]["version"],
               pnp=dict(model=pnp["model"], currentsUa=pnp["charCurrentsUa"], vbe={}), res=dict(model=card["devices"]["res"]["model"], r={}))
    for corner in corners_of(inputs, sim.name):
        body, pairs = devices_bench(sim, inputs, corner)
        name = "devices-%s" % corner
        if sim.name == "spectre":
            lines = ["// PNP and resistor characterization, corner %s" % corner, "simulator lang=spectre", "global 0", "simulator lang=spice"]
            lines += lib_lines(inputs, corner, "spectre") + [".temp %g" % card["temperatureC"]]
            for kind, text, *rest in body:
                if kind == "I":
                    lines.append("I%s %s %s %gu" % (text, rest[0][0], rest[0][1], rest[1]))
                elif kind == "V":
                    lines.append("V%s %s %s %g" % (text, rest[0][0], rest[0][1], rest[1]))
                else:
                    lines.append(text)
            saves = ["e%d" % i for i in range(len(pnp["charCurrentsUa"]))] + ["Vvr%d:p" % j for j in range(len(pairs))]
            lines += ["simulator lang=spectre", "opts options temp=%g tnom=%g rawfmt=psfascii save=selected" % (card["temperatureC"], card["temperatureC"]),
                      "save " + " ".join(saves), "dcT dc param=temp start=%g stop=%g step=%g" % SWEEP, ""]
            raw, _netlist, _n = spectre_retry(command, out_dir, name, lines)
            pts, _ = ota.psf_ascii(raw / "dcT.dc")
            temps = [p["temp"] for p in pts]
            vbe = [[p["e%d" % i] for p in pts] for i in range(len(pnp["charCurrentsUa"]))]
            rr = [[-1.0 / p["Vvr%d:p" % j] for p in pts] for j in range(len(pairs))]
        else:
            stem = ota.fresh_stem(out_dir, name, (".cir", ".cir.log", ".dat"))
            netlist, data = Path(str(stem) + ".cir"), Path(str(stem) + ".dat")
            lines = ["* PNP and resistor characterization, corner %s" % corner] + lib_lines(inputs, corner, "ngspice")
            lines += [".temp %g" % card["temperatureC"], ".options tnom=%g" % card["temperatureC"]]
            for kind, text, *rest in body:
                if kind == "I":
                    lines.append("I%s %s %s %gu" % (text, rest[0][0], rest[0][1], rest[1]))
                elif kind == "V":
                    lines.append("V%s %s %s %g" % (text, rest[0][0], rest[0][1], rest[1]))
                else:
                    lines.append(text)
            vecs = ["v(e%d)" % i for i in range(len(pnp["charCurrentsUa"]))] + ["i(vvr%d)" % j for j in range(len(pairs))]
            lines += [".control", "set noaskquit", "set wr_singlescale", "set wr_vecnames", "option numdgt=10",
                      "dc temp %g %g %g" % SWEEP, "wrdata %s %s" % (data.name, " ".join(vecs)), "quit", ".endc", ".end", ""]
            write_text(netlist, "\n".join(lines))
            ota.run([command, "-b", str(netlist)], out_dir, Path(str(netlist) + ".log"))
            rows = read_wrdata(data)
            temps = [r[0] for r in rows]
            n = len(pnp["charCurrentsUa"])
            vbe = [[r[1 + i] for r in rows] for i in range(n)]
            rr = [[-1.0 / r[1 + n + j] for r in rows] for j in range(len(pairs))]
        out["temps"] = [round(t, 3) for t in temps]
        out["pnp"]["vbe"][corner] = [[round(x, 7) for x in row] for row in vbe]
        out["res"]["r"][corner] = {"%s/%s" % (um(w), um(l)): [round(x, 4) for x in rr[j]] for j, (w, l) in enumerate(pairs)}
    return out


def cmd_characterize(ws):
    ws = Path(ws)
    ahdl_seed(ws / "work" / "spectre-ahdl")
    inputs = load_inputs(ws)
    out_dir = report_dir(ws, "characterize", 1).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    sim, command = simulator_for(inputs)
    card = card_of(inputs)
    name = inputs["pdks"][PDK_KEY]["name"]
    started = time.time()
    table = dict(schema=ota.TABLE_SCHEMA, pdk=name, vdd=card["vdd"], simulator=inputs["pdks"][PDK_KEY]["simulator"]["version"],
                 vdsV=card["vdd"] / 2.0, devices={})
    curves = 0
    for kind in ("nmos", "pmos"):
        rows = sim.sweep(command, inputs, PDK_KEY, kind, out_dir, "gmid-%s-%s" % (name, kind))
        lengths = ota.build_table(card, kind, rows)
        table["devices"][kind] = dict(model=card["devices"][kind]["model"], widthUm=card["devices"][kind]["charWUm"], lengths=lengths)
        curves += len(lengths)
    write_json(state(ws, "tables-design.json"), table)
    devices = characterize_devices(sim, command, inputs, out_dir)
    write_json(state(ws, "devices.json"), devices)
    expected = sum(len(card["devices"][k]["lengthsUm"]) for k in ("nmos", "pmos"))
    elapsed = round(time.time() - started, 1)
    write_json(state(ws, "tables.json"), dict(schema="hima-bandgap-tables/1", pdk=name, curves=curves, expected=expected,
                                             pnpCorners=sorted(devices["pnp"]["vbe"]), resCorners=sorted(devices["res"]["r"]),
                                             simulator=table["simulator"], elapsedS=elapsed))
    lines = ["# Characterization of %s (%s, %.1f s)" % (name, table["simulator"], elapsed), "",
             "gm/Id curves: %d of %d (nmos and pmos at %s um)." % (curves, expected, ", ".join(um(l) for l in card["devices"]["nmos"]["lengthsUm"])), "",
             "| corner | VBE at 1 uA, 27 C (V) | dVBE/dT at 1 uA (mV/C) | R per um at W %s um, 27 C (Ohm) |" % um(card["devices"]["res"]["defaultWUm"]),
             "| --- | --- | --- | --- |"]
    for corner in sorted(devices["pnp"]["vbe"]):
        vbe = vbe_at(devices, corner, 1.0, 27.0)
        slope = 1e3 * vbe_slope(devices, corner, 1.0, 27.0)
        a, _b = res_fit(devices, corner, card["devices"]["res"]["defaultWUm"], 27.0)
        lines.append("| %s | %.4f | %.3f | %.1f |" % (corner, vbe, slope, a))
    write_text(out_dir / "devices.rpt", "\n".join(lines) + "\n")
    ota.write_chart(ws, "characterize", 1, "gmid", ota.gmid_chart(table))
    print("characterized %s: %d gm/Id curves, PNP and resistor at %d corners (%.1f s)" % (name, curves, len(devices["pnp"]["vbe"]), elapsed))


# ---------------------------------------------------------------- the method (Kuijk equations, gm/Id, Pelgrom)

def vbe_at(devices, corner, i_ua, t):
    """VBE of one unit PNP at current i_ua and temperature t: linear in log(I) between the
    characterized currents, linear in T between sweep points."""
    cur = devices["pnp"]["currentsUa"]
    if not cur[0] <= i_ua <= cur[-1]:
        raise ToolError("the PNP was characterized from %g to %g uA, not at %g uA" % (cur[0], cur[-1], i_ua))
    rows = devices["pnp"]["vbe"][corner]
    temps = devices["temps"]
    for i in range(1, len(cur)):
        if cur[i - 1] <= i_ua <= cur[i]:
            u = (math.log(i_ua) - math.log(cur[i - 1])) / (math.log(cur[i]) - math.log(cur[i - 1]))
            a, b = interp(temps, rows[i - 1], t), interp(temps, rows[i], t)
            if a is None or b is None:
                raise ToolError("the PNP was characterized from %g to %g C, not at %g C" % (temps[0], temps[-1], t))
            return a + u * (b - a)
    raise ToolError("no PNP row brackets %g uA" % i_ua)


def vbe_slope(devices, corner, i_ua, t, dt=5.0):
    return (vbe_at(devices, corner, i_ua, t + dt) - vbe_at(devices, corner, i_ua, t - dt)) / (2 * dt)


def res_fit(devices, corner, w, t):
    """One resistor segment at width w: R = a L + b (L in um) at temperature t, from the two
    characterized lengths."""
    table = devices["res"]["r"][corner]
    lengths = sorted({float(k.split("/")[1]) for k in table if float(k.split("/")[0]) == float(w)})
    if len(lengths) < 2:
        raise ToolError("the resistor was not characterized at width %s um (widths %s)" % (
            um(w), ", ".join(sorted({k.split("/")[0] for k in table}))))
    l1, l2 = lengths[0], lengths[-1]
    r1 = interp(devices["temps"], table["%s/%s" % (um(w), um(l1))], t)
    r2 = interp(devices["temps"], table["%s/%s" % (um(w), um(l2))], t)
    a = (r2 - r1) / (l2 - l1)
    return a, r1 - a * l1


def res_geometry(card, devices, ohms, w, seg_max):
    """Series segments s and segment length L for a resistor of `ohms` at width w (tt, 27 C)."""
    res = card["devices"]["res"]
    a, b = res_fit(devices, "tt", w, 27.0)
    seg_max = min(seg_max, res["lMaxUm"])
    s = max(1, int(math.ceil(ohms / (a * seg_max + b) - 1e-9)))
    length = (ohms / s - b) / a
    grid = res["gridUm"]
    length = round(round(length / grid) * grid, 6)
    if length < res["lMinUm"]:
        raise ToolError("a %.0f Ohm resistor at W %s um needs segments shorter than %s um" % (ohms, um(w), um(res["lMinUm"])))
    return dict(wUm=float(um(w)), lUm=float(um(length)), s=s)


def snap(card, kind, x):
    grid = card["devices"][kind]["gridUm"]
    return round(round(x / grid) * grid, 6)


def eff_area(card, kind, w, l):
    d = card["devices"][kind]
    return max(0.0, (w - d.get("dwUm", 0.0))) * max(0.0, (l - d.get("dlUm", 0.0)))


def pelgrom_areas(card, spec_or_tol, r2r1, share_pct, gmid_pair, gmid_load):
    """The input pair's and the load's gate areas (Weff Leff, um2) at which 3 sigma(VBG) fits in
    share_pct of the VBG band: sigma(VBG) = (1 + R2/R1) sigma(Vos); sigma(Vos)^2 = 2 sigma(Vth,pair)^2 +
    2 sigma(Vth,load)^2 (gm_load/gm_pair)^2, sigma(Vth) = A_VT / sqrt(Weff Leff); the pair takes 80 % of
    the variance, the load 20 %. PNP and resistor mismatch are left to the share's remainder."""
    tol = spec_or_tol
    sigma_vbg = tol * share_pct / 100.0 / 3.0
    sigma_vos = sigma_vbg / (1.0 + r2r1)
    avt_p = card["devices"]["pmos"]["avtMvUm"] * 1e-3
    avt_n = card["devices"]["nmos"]["avtMvUm"] * 1e-3
    a_pair = 2 * avt_p ** 2 / (0.8 * sigma_vos ** 2)
    a_load = 2 * avt_n ** 2 * (gmid_load / gmid_pair) ** 2 / (0.2 * sigma_vos ** 2)
    return a_pair, a_load, sigma_vos


def length_for_area(table, card, kind, gmid, id_ua, area):
    """The shortest characterized L whose device at gm/Id and current reaches the gate area within
    the PDK's width limit; else the legal L with the largest area (and False)."""
    best, best_area = None, -1.0
    lim = card["devices"][kind]
    for length in lim["lengthsUm"]:
        try:
            w, _ = ota.width_for(table, card, kind, length, gmid, id_ua)
        except ToolError:
            continue
        if not lim["wMinUm"] <= w <= lim["wMaxUm"]:
            continue
        a = eff_area(card, kind, w, length)
        if a >= area:
            return length, True
        if a > best_area:
            best, best_area = length, a
    return best, False


def gmid_for_vgs(table, kind, length, vgs):
    """The gm/Id at which the device's |VGS| (at the characterization Vds) is vgs, or the nearest end."""
    points = sorted(table["devices"][kind]["lengths"][um(length)], key=lambda p: p["vgs"])
    for a, b in zip(points, points[1:]):
        if a["vgs"] <= vgs <= b["vgs"]:
            u = (vgs - a["vgs"]) / (b["vgs"] - a["vgs"])
            return a["gmId"] + u * (b["gmId"] - a["gmId"])
    return points[0]["gmId"] if vgs < points[0]["vgs"] else points[-1]["gmId"]


def nearest(choices, want):
    return min(choices, key=lambda c: (abs(math.log(c / want)), c))


def first_cut_intent(spec, card, table, devices, choices=None, topology=TOPOLOGY):
    """A first cut from the spec sheet: the method fills every intent field the agent did not choose.
    `choices` (the sheet's optional "choices") fixes any intent field, or one key of a device group
    ({"pair": {"gmId": 12}}); everything that depends on it is then derived from it, so an agent changes
    a choice and re-drafts rather than typing derived numbers. Every value is a starting point the
    sizing agent refines against the simulator; none claims a spec line is met.

    - n = 8 PNPs; the reference ibias from the sheet (default 0.5 uA); the OTA tail at 2 ibias; the
      start-up pull-up at 25 nA.
    - The core current per branch from the IQ budget: 80 % of the IQ line, less the reference, the tail
      and the start-up, shared by the two branches at the hot, low-resistance corner (the current is
      PTAT over R(T), and the ff resistor is the lowest).
    - R1 = VT ln n / I at 27 C; R2/R1 = -(dVBE/dT + (k/q)(1 - T TCR)) / ((k/q) ln n), so that dVBG/dT
      = 0 at 27 C with the PTAT core current (dVBE/dT measured on the PNP at that current).
    - The input pair at gm/Id 20 (weak inversion: the smallest |VGS|, headroom at the low supply), the
      load at 10, the mirror at 10 with L near 5 um; the pair's and load's L from the Pelgrom area at
      which 3 sigma(VBG) takes mcBandSharePct (50 %) of the VBG band.
    - kuijk-p5t: the output device at the gm/Id whose |VGS| puts its gate mid-way in the OTA's output
      range at both supplies. kuijk-p5t-mirror: the output device in moderate inversion (gm/Id 10, L
      near 2 um) at 4 times the diode M6 (driveRatio 4); its gate no longer meets the OTA's range.
    - 10 pF on the OTA output (to vdd in kuijk-p5t, to vss in kuijk-p5t-mirror); no load capacitor."""
    keys = intent_keys(topology)
    for key in ("vbgV", "vbgTolPct", "iqMaxUa"):
        if not number(spec.get(key)) or spec[key] <= 0:
            raise ToolError("the spec sheet needs a positive %s" % key)
    ch = json.loads(json.dumps(choices or {}))
    extra = sorted(set(ch) - keys)
    if extra:
        raise ToolError("choices has unknown field(s) %s (an intent field: %s)" % (", ".join(extra), ", ".join(sorted(keys))))
    for g in GROUPS:
        if g in ch and (not isinstance(ch[g], dict) or not set(ch[g]) <= GROUP_KEYS or not all(number(v) for v in ch[g].values())):
            raise ToolError("choices %s must be {gmId and/or lUm} numbers" % g)
    for key in keys - set(GROUPS):
        if key in ch and not number(ch[key]):
            raise ToolError("choices %s must be a number" % key)
    pick = lambda key, default: float(ch[key]) if key in ch else default
    n = int(pick("n", 8))
    ib = pick("ibiasUa", float(spec.get("ibiasUa", 0.5)))
    itail = pick("itailUa", 2.0 * ib)
    isu = pick("isuNa", 25.0)
    wres = pick("resWUm", card["devices"]["res"]["defaultWUm"])
    a27, b27 = res_fit(devices, "tt", wres, 27.0)
    a125, _ = res_fit(devices, "tt", wres, 125.0)
    a_ff = min(res_fit(devices, c, wres, 27.0)[0] for c in devices["res"]["r"])
    k_hot = ((125.0 + T0K) / (27.0 + T0K)) * (a27 / a125) * (a27 / a_ff)
    icore = (0.8 * spec["iqMaxUa"] - ib - itail - isu * 1e-3) / (2.0 * k_hot)
    if "iCoreUa" not in ch and icore <= 0:
        raise ToolError("the IQ line %g uA leaves no current for the core" % spec["iqMaxUa"])
    icore = pick("iCoreUa", round(icore, 3))
    t27 = 27.0 + T0K
    tcr = (a125 - a27) / a27 / 98.0
    slope = vbe_slope(devices, "tt", icore, 27.0)
    r2r1 = pick("r2r1", round(-(slope + K_Q * (1.0 - t27 * tcr)) / (K_Q * math.log(n)), 4))
    share = pick("mcBandSharePct", 50.0)
    tol = spec["vbgV"] * spec["vbgTolPct"] / 100.0
    lengths = {k: card["devices"][k]["lengthsUm"] for k in ("nmos", "pmos")}
    pair = dict(gmId=float(ch.get("pair", {}).get("gmId", 20.0)))
    load = dict(gmId=float(ch.get("load", {}).get("gmId", 10.0)))
    a_pair, a_load, _ = pelgrom_areas(card, tol, r2r1, share, pair["gmId"], load["gmId"])
    pair["lUm"] = float(ch.get("pair", {}).get("lUm") or length_for_area(table, card, "pmos", pair["gmId"], itail / 2.0, a_pair)[0])
    load["lUm"] = float(ch.get("load", {}).get("lUm") or length_for_area(table, card, "nmos", load["gmId"], itail / 2.0, a_load)[0])
    mirror = dict(gmId=float(ch.get("mirror", {}).get("gmId", 10.0)), lUm=float(ch.get("mirror", {}).get("lUm", nearest(lengths["pmos"], 5.0))))
    out = dict(ch.get("out", {}))
    if topology == "kuijk-p5t-mirror":
        out.setdefault("gmId", 10.0)
        out.setdefault("lUm", float(nearest(lengths["pmos"], 2.0)))
    if "gmId" not in out:
        # The output device's gate sits at vdd - |VGS,out| and must stay inside the OTA's output range
        # at both supplies: above the load's saturation (0.3 V), below the pair's source less a 0.1 V
        # margin (VBE + |VGS,pair|, plus 0.25 V of body effect at the top supply: the pair's well is at
        # vdd). When no |VGS| fits both supplies, the low supply wins.
        vbe27 = vbe_at(devices, "tt", icore, 27.0)
        vgs_pair = ota.lookup(table, "pmos", pair["lUm"], pair["gmId"])["vgs"]
        g_hi, g_lo = vbe27 + vgs_pair - 0.1 + 0.25, 0.3
        vmin, vmax = min(card["supplies"]), max(card["supplies"])
        lo, hi = vmax - g_hi, vmin - g_lo
        vsg = (lo + hi) / 2.0 if lo <= hi else hi - 0.05
        # The shortest length (or the chosen one) whose device at that |VGS| is at least 1 um wide.
        found = None
        for out_l in ([out["lUm"]] if "lUm" in out else lengths["pmos"]):
            gm = round(gmid_for_vgs(table, "pmos", out_l, vsg), 2)
            try:
                w, _ = ota.width_for(table, card, "pmos", out_l, gm, 2.0 * icore)
            except ToolError:
                continue
            found = dict(gmId=gm, lUm=float(out_l))
            if w >= max(1.0, card["devices"]["pmos"]["wMinUm"]):
                break
        if found is None:
            raise ToolError("no characterized length gives the output device a |VGS| of %.2f V" % vsg)
        out = found
    elif "lUm" not in out:
        out["lUm"] = float(nearest(lengths["pmos"], 5.0))
    intent = dict(n=n, ibiasUa=ib, itailUa=itail, iCoreUa=icore, r2r1=r2r1, isuNa=isu, resWUm=wres,
                  resSegMaxUm=pick("resSegMaxUm", card["devices"]["res"]["segMaxUm"]), ccPf=pick("ccPf", 10.0), coutPf=pick("coutPf", 0.0),
                  mcBandSharePct=share, pair=pair, load=load, mirror=mirror, out={"gmId": float(out["gmId"]), "lUm": float(out["lUm"])})
    if "driveRatio" in keys:
        intent["driveRatio"] = pick("driveRatio", 4.0)
    return intent


def intent_problems(intent, topology=TOPOLOGY):
    if not isinstance(intent, dict):
        return ["intent must be an object"]
    problems = []
    keys = intent_keys(topology)
    extra = sorted(set(intent) - keys)
    if extra:
        problems.append("intent has unknown field(s) %s: an intent states only design choices" % ", ".join(extra))
    for key in sorted(keys - set(GROUPS)):
        if not number(intent.get(key)):
            problems.append("intent %s must be a number" % key)
    for group in GROUPS:
        g = intent.get(group)
        if not isinstance(g, dict) or set(g) != GROUP_KEYS or not all(number(g[k]) for k in GROUP_KEYS):
            problems.append("intent %s must be {gmId, lUm} numbers" % group)
    return problems


def cap_dims(card, pf):
    """m equal square capacitors in parallel (as few as the PDK's largest one allows) for pf."""
    cap = card["devices"]["cap"]
    area = pf * 1e3 / cap["fFPerUm2"]
    m = max(1, int(math.ceil(area / (cap["wMaxUm"] * cap["lMaxUm"]) - 1e-9)))
    side = math.sqrt(area / m)
    w = min(max(side, cap["wMinUm"]), cap["wMaxUm"])
    l = min(max(area / m / w, cap["lMinUm"]), cap["lMaxUm"])
    g = cap["gridUm"]
    return dict(wUm=float(um(round(round(w / g) * g, 6))), lUm=float(um(round(round(l / g) * g, 6))), m=m)


def size_from_intent(table, devices, card, intent, topology=TOPOLOGY):
    """The design an intent gives (hima-bandgap-intent/1):

    - MB0 (the reference diode) at the mirror's gm/Id and L carrying ibias; the tail MT at the same L,
      its width scaled by itail/ibias; the start-up pull-up MSU1 likewise at isu (a width below the
      minimum is taken back by length);
    - the input pair M1/M2 and the load M3/M4 each carrying itail/2 at their gm/Id and L;
    - the output device MO carrying both branches (2 iCore) at its gm/Id and L;
    - R1 = VT ln n / iCore at 27 C; R2a = R2b = r2r1 R1; segments at resWUm, at most resSegMaxUm long;
    - kuijk-p5t-mirror: M5 at the load's gm/Id and L carrying 2 iCore / driveRatio, M6 at the output
      device's L and 1 / driveRatio of its width;
    - CC (on the OTA output) and CO (vbg to vss) as square capacitors; 0 pF leaves one out."""
    tpl = template(topology)
    problems = intent_problems(intent, topology)
    if problems:
        raise ToolError("the intent is refused:\n- " + "\n- ".join(problems))
    for key in ("ibiasUa", "itailUa", "iCoreUa", "r2r1", "isuNa", "resWUm", "resSegMaxUm"):
        if intent[key] <= 0:
            raise ToolError("the intent needs a positive %s" % key)
    n = intent["n"]
    if n != int(n) or not LIMITS["n"][0] <= n <= min(LIMITS["n"][1], card["devices"]["pnp"]["nMax"]):
        raise ToolError("n must be a whole number from %d to %d" % (LIMITS["n"][0], min(LIMITS["n"][1], card["devices"]["pnp"]["nMax"])))
    ib, itail = intent["ibiasUa"], intent["itailUa"]
    g = {k: intent[k] for k in GROUPS}
    out = {}
    w0, _ = ota.width_for(table, card, "pmos", g["mirror"]["lUm"], g["mirror"]["gmId"], ib)
    lm = float(um(g["mirror"]["lUm"]))
    out["MB0"] = dict(wUm=w0, lUm=lm)
    out["MT"] = dict(wUm=snap(card, "pmos", w0 * itail / ib), lUm=lm)
    wsu = w0 * intent["isuNa"] * 1e-3 / ib
    pm = card["devices"]["pmos"]
    if wsu >= pm["wMinUm"]:
        out["MSU1"] = dict(wUm=snap(card, "pmos", wsu), lUm=lm)
    else:
        out["MSU1"] = dict(wUm=pm["wMinUm"], lUm=min(pm["lMaxUm"], snap(card, "pmos", lm * pm["wMinUm"] / wsu)))
    for name, group, kind, cur in (("M1", "pair", "pmos", itail / 2), ("M3", "load", "nmos", itail / 2), ("MO", "out", "pmos", 2 * intent["iCoreUa"])):
        w, _ = ota.width_for(table, card, kind, g[group]["lUm"], g[group]["gmId"], cur)
        out[name] = dict(wUm=w, lUm=float(um(g[group]["lUm"])))
    out["M2"], out["M4"] = dict(out["M1"]), dict(out["M3"])
    if "M5" in tpl["mos"]:
        k = intent["driveRatio"]
        if not 1 <= k <= 20:
            raise ToolError("driveRatio must be from 1 to 20")
        w5, _ = ota.width_for(table, card, "nmos", g["load"]["lUm"], g["load"]["gmId"], 2 * intent["iCoreUa"] / k)
        out["M5"] = dict(wUm=w5, lUm=float(um(g["load"]["lUm"])))
        out["M6"] = dict(wUm=snap(card, "pmos", out["MO"]["wUm"] / k), lUm=out["MO"]["lUm"])
    for name, (kind, group, *_n) in tpl["mos"].items():
        if group == "switch":
            w, l = switch_um(name)
            out[name] = dict(wUm=w, lUm=l)
    for name, d in out.items():
        lim = card["devices"][tpl["mos"][name][0]]
        if d["wUm"] < lim["wMinUm"] - 1e-9:
            raise ToolError("%s would be %s um wide (less than %s um): lower its gm/Id or lengthen L" % (name, um(d["wUm"]), um(lim["wMinUm"])))
        if d["wUm"] > lim["wMaxUm"]:
            raise ToolError("%s would be %s um wide (more than %s um): raise its gm/Id or shorten L" % (name, um(d["wUm"]), um(lim["wMaxUm"])))
    vt = K_Q * (27.0 + T0K)
    r1 = vt * math.log(n) / (intent["iCoreUa"] * 1e-6)
    resistors = dict(R1=res_geometry(card, devices, r1, intent["resWUm"], intent["resSegMaxUm"]))
    resistors["R2a"] = res_geometry(card, devices, intent["r2r1"] * r1, intent["resWUm"], intent["resSegMaxUm"])
    resistors["R2b"] = dict(resistors["R2a"])
    caps = {name: cap_dims(card, intent[key]) for name, key in CAP_KEYS.items() if intent[key] > 0 and name in tpl["caps"]}
    devices_out = {name: out[name] for name in tpl["mos"]}
    return dict(n=int(n), ibiasUa=float(ib), devices=devices_out, resistors=resistors, caps=caps)


def gmid_for_jd(table, kind, length, jd):
    """The gm/Id at which the device at L carries jd uA per um (log-linear between sweep points)."""
    points = sorted(table["devices"][kind]["lengths"][um(length)], key=lambda p: p["jdUaUm"])
    for a, b in zip(points, points[1:]):
        if a["jdUaUm"] <= jd <= b["jdUaUm"]:
            u = (math.log(jd) - math.log(a["jdUaUm"])) / (math.log(b["jdUaUm"]) - math.log(a["jdUaUm"]))
            return a["gmId"] + u * (b["gmId"] - a["gmId"])
    return None


def area_step(table, card, kind, group, id_ua, area):
    """The group at the shortest characterized L (not shorter than today's) whose gate area reaches
    `area`: at its gm/Id when the width fits the PDK, else at the PDK's widest device, whose gm/Id the
    table gives for that current density; failing both, wider at its gm/Id's longest length. None
    when nothing reaches the area."""
    lim = card["devices"][kind]
    for length in [l for l in lim["lengthsUm"] if l >= group["lUm"] - 1e-9]:
        try:
            w, _ = ota.width_for(table, card, kind, length, group["gmId"], id_ua)
        except ToolError:
            w = None
        if w is not None and w <= lim["wMaxUm"]:
            if eff_area(card, kind, w, length) >= area:
                return dict(gmId=group["gmId"], lUm=float(length))
            continue
        if eff_area(card, kind, 0.98 * lim["wMaxUm"], length) >= area:
            gm = gmid_for_jd(table, kind, length, id_ua / (0.98 * lim["wMaxUm"]))
            if gm is not None:
                return dict(gmId=math.floor(gm * 100) / 100, lUm=float(length))     # down: never wider
    # No length reaches the area at today's gm/Id: widen at the shortest length that can (a weaker
    # inversion, the gm/Id the table gives for the wider device's current density).
    for length in [l for l in lim["lengthsUm"] if l >= group["lUm"] - 1e-9]:
        w = area / max(1e-9, length - lim.get("dlUm", 0.0)) + lim.get("dwUm", 0.0)
        if w <= lim["wMaxUm"]:
            gm = gmid_for_jd(table, kind, length, id_ua / w)
            if gm is not None:
                return dict(gmId=math.floor(gm * 100) / 100, lUm=float(length))
    return None


def mc_rescaled_intent(intent, mc, card, table, spec_tol):
    """The Pelgrom step: sigma scales as 1/sqrt(area), so the area that brings the measured sigma(VBG)
    to mcBandSharePct of the band over 3 is (sigma_measured / sigma_wanted)^2 times today's. The pair
    and the load move to the shortest characterized L reaching that area at their gm/Id, or, where
    the width would pass the PDK's limit, to the widest device at that L (its gm/Id follows from the
    current density)."""
    share = intent["mcBandSharePct"]
    want = spec_tol * share / 100.0 / 3.0
    have = mc["stats"]["sigmaV"]
    k = (have / want) ** 2
    new = json.loads(json.dumps(intent))
    itail = intent["itailUa"]
    reached = {}
    for group, kind in (("pair", "pmos"), ("load", "nmos")):
        g = intent[group]
        w, _ = ota.width_for(table, card, kind, g["lUm"], g["gmId"], itail / 2)
        target = eff_area(card, kind, w, g["lUm"]) * k
        step = area_step(table, card, kind, g, itail / 2, target) if k > 1 else None
        if step is not None:
            new[group] = step
        reached[group] = step is not None or k <= 1
    return new, dict(sigmaMeasuredMv=1e3 * have, sigmaWantedMv=1e3 * want, areaScale=round(k, 3), reached=reached)


# ---------------------------------------------------------------- designs (agent deliveries)

def design_path(ws):
    return state(ws, "design.json")


def load_tables(ws):
    return (read_json(state(ws, "tables-design.json"), "the gm/Id tables (run characterize first)"),
            read_json(state(ws, "devices.json"), "the PNP and resistor tables (run characterize first)"))


def validate_design(ws, path=None, files_root=None):
    """Check a bandgap design (hima-bandgap-design/1) against the Pack: identity, the template's
    devices, every size legal for the PDK, matched pairs and resistors, and, when it carries an
    intent, that the sizes are the intent's. Performance is never read from the file."""
    ws = Path(ws)
    inputs = load_inputs(ws)
    card = card_of(inputs)
    topology = inputs.get("topology", TOPOLOGY)
    tpl = template(topology)
    k = ota.current_round(ws)
    path = Path(path) if path else design_path(ws)
    doc = read_json(path, "the design %s" % path)
    if not isinstance(doc, dict):
        raise ToolError("the design is not a JSON object")
    problems = []
    extra = sorted(set(doc) - DESIGN_KEYS)
    if extra:
        problems.append("unknown field(s) %s: a design states sizes; the simulator measures performance" % ", ".join(extra))
    for key, value in dict(schema=DESIGN_SCHEMA, pdk=inputs["pdks"][PDK_KEY]["name"], topology=topology, round=k).items():
        if doc.get(key) != value:
            problems.append("%s must be %r (found %r)" % (key, value, doc.get(key)))
    n = doc.get("n")
    nmax = min(LIMITS["n"][1], card["devices"]["pnp"]["nMax"])
    if not isinstance(n, int) or isinstance(n, bool) or not LIMITS["n"][0] <= n <= nmax:
        problems.append("n (the PNP ratio) must be a whole number from %d to %d (found %r)" % (LIMITS["n"][0], nmax, n))
    lo, hi = LIMITS["ibiasUa"]
    if not number(doc.get("ibiasUa")) or not lo <= doc["ibiasUa"] <= hi:
        problems.append("ibiasUa must be a number in [%g, %g] (found %r)" % (lo, hi, doc.get("ibiasUa")))
    devices = doc.get("devices")
    if not isinstance(devices, dict) or sorted(devices) != sorted(tpl["mos"]):
        problems.append("devices must be exactly %s" % ", ".join(tpl["mos"]))
        devices = {}

    def sized(name, d, lim, keys=("wUm", "lUm")):
        if not isinstance(d, dict) or sorted(d) != sorted(keys) or not all(number(d.get(x)) for x in keys):
            problems.append("%s must be {%s} numbers" % (name, ", ".join(keys)))
            return False
        for key, lo_, hi_ in (("lUm", lim["lMinUm"], lim["lMaxUm"]), ("wUm", lim["wMinUm"], lim["wMaxUm"])):
            if not lo_ - 1e-9 <= d[key] <= hi_ + 1e-9:
                problems.append("%s %s=%s um is outside [%s, %s] um" % (name, key[0].upper(), um(d[key]), um(lo_), um(hi_)))
            steps = d[key] / lim["gridUm"]
            if abs(steps - round(steps)) > 1e-6:
                problems.append("%s %s=%s um is off the %s um grid" % (name, key[0].upper(), um(d[key]), um(lim["gridUm"])))
        return True

    for name, d in sorted(devices.items()):
        sized(name, d, card["devices"][tpl["mos"][name][0]])
    for a, b in (("M1", "M2"), ("M3", "M4")):
        if a in devices and b in devices and devices[a] != devices[b]:
            problems.append("%s and %s are a matched pair and must have the same W and L" % (a, b))
    resistors = doc.get("resistors")
    if not isinstance(resistors, dict) or sorted(resistors) != sorted(RESISTORS):
        problems.append("resistors must be exactly %s" % ", ".join(RESISTORS))
        resistors = {}
    for name, r in sorted(resistors.items()):
        if sized(name, r, card["devices"]["res"], ("wUm", "lUm", "s")):
            if not isinstance(r["s"], int) or isinstance(r["s"], bool) or r["s"] < 1:
                problems.append("%s s (series segments) must be a whole number >= 1" % name)
    if resistors.get("R2a") is not None and resistors.get("R2a") != resistors.get("R2b"):
        problems.append("R2a and R2b are matched and must be the same")
    if len({r.get("wUm") for r in resistors.values() if isinstance(r, dict)}) > 1:
        problems.append("the resistors must share one width (they are matched)")
    caps = doc.get("caps")
    if not isinstance(caps, dict) or not set(caps) <= set(tpl["caps"]):
        problems.append("caps must be an object with at most %s" % ", ".join(tpl["caps"]))
        caps = {}
    for name, c in sorted(caps.items()):
        if sized(name, c, card["devices"]["cap"], ("wUm", "lUm", "m")):
            if not isinstance(c["m"], int) or isinstance(c["m"], bool) or not 1 <= c["m"] <= 16:
                problems.append("%s m (capacitors in parallel) must be a whole number from 1 to 16" % name)
    if "intent" in doc:
        found = intent_problems(doc["intent"], topology)
        problems += found
        if not found and state(ws, "tables-design.json").is_file() and state(ws, "devices.json").is_file():
            table, devs = load_tables(ws)
            try:
                want = size_from_intent(table, devs, card, doc["intent"], topology)
            except ToolError as error:
                problems.append("the intent cannot be sized: %s" % error)
            else:
                if any(want[key] != doc.get(key) for key in ("n", "ibiasUa", "devices", "resistors", "caps")):
                    problems.append("the sizes do not follow the intent (draft size gives them): re-draft from the intent, "
                                    "or remove the intent to deliver a hand-sized design")
    for key in ("summary", "reason"):
        if not isinstance(doc.get(key), str) or not doc[key].strip():
            problems.append("%s must say in words what the design does and why" % key)
    folder = "reports/%s/r%d/" % (AGENT_NODE, k)
    report = doc.get("report")
    if not isinstance(report, str) or not re.fullmatch(re.escape(folder) + r"analysis(-[2-9]|-[1-9][0-9]+)?\.md", report):
        problems.append("report must be %sanalysis.md (a repair: %sanalysis-2.md, -3, ...)" % (folder, folder))
    elif files_root is not None and not (Path(files_root) / report).is_file():
        problems.append("the report %s is not in your workspace (%s)" % (report, files_root))
    if problems:
        raise ToolError("design refused:\n- " + "\n- ".join(problems))
    return doc, dict(round=k, pdk=doc["pdk"])


def cmd_design(ws):
    _doc, facts = validate_design(ws)
    print("bandgap design for round %d accepted (%s)" % (facts["round"], facts["pdk"]))


def draft(ws, kind, given=None):
    ws = Path(ws)
    inputs = load_inputs(ws)
    card = card_of(inputs)
    k = ota.current_round(ws)
    if kind == "keep":
        doc = read_json(design_path(ws), "the accepted design state/design.json")
        doc.update(round=k, report="reports/%s/r%d/analysis.md" % (AGENT_NODE, k), summary="Kept from round %s: %s" % (doc.get("round"), doc.get("summary", "")))
        return doc
    table, devices = load_tables(ws)
    if kind == "intent":
        if given is None:
            raise ToolError("draft intent needs a spec sheet file: {%s, ibiasUa, choices}" % ", ".join(SPEC_KEYS))
        sheet = read_json(given, "the spec sheet %s" % given)
        return first_cut_intent(sheet, card, table, devices, sheet.get("choices"), inputs.get("topology", TOPOLOGY))
    if kind == "mc":
        mc = read_json(state(ws, "mc.json"), "the Monte Carlo result state/mc.json (run mc first)")
        intent = read_json(given, "the intent %s" % given) if given else read_json(design_path(ws), "the accepted design")["intent"]
        problems = intent_problems(intent, inputs.get("topology", TOPOLOGY))
        if problems:
            raise ToolError("the intent is refused:\n- " + "\n- ".join(problems))
        tol = mc["spec"]["vbgV"] * mc["spec"]["vbgTolPct"] / 100.0
        new, why = mc_rescaled_intent(intent, mc, card, table, tol)
        print("Pelgrom: measured sigma(VBG) %.3f mV, wanted %.3f mV (3 sigma in %g %% of the band): area x %s; pair %s -> %s, load %s -> %s%s"
              % (why["sigmaMeasuredMv"], why["sigmaWantedMv"], intent["mcBandSharePct"], why["areaScale"], intent["pair"], new["pair"],
                 intent["load"], new["load"], "" if all(why["reached"].values()) else
                 "; no characterized length reaches the area for %s" % ", ".join(g for g, ok in why["reached"].items() if not ok)), file=sys.stderr)
        return new
    if kind != "size":
        raise ToolError("kind must be intent, size, mc or keep")
    if given is None:
        raise ToolError("draft size needs an intent file: {%s}" % ", ".join(sorted(intent_keys(inputs.get("topology", TOPOLOGY)))))
    topology = inputs.get("topology", TOPOLOGY)
    intent = read_json(given, "the intent %s" % given)
    sized = size_from_intent(table, devices, card, intent, topology)
    return dict(schema=DESIGN_SCHEMA, pdk=inputs["pdks"][PDK_KEY]["name"], topology=topology, round=k, intent={x: intent[x] for x in intent_keys(topology)},
                summary="", reason="", report="reports/%s/r%d/analysis.md" % (AGENT_NODE, k), **sized)


def cmd_draft(ws, kind, given=None):
    print(json.dumps(draft(ws, kind, given), indent=2, sort_keys=True))


def cmd_precheck(ws, path, own_workspace=None):
    doc, facts = validate_design(ws, path=path, files_root=own_workspace or os.getcwd())
    print("precheck PASS: bandgap design round %d (%s). Deliver %s as the result and %s (and your other reports under its folder) "
          "as support." % (facts["round"], facts["pdk"], path, doc["report"]))


# ---------------------------------------------------------------- PVT simulation

def cell_file(ws, stage, design, card, out_dir, mismatch=False):
    """The cell netlist this run simulates: the design's (schematic), or the extracted netlist the
    layout step left at state/cell-post.spice (post; it must define bandgap_lb with the loop pins)."""
    if stage == "post":
        path = state(ws, "cell-post.spice")
        if not path.is_file():
            raise ToolError("post-layout simulation needs state/cell-post.spice (a .subckt bandgap_lb vdd vss en ibias vbg go g)")
        if not re.search(r"(?im)^\.subckt\s+bandgap_lb\s+vdd\s+vss\s+en\s+ibias\s+vbg\s+go\s+g\b", path.read_text()):
            raise ToolError("state/cell-post.spice does not define .subckt bandgap_lb vdd vss en ibias vbg go g")
        return path.resolve(), sha256_file(path)
    name = "cell-mc" if mismatch else "cell"
    stem = ota.fresh_stem(out_dir, name, (".spice",))
    path = Path(str(stem) + ".spice")
    write_text(path, cell_spice(card, design, mismatch))
    return path.resolve(), sha256_file(path)


def simulate_pvt(ws, inputs, stage, design, out_dir, corners=None, own=False):
    out_dir = Path(out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    sim, command = simulator_for(inputs, own=own)
    card = card_of(inputs)
    cell, cell_sha = cell_file(ws, stage, design, card, out_dir)
    benches = []
    started = time.time()
    for corner in corners or corners_of(inputs, sim.name):
        for vdd in card["supplies"]:
            facts = run_bench(sim, command, inputs, corner, vdd, design["ibiasUa"], cell, out_dir, "bg-%s-%gV" % (corner, vdd))
            benches.append(bench_measures(facts))
    return benches, dict(simulator=sim.name, cell=cell.name, cellSha256=cell_sha, elapsedS=round(time.time() - started, 1),
                         benchElapsedS={label(b): b["elapsedS"] for b in benches})


def judge(benches, spec):
    worst = worst_of(benches, spec["vbgV"])
    met = line_met(worst, spec)
    return worst, met, margins_pct(worst, spec)


def cap_text(c):
    return "none" if not c else "%d x %sx%s um" % (c["m"], um(c["wUm"]), um(c["lUm"]))


def measure_rpt(record):
    s, w, met = record["spec"], record["worst"], record["specMet"]
    sign = {True: "met", False: "MISSED", None: "unknown"}
    tol = s["vbgV"] * s["vbgTolPct"] / 100.0
    specs = dict(vbg="%.3f +/- %.1f mV" % (s["vbgV"], 1e3 * tol), iq="< %g uA" % s["iqMaxUa"], isd="<= %g nA" % s["isdMaxNa"],
                 tc="< %g ppm/C" % s["tcMaxPpm"], pm="> %g deg" % s["pmMinDeg"], start="< %g us" % s["tStartMaxUs"], psrr="> %g dB" % s["psrrMinDb"])
    lines = ["# Bandgap in %s, %s: every process corner, temperature and supply" % (record["pdk"], record["stage"]), "",
             "Corners %s; supplies %s V; temperatures %s C (DC sweep -40 to 125 C in 5 C steps); %s, %d runs, %.1f s." % (
                 ", ".join(record["conditions"]["corners"]), ", ".join("%g" % v for v in record["conditions"]["supplies"]),
                 ", ".join("%g" % t for t in TEMPS), record["simulator"], len(record["benches"]), record["elapsedS"]), "",
             "| line | spec | worst | where | margin | verdict |", "| --- | --- | --- | --- | --- | --- |"]
    for key, lab, unit, digits, _b in LINES:
        v = w[key]["value"]
        lines.append("| %s | %s | %s %s | %s | %s %% | %s |" % (lab, specs[key], fmt(v, "%%.%df" % digits), unit, w[key]["where"],
                                                               fmt(record["marginPct"][key], "%.1f"), sign[met[key]]))
    lines += ["", "Meets every line at every corner: %s." % {True: "yes", False: "no", None: "unknown"}[record["meetsSpec"]], "",
              "| corner | VBG -40 / 27 / 125 C (V) | TC (ppm/C) | IQ max (uA) | ISD 27 C (nA) | PM min (deg) | start max (us) | PSRR 1 kHz min (dB) | gate g at 27 C (V) | s |",
              "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for b in record["benches"]:
        tt = b["temps"]
        vb = " / ".join(fmt(tt[str(t)]["vbgV"], "%.4f") for t in TEMPS if str(t) in tt)
        pms = [x["pmDeg"] for x in tt.values()]
        st = [x["startUs"] for x in tt.values()]
        ps = [x["psrrDb"] for x in tt.values()]
        lines.append("| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |" % (
            label(b), vb, fmt(b["tcPpm"], "%.1f"), fmt(b["iqMaxUa"], "%.2f"), fmt(tt.get("27", {}).get("isdNa"), "%.3f"),
            "n/a" if None in pms else fmt(min(pms), "%.1f"), "n/a" if None in st else fmt(max(st), "%.1f"),
            "n/a" if None in ps else fmt(min(ps), "%.1f"), fmt(tt.get("27", {}).get("nodes", {}).get("g"), "%.3f"), fmt(b["elapsedS"], "%.1f")))
    d = record["design"]
    lines += ["", "Design: n %d, ibias %g uA; R1 %s, R2 %s (W x L x segments, um); CC %s, CO %s." % (
        d["n"], d["ibiasUa"], "x".join([um(d["resistors"]["R1"]["wUm"]), um(d["resistors"]["R1"]["lUm"]), str(d["resistors"]["R1"]["s"])]),
        "x".join([um(d["resistors"]["R2a"]["wUm"]), um(d["resistors"]["R2a"]["lUm"]), str(d["resistors"]["R2a"]["s"])]),
        cap_text(d["caps"].get("CC")), cap_text(d["caps"].get("CO"))), "",
              "| device | W (um) | L (um) |", "| --- | --- | --- |"]
    lines += ["| %s | %s | %s |" % (n_, um(v["wUm"]), um(v["lUm"])) for n_, v in d["devices"].items()]
    lines += ["", record["claimBoundary"], ""]
    return "\n".join(lines)


def lines_chart(record, title, source):
    cats, series_w, series_s, metrics = [], [], [], []
    s = record["spec"]
    spec_val = dict(vbg=s["vbgV"], iq=s["iqMaxUa"], isd=s["isdMaxNa"], tc=s["tcMaxPpm"], pm=s["pmMinDeg"], start=s["tStartMaxUs"], psrr=s["psrrMinDb"])
    for key, lab, unit, digits, better in LINES:
        cats.append(lab)
        series_w.append(record["worst"][key]["value"])
        series_s.append(spec_val[key])
        metrics.append((unit, digits, "none" if better == "band" else better))
    return ota.chart(title, cats, [("Spec", series_s, "baseline"), ("Worst corner", series_w, "measured")], source, metrics,
                     subtitle="Worst over %d process x supply x temperature corners" % (3 * len(record["benches"])))


def design_summary(design):
    return dict(n=design["n"], ibiasUa=design["ibiasUa"], devices=design["devices"], resistors=design["resistors"], caps=design.get("caps") or {})


def cmd_simulate(ws, stage, *spec_args):
    ws = Path(ws)
    ahdl_seed(ws / "work" / "spectre-ahdl")
    if stage not in STAGES:
        raise ToolError("stage must be schematic or post")
    inputs = load_inputs(ws)
    design, facts = validate_design(ws)
    k = facts["round"]
    spec = spec_of(spec_args)
    out_dir = report_dir(ws, SIM_NODES[stage], k)
    benches, run = simulate_pvt(ws, inputs, stage, design, out_dir)
    worst, met, marg = judge(benches, spec)
    record = dict(schema=MEASURE_SCHEMA, stage=stage, round=k, pdk=inputs["pdks"][PDK_KEY]["name"],
                  simulator=inputs["pdks"][PDK_KEY]["simulator"]["version"], designSha256=sha256_file(design_path(ws)),
                  cellSha256=run["cellSha256"], design=design_summary(design),
                  conditions=dict(corners=sorted({b["process"] for b in benches}, key=[b["process"] for b in benches].index),
                                  supplies=card_of(inputs)["supplies"], temps=list(TEMPS), ibiasUa=design["ibiasUa"]),
                  spec=spec, benches=benches, worst=worst, specMet=met, marginPct=marg,
                  meetsSpec=None if None in met.values() else all(met.values()),
                  failing=[key for key, ok in met.items() if ok is not True], elapsedS=run["elapsedS"],
                  simulatorRuns=sum(b.get("spectreAttempts") or 1 for b in benches),
                  claimBoundary=CLAIM_BOUNDARY, measuredAt=now())
    write_json(state(ws, "measure-%s.json" % stage), record)
    write_text(out_dir / "measure.rpt", measure_rpt(record))
    ota.write_chart(ws, SIM_NODES[stage], k, "lines", lines_chart(record, "Bandgap spec lines, worst corner (%s)" % stage,
                                                                   "%s, %d corners (%s)" % (record["simulator"], len(benches), SIM_NODES[stage])))
    print("%s round %d in %s: %s; meets the spec: %s (%d runs, %.1f s)" % (
        stage, k, record["pdk"], ", ".join("%s %s%s" % (key, fmt(worst[key]["value"], "%.4g"), "" if met[key] else " (missed)") for key, *_ in LINES),
        record["meetsSpec"], len(benches), run["elapsedS"]))


# ---------------------------------------------------------------- Monte Carlo

def mc_stats(values, vbg_v, tol_pct):
    """Mean, sample sigma, min, max and mean +/- 3 sigma of VBG against the band."""
    n = len(values)
    if n < 2:
        raise ToolError("Monte Carlo needs at least two runs (got %d)" % n)
    mean = sum(values) / n
    sigma = math.sqrt(sum((v - mean) ** 2 for v in values) / (n - 1))
    lo, hi = vbg_v * (1 - tol_pct / 100.0), vbg_v * (1 + tol_pct / 100.0)
    return dict(n=n, meanV=mean, sigmaV=sigma, minV=min(values), maxV=max(values), lo3V=mean - 3 * sigma, hi3V=mean + 3 * sigma,
                bandV=[lo, hi], inBand=(mean - 3 * sigma >= lo and mean + 3 * sigma <= hi),
                marginPct=round(100.0 * min(mean - 3 * sigma - lo, hi - mean - 3 * sigma) / (hi - lo) * 2.0, 2),
                outsideBand=sum(1 for v in values if not lo <= v <= hi))


def mc_spectre_lines(inputs, cell_path, vdd, ibias_ua, n, seed):
    card = card_of(inputs)
    lines = ["// Kuijk bandgap Monte Carlo (mismatch): %s tt, 27 C, vdd %g V" % (inputs["pdks"][PDK_KEY]["name"], vdd),
             "simulator lang=spectre", "global 0", "opts options redefinedparams=warning", "simulator lang=spice"]
    lines += lib_lines(inputs, "tt", "spectre", mismatch=True) + [".include \"%s\"" % cell_path, "simulator lang=spectre"]
    lines += ["parameters %s" % " ".join("%s=%g" % kv for kv in sorted(card["mismatch"]["params"].items())),
              "opts2 options temp=27 tnom=%g rawfmt=psfascii save=selected" % card["temperatureC"],
              "VDD1 (vdd1 0) vsource dc=%g" % vdd, "VEN1 (en1 0) vsource dc=%g" % vdd,
              "GIB1 (ib1 0 en1 0) vccs gm=%.6g" % (ibias_ua * 1e-6 / vdd), "X1 (vdd1 0 en1 ib1 vbg1 g1 g1) bandgap_lb",
              "save vbg1 VDD1:p",
              "mc1 montecarlo numruns=%d seed=%d variations=all donominal=yes savefamilyplots=yes {" % (n, seed), "  op1 dc", "}", ""]
    return lines


def run_mc(ws, inputs, design, n, seed, out_dir, own=False):
    out_dir = Path(out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    sim, command = simulator_for(inputs, own=own)
    if sim.name != "spectre":
        raise ToolError("Monte Carlo runs on Spectre (montecarlo with the PDK's mismatch); the bound simulator is %s" % sim.name)
    card = card_of(inputs)
    cell, cell_sha = cell_file(ws, "schematic", design, card, out_dir, mismatch=True)
    vdd = max(card["supplies"])
    started = time.time()
    raw, netlist, attempts = spectre_retry(command, out_dir, "mc", mc_spectre_lines(inputs, cell, vdd, design["ibiasUa"], n, seed), timeout_s=3600)
    elapsed = round(time.time() - started, 1)
    values, iq = mc_values(raw)
    if len(values) != n:
        raise ToolError("Monte Carlo asked for %d runs and Spectre wrote %d (log %s.log)" % (n, len(values), netlist))
    return values, iq, dict(simulator=sim.name, cell=cell.name, cellSha256=cell_sha, netlist=netlist.name, elapsedS=elapsed, vdd=vdd,
                            spectreAttempts=attempts)


def mc_values(raw):
    """VBG and IQ of each Monte Carlo iteration (mc1-<k>_op1.dc, k >= 1, in order)."""
    raw = Path(raw)
    found = []
    for f in raw.iterdir():
        m = re.fullmatch(r"mc1-0*(\d+)_op1\.dc", f.name)
        if m and int(m.group(1)) >= 1:
            pts, _ = ota.psf_ascii(f)
            if pts and "vbg1" in pts[0]:
                found.append((int(m.group(1)), pts[0]["vbg1"], -pts[0].get("VDD1:p", float("nan"))))
    found.sort()
    return [v for _, v, _ in found], [q for _, _, q in found]


def mc_rpt(rec):
    s = rec["stats"]
    lines = ["# Monte Carlo of the bandgap in %s (mismatch)" % rec["pdk"], "",
             "%d runs, tt, 27 C, vdd %g V, seed %d; %s, %.1f s." % (s["n"], rec["conditions"]["vdd"], rec["conditions"]["seed"], rec["simulator"], rec["elapsedS"]),
             "", "| quantity | value |", "| --- | --- |",
             "| mean VBG | %.4f V |" % s["meanV"], "| sigma VBG | %.3f mV |" % (1e3 * s["sigmaV"]),
             "| mean - 3 sigma | %.4f V |" % s["lo3V"], "| mean + 3 sigma | %.4f V |" % s["hi3V"],
             "| band | %.4f to %.4f V |" % tuple(s["bandV"]), "| min / max of the runs | %.4f / %.4f V |" % (s["minV"], s["maxV"]),
             "| runs outside the band | %d |" % s["outsideBand"], "| verdict | %s |" % ("mean +/- 3 sigma inside the band" if s["inBand"] else "OUTSIDE the band"), ""]
    p = rec.get("pelgrom")
    if p:
        lines += ["Pelgrom estimate for this design (input pair and load only): sigma(VBG) %.3f mV; measured %.3f mV." % (p["sigmaVbgMv"], 1e3 * s["sigmaV"]), ""]
    lines += [CLAIM_BOUNDARY, ""]
    return "\n".join(lines)


def pelgrom_estimate(card, design):
    """sigma(VBG) the Pelgrom model gives for the design's pair and load (the method's estimate)."""
    intent = design.get("intent") or {}
    d = design["devices"]
    r2r1 = (design["resistors"]["R2a"]["lUm"] * design["resistors"]["R2a"]["s"]) / (design["resistors"]["R1"]["lUm"] * design["resistors"]["R1"]["s"])
    if number(intent.get("r2r1")):
        r2r1 = intent["r2r1"]
    avt_p = card["devices"]["pmos"]["avtMvUm"] * 1e-3
    avt_n = card["devices"]["nmos"]["avtMvUm"] * 1e-3
    ap, an = eff_area(card, "pmos", d["M1"]["wUm"], d["M1"]["lUm"]), eff_area(card, "nmos", d["M3"]["wUm"], d["M3"]["lUm"])
    ratio = (intent["load"]["gmId"] / intent["pair"]["gmId"]) if intent else 0.5
    var = 2 * avt_p ** 2 / ap + 2 * avt_n ** 2 / an * ratio ** 2
    return dict(sigmaVbgMv=round(1e3 * (1 + r2r1) * math.sqrt(var), 4), pairAreaUm2=round(ap, 2), loadAreaUm2=round(an, 2))


def cmd_mc(ws, n, vbg_v, tol_pct, seed="1"):
    ws = Path(ws)
    ahdl_seed(ws / "work" / "spectre-ahdl")
    inputs = load_inputs(ws)
    design, facts = validate_design(ws)
    k = facts["round"]
    n, seed = int(n), int(seed)
    if not 2 <= n <= 1000:
        raise ToolError("N must be 2 to 1000 runs")
    out_dir = report_dir(ws, "monte-carlo", k)
    values, iq, run = run_mc(ws, inputs, design, n, seed, out_dir)
    stats = mc_stats(values, float(vbg_v), float(tol_pct))
    rec = dict(schema=MC_SCHEMA, round=k, pdk=inputs["pdks"][PDK_KEY]["name"], simulator=inputs["pdks"][PDK_KEY]["simulator"]["version"],
               designSha256=sha256_file(design_path(ws)), cellSha256=run["cellSha256"],
               conditions=dict(process="tt", tempC=27, vdd=run["vdd"], seed=seed, variations="mismatch", ibiasUa=design["ibiasUa"]),
               spec=dict(vbgV=float(vbg_v), vbgTolPct=float(tol_pct), n=n), stats=stats, meetsSpec=stats["inBand"],
               vbgV=[round(v, 7) for v in values], iqUa=[round(1e6 * q, 5) for q in iq],
               pelgrom=pelgrom_estimate(card_of(inputs), design), elapsedS=run["elapsedS"], spectreAttempts=run["spectreAttempts"],
               claimBoundary=CLAIM_BOUNDARY, measuredAt=now())
    write_json(state(ws, "mc.json"), rec)
    write_text(out_dir / "mc.rpt", mc_rpt(rec))
    lo, hi = stats["bandV"]
    ota.write_chart(ws, "monte-carlo", k, "spread", ota.chart(
        "Monte Carlo VBG, %d runs" % n, ["Band low", "Mean - 3 sigma", "Mean", "Mean + 3 sigma", "Band high"],
        [("VBG", [lo, stats["lo3V"], stats["meanV"], stats["hi3V"], hi], "measured")],
        "%s montecarlo, mismatch, tt 27 C %g V (monte-carlo)" % (rec["simulator"], run["vdd"]), [("V", 4, "none")] * 5,
        subtitle="sigma %.3f mV" % (1e3 * stats["sigmaV"])))
    print("Monte Carlo round %d: %d runs, mean %.4f V, sigma %.3f mV, mean-3sigma %.4f V, mean+3sigma %.4f V; inside 1.2 V band: %s (%.1f s)" % (
        k, n, stats["meanV"], 1e3 * stats["sigmaV"], stats["lo3V"], stats["hi3V"], stats["inBand"], run["elapsedS"]))


# ---------------------------------------------------------------- an agent's own try

def cmd_sim(ws, path, scope, spec_file, out_dir=None):
    """The Pack's bench on an agent's own draft: the same netlists and the same measurements, printed
    as JSON (never a delivery). SCOPE: pvt, a process corner (tt, ss, ...), or mc:<N> (Spectre)."""
    ws = Path(ws)
    inputs = dict(load_inputs(ws))
    if os.environ.get("OTA_PDK_ROOT"):
        inputs["ownPdkRoot"] = os.environ["OTA_PDK_ROOT"]
    design = read_json(path, "the design %s" % path)
    mos = template(inputs.get("topology", TOPOLOGY))["mos"]
    if not isinstance(design, dict) or design.get("topology", TOPOLOGY) != inputs.get("topology", TOPOLOGY) or \
            sorted(design.get("devices") or {}) != sorted(mos) or sorted(design.get("resistors") or {}) != sorted(RESISTORS):
        raise ToolError("%s is not a %s bandgap design with devices %s and resistors %s" % (
            path, inputs.get("topology", TOPOLOGY), ", ".join(mos), ", ".join(RESISTORS)))
    spec = spec_from_sheet(read_json(spec_file, "the spec sheet %s" % spec_file)) if spec_file != "-" else None
    out_dir = Path(out_dir or "sim-bandgap")
    if scope.startswith("mc:"):
        n = int(scope[3:])
        values, _iq, run = run_mc(ws, inputs, design, n, 1, out_dir, own=True)
        tol = spec["vbgTolPct"] if spec else 2.0
        print(json.dumps(dict(simulator=run["simulator"], stats=mc_stats(values, spec["vbgV"] if spec else 1.2, tol), elapsedS=run["elapsedS"]), indent=2, sort_keys=True))
        return
    sim, _ = simulator_for(inputs, own=True)
    corners = corners_of(inputs, sim.name)
    if scope != "pvt" and scope not in corners:
        raise ToolError("scope must be pvt, mc:<N> or one of the corners %s" % ", ".join(corners))
    benches, run = simulate_pvt(ws, inputs, "schematic", design, out_dir, corners=None if scope == "pvt" else [scope], own=True)
    out = dict(simulator=run["simulator"], scope=scope, elapsedS=run["elapsedS"],
               benches=[{k: v for k, v in b.items() if k != "sweep"} for b in benches])
    if spec:
        worst, met, marg = judge(benches, spec)
        out.update(worst=worst, specMet=met, marginPct=marg, failing=[k for k, ok in met.items() if ok is not True])
    print(json.dumps(out, indent=2, sort_keys=True, default=lambda x: None))


# ---------------------------------------------------------------- the cell for layout

def cmd_cell(ws, path=None):
    """The cell netlist (SPICE) of the accepted design, or of a design file: `.subckt bandgap_lb vdd vss
    en ibias vbg go g` and the closed `.subckt bandgap vdd vss en ibias vbg`, as the benches simulate it."""
    ws = Path(ws)
    inputs = load_inputs(ws)
    if path is None:
        design, _facts = validate_design(ws)
    else:
        design = read_json(path, "the design %s" % path)
        if not isinstance(design, dict) or design.get("topology", TOPOLOGY) != inputs.get("topology", TOPOLOGY):
            raise ToolError("%s is not a %s bandgap design" % (path, inputs.get("topology", TOPOLOGY)))
    sys.stdout.write(cell_spice(card_of(inputs), design))


# ---------------------------------------------------------------- layout, DRC, LVS, extraction

LAYOUT_SCHEMA = "hima-bandgap-layout/1"
PEX_KINDS = {"c": "_pex_c.spice", "rc": "_pex_rc.spice"}


def layout_clean(facts):
    """Every check of the Site's layout tool passed: zero DRC errors on both decks (outside the PDK's
    own PNP cells for Magic; the die-level density rules are reported, not judged: a block meets them
    with fill), and both LVS checks match."""
    return (facts["drcMagic"] == 0 and facts["drcKlayout"] == 0 and facts["lvsNetgen"] is True and facts["lvsKlayout"] is True)


def cmd_layout(ws, tool, pex):
    """Lay out the accepted design with the Site's layout tool (`<tool> <netlist> bandgap_lb <out>`:
    layout, DRC, LVS against this netlist, extraction, picture), keep its facts bound to the design,
    and leave the extracted cell at state/cell-post.spice for the post-layout simulation."""
    ws = Path(ws)
    if pex not in PEX_KINDS:
        raise ToolError("the extraction is c (capacitance) or rc (resistance and capacitance)")
    inputs = load_inputs(ws)
    design, facts = validate_design(ws)
    k = facts["round"]
    out_dir = report_dir(ws, "layout", k).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = ota.fresh_stem(out_dir, "bandgap", (".spice", "-layout"))
    netlist = Path(str(stem) + ".spice")
    write_text(netlist, cell_spice(card_of(inputs), design))
    run_dir = Path(str(stem) + "-layout")
    started = time.time()
    ota.run([tool, str(netlist), "bandgap_lb", str(run_dir)], out_dir, Path(str(stem) + "-layout.log"), timeout_s=1800)
    elapsed = round(time.time() - started, 1)
    found = read_json(run_dir / "layout.json", "the layout tool's facts (%s)" % (run_dir / "layout.json"))
    if found.get("schema") != "hima-cell-layout/1" or found.get("cell") != "bandgap_lb":
        raise ToolError("%s is not the layout tool's record of bandgap_lb" % (run_dir / "layout.json"))
    if Path(found.get("netlist", "")).resolve() != netlist.resolve():
        raise ToolError("the layout tool laid out %s, not this design's netlist %s" % (found.get("netlist"), netlist))
    extracted = run_dir / ("bandgap_lb" + PEX_KINDS[pex])
    if not extracted.is_file():
        raise ToolError("the layout tool wrote no %s extraction (%s)" % (pex, extracted))
    gds = run_dir / "bandgap_lb.gds"
    drc = found["klayoutDrc"]
    bbox = found.get("render", {}).get("bboxUm")
    rec = dict(schema=LAYOUT_SCHEMA, round=k, pdk=inputs["pdks"][PDK_KEY]["name"], designSha256=sha256_file(design_path(ws)),
               netlistSha256=sha256_file(netlist), gdsSha256=sha256_file(gds) if gds.is_file() else None,
               drcMagic=found["draw"]["magicDrcErrors"], drcMagicInPdkPnpCells=found["draw"].get("magicDrcInPdkPnpCells", 0),
               drcKlayout=drc["block"]["total"], drcKlayoutByRule=drc["block"].get("byRule", {}),
               densityRules=drc["density"]["total"], lvsNetgen=found["lvs"]["match"], lvsKlayout=found["klayoutLvs"]["match"],
               pnpNameCorrections=found["lvs"].get("pnpNameCorrections", 0), referenceNotes=found["lvs"].get("referenceNotes", []),
               pex=pex, pexCounts=found["pex"]["netlists"].get("bandgap_lb" + PEX_KINDS[pex]),
               bboxUm=bbox, areaUm2=round(bbox[0] * bbox[1], 1) if bbox else None,
               toolSeconds=found.get("totalSeconds"), elapsedS=elapsed, runDir=str(run_dir.relative_to(Path(ws).resolve())),
               claimBoundary=CLAIM_BOUNDARY + " Layout checked with the open PDK's own DRC and LVS decks; die-level density "
                                              "rules need fill and are reported, not judged.",
               measuredAt=now())
    rec["clean"] = layout_clean(rec)
    post = state(ws, "cell-post.spice")
    write_text(post, extracted.read_text())
    rec["postCellSha256"] = sha256_file(post)
    write_json(state(ws, "layout.json"), rec)
    lines = ["# Layout of the bandgap in %s, round %d" % (rec["pdk"], k), "",
             "| check | result |", "| --- | --- |",
             "| Cell size | %s |" % ("%.1f x %.1f um (%.0f um2)" % (bbox[0], bbox[1], rec["areaUm2"]) if bbox else "n/a"),
             "| DRC, Magic (PDK tech file) | %d errors (%d inside the PDK's own PNP cells) |" % (rec["drcMagic"], rec["drcMagicInPdkPnpCells"]),
             "| DRC, KLayout (PDK deck, block) | %d errors |" % rec["drcKlayout"],
             "| Density rules (die level, need fill) | %d reported |" % rec["densityRules"],
             "| LVS, netgen | %s |" % ("match" if rec["lvsNetgen"] else "MISMATCH"),
             "| LVS, KLayout (PDK deck) | %s |" % ("match" if rec["lvsKlayout"] else "MISMATCH"),
             "| Extraction for post-layout simulation | %s: %s |" % (pex, json.dumps(rec["pexCounts"], sort_keys=True)),
             "| Verdict | %s |" % ("clean" if rec["clean"] else "NOT clean"), ""]
    if rec["referenceNotes"]:
        lines += ["LVS reference notes: " + "; ".join(rec["referenceNotes"]), ""]
    lines += [rec["claimBoundary"], ""]
    write_text(out_dir / "layout.rpt", "\n".join(lines))
    png = run_dir / "bandgap_lb.png"
    if png.is_file():
        (out_dir / "bandgap-layout.png").write_bytes(png.read_bytes())
    ota.write_chart(ws, "layout", k, "checks", ota.chart(
        "Layout checks of the sized bandgap", ["DRC errors (Magic)", "DRC errors (KLayout)", "LVS netgen", "LVS KLayout", "Area"],
        [("Layout", [rec["drcMagic"], rec["drcKlayout"], 1 if rec["lvsNetgen"] else 0, 1 if rec["lvsKlayout"] else 0, rec["areaUm2"]], "measured")],
        "Magic, KLayout and netgen with the %s decks (layout)" % rec["pdk"], [("count", 0, "lower"), ("count", 0, "lower"), ("match", 0, "higher"),
                                                                              ("match", 0, "higher"), ("um2", 0, "lower")],
        subtitle="clean" if rec["clean"] else "not clean"))
    print("layout round %d: DRC %d/%d, LVS netgen %s, KLayout %s, %s; %s extraction left for post-layout simulation (%.1f s)" % (
        k, rec["drcMagic"], rec["drcKlayout"], rec["lvsNetgen"], rec["lvsKlayout"], "clean" if rec["clean"] else "NOT clean", pex, elapsed))


# ---------------------------------------------------------------- the round record

def cmd_record(ws, *spec_args):
    ws = Path(ws)
    inputs = load_inputs(ws)
    k = ota.current_round(ws)
    spec = spec_of(spec_args)
    problems = []
    sha = sha256_file(design_path(ws)) if design_path(ws).is_file() else None
    found = {}
    for name in ("measure-schematic", "mc", "measure-post"):
        path = state(ws, name + ".json")
        m = read_json(path) if path.is_file() else None
        if m is None or m.get("round") != k:
            continue
        if m.get("designSha256") != sha:
            problems.append("the %s result is not of the accepted design" % name)
            continue
        found[name] = m
    pvt = found.get("measure-schematic")
    if pvt is None:
        problems.append("no PVT measurement of the accepted design this round")
    elif {kk: pvt["spec"][kk] for kk in SPEC_KEYS} != spec:
        problems.append("the PVT measurement was judged against another spec sheet")
    mc = found.get("mc")
    if mc is not None and (mc["spec"]["vbgV"], mc["spec"]["vbgTolPct"]) != (spec["vbgV"], spec["vbgTolPct"]):
        problems.append("the Monte Carlo result was judged against another VBG band")
    met = None if pvt is None else line_met(pvt["worst"], spec)
    margin = None if pvt is None else margins_pct(pvt["worst"], spec)
    pvt_ok = met is not None and all(v is True for v in met.values())
    mc_ok = None if mc is None else mc["stats"]["inBand"]
    lay_path = state(ws, "layout.json")
    lay = read_json(lay_path) if lay_path.is_file() else None
    if lay is not None and (lay.get("round") != k or lay.get("designSha256") != sha):
        lay = None
    post = found.get("measure-post")
    if post is not None and (lay is None or post.get("cellSha256") != lay.get("postCellSha256")):
        problems.append("the post-layout result is not of this round's extracted layout")
        post = None
    if post is not None and {kk: post["spec"][kk] for kk in SPEC_KEYS} != spec:
        problems.append("the post-layout measurement was judged against another spec sheet")
        post = None
    post_ok = None if post is None else post.get("meetsSpec")
    lay_ok = None if lay is None else lay["clean"]
    post_margin = None if post is None else margins_pct(post["worst"], spec)
    # The round is a valid result when every measurement in it is of the accepted design and the PVT
    # set was measured; it is signed off when the schematic meets every line at every corner, Monte
    # Carlo is in band, the layout is clean, and the extracted layout meets every line at every corner.
    valid = not problems and pvt is not None
    signoff = bool(valid and pvt_ok and mc_ok is True and lay_ok is True and post_ok is True)
    worst_margin = None if margin is None or None in margin.values() else min(margin.values())
    post_worst = None if post_margin is None or None in post_margin.values() else min(post_margin.values())
    lessons = read_json(state(ws, "lessons.json"))
    earlier = [r["worstMarginPct"] for r in lessons["rounds"] if r.get("roundValid") and r.get("worstMarginPct") is not None]
    stage_margin = post_worst if post_worst is not None else worst_margin
    best = max(earlier + ([stage_margin] if valid and stage_margin is not None else []), default=None)
    entry = dict(round=k, roundValid=bool(valid), signedOff=signoff, problems=problems, pvtMet=met, pvtMarginPct=margin,
                 worstMarginPct=stage_margin if valid else None, schematicMarginPct=worst_margin, postMarginPct=post_worst,
                 bestMarginPct=-100.0 if best is None else best,
                 roundImproved=bool(valid and stage_margin is not None and all(stage_margin > e for e in earlier)),
                 layout=None if lay is None else dict(clean=lay["clean"], drcMagic=lay["drcMagic"], drcKlayout=lay["drcKlayout"],
                                                     lvsNetgen=lay["lvsNetgen"], lvsKlayout=lay["lvsKlayout"], areaUm2=lay["areaUm2"]),
                 postWorst=None if post is None else {x: post["worst"][x]["value"] for x, *_ in LINES},
                 postWhere=None if post is None else {x: post["worst"][x]["where"] for x, *_ in LINES},
                 postLineMet=None if post is None else line_met(post["worst"], spec),
                 failing=None if met is None else [x for x, ok in met.items() if ok is not True] + ([] if mc_ok is True else ["mc"]),
                 pvtWorst=None if pvt is None else {x: pvt["worst"][x]["value"] for x, *_ in LINES},
                 pvtWhere=None if pvt is None else {x: pvt["worst"][x]["where"] for x, *_ in LINES},
                 mc=None if mc is None else dict(n=mc["stats"]["n"], meanV=mc["stats"]["meanV"], sigmaMv=1e3 * mc["stats"]["sigmaV"], inBand=mc_ok),
                 postMet=post_ok, layoutClean=lay_ok, intent=(read_json(design_path(ws)).get("intent") if sha else None))
    lessons["rounds"].append(entry)
    record = dict(schema=ROUND_SCHEMA, spec=spec, claimBoundary=CLAIM_BOUNDARY, recordedAt=now(), **entry)
    out = report_dir(ws, "record-round", k)
    text = round_md(record, inputs)
    write_text(out / ("round-%d.md" % k), text)
    write_text(Path(ws) / "derived" / ("round-%d.md" % k), text)
    write_summary(ws, inputs, lessons, spec)
    write_json(state(ws, "round.json"), record)
    write_json(state(ws, "lessons.json"), lessons)
    print("round %d recorded: valid %s, signed off %s; failing lines %s; Monte Carlo %s; layout %s; after layout %s" % (
        k, valid, signoff, "not measured" if entry["failing"] is None else (", ".join(entry["failing"]) or "none"),
        "not run" if mc is None else ("in band" if mc_ok else "outside the band"),
        "not run" if lay_ok is None else ("clean" if lay_ok else "NOT clean"),
        "not run" if post_ok is None else ("meets the spec" if post_ok else "misses the spec")))


def round_md(r, inputs):
    lines = ["# Round %d: bandgap in %s" % (r["round"], inputs["pdks"][PDK_KEY]["name"]), "",
             "| line | worst | where | met |", "| --- | --- | --- | --- |"]
    for key, lab, unit, digits, _b in LINES:
        w = (r.get("pvtWorst") or {}).get(key)
        lines.append("| %s | %s %s | %s | %s |" % (lab, fmt(w, "%%.%df" % digits), unit, (r.get("pvtWhere") or {}).get(key) or "n/a",
                                                   {True: "yes", False: "no", None: "unknown"}[(r.get("pvtMet") or {}).get(key)]))
    mc = r.get("mc")
    lines.append("| Monte Carlo (mean +/- 3 sigma in band) | %s | %s | %s |" % (
        "n/a" if mc is None else "%.4f V, sigma %.3f mV" % (mc["meanV"], mc["sigmaMv"]), "tt 27 C" if mc else "not run",
        "unknown" if mc is None else {True: "yes", False: "no"}[mc["inBand"]]))
    lay = r.get("layout")
    lines.append("| Layout (DRC Magic/KLayout, LVS netgen/KLayout) | %s | %s | %s |" % (
        "n/a" if lay is None else "%d / %d errors, %s / %s" % (lay["drcMagic"], lay["drcKlayout"], "match" if lay["lvsNetgen"] else "mismatch",
                                                               "match" if lay["lvsKlayout"] else "mismatch"),
        "not run" if lay is None else ("%.0f um2" % lay["areaUm2"] if lay.get("areaUm2") else "GF180MCU decks"),
        "unknown" if lay is None else {True: "yes", False: "no"}[lay["clean"]]))
    if r.get("postWorst"):
        lines += ["", "After layout (extracted), worst over the same corners:", "", "| line | worst | where | met |", "| --- | --- | --- | --- |"]
        for key, lab, unit, digits, _b in LINES:
            lines.append("| %s | %s %s | %s | %s |" % (lab, fmt(r["postWorst"].get(key), "%%.%df" % digits), unit, r["postWhere"].get(key) or "n/a",
                                                       {True: "yes", False: "no", None: "unknown"}[(r.get("postLineMet") or {}).get(key)]))
    lines += ["", "Round valid: %s. Signed off (every line at every corner, Monte Carlo, clean layout, every line after layout): %s." % (
        "yes" if r["roundValid"] else "no", "yes" if r.get("signedOff") else "no")]
    if r["problems"]:
        lines += ["", "Problems: " + "; ".join(r["problems"])]
    lines += ["", CLAIM_BOUNDARY, ""]
    return "\n".join(lines)


def write_summary(ws, inputs, lessons, spec):
    lines = ["# Bandgap in %s: summary" % inputs["pdks"][PDK_KEY]["name"], "",
             "| round | failing lines (schematic) | Monte Carlo | layout | after layout | worst margin (%) | valid | signed off |",
             "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    for r in lessons["rounds"]:
        mc = r.get("mc")
        lay = r.get("layoutClean")
        post = r.get("postMet")
        lines.append("| %d | %s | %s | %s | %s | %s | %s | %s |" % (
            r["round"], "not measured" if r["failing"] is None else (", ".join(x for x in r["failing"] if x != "mc") or "none"),
            "not run" if mc is None else ("in band" if mc["inBand"] else "outside"),
            "not run" if lay is None else ("clean" if lay else "not clean"),
            "not run" if post is None else ("meets" if post else "misses"),
            fmt(r["worstMarginPct"]), "yes" if r["roundValid"] else "no", "yes" if r.get("signedOff") else "no"))
    lines += ["", CLAIM_BOUNDARY, ""]
    write_text(Path(ws) / "derived" / "summary.md", "\n".join(lines))


# ---------------------------------------------------------------- entry

COMMANDS = {
    "bind": (cmd_bind, (3, 4)), "characterize": (cmd_characterize, (0,)), "design": (cmd_design, (0,)),
    "draft": (cmd_draft, (1, 2)), "precheck": (cmd_precheck, (1, 2)), "sim": (cmd_sim, (3, 4)),
    "simulate": (cmd_simulate, (9,)), "mc": (cmd_mc, (3, 4)), "record": (cmd_record, (8,)), "cell": (cmd_cell, (0, 1)),
    "layout": (cmd_layout, (2,)),
}


def main(argv):
    if len(argv) < 3 or argv[1] not in COMMANDS:
        print("usage: bg_cli.py {%s} <WORKSPACE> ..." % "|".join(COMMANDS), file=sys.stderr)
        return 2
    command, arities = COMMANDS[argv[1]]
    if len(argv) - 3 not in arities:
        print("bg_cli.py %s takes %s argument(s) after the workspace" % (argv[1], " or ".join(map(str, arities))), file=sys.stderr)
        return 2
    try:
        command(os.path.abspath(argv[2]), *argv[3:])
    except ToolError as error:
        print("bg %s: %s" % (argv[1], error), file=sys.stderr)
        return 3
    except ValueError as error:
        print("bg %s: %s" % (argv[1], error), file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
