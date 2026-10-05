#!/usr/bin/env python3
"""Deterministic tools of the custom-cell-fmax-sky130-demo Pack (python3, stdlib only).

Every number this file writes comes from ORFS output files, never from model text. The resident
agent's own trial numbers are carried as `agentClaim` and are never used as a result.

  bind      <WS> <ORFS_ROOT> <CELLUZI_ROOT> <DESIGN_CONFIG> <IMAGE> <BOOL2CMOS_ROOT>
  baseline  <WS> <PERIOD_NS> <TIMEOUT_MIN>
  recipe    <WS>                              validate state/round-recipe.json (engineer delivery)
  precheck  <WS> <OWN_WORKSPACE> <RECIPE>     the engineer's own check of its recipe before delivery
  characterize <WS> <TIMEOUT_MIN>            measure every DRC/LVS-clean extracted cell (ngspice, calibrated)
  arm       <WS> <custom|control> <TIMEOUT_MIN>
  compare   <WS>                              round record, lessons, best library and summary
  finish    <WS>                              rewrite derived/summary.{md,json} from the lessons

All output goes under <WS>. The ORFS checkout and the toolbox source roots are mounted read-only.
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

PLATFORM = "sky130hd"
DESIGN = "aes"
CELL_PREFIX = "sky130_fd_sc_hd__"
FORBIDDEN_RE = re.compile(r"^sky130_fd_sc_hd__(lpflow_|probe)")
PG_PINS = ("VPWR", "VGND", "VPB", "VNB")
NAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
RECIPE_SCHEMA = "hima-cellfmax-round-recipe/1"
ARM_SCHEMA = "hima-cellfmax-arm/1"
ROUND_SCHEMA = "hima-cellfmax-round/1"
MAX_NEW_CELLS = 400
NUM_CORES = 8
CLAIM_BOUNDARY = (
    "Custom-cell timing is SPICE-characterized by HimaHarness from each cell's Magic-extracted layout "
    "(ngspice, sky130 tt 1.8 V 25 C, calibrated against foundry cells to within 15 % p90), not signed "
    "off; only DRC/LVS-clean cells are measured and used. Results are open-source ORFS timing on SKY130 "
    "under these measured models; not signoff, not silicon."
)
FLOW_DIR = Path(__file__).resolve().parent
EMPTY_BEST = {"schema": "hima-cellfmax-best/1", "round": 0, "customFmaxMhz": None, "library": {"cells": []}}


class ToolError(Exception):
    pass


# ---------------------------------------------------------------- small helpers

def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    with open(path) as stream:
        return json.load(stream)


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


def fmax_mhz(period_ns, wns_ns):
    """Fmax from the worst setup slack of all paths: 1000 / (period - WNS); WNS of either sign."""
    if period_ns is None or wns_ns is None:
        return None
    effective = float(period_ns) - float(wns_ns)
    if effective <= 0:
        raise ToolError("period %.4f ns minus WNS %.4f ns is not positive" % (period_ns, wns_ns))
    return round(1000.0 / effective, 4)


def pct(a, b):
    if a is None or b is None or b == 0:
        return None
    return round(100.0 * (a / b - 1.0), 4)


def state_dir(ws):
    return Path(ws) / "state"


def rel_under(ws, rel, prefix):
    """Resolve a recipe path; it must be relative, without '..', and under <prefix>/.

    `ws` is the Campaign workspace, or a list of roots searched in order (the engineer's private
    workspace first, then the Campaign) when the engineer prechecks its delivery."""
    if not isinstance(rel, str) or not rel:
        raise ToolError("a recipe path is empty or not a string")
    part = PurePosixPath(rel)
    if part.is_absolute() or ".." in part.parts:
        raise ToolError("recipe path %r must be relative and stay inside the workspace" % rel)
    if not rel.startswith(prefix.rstrip("/") + "/"):
        raise ToolError("recipe path %r must be under %s/" % (rel, prefix.rstrip("/")))
    for root in (ws if isinstance(ws, list) else [ws]):
        path = Path(root) / rel
        if path.is_file():
            return path
    raise ToolError("recipe file %r does not exist" % rel)


# ---------------------------------------------------------------- Liberty / LEF / netlist parsing

def _group_end(text, open_pos):
    depth = 0
    for index in range(open_pos, len(text)):
        char = text[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index
    raise ToolError("unbalanced braces in Liberty")


def liberty_cells(text):
    """{cell_name: {"pins": {name: direction}, "pg_pins": set, "area": float|None}} for top-level cells."""
    cells = {}
    for match in re.finditer(r"\bcell\s*\(\s*\"?([A-Za-z0-9_]+)\"?\s*\)\s*\{", text):
        name = match.group(1)
        end = _group_end(text, match.end() - 1)
        body = text[match.end():end]
        pins = {}
        for pin in re.finditer(r"\bpin\s*\(\s*\"?([A-Za-z0-9_\[\]]+)\"?\s*\)\s*\{", body):
            pend = _group_end(body, pin.end() - 1)
            pbody = body[pin.end():pend]
            direction = re.search(r"\bdirection\s*:\s*\"?(\w+)\"?", pbody)
            pins[pin.group(1)] = direction.group(1) if direction else None
        pg = set(re.findall(r"\bpg_pin\s*\(\s*\"?([A-Za-z0-9_]+)\"?\s*\)", body))
        area = re.search(r"\barea\s*:\s*([0-9.eE+-]+)", body)
        cells[name] = {"pins": pins, "pg_pins": pg, "area": float(area.group(1)) if area else None}
    return cells


def lef_macros(text):
    """{macro: {"pins": {name: use}}} from a LEF."""
    macros = {}
    for match in re.finditer(r"^\s*MACRO\s+(\S+)\s*$(.*?)^\s*END\s+\1\s*$", text, re.M | re.S):
        pins = {}
        for pin in re.finditer(r"^\s*PIN\s+(\S+)\s*$(.*?)^\s*END\s+\1\s*$", match.group(2), re.M | re.S):
            use = re.search(r"\bUSE\s+(\w+)", pin.group(2))
            pins[pin.group(1)] = use.group(1).upper() if use else "SIGNAL"
        macros[match.group(1)] = {"pins": pins}
    return macros


def netlist_cell_counts(path):
    """Instance count per master from a structural Verilog netlist (one `master inst (` per line)."""
    counts = {}
    pattern = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_$]*)\s+(\\\S+|[A-Za-z_][A-Za-z0-9_$\[\]\.]*)\s*\(")
    skip = {"module", "input", "output", "inout", "wire", "assign", "reg", "endmodule"}
    with open(path) as stream:
        for line in stream:
            match = pattern.match(line)
            if match and match.group(1) not in skip:
                counts[match.group(1)] = counts.get(match.group(1), 0) + 1
    return counts


def platform_dont_use(orfs_root):
    """Resolve the platform's own DONT_USE_CELLS list from platforms/sky130hd/config.mk.

    Passing DONT_USE_CELLS on the make command line replaces the Makefile's `+=` list, so the arms
    must pass the full resolved list (the invalid-control lesson)."""
    config = Path(orfs_root) / "flow" / "platforms" / PLATFORM / "config.mk"
    lines = config.read_text().splitlines()
    cells, collecting = [], False
    for line in lines:
        stripped = line.strip()
        if not collecting and re.match(r"^export\s+DONT_USE_CELLS\s*(\+|\?|:)?=", stripped):
            collecting = True
            stripped = stripped.split("=", 1)[1]
        if collecting:
            cont = stripped.endswith("\\")
            cells.extend(tok for tok in stripped.rstrip("\\").split() if tok)
            if not cont:
                collecting = False
    if not cells:
        raise ToolError("could not resolve DONT_USE_CELLS from %s" % config)
    return cells


# ---------------------------------------------------------------- bind

TOOLBOX_SOURCES = "toolbox/SOURCES.json"


def cmd_bind(ws, orfs_root, celluzi_root, design_config, image, bool2cmos_root):
    ws = Path(ws)
    orfs = Path(orfs_root)
    flow = orfs / "flow"
    config = flow / design_config
    for label, path in (("ORFS root", flow / "Makefile"), ("design config", config),
                        ("celluzi root", Path(celluzi_root)), ("bool2cmos root", Path(bool2cmos_root))):
        if not path.exists():
            raise ToolError("%s does not exist: %s" % (label, path))
    sdc = config.parent / "constraint.sdc"
    platform_config = flow / "platforms" / PLATFORM / "config.mk"
    platform_lib = flow / "platforms" / PLATFORM / "lib" / "sky130_fd_sc_hd__tt_025C_1v80.lib"
    for path in (sdc, platform_config, platform_lib):
        if not path.is_file():
            raise ToolError("ORFS file missing: %s" % path)
    inspect = subprocess.run(["podman", "image", "inspect", "--format", "{{.Id}}", image],
                             capture_output=True, text=True, timeout=60)
    image_id = inspect.stdout.strip()
    if inspect.returncode != 0 or not re.fullmatch(r"[0-9a-f]{64}", image_id):
        raise ToolError("container image %r is not present: %s" % (image, inspect.stderr.strip()))
    if not image_id.startswith(image) and image != image_id and ":" not in image:
        raise ToolError("container image binding %r does not name image %s" % (image, image_id))
    commit = subprocess.run(["git", "-C", str(orfs), "rev-parse", "HEAD"], capture_output=True, text=True, timeout=60)
    dirty = subprocess.run(["git", "-C", str(orfs), "status", "--porcelain", "--untracked-files=no"],
                           capture_output=True, text=True, timeout=120)
    toolbox = []
    sources_path = FLOW_DIR / TOOLBOX_SOURCES
    if sources_path.is_file():
        for entry in read_json(sources_path).get("files", []):
            source = Path(celluzi_root) / entry["source"] if entry.get("root") == "celluzi" else Path(entry["source"])
            local = FLOW_DIR / entry["path"]
            toolbox.append({
                "path": entry["path"], "source": str(source), "packSha256": sha256_file(local) if local.is_file() else None,
                "sourceSha256": sha256_file(source) if source.is_file() else None,
                "pinnedSha256": entry.get("sha256"),
            })
    inputs = {
        "schema": "hima-cellfmax-inputs/1",
        "boundAt": now(),
        "orfsRoot": str(orfs), "orfsCommit": commit.stdout.strip() or None,
        "orfsLocalChanges": [line for line in dirty.stdout.splitlines() if line.strip()],
        "designConfig": design_config, "designConfigSha256": sha256_file(config),
        "sdc": str(sdc), "sdcSha256": sha256_file(sdc),
        "platformConfigSha256": sha256_file(platform_config),
        "platformLib": str(platform_lib), "platformLibSha256": sha256_file(platform_lib),
        "platformDontUse": platform_dont_use(orfs),
        "containerImage": image, "containerImageId": image_id,
        "celluziRoot": str(celluzi_root), "bool2cmosRoot": str(bool2cmos_root),
        "toolbox": toolbox,
    }
    write_json(state_dir(ws) / "inputs.json", inputs)
    # The engineer reads lessons and best from round 1 on, so both exist (empty) before it starts.
    if not (state_dir(ws) / "lessons.json").is_file():
        write_json(state_dir(ws) / "lessons.json", {"schema": "hima-cellfmax-lessons/1", "rounds": []})
    if not (state_dir(ws) / "best.json").is_file():
        write_json(state_dir(ws) / "best.json", EMPTY_BEST)
    print("bound ORFS %s, image %s, %d platform dont-use cells" % (inputs["orfsCommit"], image_id[:12], len(inputs["platformDontUse"])))


def load_inputs(ws):
    path = state_dir(ws) / "inputs.json"
    if not path.is_file():
        raise ToolError("state/inputs.json is missing; bind-inputs must run first")
    inputs = read_json(path)
    flow = Path(inputs["orfsRoot"]) / "flow"
    if sha256_file(flow / inputs["designConfig"]) != inputs["designConfigSha256"]:
        raise ToolError("the ORFS design config changed since bind-inputs")
    if sha256_file(inputs["platformLib"]) != inputs["platformLibSha256"]:
        raise ToolError("the platform Liberty changed since bind-inputs")
    return inputs


# ---------------------------------------------------------------- ORFS launch (baseline and arms)

def _sdc_with_period(source_text, period_ns):
    replaced, count = re.subn(r"(?m)^(\s*set\s+clk_period\s+)\S+", lambda m: m.group(1) + ("%g" % period_ns), source_text)
    if count != 1:
        raise ToolError("constraint.sdc has %d `set clk_period` lines, expected 1" % count)
    return replaced


def prepare_run(ws, inputs, run_dir, period_ns, recipe=None, arm=None):
    """Write the run's private inputs under <run_dir>/inputs and return the make variables."""
    run_dir = Path(run_dir)
    if run_dir.exists():
        shutil.rmtree(run_dir)
    staged = run_dir / "inputs"
    staged.mkdir(parents=True)
    sdc_text = _sdc_with_period(Path(inputs["sdc"]).read_text(), period_ns)
    write_text(staged / "constraint.sdc", sdc_text)
    shutil.copyfile(FLOW_DIR / "orfs_arm.sh", staged / "orfs_arm.sh")
    shutil.copyfile(FLOW_DIR / "top_paths.tcl", staged / "top_paths.tcl")
    variables = {
        "SDC_FILE": "/work/inputs/constraint.sdc",
        "NUM_CORES": str(NUM_CORES),
    }
    sources = {"constraint.sdc": sha256_file(staged / "constraint.sdc")}
    custom_names = []
    if recipe is not None:
        library = recipe.get("library") or {}
        measured = load_characterization(ws, recipe)
        cells = [cell for cell in library.get("cells") or [] if cell["name"] in measured["measuredNames"]]
        custom_names = [cell["name"] for cell in cells]
        if cells:
            lib_path = Path(ws) / measured["measuredLib"]
            merged = staged / "merged.lib"
            _merge_liberty(Path(inputs["platformLib"]), lib_path, merged)
            write_text(staged / "custom.lef", lef_subset((Path(ws) / library["lef"]).read_text(errors="replace"), custom_names))
            variables["LIB_FILES"] = "/work/inputs/merged.lib"
            variables["ADDITIONAL_LEFS"] = "/work/inputs/custom.lef"
            gds = [Path(ws) / cell["files"]["gds"] for cell in cells if cell.get("files", {}).get("gds")]
            if gds:
                (staged / "gds").mkdir()
                for path in gds:
                    shutil.copyfile(path, staged / "gds" / path.name)
                variables["ADDITIONAL_GDS"] = " ".join("/work/inputs/gds/" + path.name for path in gds)
            sources.update({"merged.lib": sha256_file(merged), "custom.measured.lib": sha256_file(lib_path),
                            "custom.lef": sha256_file(staged / "custom.lef")})
        dont_use = list(inputs["platformDontUse"])
        if arm == "control":
            dont_use += custom_names
        variables["DONT_USE_CELLS"] = " ".join(dont_use)
        synthesis = recipe.get("synthesis") or {"method": "orfs-abc"}
        if synthesis.get("method") == "emap-window":
            netlist = Path(ws) / (synthesis["netlist"] if arm == "custom" else synthesis["controlNetlist"])
            shutil.copyfile(netlist, staged / "synth.v")
            variables["SYNTH_NETLIST_FILES"] = "/work/inputs/synth.v"
            sources["synth.v"] = sha256_file(staged / "synth.v")
    return variables, sources, custom_names


