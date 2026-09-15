# AES reg2reg AI research method and gated physical pilot

Date: 2026-09-15. Status: Pack method implemented; direct Site pilot positive; clean HimaHarness L5 not yet run.

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

- Six existing miners remain parallel mechanical evidence generators. Timing routes now accept only
  instances mapped through the retained DC `reg2reg` full-path report; hierarchical instance paths
  are resolved through the synthesized module hierarchy rather than guessed from repeated leaf names.
- One existing Workshop component, `research-candidates`, replaces six narrow model selectors. The
  Campaign Agent authors one cross-route `research(candidates, context)` algorithm after reading the
  current probe, compact route views, exact source identities, Pack knowledge and prior feedback.
- `research-template.py` is 1,047 bytes. Fixed I/O, provenance, bounded hypotheses and exact route
  projections live in `ai_research_runner.py`, so a second-tier model only writes the research
  function. One Campaign generation therefore spends one model moment for discovery.
- `MAX_ROUTE_CANDIDATES` is bounded to `1..40`; `MAX_CELLS` is bounded to `1..50`. Candidate and Cell
  production can be broad, while one pressured DC pair is the scarce adoption screen. PNR remains
  behind the existing adoption Judge.
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
It also requires the program to fill `min(MAX_CELLS, distinct Boolean functions)` and, for a
multi-Cell screen, to use at least two competing hypotheses. The independent reader re-derives both
conditions from all six raw pools. This converts an internal-schema memory burden into Pack
scaffolding and prevents a confident one-candidate report from passing when the declared cheap build
budget is two.

A third clean run on `3563e74` was stopped after the product owner rejected the two-Cell budget as a
remaining silver-bullet assumption. It had completed the bounded probes and entered mining, but had
not opened the research Workshop or generated a Cell. The local Host was interrupted, no Site Job
remained, and the retained Run was not used as evidence. The accepted next budget is 50 generated
Cells, ordered by the AI-authored ranking, followed by one pressured DC adoption screen.

PLS-35 remains open until a fresh clean Home uses DeepSeek-V4.1-Flash to author and execute the
Workshop code through HimaHarness, reaches the same evidence gates, passes offline audit, is packaged,
and completes Catsights review. No release is claimed here.
