# Pin access probability model research contract

Date: 2026-09-29. Lead: root. Follow-up to the literature report, on the user's explicit request for first-principles, LEF-geometry-based quantitative probabilities before physical-design validation becomes available.

Deliverable: proposed mathematical model and metric system, with exact synthetic counterexamples and a later calibration plan. No production implementation, target-library probability or physical-tool validation claimed. Existing research directory retained.

## Questions

1. What event does each probability describe, and what provides the randomness?
2. How do LEF geometry and declared technology rules yield legal access and escape alternatives?
3. How are neighbor context, shared-resource competition and placement/routing policy represented without unjustified independence?
4. Which pin/cell/context probabilities, uncertainty bounds and diagnostic quantities should be reported?
5. What can be checked mathematically now, and what must later be calibrated against actual placement/routing?
6. How does this model remain useful with incomplete rules and no observed environment distribution?

## Theses and falsifiers

| Thesis | Rival | Falsifying evidence |
| --- | --- | --- |
| A probability can be calculated now by marginalizing a deterministic geometry/rule feasibility model over a declared environment distribution. | Without empirical labels any probability is meaningless. | Incoherent event/sample space, non-reproducible weights, or materially different events sharing one score. |
| Joint feasible access must be modeled separately from individual accessibility. | Multiplying per-pin probabilities suffices. | Exhaustive conflict examples in which the product always matches joint feasibility; conversely one counterexample rejects the rival. |
| Geometry/context/algorithm uncertainty must be separated. | A single fitted score is adequate. | Data showing the decomposed model adds no diagnostic or calibration value; future rather than currently assumed. |

## Targeted retrieval and evidence

- Delta queries: `pin access probability stochastic standard cell LEF routability modeling`; `LEF DEF reference pin access OBS PORT MUSTJOIN via enclosure`; primary leads include NVCell 2 and Cadence-authored LEF/DEF reference hosted by ISPD.
- Prior primary sources reused: PAO instance signatures, pin-access patterns; Cell-Flex; OpenROAD physical-rule controls. The new probability system is a proposal derived here, not attributed as a published or validated method.
- Distinguish internal transistor-routing prediction (NVCell 2) from external standard-cell pin access; do not transfer its accuracy or labels.
- Stop after physical semantics, probability definitions, counterexamples and a reviewable calibration design are resolved. No new broad literature survey.

## Reader-value and validation

Reader should be able to explain the probability denominator, diagnose why many APs can still fail, distinguish model probability from observed tool success, and identify exactly what future data updates.
Validate event inclusion, probability normalization, dependence counterexamples, unknown-result bounds and intervention assumptions with small exact models. Review these as mathematical/semantic claims; do not run unrelated software or EDA tests.
