#!/usr/bin/env python3
"""Deterministic steps of the andes-cell-fmax Pack (python3, stdlib only).

Every number this file writes comes from a tool report (sapr, himatime, qualib, andescell), never
from model text. The tools are the mock EDA toolchain bound by the Site (edaRoot).

  bind       <WS> <EDA_ROOT> <DESIGN_ROOT> <LIBRARY>   tool versions, design, families
  reference  <WS> <TIMEOUT_MIN>        Synthesis and APR on the stock library (the reference build)
  timing     <WS>                      load the latest build into HimaTime (start of a round)
  requirements <WS> <AGENT>            validate state/<AGENT>-requirements.json (agent delivery)
  delivery   <WS> <KIND>               validate a delivery of the AndesCell agent (andescell) or of a
                                       verify agent (himatime-verify, qualib-screen)
  precheck   <WS> <KIND> <FILE> [<OWN_WORKSPACE>]   an agent's own check before delivery; KIND is
                                       himatime, qualib, andescell, himatime-verify or qualib-screen
  merged     <WS>                      print both agents' requirements of this round as one list
  generate   <WS>                      AndesCell on the merged requirements, exactly the plan's families
  build      <WS> <TIMEOUT_MIN>        Synthesis and APR with the stock + every accepted new cell
  compare    <WS>                      round record, lessons, cumulative library and summary

All output goes under <WS>. The mock EDA root and the design root are read-only. Every step leaves
the reports a person reads at <WS>/reports/<node id>/r<k>/; the resident agents deliver theirs to
the same place (their artifactPrefix is reports/<node id>).
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path, PurePosixPath

DESIGN = "aes_cipher_top"
AGENTS = ("himatime", "qualib")
REQUIREMENTS_SCHEMA = "hima-andes-requirements/1"
ROUND_SCHEMA = "hima-andes-round/1"
BUILD_SCHEMA = "hima-andes-build/1"
TIMING_SCHEMA = "hima-andes-timing/1"
PLAN_SCHEMA = "hima-andes-plan/1"
CELL_TIMING_SCHEMA = "hima-andes-cell-timing/1"
CELL_SCREEN_SCHEMA = "hima-andes-cell-screen/1"
# The graph's node ids: reports land at reports/<node id>/r<k>/.
AGENT_NODES = {"himatime": "himatime-agent", "qualib": "qualib-agent"}
PLAN_NODE = "andescell-agent"
CHECK_KINDS = ("himatime-verify", "qualib-screen")
VERIFY_PATHS = 8
NUMBER_TOLERANCE = 0.5     # ps: an agent's number agrees with the tool's within this
TOOLS = ("sapr", "himatime", "qualib", "andescell", "xtop")
MAX_REQUIREMENTS = 8
CLAIM_BOUNDARY = ("Every EDA result in this Pack comes from mock tools on a demo Site (mock EDA); "
                  "not signoff, not silicon.")
# What a report the App shows says instead (round-<k>.md, the charts): the same boundary in plain words.
SHOWN_BOUNDARY = "These are results on the demo Site eda_cluster_ctu_01, not signoff and not silicon."
CHART_SCHEMA = "hima-chart/1"
IMPROVE_EPS_MHZ = 0.005


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


def pct(a, b):
    if a is None or b is None or b == 0:
        return None
    return round(100.0 * (a / b - 1.0), 2)


def report_dir(ws, node, k):
    return Path(ws) / "reports" / node / ("r%d" % k)


def publish(ws, node, k, files):
    """Copy a tool's human-readable reports to reports/<node>/r<k>/ (files: [(source, name)])."""
    d = report_dir(ws, node, k)
    d.mkdir(parents=True, exist_ok=True)
    for source, name in files:
        if Path(source).is_file():
            tmp = d / (name + ".tmp")
            shutil.copyfile(str(source), str(tmp))
            os.replace(tmp, d / name)


# ---------------------------------------------------------------- charts (hima-chart/1)
#
# Every chart a person sees in the chat is a file one of these steps wrote from a tool's own output
# (`<WS>/reports/<node id>/r<k>/<name>.chart.json`, or the Pack's knowledge/charts/). No timestamp, so
# the same tool output always gives the same bytes. The words follow the App: no internal names.

def chart(title, unit, categories, series, source, subtitle=None, highlight=(), better=None, caption=None):
    doc = dict(schema=CHART_SCHEMA, title=title, kind="bar", unit=unit, categories=list(categories),
               series=[dict(name=n, values=[None if v is None else round(float(v), 2) for v in vals], role=role) for n, vals, role in series],
               highlight=[h for h in highlight if h in categories], source=source)
    if subtitle:
        doc["subtitle"] = subtitle
    if better:
        doc["better"] = better
    if caption:
        doc["caption"] = caption
    return doc


def write_chart(ws, node, k, name, doc):
    """Write reports/<node>/r<k>/<name>.chart.json (atomically; unchanged bytes are left alone)."""
    path = report_dir(ws, node, k) / ("%s.chart.json" % name)
    text = json.dumps(doc, indent=2, sort_keys=True) + "\n"
    if path.is_file() and path.read_text() == text:
        return path
    write_text(path, text)
    return path


def path_label(p):
    """A worst path as a chart category: its id and group, at most 24 characters."""
    group = {"S-box / MixColumns": "S-box/MixColumns"}.get(p["group"], p["group"])
    return ("%s %s" % (p["id"], group))[:24]


def slack_chart(paths, source, subtitle, n=8):
    """Slack (ps) of the n worst paths of a build, worst first (HimaTime's path list)."""
    rows = paths[:n]
    return chart("Worst-path slack", "ps", [path_label(p) for p in rows],
                 [("Slack", [1000.0 * p["slackNs"] for p in rows], "measured")], source, subtitle=subtitle, better="higher",
                 highlight=[path_label(rows[0])] if rows else (),
                 caption="Negative slack fails the 0.500 ns clock; the worst path sets Fmax = 1000 / (0.500 ns - worst slack).")


def stage_chart(summary, source, subtitle):
    """Share of the worst path's delay by cell family, from HimaTime's stage breakdown and path list."""
    worst = summary["paths"][0]
    total = 1000.0 * (summary["clockPeriodNs"] - worst["slackNs"])
    rows = [r for r in summary["stageBreakdown"] if r["worstPathSharePct"] > 0]
    rows.sort(key=lambda r: -r["worstPathSharePct"])
    nets = sum(st["netDelayPs"] for st in worst["stages"])
    categories = [r["family"] for r in rows] + ["Nets"]
    values = [r["worstPathSharePct"] for r in rows] + [100.0 * nets / total]
    top = [r["family"] for r in sorted(rows, key=lambda r: -r["estRecoveryNs"])[:2] if not r["generated"]]
    return chart("Where the worst path's delay goes", "%", categories, [("Share of worst path", values, "neutral")], source,
                 subtitle=subtitle, highlight=top,
                 caption="Path %s, %d logic levels, %.1f ps; the rest is setup and clock uncertainty." % (worst["id"], len(worst["stages"]) - 1, total))


def _version(doc):
    """'4.2.0' from a tool line such as 'HimaTime static timing analysis (himatime) version 4.2.0, linux64'."""
    m = re.search(r"version ([^ ,]+)", str(doc.get("tool") or ""))
    return m.group(1) if m else ""


