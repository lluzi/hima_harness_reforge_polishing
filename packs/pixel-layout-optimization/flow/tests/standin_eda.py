"""Stand-in Argus / Calibre / gdsIn / RCExplorer for tests and route checks.

``python standin_eda.py argus|calibre|gdsIn|rcexplorer <the same args the real
tool gets>``. Each writes its report, in the real format with INVENTED values,
where the real tool would, then exits 0 (or non-zero on a forced failure). It is
stdlib-only and runs on any ``python3``; the pack's site-capabilities point the
tool argv prefixes at it in tests.

Controlling behaviour
---------------------
Behaviour is driven by a sidecar ``standin.json`` found by walking up from the
tool's working directory (the candidate directory holds it), or by a path in the
environment variable ``PIXELOPT_STANDIN``. Recognised keys (all optional):

* ``drcViolations``: ``{deck: {tile: count}}`` (``deck`` ``authority`` /
  ``reference``, ``tile`` ``1x1`` / ``2x2`` / ``3x3``) — Argus result count for
  that run (default 0, i.e. clean).
* ``lvsCorrect``: bool — Calibre verdict (default ``true``).
* ``gdsInFail``: bool — make gdsIn fail (no ``layout.oa``, exit 1).
* ``capsEmpty``: bool — RCExplorer writes an empty ``RCEResult.sp`` (no cards).
* ``caps``: ``{"<a>|<b>": fF}`` — override the default coupling table.

With no sidecar: clean DRC, LVS correct, gdsIn succeeds, and a fixed small
coupling table over the synthetic case's nets (``S VP SC EN R1 DL AN``). The
default table makes the original pass; a mutant's sidecar makes it fail.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time

# Default coupling table (fF), invented. (netA, netB, fF).
DEFAULT_CAPS = [
    ("S", "VP", 12.0),
    ("S", "EN", 0.2),
    ("S", "R1", 0.15),
    ("S", "SC", 0.4),
    ("S", "AN", 0.3),
    ("S", "DL", 0.3),
    ("SC", "VP", 0.7),
    ("SC", "EN", 0.5),
    ("SC", "R1", 0.3),
    ("SC", "DL", 0.6),
    ("SC", "AN", 0.2),
    ("AN", "VP", 8.0),
    ("AN", "DL", 0.25),
    ("AN", "EN", 0.1),
    ("S", "RCE_UNCONN_1", 1e-7),
    ("VP", "RCE_UNCONN_1", 2e-7),
]


def _sidecar():
    path = os.environ.get("PIXELOPT_STANDIN")
    if path and os.path.exists(path):
        try:
            with open(path) as fh:
                return json.load(fh)
        except (OSError, ValueError):
            return {}
    here = os.getcwd()
    for _ in range(7):
        cand = os.path.join(here, "standin.json")
        if os.path.exists(cand):
            try:
                with open(cand) as fh:
                    return json.load(fh)
            except (OSError, ValueError):
                return {}
        parent = os.path.dirname(here)
        if parent == here:
            break
        here = parent
    return {}


def _mutant_mutation():
    """Walk up from the tool's working directory to the candidate directory and,
    when its ``meta.json`` marks a planted calibration mutant, return the
    mutation descriptor (``{"kind": ...}``); otherwise ``None``.

    This lets the stand-in honour the two mutants ``num-mutants`` plants with no
    test-side sidecar. The real DRC/LVS tools catch these deliberate defects from
    geometry, which the stand-in cannot, so it reads the Pack's own record of the
    mutation (``meta.json`` ``kind == "mutant"`` with its ``mutation``) instead:
    a removed contact -> LVS incorrect; a shrunk space -> authority DRC markers.
    A sidecar key, when present, still wins (the explicit test double).
    """
    here = os.getcwd()
    for _ in range(7):
        meta_path = os.path.join(here, "meta.json")
        if os.path.exists(meta_path):
            try:
                with open(meta_path) as fh:
                    meta = json.load(fh)
            except (OSError, ValueError):
                return None
            if isinstance(meta, dict) and meta.get("kind") == "mutant":
                mutation = meta.get("mutation")
                return mutation if isinstance(mutation, dict) else {}
            return None
        parent = os.path.dirname(here)
        if parent == here:
            break
        here = parent
    return None


def _read(path):
    try:
        with open(path, "r", errors="replace") as fh:
            return fh.read()
    except OSError:
        return ""


def _now():
    return time.strftime("%a %b %d %H:%M:%S %Y")


# --------------------------------------------------------------------------- #
# Argus
# --------------------------------------------------------------------------- #

def _run_argus_lvs(args, sidecar):
    """Argus LVS stand-in: writes lvs.rep in Argus's report shape (PASS/FAIL + discrepancy count)."""
    correct = sidecar.get("lvsCorrect", True)
    if "lvsCorrect" not in sidecar:
        mut = _mutant_mutation()
        if mut and mut.get("kind") == "remove-contact":
            correct = False
    verdict = "PASS" if correct else "FAIL"
    text = [
        "LAYOUT NAME          :    pixel.gds  ('pix')",
        "--------------------------- CELL COMPARISON RESULTS ( TOP LEVEL ) ---------------------------",
        "",
        "                        ####     ###     ###     ###                    ",
        "                        #   #   #   #   #       #              %s  " % verdict,
        "",
        "LAYOUT CELL NAME=pix",
        "SOURCE CELL NAME=pix",
        "",
        "########################################### SUMMARY #########################################",
        "",
        "Total Real Discrepancy Count: %d" % (0 if correct else 1),
    ]
    with open("lvs.rep", "w") as fh:
        fh.write("\n".join(text) + "\n")
    return 0


