#!/usr/bin/env python3
"""CLI adapter for graph-native endpoint opportunity proposals."""

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from dig_store import DigStore  # noqa: E402
from mine_timing_route import mine_dig_endpoint_opportunities  # noqa: E402


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True)
    parser.add_argument("--snapshot", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--deep-threshold", type=int, default=8)
    parser.add_argument("--long-threshold-um", type=float, default=50.0)
    args = parser.parse_args()
    with DigStore(args.database) as store:
        report = mine_dig_endpoint_opportunities(
            store, args.snapshot, deep_threshold=args.deep_threshold,
            long_threshold_um=args.long_threshold_um,
        )
    Path(args.output).write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
    print(json.dumps({"status": report["status"], "endpoint_count": report["endpoint_count"],
                      "complete_endpoint_cone_count": report["complete_endpoint_cone_count"]},
                     sort_keys=True))


if __name__ == "__main__":
    main()
