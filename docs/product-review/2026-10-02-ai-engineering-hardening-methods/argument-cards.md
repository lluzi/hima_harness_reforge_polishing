# Argument cards — lead synthesis

Status: synthesis cards after primary evidence packets; no Hima execution claims. Claims are judgments, not Hima measured outcomes.

## A1. Two baselines are necessary
- Judgment: Brownfield characterization and intended business correctness must remain distinct; AI can accelerate discovery but cannot approve a current output into truth.
- Mechanism: Current code/tests share historical assumptions; preserving these catches regression but misses semantic defects.
- Case: Feathers formatText demonstrates deliberate actual-output discovery; Hima terminal Judge/local validity vs Campaign Goal demonstrates why preservation is insufficient.
- Rival: Existing tests already encode correct domain intent, so a separate oracle adds ceremony.
- Boundary: For well-specified low-risk helpers, existing independent assertions may already be sufficient; do not duplicate them.
- Decision effect: Use existing tests plus explicit disputed semantics; adopt characterization only for uncertain behavior and retain separate authorized change examples.

## A2. The value of architectural improvement is reduced required knowledge
- Judgment: Better interfaces reduce what a human or model must coordinate, while implementation retains identity, control and recovery facts.
- Mechanism: Spread information forces caller to recreate a protocol and multiplies mistakes during modifications.
- Case: Ousterhout/Martin PrimeGenerator dispute shows side effects hidden across tiny methods; Hima begin/work/complete reveals caller coordination burden.
- Rival: Decomposition improves understandability and broad interfaces hide too much.
- Boundary: Distinct business choices and permissions must stay explicit; two consumers must use the abstraction without generic-bag escape hatches.
- Decision effect: Require before/after consumer code and fresh-interface use; reject universal registries or splitting by file size.

## A3. Verification independence is an information property
- Judgment: Fresh reviewers help, but assurance comes from independent expected results and observations of actual effects, not reviewer count.
- Mechanism: Correlated assumptions can infect spec, implementation and generated tests; externally derived invariants break the loop.
- Case: V05/V17-20 PBT fixes and dateutil calendrical false positive; V13 AWS long counterexample and untested liveness; Hima same-result binding and original-effect recovery.
- Rival: Multi-agent critique already finds enough defects with lower setup cost.
- Boundary: Simple local changes can use ordinary independent review; explicit state models are only justified for consequential temporal behavior.
- Decision effect: Allocate reviewer to counterexample/oracle construction and genuine Host seam, not repeated opinion review.

## A4. Skills are executable work protocols, not proof of quality
- Judgment: Select narrow skills by inputs, outputs, side effects and fit to existing authority; do not adopt a whole workflow based on popularity or a generic success score.
- Mechanism: Skills can supply procedural/domain knowledge, but extra instructions can distract or impose mismatched lifecycle and tool assumptions.
- Case: R1 fixed-version SkillsBench v4 positive and negative task effects; R2/R3 AGENTS studies measuring distinct outcomes; source-level local skill inspection.
- Rival: A comprehensive package can reduce missed steps better than a hand-composed selection.
- Boundary: Whole-workflow adoption can be warranted when ownership is clear and measured equivalent tasks improve; current evidence must identify comparable task and cost.
- Decision effect: Existing local skills first, adapt execution assumptions explicitly; external suites remain optional source material until local pilot.

## A5. Hima needs demonstrated marginal mechanisms, not repeated principles
- Judgment: Current discipline covers most proposed governance; new work should make key requirements observable and interfaces easier, not grow mandatory prose.
- Mechanism: Repeating intent does not force correct result identity or crash recovery; small executable checks preserve a guarantee at each change.
- Case: Existing L0-L5, check:seams/check:boundary, actual Host test seams and recovery fixtures.
- Rival: Discipline exists on paper but is inconsistently followed, so stronger enforcement could be missing.
- Boundary: A missing policy may matter if repeated incidents prove it; enforcement must be measured by catching meaningful violations rather than document existence.
- Decision effect: Start one bounded seam; add only check or workflow step that rejects a real wrong candidate and does not duplicate existing coverage.

## A6. Incremental migration is conditional, not a new modernization programme
- Judgment: When replacement is necessary, use existing seams and retire temporary compatibility; do not default from engineering risk to framework migration.
- Mechanism: Smaller cutovers limit exposed state and allow comparison; permanent adapters and duplicate truth can recreate the original complexity.
- Case: Fowler supplier-by-supplier migration and Cartwright/Horn/Lewis transitional middleware case.
- Rival: Fundamentally wrong model cannot be rescued by incremental edits.
- Boundary: Several real consumers failing under a minimum new contract can justify architecture decision; do not preserve obsolete model at any cost.
- Decision effect: Demand replacement evidence, state compatibility and retirement condition before branch-by-abstraction; do not shadow-run real side effects.
