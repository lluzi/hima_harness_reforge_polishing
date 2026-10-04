#!/usr/bin/env bash
# Run the sky130 KLayout sign-off DRC (full sky130A.lydrc deck) on a single generated cell GDS.
# Runs INSIDE the container. Usage: run_drc_cell.sh <gds> <topcell> <report.xml>
set -uo pipefail
GDS="${1:?gds}"; TOP="${2:?topcell}"; REP="${3:?report.xml}"
DECK=/foss/pdks/sky130A/libs.tech/klayout/drc/sky130A.lydrc
echo "== KLayout sign-off DRC: $GDS (top=$TOP) vs sky130A.lydrc =="
klayout -b -r "$DECK" -rd input="$GDS" -rd topcell="$TOP" -rd report="$REP" -rd thr=6 2>&1 | tail -12
echo "== TOTAL violations =="
grep -c '<item>' "$REP" 2>/dev/null || echo 0
echo "== violations by rule (top 30) =="
grep -oE '<category>[^<]*</category>' "$REP" 2>/dev/null | sed 's/<[^>]*>//g; s/[^A-Za-z0-9._]//g' | sort | uniq -c | sort -rn | head -30
