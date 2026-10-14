"""Design openc910: the Site's tools replay a measured full-flow data bundle.

The bundle lives in share/designs/openc910 (override: CTU_OPENC910_DATA); it is installed per
Site and never part of the toolchain's source. Layout (all JSON keys as the bundle builder writes):

  pr/pr.json                            {reference|custom: {<stage>: {groups, wns_ns, tns_ns, nvp,
                                         all_paths, drv, density_pct, overflow_pct, command, power?,
                                         worst_paths?, clock_tree? (cts)}},
                                         custom_model: {basis, stages: {cts, route}}}
                                         stages: prePlace, place, cts, route; the custom build's
                                         cts and route come from custom_model
  pr/{reference,custom}/*.rpt|*.tarpt   the builds' report text
  himatime/high_value.json, high_value_cells.rpt
  himatime/whatif.json, whatif/cell_what_if_sort_by_<KEY>.rpt
  himatime/arc_list.json                the union of the what-if rankings' arcs
  andescell/results.json                generation counts, per-arc versions, delivered arcs
  qualib/stock_arcs.json                stock arc facts per Vt flavour

Every number a tool prints in openc910 mode comes from this bundle; this module only selects,
merges and reshapes it (python3 stdlib only).
"""
import os
import re
import statistics
from pathlib import Path

from .common import SHARE, ToolError, read_json

DESIGN = "openc910"
GROUP = "reg2reg"
RESULT_STAGE = "route"
# (stage id, label, bundle key): the flow's stages in order
FLOW = (("prePlace", "prePlace", "prePlace"), ("place_opt", "place_opt", "place"), ("cts", "CTS", "cts"), ("route", "route", "route"))
MODELLED_STAGES = ("cts", "route")
SRAM_PREFIX = "ct_"
SCREEN_LIMITS = dict(areaRatioMax=1.0, inputCapRatioMax=1.30, lvs="match")
CONSTRAINTS = dict(footprint="same area and pins as the stock cell", inputCapMaxRatio=SCREEN_LIMITS["inputCapRatioMax"], lvs="match")
SUMMARY_SCHEMA = "ctu-sapr-summary/2"
REPORTS = ("prePlace.summary.rpt", "place.summary.rpt", "cts.summary.rpt", "route.summary.rpt", "place_reg2reg.tarpt",
           "cts_reg2reg.tarpt", "route_reg2reg.tarpt", "cts.sum.rpt", "place.power.rpt", "route.power.rpt", "place.congestion.rpt",
           "route.congestion.rpt")
RENDERED_REPORTS = ("cts.summary.rpt", "route.summary.rpt", "cts_reg2reg.tarpt", "route_reg2reg.tarpt")


def data_dir(override=None):
    if override:
        return Path(override)
    env = os.environ.get("CTU_OPENC910_DATA")
    return Path(env) if env else SHARE / "designs" / DESIGN


class Bundle:
    """The installed openc910 data bundle; files are read on first use."""

    def __init__(self, root=None):
        self.root = data_dir(root)
        if not (self.root / "pr" / "pr.json").is_file():
            raise ToolError("design data openc910 is not installed on this Site")
        self._cache = {}

    def json(self, rel):
        if rel not in self._cache:
            self._cache[rel] = read_json(self.root / rel, "design data file %s" % rel)
        return self._cache[rel]

    def text(self, rel):
        path = self.root / rel
        if not path.is_file():
            raise ToolError("design data file %s is missing on this Site" % rel)
        return path.read_text()

    @property
    def pr(self):
        return self.json("pr/pr.json")

    @property
    def high_value(self):
        return self.json("himatime/high_value.json")

    @property
    def whatif(self):
        return self.json("himatime/whatif.json")

    @property
    def results(self):
        return self.json("andescell/results.json")

    @property
    def stock_arcs(self):
        return self.json("qualib/stock_arcs.json")

    def all_arcs(self):
        return [arc_key(a) for a in self.json("himatime/arc_list.json")["arcs"]]

    def stage(self, build, stage):
        try:
            return self.pr[build][stage]
        except KeyError:
            raise ToolError("design data has no %s stage for the %s build" % (stage, build))

    def clock_period_ns(self):
        """The clock period the builds were timed at: required + setup + uncertainty of a path."""
        p = self.stage("reference", "place")["worst_paths"][0]
        return round(p["required_ns"] + p["setup_ns"] + p["uncertainty_ns"], 3)

    def clock_name(self):
        m = re.search(r"edge of '([^']+)'", self.text("pr/reference/place_reg2reg.tarpt"))
        return m.group(1) if m else "clk"

    def delivered(self):
        return set(self.results["delivered"])

    def rows(self):
        return {r["arc"]: r for r in self.results["arcs"]}


