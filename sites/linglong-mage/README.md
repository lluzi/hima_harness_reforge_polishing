# linglong-mage Site

Site for the `mage-scribe-placement` Pack: the resident engineering agent runs the real Empyrean
MAGE scribe-placement tool on linglong, round by round, inside one Fabric repeat.

## Layout on linglong

| Path | Use |
| --- | --- |
| `/data/eda/project/hima_harness/mage-runs` | Campaign workspaces (`workspaceRoot`) |
| `/data/eda/project/hima_harness/mage-inputs/p23-case-v1/` | the staged P23 frame case: a frozen customer bundle copy with the pblock GDS path adapted to `${MAGE_PBLOCK_HOME}/output.gds` and `case-adaptation.json` recording the original and adapted sha256; `incumbent/placement.pla` is the kit's native baseline (135,113 µm), sha256 `0a95e89d61cf46bcd4575227ff4be11d7c0a37b5690522f27eae2173b0f61901`; `manifest.json`, `consumer-context.json`, `site-capabilities.json` are machine-local and bound below. The case's own `case/` contents are not named here or anywhere in this repository. |
| `/data/eda/project/hima_harness/mage-inputs/bin/mage-xvfb.sh` | the launcher this Site's `bindings.siteCapabilities` names (sha256 `7d234a4c566fd426a9521c81e5d86a6b41b2f5d4f99a29f373f02ca561d51cf1`, byte-identical to this repo's `bin/mage-xvfb.sh`); mode 755 |
| `/data/eda/project/hima_harness/operator-admin/resident-engineering-v1/engineering-capabilities-mage-v1.json` | the installed capability (`bindings.engineeringCapabilities`) |

The launcher wraps MAGE's `bin/mage-frb` under `/usr/bin/Xvfb` rather than the `Xvfb` on `PATH`
inside the resident container, because that `PATH` entry there is a broken Synopsys Verdi wrapper.
It is copied byte-for-byte from the verified smoke location and is not edited by this Site.

## Install record (administrator preparation, verified by the controller)

Installed and verified directly on linglong, outside this slice:

1. **Capability.** To be installed by the administrator (main agent) after this commit: copy
   `engineering-capabilities-mage-v1.json` unchanged, mode 0444, to
   `/data/eda/project/hima_harness/operator-admin/resident-engineering-v1/engineering-capabilities-mage-v1.json`,
   next to the existing wrapper. Its `wrapper.argv` names that exact path. It reuses the installed
   `resident-engineering-wrapper.py` (identical to the repo template), the OpenCode 1.18.34
   executable, and the same podman image as the other resident capabilities on this host.
2. `mkdir -p /data/eda/project/hima_harness/{mage-runs,mage-inputs/p23-case-v1}`.
3. **Case staging.** The staged P23 frame case was copied to `mage-inputs/p23-case-v1/` (frozen
   customer bundle copy with the pblock GDS path adapted; `case-adaptation.json` records the
   original and adapted sha256), with `incumbent/placement.pla` (sha256
   `0a95e89d61cf46bcd4575227ff4be11d7c0a37b5690522f27eae2173b0f61901`) and a stamped
   `manifest.json` / `consumer-context.json` / `site-capabilities.json` using absolute linglong
   paths.
4. `mage-inputs/bin/mage-xvfb.sh` installed at the sha256 above.
5. **Verification.** `task-prepare-case` and `task-measure-incumbent` ran on linglong host Python
   against the staged case in a scratch workspace: 10 Fixed, 225 Groups/Fits, 225/225 targets bound
   by Group point; the incumbent measured 27 ordinary drops / 135,113 µm total drop length, 60
   targets beyond the 100 µm goal (max 2847.7 µm), order deviation max 2, and zero movement.

## Known constraints

- **Licence window.** The MAGE licence (`EMPYREAN_LICENSE_FILE_OVERRIDE` / `EMPYREAN_LICENSE_FILE`
  `59011@localhost`) is served inside a user-run maintenance window, not continuously: the user runs
  `sudo bash /home/luzi/mage_smart_conflict_resolver/practice-20261006/scripts/run_mage_window.sh --maintenance-approved`,
  at most 810 s per invocation, and closes it early with
  `touch /home/luzi/mage_smart_conflict_resolver/practice-20261006/window/request-close`. A
  Campaign's MAGE rounds must fall inside an open window; the resident never opens, extends or
  closes the window itself. `/data/eda/env/empyrean-2025-env.sh` honours the override variable.
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
this host.
