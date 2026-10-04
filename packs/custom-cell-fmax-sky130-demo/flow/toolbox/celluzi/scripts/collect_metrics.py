#!/usr/bin/env python3
"""Aggregate ORFS per-stage metrics into a single golden/run metrics file + a headline summary.

Run INSIDE the container:
    python3 /foss/designs/celluzi/scripts/collect_metrics.py <design> [--golden]

Writes (under data/golden if --golden, else data/runs/latest):
    <design>_metrics.json     full: {summary, stages, merged}
    <design>_summary.json     just the curated headline PPA numbers
Nothing is discarded — the full merged metric set is stored (plan §8 "store the full metrics.json").
"""
import json, glob, os, sys

design = sys.argv[1] if len(sys.argv) > 1 else "aes"
golden = "--golden" in sys.argv[2:]
ROOT = "/foss/designs/celluzi"
FLOW = f"{ROOT}/OpenROAD-flow-scripts/flow"
base = f"{FLOW}/logs/sky130hd/{design}/base"
rep  = f"{FLOW}/reports/sky130hd/{design}/base"

stages, merged = {}, {}
for f in sorted(glob.glob(os.path.join(base, "*.json"))):
    try:
        d = json.load(open(f))
    except Exception:
        continue
    stages[os.path.basename(f)] = d
    merged.update(d)   # finish__ keys are unique per stage; later stages win on collisions

# KLayout sign-off DRC count (written by ORFS `drc` target)
klayout_drc = None
p = os.path.join(rep, "6_drc_count.rpt")
if os.path.exists(p):
    t = open(p).read().strip()
    klayout_drc = int(t) if t.isdigit() else t

def find(*keys):
    for k in keys:                       # exact match preferred
        if k in merged:
            return merged[k]
    cands = [k for k in merged for s in keys if s in k]
    if cands:                            # else shortest key containing the pattern
        return merged[min(cands, key=len)]
    return None

# clock target from ORFS results/<design>/base/clock_period.txt
clock_period_ns = None
_cp = f"{FLOW}/results/sky130hd/{design}/base/clock_period.txt"
if os.path.exists(_cp):
    try:
        clock_period_ns = float(open(_cp).read().strip())
    except Exception:
        pass

summary = {
    "design": design, "platform": "sky130hd",
    "die_area_um2":        find("finish__design__die__area"),
    "core_area_um2":       find("finish__design__core__area"),
    "inst_area_um2":       find("finish__design__instance__area"),
    "utilization":         find("finish__design__instance__utilization"),
    "num_instances":       find("finish__design__instance__count"),
    "num_stdcells":        find("finish__design__instance__count__stdcell"),
    "setup_ws_ns":         find("finish__timing__setup__ws"),
    "setup_tns_ns":        find("finish__timing__setup__tns"),
    "hold_ws_ns":          find("finish__timing__hold__ws"),
    "power_total_w":       find("finish__power__total"),
    "wirelength_um":       find("detailedroute__route__wirelength", "route__wirelength"),
    "drt_drc_errors":      find("detailedroute__route__drc_errors"),
    "klayout_drc_violations": klayout_drc,
    "clock_period_ns":     clock_period_ns,
}

outdir = f"{ROOT}/data/golden" if golden else f"{ROOT}/data/runs/latest"
os.makedirs(outdir, exist_ok=True)
tag = f"{design}_golden" if golden else design
json.dump({"summary": summary, "stages": stages, "merged": merged},
          open(f"{outdir}/{tag}_metrics.json", "w"), indent=2, sort_keys=True)
json.dump(summary, open(f"{outdir}/{tag}_summary.json", "w"), indent=2)
print(f"wrote {outdir}/{tag}_metrics.json  ({len(merged)} metric keys, {len(stages)} stages)")
print(json.dumps(summary, indent=2))
