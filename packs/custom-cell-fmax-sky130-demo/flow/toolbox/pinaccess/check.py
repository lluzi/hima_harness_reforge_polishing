#!/usr/bin/env python3
"""Per-cell pin-access check with OpenROAD's detailed router (the analysis behind DRT-0073).

For every requested LEF macro it places copies of the cell in a tiny design (platform rows and
tracks; orientations N, FN in N rows and FS, S in FS rows; at an even and an odd site), puts every
signal pin on its own net to an IO pin, runs `pin_access` (what ORFS runs before global routing)
and reports how many access points each pin has. A cell is ok when every signal pin of every copy
has at least one access point.

    python3 check.py --tech-lef T.tlef [--platform-lef SC.lef] --lef A.lef [--lef B.lef ...]
                     [--cells X,Y | --cells-file F] [--liberty L.lib] [--tracks make_tracks.tcl]
                     --out result.json [--jobs 8] [--group N] [--work DIR]

Exit 0 when the check ran (whatever the cells' verdicts), 2 on usage errors, 1 on tool errors (a
cell whose OpenROAD run failed for a reason other than missing access points). See README.md.
Needs python3 (stdlib) and `openroad` on PATH; runs in the IIC-OSIC-TOOLS image.
"""
import argparse
import concurrent.futures
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
DRIVER = os.path.join(HERE, "pa_openroad.py")
POWER_USES = {"POWER", "GROUND"}
POWER_NAMES = {"VPWR", "VGND", "VPB", "VNB", "VDD", "VSS", "GND"}
NO_ACCESS_RE = re.compile(r"DRT-0073\]\s+No access point for (\S+)/(\S+) \(")
ROW_OF = {"N": "N", "FN": "N", "FS": "FS", "S": "FS"}    # orientation -> row type it is legal in
DEFAULT_ORIENTS = ("N", "FS", "FN", "S")
DEFAULT_NEIGHBORS = "sky130_fd_sc_hd__nand2_1,sky130_fd_sc_hd__a21oi_1"


# ------------------------------------------------------------------------------------------------
# LEF / DEF text (pure)
# ------------------------------------------------------------------------------------------------
def _rects(block):
    out, layer = [], None
    for ln in block.splitlines():
        m = re.search(r"\bLAYER\s+(\S+)\s*;", ln)
        if m:
            layer = m.group(1)
        m = re.search(r"\bRECT\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)", ln)
        if m and layer:
            out.append((layer, tuple(float(v) for v in m.groups())))
    return out


def parse_lef_macros(text):
    """{name: {"size": (w, h), "site": s, "pins": {pin: {"use": U, "direction": D}},
    "rects": [(layer, (x1, y1, x2, y2), pin or None)]}} from LEF text."""
    out = {}
    for m in re.finditer(r"(?ms)^\s*MACRO\s+(\S+)\s*$(.*?)^\s*END\s+\1\s*$", text):
        name, body = m.group(1), m.group(2)
        size = re.search(r"\bSIZE\s+([\d.]+)\s+BY\s+([\d.]+)", body)
        site = re.search(r"\bSITE\s+(\S+)\s*;", body)
        pins, rects = {}, []
        for p in re.finditer(r"(?ms)^\s*PIN\s+(\S+)\s*$(.*?)^\s*END\s+\1\s*$", body):
            use = re.search(r"\bUSE\s+(\w+)", p.group(2))
            d = re.search(r"\bDIRECTION\s+(\w+)", p.group(2))
            pins[p.group(1)] = {"use": use.group(1).upper() if use else "SIGNAL",
                                "direction": d.group(1).upper() if d else "INOUT"}
            rects += [(lay, r, p.group(1)) for lay, r in _rects(p.group(2))]
        obs = re.search(r"(?ms)^\s*OBS\s*$(.*?)^\s*END\s*$", body)
        if obs:
            rects += [(lay, r, None) for lay, r in _rects(obs.group(1))]
        out[name] = {"size": (float(size.group(1)), float(size.group(2))) if size else None,
                     "site": site.group(1) if site else None, "pins": pins, "rects": rects}
    return out


def signal_pins(macro):
    return [p for p, a in macro["pins"].items() if a["use"] not in POWER_USES and p.upper() not in POWER_NAMES]


