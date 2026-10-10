"""qualib: Qualib library analysis and cell screen (mock)."""
import argparse
import json
import sys
from pathlib import Path

from . import libraries, model
from .common import Log, ToolError, banner, now_iso, read_json, run_main, version_line, write_json, write_text

HELP = """\
usage: qualib <command> [options]

Qualib analyses standard-cell libraries against a design's critical paths and screens new cells
before they enter a design flow.

commands:
  analyze   library coverage, drive range, rise/fall balance and gaps per cell family; with
            --timing, ranked against the design's critical-path stage breakdown (about 10 s)
  screen    screen AndesCell cells: area, input capacitance, leakage, DRC, LVS, pin access,
            Liberty/LEF consistency (about 10 s)
  list      list the cells of a library family (fast)
  -version  print the version and exit

analyze: qualib analyze --lib std9t_svt [--extra-lib DIR ...] [--timing timing_summary.json] --out DIR
screen:  qualib screen --cells ANDESCELL_DIR [--out DIR] [--json]
list:    qualib list [--lib std9t_svt] [--family XNOR3]

Screen limits (relative to the stock cell of the same family and drive): area <= 1.35x,
input capacitance <= 1.30x, leakage <= 2.5x; DRC 0, LVS match, every pin accessible.
"""

LIMITS = dict(area=1.35, cap=1.30, leakage=2.5)


def cmd_list(rest):
    p = argparse.ArgumentParser(prog="qualib list")
    p.add_argument("--lib", default=model.STOCK_LIBRARY)
    p.add_argument("--family")
    a = p.parse_args(rest)
    if a.lib != model.STOCK_LIBRARY:
        raise ToolError("library %r is not installed (installed: %s)" % (a.lib, model.STOCK_LIBRARY))
    fam = model.canonical_family(a.family) if a.family else None
    if a.family and fam is None:
        raise ToolError("unknown family %r" % a.family)
    print("%-12s %-6s %5s %9s %9s %9s %9s %8s" % ("cell", "family", "drive", "area um2", "cap fF", "leak nW", "rise ps", "fall ps"))
    for c in libraries.stock_cells():
        if fam and c["family"] != fam:
            continue
        print("%-12s %-6s %5d %9.3f %9.3f %9.2f %9.1f %8.1f" % (c["name"], c["family"], c["drive"], c["areaUm2"], c["inputCapFf"], c["leakageNw"], c["riseFo4Ps"], c["fallFo4Ps"]))


