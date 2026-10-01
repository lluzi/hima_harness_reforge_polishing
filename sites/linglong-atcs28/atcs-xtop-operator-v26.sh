#!/usr/bin/env bash
# Administrator-installed wrapper template for the `agentic-timing-closure-system` Pack's
# candidate `xtop-operator` interactive tool. v26 (Issue 66, Pack 0.2.5) retains v25 confinement
# and transport cleanup. It pins the batch Site timezone for common-R1 recovery; the reserved lead slot,
# verifier and slot hygiene. All six worker slots clone the same qualified R1 privately.
# v20 was v19 with the atcs-v20 paths and the flow/adapter pins of the flow whose XTop adapter reads per-target slack, sends pin-scoped
# fixes, dummy and delay-chain cell lists in the documented forms and keeps a real insertion (T06 repairs). v19 was
# v18 with the atcs-v19 paths and the flow/adapter pins of the flow whose reads resolve an instance or check key to its pins in-session
# (L4 run 4 gap). v18 was v17 with the atcs-v18 paths and three pins moved: the flow digest and adapter of the best-effort-replay flow and the
# verifier that does static checks only (no dynamic-Tcl regeneration compare). v17 was v16 with the atcs-v17 paths
# and the `adapter_sha256` pin of the ATCS-09 flow/atcs_cli.py (v16 pinned only the
# flow digest). v16 is v15 with one pin changed: `flow_digest` names the Pack flow whose sessions derive their
# cluster's local-topology edit domain (domain.json), read single endpoints (atcs_point), log their reads and seal
# batch Contributions, and whose replay enters the sealed effective domain. The close behaviour is v14's: the
# container runs in the background, HUP, TERM, INT or EOF on stdin stop it, the wrapper checks that no process of it
# remains and exits 0; the container name and XTop pid are written to `<slot>/session.json`. Its call shape is `<wrapper> <workspace> <slot>` and
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
# `/data/eda/project/hima_harness/operator-admin/atcs-v26/atcs-xtop-operator-v26.sh`, mode 0555, outside
# the Permit's write root.
set -Eeuo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: atcs-xtop-operator-v26.sh <campaign-workspace> <slot>" >&2
  exit 2
fi

workspace_arg="$1"
slot="$2"
allowed_root=/data/eda/project/hima_harness/atcs-runs
image='localhost/edarunner@sha256:<REPLACE-WITH-QUALIFIED-IMAGE-DIGEST>'
adapter_sha256='<REPLACE-WITH-QUALIFIED-ATCS-CLI-SHA256>'
flow_digest='<REPLACE-WITH-QUALIFIED-ATCS-FLOW-DIGEST>'
verifier=/data/eda/project/hima_harness/operator-admin/atcs-v26/verify-worker-startup.py
verifier_sha256='<REPLACE-WITH-QUALIFIED-VERIFIER-SHA256>'
fresh_slot=/data/eda/project/hima_harness/operator-admin/atcs-v26/fresh-worker-slot.py
fresh_slot_sha256='<REPLACE-WITH-QUALIFIED-FRESH-SLOT-SHA256>'
site_profile=/data/eda/project/hima_harness/atcs-inputs/siteCapabilities-v4.json
site_profile_sha256='<REPLACE-WITH-QUALIFIED-SITE-PROFILE-SHA256>'
bootstrap_root=/data/eda/project/hima_harness/operator-admin/atcs-v26/bootstraps

case "$slot" in
  w01|w02|w03|w04|w05|w06|lead) ;;
  *) echo "slot must be one of w01..w06 or reserved lead" >&2; exit 2;;
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

# Every attempt starts in a slot holding only what prepare-workers wrote: an earlier attempt's outputs move to
# workspaces/<slot>/r<N>.attempt-<k>/ (nothing is deleted) before the verifier checks the slot.
[ -f "$fresh_slot" ] && [ ! -L "$fresh_slot" ] || { echo "administrator slot step is unavailable" >&2; exit 3; }
[ "$(sha256sum "$fresh_slot" | awk '{print $1}')" = "$fresh_slot_sha256" ] || { echo "administrator slot step identity changed" >&2; exit 3; }
python3 -I "$fresh_slot" --workspace "$workspace_arg" --slot "$slot" >&2 || exit 3

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
session_record="$slot_root/session.json"

# How a session ends. The container runs in the background and this shell waits on it, so a close is acted on
# at once. HUP, TERM and INT (the Harness hangs the Job up, then sends TERM to its process group) and EOF on
# stdin (the Harness's normal close ends the REPL's terminal) all close the same way: `podman stop -t 20` (XTop
# is the container's PID 1 and ignores TERM, so podman escalates to SIGKILL after 20 s), `podman rm` if the
# container is still there, then a check that neither the container nor any process of it remains; only then
# exit 0. The stop runs in its own session, so the TERM the Harness sends to this Job's process group after its
# hangup grace cannot cut it short. A session that ends by itself (`exit` in XTop) returns XTop's status.
podman_pid=''
stdin_pid=''
xtop_pid=''
xtop_start=''
xtop_ns=''
closing=''