def lef_subset(text, names):
    """The LEF header (everything before the first MACRO) plus only the named MACROs."""
    first = re.search(r"(?m)^\s*MACRO\s", text)
    header = text[:first.start()] if first else text
    blocks = [m.group(0) for m in re.finditer(r"(?ms)^\s*MACRO\s+(\S+)\s*$.*?^\s*END\s+\1\s*$", text) if m.group(1) in names]
    return header.rstrip() + "\n\n" + "\n\n".join(block.strip("\n") for block in blocks) + "\n\nEND LIBRARY\n"


def _lef_area(text, name):
    macro = lef_macros_raw(text).get(name, "")
    size = re.search(r"SIZE\s+([0-9.]+)\s+BY\s+([0-9.]+)", macro)
    return round(float(size.group(1)) * float(size.group(2)), 4) if size else None


def lef_macros_raw(text):
    return {m.group(1): m.group(0) for m in re.finditer(r"(?ms)^\s*MACRO\s+(\S+)\s*$.*?^\s*END\s+\1\s*$", text)}


def resizer_footprint(cell, ref_text):
    """The footprint a measured cell gets, so OpenROAD's footprint-matched resizer can use it.

    A drop-in variant of its compareTo foundry cell (same pin names, logically equivalent function)
    joins that cell's footprint family; any other cell keeps the family the engineer names
    (`footprint`) or its own name."""
    cc = _charcore()
    try:
        ref = cc.read_cell(ref_text, cell["compareTo"])
    except Exception:
        return cell.get("footprint") or cell["name"], "compareTo cell not in the platform Liberty"
    m = re.search(r'cell_footprint\s*:\s*"?([^";]+)"?', cc.find_cell_text(ref_text, cell["compareTo"]))
    ref_inputs = sorted(p for p, v in ref["pins"].items() if v.get("direction") == "input")
    ref_outputs = {p: v.get("function") for p, v in ref["pins"].items() if v.get("direction") == "output"}
    if not m or ref_inputs != sorted(cell["inputs"]) or set(ref_outputs) != set(cell["outputs"]):
        return cell.get("footprint") or cell["name"], "not a drop-in variant of %s (pins differ)" % cell["compareTo"]
    names = sorted(cell["inputs"])
    for bits in range(1 << len(names)):
        env = {name: bool(bits >> i & 1) for i, name in enumerate(names)}
        for out, ref_function in ref_outputs.items():
            if not ref_function or cc.eval_function(cc.parse_function(ref_function.strip('"')), env) != \
                    cc.eval_function(cc.parse_function(cell["functions"][out]), env):
                return cell.get("footprint") or cell["name"], "not a drop-in variant of %s (function differs)" % cell["compareTo"]
    # OpenSTA groups equivalent cells by the function expression's structure, so a drop-in variant
    # also takes the foundry cell's function text verbatim (!(A|B|C) and (!A&!B&!C) never match).
    cell["_foundryFunctions"] = {out: function.strip('"') for out, function in ref_outputs.items()}
    return m.group(1).strip(), "drop-in variant of %s" % cell["compareTo"]


