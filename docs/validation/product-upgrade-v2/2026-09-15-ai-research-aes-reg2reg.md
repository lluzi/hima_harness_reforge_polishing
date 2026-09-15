# AES reg2reg AI research method and gated physical pilot

Date: 2026-09-15. Status: Pack method implemented; clean HimaHarness L5 Campaign positive and independently audited; packaging/Catsights/user signoff remain.

## Scope and authority

This pilot uses the portable `custom-cell-fmax-dtco` Pack with Site-bound
`aes_cipher_top`. It does not make AES a Pack invariant. The target RTL SHA-256 is
`ab39a4a094dc8cfde90fcaa4c1aaf7dc9bf75b57ed762e11a985b88f6b23996c`.
The validated probe has 32 explicit `reg2reg` paths and high-precision WNS
`-0.104597 ns` at a `0.5 ns` requested period with 50% DC uncertainty.

This record describes a direct Pack-stage pilot on the real Site. It is not the clean-home,
single-owner HimaHarness L5 required to close PLS-35. Site inputs, logs, databases and customer-like
artifacts remain on the Site and are not committed.

## Method upgrade

- Six existing miners remain mechanical evidence methods. Timing routes now accept only
  instances mapped through the retained DC `reg2reg` full-path report; hierarchical instance paths
  are resolved through the synthesized module hierarchy rather than guessed from repeated leaf names.
- One existing Workshop component, `research-candidates`, replaces six narrow model selectors. Equivalent
  Boolean/interface candidates are represented once with every source method and local ranking attached.
  The Campaign Agent authors one unified `research(candidates, context)` ranking after reading the
  current probe, compact route views, exact source identities, Pack knowledge and prior feedback.
- `research-template.py` is 1,047 bytes. Fixed I/O, provenance, bounded hypotheses and exact route
  projections live in `ai_research_runner.py`, so a second-tier model only writes the research
  function. One Campaign generation therefore spends one model moment for discovery.
- `MAX_ROUTE_CANDIDATES` is bounded to `1..40` per method; `MAX_CELLS` is bounded to `1..50`. The measured
  six-method raw pool had 186 rows but only 53 unique Boolean candidates. The revised Workshop sees the
  53 unique candidates, orders up to 50 into one generated library, and uses one pressured DC pair as the
  scarce adoption screen. PNR remains one pair behind the existing adoption Judge. The Site job cap for
  this L5 profile is five; it does not multiply the business validation flow.
- The foundry arm now saves Innovus's native floorplan. The generated arm loads that file and the
  same IO plan. This avoids recomputing a core box that Innovus can snap to a different origin.

No HimaFabric, Ledger, Run, Job, Judge or Desktop product component was added or given Pack-specific
logic.

## Direct Site evidence

The pilot algorithm SHA-256 was
`89244ba83dea7203d438554bebe3d3f47662ba75cbafbcf510e364082c34edd7`.
It evaluated three lenses over 48 current candidates: actual critical-path membership, repeated-logic
amortization and mapper-interface fit. It selected one timing-context candidate and one
structure-compaction candidate. Research report SHA-256:
`d2fc2fe992dc54c0d616dd633719f035be447664c8b077d0d33772cd59c55fb5`.

The timing candidate was not adopted. The structure-compaction candidate was adopted 140 times by
pressured DC and remained 94 times in the generated final route database. This distinction is
material: the result supports one discovered Boolean opportunity, not every hypothesis the algorithm
considered.

The matched final-database comparison re-read both analysis views after restoring each route database:

| Fact | Foundry arm | Generated arm |
| --- | ---: | ---: |
| Requested period | 0.5 ns | 0.5 ns |
| Final setup WNS | -0.020 ns | -0.010 ns |
| STA-derived Fmax | 1923.076923 MHz | 1960.784314 MHz |
| Generated Cell instances | 0 | 94 |

