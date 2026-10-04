#!/usr/bin/env python3
"""Cut a critical combinational window out of a mapped netlist for emap, and stitch it back.

Runs inside the EDA image (needs `yosys` on PATH, python3 stdlib). See README.md for the full recipe.

  window.py cut    --netlist SYNTH.v --lib BASE.lib [--lib CUSTOM.lib] --out-dir DIR
                   (--paths TOP_PATHS.txt [--paths ...] | --cells CELLS.txt)
                   [--top aes_cipher_top] [--max-paths 20] [--grow 1] [--max-cells 400]
  window.py stitch --dir DIR --mapped MAPPED.v --out STITCHED.v

cut
  Seeds: the instances named on the paths of an OpenSTA `report_checks` text (e.g. the baseline's
  top-paths.txt of the final routed design: `inst/pin (cell)` lines; instances the resizer created
  later are simply not found in the synthesized netlist and are ignored), or a plain list of
  instance names (--cells, one per line). Only combinational cells are kept: flops, latches,
  tie/fill/tap cells and cells with no Liberty function never enter a window, so every window is
  bounded by flops, ports and tie cells.
  Growth: --grow K adds K levels of combinational fan-in of the seed cells (the side inputs of the
  critical cones), which gives emap room to restructure; growth stops at --max-cells. Seeds are
  taken path by path (worst path first) until --max-cells is reached.
  Outputs in DIR: cut.v (the full netlist with the window moved into module `emap_win`, one
  instance), window.aig (+ window.map from yosys), window.names (port names for emap_window),
  window.arrivals (per-input arrival estimate in ns, AIGER input order: longest path from a flop or
  input port through the netlist with the same per-arc Liberty delays that liberty_to_genlib.py puts
  in the genlib, 0 at flop outputs and input ports), window.json (cells, ports, sizes, provenance).
stitch
  Writes wrapper.v (module `emap_win` with the original ports, instantiating the emap module
  `emap_win_core`), replaces the gold `emap_win` in cut.v, flattens and writes STITCHED.v. The
  flattened window instances are renamed `emapw_<name>` (no hierarchical dots). The rest of the
  netlist keeps its cells, instance names and net names (`opt_clean -purge` leaves no assigns);
  stitch checks that the cell counts outside the window are unchanged (stitch.json).
"""
import argparse
import json
import os
import re
import subprocess
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import liberty_to_genlib as l2g  # noqa: E402

YOSYS = os.environ.get("YOSYS", "yosys")
WIN = "emap_win"
CORE = "emap_win_core"


def run_yosys(script, log, cwd):
    with open(os.path.join(cwd, log), "w") as handle:
        proc = subprocess.run([YOSYS, "-q", "-l", log + ".full", "-p", script], cwd=cwd,
                              stdout=handle, stderr=subprocess.STDOUT, text=True)
    if proc.returncode != 0:
        tail = open(os.path.join(cwd, log + ".full"), errors="replace").read().splitlines()[-25:]
        raise SystemExit("window.py: yosys failed (%s):\n%s" % (log, "\n".join(tail)))


def lib_models(lib_paths, slew=0.1, load=0.005):
    """cell type -> {'comb': bool, 'outputs': [...], 'delay': {out: {pin: ns}}} from the Liberty files."""
    models = {}
    for path in lib_paths:
        root = l2g.parse_liberty(open(path, errors="replace").read())
        for library in root.find("library"):
            templates = {t.args[0] if t.args else "": t.attrs for t in library.find("lu_table_template")}
            for cell in library.find("cell"):
                name = cell.args[0]
                if name in models:
                    continue
                seq = any(cell.find(k) for k in ("ff", "latch", "ff_bank", "latch_bank", "statetable"))
                pins = cell.find("pin")
                ins = [p.args[0] for p in pins if p.attrs.get("direction") == "input"]
                outs = [p for p in pins if p.attrs.get("direction") == "output" and p.attrs.get("function")]
                tristate = any("three_state" in p.attrs for p in outs)
                comb = bool(ins) and bool(outs) and not seq and not tristate
                delay = {}
                if comb:
                    _, info = l2g.cell_lines(cell, name, templates, slew, load)
                    if isinstance(info, dict):
                        delay = info["delayNs"]
                models[name] = {"comb": comb, "outputs": [p.args[0] for p in outs], "delay": delay}
    return models