def load_characterization(ws, recipe):
    path = state_dir(ws) / "characterization.json"
    if not path.is_file():
        raise ToolError("state/characterization.json is missing; the characterize step runs before the arms")
    record = read_json(path)
    if record.get("round") != recipe["round"]:
        raise ToolError("state/characterization.json is for round %s, not %s" % (record.get("round"), recipe["round"]))
    return record


def cmd_characterize(ws, timeout_min):
    """Measure every DRC/LVS-clean extracted custom cell with ngspice (calibrated) for this round."""
    ws = Path(ws)
    inputs = load_inputs(ws)
    recipe, recipe_sha = validate_recipe(ws, rerun=True)
    k = recipe["round"]
    library = recipe.get("library") or {}
    cells = library.get("cells") or []
    run_dir = ws / "runs" / ("r%d" % k) / "char"
    if run_dir.exists():
        shutil.rmtree(run_dir)
    run_dir.mkdir(parents=True)
    lef_text = (ws / library["lef"]).read_text(errors="replace") if cells else ""
    rows, job, footprints = [], [], {}
    for cell in cells:
        files = cell.get("files") or {}
        if cell.get("layout") != "drc-lvs-clean" or not files.get("ext"):
            rows.append({"name": cell["name"], "status": "excluded", "reason": "abstract layout: no DRC/LVS-clean extracted netlist to measure"})
            continue
        spice = (ws / files["ext"]).resolve()
        ports = re.search(r"(?mi)^\.subckt\s+%s\s+(.*)$" % re.escape(cell["name"]), spice.read_text(errors="replace"))
        if not ports:
            rows.append({"name": cell["name"], "status": "excluded", "reason": "the extracted netlist has no .subckt %s" % cell["name"]})
            continue
        names = ports.group(1).split()
        power = "VPWR" if "VPWR" in names else "VDD"
        ground = "VGND" if "VGND" in names else "GND"
        footprint, footprint_reason = resizer_footprint(cell, Path(inputs["platformLib"]).read_text(errors="replace"))
        footprints[cell["name"]] = {"footprint": footprint, "why": footprint_reason}
        job.append({"name": cell["name"], "spice": str(spice), "subckt": cell["name"],
                    "pins": {"power": power, "ground": ground, "inputs": cell["inputs"], "outputs": cell["outputs"]},
                    "functions": cell.pop("_foundryFunctions", None) or cell["functions"], "area_um2": _lef_area(lef_text, cell["name"]),
                    "lef": str((ws / files["lef"]).resolve()), "index_ref": cell["compareTo"], "footprint": footprint})
    write_json(run_dir / "job.json", {"cells": job})
    started = time.time()
    rc, tail = 0, []
    result = {}
    if job:
        ref = inputs["platformLib"]
        char = ws / "flow" / "toolbox" / "char"
        cal = ws / "runs" / "calibration"
        script = ("export PATH=/foss/tools/bin:/usr/bin:/bin; cd %s && "
                  "( [ -f %s/calibration.json ] || python3 %s/calibrate.py --reference-lib %s --out %s --jobs 16 ) && "
                  "python3 %s/characterize.py %s/job.json --reference-lib %s --calibration %s/calibration.json --out %s --jobs 16"
                  ) % (run_dir, cal, char, ref, cal, char, run_dir, ref, cal, run_dir)
        orfs = inputs["orfsRoot"]
        argv = ["podman", "run", "--rm", "--entrypoint", "/bin/bash", "--userns=keep-id", "--cpus=16",
                "-v", "%s:%s:rw" % (ws.resolve(), ws.resolve()), "-v", "%s:%s:ro" % (orfs, orfs),
                inputs["containerImageId"], "-c", script]
        log_path = run_dir / "char.log"
        with open(log_path, "w") as log:
            try:
                rc = subprocess.run(argv, stdout=log, stderr=subprocess.STDOUT, timeout=float(timeout_min) * 60).returncode
            except subprocess.TimeoutExpired:
                rc = "timeout"
        tail = log_path.read_text(errors="replace").splitlines()[-30:]
        if rc not in (0, 1) or not (run_dir / "characterization.json").is_file():
            raise ToolError("characterization refused or failed (exit %s): %s" % (rc, " | ".join(tail[-6:])))
        result = read_json(run_dir / "characterization.json")
        by_name = {c.get("name"): c for c in result.get("cells", [])}
        for cell in job:
            entry = by_name.get(cell["name"], {})
            ok = entry.get("status") == "ok"
            rows.append({"name": cell["name"], "status": "measured" if ok else "failed",
                         "reason": None if ok else (entry.get("reason") or "no characterization result"),
                         "footprint": footprints[cell["name"]]["footprint"], "footprintWhy": footprints[cell["name"]]["why"]})
    measured_names = [row["name"] for row in rows if row["status"] == "measured"]
    lib = run_dir / "custom.measured.lib"
    record = {
        "schema": "hima-cellfmax-characterization/1", "round": k, "recipeSha256": recipe_sha,
        "measuredLib": os.path.relpath(lib, ws) if measured_names and lib.is_file() else None,
        "measuredNames": measured_names if lib.is_file() else [],
        "cells": rows, "method": result.get("method"), "calibration": result.get("calibration"),
        "factors": result.get("factors"), "exitCode": rc, "wallSeconds": round(time.time() - started, 1),
        "writtenAt": now(),
    }
    write_json(state_dir(ws) / "characterization.json", record)
    counts = {status: sum(1 for row in rows if row["status"] == status) for status in ("measured", "failed", "excluded")}
    print("round %d characterization: %s in %ss" % (k, counts, record["wallSeconds"]))


