"""himatime: HimaTime static timing analysis (mock). Loads a sapr design db and reports timing."""
import argparse
import sys
from pathlib import Path

from . import libraries, model
from .common import Log, ToolError, banner, now_iso, read_json, run_main, version_line, write_json, write_text

HELP = """\
usage: himatime <command> [options]

HimaTime static timing analysis of a routed design (a sapr output directory).

commands:
  load          load the routed design, update timing, write the timing reports (10-20 s)
  report        print timing of a loaded or routed design to stdout (fast)
  estimate      what-if: the timing if some cell families were AndesCell-class faster (fast)
  verify-cells  check AndesCell cells' timing arcs and their effect on the design (10-20 s)
  -version      print the version and exit

load:         himatime load --db SAPR_DIR --out DIR [--paths N]
                writes timing_summary.json, report_timing.rpt, stage_breakdown.rpt, report_qor.rpt
report:       himatime report --db SAPR_DIR [--paths N] [--stages] [--json]
estimate:     himatime estimate --db SAPR_DIR --families XNOR3,BUF[,...] [--speedup PCT] [--json]
verify-cells: himatime verify-cells --cells ANDESCELL_DIR --db SAPR_DIR --out DIR

The stage breakdown groups the cell delay of every stage on the worst paths by cell family (cell
type), with its share of the path delay and HimaTime's estimated slack recovery (ns, weighted by
path criticality) if that family were made AndesCell-class faster.
"""


def _db(path):
    d = Path(path)
    db = read_json(d / ("%s.hdb.json" % model.DESIGN), "design db (run sapr first)")
    if db.get("schema") != "ctu-design-db/1":
        raise ToolError("%s is not a sapr design db" % d)
    return d, db


def _new_cells(db):
    return {f: sorted(c)[-1] for f, c in (db.get("usable") or {}).items()}


def timing_summary(db, n_paths=20):
    speed = db.get("speed") or {}
    t = model.timing(speed)
    rows, extra = model.breakdown(speed)
    paths = []
    for p in sorted(model.PATHS, key=lambda q: model.slack_ps(q, speed))[:n_paths]:
        st = model.stages(p, speed, _new_cells(db))
        arrival = model.CLOCK_LATENCY_NS * 1000 + sum(s["cellDelayPs"] + s["netDelayPs"] for s in st)
        required = model.CLOCK_PERIOD_NS * 1000 + model.CLOCK_LATENCY_NS * 1000 - model.UNCERTAINTY_PS - model.SETUP_PS
        paths.append(dict(id=p["id"], group=p["group"], startpoint=p["start"] + "/CK", endpoint=p["end"] + "/D",
                          endpoints=p["n"], slackNs=round((required - arrival) / 1000.0, 4),
                          arrivalNs=round(arrival / 1000.0, 4), requiredNs=round(required / 1000.0, 4),
                          stages=st, cellDelayByFamilyPs={f: round(sum(s["cellDelayPs"] for s in st if s["family"] == f), 1) for f in p["mix"]}))
    return dict(schema="ctu-himatime-timing/1", tool=version_line("himatime"), design=model.DESIGN,
                clockPeriodNs=model.CLOCK_PERIOD_NS, corner=model.CORNER, wnsNs=t["wnsNs"], tnsNs=t["tnsNs"],
                fmaxMhz=t["fmaxMhz"], violatingEndpoints=t["violatingEndpoints"], worstPath=extra["worstPath"],
                generatedFamilies=sorted(speed), newCells=_new_cells(db), stageBreakdown=rows,
                netDelayPs=extra["netDelayPs"], netSharePct=extra["netSharePct"], paths=paths,
                note="MOCK EDA (demo Site eda_cluster_ctu_01): model timing, not signoff.")


