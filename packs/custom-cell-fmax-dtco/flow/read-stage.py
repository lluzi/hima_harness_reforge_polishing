#!/usr/bin/env python3
"""Read one PLS-25 stage record and re-derive numeric Hima observations."""
from __future__ import annotations

import hashlib
import gzip
import json
import math
import os
from pathlib import Path
import re
import sys

ROUTES = (
    "timing_criticality", "timing_context", "structure_frequency",
    "structure_compaction", "mapper_compatibility", "functional_diversity",
)
BUILDABLE_ROUTES = {"fusion", "cluster_compose", "boolean_synthesis"}
validate_generation_request = None
project_texts = None
project_attributed_texts = None
expected_generation_jobs = None
retained_candidate_ids = None
select_candidate_portfolio = None
validate_cumulative_manifest = None
evaluate_frontier = None


def load_domain(workspace):
    global validate_generation_request, project_texts, project_attributed_texts, expected_generation_jobs, retained_candidate_ids
    global select_candidate_portfolio, validate_cumulative_manifest
    domain = (workspace / "flow" / "domain").resolve()
    if not domain.is_dir() or not domain.is_relative_to(workspace.resolve()):
        raise ValueError("staged domain parser directory is absent or escapes workspace")
    required = (domain / "cell_need_miner" / "generator_contract.py", domain / "_cell_adoption_projection.py")
    if any(not path.is_file() or path.is_symlink() for path in required):
        raise ValueError("staged domain parser sources are incomplete")
    if str(domain) not in sys.path:
        sys.path.insert(0, str(domain))
    from cell_need_miner.generator_contract import validate_generation_request as validator
    from _cell_adoption_projection import project_texts as projector
    from _cell_adoption_projection import project_attributed_texts as attributed_projector
    from _generation_projection import expected_generation_jobs as generation_projector
    from _generation_projection import retained_candidate_ids as retention_projector
    from _generation_projection import validate_cumulative_manifest as manifest_validator
    from mine_patterns import select_candidate_portfolio as portfolio_selector
    validate_generation_request = validator
    project_texts = projector
    project_attributed_texts = attributed_projector
    expected_generation_jobs = generation_projector
    retained_candidate_ids = retention_projector
    select_candidate_portfolio = portfolio_selector
    validate_cumulative_manifest = manifest_validator


def load_frontier(workspace):
    global evaluate_frontier
    flow = workspace / "flow"
    source = flow / "library_richness.py"
    if not source.is_file() or source.is_symlink():
        raise ValueError("staged Library-richness evaluator is absent or invalid")
    if str(flow) not in sys.path:
        sys.path.insert(0, str(flow))
    from library_richness import evaluate_frontier as frontier_evaluator
    evaluate_frontier = frontier_evaluator


def unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate key: " + key)
        value[key] = item
    return value


def load(path):
    return json.loads(Path(path).read_text(), object_pairs_hook=unique)


def checked(ref, workspace):
    if not isinstance(ref, dict) or not isinstance(ref.get("path"), str):
        raise ValueError("malformed file reference")
    raw = Path(ref["path"])
    path = (workspace / raw).resolve() if not raw.is_absolute() else raw.resolve()
    if path.is_symlink() or not path.is_file():
        raise ValueError("held evidence is missing or a symlink: %s" % path)
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != ref.get("sha256") or len(data) != ref.get("bytes"):
        raise ValueError("held evidence identity mismatch: %s" % path)
    return path


def checkpoint_path(workspace, value, what):
    raw = Path(value)
    candidate = raw if raw.is_absolute() else workspace / raw
    lexical = Path(os.path.abspath(candidate))
    if not lexical.is_relative_to(workspace):
        raise ValueError("%s escapes workspace" % what)
    cursor = workspace
    for part in lexical.relative_to(workspace).parts:
        cursor = cursor / part
        if cursor.is_symlink():
            raise ValueError("%s contains a symlink: %s" % (what, cursor))
    resolved = lexical.resolve()
    if not resolved.is_relative_to(workspace):
        raise ValueError("%s resolves outside workspace" % what)
    return resolved


