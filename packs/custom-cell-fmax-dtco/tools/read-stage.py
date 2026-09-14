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


def load_domain(workspace):
    global validate_generation_request, project_texts
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
    validate_generation_request = validator
    project_texts = projector


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
    clean = bool(re.search(r"(?:no connectivity violations|0\s+connectivity violations)", text, re.I))
    if counts and len(set(counts)) == 1:
        return counts[0]
    if not counts and clean:
        return 0
    raise ValueError("connectivity report has no unambiguous violation total")


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
                path_one = re.search(r"^Path 1:.*?^= Slack Time\s+([0-9.eE+-]+)\s*$",
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
    return {
        "schema": "custom-cell-fmax-common-condition/1", "kind": "synthesis",
        "commonInputs": held_identities(record.get("inputs", []),
            exact=("FOUNDRY_DB", "shared_synth_template", "shared_synth_constraints", "EDA_WRAPPER"),
            prefixes=("rtl:",)),
        "entryContractSha256": hashlib.sha256(normalized_synth_entry(entry.read_text()).encode()).hexdigest(),
        "tool": dc_version(log.read_text(errors="replace")),
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
    floorplan = re.findall(r"(?m)^\s*floorPlan\s+-site\s+(\S+)\s+-r\s+1\.0\s+([0-9.]+)\s+2\.0\s+2\.0\s+2\.0\s+2\.0\s*$", init_text)
    if len(floorplan) != 1 or not (0.2 <= float(floorplan[0][1]) <= 0.8):
        raise ValueError("PnR init script lacks one declared Site/place utilization")
    place_site, utilization = floorplan[0]
    published = record.get("facts", {}).get("floorplan_utilization")
    if not isinstance(published, (int, float)) or float(published) != float(utilization):
        raise ValueError("PnR record utilization disagrees with generated init script")
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
        "placeSite": place_site,
        "armSpecificExclusions": ["generated_db", "generated_liberty", "generated_lef"],
    }


def checked_condition(record, workspace, derived):
    if load(one(record, workspace, "common_condition_identity")) != derived:
        raise ValueError("published common-condition identity disagrees with held evidence")
    return derived


def values_for(record, workspace, stage):
    values = []
    if stage.startswith("mine-"):
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
        lefs = [checked(ref, workspace) for ref in record.get("artifacts", [])
                if str(ref.get("role", "")).startswith("abstract_lef:")]
        metas = [checked(ref, workspace) for ref in record.get("artifacts", [])
                 if str(ref.get("role", "")).startswith("abstract_metadata:")]
        if not lefs or len(lefs) != len(metas):
            raise ValueError("abstract LEF/metadata coverage is incomplete")
        values.append(number("abstract_cell_count", len(lefs)))
    elif stage == "characterize":
        liberty = one(record, workspace, "generated_liberty").read_text(errors="replace")
        if "MODELLED, NOT MEASURED" not in liberty:
            raise ValueError("generated Liberty lacks predicted-not-measured provenance")
        values.append(number("predicted_cell_count", len(liberty_cells(liberty))))
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
    elif stage == "adoption":
        netlist = one(record, workspace, "custom_netlist", "inputs").read_text(errors="replace")
        liberty = one(record, workspace, "offered_library", "inputs").read_text(errors="replace")
        log = one(record, workspace, "custom_synth_log", "inputs").read_text(errors="replace")
        visible = re.findall(r"=== CUSTOM_CELL_FMAX LIBRARY_VISIBLE_COUNT (\d+) ===", log)
        if len(visible) != 1 or int(visible[0]) <= 0:
            raise ValueError("adoption has no generated-library visibility proof")
        values.append(number("library_visible", int(visible[0])))
        adoption = project_texts(netlist, liberty)
        values.append(number("adopted_instance_count", adoption["adopted_instance_count"]))
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
        facts = record.get("facts", {})
        for key, actual in (("hold_wns_ns", hold_wns), ("hold_violating_paths", hold_violating),
                            ("route_drc_violations", route_drc), ("connectivity_violations", connectivity)):
            if facts.get(key) != actual:
                raise ValueError("PnR physical fact disagrees with retained report: " + key)
        if view != mmmc["view"]:
            raise ValueError("post-route timing companion names the wrong analysis view")
        if "=== CCFMAX PNR DONE %s (GDS written) ===" % arm not in log:
            raise ValueError("PnR completion marker is absent")
        values.extend([number("pnr_completed", 1), number("hold_wns", hold_wns, "ns", mode="hold", scope="all"),
                       number("hold_violating_paths", hold_violating), number("route_drc_violations", route_drc),
                       number("connectivity_violations", connectivity)])
    elif stage == "verify":
        count = 0
        for arm in ("foundry", "generated"):
            script = one(record, workspace, "verify_script:" + arm).read_text(errors="replace")
            limits = re.findall(r"verify_drc\s+-limit\s+(\d+)", script)
            modes = re.findall(r"set_verify_drc_mode\s+-check_only\s+(\S+)", script)
            if len(limits) != 1 or modes != ["cell"]:
                raise ValueError("verification script is not one explicit cell-only check")
            count += drc_count(one(record, workspace, "verify_drc_report:" + arm), int(limits[0]))
        values.append(number("verification_error_count", count))
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
        errors = 0
        for arm in ("foundry", "generated"):
            script = one(record, workspace, arm + "_verify_script", "inputs").read_text(errors="replace")
            limits = re.findall(r"verify_drc\s+-limit\s+(\d+)", script)
            modes = re.findall(r"set_verify_drc_mode\s+-check_only\s+(\S+)", script)
            if len(limits) != 1 or modes != ["cell"]:
                raise ValueError("comparison verification inputs are incomplete")
            errors += drc_count(one(record, workspace, arm + "_verify_drc", "inputs"), int(limits[0]))
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
        fmax_improved = fmax_delta > 0
        facts = record.get("facts", {})
        for key, actual in (("setup_wns", gwns), ("foundry_setup_wns", fwns),
                            ("setup_wns_delta", gwns - fwns),
                            ("adopted_instance_count", adopted), ("verification_error_count", errors),
                            ("foundry_fmax_mhz", foundry_fmax), ("generated_fmax_mhz", generated_fmax),
                            ("fmax_delta_mhz", fmax_delta), ("fmax_improved", fmax_improved),
                            ("library_visible", visible)):
            if facts.get(key) != actual:
                raise ValueError("comparison claim %s disagrees with raw evidence" % key)
        matched = facts.get("matched_conditions")
        failures = facts.get("full_constraint_failures")
        if not isinstance(matched, bool) or matched != matched_derived or facts.get("clock_period") != clock:
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
            number("matched_conditions", int(matched)), number("library_visible", int(visible)),
            number("adopted_instance_count", adopted), number("verification_error_count", errors),
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
    if (raw.get("report_schema") != "xspace_cell-pattern-search/v2" or raw.get("strategy_id") != route
            or not isinstance(requests, list) or not isinstance(selected, list)
            or len(selected) > 2 or len(selected) != len(set(selected))
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


def main():
    if len(sys.argv) != 4:
        raise SystemExit("usage: read-stage.py REPORT OUT STAGE")
    report = Path(sys.argv[1]).resolve()
    out = Path(sys.argv[2])
    stage = sys.argv[3]
    if stage.startswith("select-"):
        read_selection(report, out, stage)
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
