# Installed Pack publication and method ownership

2026-09-12. Base: `6b0e1481d8fe279b58e4ee29bc4aa65ff28b4cbf`; branch: `codex/pls13-publication`. Work is isolated in the polishing worktree. Both source projects remain read-only. Production changes are confined to `packages/harness/src/release.ts`.

The independently reviewed PLS-13 × PLS-22 integration failure is reproduced and fixed: an installed Pack can complete a real test Run, release, re-release unchanged method content, export its reference method, and reinstall it. Updating an already declared method file and declaring a new version also works; old Run method bytes and customer assets survive.

## Cause and publication semantics

`releasePack` rewrote `VERSION.yml` but left `.hima-method-install.json` carrying the prior hashes. The installer includes the seal itself in its explicit ownership list, so both export and reinstall subsequently rejected the folder. `TEST.md` and other regenerated pipeline records had the same ownership mismatch. Merely relaxing `readManifest` would allow unknown or tampered files to become installed method content.

The release now holds the same sibling lock as installation, takes one snapshot of the current method, verifies the real test record against the Host Ledger, and validates publication ownership against the preserved original method. The existing five pipeline records may be regenerated; every other existing ownership claim must match the verified historical method. A tested change to method content still requires a different contract version. The resulting seal and installer manifest come from that same current snapshot; the existing method update marker remains until both writes complete.

Export and installation still use the strict existing full manifest check. Publication rejects unknown visible files, hidden ownership violations, unverifiable original ownership, symlinks, a held installation lock and interrupted method updates. A manually extended ownership manifest cannot adopt a customer file: its non-pipeline claims must agree with the preserved original method. Customer `run-assets/` files remain excluded from method identity, publication and export, and are never rewritten here.

Scope is deliberately limited to editing already declared method paths. Adding arbitrary new method files inside an existing installation is still refused; use an explicitly authored source with its reviewed method file set and the existing installation operation. This change does not infer an approval or a file's ownership from a successful test Run. It does not implement an authoring approval UI or claim universal in-place method editing.

## Reproduction and checks

Node `v24.20.0`, pnpm `11.25.0`; frozen lockfile, worktree-local dependencies using the polishing shared package store. Commands used `PATH=/Users/lluzi/.local/node24/bin:$PATH` and `pnpm --config.verifyDepsBeforeRun=false` where applicable. Every test used a corresponding fresh Harness build; the original source at the base commit was rebuilt for the second baseline reproduction, then the fixed source was restored and rebuilt.

| Check | Result | Evidence |
| --- | --- | --- |
| Baseline installed → real test → release → unchanged re-release → export | Expected RED, exit 1: manifest mismatch at export | `red-unchanged.log` |
| Baseline installed → declared version 3 and known script edit → real test → release → export | Expected RED, exit 1: manifest mismatch at export | `red-version-and-ownership.log` |
| Baseline tested method change without a new version | Expected RED: release incorrectly returned `released` | `red-version-and-ownership.log` |
| First unchanged re-release fix | 1 passed, exit 0, 4.014 s | `green-first.log` |
| Final production build and full static type check | Both exit 0 | `build.log`, `typecheck.log` |
| Full method/assets file before legacy fixture migration | 10 passed, 1 failed, exit 1, 24.066 s | `method-regression-before-fixture-migration.log` |
| Full method/assets file after fixture migration | 11 passed, 0 failed/skipped, exit 0, 22.295 s | `method-regression.log` |
| Existing release, hidden-link and snapshot boundary subset | 5 passed, 0 failed/skipped, exit 0, 9.305 s | `pack-boundary-regression.log` |
| Final publication subset, including held lock/update marker and concrete Run/hash diagnostics | 3 passed, 0 failed/skipped, exit 0, 20.309 s | `publication-final.log` |
| Test types after the final test edits | Exit 0 | `test-types-final.log` |

The final 3-case publication subset started 3 real in-process Hosts and 6 local stand-in Jobs. Each test Run's ID, `purpose=test`, actual ending, method digest and `TEST.md` SHA-256 are logged in `publication-final.log`. The tests construct the record only after observing the actual ended Run and checking that its actual Code/Refusal records are empty; the release operation independently validates that record. There is no fabricated PASS row or seal. The earlier full method/assets run started 4 in-process Hosts, 0 subprocess Hosts, 0 Electron instances and 0 SSH subprocesses, as recorded by the controlled runner.

The pre-existing old-method resume test failed because the command now creates an Agent-owned Run, which the legacy resume verb correctly refuses. Its method recovery assertions moved to the actual Host `startRun`/`resumeRun` interfaces with `HIMA_TEST_LEGACY_AUTO_DRIVE=1` scoped to the Node test. The assertions still verify the original graph node, original Run/workspace digest and historical method after upgrade. Production execution ownership was not changed.

Reproduction commands:

```sh
pnpm --config.verifyDepsBeforeRun=false install --frozen-lockfile --store-dir /Users/lluzi/code/hima_harness_reforge_polishing/.hima-tmp/pnpm-store
pnpm --config.verifyDepsBeforeRun=false run build
pnpm --config.verifyDepsBeforeRun=false run typecheck
pnpm --config.verifyDepsBeforeRun=false run test:local --files test/contract/pack-method-assets.test.ts
node --test --test-name-pattern='an installed method can be tested|authorised new version|installed publication refuses' test/contract/pack-method-assets.test.ts
node --test --test-name-pattern='a VERSION.yml that is a link|a hidden entry that is not a plain file|a link under a hidden directory|the one reading of a pack folder|the rungs above compiled' test/contract/pack.test.ts
pnpm --config.verifyDepsBeforeRun=false exec tsc -p test/tsconfig.json
git diff --check
```

The full method/assets file ran before the final added lock/marker assertions and Run diagnostics; the final three-case subset reran every edited case afterward. Other unchanged tests were not repeated without cause. No full suite, Electron, real model, EDA or complete authoring replay was run. These results establish local publication and file-ownership behavior, not model research quality, desktop usability or pilot readiness. Independent root integration review remains required.

## Recovery and rollback

No customer or historical method directory is removed. An interrupted seal/manifest write leaves `.hima-method-update.json` and verified historical method bytes for explicit repair; this change does not automatically repair interrupted publication. A held marker was tested, and existing real permission-failure installation coverage remains passing. An actual process crash between the two publication renames was not injected.

Rollback can revert this release/test change without touching Pack assets or history. Doing so restores the stale-publication-manifest defect, so installed Pack publication should remain disabled until reapplied or repaired; do not work around it by accepting mismatched ownership manifests. Source hashes are in `source-hashes.json`; artifact hashes are in `SHA256SUMS.txt`.
