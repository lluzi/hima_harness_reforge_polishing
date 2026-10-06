# Main reference point — 2026-10-06

The user asked for `main` to become the new reference starting point with the latest HimaHarness
features. This record states what `main` contains, how it was checked, and what is known to be
missing. It is source integration and cleanup, not a release, GUI acceptance or EDA qualification.

## Contents

- Previous main: `9c3a39c1` (2026-10-03 integration).
- `feat/data-insight-libinsight` at `f6660f22`, merged as `bf6543b8`. It contains
  `codex/dbos-fabric-atcs-migration` (`448b00a6`, ADR-0018: DBOS owns durable execution, U6–U10) and
  the LibInsight / Data Insight work (ADR-0019, ADR-0020, ADR-0021: Guide-led library analyses on
  their own page), plus the two LibInsight agent worktree branches.
- `refactor/post-dbos-architecture` at `e4ff114a`, fast-forwarded onto main:
  - Retires the pre-DBOS execution engine: autopilot, forks/loops, owner begin/work/complete, the
    restart recovery sweep, job-cap, the Ledger delegation and interactive runtimes, the
    server-rendered `/hima/` page and `legacyAutomaticAllowed`. Old Runs stay readable; new Runs have
    one engine. Source −12.9k lines, tests −24k lines (old-engine tests).
  - Fixes the DBOS Pack Reader `${REPORT}` path (the real report, as pack-anatomy documents, not a
    staged copy), versioned as `hima-task-effect/2`.
  - Keeps contract test runs out of the person's real `~/.hima/database-lineages`
    (`HIMA_TEST_LINEAGE_DIR`); the runner no longer starts the retired driver.
  - Adds DBOS-route tests for the AES Pack (probe, research, full graph), the fork-join Judge rule,
    ATCS known-collateral and the Reader report path.
- Not included, by user decision: `customer-demo` (34 commits; demo Packs, i18n, QuaLib Insight tab).
  No other branch had work newer than this reference point.

## Verification

- Build, full typecheck, `check:boundary`, `check:seams` and the contract inventory pass.
- Local group on `1fc59b5a` (before the review fixes): 687/766 pass, 75 fail, 4 skipped, 22 min.
  The same 19 failing files were re-run on the pre-refactor commit `af90e37d`: exactly one failure
  was new (`durable-views.host`, a dynamic import of the deleted page), fixed in `53e80619`
  (13/13). The other 74 fail identically before and after: tests still using the removed
  `/hima observe` and `/hima job launch` commands (`dc-reader`, `judge`, `observe*`, `site-name`,
  `standin-stages`), API routes that now need a session (`view`, `view-run`), `startRun` 'ran'
  expectations (`library-insight`, `report-only-seal`, `terminal.host`), `trial-package`, `pack`,
  `pack-method-assets`, `experience-files`, `durable-fabric.host`, `agentic-timing-closure-system`.
- After the review fixes: durable-views.host 13/13, custom-cell-fmax-pack 26/26, skills 9/9,
  pack-reader-report.host 2/2, aes-probe-durable.host 3/3, native-task-effects.host 1/1,
  dbos-flow.host 27/27, dbos-runtime.host 4/4; atcs-dry group: atcs-resident-durable.host 2/2,
  atcs-known-collateral-durable.host 1/1, libinsight-resident-durable.host 3/3.
- Desktop (Catsights) files changed by the refactor: budget, desktop, drill-down, fork-join, loop,
  strategy, window — 16/17, the one failure a stale tool-view list that also failed on main, fixed
  in `e4ff114a` and re-run 1/1. Other desktop files were not run.
- An independent review found no production regression for DBOS Runs; its findings were fixed.
- Not run: live-site, live-model, packaged App, commercial EDA, product model calls.

## Known gaps carried forward

- About 55 live behaviours lost their only test with the old engine (Pack Reader value gate and
  units, owner pause/handoff notices, resident delivery preflight, experience candidates,
  interactive Operator rules, native child input bounds, Workshop checks, converged endings).
  Per-item list: [coverage-review.md](coverage-review.md); to be filed as issues.
- DBOS product gaps that predate the refactor: a Run reaching its time box stays `waiting` without a
  report; `retryAllowance` never retries a Job; LibInsight E1 has no DBOS writer for its host
  attestation; research-analysis recording, Run-wide child caps and negative-history injection have
  no DBOS equivalent; a human hold may not mark saved work memory stale.
- One half-written lineage folder in `~/.hima/database-lineages` still holds every Home on the
  machine (separate task). About 2,040 test lineage records remain in that folder from runs before
  the isolation fix.
- The 74 pre-existing failing cases above.
