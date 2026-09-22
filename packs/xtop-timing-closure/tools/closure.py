#!/usr/bin/env python3
"""Manual entrypoint for the reviewed Pack adapter in flow/closure.py."""
from pathlib import Path
import runpy

runpy.run_path(str(Path(__file__).resolve().parents[1] / "flow" / "closure.py"), run_name="__main__")

