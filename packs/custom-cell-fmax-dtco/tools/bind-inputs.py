#!/usr/bin/env python3
# The executed copy is deployed to WORKSPACE/flow/bind-inputs.py by workspace.source=pack.
# This transparent wrapper executes the Pack-owned adapter that is deployed into the Campaign workspace.
from pathlib import Path
exec((Path(__file__).parents[1] / "flow" / "bind-inputs.py").read_text(), {"__name__": "__main__", "__file__": str(Path(__file__).parents[1] / "flow" / "bind-inputs.py")})
