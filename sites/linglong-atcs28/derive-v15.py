#!/usr/bin/env python3
"""v14 -> v15 text transform of the atcs `xtop-operator` wrapper (Issue #64, before treatment attempt 4).

    derive-v15.py <v14-in> <v15-out> [--template]

Applied to the INSTALLED v14 bytes, and (with --template) to the repository's v14 template to produce the v15
template. Changes, and only these, each with a count assertion:
  - the header comment says what v15 is;
  - the atcs-v14 paths -> atcs-v15 (4) and the wrapper name (2);
  - the flow_digest pin a47368518262... -> 31fbee294260... (1; the template keeps its placeholder).
Every other pin (image, adapter, verifier, slot step, Site profile), every podman option and the whole v14
close behaviour are carried over byte for byte.
"""
import sys

src, out = sys.argv[1:3]
template = '--template' in sys.argv[3:]
text = open(src, encoding="utf-8").read()


def replace(old, new, count):
    global text
    assert text.count(old) == count, (old[:80], text.count(old))
    text = text.replace(old, new)


replace(
    "# candidate `xtop-operator` interactive tool. v14 (Issue 64 before treatment attempt 3, Pack 0.2.0) is v13 with the\n"
    "# atcs-v14 paths and one change to how a session ends: the container runs in the background and the wrapper waits\n"
    "# on it, so a close reaches the wrapper at once (treatment attempt 2: v13 ran podman in the foreground, its trap\n"
    "# fired only after podman returned, and every Harness close left the container and its XTop running). HUP, TERM,\n"
    "# INT or EOF on stdin stop the container, the wrapper checks that no process of it remains and exits 0; the\n"
    "# container name and XTop pid are written to `<slot>/session.json`. Its call shape is `<wrapper> <workspace> <slot>` and\n",
    "# candidate `xtop-operator` interactive tool. v15 (Issue 64 before treatment attempt 4, Pack 0.2.0 at 9fd1331e) is\n"
    "# v14 with the atcs-v15 paths and one pin changed: `flow_digest` names the Pack flow whose Operator template states\n"
    "# the dump names `before.dump`/`after.dump` exactly and whose `atcs_dump_cells` refuses any other name (treatment\n"
    "# attempt 3, D-T03-2). The close behaviour is v14's: the container runs in the background, HUP, TERM, INT or EOF on\n"
    "# stdin stop it, the wrapper checks that no process of it remains and exits 0; the container name and XTop pid are\n"
    "# written to `<slot>/session.json`. Its call shape is `<wrapper> <workspace> <slot>` and\n",
    1)
replace("operator-admin/atcs-v14/", "operator-admin/atcs-v15/", 4)
replace("atcs-xtop-operator-v14.sh", "atcs-xtop-operator-v15.sh", 2)
if not template:
    replace("flow_digest='a47368518262c91b5524a65814a29a0ec39a2ef46741c0c7a47d534f8159b0cc'",
            "flow_digest='31fbee29426050760786f6d61c477f742b1591bf91b5dc06cf5ff0d422d6ce04'", 1)
else:
    assert "flow_digest='<REPLACE-WITH-QUALIFIED-ATCS-FLOW-DIGEST>'" in text
open(out, "w", encoding="utf-8").write(text)
