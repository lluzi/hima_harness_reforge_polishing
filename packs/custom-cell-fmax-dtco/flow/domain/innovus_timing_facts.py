#!/usr/bin/env python3
"""Parse one bounded Innovus internal-setup timing enumeration.

The parser never calls a report "complete" merely because Innovus exited 0.
Both the global max-path and per-endpoint nworst bounds must be unsaturated.
"""

from __future__ import annotations

import argparse
import json
import math
import re
from collections import Counter
from pathlib import Path


PATH_START = re.compile(r"^Path\s+(\d+):\s*(.*?)\s*$")
NUMBER = r"(-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)"


def _value(line, label):
    match = re.match(r"^\s*" + re.escape(label) + r"\s+" + NUMBER + r"\s*$", line)
    return float(match.group(1)) if match else None


def _expected_endpoints(path):
    if path is None:
        return None
    rows = []
    for line in Path(path).read_text(encoding="utf-8", errors="replace").splitlines():
        value = line.strip()
        if value and not value.startswith("#"):
            rows.append(value.split("\t", 1)[0])
    if not rows or len(rows) != len(set(rows)):
        raise ValueError("endpoint index must contain unique endpoint identities")
    return rows


def parse_timing_report(path, max_paths, nworst, max_slack_ns, endpoint_index=None):
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    design_match = re.search(r"(?m)^#\s*Design\s*:\s*(\S+)\s*$", text)
    command_match = re.search(r"(?m)^#\s*Command\s*:\s*(.*?)\s*$", text)
    if not design_match or not command_match:
        raise ValueError("Innovus timing report lacks design or command identity")
    paths, current, in_table = [], None, False
    for line in text.splitlines():
        start = PATH_START.match(line)
        if start:
            if current is not None:
                paths.append(current)
            current = {"path_id": int(start.group(1)), "status_text": start.group(2),
                       "points": []}
            in_table = False
            continue
        if current is None:
            continue
        for label, key in (("Endpoint:", "endpoint"), ("Beginpoint:", "beginpoint"),
                           ("Analysis View:", "analysis_view")):
            if line.startswith(label):
                current[key] = line.split(":", 1)[1].strip().split()[0]
        if line.startswith("Path Groups:"):
            current["path_groups"] = re.findall(r"\{([^}]+)\}", line)[0].split()
        for label, key in (("Other End Arrival Time", "capture_clock_arrival_ns"),
                           ("= Required Time", "required_time_ns"),
                           ("- Arrival Time", "arrival_time_ns"),
                           ("= Slack Time", "slack_ns"),
                           ("+ Clock Network Latency (Prop)", "launch_clock_latency_ns")):
            value = _value(line, label)
            if value is not None and key not in current:
                current[key] = value
        if line.lstrip().startswith("|") and " Pin " in line and " Delay " in line:
            in_table = True
            continue
        if in_table and line.lstrip().startswith("+"):
            continue
        if in_table and line.lstrip().startswith("|"):
            columns = [value.strip() for value in line.strip().strip("|").split("|")]
            if len(columns) >= 7 and columns[0] and columns[0] != "Pin" and not set(columns[0]) <= {"-"}:
                try:
                    delay = float(columns[4]) if columns[4] else None
                    arrival = float(columns[5]) if columns[5] else None
                    required = float(columns[6]) if columns[6] else None
                except ValueError:
                    continue
                current["points"].append({"pin": columns[0], "edge": columns[1],
                                          "net": columns[2], "cell": columns[3],
                                          "delay_ns": delay, "arrival_ns": arrival,
                                          "required_ns": required})
    if current is not None:
        paths.append(current)
    required = ("endpoint", "beginpoint", "analysis_view", "required_time_ns",
                "arrival_time_ns", "slack_ns")
    paths = [row for row in paths if all(key in row for key in required)]
    if not paths:
        raise ValueError("Innovus timing report contains no complete timing path")
    for unique_id, row in enumerate(paths, 1):
        row["reported_path_id"] = row["path_id"]
        row["path_id"] = unique_id
        points = row.pop("points")
        ordered_pins = [point["pin"] for point in points]
        ordered_steps = [[point["pin"], point["edge"]] for point in points]
        row["ordered_pins"] = ordered_pins
        row["ordered_steps"] = ordered_steps
        row["point_count"] = len(points)
        # Detailed columns remain in the hash-bound raw Innovus report.  The
        # common graph needs stable ordered identity and a tamper-evident key.
        import hashlib
        row["ordered_point_sha256"] = hashlib.sha256(
            json.dumps(points, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()
    endpoint_counts = Counter(row["endpoint"] for row in paths)
    expected = _expected_endpoints(endpoint_index)
    observed = set(endpoint_counts)
    missing_endpoints = sorted(set(expected or ()) - observed)
    unexpected_endpoints = sorted(observed - set(expected or observed))
    if expected is not None:
        # One explicitly requested worst setup path per legal register data pin.
        # The report is endpoint-complete when every requested endpoint yielded a
        # path; it does not claim alternative-path completeness.
        global_saturated = False
        endpoint_saturated = []
        completeness = "complete" if not missing_endpoints and not unexpected_endpoints else "partial"
        coverage_kind = "complete-register-endpoint-worst-setup"
    else:
        global_saturated = len(paths) >= int(max_paths)
        endpoint_saturated = sorted(endpoint for endpoint, count in endpoint_counts.items()
                                    if count >= int(nworst))
        completeness = "partial" if global_saturated or endpoint_saturated else "complete"
        coverage_kind = "bounded-near-critical-internal-setup"
    by_endpoint = {}
    for row in paths:
        entry = by_endpoint.setdefault(row["endpoint"], {
            "endpoint": row["endpoint"], "alternatives": [],
            "worst_slack_ns": row["slack_ns"],
        })
        entry["worst_slack_ns"] = min(entry["worst_slack_ns"], row["slack_ns"])
        entry["alternatives"].append(row["path_id"])
    timing = {
        "schema": "hima.innovus-timing-facts/1", "status": "observed",
        "design": design_match.group(1), "command": command_match.group(1),
        "coverage_scope": {
            "kind": coverage_kind,
            "max_paths": int(max_paths), "nworst_per_endpoint": int(nworst),
            "max_slack_ns": float(max_slack_ns),
            "global_limit_saturated": global_saturated,
            "endpoint_limits_saturated": endpoint_saturated,
            "expected_endpoint_count": len(expected) if expected is not None else None,
            "missing_endpoints": missing_endpoints,
            "unexpected_endpoints": unexpected_endpoints,
            "path_alternatives_complete": False,
        },
        "completeness": completeness, "path_count": len(paths),
        "endpoint_count": len(by_endpoint),
        "endpoint_alternatives": sorted(by_endpoint.values(),
                                        key=lambda row: (row["worst_slack_ns"], row["endpoint"])),
        "paths": paths,
    }
    clocks = {
        "schema": "hima.innovus-clock-facts/1", "status": "observed",
        "analysis_views": sorted({row["analysis_view"] for row in paths}),
        "path_clock_contributions": [{
            "path_id": row["path_id"], "beginpoint": row["beginpoint"],
            "endpoint": row["endpoint"],
            "launch_clock_latency_ns": row.get("launch_clock_latency_ns"),
            "capture_clock_arrival_ns": row.get("capture_clock_arrival_ns"),
            "data_arrival_ns": row["arrival_time_ns"],
            "required_time_ns": row["required_time_ns"],
        } for row in paths],
    }
    return timing, clocks


def build_active_frontier(timing, period_ns, target_fmax_gain, guardband_ns,
                          frozen_q_target_ns=None):
    """Derive V5 q_e and the active frontier from endpoint-complete STA facts."""
    if timing.get("schema") != "hima.innovus-timing-facts/1":
        raise ValueError("unsupported timing fact schema")
    if timing.get("completeness") != "complete":
        raise ValueError("active frontier requires endpoint-complete timing facts")
    for name, value in (("period_ns", period_ns), ("target_fmax_gain", target_fmax_gain),
                        ("guardband_ns", guardband_ns)):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError("%s must be finite" % name)
    if period_ns <= 0 or target_fmax_gain <= 0 or guardband_ns < 0:
        raise ValueError("period and target gain must be positive; guardband must be non-negative")
    endpoints = timing.get("endpoint_alternatives")
    if not isinstance(endpoints, list) or not endpoints:
        raise ValueError("timing facts contain no endpoints")
    rows = []
    for row in endpoints:
        slack = row.get("worst_slack_ns")
        if isinstance(slack, bool) or not isinstance(slack, (int, float)) or not math.isfinite(slack):
            raise ValueError("endpoint slack must be finite")
        rows.append({"endpoint": row["endpoint"], "slack_ns": float(slack),
                     "q_ns": float(period_ns) - float(slack)})
    q0 = max(row["q_ns"] for row in rows)
    if frozen_q_target_ns is None:
        q_target = q0 / (1.0 + float(target_fmax_gain))
        target_source = "derived-from-this-snapshot-q0"
    else:
        if (isinstance(frozen_q_target_ns, bool)
                or not isinstance(frozen_q_target_ns, (int, float))
                or not math.isfinite(frozen_q_target_ns) or frozen_q_target_ns <= 0):
            raise ValueError("frozen_q_target_ns must be finite and positive")
        q_target = float(frozen_q_target_ns)
        target_source = "frozen-baseline-target"
    threshold = q_target - float(guardband_ns)
    for row in rows:
        row["active"] = row["q_ns"] >= threshold - 1e-15
        row["target_deficit_ns"] = max(0.0, row["q_ns"] - q_target)
    return {
        "schema": "hima.lfr-active-frontier/1", "status": "observed",
        "period_ns": float(period_ns), "target_fmax_gain": float(target_fmax_gain),
        "guardband_ns": float(guardband_ns), "q0_ns": q0,
        "q_target_ns": q_target, "q_target_source": target_source,
        "required_gain_ns": q0 - q_target,
        "endpoint_count": len(rows),
        "active_endpoint_count": sum(row["active"] for row in rows),
        "endpoints": sorted(rows, key=lambda row: (-row["q_ns"], row["endpoint"])),
        "all_endpoints_are_regression_sentinels": True,
        "claim_limits": {"commercial_causality": False, "path_alternatives_complete": False},
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("report")
    parser.add_argument("--max-paths", type=int, required=True)
    parser.add_argument("--nworst", type=int, required=True)
    parser.add_argument("--max-slack-ns", type=float, required=True)
    parser.add_argument("--timing-json", required=True)
    parser.add_argument("--clock-json", required=True)
    parser.add_argument("--endpoint-index")
    parser.add_argument("--period-ns", type=float)
    parser.add_argument("--target-fmax-gain", type=float, default=0.05)
    parser.add_argument("--guardband-ns", type=float, default=0.0)
    parser.add_argument("--frontier-json")
    parser.add_argument("--frozen-q-target-ns", type=float)
    args = parser.parse_args()
    timing, clocks = parse_timing_report(args.report, args.max_paths, args.nworst,
                                         args.max_slack_ns, args.endpoint_index)
    if args.frontier_json:
        if args.period_ns is None:
            parser.error("--frontier-json requires --period-ns")
        frontier = build_active_frontier(timing, args.period_ns, args.target_fmax_gain,
                                         args.guardband_ns, args.frozen_q_target_ns)
        timing["active_frontier"] = frontier
        Path(args.frontier_json).write_text(json.dumps(frontier, indent=2, sort_keys=True) + "\n")
    Path(args.timing_json).write_text(json.dumps(timing, indent=2, sort_keys=True) + "\n")
    Path(args.clock_json).write_text(json.dumps(clocks, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
