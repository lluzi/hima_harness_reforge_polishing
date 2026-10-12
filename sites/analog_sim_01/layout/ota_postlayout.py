#!/usr/bin/env python3
"""Pre-layout and post-layout Spectre of the Pack's OTA on the same testbench (python3 >= 3.9, stdlib).

Runs on the Site host, where the Spectre wrapper runs Cadence Spectre:

  ota_postlayout.py <pack_flow_dir> <design.json> <layout_dir> <pdk_root> <spectre_command> [<corner>]

It refuses a layout folder whose layout.json names another design (SHA-256 of the design file) or
records a failed step, and an extracted subcircuit whose ports are not exactly the OTA's pins
(vdd vss inp inn out ibias; cell_layout.py maps a Magic substrate port to vss and records it).

It imports the Pack's own ota_cli.py, so the testbench (open-loop AC, 1 GH / 1 F DC feedback, the
strategy's 2 pF load and 60 % input common mode), the Spectre netlist head and the arithmetic of the
gain, unity-gain frequency and phase margin are the Pack's, unchanged. Four netlists are measured:

  pre-ideal   the Pack's netlist as it simulates it (ideal Rz and Cc);
  pre-pdk     the LVS reference: the same MOS, Rz as ppolyf_u and Cc as the GF180 MIM;
  post-c      the layout's extraction with parasitic capacitance (ota_pex_c.spice);
  post-rc     the same with parasitic resistance (ota_pex_rc.spice).

Writes <layout_dir>/postlayout.json and a table on stdout.
"""
import hashlib
import json
import re
import sys
import time
from pathlib import Path

LOAD_PF, CM_PCT = 2.0, 60.0
MOS_MODELS = ("nfet_03v3", "pfet_03v3")
EXTRA_LIBS = (("gf180mcuD/libs.tech/ngspice/sm141064.spice", "res_typical"),
              ("gf180mcuD/libs.tech/ngspice/sm141064.spice", "mimcap_typical"))
CORNER_LIBS = {"tt": ("res_typical", "mimcap_typical"), "ss": ("res_ss", "mimcap_ss"), "ff": ("res_ff", "mimcap_ff")}
PORT_NODE = {"vss": "0", "ibias": "nbias"}
OTA_PORTS = ("vdd", "vss", "inp", "inn", "out", "ibias")


def spice_for_spectre(text):
    """An extracted or reference SPICE subcircuit as Spectre's SPICE reader takes it: MOS instances
    of the PDK's model cards (Magic writes them as X instances) become M instances; node names lose
    the dots Magic's resistance extraction puts in them."""
    out, ports = [], None
    for line in text.splitlines():
        tok = line.split()
        if not tok or tok[0].startswith("*") or tok[0].startswith(".option"):
            continue
        head = tok[0].lower()
        if head == ".subckt":
            ports = tok[2:]
            tok = tok[:2] + [t.replace(".", "_") for t in tok[2:]]
        elif head[0] == "x":
            k = max(i for i, t in enumerate(tok) if "=" not in t)          # the model / subcircuit name
            tok = [tok[0]] + [t.replace(".", "_") for t in tok[1:k]] + tok[k:]
            if tok[k] in MOS_MODELS:
                tok[0] = "M" + tok[0][1:]
        elif head[0] in "rc":
            tok = [tok[0], tok[1].replace(".", "_"), tok[2].replace(".", "_")] + tok[3:]
        out.append(" ".join(tok))
    return "\n".join(out) + "\n", ports