def _merge_liberty(base, custom, out):
    """Insert the custom library's templates and cells before the base library's closing brace."""
    base_text = base.read_text()
    custom_text = custom.read_text()
    groups = []
    for keyword in ("lu_table_template", "power_lut_template", "cell"):
        for match in re.finditer(r"(?m)^[ \t]*%s\s*\(\s*\"?([A-Za-z0-9_]+)\"?\s*\)\s*\{" % keyword, custom_text):
            if keyword != "cell" and re.search(r"%s\s*\(\s*\"?%s\"?\s*\)" % (keyword, re.escape(match.group(1))), base_text):
                continue
            end = _group_end(custom_text, match.end() - 1)
            groups.append(custom_text[match.start():end + 1])
    closing = base_text.rstrip().rfind("}")
    write_text(out, base_text[:closing] + "\n  /* ---- custom-cell-fmax demo cells (MODELED timing) ---- */\n"
               + "\n".join(groups) + "\n" + base_text[closing:])


def run_orfs(ws, inputs, run_dir, variant, variables, timeout_min):
    """Run ORFS `finish` plus the top-paths report in the pinned container; return (rc, seconds, log tail)."""
    run_dir = Path(run_dir)
    name = "cellfmax-" + sha256_bytes(str(run_dir.resolve()).encode())[:12]
    orfs = inputs["orfsRoot"]
    env_args = []
    for key, value in sorted(variables.items()):
        env_args += ["-e", "CELLFMAX_VAR_%s=%s" % (key, value)]
    argv = [
        "podman", "run", "--rm", "--name", name, "--entrypoint", "/bin/bash", "--userns=keep-id",
        "--cpus=%d" % NUM_CORES, "-e", "DISPLAY=", "-e", "CELLFMAX_ORFS=%s" % orfs,
        "-e", "CELLFMAX_DESIGN_CONFIG=%s" % inputs["designConfig"], "-e", "CELLFMAX_VARIANT=%s" % variant,
        *env_args,
        "-v", "%s:%s:ro" % (orfs, orfs), "-v", "%s:/work:rw" % run_dir.resolve(),
        inputs["containerImageId"], "-lc", "bash /work/inputs/orfs_arm.sh",
    ]
    write_json(run_dir / "launch.json", {"argv": argv, "startedAt": now(), "timeoutMin": timeout_min})
    started = time.time()
    log_path = run_dir / "orfs.log"
    with open(log_path, "w") as log:
        process = subprocess.Popen(argv, stdout=log, stderr=subprocess.STDOUT)
        try:
            rc = process.wait(timeout=timeout_min * 60)
        except subprocess.TimeoutExpired:
            subprocess.run(["podman", "stop", "-t", "10", name], capture_output=True, timeout=120)
            process.wait(timeout=120)
            rc = "timeout"
    seconds = round(time.time() - started, 1)
    tail = log_path.read_text(errors="replace").splitlines()[-40:]
    return rc, seconds, tail


def _metrics_dir(run_dir, variant):
    return Path(run_dir) / "logs" / PLATFORM / DESIGN / variant


def _results_dir(run_dir, variant):
    return Path(run_dir) / "results" / PLATFORM / DESIGN / variant


def collect_arm(run_dir, variant, period_ns, custom_names):
    """Read the ORFS metric JSON files, the final routed netlist and the top-paths report."""
    logs = _metrics_dir(run_dir, variant)
    report = logs / "6_report.json"
    if not report.is_file():
        return None, "ORFS finish metrics %s are missing" % report
    finish = read_json(report)
    route_drc = None
    for candidate in sorted(logs.glob("5_*route*.json")):
        value = read_json(candidate).get("detailedroute__route__drc_errors")
        if value is not None:
            route_drc = int(value)
    wns = finish.get("finish__timing__setup__ws")
    tns = finish.get("finish__timing__setup__tns")
    if wns is None:
        return None, "finish__timing__setup__ws is absent from 6_report.json"
    netlist = _results_dir(run_dir, variant) / "6_final.v"
    if not netlist.is_file():
        return None, "final routed netlist 6_final.v is missing"
    counts = netlist_cell_counts(netlist)
    custom = {name: counts.get(name, 0) for name in custom_names}
    unknown = sorted(name for name in counts if not name.startswith(CELL_PREFIX) and name not in custom)
    forbidden = {name: count for name, count in counts.items() if FORBIDDEN_RE.match(name)}
    paths = parse_top_paths(Path(run_dir) / "top-paths.txt", set(custom_names))
    return {
        "wnsNs": float(wns), "tnsNs": float(tns) if tns is not None else None,
        "fmaxMhz": fmax_mhz(period_ns, float(wns)),
        "areaUm2": finish.get("finish__design__instance__area"),
        "powerW": finish.get("finish__power__total"),
        "routeDrc": route_drc,
        "instances": finish.get("finish__design__instance__count"),
        "customInstances": custom,
        "customInstanceTotal": sum(custom.values()),
        "forbiddenInstances": forbidden,
        "forbiddenInstanceTotal": sum(forbidden.values()),
        "unknownMasters": unknown,
        "topPaths": paths,
        "netlistSha256": sha256_file(netlist),
    }, None


def parse_top_paths(path, custom_names):
    """Parse an OpenSTA `report_checks -group_path_count N` text into path summaries."""
    if not Path(path).is_file():
        return []
    text = Path(path).read_text(errors="replace")
    paths = []
    for block in re.split(r"(?m)^Startpoint: ", text)[1:]:
        start = block.split("\n", 1)[0].split(" (")[0].strip()
        end = re.search(r"(?m)^Endpoint: (\S+)", block)
        slack = re.search(r"(?m)^\s*(-?[0-9.]+)\s+slack \((MET|VIOLATED)\)", block)
        cells = [cell for cell in re.findall(r"\(([A-Za-z0-9_]+)\)\s*$", block, re.M)
                 if cell.startswith(CELL_PREFIX) or cell in custom_names]
        paths.append({
            "startpoint": start, "endpoint": end.group(1) if end else None,
            "slackNs": float(slack.group(1)) if slack else None,
            "cells": cells,
            "customCells": [cell for cell in cells if cell in custom_names],
        })
    return paths[:20]


def _arm_record(ws, kind, round_number, period_ns, variant, run_dir, rc, seconds, tail, sources, custom_names, recipe_sha):
    body = {
        "schema": ARM_SCHEMA, "arm": kind, "round": round_number, "periodNs": period_ns,
        "variant": variant, "runDir": os.path.relpath(run_dir, ws), "exitCode": rc,
        "runtimeSeconds": seconds, "recipeSha256": recipe_sha, "sources": sources,
        "customCells": custom_names, "finished": False, "writtenAt": now(),
    }
    if rc == 0:
        metrics, problem = collect_arm(run_dir, variant, period_ns, custom_names)
        if metrics is not None:
            body.update(metrics)
            body["finished"] = True
        else:
            body["failure"] = problem
    else:
        body["failure"] = "ORFS exited %s" % rc
    if not body["finished"]:
        body["logTail"] = tail
    return body


def cmd_baseline(ws, period, timeout_min):
    ws = Path(ws)
    inputs = load_inputs(ws)
    period_ns = float(period)
    run_dir = ws / "runs" / "baseline"
    variables, sources, _ = prepare_run(ws, inputs, run_dir, period_ns)
    rc, seconds, tail = run_orfs(ws, inputs, run_dir, "base", variables, float(timeout_min))
    body = _arm_record(ws, "baseline", 0, period_ns, "base", run_dir, rc, seconds, tail, sources, [], None)
    write_json(state_dir(ws) / "baseline.json", body)
    print("baseline finished=%s fmax=%s MHz wns=%s ns in %ss" % (body["finished"], body.get("fmaxMhz"), body.get("wnsNs"), seconds))


# ---------------------------------------------------------------- recipe validation

def load_best(ws):
    path = state_dir(ws) / "best.json"
    return read_json(path) if path.is_file() else None


def load_lessons(ws):
    path = state_dir(ws) / "lessons.json"
    return read_json(path) if path.is_file() else {"schema": "hima-cellfmax-lessons/1", "rounds": []}


