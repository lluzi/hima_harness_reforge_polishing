#!/bin/bash
# Run mage-frb under a private Xvfb display (absolute X server path: after the EDA init script a broken
# vendor Xvfb wrapper shadows /usr/bin/Xvfb on PATH). No xauth; unix socket only; exit code is MAGE's.
set -u
: "${MAGE_HOME:?MAGE_HOME unset}"
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
