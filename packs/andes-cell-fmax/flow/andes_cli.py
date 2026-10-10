#!/usr/bin/env python3
"""Deterministic steps of the andes-cell-fmax Pack (python3, stdlib only).

Every number this file writes comes from a tool report (sapr, himatime, qualib, andescell), never
from model text. The tools are the mock EDA toolchain bound by the Site (edaRoot).

  bind       <WS> <EDA_ROOT> <DESIGN_ROOT> <LIBRARY>   tool versions, design, families
  reference  <WS> <TIMEOUT_MIN>        Synthesis and APR on the stock library (the reference build)
  timing     <WS>                      load the latest build into HimaTime (start of a round)
  requirements <WS> <AGENT>            validate state/<AGENT>-requirements.json (agent delivery)
  precheck   <WS> <AGENT> <FILE> [<OWN_WORKSPACE>]   the agent's own check before delivery
  generate   <WS>                      AndesCell on the merged requirements of both agents
  screen     <WS>                      Qualib cell screen of this round's cells
  verify     <WS>                      HimaTime verification of this round's cells
  build      <WS> <TIMEOUT_MIN>        Synthesis and APR with the stock + every accepted new cell
  compare    <WS>                      round record, lessons, cumulative library and summary

All output goes under <WS>. The mock EDA root and the design root are read-only.
"""
import hashlib
import json
import os
import re
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
TOOLS = ("sapr", "himatime", "qualib", "andescell", "xtop")
MAX_REQUIREMENTS = 8
CLAIM_BOUNDARY = ("Every EDA result in this Pack comes from mock tools on a demo Site (mock EDA); "
                  "not signoff, not silicon.")
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
    print("bound %s on %s; %d AndesCell families; EDA root %s" % (DESIGN, library, len(inputs["families"]), mock_root))


# ---------------------------------------------------------------- builds

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
    if not rec["finished"]:
        raise ToolError("the reference build did not finish: %s" % rec["failure"])
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
            problems.append("%s: target must state a percentage, e.g. 'rise delay -30 %% at fanout 4'" % where)
        ev = r.get("evidence")
        if not ev or not isinstance(ev, (str, dict, list)):
            problems.append("%s: evidence must name the paths, stages or report lines it rests on" % where)
        pr = r.get("priority")
        if not ((isinstance(pr, int) and not isinstance(pr, bool) and 1 <= pr <= 5) or (isinstance(pr, str) and pr.lower() in ("high", "medium", "low"))):
            problems.append("%s: priority must be 1-5 (1 = highest) or high/medium/low" % where)
    report = doc.get("report")
    prefix = "requirements/%s/r%d" % (agent, k)
    roots = [r for r in (files_root, ws) if r]
    try:
        _file_under(roots, report, prefix)
    except ToolError as error:
        problems.append("report: %s (write your analysis as %s/analysis.md and deliver it as support)" % (error, prefix))
    if problems:
        raise ToolError("; ".join(problems))
    return doc, dict(count=len(items), onCriticalPath=on_critical, round=k)


def cmd_requirements(ws, agent):
    doc, facts = validate_requirements(ws, agent)
    print("%s requirements for round %d accepted: %d requirement(s), %d on a critical-path family"
          % (agent, facts["round"], facts["count"], facts["onCriticalPath"]))


def cmd_precheck(ws, agent, path, own_workspace=None):
    doc, facts = validate_requirements(ws, agent, path=path, files_root=own_workspace or os.getcwd())
    print("precheck PASS: %s round %d, %d requirement(s) (%d on a critical-path family). Deliver %s as the result and "
          "%s as support." % (agent, facts["round"], facts["count"], facts["onCriticalPath"], path, doc["report"]))


# ---------------------------------------------------------------- generate, screen, verify, build

def round_dir(ws, k):
    return Path(ws) / "runs" / ("r%d" % k)