def seeds_from_paths(paths_files, max_paths):
    seeds = []
    for path in paths_files:
        text = open(path, errors="replace").read()
        blocks = re.split(r"(?m)^Startpoint: ", text)[1:][:max_paths]
        for block in blocks:
            for inst in re.findall(r"(?m)^\s*[-0-9.]+\s+[-0-9.]+\s+[\^v]\s+(\S+)/[A-Za-z0-9_]+\s+\(", block):
                seeds.append(inst)
            seeds.append(None)  # path separator
    return seeds


def cmd_cut(args):
    out = os.path.abspath(args.out_dir)
    os.makedirs(out, exist_ok=True)
    netlist = os.path.abspath(args.netlist)
    libs = [os.path.abspath(p) for p in args.lib]
    read_libs = "; ".join("read_liberty -lib %s" % p for p in libs)
    run_yosys("%s; read_verilog %s; hierarchy -top %s; flatten; write_json full.json" % (read_libs, netlist, args.top),
              "yosys_read.log", out)
    design = json.load(open(os.path.join(out, "full.json")))
    module = design["modules"][args.top]
    cells = module["cells"]
    models = lib_models(libs)

    driver, loads = {}, {}
    for name, cell in cells.items():
        dirs = cell.get("port_directions", {})
        for port, bits in cell["connections"].items():
            for bit in bits:
                if not isinstance(bit, int):
                    continue
                if dirs.get(port) == "output":
                    driver[bit] = (name, port)
                else:
                    loads.setdefault(bit, []).append((name, port))

    def comb(name):
        return name in cells and models.get(cells[name]["type"], {}).get("comb", False)

    # seeds
    if args.cells:
        seq = [line.strip().split()[0] for line in open(args.cells) if line.strip() and not line.startswith("#")]
        seq.append(None)
    else:
        seq = seeds_from_paths(args.paths, args.max_paths)
    selected, order, path_count, unknown = set(), [], 0, set()
    current = []
    for inst in seq:
        if inst is None:
            new = [c for c in current if c not in selected]
            if len(selected) + len(new) > args.max_cells:
                break
            for c in new:
                selected.add(c)
                order.append(c)
            if new:
                path_count += 1
            current = []
            continue
        name = inst if inst in cells else ("\\" + inst if "\\" + inst in cells else None)
        if name is None:
            unknown.add(inst)
        elif comb(name):
            current.append(name)
    seed_count = len(selected)
    if not selected:
        raise SystemExit("window.py: no combinational seed cell found in the netlist (check --paths/--cells)")

    # grow by fan-in levels
    frontier = list(order)
    for _ in range(args.grow):
        nxt = []
        for name in frontier:
            cell = cells[name]
            dirs = cell.get("port_directions", {})
            for port, bits in cell["connections"].items():
                if dirs.get(port) == "output":
                    continue
                for bit in bits:
                    if isinstance(bit, int) and bit in driver:
                        src = driver[bit][0]
                        if src not in selected and comb(src) and len(selected) < args.max_cells:
                            selected.add(src)
                            nxt.append(src)
        frontier = nxt

    # arrival estimate (longest path, Liberty arc delays at the genlib operating point)
    arrival_memo = {}

    def bit_arrival(bit, depth=0):
        if bit not in driver:
            return 0.0
        name, port = driver[bit]
        key = (name, port)
        if key in arrival_memo:
            return arrival_memo[key]
        if not comb(name) or depth > 400:
            arrival_memo[key] = 0.0
            return 0.0
        cell = cells[name]
        dirs = cell.get("port_directions", {})
        arcs = models[cell["type"]]["delay"].get(port, {})
        best = 0.0
        for pin, bits in cell["connections"].items():
            if dirs.get(pin) == "output":
                continue
            for b in bits:
                if isinstance(b, int):
                    best = max(best, bit_arrival(b, depth + 1) + arcs.get(pin, 0.1))
        arrival_memo[key] = best
        return best

    sys.setrecursionlimit(20000)
    sel_path = os.path.join(out, "window.sel")
    with open(sel_path, "w") as handle:
        for name in sorted(selected):
            handle.write("%s/%s\n" % (args.top, name.lstrip("\\")))
    run_yosys("%s; read_verilog %s; hierarchy -top %s; flatten; select -read %s; "
              "submod -name %s; select -clear; "
              "write_verilog -noattr -noexpr -nohex -nodec cut.v; write_json cut.json"
              % (read_libs, netlist, args.top, sel_path, WIN),
              "yosys_cut.log", out)
    cut = json.load(open(os.path.join(out, "cut.json")))
    top_cells = cut["modules"][args.top]["cells"]
    inst = [n for n, c in top_cells.items() if c["type"] == WIN]
    if len(inst) != 1:
        raise SystemExit("window.py: expected one %s instance after submod, found %d" % (WIN, len(inst)))
    win = cut["modules"][WIN]
    win_inst = inst[0]
    # AIGER of the gold window, with full Liberty logic models
    full_libs = "; ".join("read_liberty -ignore_miss_func %s" % p for p in libs)
    run_yosys("%s; read_verilog cut.v; hierarchy -top %s; flatten; opt_clean; techmap; aigmap; opt_clean; "
              "write_aiger -map window.map window.aig" % (full_libs, WIN), "yosys_aig.log", out)
    ins, outs = {}, {}
    for line in open(os.path.join(out, "window.map")):
        parts = line.split()
        if len(parts) >= 4 and parts[0] in ("input", "output"):
            (ins if parts[0] == "input" else outs)[int(parts[1])] = (parts[3], int(parts[2]))
    if sorted(ins) != list(range(len(ins))) or sorted(outs) != list(range(len(outs))):
        raise SystemExit("window.py: unexpected window.map numbering")
    with open(os.path.join(out, "window.names"), "w") as handle:
        for k in range(len(ins)):
            handle.write("i %d wi%d\n" % (k, k))
        for k in range(len(outs)):
            handle.write("o %d wo%d\n" % (k, k))
    # arrivals: window port bit -> top-level net bit through the instance connections
    inst_conn = top_cells[win_inst]["connections"]
    # map top-level (cut) bits to the original design bits through net names
    full_names = {}
    for net, info in module["netnames"].items():
        for i, bit in enumerate(info["bits"]):
            full_names[(net, i)] = bit
    cut_top = cut["modules"][args.top]
    cut_bit_name = {}
    for net, info in cut_top["netnames"].items():
        for i, bit in enumerate(info["bits"]):
            if isinstance(bit, int) and (bit not in cut_bit_name or not net.startswith("$")):
                cut_bit_name[bit] = (net, i)
    def port_arrival(port, bit):
        port_bits = inst_conn.get(port) or inst_conn.get(port.lstrip("\\"))
        if port_bits and bit < len(port_bits) and isinstance(port_bits[bit], int):
            name = cut_bit_name.get(port_bits[bit])
            if name and name in full_names:
                return bit_arrival(full_names[name])
        return 0.0

    arrivals = [port_arrival(*ins[k]) for k in range(len(ins))]
    # the same model on the original window: worst output arrival (comparable to emap's "delay")
    gold_delay = max([port_arrival(*outs[k]) for k in range(len(outs))] or [0.0])
    with open(os.path.join(out, "window.arrivals"), "w") as handle:
        handle.write("# estimated arrival (ns) per AIGER input, Liberty arcs at slew 0.1 ns / load 0.005 pF\n")
        handle.write("".join("%.4f\n" % a for a in arrivals))
    ports = {name: {"direction": p["direction"], "width": len(p["bits"])} for name, p in win["ports"].items()}
    types = Counter(c["type"] for c in win["cells"].values())
    summary = {
        "schema": "hima-emap-window/1", "netlist": netlist, "top": args.top, "libs": libs, "instance": win_inst,
        "seedSource": args.cells or args.paths, "pathsUsed": path_count, "seedCells": seed_count,
        "grow": args.grow, "maxCells": args.max_cells, "windowCells": len(win["cells"]),
        "inputs": len(ins), "outputs": len(outs), "ports": ports, "cellTypes": dict(types),
        "unknownSeedInstances": sorted(unknown)[:50], "maxInputArrivalNs": max(arrivals or [0.0]),
        "goldModelDelayNs": round(gold_delay, 4),
        "aigInputs": [ins[k] for k in range(len(ins))], "aigOutputs": [outs[k] for k in range(len(outs))],
    }
    json.dump(summary, open(os.path.join(out, "window.json"), "w"), indent=1)
    print("window.py cut: %d seed cells from %d path(s), %d cells after grow=%d, %d in / %d out, "
          "model delay of the original window %.3f ns -> %s" % (
              seed_count, path_count, len(win["cells"]), args.grow, len(ins), len(outs), gold_delay, out))