# ---- arcs ----------------------------------------------------------------------------------

def arc_key(a):
    return (a["cell"], a["from"], a["to"], a["edge"])


def arc_name(a):
    cell, frm, to, edge = arc_key(a) if isinstance(a, dict) else a
    return "%s_%s_%s_%s" % (cell, frm, to, edge)


def arc_dict(key):
    return dict(cell=key[0], **{"from": key[1]}, to=key[2], edge=key[3])


def family_of(cell):
    """Cell family: the name before its last drive token D<n> (e.g. ND2D2X -> ND2)."""
    if not cell:
        return "-"
    if cell.startswith(SRAM_PREFIX):
        return "SRAM"
    last = None
    for m in re.finditer(r"D\d+", cell):
        last = m
    return cell[:last.start()] if last and last.start() > 0 else cell


def load_arc_file(path):
    """An arc list: {"arcs": [...]}, a what-if result {"merged": [...]}, or a bare list."""
    doc = read_json(path, "arc list")
    items = doc if isinstance(doc, list) else (doc.get("arcs") or doc.get("merged")) if isinstance(doc, dict) else None
    if not isinstance(items, list) or not items:
        raise ToolError("arc list %s has no arcs (expected {\"arcs\": [{cell, from, to, edge}, ...]})" % path)
    keys = []
    for i, a in enumerate(items):
        if not isinstance(a, dict) or not all(isinstance(a.get(k), str) for k in ("cell", "from", "to", "edge")):
            raise ToolError("arc %d of %s needs cell, from, to and edge" % (i + 1, path))
        if arc_key(a) not in keys:
            keys.append(arc_key(a))
    return keys


def check_known(bundle, keys):
    known = set(bundle.all_arcs())
    unknown = [arc_name(k) for k in keys if k not in known]
    if unknown:
        raise ToolError("%d arc(s) are not in the design's what-if arc list: %s%s" % (
            len(unknown), ", ".join(unknown[:8]), " ..." if len(unknown) > 8 else ""))


# ---- design db (a sapr output directory) ---------------------------------------------------

def is_db(path):
    summary = Path(path) / "sapr_summary.json"
    if not summary.is_file():
        return False
    try:
        return read_json(summary, "sapr summary").get("design") == DESIGN
    except ToolError:
        return False


def load_db(path):
    d = Path(path)
    s = read_json(d / "sapr_summary.json", "sapr summary (run sapr first)")
    if s.get("schema") != SUMMARY_SCHEMA or s.get("design") != DESIGN:
        raise ToolError("%s is not a sapr build of design %s" % (d, DESIGN))
    return d, s, Bundle(s.get("designRoot"))


# ---- deliveries (AndesCell output, HimaTime kept/) -----------------------------------------

def is_delivery(path):
    d = Path(path) / "cells"
    return d.is_dir() and any(d.glob("*.lib"))


def delivery_arcs(path):
    d = Path(path)
    stubs = sorted((d / "cells").glob("*.lib")) if (d / "cells").is_dir() else []
    if not stubs:
        raise ToolError("%s is not an AndesCell delivery for design %s (no cells/<arc>.lib)" % (d, DESIGN))
    return [p.stem for p in stubs]


def stub_text(row, round_k, version_line):
    best = row["best"]
    return "\n".join([
        "/* %s */" % version_line,
        "/* design %s, round %s: custom cell for arc %s %s->%s %s */" % (DESIGN, round_k, row["cell"], row["from"], row["to"], row["edge"]),
        "cell (%s) {" % row["arc"],
        "  /* custom cell, version %d */" % best["version"],
        "}", ""])