def path_text(p):
    out = ["Startpoint: %s (rising edge-triggered flip-flop clocked by %s)" % (p["startpoint"].rsplit("/", 1)[0], model.CLOCK_NAME),
           "Endpoint: %s (rising edge-triggered flip-flop clocked by %s)" % (p["endpoint"].rsplit("/", 1)[0], model.CLOCK_NAME),
           "Path Group: %s" % model.CLOCK_NAME, "Path Type: max", "Path ID: %s (%s)" % (p["id"], p["group"]), "",
           "  %-46s %7s %7s %8s %8s" % ("Point", "Fanout", "Trans", "Incr", "Path"),
           "  " + "-" * 82,
           "  %-46s %7s %7s %8.4f %8.4f" % ("clock %s (rise edge)" % model.CLOCK_NAME, "", "", 0.0, 0.0),
           "  %-46s %7s %7s %8.4f %8.4f" % ("clock network delay (propagated)", "", "", model.CLOCK_LATENCY_NS, model.CLOCK_LATENCY_NS)]
    t = model.CLOCK_LATENCY_NS
    for i, s in enumerate(p["stages"]):
        if i == 0:
            out.append("  %-46s %7s %7.4f %8.4f %8.4f %s" % ("%s/CK (%s)" % (s["instance"], s["cell"]), "", 0.018, 0.0, t, "r"))
        incr = s["cellDelayPs"] / 1000.0
        t += incr
        out.append("  %-46s %7s %7.4f %8.4f %8.4f %s" % ("%s/%s (%s)" % (s["instance"], s["pin"], s["cell"]), "", s["transPs"] / 1000.0, incr, t, s["edge"]))
        net = s["netDelayPs"] / 1000.0
        t += net
        name = "n%s_%d" % (p["id"].lower(), i)
        out.append("  %-46s %7d %7s %8.4f %8.4f" % ("%s (net)" % name, s["fanout"], "", net, t))
    out += ["  %-46s %7s %7s %8s %8.4f" % ("data arrival time", "", "", "", p["arrivalNs"]), "",
            "  %-46s %7s %7s %8.4f %8.4f" % ("clock %s (rise edge)" % model.CLOCK_NAME, "", "", model.CLOCK_PERIOD_NS, model.CLOCK_PERIOD_NS),
            "  %-46s %7s %7s %8.4f %8.4f" % ("clock network delay (propagated)", "", "", model.CLOCK_LATENCY_NS, model.CLOCK_PERIOD_NS + model.CLOCK_LATENCY_NS),
            "  %-46s %7s %7s %8.4f %8.4f" % ("clock uncertainty", "", "", -model.UNCERTAINTY_PS / 1000.0, model.CLOCK_PERIOD_NS + model.CLOCK_LATENCY_NS - model.UNCERTAINTY_PS / 1000.0),
            "  %-46s %7s %7s %8.4f %8.4f" % ("%s/CK (DFFQ_X1)" % p["endpoint"].rsplit("/", 1)[0], "", "", 0.0, model.CLOCK_PERIOD_NS + model.CLOCK_LATENCY_NS - model.UNCERTAINTY_PS / 1000.0),
            "  %-46s %7s %7s %8.4f %8.4f" % ("library setup time", "", "", -model.SETUP_PS / 1000.0, p["requiredNs"]),
            "  %-46s %7s %7s %8s %8.4f" % ("data required time", "", "", "", p["requiredNs"]),
            "  " + "-" * 82,
            "  %-46s %7s %7s %8s %8.4f" % ("data required time", "", "", "", p["requiredNs"]),
            "  %-46s %7s %7s %8s %8.4f" % ("data arrival time", "", "", "", -p["arrivalNs"]),
            "  " + "-" * 82,
            "  %-46s %7s %7s %8s %8.4f" % ("slack (%s)" % ("VIOLATED" if p["slackNs"] < 0 else "MET"), "", "", "", p["slackNs"]), ""]
    return "\n".join(out)


