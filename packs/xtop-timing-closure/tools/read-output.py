#!/usr/bin/env python3
"""Fail-closed readers for the XTop timing-closure Pack's JSON contracts."""
from __future__ import annotations

import json
import math
import hashlib
import os
from pathlib import Path
import sys


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key: " + key)
        result[key] = value
    return result


def load(path: Path):
    if path.is_symlink() or not path.is_file():
        raise ValueError("report is missing or is a symlink")
    return json.loads(path.read_text(), object_pairs_hook=unique)


def number(kind, value, unit="count", **extra):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{kind} is not a finite number")
    return {"type": kind, "unit": unit, "value": value, **extra}


def workspace_path(workspace: Path, raw: str):
    value = Path(raw)
    path = value.resolve() if value.is_absolute() else (workspace / value).resolve()
    if not path.is_relative_to(workspace.resolve()):
        raise ValueError("evidence path escapes workspace")
    return path


def verify_ref(ref, workspace: Path):
    if not isinstance(ref, dict) or set(ref) != {"role", "path", "sha256", "bytes"}:
        raise ValueError("malformed file identity")
    path = workspace_path(workspace, ref["path"])
    if path.is_symlink() or not path.is_file():
        raise ValueError("held evidence is missing or linked")
    raw = path.read_bytes()
    if len(raw) != ref["bytes"] or hashlib.sha256(raw).hexdigest() != ref["sha256"]:
        raise ValueError("held evidence identity changed")
    return path


def verify_state(data, workspace: Path):
    if data.get("schema") != "xtop-timing-closure-state/1":
        raise ValueError("closure state has the wrong schema")
    refs = data.get("reportFiles")
    if not isinstance(refs, list) or not refs:
        raise ValueError("closure state has no report identities")
    for ref in refs:
        verify_ref(ref, workspace)
    physical = data.get("physical")
    if not isinstance(physical, dict) or physical.get("schema") != "xtop-timing-closure-physical-check/1" or physical.get("coverage") not in {"complete", "unknown"}:
        raise ValueError("closure state has malformed physical evidence")
    for kind in ("drc", "connectivity"):
        row = physical.get(kind)
        if not isinstance(row, dict):
            raise ValueError(f"closure state has malformed physical {kind} evidence")
        count = row.get("count")
        if count is not None and (isinstance(count, bool) or not isinstance(count, int) or count < 0):
            raise ValueError(f"closure state has malformed physical {kind} count")
        if count is None and (physical["coverage"] == "complete" or row.get("status") != "unknown" or not isinstance(row.get("reason"), str)):
            raise ValueError(f"closure state has neither a qualified physical {kind} count nor an explicit unknown")
        verify_ref(row.get("report"), workspace)
    verify_ref(physical.get("manifest"), workspace)
    measurement = data.get("measurement")
    if not isinstance(measurement, dict) or not isinstance(measurement.get("scenariosSha256"), str) or not isinstance(measurement.get("spef"), dict):
        raise ValueError("closure state has no measurement coverage identity")
    verify_ref(measurement.get("profile"), workspace)
    verify_ref(measurement.get("sourceManifest"), workspace)
    if not measurement["spef"]:
        raise ValueError("closure state has no extraction identity")
    for ref in measurement["spef"].values():
        verify_ref(ref, workspace)
    metrics = data.get("metrics")
    endpoints = data.get("endpointSlackNs")
    if not isinstance(metrics, dict) or not isinstance(endpoints, dict):
        raise ValueError("closure state is incomplete")
    return metrics


def tree_identity(root: Path):
    if root.is_symlink() or not root.is_dir():
        raise ValueError("database tree is missing or linked")
    files, links = [], []
    for entry in sorted(root.rglob("*"), key=lambda p: p.relative_to(root).as_posix()):
        rel = entry.relative_to(root).as_posix()
        if entry.is_symlink():
            target = entry.resolve(strict=True)
            raw = target.read_bytes()
            links.append({"path": rel, "link": os.readlink(entry), "targetSha256": hashlib.sha256(raw).hexdigest(), "targetBytes": len(raw)})
        elif entry.is_file():
            raw = entry.read_bytes()
            files.append({"path": rel, "sha256": hashlib.sha256(raw).hexdigest(), "bytes": len(raw)})
        elif not entry.is_dir():
            raise ValueError("unsupported database member")
    body = {"files": files, "links": links}
    body["treeSha256"] = hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    return body


