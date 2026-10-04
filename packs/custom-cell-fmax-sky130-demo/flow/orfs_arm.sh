#!/bin/bash
# In-container ORFS launcher for one measured run (baseline, custom arm or control arm).
# cellfmax_cli.py stages /work/inputs and passes CELLFMAX_ORFS, CELLFMAX_DESIGN_CONFIG,
# CELLFMAX_VARIANT and one CELLFMAX_VAR_<MAKEVAR> per make variable. The ORFS checkout is mounted
# read-only; every result, log, report and object goes to WORK_HOME=/work.
set -uo pipefail
cd "$CELLFMAX_ORFS/flow" || exit 90
vars=()
for name in $(compgen -e | grep '^CELLFMAX_VAR_' | sort); do
  vars+=("${name#CELLFMAX_VAR_}=${!name}")
done
common=(
  "DESIGN_CONFIG=./$CELLFMAX_DESIGN_CONFIG" WORK_HOME=/work "FLOW_VARIANT=$CELLFMAX_VARIANT"
  OPENROAD_EXE=/foss/tools/bin/openroad OPENSTA_EXE=/foss/tools/bin/sta
  YOSYS_EXE=/foss/tools/bin/yosys KLAYOUT_CMD=/foss/tools/klayout/klayout
)
echo "== cellfmax ORFS run variant=$CELLFMAX_VARIANT start $(date -u +%FT%TZ)"
printf '   %s\n' "${vars[@]}" | cut -c1-300
make "${common[@]}" "${vars[@]}" finish
rc=$?
if [ "$rc" -eq 0 ]; then
  make "${common[@]}" "${vars[@]}" run RUN_SCRIPT=/work/inputs/top_paths.tcl > /work/top-paths.log 2>&1 \
    || echo "== top-paths report failed (non-fatal); see /work/top-paths.log"
fi
echo "== cellfmax ORFS run end rc=$rc $(date -u +%FT%TZ)"
exit "$rc"