def breakdown_text(s):
    lines = ["Stage breakdown by cell family over the %d worst paths (cell delay only; net delay %.1f ps = %.1f %% of path delay)"
             % (len(model.PATHS), s["netDelayPs"], s["netSharePct"]),
             "Est. recovery: endpoint slack HimaTime expects back (ns, criticality-weighted) if the family's cells were AndesCell-class faster.",
             "",
             "  %-7s %7s %10s %8s %9s %11s %11s %10s %s" % ("family", "stages", "cell (ps)", "share%", "on paths", "worst-path%", "achievable", "est. rec.", "status"),
             "  " + "-" * 96]
    for r in s["stageBreakdown"]:
        lines.append("  %-7s %7d %10.1f %8.2f %9d %11.2f %10s%% %10.3f %s" % (
            r["family"], r["stages"], r["cellDelayPs"], r["sharePct"], r["onPaths"], r["worstPathSharePct"],
            "-%d" % r["achievableSpeedupPct"], r["estRecoveryNs"], "generated (AndesCell)" if r["generated"] else "stock"))
    lines.append("")
    return "\n".join(lines)


def summary_text(s):
    return ("Design %s  clock %s %.3f ns  corner %s\n  WNS %.4f ns   TNS %.3f ns   violating endpoints %d   Fmax %.2f MHz\n"
            "  worst path %s; generated families in use: %s\n" % (
                model.DESIGN, model.CLOCK_NAME, model.CLOCK_PERIOD_NS, model.CORNER, s["wnsNs"], s["tnsNs"],
                s["violatingEndpoints"], s["fmaxMhz"], s["worstPath"], ", ".join(s["generatedFamilies"]) or "none"))


