#!/usr/bin/env bash
# Full back-end for a generated cell: postprocess (clean gates + implants) -> extract -> LVS -> DRC.
# Runs INSIDE container. Usage: extract_pipeline.sh <raw.gds> <cell> [reference.spice]
set -uo pipefail
RAW="${1:?raw.gds}"; CELL="${2:?cell}"; REF="${3:-}"
B=/foss/designs/celluzi/generate
D="$(cd "$(dirname "$RAW")" && pwd)"
GDS="$D/$CELL.gds"
cp "$RAW" "$GDS"
echo "===== post-process (clean gates + implants) ====="
klayout -b -rd gds="$GDS" -rm "$B/postprocess_cell.py" 2>&1 | grep -iE 'clean_gates|post-processed'
echo "===== extract w/ parasitics (for characterization) ====="
bash "$B/extract_cell.sh" "$GDS" "$CELL" "$D/$CELL.ext.spice" 0 2>&1 | grep -iE 'subckt|^X[0-9]' | head -8
echo "===== device-only extract + netgen LVS ====="
bash "$B/extract_cell.sh" "$GDS" "$CELL" "$D/$CELL.lvs.spice" infinite >/dev/null 2>&1
if [ -n "$REF" ]; then
  bash "$B/run_lvs.sh" "$D/$CELL.lvs.spice" "$REF" "$CELL" 2>&1 | grep -iE 'Circuits match|do not match|no matching net|Final result' | head -8
fi
echo "===== DRC ====="
bash "$B/run_drc_cell.sh" "$GDS" "$CELL" "$D/${CELL}_drc.xml" 2>&1 | grep -iE 'TOTAL|by rule|^ *[0-9]+ ' | tail -8
