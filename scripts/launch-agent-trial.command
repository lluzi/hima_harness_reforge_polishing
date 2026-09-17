#!/bin/zsh
set -euo pipefail

kit_dir="${0:A:h}"
trial_data="$kit_dir/Trial Data"
trial_workspace="$kit_dir/Trial Workspace"
app="$kit_dir/HimaHarness.app"

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

exec "$app/Contents/MacOS/HimaHarness"
