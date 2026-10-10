"""sapr: Synthesis and APR (mock). RTL to routed design in one run, with reports and a design db."""
import argparse
import sys
from pathlib import Path

from . import libraries, model
from .common import SHARE, Log, ToolError, banner, now_iso, run_main, sha256_file, version_line, write_json, write_text

HELP = """\
usage: sapr run --design NAME --out DIR [options]

Synthesis and APR: logic synthesis, floorplan, placement, clock tree synthesis, routing and
post-route optimization of one design, ending with a post-route timing, area and DRC summary.

commands:
  run        full flow, RTL to routed design (typically 60-120 s)
  -version   print the version and exit

run options:
  --design NAME          top module (aes_cipher_top)
  --design-root DIR      design directory with rtl/ and <design>.sdc (default: the bundled design)
  --lib NAME             stock standard-cell library (default std9t_svt)
  --extra-lib DIR        an AndesCell library directory to add (repeatable; cumulative libraries)
  --dont-use CELL        a cell the flow must not use (repeatable; e.g. cells that failed a screen)
  --clock-period NS      override the SDC clock period (default: from the SDC, 1.000 ns)
  --jobs N               worker threads (1-8, default 4)
  --out DIR              output directory (created; must be empty or absent)
  --quiet                only print the final summary

outputs in --out:
  sapr.log                     the full run log
  sapr_summary.json            post-route WNS, TNS, Fmax, area, instances, route DRC, new-cell usage
  aes_cipher_top.hdb.json      design database for HimaTime (himatime load --db DIR)
  aes_cipher_top.route.v       routed netlist (abridged: critical-path instances)
  aes_cipher_top.route.def     routed DEF header and component summary
  reports/report_qor.rpt reports/place.rpt reports/cts.rpt reports/route_drc.rpt
  reports/area.rpt reports/postroute_timing.rpt
"""


def _parse(argv):
    if not argv or argv[0] in ("-h", "-help", "--help", "help"):
        print(HELP)
        raise SystemExit(0)
    if argv[0] != "run":
        raise ToolError("unknown command %r (try: sapr -help)" % argv[0])
    p = argparse.ArgumentParser(prog="sapr run", add_help=True)
    p.add_argument("--design", required=True)
    p.add_argument("--design-root")
    p.add_argument("--lib", default=model.STOCK_LIBRARY)
    p.add_argument("--extra-lib", action="append", default=[])
    p.add_argument("--dont-use", action="append", default=[])
    p.add_argument("--clock-period", type=float)
    p.add_argument("--jobs", type=int, default=4)
    p.add_argument("--out", required=True)
    p.add_argument("--quiet", action="store_true")
    return p.parse_args(argv[1:])


def design_root(arg):
    root = Path(arg) if arg else SHARE / "designs" / model.DESIGN
    if not (root / "rtl").is_dir() or not (root / ("%s.sdc" % model.DESIGN)).is_file():
        raise ToolError("design root %s has no rtl/ or %s.sdc" % (root, model.DESIGN))
    return root


def build(args):
    if args.design != model.DESIGN:
        raise ToolError("design %r is not available on this Site (available: %s)" % (args.design, model.DESIGN))
    if args.lib != model.STOCK_LIBRARY:
        raise ToolError("library %r is not installed (installed: %s)" % (args.lib, model.STOCK_LIBRARY))
    if not 1 <= args.jobs <= 8:
        raise ToolError("--jobs must be 1-8")
    period = args.clock_period if args.clock_period is not None else model.CLOCK_PERIOD_NS
    if abs(period - model.CLOCK_PERIOD_NS) > 1e-9:
        raise ToolError("this demo design is characterized at %.3f ns only" % model.CLOCK_PERIOD_NS)
    root = design_root(args.design_root)
    out = Path(args.out)
    if out.exists() and any(out.iterdir()):
        raise ToolError("output directory %s is not empty" % out)
    extra = [libraries.load_extra(d) for d in args.extra_lib]
    known = {c["name"] for lib in extra for c in lib["cells"]}
    for cell in args.dont_use:
        if cell not in known and cell not in {c["name"] for c in libraries.stock_cells()}:
            raise ToolError("--dont-use names %r, which no loaded library has" % cell)
    speed, usable = libraries.speed_of(extra, set(args.dont_use))
    return root, out, extra, speed, usable, period


