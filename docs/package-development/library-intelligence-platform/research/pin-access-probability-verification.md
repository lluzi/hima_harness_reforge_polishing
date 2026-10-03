# Pin access probability model verification

Date: 2026-09-29. Scope: model design, source-semantic checks and exact finite mathematics. No LEF analyzer, physical model implementation or target-library measurement delivered.

## Source checks and deltas

- Read the Cadence-authored LEF/DEF 5.7 reference hosted by ISPD, especially printed pages 190–191. Verified the PIN/PORT versus OBS exception; the document is a versioned 2009 reference, not a claim to cover every later LEF58 property. Direct PDF download succeeded after web fetch failed.
- Read NVCell 2, ISPD 2023, author-hosted full paper, particularly section 3.2. Its column-wise routability labels use unrouted terminals and congestion; it is not a calibrated LEF-only external-pin probability. No benchmark accuracy from that paper is transferred to this proposal. Direct PDF download succeeded after web fetch failed.
- Reused previously read PAO/TritonRoute/Cell-Flex primary sources for AP semantics, instance context, joint patterns and routing architecture. The blocked-pose formula, event system and probability metrics are explicitly our proposed mathematical model.
- PDF files are ignored research scratch material. No copyrighted source PDFs were added to Git. All probability examples use constructed inputs; none imply measurements of a real library.

## Research judgments

| Judgment | Mechanism and evidence | Rival and boundary | Consequence |
| --- | --- | --- | --- |
| Probabilities can be computed before P&R labels. | A declared measure over deterministic feasible/infeasible scenarios defines an expectation; exact enumerations verify examples. | Without an explicit distribution, geometry alone does not identify a scalar deployment probability. | Deliver protocol-relative probabilities and sensitivity now; validate predictive use later. |
| AP redundancy is geometric dependence, not count alone. | The same legal neighbor poses may block several APs; shared-corridor examples preserve marginal counts but change joint success. | Marginal products are correct in genuinely independent disjoint examples. | Preserve blocked-pose sets, shared resources and joint assignments. |
| Real router failures cannot directly train an existence oracle. | A feasible two-terminal case can fail under one greedy order; a validated witness proves existence but failure may be algorithmic. | A complete solver or verified relaxation can sometimes certify infeasibility. | Keep existence C, certified policy success D, failure certificates and unknown labels distinct. |

## Independent review

One existing research worker, `gpt-5.6-terra`, `medium`, reviewed the mathematical definitions, then the complete model, then only the corrections. Root owns final synthesis. No model upgrade or recursive delegation. Root session model unchanged; token/cost attribution not measured.

Corrections incorporated:

1. Fixed the probability denominator: `q_attempt`, structural legality `L`, and conditional `q_legal`; main access probability uses `q_legal`, while `P_usable` includes placement legality.
2. Separated per-pin AP existence and per-pin escape-to-frontier probability.
3. Required common/published active-terminal, net-merge and demand profiles for library comparisons.
4. Required `certified_under_theta` on PASS, retained rule uncertainty and simplified-profile boundaries.
5. Restricted the event chain to certified algorithm witnesses under the same terminals, candidates, frontier and rule semantics.
6. Required proof-preserving set inclusion for relaxed infeasibility bounds; timeout never means infeasible.
7. Separated finite-distribution unknown mass, Monte Carlo error and uncertainty in the environment/rule model.
8. Verified the new blocked-pose intersection formula and excluded intrinsically invalid candidates from false success.

Final reviewer result: no remaining blocking mathematical or semantic issue. This is a document/model review, not physical-design validation.

## Exact mathematical checks

Executed a Python standard-library rational-arithmetic enumeration, retaining all inputs, state weights and results in [the JSON record](pin-access-probability-math-checks.json). Eight checks passed:

- Scenario weights sum to one.
- Joint success is no greater than the conjunction of single-terminal existence events or any marginal probability.
- Shared corridors: each pin `15/16`, joint `9/16`; naive product `225/256` is wrong.
- Disjoint corridors: joint `225/256`, demonstrating the valid independent special case.
- Availability monotonicity holds for every nested pair of resource states in both examples.
- Greedy order: feasible probability one, certified policy success one half.
- Complete finite pass/fail/unknown partition `0.7/0.2/0.1` gives success bound `[0.7,0.8]`.
- Two equal-weight eight-pose examples: identical blocking masks give `3/4`, disjoint masks give `1`; direct enumeration matches the complement-of-intersection formula.

These checks establish arithmetic and internal event consistency only. No claim is made that actual LEF parsing, geometry predicates, DRC, candidate completeness or runtime have been tested. Mathematical monotonicity is limited to the assumptions stated in each example.

## Local artifact checks and stopping boundary

Local Markdown targets resolve, JSON parses and retains all eight checks, and staged `git diff --check` passed. Relevant source semantics and review corrections are recorded here rather than hidden behind a general confidence score.

The six research-contract questions are answered in the model. Retrieval stopped after source semantics and the probability construction were resolved. Next work needs a bounded implementation slice with real or synthetic physical fixtures; no user approval or actual tool availability is inferred from completing this design document.
