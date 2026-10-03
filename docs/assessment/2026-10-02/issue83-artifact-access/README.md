# Issue83 — usable retained engineering results after Run end

The actual field Run ended with a verified engineering delivery, but the normal archive surface
listed only experience/observation records. Workshop-scoped owner reads were no longer open. The
original immutable delivery holds 28 declared files; its verified result references a 63-file native
checkpoint outside that list. The selected tree is 163,946,678 bytes, largest member 105,726,436 bytes.
Copying only the old archive or showing paths would not provide the actual checkpoint.

A public Host regression first reproduced the missing delivery in the ordinary readRunAssets view
after real local start/delivery/release/end. The existing assets surface now supplements its unchanged
manifest with existing Ledger-verified delivery receipts. Users open files and original declared task
inputs, inspect referenced checkpoint members, and download either a file or a complete tar directory.
The existing ArchiveSection renders them; no new controller, dashboard or Run state is introduced.

## Authority and bounds

Reads bind Run/execution/request, exact retained native manifest and original task-envelope hashes.
Clients submit opaque IDs. Result-linked references stay under the retained method's engineering
artifact prefix in the original Campaign or its original native workspace; Host-declared input docs
are separately bound to the original envelope and Campaign subtree. Current project access and Site
Permit apply even after Run end. Read projections do not rewrite the old archive, verdict or Goal.

Text previews cap at 1 MiB; binary downloads retain exact verified bytes. Per-file limit 256 MiB and
checkpoint total 1 GiB / 2048 files / depth 32 cover the actual retained design. A fixed-shape, read-only
find inventory is capped at 4 MiB in the shared local/SSH output collector; arbitrary find predicates,
execution and deletion are refused. Sizes/counts are checked before hashing. Every directory segment
from the original Campaign root and each leaf is checked for links/plain type. Tree digests use the
existing sorted path/sha256/size canonical convention. Every exported member is rehashed and staged
only in a fresh local temporary directory, removed after tar creation/failure; Site bytes stay intact.

## Verification

Evidence: `.hima-tmp/issue83-artifact-access/` in the actual worktree.

- Original `red.log`: ended Run assets lacked the verified delivery.
- Independent review found two boundary gaps (unbounded inventory collection/hash-before-size; hidden
  intermediate links). `boundary-red.log` reproduced both; both are corrected. Finding-only review
  closed them with no new code finding.
- Focused public Host tests cover ended-Run listing, text and binary byte fidelity, whole checkpoint
  tar paths/bytes, Unicode digest parity, hash tampering, intermediate/leaf links, sparse oversize,
  unsafe inventory commands, capped output, wrong IDs/executions, cross-project 403 and unchanged
  archive/Run. Initial three-file regression 52/53 exposed a test setup error: the runner's legacy
  test-only global-viewer mode bypassed project auth. The new security fixture now explicitly uses
  production mode; resident subset 22/22 passes (53.693s), other 31 unchanged cases passed in the first
  run. No product permission was relaxed. No Electron or SSH subprocess in the local suite.
- Build and package typechecks pass. Full test-project typecheck retains 16 inherited diagnostics;
  the same file/code multiset is unchanged, with channel line offsets moved by the fix.
- Actual Site qualification used only a byte-identical copy of the terminal Ledger in an isolated
  Home, no copied credential/session and no new Run/model/EDA. It verified the original result,
 16 key ECO/script/report files and selected 63-file checkpoint; a complete tar is retained as
 `retained-checkpoint.tar`. After boundary fixes, `retained-boundary-read.json` reverified all tree
 metadata, the largest 105,726,436-byte member and original matched AutoFix input. Original field
 Ledger SHA remained unchanged. Unchanged full-tar construction evidence was reused.

Developer Astra/High; independent review explicitly requested Sol/High, exact runtime metadata not
independently observable. App/GUI acceptance remains for the same FL on the next frozen candidate.
Actual Timing PASS, original ended-goal-not-met, collateral UNKNOWN and prior journey FAIL remain facts;
these reads do not rerun engineering or convert unknown collateral to zero. Source rollback fa9ffcdc.
