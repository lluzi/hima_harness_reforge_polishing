"""PrimeTime (PT) report parsers.

Grammar ported and adapted (read-only reference, not imported) from
``packs/xtop-timing-closure/flow/closure.py``'s ``parse_global`` and
``parse_endpoints``, and cross-checked against the synthesized fixtures at
``packs/xtop-timing-closure/flow/tests/test_closure.py:26-58``
(``global_report``, ``path_report``). This module never imports from the old
Pack; it re-implements the same report grammar under the new fail-closed
Measure contract (`atcs.core.known`/`unknown`) required for this Pack.

Three report kinds are parsed:

- ``global_timing.rpt`` — via `parse_global_timing`. Two blocks
  (``Setup violations`` / ``Hold violations``), each either a
  ``No <mode> violations found.`` line (explicit zero) or a
  ``WNS``/``TNS``/``NUM`` table. Returns
  ``{"setup": {"wns": Measure, "tns": Measure, "violations": Measure},
  "hold": {...}}``. A block that is neither an explicit-zero line nor a
  parseable table (e.g. the ``Hold violations`` section is entirely absent
  from the text) yields `unknown` Measures for all three fields of that
  mode, never a silently-assumed zero. A field whose text is non-finite
  (``inf``/``nan``, in any case) also yields `unknown` rather than a
  numeric value — Python's ``float()`` happily parses those strings, so
  this is checked explicitly.

- ``setup.rpt`` / ``hold.rpt`` (worst-path reports) — via
  `parse_path_report`. Splits the text on ``Startpoint:`` markers (each
  block then holds one path's ``Startpoint``, ``Endpoint``, ``Path Group``,
  ``Path Type`` and ``slack (VIOLATED) <value>`` lines). Returns
  ``{"paths": [{"endpoint", "startpoint", "pathGroup", "slack"}, ...],
  "complete": bool}``.

  ``complete`` is `False` when either:
  (a) the parsed path count reaches `max_paths` (the tool's own cap was
      hit, so more paths may exist beyond what was reported), or
  (b) the report's last block is missing required fields (the report file
      was truncated mid-path, e.g. the tool was killed while writing).
  A non-trailing block missing required fields is not a truncation — it is
  a malformed report — and raises `AtcsError("malformed-report", ...)`.

  This Pack's check key (`atcs.core.check_key`) is
  ``"<scenario>|<mode>|<endpoint>"`` and deliberately does **not** include
  the path group. Two rows in the *same* report sharing an endpoint would
  therefore silently collide into one check if kept — instead
  `parse_path_report` refuses the whole report with
  `AtcsError("duplicate-check", <endpoint>)`. `mode` must be `"setup"` or
  `"hold"`; a row's `Path Type` (`max` for setup, `min` for hold) is
  cross-checked against `mode` and a mismatch raises
  `AtcsError("identity-mismatch", ...)` — a real PT report never mixes
  these, so a mismatch means the wrong file was fed to the wrong `mode`.

- ``check_timing.rpt`` — via `parse_check_timing`, looking for
  ``There are <N> endpoints which are not constrained``. Returns
  ``{"unconstrainedEndpoints": Measure}``. Per the fail-closed rule, `0` is
  only produced when the report explicitly states a count of 0 for that
  line; a report with no such line at all (never generated, or a different
  tool output entirely) yields `unknown`, unlike the old Pack's parser
  (`packs/xtop-timing-closure/flow/closure.py:unconstrained`) which
  defaulted a missing line to `0`.
"""
from __future__ import annotations

import math
import re

from . import core


_ZERO_VIOLATIONS_RE = {
    "setup": re.compile(r"(?mi)^\s*No setup violations found\.\s*$"),
    "hold": re.compile(r"(?mi)^\s*No hold violations found\.\s*$"),
}

_GLOBAL_BLOCK_RE = {
    "setup": re.compile(r"Setup violations\s*\n-+\n.*?\n-+\n(.*?)\n-+", re.S),
    "hold": re.compile(r"Hold violations\s*\n-+\n.*?\n-+\n(.*?)\n-+", re.S),
}

_STARTPOINT_SPLIT_RE = re.compile(r"(?m)^\s*Startpoint:\s*")
_STARTPOINT_VALUE_RE = re.compile(r"^\s*(\S+)")
_ENDPOINT_RE = re.compile(r"(?m)^\s*Endpoint:\s*(\S+)")
_PATH_GROUP_RE = re.compile(r"(?m)^\s*Path Group:\s*(\S+)")
_PATH_TYPE_RE = re.compile(r"(?m)^\s*Path Type:\s*(\S+)")
_SLACK_RE = re.compile(r"(?m)^\s*slack\s*\(VIOLATED\)\s+(-?[0-9.eE+]+)")
_UNCONSTRAINED_RE = re.compile(r"There are\s+(-?\d+)\s+endpoints which are not constrained")

