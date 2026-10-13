#!/bin/bash
# Drop-in replacement for /data/eda/project/hima_harness/mage-inputs/bin/mage-xvfb.sh.
#
# When the live-display marker file is absent, unreadable, or names a display whose X11 socket is
# not present, this behaves identically to the original: run mage-frb under a private per-round
# Xvfb (absolute X server path: after the EDA init script a broken vendor Xvfb wrapper shadows
# /usr/bin/Xvfb on PATH), no xauth, unix socket only, exit code is MAGE's. The fallback block below
# (from `tmp=$(mktemp …)` on) is byte-for-byte the original `mage-xvfb.sh`, diagnostic prefix
# `mage-xvfb:` included; the only additions are the marker check above it.
#
# When the marker names a display backed by a live X11 socket (the shared xpra display started by
# tool-view/xpra-start.sh, enabled by writing that display name to the marker), this runs mage-frb
# on that display instead, so the round's tool activity is visible live in the Tool tab. No private
# Xvfb is spawned or killed on that path.
set -u
: "${MAGE_HOME:?MAGE_HOME unset}"
marker="${MAGE_LIVE_DISPLAY_MARKER:-/data/eda/project/hima_harness/mage-inputs/live-display}"

if [ -r "$marker" ]; then
  live_disp=$(tr -d '[:space:]' <"$marker")
  num=${live_disp#:}
  if [ -n "$num" ] && [ -S "/tmp/.X11-unix/X$num" ]; then
    export DISPLAY="$live_disp"
    unset XAUTHORITY
    "$MAGE_HOME/bin/mage-frb" "$@"
    exit $?
  fi
  echo "mage-xvfb-live: live-display marker names '$live_disp' but /tmp/.X11-unix/X$num is missing; falling back to a private Xvfb" >&2
fi

tmp=$(mktemp -d /tmp/mage-xvfb.XXXXXX) || exit 97
mkfifo "$tmp/fd" || exit 97
/usr/bin/Xvfb -displayfd 4 -screen 0 1600x1200x24 -nolisten tcp 4>"$tmp/fd" 2>"$tmp/xvfb.log" &
xpid=$!
if ! read -r -t 20 num <"$tmp/fd"; then
  echo "mage-xvfb: Xvfb did not report a display" >&2; cat "$tmp/xvfb.log" >&2
  kill "$xpid" 2>/dev/null; rm -rf "$tmp"; exit 97
fi
export DISPLAY=":$num"
unset XAUTHORITY
"$MAGE_HOME/bin/mage-frb" "$@"
rc=$?
kill "$xpid" 2>/dev/null; wait "$xpid" 2>/dev/null
rm -rf "$tmp"
exit $rc
