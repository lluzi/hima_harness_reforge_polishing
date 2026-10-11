#!/usr/bin/env python3
"""Write the Pack's generated knowledge from the Site's own tools: knowledge/design-notes.md and
knowledge/charts/*.chart.json. Both are generated per Site and never committed.

  python3 flow/knowledge_charts.py <EDA_ROOT> [<KNOWLEDGE_DIR>]

Runs the reference build (sapr, design openc910), loads it into HimaTime, asks HimaTime for its
high-value cells and cell what-if, and Qualib for its library view of the what-if arcs, in a scratch
directory; then writes, with the same chart builders the Pack's steps use (andes_cli.py):

  charts/reference-summary.chart.json    the reference build at route (metrics)
  charts/path-groups.chart.json          worst slack, TNS and violating paths per path group (metrics)
  charts/flow-stages.chart.json          reg2reg worst slack through the flow
  charts/worst-paths.chart.json          slack of the 8 worst reg2reg paths at route
  charts/stage-breakdown.chart.json      where the worst path's time goes
  charts/library-vt.chart.json           stock arc delay per Vt: ULVT is already the fastest
  charts/high-value-families.chart.json  HimaTime's high-value cells by family
  design-notes.md                        the Guide's design notes, from knowledge/design-notes.template.md

The design data comes from where the tools read it (the Site's install, or CTU_OPENC910_DATA). The
default KNOWLEDGE_DIR is the Pack's own knowledge/. Every number in the notes is a tool's.
"""
import json
import os
import re
import shutil
import string
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import andes_cli as cli  # noqa: E402

TEMPLATE = HERE.parent / "knowledge" / "design-notes.template.md"
CONTRACT = HERE.parent / "contract.yml"
# Words for the design's hierarchy, as they appear in instance names (OpenC910 RTL module names).
UNIT_WORDS = (("icache", "I-cache"), ("dcache", "D-cache"), ("l2cache", "L2 cache"), ("l2c", "L2 cache"), ("ifu", "instruction fetch unit"),
              ("lsu", "load/store unit"), ("idu", "decode unit"), ("rtu", "retire unit"), ("mmu", "MMU"), ("biu", "bus interface unit"),
              ("iu", "integer unit"), ("vfpu", "vector/floating-point unit"))


def run(argv, env):
    out = subprocess.run(argv, capture_output=True, text=True, env=env, timeout=600)
    if out.returncode != 0:
        raise cli.ToolError("%s failed: %s" % (" ".join(os.path.basename(a) if i == 0 else a for i, a in enumerate(argv[:2])),
                                               (out.stderr or out.stdout).strip()[:400]))
    return out.stdout


def tool_outputs(eda_root):
    """Everything the notes and charts need, from the tools under eda_root."""
    eda = Path(eda_root)
    inputs = dict(tools={name: dict(path=str(eda / "bin" / name)) for name in cli.TOOLS})
    env = dict(os.environ, CTU_MOCK_TIME_SCALE="0")
    os.environ["CTU_MOCK_TIME_SCALE"] = "0"
    scratch = Path(tempfile.mkdtemp(prefix="andes-knowledge-"))
    try:
        ref, ht = scratch / "ref", scratch / "ht"
        run([str(eda / "bin" / "sapr"), "run", "--design", cli.DESIGN, "--out", str(ref), "--quiet"], env)
        run([str(eda / "bin" / "himatime"), "load", "--db", str(ref), "--out", str(ht), "--quiet"], env)
        sapr = cli.read_json(ref / "sapr_summary.json", "sapr_summary.json")
        timing = cli.read_json(ht / "timing_summary.json", "timing_summary.json")
        hv = cli.tool_json(inputs, "himatime", ["highvalue", "--db", str(ref), "--top-families", "12"])
        whatif = cli.whatif_of(inputs, ref)
        merged = cli.merged_arcs(whatif)
        analysis = cli.analysis_of(inputs, ref, merged)
        stock = cli.stock_arcs_of(inputs, merged[:8])
    finally:
        shutil.rmtree(str(scratch), ignore_errors=True)
    return dict(sapr=sapr, timing=timing, hv=hv, whatif=whatif, merged=merged, analysis=analysis, stock=stock)


