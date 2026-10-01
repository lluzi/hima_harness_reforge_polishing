#!/usr/bin/env python3
"""v22 -> v23 text transform for the ATCS Operator wrapper.

    derive-v23.py <v22-in> <v23-out> <flow-digest> <adapter-sha256> [--template]

v23 changes only candidate identity: path/name and the pinned Pack flow and adapter bytes. It carries
v22's confinement, confinement, static verifier, slot hygiene and close behavior byte for byte.
"""
import re
import sys

src, out, flow, adapter = sys.argv[1:5]
template = "--template" in sys.argv[5:]
for value in (flow, adapter):
    assert re.fullmatch(r"[0-9a-f]{64}", value), value

text = open(src, encoding="utf-8").read()

def replace(old, new, count):
    global text
    assert text.count(old) == count, (old[:100], text.count(old))
    text = text.replace(old, new)

replace(
    "# candidate `xtop-operator` interactive tool. v22 (Issue 64 / ATCS-09, Pack 0.2.1) is v21 with the atcs-v22 paths\n"
    "# and the flow/adapter pins of the role/context-optimized flow whose atcs_paths typed read returns the bounded\n"
    "# analysis report body. v21 carried the summarize endpoint-table point read and the other Q1 repairs.\n",
    "# candidate `xtop-operator` interactive tool. v23 (Issue 66 / ATCS-09, Pack 0.2.2) is v22 with the atcs-v23 paths\n"
    "# and pins of the replayable-Contribution flow: no worker saved DB dependency, repeatable ECO export and\n"
    "# close-time refresh after later mutations. Confinement, verifier, slot hygiene and transport cleanup stay unchanged.\n",
    1,
)
replace("operator-admin/atcs-v22/", "operator-admin/atcs-v23/", 4)
replace("atcs-xtop-operator-v22.sh", "atcs-xtop-operator-v23.sh", 2)
if not template:
    replace("flow_digest='86c37b9808d8577ef54dc0157ea9c2ee418d2ded8f721adc67d27151562034a5'", f"flow_digest='{flow}'", 1)
    replace("adapter_sha256='669acfb86175778aa0f449c47bcbb40b9791b4cf0ccab83bd897b73558aaac29'", f"adapter_sha256='{adapter}'", 1)
else:
    for key in ("ATCS-FLOW-DIGEST", "ATCS-CLI-SHA256"):
        assert f"<REPLACE-WITH-QUALIFIED-{key}>" in text

open(out, "w", encoding="utf-8").write(text)
