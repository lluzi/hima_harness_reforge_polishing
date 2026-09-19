#!/usr/bin/env python3
"""Materialize one Campaign's Site bindings into its private flow/inputs.json.

The Pack carries this adapter. The Site supplies design, process and tool profiles as explicit
inputs; no pre-existing Golden Flow or legacy-shaped inputs.json is required.
"""
import argparse
import glob
import hashlib
import json
import math
import re
import shlex
from pathlib import Path


# Keep this aligned with graph.yml next-research.converge.generationLimit.  The
# cumulative Library is append-only, so readiness must cover every bounded
# generation before a Campaign starts rather than hard-blocking after hours of
# valid commercial work.
PACK_GENERATION_LIMIT = 8


def plain_json(path, label):
    at = Path(path).resolve()
    if not at.is_file() or at.is_symlink():
        raise ValueError(f"{label} is not one plain JSON file: {at}")
    value = json.loads(at.read_text())
    if not isinstance(value, dict) or any(not isinstance(key, str) or not key for key in value):
        raise ValueError(f"{label} must be one JSON object")
    return value


def plain_file(value, label):
    if not isinstance(value, str) or not value:
        raise ValueError(f"{label} must be a nonempty file path")
    at = Path(value).resolve()
    if not at.is_file() or at.is_symlink():
        raise ValueError(f"{label} must be one plain file: {at}")
    return str(at)


def plain_dir(value, label):
    if not isinstance(value, str) or not value:
        raise ValueError(f"{label} must be a nonempty directory path")
    at = Path(value).resolve()
    if not at.is_dir() or at.is_symlink():
        raise ValueError(f"{label} must be one plain directory: {at}")
    return str(at)


def executable_file(value, label):
    at = Path(plain_file(value, label))
    if not at.stat().st_mode & 0o111:
        raise ValueError(f"{label} must be executable: {at}")
    return str(at)


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def sha256_identity(value, path, label):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ValueError(f"{label} must be one lowercase SHA-256 digest")
    observed = sha256_file(path)
    if value != observed:
        raise ValueError(f"{label} does not match {path}: expected {value}, observed {observed}")
    return value


def string_list(value, label):
    if (not isinstance(value, list) or not value
            or any(not isinstance(item, str) or not item or "\n" in item or "\r" in item for item in value)):
        raise ValueError(f"{label} must be a nonempty array of one-line strings")
    return value


def text(value, label):
    if not isinstance(value, str) or not value.strip() or "\n" in value or "\r" in value:
        raise ValueError(f"{label} must be one nonempty line of text")
    return value


def positive_number(value, label, minimum=0.0):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= minimum:
        raise ValueError(f"{label} must be a finite number greater than {minimum:g}")
    return value


def positive_integer(value, label, minimum=0):
    if isinstance(value, bool) or not isinstance(value, int) or value <= minimum:
        raise ValueError(f"{label} must be an integer greater than {minimum}")
    return value


def clock_cell_list(value, label):
    """Return one normalized, explicitly clock-qualified CTS Cell list."""
    cells = text(value, label).split()
    if (not cells or len(cells) != len(set(cells))
            or any(not re.fullmatch(r"DCCK[A-Za-z0-9_$]*", cell) for cell in cells)):
        raise ValueError(f"{label} must contain distinct DCCK-prefixed library Cell names")
    return " ".join(cells)


