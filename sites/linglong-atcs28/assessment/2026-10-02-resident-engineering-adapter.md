# Issue #82 Site adapter evidence — 2026-10-02

Scope: read-only Site inventory and local deterministic protocol tests. No model request, OpenCode
session, EDA process, installation, remote file write, or deployment was performed.

## Native and protocol identity

- Site kernel: `Linux 7.0.0-31-generic`; account: `luzi`.
- `/home/luzi/.opencode/bin/opencode --version`: `1.18.34`. No alternate executable existed under
  `/home/luzi/.opencode`; the earlier design-time 1.18.31 inventory is stale.
- `opencode models` listed `deepseek/deepseek-flash`; no model was invoked.
- Official OpenCode ACP documentation says `opencode acp` is a JSON-RPC stdio subprocess. Source tag
  `v1.18.34` is commit `aec0b9a6d8898f68f923aaf08b7306d931fd9d76`; its ACP implementation uses
  `@agentclientprotocol/sdk` 0.21.0 and exposes initialize, session/new, prompt, cancel, permission,
  model selection, and close over NDJSON stdio.

Primary references:

- https://opencode.ai/docs/acp/
- https://github.com/anomalyco/opencode/tree/v1.18.34/packages/opencode/src/acp

## Isolation selection

Read-only discovery found `/usr/bin/bwrap`, `/usr/bin/unshare`, `/usr/bin/systemd-run`, rootless Podman,
and Docker. Bubblewrap was not usable: `bwrap: setting up uid map: Permission denied`; `unshare -Ur`
also failed. The smallest already working environment compatible with XTop is the existing rootless
Podman image:

- image ID: `7d651dc8f1ab7d423b9d61be83fc3f5d608996ed7b91fa6588c3ed16daccfd54`
- observed tag/digest: `localhost/edarunner:alma8`,
  `sha256:8467102dbae851e4136e998661ae3a01ad9b65d49711c82f2b0883ab8d1bbb8c`

A no-model/no-EDA `podman run --rm --read-only --network none --userns keep-id
--security-opt=no-new-privileges --cap-drop=all` probe mounted the exact OpenCode executable read-only;
it reported `1.18.34`. A second probe wrote a private tmp file, attempted to append to
`atcs-inputs/designStateManifest-postroute-final.json`, observed `Permission denied`, and confirmed its
pre/post SHA-256 was unchanged. Production adds only the read roots in the capability, task-private
workspace/home write mounts, the proven XTop shm/ulimit profile, and host networking required by model
and licence services.

The existing OpenCode config and `auth.json` require exact read-only mounts. They are excluded from
prompts, argv, logs and delivery, but OpenCode tools share the container uid and can technically read
the auth mount. This is recorded native-client trust, not secret isolation.

## Deterministic protocol tests

Initial RED: 4/4 original lifecycle tests failed because the wrapper did not exist. Current command:

```sh
python3 sites/linglong-atcs28/test_resident_engineering_wrapper.py -v
```

Current GREEN: 11/11 in 2.53 seconds, covering persistent session start/message, stand-in-generated
delivery, best-effort fixture support, native permission rejection/event retention, detached descendant
cancel, unknown/no-replay restart, exact live-owned-process reconciliation before release, full
160-character Host request IDs, exact Campaign-workspace scope/refusal, and same-session result repair
with immutable prior artifact snapshots plus atomic latest delivery manifests. `py_compile` and `git
diff --check` also pass.

## Deployment blockers retained

Read-only existence checks reported all three production targets absent:

- `/data/eda/project/hima_harness/operator-admin/resident-engineering-v1/resident-engineering-wrapper.py`
- `/data/eda/project/hima_harness/operator-admin/resident-engineering-v1/engineering-capabilities-v1.json`
- `/data/eda/project/hima_harness/atcs-inputs/nativeTimingContext-v1.json`

The Site is therefore not deployed or L4-qualified. Bounded retained-STA verification found matching
context/observation/working-state identity in `qual-v31-20261002T051947Z/native`: ordered scenarios match
the current manifest, its 48-file STA tree recomputes to the recorded digest, the retained/current SDC
hashes agree, and all 16 recorded source-report paths remain plain files with matching hashes. The v28
observe script and report headers establish the exact producer command and PrimeTime X-2025.06. Those
facts are captured in the local `inputs/nativeTimingContext-v1.json` candidate; it remains undeployed
and must be rechecked immediately before administrator publication.
