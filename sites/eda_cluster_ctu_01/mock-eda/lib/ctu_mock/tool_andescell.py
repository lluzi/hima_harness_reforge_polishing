"""andescell: AndesCell standard-cell generation (mock). Builds new cells from cell requirements."""
import argparse
import json
import re
import sys
from pathlib import Path

from . import libraries, model
from .common import Log, ToolError, banner, now_iso, read_json, run_main, sha256_file, version_line, write_json, write_text

MAX_FAMILIES = model.MAX_FAMILIES_PER_ROUND

HELP = """\
usage: andescell <command> [options]

AndesCell generates standard cells (netlist, layout, Liberty, LEF) for cell families named in a
cell-requirements file, sized for the design's critical paths.

commands:
  generate   generate new cells for the requested families (20-40 s; --dry-run: about 2 s)
  families   list the cell families AndesCell has templates for
  -version   print the version and exit

generate options:
  --requirements FILE   requirements JSON: {"requirements": [{"family", "purpose", "target",
                        "evidence", "priority"}, ...]} (a hima-andes-requirements/1 file, or a
                        merged list of several)
  --db SAPR_DIR         the routed design the cells are for (sizing and ranking use its timing)
  --round K             round number; new cells are named ANDES_<FAMILY>_<VARIANT>_R<K>
  --existing DIR        an AndesCell library of an earlier round (repeatable); its families are
                        already generated and are skipped
  --max-families N      families to generate this run (1-%d; default %d, the licensed capacity)
  --families A,B        generate exactly these requested families (a generation plan's choice);
                        each must be requested, have a template and not be generated already
  --out DIR             output directory (not needed with --dry-run)
  --dry-run             rank and select only; generate nothing

Selection: requested families that AndesCell has a template for and that no earlier library has
are ranked by HimaTime's estimated slack recovery on --db (the stage breakdown's est. recovery);
the requirement priority (1 = highest, or high/medium/low) breaks ties. The top N are generated.
""" % (MAX_FAMILIES, MAX_FAMILIES)

CAP_INCREASE = {"DFF": 0.06, "BUF": 0.10, "INV": 0.08, "XNOR3": 0.14, "XOR2": 0.12, "MUX2I": 0.12, "MUX2": 0.10,
                "AOI21": 0.12, "OAI21": 0.12, "AOI22": 0.12, "OAI22": 0.12, "NAND2": 0.10, "NOR2": 0.10,
                "NAND3": 0.10, "NOR3": 0.10, "AND2": 0.10, "OR2": 0.10}
# Families for which AndesCell also tries an extra-fast high-drive variant (high leakage; Qualib screens it).
XF_FAMILIES = ("XNOR3", "BUF", "AOI21", "XOR2")


def priority_of(value):
    if isinstance(value, bool):
        return 3
    if isinstance(value, (int, float)):
        return max(1, min(5, int(value)))
    if isinstance(value, str):
        word = value.strip().lower()
        if word.isdigit():
            return max(1, min(5, int(word)))
        return {"critical": 1, "highest": 1, "high": 1, "p1": 1, "medium": 3, "med": 3, "p2": 2, "p3": 3, "low": 5, "p4": 4}.get(word, 3)
    return 3


def target_pct(text):
    if not isinstance(text, str):
        return None
    m = re.search(r"(\d+(?:\.\d+)?)\s*%", text.replace("−", "-"))
    return float(m.group(1)) if m else None


def load_requirements(path):
    doc = read_json(path, "requirements file")
    items = doc if isinstance(doc, list) else doc.get("requirements") if isinstance(doc, dict) else None
    if not isinstance(items, list) or not items:
        raise ToolError("requirements file %s has no requirements list" % path)
    out = []
    for i, r in enumerate(items):
        if not isinstance(r, dict) or not isinstance(r.get("family"), str):
            raise ToolError("requirement %d has no family" % (i + 1))
        out.append(dict(r, _index=i + 1, _family=model.canonical_family(r["family"]), _priority=priority_of(r.get("priority"))))
    return out


