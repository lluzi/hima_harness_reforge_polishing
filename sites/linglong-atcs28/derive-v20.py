#!/usr/bin/env python3
"""v19 -> v20 text transform of the atcs `xtop-operator` wrapper (ATCS-09, before Q1/T07).

    derive-v20.py <v19-in> <v20-out> <flow-digest> <adapter-sha256> [--template]

Changes, and only these, each with a count assertion: the header comment names v20; atcs-v19 paths -> atcs-v20 (4) and
the wrapper name (2); the flow_digest and adapter_sha256 pins (1 each; the template keeps its placeholders). v20 pins the
flow whose XTop adapter reads per-target slack, sends pin-scoped fixes, dummy and delay-chain cell lists in the documented
forms, keeps a real insertion, and whose composition treats trace-mismatch as advice (T06 repairs). Everything else,
the static-only verifier pin included, is carried over byte for byte.
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
replace("# candidate `xtop-operator` interactive tool. v19 (Issue 64 / ATCS-09, before T06, Pack 0.2.0) is v18 with the atcs-v19\n"
        "# paths and the flow/adapter pins of the flow whose reads resolve an instance or check key to its pins in-session\n",
        "# candidate `xtop-operator` interactive tool. v20 (Issue 64 / ATCS-09, before Q1/T07, Pack 0.2.0) is v19 with the\n"
        "# atcs-v20 paths and the flow/adapter pins of the flow whose XTop adapter reads per-target slack, sends pin-scoped\n"
        "# fixes, dummy and delay-chain cell lists in the documented forms and keeps a real insertion (T06 repairs). v19 was\n"
        "# v18 with the atcs-v19 paths and the flow/adapter pins of the flow whose reads resolve an instance or check key to its pins in-session\n", 1)
replace("operator-admin/atcs-v19/", "operator-admin/atcs-v20/", 4)
replace("atcs-xtop-operator-v19.sh", "atcs-xtop-operator-v20.sh", 2)
if not template:
    replace("flow_digest='3e8a24fbfc3cc098bf09d637ad00d6b4c88c7557ede8467503457d69323363d1'", f"flow_digest='{flow}'", 1)
    replace("adapter_sha256='48386a413919e0403dc141c48ac92716dadc90f048576a4946983581500276c5'", f"adapter_sha256='{adapter}'", 1)
else:
    for k in ('ATCS-FLOW-DIGEST','ATCS-CLI-SHA256'): assert f"<REPLACE-WITH-QUALIFIED-{k}>" in text
open(out, "w", encoding="utf-8").write(text)
