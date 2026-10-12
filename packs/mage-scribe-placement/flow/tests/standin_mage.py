#!/usr/bin/env python3
"""Stand-in MAGE interpreter used only by tests (no MAGE licence on this Mac).

Invoked exactly as the real vendor binary would be: `<this> <script.tcl>
-noterm`. It does not parse Tcl in general — only the brace-quoted forms
the four round templates in `flow/templates/` actually produce, matched
with plain regexes. It replays a round deterministic enough for
`MageSession` and its callers to exercise the whole round lifecycle
(exports, verify reports, summary, round log) without a licence.

Env knobs:
- `MAGE_STANDIN_ROWS` — JSON `{TYPE: ["row", ...]}`; rows written under
  each verify file's header line. Default: no rows for any type.
- `MAGE_STANDIN_FAIL=1` — print `MAGE_ROUND_ERROR` to stderr and exit 2
  before writing any export, as a real round that fails mid-script would.
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
_VERIFY_RE = re.compile(r"smVerify\s+-checkType\s+(\S+)\s+-doCheck\s+-save\s+\{([^}]*)\}")
_SUMMARY_RE = re.compile(r"smPFlow\s+-saveSummary\s+\{([^}]*)\}")

DBU_PER_UM = 10000


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

    table_counts = []
    for match in _VERIFY_RE.finditer(script_text):
        type_name, file_field = match.group(1), match.group(2)
        target = Path(file_field)
        target.parent.mkdir(parents=True, exist_ok=True)
        rows = rows_by_type.get(type_name, [])
        lines = [f"# {type_name} rows"] + list(rows)
        target.write_text("\n".join(lines) + "\n", encoding="utf-8")
        table_counts.append((type_name, len(rows)))
        print(f"MAGE_VERIFY {type_name} code 0")

    summary_match = _SUMMARY_RE.search(script_text)
    if summary_match:
        target = Path(summary_match.group(1))
        target.parent.mkdir(parents=True, exist_ok=True)
        lines = [f"{type_name}: {count}" for type_name, count in table_counts]
        target.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")

    print("MAGE_ROUND_END code 0")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
