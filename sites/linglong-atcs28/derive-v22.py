#!/usr/bin/env python3
"""v21 -> v22 text transform for the ATCS Operator wrapper.

    derive-v22.py <v21-in> <v22-out> <flow-digest> <adapter-sha256> [--template]

v22 changes only candidate identity: path/name and the pinned Pack flow and adapter bytes. It carries
v21's Q1 repairs, confinement, static verifier, slot hygiene and close behavior byte for byte.
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
    "# candidate `xtop-operator` interactive tool. v21 (Issue 64 / ATCS-09, after Q1/T07, Pack 0.2.0) is v20 with the\n"
    "# atcs-v21 paths and the flow pin of the flow whose atcs_point reads the summarize_gba_violations endpoint table,\n"
    "# whose atcs_ref prints the Site hold-cell list and whose atcs_close writes a skipped after.dump/export (Q1 repairs).\n",
    "# candidate `xtop-operator` interactive tool. v22 (Issue 64 / ATCS-09, Pack 0.2.1) is v21 with the atcs-v22 paths\n"
    "# and the flow/adapter pins of the role/context-optimized flow whose atcs_paths typed read returns the bounded\n"
    "# analysis report body. v21 carried the summarize endpoint-table point read and the other Q1 repairs.\n",
    1,
)
replace("operator-admin/atcs-v21/", "operator-admin/atcs-v22/", 4)
replace("atcs-xtop-operator-v21.sh", "atcs-xtop-operator-v22.sh", 2)
if not template:
    replace("flow_digest='09781f2eaa78475a02c06ef7fb170b5e17d494691167b420da7d0afdeff7dfe0'", f"flow_digest='{flow}'", 1)
    replace("adapter_sha256='669acfb86175778aa0f449c47bcbb40b9791b4cf0ccab83bd897b73558aaac29'", f"adapter_sha256='{adapter}'", 1)
else:
    for key in ("ATCS-FLOW-DIGEST", "ATCS-CLI-SHA256"):
        assert f"<REPLACE-WITH-QUALIFIED-{key}>" in text

open(out, "w", encoding="utf-8").write(text)