# ---- sapr: the full flow (prePlace, place_opt, CTS, route) ----------------------------------

def stage_data(bundle, build, key):
    """One flow stage of a build. The custom build's CTS and route stages come from the bundle's
    `custom_model` (its timing carries the measured placement-stage change forward)."""
    if build == "custom" and key in MODELLED_STAGES:
        try:
            return bundle.pr["custom_model"]["stages"][key]
        except KeyError:
            raise ToolError("design data has no %s stage for the custom build" % key)
    return bundle.stage(build, key)


def _num(v, integer=False):
    if v is None:
        return None
    return int(round(v)) if integer else v


def _group_facts(st):
    return {g: dict(wnsNs=_num(st["wns_ns"].get(g)), tnsNs=_num(st["tns_ns"].get(g)), nvp=_num(st["nvp"].get(g), True),
                    allPaths=_num(st["all_paths"].get(g), True)) for g in st["groups"]}


def _tail(pin_path):
    parts = pin_path.split("/")
    return parts[-2] if len(parts) >= 2 else parts[-1]


def short_paths(paths):
    out = []
    for i, p in enumerate(paths):
        row = dict(rank=i + 1, slackNs=p["slack_ns"], group=p.get("group", GROUP), begin=p["begin"], end=p["end"],
                   beginShort=_tail(p["begin"]), endShort=_tail(p["end"]))
        if "reference_slack_ns" in p:
            row["referenceSlackNs"] = p["reference_slack_ns"]
        out.append(row)
    return out


def build_summary(bundle, build):
    """sapr_summary.json content of a full-flow build (`reference` or `custom`), at route."""
    final = stage_data(bundle, build, RESULT_STAGE)
    groups = _group_facts(final)
    g = groups[GROUP]
    power = final.get("power") or {}
    stages = []
    for sid, label, key in FLOW:
        s = stage_data(bundle, build, key)
        stages.append(dict(stage=sid, label=label, wnsNs=_num(s["wns_ns"].get(GROUP)), tnsNs=_num(s["tns_ns"].get(GROUP)),
                           nvp=_num(s["nvp"].get(GROUP), True)))
    ct = stage_data(bundle, build, "cts").get("clock_tree") or {}
    clock_tree = dict(buffers=_num(ct.get("buffers"), True), inverters=_num(ct.get("inverters"), True), icgs=_num(ct.get("icgs"), True),
                      sinks=_num(ct.get("sinks"), True), clockWireUm=ct.get("clock_wire_um")) if ct else None
    basis = bundle.pr.get("custom_model", {}).get("basis") if build == "custom" else None
    io = io_budget(bundle)
    return dict(schema=SUMMARY_SCHEMA, design=DESIGN, build=build, stage=RESULT_STAGE, clockPeriodNs=bundle.clock_period_ns(),
                clock=bundle.clock_name(), group=GROUP, wnsNs=g["wnsNs"], tnsNs=g["tnsNs"], nvp=g["nvp"], allPaths=g["allPaths"],
                groups=groups, pathGroups=[dict(group=k, **groups[k]) for k in final["groups"]],
                densityPct=final.get("density_pct"), overflowPct=list(final["overflow_pct"]) if final.get("overflow_pct") else None,
                drv=final.get("drv"),
                power=dict(totalMw=round(power["total_mw"], 3), internalMw=round(power["internal_mw"], 3),
                           switchingMw=round(power["switching_mw"], 3), leakageMw=round(power["leakage_mw"], 3)) if power else None,
                customCells=int(power.get("custom_cells") or 0), customCellsPct=power.get("custom_cells_pct") or 0.0,
                libraries=power.get("libraries"), clockTree=clock_tree, stages=stages,
                worstPaths=short_paths(final.get("worst_paths") or []), instances=None, basis=basis, command=final.get("command"),
                ioBudget=io)


