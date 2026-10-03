# Brownfield methods evidence packet

Author: GPT-6 Astra / high. Current product snapshot is 77223fe, documentation head b645e23b. Proposals below are unexecuted. Sources M1-M11 resolve in method-sources.json. This lane establishes mechanisms and author practice, not quantified AI effectiveness.

## Main judgment

Brownfield improvement needs two different baselines: **what current consumers actually rely on**, and **what business/safety requirements say must be true**. AI can extract the first, propose the second, search discrepancies and change code. It cannot declare the two equivalent. Hima already requires current behavior, minimum existing-module increment, falsifying test, independent review and rollback. The increment is a sharper oracle and repeatable evidence of behavior/caller burden, not another governance document.

## M1 — Characterization before risky change, with a separate correctness oracle

- Actor/context: Michael Feathers, author of Working Effectively with Legacy Code, demonstrates ad-hoc formatText handling in 2016 original article. He first supplies a dummy expectation to expose actual behavior; then names and retains the observed example. He also recounts users depending on behavior he had removed as a bug fix.
- Source evidence: article explicitly distinguishes actual behavior from wished-for behavior; no reliable defect or time effect size.
- Input: small existing interface, representative inputs/outputs and one failure record; consumers that might depend on quirks.
- AI action: trace reachable behavior; propose discriminating inputs; capture actual result; normalize only nondeterministic fields known not to carry identity; label behavior as required / tolerated / suspected bug / unknown.
- Output: narrow regression fixture plus disputed-behavior table in the existing issue/spec, not wholesale snapshots.
- Validation: same input against old/new versions; separately assert an independently approved business result. Check at least one input deliberately violating a required identity/permission/outcome rule.
- Hima example: preserve old Pack Explore semantics, but do not promote a current terminal Judge result to desired Campaign truth merely because a golden test returns it. `sum-valid` is not automatically global Goal.
- Risk: approving actual output launders an existing bug into specification; broad snapshots hide meaningful mismatches in noise.
- Stop: expected business truth cannot be identified; output normalization erases execution/generation identity; test only mirrors private control flow. Fix oracle or shrink scope first.
- Existing discipline: current behavior and falsifying tests already required. Increment: explicitly separate preservation oracle from correctness oracle.

## M2 — Deepen an interface only when caller knowledge decreases

- Actor/context: Ousterhout and Martin 2024-25 author dialogue, PrimeGenerator pedagogical example. Ousterhout shows small methods whose mutation is visible only by reading several nested functions; Martin acknowledges re-reading difficulty but disputes the preferred decomposition. Evidence is reasoned code critique, not empirical superiority of a coding style.
- Input: two real call sites, their required concepts/order constraints/error handling, and an observed modification task.
- AI action: map knowledge duplicated in caller; propose two designs including leave-as-is; walk both consumers through each; identify implementation guarantees that must remain hidden and enforced.
- Output: one interface sketch and before/after caller examples; a proposed deletion list of caller-side knowledge/branches, not a class-count goal.
- Validation: fresh reader implements the same use case using public interface without reconstructing internals; old compatibility cases and unsafe outcomes remain checked. Compare business decisions vs mechanical coordination still required.
- Hima example: deterministic Reader/Judge invocation can hide begin/work/complete while internal identity, hold, admission and result binding remain. A wrapper that still requires caller to track those phases fails the design test.
- Risk: giant opaque god function; universal action registry with generic bags; forcing genuinely different jobs into one execution path.
- Stop: no caller concept disappears; new interface adds knobs to express the same internals; second consumer needs exceptions; authority crosses module boundaries.
- Existing discipline: interface depth, genuine consumers and deletion test already present. Increment: test actual use by fresh caller rather than accept an attractive diagram.

## M3/M5 — Incremental replacement through an existing seam, only if replacement is necessary

- Actor/context: Fowler explains moving client sections behind an abstraction, replacing supplier portions while system stays releasable, deleting old supplier and possibly temporary layer. Cartwright/Horn/Lewis describe middleware replacement with event routing and temporary data mimic to preserve dependent reports, explicitly removing transitional components.
- Input: reproduced limitation, at least one replaceable responsibility, backward-compatibility behavior/data and retirement condition.
- AI action: find existing seam; implement a bounded candidate behind it; replay safe inputs/differential compare; enumerate state versions and rollback constraints; keep old path for admitted old work.
- Output: one reversible slice, compatibility matrix and removal criterion recorded in existing work item.
- Validation: old consumers unchanged; both paths compared on side-effect-free records; restart/current-state migration tested before cutover; remove temporary bridge once consumers no longer use it.
- Hima example: if future OpenCode adapter replaces a proven inadequate executor integration, use current action/adapter seam; fixed method versions let old Runs retain meaning. Do not create a second Run owner or re-execute effects to compare two adapters.
- Risk: permanent dual truths; abstraction leak; two real executions launched in shadow mode; rollback after irreversible state migration falsely advertised as simple.
- Stop: cannot observe equivalent outcomes without duplicate effect; no bounded retirement; required behavior actually belongs in existing module and needs no replacement.
- Existing discipline: minimal reversible change, adapters, old method identity already required. Increment: explicit temporary-layer deletion and data/old-Run compatibility; not default recommendation to strangler-rewrite Fabric.

## M6/M7 — Quality-attribute scenarios before architecture escalation