_EXPECTED_PATH_TYPE = {"setup": "max", "hold": "min"}


def _finite_float_measure(raw):
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return core.unknown(f"unparsable-value: {raw!r}")
    if math.isnan(value) or math.isinf(value):
        return core.unknown(f"non-finite-value: {raw!r}")
    return core.known(value)


def _finite_int_measure(raw):
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return core.unknown(f"unparsable-value: {raw!r}")
    return core.known(value)


def parse_global_timing(text):
    """Parse a ``global_timing.rpt`` into `{"setup": {...}, "hold": {...}}` Measures."""
    result = {}
    for mode in ("setup", "hold"):
        if _ZERO_VIOLATIONS_RE[mode].search(text):
            result[mode] = {
                "wns": core.known(0.0),
                "tns": core.known(0.0),
                "violations": core.known(0),
            }
            continue
        block_match = _GLOBAL_BLOCK_RE[mode].search(text)
        if not block_match:
            reason = f"missing-{mode}-section"
            result[mode] = {
                "wns": core.unknown(reason),
                "tns": core.unknown(reason),
                "violations": core.unknown(reason),
            }
            continue
        body = block_match.group(1)
        wns_match = re.search(r"(?m)^WNS\s+(\S+)", body)
        tns_match = re.search(r"(?m)^TNS\s+(\S+)", body)
        num_match = re.search(r"(?m)^NUM\s+(\S+)", body)
        result[mode] = {
            "wns": _finite_float_measure(wns_match.group(1)) if wns_match else core.unknown("missing-wns-row"),
            "tns": _finite_float_measure(tns_match.group(1)) if tns_match else core.unknown("missing-tns-row"),
            "violations": _finite_int_measure(num_match.group(1)) if num_match else core.unknown("missing-num-row"),
        }
    return result


def parse_path_report(text, mode, max_paths):
    """Parse a worst-path report (``setup.rpt``/``hold.rpt``) into path rows + completeness."""
    if mode not in _EXPECTED_PATH_TYPE:
        raise core.AtcsError("invalid-mode", mode)
    if max_paths < 1:
        raise core.AtcsError("invalid-max-paths", str(max_paths))

    blocks = _STARTPOINT_SPLIT_RE.split(text)[1:]
    paths = []
    seen_endpoints = set()
    truncated = False
    total_blocks = len(blocks)

    for index, block in enumerate(blocks):
        is_last = index == total_blocks - 1
        startpoint_match = _STARTPOINT_VALUE_RE.search(block)
        endpoint_match = _ENDPOINT_RE.search(block)
        slack_match = _SLACK_RE.search(block)
        if not (startpoint_match and endpoint_match and slack_match):
            if is_last:
                truncated = True
                continue
            raise core.AtcsError("malformed-report", f"incomplete path block at index {index}")

        type_match = _PATH_TYPE_RE.search(block)
        if type_match and type_match.group(1) != _EXPECTED_PATH_TYPE[mode]:
            raise core.AtcsError(
                "identity-mismatch",
                f"path type {type_match.group(1)!r} does not match mode {mode!r}",
            )

        endpoint = endpoint_match.group(1)
        if endpoint in seen_endpoints:
            raise core.AtcsError("duplicate-check", endpoint)
        seen_endpoints.add(endpoint)

        try:
            slack = float(slack_match.group(1))
        except ValueError:
            raise core.AtcsError("malformed-report", f"unparsable slack {slack_match.group(1)!r}")
        if math.isnan(slack) or math.isinf(slack):
            raise core.AtcsError("malformed-report", f"non-finite slack {slack_match.group(1)!r}")

        group_match = _PATH_GROUP_RE.search(block)
        paths.append({
            "endpoint": endpoint,
            "startpoint": startpoint_match.group(1),
            "pathGroup": group_match.group(1) if group_match else "unknown",
            "slack": slack,
        })

    complete = (not truncated) and len(paths) < max_paths
    return {"paths": paths, "complete": complete}


def parse_check_timing(text):
    """Parse a ``check_timing.rpt`` into ``{"unconstrainedEndpoints": Measure}``."""
    match = _UNCONSTRAINED_RE.search(text)
    if not match:
        return {"unconstrainedEndpoints": core.unknown("missing-unconstrained-line")}
    return {"unconstrainedEndpoints": _finite_int_measure(match.group(1))}