def materialize_profile(document):
    """Validate every flat binding consumed by stages.py before writing inputs.json."""
    file_fields = (
        "FOUNDRY_LIB", "FOUNDRY_LEF", "FOUNDRY_QRC_TECH", "FOUNDRY_GDS", "TECH_LEF",
        "BOOL2CMOS_PDK_PROFILE", "LIBERTY_SKELETON", "LIBRECELL_TECH_PY", "GEOMETRY_RULE_DECK",
        "CHARMODEL_TIMING_MODEL", "CHARMODEL_POWER_MODEL", "CHARMODEL_AREA_MODEL", "CCFMAX_GDS_MAP",
        "EDA_WRAPPER", "CCFMAX_CONTAINER_RUNTIME",
    )
    directory_fields = ("BOOL2CMOS_CWD", "CCFMAX_CONTAINER_HOST_ROOT")
    line_fields = (
        "CLOCK_NAME", "BOOL2CMOS_CMD", "PROCESS_FAMILY", "CELL_ARCHITECTURE_REF",
        "CHARACTERIZATION_PROFILE_REF", "DRIVE_STRENGTH", "VT_CLASS", "CCFMAX_CONTAINER_IMAGE",
        "CCFMAX_CONTAINER_MOUNT_POINT", "CCFMAX_LCLAYOUT_ACTIVATE",
        "CCFMAX_POWER_PIN", "CCFMAX_GROUND_PIN", "CCFMAX_POWER_TEMPLATE_BASE_CELL",
        "GENERATED_LIBRARY_NAME", "GENERATED_LIB_CELL_PATTERN", "CCFMAX_MAX_ROUTE_LAYER",
        "CCFMAX_TAP_CELL", "CCFMAX_FILLER_CELLS", "PLACE_SITE",
        "CCFMAX_PG_HORIZONTAL_LAYER", "CCFMAX_PG_VERTICAL_LAYER",
    )
    positive_integer_fields = (
        "MAX_ROUTE_CANDIDATES", "GENERATION_TIMEOUT_SEC", "ABSTRACT_TIMEOUT_SEC",
        "CHARACTERIZE_TIMEOUT_SEC", "LC_TIMEOUT_SEC", "SYNTH_TIMEOUT_SEC", "MULTI_CPU",
        "CCFMAX_TAP_INTERVAL", "PNR_TIMEOUT_SEC", "DRC_LIMIT", "VERIFY_TIMEOUT_SEC",
        "LFR_PROXY_TIMEOUT_SEC", "LFR_PROXY_CPU_COUNT", "LFR_PROXY_MEMORY_MB",
    )
    for name in file_fields:
        document[name] = plain_file(document.get(name), name)
    if document.get("FOUNDRY_DB_FILE") not in (None, ""):
        document["FOUNDRY_DB_FILE"] = plain_file(document["FOUNDRY_DB_FILE"], "FOUNDRY_DB_FILE")
    for name in directory_fields:
        document[name] = plain_dir(document.get(name), name)
    for name in line_fields:
        document[name] = text(document.get(name), name)
    document["CCFMAX_CLOCK_BUFFER_CELLS"] = clock_cell_list(
        document.get("CCFMAX_CLOCK_BUFFER_CELLS"), "CCFMAX_CLOCK_BUFFER_CELLS")
    document["CCFMAX_CLOCK_INVERTER_CELLS"] = clock_cell_list(
        document.get("CCFMAX_CLOCK_INVERTER_CELLS"), "CCFMAX_CLOCK_INVERTER_CELLS")
    helpers = text(document.get("CCFMAX_CHARMODEL_HELPER_DIR"), "CCFMAX_CHARMODEL_HELPER_DIR")
    helper_dirs = helpers.split(":")
    if any(not item for item in helper_dirs):
        raise ValueError("CCFMAX_CHARMODEL_HELPER_DIR contains an empty directory entry")
    document["CCFMAX_CHARMODEL_HELPER_DIR"] = ":".join(plain_dir(item, "CCFMAX_CHARMODEL_HELPER_DIR") for item in helper_dirs)
    for module in ("estimate_lib.py", "mock_char.py"):
        matches = [Path(folder) / module for folder in helper_dirs if (Path(folder) / module).is_file()
                   and not (Path(folder) / module).is_symlink()]
        if len(matches) != 1:
            raise ValueError(f"CCFMAX_CHARMODEL_HELPER_DIR must resolve one plain {module}")
    try:
        if not shlex.split(document["BOOL2CMOS_CMD"]):
            raise ValueError
    except ValueError as exc:
        raise ValueError("BOOL2CMOS_CMD must be one parseable command") from exc
    timeout_floors = {
        "GENERATION_TIMEOUT_SEC": 3600,
        "ABSTRACT_TIMEOUT_SEC": 3600,
        "CHARACTERIZE_TIMEOUT_SEC": 3600,
        "LC_TIMEOUT_SEC": 3600,
        "SYNTH_TIMEOUT_SEC": 7200,
        "PNR_TIMEOUT_SEC": 14400,
        "VERIFY_TIMEOUT_SEC": 7200,
        "LFR_PROXY_TIMEOUT_SEC": 3600,
    }
    for name in positive_integer_fields:
        requested = positive_integer(document.get(name), name)
        if name in timeout_floors:
            document[f"{name}_REQUESTED"] = requested
            document[name] = max(requested, timeout_floors[name])
        else:
            document[name] = requested
    if document["MAX_ROUTE_CANDIDATES"] > 40:
        raise ValueError("MAX_ROUTE_CANDIDATES must be within 1..40")
    document["MAX_NEW_CELLS"] = positive_integer(
        document.get("MAX_NEW_CELLS"), "MAX_NEW_CELLS")
    if document["MAX_NEW_CELLS"] > 50:
        raise ValueError("MAX_NEW_CELLS must be within 1..50")
    document["MAX_CELLS"] = positive_integer(document.get("MAX_CELLS"), "MAX_CELLS")
    if document["MAX_NEW_CELLS"] > document["MAX_CELLS"]:
        raise ValueError("MAX_NEW_CELLS cannot exceed the MAX_CELLS cumulative Library cap")
    minimum_cumulative_capacity = document["MAX_NEW_CELLS"] * PACK_GENERATION_LIMIT
    if document["MAX_CELLS"] < minimum_cumulative_capacity:
        raise ValueError(
            "MAX_CELLS must be at least %d for the Pack's %d-generation append-only Library budget"
            % (minimum_cumulative_capacity, PACK_GENERATION_LIMIT))
    for name in ("LFR_YOSYS_BIN", "LFR_ABC_BIN"):
        document[name] = executable_file(document.get(name), name)
    for name in ("LFR_YOSYS", "LFR_ABC"):
        document[f"{name}_SHA256"] = sha256_identity(
            document.get(f"{name}_SHA256"), document[f"{name}_BIN"], f"{name}_SHA256")
        document[f"{name}_COMMIT"] = text(document.get(f"{name}_COMMIT"), f"{name}_COMMIT")
        document[f"{name}_BUILD_FLAGS"] = string_list(
            document.get(f"{name}_BUILD_FLAGS"), f"{name}_BUILD_FLAGS")
    container_digest = text(document.get("LFR_PROXY_CONTAINER_DIGEST"), "LFR_PROXY_CONTAINER_DIGEST")
    if not (container_digest.startswith("sha256:") or container_digest.startswith("host:")):
        raise ValueError("LFR_PROXY_CONTAINER_DIGEST must start with sha256: or host:")
    document["LFR_PROXY_CONTAINER_DIGEST"] = container_digest
    document["CLOCK_NS"] = positive_number(document.get("CLOCK_NS"), "CLOCK_NS")
    document["CCFMAX_RC_TEMPERATURE"] = positive_number(document.get("CCFMAX_RC_TEMPERATURE"), "CCFMAX_RC_TEMPERATURE", -273.15)
    document["CCFMAX_PROCESS_NODE"] = positive_number(document.get("CCFMAX_PROCESS_NODE"), "CCFMAX_PROCESS_NODE")
    for name in (
        "CCFMAX_PG_RING_WIDTH_UM", "CCFMAX_PG_RING_SPACING_UM",
        "CCFMAX_PG_STRIPE_WIDTH_UM", "CCFMAX_PG_STRIPE_SPACING_UM",
        "CCFMAX_PG_STRIPE_SET_DISTANCE_UM", "CCFMAX_PG_STRIPE_START_OFFSET_UM",
    ):
        document[name] = positive_number(document.get(name), name)
    document["CCFMAX_MAX_EFFECTIVE_DENSITY"] = positive_number(
        document.get("CCFMAX_MAX_EFFECTIVE_DENSITY"), "CCFMAX_MAX_EFFECTIVE_DENSITY")
    if document["CCFMAX_MAX_EFFECTIVE_DENSITY"] > 0.85:
        raise ValueError("CCFMAX_MAX_EFFECTIVE_DENSITY must not exceed 0.85")
    document["CCFMAX_SWITCHING_ACTIVITY"] = document.get("CCFMAX_SWITCHING_ACTIVITY")
    if (isinstance(document["CCFMAX_SWITCHING_ACTIVITY"], bool)
            or not isinstance(document["CCFMAX_SWITCHING_ACTIVITY"], (int, float))
            or not math.isfinite(document["CCFMAX_SWITCHING_ACTIVITY"])
            or not 0 <= document["CCFMAX_SWITCHING_ACTIVITY"] <= 1):
        raise ValueError("CCFMAX_SWITCHING_ACTIVITY must be a finite fraction in [0, 1]")
    return document


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workspace", required=True)
    ap.add_argument("--design-root", required=True)
    ap.add_argument("--rtl-glob", required=True)
    ap.add_argument("--design-top", required=True)
    ap.add_argument("--constraints", required=True)
    ap.add_argument("--foundry-library", required=True)
    ap.add_argument("--physical-inputs", required=True)
    ap.add_argument("--tool-stack", required=True)
    ns = ap.parse_args()
    workspace = Path(ns.workspace).resolve()
    flow = workspace / "flow"
    design_root = Path(ns.design_root).resolve()
    constraints = Path(ns.constraints).resolve()
    foundry_library = Path(ns.foundry_library).resolve()
    rtl = sorted(Path(item).resolve() for item in glob.glob(ns.rtl_glob))
    if not design_root.is_dir() or not rtl or any(not item.is_file() or item.is_symlink() or not item.is_relative_to(design_root) for item in rtl):
        raise ValueError("rtlGlob must resolve to plain files within designRoot")
    if not constraints.is_file() or constraints.is_symlink() or not foundry_library.is_file() or foundry_library.is_symlink():
        raise ValueError("constraints and foundryLibrary must be plain files")
    # A Site may stage the compiled foundry DB separately from the Liberty text. DC cannot read
    # Liberty, and the licence-free mining/characterize stages cannot read a binary DB, so one
    # path cannot serve both: FOUNDRY_DB_FILE names the DB when the Site has one, and falls back
    # to the legacy single-path derivation otherwise.
    physical = plain_json(ns.physical_inputs, "physicalInputs")
    tools = plain_json(ns.tool_stack, "toolStack")
    if physical.get("FOUNDRY_DB_FILE") not in (None, ""):
        foundry_db = Path(plain_file(physical["FOUNDRY_DB_FILE"], "FOUNDRY_DB_FILE"))
    else:
        foundry_db = foundry_library
    overlap = set(physical) & set(tools)
    if overlap:
        raise ValueError("physicalInputs and toolStack redefine: " + ", ".join(sorted(overlap)))
    if not isinstance(ns.design_top, str) or not ns.design_top.strip() or "\n" in ns.design_top or "\r" in ns.design_top:
        raise ValueError("designTop must be one nonempty line")
    primary = {
        "designRoot": str(design_root),
        "designTop": ns.design_top,
        "rtlGlob": ns.rtl_glob,
        "foundryDb": str(foundry_db),
        "constraintsTcl": str(constraints),
        "clockName": physical.get("CLOCK_NAME"),
        "edaWrapper": tools.get("EDA_WRAPPER"),
        "evidenceClass": "site-run",
        "DESIGN_TOP": ns.design_top,
        "DESIGN_ROOT": str(design_root),
        "DESIGN_RTL_GLOB": ns.rtl_glob,
        "FOUNDRY_DB": str(foundry_db),
        "CONSTRAINTS_FILE": str(constraints),
    }
    if not isinstance(primary["clockName"], str) or not primary["clockName"]:
        raise ValueError("physicalInputs must declare CLOCK_NAME")
    if not isinstance(primary["edaWrapper"], str) or not primary["edaWrapper"]:
        raise ValueError("toolStack must declare EDA_WRAPPER")
    collision = (set(primary) & set(physical)) | (set(primary) & set(tools))
    if collision:
        raise ValueError("Site profiles redefine Campaign identity: " + ", ".join(sorted(collision)))
    document = {**physical, **tools, **primary}
    materialize_profile(document)
    # These are Campaign-private products of the existing Framework. They are
    # fixed by the Pack instead of becoming Site questions or customer inputs.
    lfr_root = flow / "library-richness"
    document.update({
        "LFR_MAPPING_PROFILE": "lfr-yosys-abc-deterministic/1",
        "LFR_PROXY_STA_PROFILE": "lfr-round-evaluation/3:proxy-sta",
        "LFR_LOCAL_PORTFOLIO": str(lfr_root / "local-portfolio.json"),
        "LFR_CANDIDATE_POOL": str(lfr_root / "candidate-pool.json"),
        "LFR_CUMULATIVE_LIBRARY_MANIFEST": str(flow / "library" / "cumulative-manifest.json"),
    })
    target = flow / "inputs.json"
    if target.exists():
        raise ValueError(f"Campaign inputs already exist and are never overwritten: {target}")
    target.write_text(json.dumps(document, sort_keys=True, indent=2) + "\n")
    print(json.dumps({"inputs": str(target), "designTop": ns.design_top, "rtlFiles": len(rtl)}))


if __name__ == "__main__":
    main()
