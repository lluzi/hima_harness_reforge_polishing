#!/usr/bin/env bash
# Stage 2: generate a standard-cell layout from a SPICE netlist with lclayout (sky130 tech).
# Runs INSIDE the derived container (localhost/iic-osic-celluzi:2026.06 — has python3-dev for pysmt).
# Usage: run_lclayout.sh <cell> <netlist.sp> <outdir>
set -uo pipefail
CELL="${1:?cell}"; NET="${2:?netlist}"; OUT="${3:?outdir}"
TECH=/foss/designs/celluzi/pdk/librecell_sky130_tech.py
# shellcheck disable=SC1091
source /foss/designs/celluzi/tools/librecell_venv/bin/activate
mkdir -p "$OUT"
echo "== lclayout: cell=$CELL netlist=$NET =="
# LVS is a HARD GATE. It used to run with --ignore-lvs, justified as "an S/D-symmetry false-negative
# on symmetric transistors" -- that justification was wrong. The failures were real: routed poly over
# diffusion added a second channel segment per device (L=0.17 not 0.15) and shattered gate nets, so
# every multi-transistor cell we ever shipped was electrically broken. Fixed in the tech file (poly
# drawn-only + gate contacts off diffusion); INV/NAND2/INV2X/FUSE_XOR2_NAND2 all pass now. If LVS
# fails, the cell is wrong -- do not emit it.
lclayout --cell "$CELL" --netlist "$NET" --tech "$TECH" --output-dir "$OUT" 2>&1
echo "== outputs =="
ls -1 "$OUT"/"$CELL".* 2>/dev/null