def checkpoint_snapshot(base_path, workspace, allowed_links, phase):
    if phase not in ("init", "postroute"):
        raise ValueError("checkpoint phase must be init or postroute")
    script = checkpoint_path(workspace, base_path, "checkpoint script")
    root = checkpoint_path(workspace, str(base_path) + ".dat", "checkpoint directory")
    if not script.is_file() or script.stat().st_size == 0:
        raise ValueError("checkpoint restore script is absent or empty")
    if not root.is_dir():
        raise ValueError("checkpoint data directory is absent")
    directories, files, links = [], [], []
    for entry in sorted(root.rglob("*"), key=lambda item: item.relative_to(root).as_posix()):
        relative = entry.relative_to(root).as_posix()
        if entry.is_symlink():
            expected = allowed_links.get(relative)
            if expected is None:
                raise ValueError("checkpoint tree contains an undeclared symlink: " + relative)
            link_text = os.readlink(entry)
            raw_target = Path(link_text) if Path(link_text).is_absolute() else entry.parent / link_text
            if raw_target.is_symlink():
                raise ValueError("checkpoint link points through another symlink: " + relative)
            target = raw_target.resolve(strict=True)
            if target.is_dir() or not target.is_file() or target != expected["resolvedPath"]:
                raise ValueError("checkpoint link target is invalid or retargeted: " + relative)
            raw = target.read_bytes()
            if hashlib.sha256(raw).hexdigest() != expected["sha256"] or len(raw) != expected["bytes"]:
                raise ValueError("checkpoint link target identity changed: " + relative)
            links.append({"path": relative, "linkText": link_text,
                          "target": {key: expected[key] for key in
                                     ("role", "path", "sha256", "bytes", "sourceType")}})
            continue
        if entry.is_dir():
            directories.append(relative)
        elif entry.is_file():
            raw = entry.read_bytes()
            files.append({"path": relative, "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)})
        else:
            raise ValueError("checkpoint tree contains an unsupported member: " + relative)
    if not files:
        raise ValueError("checkpoint data directory contains no files")
    if {row["path"] for row in links} != set(allowed_links):
        raise ValueError("checkpoint tree is missing one or more declared vendor links")
    script_raw = script.read_bytes()
    body = {
        "phase": phase,
        "script": {"path": str(script.relative_to(workspace)),
                   "sha256": hashlib.sha256(script_raw).hexdigest(), "bytes": len(script_raw)},
        "restorePath": str(root.relative_to(workspace)),
        "directories": directories, "files": files, "links": links,
    }
    tree_hash = hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return {"schema": "custom-cell-fmax-innovus-checkpoint/1", **body, "treeSha256": tree_hash}


def validate_checkpoint(manifest_path, workspace, allowed_links, phase):
    document = load(manifest_path)
    if set(document) != {"schema", "phase", "script", "restorePath", "directories", "files", "links", "treeSha256"}:
        raise ValueError("checkpoint manifest has unexpected fields")
    if document.get("schema") != "custom-cell-fmax-innovus-checkpoint/1":
        raise ValueError("checkpoint manifest schema is unsupported")
    if document.get("phase") != phase:
        raise ValueError("checkpoint manifest has the wrong phase")
    script = document.get("script")
    if not isinstance(script, dict) or set(script) != {"path", "sha256", "bytes"}:
        raise ValueError("checkpoint manifest has no exact restore-script identity")
    rebuilt = checkpoint_snapshot(checkpoint_path(workspace, script["path"], "checkpoint script"),
                                  workspace, allowed_links, phase)
    if rebuilt != document:
        raise ValueError("checkpoint manifest differs from the complete current tree")
    return checkpoint_path(workspace, document["restorePath"], "checkpoint restore path")


def one(record, workspace, role, block="artifacts"):
    rows = [ref for ref in record.get(block, []) if ref.get("role") == role]
    if len(rows) != 1:
        raise ValueError("expected exactly one %s in %s" % (role, block))
    return checked(rows[0], workspace)


def logs(record, workspace, role):
    rows = [entry["log"] for entry in record.get("executions", [])
            if isinstance(entry.get("log"), dict) and entry["log"].get("role") == role]
    if len(rows) != 1:
        raise ValueError("expected exactly one execution log " + role)
    return checked(rows[0], workspace)


def number(kind, value, unit="count", **extra):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("%s is not a finite numeric observation" % kind)
    return {"type": kind, "unit": unit, "value": value, **extra}


def unknown(kind, reason, unit="count", **extra):
    return {"type": kind, "unit": unit, "value": None, "unknownReason": reason, **extra}


def liberty_cells(text):
    cells = re.findall(r"(?m)^\s*cell\s*\(\s*\"?([A-Za-z_][A-Za-z0-9_$]*)\"?\s*\)", text)
    if not cells or len(cells) != len(set(cells)):
        raise ValueError("generated Liberty has no unique Cell set")
    return set(cells)


def drc_count(path, limit):
    text = path.read_text(errors="replace")
    commands = re.findall(r"^#\s*Command:\s*verify_drc\s+([^\n]+)$", text, re.M)
    if len(commands) != 1 or not re.search(r"(?:^|\s)-limit\s+%d(?:\s|$)" % limit, commands[0]):
        raise ValueError("verify_drc report lacks expected command echo")
    totals = re.findall(r"Total Violations\s*:\s*(\d+)", text, re.I)
    clean = bool(re.search(r"No DRC violations were found", text, re.I))
    if clean == bool(totals):
        raise ValueError("verify_drc report has missing or conflicting total")
    count = 0 if clean else int(totals[0])
    if count >= limit or re.search(r"truncat|maximum number", text, re.I):
        raise ValueError("verify_drc report is capped or truncated")
    return count


def connectivity_count(path):
    text = path.read_text(errors="replace")
    counts = [int(value) for value in re.findall(
        r"(?:Total(?: number of)? (?:connectivity )?violations|Total Violations)\s*[:=]\s*(\d+)", text, re.I)]
    counts.extend(int(value) for value in re.findall(r"^\s*(\d+)\s+Problem\(s\)", text, re.I | re.M))
    clean = bool(re.search(r"(?:no connectivity violations|0\s+connectivity violations)", text, re.I))
    if counts and len(set(counts)) == 1:
        return counts[0]
    if not counts and clean:
        return 0
    raise ValueError("connectivity report has no unambiguous violation total")


def secondary_pnr(power_path, gatecount_path, summary_path):
    power = Path(power_path).read_text(errors="replace")
    gatecount = Path(gatecount_path).read_text(errors="replace")
    summary = Path(summary_path).read_text(errors="replace")
    if len(re.findall(r"Power Units\s*=\s*1mW", power)) != 1:
        raise ValueError("post-route power report does not declare one 1mW unit")
    totals = re.findall(r"^Total Power:\s*([0-9.eE+-]+)\s*$", power, re.M)
    gates = re.findall(r"^\[0\]\s+\S+\s+Gates=(\d+)\s+Cells=(\d+)\s+Area=([0-9.eE+-]+)\s+um\^2\s*$", gatecount, re.M)
    instances = re.findall(r"^# Instances:\s*(\d+)\s*$", summary, re.M)
    density = re.findall(r"^% Pure Gate Density #6 .*:\s*([0-9.eE+-]+)%\s*$", summary, re.M)
    if len(totals) != 1 or len(gates) != 1 or len(instances) != 1 or len(density) != 1:
        raise ValueError("post-route power, gate-count or density report has no unambiguous summary")
    values = [float(totals[0]), float(gates[0][2]), float(density[0])]
    if any(not math.isfinite(value) or value < 0 for value in values):
        raise ValueError("post-route power, area or density is not a finite nonnegative value")
    return {"postroute_power_mw": values[0], "gate_count": int(gates[0][0]),
            "cell_count": int(gates[0][1]), "postroute_cell_area_um2": values[1],
            "route_instance_count": int(instances[0]), "route_density_pct": values[2]}


def report_text(path):
    try:
        raw = gzip.decompress(path.read_bytes()) if path.suffix == ".gz" else path.read_bytes()
        return raw.decode("utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise ValueError("cannot decode complete timing report %s: %s" % (path, exc)) from exc


def timing(path, companion, mode="Setup"):
    text = report_text(path)
    path_text = report_text(companion)
    summary_commands = re.findall(r"^#\s+Command:\s+(.+?)\s*$", text, re.M)
    path_commands = re.findall(r"^#\s+Command:\s+(.+?)\s*$", path_text, re.M)
    if len(summary_commands) != 1 or summary_commands != path_commands:
        raise ValueError("timing summary and path report lack one identical timeDesign command")
    header = None
    for line in text.splitlines():
        if "|" not in line:
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) >= 2 and cells[0] == mode + " mode" and cells[1] == "all":
            header = cells[1:]
            break
    views = set(re.findall(r"^Analysis View:\s*(\S+)\s*$", path_text, re.M))
    if not header or "all" not in header or len(views) != 1:
        raise ValueError("post-route timing lacks one %s table and companion analysis view" % mode.lower())
    for line in text.splitlines():
        if "|" in line and "WNS (ns)" in line:
            cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
            value = float(cells[header.index("all") + 1])
            if math.isfinite(value):
                violating_rows = []
                for row in text.splitlines():
                    if "|" in row and "Violating Paths" in row:
                        row_cells = [cell.strip() for cell in row.strip().strip("|").split("|")]
                        violating_rows.append(float(row_cells[header.index("all") + 1]))
                if (len(violating_rows) != 1 or not math.isfinite(violating_rows[0])
                        or violating_rows[0] < 0 or not violating_rows[0].is_integer()):
                    raise ValueError("post-route timing has no finite nonnegative integer setup/all violating-path count")
                path_one = re.search(r"^Path 1:.*?^=?\s*Slack Time\s+([0-9.eE+-]+)\s*$",
                                     path_text, re.M | re.S)
                if path_one is None or float(path_one.group(1)) != value:
                    raise ValueError("post-route summary WNS differs from Path 1 slack")
                return next(iter(views)), value, int(violating_rows[0])
    raise ValueError("post-route timing has no finite setup/all WNS")


def sdc_period(path):
    values = [float(value) for value in re.findall(
        r"\bcreate_clock\b[^\n]*\s-period\s+([0-9.eE+-]+)", path.read_text(errors="replace"))]
    if not values or len(set(values)) != 1 or values[0] <= 0:
        raise ValueError("PnR-bound SDC has no single positive clock period")
    return values[0]


def pnr_input_sdc_identity(path):
    text = Path(path).read_text()
    header = re.compile(r"^# Created by write_sdc on [^\r\n]+$", re.M)
    if len(header.findall(text)) != 1:
        raise ValueError("PnR-input SDC lacks one recognized volatile write_sdc header")
    stable = header.sub("# Created by write_sdc on <volatile>", text, count=1)
    raw = stable.encode()
    return {"sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw),
            "canonicalization": "one write_sdc creation-time comment"}


def mmmc_identity(path):
    text = path.read_text(errors="replace")
    mode = re.findall(r"create_constraint_mode\s+-name\s+(\S+)\s+-sdc_files\s+\[list\s+([^\]]+)\]", text)
    view = re.findall(r"create_analysis_view\s+-name\s+(\S+)\s+-constraint_mode\s+(\S+)\s+-delay_corner\s+(\S+)", text)
    active = re.findall(r"set_analysis_view\s+-setup\s+\{([^}]+)\}\s+-hold\s+\{([^}]+)\}", text)
    qrc = re.findall(r"create_rc_corner\b[^\n]*-qx_tech_file\s+(\S+)\s+-temperature\s+(\S+)", text)
    libraries = re.findall(r"create_library_set\s+-name\s+(\S+)\s+-timing\s+\[list\s+([^\]]+)\]", text)
    if not all(len(rows) == 1 for rows in (mode, view, active, qrc, libraries)):
        raise ValueError("MMMC evidence does not declare one analysis view")
    return {"sdc": mode[0][1].strip(), "view": view[0][0], "active": active[0][0],
            "qrc": qrc[0][0], "temperature": qrc[0][1],
            "libraries": libraries[0][1].split()}


def checkpoint_allowed_links(record, workspace, arm, phase):
    if phase not in ("init", "postroute"):
        raise ValueError("checkpoint link phase must be init or postroute")
    target_roles = {"TECH_LEF", "FOUNDRY_LEF", "FOUNDRY_LIB", "FOUNDRY_QRC_TECH",
                    "generated_liberty", "generated_lef", "pnr_input_sdc",
                    "postroute_rc_model"}
    refs = list(record.get("inputs", []))
    if phase == "postroute":
        rc_refs = [row for row in record.get("artifacts", []) if row.get("role") == "postroute_rc_model"]
        if len(rc_refs) != 1:
            raise ValueError("PnR record has no unique postroute RC model artifact")
        checked(rc_refs[0], workspace)
        refs.extend(rc_refs)
    held = {}
    for ref in refs:
        if ref.get("role") not in target_roles:
            continue
        raw = Path(ref["path"])
        resolved = (workspace / raw).resolve() if not raw.is_absolute() else raw.resolve()
        if resolved in held:
            raise ValueError("checkpoint link targets repeat a held path")
        held[resolved] = {**ref, "resolvedPath": resolved}
    init_text = one(record, workspace, "init_script:" + arm).read_text(errors="replace")
    lef_rows = re.findall(r"^set init_lef_file\s+\[list\s+([^\]]+)\]\s*$", init_text, re.M)
    if len(lef_rows) != 1:
        raise ValueError("init script has no unambiguous LEF contract")
    mmmc = mmmc_identity(one(record, workspace, "mmmc_script:" + arm))
    categories = [
        (lef_rows[0].split(), "libs/lef"),
        (list(mmmc["libraries"]) + ([mmmc["sdc"]] if phase == "init" else []), "libs/mmmc"),
        ([mmmc["qrc"]], "libs/mmmc/rc_" + arm),
    ]
    if phase == "postroute":
        rc_models = [row for row in held.values() if row["role"] == "postroute_rc_model"]
        if len(rc_models) != 1:
            raise ValueError("postroute checkpoint requires one hash-held RC model")
        categories.append(([str(rc_models[0]["resolvedPath"])], "libs/misc"))
    allowed = {}
    for paths, folder in categories:
        for value in paths:
            target = Path(value).resolve()
            expected = held.get(target)
            if expected is None:
                raise ValueError("checkpoint script target is not a hash-held arm input")
            relative = folder + "/" + target.name
            if relative in allowed:
                raise ValueError("checkpoint link path collision")
            allowed[relative] = expected
    return allowed


def dc_version(text):
    hits = re.findall(
        r"^[ \t]*Version[ \t]+(\S+)[ \t]+for[ \t]+(\S+)[ \t]+-[ \t]+(.+?)[ \t]*$",
        text, re.M)
    if len(hits) != 1:
        raise ValueError("DC log has no unambiguous supported Version header")
    return {"version": hits[0][0], "platform": hits[0][1], "build": hits[0][2]}


def dc_target_pressure(path, expected_top):
    text = Path(path).read_text(errors="replace")
    designs = re.findall(r"(?m)^Design\s*:\s*(\S+)\s*$", text)
    groups = re.findall(r"(?m)^\s*Path Group:\s*(\S+)\s*$", text)
    starts = re.findall(r"(?m)^\s*Startpoint:\s*(.+)$", text)
    ends = re.findall(r"(?m)^\s*Endpoint:\s*(.+)$", text)
    slacks = [float(value) for value in re.findall(r"(?m)^\s*slack \([^)]*\)\s+(-?[0-9.eE+-]+)\s*$", text)]
    if designs != [expected_top] or not groups or len(groups) != len(slacks) or set(groups) != {"reg2reg"}:
        raise ValueError("DC target pressure report is not the declared top reg2reg group")
    if len(starts) != len(groups) or len(ends) != len(groups) or not all(math.isfinite(value) for value in slacks):
        raise ValueError("DC target pressure report has incomplete or nonfinite paths")
    return {"pathCount": len(groups), "worstSlackNs": min(slacks)}


def innovus_version(text):
    hits = re.findall(r"^Version:\s*(v[^,\s]+),\s+built\s+(.+?)\s*$", text, re.M)
    if len(hits) != 1:
        raise ValueError("Innovus log has no unambiguous supported version header")
    return {"version": hits[0][0], "build": hits[0][1]}


def held_identities(refs, exact=(), prefixes=()):
    selected = [ref for ref in refs if ref.get("role") in exact
                or any(str(ref.get("role", "")).startswith(prefix) for prefix in prefixes)]
    roles = [ref.get("role") for ref in selected]
    if len(roles) != len(set(roles)) or set(exact) - set(roles):
        raise ValueError("common-condition file identity is incomplete or ambiguous")
    return [{key: ref[key] for key in ("role", "sha256", "bytes", "sourceType")}
            for ref in sorted(selected, key=lambda row: row["role"])]


def referenced_paths(refs, workspace, roles):
    paths = []
    for ref in refs:
        if ref.get("role") not in roles:
            continue
        path = Path(ref["path"])
        paths.append(str((workspace / path).resolve() if not path.is_absolute() else path.resolve()))
    return paths


def normalized_synth_entry(text):
    lines = []
    for line in text.splitlines():
        if "::env(CCFMAX_CUSTOM_DB)" in line or "::env(CCFMAX_ARM)" in line:
            continue
        line = re.sub(r"/[^\s\"]+/flow/artifacts/(?:foundry|custom)-synth/run-[0-9a-f]+", "@RUN@", line)
        lines.append(line)
    return "\n".join(lines)


def normalized_arm_script(text, excluded_paths=()):
    text = "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))
    text = "\n".join(line for line in text.splitlines()
                     if not re.match(r"^\s*(?:floorPlan|loadFPlan|saveFPlan|loadIoFile|saveIoFile|setPlaceMode -place_global_place_io_pins)\b", line))
    for path in sorted(excluded_paths, key=len, reverse=True):
        text = text.replace(" " + path, "")
    text = re.sub(r"\s+/[^\s{}\]]+/generated\.(?:lib|lef)", "", text)
    text = re.sub(r"/[^\s{}\]]+/flow/artifacts/pnr-(?:foundry|generated)/run-[0-9a-f]+", "@RUN@", text)
    text = re.sub(r"/[^\s{}\]]+/(?:base|custom)\.dc\.(?:v|sdc)", "@SYNTH@", text)
    text = re.sub(r"(?:foundry|generated)", "@ARM@", text)
    text = re.sub(r"DBS_@ARM@", "@DB@", text)
    return text


def derived_synth_condition(record, workspace, arm):
    entry = one(record, workspace, "synthesis_entry")
    log = logs(record, workspace, arm + "-dc_log")
    facts = record.get("facts", {})
    clock = facts.get("clock_ns")
    dc_uncertainty = facts.get("dc_uncertainty_ns")
    route_uncertainty = facts.get("route_uncertainty_ns")
    if (not all(isinstance(value, (int, float)) and math.isfinite(value)
                for value in (clock, dc_uncertainty, route_uncertainty))
            or not math.isclose(dc_uncertainty, clock * 0.50, abs_tol=1e-12)
            or not math.isclose(route_uncertainty, clock * 0.25 + 0.050, abs_tol=1e-12)):
        raise ValueError("synthesis record lacks the fixed 50% DC / 25%+50ps APR pressure identity")
    return {
        "schema": "custom-cell-fmax-common-condition/1", "kind": "synthesis",
        "commonInputs": held_identities(record.get("inputs", []),
            exact=("FOUNDRY_DB", "shared_synth_template", "shared_synth_constraints", "EDA_WRAPPER"),
            prefixes=("rtl:",)),
        "entryContractSha256": hashlib.sha256(normalized_synth_entry(entry.read_text()).encode()).hexdigest(),
        "tool": dc_version(log.read_text(errors="replace")),
        "clockNs": clock,
        "dcUncertaintyNs": dc_uncertainty,
        "routeUncertaintyNs": route_uncertainty,
        "armSpecificExclusions": ["CCFMAX_ARM", "CCFMAX_CUSTOM_DB", "generated_db"],
    }


def derived_pnr_condition(record, workspace, arm):
    scripts = {kind: one(record, workspace, "%s_script:%s" % (kind, arm))
               for kind in ("mmmc", "init", "pnr")}
    init_tool = innovus_version(logs(record, workspace, "init-" + arm + "_log").read_text(errors="replace"))
    route_tool = innovus_version(logs(record, workspace, "pnr-" + arm + "_log").read_text(errors="replace"))
    if init_tool != route_tool:
        raise ValueError("Innovus init and route tool versions differ")
    excluded = referenced_paths(record.get("inputs", []), workspace,
                                {"generated_liberty", "generated_lef"})
    init_text = scripts["init"].read_text(errors="replace")
    facts = record.get("facts", {})
    utilization = facts.get("floorplan_utilization")
    core_box = facts.get("floorplan_core_box")
    pin_plan = facts.get("pin_plan_identity")
    if (not isinstance(utilization, (int, float)) or not 0.2 <= float(utilization) <= 0.8
            or not isinstance(core_box, list) or len(core_box) != 4
            or not all(isinstance(value, (int, float)) and math.isfinite(value) for value in core_box)
            or core_box[2] <= core_box[0] or core_box[3] <= core_box[1]
            or not isinstance(pin_plan, dict) or not re.fullmatch(r"[0-9a-f]{64}", str(pin_plan.get("sha256") or ""))
            or not isinstance(pin_plan.get("pinCount"), int) or pin_plan["pinCount"] <= 0):
        raise ValueError("PnR record lacks one frozen floorplan and pin-plan identity")
    place_site = facts.get("place_site")
    sites = re.findall(r"(?m)^\s*floorPlan\s+-site\s+(\S+)", init_text)
    loaded_floorplans = re.findall(r"(?m)^\s*loadFPlan\s+\{([^}]+)\}", init_text)
    if (not isinstance(place_site, str) or not place_site
            or (arm == "foundry" and sites != [place_site])
            or (arm == "generated" and (sites or len(loaded_floorplans) != 1))):
        raise ValueError("PnR init script/facts lack one arm-appropriate place Site and floorplan source")
    return {
        "schema": "custom-cell-fmax-common-condition/1", "kind": "place-and-route",
        "commonInputs": held_identities(record.get("inputs", []), exact=(
            "TECH_LEF", "FOUNDRY_LEF", "FOUNDRY_LIB", "FOUNDRY_QRC_TECH",
            "FOUNDRY_GDS", "CCFMAX_GDS_MAP", "EDA_WRAPPER",
            "pnr_method_template:init.tcl.tmpl", "pnr_method_template:mmmc.tcl.tmpl",
            "pnr_method_template:pnr.tcl.tmpl")),
        "scriptContractSha256": hashlib.sha256("\n".join(
            normalized_arm_script(scripts[kind].read_text(), excluded) for kind in ("mmmc", "init", "pnr")
        ).encode()).hexdigest(),
        "tool": init_tool,
        "floorplanUtilization": float(utilization),
        "floorplanCoreBox": core_box,
        "pinPlan": pin_plan,
        "placeSite": place_site,
        "armSpecificExclusions": ["generated_db", "generated_liberty", "generated_lef"],
    }


def checked_condition(record, workspace, derived):
    if load(one(record, workspace, "common_condition_identity")) != derived:
        raise ValueError("published common-condition identity disagrees with held evidence")
    return derived


LFR_SCENARIOS = ("optimistic", "nominal", "conservative")
LFR_RELATION_CODES = {
    "equal": 0,
    "augmented-dominates": 1,
    "tradeoff": 2,
    "reference-dominates": 3,
}


def canonical_payload_sha(document, field):
    if not isinstance(document, dict) or not re.fullmatch(r"[0-9a-f]{64}", str(document.get(field) or "")):
        raise ValueError("LFR document has no canonical payload identity: " + field)
    payload = dict(document)
    expected = payload.pop(field)
    raw = (json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode()
    actual = hashlib.sha256(raw).hexdigest()
    if actual != expected:
        raise ValueError("LFR document payload identity mismatch: " + field)
    return expected


def finite(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
        raise ValueError(name + " is not finite")
    return float(value)


def lfr_metric(metrics, name):
    layer, field = name.split(".", 1)
    if not isinstance(metrics, dict) or not isinstance(metrics.get(layer), dict):
        raise ValueError("LFR metric layer is absent: " + layer)
    return finite(metrics[layer].get(field), name)


def recompute_pairwise(reference, augmented, objectives):
    comparisons = []
    better = False
    worse = False
    seen = set()
    for index, objective in enumerate(objectives):
        if not isinstance(objective, dict) or set(objective) != {"metric", "direction"}:
            raise ValueError("LFR objective %d is malformed" % index)
        metric = objective["metric"]
        direction = objective["direction"]
        if not isinstance(metric, str) or metric in seen or direction not in ("minimize", "maximize"):
            raise ValueError("LFR objective identity/direction is invalid")
        seen.add(metric)
        before = lfr_metric(reference, metric)
        after = lfr_metric(augmented, metric)
        relation = "equal"
        if after != before:
            improved = after < before if direction == "minimize" else after > before
            relation = "improved" if improved else "regressed"
            better = better or improved
            worse = worse or not improved
        comparisons.append({
            "metric": metric, "direction": direction, "reference": before,
            "augmented": after, "augmented_minus_reference": after - before,
            "relation": relation,
        })
    relation = ("tradeoff" if better and worse else "augmented-dominates" if better
                else "reference-dominates" if worse else "equal")
    return {"relation": relation, "comparisons": comparisons}


def recompute_completeness(metrics, required):
    available, missing = [], []
    for name in required:
        try:
            lfr_metric(metrics, name)
            available.append(name)
        except ValueError:
            missing.append(name)
    return {
        "required": list(required), "available": available, "missing": missing,
        "fraction": len(available) / len(required) if required else 0.0,
        "complete": not missing and bool(required),
    }


def validate_round_evaluation(evaluation, schemas=("lfr-round-evaluation/3",)):
    if not isinstance(evaluation, dict) or evaluation.get("schema") not in schemas:
        raise ValueError("unsupported LFR evaluation schema")
    if evaluation.get("status") != "succeeded" or evaluation.get("evidence_class") != "license-free-evaluation-agent":
        raise ValueError("LFR evaluation did not succeed as license-free evidence")
    canonical_payload_sha(evaluation, "evaluation_payload_sha256")
    limits = evaluation.get("claim_limits")
    if (not isinstance(limits, dict) or not limits
            or any(value is not False for value in limits.values())):
        raise ValueError("LFR evaluation claim limits are absent or assert commercial meaning")
    policy = evaluation.get("metric_policy")
    if not isinstance(policy, dict):
        raise ValueError("LFR evaluation metric policy is absent")
    objectives = policy.get("objectives")
    required = policy.get("required_metrics")
    if not isinstance(objectives, list) or not objectives or not isinstance(required, list) or not required:
        raise ValueError("LFR metric policy is incomplete")
    scenarios = evaluation.get("scenarios")
    if not isinstance(scenarios, dict) or set(scenarios) != set(LFR_SCENARIOS):
        raise ValueError("LFR scenarios are incomplete")
    relations = {}
    completeness = {}
    for name in LFR_SCENARIOS:
        scenario = scenarios[name]
        if not isinstance(scenario, dict) or scenario.get("status") != "succeeded":
            raise ValueError("LFR scenario did not succeed: " + name)
        reference = scenario.get("reference")
        augmented = scenario.get("augmented")
        expected_pairwise = recompute_pairwise(reference, augmented, objectives)
        if scenario.get("pairwise_relation") != expected_pairwise:
            raise ValueError("LFR scenario pairwise relation is not reproducible: " + name)
        expected_completeness = {
            "reference": recompute_completeness(reference, required),
            "augmented": recompute_completeness(augmented, required),
        }
        expected_completeness["complete"] = all(
            row["complete"] for row in expected_completeness.values())
        if scenario.get("metric_completeness") != expected_completeness:
            raise ValueError("LFR scenario metric completeness is not reproducible: " + name)
        completeness[name] = expected_completeness
        relations[name] = expected_pairwise["relation"]
    aggregate = ("incomplete" if "incomplete" in relations.values()
                 else "equal" if all(value == "equal" for value in relations.values())
                 else "augmented-dominates" if all(value in ("equal", "augmented-dominates") for value in relations.values())
                 else "reference-dominates" if all(value in ("equal", "reference-dominates") for value in relations.values())
                 else "tradeoff")
    expected_relation = {"relation": aggregate, "by_scenario": relations}
    if evaluation.get("pairwise_relation") != expected_relation:
        raise ValueError("LFR aggregate pairwise relation is not reproducible")
    expected_top = {"by_scenario": completeness, "complete": all(
        row["complete"] for row in completeness.values())}
    if evaluation.get("metric_completeness") != expected_top:
        raise ValueError("LFR aggregate metric completeness is not reproducible")
    return evaluation


def histogram_percentile(histogram, percentile, name):
    if not isinstance(histogram, dict) or not histogram:
        raise ValueError(name + " histogram is absent")
    rows = []
    for value, count in histogram.items():
        level = int(value)
        if isinstance(count, bool) or not isinstance(count, int) or count < 0:
            raise ValueError(name + " histogram count is invalid")
        rows.append((level, count))
    total = sum(count for _level, count in rows)
    if total <= 0:
        return 0.0
    target = max(1, math.ceil(percentile * total))
    seen = 0
    for level, count in sorted(rows):
        seen += count
        if seen >= target:
            return float(level)
    raise ValueError(name + " histogram percentile is not reachable")


def mapping_values(evaluation):
    scenario = evaluation["scenarios"]["nominal"]
    reference = scenario["reference"]
    augmented = scenario["augmented"]
    rf2, af2 = reference["F2"], augmented["F2"]
    rf3, af3 = reference["F3"], augmented["F3"]
    p95_reference = histogram_percentile(rf2.get("logic_level_distribution"), 0.95, "reference logic level")
    p95_augmented = histogram_percentile(af2.get("logic_level_distribution"), 0.95, "augmented logic level")
    pressure_reference = finite(rf2.get("buffer_instance_count"), "reference buffer count") + finite(
        rf2.get("inverter_instance_count"), "reference inverter count")
    pressure_augmented = finite(af2.get("buffer_instance_count"), "augmented buffer count") + finite(
        af2.get("inverter_instance_count"), "augmented inverter count")
    fanout_load_reference = finite(rf2.get("mean_fanout"), "reference mean fanout") * finite(
        rf2.get("mean_load_indicator"), "reference mean load")
    fanout_load_augmented = finite(af2.get("mean_fanout"), "augmented mean fanout") * finite(
        af2.get("mean_load_indicator"), "augmented mean load")
    adopted = evaluation.get("mapping_adoption", {}).get("candidate_instances_in_augmented")
    if not isinstance(adopted, dict) or any(isinstance(value, bool) or not isinstance(value, int) or value < 1
                                            for value in adopted.values()):
        raise ValueError("LFR candidate adoption census is malformed")
    return [
        number("proxy_mapped_instance_delta", lfr_metric(augmented, "F2.mapped_instance_count")
               - lfr_metric(reference, "F2.mapped_instance_count")),
        number("proxy_logic_depth_p95_delta", p95_augmented - p95_reference),
        number("proxy_buffer_inverter_pressure_delta", pressure_augmented - pressure_reference),
        number("proxy_fanout_load_delta", fanout_load_augmented - fanout_load_reference, "index"),
        number("proxy_adopted_candidate_count", len(adopted)),
        number("proxy_worst_reg2reg_delay_indicator",
               finite(af3.get("worst_delay_indicator_ps"), "augmented worst delay") / 1000.0, "ns"),
        number("proxy_negative_slack_mass_indicator",
               finite(af3.get("negative_slack_mass_indicator_ps"), "augmented negative slack mass") / 1000.0, "ns"),
    ]


def validate_local_portfolio(portfolio):
    if not isinstance(portfolio, dict) or portfolio.get("schema") != "hima.library-richness.portfolio/1":
        raise ValueError("function/local evaluation has the wrong schema")
    if portfolio.get("stage") != "pre_mapping" or portfolio.get("status") != "PRE_MAPPING_PLANNING":
        raise ValueError("function/local evaluation is not a pre-mapping portfolio")
    claims = portfolio.get("claims")
    if (not isinstance(claims, dict) or set(claims) != {
            "commercial_adoption", "commercial_qor_prediction", "fmax_improvement", "post_route_benefit"}
            or any(value is not False for value in claims.values())):
        raise ValueError("function/local evaluation asserts a forbidden commercial claim")
    evaluations = portfolio.get("candidate_evaluations")
    if not isinstance(evaluations, list) or not evaluations:
        raise ValueError("function/local evaluation has no candidate evaluations")
    candidates = []
    for index, row in enumerate(evaluations):
        if not isinstance(row, dict) or not isinstance(row.get("candidate"), dict):
            raise ValueError("function/local candidate evaluation %d is malformed" % index)
        candidates.append(row["candidate"])
    proxy = portfolio.get("design_proxy_evidence")
    if not isinstance(proxy, dict) or not isinstance(proxy.get("raw"), dict):
        raise ValueError("function/local design proxy evidence is absent")
    recomputed = select_candidate_portfolio(
        candidates, portfolio.get("max_candidates"), stage="pre_mapping",
        design_proxy_evidence=proxy["raw"],
    )
    if json.loads(json.dumps(recomputed, sort_keys=True)) != portfolio:
        raise ValueError("function/local portfolio differs from independent recomputation")
    return portfolio


def function_local_values(portfolio):
    validate_local_portfolio(portfolio)
    evaluations = {row["candidate_id"]: row for row in portfolio["candidate_evaluations"]}
    selected_ids = [row["candidate_id"] for row in portfolio.get("selected", [])]
    selected = [evaluations[candidate_id]["candidate"] for candidate_id in selected_ids]
    boolean_ok = bool(selected) and all(
        row.get("functional_equivalence", {}).get("status") == "exact" for row in selected)
    generator_ok = bool(selected) and all(
        row.get("generation_feasibility", {}).get("status") == "ready" for row in selected)
    interface_ok = bool(selected)
    for row in selected:
        interface = row.get("identity", {}).get("interface")
        if not isinstance(interface, dict):
            interface_ok = False
            continue
        inputs, outputs = interface.get("inputs"), interface.get("outputs")
        interface_ok = interface_ok and isinstance(inputs, list) and isinstance(outputs, list) and bool(outputs)
        interface_ok = interface_ok and interface.get("input_count") == len(inputs or [])
        interface_ok = interface_ok and interface.get("output_count") == len(outputs or [])
        interface_ok = interface_ok and len(set(inputs or [])) == len(inputs or [])
        interface_ok = interface_ok and len(set(outputs or [])) == len(outputs or [])
    local_bounds = []
    structural = []
    new_cells = 0.0
    local_ok = bool(selected)
    for row in selected:
        bound = row.get("local_break_even")
        metrics = row.get("structural_metrics")
        cost = row.get("library_cost")
        if (not isinstance(bound, dict) or bound.get("status") != "pass"
                or bound.get("unit") != "delay_unit" or not isinstance(metrics, dict)
                or not isinstance(cost, dict)):
            local_ok = False
            continue
        local_bounds.append(finite(bound.get("break_even_delay"), "local break-even bound"))
        structural.append({
            "levels": finite(metrics.get("levels_removed"), "levels removed"),
            "nodes": finite(metrics.get("nodes_removed"), "nodes removed"),
            "edges": finite(metrics.get("edges_removed"), "edges removed"),
            "cut": finite(metrics.get("cut_width"), "cut width"),
            "reconvergence": finite(metrics.get("reconvergence_coverage"), "reconvergence coverage"),
        })
        new_cells += finite(cost.get("new_library_cells"), "new Library Cells")
    complete = boolean_ok and interface_ok and generator_ok and local_ok and bool(structural)
    levels = max((row["levels"] for row in structural), default=0.0)
    nodes = max((row["nodes"] for row in structural), default=0.0)
    edges = max((row["edges"] for row in structural), default=0.0)
    cut = max((row["cut"] for row in structural), default=0.0)
    reconvergence = max((row["reconvergence"] for row in structural), default=0.0)
    effective = complete and any(value > 0 for value in (levels, nodes, edges))
    bound_value = (number("proxy_break_even_local_bound", min(local_bounds), "delay_unit")
                   if local_bounds else unknown("proxy_break_even_local_bound",
                                                "no selected candidate has a valid local break-even bound",
                                                "delay_unit"))
    return [
        number("proxy_boolean_equivalent", int(boolean_ok)),
        number("proxy_interface_compatible", int(interface_ok)),
        number("proxy_generator_feasible", int(generator_ok)),
        bound_value,
        number("proxy_local_level_delta", levels),
        number("proxy_removed_node_count", nodes),
        number("proxy_cut_width", cut),
        number("proxy_reconvergence_coverage", reconvergence * 100.0, "percent"),
        number("new_library_cell_count", new_cells),
        number("proxy_metric_vector_complete", int(complete)),
        number("function_local_structure_effective", int(effective)),
    ]


def cumulative_library_values(manifest):
    validate_cumulative_manifest(manifest)
    functions = manifest["functions"]
    cells = {cell for row in functions for cell in row["physicalCellNames"]}
    shards = manifest["shards"]
    newest = set(shards[-1]["functionKeys"]) if shards else set()
    new_cells = {cell for row in functions if row["functionKey"] in newest
                 for cell in row["physicalCellNames"]}
    return [number("new_library_cell_count", len(new_cells)),
            number("cumulative_library_cell_count", len(cells))]


def baseline_evaluation_values(evaluation, mapped_netlist, timing_document):
    if (not isinstance(evaluation, dict) or evaluation.get("schema") != "lfr-baseline-evaluation/1"
            or evaluation.get("status") != "succeeded"
            or evaluation.get("evidence_class") != "license-free-evaluation-agent"):
        raise ValueError("baseline evaluation did not succeed as license-free evidence")
    canonical_payload_sha(evaluation, "evaluation_payload_sha256")
    limits = evaluation.get("claim_limits")
    if not isinstance(limits, dict) or not limits or any(value is not False for value in limits.values()):
        raise ValueError("baseline evaluation asserts a forbidden commercial claim")
    mapping = evaluation.get("mapping")
    if not isinstance(mapping, dict) or mapping.get("status") != "succeeded":
        raise ValueError("baseline mapping did not succeed")
    reference_artifacts = mapping.get("arms", {}).get("reference", {}).get("artifacts")
    mapped_refs = [row for row in (reference_artifacts or []) if row.get("role") == "mapped_netlist"]
    if (len(mapped_refs) != 1 or Path(mapped_refs[0].get("path", "")).resolve() != mapped_netlist
            or mapped_refs[0].get("sha256") != hashlib.sha256(mapped_netlist.read_bytes()).hexdigest()):
        raise ValueError("baseline mapped netlist differs from mapping evidence")
    if (not isinstance(timing_document, dict)
            or timing_document.get("schema") != "hima.lfr-proxy-reg2reg/1"
            or timing_document.get("status") != "succeeded"
            or timing_document.get("path_group") != "reg2reg"
            or not isinstance(timing_document.get("design"), str)):
        raise ValueError("baseline proxy reg2reg document is malformed")
    timing_limits = timing_document.get("claim_limits")
    if (not isinstance(timing_limits, dict) or not timing_limits
            or any(value is not False for value in timing_limits.values())):
        raise ValueError("baseline proxy timing asserts a forbidden commercial claim")
    time_unit_ns = finite(timing_document.get("time_unit_ns"), "baseline time unit")
    if time_unit_ns <= 0:
        raise ValueError("baseline time unit must be positive")
    timing = timing_document.get("timing")
    if not isinstance(timing, dict) or not isinstance(timing.get("paths"), list) or not timing["paths"]:
        raise ValueError("baseline proxy timing has no reg2reg paths")
    scenarios = evaluation.get("scenarios")
    if not isinstance(scenarios, dict) or set(scenarios) != set(LFR_SCENARIOS):
        raise ValueError("baseline scenarios are incomplete")
    for name in LFR_SCENARIOS:
        scenario = scenarios[name]
        if (not isinstance(scenario, dict) or scenario.get("status") != "succeeded"
                or scenario.get("reference") != scenario.get("augmented")
                or scenario.get("pairwise_relation") != {"relation": "equal", "comparisons": []}):
            raise ValueError("baseline scenario is not a self-comparison: " + name)
    if (evaluation.get("pairwise_relation") != {"relation": "equal", "comparisons": []}
            or evaluation.get("metric_completeness") != {"complete": True}):
        raise ValueError("baseline relation/completeness is not reproducible")
    nominal = scenarios["nominal"]["augmented"]
    f2, f3 = nominal["F2"], nominal["F3"]
    expected = {
        "path_count": timing.get("path_count"),
        "worst_delay_indicator_ps": finite(timing.get("worst_delay"), "baseline worst delay") * time_unit_ns * 1000.0,
        "negative_slack_mass_indicator_ps": finite(timing.get("negative_slack_mass"), "baseline negative slack mass") * time_unit_ns * 1000.0,
        "path_family_coverage": timing.get("endpoint_family_count"),
    }
    for key, value in expected.items():
        if f3.get(key) != value:
            raise ValueError("baseline nominal F3 disagrees with retained proxy timing: " + key)
    histogram_percentile(f2.get("logic_level_distribution"), 0.95, "baseline logic level")
    finite(f2.get("buffer_instance_count"), "baseline buffer count")
    finite(f2.get("inverter_instance_count"), "baseline inverter count")
    finite(f2.get("mean_fanout"), "baseline mean fanout")
    finite(f2.get("mean_load_indicator"), "baseline mean load")
    return [
        number("proxy_metric_vector_complete", 1),
        number("proxy_mapped_instance_delta", 0),
        number("proxy_logic_depth_p95_delta", 0),
        number("proxy_buffer_inverter_pressure_delta", 0),
        number("proxy_fanout_load_delta", 0, "index"),
        number("proxy_worst_reg2reg_delay_indicator", expected["worst_delay_indicator_ps"] / 1000.0, "ns"),
        number("proxy_negative_slack_mass_indicator", expected["negative_slack_mass_indicator_ps"] / 1000.0, "ns"),
    ]


def design_evaluation_values(evaluation, frontier_request, frontier, workspace):
    validate_round_evaluation(evaluation)
    # Loaded only for this route so legacy stage Readers do not depend on the Framework entrypoint.
    # The caller has already established the Campaign workspace through the held stage-record path.
    load_frontier(workspace)
    recomputed = evaluate_frontier(frontier_request)
    if recomputed != frontier:
        raise ValueError("cross-round frontier differs from independent recomputation")
    if frontier.get("schema") != "lfr-frontier-evaluation/1" or frontier.get("status") != "succeeded":
        raise ValueError("cross-round frontier did not succeed")
    canonical_payload_sha(frontier, "frontier_payload_sha256")
    manifest = frontier_request.get("library_manifest")
    validate_cumulative_manifest(manifest)
    evaluation_sha = evaluation["evaluation_payload_sha256"]
    current = [row for row in frontier.get("members", [])
               if row.get("evaluation_sha256") == evaluation_sha]
    if len(current) != 1:
        raise ValueError("current evaluation is not uniquely represented in the cross-round portfolio")
    current_round = current[0]["round_id"]
    frontier_member = current_round in frontier.get("frontier_member_ids", [])
    candidate = frontier.get("e0_library_validation_candidate")
    if not isinstance(candidate, dict) or not isinstance(candidate.get("value"), bool):
        raise ValueError("frontier commercial-observation decision is malformed")
    e0_eligible = candidate["value"] and candidate.get("round_id") == current_round and frontier_member
    relation = evaluation["pairwise_relation"]["relation"]
    if relation not in LFR_RELATION_CODES:
        raise ValueError("current pairwise relation is incomplete")
    local = evaluation.get("local_portfolio", {}).get("augmented")
    if not isinstance(local, dict):
        raise ValueError("round evaluation has no validated F1 projection")
    functions = manifest["functions"]
    cumulative_cells = {cell for row in functions for cell in row["physicalCellNames"]}
    values = [
        number("proxy_boolean_equivalent", 1),
        number("proxy_interface_compatible", 1),
        number("proxy_generator_feasible", 1),
        number("proxy_local_level_delta", finite(local.get("levels_removed"), "F1 levels removed")),
        number("proxy_removed_node_count", finite(local.get("nodes_removed"), "F1 nodes removed")),
        number("proxy_cut_width", finite(local.get("cut_width_max"), "F1 cut width")),
        number("proxy_reconvergence_coverage",
               finite(local.get("reconvergence_coverage"), "F1 reconvergence") * 100.0, "percent"),
        *mapping_values(evaluation),
        number("new_library_cell_count", finite(local.get("new_library_cells"), "new Library Cells")),
        number("cumulative_library_cell_count", len(cumulative_cells)),
        number("proxy_metric_vector_complete", 1),
        number("proxy_pairwise_relation", LFR_RELATION_CODES[relation], "relation_code"),
        number("proxy_pairwise_relation_valid", 1),
        number("portfolio_frontier_membership", int(frontier_member)),
        number("e0_library_validation_candidate", int(e0_eligible)),
    ]
    return values


def values_for(record, workspace, stage):
    values = []
    if stage == "evaluation-baseline":
        evaluation = load(one(record, workspace, "library_richness_evaluation"))
        mapped_netlist = one(record, workspace, "baseline_mapped_netlist")
        timing_document = load(one(record, workspace, "baseline_proxy_reg2reg"))
        return baseline_evaluation_values(evaluation, mapped_netlist, timing_document)
    elif stage == "function-local-evaluation":
        portfolio = load(one(record, workspace, "function_local_evaluation"))
        return function_local_values(portfolio)
    elif stage == "design-mapping-timing-evaluation":
        evaluation = load(one(record, workspace, "library_richness_evaluation"))
        frontier_request = load(one(record, workspace, "portfolio_frontier_request"))
        frontier = load(one(record, workspace, "portfolio_frontier"))
        return design_evaluation_values(evaluation, frontier_request, frontier, workspace)
    elif stage == "freeze-cumulative-library":
        manifest = load(one(record, workspace, "cumulative_library_manifest"))
        return cumulative_library_values(manifest)
    elif stage.startswith("mine-"):
        raw = load(one(record, workspace, "mining_raw"))
        requests = raw.get("generation_requests")
        if not isinstance(requests, list):
            raise ValueError("mining raw has no generation_requests array")
        values.append(number("candidate_count", len(requests)))
    elif stage == "merge":
        merged = load(one(record, workspace, "merged_patterns"))
        requests = merged.get("generation_requests")
        if not isinstance(requests, list):
            raise ValueError("merged patterns has no generation_requests array")
        values.append(number("candidate_count", len(requests)))
    elif stage == "generate":
        attempts = load(one(record, workspace, "generation_attempts"))
        if not isinstance(attempts, list) or not attempts:
            raise ValueError("generation attempts are absent")
        artifacts = {ref["role"].split(":", 1)[1]: checked(ref, workspace)
                     for ref in record.get("artifacts", []) if str(ref.get("role", "")).startswith("generated_spice:")}
        count = 0
        for row in attempts:
            cell = row.get("cell_name")
            path = artifacts.get(cell)
            structural = path is not None and bool(re.search(r"(?mi)^\s*\.subckt\s+%s\b" % re.escape(cell), path.read_text(errors="replace")))
            if row.get("returncode") == 0 and row.get("structural") is True and structural:
                count += 1
        values.append(number("generated_cell_count", count))
    elif stage == "layout":
        attempts = load(one(record, workspace, "layout_attempts"))
        if (not isinstance(attempts, list) or not attempts
                or any(not isinstance(row, dict)
                       or set(row) != {"cell_name", "exit_code", "admitted", "diagnostic"}
                       for row in attempts)):
            raise ValueError("layout attempts are absent or malformed")
        names = [row["cell_name"] for row in attempts]
        if len(names) != len(set(names)) or any(not isinstance(name, str) or not name for name in names):
            raise ValueError("layout attempts repeat or omit a Cell identity")
        executions = record.get("executions")
        if (not isinstance(executions, list) or len(executions) != len(attempts)
                or any(execution.get("exitCode") != attempt["exit_code"]
                       for execution, attempt in zip(executions, attempts))):
            raise ValueError("layout attempt outcomes differ from executed tools")
        lefs = {str(ref.get("role")).split(":", 1)[1]: checked(ref, workspace)
                for ref in record.get("artifacts", []) if str(ref.get("role", "")).startswith("abstract_lef:")}
        metas = {str(ref.get("role")).split(":", 1)[1]: checked(ref, workspace)
                 for ref in record.get("artifacts", []) if str(ref.get("role", "")).startswith("abstract_metadata:")}
        admitted = {row["cell_name"] for row in attempts if row["admitted"] is True}
        refused = [row for row in attempts if row["admitted"] is not True]
        if (not admitted or set(lefs) != admitted or set(metas) != admitted
                or record.get("facts", {}).get("layout_attempt_count") != len(attempts)
                or record.get("facts", {}).get("abstract_cell_count") != len(admitted)
                or record.get("facts", {}).get("layout_refused_count") != len(refused)
                or record.get("facts", {}).get("layout_refusals") != refused):
            raise ValueError("abstract layout admission differs from attempts or held LEF/metadata")
        values.append(number("abstract_cell_count", len(lefs)))
        values.append(number("layout_refused_count", len(refused)))
    elif stage == "characterize":
        liberty = one(record, workspace, "generated_liberty").read_text(errors="replace")
        if "MODELLED, NOT MEASURED" not in liberty:
            raise ValueError("generated Liberty lacks predicted-not-measured provenance")
        actual = liberty_cells(liberty)
        patterns = load(one(record, workspace, "characterized_patterns"))
        expected = {job["cell_name"] for job in expected_generation_jobs(patterns)}
        if actual != expected or record.get("facts", {}).get("predicted_cell_count") != len(actual):
            raise ValueError("predicted Liberty differs from the layout-admitted candidate set")
        values.append(number("predicted_cell_count", len(actual)))
    elif stage == "compile":
        log = logs(record, workspace, "lc_log").read_text(errors="replace")
        db = one(record, workspace, "generated_db")
        markers = ("LC READ COMPLETE", "LC CHECK COMPLETE", "LC WRITE COMPLETE")
        if (not db.read_bytes() or re.search(r"^(?:Error|Fatal):", log, re.M | re.I)
                or any("=== CUSTOM_CELL_FMAX %s ===" % marker not in log for marker in markers)):
            raise ValueError("Library Compiler acceptance is not proved")
        values.append(number("lc_accepted", 1))
    elif stage in ("foundry-synth", "custom-synth"):
        arm = "base" if stage == "foundry-synth" else "custom"
        log = logs(record, workspace, arm + "-dc_log").read_text(errors="replace")
        checked_condition(record, workspace, derived_synth_condition(record, workspace, arm))
        hits = re.findall(r"=== CUSTOM_CELL_FMAX LIBRARY_VISIBLE_COUNT (\d+) ===", log)
        if len(hits) != 1 or "=== CUSTOM_CELL_FMAX SYNTHESIS_COMPLETE %s ===" % arm not in log:
            raise ValueError("synthesis session evidence is incomplete")
        values.append(number("library_visible", int(hits[0])))
        pressure = dc_target_pressure(one(record, workspace, "synthesis_reg2reg_timing_report"),
                                      str(record.get("facts", {}).get("design_top")))
        if (pressure["pathCount"] != record.get("facts", {}).get("reg2reg_path_count")
                or pressure["worstSlackNs"] != record.get("facts", {}).get("reg2reg_wns_ns")):
            raise ValueError("reg2reg pressure report differs from stage facts")
        values.extend([number("reg2reg_wns", pressure["worstSlackNs"], "ns", mode="setup", scope="reg2reg"),
                       number("reg2reg_path_count", pressure["pathCount"])])
    elif stage == "adoption":
        netlist = one(record, workspace, "custom_netlist", "inputs").read_text(errors="replace")
        liberty = one(record, workspace, "offered_library", "inputs").read_text(errors="replace")
        patterns = load(one(record, workspace, "characterized_patterns", "inputs"))
        log = one(record, workspace, "custom_synth_log", "inputs").read_text(errors="replace")
        visible = re.findall(r"=== CUSTOM_CELL_FMAX LIBRARY_VISIBLE_COUNT (\d+) ===", log)
        if len(visible) != 1 or int(visible[0]) <= 0:
            raise ValueError("adoption has no generated-library visibility proof")
        values.append(number("library_visible", int(visible[0])))
        adoption = project_attributed_texts(netlist, liberty, patterns)
        for key, value in adoption.items():
            if record.get("facts", {}).get(key) != value:
                raise ValueError("adoption attribution differs from held netlist/library/method evidence: " + key)
        values.append(number("adopted_instance_count", adoption["adopted_instance_count"]))
        values.append(number("adopted_candidate_count", adoption["adopted_candidate_count"]))
    elif stage in ("pnr-foundry", "pnr-generated"):
        arm = stage.split("-", 1)[1]
        log = logs(record, workspace, "pnr-" + arm + "_log").read_text(errors="replace")
        checked_condition(record, workspace, derived_pnr_condition(record, workspace, arm))
        init_links = checkpoint_allowed_links(record, workspace, arm, "init")
        postroute_links = checkpoint_allowed_links(record, workspace, arm, "postroute")
        validate_checkpoint(one(record, workspace, "init_checkpoint"), workspace, init_links, "init")
        validate_checkpoint(one(record, workspace, "postroute_checkpoint"),
                            workspace, postroute_links, "postroute")
        one(record, workspace, "postroute_gds")
        routed_netlist = one(record, workspace, "postroute_netlist").read_text(errors="replace")
        if not re.search(r"(?m)^\s*module\s+%s\b" % re.escape(str(record.get("facts", {}).get("design_top"))), routed_netlist):
            raise ValueError("post-route netlist has the wrong or missing design top")
        clock_rows = re.findall(
            r"(?m)^\s*([A-Za-z_][A-Za-z0-9_$]*)\s+(CTS_[A-Za-z0-9_$]+)\s*\(", routed_netlist)
        facts = record.get("facts", {})
        allowed_clock_cells = set((facts.get("clock_tree_buffer_cells") or [])
                                  + (facts.get("clock_tree_inverter_cells") or []))
        if (not clock_rows or facts.get("clock_tree_cell_count") != len(clock_rows)
                or facts.get("clock_tree_used_cells") != sorted({master for master, _ in clock_rows})
                or any(not str(cell).startswith("DCCK") for cell in allowed_clock_cells)
                or any(master not in allowed_clock_cells for master, _ in clock_rows)):
            raise ValueError("saved routed netlist does not prove an exclusively DCCK clock tree")
        actual_clock = sdc_period(one(record, workspace, "postroute_sdc"))
        mmmc = mmmc_identity(one(record, workspace, "mmmc_script:" + arm))
        input_sdc = Path(mmmc["sdc"]).resolve()
        if not input_sdc.is_file() or input_sdc.is_symlink() or sdc_period(input_sdc) != actual_clock:
            raise ValueError("actual post-route clock differs from the PnR input SDC")
        view, _wns, _violating = timing(one(record, workspace, "postroute_timing_summary"),
                                        one(record, workspace, "postroute_timing_paths"))
        _hold_view, hold_wns, hold_violating = timing(one(record, workspace, "postroute_hold_summary"),
                                                       one(record, workspace, "postroute_hold_paths"), mode="Hold")
        route_drc = drc_count(one(record, workspace, "route_drc_report"), 100000)
        connectivity = connectivity_count(one(record, workspace, "connectivity_report"))
        secondary = secondary_pnr(one(record, workspace, "postroute_power_report"),
                                  one(record, workspace, "postroute_gatecount_report"),
                                  one(record, workspace, "postroute_summary_report"))
        for key, actual in (("hold_wns_ns", hold_wns), ("hold_violating_paths", hold_violating),
                            ("route_drc_violations", route_drc), ("connectivity_violations", connectivity)):
            if facts.get(key) != actual:
                raise ValueError("PnR physical fact disagrees with retained report: " + key)
        for key, actual in secondary.items():
            if facts.get(key) != actual:
                raise ValueError("PnR secondary fact disagrees with retained report: " + key)
        if view != mmmc["view"]:
            raise ValueError("post-route timing companion names the wrong analysis view")
        if "=== CCFMAX PNR DONE %s (GDS written) ===" % arm not in log:
            raise ValueError("PnR completion marker is absent")
        values.extend([number("pnr_completed", 1), number("clock_tree_cell_count", len(clock_rows)),
                       number("hold_wns", hold_wns, "ns", mode="hold", scope="all"),
                       number("hold_violating_paths", hold_violating), number("route_drc_violations", route_drc),
                       number("connectivity_violations", connectivity), number("postroute_power", secondary["postroute_power_mw"], "mw"),
                       number("gate_count", secondary["gate_count"]), number("cell_count", secondary["cell_count"]),
                       number("postroute_cell_area", secondary["postroute_cell_area_um2"], "um2"),
                       number("route_instance_count", secondary["route_instance_count"]), number("route_density", secondary["route_density_pct"], "percent"),
                       unknown("congestion_overflow", "current Innovus summary has no verified congestion-overflow metric")])
    elif stage == "verify":
        diagnostic = 0
        for arm in ("foundry", "generated"):
            script = one(record, workspace, "verify_script:" + arm).read_text(errors="replace")
            limits = re.findall(r"verify_drc\s+-limit\s+(\d+)", script)
            modes = re.findall(r"set_verify_drc_mode\s+-check_only\s+(\S+)", script)
            if len(limits) != 1 or modes != ["cell"]:
                raise ValueError("verification script is not one explicit cell-only check")
            diagnostic += drc_count(one(record, workspace, "verify_drc_report:" + arm), int(limits[0]))
        facts = record.get("facts", {})
        if facts.get("verification_error_count") != 0 or facts.get("cell_checker_diagnostic_count") != diagnostic:
            raise ValueError("verification facts do not separate execution validity from cell-checker diagnostics")
        values.extend([number("verification_error_count", 0),
                       number("cell_checker_diagnostic_count", diagnostic)])
    elif stage == "compare":
        comparison = load(one(record, workspace, "comparison"))
        for key, value in comparison.items():
            if record.get("facts", {}).get(key) != value:
                raise ValueError("comparison artifact disagrees with stage facts: " + key)
        if record.get("facts", {}).get("full_constraint_failures") is None:
            if not isinstance(record.get("facts", {}).get("unknownReason"), list) or not record["facts"]["unknownReason"]:
                raise ValueError("unknown comparison has no reason")
            reason = "; ".join(record["facts"]["unknownReason"])
            return [
                unknown("clock_period", reason, "ns"),
                unknown("setup_wns", reason, "ns", mode="setup", scope="all"),
                unknown("foundry_setup_wns", reason, "ns", mode="setup", scope="all"),
                unknown("setup_wns_delta", reason, "ns", mode="setup", scope="all"),
                unknown("foundry_fmax_mhz", reason, "mhz"), unknown("generated_fmax_mhz", reason, "mhz"),
                unknown("fmax_delta_mhz", reason, "mhz"), unknown("fmax_improved", reason),
                unknown("matched_conditions", reason), unknown("library_visible", reason),
                unknown("adopted_instance_count", reason), unknown("verification_error_count", reason),
                unknown("cell_checker_diagnostic_count", reason), unknown("comparison_valid", reason),
                unknown("full_constraint_failures", reason),
            ]
        # Re-derive the final observations from raw references copied into the comparison record.
        fview, fwns, _fviolating = timing(one(record, workspace, "foundry_final_db_timing", "inputs"),
                                          one(record, workspace, "foundry_final_db_timing_paths", "inputs"))
        gview, gwns, gviolating = timing(one(record, workspace, "generated_final_db_timing", "inputs"),
                                         one(record, workspace, "generated_final_db_timing_paths", "inputs"))
        fsdc = one(record, workspace, "foundry_pnr_sdc", "inputs")
        gsdc = one(record, workspace, "generated_pnr_sdc", "inputs")
        foundry_actual_sdc = one(record, workspace, "foundry_postroute_sdc", "inputs")
        gactual_sdc = one(record, workspace, "generated_postroute_sdc", "inputs")
        fm = mmmc_identity(one(record, workspace, "foundry_mmmc", "inputs"))
        gm = mmmc_identity(one(record, workspace, "generated_mmmc", "inputs"))
        if Path(fm["sdc"]).resolve() != fsdc or Path(gm["sdc"]).resolve() != gsdc:
            raise ValueError("MMMC constraint mode does not bind the held arm SDC")
        input_sdc_matched = pnr_input_sdc_identity(fsdc) == pnr_input_sdc_identity(gsdc)
        clock = sdc_period(foundry_actual_sdc)
        if (clock != sdc_period(gactual_sdc) or clock != sdc_period(fsdc)
                or clock != sdc_period(gsdc) or fview != fm["view"] or gview != gm["view"]):
            raise ValueError("post-route analysis view or clock differs from MMMC/SDC evidence")
        foundry_init = one(record, workspace, "foundry_pnr_init_script", "inputs").read_text(errors="replace")
        generated_init = one(record, workspace, "generated_pnr_init_script", "inputs").read_text(errors="replace")
        foundry_route = one(record, workspace, "foundry_pnr_route_script", "inputs").read_text(errors="replace")
        generated_route = one(record, workspace, "generated_pnr_route_script", "inputs").read_text(errors="replace")
        foundry_synth = load(one(record, workspace, "source_stage_record:foundry-synth", "inputs"))
        custom_synth = load(one(record, workspace, "source_stage_record:custom-synth", "inputs"))
        foundry_synth_condition = checked_condition(
            foundry_synth, workspace, derived_synth_condition(foundry_synth, workspace, "base"))
        custom_synth_condition = checked_condition(
            custom_synth, workspace, derived_synth_condition(custom_synth, workspace, "custom"))
        foundry_pnr = load(one(record, workspace, "source_stage_record:pnr-foundry", "inputs"))
        generated_pnr = load(one(record, workspace, "source_stage_record:pnr-generated", "inputs"))
        physical_by_arm = {}
        for pnr_record, pnr_arm in ((foundry_pnr, "foundry"), (generated_pnr, "generated")):
            init_links = checkpoint_allowed_links(pnr_record, workspace, pnr_arm, "init")
            postroute_links = checkpoint_allowed_links(pnr_record, workspace, pnr_arm, "postroute")
            validate_checkpoint(one(pnr_record, workspace, "init_checkpoint"),
                                workspace, init_links, "init")
            validate_checkpoint(one(pnr_record, workspace, "postroute_checkpoint"),
                                workspace, postroute_links, "postroute")
            _hold_view, hold_wns, hold_violating = timing(one(pnr_record, workspace, "postroute_hold_summary"),
                                                          one(pnr_record, workspace, "postroute_hold_paths"), mode="Hold")
            physical = {"hold_wns_ns": hold_wns, "hold_violating_paths": hold_violating,
                        "route_drc_violations": drc_count(one(pnr_record, workspace, "route_drc_report"), 100000),
                        "connectivity_violations": connectivity_count(one(pnr_record, workspace, "connectivity_report"))}
            for key, actual in physical.items():
                if pnr_record.get("facts", {}).get(key) != actual:
                    raise ValueError("PnR physical fact disagrees with retained report: " + key)
            physical_by_arm[pnr_arm] = physical
        foundry_pnr_condition = checked_condition(
            foundry_pnr, workspace, derived_pnr_condition(foundry_pnr, workspace, "foundry"))
        generated_pnr_condition = checked_condition(
            generated_pnr, workspace, derived_pnr_condition(generated_pnr, workspace, "generated"))
        synth_match = foundry_synth_condition == custom_synth_condition
        if foundry_pnr_condition.get("floorplanUtilization") != generated_pnr_condition.get("floorplanUtilization"):
            raise ValueError("matched PnR arms use different floorplan utilizations")
        pnr_match = (foundry_pnr_condition == generated_pnr_condition
                     and input_sdc_matched
                     and fm["qrc"] == gm["qrc"] and fm["temperature"] == gm["temperature"])
        matched_derived = synth_match and pnr_match
        generated_verify_log = one(record, workspace, "generated_verify_log", "inputs").read_text(errors="replace")
        adopted_hits = re.findall(r"=== CUSTOM_CELL_FMAX FINAL_DB_INSTANCE_COUNT (\d+) ===", generated_verify_log)
        if len(adopted_hits) != 1:
            raise ValueError("final route database custom Cell census is missing")
        adopted = int(adopted_hits[0])
        cell_checker_diagnostics = 0
        for arm in ("foundry", "generated"):
            script = one(record, workspace, arm + "_verify_script", "inputs").read_text(errors="replace")
            limits = re.findall(r"verify_drc\s+-limit\s+(\d+)", script)
            modes = re.findall(r"set_verify_drc_mode\s+-check_only\s+(\S+)", script)
            if len(limits) != 1 or modes != ["cell"]:
                raise ValueError("comparison verification inputs are incomplete")
            cell_checker_diagnostics += drc_count(one(record, workspace, arm + "_verify_drc", "inputs"), int(limits[0]))
        verification_source = load(one(record, workspace, "source_stage_record:verify", "inputs"))
        errors = (verification_source.get("facts") or {}).get("verification_error_count")
        if errors != 0:
            raise ValueError("final database identity/timing verification did not complete cleanly")
        pnr_log = one(record, workspace, "generated_pnr_init_log", "inputs").read_text(errors="replace")
        verify_log = one(record, workspace, "generated_verify_log", "inputs").read_text(errors="replace")
        pv = re.findall(r"=== CCFMAX GENERATED_LIB_CELLS_AFTER_RESTORE (\d+) ===", pnr_log)
        vv = re.findall(r"=== CUSTOM_CELL_FMAX VERIFY_LIBRARY_VISIBLE (\d+) ===", verify_log)
        visible = len(pv) == len(vv) == 1 and int(pv[0]) > 0 and int(vv[0]) > 0
        foundry_closed = clock - fwns
        generated_closed = clock - gwns
        if foundry_closed <= 0 or generated_closed <= 0:
            raise ValueError("restored-database timing implies a nonpositive closed period")
        foundry_fmax = 1000.0 / foundry_closed
        generated_fmax = 1000.0 / generated_closed
        fmax_delta = generated_fmax - foundry_fmax
        fmax_improvement_pct = fmax_delta / foundry_fmax * 100.0
        fmax_improved = fmax_delta > 0
        facts = record.get("facts", {})
        for key, actual in (("setup_wns", gwns), ("foundry_setup_wns", fwns),
                            ("setup_wns_delta", gwns - fwns),
                            ("adopted_instance_count", adopted), ("verification_error_count", errors),
                            ("cell_checker_diagnostic_count", cell_checker_diagnostics),
                            ("foundry_fmax_mhz", foundry_fmax), ("generated_fmax_mhz", generated_fmax),
                            ("fmax_delta_mhz", fmax_delta), ("fmax_improved", fmax_improved),
                            ("fmax_improvement_pct", fmax_improvement_pct),
                            ("library_visible", visible)):
            if facts.get(key) != actual:
                raise ValueError("comparison claim %s disagrees with raw evidence" % key)
        matched = facts.get("matched_conditions")
        comparison_valid = matched_derived and visible and adopted > 0 and errors == 0
        failures = facts.get("full_constraint_failures")
        if (not isinstance(matched, bool) or matched != matched_derived or facts.get("clock_period") != clock
                or facts.get("comparison_valid") is not comparison_valid):
            raise ValueError("comparison lacks derived clock/matched-condition evidence")
        physical_failures = 0
        for pnr_arm in ("foundry", "generated"):
            physical = physical_by_arm[pnr_arm]
            physical_failures += int(physical["route_drc_violations"])
            physical_failures += int(physical["connectivity_violations"])
            physical_failures += int(physical["hold_violating_paths"])
            if float(physical["hold_wns_ns"]) < 0:
                physical_failures += 1
        expected = sum((not matched, gwns < 0 or gviolating > 0,
                        not visible, adopted <= 0, errors != 0, not fmax_improved)) + physical_failures
        if failures != expected:
            raise ValueError("full_constraint_failures disagrees with raw evidence")
        values.extend([
            number("clock_period", clock, "ns"),
            number("setup_wns", gwns, "ns", mode="setup", scope="all"),
            number("foundry_setup_wns", fwns, "ns", mode="setup", scope="all"),
            number("setup_wns_delta", gwns - fwns, "ns", mode="setup", scope="all"),
            number("foundry_fmax_mhz", foundry_fmax, "mhz"),
            number("generated_fmax_mhz", generated_fmax, "mhz"),
            number("fmax_delta_mhz", fmax_delta, "mhz"), number("fmax_improved", int(fmax_improved)),
            number("fmax_improvement_pct", fmax_improvement_pct, "percent"),
            number("matched_conditions", int(matched)), number("library_visible", int(visible)),
            number("adopted_instance_count", adopted), number("verification_error_count", errors),
            number("cell_checker_diagnostic_count", cell_checker_diagnostics),
            number("comparison_valid", int(comparison_valid)),
            number("full_constraint_failures", failures),
        ])
    else:
        raise ValueError("unsupported stage: " + stage)
    return values


def read_selection(report, out, stage):
    route_by_stage = {"select-" + route.replace("_", "-"): route for route in ROUTES}
    route = route_by_stage.get(stage)
    if route is None:
        raise ValueError("unknown selection reader stage: " + stage)
    workspace = report.parents[3]
    expected = workspace / "flow" / "mining" / route / "selected.json"
    if report != expected.resolve() or report.is_symlink() or not report.is_file():
        raise ValueError("selection report is outside the declared route path")
    load_domain(workspace)
    selection = load(report)
    if set(selection) != {"sourceSha256", "selected", "codeSha256"}:
        raise ValueError("selection has unexpected fields")
    raw_path = report.parent / "raw.json"
    raw_bytes = raw_path.read_bytes()
    if hashlib.sha256(raw_bytes).hexdigest() != selection["sourceSha256"]:
        raise ValueError("selection sourceSha256 does not match raw.json")
    mine = load(workspace / "flow" / "records" / ("mine-" + route + ".json"))
    if (mine.get("schema") != "custom-cell-fmax-stage/1" or mine.get("status") != "passed"
            or mine.get("stage") != "mine-" + route
            or selection["codeSha256"] != mine.get("facts", {}).get("codeSha256")):
        raise ValueError("selection codeSha256 does not match the executed miner")
    held_raw = one(mine, workspace, "mining_raw")
    if hashlib.sha256(held_raw.read_bytes()).hexdigest() != hashlib.sha256(raw_bytes).hexdigest():
        raise ValueError("selected raw.json differs from the immutable mine artifact")
    raw = json.loads(raw_bytes, object_pairs_hook=unique)
    requests = raw.get("generation_requests")
    selected = selection.get("selected")
    inputs = load(workspace / "flow" / "inputs.json")
    budget = inputs.get("MAX_CELLS")
    if isinstance(budget, bool) or not isinstance(budget, int) or not 1 <= budget <= 50:
        raise ValueError("MAX_CELLS must be within 1..50")
    if (raw.get("report_schema") != "xspace_cell-pattern-search/v2" or raw.get("strategy_id") != route
            or not isinstance(requests, list) or not isinstance(selected, list)
            or len(selected) > budget or len(selected) != len(set(selected))
            or any(not isinstance(value, str) for value in selected)):
        raise ValueError("selection identity/count is invalid")
    by_id = {row.get("candidate_id"): row for row in requests if isinstance(row, dict)}
    if len(by_id) != len(requests) or any(candidate not in by_id for candidate in selected):
        raise ValueError("selection ids are not a subset of the raw route")
    for candidate in selected:
        request = by_id[candidate]
        errors = validate_generation_request(request)
        if errors or (request.get("implementation_plan") or {}).get("route") not in BUILDABLE_ROUTES:
            raise ValueError("selection contains a non-buildable or invalid Boolean contract")
    out.write_text(json.dumps({"values": [number("selected_count", len(selected))]}, sort_keys=True) + "\n")


def read_mining_research(report, out, stage):
    prefix = "research-route-"
    route = stage[len(prefix):].replace("-", "_") if stage.startswith(prefix) else None
    if route not in ROUTES:
        raise ValueError("unknown mining research reader stage: " + stage)
    workspace = report.parents[3]
    expected = workspace / "flow" / "mining" / route / "research.json"
    if report != expected.resolve() or report.is_symlink() or not report.is_file():
        raise ValueError("mining research report is outside the declared route path")
    view = load(report)
    if set(view) != {"schema", "sourceSha256", "minerCodeSha256", "route", "candidates", "sourcePhase", "limitations"}:
        raise ValueError("mining research view has unexpected fields")
    raw_path = report.parent / "raw.json"
    record = load(workspace / "flow" / "records" / ("mine-" + route + ".json"))
    held = one(record, workspace, "mining_research_view")
    if (view.get("schema") != "custom-cell-fmax-mining-research-view/1" or view.get("route") != route
            or view.get("sourcePhase") not in ("dc-probe", "generated-postroute")
            or not isinstance(view.get("candidates"), list)
            or view.get("sourceSha256") != hashlib.sha256(raw_path.read_bytes()).hexdigest()
            or view.get("minerCodeSha256") != (record.get("facts") or {}).get("codeSha256")
            or hashlib.sha256(held.read_bytes()).hexdigest() != hashlib.sha256(report.read_bytes()).hexdigest()):
        raise ValueError("mining research view disagrees with its held raw/source record")
    out.write_text(json.dumps({"values": [number("candidate_count", len(view["candidates"]))]}, sort_keys=True) + "\n")


def read_residual_ai_research(report, out, document):
    workspace = report.parents[2]
    flow = workspace / "flow"
    if str(flow) not in sys.path:
        sys.path.insert(0, str(flow))
    from ai_research_runner import (  # type: ignore
        load_candidate_pool_registry, load_residual_research_context,
        validate_residual_research_proposal,
    )
    required = {"schema", "status", "round_id", "context_sha256", "evidence",
                "next_residual_question", "budgets", "research_lenses", "candidate_program",
                "candidate_proposals", "candidate_execution", "stop_reason", "claims", "output_sha256"}
    if set(document) != required or document.get("status") != "proposed":
        raise ValueError("residual AI research document has unexpected fields or status")
    canonical_payload_sha(document, "output_sha256")
    claims = document.get("claims")
    if (not isinstance(claims, dict) or any(value is not False for value in claims.values())):
        raise ValueError("residual AI research asserts a forbidden claim")
    root = flow / "library-richness"
    request = load(root / "research-context.json")
    context = load_residual_research_context(request, evidence_root=root)
    for field in ("round_id", "context_sha256", "evidence", "next_residual_question", "budgets"):
        if document.get(field) != context.get(field):
            raise ValueError("residual AI research differs from verified context: " + field)
    normalized = validate_residual_research_proposal({
        "research_lenses": document["research_lenses"],
        "candidate_program": document["candidate_program"],
        "stop_reason": document["stop_reason"],
    }, context)
    if any(normalized[key] != document[key] for key in normalized):
        raise ValueError("residual AI research proposal is not canonical")
    execution, proposals = document.get("candidate_execution"), document.get("candidate_proposals")
    if not isinstance(execution, dict) or not isinstance(proposals, list):
        raise ValueError("residual candidate execution/proposals are absent")
    input_payload = (json.dumps({"residual": context, "budget": context["budgets"]},
                                sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode()
    if (execution.get("program_sha256") != document["candidate_program"]["sha256"]
            or execution.get("input_sha256") != hashlib.sha256(input_payload).hexdigest()
            or execution.get("proposal_count") != len(proposals) or execution.get("return_code") != 0):
        raise ValueError("residual candidate execution identity is inconsistent")
    registry = load_candidate_pool_registry(workspace)
    detached, selected_keys = [], set()
    lens_names = {row["name"] for row in document["research_lenses"]}
    for row in proposals:
        if not isinstance(row, dict) or row.get("lens") not in lens_names or not isinstance(row.get("transformation"), dict):
            raise ValueError("residual candidate proposal is malformed")
        proposal_key = row["transformation"].get("proposal_key")
        if registry:
            if proposal_key not in registry or proposal_key in selected_keys:
                raise ValueError("residual proposal_key is unknown or repeated")
            selected_keys.add(proposal_key)
            generation = row.get("generation_request")
            raw = (json.dumps(generation, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode()
            if generation != registry[proposal_key] or row.get("generation_request_sha256") != hashlib.sha256(raw).hexdigest():
                raise ValueError("residual generation request identity is inconsistent")
        detached.append({key: row[key] for key in ("lens", "transformation", "rationale")})
    output_payload = (json.dumps(detached, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode()
    if execution.get("output_sha256") != hashlib.sha256(output_payload).hexdigest():
        raise ValueError("residual candidate output identity is inconsistent")
    retained = context.get("cumulative_library", {}).get("function_count")
    if isinstance(retained, bool) or not isinstance(retained, int) or retained < 0:
        raise ValueError("residual context has no cumulative Library function count")
    values = [number("research_hypothesis_count", len(document["research_lenses"])),
              number("selected_count", len(proposals)), number("retained_candidate_count", retained),
              unknown("theoretical_gain_upper_pct", "residual research does not estimate commercial gain", "percent")]
    out.write_text(json.dumps({"values": values}, sort_keys=True) + "\n")


def read_ai_research(report, out):
    workspace = report.parents[2]
    expected = workspace / "flow" / "research" / "research.json"
    if report != expected.resolve() or report.is_symlink() or not report.is_file():
        raise ValueError("AI research report is outside flow/research")
    load_domain(workspace)
    document = load(report)
    if document.get("schema") == "lfr-ai-residual-research/1":
        read_residual_ai_research(report, out, document)
        return
    if set(document) != {"schema", "target", "algorithm", "sources", "priorCandidateSource",
                         "retainedCandidates", "priorFeedback", "hypotheses", "selected",
                         "theoreticalEstimates", "stopReason", "limitations"}:
        raise ValueError("AI research report has unexpected fields")
    target, algorithm = document.get("target"), document.get("algorithm")
    if (document.get("schema") != "custom-cell-fmax-ai-research/1" or not isinstance(target, dict)
            or target.get("path_group") != "reg2reg" or not isinstance(target.get("design_top"), str)
            or target.get("source_phase") not in ("dc-probe", "generated-postroute")
            or not isinstance(target.get("reg2reg_wns_ns"), (int, float))
            or not isinstance(target.get("reg2reg_path_count"), int) or target["reg2reg_path_count"] <= 0
            or not isinstance(target.get("current_fmax_mhz"), (int, float)) or target["current_fmax_mhz"] <= 0
            or not isinstance(target.get("current_gain_pct"), (int, float))
            or not isinstance(target.get("target_gain_pct"), (int, float)) or not 0.1 <= target["target_gain_pct"] <= 25
            or not isinstance(target.get("baseline_fmax_mhz"), (int, float)) or target["baseline_fmax_mhz"] <= 0
            or not isinstance(target.get("target_fmax_mhz"), (int, float)) or target["target_fmax_mhz"] <= 0
            or not isinstance(target.get("required_incremental_fmax_gain_pct"), (int, float))
            or not isinstance(target.get("required_closed_period_reduction_ns"), (int, float))
            or not isinstance(algorithm, dict) or not re.fullmatch(r"[0-9a-f]{64}", str(algorithm.get("entrySha256") or ""))):
        raise ValueError("AI research target/algorithm identity is invalid")
    relative_entry = Path(str(algorithm.get("entryPath") or ""))
    entry = (workspace / relative_entry).resolve()
    execution_root = (workspace / "research" / "ai-discovery" / ".executions").resolve()
    if (relative_entry.is_absolute() or ".." in relative_entry.parts
            or not entry.is_relative_to(execution_root) or entry.name != "entry.py"
            or not entry.is_file() or entry.is_symlink()
            or hashlib.sha256(entry.read_bytes()).hexdigest() != algorithm["entrySha256"]):
        raise ValueError("AI research report does not match the executed Workshop entry")
    probe = load(workspace / "flow" / "probe.json")
    if target["design_top"] != ((probe.get("effectiveIdentity") or {}).get("inputs") or {}).get("designTop"):
        raise ValueError("AI research target differs from the probe")
    if target["source_phase"] == "generated-postroute":
        pnr = load(workspace / "flow" / "records" / "pnr-generated.json")
        compare = load(workspace / "flow" / "records" / "compare.json")
        with gzip.open(one(pnr, workspace, "postroute_timing_paths"), "rb") as source:
            timing_bytes = source.read()
        facts = compare.get("facts") or {}
        if (hashlib.sha256(timing_bytes).hexdigest() != target["timing_report_sha256"]
                or facts.get("comparison_valid") is not True
                or facts.get("generated_fmax_mhz") != target["current_fmax_mhz"]
                or facts.get("fmax_improvement_pct") != target["current_gain_pct"]):
            raise ValueError("AI research target differs from prior generated post-route evidence")
    else:
        current_fmax = 1000.0 / (float(probe["askedPeriodNs"]) - float(target["reg2reg_wns_ns"]))
        if target["current_gain_pct"] != 0.0 or not math.isclose(target["current_fmax_mhz"], current_fmax, rel_tol=0, abs_tol=1e-12):
            raise ValueError("initial AI research target differs from the DC probe")
    baseline_fmax = target["current_fmax_mhz"] / (1.0 + target["current_gain_pct"] / 100.0)
    target_fmax = baseline_fmax * (1.0 + target["target_gain_pct"] / 100.0)
    required_incremental = max(0.0, (target_fmax / target["current_fmax_mhz"] - 1.0) * 100.0)
    required_reduction = max(0.0, 1000.0 / target["current_fmax_mhz"] - 1000.0 / target_fmax)
    if (not math.isclose(target["baseline_fmax_mhz"], baseline_fmax, rel_tol=0, abs_tol=1e-12)
            or not math.isclose(target["target_fmax_mhz"], target_fmax, rel_tol=0, abs_tol=1e-12)
            or not math.isclose(target["required_incremental_fmax_gain_pct"], required_incremental, rel_tol=0, abs_tol=1e-12)
            or not math.isclose(target["required_closed_period_reduction_ns"], required_reduction, rel_tol=0, abs_tol=1e-12)):
        raise ValueError("AI research theoretical target arithmetic is not reproducible")
    hypotheses, selected, sources = document.get("hypotheses"), document.get("selected"), document.get("sources")
    inputs = load(workspace / "flow" / "inputs.json")
    budget = inputs.get("MAX_CELLS")
    if isinstance(budget, bool) or not isinstance(budget, int) or not 1 <= budget <= 50:
        raise ValueError("MAX_CELLS must be within 1..50")
    retained_ids = []
    retained_keys = set()
    expected_retained = []
    expected_prior_source = None
    adoption_path = workspace / "flow" / "records" / "adoption.json"
    characterize_path = workspace / "flow" / "records" / "characterize.json"
    if adoption_path.is_file() and characterize_path.is_file():
        adoption, characterize = load(adoption_path), load(characterize_path)
        if adoption.get("status") == "passed" and characterize.get("status") == "passed":
            patterns_path = one(characterize, workspace, "characterized_patterns")
            patterns = load(patterns_path)
            rows = (adoption.get("facts") or {}).get("candidate_rows")
            retained_ids = retained_candidate_ids(rows, budget)
            by_id = {row.get("candidate_id"): row for row in patterns.get("generation_requests", []) if isinstance(row, dict)}
            adopted = {row.get("candidate_id"): row for row in rows if isinstance(row, dict)}
            for candidate in retained_ids:
                request = by_id.get(candidate)
                if request is None:
                    raise ValueError("prior retained candidate is absent from characterized patterns")
                contract = request.get("generator_contract") or {}
                reference = contract.get("equivalence_reference") or {}
                retained_keys.add((reference.get("digest"), tuple(reference.get("output_order") or ()),
                                   json.dumps(contract.get("target_library_profile") or {}, sort_keys=True, separators=(",", ":"))))
                expected_retained.append({"generation_rank": adopted[candidate]["generation_rank"],
                                          "adopted_instance_count": adopted[candidate]["adopted_instance_count"],
                                          "source_methods": adopted[candidate]["source_methods"],
                                          "candidate_id": candidate})
            expected_prior_source = {
                "patternsSha256": hashlib.sha256(patterns_path.read_bytes()).hexdigest(),
                "adoptionRecordSha256": hashlib.sha256(adoption_path.read_bytes()).hexdigest(),
                "retainedCandidateIds": retained_ids,
            }
    if document.get("retainedCandidates") != expected_retained or document.get("priorCandidateSource") != expected_prior_source:
        raise ValueError("AI research retained-candidate evidence differs from prior adoption")
    if (not isinstance(hypotheses, list) or not 3 <= len(hypotheses) <= 12
            or not isinstance(selected, list) or not 0 <= len(selected) <= budget - len(retained_ids) <= 50
            or not isinstance(sources, dict) or set(sources) != set(ROUTES)):
        raise ValueError("AI research hypothesis/selection budget is invalid")
    names = {row.get("name") for row in hypotheses if isinstance(row, dict)}
    if len(names) != len(hypotheses) or None in names:
        raise ValueError("AI research hypotheses are not distinct")
    selected_keys = []
    for row in selected:
        if (not isinstance(row, dict) or set(row) != {"route", "candidate_id", "hypothesis", "rationale"}
                or row.get("route") not in ROUTES or row.get("hypothesis") not in names):
            raise ValueError("AI research selection is malformed")
        selected_keys.append((row["route"], row["candidate_id"]))
    if len(selected_keys) != len(set(selected_keys)):
        raise ValueError("AI research selection repeats a source candidate")
    distinct_pool = set()
    identities = {}
    source_requests = {}
    raw_candidate_count = 0
    for route in ROUTES:
        raw_path = workspace / "flow" / "mining" / route / "raw.json"
        record_path = workspace / "flow" / "records" / ("mine-" + route + ".json")
        raw, record = load(raw_path), load(record_path)
        source = sources[route]
        if (not isinstance(source, dict) or source.get("rawSha256") != hashlib.sha256(raw_path.read_bytes()).hexdigest()
                or source.get("recordSha256") != hashlib.sha256(record_path.read_bytes()).hexdigest()
                or source.get("minerCodeSha256") != (record.get("facts") or {}).get("codeSha256")):
            raise ValueError("AI research source identity changed for " + route)
        available = {row.get("candidate_id") for row in raw.get("generation_requests", []) if isinstance(row, dict)}
        for row in raw.get("generation_requests", []):
            if isinstance(row, dict) and (row.get("implementation_plan") or {}).get("route") in BUILDABLE_ROUTES:
                contract = row.get("generator_contract") or {}
                reference = contract.get("equivalence_reference") or {}
                key = (reference.get("digest"), tuple(reference.get("output_order") or ()),
                       json.dumps(contract.get("target_library_profile") or {}, sort_keys=True, separators=(",", ":")))
                if key[0]:
                    distinct_pool.add(key)
                    identities[(route, row.get("candidate_id"))] = key
                    source_requests[(route, row.get("candidate_id"))] = row
                    raw_candidate_count += 1
        if any(candidate not in available for selected_route, candidate in selected_keys if selected_route == route):
            raise ValueError("AI research selected an absent source candidate")
        projection = load(workspace / "flow" / "mining" / route / "selected.json")
        expected_ids = [candidate for selected_route, candidate in selected_keys if selected_route == route]
        if projection != {"sourceSha256": source["rawSha256"], "selected": expected_ids,
                          "codeSha256": source["minerCodeSha256"]}:
            raise ValueError("route selection projection differs from AI research for " + route)
    distinct_pool -= retained_keys
    selected_distinct = [identities.get(key) for key in selected_keys]
    if (None in selected_distinct or len(selected_distinct) != len(set(selected_distinct))
            or len(selected) != min(budget - len(retained_ids), len(distinct_pool))
            or algorithm.get("candidatePoolCount") != len(distinct_pool)
            or algorithm.get("rawCandidateCount") != raw_candidate_count):
        raise ValueError("AI research did not fill the one de-duplicated Cell screen")
    estimates = document.get("theoreticalEstimates")
    if not isinstance(estimates, list) or len(estimates) != len(selected):
        raise ValueError("AI research theoretical estimates do not cover the selected Cell set")
    for selected_row, estimate in zip(selected, estimates):
        request = source_requests[(selected_row["route"], selected_row["candidate_id"])]
        evidence = request.get("discovery_evidence") or {}
        occurrences = evidence.get("occurrences") or []
        increments = [float(row.get("reg2reg_increment_ns") or 0.0)
                      for row in occurrences if isinstance(row, dict)]
        root_saving = max(increments + [float(evidence.get("reg2reg_increment_ns") or 0.0)])
        cone_saving = float(evidence.get("reg2reg_cone_delay_upper_ns") or 0.0)
        saving = max(root_saving, cone_saving)
        path_ranks = sorted({int(rank) for row in occurrences if isinstance(row, dict)
                             for rank in (row.get("reg2reg_path_ranks") or [])
                             if isinstance(rank, int) and rank > 0})
        path_families = sorted({str(family) for row in occurrences if isinstance(row, dict)
                                for family in (row.get("reg2reg_path_family_ids") or [])
                                if isinstance(family, str) and family})
        if not path_families:
            path_families = sorted(str(value) for value in (evidence.get("reg2reg_path_family_ids") or [])
                                   if isinstance(value, str) and value)
        current_fmax = float(target["current_fmax_mhz"])
        closed = 1000.0 / current_fmax
        upper = None if saving <= 0 or saving >= closed else (1000.0 / (closed - saving) / current_fmax - 1.0) * 100.0
        expected_estimate = {
            "route": selected_row["route"], "candidate_id": selected_row["candidate_id"],
            "evidence_status": "path-delay upper bound" if upper is not None else "no explicit path-delay bound",
            "path_delay_basis": ("observed candidate-cone delay" if cone_saving > 0
                                 else "observed root Cell delay" if root_saving > 0 else None),
            "path_delay_removal_upper_ns": round(saving, 6) if saving > 0 else None,
            "incremental_fmax_gain_upper_pct": round(upper, 6) if upper is not None and math.isfinite(upper) else None,
            "covered_reg2reg_path_count": len(path_ranks), "covered_reg2reg_path_ranks": path_ranks,
            "covered_reg2reg_path_family_count": len(path_families),
            "covered_reg2reg_path_families": path_families,
            "covered_reg2reg_family_path_support": int(evidence.get("reg2reg_path_family_support") or 0),
            "worst_covered_path_slack_ns": evidence.get("reg2reg_worst_path_slack_ns"),
            "current_fmax_mhz": round(current_fmax, 6),
            "current_gain_pct": round(float(target["current_gain_pct"]), 6),
            "target_gain_pct": round(float(target["target_gain_pct"]), 6),
            "remaining_gain_pct": round(max(0.0, float(target["target_gain_pct"]) - float(target["current_gain_pct"])), 6),
            "required_incremental_fmax_gain_pct": round(required_incremental, 6),
            "meets_remaining_target_upper_bound": upper is not None and upper >= required_incremental,
            "limitations": "upper bound removes the full observed Cell-cone increment and does not model remapping, RC, path migration or overlap",
        }
        if estimate != expected_estimate:
            raise ValueError("AI research theoretical estimate differs from source timing evidence")
    upper_values = [row.get("incremental_fmax_gain_upper_pct") for row in estimates
                    if isinstance(row, dict) and isinstance(row.get("incremental_fmax_gain_upper_pct"), (int, float))]
    values = [number("research_hypothesis_count", len(hypotheses)), number("selected_count", len(selected)),
              number("retained_candidate_count", len(retained_ids))]
    values.append(number("theoretical_gain_upper_pct", max(upper_values), "percent") if upper_values
                  else unknown("theoretical_gain_upper_pct", "no selected candidate has explicit reg2reg path-delay evidence", "percent"))
    out.write_text(json.dumps({"values": values}, sort_keys=True) + "\n")


def main():
    if len(sys.argv) != 4:
        raise SystemExit("usage: read-stage.py REPORT OUT STAGE")
    report = Path(sys.argv[1]).resolve()
    out = Path(sys.argv[2])
    stage = sys.argv[3]
    if stage.startswith("select-"):
        read_selection(report, out, stage)
        return
    if stage.startswith("research-route-"):
        read_mining_research(report, out, stage)
        return
    if stage == "research-selection":
        read_ai_research(report, out)
        return
    workspace = report.parents[2]
    expected = workspace / "flow" / "records" / (stage + ".json")
    if report != expected.resolve() or report.is_symlink() or not report.is_file():
        raise ValueError("report path is not WORKSPACE/flow/records/STAGE.json")
    record = load(report)
    if record.get("schema") != "custom-cell-fmax-stage/1" or record.get("stage") != stage:
        raise ValueError("stage record identity mismatch")
    if record.get("status") != "passed":
        raise ValueError("stage is %s: %s" % (record.get("status"),
                                             record.get("facts", {}).get("rejected_reason")
                                             or record.get("facts", {}).get("tool_failure_reason")))
    load_domain(workspace)
    result = {"values": values_for(record, workspace, stage)}
    out.write_text(json.dumps(result, allow_nan=False, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
