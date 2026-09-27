#!/usr/bin/env bash
# Administrator-installed wrapper template for the `agentic-timing-closure-system` Pack's
# candidate `xtop-operator` interactive tool. Its call shape is `<wrapper> <workspace> <slot>` and
# becomes authoritative only when ATCS-03 updates `contract.yml` to this v2 path -- unlike the
# frozen `xtop-timing-closure` Pack's wrapper (`sites/linglong-swerv28/xtop-operator-v1.sh`, four
# args including an explicit adapter/template path), this Pack's `prepare-workers` tool has already
# compiled and written every worker slot's own typed session Tcl into `state/workers.json` before the
# Operator is ever opened -- the wrapper's only job is to resolve that one fixed record, validate it,
# and launch XTop against it under the same confinement discipline. See
# `sites/linglong-atcs28/README.md` for installation and qualification steps.
#
# THIS IS A TEMPLATE. Nobody installs these exact bytes on the server from this repository: the
# administrator copies this file, fills in the three `<REPLACE-...>` placeholders below from a real,
# fresh qualification (see README), and installs the result at
# `/data/eda/project/hima_harness/operator-admin/atcs-v2/atcs-xtop-operator-v2.sh`, mode 0755, outside
# the Permit's write root.
set -Eeuo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: atcs-xtop-operator-v2.sh <campaign-workspace> <slot>" >&2
  exit 2
fi

workspace_arg="$1"
slot="$2"
allowed_root=/data/eda/project/hima_harness/atcs-runs
image='localhost/edarunner@sha256:<REPLACE-WITH-QUALIFIED-IMAGE-DIGEST>'
adapter_sha256='<REPLACE-WITH-QUALIFIED-ATCS-CLI-SHA256>'
flow_digest='<REPLACE-WITH-QUALIFIED-ATCS-FLOW-DIGEST>'

case "$slot" in
  w01|w02|w03) ;;
  *) echo "slot must be one of w01, w02, w03" >&2; exit 2;;
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
[ "$(python3 "$adapter" flow-digest "$workspace/flow")" = "$flow_digest" ] || { echo "Pack flow bytes do not match the qualified release" >&2; exit 3; }

# The one fixed record this Pack's `prepare-workers` tool writes: `state/workers.json`, keyed by
# slot, each carrying that slot's own compiled `sessionTcl` path (see FABRIC.md "Gaps" G26 and
# `flow/atcs_cli.py`'s `_cmd_prepare_workers`). No other input names the session file -- there is no
# separate "adapter"/"startup template" argv here to validate.
workers_json="$workspace/state/workers.json"
[ -f "$workers_json" ] && [ ! -L "$workers_json" ] || { echo "state/workers.json is not a plain file" >&2; exit 3; }

session_record="$(python3 -c '
import json, sys
with open(sys.argv[1], "r", encoding="utf-8") as fh:
    document = json.load(fh)
workers = document.get("workers", {})
slot = sys.argv[2]
if slot not in workers:
    sys.stderr.write("slot " + slot + " has no prepared worker in state/workers.json\n")
    sys.exit(1)
session = workers[slot].get("sessionTcl")
digest = workers[slot].get("sessionTclSha256")
if not session or not isinstance(digest, str) or len(digest) != 64:
    sys.stderr.write("slot " + slot + " has no pinned session Tcl identity in state/workers.json\n")
    sys.exit(1)
sys.stdout.write(session + "\n" + digest)
' "$workers_json" "$slot")" || exit 3
session_tcl="$(printf '%s\n' "$session_record" | sed -n '1p')"
session_tcl_sha256="$(printf '%s\n' "$session_record" | sed -n '2p')"

session_tcl="$(realpath -e -- "$session_tcl")"
# `atcs.workspaces.prepare`'s own path convention: `workspaces/<taskId>/r<rev>/`, and
# `atcs.adapters.compile_xtop_analysis_manual_task` always names its file `xtop-analysis-manual.tcl`
# inside that root -- a session Tcl anywhere else was not this wrapper's slot to run.
case "$session_tcl" in
  "$workspace"/workspaces/"$slot"/r[0-9]*/xtop-analysis-manual.tcl) ;;
  *) echo "session Tcl is outside the fixed per-slot workspace tree" >&2; exit 3;;
esac
[ -f "$session_tcl" ] && [ ! -L "$session_tcl" ] || { echo "session Tcl is not a plain file" >&2; exit 3; }
[ "$(sha256sum "$session_tcl" | awk '{print $1}')" = "$session_tcl_sha256" ] || { echo "session Tcl bytes do not match state/workers.json" >&2; exit 3; }

mode="$(cat /data/eda/env/empyrean-license-mode)"
[ "$mode" = old ] || { echo "XTop operator requires selected=old" >&2; exit 4; }

private_home="$workspace/.operator-home"
mkdir -p -- "$private_home"
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
  ' -- "$session_tcl"
xtop_status=$?
set -e
exit "$xtop_status"
