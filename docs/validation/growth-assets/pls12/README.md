# PLS-12 bounded Campaign budget evidence

Baseline: `4e52c32fad6de151029edb715f2af34f512e264f` on `codex/pls12-budget`.

Development used GPT-6 Astra at high effort with no delegated agents. The tested product paths used
no live model or EDA call: L1 arithmetic and L2 real in-process Host, Hima Fabric/Ledger, local files,
local Jobs and public owner actions were used. The pre-approved legacy replay path was attempted
separately and its baseline mismatch is recorded below.

## Implemented contract

- `contract.yml` may declare one Campaign-wide `budget` with an optional closing reserve and finite
  research writer call/byte bounds. Existing Packs receive `0 ms`, `256` calls and `4 MiB` defaults.
- A Run freezes those bounds at start. Active, closing and hard-exhausted phases are derived from the
  original hard deadline; reserve time is never added to the time box.
- Closing refuses new node work, Workshop writes, revisions and growth. Source-linked `analyze`,
  reads and deterministic settlement remain available until the hard deadline. Hard exhaustion does
  not turn an unfinished Explore analysis into a completed decision.
- Every writer call, including rewrites and failures, appends a scoped `research-write` receipt before
  Site effects. Revision content uses stable call identities and is charged once; retained copies and
  rerun materialization are deterministic consequences and are not charged again.
- Explicit user cancellation replaces a pending budget stop reason. Delivery remains a separate
  archive/report fact; this slice does not rewrite the parallel archive implementation.

## Current verification

- [`build.log`](build.log): full workspace build, exit 0.
- [`typecheck.log`](typecheck.log): package and test TypeScript checks, exit 0.
- [`focused-l1-l2.log`](focused-l1-l2.log): 24/24 pass across owner graph, Workshop budget, local Job and revision
  files. Covers exact reserve boundary arithmetic; begin/work/write/revise/grow fences; analysis in
  reserve; same-path cumulative bytes; refusal receipts; restart persistence; revision charging;
  deterministic materialization; local Jobs; generation admission; and cancel priority.
- [`stale-replay-failure.log`](stale-replay-failure.log): one legacy desktop replay case fails before
  Workshop execution because it starts without the live owner now required by the PLS-11 baseline.
  The stale assertion was not repaired in this branch.

## Not tested here

No full local suite, L3 desktop correction, live model, live remote Site/EDA, L4 hard cancellation, or
L5 Campaign was run. Hima enforces the owning conversation's business action admission and commit;
it does not claim that it cancels unrelated general-conversation model generation. Ledger schema
version/import consolidation and archive retention are left to the integration branch.