def charts(t):
    sapr, timing, hv, analysis = t["sapr"], t["timing"], t["hv"], t["analysis"]
    sapr_source = "Synthesis and APR %s, the reference build at route (sapr_summary.json)" % cli._version(sapr)
    ref = [("Reference build", "baseline", sapr)]
    out = {
        "reference-summary": cli.metrics_chart("Reference build at route: summary", ref, sapr_source,
                                               subtitle="%s on the stock libraries at the end of route, clock %s" % (cli.DESIGN, cli.clock_words(sapr)),
                                               caption=cli.SHOWN_BOUNDARY),
        "path-groups": cli.path_groups_chart(ref, sapr_source, subtitle="The reference build's path groups at the end of route"),
        "flow-stages": cli.flow_stages_chart(ref, sapr_source, subtitle="The reference build, stage by stage"),
        "worst-paths": cli.slack_chart(timing["paths"], "HimaTime %s, the routed reference build (report_timing.rpt)" % cli._version(timing),
                                       "Reference build: reg2reg WNS %d ps, %d violating paths" % (round(cli.ps(timing["wnsNs"])), timing["nvp"]),
                                       timing["clockPeriodNs"]),
        "library-vt": cli.vt_chart(t["stock"].get("arcs") or [], cli.common_suffix([a["cell"] for a in t["merged"]]),
                                   "Qualib %s stock arc delays per Vt (qualib list --arcs)" % cli._version(t["stock"]),
                                   subtitle="HimaTime's first 8 what-if arcs; ULVT fastest on %s of %s arcs"
                                   % ((analysis.get("vt") or {}).get("ulvt_fastest_count"), analysis.get("arcs"))),
        "high-value-families": cli.high_value_chart(hv, "HimaTime %s high-value cell analysis (himatime highvalue)" % cli._version(hv),
                                                    subtitle="%s high-value cells in %s families" % (hv.get("listed_cells"), hv.get("family_count"))),
    }
    if timing.get("breakdown"):
        out["stage-breakdown"] = cli.stage_chart(timing, "HimaTime %s worst-path breakdown (stage_breakdown.rpt) of the reference build"
                                                 % cli._version(timing), "Reference build at route, the worst reg2reg path")
    return {"%s.chart.json" % name: doc for name, doc in out.items()}


# ---------------------------------------------------------------- the notes

def millions(n):
    if n is None:
        return "?"
    if n >= 1e6:
        return "%.2f M" % (n / 1e6)
    if n >= 1e4:
        return "%d k" % round(n / 1e3)
    return "{:,}".format(n)


def where(name):
    """Plain words for an instance path: the core, the unit and what the point is (SRAM, flop)."""
    low = name.lower()
    words = []
    m = re.search(r"x_ct_top_(\d+)", low)
    if m:
        words.append("core %s" % m.group(1))
    for key, word in UNIT_WORDS:
        if re.search(r"(^|[_/])%s([_/]|$)" % key, low) or "_%s_" % key in low:
            if word not in words:
                words.append(word)
            if len([w for w in words if not w.startswith("core")]) >= 2:
                break
    leaf = name.split("/")[-2] if "/" in name else name
    kind = "SRAM" if "sram" in leaf.lower() else ("flop" if "_reg" in leaf.lower() else "pin")
    return "%s %s" % (", ".join(words) if words else "top level", kind)


def data_path_words(parts, worst):
    """The worst path's data time in words: SRAM access, cells and nets (the launch clock latency,
    matched by the capture clock, is not time the path spends)."""
    if not parts or not worst.get("arrivalNs"):
        return ""
    by = {p["part"]: p["ns"] for p in parts}
    cells = [p["part"] for p in parts if p["part"] not in ("SRAM access", "nets")]
    data = sum(p["ns"] for p in parts)
    words = "Its data path takes %d ps" % round(cli.ps(data))
    if "SRAM access" in by:
        words += ": the SRAM access %d ps" % round(cli.ps(by["SRAM access"]))
    words += ", then %s and %d ps of nets." % (", ".join(cells[:4]) or "no cell", round(cli.ps(by.get("nets", 0.0))))
    return words


def io_words(sapr, all_wns_ns):
    """Why the all-group worst slack sits on reg2out: the block SDC's output-delay budget."""
    io = sapr.get("ioBudget") or {}
    w = io.get("worstReg2out") or {}
    if not io or not w:
        return "The all-group worst slack can sit on an input or output group, which custom cells inside the core do not move."
    groups = ", ".join("%s* %d" % (g["prefix"], g["ports"]) for g in (io.get("portGroups") or [])[:3])
    return ("It sits on reg2out: the block SDC reserves %.3f ns of output delay on %d output ports (%s; clock %s), which leaves "
            "%d ps inside the core for those paths; the worst, `%s`, needs %d ps. That is a chip-level I/O budget, settled at "
            "SoC integration, not a core-cell problem: the core clock is set by reg2reg."
            % (io["outputDelayNs"], io["outputDelayPorts"], groups, io.get("outputClock"), round(cli.ps(w["requiredNs"])), w["endpoint"],
               round(cli.ps(w["arrivalNs"]))))


