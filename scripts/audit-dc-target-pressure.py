#!/usr/bin/env python3
"""Fail closed unless a DC timing report targets the declared reg2reg Fmax paths."""
import argparse
import json
import math
from pathlib import Path
import re


def audit(path, expected_top, maximum_slack):
    text = Path(path).read_text(errors="replace")
    designs = re.findall(r"(?m)^Design\s*:\s*(\S+)\s*$", text)
    groups = re.findall(r"(?m)^\s*Path Group:\s*(\S+)\s*$", text)
    starts = re.findall(r"(?m)^\s*Startpoint:\s*(.+)$", text)
    ends = re.findall(r"(?m)^\s*Endpoint:\s*(.+)$", text)
    slacks = [float(value) for value in re.findall(
        r"(?m)^\s*slack \([^)]*\)\s+(-?[0-9.eE+-]+)\s*$", text)]
    checks = {
        "exactTop": designs == [expected_top],
        "onlyReg2reg": bool(groups) and set(groups) == {"reg2reg"},
        "completePaths": len(groups) == len(starts) == len(ends) == len(slacks),
        "finiteSlack": bool(slacks) and all(math.isfinite(value) for value in slacks),
        "pressureReached": bool(slacks) and min(slacks) <= maximum_slack,
    }
    return {"status": "passed" if all(checks.values()) else "failed", "report": str(Path(path).resolve()),
            "expectedTop": expected_top, "targetGroup": "reg2reg", "maximumSlackNs": maximum_slack,
            "observed": {"designs": designs, "groups": sorted(set(groups)), "pathCount": len(groups),
                         "worstSlackNs": min(slacks) if slacks else None}, "checks": checks}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", required=True)
    parser.add_argument("--expected-top", required=True)
    parser.add_argument("--maximum-slack-ns", type=float, default=0.0)
    args = parser.parse_args()
    result = audit(args.report, args.expected_top, args.maximum_slack_ns)
    print(json.dumps(result, indent=2))
    return 0 if result["status"] == "passed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
