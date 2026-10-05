#!/usr/bin/env python3
"""Abstract cells: cell specs -> sized SKY130 netlists + abstract LEFs + round-recipe library entries.

    python3 abstract_cells.py SPEC.json ROUND WORKSPACE [--platform-lef LEF] [--pdk-spice SPICE]
                              [--jobs N] [--out cells.json]

The fast path of the demo (no LibreCell, Magic, DRC or LVS). Per spec cell:

  netlist  bool2cmos -> switch-level check -> the factory's sizing variant -> switch-level check,
           exactly as factory.py builds it (same spec format, same helpers).
  layout   an ABSTRACT LEF composed from foundry sky130_fd_sc_hd macros (`layoutFrom`, default the
           cell's `compareTo` with identical pin names): their pin, rail and obstruction geometry is
           copied side by side, renamed, and the cell is widened by whole sites when the sized netlist
           has more transistor width than its sources (width ~ total device width). Pins therefore
           have the same router access as foundry pins; the area follows the devices.
  library  nothing here: HimaHarness models every abstract cell itself from the pre-layout netlist
           (calibrated pre-layout SPICE, MODELLED, see ../char/README.md).

Abstract cells have no GDS and no internal wiring: they are placement and routing models for a
timing study, not tape-out cells. ORFS runs them with GDS_ALLOW_EMPTY.

Spec cell keys (factory format plus): `compareTo` (foundry cell, required), `layoutFrom` (optional
list of {"cell": foundry cell, "pins": {source pin: cell pin or null}}; a null pin's shapes become
obstruction), `footprint` (optional resizer family). A multi-output or fused cell needs `layoutFrom`.

Writes WORKSPACE/cells/r<ROUND>/lib/<name>.sp and <name>.lef, cells/r<ROUND>/library.lef and
library.md, and prints (or writes) the recipe `library` object with SHA-256 per file.
"""
import argparse
import concurrent.futures
import hashlib
import json
import math
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "factory"))
import factory as fx  # noqa: E402

PREFIX = "sky130_fd_sc_hd__"
SITE_W = 0.46
POWER = ("VGND", "VNB", "VPB", "VPWR")
PLATFORM_LEF = "platforms/sky130hd/lef/sky130_fd_sc_hd_merged.lef"
PDK_SPICE = "/foss/pdks/sky130A/libs.ref/sky130_fd_sc_hd/spice/sky130_fd_sc_hd.spice"
BOOL2CMOS = os.environ.get("BOOL2CMOS_ROOT", "/data/eda/project/bool2cmos")


class AbstractError(Exception):
    pass


def sha(path):
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


