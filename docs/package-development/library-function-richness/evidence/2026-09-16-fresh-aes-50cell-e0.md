# Fresh AES 50-Cell Framework-to-E0 observation

Date: 2026-09-16  
Framework fix commit: `b206d84f0f18bcd392a7aa2ffd9315a0d52e1dd5`  
Machine-readable summary: [`fresh-aes-50cell-e0.summary.json`](fresh-aes-50cell-e0.summary.json)

## Decision

The standalone Library Function Richness Framework completed one fresh `aes_cipher_top` path from
F0 through E0 and **did not improve Fmax**. The matched final-database result changed from
1795.332 MHz to 1745.201 MHz, or **-2.792%**. This Library is a negative method result and is not a
release candidate.

The run did not use DeepSeek, HimaHarness execution or the old 47-Cell candidate Library. It started
again from the AES RTL, foundry Liberty and fixed constraints, rebuilt the mapped graph, ran all six
mining views, selected one 50-Cell Library, generated all 50 Cells, evaluated that Library once with
Yosys/ABC, and spent one matched commercial E0 observation.

## Free-factor result

| Fact | Observation |
| --- | ---: |
| Fresh de-duplicated function candidates | 66 |
| Selected/generated/layout-admitted Cells | 50 / 50 / 50 |
| Yosys/ABC adopted Cells | 22 / 50 |
| Yosys/ABC adopted instances | 1,671 |
| Mapped instances | 13,450 -> 11,383 (-2,067; -15.37%) |
| F1 levels removed | +7 |
| Nominal worst-delay indicator | -90.948 ps |
| Conservative worst-delay indicator | -2,604.954 ps |
| Optimistic worst-delay indicator | **+33.898 ps regression** |
| Free factor classification | F1 positive; F2 positive; F3 mixed |
| E0 admission | true; current frontier member |

Positive changes use the metric's declared direction. The free layer did not predict Fmax. Its gate
said only that the complete Library deserved one expensive observation.

## Matched E0 result

| Fact | Foundry | 50-Cell Library |
| --- | ---: | ---: |
| DC reg2reg WNS | -100 ps | -90 ps |
| DC-adopted new Cells / instances | 0 / 0 | 10 / 279 |
| Final-database new Cell instances | 0 | 175 |
| Final setup WNS | -57 ps | -73 ps |
| Derived Fmax | 1795.332 MHz | 1745.201 MHz |
| Post-route cell area | 23,766.0 um2 | 22,640.1 um2 |
| Post-route power | 28.571 mW | 28.428 mW |
| Route DRC / connectivity findings | 2 / 2 | 2 / 2 |

The two arms used the same RTL, 0.5 ns clock, 0.25 ns DC uncertainty, 0.175 ns route uncertainty,
25% utilization core, core box, 388-pin plan, DCCK-only CTS policy, tool versions and normalized
scripts. Verification restored both final databases, found 175 new Cell instances in the generated
arm, and reported zero verification errors. The physical Cell Liberty remains learned-model
characterization, as declared by the Pack.

## What this falsified

The result falsifies the useful but insufficient assumption that strong global structure
compression plus positive nominal/conservative proxy timing is enough for commercial Fmax benefit.
This observation is:

`F1 positive + F2 positive + F3 mixed -> E0 negative for Fmax`

The optimistic worst-delay regression is the clearest free warning in this sample, but one result
does not prove that this factor alone caused the E0 loss. The next method work should add factors
that distinguish global mapping compression from retained route-critical benefit and then test
their association against this observation. It must not fit a portable gain predictor or rerun the
same Library unchanged.

## Framework defects exposed and fixed

The fresh design found several scale and boundary defects before E0:

- a reconvergent timing cut with no active maximum predecessor path crashed the counterfactual;
- F1 local replacement and F3 timing facts incorrectly vetoed exact buildable functions before the
  one whole-Library mapper screen;
- real 50-Cell candidate evidence and runner-owned output exceeded limits intended for compact model
  context;
- residual Boolean de-duplication lost contributing-method provenance required by adoption;
- matched P&R script normalization recognized `generated.lib/lef` but not frozen
  `cumulative-custom.lib/lef` arm inputs.

The fixes deepen the existing miner, portfolio, residual runner, adoption and P&R seams. They add no
Runtime component or second evidence system.

## Evidence and verification

Raw RTL, foundry data, generated assets, commercial reports and final databases remain outside Git.
The summary JSON retains SHA-256 and byte counts for every key local or Site record. Private retained
locations are:

- local: `.hima-tmp/lfr-aes-fresh-50-20260915/`;
- Site: `/data/eda/project/hima_harness/polishing-runs/lfr-aes-fresh-50-20260915-framework-e0`.

Verification after the fixes:

- Framework/domain Python: 63/63 passed;
- selected Pack/LFR contracts: 41/41 passed;
- Python compilation, flow/tools copy equality and `git diff --check`: passed;
- Desktop: not run; no Desktop path changed;
- DeepSeek/product-model calls: 0;
- commercial search loops: 0; one admitted matched E0 observation was executed.