def select(reqs, speed, existing_families, max_families):
    by_family = {}
    skipped = []
    for r in reqs:
        fam = r["_family"]
        if fam is None:
            skipped.append(dict(requirement=r["_index"], family=r["family"], reason="AndesCell has no template for this family"))
            continue
        if fam in existing_families:
            skipped.append(dict(requirement=r["_index"], family=fam, reason="already generated in an earlier round (in the cumulative library)"))
            continue
        by_family.setdefault(fam, []).append(r)
    ranked = []
    for fam, rs in by_family.items():
        ranked.append(dict(family=fam, estRecoveryNs=model.recovery_ns(speed, fam), priority=min(r["_priority"] for r in rs),
                           requirements=[r["_index"] for r in rs], requestedBy=sorted({str(r.get("source") or r.get("agent") or "") for r in rs} - {""})))
    ranked.sort(key=lambda x: (-x["estRecoveryNs"], x["priority"], x["family"]))
    chosen = ranked[:max_families]
    for x in ranked[max_families:]:
        skipped.append(dict(requirement=x["requirements"][0], family=x["family"],
                            reason="ranked %d of %d by estimated recovery (%.3f ns); this run generates %d families" % (ranked.index(x) + 1, len(ranked), x["estRecoveryNs"], max_families)))
    return ranked, chosen, skipped


def plan_select(ranked, chosen_words, max_families):
    """Keep exactly the families a generation plan chose; every other candidate is skipped."""
    chosen = []
    for word in [w for w in chosen_words.split(",") if w.strip()]:
        fam = model.canonical_family(word)
        match = next((x for x in ranked if x["family"] == fam), None)
        if match is None:
            raise ToolError("family %r is not a candidate this run: it must be requested, have an AndesCell template and not be generated already (candidates: %s)"
                            % (word, ", ".join(x["family"] for x in ranked) or "none"))
        if match not in chosen:
            chosen.append(match)
    if not 1 <= len(chosen) <= max_families:
        raise ToolError("--families must name 1-%d families" % max_families)
    skipped = [dict(requirement=x["requirements"][0], family=x["family"],
                    reason="not in the generation plan (ranked %d of %d by estimated recovery, %.3f ns)" % (ranked.index(x) + 1, len(ranked), x["estRecoveryNs"]))
               for x in ranked if x not in chosen]
    return chosen, skipped


def make_cells(family, k):
    info = model.FAMILIES[family]
    s = info["speedup"]
    out = []
    drives = sorted({libraries.drive_of(c) for c in info["cells"]})[:2]
    if len(drives) == 1:
        drives.append(drives[0] * 2)
    variants = [("F%d" % drives[0], drives[0], s, 1.35, CAP_INCREASE[family]), ("F%d" % drives[1], drives[1], s, 1.40, CAP_INCREASE[family])]
    if family in XF_FAMILIES:
        top = max(4, 2 * drives[1])
        variants.append(("XF%d" % top, top, s + 0.06, 2.9, 0.34))
    for tag, drive, sp, leak_ratio, cap_inc in variants:
        stock = libraries.stock_cell(family, drive)
        fo4 = round(stock["fo4DelayPs"] * (1 - sp), 1)
        rf = libraries.STOCK[family]["rf"]
        balanced = 1.0 + (rf - 1.0) * 0.3   # AndesCell balances rise and fall
        out.append(dict(name="ANDES_%s_%s_R%d" % (family, tag, k), family=family, drive=drive, variant=tag,
                        speedupPct=round(100 * sp, 1), fo4DelayPs=fo4,
                        riseFo4Ps=round(fo4 * balanced / ((1 + balanced) / 2), 1), fallFo4Ps=round(fo4 / ((1 + balanced) / 2), 1),
                        areaUm2=round(stock["areaUm2"] * info["areaRatio"] * (1.08 if tag.startswith("XF") else 1.0), 3),
                        stockCell=stock["name"], stockAreaUm2=stock["areaUm2"], stockFo4DelayPs=stock["fo4DelayPs"],
                        inputCapFf=round(stock["inputCapFf"] * (1 + cap_inc), 3), stockInputCapFf=stock["inputCapFf"],
                        leakageNw=round(stock["leakageNw"] * leak_ratio, 2), stockLeakageNw=stock["leakageNw"],
                        function=info["function"], inputs=info["inputs"], output=info["out"],
                        origin="AndesCell 2.4.0 round %d, %s variant of %s" % (k, tag, stock["name"])))
    return out


def cmd_families(rest):
    p = argparse.ArgumentParser(prog="andescell families")
    p.add_argument("--json", action="store_true")
    a = p.parse_args(rest)
    rows = [dict(family=f, describe=i["describe"], stockCells=i["cells"], achievableSpeedupPct=round(100 * i["speedup"]))
            for f, i in model.FAMILIES.items()]
    if a.json:
        print(json.dumps(dict(schema="ctu-andescell-families/1", families=rows, aliases=model.ALIASES,
                              maxFamiliesPerRun=MAX_FAMILIES), indent=2, sort_keys=True))
        return
    print("AndesCell templates (%d families; at most %d generated per run):" % (len(rows), MAX_FAMILIES))
    for r in rows:
        print("  %-6s %-30s stock: %-34s typical FO4 gain -%d %%" % (r["family"], r["describe"], " ".join(r["stockCells"]), r["achievableSpeedupPct"]))