def vt_of(names):
    for vt in ("ULVT", "ELVT", "LVT", "SVT", "HVT"):
        if names and all(str(n).upper().endswith(vt) for n in names):
            return vt
    return None


def goal_pct():
    m = re.search(r"target_timing_gain_pct:\s*\{[^}]*default:\s*([0-9.]+)", CONTRACT.read_text())
    return float(m.group(1)) if m else 1.0


def table(head, rows):
    out = ["| %s |" % " | ".join(head), "| %s |" % " | ".join("---" for _ in head)]
    out += ["| %s |" % " | ".join(str(c) for c in r) for r in rows]
    return "\n".join(out)


def notes(t, chart_names):
    sapr, timing, hv, whatif, merged, analysis = t["sapr"], t["timing"], t["hv"], t["whatif"], t["merged"], t["analysis"]
    period = sapr["clockPeriodNs"]
    all_g = (sapr.get("groups") or {}).get("all") or {}
    ct = sapr.get("clockTree") or {}
    power = sapr.get("power") or {}
    vt = analysis.get("vt") or {}
    stock_vt = vt_of(hv.get("cells") or [])
    note = str(analysis.get("note") or "")
    m = re.search(r"stock libraries (.+)$", note)
    corner = m.group(1).strip() if m else None
    worst = (timing.get("paths") or [{}])[0]
    parts = timing.get("breakdown") or []
    sram = next((p["ns"] for p in parts if p["part"] == "SRAM access"), None)
    arrival = worst.get("arrivalNs")
    others = [p for p in parts if p["part"] not in ("SRAM access", "nets", "clock network")]
    top3 = sorted(merged, key=lambda a: -(a["tnsGainNs"] or 0.0))[:3]
    goal = goal_pct()
    fields = dict(
        design=cli.DESIGN, design_cells=millions(hv.get("design_cells")),
        clock=sapr.get("clock") or "the clock", period="%.3f" % period, ghz="%.1f" % (1.0 / period),
        corner_line=(" Corner: %s (Qualib)." % corner) if corner else "",
        stock_vt=(" (all %s are %s cells)" % (hv.get("listed_cells"), stock_vt)) if stock_vt else "",
        wns="%d" % round(cli.ps(sapr["wnsNs"])), tns="%.3f" % sapr["tnsNs"], nvp="{:,}".format(sapr["nvp"]),
        all_paths="{:,}".format(sapr.get("allPaths") or 0),
        all_wns="%d" % round(cli.ps(all_g.get("wnsNs") or 0.0)), all_tns="%.3f" % (all_g.get("tnsNs") or 0.0),
        all_nvp="{:,}".format(all_g.get("nvp") or 0),
        groups_table=table(["Path group", "Worst slack (ps)", "TNS (ns)", "Violating paths"],
                           [(g["group"], "%d" % round(cli.ps(g["wnsNs"])), "%.3f" % g["tnsNs"], "{:,}".format(g["nvp"]))
                            for g in cli._groups(sapr) if g.get("wnsNs") is not None and g["group"] != "default"]),
        stages_table=table(["Stage", "reg2reg worst slack (ps)", "TNS (ns)", "Violating paths"],
                           [(st.get("label") or st["stage"], "%d" % round(cli.ps(st["wnsNs"])), "%.3f" % st["tnsNs"], "{:,}".format(st["nvp"]))
                            for st in sapr.get("stages") or []]),
        density="%.3f" % (sapr.get("densityPct") or 0.0), power="%.2f" % (power.get("totalMw") or 0.0),
        clock_tree=("%s clock sinks, %s clock gates, %s clock buffers and %.0f mm of clock wire (CTS)"
                    % ("{:,}".format(ct.get("sinks") or 0), "{:,}".format(ct.get("icgs") or 0), "{:,}".format(ct.get("buffers") or 0),
                       (ct.get("clockWireUm") or 0.0) / 1000.0)) if ct else "no clock-tree summary",
        worst_slack="%d" % round(cli.ps(worst.get("slackNs", 0.0))), worst_begin=worst.get("beginShort", "?"), worst_end=worst.get("endShort", "?"),
        worst_from=where(worst.get("begin", "")), worst_to=where(worst.get("end", "")),
        worst_parts=table(["Part of the worst path's data time", "ps", "share"],
                          [(p["part"], "%d" % round(cli.ps(p["ns"])), "%.1f %%" % p["pct"]) for p in parts]) if parts else "(no breakdown)",
        sram_line=data_path_words(parts, worst),
        io_line=io_words(sapr, all_g.get("wnsNs")),
        wall_ps="%d" % round(cli.ps(max(p["slackNs"] for p in timing.get("paths") or [worst]) - min(p["slackNs"] for p in timing.get("paths") or [worst]))) if worst else "0",
        max_tns="%.3f" % max((a["tnsGainNs"] or 0.0) for a in merged) if merged else "0",
        max_wns="%.1f" % (1000.0 * max((a["wnsGainNs"] or 0.0) for a in merged)) if merged else "0",
        top3wns=table(["Arc (cell, pin to pin, edge)", "What-if WNS gain (ps)", "What-if TNS gain (ns)", "Rankings naming it"],
                      [("%s %s→%s %s" % (a["cell"], a["from"], a["to"], a["edge"]), "%.1f" % (1000.0 * (a["wnsGainNs"] or 0.0)),
                        "%.3f" % (a["tnsGainNs"] or 0.0), len(a["rankedBy"])) for a in sorted(merged, key=lambda a: -(a["wnsGainNs"] or 0.0))[:3]]),
        paths_table=table(["#", "Slack (ps)", "From", "To", "End point"],
                          [(p.get("rank"), "%d" % round(cli.ps(p["slackNs"])), where(p.get("begin", "")), where(p.get("end", "")), p.get("endShort"))
                           for p in timing.get("paths") or []]),
        hv_cells=millions(hv.get("design_cells")), hv_instances=millions(hv.get("high_value_instances")), hv_lib=hv.get("lib_cells"),
        hv_listed=hv.get("listed_cells"), hv_per_rank=millions(hv.get("top_per_rank")),
        rank_types=cli.rank_words(hv.get("rank_types")),
        hv_families=", ".join("%s %s" % (f["family"], f["count"]) for f in (hv.get("families") or [])[:8]),
        rankings=len(whatif.get("rankings") or {}), ranking_keys=", ".join(whatif.get("rankings") or {}), top_n=whatif.get("top_n"),
        scale="%g" % cli.SCALE, faster_pct="%d" % round(100 * (1 - cli.SCALE)), merged=len(merged),
        top3=table(["Arc (cell, pin to pin, edge)", "What-if TNS gain (ns)", "What-if WNS gain (ps)", "Rankings naming it"],
                   [("%s %s→%s %s" % (a["cell"], a["from"], a["to"], a["edge"]), "%.3f" % (a["tnsGainNs"] or 0.0),
                     "%.1f" % (1000.0 * (a["wnsGainNs"] or 0.0)), len(a["rankedBy"])) for a in top3]),
        ql_arcs=analysis.get("arcs"), ql_cells=analysis.get("cells"), ulvt_fastest=vt.get("ulvt_fastest_count"),
        lvt_slower=cli._fmt(vt.get("lvt_slower_median_pct"), "%.1f"), svt_slower=cli._fmt(vt.get("svt_slower_median_pct"), "%.1f"),
        footprint=(analysis.get("constraints") or {}).get("footprint"), cap_ratio=(analysis.get("constraints") or {}).get("inputCapMaxRatio"),
        lvs=(analysis.get("constraints") or {}).get("lvs"),
        iterations=cli.ITERATIONS, goal="%g" % goal, goal_ps="%g" % round(goal / 100.0 * period * 1000.0, 1),
        charts="\n".join("- `charts/%s`" % name for name in chart_names),
    )
    text = re.sub(r"<!--.*?-->\n*", "", TEMPLATE.read_text(), flags=re.S)
    return string.Template(text).substitute(fields)


def main(argv):
    if len(argv) not in (2, 3):
        print(__doc__.strip().splitlines()[3].strip(), file=sys.stderr)
        return 2
    out = Path(argv[2]) if len(argv) == 3 else HERE.parent / "knowledge"
    (out / "charts").mkdir(parents=True, exist_ok=True)
    t = tool_outputs(argv[1])
    made = charts(t)
    for name, doc in made.items():
        cli.write_text(out / "charts" / name, json.dumps(doc, indent=2, sort_keys=True) + "\n")
        print("wrote %s" % (out / "charts" / name))
    cli.write_text(out / "design-notes.md", notes(t, sorted(made)))
    print("wrote %s" % (out / "design-notes.md"))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv))
    except cli.ToolError as error:
        print("knowledge_charts: %s" % error, file=sys.stderr)
        sys.exit(3)