def cmd_analyze(rest):
    p = argparse.ArgumentParser(prog="qualib analyze")
    p.add_argument("--lib", default=model.STOCK_LIBRARY)
    p.add_argument("--extra-lib", action="append", default=[])
    p.add_argument("--timing", help="a HimaTime timing_summary.json of the design")
    p.add_argument("--out", required=True)
    p.add_argument("--quiet", action="store_true")
    a = p.parse_args(rest)
    if a.lib != model.STOCK_LIBRARY:
        raise ToolError("library %r is not installed (installed: %s)" % (a.lib, model.STOCK_LIBRARY))
    extra = [libraries.load_extra(d) for d in a.extra_lib]
    timing = read_json(a.timing, "HimaTime timing summary") if a.timing else None
    if timing is not None and timing.get("schema") != "ctu-himatime-timing/1":
        raise ToolError("%s is not a HimaTime timing_summary.json" % a.timing)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    if not a.quiet:
        banner("qualib")
    log = Log("QL", out / "qualib.log", quiet=a.quiet)
    log.phase("LIB", "Reading %s%s" % (model.STOCK_LIBRARY, "".join(" + " + l["name"] for l in extra)), 3, 2)
    log.phase("ARC", "Analysing %d cells: drive range, rise/fall balance, FO4 delay, input capacitance, leakage" % len(libraries.stock_cells()), 4, 4)
    generated = {c["family"]: c["name"] for l in extra for c in l["cells"]}
    crit = {}
    if timing is not None:
        for r in timing.get("stageBreakdown") or []:
            crit[r["family"]] = r
        log.phase("CP", "Matching the library to the critical-path stage breakdown (%d paths)" % len(timing.get("paths") or []), 2, 2)
    rows = []
    for fam, info in model.FAMILIES.items():
        cells = [c for c in libraries.stock_cells() if c["family"] == fam]
        s = libraries.STOCK[fam]
        cp = crit.get(fam)
        headroom = round(100 * info["speedup"])
        rows.append(dict(family=fam, describe=info["describe"], cells=[c["name"] for c in cells], drives=[c["drive"] for c in cells],
                         fo4DelayPs=cells[0]["fo4DelayPs"], riseFallRatio=s["rf"], inputCapFf=cells[0]["inputCapFf"],
                         leakageNw=cells[0]["leakageNw"], gap=s["gap"], customHeadroomPct=headroom,
                         generatedCell=generated.get(fam),
                         criticalPath=None if cp is None else dict(sharePct=cp["sharePct"], stages=cp["stages"], onPaths=cp["onPaths"],
                                                                     worstPathSharePct=cp["worstPathSharePct"], estRecoveryNs=cp["estRecoveryNs"])))
    if crit:
        rows.sort(key=lambda r: (-(r["criticalPath"] or {}).get("estRecoveryNs", -1), r["family"]))
    result = dict(schema="ctu-qualib-analysis/1", tool=version_line("qualib"), library=model.STOCK_LIBRARY, corner=model.CORNER,
                  extraLibraries=[l["name"] for l in extra], timing=a.timing, families=rows, analysedAt=now_iso(),
                  note="MOCK EDA (demo Site eda_cluster_ctu_01): model library facts, not a foundry library.")
    write_json(out / "library_analysis.json", result)
    text = ["Qualib library analysis: %s (%s)%s" % (model.STOCK_LIBRARY, model.CORNER, " + " + ", ".join(result["extraLibraries"]) if extra else ""), ""]
    if crit:
        text.append("Ranked by the design's critical-path need (HimaTime est. recovery), then the library's gap per family.")
        text.append("")
    text.append("  %-6s %-14s %8s %6s %8s %8s %9s %10s  %s" % ("family", "drives", "FO4 ps", "r/f", "share%", "est.rec", "headroom", "generated", "library gap"))
    text.append("  " + "-" * 120)
    for r in rows:
        cp = r["criticalPath"] or {}
        text.append("  %-6s %-14s %8.1f %6.2f %8s %8s %8s%% %10s  %s" % (
            r["family"], ",".join("X%d" % d for d in sorted(set(r["drives"]))), r["fo4DelayPs"], r["riseFallRatio"],
            "%.2f" % cp["sharePct"] if cp else "-", "%.3f" % cp["estRecoveryNs"] if cp else "-", "-%d" % r["customHeadroomPct"],
            "yes" if r["generatedCell"] else "no", r["gap"]))
    text.append("")
    write_text(out / "library_analysis.rpt", "\n".join(text))
    log("RPT", "wrote library_analysis.json and library_analysis.rpt in %s (%.1f s)" % (out, log.elapsed()))
    log.close()


def screen_cell(cell, signoff_dir):
    stock = libraries.stock_cell(cell["family"], cell["drive"])
    ratios = dict(area=round(cell["areaUm2"] / stock["areaUm2"], 3), cap=round(cell["inputCapFf"] / stock["inputCapFf"], 3),
                  leakage=round(cell["leakageNw"] / stock["leakageNw"], 3))
    drc = (signoff_dir / ("%s.drc.rpt" % cell["name"]))
    lvs = (signoff_dir / ("%s.lvs.rpt" % cell["name"]))
    checks = dict(
        drcClean=drc.is_file() and " 0 violations" in drc.read_text(),
        lvsMatch=lvs.is_file() and "MATCH" in lvs.read_text(),
        pinAccess=True, libertyLefConsistent=True,
        areaWithinLimit=ratios["area"] <= LIMITS["area"],
        inputCapWithinLimit=ratios["cap"] <= LIMITS["cap"],
        leakageWithinLimit=ratios["leakage"] <= LIMITS["leakage"])
    reasons = []
    if not checks["drcClean"]:
        reasons.append("DRC report missing or not clean")
    if not checks["lvsMatch"]:
        reasons.append("LVS report missing or not matched")
    if not checks["areaWithinLimit"]:
        reasons.append("area %.2fx stock > %.2fx" % (ratios["area"], LIMITS["area"]))
    if not checks["inputCapWithinLimit"]:
        reasons.append("input cap %.2fx stock > %.2fx" % (ratios["cap"], LIMITS["cap"]))
    if not checks["leakageWithinLimit"]:
        reasons.append("leakage %.2fx stock > %.2fx" % (ratios["leakage"], LIMITS["leakage"]))
    return dict(name=cell["name"], family=cell["family"], drive=cell["drive"], stockCell=stock["name"], ratios=ratios,
                fo4DelayPs=cell["fo4DelayPs"], stockFo4DelayPs=stock["fo4DelayPs"], checks=checks,
                status="PASS" if not reasons else "FAIL", reasons=reasons)


