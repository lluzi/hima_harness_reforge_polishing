#!/usr/bin/env python3
"""Deterministic steps of the andes-cell-fmax Pack (python3, stdlib only).

Every number this file writes comes from a tool's own output (sapr, himatime, qualib, andescell),
never from model text. The tools are the Site's toolchain bound as edaRoot; for design openc910
they replay a measured full-flow data bundle (prePlace, place_opt, CTS, route); every build's
result is its timing at the end of route, path group reg2reg.

  bind       <WS> <EDA_ROOT> <DESIGN_ROOT> <LIBRARY>   tool versions and the design data
  reference  <WS> <TIMEOUT_MIN>        the full flow on the stock libraries (the reference build)
  timing     <WS>                      load the latest build into HimaTime (start of a round)
  requirements <WS> <AGENT>            check state/<AGENT>-requirements.json (agent delivery)
  delivery   <WS> <KIND>               check a delivery of the AndesCell agent (andescell) or of a
                                       verify agent (himatime-verify, qualib-screen)
  draft      <WS> <KIND> [<TOOL_JSON>] print a delivery skeleton filled from the tool's own JSON;
                                       the agent adds its summary and analysis
  precheck   <WS> <KIND> <FILE> [<OWN_WORKSPACE>]   an agent's own check before delivery; KIND is
                                       himatime, qualib, andescell, himatime-verify or qualib-screen
  generate   <WS>                      AndesCell on exactly the generation plan's arcs
  build      <WS> <TIMEOUT_MIN>        the full flow with the stock libraries + the accepted cells
  compare    <WS>                      round record, lessons, cumulative library and summary

All output goes under <WS>. The EDA root and the design data are read-only. Every step leaves the
reports a person reads at <WS>/reports/<node id>/r<k>/; the resident agents deliver theirs to the
same place (their artifactPrefix is reports/<node id>).
"""
import hashlib
import json
import os
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path, PurePosixPath

DESIGN = "openc910"
GROUP = "reg2reg"
STAGE = "route"
ITERATIONS = 50            # AndesCell iterations per arc (the Site's generation data)
SCALE = 0.9                # arc delay target: 10 % faster (the what-if scale and the AndesCell target)
AGENTS = ("himatime", "qualib")
REQUIREMENTS_SCHEMA = "hima-andes-requirements/2"
PLAN_SCHEMA = "hima-andes-plan/2"
CELL_CHECK_SCHEMA = "hima-andes-cell-check/1"
CELL_SCREEN_SCHEMA = "hima-andes-cell-screen/2"
ROUND_SCHEMA = "hima-andes-round/2"
BUILD_SCHEMA = "hima-andes-build/2"
TIMING_SCHEMA = "hima-andes-timing/2"
GENERATION_SCHEMA = "hima-andes-generation/2"
# The graph's node ids: reports land at reports/<node id>/r<k>/.
AGENT_NODES = {"himatime": "himatime-agent", "qualib": "qualib-agent"}
PLAN_NODE = "andescell-agent"
CHECK_KINDS = ("himatime-verify", "qualib-screen")
KINDS = AGENTS + ("andescell",) + CHECK_KINDS
GAIN_TOLERANCE_NS = 0.0005   # an agent's what-if gain agrees with HimaTime's within this
IMPROVE_EPS_PS = 0.5         # a build is better than another when its worst slack is this much higher
TOOLS = ("sapr", "himatime", "qualib", "andescell", "xtop")
DESIGN_FILES = ("pr/pr.json", "himatime/high_value.json", "himatime/whatif.json", "himatime/arc_list.json",
                "andescell/results.json", "qualib/stock_arcs.json")
CLAIM_BOUNDARY = ("Every EDA result in this Pack is replayed by mock tools on a demo Site (mock EDA) from measured flow data; "
                  "a custom-cell build's CTS and route timing follow the Site's stated basis (see the build's basis); "
                  "not signoff, not silicon.")
# What a report the App shows says instead (round-<k>.md, the charts): the same boundary in plain words.
SHOWN_BOUNDARY = "These are results on the demo Site eda_cluster_ctu_01, not signoff and not silicon."
STAGE_WORDS = "The timing is at the end of route, path group reg2reg."
CHART_SCHEMA = "hima-chart/1"


class ToolError(Exception):
    pass


# ---------------------------------------------------------------- small helpers

def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def read_json(path, what=None):
    try:
        with open(path) as stream:
            return json.load(stream)
    except FileNotFoundError:
        raise ToolError("%s not found: %s" % (what or "file", path))
    except ValueError as error:
        raise ToolError("%s is not valid JSON (%s)" % (what or path, error))


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w") as stream:
        json.dump(value, stream, indent=2, sort_keys=True)
        stream.write("\n")
    os.replace(tmp, path)


def write_text(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text)
    os.replace(tmp, path)


def now():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def state(ws, name):
    return Path(ws) / "state" / name


def rel(ws, path):
    return os.path.relpath(str(path), str(ws))


def fresh_dir(base):
    """A new, absent directory: base, or base.attempt-<n> when an earlier attempt left base."""
    base = Path(base)
    if not base.exists():
        return base
    n = 2
    while Path("%s.attempt-%d" % (base, n)).exists():
        n += 1
    return Path("%s.attempt-%d" % (base, n))


def ps(ns):
    return None if ns is None else round(1000.0 * ns, 3)


def report_dir(ws, node, k):
    return Path(ws) / "reports" / node / ("r%d" % k)


def round_dir(ws, k):
    return Path(ws) / "runs" / ("r%d" % k)


def publish_reports(ws, node, k, build_dir):
    """Every report a build wrote (its reports/ folder) to reports/<node>/r<k>/."""
    d = Path(build_dir) / "reports"
    publish(ws, node, k, [(f, f.name) for f in sorted(d.iterdir()) if f.is_file()] if d.is_dir() else [])


def publish(ws, node, k, files):
    """Copy a tool's human-readable reports to reports/<node>/r<k>/ (files: [(source, name)])."""
    d = report_dir(ws, node, k)
    d.mkdir(parents=True, exist_ok=True)
    for source, name in files:
        if Path(source).is_file():
            tmp = d / (name + ".tmp")
            shutil.copyfile(str(source), str(tmp))
            os.replace(tmp, d / name)


def _fmt(value, spec="%.2f"):
    return "n/a" if value is None else spec % value


def _version(doc):
    """'4.2.0' from a tool line such as 'HimaTime static timing analysis (himatime) version 4.2.0, linux64'."""
    m = re.search(r"version ([^ ,]+)", str(doc.get("tool") or ""))
    return m.group(1) if m else ""


def arc_key(a):
    return (a.get("cell"), a.get("from"), a.get("to"), a.get("edge"))


def arc_name(a):
    return "%s_%s_%s_%s" % (arc_key(a) if isinstance(a, dict) else a)


def plain_arc(a):
    return {"cell": a["cell"], "from": a["from"], "to": a["to"], "edge": a["edge"]}


def is_arc(a):
    return isinstance(a, dict) and all(isinstance(a.get(k), str) and a[k] for k in ("cell", "from", "to", "edge"))


# ---------------------------------------------------------------- chart labels

def common_suffix(names):
    """The library suffix every cell name shares (e.g. a track/Vt tag), so a chart label keeps the
    part that differs. Never cuts into a drive strength: leading digits stay with the name."""
    names = [n for n in names if n]
    if len(names) < 2:
        return ""
    suffix = os.path.commonprefix([n[::-1] for n in names])[::-1]
    suffix = suffix.lstrip("0123456789")
    if len(suffix) < 3 or any(len(n) <= len(suffix) for n in names):
        return ""
    return suffix


def arc_label(a, suffix="", width=24):
    cell = a["cell"][:-len(suffix)] if suffix and a["cell"].endswith(suffix) else a["cell"]
    label = "%s %s→%s %s" % (cell, a["from"], a["to"], a["edge"])
    if len(label) > width:
        label = "%s %s→%s %s" % (cell, a["from"], a["to"], a["edge"][:1])
    return label[:width]


def end_label(p):
    """A worst path as a chart category: its end flop's instance name (the tail when it is long)."""
    name = str(p.get("endShort") or p.get("end") or "path %s" % p.get("rank")).rstrip("_")
    if len(name) > 24:
        tail = name[-23:]
        if "_" in tail[:-1]:
            tail = tail[tail.index("_") + 1:]
        name = "…" + tail
    return name


def unique(labels):
    out, seen = [], {}
    for label in labels:
        if label in seen:
            seen[label] += 1
            mark = " #%d" % seen[label]
            keep = 24 - len(mark)
            label = ("\u2026" + label[-(keep - 1):] if label.startswith("\u2026") else label[:keep]) + mark
        else:
            seen[label] = 1
        out.append(label)
    return out


# ---------------------------------------------------------------- charts (hima-chart/1)
#
# Every chart a person sees in the chat is a file one of these steps wrote from a tool's own output
# (`<WS>/reports/<node id>/r<k>/<name>.chart.json`, or the Pack's generated knowledge/charts/). No
# timestamp, so the same tool output always gives the same bytes. The words follow the App.

def chart(title, unit, categories, series, source, subtitle=None, highlight=(), better=None, caption=None, metrics=None, digits=2):
    """One hima-chart/1 document. metrics: for a metric table (kind metrics), a list of one
    (unit, digits, better) per category; values then keep their row's digits (a bar chart's keep
    `digits`)."""
    places = [m[1] for m in metrics] if metrics else [digits] * len(categories)
    doc = dict(schema=CHART_SCHEMA, title=title[:80], kind="metrics" if metrics else "bar", unit=unit, categories=list(categories),
               series=[dict(name=n, values=[None if v is None else round(float(v), max(2, d)) for v, d in zip(vals, places)], role=role)
                       for n, vals, role in series],
               highlight=[h for h in highlight if h in categories], source=source[:160])
    if metrics:
        doc["units"] = [m[0] for m in metrics]
        doc["digits"] = [m[1] for m in metrics]
        doc["betterEach"] = [m[2] for m in metrics]
    if subtitle:
        doc["subtitle"] = subtitle[:120]
    if better:
        doc["better"] = better
    if caption:
        doc["caption"] = caption[:200]
    return doc


def write_chart(ws, node, k, name, doc):
    """Write reports/<node>/r<k>/<name>.chart.json (atomically; unchanged bytes are left alone)."""
    path = report_dir(ws, node, k) / ("%s.chart.json" % name)
    text = json.dumps(doc, indent=2, sort_keys=True) + "\n"
    if path.is_file() and path.read_text() == text:
        return path
    write_text(path, text)
    return path


def _all(b, key):
    return ((b.get("groups") or {}).get("all") or {}).get(key)