def cmd_generate(ws):
    ws = Path(ws)
    inputs = load_inputs(ws)
    k, timing = current_round(ws)
    merged = []
    for agent in AGENTS:
        doc, _ = validate_requirements(ws, agent)
        for r in doc["requirements"]:
            merged.append(dict(r, source=agent))
    merged_path = round_dir(ws, k) / "requirements.merged.json"
    write_json(merged_path, dict(schema="hima-andes-requirements-merged/1", round=k, requirements=merged))
    library = load_library(ws)
    out = fresh_dir(round_dir(ws, k) / "andescell")
    argv = [tool(inputs, "andescell"), "generate", "--requirements", str(merged_path), "--db", str(ws / timing["buildDir"]),
            "--round", str(k), "--out", str(out)]
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
               cells=[dict(name=c["name"], family=c["family"], drive=c["drive"], speedupPct=c["speedupPct"], areaUm2=c["areaUm2"])
                      for c in manifest["cells"]], manifestSha256=sha256_file(out / ("andes_r%d.json" % k)),
               runtimeS=seconds, writtenAt=now())
    write_json(state(ws, "generation.json"), rec)
    print("AndesCell round %d: %d cell(s) in %s" % (k, len(rec["cells"]), ", ".join(rec["selected"]) or "no family"))


def _generation(ws, k):
    gen = read_json(state(ws, "generation.json"), "state/generation.json")
    if gen.get("round") != k:
        raise ToolError("state/generation.json is for round %s, this is round %d" % (gen.get("round"), k))
    return gen


def cmd_screen(ws):
    ws = Path(ws)
    inputs = load_inputs(ws)
    k, _ = current_round(ws)
    gen = _generation(ws, k)
    out = fresh_dir(round_dir(ws, k) / "screen")
    rc, seconds = run_tool([tool(inputs, "qualib"), "screen", "--cells", str(ws / gen["dir"]), "--out", str(out)])
    path = out / "screen.json"
    if rc != 0 or not path.is_file():
        raise ToolError("Qualib screen failed (exit %d)" % rc)
    s = read_json(path, "screen.json")
    write_json(state(ws, "screen.json"), dict(schema="hima-andes-screen/1", round=k, dir=rel(ws, out), passed=s["passed"],
                                              failed=s["failed"], cells=[dict(name=c["name"], status=c["status"], reasons=c["reasons"], ratios=c["ratios"]) for c in s["cells"]],
                                              runtimeS=seconds, writtenAt=now()))
    print("Qualib screen round %d: %d pass, %d fail" % (k, len(s["passed"]), len(s["failed"])))


def cmd_verify(ws):
    ws = Path(ws)
    inputs = load_inputs(ws)
    k, timing = current_round(ws)
    gen = _generation(ws, k)
    screen = read_json(state(ws, "screen.json"), "state/screen.json")
    out = fresh_dir(round_dir(ws, k) / "verify")
    argv = [tool(inputs, "himatime"), "verify-cells", "--cells", str(ws / gen["dir"]), "--db", str(ws / timing["buildDir"]), "--out", str(out)]
    for cell in screen["failed"]:
        argv += ["--dont-use", cell]
    rc, seconds = run_tool(argv)
    path = out / "verify.json"
    if rc != 0 or not path.is_file():
        raise ToolError("HimaTime cell verification failed (exit %d)" % rc)
    v = read_json(path, "verify.json")
    write_json(state(ws, "cell-verify.json"), dict(schema="hima-andes-verify/1", round=k, dir=rel(ws, out),
                                                   passed=[c["name"] for c in v["cells"] if c["status"] == "PASS"],
                                                   failed=[c["name"] for c in v["cells"] if c["status"] != "PASS"],
                                                   designEstimate=v["designEstimate"], runtimeS=seconds, writtenAt=now()))
    print("HimaTime verify round %d: %d pass; estimate Fmax %.2f MHz (%+.2f %%)" % (k, v["passed"], v["designEstimate"]["fmaxMhz"], v["designEstimate"]["gainVsDbPct"]))


