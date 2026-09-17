#!/usr/bin/env python3
"""Parse one bounded Innovus internal-setup timing enumeration.

The parser never calls a report "complete" merely because Innovus exited 0.
Both the global max-path and per-endpoint nworst bounds must be unsaturated.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter
from pathlib import Path


PATH_START = re.compile(r"^Path\s+(\d+):\s*(.*?)\s*$")
NUMBER = r"(-?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)"


def _value(line, label):
    match = re.match(r"^\s*" + re.escape(label) + r"\s+" + NUMBER + r"\s*$", line)
    return float(match.group(1)) if match else None


def parse_timing_report(path, max_paths, nworst, max_slack_ns):
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
    for row in paths:
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
    global_saturated = len(paths) >= int(max_paths)
    endpoint_saturated = sorted(endpoint for endpoint, count in endpoint_counts.items()
                                if count >= int(nworst))
    completeness = "partial" if global_saturated or endpoint_saturated else "complete"
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
            "kind": "bounded-near-critical-internal-setup",
            "max_paths": int(max_paths), "nworst_per_endpoint": int(nworst),
            "max_slack_ns": float(max_slack_ns),
            "global_limit_saturated": global_saturated,
            "endpoint_limits_saturated": endpoint_saturated,
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("report")
    parser.add_argument("--max-paths", type=int, required=True)
    parser.add_argument("--nworst", type=int, required=True)
    parser.add_argument("--max-slack-ns", type=float, required=True)
    parser.add_argument("--timing-json", required=True)
    parser.add_argument("--clock-json", required=True)
    args = parser.parse_args()
    timing, clocks = parse_timing_report(args.report, args.max_paths, args.nworst,
                                         args.max_slack_ns)
    Path(args.timing_json).write_text(json.dumps(timing, indent=2, sort_keys=True) + "\n")
    Path(args.clock_json).write_text(json.dumps(clocks, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