def screen_result(lib):
    """What `qualib screen` decides, computed without pacing (deterministic)."""
    rows = [screen_cell(cell, Path(lib["_dir"]) / "signoff") for cell in lib["cells"]]
    return dict(schema="ctu-qualib-screen/1", tool=version_line("qualib"), library=lib["name"], round=lib.get("round"),
                limits=LIMITS, cells=rows, passed=[r["name"] for r in rows if r["status"] == "PASS"],
                failed=[r["name"] for r in rows if r["status"] != "PASS"], screenedAt=now_iso(),
                note="MOCK EDA (demo Site eda_cluster_ctu_01)")


def cmd_screen(rest):
    p = argparse.ArgumentParser(prog="qualib screen")
    p.add_argument("--cells", required=True, help="an AndesCell output directory")
    p.add_argument("--out", help="write screen.json, cell_screen.rpt and screen.log here")
    p.add_argument("--json", action="store_true", help="print the result as JSON (fast without --out)")
    p.add_argument("--quiet", action="store_true")
    a = p.parse_args(rest)
    if not a.out and not a.json:
        raise ToolError("give --out DIR (reports) or --json (result to stdout)")
    lib = libraries.load_extra(a.cells)
    result = screen_result(lib)
    rows, passed = result["cells"], result["passed"]
    if a.out:
        out = Path(a.out)
        out.mkdir(parents=True, exist_ok=True)
        quiet = a.quiet or a.json
        if not quiet:
            banner("qualib")
        log = Log("QL", out / "screen.log", quiet=quiet)
        log("SCR", "screening %d cell(s) of %s (limits: area <= %.2fx, input cap <= %.2fx, leakage <= %.2fx)"
            % (len(lib["cells"]), lib["name"], LIMITS["area"], LIMITS["cap"], LIMITS["leakage"]))
        log.phase("SCR", "Liberty/LEF consistency and pin access", 3, 2)
        for row in rows:
            log.phase("SCR", "%s" % row["name"], 0.8, 1)
            log("SCR", "  %-22s %s%s" % (row["name"], row["status"], "  (" + "; ".join(row["reasons"]) + ")" if row["reasons"] else ""))
        write_json(out / "screen.json", result)
        table = ["Qualib cell screen: %s (round %s)" % (lib["name"], lib.get("round")), "",
                 "  %-22s %-6s %-9s %6s %6s %6s %4s %4s %6s  %s" % ("cell", "family", "vs stock", "area", "cap", "leak", "DRC", "LVS", "result", "reason"),
                 "  " + "-" * 100]
        for r in rows:
            table.append("  %-22s %-6s %-9s %5.2fx %5.2fx %5.2fx %4s %4s %6s  %s" % (
                r["name"], r["family"], r["stockCell"], r["ratios"]["area"], r["ratios"]["cap"], r["ratios"]["leakage"],
                "0" if r["checks"]["drcClean"] else "ERR", "ok" if r["checks"]["lvsMatch"] else "ERR", r["status"], "; ".join(r["reasons"])))
        table += ["", "%d of %d cell(s) pass the screen." % (len(passed), len(rows)), ""]
        write_text(out / "cell_screen.rpt", "\n".join(table))
        log("SCR", "%d of %d cell(s) PASS; report %s (%.1f s)" % (len(passed), len(rows), out / "cell_screen.rpt", log.elapsed()))
        log.close()
    if a.json:
        print(json.dumps(result, indent=2, sort_keys=True))


def handler(argv):
    if not argv or argv[0] in ("-h", "-help", "--help", "help"):
        print(HELP)
        return 0
    commands = {"analyze": cmd_analyze, "screen": cmd_screen, "list": cmd_list}
    if argv[0] not in commands:
        raise ToolError("unknown command %r (try: qualib -help)" % argv[0])
    commands[argv[0]](argv[1:])
    return 0


def main(argv):
    return run_main("qualib", handler, argv)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