def _groups(b):
    """A build's path groups at route, as the flow reports them, without the 'all' row."""
    rows = b.get("pathGroups")
    if rows is None:
        rows = [dict(group=g, **v) for g, v in (b.get("groups") or {}).items()]
    return [r for r in rows if r.get("group") != "all"]


# The route-stage metric table: (category, unit, digits, better, value of a build record or sapr summary)
BUILD_METRICS = [
    ("reg2reg worst slack", "ps", 0, "higher", lambda b: ps(b.get("wnsNs"))),
    ("reg2reg TNS", "ns", 3, "higher", lambda b: b.get("tnsNs")),
    ("reg2reg violating paths", "", 0, "lower", lambda b: b.get("nvp")),
    ("All groups worst slack", "ps", 0, "higher", lambda b: ps(_all(b, "wnsNs"))),
    ("All groups TNS", "ns", 3, "higher", lambda b: _all(b, "tnsNs")),
    ("All groups violating", "", 0, "lower", lambda b: _all(b, "nvp")),
    ("Path groups", "", 0, "none", lambda b: len(_groups(b)) or None),
    ("Density", "%", 3, "none", lambda b: b.get("densityPct")),
    ("Total power", "mW", 2, "lower", lambda b: (b.get("power") or {}).get("totalMw")),
    ("Clock sinks", "", 0, "none", lambda b: (b.get("clockTree") or {}).get("sinks")),
    ("Clock gates", "", 0, "none", lambda b: (b.get("clockTree") or {}).get("icgs")),
]
NEW_CELL_METRICS = [
    ("Custom-cell instances", "", 0, "none", lambda b: b.get("customCells") or 0),
    ("Custom-cell share", "%", 2, "none", lambda b: b.get("customCellsPct") or 0.0),
    ("Timing gain", "% of clock", 2, "higher", lambda b: b.get("timingGainPct") or 0.0),
]


def metrics_chart(title, builds, source, subtitle=None, caption=None, new_cells=False):
    """The route-stage metric table of one or more builds: builds = [(series name, role, record)]."""
    rows = BUILD_METRICS + (NEW_CELL_METRICS if new_cells else [])
    return chart(title, "", [r[0] for r in rows], [(name, [r[4](b) for r in rows], role) for name, role, b in builds], source,
                 subtitle=subtitle, caption=caption, metrics=[(r[1], r[2], r[3]) for r in rows])


def flow_stages_chart(builds, source, subtitle=None):
    """reg2reg worst slack (ps) at the end of every flow stage: builds = [(name, role, record)]."""
    stages = builds[0][2].get("stages") or []
    return chart("reg2reg worst slack through the flow", "ps", [st.get("label") or st["stage"] for st in stages],
                 [(name, [ps(st["wnsNs"]) for st in (b.get("stages") or [])], role) for name, role, b in builds], source,
                 subtitle=subtitle, better="higher",
                 caption="prePlace times the netlist before placement; place_opt, CTS and route each end with the optimized design. "
                         "The build's result is its route timing.")


GROUP_FIELDS = (("worst slack", "ps", 0, "higher", lambda g: ps(g.get("wnsNs"))), ("TNS", "ns", 3, "higher", lambda g: g.get("tnsNs")),
                ("violating", "", 0, "lower", lambda g: g.get("nvp")))


def path_groups_chart(builds, source, subtitle=None, n=4):
    """Worst slack, TNS and violating paths per path group at route (the flow's own table), for the
    groups with timing: builds = [(name, role, record)]."""
    groups = [g["group"] for g in _groups(builds[0][2]) if g.get("wnsNs") is not None and g["group"] != "default"][:n]
    rows = [(g, f) for g in groups for f in GROUP_FIELDS]
    series = []
    for name, role, b in builds:
        by = {g["group"]: g for g in _groups(b)}
        series.append((name, [f[4](by.get(g) or {}) for g, f in rows], role))
    return chart("Path groups at route", "", [("%s %s" % (g, f[0]))[:24] for g, f in rows], series, source, subtitle=subtitle,
                 highlight=[("%s worst slack" % GROUP)[:24]] if GROUP in groups else (),
                 caption="reg2reg: flop to flop; reg2cgate: flop to clock gate; in2reg and reg2out: the core's inputs and outputs.",
                 metrics=[(f[1], f[2], f[3]) for g, f in rows])


def rank_words(types):
    """HimaTime's rank types in words: logic_depth -> logic depth, count_delay -> count x delay."""
    return ", ".join(re.sub(r"^count (delay|slack)$", "count \u00d7 \\1", str(t).replace("_", " ")) for t in types or [])


def funnel_chart(hv, merged_count, requested, source, subtitle=None):
    """HimaTime's funnel from the design to the arcs the HimaTime agent asks for (metrics)."""
    rows = [("Design cells", hv.get("design_cells")), ("High-value instances", hv.get("high_value_instances")),
            ("Library cells used", hv.get("lib_cells")), ("High-value cells", hv.get("listed_cells")),
            ("What-if arcs", merged_count), ("Arcs requested", requested)]
    return chart("From the design to the arcs to customize", "", [r[0] for r in rows], [("Count", [r[1] for r in rows], "measured")],
                 source, subtitle=subtitle, highlight=["Arcs requested"],
                 caption="High-value instances: the top instances per rank type (%s). What-if arcs: the arcs the rankings name, merged."
                 % rank_words(hv.get("rank_types")),
                 metrics=[("", 0, "none") for r in rows])


def slack_chart(paths, source, subtitle, clock_ns, n=8):
    """Slack (ps) of the n worst reg2reg paths of a build, worst first (HimaTime's path list)."""
    rows = paths[:n]
    labels = unique([end_label(p) for p in rows])
    return chart("Worst reg2reg paths: slack", "ps", labels, [("Slack", [ps(p["slackNs"]) for p in rows], "measured")], source,
                 subtitle=subtitle, better="higher", highlight=labels[:1],
                 caption="Each path by its end point. Negative slack misses the %.3f ns clock; the worst path sets the worst slack." % clock_ns)


def stage_chart(summary, source, subtitle=None):
    """Where the worst reg2reg path's time goes: SRAM access, cell families and nets (ps), from
    HimaTime's breakdown of the worst path."""
    parts = list(summary.get("breakdown") or [])
    if len(parts) > 16:
        nets = [p for p in parts if p["part"] == "nets"]
        body = [p for p in parts if p["part"] != "nets"]
        rest = body[14 - len(nets) + 1:]
        body = body[:14 - len(nets) + 1] + [dict(part="other cells", ns=sum(p["ns"] for p in rest))]
        parts = body + nets
    worst = (summary.get("paths") or [{}])[0]
    total = sum(p["ns"] for p in parts)
    return chart("Where the worst path's %d ps of data time go" % round(1000.0 * total), "ps", [p["part"][:24] for p in parts],
                 [("Delay", [ps(p["ns"]) for p in parts], "neutral")], source, subtitle=subtitle,
                 highlight=[p["part"][:24] for p in parts if p["part"] == "SRAM access"],
                 caption="%s → %s, slack %d ps. Launch clock latency (%d ps) left out: the capture clock matches it."
                 % (worst.get("beginShort", "?")[-40:], worst.get("endShort", "?")[-40:], round(1000.0 * worst.get("slackNs", 0.0)),
                    round(1000.0 * (worst.get("clockNs") or 0.0))))


def whatif_gains(whatif):
    """Per arc (cell, from, to, edge): the rankings that name it and its best TNS and WNS what-if
    gain (ns) over those rankings, from HimaTime's own what-if result."""
    out = {}
    for key, rows in (whatif.get("rankings") or {}).items():
        for row in rows:
            for edge in row.get("edges") or ([row["edge"]] if row.get("edge") else []):
                arc = (row["cell"], row["from"], row["to"], edge)
                facts = out.setdefault(arc, dict(rankedBy=[], tnsGainNs=None, wnsGainNs=None))
                if key not in facts["rankedBy"]:
                    facts["rankedBy"].append(key)
                for field, src in (("tnsGainNs", "tns_delta_ns"), ("wnsGainNs", "wns_delta_ns")):
                    v = row.get(src)
                    if isinstance(v, (int, float)) and (facts[field] is None or v > facts[field]):
                        facts[field] = v
    return out


def merged_arcs(whatif):
    """HimaTime's merged what-if arc list (union of the rankings, dedup) with each arc's rankings and gains."""
    gains = whatif_gains(whatif)
    out = []
    for a in whatif.get("merged") or []:
        facts = gains.get(arc_key(a), dict(rankedBy=list(a.get("rankedBy") or []), tnsGainNs=None, wnsGainNs=None))
        out.append(dict(plain_arc(a), rankedBy=list(a.get("rankedBy") or facts["rankedBy"]),
                        tnsGainNs=facts["tnsGainNs"], wnsGainNs=facts["wnsGainNs"]))
    return out


def vt_chart(arc_rows, suffix, source, subtitle=None, highlight=()):
    """Stock arc delay (ps) per Vt flavour for a few arcs: ULVT against LVT and SVT."""
    labels = unique([arc_label(r, suffix) for r in arc_rows])
    return chart("Already the fastest Vt: stock arc delay", "ps", labels,
                 [("ULVT", [(r.get("ulvt") or {}).get("delayPs") for r in arc_rows], "baseline"),
                  ("LVT", [(r.get("lvt") or {}).get("delayPs") for r in arc_rows], "neutral"),
                  ("SVT", [(r.get("svt") or {}).get("delayPs") for r in arc_rows], "neutral")],
                 source, subtitle=subtitle, better="lower", highlight=highlight,
                 caption="Arc delay at the centre of each stock library's delay table. A slower Vt cannot help; only a new cell can.")


def high_value_chart(hv, source, subtitle=None, n=12):
    fams = [f for f in hv.get("families") or [] if isinstance(f, dict)][:n]
    return chart("High-value cells by family", "", [str(f["family"])[:24] for f in fams],
                 [("Cells listed", [f["count"] for f in fams], "neutral")], source, subtitle=subtitle,
                 caption="HimaTime's high-value cells: the library cells on the most timing-critical instances, by cell family.")


# ---------------------------------------------------------------- tools

def load_inputs(ws):
    inputs = read_json(state(ws, "inputs.json"), "state/inputs.json (run bind-inputs first)")
    if inputs.get("schema") != "hima-andes-inputs/2":
        raise ToolError("state/inputs.json is not hima-andes-inputs/2")
    return inputs


def tool(inputs, name):
    return inputs["tools"][name]["path"]


def tool_path(inputs, name):
    """The Site's tool as bind-inputs recorded it, or the same command on PATH (an agent's sandbox)."""
    path = tool(inputs, name)
    if os.path.isfile(path) and os.access(path, os.X_OK):
        return path
    found = shutil.which(name)
    if found is None:
        raise ToolError("%s is neither at %s nor on PATH" % (name, path))
    return found