def parse_spacing(tech_text):
    """{routing layer: minimum spacing um} from the tech LEF (first SPACING of each ROUTING layer)."""
    out = {}
    for m in re.finditer(r"(?ms)^\s*LAYER\s+(\S+)\s*$(.*?)^\s*END\s+\1\s*$", tech_text):
        if re.search(r"\bTYPE\s+ROUTING\b", m.group(2)):
            sp = re.search(r"^\s*SPACING\s+([\d.]+)\s*;", m.group(2), re.M)
            if sp:
                out[m.group(1)] = float(sp.group(1))
    return out


def edge_violations(macro, spacing):
    """Rects of signal pins and OBS on routing layers that come closer than half the layer spacing
    to the left or right cell edge, i.e. that can touch or crowd an abutted cell's metal. Shapes of
    power pins and full-width shapes (rails) are exempt. sky130_fd_sc_hd: none in 440 core cells."""
    w = macro["size"][0] if macro.get("size") else None
    if w is None:
        return []
    out = []
    for layer, r, pin in macro.get("rects", []):
        if layer not in spacing or (pin and macro["pins"][pin]["use"] in POWER_USES):
            continue
        if r[0] <= 1e-6 and r[2] >= w - 1e-6:
            continue
        half = spacing[layer] / 2
        if r[0] < half - 1e-6 or r[2] > w - half + 1e-6:
            out.append((layer, r))
    return out


def parse_site(text, site):
    """(width, height) in um of SITE `site` in LEF text, or None."""
    m = re.search(r"(?ms)^\s*SITE\s+%s\s*$(.*?)^\s*END\s+%s\s*$" % (re.escape(site), re.escape(site)), text)
    if not m:
        return None
    s = re.search(r"\bSIZE\s+([\d.]+)\s+BY\s+([\d.]+)", m.group(1))
    return (float(s.group(1)), float(s.group(2))) if s else None


def inst_name(cell, orient, pos):
    return "%s__%s%d" % (cell, orient, pos)


def split_inst(name):
    """inst_name() -> (cell, orient, pos) or None."""
    m = re.match(r"^(.*)__(N|FN|FS|S)(\d)$", name)
    return (m.group(1), m.group(2), int(m.group(3))) if m else None


def copy_rows(orients=DEFAULT_ORIENTS, context=True):
    """Rows of one cell's test placement: [(row type, [(orient, copy index) | ("nbr", side)])].
    Isolated copies (index 0, one per requested orientation, apart from everything) and, with
    context, two abutted rows: foundry | N | FN | N | foundry and foundry | FS | S | FS | foundry,
    so each copy touches a mirrored copy of itself on one side and a foundry cell on the other."""
    rows = []
    for rtype in ("N", "FS"):
        iso = [(o, 0) for o in orients if ROW_OF[o] == rtype]
        if iso:
            rows.append((rtype, iso, False))
    if context:
        rows.append(("N", [("nbr", 0), ("N", 1), ("FN", 2), ("N", 3), ("nbr", 1)], True))
        rows.append(("FS", [("nbr", 0), ("FS", 1), ("S", 2), ("FS", 3), ("nbr", 1)], True))
    return rows


def copies(rows):
    return ["%s%d" % (o, i) for _rt, items, _abut in rows for o, i in items if o != "nbr"]


