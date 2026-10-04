#!/usr/bin/env bash
# Stage 3: extract parasitics from a generated cell GDS via Magic -> SPICE netlist. Runs INSIDE container.
# Usage: extract_cell.sh <gds> <cell> <out.spice>
set -uo pipefail
GDS="${1:?gds}"; CELL="${2:?cell}"; OUT="${3:?out.spice}"; CTH="${4:-0}"
# CTH = coupling-cap threshold: 0 keeps all parasitics (for characterization); "infinite" drops
# every cap for a device-only netlist (for LVS, where netgen would otherwise count caps as devices).
RC=/foss/pdks/sky130A/libs.tech/magic/sky130A.magicrc
WORK="$(cd "$(dirname "$OUT")" && pwd)"
cd "$WORK"
echo "== Magic extraction: $GDS (cell $CELL, cthresh=$CTH) =="
magic -dnull -noconsole -rcfile "$RC" <<MAGIC 2>&1 | tail -25
gds read $GDS
load $CELL
select top cell
port makeall
extract all
ext2spice lvs
ext2spice cthresh $CTH
ext2spice -o $OUT
quit -noprompt
MAGIC
echo
echo "== extracted SPICE (subckt + devices + caps) =="
if [ -f "$OUT" ]; then
  grep -iE 'subckt|^X|^M|^C|nfet|pfet|sky130_fd_pr' "$OUT" | head -35
  echo "...($(wc -l < "$OUT") lines total)"
else
  echo "NO OUTPUT FILE"
fi
