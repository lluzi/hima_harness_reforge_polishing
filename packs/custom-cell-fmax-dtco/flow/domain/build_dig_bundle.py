#!/usr/bin/env python3
"""Publish an Innovus export directory only after identity checks and hashing."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from design_information_graph import file_sha256, validate_bundle
from dig_store import sha256_json


ROLE_FILES = {
    "netlist": "design.v",
    "def": "design.def",
    "sdc": "constraints.sdc",
    "spef": "parasitics.spef",
    "census": "census.tsv",
    "checkpoint_facts": "checkpoint-facts.tsv",
    "tool_version": "tool-version.txt",
    "timing_facts": "timing-facts.json",
    "clock_facts": "clock-facts.json",
    "setup_endpoint_index": "setup-endpoints.tsv",
    "endpoint_worst_setup_report": "endpoint-worst-setup.rpt",
    "active_frontier": "active-frontier.json",
}


def _facts(path):
    values = {}
    for line in path.read_text(errors="replace").splitlines():
        fields = line.split("\t")
        if len(fields) >= 2:
            values[fields[0]] = "\t".join(fields[1:])
    return values


def publish_bundle(directory, design_name, expected_phase, expected_top,
                   timing_facts=None, clock_facts=None, source_checkpoint_sha256=None):
    directory = Path(directory).resolve()
    facts_path = directory / ROLE_FILES["checkpoint_facts"]
    if not facts_path.is_file() or facts_path.is_symlink():
        raise ValueError("Innovus export lacks checkpoint-facts.tsv")
    facts = _facts(facts_path)
    if facts.get("phase") != expected_phase or facts.get("top") != expected_top:
        raise ValueError("Innovus export checkpoint identity disagrees with requested bundle")
    if timing_facts is None:
        timing_facts = {
            "schema": "hima.innovus-timing-facts/1", "status": "unavailable",
            "completeness": "sampled", "reason": "no timing fact adapter supplied",
            "endpoint_alternatives": [],
        }
    if clock_facts is None:
        clock_facts = {
            "schema": "hima.innovus-clock-facts/1", "status": "unavailable",
            "reason": "no clock fact adapter supplied", "clocks": [],
        }
    (directory / ROLE_FILES["timing_facts"]).write_text(
        json.dumps(timing_facts, indent=2, sort_keys=True) + "\n"
    )
    (directory / ROLE_FILES["clock_facts"]).write_text(
        json.dumps(clock_facts, indent=2, sort_keys=True) + "\n"
    )
    artifacts = []
    for role, name in ROLE_FILES.items():
        path = directory / name
        if path.is_file() and not path.is_symlink():
            artifacts.append({"role": role, "path": name, "sha256": file_sha256(path),
                              "bytes": path.stat().st_size})
    required = {"netlist", "def", "sdc", "census", "checkpoint_facts", "tool_version",
                "timing_facts", "clock_facts"}
    if expected_phase == "postroute":
        required.add("spef")
    missing = sorted(required - {row["role"] for row in artifacts})
    completeness = "complete"
    if missing or timing_facts.get("completeness") != "complete":
        completeness = "partial" if artifacts else "sampled"
    manifest = {
        "schema": "hima.innovus-dig-export/1", "schema_version": 1,
        "design_name": design_name, "top_module": expected_top,
        "phase": expected_phase, "checkpoint": facts.get("database"),
        "source_checkpoint_sha256": source_checkpoint_sha256,
        "tool_version": (directory / ROLE_FILES["tool_version"]).read_text(errors="replace").strip(),
        "units": {"distance": "um", "time": "ns", "capacitance": "pF",
                  "resistance": "ohm", "database": facts.get("dbu_per_micron")},
        "counts": {"instances": int(facts.get("instance_count", -1)),
                   "nets": int(facts.get("net_count", -1))},
        "completeness": completeness, "missing_roles": missing,
        "artifacts": sorted(artifacts, key=lambda row: row["role"]),
        "side_effect_policy": "restore-and-export-only-no-design-optimization",
    }
    manifest["manifest_sha256"] = sha256_json(manifest)
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    validated = validate_bundle(directory)
    return {"manifest": manifest, "bundle_sha256": validated["bundle_sha256"]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("directory")
    parser.add_argument("--design", required=True)
    parser.add_argument("--phase", required=True, choices=("place", "postroute"))
    parser.add_argument("--top", required=True)
    args = parser.parse_args()
    print(json.dumps(publish_bundle(args.directory, args.design, args.phase, args.top),
                     indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