def validate_recipe(ws, rerun=False, recipe_path=None, files_root=None):
    """Check the engineer's delivery. Raises ToolError naming exactly what must change.

    At delivery the recipe must be the next round. The arms and compare-round may run again for the
    round already recorded in lessons.json (`rerun`), but only with byte-identical recipe bytes."""
    ws = Path(ws)
    path = Path(recipe_path) if recipe_path else state_dir(ws) / "round-recipe.json"
    roots = [Path(files_root), Path(ws)] if files_root else [Path(ws)]
    if not path.is_file():
        raise ToolError("state/round-recipe.json is missing; the engineer must deliver it as its result")
    try:
        recipe = read_json(path)
    except ValueError as error:
        raise ToolError("state/round-recipe.json is not JSON: %s" % error)
    if recipe.get("schema") != RECIPE_SCHEMA:
        raise ToolError("recipe schema must be %r" % RECIPE_SCHEMA)
    lessons = load_lessons(ws)
    measured = [entry for entry in lessons["rounds"] if entry.get("round")]
    expected_round = len(measured) + 1
    k = recipe.get("round")
    repeat = rerun and measured and k == measured[-1]["round"] and measured[-1].get("recipeSha256") == sha256_file(path)
    if not isinstance(k, int) or isinstance(k, bool) or (k != expected_round and not repeat):
        raise ToolError("recipe round must be %d (lessons.json holds %d measured round(s))" % (expected_round, expected_round - 1))
    prefix = "cells/r%d" % k
    period = recipe.get("periodNs")
    if not isinstance(period, (int, float)) or isinstance(period, bool) or not 1.0 <= period <= 20.0:
        raise ToolError("periodNs must be a number between 1.0 and 20.0 ns")
    synthesis = recipe.get("synthesis") or {}
    method = synthesis.get("method")
    if method not in ("orfs-abc", "emap-window"):
        raise ToolError("synthesis.method must be 'orfs-abc' or 'emap-window'")
    if method == "emap-window":
        rel_under(roots, synthesis.get("netlist"), prefix)
        rel_under(roots, synthesis.get("controlNetlist"), prefix)
        if synthesis.get("equivalence") is not None:
            rel_under(roots, synthesis["equivalence"], prefix)
    library = recipe.get("library") or {}
    cells = library.get("cells") or []
    if not isinstance(cells, list):
        raise ToolError("library.cells must be a list")
    best = load_best(ws)
    best_cells = {cell["name"]: cell for cell in (best or {}).get("library", {}).get("cells", [])}
    names = [cell.get("name") for cell in cells]
    if len(set(names)) != len(names):
        raise ToolError("library.cells has duplicate names")
    missing_best = sorted(set(best_cells) - set(names))
    if missing_best:
        raise ToolError("the recipe drops cells of the best library: %s; keep them byte-identical" % ", ".join(missing_best))
    new_cells = [cell for cell in cells if cell.get("origin") == "r%d" % k]
    if len(new_cells) > MAX_NEW_CELLS:
        raise ToolError("at most %d new cells per round (got %d)" % (MAX_NEW_CELLS, len(new_cells)))
    if not cells and method == "orfs-abc":
        raise ToolError("an orfs-abc round needs at least one custom cell")
    lib_cells, lef_cells = {}, {}
    if cells:
        lef_file = rel_under(roots, library.get("lef"), prefix)
        lef_cells = lef_macros(lef_file.read_text(errors="replace"))
        if library.get("lib"):
            # The engineer's own Liberty is a claim, compared with HimaHarness's measurement.
            lib_file = rel_under(roots, library.get("lib"), prefix)
            lib_cells = liberty_cells(lib_file.read_text(errors="replace"))
    for cell in cells:
        name = cell.get("name")
        if not isinstance(name, str) or not NAME_RE.match(name) or name.startswith(CELL_PREFIX):
            raise ToolError("cell %s: the name must be a plain identifier and not a foundry cell name" % name)
        origin = cell.get("origin")
        match = re.fullmatch(r"r(\d+)", origin or "")
        if not match or not 1 <= int(match.group(1)) <= k:
            raise ToolError("cell %s origin must be r1..r%d" % (name, k))
        inputs = cell.get("inputs")
        outputs = cell.get("outputs")
        for label, pins in (("inputs", inputs), ("outputs", outputs)):
            if not isinstance(pins, list) or not pins or not all(isinstance(o, str) and re.fullmatch(r"[A-Z][A-Z0-9_]*", o) for o in pins):
                raise ToolError("cell %s needs a non-empty %s list of upper-case pin names" % (name, label))
        if set(inputs) & set(outputs) or set(inputs + outputs) & set(PG_PINS):
            raise ToolError("cell %s: inputs, outputs and power pins must be distinct" % name)
        functions = cell.get("functions")
        if not isinstance(functions, dict) or set(functions) != set(outputs) or not all(isinstance(v, str) and v.strip() for v in functions.values()):
            raise ToolError("cell %s needs functions: one Liberty function per output, e.g. {\"Y\": \"!(A|B)\"}" % name)
        used = set(re.findall(r"[A-Za-z_][A-Za-z0-9_]*", " ".join(functions.values())))
        if not used <= set(inputs):
            raise ToolError("cell %s functions name pins %s that are not inputs" % (name, sorted(used - set(inputs))))
        compare_to = cell.get("compareTo")
        if not isinstance(compare_to, str) or not compare_to.startswith(CELL_PREFIX):
            raise ToolError("cell %s needs compareTo: the nearest foundry cell, e.g. sky130_fd_sc_hd__nor3_1" % name)
        layout = cell.get("layout")
        if layout not in ("drc-lvs-clean", "abstract"):
            raise ToolError("cell %s layout must be 'drc-lvs-clean' or 'abstract'" % name)
        files = cell.get("files") or {}
        required = ["sp", "lef"] + (["gds", "ext"] if layout == "drc-lvs-clean" else [])
        for key in required:
            if not files.get(key):
                raise ToolError("cell %s needs files.%s (%s)" % (name, key, "the Magic-extracted netlist HimaHarness characterizes" if key == "ext" else "from the cell factory"))
        hashes = cell.get("sha256") or {}
        cell_prefix = "cells/%s" % origin
        for key, rel in files.items():
            file_path = rel_under(roots, rel, cell_prefix)
            actual = sha256_file(file_path)
            if hashes.get(key) != actual:
                raise ToolError("cell %s files.%s sha256 differs from the file (%s)" % (name, key, actual))
        if origin != "r%d" % k:
            prior = best_cells.get(name)
            if prior is None:
                raise ToolError("cell %s claims origin %s but is not in the best library; rebuild it under %s/" % (name, origin, prefix))
            if prior.get("sha256") != hashes or prior.get("files") != files:
                raise ToolError("cell %s from %s must be byte-identical to best.json" % (name, origin))
        if name not in lef_cells:
            raise ToolError("cell %s has no MACRO in %s" % (name, library.get("lef")))
        lef_pins = lef_cells[name]["pins"]
        lef_signal = {pin for pin, use in lef_pins.items() if use not in ("POWER", "GROUND")}
        if lef_signal != set(inputs + outputs):
            raise ToolError("cell %s signal pins differ: recipe %s, LEF %s" % (name, sorted(inputs + outputs), sorted(lef_signal)))
        if set(PG_PINS) - set(lef_pins):
            raise ToolError("cell %s LEF must carry power pins %s (the factory normalizes this)" % (name, ", ".join(PG_PINS)))
        if name in lib_cells:
            claimed = set(lib_cells[name]["pins"])
            if claimed != set(inputs + outputs):
                raise ToolError("cell %s claimed Liberty pins %s differ from the recipe %s" % (name, sorted(claimed), sorted(inputs + outputs)))
    report = recipe.get("report") or {}
    rel_under(roots, report.get("findings"), prefix)
    rel_under(roots, report.get("usage"), prefix)
    if new_cells:
        rel_under(roots, report.get("library"), prefix)
    if not isinstance(recipe.get("hypothesis"), str) or not recipe["hypothesis"].strip():
        raise ToolError("hypothesis must say what this round expects and why")
    claim = recipe.get("agentClaim")
    if claim is not None:
        if not isinstance(claim, dict):
            raise ToolError("agentClaim must be an object or null")
        for key in ("customFmaxMhz", "controlFmaxMhz", "gainPct"):
            value = claim.get(key)
            if value is not None and (not isinstance(value, (int, float)) or isinstance(value, bool)):
                raise ToolError("agentClaim.%s must be a number" % key)
        for rel in claim.get("runs") or []:
            rel_under(roots, rel, prefix)
    for rel in recipe.get("evidence") or []:
        rel_under(roots, rel, "cells")
    return recipe, sha256_file(path)


