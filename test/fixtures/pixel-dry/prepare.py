#!/usr/bin/env python3
"""Initial declared inputs for the pixel-layout-optimization L2 dry route.

Builds the synthetic pixel case with the Pack's own
``flow/tests/fixtures.build_case`` under ``<root>/case/`` and prints the two
paths the Host's ``local.yml`` bindings need (``pixelCaseManifest``,
``siteCapabilities``), one per line and nothing else on stdout.

The numeric half of the flow (``num-*``: numpy / SciPy with HiGHS / Shapely /
gdstk) runs through ``siteCapabilities.python``, so this script points that
interpreter at a dedicated venv it creates once, idempotently, at
``<repo>/.hima-tmp/pixel-dry-venv`` with the versions the real EDA container
pins. ``build_case`` itself draws the real GDS with gdstk, so the host
``python3`` that first runs this script re-executes it under the venv python
(``--build``) to assemble the case and rewrite the site capabilities. The
EDA tool argv prefixes point at ``flow/tests/standin_eda.py`` of the repo Pack
copy (a read root the Site permit grants), the stdlib-only stand-in.
"""
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
PACK_FLOW = REPO / "packs/pixel-layout-optimization/flow"
STANDIN = PACK_FLOW / "tests" / "standin_eda.py"

VENV = REPO / ".hima-tmp/pixel-dry-venv"
VENV_PY = VENV / "bin/python"
PACKAGES = ["numpy==1.26.4", "scipy==1.13.1", "shapely==2.0.7", "gdstk==0.9.52"]


def _venv_ready():
    if not VENV_PY.exists():
        return False
    probe = subprocess.run([str(VENV_PY), "-c", "import numpy, scipy, shapely, gdstk"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return probe.returncode == 0


def ensure_venv():
    """Create <repo>/.hima-tmp/pixel-dry-venv with the pinned numeric stack, once.

    uv's own output is sent to stderr so stdout carries only the two paths the
    caller parses."""
    if _venv_ready():
        return
    VENV.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["uv", "venv", "--python", "3.12", str(VENV)],
                   check=True, stdout=sys.stderr, stderr=sys.stderr)
    subprocess.run(["uv", "pip", "install", "--python", str(VENV_PY)] + PACKAGES,
                   check=True, stdout=sys.stderr, stderr=sys.stderr)


def build_and_emit(root):
    """Run under the venv python: build the case and print the two paths."""
    sys.path[:0] = [str(PACK_FLOW / "tests"), str(PACK_FLOW)]
    import fixtures  # noqa: E402  (flow/tests/fixtures.py)

    root = Path(root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    case = fixtures.build_case(str(root / "case"))

    sitecaps_path = Path(case["sitecaps"])
    sitecaps = json.loads(sitecaps_path.read_text(encoding="utf-8"))
    sitecaps["python"] = sys.executable          # the venv python running this
    sitecaps["reaperPython"] = sys.executable
    for tool in list(sitecaps.get("tools", {})):
        sitecaps["tools"][tool] = [sys.executable, str(STANDIN), tool]
    sitecaps_path.write_text(json.dumps(sitecaps), encoding="utf-8")

    sys.stdout.write(case["manifest"] + "\n")
    sys.stdout.write(str(sitecaps_path) + "\n")
    sys.stdout.flush()


def prepare(root):
    ensure_venv()
    # gdstk (for the real GDS) lives only in the venv, so build there.
    completed = subprocess.run([str(VENV_PY), str(Path(__file__).resolve()), "--build", str(root)])
    if completed.returncode != 0:
        raise SystemExit(completed.returncode)


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["--build"]:
        build_and_emit(args[1])
    else:
        prepare(args[0])
