# Standard cell pin accessibility research contract

Date: 2026-09-29. Lead synthesizer: root research agent.

Audience: HimaHarness / Library Insight owner and standard-cell/physical-design engineers.
Decision: understand whether and how to add pin accessibility analysis and modeling alongside Liberty analysis. Research only; no implementation or product acceptance claimed.
Scope: public academic and industrial primary sources, historical methods through publicly available 2026 work. Advanced-node standard cells; distinguish predictive PDK studies from production-foundry evidence.
Deliverable: Chinese technical research report in this existing repository research directory, source ledger, retrieval/verification record. Preserve the user's requested problem explanation, advanced-process importance, and industry/academic quantitative evaluation and modeling.

## Living outline

| Question | Required fields | State |
| --- | --- | --- |
| What is pin accessibility? | Access point, legal access segment, joint feasibility, escape and detailed routing; Liberty boundary | Answered |
| Why does scaling make it important? | Cell tracks, via/cut/EOL rules, unidirectionality, neighbor context, modern power/cell architectures | Answered with architecture-dependent limits |
| How is it quantified? | Formula or operation, inputs, scale, blind spots, validation target | Answered; original vs proposed formulas separated |
| What do industry and academic tools actually do? | PAC stress tests, router pin access, layout synthesis, learned predictors, dated cases | Answered with access and benchmark limits |
| What can Library Insight credibly model? | Data requirements, proposed outputs, minimal baseline, qualification and transfer limits | Research recommendation; implementation not started |
| What remains unknown? | Foundry rules, commercial APIs, real library availability, design-level validation | Explicitly bounded; no target-library claim |

## Theses and rivals

| Provisional thesis | Rival | Evidence that changes the judgment |
| --- | --- | --- |
| Liberty alone cannot identify legal physical pin access. | Electrical/logic features may predict typical routing problems adequately. | Demonstrated transferable Liberty-only identification of legal APs for different layouts of the same logical/electrical cell. |
| AP count is useful but insufficient; conflicts and context determine simultaneous access. | A well-calibrated AP threshold may be enough for library screening. | Independent per-pin count reliably predicts joint access across neighbor/orientation and routing contexts. |
| A deterministic geometric baseline plus contextual routing validation should precede learned scoring. | End-to-end learned predictors may be cheaper and generalize sufficiently. | Prospective cross-library/node/router validation with calibrated errors and lower total qualification effort. |

Reader-value test: reader can explain why a DRC-clean cell can be difficult to route; compare geometric, joint/context, routing-test and ML methods; identify required inputs beyond Liberty; choose a bounded next experiment.

## Retrieval protocol

Include primary papers, author-hosted manuscripts, tool-owner docs/source and vendor material. Exclude SEO summaries and anonymous forum claims as technical authority. Abstract-only papers may establish scope, not detailed benchmark claims. Preserve workload/node/tool/baseline with every quantitative result.

Initial queries: standard cell pin accessibility metric modeling advanced nodes; standard cell pin access analysis Synopsys Cadence; RPA pin access value; OpenROAD TritonRoute pin_access; pin accessibility machine learning; advanced-node standard cell layout synthesis pin access.

Stop each lane once mechanism, representative primary case and limits are clear; use delta queries only for consequential gaps. Stop the whole pass before implementation or proprietary-tool qualification.

## Outline changelog

- 2026-09-29: Initial six questions. Discovery identified joint pin feasibility as distinct from per-pin access count; retained as a required field rather than a new product module.
- 2026-09-29: Cell-Flex and active-learning primary slides added PDN/track flexibility and a concrete transfer-failure case. Kept six questions; expanded metric and model-limit fields. Numerical claims now preserve the 200-DRV area threshold and PAC runtime tradeoff.
