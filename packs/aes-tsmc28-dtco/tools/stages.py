#!/usr/bin/env python3
"""Human CLI for the same Site-staged domain adapter used by Fabric.

Usage: python3 tools/stages.py STAGE WORKSPACE [ROUTE|FLOORPLAN_UTILIZATION]
No Host or model is created here; the calling conversational Agent requests each Job.
"""
import pathlib
import subprocess
import sys

if len(sys.argv) not in (3, 4):
    raise SystemExit("usage: stages.py STAGE WORKSPACE [ROUTE|FLOORPLAN_UTILIZATION]")
workspace = pathlib.Path(sys.argv[2]).resolve()
raise SystemExit(subprocess.call([
    "/usr/bin/python3", str(workspace / "flow/stages.py"),
    sys.argv[1], str(workspace), *sys.argv[3:],
]))