def tool_query(inputs, name, argv):
    """A fast, read-only tool query that prints JSON."""
    out = subprocess.run([tool_path(inputs, name)] + argv, capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        raise ToolError("%s %s failed: %s" % (name, argv[0], (out.stderr or out.stdout).strip()[:400]))
    try:
        return json.loads(out.stdout)
    except ValueError:
        raise ToolError("%s %s printed no JSON" % (name, argv[0]))


def fo4_rows(stock, families):
    """Per family: Qualib's stock FO4 (the smallest drive, as library_analysis.rpt lists it) and the
    AndesCell target at the family's typical speed-up."""
    rows = []
    for fam in families:
        cells = sorted((c for c in stock["cells"] if c["family"] == fam), key=lambda c: c["drive"])
        if not cells:
            continue
        headroom = stock["families"][fam]["customHeadroomPct"]
        rows.append(dict(family=fam, cell=cells[0]["name"], fo4=cells[0]["fo4DelayPs"], target=cells[0]["fo4DelayPs"] * (1 - headroom / 100.0),
                         headroom=headroom))
    return rows


def library_chart(rows, title, source, subtitle, highlight=()):
    return chart(title, "ps", [r["family"] for r in rows],
                 [("Stock std9t_svt FO4", [r["fo4"] for r in rows], "baseline"),
                  ("AndesCell target FO4", [r["target"] for r in rows], "proposed")],
                 source, subtitle=subtitle, better="lower", highlight=highlight,
                 caption="FO4 delay of the smallest stock drive (%s); the target is AndesCell's typical cell-level speed-up (%s)."
                 % (", ".join(r["cell"] for r in rows[:4]) + (", ..." if len(rows) > 4 else ""),
                    ", ".join("-%d %%" % r["headroom"] for r in rows[:4]) + (", ..." if len(rows) > 4 else "")))


def load_inputs(ws):
    inputs = read_json(state(ws, "inputs.json"), "state/inputs.json (run bind-inputs first)")
    if inputs.get("schema") != "hima-andes-inputs/1":
        raise ToolError("state/inputs.json is not hima-andes-inputs/1")
    return inputs


def tool(inputs, name):
    return inputs["tools"][name]["path"]


def run_tool(argv, timeout_s=None, log_path=None):
    """Run one mock EDA command, streaming its output to this Job's log; return (rc, seconds)."""
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


def load_lessons(ws):
    return read_json(state(ws, "lessons.json"), "state/lessons.json")


def load_library(ws):
    return read_json(state(ws, "library.json"), "state/library.json")


def current_round(ws):
    timing = read_json(state(ws, "timing.json"), "state/timing.json (run load-timing first)")
    return int(timing["round"]), timing


# ---------------------------------------------------------------- bind

def cmd_bind(ws, mock_root, design_root, library):
    ws = Path(ws)
    mock_root = Path(mock_root)
    design_root = Path(design_root)
    tools = {}
    for name in TOOLS:
        path = mock_root / "bin" / name
        if not path.is_file() or not os.access(str(path), os.X_OK):
            raise ToolError("the Site's EDA root has no executable bin/%s: %s" % (name, path))
        out = subprocess.run([str(path), "-version"], capture_output=True, text=True, timeout=60)
        if out.returncode != 0 or not out.stdout.strip():
            raise ToolError("%s -version failed: %s" % (name, (out.stderr or out.stdout).strip()))
        tools[name] = dict(path=str(path), version=out.stdout.strip().splitlines()[0], sha256=sha256_file(path))
        print("%-9s %s" % (name, tools[name]["version"]), flush=True)
    design = read_json(design_root / "design.json", "the design description design.json")
    if design.get("design") != DESIGN:
        raise ToolError("design root %s holds %r, not %s" % (design_root, design.get("design"), DESIGN))
    if design.get("library") != library:
        raise ToolError("design %s is set up for library %s, the Site binds %s" % (DESIGN, design.get("library"), library))
    sdc = design_root / design["sdc"]
    rtl = [design_root / f for f in design.get("rtl") or []]
    for path in [sdc] + rtl:
        if not path.is_file():
            raise ToolError("design file missing: %s" % path)
    fam = subprocess.run([tools["andescell"]["path"], "families", "--json"], capture_output=True, text=True, timeout=60)
    if fam.returncode != 0:
        raise ToolError("andescell families failed: %s" % fam.stderr.strip())
    families = json.loads(fam.stdout)
    inputs = dict(schema="hima-andes-inputs/1", edaRoot=str(mock_root), designRoot=str(design_root), design=DESIGN,
                  library=library, clockPeriodNs=design.get("clockPeriodNs"), technology=design.get("technology"),
                  tools=tools, families=[f["family"] for f in families["families"]], aliases=families.get("aliases") or {},
                  maxFamiliesPerRound=families.get("maxFamiliesPerRun"),
                  designFiles={rel(design_root, p): sha256_file(p) for p in [sdc] + rtl}, boundAt=now(),
                  claimBoundary=CLAIM_BOUNDARY)
    write_json(state(ws, "inputs.json"), inputs)
    if not state(ws, "lessons.json").exists():
        write_json(state(ws, "lessons.json"), dict(schema="hima-andes-lessons/1", rounds=[]))
    if not state(ws, "library.json").exists():
        write_json(state(ws, "library.json"), dict(schema="hima-andes-library/1", rounds=[], families=[]))
    lines = ["Tools and design for %s (%s, stock library %s, clock %.3f ns)" % (DESIGN, inputs["technology"], library, inputs["clockPeriodNs"]), "",
             "  %-10s %s" % ("tool", "version"), "  " + "-" * 70]
    lines += ["  %-10s %s" % (name, tools[name]["version"]) for name in TOOLS]
    lines += ["", "Design files (SHA-256):"] + ["  %-28s %s" % (f, d[:16]) for f, d in sorted(inputs["designFiles"].items())]
    lines += ["", "AndesCell families: %s (at most %s per round)" % (", ".join(inputs["families"]), inputs["maxFamiliesPerRound"]), ""]
    write_text(report_dir(ws, "bind-inputs", 1) / "tools.rpt", "\n".join(lines))
    print("bound %s on %s; %d AndesCell families; EDA root %s" % (DESIGN, library, len(inputs["families"]), mock_root))


# ---------------------------------------------------------------- builds

BUILD_REPORTS = ("report_qor.rpt", "postroute_timing.rpt", "area.rpt", "route_drc.rpt")


def sapr_build(ws, inputs, out_dir, timeout_min, extra=()):
    argv = [tool(inputs, "sapr"), "run", "--design", DESIGN, "--design-root", inputs["designRoot"], "--lib", inputs["library"],
            "--jobs", "4", "--out", str(out_dir)]
    for lib_dir, dont_use in extra:
        argv += ["--extra-lib", str(lib_dir)]
        for cell in dont_use:
            argv += ["--dont-use", cell]
    rc, seconds = run_tool(argv, timeout_s=int(float(timeout_min) * 60))
    summary_path = Path(out_dir) / "sapr_summary.json"
    if rc != 0 or not summary_path.is_file():
        return dict(finished=False, failure="sapr exited %d" % rc, seconds=seconds)
    s = read_json(summary_path, "sapr_summary.json")
    return dict(finished=bool(s.get("finished")), seconds=seconds, summary=s, summarySha256=sha256_file(summary_path))


def build_record(ws, kind, k, out_dir, result, extra_libs=()):
    s = result.get("summary") or {}
    rec = dict(schema=BUILD_SCHEMA, kind=kind, round=k, dir=rel(ws, out_dir), finished=result["finished"],
               failure=result.get("failure"), runtimeS=result.get("seconds"), summarySha256=result.get("summarySha256"),
               clockPeriodNs=s.get("clockPeriodNs"), wnsNs=s.get("wnsNs"), tnsNs=s.get("tnsNs"), fmaxMhz=s.get("fmaxMhz"),
               violatingEndpoints=s.get("violatingEndpoints"), areaUm2=s.get("areaUm2"), instances=s.get("instances"),
               routeDrcErrors=s.get("routeDrcErrors"), newCellInstances=s.get("newCellInstances", 0),
               newCellInstancesByCell=s.get("newCellInstancesByCell") or {}, newFamiliesUsed=s.get("newFamiliesUsed") or [],
               extraLibraries=[dict(dir=rel(ws, d), dontUse=list(u)) for d, u in extra_libs], tool=s.get("tool"),
               writtenAt=now(), claimBoundary=CLAIM_BOUNDARY)
    return rec


def cmd_reference(ws, timeout_min):
    ws = Path(ws)
    inputs = load_inputs(ws)
    out = fresh_dir(ws / "runs" / "reference" / "sapr")
    result = sapr_build(ws, inputs, out, timeout_min)
    rec = build_record(ws, "reference", 0, out, result)
    write_json(state(ws, "reference.json"), rec)
    publish(ws, "reference-build", 1, [(out / "reports" / name, name) for name in BUILD_REPORTS])
    if not rec["finished"]:
        raise ToolError("the reference build did not finish: %s" % rec["failure"])
    report = tool_query(inputs, "himatime", ["report", "--db", str(out), "--paths", "8", "--json"])
    write_chart(ws, "reference-build", 1, "timing", slack_chart(
        report["paths"], "HimaTime %s, the routed reference build (himatime report --paths 8)" % _version(report),
        "Reference build on the stock library: WNS %.1f ps, Fmax %.2f MHz" % (1000.0 * rec["wnsNs"], rec["fmaxMhz"])))
    print("reference build: Fmax %.2f MHz (WNS %.4f ns, TNS %.3f ns), area %.1f um^2, %d instances, route DRC %d"
          % (rec["fmaxMhz"], rec["wnsNs"], rec["tnsNs"], rec["areaUm2"], rec["instances"], rec["routeDrcErrors"]))


def latest_build(ws):
    """The build the next round starts from: the newest valid round build, else the reference."""
    lessons = load_lessons(ws)
    for r in reversed(lessons["rounds"]):
        if r.get("roundValid"):
            return Path(ws) / r["buildDir"], "round %d new-library build" % r["round"]
    ref = read_json(state(ws, "reference.json"), "state/reference.json")
    return Path(ws) / ref["dir"], "reference build"


# ---------------------------------------------------------------- timing (start of a round)

def cmd_timing(ws):
    ws = Path(ws)
    inputs = load_inputs(ws)
    k = len(load_lessons(ws)["rounds"]) + 1
    db, source = latest_build(ws)
    out = fresh_dir(ws / "runs" / ("r%d" % k) / "timing")
    rc, seconds = run_tool([tool(inputs, "himatime"), "load", "--db", str(db), "--out", str(out), "--paths", "20"])
    summary_path = out / "timing_summary.json"
    if rc != 0 or not summary_path.is_file():
        raise ToolError("HimaTime load of %s failed (exit %d)" % (db, rc))
    s = read_json(summary_path, "timing_summary.json")
    worst = [dict(id=p["id"], group=p["group"], startpoint=p["startpoint"], endpoint=p["endpoint"], slackNs=p["slackNs"],
                  cellDelayByFamilyPs=p["cellDelayByFamilyPs"]) for p in s["paths"][:8]]
    rec = dict(schema=TIMING_SCHEMA, round=k, source=source, buildDir=rel(ws, db), dir=rel(ws, out),
               reports=dict(summary=rel(ws, summary_path), timing=rel(ws, out / "report_timing.rpt"),
                            stages=rel(ws, out / "stage_breakdown.rpt")),
               summarySha256=sha256_file(summary_path), wnsNs=s["wnsNs"], tnsNs=s["tnsNs"], fmaxMhz=s["fmaxMhz"],
               violatingEndpoints=s["violatingEndpoints"], worstPaths=worst, stageBreakdown=s["stageBreakdown"],
               generatedFamilies=s["generatedFamilies"], netSharePct=s["netSharePct"], runtimeS=seconds, writtenAt=now(),
               claimBoundary=CLAIM_BOUNDARY)
    write_json(state(ws, "timing.json"), rec)
    publish(ws, "load-timing", k, [(out / "report_timing.rpt", "report_timing.rpt"), (out / "stage_breakdown.rpt", "stage_breakdown.rpt")])
    write_chart(ws, "load-timing", k, "stage-breakdown", stage_chart(
        s, "HimaTime %s stage breakdown (stage_breakdown.rpt) of the %s" % (_version(s), source),
        "Round %d starts at Fmax %.2f MHz; worst path %s" % (k, s["fmaxMhz"], s["worstPath"])))
    top = ", ".join("%s %.3f ns" % (r["family"], r["estRecoveryNs"]) for r in s["stageBreakdown"][:4])
    print("round %d starts from the %s: Fmax %.2f MHz, WNS %.4f ns; largest est. recovery: %s" % (k, source, s["fmaxMhz"], s["wnsNs"], top))


# ---------------------------------------------------------------- requirements (agent delivery)

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


def validate_requirements(ws, agent, path=None, files_root=None):
    """The one check of an agent's requirements (Reader and precheck). Returns (doc, facts)."""
    ws = Path(ws)
    if agent not in AGENTS:
        raise ToolError("agent must be one of %s" % ", ".join(AGENTS))
    path = Path(path) if path else state(ws, "%s-requirements.json" % agent)
    doc = read_json(path, "the %s requirements" % agent)
    inputs = load_inputs(ws)
    k, timing = current_round(ws)
    problems = []
    if not isinstance(doc, dict):
        raise ToolError("the requirements file must be one JSON object")
    if doc.get("schema") != REQUIREMENTS_SCHEMA:
        problems.append("schema must be %r" % REQUIREMENTS_SCHEMA)
    if doc.get("agent") != agent:
        problems.append("agent must be %r (this is the %s agent's delivery)" % (agent, agent))
    if doc.get("round") != k:
        problems.append("round must be %d (state/timing.json round)" % k)
    if not isinstance(doc.get("summary"), str) or len(doc["summary"].strip()) < 20:
        problems.append("summary must say in at least a sentence what the analysis found")
    items = doc.get("requirements")
    families = set(inputs["families"])
    aliases = {a.upper(): f for a, f in (inputs.get("aliases") or {}).items()}
    critical = {r["family"] for r in timing.get("stageBreakdown") or [] if r.get("estRecoveryNs", 0) > 0 and not r.get("generated")}
    on_critical = 0
    if not isinstance(items, list) or not 1 <= len(items) <= MAX_REQUIREMENTS:
        problems.append("requirements must be a list of 1-%d items" % MAX_REQUIREMENTS)
        items = []
    for i, r in enumerate(items, 1):
        where = "requirement %d" % i
        if not isinstance(r, dict):
            problems.append("%s must be an object" % where)
            continue
        fam = r.get("family")
        canon = None
        if isinstance(fam, str):
            key = fam.strip().upper()
            canon = key if key in families else aliases.get(key)
        if canon is None:
            problems.append("%s: family %r is not an AndesCell family (one of %s)" % (where, fam, ", ".join(sorted(families))))
        elif canon in critical:
            on_critical += 1
        for field in ("purpose", "target"):
            if not isinstance(r.get(field), str) or not r[field].strip():
                problems.append("%s: %s must be a non-empty string" % (where, field))
        if isinstance(r.get("target"), str) and not re.search(r"\d+(?:\.\d+)?\s*%", r["target"]):
            problems.append("%s: target must state a percentage, e.g. 'rise delay -10 %% at fanout 4'" % where)
        ev = r.get("evidence")
        if not ev or not isinstance(ev, (str, dict, list)):
            problems.append("%s: evidence must name the paths, stages or report lines it rests on" % where)
        pr = r.get("priority")
        if not ((isinstance(pr, int) and not isinstance(pr, bool) and 1 <= pr <= 5) or (isinstance(pr, str) and pr.lower() in ("high", "medium", "low"))):
            problems.append("%s: priority must be 1-5 (1 = highest) or high/medium/low" % where)
    report = doc.get("report")
    prefix = "reports/%s/r%d" % (AGENT_NODES[agent], k)
    roots = [r for r in (files_root, ws) if r]
    try:
        _file_under(roots, report, prefix)
    except ToolError as error:
        problems.append("report: %s (write your analysis as %s/analysis.md and deliver it as support)" % (error, prefix))
    if problems:
        raise ToolError("; ".join(problems))
    return doc, dict(count=len(items), onCriticalPath=on_critical, round=k)


def requested_families(inputs, doc):
    out = []
    for r in doc.get("requirements") or []:
        fam = canonical(inputs, r.get("family")) if isinstance(r, dict) else None
        if fam is not None and fam not in out:
            out.append(fam)
    return out


def proposal_chart(ws, agent):
    """reports/<agent node>/r<k>/proposal.chart.json: why this agent asks for these cells, from the
    tools' own numbers (HimaTime's stage breakdown in state/timing.json; Qualib's stock library)."""
    ws = Path(ws)
    doc, facts = validate_requirements(ws, agent)
    inputs = load_inputs(ws)
    k, timing = current_round(ws)
    families = requested_families(inputs, doc)[:16]
    rows = {r["family"]: r for r in timing.get("stageBreakdown") or []}
    top = sorted(families, key=lambda f: -rows.get(f, {}).get("estRecoveryNs", 0.0))[:2]
    if agent == "himatime":
        made = chart("Why these cells: timing", "", families,
                     [("Share of worst path, %", [rows.get(f, {}).get("worstPathSharePct", 0.0) for f in families], "neutral"),
                      ("Worst-path slack back, ps", [rows.get(f, {}).get("worstPathRecoveryPs", 0.0) for f in families], "proposed")],
                     "HimaTime stage breakdown of the %s, round %d (stage_breakdown.rpt)" % (timing["source"], k),
                     subtitle="The HimaTime agent's families: their share of the worst path and the slack HimaTime expects back",
                     highlight=top, better="higher",
                     caption="Slack back: the worst path's gain if the family's cells were AndesCell-class faster (HimaTime).")
    else:
        stock = tool_query(inputs, "qualib", ["list", "--lib", inputs["library"], "--json"])
        made = library_chart(fo4_rows(stock, families), "Why these cells: library FO4 against the AndesCell target",
                             "Qualib %s, stock library %s (qualib list)" % (_version(stock), inputs["library"]),
                             "The Qualib agent's families, round %d: stock FO4 and what a custom cell reaches" % k, highlight=top)
    return write_chart(ws, AGENT_NODES[agent], k, "proposal", made)


def cmd_requirements(ws, agent):
    doc, facts = validate_requirements(ws, agent)
    print("%s requirements for round %d accepted: %d requirement(s), %d on a critical-path family"
          % (agent, facts["round"], facts["count"], facts["onCriticalPath"]))




# ---------------------------------------------------------------- the round's deliveries after the join

def round_dir(ws, k):
    return Path(ws) / "runs" / ("r%d" % k)


def tool_path(inputs, name):
    """The Site's tool as bind-inputs recorded it, or the same command on PATH (an agent's sandbox)."""
    path = tool(inputs, name)
    if os.path.isfile(path) and os.access(path, os.X_OK):
        return path
    found = shutil.which(name)
    if found is None:
        raise ToolError("%s is neither at %s nor on PATH" % (name, path))
    return found


def tool_json(inputs, name, argv):
    """One fast, read-only tool query (--json, no output directory): the tool's own numbers."""
    out = subprocess.run([tool_path(inputs, name)] + argv + ["--json"], capture_output=True, text=True, timeout=120)
    if out.returncode != 0:
        raise ToolError("%s %s failed: %s" % (name, argv[0], (out.stderr or out.stdout).strip()[:400]))
    try:
        return json.loads(out.stdout)
    except ValueError:
        raise ToolError("%s %s printed no JSON" % (name, argv[0]))


def canonical(inputs, word):
    """The AndesCell family a word names (aliases included), or None."""
    if not isinstance(word, str):
        return None
    key = word.strip().upper()
    if key in set(inputs["families"]):
        return key
    return {a.upper(): f for a, f in (inputs.get("aliases") or {}).items()}.get(key)


def merged_requirements(ws):
    """Both agents' validated requirements of this round, as one list (each item names its source)."""
    merged = []
    for agent in AGENTS:
        doc, _ = validate_requirements(ws, agent)
        for r in doc["requirements"]:
            merged.append(dict(r, source=agent))
    k, _ = current_round(ws)
    return dict(schema="hima-andes-requirements-merged/1", round=k, requirements=merged)


def cmd_merged(ws):
    print(json.dumps(merged_requirements(ws), indent=2, sort_keys=True))


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


def validate_plan(ws, path=None, files_root=None):
    """The one check of the AndesCell agent's generation plan (Reader, precheck, generate-cells)."""
    ws = Path(ws)
    path = Path(path) if path else state(ws, "generation-plan.json")
    doc = read_json(path, "the generation plan")
    if not isinstance(doc, dict):
        raise ToolError("the generation plan must be one JSON object")
    inputs = load_inputs(ws)
    k, timing = current_round(ws)
    problems = _intro_problems(doc, PLAN_SCHEMA, "andescell", k)
    library = load_library(ws)
    existing = set(library.get("families") or []) | set(timing.get("generatedFamilies") or [])
    requested = []
    for r in merged_requirements(ws)["requirements"]:
        fam = canonical(inputs, r.get("family"))
        if fam is not None and fam not in requested:
            requested.append(fam)
    candidates = [f for f in requested if f not in existing]
    recovery = {r["family"]: r.get("estRecoveryNs", 0.0) for r in timing.get("stageBreakdown") or []}
    limit = int(inputs.get("maxFamiliesPerRound") or 2)
    chosen = []
    items = doc.get("families")
    if not isinstance(items, list) or not 1 <= len(items) <= limit:
        problems.append("families must list 1-%d families (AndesCell builds at most %d per round)" % (limit, limit))
        items = []
    for i, item in enumerate(items, 1):
        where = "family %d" % i
        if not isinstance(item, dict):
            problems.append("%s must be an object {family, reason, estRecoveryNs}" % where)
            continue
        fam = canonical(inputs, item.get("family"))
        if fam is None:
            problems.append("%s: %r is not an AndesCell family" % (where, item.get("family")))
            continue
        if fam in existing:
            problems.append("%s: %s is already in the delivered library" % (where, fam))
        elif fam not in requested:
            problems.append("%s: %s was not requested this round (requested: %s)" % (where, fam, ", ".join(requested)))
        if fam in chosen:
            problems.append("%s: %s is listed twice" % (where, fam))
        chosen.append(fam)
        if not isinstance(item.get("reason"), str) or len(item["reason"].strip()) < 10:
            problems.append("%s: reason must say why %s, in a sentence" % (where, fam))
        est = item.get("estRecoveryNs")
        if not isinstance(est, (int, float)) or isinstance(est, bool) or abs(est - recovery.get(fam, 0.0)) > 0.0015:
            problems.append("%s: estRecoveryNs must be HimaTime's estimated recovery for %s, %.3f ns (state/timing.json stageBreakdown)"
                            % (where, fam, recovery.get(fam, 0.0)))
    skipped = doc.get("skipped")
    if not isinstance(skipped, list):
        problems.append("skipped must be a list of {family, reason} (empty when nothing else was requested)")
        skipped = []
    said = set()
    for item in skipped:
        fam = canonical(inputs, item.get("family")) if isinstance(item, dict) else None
        if fam is None or not isinstance(item.get("reason"), str) or not item["reason"].strip():
            problems.append("skipped item %r must name an AndesCell family and a reason" % (item,))
        else:
            said.add(fam)
    for fam in candidates:
        if fam not in chosen and fam not in said:
            problems.append("skipped: %s was requested and not chosen; say why" % fam)
    problem = _report_problem([r for r in (files_root, ws) if r], doc.get("report"), "reports/%s/r%d" % (PLAN_NODE, k))
    if problem:
        problems.append(problem)
    if problems:
        raise ToolError("; ".join(problems))
    # Informational: the plan took the candidates HimaTime expects the most back from (ties allowed).
    best = sorted((recovery.get(f, 0.0) for f in candidates), reverse=True)[:len(chosen)]
    follows = sorted((recovery.get(f, 0.0) for f in chosen), reverse=True) == best
    return doc, dict(round=k, families=chosen, candidates=candidates, followsRanking=follows)


def _generation(ws, k):
    gen = read_json(state(ws, "generation.json"), "state/generation.json")
    if gen.get("round") != k:
        raise ToolError("state/generation.json is for round %s, this is round %d" % (gen.get("round"), k))
    return gen


def tool_facts(ws, inputs, k, timing):
    """What HimaTime and Qualib say about this round's cells: the deterministic reference a verify
    delivery is held against, and the numbers the Reader states."""
    gen = _generation(ws, k)
    cells_dir = str(Path(ws) / gen["dir"])
    verify = tool_json(inputs, "himatime", ["verify", "--cells", cells_dir, "--db", str(Path(ws) / timing["buildDir"]), "--paths", str(VERIFY_PATHS)])
    screen = tool_json(inputs, "qualib", ["screen", "--cells", cells_dir])
    return gen, verify, screen


def _near(a, b):
    return isinstance(a, (int, float)) and not isinstance(a, bool) and abs(a - b) <= NUMBER_TOLERANCE


def validate_check(ws, kind, path=None, files_root=None):
    """The one check of a verify delivery (Reader, precheck, rebuild): HimaTime's local timing of the
    new cells or Qualib's screen decision, held against the tools' own deterministic answer."""
    ws = Path(ws)
    if kind not in CHECK_KINDS:
        raise ToolError("kind must be one of %s" % ", ".join(CHECK_KINDS))
    path = Path(path) if path else state(ws, "%s.json" % kind)
    doc = read_json(path, "the %s delivery" % kind)
    if not isinstance(doc, dict):
        raise ToolError("the %s delivery must be one JSON object" % kind)
    inputs = load_inputs(ws)
    k, timing = current_round(ws)
    gen, verify, screen = tool_facts(ws, inputs, k, timing)
    names = [c["name"] for c in gen["cells"]]
    problems = []
    if kind == "himatime-verify":
        problems += _intro_problems(doc, CELL_TIMING_SCHEMA, "himatime", k)
        local = verify["local"]
        by_path = {p["id"]: p for p in local["paths"]}
        if doc.get("worstPath") != local["worstPath"]:
            problems.append("worstPath must be %s, the worst of the build's paths HimaTime re-timed" % local["worstPath"])
        if not _near(doc.get("localGainPs"), local["localGainPs"]):
            problems.append("localGainPs must be HimaTime's gain on the worst path, %.2f ps (himatime verify --paths %d)" % (local["localGainPs"], VERIFY_PATHS))
        paths = doc.get("paths")
        if not isinstance(paths, list) or not paths:
            problems.append("paths must list the re-timed worst paths {id, beforePs, afterPs, gainPs}")
            paths = []
        if paths and isinstance(paths[0], dict) and paths[0].get("id") != local["worstPath"]:
            problems.append("paths must start with the worst path %s" % local["worstPath"])
        for item in paths:
            ref = by_path.get(item.get("id")) if isinstance(item, dict) else None
            if ref is None:
                problems.append("path %r is not one of the %d worst paths HimaTime re-timed" % (item.get("id") if isinstance(item, dict) else item, VERIFY_PATHS))
                continue
            for field in ("beforePs", "afterPs", "gainPs"):
                if not _near(item.get(field), ref[field]):
                    problems.append("path %s: %s must be %.2f ps (HimaTime)" % (ref["id"], field, ref[field]))
        cells = {c.get("name"): c for c in doc.get("cells") or [] if isinstance(c, dict)}
        tool_cells = {c["name"]: c for c in verify["cells"]}
        for name in names:
            got, ref = cells.get(name), tool_cells[name]
            if got is None:
                problems.append("cells: %s is missing (every new cell with its FO4 against its stock cell)" % name)
                continue
            if not _near(got.get("fo4Ps"), ref["fo4DelayPs"]) or not _near(got.get("stockFo4Ps"), ref["stockFo4DelayPs"]) or got.get("stockCell") != ref["stockCell"]:
                problems.append("cells: %s must read FO4 %.1f ps against %s %.1f ps (HimaTime)" % (name, ref["fo4DelayPs"], ref["stockCell"], ref["stockFo4DelayPs"]))
        for name in cells:
            if name not in tool_cells:
                problems.append("cells: %r is not a cell AndesCell generated this round" % name)
        node = "himatime-verify"
    else:
        problems += _intro_problems(doc, CELL_SCREEN_SCHEMA, "qualib", k)
        tool_cells = {c["name"]: c for c in screen["cells"]}
        cells = doc.get("cells")
        if not isinstance(cells, list):
            problems.append("cells must list every new cell {name, status PASS or FAIL, reasons}")
            cells = []
        seen = set()
        for item in cells:
            name = item.get("name") if isinstance(item, dict) else None
            ref = tool_cells.get(name)
            if ref is None:
                problems.append("cells: %r is not a cell AndesCell generated this round" % (name,))
                continue
            if name in seen:
                problems.append("cells: %s is listed twice" % name)
            seen.add(name)
            status, reasons = item.get("status"), item.get("reasons")
            if status not in ("PASS", "FAIL"):
                problems.append("cells: %s status must be PASS or FAIL" % name)
            elif status == "PASS" and ref["status"] != "PASS":
                problems.append("cells: %s fails the Qualib screen (%s); it cannot pass" % (name, "; ".join(ref["reasons"])))
            elif status == "FAIL" and not (isinstance(reasons, list) and any(isinstance(x, str) and x.strip() for x in reasons) or isinstance(reasons, str) and reasons.strip()):
                problems.append("cells: %s is FAIL and needs its reasons" % name)
        for name in names:
            if name not in seen:
                problems.append("cells: %s is missing (decide PASS or FAIL for every new cell)" % name)
        node = "qualib-screen"
    problem = _report_problem([r for r in (files_root, ws) if r], doc.get("report"), "reports/%s/r%d" % (node, k))
    if problem:
        problems.append(problem)
    if problems:
        raise ToolError("; ".join(problems))
    facts = dict(round=k, localGainPs=verify["local"]["localGainPs"], worstPath=verify["local"]["worstPath"],
                 cellsPassedScreen=len(screen["passed"]), cellsFailedScreen=list(screen["failed"]),
                 cellsFasterThanStock=sum(1 for c in verify["cells"] if c["fo4DelayPs"] < c["stockFo4DelayPs"]),
                 fasterCells=[c["name"] for c in verify["cells"] if c["fo4DelayPs"] < c["stockFo4DelayPs"]])
    if kind == "qualib-screen":
        facts["agentPassed"] = [c["name"] for c in doc["cells"] if c.get("status") == "PASS"]
    return doc, facts


def check_chart(ws, kind):
    """reports/<node>/r<k>/<name>.chart.json for an accepted verify delivery, from the tools' own
    answer: HimaTime's re-timed worst paths (local-gain) or Qualib's screen ratios (screen)."""
    ws = Path(ws)
    inputs = load_inputs(ws)
    k, timing = current_round(ws)
    gen, verify, screen = tool_facts(ws, inputs, k, timing)
    if kind == "himatime-verify":
        local = verify["local"]
        rows = local["paths"]
        made = chart("Worst paths with the new cells: slack before and after", "ps", [path_label(p) for p in rows],
                     [("Before", [1000.0 * p["slackBeforeNs"] for p in rows], "baseline"),
                      # HimaTime's slack before plus its gain in ps (slackAfterNs is rounded to 0.1 ps)
                      ("With the new cells", [1000.0 * p["slackBeforeNs"] + p["gainPs"] for p in rows], "measured")],
                     "HimaTime %s verify --paths %d of %s on the %s (verify.rpt)" % (_version(verify), VERIFY_PATHS, gen["library"], timing["source"]),
                     subtitle="Local gain on the worst path %s: %.2f ps" % (local["worstPath"], local["localGainPs"]),
                     better="higher", highlight=[path_label(rows[0])] if rows else (),
                     caption="Every new cell of the round, extra-fast variants included; the rebuild uses only the cells that pass the screen.")
        return write_chart(ws, "himatime-verify", k, "local-gain", made)
    limits = screen["limits"]
    cells = screen["cells"][:16]
    made = chart("New cells against the screen limits", "% of limit", [c["name"] for c in cells],
                 [("Area", [100.0 * c["ratios"]["area"] / limits["area"] for c in cells], "neutral"),
                  ("Input cap", [100.0 * c["ratios"]["cap"] / limits["cap"] for c in cells], "neutral"),
                  ("Leakage", [100.0 * c["ratios"]["leakage"] / limits["leakage"] for c in cells], "neutral")],
                 "Qualib %s cell screen of %s (cell_screen.rpt)" % (_version(screen), gen["library"]),
                 subtitle="%d of %d cells pass; above 100 %% fails" % (len(screen["passed"]), len(cells)), better="lower",
                 highlight=[c["name"] for c in cells if c["status"] != "PASS"],
                 caption="Each ratio to its stock cell, as a share of its limit: area %.2fx, input cap %.2fx, leakage %.2fx."
                 % (limits["area"], limits["cap"], limits["leakage"]))
    return write_chart(ws, "qualib-screen", k, "screen", made)


def cmd_delivery(ws, kind):
    if kind == "andescell":
        doc, facts = validate_plan(ws)
        print("generation plan for round %d accepted: %s" % (facts["round"], ", ".join(facts["families"])))
        return
    doc, facts = validate_check(ws, kind)
    print("%s for round %d accepted: local gain %.2f ps on %s; %d cell(s) pass the Qualib screen"
          % (kind, facts["round"], facts["localGainPs"], facts["worstPath"], facts["cellsPassedScreen"]))


def cmd_precheck(ws, kind, path, own_workspace=None):
    root = own_workspace or os.getcwd()
    if kind in AGENTS:
        doc, facts = validate_requirements(ws, kind, path=path, files_root=root)
        print("precheck PASS: %s round %d, %d requirement(s) (%d on a critical-path family). Deliver %s as the result and "
              "%s as support." % (kind, facts["round"], facts["count"], facts["onCriticalPath"], path, doc["report"]))
        return
    if kind == "andescell":
        doc, facts = validate_plan(ws, path=path, files_root=root)
        print("precheck PASS: generation plan round %d, families %s. Deliver %s as the result and %s (and your other "
              "reports under its folder) as support." % (facts["round"], ", ".join(facts["families"]), path, doc["report"]))
        return
    if kind in CHECK_KINDS:
        doc, facts = validate_check(ws, kind, path=path, files_root=root)
        print("precheck PASS: %s round %d (local gain %.2f ps on %s; %d cell(s) pass the Qualib screen). Deliver %s as the "
              "result and %s (and your other reports under its folder) as support."
              % (kind, facts["round"], facts["localGainPs"], facts["worstPath"], facts["cellsPassedScreen"], path, doc["report"]))
        return
    raise ToolError("kind must be one of %s" % ", ".join(AGENTS + ("andescell",) + CHECK_KINDS))


# ---------------------------------------------------------------- generate and rebuild

def cmd_generate(ws):
    ws = Path(ws)
    inputs = load_inputs(ws)
    k, timing = current_round(ws)
    plan, facts = validate_plan(ws)
    merged_path = round_dir(ws, k) / "requirements.merged.json"
    write_json(merged_path, merged_requirements(ws))
    library = load_library(ws)
    out = fresh_dir(round_dir(ws, k) / "andescell")
    argv = [tool(inputs, "andescell"), "generate", "--requirements", str(merged_path), "--db", str(ws / timing["buildDir"]),
            "--round", str(k), "--families", ",".join(facts["families"]), "--out", str(out)]
    for r in library["rounds"]:
        argv += ["--existing", str(ws / r["dir"])]
    rc, seconds = run_tool(argv)
    gen_path = out / "generation.json"
    if rc != 0 or not gen_path.is_file():
        raise ToolError("AndesCell generation failed (exit %d)" % rc)
    gen = read_json(gen_path, "generation.json")
    manifest = read_json(out / ("andes_r%d.json" % k), "AndesCell library manifest")
    rec = dict(schema="hima-andes-generation/1", round=k, dir=rel(ws, out), library=manifest["name"],
               selected=gen["selected"], skipped=gen["skipped"], ranked=gen["ranked"], requirements=gen["requirements"],
               plan=dict(families=[dict(family=canonical(inputs, f["family"]), reason=f["reason"]) for f in plan["families"]],
                         followsRanking=facts["followsRanking"]),
               cells=[dict(name=c["name"], family=c["family"], drive=c["drive"], speedupPct=c["speedupPct"], areaUm2=c["areaUm2"])
                      for c in manifest["cells"]], manifestSha256=sha256_file(out / ("andes_r%d.json" % k)),
               runtimeS=seconds, writtenAt=now())
    write_json(state(ws, "generation.json"), rec)
    publish(ws, "generate-cells", k, [(out / "generation.rpt", "generation.rpt")])
    cells = manifest["cells"][:16]
    write_chart(ws, "generate-cells", k, "generation", chart(
        "New cells against their stock cells", "ps", [c["name"] for c in cells],
        [("Stock cell FO4", [c["stockFo4DelayPs"] for c in cells], "baseline"), ("AndesCell FO4", [c["fo4DelayPs"] for c in cells], "measured")],
        "AndesCell %s characterization, %s (generation.rpt)" % (_version(gen), manifest["name"]),
        subtitle="Round %d: %s" % (k, ", ".join(gen["selected"]) or "no family"), better="lower",
        highlight=[c["name"] for c in cells if not c["variant"].startswith("XF")],
        caption="XF cells are extra-fast high-drive variants; the Qualib screen decides whether they may enter a build."))
    print("AndesCell round %d: %d cell(s) in %s (the generation plan's families)" % (k, len(rec["cells"]), ", ".join(rec["selected"]) or "no family"))


def accepted_cells(ws):
    """This round's cells the rebuild may use: passed by the Qualib agent's screen (which the tool
    confirms) and faster than their stock cell in HimaTime's verification."""
    _, timing_facts = validate_check(ws, "himatime-verify")
    screen_doc, screen_facts = validate_check(ws, "qualib-screen")
    faster = set(timing_facts["fasterCells"])
    return [c for c in screen_facts["agentPassed"] if c in faster], timing_facts, screen_doc


def cmd_build(ws, timeout_min):
    ws = Path(ws)
    inputs = load_inputs(ws)
    k, _ = current_round(ws)
    gen = _generation(ws, k)
    accepted, _, _ = accepted_cells(ws)
    extra = [(ws / r["dir"], r["dontUse"]) for r in load_library(ws)["rounds"]]
    all_cells = [c["name"] for c in gen["cells"]]
    if all_cells:
        extra.append((ws / gen["dir"], sorted(set(all_cells) - set(accepted))))
    out = fresh_dir(round_dir(ws, k) / "build")
    result = sapr_build(ws, inputs, out, timeout_min, extra)
    rec = build_record(ws, "round", k, out, result, extra)
    rec["acceptedCells"] = accepted
    write_json(state(ws, "round-build.json"), rec)
    publish(ws, "new-library-build", k, [(out / "reports" / name, name) for name in BUILD_REPORTS])
    if not rec["finished"]:
        raise ToolError("the new-library build did not finish: %s" % rec["failure"])
    report = subprocess.run([tool(inputs, "himatime"), "report", "--db", str(out), "--paths", "5"], capture_output=True, text=True, timeout=120)
    if report.returncode == 0:
        write_text(report_dir(ws, "new-library-build", k) / "report_timing.rpt", report.stdout)
    print("round %d new-library build: Fmax %.2f MHz (WNS %.4f ns), %d new-cell instances, area %.1f um^2"
          % (k, rec["fmaxMhz"], rec["wnsNs"], rec["newCellInstances"], rec["areaUm2"]))


# ---------------------------------------------------------------- compare: the round record

def cmd_compare(ws):
    ws = Path(ws)
    k, timing = current_round(ws)
    ref = read_json(state(ws, "reference.json"), "state/reference.json")
    build = read_json(state(ws, "round-build.json"), "state/round-build.json")
    gen = _generation(ws, k)
    verify = read_json(state(ws, "himatime-verify.json"), "state/himatime-verify.json")
    screen = read_json(state(ws, "qualib-screen.json"), "state/qualib-screen.json")
    if verify.get("round") != k or screen.get("round") != k:
        raise ToolError("the verify deliveries are not this round's (%d)" % k)
    passed = [c["name"] for c in screen["cells"] if c.get("status") == "PASS"]
    failed = [dict(name=c["name"], reasons=c.get("reasons")) for c in screen["cells"] if c.get("status") != "PASS"]
    lessons = load_lessons(ws)
    library = load_library(ws)
    if build.get("round") != k:
        raise ToolError("state/round-build.json is for round %s, this is round %d" % (build.get("round"), k))
    reqs = {}
    for agent in AGENTS:
        doc = read_json(state(ws, "%s-requirements.json" % agent))
        reqs[agent] = [dict(family=r.get("family"), target=r.get("target"), priority=r.get("priority")) for r in doc["requirements"]]
    earlier_ok = {c for r in library["rounds"] for c in r["acceptedCells"]}
    accepted = set(build.get("acceptedCells") or [])
    used = build.get("newCellInstancesByCell") or {}
    problems = []
    if not build["finished"]:
        problems.append("the new-library build did not finish: %s" % build.get("failure"))
    if build.get("routeDrcErrors") not in (0,):
        problems.append("route DRC errors: %s" % build.get("routeDrcErrors"))
    if build.get("clockPeriodNs") != ref.get("clockPeriodNs"):
        problems.append("the build clock differs from the reference clock")
    stray = sorted(c for c in used if c not in accepted and c not in earlier_ok)
    if stray:
        problems.append("the build used cells that did not pass the Qualib screen and HimaTime verification: %s" % ", ".join(stray))
    valid = not problems
    previous = [r for r in lessons["rounds"] if r.get("roundValid")]
    prev_best = max([r["fmaxMhz"] for r in previous], default=ref["fmaxMhz"])
    fmax = build.get("fmaxMhz")
    gain = pct(fmax, ref["fmaxMhz"]) if valid else None
    improved = bool(valid and fmax is not None and fmax > prev_best + IMPROVE_EPS_MHZ)
    best_fmax = max(prev_best, fmax) if valid and fmax is not None else prev_best
    best_gain = pct(best_fmax, ref["fmaxMhz"])
    this_families = sorted({c["family"] for c in gen["cells"] if c["name"] in accepted})
    cumulative = sorted(set(library.get("families") or []) | set(this_families)) if valid else sorted(library.get("families") or [])
    record = dict(
        schema=ROUND_SCHEMA, round=k, roundValid=valid, problems=problems,
        reference=dict(fmaxMhz=ref["fmaxMhz"], wnsNs=ref["wnsNs"], tnsNs=ref["tnsNs"], areaUm2=ref["areaUm2"],
                       instances=ref["instances"], routeDrcErrors=ref["routeDrcErrors"]),
        build=dict(fmaxMhz=fmax, wnsNs=build.get("wnsNs"), tnsNs=build.get("tnsNs"), areaUm2=build.get("areaUm2"),
                   instances=build.get("instances"), routeDrcErrors=build.get("routeDrcErrors"), dir=build["dir"],
                   newCellInstances=build.get("newCellInstances", 0), newCellInstancesByCell=used),
        startedFrom=dict(source=timing["source"], fmaxMhz=timing["fmaxMhz"], wnsNs=timing["wnsNs"]),
        fmaxGainPct=gain, previousBestFmaxMhz=prev_best, bestFmaxMhz=best_fmax, bestGainPct=best_gain,
        roundImproved=improved, areaChangePct=pct(build.get("areaUm2"), ref["areaUm2"]),
        requested=reqs, plan=gen.get("plan"), selectedFamilies=gen["selected"], skipped=gen["skipped"],
        cellsGenerated=len(gen["cells"]), cellsPassedScreen=len(passed), cellsFailedScreen=[c["name"] for c in failed],
        screenReasons={c["name"]: c["reasons"] for c in failed},
        localGainPs=verify.get("localGainPs"), localGainPath=verify.get("worstPath"),
        acceptedCells=sorted(accepted), newFamiliesUsed=this_families,
        cumulativeFamilies=cumulative, claimBoundary=CLAIM_BOUNDARY, writtenAt=now())
    write_json(state(ws, "round.json"), record)
    lesson = dict(round=k, roundValid=valid, fmaxMhz=fmax, fmaxGainPct=gain, roundImproved=improved, wnsNs=build.get("wnsNs"),
                  tnsNs=build.get("tnsNs"), areaUm2=build.get("areaUm2"), newCellInstances=build.get("newCellInstances", 0),
                  requested=reqs, plan=gen.get("plan"), selectedFamilies=gen["selected"],
                  skipped=[dict(family=s["family"], reason=s["reason"]) for s in gen["skipped"]],
                  localGainPs=verify.get("localGainPs"), localGainPath=verify.get("worstPath"),
                  acceptedCells=sorted(accepted), failedScreen=failed, buildDir=build["dir"],
                  startedFromFmaxMhz=timing["fmaxMhz"], problems=problems)
    lessons["rounds"].append(lesson)
    write_json(state(ws, "lessons.json"), lessons)
    if valid and gen["cells"]:
        dont_use = sorted({c["name"] for c in gen["cells"]} - accepted)
        library["rounds"].append(dict(round=k, name=gen["library"], dir=gen["dir"], acceptedCells=sorted(accepted),
                                      dontUse=dont_use, families=this_families))
        library["families"] = cumulative
        write_json(state(ws, "library.json"), library)
    write_text(ws / "derived" / ("round-%d.md" % k), round_markdown(record))
    publish(ws, "compare-round", k, [(ws / "derived" / ("round-%d.md" % k), "round-%d.md" % k)])
    write_chart(ws, "compare-round", k, "before-after", chart(
        "Before and after: the reference build against the new library", "", ["Fmax, MHz", "Worst slack, ps", "TNS, ps"],
        [("Reference build", [ref["fmaxMhz"], 1000.0 * ref["wnsNs"], 1000.0 * ref["tnsNs"]], "baseline"),
         ("Round %d new library" % k, [fmax, None if build.get("wnsNs") is None else 1000.0 * build["wnsNs"],
                                       None if build.get("tnsNs") is None else 1000.0 * build["tnsNs"]], "measured")],
        "Synthesis and APR post-route summaries, reference and round %d builds (report_qor.rpt)" % k,
        subtitle="Fmax gain %s %% over the reference build" % _fmt(gain), better="higher",
        caption=SHOWN_BOUNDARY))
    write_summary(ws)
    print("round %d: Fmax %s MHz vs reference %.2f MHz (%s %%), best %s %%, improved %s, valid %s"
          % (k, fmax, ref["fmaxMhz"], gain, best_gain, improved, valid))


def _fmt(value, spec="%.2f"):
    return "n/a" if value is None else spec % value


def round_markdown(r):
    ref, b = r["reference"], r["build"]
    lines = ["# Round %d: new standard cells for aes_cipher_top" % r["round"], "",
             "Started from the %s (Fmax %.2f MHz)." % (r["startedFrom"]["source"], r["startedFrom"]["fmaxMhz"]), "",
             "| | Reference build | New-library build |", "| --- | --- | --- |",
             "| Fmax (MHz) | %.2f | %s |" % (ref["fmaxMhz"], _fmt(b["fmaxMhz"])),
             "| Worst slack (ns) | %.4f | %s |" % (ref["wnsNs"], _fmt(b["wnsNs"], "%.4f")),
             "| Total negative slack (ns) | %.3f | %s |" % (ref["tnsNs"], _fmt(b["tnsNs"], "%.3f")),
             "| Cell area (um^2) | %.1f | %s |" % (ref["areaUm2"], _fmt(b["areaUm2"], "%.1f")),
             "| Instances | %d | %s |" % (ref["instances"], b["instances"]),
             "| New-cell instances | 0 | %d |" % b["newCellInstances"],
             "| Route DRC errors | %d | %s |" % (ref["routeDrcErrors"], b["routeDrcErrors"]), "",
             "Fmax gain over the reference build: **%s %%** (best so far %s %%)." % (_fmt(r["fmaxGainPct"]), _fmt(r["bestGainPct"])), "",
             "Requested by the HimaTime agent: %s." % ", ".join(x["family"] for x in r["requested"]["himatime"]),
             "Requested by the Qualib agent: %s." % ", ".join(x["family"] for x in r["requested"]["qualib"]),
             "The AndesCell agent chose: %s." % "; ".join("%s (%s)" % (f["family"], f["reason"]) for f in (r.get("plan") or {}).get("families") or []),
             "AndesCell generated: %s (%d cells; %d passed the Qualib screen)." % (
                 ", ".join(r["selectedFamilies"]) or "nothing", r["cellsGenerated"], r["cellsPassedScreen"]),
             "HimaTime local gain on the worst path %s: %s ps." % (r.get("localGainPath") or "?", _fmt(r.get("localGainPs"))),
             ]
    for name in r["cellsFailedScreen"]:
        reasons = r["screenReasons"].get(name)
        lines.append("Left out after the screen: %s (%s)." % (name, "; ".join(reasons) if isinstance(reasons, list) else reasons))
    for s in r["skipped"]:
        lines.append("Not generated: %s, %s." % (s["family"], s["reason"]))
    if r["problems"]:
        lines += ["", "Problems: " + "; ".join(r["problems"])]
    lines += ["", SHOWN_BOUNDARY, ""]
    return "\n".join(lines)


def write_summary(ws):
    ws = Path(ws)
    ref = read_json(state(ws, "reference.json"), "state/reference.json")
    lessons = load_lessons(ws)
    rounds = lessons["rounds"]
    best = max([r["fmaxMhz"] for r in rounds if r.get("roundValid") and r.get("fmaxMhz") is not None], default=None)
    summary = dict(schema="hima-andes-summary/1", reference=dict(fmaxMhz=ref["fmaxMhz"], wnsNs=ref["wnsNs"], tnsNs=ref["tnsNs"],
                                                                 areaUm2=ref["areaUm2"], instances=ref["instances"]),
                   rounds=rounds, bestFmaxMhz=best, bestGainPct=pct(best, ref["fmaxMhz"]),
                   cumulativeFamilies=load_library(ws).get("families"), claimBoundary=CLAIM_BOUNDARY, writtenAt=now())
    write_json(ws / "derived" / "summary.json", summary)
    lines = ["# New standard cells for a faster aes_cipher_top: summary", "",
             "Reference build (stock std9t_svt): Fmax %.2f MHz, worst slack %.4f ns, TNS %.3f ns, area %.1f um^2."
             % (ref["fmaxMhz"], ref["wnsNs"], ref["tnsNs"], ref["areaUm2"]), "",
             "| round | new families | Fmax (MHz) | gain over reference | worst slack (ns) | new-cell instances | area (um^2) | improved |",
             "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    for r in rounds:
        lines.append("| %d | %s | %s | %s %% | %s | %d | %s | %s |" % (
            r["round"], ", ".join(r["selectedFamilies"]) or "-", _fmt(r["fmaxMhz"]), _fmt(r["fmaxGainPct"]),
            _fmt(r["wnsNs"], "%.4f"), r["newCellInstances"], _fmt(r["areaUm2"], "%.1f"), "yes" if r["roundImproved"] else "no"))
    lines += ["", "Best Fmax gain over the reference build: %s %%." % _fmt(summary["bestGainPct"]),
              "Cell families in the delivered library: %s." % (", ".join(summary["cumulativeFamilies"] or []) or "none"), "",
              "Round reports: `derived/round-<k>.md`; every tool's and agent's reports under `reports/<step>/r<k>/`.", "",
              "Claim boundary: " + CLAIM_BOUNDARY, ""]
    write_text(ws / "derived" / "summary.md", "\n".join(lines))


# ---------------------------------------------------------------- entry

COMMANDS = {
    "bind": (cmd_bind, (3,)), "reference": (cmd_reference, (1,)), "timing": (cmd_timing, (0,)),
    "requirements": (cmd_requirements, (1,)), "delivery": (cmd_delivery, (1,)), "precheck": (cmd_precheck, (2, 3)),
    "merged": (cmd_merged, (0,)), "generate": (cmd_generate, (0,)),
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