def _run_argus(args, sidecar):
    if "-lvs" in args:
        return _run_argus_lvs(args, sidecar)
    rule_file = "rule"
    for a in args:
        if os.path.exists(a) and os.path.basename(a) == "rule":
            rule_file = a
    text = _read(rule_file)

    m = re.search(r'drc_summary\(\s*"([^"]+)"\s*\)', text)
    sum_name = m.group(1) if m else "argus_drc.sum"
    m = re.search(r'drc_result\(\s*db\s+"([^"]+)"\s*\)', text)
    db_name = m.group(1) if m else "argus_drc.db"
    m = re.search(r'layout_input\(\s*top_cell\s+"([^"]+)"\s*\)', text)
    top = m.group(1) if m else "pix"
    rule_ids = re.findall(r'\brule\s+(\S+)\s*\{', text)
    if not rule_ids:
        rule_ids = ["R.1"]

    deck, tile = _deck_tile(os.getcwd())
    viol = int(((sidecar.get("drcViolations", {}) or {}).get(deck, {}) or {}).get(tile, 0))
    if "drcViolations" not in sidecar and deck == "authority":
        mut = _mutant_mutation()
        if mut and mut.get("kind") == "shrink-space":
            viol = 2

    counts = {rid: 0 for rid in rule_ids}
    counts[rule_ids[0]] = viol

    lines = []
    lines.append("                    DRC Flat SUMMARY REPORT(ARGUS)\n")
    lines.append("ARGUS Version:                 Version 2099.01, standin, Build 00000000")
    lines.append("Running time:                  %s" % _now())
    lines.append("Top Cell Name:                 %s" % top)
    lines.append("DRC Result Output:             %s (ASCII)" % db_name)
    lines.append("DRC Summary File:              %s" % sum_name)
    lines.append("*" * 80)
    lines.append("                RULE RESULTS INFORMATION\n")
    for rid in rule_ids:
        pad = "-" * max(3, 24 - len(rid))
        lines.append("RULE NAME %s %s Result Count = %d" % (rid, pad, counts[rid]))
    lines.append("*" * 80)
    lines.append("                SUMMARY\n")
    lines.append("ALL DRC Rule:                    %d" % len(rule_ids))
    lines.append("ALL DRC Results:                 %d" % viol)
    with open(sum_name, "w") as fh:
        fh.write("\n".join(lines) + "\n")

    db = ["%s 1000" % top]
    for rid, n in counts.items():
        for i in range(n):
            db.append(rid)
            db.append("%d %d 4 %s" % (i + 1, i + 1, _now()))
            db.append("RuleCheckOrder: %d" % (i + 1))
            db.append("Rule File Pathname: rule")
            db.append("rule %s {" % rid)
            db.append("}")
            x = 1000 + i * 500
            db.append("p 1 4")
            db.append("%d %d" % (x, 1000))
            db.append("%d %d" % (x + 300, 1000))
            db.append("%d %d" % (x + 300, 1300))
            db.append("%d %d" % (x, 1300))
    with open(db_name, "w") as fh:
        fh.write("\n".join(db) + "\n")
    return 0


def _deck_tile(cwd):
    base = os.path.basename(cwd.rstrip(os.sep))
    m = re.match(r"drc_(authority|reference)_(1x1|2x2|3x3)$", base)
    if m:
        return m.group(1), m.group(2)
    return "authority", "1x1"


# --------------------------------------------------------------------------- #
# Calibre LVS
# --------------------------------------------------------------------------- #