def tool_json(inputs, name, argv, timeout=300):
    """A tool query that prints JSON (--json): the tool's own numbers."""
    out = subprocess.run([tool_path(inputs, name)] + argv + ["--json"], capture_output=True, text=True, timeout=timeout)
    if out.returncode != 0:
        raise ToolError("%s %s failed: %s" % (name, argv[0], (out.stderr or out.stdout).strip()[:400]))
    try:
        return json.loads(out.stdout)
    except ValueError:
        raise ToolError("%s %s printed no JSON" % (name, argv[0]))


def run_tool(argv, timeout_s=None, log_path=None):
    """Run one EDA command, streaming its output to this Job's log; return (rc, seconds)."""
    started = time.time()
    print("+ %s" % " ".join(argv), flush=True)
    sink = open(log_path, "w") if log_path else None
    try:
        proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        try:
            for line in proc.stdout:
                sys.stdout.write(line)
                sys.stdout.flush()
                if sink:
                    sink.write(line)
                if timeout_s is not None and time.time() - started > timeout_s:
                    proc.kill()
                    raise ToolError("%s exceeded its time limit of %d s" % (os.path.basename(argv[0]), timeout_s))
            rc = proc.wait()
        finally:
            if proc.poll() is None:
                proc.kill()
    finally:
        if sink:
            sink.close()
    return rc, round(time.time() - started, 1)


def write_arcs(path, arcs):
    write_json(path, dict(arcs=[plain_arc(a) for a in arcs]))
    return path


def whatif_of(inputs, db):
    return tool_json(inputs, "himatime", ["whatif", "--db", str(db), "--scale", str(SCALE)])


def analysis_of(inputs, db, arcs):
    """Qualib's library view of a requested arc list (qualib analyze), in a scratch directory."""
    scratch = Path(tempfile.mkdtemp(prefix="andes-ql-"))
    try:
        arcs_file = write_arcs(scratch / "arcs.json", arcs)
        return tool_json(inputs, "qualib", ["analyze", "--db", str(db), "--arcs", str(arcs_file), "--out", str(scratch / "ql")])
    finally:
        shutil.rmtree(str(scratch), ignore_errors=True)


def stock_arcs_of(inputs, arcs):
    scratch = Path(tempfile.mkdtemp(prefix="andes-qa-"))
    try:
        return tool_json(inputs, "qualib", ["list", "--arcs", str(write_arcs(scratch / "arcs.json", arcs))])
    finally:
        shutil.rmtree(str(scratch), ignore_errors=True)


def load_lessons(ws):
    return read_json(state(ws, "lessons.json"), "state/lessons.json")


def load_library(ws):
    return read_json(state(ws, "library.json"), "state/library.json")


def current_round(ws):
    timing = read_json(state(ws, "timing.json"), "state/timing.json (run load-timing first)")
    return int(timing["round"]), timing


def build_db(ws, timing):
    return Path(ws) / timing["buildDir"]


# ---------------------------------------------------------------- bind

def cmd_bind(ws, eda_root, design_root, library):
    ws = Path(ws)
    eda_root = Path(eda_root)
    design_root = Path(design_root)
    tools = {}
    for name in TOOLS:
        path = eda_root / "bin" / name
        if not path.is_file() or not os.access(str(path), os.X_OK):
            raise ToolError("the Site's EDA root has no executable bin/%s: %s" % (name, path))
        out = subprocess.run([str(path), "-version"], capture_output=True, text=True, timeout=60)
        if out.returncode != 0 or not out.stdout.strip():
            raise ToolError("%s -version failed: %s" % (name, (out.stderr or out.stdout).strip()))
        tools[name] = dict(path=str(path), version=out.stdout.strip().splitlines()[0], sha256=sha256_file(path))
        print("%-9s %s" % (name, tools[name]["version"]), flush=True)
    if not (design_root / "pr" / "pr.json").is_file():
        raise ToolError("design data %s is not installed at %s (no pr/pr.json)" % (DESIGN, design_root))
    files = {f: sha256_file(design_root / f) for f in DESIGN_FILES if (design_root / f).is_file()}
    inputs = dict(schema="hima-andes-inputs/2", edaRoot=str(eda_root), designRoot=str(design_root), design=DESIGN, library=library,
                  stage=STAGE, group=GROUP, tools=tools, designFiles=files, iterations=ITERATIONS, scale=SCALE, boundAt=now(),
                  claimBoundary=CLAIM_BOUNDARY)
    write_json(state(ws, "inputs.json"), inputs)
    if not state(ws, "lessons.json").exists():
        write_json(state(ws, "lessons.json"), dict(schema="hima-andes-lessons/2", rounds=[]))
    if not state(ws, "library.json").exists():
        write_json(state(ws, "library.json"), dict(schema="hima-andes-library/2", rounds=[], arcs=[]))
    lines = ["Tools and design data for %s (stock libraries %s; full flow to route, path group %s)" % (DESIGN, library, GROUP), "",
             "  %-10s %s" % ("tool", "version"), "  " + "-" * 70]
    lines += ["  %-10s %s" % (name, tools[name]["version"]) for name in TOOLS]
    lines += ["", "Design data (SHA-256):"] + ["  %-28s %s" % (f, d[:16]) for f, d in sorted(files.items())]
    lines += ["", "AndesCell settings: %d iterations per arc, arc delay target x%g" % (ITERATIONS, SCALE), ""]
    write_text(report_dir(ws, "bind-inputs", 1) / "tools.rpt", "\n".join(lines))
    print("bound %s (%s); %d design data file(s); EDA root %s" % (DESIGN, library, len(files), eda_root))


# ---------------------------------------------------------------- builds

def sapr_build(ws, inputs, out_dir, timeout_min, extra=()):
    argv = [tool(inputs, "sapr"), "run", "--design", DESIGN, "--design-root", inputs["designRoot"], "--out", str(out_dir)]
    for lib_dir in extra:
        argv += ["--extra-lib", str(lib_dir)]
    rc, seconds = run_tool(argv, timeout_s=int(float(timeout_min) * 60))
    summary_path = Path(out_dir) / "sapr_summary.json"
    if rc != 0 or not summary_path.is_file():
        return dict(finished=False, failure="sapr exited %d" % rc, seconds=seconds)
    s = read_json(summary_path, "sapr_summary.json")
    if s.get("design") != DESIGN or s.get("wnsNs") is None:
        return dict(finished=False, failure="sapr wrote no %s timing summary" % DESIGN, seconds=seconds)
    return dict(finished=s.get("finished", True) is not False, seconds=seconds, summary=s, summarySha256=sha256_file(summary_path))


def build_record(ws, kind, k, out_dir, result, extra_libs=()):
    s = result.get("summary") or {}
    keys = ("clockPeriodNs", "clock", "stage", "group", "wnsNs", "tnsNs", "nvp", "allPaths", "groups", "densityPct", "overflowPct",
            "drv", "power", "libraries", "stages", "extraLibs", "pathGroups", "clockTree", "worstPaths", "basis")
    rec = dict(schema=BUILD_SCHEMA, kind=kind, round=k, dir=rel(ws, out_dir), finished=result["finished"], failure=result.get("failure"),
               runtimeS=result.get("seconds"), summarySha256=result.get("summarySha256"), tool=s.get("tool"),
               customCells=int(s.get("customCells") or 0), customCellsPct=s.get("customCellsPct") or 0.0,
               extraLibraries=[rel(ws, d) for d in extra_libs], writtenAt=now(), claimBoundary=CLAIM_BOUNDARY)
    rec.update({key: s.get(key) for key in keys})
    rec["stages"] = rec.get("stages") or []
    return rec


def clock_words(rec):
    cp = rec.get("clockPeriodNs") or 0.5
    return "%.3f ns (%.1f GHz)" % (cp, 1.0 / cp)


def cmd_reference(ws, timeout_min):
    ws = Path(ws)
    inputs = load_inputs(ws)
    out = fresh_dir(ws / "runs" / "reference" / "sapr")
    result = sapr_build(ws, inputs, out, timeout_min)
    rec = build_record(ws, "reference", 0, out, result)
    write_json(state(ws, "reference.json"), rec)
    publish_reports(ws, "reference-build", 1, out)
    if not rec["finished"]:
        raise ToolError("the reference build did not finish: %s" % rec["failure"])
    source = "Synthesis and APR %s, the reference build at route (sapr_summary.json, route.summary.rpt)" % _version(result["summary"])
    write_chart(ws, "reference-build", 1, "summary", metrics_chart(
        "Reference build at route: summary", [("Reference build", "baseline", rec)], source,
        subtitle="%s on the stock libraries at the end of route, clock %s" % (DESIGN, clock_words(rec)), caption=SHOWN_BOUNDARY))
    write_chart(ws, "reference-build", 1, "path-groups", path_groups_chart([("Reference build", "baseline", rec)], source,
                                                                           subtitle="The reference build's path groups at the end of route"))
    write_chart(ws, "reference-build", 1, "flow-stages", flow_stages_chart([("Reference build", "baseline", rec)], source,
                                                                           subtitle="The reference build, stage by stage"))
    report = tool_json(inputs, "himatime", ["report", "--db", str(out)])
    write_chart(ws, "reference-build", 1, "timing", slack_chart(
        report["paths"], "HimaTime %s, the routed reference build (himatime report)" % _version(report),
        "Reference build: reg2reg WNS %d ps, %d violating paths" % (round(ps(rec["wnsNs"])), rec["nvp"]), rec["clockPeriodNs"]))
    print("reference build: reg2reg WNS %.0f ps, TNS %.3f ns, %d violating paths; density %.3f %%"
          % (ps(rec["wnsNs"]), rec["tnsNs"], rec["nvp"], rec["densityPct"] or 0.0))


def latest_build(ws):
    """The build the next round starts from: the newest valid round build, else the reference."""
    lessons = load_lessons(ws)
    for r in reversed(lessons["rounds"]):
        if r.get("roundValid"):
            return Path(ws) / r["buildDir"], "round %d custom-cell build" % r["round"]
    ref = read_json(state(ws, "reference.json"), "state/reference.json")
    return Path(ws) / ref["dir"], "reference build"


# ---------------------------------------------------------------- timing (start of a round)