def io_budget(bundle):
    """The block SDC's output-delay budget and the worst reg2out path it sets, when the bundle has it."""
    if not (bundle.root / "pr" / "io_budget.json").is_file():
        return None
    b = bundle.json("pr/io_budget.json")
    w = b.get("worst_reg2out") or {}
    return dict(outputDelayPorts=b.get("output_delay_ports"), outputDelayNs=b.get("output_delay_max_ns"), outputClock=b.get("output_delay_clock"),
                portGroups=[dict(prefix=k, ports=n) for k, n in b.get("port_groups") or []],
                worstReg2out=dict(endpoint=w.get("endpoint"), externalDelayNs=w.get("external_delay_ns"), requiredNs=w.get("required_ns"),
                                  arrivalNs=w.get("arrival_ns"), slackNs=w.get("slack_ns")) if w else None)


def timing_gain_pct(new_wns_ns, ref_wns_ns, period_ns):
    return round(100.0 * (new_wns_ns - ref_wns_ns) / period_ns, 3)


def flow_summary_text(summary):
    lines = ["  %-12s %10s %12s %16s" % ("stage", "WNS (ps)", "TNS (ns)", "violating paths"), "  " + "-" * 54]
    for s in summary["stages"]:
        lines.append("  %-12s %10.0f %12.3f %16d" % (s["label"], 1000 * s["wnsNs"], s["tnsNs"], s["nvp"]))
    lines += ["", "  Path group %s, clock %s %.3f ns. prePlace times the netlist before placement; place_opt, CTS"
              % (summary["group"], summary["clock"], summary["clockPeriodNs"]),
              "  (optDesign -postCTS) and route (optDesign -postRoute) end with the optimized design.", ""]
    return "\n".join(lines)


