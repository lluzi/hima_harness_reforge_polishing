#!/usr/bin/env python3
"""Fail-closed readers for the XTop timing-closure Pack's JSON contracts."""
from __future__ import annotations

import json
import math
import hashlib
import os
from pathlib import Path
import re
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


def verified_physical_count(path: Path, kind: str):
    """Independently verify the fixed Innovus check, its count and every listed error.

    A Pack reader is shipped as one pinned script into the Campaign workspace.
    It must not import a mutable flow copy just to reuse the producer's parser.
    """
    lines = path.read_text(errors="replace").splitlines()
    commands = [match.group(1) for line in lines
                if (match := re.fullmatch(r"#\s*Command:\s*(.*)", line.strip()))]
    if len(commands) != 1:
        raise ValueError(f"{kind} has no single Innovus command identity")
    report_path = r'(?:/\S+|\{[^}\n]+\}|"[^"\n]+")'
    if kind == "drc":
        if re.fullmatch(r"verify_drc\s+-limit\s+1000000\s+-report\s+" + report_path, commands[0]) is None:
            raise ValueError("DRC check scope or limit differs from the Pack template")
        counts = [int(match.group(1)) for line in lines if (match := re.fullmatch(r"\s*Total Violations\s*:\s*(\d+)\s+Viols\.\s*", line))]
        listed = sum(line.startswith("Bounds :") for line in lines)
    else:
        if re.fullmatch(r"verifyConnectivity\s+-noAntenna\s+-error\s+1000000\s+-report\s+" + report_path, commands[0]) is None:
            raise ValueError("connectivity check scope or limit differs from the Pack template")
        if lines.count("Begin Summary") != 1 or lines.count("End Summary") != 1:
            raise ValueError("connectivity check has no single complete summary")
        counts = [int(match.group(1)) for line in lines if (match := re.fullmatch(r"\s*(\d+) total info\(s\) created\.\s*", line))]
        categories = [int(match.group(1)) for line in lines if (match := re.fullmatch(r"\s*(\d+) Problem\(s\) \([^\n]+\):[^\n]*", line))]
        if not categories or len(counts) != 1 or sum(categories) != counts[0]:
            raise ValueError("connectivity summary categories differ from the total")
        listed = sum(line.startswith("Net ") for line in lines)
    if len(counts) != 1 or counts[0] >= 1000000 or listed != counts[0]:
        raise ValueError(f"{kind} report count is missing, capped or does not cover every listed error")
    return counts[0]