def run(argv):
    args = _parse(argv)
    root, out, extra, speed, usable, period = build(args)
    out.mkdir(parents=True, exist_ok=True)
    if not args.quiet:
        banner("sapr")
    log = Log("SAPR", out / "sapr.log", quiet=args.quiet)
    log.raw(version_line("sapr"))
    rtl = sorted((root / "rtl").glob("*.v"))
    log("INFO", "design %s, %d RTL file(s) under %s" % (model.DESIGN, len(rtl), root / "rtl"))
    log("INFO", "constraints %s (clock %s period %.3f ns, uncertainty %.3f ns)" % (root / ("%s.sdc" % model.DESIGN), model.CLOCK_NAME, period, model.UNCERTAINTY_PS / 1000))
    stock_lib = SHARE / "libs" / model.STOCK_LIBRARY / ("%s_%s.lib" % (model.STOCK_LIBRARY, model.CORNER))
    log("INFO", "library %s (%s): %s" % (model.STOCK_LIBRARY, model.CORNER, stock_lib))
    for lib in extra:
        log("INFO", "extra library %s (round %s): %d cell(s) from %s" % (lib["name"], lib.get("round"), len(lib["cells"]), lib["_dir"]))
    if args.dont_use:
        log("INFO", "dont_use: %s" % " ".join(sorted(args.dont_use)))
    n_extra = len(extra)
    log.phase("SYN", "Elaborating RTL", 3, 2, lambda k, n: "%d modules" % (9 * k))
    log.phase("SYN", "Technology mapping to %s%s" % (model.STOCK_LIBRARY, " + %d AndesCell librar%s" % (n_extra, "y" if n_extra == 1 else "ies") if n_extra else ""),
              14, 5, lambda k, n: "%d cells mapped" % (int(18400 * k / n)))
    log.phase("SYN", "Timing-driven optimization", 10, 4, lambda k, n: "WNS %.3f ns" % (-0.21 + 0.04 * k))
    log.phase("FP", "Floorplan (utilization %.0f %%, 9-track rows)" % (100 * model.CORE_UTILIZATION), 3, 2)
    log.phase("PLC", "Global and detailed placement", 14, 5, lambda k, n: "overflow %.2f %%" % (4.0 / k))
    log.phase("CTS", "Clock tree synthesis (%s)" % model.CLOCK_NAME, 8, 4, lambda k, n: "skew %d ps" % (40 - 6 * k))
    log.phase("RT", "Global and detailed routing", 16, 6, lambda k, n: "%d DRC violations" % (max(0, 410 // (k * k) - (8 if k == n else 0))))
    log.phase("OPT", "Post-route optimization%s" % (" with new cells" if speed else ""), 8 + 4 * n_extra, 4)
    t = model.timing(speed)
    area, instances, by_cell = model.area(speed, usable)
    log.phase("STA", "Post-route timing (SPEF, %s)" % model.CORNER, 4, 2)
    new_total = sum(by_cell.values())
    families_used = sorted(f for f, cells in usable.items() if any(by_cell.get(c) for c in cells))
    summary = dict(
        schema="ctu-sapr-summary/1", tool=version_line("sapr"), design=model.DESIGN, technology=model.TECHNOLOGY,
        library=model.STOCK_LIBRARY, corner=model.CORNER, clockPeriodNs=period, finished=True,
        wnsNs=t["wnsNs"], tnsNs=t["tnsNs"], fmaxMhz=t["fmaxMhz"], violatingEndpoints=t["violatingEndpoints"],
        areaUm2=area, instances=instances, routeDrcErrors=model.REFERENCE_DRC, coreUtilizationPct=round(100 * model.CORE_UTILIZATION, 1),
        newCellInstances=new_total, newCellInstancesByCell=by_cell, newFamiliesUsed=families_used,
        extraLibraries=[dict(name=l["name"], round=l.get("round"), manifestSha256=l["_manifestSha256"],
                             libertySha256=l["_files"]["liberty"]["sha256"]) for l in extra],
        dontUse=sorted(args.dont_use), runtimeS=log.elapsed(), finishedAt=now_iso(),
        note="MOCK EDA: model numbers for the demo Site eda_cluster_ctu_01; not signoff, not silicon.")
    db = dict(schema="ctu-design-db/1", design=model.DESIGN, clockPeriodNs=period, library=model.STOCK_LIBRARY,
              stockLibertySha256=sha256_file(stock_lib),
              extraLibraries=[dict(name=l["name"], dir=l["_dir"], round=l.get("round"), manifestSha256=l["_manifestSha256"],
                                   cells=l["cells"]) for l in extra],
              dontUse=sorted(args.dont_use), speed=speed, usable=usable, newCellInstancesByCell=by_cell, builtAt=now_iso())
    write_json(out / "sapr_summary.json", summary)
    write_json(out / ("%s.hdb.json" % model.DESIGN), db)
    _reports(out, summary, speed, by_cell, usable, extra)
    log("INFO", "post-route: WNS %.4f ns, TNS %.3f ns, Fmax %.2f MHz, %d violating endpoints" % (t["wnsNs"], t["tnsNs"], t["fmaxMhz"], t["violatingEndpoints"]))
    log("INFO", "cell area %.1f um^2, %d instances, route DRC %d, new-cell instances %d" % (area, instances, model.REFERENCE_DRC, new_total))
    log("INFO", "wrote %s" % (out / "sapr_summary.json"))
    log("INFO", "sapr finished in %.1f s" % log.elapsed())
    if args.quiet:
        print("sapr: WNS %.4f ns  TNS %.3f ns  Fmax %.2f MHz  area %.1f um^2  instances %d  DRC %d  new-cell instances %d"
              % (t["wnsNs"], t["tnsNs"], t["fmaxMhz"], area, instances, model.REFERENCE_DRC, new_total))
    log.close()
    return 0


def _reports(out, s, speed, by_cell, usable, extra):
    r = out / "reports"
    hdr = ["*" * 72, "Report : %s", "Design : %s" % model.DESIGN, "Version: %s" % s["tool"], "Date   : %s" % s["finishedAt"],
           "Note   : demo Site eda_cluster_ctu_01; not signoff", "*" * 72, ""]
    head = lambda title: "\n".join(hdr) % title
    worst_path = min(model.PATHS, key=lambda p: model.slack_ps(p, speed))
    write_text(r / "report_qor.rpt", head("qor") + "\n".join([
        "  Flow settings",
        "  -----------------------------------",
        "  Synthesis effort:           high (timing-driven, ultra mapping, retiming off)",
        "  Placement effort:           high (timing-driven)",
        "  Clock tree effort:          high",
        "  Routing effort:             high (timing-driven, SI-aware)",
        "  Post-route optimization:    high (setup)",
        "",
        "  Timing path group '%s' (clock period %.3f ns)" % (model.CLOCK_NAME, s["clockPeriodNs"]),
        "  -----------------------------------",
        "  Levels of logic:            %d" % (len(model.stages(worst_path, speed)) - 1),
        "  Critical path length:       %.3f ns" % (model.path_delay(worst_path, speed) / 1000.0),
        "  Critical path slack:        %.4f ns" % s["wnsNs"],
        "  Total negative slack:       %.3f ns" % s["tnsNs"],
        "  No. of violating paths:     %d" % s["violatingEndpoints"],
        "  Fmax:                       %.2f MHz" % s["fmaxMhz"],
        "",
        "  Cell count",
        "  -----------------------------------",
        "  Leaf cell count:            %d" % s["instances"],
        "  Sequential cell count:      %d" % model.FAMILIES["DFF"]["instances"],
        "  AndesCell instances:        %d" % s["newCellInstances"],
        "  Cell area:                  %.1f um^2" % s["areaUm2"],
        "  Route DRC violations:       %d" % s["routeDrcErrors"], ""]))
    write_text(r / "place.rpt", head("placement") + "  utilization %.1f %%   rows 9-track   overflow 0.00 %%   legal: yes\n" % s["coreUtilizationPct"])
    write_text(r / "cts.rpt", head("clock tree") + "  clock %s  sinks %d  latency %.3f ns  skew 0.016 ns  buffers 74\n"
               % (model.CLOCK_NAME, model.FAMILIES["DFF"]["instances"], model.CLOCK_LATENCY_NS))
    write_text(r / "route_drc.rpt", head("route DRC") + "  Total DRC violations: %d\n  Shorts: 0  Spacing: 0  Min-area: 0  Antenna: 0\n" % s["routeDrcErrors"])
    lines = ["  %-22s %8s %12s" % ("cell family", "count", "area (um^2)"), "  " + "-" * 44]
    for fam, info in model.FAMILIES.items():
        new = sum(by_cell.get(c, 0) for c in usable.get(fam, []))
        lines.append("  %-22s %8d %12.1f%s" % (fam, info["instances"] - new, (info["instances"] - new) * info["areaUm2"], ""))
    for cell, n in sorted(by_cell.items()):
        fam = next(c["family"] for l in extra for c in l["cells"] if c["name"] == cell)
        lines.append("  %-22s %8d %12.1f   (AndesCell)" % (cell, n, n * model.FAMILIES[fam]["areaUm2"] * model.FAMILIES[fam]["areaRatio"]))
    lines += ["  " + "-" * 44, "  %-22s %8d %12.1f" % ("total", s["instances"], s["areaUm2"]), ""]
    write_text(r / "area.rpt", head("area by cell") + "\n".join(lines))
    t = model.timing(speed)
    worst = sorted(model.PATHS, key=lambda p: model.slack_ps(p, speed))[:5]
    tl = ["  WNS %.4f ns   TNS %.3f ns   violating endpoints %d   Fmax %.2f MHz" % (t["wnsNs"], t["tnsNs"], t["violatingEndpoints"], t["fmaxMhz"]), "",
          "  %-24s %-24s %10s  %s" % ("Startpoint", "Endpoint", "Slack (ns)", "")]
    for p in worst:
        slack = model.slack_ps(p, speed) / 1000.0
        tl.append("  %-24s %-24s %10.4f  %s" % (p["start"], p["end"], slack, "(VIOLATED)" if slack < 0 else "(MET)"))
    tl += ["", "  Full path detail: himatime load --db %s" % out, ""]
    write_text(r / "postroute_timing.rpt", head("post-route timing summary") + "\n".join(tl))
    nl = ["// %s routed netlist (abridged to the 20 worst paths' instances)" % model.DESIGN,
          "// MOCK EDA: demo Site eda_cluster_ctu_01", "module %s (clk, rst, ld, done, key, text_in, text_out);" % model.DESIGN]
    seen = set()
    for p in model.PATHS:
        for st in model.stages(p, speed, {f: sorted(c)[-1] for f, c in usable.items()}):
            if st["instance"] in seen:
                continue
            seen.add(st["instance"])
            nl.append("  %s %s ( /* ... */ );" % (st["cell"], st["instance"].replace("/", "_")))
    nl += ["  // ... %d further instances" % (s["instances"] - len(seen)), "endmodule", ""]
    write_text(out / ("%s.route.v" % model.DESIGN), "\n".join(nl))
    die = (s["areaUm2"] / model.CORE_UTILIZATION) ** 0.5
    write_text(out / ("%s.route.def" % model.DESIGN), "VERSION 5.8 ;\nDESIGN %s ;\nUNITS DISTANCE MICRONS 2000 ;\nDIEAREA ( 0 0 ) ( %d %d ) ;\nCOMPONENTS %d ;\n# ... (abridged, MOCK EDA)\nEND COMPONENTS\nEND DESIGN\n"
               % (model.DESIGN, int(die * 2000), int(die * 2000), s["instances"]))


def main(argv):
    return run_main("sapr", run, argv)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