def cmd_timing(ws):
    ws = Path(ws)
    inputs = load_inputs(ws)
    k = len(load_lessons(ws)["rounds"]) + 1
    db, source = latest_build(ws)
    out = fresh_dir(round_dir(ws, k) / "timing")
    rc, seconds = run_tool([tool(inputs, "himatime"), "load", "--db", str(db), "--out", str(out)])
    summary_path = out / "timing_summary.json"
    if rc != 0 or not summary_path.is_file():
        raise ToolError("HimaTime load of %s failed (exit %d)" % (db, rc))
    s = read_json(summary_path, "timing_summary.json")
    hv_dir = out / "highvalue"
    rc, more = run_tool([tool(inputs, "himatime"), "highvalue", "--db", str(db), "--out", str(hv_dir)])
    hv = read_json(hv_dir / "high_value.json", "high_value.json") if rc == 0 else {}
    paths = [dict(rank=p.get("rank"), slackNs=p["slackNs"], beginShort=p.get("beginShort"), endShort=p.get("endShort"),
                  sramNs=p.get("sramNs"), cellNs=p.get("cellNs"), netNs=p.get("netNs")) for p in s["paths"]]
    rec = dict(schema=TIMING_SCHEMA, round=k, source=source, buildDir=rel(ws, db), dir=rel(ws, out),
               reports=dict(summary=rel(ws, summary_path), timing=rel(ws, out / "report_timing.rpt"),
                            stages=rel(ws, out / "stage_breakdown.rpt"), highValue=rel(ws, hv_dir / "high_value_cells.rpt")),
               summarySha256=sha256_file(summary_path), clockPeriodNs=s["clockPeriodNs"], group=s.get("group"), wnsNs=s["wnsNs"],
               tnsNs=s["tnsNs"], nvp=s["nvp"], paths=paths, breakdown=s.get("breakdown") or [],
               highValue={key: hv.get(key) for key in ("design_cells", "top_per_rank", "high_value_instances", "lib_cells",
                                                         "listed_cells", "rank_types")},
               runtimeS=round(seconds + more, 1), writtenAt=now(), claimBoundary=CLAIM_BOUNDARY)
    write_json(state(ws, "timing.json"), rec)
    publish(ws, "load-timing", k, [(out / "report_timing.rpt", "report_timing.rpt"), (out / "stage_breakdown.rpt", "stage_breakdown.rpt"),
                                   (hv_dir / "high_value_cells.rpt", "high_value_cells.rpt")])
    if s.get("breakdown"):
        write_chart(ws, "load-timing", k, "stage-breakdown", stage_chart(
            s, "HimaTime %s worst-path breakdown (stage_breakdown.rpt) of the %s" % (_version(s), source),
            "Round %d starts at route reg2reg WNS %d ps" % (k, round(ps(s["wnsNs"])))))
    if rc != 0:
        raise ToolError("HimaTime high-value analysis of %s failed (exit %d)" % (db, rc))
    print("round %d starts from the %s: reg2reg WNS %.0f ps, TNS %.3f ns, %d violating paths; %s high-value cells listed"
          % (k, source, ps(s["wnsNs"]), s["tnsNs"], s["nvp"], hv.get("listed_cells")))


# ---------------------------------------------------------------- deliveries: shared checks

def _file_under(roots, relpath, prefix):
    if not isinstance(relpath, str) or not relpath:
        raise ToolError("the report path is empty or not a string")
    part = PurePosixPath(relpath)
    if part.is_absolute() or ".." in part.parts:
        raise ToolError("report path %r must be relative and stay inside the workspace" % relpath)
    if not relpath.startswith(prefix + "/"):
        raise ToolError("report path %r must be under %s/" % (relpath, prefix))
    for root in roots:
        if (Path(root) / relpath).is_file():
            return Path(root) / relpath
    raise ToolError("report file %r does not exist" % relpath)


def _report_problem(roots, report, prefix):
    try:
        _file_under(roots, report, prefix)
        return None
    except ToolError as error:
        return "report: %s (write your analysis as %s/analysis.md and deliver it as support)" % (error, prefix)


def _intro_problems(doc, schema, agent, k):
    problems = []
    if doc.get("schema") != schema:
        problems.append("schema must be %r" % schema)
    if doc.get("agent") != agent:
        problems.append("agent must be %r" % agent)
    if doc.get("round") != k:
        problems.append("round must be %d (state/timing.json round)" % k)
    if not isinstance(doc.get("summary"), str) or len(doc["summary"].strip()) < 20:
        problems.append("summary must say in at least a sentence what you found")
    return problems


def _gain_near(a, b):
    if b is None:
        return a is None
    return isinstance(a, (int, float)) and not isinstance(a, bool) and abs(a - b) <= GAIN_TOLERANCE_NS


# ---------------------------------------------------------------- requirements (propose)

def validate_requirements(ws, agent, path=None, files_root=None, tools=None):
    """The one check of an agent's requirements (Reader and precheck), against the tools' own
    answer for the build this round starts from. Returns (doc, facts).

    HimaTime: arcs [{cell, from, to, edge, rankedBy, tnsGainNs, wnsGainNs}], each one of HimaTime's
    merged what-if arcs with that arc's rankings and best gains. Qualib: cells [names], each a cell
    of `qualib analyze` on the what-if arcs, with the tool's custom-cell constraints."""
    ws = Path(ws)
    if agent not in AGENTS:
        raise ToolError("agent must be one of %s" % ", ".join(AGENTS))
    path = Path(path) if path else state(ws, "%s-requirements.json" % agent)
    doc = read_json(path, "the %s requirements" % agent)
    if not isinstance(doc, dict):
        raise ToolError("the requirements file must be one JSON object")
    inputs = load_inputs(ws)
    k, timing = current_round(ws)
    tools = tools if tools is not None else {}
    problems = []
    if doc.get("schema") != REQUIREMENTS_SCHEMA:
        problems.append("schema must be %r" % REQUIREMENTS_SCHEMA)
    if doc.get("agent") != agent:
        problems.append("agent must be %r (this is the %s agent's delivery)" % (agent, agent))
    if doc.get("round") != k:
        problems.append("round must be %d (state/timing.json round)" % k)
    if not isinstance(doc.get("summary"), str) or len(doc["summary"].strip()) < 20:
        problems.append("summary must say in at least a sentence what the analysis found")
    if "whatif" not in tools:
        tools["whatif"] = whatif_of(inputs, build_db(ws, timing))
    merged = merged_arcs(tools["whatif"])
    by_key = {arc_key(a): a for a in merged}
    facts = dict(round=k, agent=agent)
    if agent == "himatime":
        items = doc.get("arcs")
        if not isinstance(items, list) or not items:
            problems.append("arcs must list the arcs to customize [{cell, from, to, edge, rankedBy, tnsGainNs, wnsGainNs}] "
                            "(HimaTime's merged what-if arcs: himatime whatif --scale %g)" % SCALE)
            items = []
        seen, bad = set(), []
        for i, a in enumerate(items, 1):
            if not is_arc(a):
                problems.append("arc %d must be an object with cell, from, to and edge" % i)
                continue
            ref = by_key.get(arc_key(a))
            if ref is None:
                bad.append(arc_name(a))
                continue
            if arc_key(a) in seen:
                problems.append("arc %s is listed twice" % arc_name(a))
            seen.add(arc_key(a))
            ranked = a.get("rankedBy")
            if not isinstance(ranked, list) or sorted(ranked) != sorted(ref["rankedBy"]):
                problems.append("arc %s: rankedBy must be %s (the what-if rankings that name it)" % (arc_name(a), ", ".join(ref["rankedBy"])))
            for field in ("tnsGainNs", "wnsGainNs"):
                if not _gain_near(a.get(field), ref[field]):
                    problems.append("arc %s: %s must be HimaTime's best what-if gain, %s ns" % (arc_name(a), field, ref[field]))
        if bad:
            problems.append("%d arc(s) are not in HimaTime's merged what-if list: %s%s" % (len(bad), ", ".join(bad[:5]), " ..." if len(bad) > 5 else ""))
        facts.update(count=len(seen), arcs=[plain_arc(by_key[key]) for key in by_key if key in seen], mergedCount=len(merged))
    else:
        if "analysis" not in tools:
            tools["analysis"] = analysis_of(inputs, build_db(ws, timing), merged)
        analysis = tools["analysis"]
        known = []
        for r in analysis.get("arcRows") or []:
            if r.get("cell") and r["cell"] not in known:
                known.append(r["cell"])
        cells = doc.get("cells")
        if not isinstance(cells, list) or not cells:
            problems.append("cells must list the cells to customize (the cells of qualib analyze on the what-if arcs)")
            cells = []
        seen, bad = [], []
        for c in cells:
            if not isinstance(c, str) or c not in known:
                bad.append(str(c))
            elif c in seen:
                problems.append("cell %s is listed twice" % c)
            else:
                seen.append(c)
        if bad:
            problems.append("%d cell(s) are not cells of Qualib's analysis of the what-if arcs: %s%s" % (len(bad), ", ".join(bad[:5]), " ..." if len(bad) > 5 else ""))
        want = analysis.get("constraints") or {}
        got = doc.get("constraints")
        if not isinstance(got, dict):
            problems.append("constraints must be Qualib's custom-cell constraints {footprint, inputCapMaxRatio, lvs}")
        else:
            if not isinstance(got.get("footprint"), str) or not got["footprint"].strip():
                problems.append("constraints.footprint must say the footprint rule (%s)" % want.get("footprint"))
            ratio = got.get("inputCapMaxRatio")
            if not isinstance(ratio, (int, float)) or isinstance(ratio, bool) or abs(ratio - (want.get("inputCapMaxRatio") or 0)) > 1e-6:
                problems.append("constraints.inputCapMaxRatio must be %s (qualib analyze)" % want.get("inputCapMaxRatio"))
            if got.get("lvs") != want.get("lvs"):
                problems.append("constraints.lvs must be %r (qualib analyze)" % want.get("lvs"))
        facts.update(count=len(seen), cells=seen, analysisCells=len(known), vt=analysis.get("vt"))
    report = doc.get("report")
    prefix = "reports/%s/r%d" % (AGENT_NODES[agent], k)
    problem = _report_problem([r for r in (files_root, ws) if r], report, prefix)
    if problem:
        problems.append(problem)
    if problems:
        raise ToolError("; ".join(problems))
    return doc, facts