def _center(text, width):
    pad = max(0, width - len(text))
    return " " * (pad // 2) + text + " " * (pad - pad // 2)


def _header(text, command):
    """The lines of a report before its first table or path, with the Command line set."""
    out = []
    for line in text.splitlines():
        if line.startswith("+") or line.startswith("Path 1:"):
            break
        if line.startswith("#  Command:") and command:
            line = "#  Command:           %s" % command
        out.append(line)
    return "\n".join(out) + "\n"


def summary_rpt_text(bundle, build, key):
    """An optDesign summary report of a stage, in the layout of the reference build's report."""
    st = stage_data(bundle, build, key)
    ref = bundle.text("pr/reference/%s.summary.rpt" % key)
    m = re.search(r"^\|([A-Za-z]\w+) *\|", ref, re.M)
    view = m.group(1) if m else "default_view"
    groups = st["groups"]
    sep = "+" + "-" * 20 + ("+" + "-" * 9) * len(groups) + "+"

    def cells(field):
        out = []
        for gname in groups:
            v = st[field].get(gname)
            if v is None:
                out.append("N/A")
            elif field in ("wns_ns", "tns_ns"):
                out.append("%.3f" % v)
            elif field == "all_paths" and v >= 1e5:
                out.append("%.2e" % v)
            else:
                out.append("%d" % round(v))
        return out

    rows = [("WNS (ns):", cells("wns_ns")), ("TNS (ns):", cells("tns_ns")), ("Violating Paths:", cells("nvp")), ("All Paths:", cells("all_paths"))]
    line = lambda label, vals: "|" + label + "|" + "|".join(_center(v, 9) for v in vals) + "|"
    t = [sep, line(_center("Setup mode", 20), groups), sep]
    t += [line(label.rjust(20), vals) for label, vals in rows]
    t.append(sep)
    t += [line((view if i == 0 else "").ljust(20), vals) for i, (_, vals) in enumerate(rows)]
    t += [sep, ""]
    d = "+" + "-" * 16 + "+" + "-" * 18 + "+" + "-" * 12 + "+" + "-" * 18 + "+"
    t += ["+" + "-" * 16 + "+" + "-" * 31 + "+" + "-" * 18 + "+", "|                |              Real             |       Total      |",
          "|    DRVs        +" + "-" * 18 + "+" + "-" * 12 + "+" + "-" * 18 + "|",
          "|" + " " * 16 + "|" + _center("Nr nets(terms)", 18) + "|" + _center("Worst Vio", 12) + "|" + _center("Nr nets(terms)", 18) + "|", d]
    for name in ("max_cap", "max_tran", "max_fanout", "max_length"):
        v = (st.get("drv") or {}).get(name) or dict(nets=0, terms=0, worst=0)
        nets = "%d (%d)" % (v["nets"], v["terms"])
        worst = "%.3f" % v["worst"] if name in ("max_cap", "max_tran") else "%d" % round(v["worst"])
        t.append("|   %-13s|%s|%s|%s|" % (name, _center(nets, 18), _center(worst, 12), _center(nets, 18)))
    t += [d, "", "Density: %.3f%%" % st["density_pct"]]
    if st.get("overflow_pct"):
        t.append("Routing Overflow: %.2f%% H and %.2f%% V" % tuple(st["overflow_pct"][:2]))
    t += ["-" * 66, ""]
    return _header(ref, st.get("command")) + "\n".join(t)


def short_tarpt_text(bundle, build, key):
    """A timing report of a stage's worst paths: path, slack, begin and end points, path group."""
    st = stage_data(bundle, build, key)
    ref = bundle.text("pr/reference/%s_reg2reg.tarpt" % key)
    out = [_header(ref, st.get("command"))]
    for p in short_paths(st.get("worst_paths") or []):
        out.append("Path %d: %s Setup Check\nEndpoint:   %s\nBeginpoint: %s\nPath Groups: {%s}\n= Slack Time %14.3f\n\n"
                   % (p["rank"], "VIOLATED" if p["slackNs"] < 0 else "MET", p["end"], p["begin"], p["group"], p["slackNs"]))
    return "".join(out)


def build_reports(bundle, build):
    """{report name: text} of a build's flow reports (only those the Site has data for)."""
    out = {}
    for name in REPORTS:
        if build == "custom" and name in RENDERED_REPORTS:
            key = name.split(".")[0].split("_")[0]
            out[name] = summary_rpt_text(bundle, build, key) if name.endswith(".summary.rpt") else short_tarpt_text(bundle, build, key)
        elif (bundle.root / "pr" / build / name).is_file():
            out[name] = bundle.text("pr/%s/%s" % (build, name))
    return out


# ---- himatime: timing of a build -----------------------------------------------------------

def data_stages(p):
    """The path's stages up to its endpoint, and the index of its begin point."""
    st = p["stages"]
    bpin = p["begin"].rsplit("/", 1)[-1]
    epin = p["end"].rsplit("/", 1)[-1]
    b = next((i for i, s in enumerate(st) if s["pin"] == bpin), 0)
    e = next((i for i, s in enumerate(st) if i > b and s["pin"] == epin), len(st) - 1)
    return st[:e + 1], b


def _parts(p):
    """A path's arrival by part: launch clock network, SRAM access, each cell family, nets. Each
    stage counts its arrival minus the previous stage's, so the parts add up to the arrival."""
    st, b = data_stages(p)
    clock = st[b - 1]["arrival_ns"] if b > 0 else 0.0
    prev = clock
    parts = {}
    for s in st[b:]:
        ns = s["arrival_ns"] - prev
        prev = s["arrival_ns"]
        if s["kind"] == "net":
            k = "nets"
        else:
            k = "SRAM access" if s["cell"].startswith(SRAM_PREFIX) else family_of(s["cell"])
        parts[k] = parts.get(k, 0.0) + ns
    return clock, parts, st


def path_row(rank, p):
    if not p.get("stages"):
        return dict(short_paths([p])[0], rank=rank)
    clock, parts, st = _parts(p)
    sram = parts.pop("SRAM access", 0.0)
    net = parts.pop("nets", 0.0)
    row = short_paths([p])[0]
    row.update(rank=rank, arrivalNs=p["arrival_ns"], requiredNs=p["required_ns"], clockNs=round(clock, 3), sramNs=round(sram, 3),
               cellNs=round(sum(parts.values()), 3), netNs=round(net, 3), stages=st)
    return row


def breakdown(p):
    """The worst path's data time by part (ns and % of the data path: arrival less the launch clock latency)."""
    if not p.get("stages"):
        return []
    clock, parts, _ = _parts(p)
    sram = parts.pop("SRAM access", 0.0)
    net = parts.pop("nets", 0.0)
    # The data path only: the launch clock's latency is matched by the capture clock's, so it is not
    # time the path spends (path rows keep it as clockNs).
    rows = [("SRAM access", sram)] if round(sram, 3) else []
    rows += sorted(((k, v) for k, v in parts.items() if round(v, 3) > 0), key=lambda kv: (-kv[1], kv[0]))
    rows.append(("nets", net))
    total = (p["arrival_ns"] - clock) or 1.0
    return [dict(part=k, ns=round(v, 3), pct=round(100.0 * v / total, 1)) for k, v in rows]


def timing_summary(bundle, build):
    st = stage_data(bundle, build, RESULT_STAGE)
    worst = st.get("worst_paths") or []
    paths = [path_row(i + 1, p) for i, p in enumerate(worst)]
    return dict(schema="ctu-himatime-timing/2", design=DESIGN, build=build, stage=RESULT_STAGE, clockPeriodNs=bundle.clock_period_ns(),
                clock=bundle.clock_name(), group=GROUP, wnsNs=st["wns_ns"][GROUP], tnsNs=st["tns_ns"][GROUP],
                nvp=_num(st["nvp"][GROUP], True), paths=paths, breakdown=breakdown(worst[0]) if worst else [])


def timing_report_text(bundle, build, n):
    if build == "custom":
        return short_tarpt_text(bundle, build, RESULT_STAGE)
    return tarpt_paths(bundle.text("pr/%s/%s_reg2reg.tarpt" % (build, RESULT_STAGE)), n)


def tarpt_paths(text, n):
    """The first n `Path K:` blocks of a timing report, with whatever precedes Path 1."""
    starts = [m.start() for m in re.finditer(r"^Path \d+:", text, re.M)]
    if not starts:
        return text
    end = starts[n] if len(starts) > n else len(text)
    return text[:end].rstrip() + "\n"


def summary_text(s):
    return ("Design %s  stage %s  clock %s %.3f ns  path group %s\n  WNS %.0f ps   TNS %.3f ns   violating paths %d\n" % (
        DESIGN, s["stage"], s["clock"], s["clockPeriodNs"], s["group"], 1000 * s["wnsNs"], s["tnsNs"], s["nvp"]))


def paths_text(s):
    ps = lambda v: "-" if v is None else "%.0f" % (1000 * v)
    lines = ["  %-4s %10s %-36s %-40s %8s %8s %8s %8s" % ("rank", "slack ps", "begin", "end", "clock ps", "SRAM ps", "cell ps", "net ps"),
             "  " + "-" * 132]
    for p in s["paths"]:
        lines.append("  %-4d %10.0f %-36s %-40s %8s %8s %8s %8s" % (p["rank"], 1000 * p["slackNs"], p["beginShort"][:36], p["endShort"][:40],
                                                                  ps(p.get("clockNs")), ps(p.get("sramNs")), ps(p.get("cellNs")), ps(p.get("netNs"))))
    return "\n".join(lines) + "\n"


def breakdown_text(s):
    if not s["paths"] or not s["breakdown"]:
        return "No stage detail for the worst path of this build.\n"
    w = s["paths"][0]
    lines = ["Worst %s path: %s -> %s, arrival %.0f ps, slack %.0f ps" % (s["group"], w["beginShort"], w["endShort"], 1000 * w["arrivalNs"], 1000 * w["slackNs"]),
             "Data path %.0f ps (arrival less %.0f ps of launch clock latency, which the capture clock matches)."
             % (1000 * (w["arrivalNs"] - (w.get("clockNs") or 0.0)), 1000 * (w.get("clockNs") or 0.0)),
             "", "  %-24s %10s %8s" % ("part", "ps", "share %"), "  " + "-" * 44]
    for b in s["breakdown"]:
        lines.append("  %-24s %10.0f %8.1f" % (b["part"], 1000 * b["ns"], b["pct"]))
    return "\n".join(lines) + "\n"


# ---- himatime: high-value cells and what-if --------------------------------------------------

def high_value_result(bundle, top_families=10):
    hv = bundle.high_value
    fams = [dict(family=f, count=c) for f, c in hv.get("families") or []]
    return dict(schema="ctu-himatime-highvalue/1", design=DESIGN, design_cells=hv["design_cells"], top_per_rank=hv["top_per_rank"],
                high_value_instances=hv["high_value_instances"], lib_cells=hv["lib_cells"], rank_types=hv["rank_types"],
                listed_cells=hv["listed_cells"], families=fams[:top_families], family_count=len(fams), cells=list(hv.get("cells") or []))


def merge_rankings(rankings, keys):
    """Union of the rankings' arcs: ordered by how many rankings name an arc (desc), then first seen."""
    seen, order = {}, []
    for k in keys:
        for row in rankings[k]:
            for edge in row.get("edges") or []:
                key = (row["cell"], row["from"], row["to"], edge)
                if key not in seen:
                    seen[key] = []
                    order.append(key)
                if k not in seen[key]:
                    seen[key].append(k)
    ranked = sorted(order, key=lambda key: (-len(seen[key]), order.index(key)))
    return [dict(arc_dict(key), rankedBy=seen[key]) for key in ranked]


def whatif_result(bundle, scale, top, keys=None):
    wi = bundle.whatif
    if abs(scale - wi["scale"]) > 1e-9 or top != wi["top_n"]:
        raise ToolError("the Site has what-if data for scale %g, top %d" % (wi["scale"], wi["top_n"]))
    available = list(wi["rankings"])
    keys = keys or available
    bad = [k for k in keys if k not in available]
    if bad:
        raise ToolError("unknown --sort key(s) %s (keys: %s)" % (", ".join(bad), ", ".join(available)))
    merged = merge_rankings(wi["rankings"], keys)
    return dict(schema="ctu-himatime-whatif/1", design=DESIGN, scale=wi["scale"], top_n=wi["top_n"],
                rankings={k: wi["rankings"][k] for k in keys}, merged=merged, merged_count=len(merged))


# ---- qualib --------------------------------------------------------------------------------

def stock_rows(bundle, keys=None, cells=None):
    rows = bundle.stock_arcs["arcs"]
    if keys is not None:
        index = {arc_key(r): r for r in rows}
        missing = [arc_name(k) for k in keys if k not in index]
        if missing:
            raise ToolError("no stock facts for %d arc(s): %s" % (len(missing), ", ".join(missing[:8])))
        return [index[k] for k in keys]
    if cells is not None:
        have = {r["cell"] for r in rows}
        missing = [c for c in cells if c not in have]
        if missing:
            raise ToolError("cell(s) not in the stock arc data: %s" % ", ".join(missing))
        return [r for r in rows if r["cell"] in cells]
    return rows


def fastest_vt(row):
    vts = [v for v in ("ULVT", "LVT", "SVT") if (row.get(v) or {}).get("delay_ns") is not None]
    return min(vts, key=lambda v: row[v]["delay_ns"]) if vts else None


def arc_row(row):
    out = dict(arc_dict(arc_key(row)), arc=arc_name(row), family=family_of(row["cell"]), fastestVt=fastest_vt(row))
    for vt in ("ULVT", "LVT", "SVT"):
        v = row.get(vt) or {}
        out[vt.lower()] = dict(delayPs=None if v.get("delay_ns") is None else round(1000 * v["delay_ns"], 2),
                               areaUm2=v.get("area_um2"), inputCapPf=v.get("input_cap_pf"), slewNs=v.get("slew_ns"), loadPf=v.get("load_pf"))
    return out


def vt_summary(rows):
    def slower(vt):
        vals = [100.0 * (r[vt]["delay_ns"] / r["ULVT"]["delay_ns"] - 1) for r in rows
                if (r.get(vt) or {}).get("delay_ns") and (r.get("ULVT") or {}).get("delay_ns")]
        return round(statistics.median(vals), 2) if vals else None
    return dict(ulvt_fastest_count=sum(1 for r in rows if fastest_vt(r) == "ULVT"),
                lvt_slower_median_pct=slower("LVT"), svt_slower_median_pct=slower("SVT"))


def library_analysis(bundle, keys):
    rows = stock_rows(bundle, keys=keys)
    fams = {}
    for r in rows:
        f = fams.setdefault(family_of(r["cell"]), dict(arcs=0, cells=set()))
        f["arcs"] += 1
        f["cells"].add(r["cell"])
    families = [dict(family=f, arcs=v["arcs"], cells=len(v["cells"])) for f, v in sorted(fams.items(), key=lambda kv: (-kv[1]["arcs"], kv[0]))]
    return dict(schema="ctu-qualib-analysis/2", design=DESIGN, arcs=len(rows), cells=len({r["cell"] for r in rows}), vt=vt_summary(rows),
                families=families, constraints=dict(CONSTRAINTS), arcRows=[arc_row(r) for r in rows],
                note=bundle.stock_arcs.get("note"))


def screen_rows(bundle, arcs):
    rows_by_arc = bundle.rows()
    out = []
    for name in arcs:
        r = rows_by_arc.get(name)
        lib = (r or {}).get("library")
        best = (r or {}).get("best") or {}
        reasons = []
        area = cap = None
        if lib:
            area = round(lib["area_custom_um2"] / lib["area_stock_um2"], 3)
            cap = round(lib["input_cap_custom_pf"] / lib["input_cap_stock_pf"], 3)
            if area > SCREEN_LIMITS["areaRatioMax"] + 1e-9:
                reasons.append("area %.3fx stock > %.2fx (footprint)" % (area, SCREEN_LIMITS["areaRatioMax"]))
            if cap > SCREEN_LIMITS["inputCapRatioMax"] + 1e-9:
                reasons.append("input cap %.3fx stock > %.2fx" % (cap, SCREEN_LIMITS["inputCapRatioMax"]))
        else:
            reasons.append("no characterized library view for this cell")
        lvs = "match" if best.get("lvs_pass") else "mismatch"
        if lvs != "match":
            reasons.append("LVS not matched")
        out.append(dict(arc=name, cell=(r or {}).get("cell"), family=family_of((r or {}).get("cell") or name), edge=(r or {}).get("edge"),
                        version=best.get("version"), areaRatio=area, inputCapRatio=cap, lvs=lvs,
                        status="PASS" if not reasons else "FAIL", reasons=reasons))
    return out


# ---- andescell -----------------------------------------------------------------------------

def generation(bundle, keys):
    """Counts and per-arc rows of a generation of the requested arcs (a subset of the bundle's)."""
    res = bundle.results
    rows = bundle.rows()
    names = [arc_name(k) for k in keys]
    failed_known = [n for n in names if n in rows and not rows[n].get("versions_kept")]
    all_known_failed = [a["arc"] for a in res["arcs"] if not a.get("versions_kept")]
    if set(keys) == set(bundle.all_arcs()):
        generated, failed = res["generated"], res["failed"]
    else:
        failed = len(failed_known)
        generated = len(names) - failed
    data = []
    for n in names:
        r = rows.get(n)
        if r and r.get("versions_kept"):
            data.append(dict(arc=n, cell=r["cell"], **{"from": r["from"]}, to=r["to"], edge=r["edge"], family=family_of(r["cell"]),
                             versions=r["versions_kept"], best=r["best"]))
    return dict(requested=len(names), generated=generated, failed=failed,
                failedKnown=[n for n in all_known_failed if n in set(names)], arcs=data)


def cell_check(bundle, generated, stub_arcs):
    rows = bundle.rows()
    delivered = bundle.delivered()
    cells = []
    for name in stub_arcs:
        r = rows.get(name)
        if not r or not r.get("best"):
            continue
        best = r["best"]
        lib = r.get("library") or {}
        cap = (round(100.0 * (lib["input_cap_custom_pf"] / lib["input_cap_stock_pf"] - 1), 1)
               if lib.get("input_cap_stock_pf") and lib.get("input_cap_custom_pf") is not None else None)
        cells.append(dict(arc=name, cell=r["cell"], family=family_of(r["cell"]), edge=r["edge"], bestVersion=best["version"],
                          delayPs=round(1000 * best["delay_ns"], 3), delta=best["delta"], inputCapChangePct=cap, kept=name in delivered))
    kept = [c for c in cells if c["kept"]]
    by_fam = {}
    for c in kept:
        by_fam[c["family"]] = by_fam.get(c["family"], 0) + 1
    return dict(schema="ctu-himatime-cellcheck/1", design=DESIGN, generated=generated, kept=len(kept), dropped=generated - len(kept),
                cells=cells, keptByFamily=[dict(family=f, count=n) for f, n in sorted(by_fam.items(), key=lambda kv: (-kv[1], kv[0]))])
