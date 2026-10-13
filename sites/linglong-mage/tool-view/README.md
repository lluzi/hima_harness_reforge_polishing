# Tool view for linglong-mage

How to stand up the shared, viewable MAGE display that this Site's `toolView` declaration
(`site.yml`: `kind: xpra-html5, port: 14500, label: MAGE`) points the Campaign pane's **Tool** tab
at, and how to route a round's MAGE process onto it instead of its private per-round Xvfb.

## Prerequisites

- xpra on linglong. Ubuntu 24.04 ships 3.1.5 in apt: `sudo apt install xpra` (the operator runs
  this; it needs sudo). If the bundled HTML5 client ever misbehaves (stale JS, missing feature),
  the xpra.org apt repository (https://github.com/Xpra-org/xpra/wiki/Download) carries newer
  builds (6.x at time of writing) as a fallback — add it and `apt install xpra` again.
- `xhost` on linglong (`/usr/bin/xhost`, from `x11-xserver-utils`). `xpra-start.sh` uses it to grant
  the resident narrow access to the display without disabling X11 access control globally.
- The resident's podman container already shares the host's `/tmp`, so a socket under
  `/tmp/.X11-unix` started on the host is visible inside the container with no extra mount.

## Install the scripts on linglong

These scripts live in this repo; they run on linglong. Copy them to a working path there, for
example:

```
scp sites/linglong-mage/tool-view/xpra-start.sh sites/linglong-mage/tool-view/mage-xvfb-live.sh \
  luzi@<linglong>:/data/eda/project/hima_harness/tool-view/
ssh luzi@<linglong> 'chmod 755 /data/eda/project/hima_harness/tool-view/*.sh'
```

Then run `xpra-start.sh` from that path on linglong (the examples below use the repo-relative name
for brevity).

## Start

```
sites/linglong-mage/tool-view/xpra-start.sh
```

Starts xpra display `:1100` with its HTML5 client on `127.0.0.1:14500` (override with env vars
`XPRA_DISPLAY` / `XPRA_PORT`; keep `XPRA_PORT` in step with `site.yml`'s `toolView.port` if you
change it). Idempotent: if `xpra list` already shows that display `LIVE`, it prints "already
running" and exits 0 without starting a second server. The server is started with its data-moving
and command-starting features refused server-side (`--start-new-commands=no --file-transfer=no
--open-files=no --open-url=no --printing=no --clipboard=no`) and with no initial child window;
after start it grants the same-uid resident access to the display with `xhost +SI:localuser:<you>`
instead of a global `-ac`.

## Verify

```
curl -sI http://127.0.0.1:14500/ | head -n 1
```

Expect an HTTP response line (e.g. `HTTP/1.1 200 OK`) once xpra is up. This is the same URL shape
the Host's tool-view module polls for readiness.

Confirm the server-side refusals took effect (these are what bind other clients, not just our URL
options):

```
xpra showconfig | grep -E 'start-new-commands|file-transfer|clipboard|sharing'
```

Confirm the resident container can actually reach the display over the shared socket:

```
podman exec <resident-container> test -S /tmp/.X11-unix/X1100 && echo reachable
```

## Enable the live display for MAGE rounds

By default, MAGE still runs under its private per-round Xvfb (`mage-inputs/bin/mage-xvfb.sh`,
unobservable, killed after each round) — starting xpra alone changes nothing. To route rounds onto
the shared, viewable display instead:

1. Back up the installed launcher first, then install `mage-xvfb-live.sh` at
   `/data/eda/project/hima_harness/mage-inputs/bin/mage-xvfb.sh` (the path this Site's
   `siteCapabilities` binding already names), replacing the private-only launcher. Its fallback
   block is byte-for-byte the original, so behaviour is identical when the marker below is absent —
   a safe drop-in.
   ```
   cd /data/eda/project/hima_harness/mage-inputs/bin
   cp -p mage-xvfb.sh mage-xvfb.sh.orig          # one-time backup
   install -m 755 /data/eda/project/hima_harness/tool-view/mage-xvfb-live.sh mage-xvfb.sh
   ```
2. Write the live display name to the marker file:
   ```
   echo :1100 > /data/eda/project/hima_harness/mage-inputs/live-display
   ```
   (matching whatever `XPRA_DISPLAY` was used in Start, above).

From the next round onward, the launcher checks the marker, confirms the display's X11 socket
exists, and runs `mage-frb` there instead of spawning a private Xvfb. A Campaign on this Site then
shows a **Tool** tab (labelled "MAGE") in the pane next to Live, Generations, Evidence and Report;
opening it shows MAGE's real display, view-only, with a **Take control** button.

## Rollback

- Delete the marker file (`rm /data/eda/project/hima_harness/mage-inputs/live-display`) to return
  every subsequent round to a private per-round Xvfb immediately — `mage-xvfb-live.sh` behaves
  exactly like the original launcher once the marker is gone.
- To fully revert the launcher, restore the backup taken in step 1:
  `cd /data/eda/project/hima_harness/mage-inputs/bin && cp -p mage-xvfb.sh.orig mage-xvfb.sh`.
- Stop the xpra server when it is no longer needed: `xpra stop :1100`.

## Residual risk

This is an honest statement of what the display grants, not a guarantee of isolation:

- `:1100` is a shared X display. Any process that can open it — MAGE from the resident container,
  and any process running as the same local user (uid 1000) on linglong — can observe its contents
  and inject X input (XTEST keystrokes and pointer events) into whatever windows are on it. X11 has
  no per-window isolation. So **the display must hold only MAGE**: do not start other GUI programs,
  and in particular no terminal, on `:1100`. The launcher starts xpra with no initial child for this
  reason, and the only window placed on the display is MAGE's own via `mage-xvfb-live.sh`.
- The grant is uid-scoped (`xhost +SI:localuser:<operator>`), not global (`-ac`): a process running
  as a *different* uid cannot reach the display. It is the same-uid resident this admits, by design.
- The HTML5 server binds loopback only (`127.0.0.1:14500`) and is reached from the App solely through
  the Host's dedicated SSH forward to this machine. It is not exposed on the network, and nothing in
  the repo publishes the Site's address or port to the client. The xpra server also refuses file
  transfer, clipboard, printing, URL/file open and new-command starts server-side, so a client that
  reaches it still cannot move data or start a command by those paths.

## Limits

- One MAGE session lives on the shared display at a time: it is a single display, not a pool. Two
  Campaigns on this Site cannot both get a usable Tool tab concurrently on the same `:1100`.
- The Host opens one forward and one `localhost` URL per Site, shared by every Run and pane on that
  Site (matching `licences.mage: 1`, one display). The URL asks `sharing=true`, but the server is
  not started with `--sharing=yes`, so a second simultaneous HTML5 viewer may be refused by xpra.
  That is intended for this single-seat Site; if more than one concurrent viewer is ever wanted, add
  `--sharing=yes` to `xpra-start.sh`.
- The resident agent drives the tool during a round; expect its mouse and keyboard activity to be
  visible while a round is in progress, not just a static screen.
- A person can take control between rounds (or while the resident is otherwise idle on the
  display) via **Take control** in the Tool tab; press **Hand back** to return to view-only before
  the next round starts driving it. Taking control while the resident is actively operating the
  tool can race with it — coordinate with whoever owns the running Campaign first.
