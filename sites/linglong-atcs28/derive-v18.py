#!/usr/bin/env python3
"""v17 -> v18 text transform of the atcs `xtop-operator` wrapper (ATCS-09 spec #66 superseding decision, before T06).

    derive-v18.py <v17-in> <v18-out> <flow-digest> <adapter-sha256> <verifier-sha256> [--template]

Changes, and only these, each with a count assertion: the header comment names v18; atcs-v17 paths -> atcs-v18 (4) and
the wrapper name (2); the flow_digest, adapter_sha256 and verifier_sha256 pins (1 each; the template keeps its
placeholders). v18's verifier does static checks only (identities, roots, required inputs, recorded sha of the prepared
session Tcl) and starts XTop from the prepared bytes: no dynamic-Tcl regeneration compare. Everything else is carried
over byte for byte.
"""
import re, sys
src, out, flow, adapter, verifier = sys.argv[1:6]
template = '--template' in sys.argv[6:]
for v in (flow, adapter, verifier): assert re.fullmatch(r'[0-9a-f]{64}', v), v
text = open(src, encoding="utf-8").read()
def replace(old, new, count):
    global text
    assert text.count(old) == count, (old[:80], text.count(old))
    text = text.replace(old, new)
replace("# candidate `xtop-operator` interactive tool. v17 (Issue 64 / ATCS-09 spec #66, before treatment T05, Pack 0.2.0) is\n"
        "# v16 with the atcs-v17 paths and the `adapter_sha256` pin of the ATCS-09 flow/atcs_cli.py (v16 pinned only the\n",
        "# candidate `xtop-operator` interactive tool. v18 (Issue 64 / ATCS-09 superseding decision, before T06, Pack 0.2.0) is\n"
        "# v17 with the atcs-v18 paths and three pins moved: the flow digest and adapter of the best-effort-replay flow and the\n"
        "# verifier that does static checks only (no dynamic-Tcl regeneration compare). v17 was v16 with the atcs-v17 paths\n"
        "# and the `adapter_sha256` pin of the ATCS-09 flow/atcs_cli.py (v16 pinned only the\n", 1)
replace("operator-admin/atcs-v17/", "operator-admin/atcs-v18/", 4)
replace("atcs-xtop-operator-v17.sh", "atcs-xtop-operator-v18.sh", 2)
if not template:
    replace("flow_digest='476ebdb793ba1a09c88bf6454cd0af4d0501ab4f46c1f227678510ac84d8f9fd'", f"flow_digest='{flow}'", 1)
    replace("adapter_sha256='98be15132d8c1444d6ebc704d099d34b478a17deedfa1f81ef1bf708a18598d0'", f"adapter_sha256='{adapter}'", 1)
    replace("verifier_sha256='014fcfa5ec6e9612f66d5837968ff1eeed65a7c16b6d445501d96f4ab1c5c92f'", f"verifier_sha256='{verifier}'", 1)
else:
    for k in ('ATCS-FLOW-DIGEST','ATCS-CLI-SHA256','VERIFIER-SHA256'): assert f"<REPLACE-WITH-QUALIFIED-{k}>" in text
open(out, "w", encoding="utf-8").write(text)
