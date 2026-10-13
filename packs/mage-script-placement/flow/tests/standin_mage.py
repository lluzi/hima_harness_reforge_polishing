#!/usr/bin/env python3
"""Stand-in MAGE for the mage-script-placement Pack (tests only, no licence).

Invoked as the real binary: `<this> <stage.tcl> -noterm`. It reads the
Pack-assembled stage.tcl, takes the case paths from the prelude's `set
hima_*` lines, and interprets ONLY the lines between `# hima:agent-begin`
and `# hima:agent-end` with a tiny line-based state machine:

  hima_open_build [...]            state <- fixed instances of the start PLA, no Groups/Fits/drops
  source <pla>                     state <- that PLA ($hima_start_pla is substituted)
  smPFlow -placeGroup -groupItem G -groupTargetPoint (x,y) ...
                                   add the start PLA's Group(s) G at (x,y) um and their in-group Fits
  g_params -set {smPFlow::s_ARTestConvergePrplaced true|false}
  smPFlow -autoRefine              converge mode true -> fail like the real build (unless MAGE_STANDIN_CONVERGE_OK=1);
                                   else fill: top ordinary bases up to the start snapshot's rule-derived pending,
                                   recording MAGE_STANDIN_DROP_BASES (default KEY_V) as drops
  smSLFit ... -arOffsetRange...    empty the placed Fits, keep Groups (MAGE_STANDIN_OFFSET_INVALIDATES=0 disables)
  hima_snapshot <name>             write out/snap-NN-<name>/placement.pla (DBU shape) + summary; print marker
  hima_check                       print MAGE_CHECK_* blocks (rows from MAGE_STANDIN_ROWS)

Every other agent line is ignored. The epilogue is hard-coded: MAGE_VERIFY_*
blocks, out/export.pla (DBU shape), out/summary.txt, `MAGE_ROUND_END code 0`.
Failure knobs: MAGE_STANDIN_FAIL=1, MAGE_STANDIN_FAIL_AFTER_SNAPSHOT=<name>,
MAGE_STANDIN_VERIFY_FAIL=<TYPE>, MAGE_STANDIN_NO_END=1.
"""
from __future__ import annotations

import json, os, re, sys
from pathlib import Path

sys.path[:0] = [str(Path(__file__).resolve().parents[1])]
from mage_placement import core, pla  # noqa: E402

DBU = 10000
_SET_RE = re.compile(r"^set (hima_case_frb|hima_case_dir|hima_start_pla|hima_out) \{(.*)\}$", re.M)
_PLACE_GROUP_RE = re.compile(r"smPFlow\s+-placeGroup\s+-groupItem\s+(\S+)\s+-groupTargetPoint\s+\(([-\d.]+),([-\d.]+)\)")
_PHRASE = {"OVERLAP": "overlapped", "SPACE": "spacing overlapped", "BOUNDARY": "outside-frame-boundary"}


def _fail(boundary, message):
    sys.stderr.write("MAGE_STAGE_ERROR boundary %s message {%s}\n" % (boundary, message))
    sys.exit(2)


def _find_start_snapshot(path):
    for ancestor in [path.parent, *path.parents]:
        f = ancestor / "state" / "start-snapshot.json"
        if f.is_file():
            try: return json.loads(f.read_text(encoding="utf-8"))
            except (OSError, ValueError): return None
    return None


def _fill(state, start_snapshot, drop_bases):
    needed = {}
    for item in (start_snapshot or {}).get("pending", []):
        if item.get("inGroup"): continue
        needed.setdefault(item["base"], {"count": 0, "sizeDbu": item.get("sizeDbu")})["count"] += 1
    have = {}
    for f in state["fits"] + state["drops"]:
        if not f.get("inGroup"): have[f["base"]] = have.get(f["base"], 0) + 1
    for base, info in sorted(needed.items()):
        size = info["sizeDbu"] or [1000000, 560000]
        for k in range(1, info["count"] - have.get(base, 0) + 1):
            if base in drop_bases:
                state["drops"].append({"id": "%s.%s" % (base, base), "base": base, "inst": "%s.%s" % (base, base),
                                       "boxDbu": [0, 0, size[0], size[1]], "extraRot": "NULL", "placedFlag": 0,
                                       "postfix": "", "inGroup": ""})
            else:
                left = 5500000 + (k - 1) * 11000000
                state["fits"].append({"id": "%s.%s_fill%d" % (base, base, k), "base": base, "inst": "%s.%s_fill%d" % (base, base, k),
                                      "boxDbu": [left, 20000, left + size[0], 20000 + size[1]],
                                      "extraRot": "NULL", "postfix": "", "inGroup": ""})


def _print_check_block(kind, idx, t, rows, verify_fail):
    tag = "MAGE_VERIFY" if kind == "verify" else "MAGE_CHECK"
    head = "%s_BEGIN %s%s" % (tag, (idx + " ") if idx else "", t)
    print(head)
    for r in rows: print(r)
    print("%d %s instance(s)" % (len(rows), _PHRASE[t]))
    print("%s_CODE %s%s %d" % (tag, (idx + " ") if idx else "", t, 1 if verify_fail == t else 0))
    print("%s_END %s%s" % (tag, (idx + " ") if idx else "", t))


