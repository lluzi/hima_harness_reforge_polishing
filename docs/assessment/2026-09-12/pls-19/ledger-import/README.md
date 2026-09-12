# PLS-19 offline Ledger import — bounded delivery

Baseline: `f9808cf5b9f17d52534f3e2296931f2a31c62156` on `codex/pls19-ledger-upgrade`. This slice implements explicit v19-to-v20 history import. It does not complete PLS-19 or certify safe adoption of an old in-flight Run.

The existing JSON backend stores one document at `storages/hima_ledger.json`: `{ unit: { name, version }, global: null, tables: { runs, records } }`. Its single-unit loader refuses a different version. `@deepseek-ai/dsh-storage-json@0.1.5-alpha.1` was inspected locally; its built `lib/index.js` SHA-256 is `293b76e38e9dd64017dae9503218b5120058ce0087b06dffa058512dcb6ee771`. No compatibility setting, live-domain rewrite or alternate storage backend was added.

The operator stops the old Host and takes a complete offline snapshot first. The source file and its home remain unchanged. Existing old homes continue to fail the version gate. With the current build, run:

```sh
node packages/desktop/lib/hima-home.js \
  --import-ledger /absolute/path/offline-v19.json \
  --home /absolute/path/new-empty-home
```

Both flags are required in that order. `DSH_HOME` is never a default destination for this command. The destination must be absent or an empty directory, its parent must already exist, and source/destination components cannot be symlinks. Keep the snapshot and destination directories under operator control throughout the offline operation; concurrent directory replacement is not an authorized operating mode. The helper checks ancestors, opens the source with `O_NOFOLLOW`, verifies its identity/size/timestamps before and after reading and again before publication, and rechecks the destination boundary before publishing.

Validation accepts exactly version 19, the known unit/table names, the v19 Run and record shapes, canonical Run/record keys, Site/Run/Campaign links, evidence citations and safe sequence numbers. Existing reserved sequence gaps remain unchanged. V20 ownership, optional missing Job PID, workspace method digest, conversational decision attribution and unsupported nested fields are refused. Schema parsing must leave the complete parsed document equal to its input; it cannot silently strip facts. The only altered value in the imported Ledger is `unit.version`.

Output is built in an owned sibling staging directory, synced, then the complete home is published with one directory rename. It contains:

- `storages/hima_ledger.json`: the v20 document with the same Runs and records.
- `ledger-import/source-v19.json`: the exact original bytes.
- `ledger-import/receipt.json`: original and imported SHA-256 hashes, source path/byte count, versions, Run/record counts and the explicit `unchanged-unowned` status.

The imported hash describes the initial import, before any future Host writes. Caught write failures remove only this import's staging directory. Process death can leave an unpublished `.hima-ledger-import-*` directory; it never makes that directory the target home. Preserve the source and receipt for auditing. Rollback consists of continuing to retain the original v19 snapshot/home; if an unused imported home is discarded, remove only the explicitly selected new home. Never point an older build at a v20 Ledger.

Import exits without preparing profiles or starting a Host, Agent, Job or model. It does not copy Sites, Packs, workspaces, permits or Agent session logs. Preserved record paths still identify the original files. It never invents an owner. Production reconciliation and explicit safety checks for adopting old Runs belong to the main PLS-19 runtime change; import alone cannot establish that an old Host has stopped or that an in-flight Job is safe to adopt.

## Validation

Node 24 with the frozen lockfile, isolated worktree dependencies, shared download store at the polishing root's `.hima-tmp/pnpm-store`. The source projects and user homes were untouched. Original `ledger-version.test.ts` remains in the desktop group; this slice did not rerun Electron.

[Build output](build.log), [typecheck output](typecheck.log), [static checks](static-checks.log) and [L2 TAP output](ledger-import.tap.log) retain the final commands' results. The L2 fixture comes from two actual Runs and two real report observations persisted by the current Host, stopped before the snapshot's stamp is set to 19. These are the unchanged v19 Run/observation shapes from `ad84d2f`, using the same prior-version fixture method as the existing version-gate test. It is a generated compatibility fixture, not a user's historical export or a full legacy Campaign.

Final result: build/typecheck/seams/boundary/inventory passed; **9 L2 tests passed, 0 failed/skipped, 9.222 s**, with three in-process Host attempts (including the intended v19 refusal), zero Electron and zero SSH attempts. The final test-only change was also typechecked with `tsc -p test/tsconfig.json` (exit 0).

An intermediate [strict signal assertion failed](signal-assumption-failed.tap.log): the OS file-size limit returned caught `EFBIG`, not the initially assumed process-ending signal. The product code needed no fix. The final test separately observes and kills its own child with `SIGKILL` during staging, then exercises real `EFBIG` cleanup while checking that the earlier interrupted staging remains untouched. Both paths pass; the failed assertion is retained as evidence of the corrected test assumption.

The selected L2 file tests explicit CLI import and real Host readback of every Run/record identity and value; the unchanged old-home refusal; malformed/unsupported formats and v20 fields; broken record linkage/sequence; symlink files/ancestors and occupied homes; actual OS file-size write failure/process interruption; absent required CLI flags; and concurrent import publication. It also asserts that the offline CLI starts no Host and does not prepare a profile.

Commands, after a fresh build:

```sh
pnpm --config.verifyDepsBeforeRun=false run typecheck
pnpm --config.verifyDepsBeforeRun=false run check:seams
pnpm --config.verifyDepsBeforeRun=false run check:boundary
node scripts/run-contract-tests.mjs --check
pnpm --config.verifyDepsBeforeRun=false run test:local --files test/contract/ledger-import.test.ts
```

This is L0/L2 compatibility and real filesystem evidence. No full suite, Electron, SSH, model or EDA acceptance was run; the runtime's in-flight legacy safety fence and owner adoption remain separate integration obligations.
