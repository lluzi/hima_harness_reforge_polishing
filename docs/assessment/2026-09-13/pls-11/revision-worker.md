# PLS-11 revision and validity worker evidence

Baseline: `fad81847a8886dd98aa371847eb09c4bff9b4e60` on `codex/pls11-revision`.

This bounded worker used the existing Host/Fabric/Ledger/workspace seams. It added no driver,
snapshot service or graph engine. Product tests used no model, Electron, SSH, EDA or remote Site.

## Verified behavior

- `revise` accepts one strict, byte-identified request from the live Run owner at a safe boundary.
- A Workshop revision leaves the completed executable untouched, keeps immutable before/after
  versions, and seeds the accepted bytes into the next execution's private directory.
- Only explicit owner `work` launches the revised local tmux Job. A second Host reconstructs the
  applied revision and waits at the affected downstream node without launching business work.
- A strategy-only revision is held against the Pack declaration, recorded as a new version and
  moves the Run back to its declared changed node without launching work.
- Completed affected executions remain visible with `supersededBy`; current projections exclude
  their invalidated observation while full history and revision ids remain visible.
- A dependency counterexample gives `A -> B -> C` while independent `D` remains reused. Changing A
  expands the closure to all downstream nodes.
- Same report path/name, misleading timestamps, cross-branch records and same-path changed bytes do
  not establish reuse; content and record identities decide.

## Checks run

- Build, typecheck, seam check and architecture-boundary check: pass, exit 0.
- Focused L1/L2: 4/4 pass, 0 fail, 5.463 s; two in-process Host boots, zero SSH/Electron.
- Adjacent PLS-10 growth and owner Workshop: 12/12 pass, 0 fail, 28.110 s.
- Larger adjacent graph/recovery/growth/Workshop run: 28/30 passed. The two failures are pre-existing
  archive-integration expectations in `agent-recovery.host.test.ts`: archive pending+complete records
  make repaired report sequence growth `+3`, while the old assertion requires `+1`. This worker did
  not edit archive-owned assertions; the integrating PLS-14 task owns that consolidation.

Not run here: full local suite, L3, real model, EDA/Site, or L5 pilot.

## Integration requirement

The new `revision` Ledger union arm and `NodeExecution.supersededBy` require the combined schema gate
to move from 24 to 25. This worker intentionally did not change the offline importer or global
version assertions. Integration must review the combined PLS-11/14/15 shape, set version 25, and
update the importer as one transition rather than landing competing bumps.