def verify_state(data, workspace: Path):
    if data.get("schema") != "xtop-timing-closure-state/1":
        raise ValueError("closure state has the wrong schema")
    refs = data.get("reportFiles")
    if not isinstance(refs, list) or not refs:
        raise ValueError("closure state has no report identities")
    for ref in refs:
        verify_ref(ref, workspace)
    physical = data.get("physical")
    if not isinstance(physical, dict) or physical.get("schema") != "xtop-timing-closure-physical-check/2" or physical.get("coverage") not in {"complete", "unknown"}:
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
    manifest_path = verify_ref(physical.get("manifest"), workspace)
    manifest = load(manifest_path)
    if (set(manifest) != {"schema", "coverage", "drcLimit", "connectivityLimit", "drcReport", "connectivityReport"}
            or manifest["schema"] != physical["schema"] or manifest["drcLimit"] != 1000000
            or manifest["connectivityLimit"] != 1000000):
        raise ValueError("closure state physical manifest differs from the retained check contract")
    if physical["coverage"] == "complete":
        if manifest["coverage"] != "complete":
            raise ValueError("closure state claims complete physical coverage without a complete check")
        for kind, name in (("drc", "drcReport"), ("connectivity", "connectivityReport")):
            report = verify_ref(physical[kind]["report"], workspace)
            if report.parent != manifest_path.parent or report.name != manifest[name] or physical[kind].get("count") != verified_physical_count(report, kind):
                raise ValueError("closure state physical counts or coverage differ from retained report bytes")
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
        feedback = data.get("generation_feedback")
        if (not isinstance(feedback, dict) or feedback.get("schema") != "hima-generation-feedback/1"
                or feedback.get("generation") != data.get("iteration")
                or feedback.get("subject") != "timing-endpoint"):
            raise ValueError("iteration result has no typed generation feedback")
        denominator = feedback.get("denominator") or {}
        original = sorted(key for key, value in data["before"]["endpointSlackNs"].items() if value < 0)
        if (denominator.get("kind") != "endpoint" or denominator.get("originalIds") != original
                or denominator.get("originalCount") != len(original)):
            raise ValueError("generation feedback changes the original endpoint denominator")
        expected_missing = sorted(set(original) - set(data["after"]["endpointSlackNs"]))
        if delta.get("missing") != expected_missing:
            raise ValueError("endpoint delta missing identities differ from retained snapshots")
        categories = feedback.get("endpointChanges") or {}
        for name in ("fixed", "remaining", "entrant", "regressed", "missing"):
            category = categories.get(name)
            if (not isinstance(category, dict) or category.get("status") not in {"measured", "unknown"}
                    or not isinstance(category.get("ids"), list)
                    or (category["status"] == "unknown" and not isinstance(category.get("reason"), str))):
                raise ValueError(f"generation feedback category {name} is malformed")
        expected_categories = {
            "fixed": "fixed", "remaining": "remaining", "entrant": "entrants",
            "regressed": "regressed", "missing": "missing",
        }
        comparable = delta.get("comparability", "comparable") == "comparable"
        for name, delta_name in expected_categories.items():
            category = categories[name]
            if comparable or name == "missing":
                if category != {"status": "measured", "ids": list(delta[delta_name])}:
                    raise ValueError(f"generation feedback category {name} differs from endpoint delta")
            elif category["status"] != "unknown":
                raise ValueError(f"non-comparable generation reports {name} as measured")
        if not comparable:
            next_step = feedback.get("next") or {}
            items = next_step.get("items") or []
            if (next_step.get("kind") != "action" or next_step.get("status") != "available"
                    or not isinstance(items, list) or len(items) != 1 or not isinstance(items[0], dict)
                    or items[0].get("change") != "remeasure-comparable-snapshot"
                    or items[0].get("targetIds") != original):
                raise ValueError("non-comparable generation must request a matched remeasurement")
        coverage = feedback.get("coverage") or {}
        expected_covered = sorted(set(original) & set(data["after"]["endpointSlackNs"]))
        if (coverage.get("before") != {"status": "measured", "coveredIds": original, "missingIds": []}
                or coverage.get("after") != {"status": "measured", "coveredIds": expected_covered,
                                              "missingIds": expected_missing}):
            raise ValueError("generation feedback coverage differs from retained endpoint identities")
        sources = feedback.get("sources")
        expected_source_ids = {f"before:g{int(data['before']['iteration']):03d}",
                               f"after:g{int(data['after']['iteration']):03d}",
                               f"plan:g{int(data['iteration']):03d}"}
        if (not isinstance(sources, list) or {row.get("id") for row in sources if isinstance(row, dict)} != expected_source_ids):
            raise ValueError("generation feedback source identities are incomplete")
        by_id = {row["id"]: row for row in sources}
        for source_id, expected_document in ((f"before:g{int(data['before']['iteration']):03d}", data["before"]),
                                             (f"after:g{int(data['after']['iteration']):03d}", data["after"])):
            held = by_id[source_id]
            if set(held) != {"id", "path", "sha256"}:
                raise ValueError("generation feedback source identity is malformed")
            held_path = workspace_path(workspace, held["path"])
            if load(held_path) != expected_document or hashlib.sha256(held_path.read_bytes()).hexdigest() != held["sha256"]:
                raise ValueError("generation feedback state source differs from retained bytes")
        plan_source = by_id[f"plan:g{int(data['iteration']):03d}"]
        if set(plan_source) != {"id", "path", "sha256"}:
            raise ValueError("generation feedback plan source identity is malformed")
        plan_path = workspace_path(workspace, plan_source["path"])
        if (hashlib.sha256(plan_path.read_bytes()).hexdigest() != plan_source["sha256"]
                or load(plan_path).get("iteration") != data["iteration"]):
            raise ValueError("generation feedback plan source differs from retained bytes")
        values = [
            number("xtop_setup_wns", after["setup_wns_ns"], "ns", mode="setup", scope="all"),
            number("xtop_setup_tns", after["setup_tns_ns"], "ns", mode="setup", scope="all"),
            number("xtop_setup_violations", after["setup_violations"]),
            number("xtop_hold_wns", after["hold_wns_ns"], "ns", mode="hold", scope="all"),
            number("xtop_hold_tns", after["hold_tns_ns"], "ns", mode="hold", scope="all"),
            number("xtop_hold_violations", after["hold_violations"]),
            number("xtop_closure_score", after["closure_score"], "score"),
            number("xtop_iteration_evidence_valid", 1 if data.get("evidence_valid") is True else 0),
            number("xtop_endpoint_original_count", denominator["originalCount"]),
        ]
        changes = (("fixed", "xtop_endpoint_fixed_count"),
                   ("remaining", "xtop_endpoint_remaining_count"),
                   ("entrant", "xtop_endpoint_entrant_count"),
                   ("regressed", "xtop_endpoint_regressed_count"),
                   ("missing", "xtop_endpoint_missing_count"))
        values[6:6] = [number(kind, len(categories[name]["ids"]))
                       for name, kind in changes if categories[name]["status"] == "measured"]
        return values
    raise ValueError("unknown reader mode: " + mode)


def main():
    if len(sys.argv) != 4:
        raise SystemExit("usage: read-output.py REPORT OUT MODE")
    values = read(Path(sys.argv[1]).resolve(), sys.argv[3])
    Path(sys.argv[2]).write_text(json.dumps({"values": values}, sort_keys=True, allow_nan=False) + "\n")


if __name__ == "__main__":
    main()
