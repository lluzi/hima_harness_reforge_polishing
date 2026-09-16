# LFR-FW-04 calibration assessment

Date: 2026-09-15

Framework source: `aa3b138` plus the uncommitted FW-02/FW-03 fixes assessed here

Commercial EDA jobs started for this assessment: **0**

## Decision

The calibration calculation **passed**: all supplied identities were verified and the mapping and
physical comparisons were computed. The current proxy **does not pass the commercial-exit role**.
It may continue as a license-free structural screen, provided every conclusion remains scoped to
the fixed AES corpus and the exit gate carries the observed error band.

This is the LFR-FW-04 early-falsification result:

- mapping proxy: **conditionally admitted for screening**, not admitted as a DC adoption or ranking
  predictor;
- physical correction: **not admitted as a magnitude predictor**;
- current 47-Cell Library: **not exit-ready**;
- next Framework work may optimize the proxy objective, but it cannot send this Library to another
  commercial trial on the strength of the current proxy result.

## Identity-bound inputs and outputs

| Evidence | SHA-256 |
| --- | --- |
| Frozen corpus identity | `a5e0c2df3e725b25fb24fbc4f4d4812bad3cdfa3563ba8f4a18d1c8e6cd74ca2` |
| Flattened paired mapping result used by calibration | `8061e4634db785a081d537ddcede608b1a047a7390d5f8401560d5817a7efb67` |
| Unified round evaluation | `7f81acb52533db53c0d4f43b3d53c44cc946c85c8463a26ea3ba7032b6fb3266` |
| Full calibration report | `659913f575aaec7cc251ca232b3a83dc2cd695811ab95e8588d9eb7dca0fc325` |

The mapping, round and calibration payloads remain under the ignored local directory
`.hima-tmp/lfr-calibration/aes-47cell-v1/`. The repository contains this compact assessment and the
portable evaluator, not RTL, foundry Liberty, generated Liberty, commercial reports or mapped
netlists.

## Mapping role

Flattening removed three RTL submodules that the first smoke had incorrectly counted as Cells. In
the corrected mapping, ABC used 26 of the 47 custom masters; DC used 21; 14 were common:

| Metric | Result |
| --- | ---: |
| Exact-master precision | 0.5385 |
| Exact-master recall | 0.6667 |
| Spearman instance-count rank correlation | 0.1760 |
| Top-5 overlap | 2 / 5 |
| Top-10 overlap | 4 common; proxy tie-expanded set 11, DC set 10 |
| Positive-count top-20 overlap | 12 common; both tie-expanded sets 21 |

This is enough to prove that the proxy sees and uses real candidate functions. It is not strong
enough to treat ABC instance count or order as a DC prediction. The commercial record also lacks
function-class, pin-interface and drive-variant identities, so this calibration is exact-master
only.

## Timing and physical correction role

The round used the same flattened mapped netlists in three explicit NLDM slew/load scenarios:

| Scenario | Reference worst delay | Augmented worst delay | Predicted release |
| --- | ---: | ---: | ---: |
| optimistic | 891.727 ps | 886.011 ps | 5.717 ps |
| nominal | 1605.062 ps | 1473.115 ps | 131.947 ps |
| conservative | 4350.838 ps | 3474.201 ps | 876.637 ps |

All three directions are positive, but the magnitude changes by more than two orders of magnitude.
The nominal prediction was compared with each retained matched route result:

| Trial | APR / CTS condition | Route WNS delta | Absolute proxy error | Direction agrees |
| --- | --- | ---: | ---: | --- |
| first clean | 0.125 ns uncertainty; legacy unrestricted CTS | +1 ps | 130.947 ps | yes |
| corrected pressure | 0.175 ns uncertainty; DCCK-only CTS | -1 ps | 132.947 ps | no |

The observed conservative error band is therefore **132.947 ps**. It contains proxy error and the
spread from changed APR uncertainty, CTS policy, timing expansion and pin-plan identity; it is not
a universal correction. Sign agreement is 1/2.

For the current 25 ps target, a commercial-exit candidate would need all supported scenarios to
show more than `25 + 132.947 = 157.947 ps` release, together with the other adoption, path-family
and convergence gates. The current optimistic and nominal scenarios fail that requirement.

## Root causes and retained gaps

1. ABC and DC use different optimization engines; exact adoption overlap exists but ranking
   correlation is weak.
2. The proxy omits clock-to-Q, setup and extracted physical RC. Conditional foundry arcs use an
   explicit worst-case-over-conditions policy and do not claim sensitization.
3. The frozen predicted custom Liberty omitted `timing_sense`; FW-03 derived it exactly from Boolean
   cofactors. `charlib_emit.py` now reuses that derivation and writes the sense explicitly for future
   Libraries; the frozen evidence remains unchanged.
4. The two commercial trials are not homogeneous, so the error envelope cannot isolate wire,
   fanout, congestion, CTS or path migration.
5. No held-out non-AES design has been evaluated yet.

FW-05 may proceed only as development of a better influence/portfolio objective under this large
error band. A later proxy or calibration change must rerun FW-04 before any commercial exit.
