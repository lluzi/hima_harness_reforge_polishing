# PLS-22 checkpoint continuation entry

The opt-in [checkpoint script](../../../../../scripts/live-check-pipeline-checkpoint.ts) resumes the original native author of [the failed pre-Run evidence](../live-authoring-3/evidence.json). This implementation has **not** run a real model. It is ready for a separately budgeted live continuation, not evidence of five-stage completion.

The parent evidence SHA-256 is `ffd5773342edb5d4e42db0bbd4676d950dbd9cd788fd38620aaca01a81343411`; original method digest is `39acedf4d2d214b4aa806e9777684793bebfa9149dc2c06f7a9ecb91d4844563`. Its retained installed bundle, authored files, INTENT/SPEC/FABRIC and numeric input were checked against that evidence. Native `agents.resume` on a private home copy recovered `session-49dc2661-cbdd-49ae-ac65-8df55b0917bf`, the original three injected skills and all 57 tool calls. The real ledger was empty. [Final preflight evidence](preflight/evidence.json) records zero model requests and verifies the original home stayed unchanged.

The actual reader defect reproduces. Script `a5fe424b7347fd19da76e786791bb3704497144c3b2a9059a1461105d1e63e63` reads both `1\n2\n` and `1 2\n` as numeric_sum 12. Single integer and zero are valid; text, negative, empty, missing and unreadable input produced no numeric claim. The preflight PASS means provenance and native resume passed; the malformed-input reader findings remain FAIL and require correction before any Run.

The live entry holds the exact original resumed Agent handle across turns. It supplies the reproduced counterexample to `/hima-fabric`, permits model changes only to the reader script and FABRIC, and reruns the nine sanitized direct checks. It then freezes the corrected method digest in exactly one local test Run: minimum 1, original limit 16, one generation, two retries, eight-minute Run budget. It verifies actual code/reader hashes, original copied input, an independent strict-bound sum, current Judge PASS records, the owner's explicit goal-met Explore decision and cites, all five stage skills, and a native release seal matching the exact Run/method/files.

The unchanged Golden Flow/other-Pack/bundle baseline starts at this continuation. The earlier phase remains linked to its parent guard/tool provenance and input hash; the parent did not record a whole-tree baseline before authoring. Parent costs remain separate, then aggregate with continuation costs. Cleanup scans the retained original home as well as new evidence and temporary files, and stops only the new private tmux server.

## Invocation

Run from the polishing checkout with Node 24 and fresh output directories. Preflight never needs a credential and boots only a disposable copy:

```sh
node scripts/live-check-pipeline-checkpoint.ts \
  --parent docs/assessment/2026-09-12/pls-22/live-authoring-3/evidence.json \
  --out .hima-tmp/checkpoint-preflight-new --preflight-only
```

The separately authorized live execution expects the key through its inherited environment, never a command argument. The helper has a 12-minute overall maximum, 12 user turns and 100 model request steps. It does not reset or widen the product Run budget:

```sh
node scripts/live-check-pipeline-checkpoint.ts \
  --parent docs/assessment/2026-09-12/pls-22/live-authoring-3/evidence.json \
  --out docs/assessment/2026-09-12/pls-22/live-continuation-1 \
  --timeout-ms 720000 --max-turns 12 --max-steps 100
```

The checkpoint is intentionally single-use after correction or a Run: altered parent method bytes, TEST/release files, or any existing Run cause admission failure. A later failure needs a fresh diagnosis from its new evidence.

## Validation and limits

- Fresh workspace build PASS. Full typecheck PASS after fast-forwarding to the parent's `38abeb0` test typing fix. The first typecheck against `5726216` exposed its three already-known `unknown` typing errors; no product change was made for them here.
- Five keyless local admission/provenance/reader/CLI tests PASS in 1.196 seconds; zero Hosts, Electron launches, SSH attempts or model calls. They reject existing-Run evidence, additional failures, missing stages, changed business terms, split author identity and changed installed/authored files.
- Two keyless copied-home native preflight invocations passed during development: two Host boots total, zero model requests. Final evidence is linked above; both left the original home untouched.
- Seam check, Pack boundary check and `git diff --check` PASS.
- No real-model continuation, Run, release, desktop check or EDA operation was performed by this implementation task. The live entry remains subject to the parent's independent review and authorized run.

Rollback is limited to this script, its local test/group entry, the native resume support wrapper and LiveCheck retained-home/resumed-session accounting. No product component or Pack was added or edited.
