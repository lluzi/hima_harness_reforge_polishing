#!/usr/bin/env bash
# Administrator-installed wrapper template for the `agentic-timing-closure-system` Pack's
# candidate `xtop-operator` interactive tool. v12 (Issue 64 fix round 2, Pack 0.2.0) is the installed v11 with only the
# atcs-v12 paths (the six-slot verifier copied beside it) and the pinned adapter/flow identities. Its call shape is `<wrapper> <workspace> <slot>` and
# becomes authoritative only when ATCS-03 updates `contract.yml` to this v2 path -- unlike the
# frozen `xtop-timing-closure` Pack's wrapper (`sites/linglong-swerv28/xtop-operator-v1.sh`, four
# args including an explicit adapter/template path), this Pack's `prepare-workers` tool has already
# compiled and written every worker slot's own typed session Tcl into `state/workers.json` before the
# Operator is ever opened -- the wrapper's only job is to resolve that one fixed record, validate it,
# and launch XTop against it under the same confinement discipline. See
# `sites/linglong-atcs28/README.md` for installation and qualification steps.
#
# THIS IS A TEMPLATE. Nobody installs these exact bytes on the server from this repository: the
# administrator copies this file, fills in the five `<REPLACE-...>` placeholders below from a real,
# fresh qualification (see README), and installs the result at
# `/data/eda/project/hima_harness/operator-admin/atcs-v12/atcs-xtop-operator-v12.sh`, mode 0555, outside
# the Permit's write root.
set -Eeuo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: atcs-xtop-operator-v12.sh <campaign-workspace> <slot>" >&2
  exit 2
fi

workspace_arg="$1"
slot="$2"
allowed_root=/data/eda/project/hima_harness/atcs-runs
image='localhost/edarunner@sha256:<REPLACE-WITH-QUALIFIED-IMAGE-DIGEST>'
adapter_sha256='<REPLACE-WITH-QUALIFIED-ATCS-CLI-SHA256>'
flow_digest='<REPLACE-WITH-QUALIFIED-ATCS-FLOW-DIGEST>'
verifier=/data/eda/project/hima_harness/operator-admin/atcs-v12/verify-worker-startup.py
verifier_sha256='<REPLACE-WITH-QUALIFIED-VERIFIER-SHA256>'
site_profile=/data/eda/project/hima_harness/atcs-inputs/siteCapabilities-v4.json
site_profile_sha256='<REPLACE-WITH-QUALIFIED-SITE-PROFILE-SHA256>'
bootstrap_root=/data/eda/project/hima_harness/operator-admin/atcs-v12/bootstraps

case "$slot" in
  w01|w02|w03|w04|w05|w06) ;;
  *) echo "slot must be one of w01..w06" >&2; exit 2;;
esac

workspace="$(realpath -e -- "$workspace_arg")"
case "$workspace/" in "$allowed_root"/*) ;; *) echo "workspace is outside the qualified Site workspace root" >&2; exit 3;; esac
[ -d "$workspace" ] && [ ! -L "$workspace" ] || { echo "workspace is not a plain directory" >&2; exit 3; }

# The fixed Pack adapter this Campaign's workspace was seeded with (`workspace.source: pack`,
# `workspace.copy: [atcs_cli.py, atcs, templates]`) -- pinned by content hash exactly like the frozen
# wrapper pins `closure.py`, so a modified or substituted adapter refuses before XTop ever opens.
adapter="$workspace/flow/atcs_cli.py"
[ -f "$adapter" ] && [ ! -L "$adapter" ] || { echo "Pack adapter is not a plain file" >&2; exit 3; }
[ "$(sha256sum "$adapter" | awk '{print $1}')" = "$adapter_sha256" ] || { echo "Pack adapter bytes do not match the qualified release" >&2; exit 3; }

# The administrator verifier independently hashes source before importing it, snapshots only
# qualified source (without workspace bytecode), and regenerates both Tcl files.
[ -f "$verifier" ] && [ ! -L "$verifier" ] || { echo "administrator verifier is unavailable" >&2; exit 3; }
[ "$(sha256sum "$verifier" | awk '{print $1}')" = "$verifier_sha256" ] || { echo "administrator verifier identity changed" >&2; exit 3; }
startup_record="$(python3 -I "$verifier" --workspace "$workspace_arg" --slot "$slot" \
  --flow "$flow_digest" --profile "$site_profile" --profile-hash "$site_profile_sha256" \
  --admin-root "$bootstrap_root")" || exit 3
session_tcl="$(printf '%s' "$startup_record" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["startup"])')"
slot_root="$(printf '%s' "$startup_record" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["slotRoot"])')"
case "$session_tcl" in "$bootstrap_root"/bootstrap-*/startup.tcl) ;; *) echo "startup is outside administrator snapshot root" >&2; exit 3;; esac

mode="$(cat /data/eda/env/empyrean-license-mode)"
[ "$mode" = old ] || { echo "XTop operator requires selected=old" >&2; exit 4; }

private_home="$slot_root/.operator-home-$$"
mkdir -- "$private_home"
chmod 700 -- "$private_home"
container_name="hima-atcs-xtop-operator-$(id -u)-$$"
cleanup_container() {
  podman rm -f -- "$container_name" >/dev/null 2>&1 || true
}
trap cleanup_container EXIT HUP INT TERM

set +e
podman run --rm -it \
  --name "$container_name" \
  --userns=keep-id --user "$(id -u):$(id -g)" \
  --network host --read-only --cap-drop=ALL --security-opt=no-new-privileges \
  --pids-limit 4096 --shm-size=16g --tmpfs /tmp:rw,nosuid,nodev,size=4g \
  --ulimit stack=-1:-1 --ulimit nofile=1048576:1048576 \
  --mount type=bind,src=/data/eda,dst=/data/eda,ro=true \
  --mount type=bind,src="$workspace",dst="$workspace",ro=true \
  --mount type=bind,src="$slot_root",dst="$slot_root",rw=true \
  --workdir "$slot_root" \
  -e HOME="$private_home" -e USER="$(id -un)" -e LOGNAME="$(id -un)" -e TERM=xterm-256color \
  -e HTTP_PROXY= -e HTTPS_PROXY= -e ALL_PROXY= -e http_proxy= -e https_proxy= -e all_proxy= \
  -e NO_PROXY=localhost,127.0.0.1,::1,linglong,.local \
  "$image" /bin/bash --noprofile --norc -c '
    set -euo pipefail
    source /data/eda/env/eda_tools_2025_env.sh
    test "${EMPYREAN_LICENSE_MODE}" = old
    exec xtop -f "$1"
  ' -- "$session_tcl"
xtop_status=$?
set -e
exit "$xtop_status"
