#!/usr/bin/env python3
"""The two Readers of the pixel-layout-optimization Pack, in one script.

The reader declarations (``readers/pixel-receipt.yml`` and
``readers/pixel-plan.yml``) both invoke this script with::

    [python3, '${READER}', receipt|plan, '${REPORT}', '${OUT}', '${WORKSPACE}']

so this script's own ``sys.argv`` is
``[read-pixel.py, <kind>, <report path>, <out path>, <workspace path>]``.

It is shipped alone into the Campaign workspace's ``hima-readers/<reader-id>/``
directory; ``workspace.source: pack`` copies this Pack's ``flow/`` into
``<workspace>/flow/``, so ``${WORKSPACE}`` (the fourth placeholder) lets the
script put ``<workspace>/flow`` on ``sys.path`` and import ``pixelopt.*`` as a
top-level package, the same way ``flow/tests/*`` do.

On success it writes ``{"values": [{"type","unit","value": number|null[,
"unknownReason"]}, ...]}`` to ``<out>`` and exits 0. Any refusal exits
non-zero (code 3) with a ``{"code","detail"}`` line on stderr and leaves
``<out>`` unwritten — fail closed, never a 0 exit carrying an unverified
reading. Standard library only.
"""
from __future__ import annotations

import json
import os
import sys


def _pixelopt(workspace):
    flow_dir = os.path.join(os.path.abspath(workspace), "flow")
    if flow_dir not in sys.path:
        sys.path.insert(0, flow_dir)
    import pixelopt.core as core
    return core


def _fail(code, detail):
    sys.stderr.write(json.dumps({"code": code, "detail": detail}, sort_keys=True) + "\n")
    return 3


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) != 4:
        return _fail("missing-input",
                     "usage: read-pixel.py <receipt|plan> <report> <out> <workspace>")
    kind, report_path, out_path, workspace = argv

    try:
        core = _pixelopt(workspace)
        from pixelopt.core import PixelError
    except ImportError as exc:
        return _fail("missing-input", "cannot import pixelopt from workspace: %s" % exc)

    readiness_path = os.path.join(os.path.abspath(workspace), "state", "case-readiness.json")
    try:
        readiness = core.read_json(readiness_path)
    except PixelError as exc:
        return _fail(exc.code, exc.detail)

    try:
        if kind == "receipt":
            from pixelopt import receipt
            values = receipt.reader_values(report_path, workspace, readiness)
        elif kind == "plan":
            from pixelopt import plan
            values = plan.reader_values(report_path, workspace, readiness)
        else:
            return _fail("missing-input", "unknown reader kind %r" % kind)
    except PixelError as exc:
        return _fail(exc.code, exc.detail)
    except (OSError, KeyError, TypeError, ValueError) as exc:
        return _fail("malformed-input", "%s: %s" % (type(exc).__name__, exc))

    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"values": values}, fh, sort_keys=True)
    os.replace(tmp, out_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
