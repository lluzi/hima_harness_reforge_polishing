#!/bin/bash
# Start (idempotently) the shared xpra HTML5 display that backs this Site's `toolView` declaration
# (kind: xpra-html5, port 14500, label MAGE). Run on linglong by the operator, not by the Pack or the
# resident. Requires xpra on PATH (Ubuntu 24.04: `sudo apt install xpra`, ships 3.1.5).
#
# The resident runs in a podman container that shares the host's /tmp, so /tmp/.X11-unix sockets
# started here are visible inside it; that is why the embedded Xvfb below runs with -ac (no X11
# access control) rather than relying on xauth across the container boundary.
#
# Env overrides: XPRA_DISPLAY (default :1100), XPRA_PORT (default 14500; keep in step with
# site.yml's toolView.port if you change it).
set -u

display="${XPRA_DISPLAY:-:1100}"
port="${XPRA_PORT:-14500}"

if ! command -v xpra >/dev/null 2>&1; then
  echo "xpra-start: xpra not found on PATH; install it with: sudo apt install xpra" >&2
  exit 97
fi

if xpra list 2>/dev/null | grep -F "$display" | grep -q "LIVE"; then
  echo "xpra-start: $display already running"
  exit 0
fi

xpra start "$display" \
  --bind-tcp="127.0.0.1:$port" \
  --html=on \
  --daemon=yes \
  --mdns=no \
  --notifications=no \
  --pulseaudio=no \
  --speaker=off \
  --microphone=off \
  --webcam=no \
  --dbus-launch= \
  --xvfb="/usr/bin/Xvfb -ac +extension Composite -screen 0 1920x1200x24 -nolisten tcp -noreset" \
  --start=xterm
rc=$?
if [ "$rc" -ne 0 ]; then
  echo "xpra-start: xpra start $display failed (exit $rc)" >&2
  exit "$rc"
fi

echo "xpra-start: $display started, HTML5 client on 127.0.0.1:$port"
echo "xpra-start: verify with: curl -sI http://127.0.0.1:$port/ | head -n 1"