The derived Fmax delta is `+37.707391 MHz`, or about `+1.96%`. The A/B method, tool, RTL,
constraints, core box `{2.1, 2.0, 187.6, 187.4}`, 388-pin identity and route settings match; the
generated library content is the declared arm-specific difference. Compare record SHA-256:
`67776b39976408644b699340c746470c58d274d7b03d069eca2f8a979f3e9363`.

## Disclosed physical findings

This pilot is not a physical-signoff-clean claim. Both arms retain setup and hold violations, route
DRC findings and two unrouted power nets because the current pilot does not build a PG network. The
reported `full_constraint_failures` is 67. Innovus `-check_only cell` also reports 106,998 findings
on the foundry-only arm and 101,862 on the generated arm. Because the baseline foundry library itself
triggers that abstract-cell check, the combined 208,860 count is retained as
`cell_checker_diagnostic_count`; it is not represented as a generated-Cell validity error.

`comparison_valid=1` means only that final-database identities match, the generated library is live,
the generated Cell is present, and final timing/census verification completed. It does not mean
physical signoff is clean. `fmax_improved` remains a separate rule.

## Failures retained during bring-up

1. A multi-line pin placeholder also appeared inside a Tcl comment. Global substitution appended
   prose to `setPlaceMode`, and Innovus rejected `baseline` as an option. The placeholder is no longer
   present in comments; the synthetic fixture asserts the rendered command is clean.
2. Reconstructing the generated core from foundry width/height let Innovus resnap the X origin from
   `2.1` to `1.96`. Native `saveFPlan/loadFPlan` reuse produced exact equality before generated PNR.
3. The initial path-to-module mapper associated repeated `Uxxx` leaf names with unrelated AES S-box
   modules. Hierarchical traversal now resolves the actual child module before a timing candidate is
   admitted.

## Verification

- One full local checkpoint completed: build, typecheck, seam/boundary checks and 501/501 local
  contract subtests passed. It launched no Electron window and made no SSH attempt.
- After the final comparison-semantics change, the affected custom Pack file passed 19/19; typecheck,
  Python compile, seam and boundary checks passed.
- Real Site readers independently reproduced `comparison_valid=1`, 94 routed instances and the exact
  Fmax values above. The new acceptance profile expands each route pool to 40 while keeping the
  initial generated Cell budget at two for one controlled L5 screen.

## First clean-Harness attempt

Commit `927ec6b` started a fresh Home and one Campaign Run
`run-6b7ee3b8-ad60-4a94-8bd8-604e9d924f48`. DeepSeek-V4.1-Flash completed both bounded probes and
all six 40-candidate evidence branches, read the declared Workshop inputs and authored three
research program revisions. The Run did not reach merge. The first program resolved `flow/` from
the isolated `.executions/<execution>/entry.py` location rather than from the supplied workspace;
the next two programs wrote a valid research report, but the Pack reader looked for a stable
`research/ai-discovery/entry.py` that the Workshop intentionally does not create. A final attempt to
write outside the execution directory was refused by the Workshop boundary. The live check cancelled
the blocked Run during cleanup and retained 242 records. No generation, DC adoption screen or PNR
was launched in that attempt.

The fix makes the template use the `WORKSPACE` argument and records the exact execution-relative
entry path in the research report. The reader now checks that path is inside
`research/ai-discovery/.executions`, is a plain `entry.py`, and has the reported SHA-256. A focused
isolated-execution regression passes. The failed Run remains negative integration evidence.

Commit `c9de4a3` then ran a second clean Home. The isolated entry/read contract passed, all six
40-candidate pools completed, and DeepSeek authored a four-hypothesis program over 186 candidates.
However, the fixed runner handed `research()` the complete raw request shape while the model wrote
against the compact `evidence`, `interface`, `equivalence_digest` and `implementation_route` shape it
had just read. Its ranking fields became unknown, it selected only
`CAND_FUNCTIONAL_DIVERSITY_MAPPED_SINGLE_0001`, and pressured DC adopted zero instances. The existing
adoption Judge stopped the Run before PNR; the live check then preserved and cancelled the blocked
Run. This is a valid negative result and does not supersede the direct positive pilot.

