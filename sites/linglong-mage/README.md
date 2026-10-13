# linglong-mage Site

Site for the `mage-scribe-placement` Pack: the resident engineering agent runs the real Empyrean
MAGE scribe-placement tool on linglong, round by round, inside one Fabric repeat.

## Layout on linglong

| Path | Use |
| --- | --- |
| `/data/eda/project/hima_harness/mage-runs` | Campaign workspaces (`workspaceRoot`) |
| `/data/eda/project/hima_harness/mage-inputs/scribe-case-v1/` | the staged frame case: a frozen customer bundle copy with the pblock GDS path adapted to `${MAGE_PBLOCK_HOME}/output.gds` and `case-adaptation.json` recording the original and adapted sha256; `incumbent/placement.pla` is the kit's native baseline, sha256 `0a95e89d61cf46bcd4575227ff4be11d7c0a37b5690522f27eae2173b0f61901`; `manifest.json`, `consumer-context.json`, `site-capabilities.json` are machine-local and bound below. The case's own `case/` contents, and any measurement figures taken from it, are not named here or anywhere in this repository. |
| `/data/eda/project/hima_harness/mage-inputs/bin/mage-xvfb.sh` | the launcher this Site's `bindings.siteCapabilities` names (sha256 `7d234a4c566fd426a9521c81e5d86a6b41b2f5d4f99a29f373f02ca561d51cf1`, byte-identical to this repo's `bin/mage-xvfb.sh`); mode 755 |
| `/data/eda/project/hima_harness/operator-admin/resident-engineering-v1/engineering-capabilities-mage-v1.json` | the installed capability (`bindings.engineeringCapabilities`) |

The launcher wraps MAGE's `bin/mage-frb` under `/usr/bin/Xvfb` rather than the `Xvfb` on `PATH`
inside the resident container, because that `PATH` entry there is a broken Synopsys Verdi wrapper.
It is copied byte-for-byte from the verified smoke location and is not edited by this Site.

## Tool view (live MAGE display)

This Site declares `toolView: {kind: xpra-html5, port: 14500, label: MAGE}`, so a Campaign's
**Tool** tab can show MAGE's real display while the resident drives it, and a person can take
control between rounds. Setting up and operating the shared xpra display, and the drop-in launcher
override that points a round at it instead of a private per-round Xvfb, are documented in
`tool-view/README.md`; the scripts are `tool-view/xpra-start.sh` and `tool-view/mage-xvfb-live.sh`.
Nothing here changes the round-by-round launcher behaviour described above when the Tool view's
live-display marker is absent.

## Install record (administrator preparation, verified by the controller)

Installed and verified directly on linglong, outside this slice:

1. **Capability.** Installed, sha256
   `24a771a3496e302a8cb2ddadd4d55f54e4e2738431accfe36b7a7c6d518b4812` (byte-identical to this repo's
   `engineering-capabilities-mage-v1.json`), mode 0444, at
   `/data/eda/project/hima_harness/operator-admin/resident-engineering-v1/engineering-capabilities-mage-v1.json`,
   next to the existing wrapper. Its `wrapper.argv` names that exact path. It reuses the installed
   `resident-engineering-wrapper.py` (identical to the repo template), the OpenCode 1.18.34
   executable, and the same podman image as the other resident capabilities on this host.
2. `mkdir -p /data/eda/project/hima_harness/{mage-runs,mage-inputs/scribe-case-v1}`.
3. **Case staging.** The staged frame case was copied to `mage-inputs/scribe-case-v1/` (frozen
   customer bundle copy with the pblock GDS path adapted; `case-adaptation.json` records the
   original and adapted sha256), with `incumbent/placement.pla` (sha256
   `0a95e89d61cf46bcd4575227ff4be11d7c0a37b5690522f27eae2173b0f61901`) and a stamped
   `manifest.json` / `consumer-context.json` / `site-capabilities.json` using absolute linglong
   paths.
4. `mage-inputs/bin/mage-xvfb.sh` installed at the sha256 above.
5. **Verification.** `task-prepare-case` and `task-measure-incumbent` ran on linglong host Python
   against the staged case in a scratch workspace: the Fixed, Group/Fit and target-binding
   inventories reproduced, every target bound by Group point, and the incumbent's ordinary-drop,
   drop-length, beyond-goal, order-deviation and movement measurements recorded machine-locally
   (the figures themselves are not reproduced in this repository).

## Known constraints

- **Licence server.** The MAGE licence (`EMPYREAN_LICENSE_FILE_OVERRIDE` / `EMPYREAN_LICENSE_FILE`
  `59003@localhost`) is served by the permanent `empyrean-mage-lmgrd.service` systemd unit (Empyrean
  Mage 2026 FlexNet), which covers every MAGE feature used here (MAGE_GUI, MAGE_SHELL,
  MAGE_AUTO_REFINE, MAGE_DRC, …; 5 seats each; features expire 31-oct-2026). Verify with
  `<MAGE_HOME>/exe/lmutil lmstat -a -c 59003@localhost`. `/data/eda/env/empyrean-2025-env.sh`
  honours the override variable. The earlier `59011@localhost` maintenance-window helper
  (`run_mage_window.sh`) is historical and is not used by this Site.
- **Parallel jobs.** `parallelJobs: 2`; a Site declaring only 1 slot stalls resident release (the
  release of one round's seat needs a second slot free to proceed), so this Site always declares 2
  even though the Pack holds the `mage` licence (seat count 1) only during `engineer-place`.
- **Round-end detection.** The vendor `bin/mage-frb` always exits 0 regardless of outcome, so the
  Pack judges each round by the `MAGE_ROUND_END code 0` marker the launcher emits, not by the
  process exit code.
- **Python version.** Inside the resident container, after the EDA init script runs, `python3` is
  3.8.16 — older than the 3.9+ the Pack's prototype scripts were first written against; the Pack's
  Python stays 3.8-compatible (see the global constraints' 2026-10-12 amendment) specifically for
  this Site.

## What is not installed

No new wrapper, podman image, Python package, or licence-server change. The capability file is the
only new artifact under `operator-admin/resident-engineering-v1/`; everything else it names
(wrapper, OpenCode binary, image) is already installed there for the other resident capabilities on
this host. The Tool view's xpra server is a separate, optional operator step (`tool-view/README.md`)
and installs nothing beyond the apt `xpra` package the operator runs themselves.
