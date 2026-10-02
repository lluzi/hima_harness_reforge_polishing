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

The original candidate mounted OpenCode config and `auth.json` read-only into the native home; review
correctly showed that a shell could still read the account key. The corrected wrapper keeps one auth
path on the wrapper host, exposes only a sanitized task profile plus ephemeral local route token, and
forwards only `deepseek-flash` chat-completion requests through an in-process broker. A fake upstream
received the real dummy account header while recursive task-home and native-argv checks found no dummy
account key/path. No actual provider call was made.

A zero-network, ephemeral Podman probe first ran the installed OpenCode 1.18.34 `debug config` against a
tmpfs-only home containing the same sanitized profile and a dummy route token. It resolved model
`deepseek/deepseek-flash` and base URL `http://127.0.0.1:43123/deepseek`; provider fields contained only
`options`. A second probe used the exact `opencode acp --pure --cwd /work` native argv, performed only
ACP initialize/new-session/close, observed agent version 1.18.34 and model currentValue
`deepseek/deepseek-flash`, then exited 0. Both containers were removed; network was disabled, so neither
probe made a model/API call or persistent Site write.

## Deterministic protocol tests

Initial RED: 4/4 original lifecycle tests failed because the wrapper did not exist. Current command:

```sh
python3 sites/linglong-atcs28/test_resident_engineering_wrapper.py -v
```

Review RED reproduced the delivery escape: `linked-parent/auth.json` followed a workspace symlink and
was incorrectly accepted as a result artifact. Current GREEN is 22/22 in 11.33 seconds, including
no-follow positive/negative containment, dummy provider credential separation, selected-model
streaming forwarding, fixed one-shot/never-started/HUP reconciliation, and the original task protocol
cases.
The original protocol set covers persistent session start/message, a 5.5-second message
with immediate durable queue acknowledgement and later native completion fact, stand-in-generated
delivery, best-effort fixture support, native permission rejection/event retention, detached descendant
cancel, unknown/no-replay restart including an accepted but unfinished message, exact
live-owned-process reconciliation before release, full
160-character Host request IDs, exact Campaign-workspace scope/refusal, and same-session result repair
with immutable prior artifact snapshots plus atomic latest delivery manifests. `py_compile` and
`git diff --check` also pass.

After a fresh build, the final focused public Host recovery file passed 12/12 in 30.95 seconds using
11 actual in-process Hosts and zero SSH/model/Electron attempts. Its main lifecycle case
asserts the slow message returns `accepted` before the Host's five-second wait, then waits for the actual
completion state before delivery. The same suite retains cancel, unknown/no-replay, best-effort,
capacity/licence, same-session Reader repair, wrapper-crash cleanup, never-started cleanup and restart
fencing coverage.

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