- Actor/context: SEI ATAM gathers business drivers, quality scenarios, architectural responses and tradeoffs; full ATAM typically 3-4 days and trained evaluators. QAW narrows to prioritized/refined scenarios and is originally pre-architecture. A one-page Hima exercise is an adaptation, not formal ATAM.
- Input: one business consequence, precise stimulus, environment, affected artifact, response and observable measure.
- AI action: turn “reliable/complex business ready” into concrete scenarios; trace current response; identify sensitivity points and conflicting qualities; ask whether two candidate designs produce distinguishable behavior.
- Output: three to five prioritized scenarios attached to current spec, with current evidence and unknowns.
- Hima example: after a remote effect starts but before receipt lands, Host restarts; recovery must find original effect or remain unknown, and must not start a second effect. Opposing need: resume useful work promptly. Another scenario: introduce unrelated Reading; result consumer identity must not change.
- Validation: execute corresponding L1/L2 faults later; scenario review alone cannot prove system behavior. Explicitly separate safety (never duplicate), liveness (eventually resolve when facts arrive) and honest uncertainty (unknown when facts missing).
- Risk: invented quality trees and risk scores; business priorities guessed by AI; lightweight adaptation falsely branded full architecture assurance.
- Stop: scenarios do not change a design/test choice; no measurable observation; every response is add a document or a human gate.
- Existing discipline: failure/boundary examples and tests already required. Increment: cover temporal/operational quality and tradeoffs across business scenarios, rather than only present bug examples.

## M8 — Fitness functions as persistent assertions, not scorecards

- Actor/context: Thoughtworks original practice article describes encoding important architecture qualities in delivery checks; shows resilience, observability, security and coverage examples. Thresholds are illustrative, not empirical standards.
- Input: an expensive repeated failure class and stable requirement with observable violation.
- AI action: translate one requirement into cheapest check at existing seam; inject known wrong variant to see check fail; keep slow/live checks conditional.
- Output: a named executable invariant in existing tests or seam checks; clear owner and reason to remove if requirement changes.
- Validation: wrong implementation is rejected, allowed implementation passes; false positives and check-maintenance cost visible. File-exists or coverage tests alone do not prove desired reliability.
- Hima example: old owner epoch cannot start an effect; human hold survives restart; unrelated Reading cannot rebind accepted result; UI projection cannot manufacture completion.
- Risk: every policy becomes an approval gate; metric gaming; mandatory full live test on trivial change; brittle syntactic import prohibition that blocks valid design.
- Stop: property cannot be stated independent of implementation; check repeatedly blocks harmless change without detecting real risk; duplicate of existing meaningful check.
- Existing discipline: L0 seams and L1/L2 assertions already present. Increment: only add missing durable properties from real failure classes, not a new fitness platform.

## M9/M10/M11 — Hotspots and change coupling prioritize investigation, not correctness

- Actor/context: Tornhill original interview describes combining complexity with frequent changes; cochange shows historical dependencies. Vendor author mechanism is supported by his own practice testimony, not independent effect-size evidence. A 2026 industrial paper abstract says maintenance burden requires contextual interpretation and complementary views.
- Input: bounded recent semantic changes, bug/rework history, coupled files, pending business need. Exclude mass formatting, generated files and bulk imports.
- AI action: calculate change frequency/cochange; inspect the actual top commits; ask whether coupling is necessary, accidental or artifact; trace a representative business change through affected modules.
- Output: at most a few ranked investigation candidates, each with a concrete consequence and a reason it might be false.
- Validation: developer pain/rework and actual semantic dependency corroborate ranking; stable ugly code can be deliberately left alone. Treat foundational authority code as potentially critical even if it rarely changes.
- Hima example: large fabric.ts is a candidate for inquiry, not automatic split justification. Recent migration commits could dominate cochange and make an incorrect “architecture cluster.” No historical mining was run this round.
- Risk: score becomes quality truth; AI-generated burst commits amplify noise; high frequency means active feature delivery rather than debt.
- Stop: ranking is explained by bulk churn; candidate has no expected business change/risk; architecture redesign is inferred solely from line count.
- Existing discipline: evidence first and bounded slice already present. Increment: lightweight backlog prioritization if selecting work is genuinely difficult; skip when a specific failed invariant already identifies priority.

## Combinations to synthesize

1. **Default: behavior baseline + deep interface + independent counterexample.** Existing skills can guide diagnosis/design/refactoring, while tests carry durable truth. Best for Hima now; concrete consumer input and measurable caller burden.
2. **For stateful/high-effect seams: scenario + small state model + fault sequence + retained invariant.** Requires independent semantics and real Host L2 seam, not full production rollout. Sibling verification packet supplies details.
3. **Conditional: history-based triage + branch-by-abstraction.** For repeated change burden or proven inadequate adapter only. Not a mandatory phase for each patch, and not an argument for a new framework.

## Explicit rival explanations

- Existing architecture may be fundamentally wrong: keep this possible; require multiple real consumers that cannot fit existing responsibility and compare a minimal new model using the same counterexamples.
- Broad agent workflow may improve task execution: skill evidence can support bounded outcomes, but it cannot substitute for external oracle/stateful fault evidence.
- Existing discipline may already suffice: likely for many slices; require demonstrated marginal value before adding checks or steps.
- More tests can slow maintenance: retain behavior-facing tests that reject meaningful wrongness; do not measure success by count or coverage alone.
