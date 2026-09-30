#!/usr/bin/env python3
"""v18 -> v19 text transform of the atcs `xtop-operator` wrapper (ATCS-09, before T06).

    derive-v19.py <v18-in> <v19-out> <flow-digest> <adapter-sha256> [--template]

Changes, and only these, each with a count assertion: the header comment names v19; atcs-v18 paths -> atcs-v19 (4) and
the wrapper name (2); the flow_digest and adapter_sha256 pins (1 each; the template keeps its placeholders). v19 pins the
flow whose reads resolve an instance or check key to its pins in-session and whose plans always emit target pins.
Everything else (the static-only verifier pin included) is carried over byte for byte.
"""
import re, sys
src, out, flow, adapter = sys.argv[1:5]
template = '--template' in sys.argv[5:]
for v in (flow, adapter): assert re.fullmatch(r'[0-9a-f]{64}', v), v
text = open(src, encoding="utf-8").read()
def replace(old, new, count):
    global text
    assert text.count(old) == count, (old[:80], text.count(old))
    text = text.replace(old, new)
replace("# candidate `xtop-operator` interactive tool. v18 (Issue 64 / ATCS-09 superseding decision, before T06, Pack 0.2.0) is\n"
        "# v17 with the atcs-v18 paths and three pins moved:",
        "# candidate `xtop-operator` interactive tool. v19 (Issue 64 / ATCS-09, before T06, Pack 0.2.0) is v18 with the atcs-v19\n"
        "# paths and the flow/adapter pins of the flow whose reads resolve an instance or check key to its pins in-session\n"
        "# (L4 run 4 gap). v18 was v17 with the atcs-v18 paths and three pins moved:", 1)
replace("operator-admin/atcs-v18/", "operator-admin/atcs-v19/", 4)
replace("atcs-xtop-operator-v18.sh", "atcs-xtop-operator-v19.sh", 2)
if not template:
    replace("flow_digest='2835a2c3d4ce57e2dd3280521bc388a3182fb75b51e9cfa09209be2533eb1291'", f"flow_digest='{flow}'", 1)
    replace("adapter_sha256='48386a413919e0403dc141c48ac92716dadc90f048576a4946983581500276c5'", f"adapter_sha256='{adapter}'", 1)
else:
    for k in ('ATCS-FLOW-DIGEST','ATCS-CLI-SHA256'): assert f"<REPLACE-WITH-QUALIFIED-{k}>" in text
open(out, "w", encoding="utf-8").write(text)
