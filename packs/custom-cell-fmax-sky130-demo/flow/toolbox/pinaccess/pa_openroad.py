"""OpenROAD side of pinaccess/check.py; run as `openroad -python -exit pa_openroad.py JOB.json`.

Loads the LEFs and the DEF that check.py wrote, runs the detailed router's pin-access analysis
(`pin_access`, the same command ORFS runs before global routing) and writes RESULT.json:

    {"ok": true|false, "error": "...", "noAccess": [[inst, pin], ...],
     "accessPoints": {"MASTER/PIN": n},      # summed over the unique instances
     "insts": {INST: {"master": M, "orient": O, "pins": {PIN: n_preferred_access_points}}}}

DRT-0073 ("No access point for INST/PIN") makes `pin_access` raise; the instances and pins it names
are collected from the message and returned in noAccess with ok=false. Any other exception is a
tool error (ok=false, noAccess empty).
"""
import json
import re
import sys

import odb
import openroad
from openroad import Design, Tech


def main():
    job = json.load(open(sys.argv[1]))
    openroad.set_thread_count(int(job.get("threads", 1)))
    tech = Tech()
    for lef in job["lefs"]:
        tech.readLef(lef)
    for lib in job.get("liberty", []):
        tech.readLiberty(lib)
    design = Design(tech)
    design.readDef(job["def"])
    for cmd in job.get("tcl", []):
        design.evalTclString(cmd)
    out = {"ok": True, "error": "", "noAccess": [], "insts": {}}
    # evalTclString does not raise on a Tcl error, so catch it in Tcl and read the message back.
    rc = design.evalTclString("catch {%s} ::pa_msg" % job["pinAccessCmd"]).strip()
    if rc != "0":
        out["ok"] = False
        out["error"] = design.evalTclString("set ::pa_msg")[-4000:]
    for inst, pin in re.findall(r"No access point for (\S+)/(\S+) \(", out["error"]):
        if [inst, pin] not in out["noAccess"]:
            out["noAccess"].append([inst, pin])
    block = design.getBlock()
    # Access points per library pin, summed over the unique instances (orientations) that use it;
    # odb's Python API does not expose which unique instance an access point belongs to.
    counts = {}
    for ap in block.getAccessPoints():
        mp = ap.getMPin()
        if mp is not None:
            key = mp.getMTerm().getMaster().getName() + "/" + mp.getMTerm().getName()
            counts[key] = counts.get(key, 0) + 1
    out["accessPoints"] = counts
    for inst in block.getInsts():
        pins = {}
        for it in inst.getITerms():
            mt = it.getMTerm()
            if mt.getSigType() in ("POWER", "GROUND") or it.getNet() is None:
                continue
            pins[mt.getName()] = len(it.getPrefAccessPoints())   # preferred access points (one per pin shape)
        out["insts"][inst.getName()] = {"master": inst.getMaster().getName(), "orient": inst.getOrient(),
                                        "pinAccessIdx": inst.getPinAccessIdx(), "pins": pins}
    with open(job["result"], "w") as fh:
        json.dump(out, fh, indent=1)


main()