def cmd_load(rest):
    p = argparse.ArgumentParser(prog="himatime load")
    p.add_argument("--db", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--paths", type=int, default=20)
    p.add_argument("--quiet", action="store_true")
    a = p.parse_args(rest)
    if not 1 <= a.paths <= 20:
        raise ToolError("--paths must be 1-20 (the design db keeps the 20 worst path groups)")
    d, db = _db(a.db)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    if not a.quiet:
        banner("himatime")
    log = Log("HT", out / "himatime.log", quiet=a.quiet)
    log("LOAD", "design db %s" % (d / ("%s.hdb.json" % model.DESIGN)))
    log.phase("LIB", "Reading libraries (%s%s)" % (model.STOCK_LIBRARY, "".join(" + " + l["name"] for l in db.get("extraLibraries") or [])), 2 + len(db.get("extraLibraries") or []), 2)
    log.phase("LOAD", "Reading routed netlist and SPEF parasitics", 3, 3, lambda k, n: "%d nets" % (6900 * k))
    log.phase("TG", "Building timing graph", 3, 2)
    log.phase("UPD", "Updating timing (propagated clocks, %s)" % model.CORNER, 4, 4)
    s = timing_summary(db, a.paths)
    s["db"] = str(d)
    s["loadedAt"] = now_iso()
    write_json(out / "timing_summary.json", s)
    write_text(out / "report_timing.rpt", "\n".join(["Report : timing -max_paths %d -delay max" % a.paths, "Design : %s" % model.DESIGN,
                                                       "Version: %s" % version_line("himatime"), "Note   : MOCK EDA (demo Site eda_cluster_ctu_01)", ""]
                                                      + [path_text(x) for x in s["paths"]]))
    write_text(out / "stage_breakdown.rpt", summary_text(s) + "\n" + breakdown_text(s))
    write_text(out / "report_qor.rpt", summary_text(s))
    log("RPT", "WNS %.4f ns  TNS %.3f ns  Fmax %.2f MHz  (%d violating endpoints)" % (s["wnsNs"], s["tnsNs"], s["fmaxMhz"], s["violatingEndpoints"]))
    top = s["stageBreakdown"][:3]
    log("RPT", "largest est. recovery: %s" % ", ".join("%s %.3f ns" % (r["family"], r["estRecoveryNs"]) for r in top))
    log("RPT", "wrote timing_summary.json, report_timing.rpt, stage_breakdown.rpt in %s (%.1f s)" % (out, log.elapsed()))
    log.close()


def cmd_report(rest):
    p = argparse.ArgumentParser(prog="himatime report")
    p.add_argument("--db", required=True)
    p.add_argument("--paths", type=int, default=3)
    p.add_argument("--stages", action="store_true", help="print the stage breakdown by cell family")
    p.add_argument("--json", action="store_true")
    a = p.parse_args(rest)
    _, db = _db(a.db)
    s = timing_summary(db, max(1, min(20, a.paths)))
    if a.json:
        import json
        print(json.dumps(s, indent=2, sort_keys=True))
        return
    print(summary_text(s))
    if a.stages:
        print(breakdown_text(s))
    for x in s["paths"]:
        print(path_text(x))


def cmd_estimate(rest):
    p = argparse.ArgumentParser(prog="himatime estimate")
    p.add_argument("--db", required=True)
    p.add_argument("--families", required=True, help="comma-separated cell families, e.g. XNOR3,BUF")
    p.add_argument("--speedup", type=float, help="cell-delay reduction in percent (default: AndesCell-class per family)")
    p.add_argument("--json", action="store_true")
    a = p.parse_args(rest)
    _, db = _db(a.db)
    speed = dict(db.get("speed") or {})
    base = model.timing(speed)
    asked = []
    for word in a.families.split(","):
        fam = model.canonical_family(word)
        if fam is None:
            raise ToolError("unknown cell family %r (families: %s)" % (word, ", ".join(model.FAMILIES)))
        asked.append(fam)
        if fam not in speed:
            speed[fam] = (a.speedup / 100.0) if a.speedup is not None else model.FAMILIES[fam]["speedup"]
    t = model.timing(speed)
    gain = round(100.0 * (t["fmaxMhz"] / base["fmaxMhz"] - 1), 2)
    result = dict(schema="ctu-himatime-estimate/1", families=asked, baseline=dict(wnsNs=base["wnsNs"], tnsNs=base["tnsNs"], fmaxMhz=base["fmaxMhz"]),
                  estimate=dict(wnsNs=t["wnsNs"], tnsNs=t["tnsNs"], fmaxMhz=t["fmaxMhz"]), fmaxGainPct=gain,
                  note="estimate on the loaded design; the new-library build decides")
    if a.json:
        import json
        print(json.dumps(result, indent=2, sort_keys=True))
        return
    print("HimaTime what-if on %s: families %s %s faster" % (model.DESIGN, ", ".join(asked), "%.0f %%" % a.speedup if a.speedup is not None else "AndesCell-class"))
    print("  now      : WNS %.4f ns  TNS %.3f ns  Fmax %.2f MHz" % (base["wnsNs"], base["tnsNs"], base["fmaxMhz"]))
    print("  estimate : WNS %.4f ns  TNS %.3f ns  Fmax %.2f MHz  (%+.2f %%)" % (t["wnsNs"], t["tnsNs"], t["fmaxMhz"], gain))


def cmd_verify(rest):
    p = argparse.ArgumentParser(prog="himatime verify-cells")
    p.add_argument("--cells", required=True, help="an AndesCell output directory")
    p.add_argument("--db", required=True, help="the sapr directory of the design the cells are for")
    p.add_argument("--out", required=True)
    p.add_argument("--dont-use", action="append", default=[], help="cells to leave out of the design estimate")
    p.add_argument("--quiet", action="store_true")
    a = p.parse_args(rest)
    lib = libraries.load_extra(a.cells)
    _, db = _db(a.db)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    if not a.quiet:
        banner("himatime")
    log = Log("HT", out / "verify.log", quiet=a.quiet)
    log("VFY", "verifying %d AndesCell cell(s) of %s against %s" % (len(lib["cells"]), lib["name"], model.STOCK_LIBRARY))
    log.phase("LIB", "Reading %s and %s" % (model.STOCK_LIBRARY, lib["name"]), 3, 2)
    rows = []
    for cell in lib["cells"]:
        log.phase("ARC", "Timing arcs of %s" % cell["name"], 1.6, 1)
        stock = libraries.stock_cell(cell["family"], cell["drive"])
        improvement = round(100.0 * (1 - cell["fo4DelayPs"] / stock["fo4DelayPs"]), 1)
        checks = dict(monotonicTables=True, slewWithinLimits=True, capWithinLimits=True,
                      fo4MatchesGeneration=abs(improvement - cell["speedupPct"]) <= 3.0)
        status = "PASS" if all(checks.values()) else "FAIL"
        rows.append(dict(name=cell["name"], family=cell["family"], drive=cell["drive"], stockCell=stock["name"],
                         fo4DelayPs=cell["fo4DelayPs"], stockFo4DelayPs=stock["fo4DelayPs"], improvementPct=improvement,
                         checks=checks, status=status))
        log("ARC", "  %-22s FO4 %6.1f ps vs %-9s %6.1f ps  (%+.1f %%)  %s" % (cell["name"], cell["fo4DelayPs"], stock["name"], stock["fo4DelayPs"], -improvement, status))
    usable_extra = [dict(name=l["name"], cells=l["cells"]) for l in db.get("extraLibraries") or []] + [dict(name=lib["name"], cells=lib["cells"])]
    speed, _ = libraries.speed_of(usable_extra, set(a.dont_use) | set(db.get("dontUse") or []))
    base = model.timing(db.get("speed") or {})
    t = model.timing(speed)
    gain = round(100.0 * (t["fmaxMhz"] / base["fmaxMhz"] - 1), 2)
    log.phase("UPD", "Design estimate with the new cells (%s)" % model.DESIGN, 3, 2)
    result = dict(schema="ctu-himatime-verify/1", tool=version_line("himatime"), library=lib["name"], round=lib.get("round"),
                  cells=rows, passed=sum(1 for r in rows if r["status"] == "PASS"), failed=sum(1 for r in rows if r["status"] != "PASS"),
                  designEstimate=dict(wnsNs=t["wnsNs"], tnsNs=t["tnsNs"], fmaxMhz=t["fmaxMhz"], gainVsDbPct=gain,
                                      dbFmaxMhz=base["fmaxMhz"], excluded=sorted(set(a.dont_use))),
                  verifiedAt=now_iso(), note="MOCK EDA (demo Site eda_cluster_ctu_01)")
    write_json(out / "verify.json", result)
    table = ["HimaTime cell verification: %s (round %s)" % (lib["name"], lib.get("round")), "",
             "  %-22s %-6s %-10s %9s %9s %8s %s" % ("cell", "family", "vs stock", "FO4 (ps)", "stock", "delta", "result"),
             "  " + "-" * 78]
    for r in rows:
        table.append("  %-22s %-6s %-10s %9.1f %9.1f %7.1f%% %s" % (r["name"], r["family"], r["stockCell"], r["fo4DelayPs"], r["stockFo4DelayPs"], -r["improvementPct"], r["status"]))
    table += ["", "Design estimate with these cells (excluding %s): WNS %.4f ns, Fmax %.2f MHz (%+.2f %% vs the loaded build)"
              % (", ".join(sorted(set(a.dont_use))) or "none", t["wnsNs"], t["fmaxMhz"], gain), ""]
    write_text(out / "verify.rpt", "\n".join(table))
    log("VFY", "%d of %d cell(s) PASS; design estimate Fmax %.2f MHz (%+.2f %%)" % (result["passed"], len(rows), t["fmaxMhz"], gain))
    log.close()


def handler(argv):
    if not argv or argv[0] in ("-h", "-help", "--help", "help"):
        print(HELP)
        return 0
    commands = {"load": cmd_load, "report": cmd_report, "estimate": cmd_estimate, "verify-cells": cmd_verify}
    if argv[0] not in commands:
        raise ToolError("unknown command %r (try: himatime -help)" % argv[0])
    commands[argv[0]](argv[1:])
    return 0


def main(argv):
    return run_main("himatime", handler, argv)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