def build_def(cells, macros, site, site_wh, skip=None, rows_plan=None, neighbors=(), gap_sites=3,
              margin_sites=4, io=True):
    """DEF text placing every cell as copy_rows() says, one cell after the other (the N/FS row
    alternation of the platform is kept: an N-type row of the plan lands on an even row). Isolated
    copies are gap_sites apart; abutted rows have no gaps, foundry `neighbors` at both ends (N or FS
    left, FN or S right). Every signal pin of every instance (neighbours too) is on its own net,
    except the cell pins in skip[cell] (left unconnected, so pin_access ignores them); with io=True
    each net also has an IO pin on the left/right die edge (met3, on the 0.34 + 0.68k um tracks)."""
    skip = skip or {}
    rows_plan = rows_plan if rows_plan is not None else copy_rows()
    sw, sh = (int(round(v * 1000)) for v in site_wh)
    sites = lambda m: -(-int(round(macros[m]["size"][0] * 1000)) // sw)
    placed, comps, nets = [], [], []        # placed: (row index, x site, master, inst, orient)
    r = 2                                   # two empty rows at the bottom
    width_sites = 0
    nbr_k = 0
    for c in cells:
        for rtype, items, abut in rows_plan:
            if (r % 2 == 0) != (rtype == "N"):
                r += 1
            x = margin_sites
            for o, i in items:
                if o == "nbr":
                    if not neighbors:
                        continue
                    m = neighbors[nbr_k % len(neighbors)]
                    nbr_k += 1
                    orient = rtype if i == 0 else ("FN" if rtype == "N" else "S")
                    placed.append((r, x, m, "nbr%d" % nbr_k, orient))
                    x += sites(m)
                else:
                    placed.append((r, x, c, inst_name(c, o, i), o))
                    x += sites(c) + (0 if abut else gap_sites)
            width_sites = max(width_sites, x + margin_sites)
            r += 1
    nrows = r + 2
    for row, x, m, n, o in placed:
        comps.append("- %s %s + PLACED ( %d %d ) %s ;" % (n, m, x * sw, row * sh, o))
        for p in signal_pins(macros[m]):
            if m in skip and p in skip[m]:
                continue
            nets.append((n, p))
    die_w = width_sites * sw
    pitch, off = 680, 340
    die_h = nrows * sh
    if io:
        need = off + ((len(nets) + 1) // 2 + 1) * pitch
        if need > die_h:
            nrows += -(-(need - die_h) // sh)
            die_h = nrows * sh
    rows = ["ROW ROW_%d %s 0 %d %s DO %d BY 1 STEP %d 0 ;" % (k, site, k * sh, "N" if k % 2 == 0 else "FS",
                                                             width_sites, sw) for k in range(nrows)]
    pins, net_lines = [], []
    for i, (inst, p) in enumerate(nets):
        net = "n%d" % i
        conn = "( %s %s )" % (inst, p)
        if io:
            y = off + (i // 2) * pitch
            x = 150 if i % 2 == 0 else die_w - 150
            pins.append("- io%d + NET %s + DIRECTION INOUT + USE SIGNAL\n  + LAYER met3 ( -150 -150 ) ( 150 150 )"
                        " + PLACED ( %d %d ) N ;" % (i, net, x, y))
            conn = "( PIN io%d ) " % i + conn
        net_lines.append("- %s %s ;" % (net, conn))
    lines = ["VERSION 5.8 ;", 'DIVIDERCHAR "/" ;', 'BUSBITCHARS "[]" ;', "DESIGN pinaccess ;",
             "UNITS DISTANCE MICRONS 1000 ;", "DIEAREA ( 0 0 ) ( %d %d ) ;" % (die_w, die_h)]
    lines += rows
    lines += ["COMPONENTS %d ;" % len(comps)] + comps + ["END COMPONENTS"]
    if pins:
        lines += ["PINS %d ;" % len(pins)] + pins + ["END PINS"]
    lines += ["NETS %d ;" % len(net_lines)] + net_lines + ["END NETS", "END DESIGN", ""]
    return "\n".join(lines)


def no_access_pairs(result, log_text):
    """{(cell, pin, copy)} named by DRT-0073 in a result or its log."""
    pairs = {tuple(x) for x in result.get("noAccess", [])} | set(NO_ACCESS_RE.findall(log_text or ""))
    out = set()
    for inst, pin in pairs:
        sp = split_inst(inst)
        if sp:
            out.add((sp[0], pin, "%s%d" % (sp[1], sp[2])))
    return out


def cell_verdict(cell, macros, result, failed, rows_plan, min_ap=1):
    """Verdict for one cell from a COMPLETED OpenROAD result (pin_access returned) plus the pins found
    without access in earlier runs (failed = {(pin, copy)}; those pins were left unconnected here).
    -> {ok, uniqueInstances, pins: {pin: {accessPoints, perInstance, byCopy}}, error?}
    accessPoints: access points of the pin summed over the cell's unique instances (the router's
    classes of copies with the same orientation and track offset; 0 for a pin DRT-0073 named, None
    when not counted); perInstance = accessPoints / uniqueInstances, must reach min_ap; byCopy:
    preferred access points of each placed copy (0 = named by DRT-0073, None = not analysed)."""
    insts = {cp: result.get("insts", {}).get(inst_name(cell, cp[:-1], int(cp[-1])), {}) for cp in copies(rows_plan)}
    classes = len({v["pinAccessIdx"] for v in insts.values() if v.get("pinAccessIdx", -1) >= 0}) or None
    pins, bad, weak = {}, [], []
    for p in signal_pins(macros[cell]):
        by = {}
        dead = any(fp == p for fp, _ in failed)
        for cp in copies(rows_plan):
            by[cp] = (0 if (p, cp) in failed else None) if dead else insts[cp].get("pins", {}).get(p)
        n = 0 if dead else result.get("accessPoints", {}).get("%s/%s" % (cell, p))
        per = round(n / classes, 2) if n is not None and classes else None
        pins[p] = {"accessPoints": n, "perInstance": per, "byCopy": by}
        if not n or any(x == 0 for x in by.values()) or None in by.values():
            bad.append(p)
        elif per is not None and per < min_ap:
            weak.append(p)
    out = {"ok": not bad and not weak, "uniqueInstances": classes, "pins": pins}
    errs = []
    if bad:
        errs.append("no access point: %s" % ",".join(sorted(bad)))
    if weak:
        errs.append("fewer than %s access points per instance: %s" % (min_ap, ",".join(sorted(weak))))
    if errs:
        out["error"] = "; ".join(errs)
    return out


# ------------------------------------------------------------------------------------------------
# Runner (impure)
# ------------------------------------------------------------------------------------------------
def run_group(idx, cells, ctx, skip=None):
    """One OpenROAD run over `cells` (pins in skip[cell] unconnected) -> (result dict, log text, seconds)."""
    d = os.path.join(ctx["work"], "r%04d" % idx)
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d)
    with open(os.path.join(d, "pa.def"), "w") as fh:
        fh.write(build_def(cells, ctx["macros"], ctx["site"], ctx["site_wh"], skip=skip, rows_plan=ctx["rows"],
                           neighbors=ctx["neighbors"], io=ctx["io"]))
    tcl = ["source %s" % ctx["tracks"]] if ctx["tracks"] else ["make_tracks"]
    tcl.append("set_routing_layers -signal %s" % ctx["layers"])
    job = {"cells": cells, "skip": {k: sorted(v) for k, v in (skip or {}).items()},
           "lefs": ctx["lefs"], "liberty": ctx["liberty"], "def": os.path.join(d, "pa.def"), "tcl": tcl,
           "pinAccessCmd": ctx["pa_cmd"], "result": os.path.join(d, "result.json"), "threads": 1}
    with open(os.path.join(d, "job.json"), "w") as fh:
        json.dump(job, fh, indent=1)
    log = os.path.join(d, "openroad.log")
    t0 = time.time()
    with open(log, "w") as fh:
        try:
            p = subprocess.run([ctx["openroad"], "-python", "-exit", "-no_splash", DRIVER, os.path.join(d, "job.json")],
                               cwd=d, stdout=fh, stderr=subprocess.STDOUT, timeout=ctx["timeout"])
            rc = p.returncode
        except subprocess.TimeoutExpired:
            rc = "timeout"
    secs = round(time.time() - t0, 2)
    log_text = "".join(ln for ln in open(log, errors="replace") if not ln.startswith("swig/python detected"))
    with open(log, "w") as fh:
        fh.write(log_text)
    try:
        result = json.load(open(job["result"]))
    except (OSError, ValueError):
        result = {"ok": False, "error": "openroad rc=%s, no result: %s" % (rc, log_text[-600:]), "insts": {}}
    return result, log_text, secs


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--tech-lef", required=True)
    ap.add_argument("--platform-lef", action="append", default=[],
                    help="platform cell LEF(s); read only when a requested cell is not in --lef")
    ap.add_argument("--lef", action="append", default=[], help="custom cell LEF (repeatable)")
    ap.add_argument("--cells", help="comma-separated macro names (default: every MACRO in --lef)")
    ap.add_argument("--cells-file", help="file with one macro name per line")
    ap.add_argument("--liberty", action="append", default=[], help="optional Liberty (repeatable)")
    ap.add_argument("--tracks", help="make_tracks Tcl (default: make_tracks from the tech LEF pitches)")
    ap.add_argument("--site", default="unithd")
    ap.add_argument("--layers", default="met1-met5", help="signal routing layers, as ORFS MIN-MAX_ROUTING_LAYER")
    ap.add_argument("--pin-access-args", default="", help="extra arguments for pin_access")
    ap.add_argument("--orients", default="N,FS",
                    help="orientations of the isolated copies (N, FN go in N rows, FS, S in FS rows)")
    ap.add_argument("--neighbors", default=DEFAULT_NEIGHBORS,
                    help="platform cells abutted at both ends of the context rows (from --platform-lef)")
    ap.add_argument("--no-context", action="store_true",
                    help="isolated copies only (no abutted rows with flipped copies and foundry neighbours)")
    ap.add_argument("--min-access-points", type=float, default=1,
                    help="a pin needs at least this many access points per unique instance (default 1 = "
                         "what the router needs; foundry sky130hd cells have >= 3)")
    ap.add_argument("--no-io", action="store_true", help="nets without IO pins")
    ap.add_argument("--no-edge-check", action="store_true",
                    help="do not fail cells whose metal comes within half the spacing of the left/right edge")
    ap.add_argument("--out", required=True, help="result JSON")
    ap.add_argument("--jobs", type=int, default=os.cpu_count() or 4)
    ap.add_argument("--group", type=int, default=0,
                    help="cells per OpenROAD run (default: spread over --jobs, at most 12)")
    ap.add_argument("--work", help="work directory (default: a temp dir, removed unless --keep)")
    ap.add_argument("--keep", action="store_true")
    ap.add_argument("--timeout", type=int, default=300, help="seconds per OpenROAD run")
    ap.add_argument("--openroad", default=shutil.which("openroad") or "openroad")
    a = ap.parse_args(argv)
    t0 = time.time()

    macros, owner = {}, {}
    for f in a.lef:
        for n, m in parse_lef_macros(open(f).read()).items():
            macros[n], owner[n] = m, f
    if a.cells:
        want = [x for x in a.cells.split(",") if x]
    elif a.cells_file:
        want = [x.strip() for x in open(a.cells_file) if x.strip() and not x.startswith("#")]
    else:
        want = sorted(macros)
    lefs = [a.tech_lef]
    neighbors = [] if a.no_context else [x for x in a.neighbors.split(",") if x]
    if any(c not in macros for c in want + neighbors):
        for f in a.platform_lef:
            for n, m in parse_lef_macros(open(f).read()).items():
                if n not in macros:
                    macros[n], owner[n] = m, f
            lefs.append(f)
    lefs += a.lef
    missing = [c for c in want + neighbors if c not in macros]
    if missing or not want:
        print("pinaccess: unknown cells: %s%s" % (",".join(missing) or "(none requested)",
              " (neighbours come from --platform-lef; or pass --no-context)" if set(missing) & set(neighbors) else ""),
              file=sys.stderr)
        return 2
    site_wh = parse_site(open(a.tech_lef).read(), a.site)
    for f in a.platform_lef:
        site_wh = site_wh or parse_site(open(f).read(), a.site)
    if not site_wh:
        print("pinaccess: SITE %s not found" % a.site, file=sys.stderr)
        return 2
    orients = tuple(x for x in a.orients.split(",") if x)
    if not orients or any(o not in ROW_OF for o in orients):
        print("pinaccess: --orients takes a comma list of %s" % ",".join(DEFAULT_ORIENTS), file=sys.stderr)
        return 2
    work = a.work or tempfile.mkdtemp(prefix="pinaccess.")
    os.makedirs(work, exist_ok=True)
    ctx = {"work": os.path.abspath(work), "macros": macros, "site": a.site, "site_wh": site_wh,
           "io": not a.no_io, "rows": copy_rows(orients, not a.no_context), "neighbors": neighbors, "tracks": os.path.abspath(a.tracks) if a.tracks else None, "layers": a.layers,
           "lefs": [os.path.abspath(x) for x in lefs], "liberty": [os.path.abspath(x) for x in a.liberty],
           "pa_cmd": ("pin_access " + a.pin_access_args).strip(), "timeout": a.timeout, "openroad": a.openroad}

    verdicts, runs, counter = {}, [], [0]

    def task(k, cells, failed):
        """failed: {cell: {(pin, copy)}} found so far; those pins are left unconnected."""
        skip = {c: {p for p, _ in failed.get(c, ())} for c in cells}
        result, log_text, secs = run_group(k, cells, ctx, skip)
        return cells, failed, result, log_text, secs

    # A DRT-0073 aborts pin_access for the whole run, after naming the first pin without access of
    # every failing instance. The run is repeated with the named pins unconnected (pin_access skips
    # them) until it completes; the completed run counts the access points of the other pins. A run
    # that fails without naming a new pin is split into single cells; a single cell that still fails
    # is a tool error.
    g = a.group or max(1, min(12, -(-len(want) // max(1, a.jobs))))
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, a.jobs)) as ex:
        def submit(cells, failed):
            counter[0] += 1
            return ex.submit(task, counter[0] - 1, cells, failed)
        pending = [submit(want[i:i + g], {}) for i in range(0, len(want), g)]
        while pending:
            done, rest = concurrent.futures.wait(pending, return_when=concurrent.futures.FIRST_COMPLETED)
            pending = list(rest)
            for f in done:
                cells, failed, result, log_text, secs = f.result()
                runs.append({"cells": len(cells), "seconds": secs, "ok": bool(result.get("ok")),
                             "pinsLeftOut": sum(len({p for p, _ in v}) for v in failed.values())})
                if result.get("ok"):
                    for c in cells:
                        verdicts[c] = cell_verdict(c, macros, result, failed.get(c, set()), ctx["rows"], a.min_access_points)
                    continue
                named = no_access_pairs(result, log_text)
                grown, new_any = {}, False
                for c in cells:
                    new = {(p, cp) for cc, p, cp in named if cc == c} - failed.get(c, set())
                    grown[c] = failed.get(c, set()) | new
                    new_any = new_any or bool(new)
                if new_any:
                    pending.append(submit(cells, grown))
                elif len(cells) > 1:
                    pending += [submit([c], {c: failed.get(c, set())}) for c in cells]
                elif "DRT-0085" in result.get("error", "") + log_text:
                    # every pin has access points, but no conflict-free combination exists in the cell
                    c = cells[0]
                    v = cell_verdict(c, macros, {"insts": {}}, failed.get(c, set()), ctx["rows"])
                    v["ok"] = False
                    v["error"] = "no valid access pattern (DRT-0085)" + (
                        "; " + v["error"] if "error" in v and failed.get(c) else "")
                    verdicts[c] = v
                else:
                    c = cells[0]
                    verdicts[c] = {"ok": None, "pins": {}, "error": "tool error: %s" % (
                        result.get("error", "")[-600:].strip() or log_text[-600:])}
    # Abutment: metal this close to the edge touches or crowds the neighbour's metal; the detailed
    # router cannot repair that (it is inside the cells), so such a cell is not routable either.
    if not a.no_edge_check:
        spacing = parse_spacing(open(a.tech_lef).read())
        for c in want:
            ev = edge_violations(macros[c], spacing)
            if ev:
                verdicts[c]["edgeViolations"] = [[lay] + list(r) for lay, r in ev]
                msg = "metal within half the spacing of the cell edge (%d rects, e.g. %s %s)" % (
                    len(ev), ev[0][0], list(ev[0][1]))
                if verdicts[c]["ok"] is not None:
                    verdicts[c]["ok"] = False
                verdicts[c]["error"] = "; ".join(x for x in (verdicts[c].get("error"), msg) if x)
    tool_errors = sorted(c for c, v in verdicts.items() if v["ok"] is None)
    for c in tool_errors:
        verdicts[c]["ok"] = False
    passed = sum(1 for v in verdicts.values() if v["ok"])
    out = {"schema": "pinaccess/1", "seconds": round(time.time() - t0, 1), "jobs": a.jobs,
           "openroadRuns": len(runs), "orients": list(orients), "context": not a.no_context, "neighbors": neighbors,
           "copies": copies(ctx["rows"]), "runs": runs, "pinAccessCmd": ctx["pa_cmd"], "layers": a.layers,
           "lefs": ctx["lefs"], "tracks": ctx["tracks"],
           "summary": {"cells": len(want), "ok": passed, "failed": len(want) - passed, "toolErrors": tool_errors},
           "cells": {c: verdicts[c] for c in want}}
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w") as fh:
        json.dump(out, fh, indent=1)
        fh.write("\n")
    print("pinaccess: %d/%d cells ok, %d tool errors, %d OpenROAD runs, %.1fs -> %s"
          % (passed, len(want), len(tool_errors), len(runs), out["seconds"], a.out))
    for c in want:
        if not verdicts[c]["ok"]:
            print("  FAIL %-28s %s" % (c, verdicts[c].get("error", "")))
    if not a.work and not a.keep:
        shutil.rmtree(work, ignore_errors=True)
    return 1 if tool_errors else 0


if __name__ == "__main__":
    sys.exit(main())
