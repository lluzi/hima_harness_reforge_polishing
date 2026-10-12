# Linux asset assembly and native runtime qualification

This is a partial [#100](https://github.com/lluzi/hima_harness_reforge_polishing/issues/100) integration cut based on `009d66885c3853467422fb6bb89ea310ec983ea0`. It adds the exact `linux-x64` retained asset closure to the shared catalog. It does not close #100, enable member activation, authorize a product/installer release, or merge main. Darwin asset declarations remain identical. The catalog DSH version now matches the rc.2 dependency cohort already qualified by #99.

## Frozen inputs

The combined immutable prefix contains 49,030 files. Manifest SHA256 is `5616cc4f5f4f4f328ebd7614e72b30e08fafbc4f38458b3f0b99056a4d03bac8`; inventory and component/helper/notice hashes are bound by `packages/desktop/team-runtime.pin.json`. A separately verified inner PostgreSQL manifest represents all PostgreSQL files; eight internal links were flattened only in the new staging copy. All original inputs are retained unchanged.

The exact 101-file v2 helper/source/notice/relink tree was retrieved and independently hash/size/mode verified. nft SHA256 is `6742f5caa96035b791c28b020ccc4f8dcf32866375958be54b30dd3b158c244f`, nsenter SHA256 is `8acc24f3cb9d9205caeb73cbbc0d9c71f84aaf9862e83853d08580111c25906d`. Helpers use the normal host loader; nft requires GLIBC up to 2.27 and nsenter up to 2.14. Static symbol requirements do not qualify an operating system or its loader/kernel.

Hindsight retains the fixed `hindsight-api-slim/0.10.3` source identity: 360 installed RECORD-owned files matched their recorded hash and size, and the full metapackage wrappers do not overwrite API code. Python 3.12.13, CPU dependency lock, model revisions, PostgreSQL 16.15/vector 0.8.7/trigram 1.6 and member SDK cohort remain fixed. Member image readiness remains `trusted-fixture-only`, not business qualification.

Current consumer validation checked all asset bytes/native targets, nested PostgreSQL layout, nested SDK manifest/config/layers, exact component metadata and formal distribution refusal. Source-only catalog status remains `retained-assets-partial`; both platform release blockers remain effective.

## Native evidence and resource policy

The human authorized native x86_64 verification on Linglong after a minimal same-UID child probe reproduced the ARM Docker/amd64 usermode problem: another process's executable link pointed to the unavailable Rosetta loader. The native probe resolved the actual loaded binaries and distinct file identities. The original ownership gate was retained. The SDK/namespace driver’s `environment` text and Hindsight driver’s `hostPlatform` text were copied from the local ARM fixture and still describe usermode. Raw reports are preserved; adjacent `provenance-correction.json` sidecars bind each raw report hash to the measured native preflight, loaded-executable probe, wrapper and cleanup evidence. These descriptive strings are not used as platform qualification evidence.

All tests were serial. Only SDK import and Hindsight startup used the explicitly approved 1536 MiB memory/memory-swap limit; other containers retained 768 MiB. Each used 1 CPU, 96 PIDs and a 240-second wall limit, with host available memory at least 3 GiB, disk at least 4 GiB and host swap growth at most 1 GiB. Native Docker shares the x86_64 host kernel; no VM was added. No implicit image pull or system package installation occurred.

| Verification | Actual result | Scope |
| --- | --- | --- |
| Transferred prefix | 49,030 exact file hashes; no unpinned AppleDouble entries | Asset transfer only |
| SDK C7 | PASS 29.343 s, sampled peak 394.2 MiB, no OOM | Real import, start/status, inventory export, stop; all owned engine closure fields true |
| Hindsight startup | PASS 48.558 s, sampled peak 1013 MiB, no OOM | Private authenticated ready/status, foreign credential 401, stop; PG PID 51 and service PID 105 absent |
| Hindsight input immutability | 49,030 service and 805 PostgreSQL inventory entries match before/after | Actual byte preservation |
| nft/nsenter helper matrix | PASS AlmaLinux 8.10, Rocky 8.9, CentOS 8 and Ubuntu 22 userlands | Default/numeric plain and JSON rules; own network namespace; Linux host kernel, not each distro's native kernel |
| Public namespace seam | PASS 42.499 s, sampled peak 350.7 MiB, no OOM | Actual policy installation/rule observation, online namespace inventory export, complete owned closure; trusted fixture and no external traffic |

The disposable integration containers require an init reaper: before adding `--init`, the SDK pause helper was a PPID-1 zombie under `su`, and the stopped PostgreSQL daemon still had a PID. These failed setups remain recorded. The final tests did not treat zombies or unknown resources as closed.

Nested rootless namespace tests also needed two explicit outer devices (`/dev/net/tun`, `/dev/fuse`) and Docker's system-path setting for the namespaced network sysctl. These are scoped development-fixture settings, not clean-install evidence. They changed neither host settings nor product ownership checks. Missing-device and read-only-sysctl failures, unresolved native receipts and controlled outer cleanup are retained.

Product model/EDA business calls were zero. The Hindsight startup used a declared keyless LLM fixture and fixed local CPU models; this does not prove memory effectiveness or real model credentials. Development used the coordinator's Sol/high allocation for diagnosis/integration; development call/token attribution was not measured.

## Remaining gates

The catalog release blockers explicitly retain non-admin clean installation/move/upgrade and install UI, full transitive/native source/NOTICE/relink/signature authenticity, approved destination connectivity and actual private-credential/peer isolation, and current-budget Hindsight online C8 export. #105 owns active-member exit composition, #108 owns complete same-cut backup, and #109 owns final installer business acceptance. #101/#104 remain blocked by the open #100 issue.

Evidence is retained under `.scratch/himateam-issue97/linux-current-009d668/linglong-results/` and the private server job `/data/eda/project/hima_harness_reforge_polishing/.scratch/himateam-issue97/native-009d668`. Native result JSON, public receipts, CLI diagnostics, resource traces and exact outer-container cleanup are separate from this summary. The short development baton identifies the sole next step. Generated test-data archives and all failed command logs are retained; unrelated source/user files were not staged.