The next runner revision supplies those stable compact aliases alongside the complete source request.
It folds equivalent proposals before the model sees them, retains `source_methods` and
`method_rankings`, and requires the program to fill `min(MAX_CELLS, unique candidates)`. The independent
reader re-derives the pool and bound from all six raw sources. This converts an internal-schema memory
burden into Pack scaffolding and prevents both duplicate generation and a confident one-candidate
report from passing when cheap generation capacity remains.

A third clean run on `3563e74` was stopped after the product owner rejected the two-Cell budget as a
remaining silver-bullet assumption. It had completed the bounded probes and entered mining, but had
not opened the research Workshop or generated a Cell. The local Host was interrupted, no Site Job
remained, and the retained Run was not used as evidence. The accepted next budget is up to 50 generated
Cells, ordered by one AI-authored ranking, combined in one library and followed by one pressured DC
adoption screen. Source methods collaborate; they do not receive separate DC/APR evaluation chains.
Adoption evidence maps each used candidate back to all of its source methods, with shared credits
explicitly non-additive.

The first 50-Cell preflight then exposed that confirmed product Campaigns still inherited the
Harness 60-minute default while the L5 expected 120 minutes. The check failed before `bind-inputs`
launched. The existing Pack budget schema now accepts an optional `timeBoxMs`; `startRun` uses that
reviewed Pack value when the caller supplies no test-only override. This Pack declares 120 minutes,
while every Pack that omits the field retains the 60-minute Harness default. No new budget component
or user choice was introduced.

The first unified-pool L5 on commit `f6a744a` exposed one older probe-control error before mining.
At 0.5 ns the real `aes_cipher_top` probe measured 32 reg2reg paths and WNS `-0.104597 ns`, which is
the intended optimization pressure. The old `reg2reg-wns-nonnegative` rule marked that evidence FAIL,
and `over-constraining-push` relaxed the next period to 0.595 ns in pursuit of closure. The Run was
cancelled before mining, AI research, Cell generation or downstream DC/APR. The Pack now judges
`reg2reg_wns <= -0.1 ns` and uses a pressure-maintaining chooser that tightens only when the measured
violation is too light. A 0.5 ns / -0.104597 ns probe therefore ends the inner loop immediately and
preserves 0.5 ns for both matched synthesis arms.

The next clean Run on `fc1aa19` proved the new rule itself: the same 0.5 ns observation made both the
pressure and clock Goal verdicts PASS. DeepSeek nevertheless bypassed the Pack recommendation and
invented a 0.505 ns second probe because it treated convergence as a required sample count. The Run
was cancelled before mining. The L5 owner instruction now requires the Pack recommendation at every
Explore node and explicitly states that convergence is a fallback ending, not a quota. The final
audit also requires exactly one 0.5 ns probe, both PASS verdicts and a `goalMet` next-period decision.

The following clean Run on `04a13f0` passed that audit condition and reached the new unified research
path. DeepSeek wrote one 15,230-byte Workshop program; 170 raw method proposals folded into 47 unique
candidates, and all 47 entered one generation set. Bool-to-CMOS generation completed for all 47. The
21st abstract-layout attempt then exceeded its 180-second per-Cell limit. The old layout stage turned
that one candidate refusal into a whole-stage failure and began redoing the first 20 successful Cells.
The Run was cancelled before characterization or any matched DC/APR. Layout now records every Cell
attempt, excludes failed candidates from the characterized common library, and continues with the
successful subset; only zero admitted Cells blocks the Campaign. Readers re-derive the admitted set,
and adoption attribution uses that characterized subset rather than claiming a failed Cell was offered.

## Clean unified-pool L5 result

Commit `115d33c` started a fresh Hima Home, installed the exact Pack, discovered the real Site and
created one Campaign/Run owned by DeepSeek-V4.1-Flash. One 0.5 ns probe measured 32 explicit reg2reg
paths and WNS `-0.104597 ns`; both the pressure and clock Goal rules passed, and the Pack recommendation
ended the inner loop without a closure-seeking second probe.

