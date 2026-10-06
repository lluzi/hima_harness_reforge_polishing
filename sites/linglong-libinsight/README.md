# linglong-libinsight Site

Site for the `libinsight-analysis` Pack (ADR-0020, spec `docs/specs/libinsight-resident/`): the
resident engineering agent answers custom library-analysis questions on linglong in facts mode
(QuaLib-extracted `lib-insight-facts/1` files, no licence) or live QuaLib 2026 mode.

## Layout on linglong

| Path | Use |
| --- | --- |
| `/data/eda/project/hima_harness/libinsight-runs/campaigns` | Campaign workspaces (`workspaceRoot`) |
| `/data/eda/project/hima_harness/libinsight-runs/requests` | Host-written `<requestId>.json` requests (`analysisRequests`); each Run overrides `analysisRequest` with its file |
| `/data/eda/project/hima_harness/libinsight-runs/library` | admitted analyses `<id>/v<version>/` (`analysisLibrary`) |
| `/data/eda/project/hima_harness/library-intelligence-prototypes/claude-libint-20260923-01/canonical` | read-only facts corpus (`factsCorpus`) |
| `/data/eda/env/empyrean-license-mode` | the one-word Empyrean licence mode (`licenceModeFile`), read only |

The `analysisRequest` binding is a placeholder (`requests/unset.json`) that keeps the contract input
bound for `checkPack`; prepare-request fails clearly when a Run does not override it.

`sourceReadRoots` repeats the Permit's `allowedReadRoots` joined with `:` because Pack tools run on
the Site and cannot read the Permit; prepare-request and the Reader bound every source to it. Change
both files together.

The Permit writes only under `libinsight-runs`. Read roots add the QuaLib API, the vendor venv,
the SAED14 PDK, `techlib/tsmc28`, the facts corpus and the resident admin directory.

## Install record (one-time administrator preparation)

Installed by the integrator, not by this slice:

1. `engineering-capabilities-libinsight-v1.json` copied unchanged, mode 0444, to
   `/data/eda/project/hima_harness/operator-admin/resident-engineering-v1/engineering-capabilities-libinsight-v1.json`
   next to the existing wrapper. Its `wrapper.argv` names that exact path. It reuses the installed
   `resident-engineering-wrapper.py` (sha256 `85d64ee8…9e799`, identical to the repo template), the
   OpenCode 1.18.34 executable and image `7d651dc8…` (`localhost/edarunner:alma8`).
2. `mkdir -p /data/eda/project/hima_harness/libinsight-runs/{campaigns,requests,library}` — the
   capability bind-mounts `library` and `requests` read-only, and Podman refuses to start a container
   whose bind source is missing.

Nothing else is installed: no new wrapper, image, Python package or licence change.

## Known constraints

- **Licence mode.** linglong serves one Empyrean licence at a time; the user switches with
  `empyrean-license new` (QuaLib Liberty API, port 59099) and `empyrean-license old` (XTop, port
  59001). Live QuaLib needs `new`; facts mode works in either. prepare-request refuses a request that
  needs live QuaLib while the mode file is not `new`. The resident never switches it.
- **Wrapper entry check.** The container entry of the unchanged wrapper runs
  `test "${EMPYREAN_LICENSE_MODE:-}" = old; exec "$@"` under `bash -c` without `set -e`, so the test
  result is ignored: the resident still starts in mode `new`. It inherits the licence environment of
  the mode at container start; the playbook re-sources `EDA_INIT` per QuaLib command.
- **Python in the sandbox.** `/usr/bin/python3` inside the edarunner image is 3.6.8 and the vendor
  runtime is 3.7.12; neither has numpy, so LibInsight's own engine cannot run inside the sandbox.
- **Concurrency.** The custom-analysis tool holds `QuaLib-2026-new-59099: 1`, so one resident analysis
  runs per Site at a time. XTop work on `linglong-atcs28` and QuaLib work here are not mutually
  excluded by the Host (as for library-intelligence); the licence mode switch is the operator's
  serialization point.

## Verification (2026-10-05)

Facts mode: the Pack's worked example ran on the SAED14 RVT TT facts file with `/usr/bin/python3`
3.12.3 on the host and with python3 3.6.8 inside the edarunner image (sandbox mount shape); both
deliveries passed `check-delivery`, and the host delivery passed the Reader, admission and deliver.
Live QuaLib, inside the same image: in licence mode `old` the probe got a null handle (FlexNet
-15,570) and exited 3; after the user switched to `new`, the playbook command (licence from
`EDA_INIT`, no override) read SAED14 RVT TT in 0.79 s, its 92 inverter delay tables equal the corpus
facts exactly, and the live delivery passed `check-delivery` and the Reader. Every run left the source
sha256 unchanged. Evidence directory: `/data/eda/project/hima_harness/libinsight-runs/dev/claude-r1-20261005`.
