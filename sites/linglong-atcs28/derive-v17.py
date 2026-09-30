#!/usr/bin/env python3
"""v16 -> v17 text transform of the atcs `xtop-operator` wrapper (ATCS-09 spec #66, before treatment T05).

    derive-v17.py <v16-in> <v17-out> <adapter-sha256> [--template]

Changes, and only these, each with a count assertion: the header comment names v17; atcs-v16 paths -> atcs-v17 (4)
and the wrapper name (2); the adapter_sha256 pin 2b001eda... -> <adapter-sha256> (1; the template keeps its
placeholder). v16 already pins the ATCS-09 flow digest; v17 adds the matching adapter (flow/atcs_cli.py) pin, which
tickets #67/#69/#71/#73 changed. Everything else is carried over byte for byte.
"""
import re, sys
src, out, adapter = sys.argv[1:4]
template = '--template' in sys.argv[4:]
assert re.fullmatch(r'[0-9a-f]{64}', adapter), adapter
text = open(src, encoding="utf-8").read()
def replace(old, new, count):
    global text
    assert text.count(old) == count, (old[:80], text.count(old))
    text = text.replace(old, new)
replace("# candidate `xtop-operator` interactive tool. v16 (Issue 64 / ATCS-09 spec #66, before treatment T05, Pack 0.2.0) is\n"
        "# v15 with the atcs-v16 paths and one pin changed: `flow_digest` names the Pack flow whose sessions derive their\n",
        "# candidate `xtop-operator` interactive tool. v17 (Issue 64 / ATCS-09 spec #66, before treatment T05, Pack 0.2.0) is\n"
        "# v16 with the atcs-v17 paths and the `adapter_sha256` pin of the ATCS-09 flow/atcs_cli.py (v16 pinned only the\n"
        "# flow digest). v16 is v15 with one pin changed: `flow_digest` names the Pack flow whose sessions derive their\n", 1)
replace("operator-admin/atcs-v16/", "operator-admin/atcs-v17/", 4)
replace("atcs-xtop-operator-v16.sh", "atcs-xtop-operator-v17.sh", 2)
if not template:
    replace("adapter_sha256='2b001eda4ad4634208babf61b5bd8bdd64784c1b4eb3be95a9c188f6c421449a'", f"adapter_sha256='{adapter}'", 1)
else:
    assert "adapter_sha256='<REPLACE-WITH-QUALIFIED-ATCS-CLI-SHA256>'" in text
open(out, "w", encoding="utf-8").write(text)
