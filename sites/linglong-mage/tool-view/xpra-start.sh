#!/bin/bash
# Start (idempotently) the shared xpra HTML5 display that backs this Site's `toolView` declaration
# (kind: xpra-html5, port 14500, label MAGE). Run on linglong by the operator, not by the Pack or the
# resident. Requires xpra on PATH (Ubuntu 24.04: `sudo apt install xpra`, ships 3.1.5).
#
# The resident runs in a podman container that shares the host's /tmp, so /tmp/.X11-unix sockets
# started here are visible inside it. Rather than disable X11 access control globally (`-ac`, which
# would let ANY local process drive this display), the display keeps its xauth cookie and we add one
# narrow grant after start: `xhost +SI:localuser:<operator>` admits clients that the X server sees as
# the same local user over the unix socket. The resident container runs as that same uid (1000) and
# shares /tmp/.X11-unix, so MAGE inside it reaches the display; a process running as a different uid
# does not. See the README "Residual risk" note.
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

# No `--start=...`: xpra runs with no initial child, and MAGE puts its own windows on the display.
# Server-side refusals, not just client URL preferences: these make the xpra *server* refuse the
# features, so no client — ours, another local user's, or the resident — can move data or start a
# command through it. `--xvfb` drops `-ac`; xpra manages the display's xauth cookie itself, and the
# narrow xhost grant below is what lets the same-uid resident reach it.
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
  --start-new-commands=no \
  --file-transfer=no \
  --open-files=no \
  --open-url=no \
  --printing=no \
  --clipboard=no \
  --xvfb="/usr/bin/Xvfb +extension Composite -screen 0 1920x1200x24 -nolisten tcp -noreset"
rc=$?
if [ "$rc" -ne 0 ]; then
  echo "xpra-start: xpra start $display failed (exit $rc)" >&2
  exit "$rc"
fi

# Admit the same-uid resident container over the unix socket, without a global `-ac`. Wait briefly
# for the X socket first (xpra --daemon returns before the server is fully up). If xpra's own Xvfb
# invocation ends up needing an explicit -auth that it did not add, drop the custom --xvfb above and
# use xpra's default handling (README "Residual risk"); the xhost grant stays either way.
num="${display#:}"
for _ in $(seq 1 50); do [ -S "/tmp/.X11-unix/X$num" ] && break; sleep 0.1; done
if command -v xhost >/dev/null 2>&1; then
  DISPLAY="$display" xhost "+SI:localuser:$(id -un)" >/dev/null 2>&1 \
    || echo "xpra-start: warning: could not grant $display access to $(id -un) via xhost" >&2
else
  echo "xpra-start: warning: xhost not found at /usr/bin/xhost; the resident may be unable to reach $display" >&2
fi

echo "xpra-start: $display started, HTML5 client on 127.0.0.1:$port"
echo "xpra-start: verify with: curl -sI http://127.0.0.1:$port/ | head -n 1"
echo "xpra-start: verify server refusals with: xpra showconfig | grep -E 'start-new-commands|file-transfer|sharing'"
