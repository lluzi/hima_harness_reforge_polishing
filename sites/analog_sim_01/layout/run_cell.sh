#!/usr/bin/env bash
# Layout, DRC, LVS (netgen and the PDK's KLayout deck) and extraction of one SPICE subcircuit of
# GF180 devices, on the Site host, in the open-source tool image (offline, as the calling user).
#
#   run_cell.sh <netlist.spice> <subckt> <out_dir> [image]
set -euo pipefail
netlist=$(readlink -f "$1"); cell=$2; out=$(readlink -f "$3")
image=${4:-localhost/iic-osic-celluzi-hima:2026.06}
here=$(dirname "$(readlink -f "$0")")
mkdir -p "$out"
podman run --rm --network=none --userns=keep-id \
  -v "$here:$here:ro" -v "$(dirname "$netlist"):$(dirname "$netlist"):ro" -v "$out:$out" -w "$out" \
  --entrypoint /bin/bash "$image" -lc "python3 '$here/cell_layout.py' all '$netlist' '$cell' '$out'" 2>&1 | grep -v '^\[INFO\]'
