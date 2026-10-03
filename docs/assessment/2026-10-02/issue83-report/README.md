# Issue #83: evidence-scoped report and ATCS ending

The human acceptance criterion is repair effect, not elapsed time. The retained
field result has setup/hold counts 0/0 against strong serial AutoFix 24/82;
broader collateral remains UNKNOWN. Its historical `ended-goal-not-met` and
failed original journey remain unchanged. Independent FL subsequently verified
r3 normal GUI access and download of that result, reports and checkpoint.

## Bounded change

Existing Reader, Pack graph, completion receipt and report projection own this
change. ATCS 0.3.2 declares a Timing-only clearance check and explicit owner
Explore ending after its narrow Goal Judge. A separate collateral Judge retains
broader FAIL/UNDETERMINED. The old graph ended at Judge without an explicit
goal-met decision; collateral was not the sole cause of its recorded ending.

The Host records the validated required verdict IDs in existing completion
receipt data. The report can explain sourced known checks beside UNKNOWN and
recognize a supported declared Goal without claiming broader closure/adoption.
Legacy decisions receive no new scope. Invalid hashes, invalidated observations
and malformed explicit scopes cannot establish success. The UI distinguishes
the refreshed evidence view from the original saved report and ending.

No Ledger version, runtime ending policy, new controller or historical asset is
changed. Revert this commit to restore the prior behavior; use frozen r3 for
the already-qualified retained-artifact access path.

## Verification

Evidence is retained under `.hima-tmp/issue83-report/` in the source worktree.

- Red: Reader lacked the Timing-only value; report rejected supported partial
  evidence and contained unrelated demo prose.
- Reader tests: 11/11 PASS.
- Report and public Host receipt/projection tests: 20/20 PASS; zero SSH or
  Electron attempts.
- Current Pack load: PASS.
- Public Host tail tests: 4/4 PASS, covering the existing production-adapter
  best effort, clear Timing with UNKNOWN collateral, residual Timing refusing
  goal-met, and known collateral regression remaining visible with narrow success.
- Build: PASS. `git diff --check`: PASS.
- Whole test-project typecheck: FAIL, with the same 16 file/error-code entries
  as `.hima-tmp/issue82-baseline-typecheck.log`; no new diagnostic pair. Nine
  TS1294 diagnostics and seven trial-package declaration/implicit-any diagnostics
  remain. This is not a whole-repository typecheck pass.
- One fresh independent Sol/high review: zero actionable findings. Requested
  child configuration is recorded; applied settings were not independently
  observable. Review note: `.hima-tmp/issue83-report/review.md`.

DL remains user-selected GPT-6 Astra/high. No new product-model, commercial EDA
or Timing experiment ran for this slice. Requests/tokens/cost are unmeasured.
Tests establish mechanisms, not a new 0.3.2 field journey. Actual native adherence
to the revised delivery contract and autonomous owner consumption still need a
bounded retained-artifact interaction, without manual schema rescue or new
Timing work. A refreshed GUI report also needs independent operator acceptance.