def proposal_chart(ws, agent):
    """reports/<agent node>/r<k>/proposal.chart.json: why this agent asks for these arcs or cells,
    from the tools' own numbers (HimaTime's what-if; Qualib's stock arc delays per Vt)."""
    ws = Path(ws)
    tools = {}
    doc, facts = validate_requirements(ws, agent, tools=tools)
    inputs = load_inputs(ws)
    k, timing = current_round(ws)
    merged = merged_arcs(tools["whatif"])
    suffix = common_suffix([a["cell"] for a in merged])
    version = _version(tools["whatif"])
    if agent == "himatime":
        wanted = {arc_key(a) for a in facts["arcs"]}
        rows = sorted((a for a in merged if arc_key(a) in wanted), key=lambda a: -(a["tnsGainNs"] or 0.0))[:10]
        labels = unique([arc_label(a, suffix) for a in rows])
        made = chart("Why these arcs: what-if TNS gain", "", labels,
                     [("What-if TNS gain, ns", [a["tnsGainNs"] for a in rows], "proposed"),
                      ("Rankings naming it", [len(a["rankedBy"]) for a in rows], "neutral")],
                     "HimaTime %s cell what-if, arc delay x%g, top %d per ranking (himatime whatif)" % (version, SCALE, tools["whatif"].get("top_n") or 0),
                     subtitle="The HimaTime agent's %d arcs: the 10 with the most TNS back if 10 %% faster" % facts["count"],
                     highlight=labels[:1], better="higher", digits=3,
                     caption="TNS gain: reg2reg TNS back if this arc alone were 10 %% faster (HimaTime). Rankings: of the %d what-if rankings."
                     % len(tools["whatif"].get("rankings") or {}))
        write_chart(ws, AGENT_NODES[agent], k, "funnel", funnel_chart(
            timing.get("highValue") or {}, len(merged), facts["count"],
            "HimaTime %s high-value analysis and cell what-if (himatime highvalue, himatime whatif)" % version,
            subtitle="Round %d: the HimaTime agent's arcs, from the whole design" % k))
    else:
        listed = set(facts["cells"])
        top = [a for a in merged if a["cell"] in listed][:8]
        stock = stock_arcs_of(inputs, top)
        rows = stock.get("arcs") or []
        vt = facts.get("vt") or {}
        made = vt_chart(rows, suffix, "Qualib %s stock arc delays per Vt (qualib list --arcs)" % _version(stock),
                        subtitle="ULVT fastest on %s of %s analysed arcs; LVT %s %% and SVT %s %% slower (median)"
                        % (vt.get("ulvt_fastest_count"), len(merged), _fmt(vt.get("lvt_slower_median_pct"), "%.1f"),
                           _fmt(vt.get("svt_slower_median_pct"), "%.1f")))
    return write_chart(ws, AGENT_NODES[agent], k, "proposal", made)


def cmd_requirements(ws, agent):
    doc, facts = validate_requirements(ws, agent)
    print("%s requirements for round %d accepted: %d %s" % (agent, facts["round"], facts["count"], "arc(s)" if agent == "himatime" else "cell(s)"))


# ---------------------------------------------------------------- the generation plan (choose)

def both_lists(ws):
    """Both agents' validated requirements of this round: HimaTime's arcs and Qualib's cells."""
    tools = {}
    _, ht = validate_requirements(ws, "himatime", tools=tools)
    _, ql = validate_requirements(ws, "qualib", tools=tools)
    return ht, ql


def validate_plan(ws, path=None, files_root=None):
    """The one check of the AndesCell agent's generation plan (Reader, precheck, generate-cells):
    arcs that HimaTime asked for and whose cell Qualib lists, and AndesCell's settings."""
    ws = Path(ws)
    path = Path(path) if path else state(ws, "generation-plan.json")
    doc = read_json(path, "the generation plan")
    if not isinstance(doc, dict):
        raise ToolError("the generation plan must be one JSON object")
    k, timing = current_round(ws)
    problems = _intro_problems(doc, PLAN_SCHEMA, "andescell", k)
    ht, ql = both_lists(ws)
    cells = set(ql["cells"])
    allowed = {arc_key(a) for a in ht["arcs"] if a["cell"] in cells}
    items = doc.get("arcs")
    if not isinstance(items, list) or not items:
        problems.append("arcs must list the arcs to generate [{cell, from, to, edge}]")
        items = []
    seen, outside = [], []
    for i, a in enumerate(items, 1):
        if not is_arc(a):
            problems.append("arc %d must be an object with cell, from, to and edge" % i)
            continue
        if arc_key(a) not in allowed:
            outside.append(arc_name(a))
        elif arc_key(a) in seen:
            problems.append("arc %s is listed twice" % arc_name(a))
        else:
            seen.append(arc_key(a))
    if outside:
        problems.append("%d arc(s) are not both in the HimaTime agent's arcs and on a cell the Qualib agent lists: %s%s"
                        % (len(outside), ", ".join(outside[:5]), " ..." if len(outside) > 5 else ""))
    settings = doc.get("settings")
    if not isinstance(settings, dict) or settings.get("iterations") != ITERATIONS or not isinstance(settings.get("scale"), (int, float)) \
            or abs(settings["scale"] - SCALE) > 1e-9:
        problems.append("settings must be {\"iterations\": %d, \"scale\": %g} (the Site's AndesCell data: %d iterations per arc at a "
                        "%d %% delay target)" % (ITERATIONS, SCALE, ITERATIONS, round(100 * (1 - SCALE))))
    if not isinstance(doc.get("reason"), str) or len(doc["reason"].strip()) < 20:
        problems.append("reason must say in a sentence or two why these arcs and these settings")
    problem = _report_problem([r for r in (files_root, ws) if r], doc.get("report"), "reports/%s/r%d" % (PLAN_NODE, k))
    if problem:
        problems.append(problem)
    if problems:
        raise ToolError("; ".join(problems))
    arcs = [dict(cell=key[0], **{"from": key[1]}, to=key[2], edge=key[3]) for key in seen]
    return doc, dict(round=k, arcs=arcs, candidates=len(allowed), coversAll=len(seen) == len(allowed),
                     himatimeArcs=ht["count"], qualibCells=ql["count"])


# ---------------------------------------------------------------- the cell checks (verify)

def _generation(ws, k):
    gen = read_json(state(ws, "generation.json"), "state/generation.json")
    if gen.get("round") != k:
        raise ToolError("state/generation.json is for round %s, this is round %d" % (gen.get("round"), k))
    return gen


def copy_cells(source_dir, arcs, dest):
    """A cell directory holding exactly these arcs' cells (cells/<arc>.lib) from an AndesCell output."""
    dest = Path(dest)
    (dest / "cells").mkdir(parents=True, exist_ok=True)
    for name in arcs:
        shutil.copyfile(str(Path(source_dir) / "cells" / ("%s.lib" % name)), str(dest / "cells" / ("%s.lib" % name)))
    return dest


def tool_facts(ws, inputs, k, timing):
    """What HimaTime and Qualib say about this round's cells: HimaTime's cell-level check of the
    generated cells, and Qualib's screen of the cells HimaTime keeps. The deterministic reference a
    verify delivery is held against, and the numbers the Reader states."""
    gen = _generation(ws, k)
    cells_dir = Path(ws) / gen["dir"]
    check = tool_json(inputs, "himatime", ["verify", "--cells", str(cells_dir), "--db", str(build_db(ws, timing))])
    kept = [c["arc"] for c in check.get("cells") or [] if c.get("kept")]
    screen = dict(cells=[], passed=0, failed=0, limits={})
    if kept:
        scratch = Path(tempfile.mkdtemp(prefix="andes-kept-"))
        try:
            screen = tool_json(inputs, "qualib", ["screen", "--cells", str(copy_cells(cells_dir, kept, scratch / "kept"))])
        finally:
            shutil.rmtree(str(scratch), ignore_errors=True)
    return gen, check, screen


def validate_check(ws, kind, path=None, files_root=None):
    """The one check of a verify delivery (Reader, precheck, rebuild): HimaTime's cell-level check or
    Qualib's screen decision, held against the tools' own deterministic answer."""
    ws = Path(ws)
    if kind not in CHECK_KINDS:
        raise ToolError("kind must be one of %s" % ", ".join(CHECK_KINDS))
    path = Path(path) if path else state(ws, "%s.json" % kind)
    doc = read_json(path, "the %s delivery" % kind)
    if not isinstance(doc, dict):
        raise ToolError("the %s delivery must be one JSON object" % kind)
    inputs = load_inputs(ws)
    k, timing = current_round(ws)
    gen, check, screen = tool_facts(ws, inputs, k, timing)
    kept = [c["arc"] for c in check.get("cells") or [] if c.get("kept")]
    problems = []
    if kind == "himatime-verify":
        problems += _intro_problems(doc, CELL_CHECK_SCHEMA, "himatime", k)
        for field in ("generated", "kept", "dropped"):
            if doc.get(field) != check.get(field):
                problems.append("%s must be %s (himatime verify)" % (field, check.get(field)))
        listed = doc.get("keptArcs")
        if not isinstance(listed, list) or sorted(x for x in listed if isinstance(x, str)) != sorted(kept) or len(listed) != len(kept):
            got = set(x for x in listed if isinstance(x, str)) if isinstance(listed, list) else set()
            extra, missing = sorted(got - set(kept)), sorted(set(kept) - got)
            problems.append("keptArcs must be exactly the %d arcs himatime verify keeps%s%s" % (
                len(kept), "; not kept: %s" % ", ".join(extra[:5]) if extra else "", "; missing: %s" % ", ".join(missing[:5]) if missing else ""))
        node = "himatime-verify"
    else:
        problems += _intro_problems(doc, CELL_SCREEN_SCHEMA, "qualib", k)
        tool_cells = {c["arc"]: c for c in screen.get("cells") or []}
        cells = doc.get("cells")
        if not isinstance(cells, list):
            problems.append("cells must list every cell HimaTime keeps {arc, status PASS or FAIL, reasons}")
            cells = []
        seen = set()
        for item in cells:
            name = item.get("arc") if isinstance(item, dict) else None
            ref = tool_cells.get(name)
            if ref is None:
                problems.append("cells: %r is not a cell HimaTime keeps this round" % (name,))
                continue
            if name in seen:
                problems.append("cells: %s is listed twice" % name)
            seen.add(name)
            status, reasons = item.get("status"), item.get("reasons")
            if status not in ("PASS", "FAIL"):
                problems.append("cells: %s status must be PASS or FAIL" % name)
            elif status == "PASS" and ref["status"] != "PASS":
                problems.append("cells: %s fails the Qualib screen (%s); it cannot pass" % (name, "; ".join(ref.get("reasons") or [])))
            elif status == "FAIL" and not (isinstance(reasons, list) and any(isinstance(x, str) and x.strip() for x in reasons)
                                           or isinstance(reasons, str) and reasons.strip()):
                problems.append("cells: %s is FAIL and needs its reasons" % name)
        missing = [name for name in tool_cells if name not in seen]
        if missing:
            problems.append("cells: %d kept cell(s) are missing (decide PASS or FAIL for every one): %s%s"
                            % (len(missing), ", ".join(missing[:5]), " ..." if len(missing) > 5 else ""))
        node = "qualib-screen"
    problem = _report_problem([r for r in (files_root, ws) if r], doc.get("report"), "reports/%s/r%d" % (node, k))
    if problem:
        problems.append(problem)
    if problems:
        raise ToolError("; ".join(problems))
    passed = [c["arc"] for c in screen.get("cells") or [] if c.get("status") == "PASS"]
    facts = dict(round=k, generated=check.get("generated"), cellsKept=check.get("kept"), kept=kept, cellsPassedScreen=len(passed),
                 passed=passed, cellsDir=gen["dir"])
    if kind == "qualib-screen":
        facts["agentPassed"] = [c["arc"] for c in doc["cells"] if c.get("status") == "PASS"]
    return doc, facts


