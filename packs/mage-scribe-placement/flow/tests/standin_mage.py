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

The `-saveMark` export is written in the real native DBU shape confirmed
on the Oct-12 build: the µm candidate PLA is parsed and re-written with
`pla.write_pla(..., units="dbu")` -- a braced `-savePlaDBU {10000}`
header, `-box` boxes, integer DBU, Group target points still in µm --
exactly as the live route's own `-saveMark` behaves on that build.
`-savePlaDBU` itself is not treated as a second export command (it is
just a header line a saved PLA carries, not a path-taking command on this
build).

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
# The fill stage (`--fill`) and a fill-like experiment both carry
# `smPFlow -autoRefine`; a plain replay round never does. Detecting the
# token is how this stand-in decides whether the round fills.
_AUTOREFINE_TOKEN = "autoRefine"
_SAVE_MARK_RE = re.compile(r"smPInstMgr\s+-saveMark\s+\{([^}]*)\}")
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


def _find_state_dir(script_path):
    """Walk up from the round's own `round.tcl` to the first ancestor holding
    `state/start-snapshot.json`, and return that `state/` directory, or `None`
    when it cannot be found. The stand-in is sometimes driven outside a
    Campaign workspace (direct `MageSession` unit tests); filling is then
    simply skipped."""
    for ancestor in [script_path.parent, *script_path.parents]:
        state_dir = ancestor / "state"
        if (state_dir / "start-snapshot.json").is_file():
            return state_dir
    return None


def _ordinary_targets(script_path):
    """Per-base ordinary (empty `inGroup`) population the fill should top up
    to, as `{base: {"count": int, "sizeDbu": [w, h] | None}}`, or `None` when
    there is no workspace to read.

    I-2: the target is the INCUMBENT's own measured ordinary population (read
    from `state/case-readiness.json`'s `manifest.incumbentState.path`), never
    the start's (larger) rule-derived pending -- so a de-degenerated fixture
    whose start-pending exceeds the incumbent population still fills to the
    incumbent and passes inventory. Only when no `case-readiness.json` exists
    (direct `MageSession` unit tests) does it fall back to the start-pending
    behaviour."""
    state_dir = _find_state_dir(script_path)
    if state_dir is None:
        return None

    case_readiness = state_dir / "case-readiness.json"
    if case_readiness.is_file():
        try:
            readiness = json.loads(case_readiness.read_text(encoding="utf-8"))
            incumbent_path = Path(readiness["manifest"]["incumbentState"]["path"])
            incumbent_doc = pla.read_pla(incumbent_path.read_text(encoding="utf-8"), DBU_PER_UM)
        except (OSError, ValueError, KeyError):
            return None
        counts = {}
        for item in list(incumbent_doc.get("fits", [])) + list(incumbent_doc.get("drops", [])):
            if item.get("inGroup"):
                continue
            base = item["base"]
            l, b, r, t = item["boxDbu"]
            counts.setdefault(base, {"count": 0, "sizeDbu": [r - l, t - b]})
            counts[base]["count"] += 1
        return counts

    # Fallback: the start's rule-derived ordinary pending.
    try:
        start_snapshot = json.loads((state_dir / "start-snapshot.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    counts = {}
    for item in start_snapshot.get("pending", []):
        if item.get("inGroup"):
            continue
        base = item["base"]
        counts.setdefault(base, {"count": 0, "sizeDbu": item.get("sizeDbu")})
        counts[base]["count"] += 1
    return counts


def _fill_ordinary(doc, needed_by_base):
    """Model a completed MAGE round's fill stage (`smPFlow -autoRefine`): top
    each ordinary (empty `inGroup`) base up to `needed_by_base[base]["count"]`
    by appending ordinary Fits. Idempotent per base, so a candidate that
    already carries one of a base's ordinary structures (e.g. a placed or
    dropped KEY_V) has only the shortfall added. The exported ordinary
    population then equals the incumbent's own measured ordinary population."""
    have_by_base = {}
    for fit in doc["fits"]:
        if not fit.get("inGroup"):
            have_by_base[fit["base"]] = have_by_base.get(fit["base"], 0) + 1
    for drop in doc["drops"]:
        if not drop.get("inGroup"):
            have_by_base[drop["base"]] = have_by_base.get(drop["base"], 0) + 1

    for base, info in sorted(needed_by_base.items()):
        add = info["count"] - have_by_base.get(base, 0)
        size = info["sizeDbu"] or [1000000, 560000]
        width, height = size[0], size[1]
        for k in range(1, add + 1):
            left = 5500000 + (k - 1) * 11000000
            doc["fits"].append({
                "id": "%s.%s_fill%d" % (base, base, k), "base": base,
                "inst": "%s.%s_fill%d" % (base, base, k),
                "boxDbu": [left, 20000, left + width, 20000 + height],
                "extraRot": "NULL", "postfix": "", "inGroup": "",
            })


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

    # The candidate PLA is the FIRST sourced file (replayed and exported);
    # an experiment round sources its experiment file after it.
    source_paths = _SOURCE_RE.findall(script_text)
    first_source = source_paths[0] if source_paths else None
    source_text = Path(first_source).read_text(encoding="utf-8") if first_source else None

    # A round whose script (or ANY sourced file, e.g. an Engineer experiment)
    # runs `smPFlow -autoRefine` fills the ordinary population; a plain replay
    # does not. When it fills, the exported ordinary population is topped up to
    # match the incumbent.
    fills = _AUTOREFINE_TOKEN in script_text
    if not fills:
        for src in source_paths:
            try:
                if _AUTOREFINE_TOKEN in Path(src).read_text(encoding="utf-8"):
                    fills = True
                    break
            except OSError:
                pass
    needed_by_base = _ordinary_targets(script_path) if fills else None

    for mark_match in _SAVE_MARK_RE.finditer(script_text):
        target = Path(mark_match.group(1))
        target.parent.mkdir(parents=True, exist_ok=True)
        if source_text is not None:
            # The real `-saveMark` behaviour on the Oct-12 build writes the
            # native DBU shape (braced header, `-box`, integer DBU, Group
            # target points still in µm) -- re-emit the sourced µm
            # candidate that way so the candidate/Reader path exercises
            # the DBU reader exactly as the live route will.
            doc = pla.read_pla(source_text, DBU_PER_UM)
            if needed_by_base is not None:
                _fill_ordinary(doc, needed_by_base)
            target.write_text(pla.write_pla(doc, DBU_PER_UM, units="dbu"), encoding="utf-8")
        else:
            target.write_text("", encoding="utf-8")

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