# ------------------------------------------------------------------------------------------- netlist
def sized_netlist(cell, work):
    """bool2cmos + sizing, as factory.build_cell does; returns the sized netlist dict."""
    os.makedirs(work, exist_ok=True)
    b2c = os.path.join(work, cell["name"] + ".b2c.sp")
    cmd = [sys.executable, "-m", "bool2cmos", "--inputs", ",".join(cell["inputs"]), "--pdk", "sky130",
           "--cell-name", cell["name"], "--out", b2c, "--meta", b2c[:-3] + ".json"]
    for pin, function in cell["outputs"].items():
        cmd += ["--function", function, "--output", pin]
    env = dict(os.environ)
    env["PYTHONPATH"] = BOOL2CMOS + (":" + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
    done = subprocess.run(cmd, cwd=work, env=env, capture_output=True, text=True, timeout=120)
    if done.returncode != 0 or not os.path.isfile(b2c):
        raise AbstractError("bool2cmos rc=%s: %s" % (done.returncode, (done.stderr or done.stdout)[-400:]))
    with open(b2c) as handle:
        base = fx.parse_b2c_spice(handle.read())
    err = fx.verify_switch_level(base, cell)
    if err:
        raise AbstractError("bool2cmos netlist wrong at switch level: " + err)
    sized = fx.apply_sizing(base, cell["variant"])
    err = fx.verify_switch_level(sized, cell)
    if err:
        raise AbstractError("sized netlist wrong at switch level: " + err)
    return sized


def foundry_width(pdk_text, name):
    """Total transistor width (um) of a foundry cell's schematic."""
    match = re.search(r"(?ims)^\.subckt\s+%s\s.*?^\.ends" % re.escape(name), pdk_text)
    if not match:
        raise AbstractError("%s is not in the PDK SPICE" % name)
    total = 0.0
    for line in match.group(0).splitlines():
        w = re.search(r"(?i)\bw=([0-9.]+(?:e[+-]?\d+)?)(u)?", line)
        if w and line[:1].upper() in "XM":
            total += float(w.group(1)) * (1e-6 if w.group(2) else 1.0)
    return total


# ---------------------------------------------------------------------------------------------- LEF
def macro_text(lef_text, name):
    match = re.search(r"(?ms)^MACRO\s+%s\s*$.*?^END\s+%s\s*$" % (re.escape(name), re.escape(name)), lef_text)
    if not match:
        raise AbstractError("%s is not in the platform LEF" % name)
    return match.group(0)


def parse_macro(text):
    """-> {"width", "height", "pins": {name: {"head": [lines], "ports": [[lines]]}}, "obs": [lines]}"""
    size = re.search(r"SIZE\s+([0-9.]+)\s+BY\s+([0-9.]+)", text)
    pins = {}
    for m in re.finditer(r"(?ms)^\s*PIN\s+(\S+)\s*$(.*?)^\s*END\s+\1\s*$", text):
        body = m.group(2)
        ports = [p.group(1).strip("\n").splitlines() for p in re.finditer(r"(?ms)^\s*PORT\s*$(.*?)^\s*END\s*$", body)]
        head = [l for l in re.sub(r"(?ms)^\s*PORT\s*$.*?^\s*END\s*$", "", body).splitlines() if l.strip()]
        pins[m.group(1)] = {"head": head, "ports": ports}
    obs = re.search(r"(?ms)^\s*OBS\s*$(.*?)^\s*END\s*$", text)
    return {"width": float(size.group(1)), "height": float(size.group(2)), "pins": pins,
            "obs": obs.group(1).strip("\n").splitlines() if obs else []}


def shift(lines, dx):
    out = []
    for line in lines:
        m = re.match(r"(\s*)(RECT|POLYGON)\s+(.*?)\s*;\s*$", line)
        if not m or dx == 0:
            out.append(line)
            continue
        nums = [float(v) for v in m.group(3).split()]
        nums = [v + dx if i % 2 == 0 else v for i, v in enumerate(nums)]
        out.append("%s%s %s ;" % (m.group(1), m.group(2), " ".join("%.3f" % v for v in nums)))
    return out


def rails(ports, width, total):
    """Full-width rail rectangles of a power pin's ports, stretched to the composed cell width."""
    extra = []
    for port in ports:
        layer = None
        for line in port:
            lm = re.match(r"\s*LAYER\s+(\S+)", line)
            if lm:
                layer = lm.group(1)
            rm = re.match(r"\s*RECT\s+([-0-9.]+)\s+([-0-9.]+)\s+([-0-9.]+)\s+([-0-9.]+)", line)
            if rm and layer and float(rm.group(1)) <= 0.001 and float(rm.group(3)) >= width - 0.001:
                extra.append((layer, float(rm.group(2)), float(rm.group(4))))
    port = []
    for layer in sorted({e[0] for e in extra}):
        port.append("        LAYER %s ;" % layer)
        for _l, y0, y1 in sorted({e for e in extra if e[0] == layer}):
            port.append("          RECT 0.000 %.3f %.3f %.3f ;" % (y0, total, y1))
    return port


def compose(cell, sources, lef_text, widen_sites):
    """Abstract MACRO for `cell` from foundry `sources` [(foundry name, {src pin: cell pin|None})]."""
    parts, x = [], 0.0
    for name, mapping in sources:
        macro = parse_macro(macro_text(lef_text, name))
        signal = [p for p in macro["pins"] if p not in POWER]
        unmapped = [p for p in signal if p not in mapping]
        if unmapped:
            raise AbstractError("layoutFrom %s: pins %s have no mapping" % (name, unmapped))
        parts.append((name, mapping, macro, x))
        x += macro["width"]
    height = parts[0][2]["height"]
    width = round((round(x / SITE_W) + widen_sites) * SITE_W, 3)
    pins, obs = {}, []
    for name, mapping, macro, dx in parts:
        for pin, info in macro["pins"].items():
            target = pin if pin in POWER else mapping[pin]
            ports = [shift(p, dx) for p in info["ports"]]
            if target is None:
                for port in ports:
                    obs.extend(port)
                continue
            entry = pins.setdefault(target, {"head": info["head"], "ports": []})
            entry["ports"].extend(ports)
        obs.extend(shift(macro["obs"], dx))
    want = set(cell["inputs"]) | set(cell["outputs"]) | set(POWER)
    if set(pins) != want:
        raise AbstractError("layout pins %s differ from the cell's pins %s" % (sorted(pins), sorted(want)))
    for power in ("VPWR", "VGND"):
        stretched = rails(pins[power]["ports"], parts[0][2]["width"], width) if (len(parts) > 1 or widen_sites) else []
        if stretched:
            pins[power]["ports"].append(stretched)
    lines = ["MACRO %s" % cell["name"], "  CLASS CORE ;", "  FOREIGN %s ;" % cell["name"], "  ORIGIN 0.000 0.000 ;",
             "  SIZE %.3f BY %.3f ;" % (width, height), "  SYMMETRY X Y R90 ;", "  SITE unithd ;"]
    order = cell["inputs"] + list(cell["outputs"]) + list(POWER)
    for pin in order:
        info = pins[pin]
        head = [l for l in info["head"] if not re.match(r"\s*ANTENNA", l)]
        if pin in cell["inputs"]:
            head = [l for l in head if "DIRECTION" not in l] + ["    DIRECTION INPUT ;"]
        elif pin in cell["outputs"]:
            head = [l for l in head if "DIRECTION" not in l] + ["    DIRECTION OUTPUT ;"]
        lines.append("  PIN %s" % pin)
        lines.extend(head)
        for port in info["ports"]:
            lines.append("    PORT")
            lines.extend(port)
            lines.append("    END")
        lines.append("  END %s" % pin)
    if obs:
        lines.append("  OBS")
        lines.extend(obs)
        lines.append("  END")
    lines.append("END %s" % cell["name"])
    return "\n".join(lines) + "\n", width, height


def layout_sources(raw, cell, lef_text):
    if raw.get("layoutFrom"):
        out = []
        for item in raw["layoutFrom"]:
            name = item["cell"] if item["cell"].startswith(PREFIX) else PREFIX + item["cell"]
            out.append((name, dict(item.get("pins") or {})))
        return out
    ref = raw["compareTo"]
    macro = parse_macro(macro_text(lef_text, ref))
    signal = sorted(p for p in macro["pins"] if p not in POWER)
    if signal != sorted(cell["inputs"] + list(cell["outputs"])):
        raise AbstractError("pins differ from %s (%s); give layoutFrom" % (ref, ", ".join(signal)))
    return [(ref, {p: p for p in signal})]


# --------------------------------------------------------------------------------------------- main
def build(raw, cell, ws, k, lef_text, pdk_text):
    lib = os.path.join(ws, "cells", "r%d" % k, "lib")
    sized = sized_netlist(cell, os.path.join(ws, "cells", "r%d" % k, "work", cell["name"]))
    sp = os.path.join(lib, cell["name"] + ".sp")
    with open(sp, "w") as handle:
        handle.write(fx.emit_source(sized, cell, "abstract cell (no layout): netlist for HimaHarness pre-layout modelling"))
    sources = layout_sources(raw, cell, lef_text)
    w_cell = sum(d["w"] for d in sized["devices"])
    w_src = sum(foundry_width(pdk_text, name) for name, _ in sources)
    sites_src = sum(round(parse_macro(macro_text(lef_text, n))["width"] / SITE_W) for n, _ in sources)
    widen = max(0, int(math.ceil(sites_src * w_cell / w_src - 1e-6)) - sites_src) if w_src > 0 else 0
    macro, width, height = compose(cell, sources, lef_text, widen)
    lef = os.path.join(lib, cell["name"] + ".lef")
    with open(lef, "w") as handle:
        handle.write(macro)
    return {"macro": macro, "width": width, "height": height, "devices": len(sized["devices"]),
            "deviceWidthUm": round(w_cell, 3), "sourceWidthUm": round(w_src, 3), "sources": [n for n, _ in sources],
            "files": {"sp": sp, "lef": lef}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("spec")
    parser.add_argument("round", type=int)
    parser.add_argument("workspace")
    parser.add_argument("--platform-lef", help="sky130_fd_sc_hd merged LEF (default: <orfsRoot>/flow/" + PLATFORM_LEF + " from state/inputs.json)")
    parser.add_argument("--pdk-spice", default=PDK_SPICE)
    parser.add_argument("--jobs", type=int, default=8)
    parser.add_argument("--out")
    args = parser.parse_args(argv)
    ws, k = os.path.abspath(args.workspace), args.round
    with open(args.spec) as handle:
        doc = json.load(handle)
    cells, errors, _jobs = fx.parse_spec(doc)
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 2
    raw_by_name = {raw["name"]: raw for raw in doc["cells"]}
    missing = [c["name"] for c in cells if not raw_by_name[c["name"]].get("compareTo")]
    if missing:
        print("cells need compareTo (the nearest foundry cell): %s" % ", ".join(missing), file=sys.stderr)
        return 2
    lef_path = args.platform_lef
    if not lef_path:
        with open(os.path.join(ws, "state", "inputs.json")) as handle:
            lef_path = os.path.join(json.load(handle)["orfsRoot"], "flow", PLATFORM_LEF)
    with open(lef_path) as handle:
        lef_text = handle.read()
    with open(args.pdk_spice) as handle:
        pdk_text = handle.read()
    os.makedirs(os.path.join(ws, "cells", "r%d" % k, "lib"), exist_ok=True)
    results = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.jobs) as pool:
        futures = {pool.submit(build, raw_by_name[c["name"]], c, ws, k, lef_text, pdk_text): c for c in cells}
        for future in concurrent.futures.as_completed(futures):
            cell = futures[future]
            try:
                results[cell["name"]] = future.result()
            except (AbstractError, fx.SpecError, subprocess.TimeoutExpired, OSError) as error:
                results[cell["name"]] = {"error": str(error)}
    entries, rows, macros = [], [], []
    header = lef_text[:re.search(r"(?m)^MACRO\s", lef_text).start()]
    for cell in cells:
        raw, res = raw_by_name[cell["name"]], results[cell["name"]]
        functions = "; ".join("%s=%s" % kv for kv in cell["outputs"].items())
        if "error" in res:
            rows.append("| %s | %s | %s | failed | | %s |" % (cell["name"], functions, raw["compareTo"], res["error"]))
            continue
        rows.append("| %s | %s | %s | abstract | %.2f x %.2f (%d devices, %.2f um W vs %.2f in %s) | %s |" % (
            cell["name"], functions, raw["compareTo"], res["width"], res["height"], res["devices"],
            res["deviceWidthUm"], res["sourceWidthUm"], "+".join(s.replace(PREFIX, "") for s in res["sources"]),
            raw.get("notes", "")))
        macros.append(res["macro"].rstrip("\n"))
        files = {key: os.path.relpath(path, ws) for key, path in res["files"].items()}
        entry = {"name": cell["name"], "origin": "r%d" % k, "inputs": cell["inputs"], "outputs": list(cell["outputs"]),
                 "functions": dict(cell["outputs"]), "compareTo": raw["compareTo"], "layout": "abstract",
                 "files": files, "sha256": {key: sha(path) for key, path in res["files"].items()}}
        if raw.get("footprint"):
            entry["footprint"] = raw["footprint"]
        entries.append(entry)
    library_lef = os.path.join(ws, "cells", "r%d" % k, "library.lef")
    with open(library_lef, "w") as handle:
        handle.write(header.rstrip() + "\n\n" + "\n\n".join(macros) + "\n\nEND LIBRARY\n")
    with open(os.path.join(ws, "cells", "r%d" % k, "library.md"), "w") as handle:
        handle.write("| cell | function | competes with | layout | size (um) | note |\n| --- | --- | --- | --- | --- | --- |\n"
                     + "\n".join(rows) + "\n")
    library = {"lef": os.path.relpath(library_lef, ws), "cells": entries}
    text = json.dumps(library, indent=1)
    if args.out:
        with open(args.out, "w") as handle:
            handle.write(text)
    else:
        print(text)
    print("%d abstract of %d spec cells -> %s" % (len(entries), len(cells), library_lef), file=sys.stderr)
    return 0 if entries else 1


if __name__ == "__main__":
    sys.exit(main())