TOP_CELLS = 5   # rows of three: a metrics table holds at most 16 rows and one column per series


def top_cells_chart(ws, inputs, timing, gen, check, screen):
    """The first kept cells in HimaTime's what-if order, each with its best version and delay, the
    Δ HimaTime reports, and its input capacitance against the stock cell (Qualib screen)."""
    kept = {c["arc"]: c for c in check.get("cells") or [] if c.get("kept")}
    order = [arc_name(a) for a in merged_arcs(whatif_of(inputs, build_db(ws, timing)))]
    arcs = {c["arc"]: c for c in gen.get("cells") or []}
    names = [n for n in order if n in kept] + sorted(n for n in kept if n not in order)
    caps = {c["arc"]: c.get("inputCapRatio") for c in screen.get("cells") or []}
    suffix = common_suffix([c["cell"] for c in check.get("cells") or []])
    rows, metrics, values = [], [], []
    for name in names[:TOP_CELLS]:
        c = kept[name]
        a = arcs.get(name) or {}
        label = arc_label(dict(cell=c["cell"], **{"from": a.get("from", "?")}, to=a.get("to", "?"), edge=c.get("edge") or "?"), suffix, 17)
        cap = caps.get(name)
        for word, unit, digits, better, value in (("v%s ps" % c.get("bestVersion"), "ps", 3, "none", c.get("delayPs")),
                                                  ("Δ", "", 4, "none", c.get("delta")),
                                                  ("cap", "%", 1, "lower", None if cap is None else 100.0 * (cap - 1.0))):
            rows.append(("%s %s" % (label, word))[:24])
            metrics.append((unit, digits, better))
            values.append(value)
    return chart("Kept cells: best version, delay and input cap", "", unique(rows), [("Kept cell", values, "measured")],
                 "HimaTime %s cell-level check (verify.rpt) and Qualib %s screen (cell_screen.rpt)" % (_version(check), _version(screen)),
                 subtitle="The first %d kept cells in HimaTime's what-if order" % min(TOP_CELLS, len(names)),
                 caption="v<n> ps: the best version's arc delay. Δ: as HimaTime reports it. cap: input capacitance change against the stock cell.",
                 metrics=metrics)


def check_chart(ws, kind):
    """reports/<node>/r<k>/<name>.chart.json for an accepted verify delivery, from the tools' own
    answer: HimaTime's kept cells by family (cell-check) or Qualib's screen ratios (screen)."""
    ws = Path(ws)
    inputs = load_inputs(ws)
    k, timing = current_round(ws)
    gen, check, screen = tool_facts(ws, inputs, k, timing)
    if kind == "himatime-verify":
        fams = list(check.get("keptByFamily") or [])
        if len(fams) > 16:
            fams = fams[:15] + [dict(family="other", count=sum(f["count"] for f in fams[15:]))]
        made = chart("Cell-level gain: kept cells by family", "", [str(f["family"])[:24] for f in fams],
                     [("Kept cells", [f["count"] for f in fams], "measured")],
                     "HimaTime %s cell-level check (himatime verify, verify.rpt)" % _version(check),
                     subtitle="%d of %d generated cells give a positive cell-level gain and are kept" % (check.get("kept") or 0, check.get("generated") or 0),
                     caption="A cell is kept when its new arc is faster than the stock cell's at cell level; the dropped cells never enter a build.")
        write_chart(ws, "himatime-verify", k, "top-cells", top_cells_chart(ws, inputs, timing, gen, check, screen))
        return write_chart(ws, "himatime-verify", k, "cell-check", made)
    rows = screen.get("cells") or []
    caps = [c["inputCapRatio"] for c in rows if isinstance(c.get("inputCapRatio"), (int, float))]
    areas = [c["areaRatio"] for c in rows if isinstance(c.get("areaRatio"), (int, float))]
    limits = screen.get("limits") or {}
    metrics = [("Cells screened", "", 0, "none", len(rows)),
               ("Pass", "", 0, "higher", screen.get("passed")),
               ("Fail", "", 0, "lower", screen.get("failed")),
               ("Input cap ratio, min", "×", 3, "lower", min(caps) if caps else None),
               ("Input cap ratio, median", "×", 3, "lower", statistics.median(caps) if caps else None),
               ("Input cap ratio, max", "×", 3, "lower", max(caps) if caps else None),
               ("Area ratio, max", "×", 3, "lower", max(areas) if areas else None),
               ("LVS match", "", 0, "higher", sum(1 for c in rows if c.get("lvs") == "match"))]
    made = chart("Qualib screen of the kept cells", "", [m[0] for m in metrics], [("Kept cells", [m[4] for m in metrics], "measured")],
                 "Qualib %s cell screen (qualib screen, cell_screen.rpt)" % _version(screen),
                 subtitle="%d of %d kept cells pass" % (screen.get("passed") or 0, len(rows)),
                 caption="Each ratio is the custom cell against its stock cell. Limits: area %sx (same footprint), input cap %sx, LVS %s."
                 % (limits.get("areaRatioMax", "?"), limits.get("inputCapRatioMax", "?"), limits.get("lvs", "?")),
                 metrics=[(m[1], m[2], m[3]) for m in metrics])
    return write_chart(ws, "qualib-screen", k, "screen", made)


def cmd_delivery(ws, kind):
    if kind == "andescell":
        doc, facts = validate_plan(ws)
        print("generation plan for round %d accepted: %d arc(s) of %d candidates" % (facts["round"], len(facts["arcs"]), facts["candidates"]))
        return
    doc, facts = validate_check(ws, kind)
    print("%s for round %d accepted: %s of %s generated cell(s) kept; %d pass the Qualib screen"
          % (kind, facts["round"], facts["cellsKept"], facts["generated"], facts["cellsPassedScreen"]))


# ---------------------------------------------------------------- draft and precheck (the agents' own commands)

def _skeleton(schema, agent, k, node):
    return dict(schema=schema, agent=agent, round=k, summary="", report="reports/%s/r%d/analysis.md" % (node, k))


def draft(ws, kind, tool_file=None):
    """A delivery skeleton for KIND, filled from the tool's own JSON (the file the agent's own tool
    run wrote; without it the tool is asked here). The agent writes the summary and its analysis."""
    ws = Path(ws)
    inputs = load_inputs(ws)
    k, timing = current_round(ws)
    given = read_json(tool_file, "the tool output %s" % tool_file) if tool_file else None
    db = build_db(ws, timing)
    if kind == "himatime":
        whatif = given if given is not None else whatif_of(inputs, db)
        if "merged" not in whatif:
            raise ToolError("%s is not HimaTime's what-if result (himatime whatif --scale %g --out DIR writes whatif.json)" % (tool_file, SCALE))
        doc = _skeleton(REQUIREMENTS_SCHEMA, "himatime", k, AGENT_NODES["himatime"])
        doc["arcs"] = merged_arcs(whatif)
        return doc
    if kind == "qualib":
        analysis = given if given is not None else analysis_of(inputs, db, merged_arcs(whatif_of(inputs, db)))
        if "arcRows" not in analysis:
            raise ToolError("%s is not Qualib's library analysis (qualib analyze --out DIR writes library_analysis.json)" % tool_file)
        doc = _skeleton(REQUIREMENTS_SCHEMA, "qualib", k, AGENT_NODES["qualib"])
        cells = []
        for r in analysis["arcRows"]:
            if r.get("cell") and r["cell"] not in cells:
                cells.append(r["cell"])
        doc["cells"] = cells
        doc["constraints"] = dict(analysis.get("constraints") or {})
        return doc
    if kind == "andescell":
        ht, ql = both_lists(ws)
        cells = set(ql["cells"])
        doc = _skeleton(PLAN_SCHEMA, "andescell", k, PLAN_NODE)
        doc["arcs"] = [plain_arc(a) for a in ht["arcs"] if a["cell"] in cells]
        doc["settings"] = dict(iterations=ITERATIONS, scale=SCALE)
        doc["reason"] = ""
        return doc
    if kind == "himatime-verify":
        check = given if given is not None else tool_json(inputs, "himatime", ["verify", "--cells", str(ws / _generation(ws, k)["dir"]), "--db", str(db)])
        if "kept" not in check or "cells" not in check:
            raise ToolError("%s is not HimaTime's cell-level check (himatime verify --out DIR writes verify.json)" % tool_file)
        doc = _skeleton(CELL_CHECK_SCHEMA, "himatime", k, "himatime-verify")
        doc.update(generated=check.get("generated"), kept=check.get("kept"), dropped=check.get("dropped"),
                   keptArcs=[c["arc"] for c in check["cells"] if c.get("kept")])
        return doc
    if kind == "qualib-screen":
        screen = given if given is not None else tool_facts(ws, inputs, k, timing)[2]
        if "cells" not in screen or "passed" not in screen:
            raise ToolError("%s is not Qualib's screen (qualib screen --out DIR writes screen.json)" % tool_file)
        doc = _skeleton(CELL_SCREEN_SCHEMA, "qualib", k, "qualib-screen")
        doc["cells"] = [dict(arc=c["arc"], status=c["status"], reasons=list(c.get("reasons") or [])) for c in screen["cells"]]
        return doc
    raise ToolError("kind must be one of %s" % ", ".join(KINDS))


def cmd_draft(ws, kind, tool_file=None):
    print(json.dumps(draft(ws, kind, tool_file), indent=2, sort_keys=True))


def cmd_precheck(ws, kind, path, own_workspace=None):
    root = own_workspace or os.getcwd()
    if kind in AGENTS:
        doc, facts = validate_requirements(ws, kind, path=path, files_root=root)
        print("precheck PASS: %s round %d, %d %s. Deliver %s as the result and %s (and your other reports under its folder) as support."
              % (kind, facts["round"], facts["count"], "arc(s)" if kind == "himatime" else "cell(s)", path, doc["report"]))
        return
    if kind == "andescell":
        doc, facts = validate_plan(ws, path=path, files_root=root)
        print("precheck PASS: generation plan round %d, %d arc(s) of %d candidates. Deliver %s as the result and %s (and your other "
              "reports under its folder) as support." % (facts["round"], len(facts["arcs"]), facts["candidates"], path, doc["report"]))
        return
    if kind in CHECK_KINDS:
        doc, facts = validate_check(ws, kind, path=path, files_root=root)
        print("precheck PASS: %s round %d (%s of %s generated cells kept; %d pass the Qualib screen). Deliver %s as the result and %s "
              "(and your other reports under its folder) as support."
              % (kind, facts["round"], facts["cellsKept"], facts["generated"], facts["cellsPassedScreen"], path, doc["report"]))
        return
    raise ToolError("kind must be one of %s" % ", ".join(KINDS))


