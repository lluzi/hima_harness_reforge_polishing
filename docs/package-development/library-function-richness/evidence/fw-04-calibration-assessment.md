# LFR-FW-04 indicator baseline and commercial-QoR comparison

Date: 2026-09-15

Framework source: `aa3b138` plus the uncommitted FW-02/FW-03 fixes assessed here

Commercial EDA jobs started for this assessment: **0**

## Decision

The supplied-relationship calculation **passed**: all supplied identities were verified and the
available F0/F2/F3 indicators were compared with retained F4 design-QoR observations. F1 evidence
was not present and remains a declared gap. “Complete” here means all supplied relationships were
computed; it does not mean every layer exists. This comparison is not an accuracy test and does not
turn the open-source evaluator into a commercial-QoR predictor.

This is the LFR-FW-04 early-falsification result:

- F0/F1: function feasibility and local structural indices remain the primary high-volume search
  evidence;
- F2: whole-design mapping proves that candidate functions can materially change one design, while
  ABC/DC adoption differences remain descriptive rather than an accuracy score;
- F3: proxy timing is a scenario-sensitive indicator and cannot stand alone;
- F4: only the matched commercial flow states the actual QoR outcome;
- next Framework work must optimize a multi-index Pareto frontier, not a predicted delta.

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

## F2 mapping indicators and F4 adoption observation

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

This proves that the evaluation agent sees and uses real candidate functions. Precision, recall and
rank correlation describe how two different optimizers behaved on this design; they are not targets
to maximize. The commercial record also lacks function-class, pin-interface and drive-variant
identities, so the relationship can currently be observed only at exact-master level.

## F3 timing indicators and F4 QoR observation

The round used the same flattened mapped netlists in three explicit NLDM slew/load scenarios:

| Scenario | Reference worst delay | Augmented worst delay | F3 worst-delay indicator reduction |
| --- | ---: | ---: | ---: |
| optimistic | 891.727 ps | 886.011 ps | 5.717 ps |
| nominal | 1605.062 ps | 1473.115 ps | 131.947 ps |
| conservative | 4350.838 ps | 3474.201 ps | 876.637 ps |

All three indicator directions are positive, but their magnitude changes by more than two orders of
magnitude. This sensitivity is itself an index-system result: proxy timing cannot be the sole
grading axis. The nominal indicator was placed beside each retained matched route result:

The table uses `reference - augmented`, so a positive reduction means the augmented proxy has a
smaller indicator. The machine interface stores raw changes as `augmented - reference`; it does not
call either orientation a predicted release.

| Trial | APR / CTS condition | Route WNS delta | Numeric gap to F3 indicator | Same direction |
| --- | --- | ---: | ---: | --- |
| first clean | 0.125 ns uncertainty; legacy unrestricted CTS | +1 ps | 130.947 ps | yes |
| corrected pressure | 0.175 ns uncertainty; DCCK-only CTS | -1 ps | 132.947 ps | no |

The 130.947/132.947 ps gaps and 1/2 direction relationship are retained observations, not a fitted
error band. The two commercial trials changed APR uncertainty, CTS policy, timing expansion and
pin-plan identity, so they cannot define a correction function or a cross-design threshold.

## Root causes and retained gaps

1. ABC and DC use different optimization engines; their adoption relationship is useful evidence,
   but matching their ranking is not the Framework objective.
2. The proxy omits clock-to-Q, setup and extracted physical RC. Conditional foundry arcs use an
   explicit worst-case-over-conditions policy and do not claim sensitization.
3. The frozen predicted custom Liberty omitted `timing_sense`; FW-03 derived it exactly from Boolean
   cofactors. `charlib_emit.py` now reuses that derivation and writes the sense explicitly for future
   Libraries; the frozen evidence remains unchanged.
4. The two commercial trials are not homogeneous, so the error envelope cannot isolate wire,
   fanout, congestion, CTS or path migration.
5. No held-out non-AES design has been evaluated yet.

FW-05 proceeds by building a layered metric vector: Boolean feasibility; local levels/nodes/edges,
cut and reconvergence; whole-design adoption, depth, buffer/inverter and fanout/load; and proxy-STA
frontier/path migration. Candidate portfolios advance by Pareto relation and cost. A later
commercial run records another F4 observation; it does not certify a learned benefit predictor.