start_time() {
  local stat
  stat="$(cat "/proc/$1/stat" 2>/dev/null)" || return 1
  stat="${stat##*) }"
  set -- $stat
  printf '%s\n' "${20}"
}

# Every process still in the container's pid namespace, and the recorded XTop pid if it still runs.
container_processes() {
  if [ -n "$xtop_pid" ] && [ "$(start_time "$xtop_pid")" = "$xtop_start" ]; then echo "$xtop_pid"; fi
  [ -z "$xtop_ns" ] || python3 -I -c '
import os, sys
for pid in os.listdir("/proc"):
    if pid.isdigit():
        try:
            if os.readlink("/proc/" + pid + "/ns/pid") == sys.argv[1]:
                print(pid)
        except OSError:
            pass
' "$xtop_ns"
}

stop_container() {
  local tries=0
  if podman container exists "$container_name" 2>/dev/null; then
    setsid --wait podman stop -t 20 -- "$container_name" >/dev/null 2>&1 || true
  fi
  if [ -n "$podman_pid" ]; then
    while kill -0 "$podman_pid" 2>/dev/null && [ "$tries" -lt 50 ]; do sleep 0.1; tries=$((tries + 1)); done
    kill -KILL "$podman_pid" 2>/dev/null || true
    wait "$podman_pid" 2>/dev/null || true
  fi
  tries=0
  while podman container exists "$container_name" 2>/dev/null && [ "$tries" -lt 10 ]; do
    setsid --wait podman rm -f -t 0 -- "$container_name" >/dev/null 2>&1 || true
    tries=$((tries + 1))
    sleep 0.5
  done
  if [ -n "$stdin_pid" ]; then kill -KILL "$stdin_pid" 2>/dev/null || true; wait "$stdin_pid" 2>/dev/null || true; fi
}

close_session() {
  [ -z "$closing" ] || return 0
  closing="$1"
  trap '' HUP INT TERM
  echo "atcs-xtop-operator: close ($closing): stopping $container_name" >&2
  stop_container
  local left
  left="$(container_processes | tr '\n' ' ')"
  if podman container exists "$container_name" 2>/dev/null || [ -n "${left// /}" ]; then
    echo "atcs-xtop-operator: close ($closing) left the container $container_name or its processes: $left" >&2
    exit 5
  fi
  echo "atcs-xtop-operator: closed ($closing): no container and no XTop process remain" >&2
  exit 0
}

leave() {
  if [ -z "$closing" ]; then closing=exit; stop_container; fi
}
trap leave EXIT
trap 'close_session hangup' HUP
trap 'close_session terminate' TERM
trap 'close_session interrupt' INT

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
  -e TZ=America/Los_Angeles \
  -e HTTP_PROXY= -e HTTPS_PROXY= -e ALL_PROXY= -e http_proxy= -e https_proxy= -e all_proxy= \
  -e NO_PROXY=localhost,127.0.0.1,::1,linglong,.local \
  "$image" /bin/bash --noprofile --norc -c '
    set -euo pipefail
    source /data/eda/env/eda_tools_2025_env.sh
    test "${EMPYREAN_LICENSE_MODE}" = old
    exec xtop -f "$1"
  ' -- "$session_tcl" 0<&0 &
podman_pid=$!

# The container's PID 1 is XTop (`exec xtop`). Its name and pid go to the slot, for a person or the Harness.
for _ in $(seq 600); do
  pid="$(podman inspect --format '{{.State.Pid}}' -- "$container_name" 2>/dev/null)" || pid=''
  case "$pid" in ''|0|*[!0-9]*) ;; *) xtop_pid="$pid"; break;; esac
  kill -0 "$podman_pid" 2>/dev/null || break
  sleep 0.1
done
if [ -n "$xtop_pid" ]; then
  xtop_start="$(start_time "$xtop_pid")" || xtop_start=''
  xtop_ns="$(readlink "/proc/$xtop_pid/ns/pid" 2>/dev/null)" || xtop_ns=''
  [ -n "$xtop_start" ] || xtop_pid=''
fi
python3 -I -c '
import json, os, sys
path, name, pid, wrapper = sys.argv[1:]
record = {"container": name, "xtopPid": int(pid) if pid else None, "wrapperPid": int(wrapper)}
with open(path + ".tmp", "w") as out:
    json.dump(record, out)
    out.write("\n")
os.replace(path + ".tmp", path)
' "$session_record" "$container_name" "$xtop_pid" "$$" || echo "atcs-xtop-operator: cannot write $session_record" >&2

# EOF on stdin: stdin is the REPL's terminal. This waits, without reading it, until it hangs up or closes.
python3 -I -c '
import select, signal
for sig in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
    signal.signal(sig, signal.SIG_IGN)
poller = select.poll()
poller.register(0, 0)
poller.poll()
' 0<&0 &
stdin_pid=$!

while :; do
  ended=''
  wait -n -p ended "$podman_pid" "$stdin_pid"
  status=$?
  [ -n "$ended" ] || continue
  if [ "$ended" = "$stdin_pid" ]; then stdin_pid=''; close_session stdin-eof; fi
  break
done
podman_pid=''
closing=exit
stop_container
exit "$status"
