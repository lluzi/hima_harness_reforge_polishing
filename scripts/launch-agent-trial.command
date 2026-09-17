#!/bin/zsh
set -euo pipefail

kit_dir="${0:A:h}"
trial_data="$kit_dir/Trial Data"
trial_workspace="$kit_dir/Trial Workspace"
app="$kit_dir/HimaHarness.app"
log="$trial_data/launcher.log"

if [[ ! -d "$app" ]]; then
  print -u2 "HimaHarness.app is missing beside this launcher: $app"
  exit 1
fi

mkdir -p "$trial_data/dsh" "$trial_workspace"
export HIMA_USER_DATA="$trial_data"
export DSH_HOME="$trial_data/dsh"
export DSH_AGENTS_HOME="$trial_data/dsh/agents"
export HIMA_WORKSPACE="$trial_workspace"
export HIMA_DRIVER_DISPLAY="Catsights"
export DSH_TELEMETRY_DISABLED="1"

{
  print "HimaHarness trial launcher"
  print "App: $app"
  print "HIMA_USER_DATA: $HIMA_USER_DATA"
  print "DSH_HOME: $DSH_HOME"
  print "HIMA_WORKSPACE: $HIMA_WORKSPACE"
  print "Display: $HIMA_DRIVER_DISPLAY"
  print "Mode: ordinary GUI (no --driver)"
} | tee -a "$log"

exec "$app/Contents/MacOS/HimaHarness" > >(tee -a "$log") 2> >(tee -a "$log" >&2)
