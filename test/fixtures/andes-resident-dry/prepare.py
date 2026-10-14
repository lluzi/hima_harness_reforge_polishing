#!/usr/bin/env python3
"""Initial declared inputs for the andes-cell-fmax L2 DBOS dry route.

Materialises a SYNTHETIC OpenC910 data bundle for `CTU_OPENC910_DATA` and the
Site `designRoot`, so the dry route never reads the git-ignored real OpenC910
data. The bundle is a copy of the Site's own tracked synthetic fixture
(`mock-eda/tests/fixtures/openc910-mini`, verified free of foundry data), placed
at `<root>/synthetic-bundle`. Prints that one path and nothing else; the worker
binds it as `designRoot` and exports it as `CTU_OPENC910_DATA`.
"""
import shutil
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
FIXTURE = REPO / "sites/eda_cluster_ctu_01/mock-eda/tests/fixtures/openc910-mini"


def prepare(root):
    root = Path(root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    bundle = root / "synthetic-bundle"
    if bundle.exists():
        shutil.rmtree(bundle)
    shutil.copytree(FIXTURE, bundle)
    print(bundle)
    return bundle


if __name__ == "__main__":
    prepare(sys.argv[1])
