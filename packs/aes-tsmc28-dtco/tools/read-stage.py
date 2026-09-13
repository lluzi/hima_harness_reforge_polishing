#!/usr/bin/env python3
"""Read one PLS-25 stage record and re-derive numeric Hima observations."""
from __future__ import annotations

import hashlib
import json
import math
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


def timing(path):
    text = path.read_text(errors="replace")
    header = None
    for line in text.splitlines():
        if "|" not in line:
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) >= 2 and cells[1] in ("all", "reg2reg", "default"):
            header = cells[1:]
            break
    views = re.findall(r"Setup views included:\s*\n\s*([^\s]+)", text)
    if not header or "all" not in header or len(views) != 1:
        raise ValueError("post-route timing lacks one view and all-mode table")
    for line in text.splitlines():
        if "|" in line and "WNS (ns)" in line:
            cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
            value = float(cells[header.index("all") + 1])
            if math.isfinite(value):
                return views[0], value
    raise ValueError("post-route timing has no finite setup/all WNS")


def sdc_period(path):
    values = [float(value) for value in re.findall(
        r"\bcreate_clock\b[^\n]*\s-period\s+([0-9.eE+-]+)", path.read_text(errors="replace"))]
    if not values or len(set(values)) != 1 or values[0] <= 0:
        raise ValueError("PnR-bound SDC has no single positive clock period")
    return values[0]


def mmmc_identity(path):
    text = path.read_text(errors="replace")
    mode = re.findall(r"create_constraint_mode\s+-name\s+(\S+)\s+-sdc_files\s+\[list\s+([^\]]+)\]", text)
    view = re.findall(r"create_analysis_view\s+-name\s+(\S+)\s+-constraint_mode\s+(\S+)\s+-delay_corner\s+(\S+)", text)
    active = re.findall(r"set_analysis_view\s+-setup\s+\{([^}]+)\}\s+-hold\s+\{([^}]+)\}", text)
    qrc = re.findall(r"create_rc_corner\b[^\n]*-qx_tech_file\s+(\S+)\s+-temperature\s+(\S+)", text)
    if not all(len(rows) == 1 for rows in (mode, view, active, qrc)):
        raise ValueError("MMMC evidence does not declare one analysis view")
    return {"sdc": mode[0][1].strip(), "view": view[0][0], "active": active[0][0],
            "qrc": qrc[0][0], "temperature": qrc[0][1]}