def main(argv):
    if not argv:
        sys.stderr.write("usage: standin_mage.py <stage.tcl> -noterm\n"); return 2
    if os.environ.get("MAGE_STANDIN_FAIL") == "1":
        _fail("prelude", "forced")
    stage_path = Path(argv[0]); text = stage_path.read_text(encoding="utf-8")
    vars_ = dict(_SET_RE.findall(text))
    out = Path(vars_["hima_out"]); start_pla_path = vars_["hima_start_pla"]
    out.mkdir(parents=True, exist_ok=True)
    start_doc = pla.read_pla(Path(start_pla_path).read_text(encoding="utf-8"), DBU)
    start_snapshot = _find_start_snapshot(stage_path)
    rows_by_type = json.loads(os.environ.get("MAGE_STANDIN_ROWS") or "{}")
    verify_fail = os.environ.get("MAGE_STANDIN_VERIFY_FAIL")
    drop_bases = set(filter(None, os.environ.get("MAGE_STANDIN_DROP_BASES", "KEY_V").split(",")))
    begin, end = text.index("# hima:agent-begin"), text.index("# hima:agent-end")
    agent_lines = text[begin:end].splitlines()[1:]

    state = {"units": "dbu", "dbuPerUm": DBU, "fixed": [], "groups": [], "fits": [], "drops": []}
    converge, snap_index, boundary = False, 0, "prelude"
    for raw in agent_lines:
        line = raw.strip()
        if not line or line.startswith("#"): continue
        if line.startswith("hima_open_build"):
            state = {"units": "dbu", "dbuPerUm": DBU, "fixed": [dict(f) for f in start_doc["fixed"]],
                     "groups": [], "fits": [], "drops": []}; boundary = "open-build"
        elif line.startswith("source "):
            target = line[len("source "):].strip().strip("{}").replace("$hima_start_pla", start_pla_path)
            state = pla.read_pla(Path(target).read_text(encoding="utf-8"), DBU)
        elif _PLACE_GROUP_RE.search(line):
            g, x, y = _PLACE_GROUP_RE.search(line).groups()
            point = [core.um_to_dbu(x, DBU), core.um_to_dbu(y, DBU)]
            for grp in start_doc["groups"]:
                if grp["groupItem"] == g and grp["targetPointDbu"] == point and grp not in state["groups"]:
                    state["groups"].append(dict(grp))
                    state["fits"].extend(dict(f) for f in start_doc["fits"] if f["inGroup"] == grp["pinstGroup"])
        elif "s_ARTestConvergePrplaced" in line:
            converge = "true" in line
        elif "-autoRefine" in line and "-setAutoRefine" not in line:
            if converge and os.environ.get("MAGE_STANDIN_CONVERGE_OK") != "1":
                print("Sort sl SCRIBE_V_1 preplaced fits failed"); print("Failed at auto refinement"); sys.stdout.flush()
                _fail(boundary, "Failed at auto refinement")
            _fill(state, start_snapshot, drop_bases)
        elif line.startswith("smSLFit") and "-arOffsetRange" in line:
            if os.environ.get("MAGE_STANDIN_OFFSET_INVALIDATES", "1") == "1":
                state["fits"] = []
        elif line.startswith("hima_snapshot "):
            name = line.split(None, 1)[1].strip(); snap_index += 1
            d = out / ("snap-%02d-%s" % (snap_index, name)); d.mkdir(parents=True, exist_ok=True)
            (d / "placement.pla").write_text(pla.write_pla(state, DBU, units="dbu"), encoding="utf-8")
            (d / "summary.txt").write_text("fits: %d\n" % len(state["fits"]), encoding="utf-8")
            print("MAGE_SNAPSHOT %d %s" % (snap_index, name)); sys.stdout.flush(); boundary = name
            if os.environ.get("MAGE_STANDIN_FAIL_AFTER_SNAPSHOT") == name:
                _fail(name, "forced after snapshot")
        elif line.startswith("hima_check"):
            for t in ("OVERLAP", "SPACE", "BOUNDARY"):
                _print_check_block("check", str(snap_index), t, rows_by_type.get(t, []), None)
    for t in ("OVERLAP", "SPACE", "BOUNDARY"):
        _print_check_block("verify", "", t, rows_by_type.get(t, []), verify_fail)
    (out / "export.pla").write_text(pla.write_pla(state, DBU, units="dbu"), encoding="utf-8")
    (out / "summary.txt").write_text("fits: %d\ndrops: %d\n" % (len(state["fits"]), len(state["drops"])), encoding="utf-8")
    if os.environ.get("MAGE_STANDIN_NO_END") != "1":
        print("MAGE_ROUND_END code 0")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