def cmd_precheck(ws, own_workspace, recipe):
    """The engineer's own check before delivery: the same validator, on its private files.

    Files are looked up in <own_workspace> first, then in the Campaign <ws> (earlier rounds' cells)."""
    recipe_doc, digest = validate_recipe(ws, recipe_path=recipe, files_root=own_workspace)
    cells = (recipe_doc.get("library") or {}).get("cells") or []
    print("precheck PASS: round %d, %d cell(s), method %s, period %g ns; deliver %s as the result and every "
          "cells/r%d/ file it names as support" % (recipe_doc["round"], len(cells), recipe_doc["synthesis"]["method"],
                                                  recipe_doc["periodNs"], recipe, recipe_doc["round"]))


def cmd_recipe(ws):
    recipe, digest = validate_recipe(ws)
    cells = (recipe.get("library") or {}).get("cells") or []
    print("recipe round %d accepted: %d cell(s), method %s, period %g ns, sha256 %s" % (
        recipe["round"], len(cells), recipe["synthesis"]["method"], recipe["periodNs"], digest))


# ---------------------------------------------------------------- measured arms

def cmd_arm(ws, kind, timeout_min):
    if kind not in ("custom", "control"):
        raise ToolError("arm must be 'custom' or 'control'")
    ws = Path(ws)
    inputs = load_inputs(ws)
    recipe, recipe_sha = validate_recipe(ws, rerun=True)
    k = recipe["round"]
    period_ns = float(recipe["periodNs"])
    run_dir = ws / "runs" / ("r%d" % k) / kind
    variables, sources, custom_names = prepare_run(ws, inputs, run_dir, period_ns, recipe, kind)
    sources["round-recipe.json"] = recipe_sha
    rc, seconds, tail = run_orfs(ws, inputs, run_dir, kind, variables, float(timeout_min))
    body = _arm_record(ws, kind, k, period_ns, kind, run_dir, rc, seconds, tail, sources, custom_names, recipe_sha)
    write_json(state_dir(ws) / ("arm-%s.json" % kind), body)
    print("arm %s round %d finished=%s fmax=%s MHz custom=%s in %ss" % (
        kind, k, body["finished"], body.get("fmaxMhz"), body.get("customInstanceTotal"), seconds))


# ---------------------------------------------------------------- compare

def _function_verified(ws, recipe):
    synthesis = recipe.get("synthesis") or {}
    if synthesis.get("method") != "emap-window":
        return 1, "synthesised from RTL by ORFS Yosys in both arms"
    log = synthesis.get("equivalence")
    if not log:
        return 0, "function not verified: no equivalence log for the remapped window"
    text = (Path(ws) / log).read_text(errors="replace")
    if re.search(r"Equivalence successfully proven|Networks are equivalent|EQUIVALENCE: PASS", text) and \
            not re.search(r"(?i)not equivalent|EQUIVALENCE: FAIL|\b[1-9]\d* (?:are )?unproven", text):
        return 1, "equivalence log passed"
    return 0, "function not verified: the equivalence log does not show a pass"


def cmd_compare(ws):
    ws = Path(ws)
    recipe, recipe_sha = validate_recipe(ws, rerun=True)
    k = recipe["round"]
    baseline = read_json(state_dir(ws) / "baseline.json")
    arms = {}
    for kind in ("custom", "control"):
        path = state_dir(ws) / ("arm-%s.json" % kind)
        arms[kind] = read_json(path) if path.is_file() else {"finished": False, "failure": "arm record missing"}
    custom, control = arms["custom"], arms["control"]
    problems = []
    for kind, arm in arms.items():
        if arm.get("round") != k:
            problems.append("%s arm record is for round %s, not %d" % (kind, arm.get("round"), k))
        if arm.get("recipeSha256") != recipe_sha:
            problems.append("%s arm ran a different recipe" % kind)
        if not arm.get("finished"):
            problems.append("%s arm did not finish: %s" % (kind, arm.get("failure")))
        elif arm.get("routeDrc") != 0:
            problems.append("%s arm has %s route DRC errors" % (kind, arm.get("routeDrc")))
        elif arm.get("forbiddenInstanceTotal", 1) != 0:
            problems.append("%s arm placed %s lpflow/probe cells" % (kind, arm.get("forbiddenInstanceTotal")))
        if arm.get("periodNs") != recipe["periodNs"]:
            problems.append("%s arm period %s differs from the recipe" % (kind, arm.get("periodNs")))
    if control.get("finished") and control.get("customInstanceTotal", 1) != 0:
        problems.append("control arm used %s custom instances" % control.get("customInstanceTotal"))
    valid = not problems
    lessons = load_lessons(ws)
    prior = [entry for entry in lessons["rounds"] if entry.get("round") != k]
    best = load_best(ws)
    if best and best.get("round") == k:
        # A re-run of this round: compare against the best before it, which lessons still hold.
        earlier = [entry for entry in prior if entry.get("roundImproved")]
        best = None
        prior_best_custom = max([entry["customFmaxMhz"] for entry in earlier], default=None) or baseline.get("fmaxMhz")
    else:
        prior_best_custom = (best or {}).get("customFmaxMhz") or baseline.get("fmaxMhz")
    gain = pct(custom.get("fmaxMhz"), control.get("fmaxMhz")) if valid else None
    improved = bool(valid and gain is not None and gain > 0 and custom["fmaxMhz"] > (prior_best_custom or 0))
    gains = [entry["roundGainPct"] for entry in prior if entry.get("comparisonValid") and entry.get("roundGainPct") is not None]
    if gain is not None:
        gains.append(gain)
    best_gain = max(gains) if gains else None
    adopted = custom.get("customInstanceTotal", 0) if custom.get("finished") else 0
    verified, verified_reason = _function_verified(ws, recipe)
    claim = recipe.get("agentClaim") or {}
    claim_gain = claim.get("gainPct")
    claim_delta = round(claim_gain - gain, 4) if claim_gain is not None and gain is not None else None
    matches = None
    synthesis = recipe.get("synthesis") or {}
    if control.get("finished") and baseline.get("finished") and synthesis.get("method") == "orfs-abc" \
            and recipe["periodNs"] == baseline.get("periodNs"):
        matches = all(control.get(key) == baseline.get(key) for key in ("wnsNs", "tnsNs", "instances"))
    if not valid:
        reason = "invalid comparison: " + "; ".join(problems)
    elif adopted == 0:
        reason = "not adopted: the custom arm placed no custom cell"
    elif not improved:
        reason = "adopted but not faster: custom %.2f MHz vs control %.2f MHz, best so far %.2f MHz" % (
            custom["fmaxMhz"], control["fmaxMhz"], prior_best_custom or 0)
    else:
        reason = "improved: custom %.2f MHz over control %.2f MHz (%+.2f %%)" % (custom["fmaxMhz"], control["fmaxMhz"], gain)
    cells = (recipe.get("library") or {}).get("cells") or []
    adopted_by_cell = custom.get("customInstances") or {}
    record = {
        "schema": ROUND_SCHEMA, "round": k, "recipeSha256": recipe_sha, "periodNs": recipe["periodNs"],
        "method": synthesis.get("method"), "hypothesis": recipe.get("hypothesis"),
        "comparisonValid": valid, "problems": problems,
        "custom": {key: custom.get(key) for key in ("finished", "fmaxMhz", "wnsNs", "tnsNs", "areaUm2", "powerW", "routeDrc", "instances", "customInstances", "runtimeSeconds")},
        "control": {key: control.get(key) for key in ("finished", "fmaxMhz", "wnsNs", "tnsNs", "areaUm2", "powerW", "routeDrc", "instances", "customInstances", "runtimeSeconds")},
        "baselineFmaxMhz": baseline.get("fmaxMhz"),
        "roundGainPct": gain, "bestGainPct": best_gain, "roundImproved": improved,
        "customAdopted": adopted, "priorBestCustomFmaxMhz": prior_best_custom,
        "bestCustomFmaxMhz": custom["fmaxMhz"] if improved else prior_best_custom,
        "fmaxVsOriginalBaselinePct": pct(custom.get("fmaxMhz"), baseline.get("fmaxMhz")) if custom.get("finished") else None,
        "functionVerified": verified, "functionVerifiedReason": verified_reason,
        "controlMatchesBaseline": matches,
        "agentClaimGainPct": claim_gain, "claimDeltaPct": claim_delta,
        "reason": reason,
        "cells": library_rows(ws, recipe, adopted_by_cell),
        "characterization": characterization_summary(ws, recipe),
        "topPathsCustom": (custom.get("topPaths") or [])[:5],
        "topPathsControl": (control.get("topPaths") or [])[:5],
        "report": recipe.get("report"),
        "writtenAt": now(),
    }
    write_json(state_dir(ws) / "round.json", record)
    lesson = {key: record[key] for key in ("round", "periodNs", "method", "hypothesis", "comparisonValid", "roundGainPct",
                                            "roundImproved", "customAdopted", "reason", "cells", "functionVerified",
                                            "agentClaimGainPct", "claimDeltaPct", "controlMatchesBaseline", "characterization")}
    lesson["recipeSha256"] = recipe_sha
    lesson["customFmaxMhz"] = custom.get("fmaxMhz")
    lesson["controlFmaxMhz"] = control.get("fmaxMhz")
    lesson["remainingTopPaths"] = [{"endpoint": path["endpoint"], "slackNs": path["slackNs"], "customCells": path["customCells"]}
                                   for path in (custom.get("topPaths") or [])[:5]]
    lessons["rounds"] = prior + [lesson]
    lessons["rounds"].sort(key=lambda entry: entry["round"])
    write_json(state_dir(ws) / "lessons.json", lessons)
    if improved:
        write_json(state_dir(ws) / "best.json", {
            "schema": "hima-cellfmax-best/1", "round": k, "recipeSha256": recipe_sha, "periodNs": recipe["periodNs"],
            "customFmaxMhz": custom["fmaxMhz"], "controlFmaxMhz": control["fmaxMhz"], "gainPct": gain,
            "library": {"lib": recipe["library"].get("lib"), "lef": recipe["library"].get("lef"),
                        "measuredLib": (record["characterization"] or {}).get("measuredLib"),
                        "cells": [{"name": c["name"], "origin": c["origin"], "files": c["files"], "sha256": c["sha256"],
                                   "inputs": c.get("inputs"), "outputs": c["outputs"], "functions": c.get("functions"),
                                   "compareTo": c.get("compareTo"), "layout": c["layout"]} for c in cells]},
            "synthesis": synthesis,
        })
    render_cell_images(ws, k, cells)
    write_text(ws / "derived" / ("round-%d.md" % k), round_markdown(record))
    print("round %d: valid=%s gain=%s%% improved=%s adopted=%s" % (k, valid, gain, improved, adopted))
    cmd_finish(ws)


