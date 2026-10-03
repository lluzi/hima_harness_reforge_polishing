#!/usr/bin/env python3
"""v15 -> v16 text transform of the atcs `xtop-operator` wrapper (Issue #64 / ATCS-09 spec #66, before treatment T05).

    derive-v16.py <v15-in> <v16-out> <flow-digest> [--template]

Applied to the INSTALLED v15 bytes, and (with --template) to the repository's v15 template to produce the v16
template. Changes, and only these, each with a count assertion:
  - the header comment says what v16 is;
  - the atcs-v15 paths -> atcs-v16 (4) and the wrapper name (2);
  - the flow_digest pin 31fbee294260... -> <flow-digest> (1; the template keeps its placeholder).
Every other pin (image, adapter, verifier, slot step, Site profile), every podman option and the whole v14/v15
close behaviour are carried over byte for byte.
"""
import re, sys

src, out, digest = sys.argv[1:4]
template = '--template' in sys.argv[4:]
assert re.fullmatch(r'[0-9a-f]{64}', digest), digest
text = open(src, encoding="utf-8").read()


def replace(old, new, count):
    global text
    assert text.count(old) == count, (old[:80], text.count(old))
    text = text.replace(old, new)


replace(
    "# candidate `xtop-operator` interactive tool. v15 (Issue 64 before treatment attempt 4, Pack 0.2.0 at 9fd1331e) is\n"
    "# v14 with the atcs-v15 paths and one pin changed: `flow_digest` names the Pack flow whose Operator template states\n"
    "# the dump names `before.dump`/`after.dump` exactly and whose `atcs_dump_cells` refuses any other name (treatment\n"
    "# attempt 3, D-T03-2). The close behaviour is v14's: the container runs in the background, HUP, TERM, INT or EOF on\n"
    "# stdin stop it, the wrapper checks that no process of it remains and exits 0; the container name and XTop pid are\n"
    "# written to `<slot>/session.json`. Its call shape is `<wrapper> <workspace> <slot>` and\n",
    "# candidate `xtop-operator` interactive tool. v16 (Issue 64 / ATCS-09 spec #66, before treatment T05, Pack 0.2.0) is\n"
    "# v15 with the atcs-v16 paths and one pin changed: `flow_digest` names the Pack flow whose sessions derive their\n"
    "# cluster's local-topology edit domain (domain.json), read single endpoints (atcs_point), log their reads and seal\n"
    "# batch Contributions, and whose replay enters the sealed effective domain. The close behaviour is v14's: the\n"
    "# container runs in the background, HUP, TERM, INT or EOF on stdin stop it, the wrapper checks that no process of it\n"
    "# remains and exits 0; the container name and XTop pid are written to `<slot>/session.json`. Its call shape is `<wrapper> <workspace> <slot>` and\n",
    1)
replace("operator-admin/atcs-v15/", "operator-admin/atcs-v16/", 4)
replace("atcs-xtop-operator-v15.sh", "atcs-xtop-operator-v16.sh", 2)
if not template:
    replace("flow_digest='31fbee29426050760786f6d61c477f742b1591bf91b5dc06cf5ff0d422d6ce04'",
            f"flow_digest='{digest}'", 1)
else:
    assert "flow_digest='<REPLACE-WITH-QUALIFIED-ATCS-FLOW-DIGEST>'" in text
open(out, "w", encoding="utf-8").write(text)
