#!/usr/bin/env bash
# Sign-off LVS: compare a Magic-extracted netlist against a sky130-device reference via netgen.
# Runs INSIDE container. Usage: run_lvs.sh <extracted.spice> <reference.spice> <cell>
set -uo pipefail
EXT="${1:?extracted}"; SRC="${2:?reference}"; CELL="${3:?cell}"
SETUP=/foss/pdks/sky130A/libs.tech/netgen/sky130A_setup.tcl
OUT="$(cd "$(dirname "$EXT")" && pwd)/${CELL}_lvs.out"
# Optional 4th arg: space-separated SYMMETRIC input pins, e.g. "A B C" for a NOR3. A layout
# generator is free to bind symmetric inputs to different stack positions than the reference
# names them; the topology still matches but netgen "fail[s] pin matching" on the permutation.
# permute declares the pins interchangeable, which for a fully-symmetric function they are.
# ONLY list pins the cell's boolean function is symmetric in -- permuting non-symmetric pins
# would let a real wiring error pass.
PERMUTE="${4:-}"
if [ -n "$PERMUTE" ]; then
  WRAP="$(cd "$(dirname "$EXT")" && pwd)/${CELL}_setup.tcl"
  cp "$SETUP" "$WRAP"
  set -- $PERMUTE
  first=$1; shift
  for pin in "$@"; do
    echo "permute \"$CELL\" $first $pin" >> "$WRAP"
  done
  SETUP="$WRAP"
fi
netgen -batch lvs "$EXT $CELL" "$SRC $CELL" "$SETUP" "$OUT" 2>&1 | tail -30
echo "---- verdict ----"
grep -iE 'Circuits match|do not match|uniquely|net.*mismatch|property' "$OUT" 2>/dev/null | tail -8