# ---------------------------------------------------------------- generate and rebuild

def cmd_generate(ws):
    ws = Path(ws)
    inputs = load_inputs(ws)
    k, timing = current_round(ws)
    plan, facts = validate_plan(ws)
    arcs_file = write_arcs(round_dir(ws, k) / "plan-arcs.json", facts["arcs"])
    out = fresh_dir(round_dir(ws, k) / "andescell")
    argv = [tool(inputs, "andescell"), "generate", "--arcs", str(arcs_file), "--round", str(k), "--iterations", str(ITERATIONS),
            "--scale", str(SCALE), "--out", str(out)]
    rc, seconds = run_tool(argv)
    gen_path = out / "generation.json"
    if rc != 0 or not gen_path.is_file():
        raise ToolError("AndesCell generation failed (exit %d)" % rc)
    gen = read_json(gen_path, "generation.json")
    versions = gen.get("versionsKeptPerArc") or max([len(r.get("versions") or []) for r in gen.get("arcs") or []] or [0])
    rec = dict(schema=GENERATION_SCHEMA, round=k, dir=rel(ws, out), requested=gen["requested"], generated=gen["generated"],
               failed=gen["failed"], failedKnown=gen.get("failedKnown") or [], iterations=gen.get("iterations"), scale=gen.get("scale"),
               versionsKeptPerArc=versions, cellsWithData=len(gen.get("arcs") or []),
               cells=[dict(arc=r["arc"], cell=r["cell"], family=r.get("family"), edge=r["edge"], bestVersion=(r.get("best") or {}).get("version"),
                           **{"from": r.get("from"), "to": r.get("to")})
                      for r in gen.get("arcs") or []],
               planReason=plan.get("reason"), generationSha256=sha256_file(gen_path), runtimeS=seconds, writtenAt=now())
    write_json(state(ws, "generation.json"), rec)
    publish(ws, "generate-cells", k, [(out / "generation.rpt", "generation.rpt")])
    metrics = [("Requested arcs", "", 0, "none", gen["requested"]), ("Generated", "", 0, "higher", gen["generated"]),
               ("Failed", "", 0, "lower", gen["failed"]), ("Iterations per arc", "", 0, "none", gen.get("iterations")),
               ("Versions kept per arc", "", 0, "none", versions)]
    write_chart(ws, "generate-cells", k, "generation", chart(
        "AndesCell generation", "", [m[0] for m in metrics], [("Round %d" % k, [m[4] for m in metrics], "measured")],
        "AndesCell %s generation report (generation.rpt)" % _version(gen),
        subtitle="Custom cells for the plan's arcs, %d iterations per arc at a %d %% delay target" % (gen.get("iterations") or 0, round(100 * (1 - (gen.get("scale") or SCALE)))),
        caption="Failed: no version of the arc passed. HimaTime's cell-level check decides which generated cells are kept.",
        metrics=[(m[1], m[2], m[3]) for m in metrics]))
    print("AndesCell round %d: %d of %d arc(s) generated, %d failed (%s)" % (k, gen["generated"], gen["requested"], gen["failed"], out))


def accepted_cells(ws):
    """This round's cells the rebuild may use: kept by HimaTime's cell-level check, passed by the
    Qualib screen and by the Qualib agent (both checked against the tools)."""
    _, check_facts = validate_check(ws, "himatime-verify")
    _, screen_facts = validate_check(ws, "qualib-screen")
    passed = set(screen_facts["passed"]) & set(screen_facts["agentPassed"])
    return [a for a in check_facts["kept"] if a in passed], check_facts, screen_facts


def cmd_build(ws, timeout_min):
    ws = Path(ws)
    inputs = load_inputs(ws)
    k, _ = current_round(ws)
    gen = _generation(ws, k)
    accepted, _, _ = accepted_cells(ws)
    extra = [ws / r["dir"] for r in load_library(ws)["rounds"]]
    library_dir = None
    if accepted:
        library_dir = copy_cells(ws / gen["dir"], accepted, fresh_dir(round_dir(ws, k) / "library"))
        write_json(library_dir / "delivery.json", dict(schema="hima-andes-delivery/1", design=DESIGN, round=k, cells=accepted,
                                                       source=gen["dir"]))
        extra.append(library_dir)
    out = fresh_dir(round_dir(ws, k) / "build")
    result = sapr_build(ws, inputs, out, timeout_min, extra)
    rec = build_record(ws, "round", k, out, result, extra)
    rec["acceptedCells"] = accepted
    rec["libraryDir"] = rel(ws, library_dir) if library_dir else None
    write_json(state(ws, "round-build.json"), rec)
    publish_reports(ws, "new-library-build", k, out)
    if not rec["finished"]:
        raise ToolError("the custom-cell build did not finish: %s" % rec["failure"])
    report = subprocess.run([tool(inputs, "himatime"), "report", "--db", str(out)], capture_output=True, text=True, timeout=300)
    if report.returncode == 0:
        write_text(report_dir(ws, "new-library-build", k) / "report_timing.rpt", report.stdout)
    print("round %d custom-cell build: reg2reg WNS %.0f ps, TNS %.3f ns, %d violating paths; %d custom-cell instances"
          % (k, ps(rec["wnsNs"]), rec["tnsNs"], rec["nvp"], rec["customCells"]))


# ---------------------------------------------------------------- compare: the round record

def gain_pct(wns_ns, ref_wns_ns, period_ns):
    if wns_ns is None or ref_wns_ns is None or not period_ns:
        return None
    return round(100.0 * (wns_ns - ref_wns_ns) / period_ns, 2)


def build_facts(b):
    return dict(wnsNs=b.get("wnsNs"), tnsNs=b.get("tnsNs"), nvp=b.get("nvp"), allPaths=b.get("allPaths"),
                allGroups=(b.get("groups") or {}).get("all"), densityPct=b.get("densityPct"),
                totalPowerMw=(b.get("power") or {}).get("totalMw"), customCells=b.get("customCells") or 0,
                customCellsPct=b.get("customCellsPct") or 0.0, clockPeriodNs=b.get("clockPeriodNs"), dir=b.get("dir"))


def cmd_compare(ws):
    ws = Path(ws)
    inputs = load_inputs(ws)
    k, timing = current_round(ws)
    ref = read_json(state(ws, "reference.json"), "state/reference.json")
    build = read_json(state(ws, "round-build.json"), "state/round-build.json")
    gen = _generation(ws, k)
    check = read_json(state(ws, "himatime-verify.json"), "state/himatime-verify.json")
    screen = read_json(state(ws, "qualib-screen.json"), "state/qualib-screen.json")
    if check.get("round") != k or screen.get("round") != k:
        raise ToolError("the verify deliveries are not this round's (%d)" % k)
    if build.get("round") != k:
        raise ToolError("state/round-build.json is for round %s, this is round %d" % (build.get("round"), k))
    lessons = load_lessons(ws)
    library = load_library(ws)
    plan = read_json(state(ws, "generation-plan.json"), "state/generation-plan.json")
    reqs = {agent: read_json(state(ws, "%s-requirements.json" % agent)) for agent in AGENTS}
    accepted = list(build.get("acceptedCells") or [])
    allowed = sorted([r["dir"] for r in library["rounds"]] + ([build["libraryDir"]] if build.get("libraryDir") else []))
    problems = []
    if not build["finished"]:
        problems.append("the custom-cell build did not finish: %s" % build.get("failure"))
    if build.get("clockPeriodNs") != ref.get("clockPeriodNs"):
        problems.append("the build clock differs from the reference clock")
    if build.get("stage") != ref.get("stage") or build.get("group") != ref.get("group"):
        problems.append("the build is not timed at the reference's stage and path group")
    if sorted(build.get("extraLibraries") or []) != allowed:
        problems.append("the build used libraries other than the kept and screened cells: %s" % ", ".join(build.get("extraLibraries") or []))
    valid = not problems
    period = ref.get("clockPeriodNs")
    previous = [r for r in lessons["rounds"] if r.get("roundValid") and r.get("wnsNs") is not None]
    prev_best_ps = max([ps(r["wnsNs"]) for r in previous] + [ps(ref["wnsNs"])])
    wns_ps = ps(build.get("wnsNs"))
    gain = gain_pct(build.get("wnsNs"), ref["wnsNs"], period) if valid else None
    improved = bool(valid and wns_ps is not None and wns_ps > prev_best_ps + IMPROVE_EPS_PS)
    best_ps = max(prev_best_ps, wns_ps) if valid and wns_ps is not None else prev_best_ps
    best_gain = gain_pct(best_ps / 1000.0, ref["wnsNs"], period)
    cumulative = sorted(set(library.get("arcs") or []) | set(accepted)) if valid else sorted(library.get("arcs") or [])
    record = dict(
        schema=ROUND_SCHEMA, round=k, roundValid=valid, problems=problems, stage=STAGE, group=GROUP, clockPeriodNs=period,
        reference=build_facts(ref), build=build_facts(build),
        startedFrom=dict(source=timing["source"], wnsNs=timing["wnsNs"]),
        timingGainPct=gain, previousBestWnsPs=prev_best_ps, bestWnsPs=best_ps, bestGainPct=best_gain, roundImproved=improved,
        requested=dict(himatimeArcs=len(reqs["himatime"].get("arcs") or []), qualibCells=len(reqs["qualib"].get("cells") or [])),
        planArcs=len(plan.get("arcs") or []), planReason=plan.get("reason"),
        generation=dict(requested=gen["requested"], generated=gen["generated"], failed=gen["failed"], iterations=gen.get("iterations"),
                        scale=gen.get("scale")),
        cellsKept=check.get("kept"), cellsDropped=check.get("dropped"),
        cellsPassedScreen=sum(1 for c in screen.get("cells") or [] if c.get("status") == "PASS"),
        cellsFailedScreen=[dict(arc=c.get("arc"), reasons=c.get("reasons")) for c in screen.get("cells") or [] if c.get("status") != "PASS"],
        acceptedCells=len(accepted), cumulativeCells=len(cumulative), basis=build.get("basis"), claimBoundary=CLAIM_BOUNDARY,
        writtenAt=now())
    write_json(state(ws, "round.json"), record)
    lessons["rounds"].append(dict(round=k, roundValid=valid, wnsNs=build.get("wnsNs"), tnsNs=build.get("tnsNs"), nvp=build.get("nvp"),
                                  timingGainPct=gain, roundImproved=improved, customCells=build.get("customCells") or 0,
                                  planArcs=record["planArcs"], generated=gen["generated"], failed=gen["failed"], cellsKept=check.get("kept"),
                                  cellsPassedScreen=record["cellsPassedScreen"], acceptedCells=len(accepted), buildDir=build["dir"],
                                  startedFromWnsNs=timing["wnsNs"], problems=problems))
    write_json(state(ws, "lessons.json"), lessons)
    if valid and build.get("libraryDir"):
        library["rounds"].append(dict(round=k, dir=build["libraryDir"], acceptedCells=accepted))
        library["arcs"] = cumulative
        write_json(state(ws, "library.json"), library)
    write_text(ws / "derived" / ("round-%d.md" % k), round_markdown(record))
    publish(ws, "compare-round", k, [(ws / "derived" / ("round-%d.md" % k), "round-%d.md" % k)])
    source = "Synthesis and APR summaries at route of the reference and round %d builds (sapr_summary.json)" % k
    ref_row = dict(ref, timingGainPct=0.0)
    build_row = dict(build, timingGainPct=gain)
    builds = [("Reference build", "baseline", ref_row), ("Round %d custom cells" % k, "measured", build_row)]
    write_chart(ws, "compare-round", k, "comparison", metrics_chart(
        "At route: reference against custom cells", builds, source, new_cells=True,
        subtitle="reg2reg worst slack %s ps, %s %% of the %.3f ns clock" % (_fmt(None if gain is None else wns_ps - ps(ref["wnsNs"]), "%+.0f"),
                                                                          _fmt(gain, "%+.2f"), period or 0.0),
        caption=SHOWN_BOUNDARY + " " + STAGE_WORDS))
    if ref.get("stages") and build.get("stages"):
        write_chart(ws, "compare-round", k, "flow-stages", flow_stages_chart(builds, source,
                                                                               subtitle="Reference against round %d, stage by stage" % k))
    if ref.get("pathGroups") or ref.get("groups"):
        write_chart(ws, "compare-round", k, "path-groups", path_groups_chart(builds, source,
                                                                               subtitle="Reference against round %d at the end of route" % k))
    if build["finished"]:
        write_chart(ws, "compare-round", k, "worst-paths", worst_paths_chart(inputs, ws, ref, build, k, period))
    write_summary(ws)
    print("round %d: reg2reg WNS %s ps vs reference %.0f ps (gain %s %% of the clock), best %s %%, improved %s, valid %s"
          % (k, _fmt(wns_ps, "%.0f"), ps(ref["wnsNs"]), _fmt(gain), _fmt(best_gain), improved, valid))


