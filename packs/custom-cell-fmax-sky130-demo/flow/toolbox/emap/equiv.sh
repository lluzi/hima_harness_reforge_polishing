#!/bin/bash
# Prove the emap-remapped window equal to the original window (combinational, Yosys).
#
#   bash equiv.sh <WINDOW_DIR> <MAPPED.v> [LOG]
#
# WINDOW_DIR is the `window.py cut` output dir after `window.py stitch` (needs cut.v, wrapper.v,
# window.json). MAPPED.v is the emap_window output (module emap_win_core). Gold = module emap_win
# of cut.v (the original cells); gate = wrapper.v + MAPPED.v. Both are flattened onto the Liberty
# cell functions (read_liberty without -lib), then equiv_make / equiv_simple / equiv_induct /
# equiv_status -assert. If that leaves anything unproven, a SAT miter (miter -equiv + sat -prove)
# is tried. The log ends with exactly one of
#   EQUIVALENCE: PASS        (all outputs proven equal)
#   EQUIVALENCE: FAIL        (counterexample or unproven outputs; see the yosys output above)
# The raw Yosys transcript goes to <LOG>.yosys; LOG itself holds the header, the equivalence-point
# counts and the verdict. (Yosys' equiv_status prints "... and 0 are unproven" even on success,
# and the Pack's compare step treats any "unproven" in the referenced log as a failure, so the
# raw line is summarised instead of copied.)
# Exit 0 on PASS, 1 on FAIL, 2 on usage/setup errors. Runs in seconds for windows of a few
# hundred cells. Needs `yosys` and `python3` on PATH (the EDA image).
set -uo pipefail
dir="${1:?usage: equiv.sh <WINDOW_DIR> <MAPPED.v> [LOG]}"
mapped="${2:?usage: equiv.sh <WINDOW_DIR> <MAPPED.v> [LOG]}"
log="${3:-$dir/equiv.log}"
YOSYS="${YOSYS:-yosys}"
for f in "$dir/cut.v" "$dir/wrapper.v" "$dir/window.json" "$mapped"; do
  [ -f "$f" ] || { echo "equiv.sh: missing $f (run window.py cut and stitch first)" >&2; exit 2; }
done
libs=$(python3 -c 'import json,sys; print(" ".join(json.load(open(sys.argv[1]))["libs"]))' "$dir/window.json") || exit 2
top=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["top"])' "$dir/window.json") || exit 2
read_libs=""
for l in $libs; do read_libs="$read_libs read_liberty -ignore_miss_func $l;"; done
common="$read_libs
read_verilog $dir/cut.v; delete $top; rename emap_win gold;
read_verilog $dir/wrapper.v; read_verilog $mapped; rename emap_win gate;
hierarchy -check; flatten; opt_clean;"
{
  echo "== equiv.sh $(date -u +%FT%TZ) window=$dir mapped=$mapped"
  echo "== sha256 $(sha256sum "$mapped" | cut -c1-64) mapped"
  echo "== sha256 $(sha256sum "$dir/cut.v" | cut -c1-64) cut.v"
} > "$log"
raw="$log.yosys"
"$YOSYS" -p "$common
equiv_make gold gate equiv; hierarchy -top equiv; equiv_simple -seq 0; equiv_induct; equiv_status -assert" > "$raw" 2>&1
rc=$?
counts=$(grep -o "Of those cells [0-9]* are proven and [0-9]* are unproven" "$raw" | tail -1 | awk '{print $4, $8}')
total=$(grep -o "Found [0-9]* \$equiv cells" "$raw" | tail -1 | awk '{print $2}')
echo "== equiv_make/equiv_simple/equiv_induct: ${total:-?} equivalence points, proven/open = ${counts:-? ?} (rc=$rc)" >> "$log"
grep -q "Equivalence successfully proven" "$raw" && echo "== Equivalence successfully proven (equiv_status -assert)" >> "$log"
if [ $rc -ne 0 ]; then
  echo "== equiv_status did not prove every point; trying SAT miter" >> "$log"
  "$YOSYS" -p "$common
miter -equiv -flatten -make_assert -ignore_gold_x gold gate miter; hierarchy -top miter;
sat -verify -prove-asserts -show-ports -enable_undef miter" >> "$raw" 2>&1
  rc=$?
  grep -E "SAT proof finished|SUCCESS|FAIL" "$raw" | tail -3 | sed 's/^/== sat: /' >> "$log"
fi
grep -E "^ERROR" "$raw" | head -5 | sed 's/^/== yosys: /' >> "$log"
echo "== raw transcript: $raw" >> "$log"
if [ $rc -eq 0 ]; then
  echo "EQUIVALENCE: PASS" | tee -a "$log"
  exit 0
fi
echo "EQUIVALENCE: FAIL" | tee -a "$log"
exit 1
