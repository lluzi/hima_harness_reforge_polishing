#!/usr/bin/env python3
"""XTop timing-closure Pack adapter.

Each commercial tool is a separate HimaFabric act node. This file supplies the
bounded adapter for that node and the deterministic endpoint feedback contract;
it is not a second workflow engine.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import time


STAGE_SCHEMA = "xtop-timing-closure-stage/1"
STATE_SCHEMA = "xtop-timing-closure-state/1"
PLAN_SCHEMA = "xtop-timing-fix-plan/1"
ITERATION_SCHEMA = "xtop-timing-closure-iteration/1"
BEST_SCHEMA = "xtop-timing-closure-best-database/1"
PROFILE_SCHEMA = "xtop-timing-closure-site/1"
SUPPORTED_ACTIONS = {"setup-size", "setup-buffer", "hold-size", "hold-buffer"}


class Rejected(RuntimeError):
    pass


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise Rejected("duplicate JSON key: " + key)
        result[key] = value
    return result


def read_json(path: Path):
    try:
        if path.is_symlink() or not path.is_file():
            raise Rejected(f"missing or linked JSON file: {path}")
        return json.loads(path.read_text(), object_pairs_hook=unique)
    except (OSError, ValueError) as exc:
        raise Rejected(f"cannot read {path}: {exc}") from exc


def atomic_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".new")
    tmp.write_text(json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n")
    os.replace(tmp, path)


def sha_file(path: Path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def file_ref(path: Path, workspace: Path, role: str):
    if path.is_symlink() or not path.is_file() or path.stat().st_size == 0:
        raise Rejected(f"{role} is missing, empty or linked: {path}")
    raw = path.read_bytes()
    try:
        named = str(path.resolve().relative_to(workspace.resolve()))
    except ValueError:
        named = str(path.resolve())
    return {"role": role, "path": named, "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)}


def tree_identity(root: Path):
    if root.is_symlink() or not root.is_dir():
        raise Rejected(f"database tree is missing or linked: {root}")
    files = []
    links = []
    for entry in sorted(root.rglob("*"), key=lambda p: p.relative_to(root).as_posix()):
        rel = entry.relative_to(root).as_posix()
        if entry.is_symlink():
            target = entry.resolve(strict=True)
            if not target.is_file():
                raise Rejected(f"database link is not a file: {entry}")
            links.append({"path": rel, "link": os.readlink(entry), "targetSha256": sha_file(target), "targetBytes": target.stat().st_size})
        elif entry.is_file():
            files.append({"path": rel, "sha256": sha_file(entry), "bytes": entry.stat().st_size})
        elif not entry.is_dir():
            raise Rejected(f"unsupported database member: {entry}")
    if not files and not links:
        raise Rejected(f"database tree is empty: {root}")
    body = {"files": files, "links": links}
    body["treeSha256"] = hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return body


def paths(workspace: Path):
    flow = workspace / "flow"
    return {
        "workspace": workspace,
        "flow": flow,
        "records": flow / "records",
        "runtime": flow / "state" / "runtime.json",
        "current": flow / "state" / "current.json",
        "history": flow / "evidence" / "experience.jsonl",
        "plan": flow / "research" / "fix-plan.json",
        "best": flow / "output" / "best-database.json",
        "site": flow / "site",
        "templates": flow / "templates",
    }


def load_runtime(workspace: Path):
    value = read_json(paths(workspace)["runtime"])
    if value.get("schema") != "xtop-timing-closure-runtime/1":
        raise Rejected("runtime state has the wrong schema")
    return value


def load_profile(path: Path):
    profile = read_json(path)
    required = {"schema", "design", "foundationRoot", "physicalInputRoot", "inputSdc", "sourceManifestRoot", "edaShell", "originalDriverLibrary", "techLef", "cellLefGlob", "starrc", "scenarios"}
    # `starrcHome` is permitted but not required: when it is absent the StarRC toolkit root is
    # discovered inside the container, so an already-deployed profile needs no edit.
    if set(profile) - {"starrcHome"} != required or profile.get("schema") != PROFILE_SCHEMA:
        raise Rejected("Site profile fields or schema are not exact")
    if not isinstance(profile["edaShell"], list) or not profile["edaShell"] or not all(isinstance(x, str) and x for x in profile["edaShell"]):
        raise Rejected("edaShell must be a non-empty argv list")
    if "starrcHome" in profile and (not isinstance(profile["starrcHome"], str) or not profile["starrcHome"]):
        raise Rejected("starrcHome, when declared, must be the StarRC toolkit root holding linux64_starrc")
    scenarios = profile["scenarios"]
    if not isinstance(scenarios, list) or len(scenarios) < 2:
        raise Rejected("Site profile must declare at least two timing scenarios")
    names = set()
    for row in scenarios:
        if set(row) != {"name", "libGlob", "driverLibrary", "spefCorner", "xtopCorner", "xtopLibertyGlob"}:
            raise Rejected("timing scenario fields are not exact")
        if row["name"] in names:
            raise Rejected("duplicate timing scenario: " + row["name"])
        names.add(row["name"])
    corners = profile["starrc"]
    if not isinstance(corners, list) or len(corners) < 2:
        raise Rejected("Site profile must declare at least two StarRC corners")
    for row in corners:
        if set(row) != {"name", "template"}:
            raise Rejected("StarRC corner fields are not exact")
    return profile


def validate_manifest(manifest: Path, root: Path):
    checked = []
    for line in manifest.read_text().splitlines():
        if not line.strip():
            continue
        match = re.fullmatch(r"([0-9a-f]{64})  (.+)", line)
        if not match:
            raise Rejected("malformed source manifest line: " + line)
        expected, rel = match.groups()
        target = root / rel
        if target.is_symlink() or not target.is_file() or sha_file(target) != expected:
            raise Rejected("Foundation source identity mismatch: " + rel)
        checked.append(rel)
    if not checked:
        raise Rejected("source manifest is empty")
    return checked


def record_path(workspace: Path, stage: str):
    return paths(workspace)["records"] / f"{stage}.json"


def write_stage(workspace: Path, stage: str, status: str, started: float, **facts):
    value = {
        "schema": STAGE_SCHEMA,
        "stage": stage,
        "status": status,
        "startedEpoch": started,
        "finishedEpoch": time.time(),
        "facts": facts,
    }
    atomic_json(record_path(workspace, stage), value)
    return value


def stage(stage_name):
    def decorate(function):
        def wrapped(workspace: Path, *args):
            started = time.time()
            try:
                facts = function(workspace, *args)
                write_stage(workspace, stage_name, "passed", started, **facts)
            except Exception as exc:
                write_stage(workspace, stage_name, "failed", started, reason=str(exc))
                raise
        return wrapped
    return decorate


def database_pair(data_dir: Path):
    if not data_dir.name.endswith(".enc.dat"):
        raise Rejected("inputInnovusDatabase must name an .enc.dat directory")
    script = data_dir.with_name(data_dir.name[:-4])
    if script.is_symlink() or not script.is_file() or script.stat().st_size == 0:
        raise Rejected("Innovus restore script beside .enc.dat is missing")
    return script, data_dir


@stage("prepare")
def prepare(workspace: Path, input_db: str, profile_path: str, source_manifest: str):
    p = paths(workspace)
    for name in ("records", "state", "research", "evidence", "output", "iterations"):
        (p["flow"] / name).mkdir(parents=True, exist_ok=True)
    p["history"].touch(exist_ok=True)
    profile = load_profile(Path(profile_path).resolve())
    foundation = Path(profile["foundationRoot"]).resolve()
    checked = validate_manifest(Path(source_manifest).resolve(), Path(profile["sourceManifestRoot"]).resolve())
    source_script, source_data = database_pair(Path(input_db).resolve())
    staged = p["site"]
    staged.mkdir(parents=True, exist_ok=True)
    for rel in ("FF", "PLUG", "script"):
        source = foundation / rel
        if source.exists() and not (staged / rel).exists():
            shutil.copytree(source, staged / rel, symlinks=True)
    for rel in ("setup.tcl",):
        source = foundation / rel
        if source.is_file() and not (staged / rel).exists():
            shutil.copy2(source, staged / rel)
    db_root = staged / "DBS"
    db_root.mkdir(exist_ok=True)
    staged_script = db_root / "input.enc"
    staged_data = db_root / "input.enc.dat"
    shutil.copy2(source_script, staged_script)
    shutil.copytree(source_data, staged_data, symlinks=True)
    identity = tree_identity(staged_data)
    runtime = {
        "schema": "xtop-timing-closure-runtime/1",
        "iteration": 0,
        "profile": profile,
        "profileIdentity": file_ref(Path(profile_path).resolve(), workspace, "site-profile"),
        "sourceManifest": file_ref(Path(source_manifest).resolve(), workspace, "source-manifest"),
        "sourceFilesChecked": checked,
        "currentDatabase": str(staged_data),
        "currentDatabaseScript": str(staged_script),
        "currentExport": None,
        "currentAnalysis": None,
        "previousSnapshot": None,
    }
    atomic_json(p["runtime"], runtime)
    return {"inputDatabase": {"script": file_ref(staged_script, workspace, "input-db-script"), "tree": identity}, "sourceFilesChecked": len(checked)}


def shell_line(profile, command, shell_env=None):
    """The single command the site's shell runs for one commercial tool invocation.

    `shell_env` is not the same thing as a subprocess `env`. A value the tool itself needs in its
    process environment must be set *inside* the container, by prefixing the command the wrapper
    runs, because the wrapper forwards only its own allowlist across that boundary.
    """
    prefix = "".join(f"{name}={value} " for name, value in (shell_env or []))
    return prefix + shlex.join([str(x) for x in command])


def shell_env_value(value) -> str:
    """One assignment's right-hand side, quoted so the container's shell evaluates it as written.

    Double quotes preserve an inner `${...}` expansion, which is how an inherited value is kept;
    a value with no expansion keeps its literal text either way.
    """
    return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"') + '"'


def run_eda(profile, command, cwd: Path, log: Path, env=None, shell_env=None):
    log.parent.mkdir(parents=True, exist_ok=True)
    shell = profile["edaShell"] + [shell_line(profile, command, shell_env)]
    merged = os.environ.copy()
    if env:
        merged.update({key: str(value) for key, value in env.items()})
    with log.open("wb") as output:
        proc = subprocess.run(shell, cwd=cwd, env=merged, stdout=output, stderr=subprocess.STDOUT)
    if proc.returncode != 0:
        raise Rejected(f"commercial tool exited {proc.returncode}; see {log}")
    text = log.read_text(errors="replace")
    if re.search(r"(?m)^(?:\*\*)?(?:ERROR|Error|Fatal):", text):
        raise Rejected(f"commercial tool log reports an error; see {log}")
    return log


def discover_starrc_toolkit(profile):
    """The StarRC toolkit root, asked of the container that will run StarXtract.

    Resolved by walking up from the binary to the directory that actually holds `linux64_starrc`,
    rather than by counting levels: the toolkit root is the one a given install puts its platform
    directory under, and a fixed count would silently pick the wrong directory when it differs.
    Asked inside the container because that is where the tool resolves; a path computed on the host
    says nothing about what the tool's own environment will look like.
    """
    probe = ('b=$(command -v StarXtract) || exit 1; d=$(dirname "$b"); '
             'while [ "$d" != / ]; do [ -d "$d/linux64_starrc/lib" ] && { echo "$d"; exit 0; }; '
             'd=$(dirname "$d"); done; exit 1')
    try:
        proc = subprocess.run(profile["edaShell"] + [probe], stdout=subprocess.PIPE,
                              stderr=subprocess.DEVNULL, timeout=120)
    except (OSError, subprocess.SubprocessError):
        return None
    found = proc.stdout.decode("utf-8", "replace").strip().splitlines()
    return Path(found[-1]) if proc.returncode == 0 and found else None


def starrc_shell_env(toolkit: Path):
    """The in-container environment StarXtract needs, as assignment pairs.

    StarXtract resolves `libtbb.so.12` only when the toolkit's own library directories are on the
    loader search path. The inherited value is appended in the same shell, preserving whatever the
    container's own EDA init put there.
    """
    roots = [candidate for candidate in (toolkit / "linux64_starrc" / "lib",
                                        toolkit / "linux64_starrc" / "lib" / "shlib")
             if candidate.is_dir()]
    if not roots:
        return []
    entries = ":".join(str(root) for root in roots) + ":${LD_LIBRARY_PATH:-}"
    return [("LD_LIBRARY_PATH", shell_env_value(entries))]


def run_starrc(profile, command, cwd: Path, log: Path, toolkit: Path):
    return run_eda(profile, command, cwd, log, shell_env=starrc_shell_env(toolkit))


def tcl_quote(value) -> str:
    text = str(value)
    for char in ("\\", "\"", "[", "]", "$"):
        text = text.replace(char, "\\" + char)
    return text


def copy_template(workspace: Path, name: str, target: Path, env: dict | None = None):
    source = paths(workspace)["templates"] / name
    if source.is_symlink() or not source.is_file():
        raise Rejected("Pack template is missing: " + name)
    target.parent.mkdir(parents=True, exist_ok=True)
    if env:
        # The site's container wrapper (edarun) forwards only a fixed allowlist of
        # environment variables into the podman container; a Pack-declared variable
        # such as WORK_ROOT never reaches the commercial tool's process environment
        # there. Bake the values into the script itself so `env(NAME)` resolves
        # regardless of what the container transport forwards.
        preamble = "".join(f'set env({key}) "{tcl_quote(value)}"\n' for key, value in env.items())
        target.write_text(preamble + source.read_text())
        shutil.copystat(source, target)
    else:
        shutil.copy2(source, target)
    return target


@stage("export")
def export_current(workspace: Path):
    runtime = load_runtime(workspace)
    profile = runtime["profile"]
    iteration = int(runtime["iteration"])
    root = paths(workspace)["flow"] / "iterations" / f"g{iteration:03d}"
    export_root = root / "EXPORT"
    export_env = {
        "WORK_ROOT": paths(workspace)["site"], "CURRENT_DB": runtime["currentDatabase"],
        "DESIGN": profile["design"], "EXPORT_ROOT": export_root,
    }
    tcl = copy_template(workspace, "export.tcl", root / "scripts" / "export.tcl", env=export_env)
    log = root / "logs" / "innovus-export.log"
    run_eda(profile, ["innovus", "-batch", "-files", str(tcl), "-log", str(log), "-overwrite", "-64", "-nowin"], paths(workspace)["site"], log, export_env)
    def_path, netlist = export_root / "design.def", export_root / "design.v"
    refs = [file_ref(def_path, workspace, "routed-def"), file_ref(netlist, workspace, "routed-netlist")]
    runtime["currentExport"] = {"root": str(export_root), "def": str(def_path), "netlist": str(netlist)}
    atomic_json(paths(workspace)["runtime"], runtime)
    return {"iteration": iteration, "artifacts": refs}


def patch_starrc_template(source: Path, target: Path, def_path: Path, work: Path, spef: Path):
    text = source.read_text()
    changes = {
        r"(?m)^TOP_DEF_FILE:.*$": f"TOP_DEF_FILE: {def_path}",
        r"(?m)^STAR_DIRECTORY:.*$": f"STAR_DIRECTORY: {work}",
        r"(?m)^NETLIST_FILE:.*$": f"NETLIST_FILE: {spef}",
    }
    for pattern, replacement in changes.items():
        text, count = re.subn(pattern, replacement, text)
        if count != 1:
            raise Rejected(f"StarRC template did not have exactly one {pattern}")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text)


@stage("extract")
def extract_current(workspace: Path):
    runtime = load_runtime(workspace)
    profile = runtime["profile"]
    export = runtime.get("currentExport")
    if not isinstance(export, dict):
        raise Rejected("current Innovus export is absent")
    iteration = int(runtime["iteration"])
    root = paths(workspace)["flow"] / "iterations" / f"g{iteration:03d}" / "STARRC"
    declared = profile.get("starrcHome")
    starrc_toolkit = Path(declared) if declared else discover_starrc_toolkit(profile)
    if not starrc_toolkit or not starrc_shell_env(starrc_toolkit):
        # Failing here says which library directories were wanted; letting it through would run
        # StarXtract again just to fail on the same shared library.
        raise Rejected("StarRC toolkit root cannot be resolved: declare starrcHome in the Site "
                       "profile, or have StarXtract on PATH under a toolkit holding "
                       "linux64_starrc/lib")
    artifacts, logs = [], []
    for corner in profile["starrc"]:
        name = corner["name"]
        cmd = root / f"{name}.cmd"
        spef = root / f"{profile['design']}.{name}.spef"
        patch_starrc_template(Path(corner["template"]), cmd, Path(export["def"]), root / f"work_{name}", spef)
        log = root / f"{name}.log"
        run_starrc(profile, ["StarXtract", "-clean", str(cmd)], root, log, starrc_toolkit)
        text = log.read_text(errors="replace")
        if re.search(r"Errors:\s*[1-9]", text):
            raise Rejected(f"StarRC {name} reported extraction errors")
        artifacts.append(file_ref(spef, workspace, f"spef-{name}"))
        logs.append(file_ref(log, workspace, f"starrc-log-{name}"))
    runtime["currentAnalysis"] = {"starrcRoot": str(root), "spef": {row["name"]: str(root / f"{profile['design']}.{row['name']}.spef") for row in profile["starrc"]}}
    atomic_json(paths(workspace)["runtime"], runtime)
    return {"iteration": iteration, "artifacts": artifacts, "logs": logs}


def generate_xtop_libraries(profile, target: Path):
    lines = []
    corners = []
    for row in profile["scenarios"]:
        corner = row["xtopCorner"]
        if corner not in corners:
            corners.append(corner)
            lines += [f"create_corner {corner}", f"set libs [lsort [glob -nocomplain {row['xtopLibertyGlob']}]]", f"if {{[llength $libs] == 0}} {{ error \"no Liberty for {corner}\" }}", f"link_timing_library -corner {corner} -search_type min_max $libs"]
    lines.append("create_mode func")
    for row in profile["scenarios"]:
        lines.append(f"create_scenario -corner {row['xtopCorner']} -mode func {row['name']}")
    target.write_text("\n".join(lines) + "\n")


@stage("timing")
def timing_current(workspace: Path):
    runtime = load_runtime(workspace)
    profile = runtime["profile"]
    analysis = runtime.get("currentAnalysis")
    export = runtime.get("currentExport")
    if not isinstance(analysis, dict) or not isinstance(export, dict):
        raise Rejected("current export or extraction is absent")
    iteration = int(runtime["iteration"])
    root = paths(workspace)["flow"] / "iterations" / f"g{iteration:03d}" / "PT"
    reports, sta_data, logs = root / "reports", root / "sta_data", []
    for row in profile["scenarios"]:
        name = row["name"]
        spef = analysis["spef"].get(row["spefCorner"])
        if spef is None:
            raise Rejected(f"scenario {name} references unknown SPEF corner")
        scenario_env = {
            "DESIGN": profile["design"], "NETLIST": export["netlist"], "INPUT_SDC": profile["inputSdc"],
            "SPEF": spef, "REPORT_ROOT": reports, "STA_DATA": sta_data, "LIB_GLOB": row["libGlob"],
            "DRIVER_LIBRARY": row["driverLibrary"], "ORIGINAL_DRIVER_LIBRARY": profile["originalDriverLibrary"], "SCENARIO": name,
        }
        tcl = copy_template(workspace, "pt-scenario.tcl", root / "scripts" / f"pt-scenario-{name}.tcl", env=scenario_env)
        log = root / "logs" / f"{name}.log"
        run_eda(profile, ["pt_shell", "-f", str(tcl)], root, log, scenario_env)
        required = [reports / name / part for part in ("global_timing.rpt", "setup.rpt", "hold.rpt", "check_timing.rpt")]
        for part in required:
            file_ref(part, workspace, f"pt-{name}-{part.stem}")
        if not any(sta_data.glob(f"{name}_data_finish*")):
            raise Rejected(f"PrimeTime scenario {name} produced no XTop timing-data finish file")
        logs.append(file_ref(log, workspace, f"pt-log-{name}"))
    analysis.update({"ptRoot": str(root), "reports": str(reports), "staData": str(sta_data)})
    runtime["currentAnalysis"] = analysis
    atomic_json(paths(workspace)["runtime"], runtime)
    return {"iteration": iteration, "scenarioCount": len(profile["scenarios"]), "logs": logs}


def parse_global(path: Path):
    text = path.read_text(errors="replace")
    result = {}
    for mode in ("Setup", "Hold"):
        block = re.search(rf"{mode} violations\s*\n-+\n.*?\n-+\n(.*?)\n-+", text, re.S)
        if not block:
            raise Rejected(f"cannot parse {mode.lower()} global timing from {path}")
        rows = {}
        for label in ("WNS", "TNS", "NUM"):
            found = re.search(rf"(?m)^{label}\s+(-?[0-9.]+)", block.group(1))
            if not found:
                raise Rejected(f"cannot parse {mode} {label} from {path}")
            rows[label] = float(found.group(1)) if label != "NUM" else int(found.group(1))
        result[mode.lower()] = rows
    return result


def parse_endpoints(path: Path, scenario: str, mode: str):
    text = path.read_text(errors="replace")
    blocks = re.split(r"(?m)^\s*Startpoint:\s*", text)[1:]
    endpoints = {}
    for block in blocks:
        endpoint = re.search(r"(?m)^\s*Endpoint:\s*(\S+)", block)
        slack = re.search(r"(?m)^\s*slack \(VIOLATED\)\s+(-?[0-9.eE+]+)", block)
        group = re.search(r"(?m)^\s*Path Group:\s*(\S+)", block)
        if endpoint and slack:
            key = f"{scenario}|{mode}|{group.group(1) if group else 'unknown'}|{endpoint.group(1)}"
            value = float(slack.group(1))
            endpoints[key] = min(value, endpoints.get(key, value))
    return endpoints


def unconstrained(path: Path):
    text = path.read_text(errors="replace")
    match = re.search(r"There are\s+(\d+) endpoints which are not constrained", text)
    return int(match.group(1)) if match else 0


def metrics_of(reports: Path, scenarios):
    setup_wns, setup_tns, setup_num = 0.0, 0.0, 0
    hold_wns, hold_tns, hold_num = 0.0, 0.0, 0
    endpoint_slack = {}
    unchecked = 0
    first = True
    for row in scenarios:
        root = reports / row["name"]
        values = parse_global(root / "global_timing.rpt")
        if first:
            setup_wns, hold_wns, first = values["setup"]["WNS"], values["hold"]["WNS"], False
        else:
            setup_wns, hold_wns = min(setup_wns, values["setup"]["WNS"]), min(hold_wns, values["hold"]["WNS"])
        setup_tns += values["setup"]["TNS"]
        setup_num += values["setup"]["NUM"]
        hold_tns += values["hold"]["TNS"]
        hold_num += values["hold"]["NUM"]
        endpoint_slack.update(parse_endpoints(root / "setup.rpt", row["name"], "setup"))
        endpoint_slack.update(parse_endpoints(root / "hold.rpt", row["name"], "hold"))
        unchecked = max(unchecked, unconstrained(root / "check_timing.rpt"))
    score = setup_num + hold_num + abs(min(0.0, setup_tns)) + abs(min(0.0, hold_tns)) + 10 * abs(min(0.0, setup_wns, hold_wns))
    return {
        "setup_wns_ns": setup_wns, "setup_tns_ns": setup_tns, "setup_violations": setup_num,
        "hold_wns_ns": hold_wns, "hold_tns_ns": hold_tns, "hold_violations": hold_num,
        "unconstrained_endpoints": unchecked, "closure_score": round(score, 9),
    }, endpoint_slack


@stage("summarize")
def summarize(workspace: Path):
    runtime = load_runtime(workspace)
    reports = Path(runtime["currentAnalysis"]["reports"])
    metrics, endpoints = metrics_of(reports, runtime["profile"]["scenarios"])
    report_files = []
    for row in runtime["profile"]["scenarios"]:
        for name in ("global_timing.rpt", "setup.rpt", "hold.rpt", "check_timing.rpt"):
            report_files.append(file_ref(reports / row["name"] / name, workspace, f"{row['name']}-{name}"))
    snapshot = {
        "schema": STATE_SCHEMA, "iteration": runtime["iteration"], "metrics": metrics,
        "endpointSlackNs": dict(sorted(endpoints.items())),
        "database": {"script": runtime["currentDatabaseScript"], "data": runtime["currentDatabase"]},
        "reportsRoot": str(reports), "reportFiles": report_files,
    }
    iteration_root = paths(workspace)["flow"] / "iterations" / f"g{int(runtime['iteration']):03d}"
    atomic_json(iteration_root / "closure-state.json", snapshot)
    atomic_json(paths(workspace)["current"], snapshot)
    runtime["latestSnapshot"] = str(iteration_root / "closure-state.json")
    if runtime.get("previousSnapshot") is None:
        runtime["previousSnapshot"] = runtime["latestSnapshot"]
    atomic_json(paths(workspace)["runtime"], runtime)
    return {"iteration": runtime["iteration"], "metrics": metrics, "endpointCount": len(endpoints)}


def validate_plan(path: Path, expected_iteration: int):
    plan = read_json(path)
    required = {"schema", "iteration", "diagnosis", "hypotheses", "endpointGroups", "actions", "avoid", "reasoning"}
    if set(plan) != required or plan.get("schema") != PLAN_SCHEMA or plan.get("iteration") != expected_iteration:
        raise Rejected("fix plan fields, schema or iteration are not exact")
    for key in ("diagnosis", "reasoning"):
        if not isinstance(plan[key], str) or not plan[key].strip():
            raise Rejected(f"fix plan {key} is empty")
    if not isinstance(plan["hypotheses"], list) or not plan["hypotheses"]:
        raise Rejected("fix plan must compare at least one grounded hypothesis")
    if not isinstance(plan["endpointGroups"], list) or not plan["endpointGroups"]:
        raise Rejected("fix plan must target at least one endpoint group")
    actions = plan["actions"]
    if not isinstance(actions, list) or not 1 <= len(actions) <= 8:
        raise Rejected("fix plan must hold one through eight actions")
    for action in actions:
        if set(action) != {"kind", "effort", "setupTargetNs", "holdTargetNs", "setupMarginNs", "holdMarginNs", "endpointGroups", "reason"}:
            raise Rejected("fix action fields are not exact")
        if action["kind"] not in SUPPORTED_ACTIONS or action["effort"] not in {"medium", "high"}:
            raise Rejected("fix action is outside the supported method")
        if not isinstance(action["endpointGroups"], list) or not action["endpointGroups"]:
            raise Rejected("every fix action must cite an endpoint group")
        for field in ("setupTargetNs", "holdTargetNs", "setupMarginNs", "holdMarginNs"):
            value = action[field]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not -0.2 <= value <= 0.2:
                raise Rejected(f"fix action {field} is outside the bounded range")
    return plan


def actions_tcl(plan, target: Path):
    lines = []
    for action in plan["actions"]:
        effort = action["effort"]
        if action["kind"] == "setup-size":
            lines.append(f"fix_setup_gba_violations -methods size_cell -effort {effort} -setup_target {action['setupTargetNs']} -hold_margin {action['holdMarginNs']}")
        elif action["kind"] == "setup-buffer":
            lines.append(f"fix_setup_gba_violations -methods insert_buffer -effort {effort} -setup_target {action['setupTargetNs']} -hold_margin {action['holdMarginNs']}")
        elif action["kind"] == "hold-size":
            lines.append(f"fix_hold_gba_violations -size_cell_only -size_rule nominal_keywords -hold_target {action['holdTargetNs']} -setup_margin {action['setupMarginNs']}")
        elif action["kind"] == "hold-buffer":
            lines.append(f"fix_hold_gba_violations -effort {effort} -hold_target {action['holdTargetNs']} -setup_margin {action['setupMarginNs']}")
    target.write_text("\n".join(lines) + "\n")


@stage("xtop")
def xtop(workspace: Path):
    runtime = load_runtime(workspace)
    plan = validate_plan(paths(workspace)["plan"], int(runtime["iteration"]) + 1)
    profile, export, analysis = runtime["profile"], runtime["currentExport"], runtime["currentAnalysis"]
    next_iteration = int(runtime["iteration"]) + 1
    root = paths(workspace)["flow"] / "iterations" / f"g{next_iteration:03d}" / "XTOP"
    root.mkdir(parents=True, exist_ok=True)
    action_file = root / "actions.tcl"
    library_file = root / "libraries.tcl"
    actions_tcl(plan, action_file)
    generate_xtop_libraries(profile, library_file)
    xtop_env = {
        "DESIGN": profile["design"], "TECH_LEF": profile["techLef"], "CELL_LEF_GLOB": profile["cellLefGlob"],
        "NETLIST": export["netlist"], "DEF": export["def"], "STA_DATA": analysis["staData"], "RUN_ROOT": root,
        "LIBRARY_TCL": library_file, "ACTIONS_TCL": action_file, "ECO_PREFIX": f"xtop_g{next_iteration:03d}_eco",
    }
    tcl = copy_template(workspace, "xtop.tcl", root / "xtop.tcl", env=xtop_env)
    log = root / "xtop.log"
    run_eda(profile, ["xtop", "-f", str(tcl), "-log_dir", str(root / "logs")], root, log, xtop_env)
    eco = root / "eco_output"
    netlist = list(eco.glob("xtop_opt_innovus_netlist_*.txt"))
    physical = list(eco.glob("xtop_opt_innovus_physical_*.txt"))
    if len(netlist) != 1 or len(physical) != 1:
        raise Rejected("XTop produced no unique netlist and physical ECO pair")
    runtime["pendingIteration"] = next_iteration
    runtime["pendingEco"] = {"root": str(eco), "netlist": str(netlist[0]), "physical": str(physical[0])}
    atomic_json(paths(workspace)["runtime"], runtime)
    return {"iteration": next_iteration, "actionCount": len(plan["actions"]), "artifacts": [file_ref(netlist[0], workspace, "netlist-eco"), file_ref(physical[0], workspace, "physical-eco")]}


@stage("apply-eco")
def apply_eco(workspace: Path):
    runtime = load_runtime(workspace)
    profile = runtime["profile"]
    iteration = runtime.get("pendingIteration")
    eco = runtime.get("pendingEco")
    if not isinstance(iteration, int) or not isinstance(eco, dict):
        raise Rejected("there is no pending XTop ECO")
    root = paths(workspace)["flow"] / "iterations" / f"g{iteration:03d}" / "INNOVUS"
    apply_eco_env = {
        "WORK_ROOT": paths(workspace)["site"], "CURRENT_DB": runtime["currentDatabase"], "DESIGN": profile["design"],
        "ECO_DIR": eco["root"], "OUTPUT_ROOT": root,
    }
    tcl = copy_template(workspace, "apply-eco.tcl", root / "apply-eco.tcl", env=apply_eco_env)
    log = root / "innovus-eco.log"
    run_eda(profile, ["innovus", "-batch", "-files", str(tcl), "-log", str(log), "-overwrite", "-64", "-nowin"], paths(workspace)["site"], log, apply_eco_env)
    data = root / "DBS" / "closed.enc.dat"
    script = root / "DBS" / "closed.enc"
    export_root = root / "EXPORT"
    tree = tree_identity(data)
    runtime.update({
        "iteration": iteration, "currentDatabase": str(data), "currentDatabaseScript": str(script),
        "currentExport": {"root": str(export_root), "def": str(export_root / "design.def"), "netlist": str(export_root / "design.v")},
        "currentAnalysis": None, "pendingIteration": None, "pendingEco": None,
    })
    atomic_json(paths(workspace)["runtime"], runtime)
    return {"iteration": iteration, "databaseTree": tree, "artifacts": [file_ref(script, workspace, "innovus-db-script"), file_ref(export_root / "design.def", workspace, "routed-def"), file_ref(export_root / "design.v", workspace, "routed-netlist")]}


def rank(snapshot):
    m = snapshot["metrics"]
    return (m["setup_violations"] + m["hold_violations"], abs(min(0.0, m["setup_tns_ns"])) + abs(min(0.0, m["hold_tns_ns"])), abs(min(0.0, m["setup_wns_ns"], m["hold_wns_ns"])))


def copy_database_alias(workspace: Path, snapshot):
    source_script = Path(snapshot["database"]["script"])
    source_data = Path(snapshot["database"]["data"])
    output = paths(workspace)["flow"] / "output"
    output.mkdir(parents=True, exist_ok=True)
    script = output / "best.enc"
    data = output / "best.enc.dat"
    shutil.copy2(source_script, script)
    if data.exists():
        shutil.copytree(source_data, data, symlinks=True, dirs_exist_ok=True)
    else:
        shutil.copytree(source_data, data, symlinks=True)
    return script, data, tree_identity(data)


def compare(workspace: Path):
    try:
        runtime = load_runtime(workspace)
        before = read_json(Path(runtime["previousSnapshot"]))
        after = read_json(Path(runtime["latestSnapshot"]))
        b, a = before["endpointSlackNs"], after["endpointSlackNs"]
        b_bad = {key for key, value in b.items() if value < 0}
        a_bad = {key for key, value in a.items() if value < 0}
        shared = b_bad & a_bad
        delta = {
            "fixed": sorted(b_bad - a_bad),
            "remaining": sorted(shared),
            "entrants": sorted(a_bad - b_bad),
            "regressed": sorted(key for key in shared if a[key] < b[key] - 0.001),
        }
        previous_best = read_json(paths(workspace)["best"]) if paths(workspace)["best"].is_file() else None
        previous_snapshot = read_json(Path(previous_best["snapshot"])) if previous_best else before
        selected = after if rank(after) < rank(previous_snapshot) else previous_snapshot
        if previous_best is None or selected is after:
            script, data, identity = copy_database_alias(workspace, selected)
            best = {
                "schema": BEST_SCHEMA, "ready": True, "iteration": selected["iteration"],
                "snapshot": runtime["latestSnapshot"] if selected is after else runtime["previousSnapshot"],
                "restoreScript": file_ref(script, workspace, "best-db-script"), "restoreData": str(data), "tree": identity,
            }
            atomic_json(paths(workspace)["best"], best)
        else:
            best = previous_best
        result = {
            "schema": ITERATION_SCHEMA, "iteration": after["iteration"], "before": before, "after": after,
            "endpoint_delta": delta, "evidence_valid": bool(best and best.get("ready")),
            "bestDatabaseIteration": best["iteration"],
        }
        atomic_json(record_path(workspace, "compare"), result)
        experience = {
            "iteration": after["iteration"], "beforeMetrics": before["metrics"], "afterMetrics": after["metrics"],
            "endpointDelta": delta, "plan": read_json(paths(workspace)["plan"]), "selectedAsBest": selected is after,
        }
        paths(workspace)["history"].parent.mkdir(parents=True, exist_ok=True)
        with paths(workspace)["history"].open("a") as stream:
            stream.write(json.dumps(experience, sort_keys=True, allow_nan=False) + "\n")
        runtime["previousSnapshot"] = runtime["latestSnapshot"]
        atomic_json(paths(workspace)["runtime"], runtime)
    except Exception as exc:
        atomic_json(record_path(workspace, "compare-failure"), {"schema": STAGE_SCHEMA, "stage": "compare", "status": "failed", "reason": str(exc)})
        raise


def main():
    if len(sys.argv) < 3:
        raise SystemExit("usage: closure.py STAGE WORKSPACE [stage arguments]")
    command = sys.argv[1]
    workspace = Path(sys.argv[2]).resolve()
    commands = {
        "prepare": lambda: prepare(workspace, *sys.argv[3:6]),
        "export": lambda: export_current(workspace),
        "extract": lambda: extract_current(workspace),
        "timing": lambda: timing_current(workspace),
        "summarize": lambda: summarize(workspace),
        "xtop": lambda: xtop(workspace),
        "apply-eco": lambda: apply_eco(workspace),
        "compare": lambda: compare(workspace),
    }
    if command not in commands:
        raise SystemExit("unknown stage: " + command)
    commands[command]()


if __name__ == "__main__":
    main()