def read(report: Path, mode: str):
    data = load(report)
    schema = data.get("schema")
    workspace = report.parents[2]
    if mode == "stage":
        if schema != "xtop-timing-closure-stage/1" or data.get("status") != "passed":
            raise ValueError("stage did not pass")
        return [number("xtop_stage_ok", 1)]
    if mode == "plan":
        if schema != "xtop-timing-fix-plan/1":
            raise ValueError("fix plan has the wrong schema")
        actions = data.get("actions")
        if not isinstance(actions, list) or not actions:
            raise ValueError("fix plan has no bounded action")
        return [number("xtop_fix_action_count", len(actions))]
    if mode == "best":
        if schema != "xtop-timing-closure-best-database/1" or data.get("ready") is not True:
            raise ValueError("best database is not ready")
        verify_ref(data.get("restoreScript"), workspace)
        root = workspace_path(workspace, data.get("restoreData", ""))
        if tree_identity(root) != data.get("tree"):
            raise ValueError("best database tree identity changed")
        return [number("xtop_best_database_ready", 1)]
    if mode == "state":
        metrics = verify_state(data, workspace)
        return [
            number("xtop_setup_wns", metrics["setup_wns_ns"], "ns", mode="setup", scope="all"),
            number("xtop_setup_tns", metrics["setup_tns_ns"], "ns", mode="setup", scope="all"),
            number("xtop_setup_violations", metrics["setup_violations"]),
            number("xtop_hold_wns", metrics["hold_wns_ns"], "ns", mode="hold", scope="all"),
            number("xtop_hold_tns", metrics["hold_tns_ns"], "ns", mode="hold", scope="all"),
            number("xtop_hold_violations", metrics["hold_violations"]),
            number("xtop_unconstrained_endpoints", metrics["unconstrained_endpoints"]),
            number("xtop_closure_score", metrics["closure_score"], "score"),
        ]
    if mode == "iteration":
        if schema != "xtop-timing-closure-iteration/1":
            raise ValueError("iteration result has the wrong schema")
        verify_state(data["before"], workspace)
        after = verify_state(data["after"], workspace)
        delta = data["endpoint_delta"]
        values = [
            number("xtop_setup_wns", after["setup_wns_ns"], "ns", mode="setup", scope="all"),
            number("xtop_setup_tns", after["setup_tns_ns"], "ns", mode="setup", scope="all"),
            number("xtop_setup_violations", after["setup_violations"]),
            number("xtop_hold_wns", after["hold_wns_ns"], "ns", mode="hold", scope="all"),
            number("xtop_hold_tns", after["hold_tns_ns"], "ns", mode="hold", scope="all"),
            number("xtop_hold_violations", after["hold_violations"]),
            number("xtop_closure_score", after["closure_score"], "score"),
            number("xtop_iteration_evidence_valid", 1 if data.get("evidence_valid") is True else 0),
        ]
        if delta.get("comparability", "comparable") == "comparable":
            values[6:6] = [
                number("xtop_endpoint_fixed_count", len(delta["fixed"])),
                number("xtop_endpoint_remaining_count", len(delta["remaining"])),
                number("xtop_endpoint_entrant_count", len(delta["entrants"])),
                number("xtop_endpoint_regressed_count", len(delta["regressed"])),
            ]
        return values
    raise ValueError("unknown reader mode: " + mode)


def main():
    if len(sys.argv) != 4:
        raise SystemExit("usage: read-output.py REPORT OUT MODE")
    values = read(Path(sys.argv[1]).resolve(), sys.argv[3])
    Path(sys.argv[2]).write_text(json.dumps({"values": values}, sort_keys=True, allow_nan=False) + "\n")


if __name__ == "__main__":
    main()
