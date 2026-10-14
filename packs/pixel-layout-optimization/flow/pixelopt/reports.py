"""Parsers for the commercial EDA tools' own reports (stdlib only).

Each function reads one report file in the exact format the tool writes (the
formats were learned, read-only, from the reference Site; no customer text,
value or file name is copied here). They return plain data; the judge records
it and the ``pixel-receipt`` Reader re-parses it.

Report formats
--------------
* **Argus DRC summary** (``argus_drc.sum``): a ``DRC Flat SUMMARY REPORT`` with a
  ``RULE RESULTS INFORMATION`` block of ``RULE NAME <id> ---- Result Count = N``
  lines and a ``SUMMARY`` block ending ``ALL DRC Results: <N>``.
* **Calibre LVS report** (``lvs.rep``): an ``OVERALL COMPARISON RESULTS`` banner
  that reads ``CORRECT`` or ``INCORRECT`` and a ``CELL SUMMARY`` table.
* **RCExplorer result** (``RCEResult.sp``): a SPICE subckt of two-terminal
  ``C_<a>_<b> <neta> <netb> <value_in_farads>`` cards.
* **Tool logs** (``argus.log`` / ``cal.log`` / ``gdsin.log`` / ``rce.log``): carry
  a version banner each.
"""
from __future__ import annotations

import os
import re

from .core import PixelError

__all__ = ["argus_summary", "calibre_lvs", "rce_caps", "tool_versions"]

_RULE_RESULT_RE = re.compile(r"RULE NAME (\S+) -+ Result Count = (\d+)")
_ALL_RESULTS_RE = re.compile(r"ALL DRC Results:\s+(\d+)")


def _read(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except OSError as exc:
        raise PixelError("tool-failed", "cannot read report %s: %s" % (path, exc))


def argus_summary(path):
    """Parse an Argus ``.sum`` into ``{"total": int, "byRule": {rule: count}}``.

    ``total`` is the deck's ``ALL DRC Results`` line (the authoritative count),
    falling back to the sum of the per-rule counts when that line is absent.
    Raises ``PixelError`` when the file cannot be read or has no rule-result
    block at all (an unreadable or truncated summary is not a clean result).
    """
    text = _read(path)
    by_rule = {}
    for m in _RULE_RESULT_RE.finditer(text):
        by_rule[m.group(1)] = int(m.group(2))
    mt = _ALL_RESULTS_RE.search(text)
    if mt is not None:
        total = int(mt.group(1))
    elif by_rule:
        total = sum(by_rule.values())
    else:
        raise PixelError("tool-failed",
                         "argus summary %s has no rule results" % path)
    return {"total": total, "byRule": by_rule}


def calibre_lvs(path):
    """Parse a Calibre LVS report into ``{"correct": bool, "lines": [...]}``.

    ``correct`` is true only when the report states a comparison result and that
    result is ``CORRECT`` with no ``INCORRECT`` anywhere; any ``INCORRECT`` makes
    it false. ``lines`` are the comparison-verdict lines, kept for diagnostics.
    """
    text = _read(path)
    lines = [ln.strip() for ln in text.splitlines()
             if re.search(r"CORRECT|INCORRECT|NOT COMPARED|discrepan", ln)]
    has_correct = re.search(r"\bCORRECT\b", text) is not None
    has_incorrect = re.search(r"\bINCORRECT\b", text) is not None
    correct = has_correct and not has_incorrect
    return {"correct": correct, "lines": lines}


def rce_caps(path):
    """Parse ``RCEResult.sp`` into ``{"<a>|<b>": fF}`` (sorted net pair keys).

    Each ``C... <neta> <netb> <farads>`` card contributes; parallel cards on the
    same pair are summed. Values are converted farads -> femtofarads. An empty
    result (no cards) returns ``{}`` so the Reader can report ``null`` coupling
    rather than a false zero. ``RCE_UNCONN_*`` pseudo-nodes are retained in the
    returned map; callers exclude them from net totals.
    """
    text = _read(path)
    caps = {}
    for line in text.splitlines():
        toks = line.split()
        if len(toks) == 4 and toks[0][:1].upper() == "C":
            try:
                farads = float(toks[3])
            except ValueError:
                continue
            key = "|".join(sorted(toks[1:3]))
            caps[key] = caps.get(key, 0.0) + farads * 1e15
    return caps


_VERSION_PATTERNS = [
    ("argus", re.compile(r"ARGUS Version:\s*(.+)")),
    ("calibre", re.compile(r"CALIBRE VERSION:\s*(\S+)")),
    ("tool", re.compile(r"Tool:\s*(\S+)\s+([0-9][0-9A-Za-z.\-_]*)")),
    ("empyrean", re.compile(r"Version\s+(20[0-9]{2}\.[0-9A-Za-z.\-_]+)")),
]


def tool_versions(log_text):
    """Best-effort ``{tool_name: version}`` scraped from a tool log banner.

    Never raises: a log without a recognisable banner yields ``{}``. The
    ``Tool: <name> <version>`` banner (gdsIn / rcexplorer) names its own tool.
    """
    out = {}
    if not log_text:
        return out
    m = _VERSION_PATTERNS[0][1].search(log_text)
    if m:
        out["argus"] = m.group(1).strip()
    m = _VERSION_PATTERNS[1][1].search(log_text)
    if m:
        out["calibre"] = m.group(1).strip()
    m = _VERSION_PATTERNS[2][1].search(log_text)
    if m:
        out[m.group(1).strip()] = m.group(2).strip()
    if not out:
        m = _VERSION_PATTERNS[3][1].search(log_text)
        if m:
            out["version"] = m.group(1).strip()
    return out