def _run_calibre(args, sidecar):
    svrf = None
    for a in args:
        if os.path.exists(a):
            svrf = a
    report = "lvs.rep"
    if svrf:
        m = re.search(r'LVS REPORT\s+"([^"]+)"', _read(svrf))
        if m:
            report = m.group(1)
    correct = sidecar.get("lvsCorrect", True)
    if "lvsCorrect" not in sidecar:
        mut = _mutant_mutation()
        if mut and mut.get("kind") == "remove-contact":
            correct = False
    verdict = "CORRECT" if correct else "INCORRECT"
    banner = [
        "",
        "                  ##################################################",
        "                  ##             L V S   R E P O R T              ##",
        "                  ##################################################",
        "",
        "REPORT FILE NAME:         %s" % report,
        "CREATION TIME:            %s" % _now(),
        "CALIBRE VERSION:          v2099.1_standin",
        "",
        "                               OVERALL COMPARISON RESULTS",
        "",
        "                         ###################",
        "                         #    %-9s     #" % verdict,
        "                         ###################",
        "",
        "                                      CELL  SUMMARY",
        "",
        "  Result         Layout                        Source",
        "  -----------    -----------                   --------------",
        "  %-11s    pixel                         pixel" % verdict,
        "",
    ]
    with open(report, "w") as fh:
        fh.write("\n".join(banner) + "\n")
    print("LVS completed. %s. See report file: %s" % (verdict, report))
    return 0


# --------------------------------------------------------------------------- #
# gdsIn
# --------------------------------------------------------------------------- #

def _run_gdsin(args, sidecar):
    lib = _opt(args, "-lib", "pixel")
    cell = _opt(args, "-cell", "pixel")
    print("*" * 60)
    print("Tool:\t\tgdsIn               0.10.0")
    print("*" * 60)
    print("Running: gdsIn %s" % " ".join(args))
    print("Started: %s (Hostname: standin)" % _now())
    if sidecar.get("gdsInFail"):
        print("ERROR: (standin) forced gdsIn failure")
        return 1
    layout = os.path.join(lib, cell, "layout")
    os.makedirs(layout, exist_ok=True)
    with open(os.path.join(layout, "layout.oa"), "w") as fh:
        fh.write("standin layout.oa marker\n")
    print("gdsIn completed.")
    return 0


def _opt(args, flag, default):
    for i, a in enumerate(args):
        if a == flag and i + 1 < len(args):
            return args[i + 1]
    return default


# --------------------------------------------------------------------------- #
# RCExplorer
# --------------------------------------------------------------------------- #

def _run_rcexplorer(args, sidecar):
    tcl = None
    for a in args:
        if os.path.exists(a) and a.endswith(".tcl"):
            tcl = a
    text = _read(tcl) if tcl else ""
    work_dir = None
    m = re.search(r'set\s+work_dir\s+(\S+)', text)
    if m:
        work_dir = m.group(1).strip('"{}')
    out = None
    m = re.search(r'"OUTPUT_RC_FILE"\s*:\s*"([^"]+)"', text)
    if m:
        out = m.group(1)
    if out is None:
        m = re.search(r'-out\s+(\S+)', text)
        if m:
            out = m.group(1).strip('"{}')
    if out is None:
        out = "RCEResult.sp"
    if not os.path.isabs(out):
        base = work_dir if work_dir else os.getcwd()
        out = os.path.join(base, out)
    m = re.search(r'set\s+top\s+(\S+)', text)
    top = m.group(1).strip('"{}') if m else "pix"

    print("Empyrean rcexplorer standin  Version 2099.01")
    if sidecar.get("capsEmpty"):
        with open(out, "w") as fh:
            fh.write("\n.subckt %s\n.ends %s\n" % (top, top))
        print("rcexplorer completed (no coupling).")
        return 0

    caps = sidecar.get("caps")
    if caps:
        pairs = []
        for key, val in caps.items():
            a, b = key.split("|", 1)
            pairs.append((a, b, float(val)))
    else:
        pairs = list(DEFAULT_CAPS)

    nets = []
    for a, b, _v in pairs:
        for n in (a, b):
            if n not in nets:
                nets.append(n)
    lines = ["", ".subckt %s %s" % (top, " ".join(nets))]
    for a, b, v in pairs:
        lines.append("C_%s_%s %s %s %.6g" % (a, b, a, b, v * 1e-15))
    lines.append(".ends %s" % top)
    with open(out, "w") as fh:
        fh.write("\n".join(lines) + "\n")
    print("rcexplorer completed. wrote %s" % out)
    return 0


# --------------------------------------------------------------------------- #

_TOOLS = {
    "argus": _run_argus,
    "calibre": _run_calibre,
    "gdsIn": _run_gdsin,
    "gdsin": _run_gdsin,
    "rcexplorer": _run_rcexplorer,
}


def main(argv):
    if not argv:
        sys.stderr.write("standin_eda: need a tool name\n")
        return 2
    tool = argv[0]
    fn = _TOOLS.get(tool)
    if fn is None:
        sys.stderr.write("standin_eda: unknown tool %r\n" % tool)
        return 2
    return fn(argv[1:], _sidecar())


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
