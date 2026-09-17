#!/usr/bin/env python3
"""Build one reloadable DIG snapshot from already admitted adapter outputs."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from design_information_graph import augment_timing_projection, validate_bundle, write_projection
from dig_store import store_projection


def build_snapshot(bundle_dir, physical_projection, database_path, output_projection):
    bundle = validate_bundle(bundle_dir)
    manifest = bundle["manifest"]
    physical = json.loads(Path(physical_projection).read_text())
    timing = json.loads(bundle["roles"]["timing_facts"].read_text())
    clocks = json.loads(bundle["roles"]["clock_facts"].read_text())
    physical["snapshot"]["bundle_sha256"] = bundle["bundle_sha256"]
    physical["snapshot"]["manifest"] = manifest
    physical["snapshot"]["completeness"] = manifest["completeness"]
    projection = augment_timing_projection(physical, timing, clocks)
    normalized = write_projection(output_projection, projection)
    store_projection(database_path, normalized, validated=True)
    return normalized["snapshot"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", required=True)
    parser.add_argument("--physical-projection", required=True)
    parser.add_argument("--database", required=True)
    parser.add_argument("--projection", required=True)
    args = parser.parse_args()
    print(json.dumps(build_snapshot(args.bundle, args.physical_projection, args.database,
                                    args.projection), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
