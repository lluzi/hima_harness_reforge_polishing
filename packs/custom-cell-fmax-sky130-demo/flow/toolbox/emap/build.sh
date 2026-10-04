#!/bin/bash
# Build emap_window against a local copy of mockturtle (header-only use; no network access needed).
#
#   bash build.sh [MOCKTURTLE_DIR] [OUT_DIR]
#
# Defaults: MOCKTURTLE_DIR=$EMAP_MOCKTURTLE or the linglong install
#           /data/eda/project/hima_harness/operator-admin/cellfmax-toolbox/mockturtle-47d1e70
#           OUT_DIR=$EMAP_OUT or <this dir>/bin
# Run it inside the EDA image (g++ 13, C++17), e.g. on linglong:
#   podman run --rm --userns=keep-id --cpus=8 -v <toolbox>:<toolbox> -v <this dir>:<this dir> \
#     localhost/iic-osic-celluzi-hima:2026.06 /bin/bash -lc 'bash <this dir>/build.sh'
# Prints the absolute path of the binary on its last line. Takes ~1-2 min (emap.hpp is large).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mt="${1:-${EMAP_MOCKTURTLE:-/data/eda/project/hima_harness/operator-admin/cellfmax-toolbox/mockturtle-47d1e70}}"
out="${2:-${EMAP_OUT:-$here/bin}}"
for d in include lib/fmt lib/kitty lib/lorina lib/parallel_hashmap lib/rang; do
  [ -d "$mt/$d" ] || { echo "build.sh: missing $mt/$d (copy mockturtle include/ and lib/ there)" >&2; exit 3; }
done
mkdir -p "$out"
${CXX:-g++} -std=c++17 -O2 -DNDEBUG -DFMT_HEADER_ONLY=1 -w -Wno-c++11-narrowing \
  -I"$mt/include" -isystem "$mt/lib/fmt" -isystem "$mt/lib/kitty" -isystem "$mt/lib/lorina" \
  -isystem "$mt/lib/parallel_hashmap" -isystem "$mt/lib/rang" \
  -o "$out/emap_window" "$here/emap_window.cpp" -pthread
"$out/emap_window" --help 2>/dev/null || true
echo "$out/emap_window"
