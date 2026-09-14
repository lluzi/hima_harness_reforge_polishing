#!/usr/bin/env python3
"""Materialize one Campaign's Site bindings into its private flow/inputs.json.

The Pack carries this adapter. The Site supplies design, process and tool profiles as explicit
inputs; no pre-existing Golden Flow or legacy-shaped inputs.json is required.
"""
import argparse
import glob
import json
import math
import shlex
from pathlib import Path


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
    )
    positive_integer_fields = (
        "MAX_ROUTE_CANDIDATES", "GENERATION_TIMEOUT_SEC", "ABSTRACT_TIMEOUT_SEC",
        "CHARACTERIZE_TIMEOUT_SEC", "LC_TIMEOUT_SEC", "SYNTH_TIMEOUT_SEC", "MULTI_CPU",
        "CCFMAX_TAP_INTERVAL", "PNR_TIMEOUT_SEC", "DRC_LIMIT", "VERIFY_TIMEOUT_SEC",
    )
    for name in file_fields:
        document[name] = plain_file(document.get(name), name)
    for name in directory_fields:
        document[name] = plain_dir(document.get(name), name)
    for name in line_fields:
        document[name] = text(document.get(name), name)
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
    for name in positive_integer_fields:
        document[name] = positive_integer(document.get(name), name)
    document["MAX_CELLS"] = positive_integer(document.get("MAX_CELLS"), "MAX_CELLS")
    if document["MAX_CELLS"] not in (1, 2):
        raise ValueError("MAX_CELLS must be the bounded-pilot value 1 or 2")
    document["CLOCK_NS"] = positive_number(document.get("CLOCK_NS"), "CLOCK_NS")
    document["CCFMAX_RC_TEMPERATURE"] = positive_number(document.get("CCFMAX_RC_TEMPERATURE"), "CCFMAX_RC_TEMPERATURE", -273.15)
    document["CCFMAX_PROCESS_NODE"] = positive_number(document.get("CCFMAX_PROCESS_NODE"), "CCFMAX_PROCESS_NODE")
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
    foundry_db = Path(ns.foundry_library).resolve()
    rtl = sorted(Path(item).resolve() for item in glob.glob(ns.rtl_glob))
    if not design_root.is_dir() or not rtl or any(not item.is_file() or item.is_symlink() or not item.is_relative_to(design_root) for item in rtl):
        raise ValueError("rtlGlob must resolve to plain files within designRoot")
    if not constraints.is_file() or constraints.is_symlink() or not foundry_db.is_file() or foundry_db.is_symlink():
        raise ValueError("constraints and foundryLibrary must be plain files")
    physical = plain_json(ns.physical_inputs, "physicalInputs")
    tools = plain_json(ns.tool_stack, "toolStack")
    overlap = set(physical) & set(tools)
    if overlap:
        raise ValueError("physicalInputs and toolStack redefine: " + ", ".join(sorted(overlap)))
    if not isinstance(ns.design_top, str) or not ns.design_top.strip() or "\n" in ns.design_top or "\r" in ns.design_top:
        raise ValueError("designTop must be one nonempty line")
    primary = {
        "designTop": ns.design_top,
        "rtlGlob": ns.rtl_glob,
        "foundryDb": str(foundry_db),
        "constraintsTcl": str(constraints),
        "clockName": physical.get("CLOCK_NAME"),
        "edaWrapper": tools.get("EDA_WRAPPER"),
        "evidenceClass": "site-run",
        "DESIGN_TOP": ns.design_top,
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
    target = flow / "inputs.json"
    if target.exists():
        raise ValueError(f"Campaign inputs already exist and are never overwritten: {target}")
    target.write_text(json.dumps(document, sort_keys=True, indent=2) + "\n")
    print(json.dumps({"inputs": str(target), "designTop": ns.design_top, "rtlFiles": len(rtl)}))


if __name__ == "__main__":
    main()