def cmd_build(ws, timeout_min):
    ws = Path(ws)
    inputs = load_inputs(ws)
    k, _ = current_round(ws)
    gen = _generation(ws, k)
    screen = read_json(state(ws, "screen.json"), "state/screen.json")
    verify = read_json(state(ws, "cell-verify.json"), "state/cell-verify.json")
    if screen.get("round") != k or verify.get("round") != k:
        raise ToolError("the screen and verify records are not this round's (%d)" % k)
    extra = [(ws / r["dir"], r["dontUse"]) for r in load_library(ws)["rounds"]]
    all_cells = [c["name"] for c in gen["cells"]]
    accepted = [c for c in all_cells if c in screen["passed"] and c in verify["passed"]]
    if all_cells:
        extra.append((ws / gen["dir"], sorted(set(all_cells) - set(accepted))))
    out = fresh_dir(round_dir(ws, k) / "build")
    result = sapr_build(ws, inputs, out, timeout_min, extra)
    rec = build_record(ws, "round", k, out, result, extra)
    rec["acceptedCells"] = accepted
    write_json(state(ws, "round-build.json"), rec)
    if not rec["finished"]:
        raise ToolError("the new-library build did not finish: %s" % rec["failure"])
    print("round %d new-library build: Fmax %.2f MHz (WNS %.4f ns), %d new-cell instances, area %.1f um^2"
          % (k, rec["fmaxMhz"], rec["wnsNs"], rec["newCellInstances"], rec["areaUm2"]))


# ---------------------------------------------------------------- compare: the round record

def cmd_compare(ws):
    ws = Path(ws)
    k, timing = current_round(ws)
    ref = read_json(state(ws, "reference.json"), "state/reference.json")
    build = read_json(state(ws, "round-build.json"), "state/round-build.json")
    gen = _generation(ws, k)
    screen = read_json(state(ws, "screen.json"), "state/screen.json")
    verify = read_json(state(ws, "cell-verify.json"), "state/cell-verify.json")
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
        problems.append("the build used cells that did not pass the screen and verification: %s" % ", ".join(stray))
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
        requested=reqs, selectedFamilies=gen["selected"], skipped=gen["skipped"],
        cellsGenerated=len(gen["cells"]), cellsPassedScreen=len(screen["passed"]), cellsFailedScreen=screen["failed"],
        cellsVerified=len(verify["passed"]), acceptedCells=sorted(accepted), newFamiliesUsed=this_families,
        cumulativeFamilies=cumulative, verifyEstimate=verify.get("designEstimate"), claimBoundary=CLAIM_BOUNDARY,
        writtenAt=now())
    write_json(state(ws, "round.json"), record)
    lesson = dict(round=k, roundValid=valid, fmaxMhz=fmax, fmaxGainPct=gain, roundImproved=improved, wnsNs=build.get("wnsNs"),
                  tnsNs=build.get("tnsNs"), areaUm2=build.get("areaUm2"), newCellInstances=build.get("newCellInstances", 0),
                  requested=reqs, selectedFamilies=gen["selected"],
                  skipped=[dict(family=s["family"], reason=s["reason"]) for s in gen["skipped"]],
                  acceptedCells=sorted(accepted), failedScreen=screen["failed"], buildDir=build["dir"],
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
             "AndesCell generated: %s (%d cells; %d passed the Qualib screen, %d verified by HimaTime)." % (
                 ", ".join(r["selectedFamilies"]) or "nothing", r["cellsGenerated"], r["cellsPassedScreen"], r["cellsVerified"]),
             ]
    if r["cellsFailedScreen"]:
        lines.append("Left out after the screen: %s." % ", ".join(r["cellsFailedScreen"]))
    for s in r["skipped"]:
        lines.append("Not generated: %s (%s)." % (s["family"], s["reason"]))
    if r["problems"]:
        lines += ["", "Problems: " + "; ".join(r["problems"])]
    lines += ["", "Claim boundary: " + CLAIM_BOUNDARY, ""]
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
              "Round reports: `derived/round-<k>.md`; agent analyses under `requirements/<agent>/r<k>/`.", "",
              "Claim boundary: " + CLAIM_BOUNDARY, ""]
    write_text(ws / "derived" / "summary.md", "\n".join(lines))


# ---------------------------------------------------------------- entry

COMMANDS = {
    "bind": (cmd_bind, (3,)), "reference": (cmd_reference, (1,)), "timing": (cmd_timing, (0,)),
    "requirements": (cmd_requirements, (1,)), "precheck": (cmd_precheck, (2, 3)),
    "generate": (cmd_generate, (0,)), "screen": (cmd_screen, (0,)), "verify": (cmd_verify, (0,)),
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
