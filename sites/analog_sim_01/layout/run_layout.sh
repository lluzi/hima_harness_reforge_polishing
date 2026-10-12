#!/usr/bin/env bash
# Layout, DRC, LVS, PEX and post-layout Spectre of the Pack's OTA, on the Site host.
#
#   run_layout.sh <design.json> <out_dir> <pack_flow_dir> <pdk_root> <spectre_command> [image]
#
# The layout steps (Magic, netgen, KLayout) run in the open-source tool image, offline and as the
# calling user; the Spectre step runs on the host through <spectre_command> (a wrapper of the
# Site's `edarun spectre`). <pdk_root> holds gf180mcuD/libs.tech/ngspice as the host sees it.
set -euo pipefail
design=$(readlink -f "$1"); out=$(readlink -f "$2"); flow=$(readlink -f "$3"); pdk_root=$(readlink -f "$4"); spectre=$5
image=${6:-localhost/iic-osic-celluzi-hima:2026.06}
here=$(dirname "$(readlink -f "$0")")
mkdir -p "$out"
t0=$(date +%s.%N)
podman run --rm --network=none --userns=keep-id \
  -v "$here:$here:ro" -v "$(dirname "$design"):$(dirname "$design"):ro" -v "$out:$out" -w "$out" \
  --entrypoint /bin/bash "$image" -lc "python3 '$here/ota_layout.py' all '$design' '$out'" 2>&1 | grep -v '^\[INFO\]'
t1=$(date +%s.%N)
for corner in tt ss ff; do
  python3 "$here/ota_postlayout.py" "$flow" "$design" "$out" "$pdk_root" "$spectre" "$corner"
done
t2=$(date +%s.%N)
python3 - "$out" "$t0" "$t1" "$t2" <<'EOF'
import json, sys
out, t0, t1, t2 = sys.argv[1], *map(float, sys.argv[2:])
d = json.load(open(out + "/layout.json"))
d["wallSeconds"] = {"layoutContainer": round(t1 - t0, 1), "spectreThreeCorners": round(t2 - t1, 1)}
json.dump(d, open(out + "/layout.json", "w"), indent=2, sort_keys=True)
print("wall: layout in container %.1f s, Spectre 3 corners x 4 netlists %.1f s" % (t1 - t0, t2 - t1))
EOF
