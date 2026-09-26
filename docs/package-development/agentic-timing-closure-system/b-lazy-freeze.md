# B_lazy freeze note

This freezes the identity of **B_lazy** — the existing `xtop-timing-closure` HimaPack, the lazy
agentic migration from the human flow that `agentic-timing-closure-system` is measured against
(SPEC.md, Goal template chapter). It is a source-linked snapshot, not a re-executed measurement:
nothing below was re-run for this task. Source: `EDA_SERVER_TOOLS_AND_EVIDENCE_GUIDE.zh-CN.md` §9
(`/Users/lluzi/Documents/linglong setup/agentic_closure_campaign/`), cross-checked against the local
evidence files it names: `docs/assessment/2026-09-24/commercial-chain-j3/result.json` and
`packs/xtop-timing-closure/VERSION.yml` (both in this repository).

## Method identity

- Pack id: `xtop-timing-closure`
- Version: `1.0.14`
- Method digest: `19207d78dc3b1e9f4fd80f6bd4c21df209f1dfffc5f83fa7afd3ac5c96fd2a92`
- This identity is historical release material; it was not re-verified through a fresh Harness
  release check for this task.

## Run identity

- Run: `run-ddabd488-f05c-44d6-9c9b-45abccaff226`
- Server workspace: `/data/eda/project/hima_harness/xtop-timing-closure-runs/xtop-timing-closure-20260925-054133-cd2f`
- Best database: `flow/output/databases/g001-c47ba5f1f25d2dd17395/closed.enc` and
  `flow/output/databases/g001-c47ba5f1f25d2dd17395/closed.enc.dat` (paths relative to the server
  workspace above). The name `closed` does not mean timing clean.

## Measured ending

All figures below are attributed to their actual arm in `result.json`. The Hima arm
(`run-ddabd488-...`, B_lazy itself) and the control arm (`qualification-v109-20260924-1535`, the
human/manual comparison arm run for the same J3 exercise) are two different `result.json` objects;
do not read one arm's numbers as if they belonged to the other.

**Hima arm (`.himaArm` — this is B_lazy's own frozen Run):**

- Status: `ended-budget-exhausted`, ended by `generation-limit`, `generation = 1`.
- Final metrics only (this object carries no separate "before" baseline of its own): setup WNS
  `-0.04 ns` / `12` violations; hold WNS `-0.15 ns` / `196` violations; `closureScore 217.96`.
- Endpoint delta for this generation: `original 153`, `remaining 147`, `fixed 0`, `entrant 0`,
  `regressed 0`, `missing 6` — six endpoint identities disappeared from the report rather than being
  fixed; they must not be counted as `tc_fixed_check_count`.
- Verdicts: `evidenceValid = PASS`, `setupClean = FAIL`, `holdClean = FAIL`.
- Cost data recorded for this arm: `jobsLaunched = 25`; licence milliseconds Innovus `496649`,
  StarRC `1222907`, PrimeTime `212997`, XTop `216053`. `.himaArm` carries **no physical (DRC/
  connectivity) figures of its own** — see the control arm below for the only physical figures
  `result.json` reports for this comparison.

**Control arm (`.controlArm`, workspace `qualification-v109-20260924-1535` — a human-orchestrated
invocation of the same retained Pack adapter (`charter.md:23`), not the frozen Hima-arm Run; kept here only because the "what this Run lacks" section below needs it
and because it is the source of the physical totals that must not be misattributed to B_lazy):**

- Before: setup WNS `-0.04 ns` / `12` violations; hold WNS `-0.16 ns` / `221` violations;
  `closureScore 243.58`.
- After: setup WNS `-0.04 ns` / `12` violations; hold WNS `-0.15 ns` / `196` violations;
  `closureScore 217.96` (matches the Hima arm's final metrics — both arms reached the same
  qualified engineering adoption, which is what J3's `inconclusive` verdict below is about).
- Physical, before/after (unchanged in both): full-chip DRC `72,799`, connectivity `3,465`; `0`
  normalized-added and `0` normalized-removed violations.

## J3 verdict

- Verdict: **`inconclusive`**.
- Reason (verbatim from `result.json`): "The arms reached the same qualified engineering adoption
  and Hima retained materially richer continuation evidence, but exact human minutes were not
  measured consistently enough to establish labor savings or ROI."
- Claim limits recorded alongside the verdict: timing is not clean; DRC and connectivity are not
  clean; six endpoint identities are missing rather than fixed; no signoff, tapeout-readiness,
  universal PPA, labor-replacement, causal-feedback or notarization claim; the conclusion applies
  only to this SWERV28 checkpoint, Site, model, method and one-generation budget.

## What this old Run lacks for a same-oracle comparison

`agentic-timing-closure-system` must not treat this Run as if it already supplies the data its own
Semantics/Evaluation contract needs. Specifically, the old Run's evidence does not give a same-oracle
comparison on:

1. **Consistent human/engineer time.** J3's own reason for `inconclusive` is that human minutes were
   not measured consistently between arms — there is no comparable labor-time basis to subtract from
   a future Campaign's elapsed time.
2. **Decomposed cost accounting.** The Run reports `jobsLaunched = 25` and per-tool licence
   milliseconds (Innovus, StarRC, PrimeTime, XTop), not the seat-hours / engineer-time / full physical
   refresh count breakdown this Pack's Goal template chapter commits to reporting
   (`tc_refresh_count` and its neighbors); `generation = 1` is a legacy-Harness generation count, not
   a count of full physical refreshes in this Pack's sense.
3. **A resolved fate for the six missing endpoints.** `missing: 6` records that six endpoint
   identities left the report, not that they were fixed, replaced under an explained lineage change,
   or are still open. A same-oracle comparison needs an accounting under
   `tc_missing_prior_check_count` (kept separate from structural-replacement lineage per Semantics),
   which this Run's own artifacts do not resolve.
4. **A directly comparable full-chip DRC/connectivity denominator, and none at all from the Hima
   arm itself.** The DRC 72,799 / connectivity 3,465 figures above belong to the **control arm**, not
   to B_lazy's own Run — `.himaArm` in `result.json` carries no physical figures of its own to compare
   against either baseline. The control arm's figures are also not comparable to the Foundation Flow's
   earlier connectivity report, which is capped at 1,000 problems (a different, truncated denominator).
   Mixing a capped report, an uncapped control-arm report, and a Hima arm that reports no physical
   figures at all into one series is exactly the incomplete/mismatched-evidence case
   `tc_applicable_constraint_unknown_count` must flag — not `tc_final_identity_error_count`, and not
   silently averaged or treated as B_lazy's own physical evidence.
5. **An independent Host Ledger confirmation of Run terminal status.** The Run's own
   `flow/state/runtime.json` is B_lazy's own working state and, per the source guide, "does not
   replace the Host Ledger's authority over the Run's terminal state" — a same-oracle comparison needs
   that independent confirmation pulled separately, not assumed from the Pack's own state file.
6. **Re-verified TEST/release evidence for this comparison cycle.** The method digest and test Run
   above are historical identity; they were not re-executed or re-verified as part of this task, so a
   future same-oracle comparison still needs its own fresh confirmation that B_lazy's frozen artifacts
   still match `packs/xtop-timing-closure/VERSION.yml` before citing them as the baseline.

`packs/xtop-timing-closure/` and `sites/linglong-swerv28/` stay frozen: read and copy identity from
them (as above), never modify them, and never reuse their method digest or hash to claim a new Pack
is already qualified.