def _charcore():
    sys.path.insert(0, str(FLOW_DIR / "toolbox" / "char"))
    import charcore  # noqa: E402  (pure Python, shipped in the Pack toolbox)
    return charcore


def _median(values):
    values = sorted(v for v in values if v is not None)
    if not values:
        return None
    mid = len(values) // 2
    return round(values[mid] if len(values) % 2 else (values[mid - 1] + values[mid]) / 2, 4)


def _ratios(cc, lib_text, name, ref_text, ref_name):
    """Median measured/foundry ratio of cell_rise, cell_fall and input capacitance over matching arcs."""
    try:
        cell = cc.read_cell(lib_text, name)
        ref = cc.read_cell(ref_text, ref_name)
    except Exception:  # a missing or unreadable cell is reported as unknown, never as a number
        return {}
    out = {}
    for quantity in ("cell_rise", "cell_fall"):
        ratios = []
        for arc in cell["arcs"]:
            match = [r for r in ref["arcs"] if r["input"] == arc["input"] and quantity in r["tables"]]
            if not match or quantity not in arc["tables"]:
                continue
            for row, ref_row in zip(arc["tables"][quantity], match[0]["tables"][quantity]):
                ratios += [a / b for a, b in zip(row, ref_row) if b and b > 0 and a > 0]
        out[quantity] = _median(ratios)
    caps = [cell["pins"][p].get("capacitance") / ref["pins"][p]["capacitance"] for p in cell["pins"]
            if p in ref["pins"] and cell["pins"][p].get("capacitance") and ref["pins"][p].get("capacitance")]
    out["input_cap"] = _median(caps)
    return out


def characterization_summary(ws, recipe):
    path = state_dir(ws) / "characterization.json"
    if not path.is_file():
        return None
    record = read_json(path)
    if record.get("round") != recipe["round"]:
        return None
    counts = {status: sum(1 for row in record["cells"] if row["status"] == status) for status in ("measured", "failed", "excluded")}
    return {"counts": counts, "measuredLib": record.get("measuredLib"), "factors": record.get("factors"),
            "wallSeconds": record.get("wallSeconds")}


def library_rows(ws, recipe, adopted_by_cell):
    """One row per cell: measured status, adoption, and measured timing against its foundry cell."""
    ws = Path(ws)
    cells = (recipe.get("library") or {}).get("cells") or []
    char_path = state_dir(ws) / "characterization.json"
    status = {}
    lib_text = ref_text = claim_text = ""
    if char_path.is_file():
        record = read_json(char_path)
        if record.get("round") == recipe["round"]:
            status = {row["name"]: row for row in record["cells"]}
            if record.get("measuredLib"):
                lib_text = (ws / record["measuredLib"]).read_text(errors="replace")
    inputs_path = state_dir(ws) / "inputs.json"
    if inputs_path.is_file() and Path(read_json(inputs_path)["platformLib"]).is_file():
        ref_text = Path(read_json(inputs_path)["platformLib"]).read_text(errors="replace")
    if (recipe.get("library") or {}).get("lib") and (ws / recipe["library"]["lib"]).is_file():
        claim_text = (ws / recipe["library"]["lib"]).read_text(errors="replace")
    cc = _charcore() if lib_text and ref_text else None
    rows = []
    for cell in cells:
        row = {"name": cell["name"], "origin": cell["origin"], "inputs": cell.get("inputs"), "outputs": cell["outputs"],
               "functions": cell.get("functions"), "compareTo": cell.get("compareTo"), "layout": cell["layout"],
               "status": status.get(cell["name"], {}).get("status", "not characterized"),
               "statusReason": status.get(cell["name"], {}).get("reason"),
               "adopted": adopted_by_cell.get(cell["name"], 0)}
        if cc and row["status"] == "measured":
            row["measuredVsFoundry"] = _ratios(cc, lib_text, cell["name"], ref_text, cell.get("compareTo"))
            if claim_text and cell["name"] in claim_text:
                row["claimedVsFoundry"] = _ratios(cc, claim_text, cell["name"], ref_text, cell.get("compareTo"))
        rows.append(row)
    return rows


