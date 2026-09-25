#!/usr/bin/env bash
set -Eeuo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: xtop-operator-v1.sh <campaign-workspace> <pack-adapter> <startup-template>" >&2
  exit 2
fi

workspace="$1"
adapter="$2"
startup_template="$3"
allowed_root=/data/eda/project/hima_harness/xtop-timing-closure-runs
image='localhost/edarunner@sha256:8467102dbae851e4136e998661ae3a01ad9b65d49711c82f2b0883ab8d1bbb8c'
adapter_sha256='e0fbd46ee6dd90ff2b59756daa5ea3d29d2c6e9e74c1d47fdb176a8a54256dcf'
startup_template_sha256='46bf85afca2adfdc5b310348a6abf293b70ad88598bd1976f47dac888c804b82'

workspace="$(realpath -e -- "$workspace")"
adapter="$(realpath -e -- "$adapter")"
startup_template="$(realpath -e -- "$startup_template")"
case "$workspace/" in "$allowed_root"/*) ;; *) echo "workspace is outside the qualified Site workspace root" >&2; exit 3;; esac
case "$adapter" in "$workspace/flow/closure.py") ;; *) echo "Pack adapter is not the retained workspace adapter" >&2; exit 3;; esac
case "$startup_template" in "$workspace/flow/templates/xtop-operator.tcl") ;; *) echo "startup Tcl is not the retained workspace template" >&2; exit 3;; esac
[ -d "$workspace" ] && [ ! -L "$workspace" ] || { echo "workspace is not a plain directory" >&2; exit 3; }
[ -f "$adapter" ] && [ ! -L "$adapter" ] || { echo "Pack adapter is not a plain file" >&2; exit 3; }
[ -f "$startup_template" ] && [ ! -L "$startup_template" ] || { echo "startup Tcl is not a plain file" >&2; exit 3; }
[ "$(sha256sum "$adapter" | awk '{print $1}')" = "$adapter_sha256" ] || { echo "Pack adapter bytes do not match the qualified release" >&2; exit 3; }
[ "$(sha256sum "$startup_template" | awk '{print $1}')" = "$startup_template_sha256" ] || { echo "startup Tcl bytes do not match the qualified release" >&2; exit 3; }

mode="$(cat /data/eda/env/empyrean-license-mode)"
[ "$mode" = old ] || { echo "XTop operator requires selected=old" >&2; exit 4; }

startup="$(python3 "$adapter" xtop-interactive-startup "$workspace")"
startup="$(realpath -e -- "$startup")"
case "$startup" in "$workspace"/flow/iterations/g[0-9][0-9][0-9]/XTOP/operator.tcl) ;; *) echo "materialized startup Tcl is outside the fixed XTop iteration path" >&2; exit 3;; esac

private_home="$workspace/.operator-home"
mkdir -p -- "$private_home"
chmod 700 -- "$private_home"

set +e
podman run --rm -it \
  --userns=keep-id --user "$(id -u):$(id -g)" \
  --network host --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  --pids-limit 4096 --shm-size=16g --tmpfs /tmp:rw,nosuid,nodev,size=4g \
  --ulimit stack=-1:-1 --ulimit nofile=1048576:1048576 \
  --mount type=bind,src=/data/eda,dst=/data/eda,ro=true \
  --mount type=bind,src="$workspace",dst="$workspace",rw=true \
  --workdir "$workspace" \
  -e HOME="$private_home" -e USER="$(id -un)" -e LOGNAME="$(id -un)" -e TERM=xterm-256color \
  -e HTTP_PROXY= -e HTTPS_PROXY= -e ALL_PROXY= -e http_proxy= -e https_proxy= -e all_proxy= \
  -e NO_PROXY=localhost,127.0.0.1,::1,linglong,.local \
  "$image" /bin/bash -lc '
    set -euo pipefail
    source /data/eda/env/eda_tools_2025_env.sh
    test "${EMPYREAN_LICENSE_MODE}" = old
    exec xtop -f "$1"
  ' -- "$startup"
xtop_status=$?
set -e
[ "$xtop_status" -eq 0 ] || exit "$xtop_status"
python3 "$adapter" xtop-interactive-finalize "$workspace"
