# Tool view for linglong-mage

How to stand up the shared, viewable MAGE display that this Site's `toolView` declaration
(`site.yml`: `kind: xpra-html5, port: 14500, label: MAGE`) points the Campaign pane's **Tool** tab
at, and how to route a round's MAGE process onto it instead of its private per-round Xvfb.

## Prerequisites

- xpra on linglong. Ubuntu 24.04 ships 3.1.5 in apt: `sudo apt install xpra` (the operator runs
  this; it needs sudo). If the bundled HTML5 client ever misbehaves (stale JS, missing feature),
  the xpra.org apt repository (https://xpra.org/trac/wiki/Download) carries newer 3.x/4.x builds as
  a fallback — add it and `apt install xpra` again.
- The resident's podman container already shares the host's `/tmp`, so a socket under
  `/tmp/.X11-unix` started on the host is visible inside the container with no extra mount.

## Start

```
sites/linglong-mage/tool-view/xpra-start.sh
```

Starts xpra display `:1100` with its HTML5 client on `127.0.0.1:14500` (override with env vars
`XPRA_DISPLAY` / `XPRA_PORT`; keep `XPRA_PORT` in step with `site.yml`'s `toolView.port` if you
change it). Idempotent: if `xpra list` already shows that display `LIVE`, it prints "already
running" and exits 0 without starting a second server.

## Verify

```
curl -sI http://127.0.0.1:14500/ | head -n 1
```

Expect an HTTP response line (e.g. `HTTP/1.1 200 OK`) once xpra is up. This is the same URL shape
the Host's tool-view module polls for readiness.

## Enable the live display for MAGE rounds

By default, MAGE still runs under its private per-round Xvfb (`mage-inputs/bin/mage-xvfb.sh`,
unobservable, killed after each round) — starting xpra alone changes nothing. To route rounds onto
the shared, viewable display instead:

1. Install `mage-xvfb-live.sh` at `/data/eda/project/hima_harness/mage-inputs/bin/mage-xvfb.sh`
   (the path this Site's `siteCapabilities` binding already names), replacing the private-only
   launcher. Behaviour is identical to the original when the marker below is absent — this is a
   safe drop-in.
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
- Stop the xpra server when it is no longer needed: `xpra stop :1100`.

## Limits

- One MAGE session lives on the shared display at a time: it is a single display, not a pool. Two
  Campaigns on this Site cannot both get a usable Tool tab concurrently on the same `:1100`.
- The resident agent drives the tool during a round; expect its mouse and keyboard activity to be
  visible while a round is in progress, not just a static screen.
- A person can take control between rounds (or while the resident is otherwise idle on the
  display) via **Take control** in the Tool tab; press **Hand back** to return to view-only before
  the next round starts driving it. Taking control while the resident is actively operating the
  tool can race with it — coordinate with whoever owns the running Campaign first.
