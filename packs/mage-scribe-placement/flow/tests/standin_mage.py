#!/usr/bin/env python3
"""Stand-in MAGE interpreter used only by tests (no MAGE licence on this Mac).

Invoked exactly as the real vendor binary would be: `<this> <script.tcl>
-noterm`. It does not parse Tcl in general — only the brace-quoted forms
this Pack's round templates in `flow/templates/` actually produce, matched
with plain regexes. It replays a round deterministic enough for
`MageSession` and its callers to exercise the whole round lifecycle
(exports, native-check markers, summary, round log) without a licence.

It emulates the Site's proven native route: the `verify-all` template runs
`frbCheckOverlap`/`frbCheckSpace`/`frbCheckBoundary` and the driver writes
each check's `verify-<TYPE>.txt` from the `MAGE_VERIFY_*` markers printed to
stdout — so this stand-in prints those markers (and each check's own
`-print` summary line) rather than writing verify files itself.

Lines the fill and experiment stages add (`smPFlow -autoRefine`,
`smPFlow -setAutoRefineSimpleConverge`, `g_params -set ...`, a sourced
`experiment.tcl`) have no effect here and must not stop the run — the
stand-in simply ignores every line it does not recognise and still exits 0.

Env knobs:
- `MAGE_STANDIN_ROWS` — JSON `{TYPE: ["row", ...]}`; the count of rows for a
  type becomes that check's reported instance count (and the rows are
  printed as the check's detail lines). Default: no rows for any type -> 0.
- `MAGE_STANDIN_FAIL=1` — print `MAGE_ROUND_ERROR` to stderr and exit 2
  before writing any export or marker, as a real round that fails
  mid-script would.
- `MAGE_STANDIN_VERIFY_FAIL=<TYPE>` — that check's `MAGE_VERIFY_CODE` line
  reports `1` (a failed catch), so the driver writes no `verify-<TYPE>.txt`
  and the fact stays unknown.
- `MAGE_STANDIN_NO_END=1` — run and export normally but do NOT print the
  `MAGE_ROUND_END code 0` completion marker, as the vendor launcher's
  unconditional `exit 0` would mask a mid-script failure that never reached
  the end marker. Still exits 0.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import pla  # noqa: E402


_SOURCE_RE = re.compile(r"(?m)^source\s+\{([^}]*)\}")
_SAVE_MARK_RE = re.compile(r"smPInstMgr\s+-saveMark\s+\{([^}]*)\}")
_SAVE_PLA_DBU_RE = re.compile(r"smPInstMgr\s+-savePlaDBU\s+\{([^}]*)\}")
_VERIFY_FOREACH_RE = re.compile(
    r"foreach\s+\{mage_verify_type mage_verify_cmd\}\s+\{([^}]*)\}"
)
_SUMMARY_RE = re.compile(r"smPFlow\s+-saveSummary\s+\{([^}]*)\}")

DBU_PER_UM = 10000

# Each native check's own `-print` summary phrasing (between the leading
# instance count and the trailing `instance(s)`), as the real tool prints it.
_SUMMARY_PHRASE = {
    "OVERLAP": "overlapped",
    "SPACE": "spacing overlapped",
    "BOUNDARY": "outside-frame-boundary",
}


def _verify_pairs(script_text):
    """`[(TYPE, cmd), ...]` from the verify-all foreach, in script order."""
    match = _VERIFY_FOREACH_RE.search(script_text)
    if not match:
        return []
    tokens = match.group(1).split()
    return list(zip(tokens[0::2], tokens[1::2]))


def main(argv):
    if len(argv) < 1:
        sys.stderr.write("usage: standin_mage.py <script.tcl> -noterm\n")
        return 2
    script_path = Path(argv[0])
    script_text = script_path.read_text(encoding="utf-8")

    if os.environ.get("MAGE_STANDIN_FAIL") == "1":
        sys.stderr.write("MAGE_ROUND_ERROR stage standin message forced\n")
        return 2

    source_match = _SOURCE_RE.search(script_text)
    source_text = Path(source_match.group(1)).read_text(encoding="utf-8") if source_match else None

    for mark_match in _SAVE_MARK_RE.finditer(script_text):
        target = Path(mark_match.group(1))
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(source_text if source_text is not None else "", encoding="utf-8")

    dbu_match = _SAVE_PLA_DBU_RE.search(script_text)
    if dbu_match and source_text is not None:
        target = Path(dbu_match.group(1))
        target.parent.mkdir(parents=True, exist_ok=True)
        doc = pla.read_pla(source_text, DBU_PER_UM)
        target.write_text(pla.write_pla(doc, DBU_PER_UM, units="dbu"), encoding="utf-8")

    rows_by_type = {}
    raw_rows = os.environ.get("MAGE_STANDIN_ROWS")
    if raw_rows:
        rows_by_type = json.loads(raw_rows)
    verify_fail = os.environ.get("MAGE_STANDIN_VERIFY_FAIL")

    table_counts = []
    for type_name, _cmd in _verify_pairs(script_text):
        rows = rows_by_type.get(type_name, [])
        print("MAGE_VERIFY_BEGIN %s" % type_name)
        for row in rows:
            print(row)
        phrase = _SUMMARY_PHRASE.get(type_name, "offending")
        print("%d %s instance(s)" % (len(rows), phrase))
        code = 1 if verify_fail == type_name else 0
        print("MAGE_VERIFY_CODE %s %d" % (type_name, code))
        print("MAGE_VERIFY_END %s" % type_name)
        table_counts.append((type_name, len(rows)))

    summary_match = _SUMMARY_RE.search(script_text)
    if summary_match:
        target = Path(summary_match.group(1))
        target.parent.mkdir(parents=True, exist_ok=True)
        lines = ["%s: %d" % (type_name, count) for type_name, count in table_counts]
        target.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")

    if os.environ.get("MAGE_STANDIN_NO_END") != "1":
        print("MAGE_ROUND_END code 0")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
