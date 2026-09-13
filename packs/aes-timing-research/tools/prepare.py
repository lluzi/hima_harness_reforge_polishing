#!/usr/bin/env python3
"""Stage the Site-owned finite handoff without changing its bytes."""
import shutil
import sys
from pathlib import Path

workspace = Path(sys.argv[1]).resolve()
flow = workspace / "flow"
for name in ("sample.json", "baseline.py"):
    source = flow / name
    if not source.is_file():
        raise SystemExit(f"missing Site-staged {name}")
    target = workspace / name
    shutil.copyfile(source, target)
