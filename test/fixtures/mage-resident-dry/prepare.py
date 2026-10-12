#!/usr/bin/env python3
"""Initial declared inputs for the mage-scribe-placement L2 dry route.

Writes the synthetic 2x2 case (`flow/tests/fixtures.py:make_case`) and a
`site-capabilities.json` whose `mage.executable` is the Pack's own
stand-in MAGE interpreter (`flow/tests/standin_mage.py`, `-noterm`
behaviour), under `<root>/case/`. Prints the three paths the Host's
`local.yml` bindings need (manifest, consumerContext, siteCapabilities),
one per line, and nothing else.
"""
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
PACK_FLOW = REPO / "packs/mage-scribe-placement/flow"
sys.path[:0] = [str(PACK_FLOW / "tests"), str(PACK_FLOW)]

from fixtures import make_case, make_site_capabilities  # noqa: E402

STANDIN = PACK_FLOW / "tests" / "standin_mage.py"


def prepare(root):
    root = Path(root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    executable = [sys.executable, str(STANDIN)]
    case = make_case(root, mage_executable=executable)
    site_capabilities_path = make_site_capabilities(root, executable)
    print(case["files"]["manifest"])
    print(case["files"]["consumerContext"])
    print(site_capabilities_path)
    return case


if __name__ == "__main__":
    prepare(sys.argv[1])
