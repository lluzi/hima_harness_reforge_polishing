#!/usr/bin/env python3
"""v20 -> v21 text transform of the atcs `xtop-operator` wrapper (ATCS-09, after Q1/T07).

    derive-v21.py <v20-in> <v21-out> <flow-digest> <adapter-sha256> [--template]

Changes, and only these, each with a count assertion: the header comment names v21; atcs-v20 paths -> atcs-v21 (4) and
the wrapper name (2); the flow_digest and adapter_sha256 pins (1 each; the template keeps its placeholders). v21 pins the
flow whose atcs_point reads the summarize_gba_violations endpoint table, whose atcs_ref prints the Site hold-cell list,
whose atcs_close writes a skipped after.dump/export, and whose replay reads only the last fix flow's check (Q1 repairs).
Everything else, the static-only verifier pin included, is carried over byte for byte.
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
replace("# candidate `xtop-operator` interactive tool. v20 (Issue 64 / ATCS-09, before Q1/T07, Pack 0.2.0) is v19 with the\n"
        "# atcs-v20 paths and the flow/adapter pins of the flow whose XTop adapter reads per-target slack, sends pin-scoped\n",
        "# candidate `xtop-operator` interactive tool. v21 (Issue 64 / ATCS-09, after Q1/T07, Pack 0.2.0) is v20 with the\n"
        "# atcs-v21 paths and the flow pin of the flow whose atcs_point reads the summarize_gba_violations endpoint table,\n"
        "# whose atcs_ref prints the Site hold-cell list and whose atcs_close writes a skipped after.dump/export (Q1 repairs).\n"
        "# v20 was v19 with the atcs-v20 paths and the flow/adapter pins of the flow whose XTop adapter reads per-target slack, sends pin-scoped\n", 1)
replace("operator-admin/atcs-v20/", "operator-admin/atcs-v21/", 4)
replace("atcs-xtop-operator-v20.sh", "atcs-xtop-operator-v21.sh", 2)
if not template:
    replace("flow_digest='5ec10d9cfbd76463df046a61ede271b6ddadf4bd5cbf6e271c4034ce25a42b36'", f"flow_digest='{flow}'", 1)
    replace("adapter_sha256='669acfb86175778aa0f449c47bcbb40b9791b4cf0ccab83bd897b73558aaac29'", f"adapter_sha256='{adapter}'", 1)
else:
    for k in ('ATCS-FLOW-DIGEST','ATCS-CLI-SHA256'): assert f"<REPLACE-WITH-QUALIFIED-{k}>" in text
open(out, "w", encoding="utf-8").write(text)