def dc_version(text):
    hits = re.findall(r"^Version\s+(\S+)\s+for\s+(\S+)(?:\s+.*)?$", text, re.M)
    if len(hits) != 1:
        raise ValueError("DC log has no unambiguous supported Version header")
    return {"version": hits[0][0], "platform": hits[0][1]}


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
        if "::env(XS28_CUSTOM_DB)" in line or "::env(XS28_ARM)" in line:
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
        "schema": "aes-dtco-common-condition/1", "kind": "synthesis",
        "commonInputs": held_identities(record.get("inputs", []),
            exact=("FOUNDRY_DB", "shared_synth_template", "shared_synth_constraints", "EDA_WRAPPER"),
            prefixes=("rtl:",)),
        "entryContractSha256": hashlib.sha256(normalized_synth_entry(entry.read_text()).encode()).hexdigest(),
        "tool": dc_version(log.read_text(errors="replace")),
        "armSpecificExclusions": ["XS28_ARM", "XS28_CUSTOM_DB", "generated_db"],
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
    return {
        "schema": "aes-dtco-common-condition/1", "kind": "place-and-route",
        "commonInputs": held_identities(record.get("inputs", []), exact=(
            "TECH_LEF", "FOUNDRY_LEF", "FOUNDRY_LIB", "FOUNDRY_QRC_TECH",
            "FOUNDRY_GDS", "XS28_GDS_MAP", "EDA_WRAPPER",
            "pnr_method_template:init.tcl.tmpl", "pnr_method_template:mmmc.tcl.tmpl",
            "pnr_method_template:pnr.tcl.tmpl")),
        "scriptContractSha256": hashlib.sha256("\n".join(
            normalized_arm_script(scripts[kind].read_text(), excluded) for kind in ("mmmc", "init", "pnr")
        ).encode()).hexdigest(),
        "tool": init_tool,
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
                or any("=== AES_DTCO %s ===" % marker not in log for marker in markers)):
            raise ValueError("Library Compiler acceptance is not proved")
        values.append(number("lc_accepted", 1))
    elif stage in ("foundry-synth", "custom-synth"):
        arm = "base" if stage == "foundry-synth" else "custom"
        log = logs(record, workspace, arm + "-dc_log").read_text(errors="replace")
        checked_condition(record, workspace, derived_synth_condition(record, workspace, arm))
        hits = re.findall(r"=== AES_DTCO LIBRARY_VISIBLE_COUNT (\d+) ===", log)
        if len(hits) != 1 or "=== AES_DTCO SYNTHESIS_COMPLETE %s ===" % arm not in log:
            raise ValueError("synthesis session evidence is incomplete")
        values.append(number("library_visible", int(hits[0])))
    elif stage == "adoption":
        netlist = one(record, workspace, "custom_netlist", "inputs").read_text(errors="replace")
        liberty = one(record, workspace, "offered_library", "inputs").read_text(errors="replace")
        log = one(record, workspace, "custom_synth_log", "inputs").read_text(errors="replace")
        visible = re.findall(r"=== AES_DTCO LIBRARY_VISIBLE_COUNT (\d+) ===", log)
        if len(visible) != 1 or int(visible[0]) <= 0:
            raise ValueError("adoption has no generated-library visibility proof")
        values.append(number("library_visible", int(visible[0])))
        adoption = project_texts(netlist, liberty)
        values.append(number("adopted_instance_count", adoption["adopted_instance_count"]))
    elif stage in ("pnr-foundry", "pnr-generated"):
        arm = stage.split("-", 1)[1]
        log = logs(record, workspace, "pnr-" + arm + "_log").read_text(errors="replace")
        checked_condition(record, workspace, derived_pnr_condition(record, workspace, arm))
        one(record, workspace, "postroute_db")
        one(record, workspace, "postroute_gds")
        actual_clock = sdc_period(one(record, workspace, "postroute_sdc"))
        mmmc = mmmc_identity(one(record, workspace, "mmmc_script:" + arm))
        input_sdc = Path(mmmc["sdc"]).resolve()
        if not input_sdc.is_file() or input_sdc.is_symlink() or sdc_period(input_sdc) != actual_clock:
            raise ValueError("actual post-route clock differs from the PnR input SDC")
        timing(one(record, workspace, "postroute_timing_summary"))
        if "=== XS28 PNR DONE %s (GDS written) ===" % arm not in log:
            raise ValueError("PnR completion marker is absent")
        values.append(number("pnr_completed", 1))
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
                unknown("matched_conditions", reason), unknown("library_visible", reason),
                unknown("adopted_instance_count", reason), unknown("verification_error_count", reason),
                unknown("full_constraint_failures", reason),
            ]
        # Re-derive the final observations from raw references copied into the comparison record.
        fview, fwns = timing(one(record, workspace, "foundry_postroute_timing", "inputs"))
        gview, gwns = timing(one(record, workspace, "generated_postroute_timing", "inputs"))
        fsdc = one(record, workspace, "foundry_pnr_sdc", "inputs")
        gsdc = one(record, workspace, "generated_pnr_sdc", "inputs")
        foundry_actual_sdc = one(record, workspace, "foundry_postroute_sdc", "inputs")
        gactual_sdc = one(record, workspace, "generated_postroute_sdc", "inputs")
        fm = mmmc_identity(one(record, workspace, "foundry_mmmc", "inputs"))
        gm = mmmc_identity(one(record, workspace, "generated_mmmc", "inputs"))
        if Path(fm["sdc"]).resolve() != fsdc or Path(gm["sdc"]).resolve() != gsdc:
            raise ValueError("MMMC constraint mode does not bind the held arm SDC")
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
        foundry_pnr_condition = checked_condition(
            foundry_pnr, workspace, derived_pnr_condition(foundry_pnr, workspace, "foundry"))
        generated_pnr_condition = checked_condition(
            generated_pnr, workspace, derived_pnr_condition(generated_pnr, workspace, "generated"))
        synth_match = foundry_synth_condition == custom_synth_condition
        pnr_match = (foundry_pnr_condition == generated_pnr_condition
                     and fm["qrc"] == gm["qrc"] and fm["temperature"] == gm["temperature"])
        matched_derived = synth_match and pnr_match
        netlist = one(record, workspace, "custom_netlist", "inputs").read_text(errors="replace")
        liberty = one(record, workspace, "offered_library", "inputs").read_text(errors="replace")
        adopted = project_texts(netlist, liberty)["adopted_instance_count"]
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
        pv = re.findall(r"=== XS28 GENERATED_LIB_CELLS_AFTER_RESTORE (\d+) ===", pnr_log)
        vv = re.findall(r"=== AES_DTCO VERIFY_LIBRARY_VISIBLE (\d+) ===", verify_log)
        visible = len(pv) == len(vv) == 1 and int(pv[0]) > 0 and int(vv[0]) > 0
        facts = record.get("facts", {})
        for key, actual in (("setup_wns", gwns), ("foundry_setup_wns", fwns),
                            ("setup_wns_delta", gwns - fwns),
                            ("adopted_instance_count", adopted), ("verification_error_count", errors),
                            ("library_visible", visible)):
            if facts.get(key) != actual:
                raise ValueError("comparison claim %s disagrees with raw evidence" % key)
        matched = facts.get("matched_conditions")
        failures = facts.get("full_constraint_failures")
        if not isinstance(matched, bool) or matched != matched_derived or facts.get("clock_period") != clock:
            raise ValueError("comparison lacks derived clock/matched-condition evidence")
        expected = sum((not matched, gwns < 0, not visible, adopted <= 0, errors != 0))
        if failures != expected:
            raise ValueError("full_constraint_failures disagrees with raw evidence")
        values.extend([
            number("clock_period", clock, "ns"),
            number("setup_wns", gwns, "ns", mode="setup", scope="all"),
            number("foundry_setup_wns", fwns, "ns", mode="setup", scope="all"),
            number("setup_wns_delta", gwns - fwns, "ns", mode="setup", scope="all"),
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
    if (mine.get("schema") != "aes-dtco-stage/1" or mine.get("status") != "passed"
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
    if record.get("schema") != "aes-dtco-stage/1" or record.get("stage") != stage:
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
