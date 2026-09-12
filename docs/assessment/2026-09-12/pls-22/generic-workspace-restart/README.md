# Generic Pack workspace cold restart

PLS-21/22 defect correction on base `7581fe6fbf0463ab37c2241da3aab8ef4cf11e37`.
The worktree and every test home are private to this correction. No retained L4 home, original
Ledger, model session, prototype checkout, Electron window, or EDA job was changed or used.

## Reproduction and cause

The first regression used the actual in-process dsh Host, a temporary numeric Pack declaring only
`flowRoot` and `workspaceRoot`, and a local Site with those two bindings. Preparation and cancellation
completed. A second Host opening that Ledger failed in 6.935 seconds:

```text
domain 'hima_ledger': stored record 'run-6f432d74-9289-438e-a40b-d8b49dadf108#000001'
in table 'records' does not match its schema
path: ["design"]
Invalid input: expected string, received undefined
```

Command: `PATH=/Users/lluzi/.local/node24/bin:$PATH pnpm --config.verifyDepsBeforeRun=false run test:local --files test/contract/generic-workspace.host.test.ts`.
The initial minimal case passed after the production fix in 3.358 seconds (2 Host boots, no skips).
The committed test expands this to actual numeric code, a local Job, a reader, a judge and cold restart.

`boundInputs` deliberately returns only inputs declared by the Pack. The workspace producer used
`bindings.design!`: its TypeScript assertion cannot supply a runtime value. JSON therefore already
omitted design, while both the Ledger reader and `workspace.json` reader required a string. The
same mistaken requirement appeared in the remote Run workspace type. The problem was a producer/
consumer contract mismatch, not a missing Site binding or lost Run history.

## Repair and compatibility

The existing workspace and Ledger readers now accept absent design; producers and the remote
projection omit the key when absent. A declared design remains the real bound string. Admission
still rejects a missing declared input before opening a Run. The workspace identity comparisons
and adoption comparisons already distinguish absent versus present values, and remain strict.
No business input is invented or taken from an undeclared Site binding.

Ledger stays at **20** and workspace metadata stays at **format 1**. This is a reader correction
for absent fields already written by the current unreleased v20 branch, not a new persisted field,
control state, or migration. `origin/main` was independently verified at
`4d8bc8c9b1e1f1205eb7725ac14ee89386cdd3f2`, whose Ledger is v19. That version still fails the domain
version gate against v20; earlier v20 readers fail closed on the absent design, as the reproduction
shows. A separate version bump would make the already-written v20 history unreadable by the fixed
reader without adding a migration, which is unnecessary here. The v19 offline importer explicitly
retains its original required-string design schema, so widening the current reader cannot silently
widen the accepted historical source format. No history is rewritten.

Recovery/adoption continue to compare recorded metadata against the declared bindings and reject
an added or changed design. The existing display/report consumers already have an absent-value
fallback; their text and UI are unchanged. This correction does not claim desktop visual validation.

## Verification

Fresh build, complete typecheck (including test types), seam check, Pack boundary check and
`git diff --check` passed under Node v24.20.0. Dependencies were installed offline into this worktree;
no global configuration changed.

The focused L2 command was:

```sh
PATH=/Users/lluzi/.local/node24/bin:$PATH pnpm --config.verifyDepsBeforeRun=false run test:local --files \
  test/contract/generic-workspace.host.test.ts \
  test/contract/ledger-import.test.ts \
  test/contract/agent-recovery.host.test.ts
```

**24 passed, 0 failed, 0 skipped; 46.126 seconds; 30 in-process Host boots; 0 Electron boots and
0 SSH attempts.** The [full focused output](focused-tests.log) preserves individual test names and timing.

The five new cases establish:

- A generic Run executes local numeric code and its reader (42 count), ends, and cold-opens with
  the entire stored Ledger byte-for-byte unchanged. Its fixture has no Goal rule, so its actual
  ending is `ended-goal-not-met`; this is mechanism evidence, not research/Goal-success evidence.
- An unrelated Site design is not bound; repeated workspace preparation reuses absent-design
  metadata unchanged and rejects an injected design.
- A Pack declaring design refuses the missing binding before any Run exists.
- A declared design survives metadata and Ledger cold reload unchanged.
- A historical fixture at a real collected Job boundary cold-opens without advancing; adoption
  rejects changed metadata and accepts restored absent-design metadata without rewriting records.
  A purported v19 source missing design is refused and its bytes remain unchanged.

The existing focused recovery/import tests additionally cover the v19 version gate, valid source
preservation, ownership fencing, historical metadata checks and owed report repair. Full local,
desktop, real model and EDA suites were not run. The retained L4 Run is not reopened by this patch's
tests; its validated installed-bundle update and finalization remain a separate integration action.

Rollback is the inverse of the three production-file changes; a reverted reader again refuses
generic absent-design history. Keep the current bundle when those histories need to be read.