def render_cell_images(ws, k, cells):
    """Best-effort PNG of each new cell's GDS through KLayout in the pinned container."""
    ws = Path(ws)
    targets = [cell for cell in cells if cell.get("origin") == "r%d" % k and cell.get("files", {}).get("gds")]
    if not targets:
        return
    inputs_path = state_dir(ws) / "inputs.json"
    if not inputs_path.is_file():
        return
    image = read_json(inputs_path)["containerImageId"]
    out = ws / "derived" / "cells"
    out.mkdir(parents=True, exist_ok=True)
    for cell in targets:
        gds = (ws / cell["files"]["gds"]).resolve()
        png = out / ("%s.png" % cell["name"])
        script = ("import pya\nlv = pya.LayoutView()\nlv.load_layout('/in/%s', 0)\nlv.max_hier()\nlv.zoom_fit()\n"
                  "lv.save_image('/out/%s', 600, 900)\n" % (gds.name, png.name))
        (out / ".render.py").write_text(script)
        subprocess.run(["podman", "run", "--rm", "--entrypoint", "/bin/bash", "--userns=keep-id", "--cpus=1",
                        "-v", "%s:/in:ro" % gds.parent, "-v", "%s:/out:rw" % out, image, "-lc",
                        "QT_QPA_PLATFORM=offscreen /foss/tools/klayout/klayout -b -r /out/.render.py"],
                       capture_output=True, timeout=300)
        (out / ".render.py").unlink(missing_ok=True)


def _fmt(value, spec="%.2f"):
    return "n/a" if value is None else spec % value


def round_markdown(record):
    lines = [
        "# Round %d" % record["round"], "",
        "Hypothesis: %s" % (record.get("hypothesis") or "-"), "",
        "| | custom arm | control arm |", "| --- | --- | --- |",
        "| Fmax (MHz) | %s | %s |" % (_fmt(record["custom"].get("fmaxMhz")), _fmt(record["control"].get("fmaxMhz"))),
        "| WNS (ns) | %s | %s |" % (_fmt(record["custom"].get("wnsNs"), "%.3f"), _fmt(record["control"].get("wnsNs"), "%.3f")),
        "| TNS (ns) | %s | %s |" % (_fmt(record["custom"].get("tnsNs"), "%.3f"), _fmt(record["control"].get("tnsNs"), "%.3f")),
        "| area (um2) | %s | %s |" % (_fmt(record["custom"].get("areaUm2"), "%.0f"), _fmt(record["control"].get("areaUm2"), "%.0f")),
        "| route DRC | %s | %s |" % (record["custom"].get("routeDrc"), record["control"].get("routeDrc")),
        "", "Clock period %g ns, synthesis %s. Comparison valid: %s." % (record["periodNs"], record["method"], record["comparisonValid"]),
        "HimaHarness gain (custom vs its own control): %s %%. Agent's own claim: %s %% (difference %s)." % (
            _fmt(record["roundGainPct"]), _fmt(record["agentClaimGainPct"]), _fmt(record["claimDeltaPct"])),
        "Custom instances adopted: %s. Function: %s." % (record["customAdopted"], record["functionVerifiedReason"]),
        "", "Outcome: %s" % record["reason"], "",
    ]
    summary = record.get("characterization") or {}
    counts = summary.get("counts") or {}
    lines += ["Library: %d cell(s); measured by HimaHarness %d, characterization failed %d, excluded %d (not measurable)." % (
        len(record["cells"]), counts.get("measured", 0), counts.get("failed", 0), counts.get("excluded", 0)), "",
        "| cell | function | vs foundry | status | adopted | measured rise | measured fall | input cap | claimed rise |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for cell in sorted(record["cells"], key=lambda c: (-c["adopted"], c["name"])):
        measured = cell.get("measuredVsFoundry") or {}
        claimed = cell.get("claimedVsFoundry") or {}
        functions = "; ".join("%s=%s" % kv for kv in (cell.get("functions") or {}).items())
        status = cell["status"] + (" (%s)" % cell["statusReason"] if cell.get("statusReason") else "")
        lines.append("| %s | %s | %s | %s | %d | %s | %s | %s | %s |" % (
            cell["name"], functions, (cell.get("compareTo") or "").replace(CELL_PREFIX, ""), status, cell["adopted"],
            _fmt(measured.get("cell_rise"), "%.2fx"), _fmt(measured.get("cell_fall"), "%.2fx"),
            _fmt(measured.get("input_cap"), "%.2fx"), _fmt(claimed.get("cell_rise"), "%.2fx")))
    lines += ["", "Ratios are medians over the 7x7 tables against the named foundry cell (below 1 = faster or smaller).",
              "Custom-cell timing is SPICE-characterized by HimaHarness from the extracted layout (ngspice, tt 1.8 V 25 C, "
              "calibrated against foundry cells); not signoff, not silicon.", ""]
    return "\n".join(lines)


# ---------------------------------------------------------------- finish

def cmd_finish(ws):
    ws = Path(ws)
    baseline = read_json(state_dir(ws) / "baseline.json") if (state_dir(ws) / "baseline.json").is_file() else {}
    lessons = load_lessons(ws)
    best = load_best(ws)
    rounds = lessons["rounds"]
    best_gain = max([r["roundGainPct"] for r in rounds if r.get("comparisonValid") and r.get("roundGainPct") is not None], default=None)
    summary = {
        "schema": "hima-cellfmax-summary/1",
        "baseline": {key: baseline.get(key) for key in ("periodNs", "fmaxMhz", "wnsNs", "tnsNs", "routeDrc", "finished")},
        "rounds": rounds, "bestGainPct": best_gain,
        "best": best, "claimBoundary": CLAIM_BOUNDARY, "writtenAt": now(),
    }
    write_json(ws / "derived" / "summary.json", summary)
    lines = ["# Custom-cell Fmax on SKY130 aes: summary", "",
             "Stock baseline at %s ns: %s MHz (WNS %s ns, route DRC %s)." % (
                 baseline.get("periodNs"), _fmt(baseline.get("fmaxMhz")), _fmt(baseline.get("wnsNs"), "%.3f"), baseline.get("routeDrc")),
             "",
             "| round | period (ns) | method | custom Fmax | control Fmax | HimaHarness gain | agent claim | adopted | valid | function | outcome |",
             "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for r in rounds:
        lines.append("| %d | %g | %s | %s | %s | %s %% | %s %% | %s | %s | %s | %s |" % (
            r["round"], r["periodNs"], r["method"], _fmt(r.get("customFmaxMhz")), _fmt(r.get("controlFmaxMhz")),
            _fmt(r.get("roundGainPct")), _fmt(r.get("agentClaimGainPct")), r.get("customAdopted"),
            r.get("comparisonValid"), "verified" if r.get("functionVerified") else "function not verified", r.get("reason")))
    lines += ["", "Best matched gain: %s %%." % _fmt(best_gain), ""]
    if best and best.get("round"):
        lines += ["Best library (round %d):" % best["round"], ""]
        for cell in best["library"]["cells"]:
            image = "derived/cells/%s.png" % cell["name"]
            lines.append("- %s (%s, from %s)%s" % (cell["name"], cell["layout"], cell["origin"],
                                                   " — image `%s`" % image if (ws / image).is_file() else ""))
        lines.append("")
    for r in rounds:
        lines.append("Round %d reports: see `derived/round-%d.md` and the agent's findings under `cells/r%d/`." % (r["round"], r["round"], r["round"]))
    lines += ["", "Claim boundary: " + CLAIM_BOUNDARY, ""]
    write_text(ws / "derived" / "summary.md", "\n".join(lines))
    print("summary written: %d round(s), best gain %s %%" % (len(rounds), best_gain))


# ---------------------------------------------------------------- entry

COMMANDS = {
    "bind": (cmd_bind, 6), "baseline": (cmd_baseline, 3), "recipe": (cmd_recipe, 1), "precheck": (cmd_precheck, 3),
    "characterize": (cmd_characterize, 2),
    "arm": (cmd_arm, 3), "compare": (cmd_compare, 1), "finish": (cmd_finish, 1),
}


def main(argv):
    if len(argv) < 2 or argv[1] not in COMMANDS:
        print("usage: cellfmax_cli.py {%s} <WORKSPACE> ..." % "|".join(COMMANDS), file=sys.stderr)
        return 2
    command, arity = COMMANDS[argv[1]]
    if len(argv) - 2 != arity:
        print("cellfmax_cli.py %s takes %d argument(s)" % (argv[1], arity), file=sys.stderr)
        return 2
    try:
        command(*argv[2:])
    except ToolError as error:
        print("cellfmax %s: %s" % (argv[1], error), file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