def cmd_generate(rest):
    p = argparse.ArgumentParser(prog="andescell generate")
    p.add_argument("--requirements", required=True)
    p.add_argument("--db", required=True)
    p.add_argument("--round", type=int, required=True)
    p.add_argument("--existing", action="append", default=[])
    p.add_argument("--max-families", type=int, default=MAX_FAMILIES)
    p.add_argument("--families", help="comma-separated families to generate (a generation plan's choice)")
    p.add_argument("--out")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--quiet", action="store_true")
    a = p.parse_args(rest)
    if not 1 <= a.round <= 99:
        raise ToolError("--round must be 1-99")
    if not 1 <= a.max_families <= MAX_FAMILIES:
        raise ToolError("--max-families must be 1-%d (licensed capacity per run)" % MAX_FAMILIES)
    if not a.dry_run and not a.out:
        raise ToolError("--out is required unless --dry-run")
    db = read_json(Path(a.db) / ("%s.hdb.json" % model.DESIGN), "design db (run sapr first)")
    speed = dict(db.get("speed") or {})
    existing = [libraries.load_extra(d) for d in a.existing]
    existing_families = {c["family"] for lib in existing for c in lib["cells"]} | set(speed)
    reqs = load_requirements(a.requirements)
    ranked, chosen, skipped = select(reqs, speed, existing_families, a.max_families)
    if a.families is not None:
        chosen, plan_skipped = plan_select(ranked, a.families, a.max_families)
        skipped = [x for x in skipped if "ranked" not in x["reason"]] + plan_skipped
    if a.dry_run:
        print("AndesCell dry run, round %d: %d requirement(s), %d candidate famil%s" % (a.round, len(reqs), len(ranked), "y" if len(ranked) == 1 else "ies"))
        for i, x in enumerate(ranked):
            print("  %d. %-6s est. recovery %.3f ns  priority %d  %s" % (i + 1, x["family"], x["estRecoveryNs"], x["priority"], "SELECTED" if x in chosen else "not this run"))
        for s in skipped:
            if "ranked" not in s["reason"]:
                print("  skipped requirement %s (%s): %s" % (s["requirement"], s["family"], s["reason"]))
        return
    out = Path(a.out)
    if out.exists() and any(out.iterdir()):
        raise ToolError("output directory %s is not empty" % out)
    out.mkdir(parents=True, exist_ok=True)
    if not a.quiet:
        banner("andescell")
    log = Log("AC", out / "andescell.log", quiet=a.quiet)
    log("REQ", "%d requirement(s) from %s" % (len(reqs), a.requirements))
    log("REQ", "ranking %d candidate famil%s by HimaTime estimated recovery on %s" % (len(ranked), "y" if len(ranked) == 1 else "ies", a.db))
    for i, x in enumerate(ranked):
        log("REQ", "  %d. %-6s %.3f ns (priority %d)%s" % (i + 1, x["family"], x["estRecoveryNs"], x["priority"], "  <- generate" if x in chosen else ""))
    for s in skipped:
        log("REQ", "  skip requirement %s (%s): %s" % (s["requirement"], s["family"], s["reason"]))
    log.phase("INIT", "Loading %s templates, design rules and device models" % model.STOCK_LIBRARY, 5, 2)
    cells = []
    for x in chosen:
        fam = x["family"]
        made = make_cells(fam, a.round)
        log.phase("GEN", "%s: transistor sizing for the critical arcs (%s)" % (fam, ", ".join(c["variant"] for c in made)), 4, 2)
        log.phase("LAY", "%s: layout synthesis, DRC and LVS" % fam, 5, 3, lambda k, n: "%d/%d cells" % (min(len(made), k), len(made)))
        log.phase("CHR", "%s: characterization (%s, 5x5 NLDM)" % (fam, model.CORNER), 3, 2)
        for c in made:
            log("GEN", "  %-22s FO4 %.1f ps (stock %s %.1f ps, -%.1f %%), area %.3f um^2" % (c["name"], c["fo4DelayPs"], c["stockCell"], c["stockFo4DelayPs"], c["speedupPct"], c["areaUm2"]))
            write_text(out / "signoff" / ("%s.drc.rpt" % c["name"]), "DRC %s: 0 violations\n" % c["name"])
            write_text(out / "signoff" / ("%s.lvs.rpt" % c["name"]), "LVS %s: layout and schematic netlists MATCH\n" % c["name"])
        cells.extend(made)
    name = "andes_r%d" % a.round
    banner_lines = ["AndesCell library %s, round %d, %s (MOCK EDA, demo Site eda_cluster_ctu_01; not signoff)" % (name, a.round, model.CORNER)]
    write_text(out / (name + ".lib"), libraries.liberty_text(name, cells, banner_lines))
    write_text(out / (name + ".lef"), libraries.lef_text(cells, banner_lines))
    manifest = dict(schema="ctu-andescell-library/1", name=name, round=a.round, generatedBy=version_line("andescell"),
                    baseLibrary=model.STOCK_LIBRARY, corner=model.CORNER, families=[x["family"] for x in chosen],
                    cells=cells, files=dict(liberty=name + ".lib", lef=name + ".lef"), generatedAt=now_iso())
    write_json(out / (name + ".json"), manifest)
    trace = []
    for r in reqs:
        fam = r["_family"]
        made = [c for c in cells if c["family"] == fam]
        wanted = target_pct(r.get("target"))
        achieved = max((c["speedupPct"] for c in made if not c["variant"].startswith("XF")), default=None)
        trace.append(dict(requirement=r["_index"], family=r["family"], canonicalFamily=fam, source=r.get("source") or r.get("agent"),
                          target=r.get("target"), targetPct=wanted, generated=bool(made), achievedPct=achieved,
                          targetMet=None if (wanted is None or achieved is None) else achieved + 2.0 >= wanted,
                          cells=[c["name"] for c in made]))
    gen = dict(schema="ctu-andescell-generation/1", tool=version_line("andescell"), round=a.round, library=name,
               requirementsFile=str(a.requirements), requirementsSha256=sha256_file(a.requirements),
               ranked=ranked, selected=[x["family"] for x in chosen], skipped=skipped, requirements=trace,
               cells=[c["name"] for c in cells], runtimeS=log.elapsed(), generatedAt=now_iso())
    write_json(out / "generation.json", gen)
    rpt = ["AndesCell generation report, round %d (%s)" % (a.round, name), "",
           "Selected families: %s" % (", ".join(gen["selected"]) or "none"), "",
           "Requested families ranked by HimaTime estimated recovery on the build:"]
    for i, x in enumerate(ranked):
        rpt.append("  %d. %-6s %7.3f ns  priority %d  requested by %-17s %s" % (i + 1, x["family"], x["estRecoveryNs"], x["priority"],
                                                                         ", ".join(x["requestedBy"]) or "-", "generated" if x in chosen else "not this run"))
    for sk in skipped:
        if "ranked" not in sk["reason"]:
            rpt.append("  skipped %-6s %s" % (sk["family"], sk["reason"]))
    rpt += ["",
           "  %-24s %-6s %-9s %9s %9s %8s %10s" % ("cell", "family", "vs stock", "FO4 (ps)", "stock", "delta", "area um^2"), "  " + "-" * 82]
    for c in cells:
        rpt.append("  %-24s %-6s %-9s %9.1f %9.1f %7.1f%% %10.3f" % (c["name"], c["family"], c["stockCell"], c["fo4DelayPs"], c["stockFo4DelayPs"], -c["speedupPct"], c["areaUm2"]))
    rpt += ["", "Requirements:"]
    for t in trace:
        rpt.append("  #%d %-6s %-40s -> %s" % (t["requirement"], t["family"], (t["target"] or "")[:40],
                                              ("generated, -%.0f %%%s" % (t["achievedPct"], "" if t["targetMet"] in (None, True) else " (below the requested target)")) if t["generated"] else "not generated this run"))
    write_text(out / "generation.rpt", "\n".join(rpt) + "\n")
    if not cells:
        log("WARN", "no cell generated: no requested family is both new and on AndesCell's template list")
    log("DONE", "%d cell(s) in %d famil%s written to %s (%.1f s)" % (len(cells), len(chosen), "y" if len(chosen) == 1 else "ies", out, log.elapsed()))
    log.close()


def handler(argv):
    if not argv or argv[0] in ("-h", "-help", "--help", "help"):
        print(HELP)
        return 0
    commands = {"generate": cmd_generate, "families": cmd_families}
    if argv[0] not in commands:
        raise ToolError("unknown command %r (try: andescell -help)" % argv[0])
    commands[argv[0]](argv[1:])
    return 0


def main(argv):
    return run_main("andescell", handler, argv)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