def worst_paths_chart(inputs, ws, ref, build, k, period):
    """The custom build's 8 worst reg2reg paths at route against the same paths in the reference
    build (the summary's worst paths carry the reference slack); by rank when they do not."""
    new = (build.get("worstPaths") or [])[:8]
    if new and all(p.get("referenceSlackNs") is not None for p in new):
        labels = unique([end_label(p) for p in new])
        before, after = [ps(p["referenceSlackNs"]) for p in new], [ps(p["slackNs"]) for p in new]
        subtitle, caption = "The custom build's worst paths, each against the same path in the reference build", \
            "Each path by its end point. Negative slack misses the %.3f ns clock." % (period or 0.0)
    else:
        old = (ref.get("worstPaths") or tool_json(inputs, "himatime", ["report", "--db", str(Path(ws) / ref["dir"])])["paths"])[:8]
        new = new or tool_json(inputs, "himatime", ["report", "--db", str(Path(ws) / build["dir"])])["paths"][:8]
        n = min(len(old), len(new))
        labels = ["Worst path %d" % (i + 1) for i in range(n)]
        before, after = [ps(p["slackNs"]) for p in old[:n]], [ps(p["slackNs"]) for p in new[:n]]
        subtitle, caption = "Each build's own worst paths, worst first", "Path 1 is each build's worst slack. Negative slack misses the %.3f ns clock." % (period or 0.0)
    return chart("The worst reg2reg paths at route: slack", "ps", labels,
                 [("Reference build", before, "baseline"), ("Round %d custom cells" % k, after, "measured")],
                 "Synthesis and APR route timing of the reference and round %d builds (sapr_summary.json)" % k,
                 subtitle=subtitle, better="higher", highlight=labels[:1], caption=caption)


def round_markdown(r):
    ref, b = r["reference"], r["build"]
    ra, ba = ref.get("allGroups") or {}, b.get("allGroups") or {}
    lines = ["# Round %d: custom standard cells for %s" % (r["round"], DESIGN), "",
             "Started from the %s (reg2reg worst slack %s ps)." % (r["startedFrom"]["source"], _fmt(ps(r["startedFrom"]["wnsNs"]), "%.0f")), "",
             "| | Reference build | With custom cells |", "| --- | --- | --- |",
             "| reg2reg worst slack (ps) | %s | %s |" % (_fmt(ps(ref["wnsNs"]), "%.0f"), _fmt(ps(b["wnsNs"]), "%.0f")),
             "| reg2reg TNS (ns) | %s | %s |" % (_fmt(ref["tnsNs"], "%.3f"), _fmt(b["tnsNs"], "%.3f")),
             "| reg2reg violating paths | %s | %s |" % (_fmt(ref["nvp"], "%d"), _fmt(b["nvp"], "%d")),
             "| All groups worst slack (ps) | %s | %s |" % (_fmt(ps(ra.get("wnsNs")), "%.0f"), _fmt(ps(ba.get("wnsNs")), "%.0f")),
             "| All groups TNS (ns) | %s | %s |" % (_fmt(ra.get("tnsNs"), "%.3f"), _fmt(ba.get("tnsNs"), "%.3f")),
             "| All groups violating paths | %s | %s |" % (_fmt(ra.get("nvp"), "%d"), _fmt(ba.get("nvp"), "%d")),
             "| Density (%%) | %s | %s |" % (_fmt(ref["densityPct"], "%.3f"), _fmt(b["densityPct"], "%.3f")),
             "| Total power (mW) | %s | %s |" % (_fmt(ref["totalPowerMw"], "%.3f"), _fmt(b["totalPowerMw"], "%.3f")),
             "| Custom-cell instances | %d | %d (%s %%) |" % (ref["customCells"], b["customCells"], _fmt(b["customCellsPct"], "%.2f")), "",
             "Timing gain: **%s %% of the %.3f ns clock** in reg2reg worst slack (best so far %s %%)." % (
                 _fmt(r["timingGainPct"]), r["clockPeriodNs"] or 0.0, _fmt(r["bestGainPct"])), "",
             "The HimaTime agent asked for %d arcs; the Qualib agent listed %d cells; the AndesCell agent planned %d arcs "
             "(%s iterations per arc, arc delay target x%s)." % (r["requested"]["himatimeArcs"], r["requested"]["qualibCells"], r["planArcs"],
                                                                   r["generation"]["iterations"], r["generation"]["scale"]),
             "AndesCell generated %d of %d (%d failed). HimaTime's cell-level check kept %s; %d passed the Qualib screen; "
             "the build used %d." % (r["generation"]["generated"], r["generation"]["requested"], r["generation"]["failed"],
                                     r["cellsKept"], r["cellsPassedScreen"], r["acceptedCells"])]
    for c in r["cellsFailedScreen"][:20]:
        reasons = c.get("reasons")
        lines.append("Left out after the screen: %s (%s)." % (c.get("arc"), "; ".join(reasons) if isinstance(reasons, list) else reasons))
    if r["problems"]:
        lines += ["", "Problems: " + "; ".join(r["problems"])]
    lines += ["", STAGE_WORDS, SHOWN_BOUNDARY, ""]
    return "\n".join(lines)


def write_summary(ws):
    ws = Path(ws)
    ref = read_json(state(ws, "reference.json"), "state/reference.json")
    rounds = load_lessons(ws)["rounds"]
    period = ref.get("clockPeriodNs")
    valid = [r for r in rounds if r.get("roundValid") and r.get("wnsNs") is not None]
    best = max([ps(r["wnsNs"]) for r in valid], default=None)
    summary = dict(schema="hima-andes-summary/2", reference=build_facts(ref), rounds=rounds, bestWnsPs=best,
                   bestGainPct=None if best is None else gain_pct(best / 1000.0, ref["wnsNs"], period),
                   cumulativeCells=len(load_library(ws).get("arcs") or []), claimBoundary=CLAIM_BOUNDARY, writtenAt=now())
    write_json(ws / "derived" / "summary.json", summary)
    lines = ["# Custom standard cells for %s: summary" % DESIGN, "",
             "Reference build (stock libraries, end of route): reg2reg worst slack %s ps, TNS %s ns, %s violating paths, "
             "clock %.3f ns." % (_fmt(ps(ref["wnsNs"]), "%.0f"), _fmt(ref["tnsNs"], "%.3f"), _fmt(ref["nvp"], "%d"), period or 0.0), "",
             "| round | arcs planned | cells in the build | reg2reg WNS (ps) | TNS (ns) | violating paths | timing gain | custom-cell instances | improved |",
             "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for r in rounds:
        lines.append("| %d | %d | %d | %s | %s | %s | %s %% | %d | %s |" % (
            r["round"], r["planArcs"], r["acceptedCells"], _fmt(ps(r["wnsNs"]), "%.0f"), _fmt(r["tnsNs"], "%.3f"), _fmt(r["nvp"], "%d"),
            _fmt(r["timingGainPct"]), r["customCells"], "yes" if r["roundImproved"] else "no"))
    lines += ["", "Best timing gain over the reference build: %s %% of the clock period." % _fmt(summary["bestGainPct"]),
              "Custom cells in the delivered library: %d." % summary["cumulativeCells"], "",
              "Round reports: `derived/round-<k>.md`; every tool's and agent's reports under `reports/<step>/r<k>/`.", "",
              STAGE_WORDS, "", "Claim boundary: " + CLAIM_BOUNDARY, ""]
    write_text(ws / "derived" / "summary.md", "\n".join(lines))


# ---------------------------------------------------------------- entry

COMMANDS = {
    "bind": (cmd_bind, (3,)), "reference": (cmd_reference, (1,)), "timing": (cmd_timing, (0,)),
    "requirements": (cmd_requirements, (1,)), "delivery": (cmd_delivery, (1,)), "draft": (cmd_draft, (1, 2)),
    "precheck": (cmd_precheck, (2, 3)), "generate": (cmd_generate, (0,)),
    "build": (cmd_build, (1,)), "compare": (cmd_compare, (0,)),
}


def main(argv):
    if len(argv) < 3 or argv[1] not in COMMANDS:
        print("usage: andes_cli.py {%s} <WORKSPACE> ..." % "|".join(COMMANDS), file=sys.stderr)
        return 2
    command, arities = COMMANDS[argv[1]]
    if len(argv) - 3 not in arities:
        print("andes_cli.py %s takes %s argument(s) after the workspace" % (argv[1], " or ".join(map(str, arities))), file=sys.stderr)
        return 2
    try:
        command(*argv[2:])
    except ToolError as error:
        print("andes %s: %s" % (argv[1], error), file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