def main(argv):
    if len(argv) < 6:
        print(__doc__, file=sys.stderr)
        return 2
    flow, design_path, layout, pdk_root, spectre = Path(argv[1]), Path(argv[2]), Path(argv[3]).resolve(), argv[4], argv[5]
    corner = argv[6] if len(argv) > 6 else "tt"
    sys.path.insert(0, str(flow))
    import ota_cli as ota
    # the layout must be of this design, and clean of tool failures
    facts_path = layout / "layout.json"
    if not facts_path.is_file():
        raise SystemExit("ota_postlayout: %s has no layout.json" % layout)
    facts = json.loads(facts_path.read_text())
    sha = hashlib.sha256(design_path.read_bytes()).hexdigest()
    if facts.get("designSha256") != sha:
        raise SystemExit("ota_postlayout: %s was laid out from design %s, not %s (sha256 %s)" % (
            layout, facts.get("designSha256"), design_path, sha))
    if not facts.get("ok"):
        raise SystemExit("ota_postlayout: the layout run failed: %s" % "; ".join(facts.get("failures", [])))
    cards = json.loads((flow / "pdks.json").read_text())["cards"]
    design = json.loads(design_path.read_text())
    inputs = dict(pdkRoot=pdk_root, pdks=dict(source=dict(name=design["pdk"], card=cards[design["pdk"]])))
    sim_dir = layout / "spectre"
    sim_dir.mkdir(exist_ok=True)
    version = ota.Spectre.version(spectre)

    pack_lines, insts, vdd = ota.ota_lines(ota.Spectre, inputs, "source", design, corner, LOAD_PF, CM_PCT)
    results = {}

    def measure(tag, lines, names):
        t0 = time.time()
        facts = ota.Spectre.ota(spectre, inputs, "source", lines, names, vdd, sim_dir, "%s-%s" % (tag, corner))
        m = ota.corner_measures(facts)
        results[tag] = dict(gainDb=m["gainDb"], gbwMhz=m["gbwMhz"], pmDeg=m["pmDeg"], powerUw=m["powerUw"],
                            seconds=round(time.time() - t0, 2))

    measure("pre-ideal", pack_lines, insts)

    # The same testbench around a subcircuit: the Pack's head and sources, its devices removed.
    split = pack_lines.index("simulator lang=spectre")
    head = pack_lines[:split]
    head += ['.lib "%s/gf180mcuD/libs.tech/ngspice/sm141064.spice" %s' % (pdk_root, lib) for lib in CORNER_LIBS[corner]]
    tail = [l for l in pack_lines[split:] if not re.match(r"^(M[1-8]|RZ|CC) \(", l)]
    none = {d: "-" for d in ota.DEVICES}
    for tag, name in (("pre-pdk", "ota_ref.spice"), ("post-c", "ota_pex_c.spice"), ("post-rc", "ota_pex_rc.spice")):
        path = layout / name
        if not path.is_file():
            continue
        body, ports = spice_for_spectre(path.read_text())
        if ports is None or sorted(ports) != sorted(OTA_PORTS):
            raise SystemExit("ota_postlayout: %s exposes ports %s; the OTA's are exactly %s" % (name, ports, " ".join(OTA_PORTS)))
        sub = sim_dir / ("%s.spice" % tag)
        sub.write_text(body)
        nodes = " ".join(PORT_NODE.get(p, p) for p in ports)
        lines = head + ['.include "%s"' % sub] + tail[:2] + ["XOTA (%s) ota" % nodes] + tail[2:]
        measure(tag, lines, none)

    out = dict(schema="hima-ota-postlayout/1", simulator=version, corner=corner, loadPf=LOAD_PF, inputCmPct=CM_PCT,
               design=str(design_path), results=results)
    (layout / ("postlayout-%s.json" % corner)).write_text(json.dumps(out, indent=2) + "\n")
    print("%s, corner %s, load %g pF, input CM %g %%" % (version, corner, LOAD_PF, CM_PCT))
    print("%-10s %9s %9s %8s %9s %7s" % ("netlist", "gain dB", "UGF MHz", "PM deg", "power uW", "sec"))
    for tag, r in results.items():
        f = lambda v, s: ("%" + s) % v if v is not None else "-"
        print("%-10s %9s %9s %8s %9s %7.1f" % (tag, f(r["gainDb"], ".2f"), f(r["gbwMhz"], ".3f"), f(r["pmDeg"], ".2f"),
                                              f(r["powerUw"], ".1f"), r["seconds"]))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