KEYWORDS = {"module", "wire", "input", "output", "inout", "reg", "assign", "endmodule", "supply0", "supply1"}


def instance_counts(text):
    """Instance count per master of a structural Verilog netlist written by Yosys."""
    found = re.findall(r"(?m)^\s*([A-Za-z_][A-Za-z0-9_$]*)\s+(?:\\\S+|[A-Za-z_][A-Za-z0-9_$]*)\s*\(", text)
    return Counter(name for name in found if name not in KEYWORDS)


def vname(name):
    if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_$]*", name):
        return name
    return "\\" + name + " "


def cmd_stitch(args):
    d = os.path.abspath(args.dir)
    win = json.load(open(os.path.join(d, "window.json")))
    mapped = os.path.abspath(args.mapped)
    core_text = open(mapped).read()
    m = re.search(r"(?m)^module\s+(\S+)\s*\(", core_text)
    if not m or m.group(1) != CORE:
        raise SystemExit("window.py: the mapped module must be named %s (emap_window --module %s)" % (CORE, CORE))
    lines = ["// emap window wrapper: original window ports -> emap-mapped core", "module %s (" % WIN]
    port_names = list(win["ports"])
    lines.append("  " + ", ".join(vname(p) for p in port_names) + ");")
    for p in port_names:
        info = win["ports"][p]
        rng = "" if info["width"] == 1 else "[%d:0] " % (info["width"] - 1)
        lines.append("  %s %s%s;" % (info["direction"], rng, vname(p)))

    def ref(port, bit):
        if win["ports"][port]["width"] == 1:
            return vname(port)
        return "%s[%d]" % (vname(port), bit)

    conns = [".wi%d(%s)" % (k, ref(p, b)) for k, (p, b) in enumerate(win["aigInputs"])]
    conns += [".wo%d(%s)" % (k, ref(p, b)) for k, (p, b) in enumerate(win["aigOutputs"])]
    lines.append("  %s core (%s);" % (CORE, ", ".join(conns)))
    lines.append("endmodule")
    open(os.path.join(d, "wrapper.v"), "w").write("\n".join(lines) + "\n")
    libs = win["libs"]
    read_libs = "; ".join("read_liberty -lib %s" % p for p in libs)
    raw = os.path.join(d, "stitched_raw.v")
    run_yosys("%s; read_verilog cut.v; read_verilog -overwrite wrapper.v; read_verilog %s; hierarchy -top %s; "
              "flatten; opt_clean -purge; write_verilog -noattr -noexpr -nohex -nodec %s"
              % (read_libs, mapped, win["top"], raw), "yosys_stitch.log", d)
    text = open(raw).read()
    inst = win["instance"]
    text = re.sub(r"\\%s\.(core\.)?([^\s]+) " % re.escape(inst),
                  lambda mm: "emapw_" + re.sub(r"[^A-Za-z0-9_]", "_", mm.group(2)) + " ", text)
    if (inst + ".") in text:
        raise SystemExit("window.py: hierarchical window names remain after renaming; see %s" % raw)
    open(os.path.abspath(args.out), "w").write(text)
    # sanity: cells outside the window are unchanged
    orig = instance_counts(open(win["netlist"]).read())
    new = instance_counts(text)
    mapped_cells = Counter(re.findall(r"(?m)^\s*(\S+)\s+g\d+\s*\(", core_text))
    expected = orig - Counter(win["cellTypes"]) + mapped_cells
    diff = {k: new.get(k, 0) - expected.get(k, 0) for k in set(new) | set(expected) if new.get(k, 0) != expected.get(k, 0)}
    report = {"schema": "hima-emap-stitch/1", "out": os.path.abspath(args.out), "windowCellsRemoved": sum(win["cellTypes"].values()),
              "mappedCellsAdded": sum(mapped_cells.values()), "cellsBefore": sum(orig.values()),
              "cellsAfter": sum(new.values()), "unexpectedCountDiff": diff}
    json.dump(report, open(os.path.join(d, "stitch.json"), "w"), indent=1)
    print("window.py stitch: %d -> %d cells (window %d -> %d), count check %s -> %s" % (
        report["cellsBefore"], report["cellsAfter"], report["windowCellsRemoved"], report["mappedCellsAdded"],
        "OK" if not diff else "MISMATCH %s" % diff, args.out))
    if diff:
        return 1
    return 0


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("cut")
    c.add_argument("--netlist", required=True)
    c.add_argument("--lib", action="append", required=True)
    c.add_argument("--out-dir", required=True)
    c.add_argument("--top", default="aes_cipher_top")
    c.add_argument("--paths", action="append", default=[])
    c.add_argument("--cells")
    c.add_argument("--max-paths", type=int, default=20)
    c.add_argument("--grow", type=int, default=1)
    c.add_argument("--max-cells", type=int, default=400)
    s = sub.add_parser("stitch")
    s.add_argument("--dir", required=True)
    s.add_argument("--mapped", required=True)
    s.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    if args.cmd == "cut":
        if not args.paths and not args.cells:
            ap.error("cut needs --paths or --cells")
        return cmd_cut(args) or 0
    return cmd_stitch(args)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