Six method views emitted 170 raw source-linked proposals. The fixed runner folded them into 47 unique
Boolean/interface candidates before the model saw them. DeepSeek authored one 12,980-byte Workshop
program with six research lenses and ranked all 47 into one generated library. Bool-to-CMOS, abstract
layout, predicted characterization and Library Compiler admitted all 47; `layout_refused_count=0`.
One foundry/custom DC pair then produced 21 adopted candidate Cells and 307 instances. The non-additive
source-method attribution was:

| Method | Offered candidates | Adopted candidates | Adopted instances |
| --- | ---: | ---: | ---: |
| structure_compaction | 40 | 21 | 307 |
| structure_frequency | 40 | 21 | 307 |
| functional_diversity | 40 | 20 | 306 |
| mapper_compatibility | 40 | 20 | 304 |
| timing_context | 5 | 0 | 0 |
| timing_criticality | 5 | 0 | 0 |

The methods share candidates, so rows cannot be summed. One foundry/generated APR pair preserved 250
custom Cell instances in the generated final database. The independent final comparison reported
foundry Fmax `1923.076923 MHz`, generated Fmax `1926.782274 MHz`, and delta `+3.705351 MHz`
(approximately `+0.193%`). `matched_conditions=1`, `comparison_valid=1`,
`verification_error_count=0`, and all final Judge rules passed. The Campaign ended `ended-goal-met`
and archived 304 records plus the model-authored code and source material.

This result remains a limited trial result, not physical signoff. It retains 45 full-constraint
findings and 197,149 cell-checker diagnostics. The first live wrapper marked its restart check failed
because it hashed ordinary `JSON.stringify` output: the 304 record objects were deeply equal but their
object-key order changed after persistence. Canonical record SHA on both sides is
`a9285be1cb27db6ae07d2c2a5a137f7de3ee3a70ca8358792e2a08fa3d429a85`. The corrected offline audit
accepted only this one precisely identified false negative and passed with zero model requests and
zero new Site Jobs. Evidence remains local under
`.hima-tmp/product-upgrade-v2-l5/unified-50cell-l5-115d33c/` and
`.hima-tmp/product-upgrade-v2-l5/offline-audit-115d33c/`; Site artifacts remain on Site.

## Trial candidate and Catsights review

Commit `8521037` produced a local unsigned arm64 candidate at
`.hima-tmp/product-upgrade-v2-l5/trial-8521037/HimaHarness.app`. The packager verified the complete
file manifest, signature, bundled Node 24, native runtime selection, bundled portable Pack and its
knowledge assets. A relocated clean-Home Host smoke opened the Hima API and reported the bundled Pack
ready for preparation while correctly refusing Campaign readiness without a Site. The local
`trial-manifest.json` SHA-256 is
`069acb31fd555e995f84e946b762f6b08241248da2275b5d64aff20d0a70ab5e`.

The candidate was then launched and moved to the Catsights display
(`1920x1200`, display 3) before visual inspection. The conversation and Campaign entry were visible
in one window; Campaign opened beside the conversation; Pack & assets exposed the folder-install
boundary; and the model selector showed `DeepSeek-V4.1-Flash`. This last check exposed and fixed a
legacy-home migration defect: packaged startup previously preserved an old profile wholesale and
therefore displayed `DeepSeek-V4-Flash` despite the new template. Startup now refreshes only the
explicitly marked Hima-managed model catalog, retains all other profile text, and leaves machine
overrides in the later home patch. The four focused profile tests passed. The Catsights screenshot is
local at `.hima-tmp/product-upgrade-v2-l5/catsights-trial-8521037.png`, SHA-256
`ce6acda4a953aee95aad18406abc71e5adf8c5e23a252cbd71f342b29dce5397`.

PLS-35 now awaits the product owner's final signoff and an explicit later release decision. No
GitHub Release is claimed here.
