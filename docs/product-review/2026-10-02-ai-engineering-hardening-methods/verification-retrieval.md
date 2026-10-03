# Verification lane retrieval log

Date: 2026-10-03 UTC. Owner: astra_verification_methods. Contract: research-contract.json Q2/Q4/Q5/Q6. No candidate/Hima/EDA/model tests executed.

## Questions / provisional theses

1. What independently checks behavior when implementation and tests are AI-written? Thesis: oracle provenance matters more than role count. Rival: multi-role self-review sufficiently reduces shared errors. Falsifier: relevant controlled brownfield evidence showing adequate independent gains without external checks.
2. What catches identity, crash, and scheduling failures? Thesis: narrow genuine Host fault experiments plus invariants first. Rival: all-purpose E2E or replacement durable engine eliminates need. Falsifier: actual guarantees cover external effect boundary and upgrade semantics.
3. When do PBT, mutation, formal models repay cost? Thesis: risk-triggered use beats every-tool/every-PR policy. Rival: tools are cheap enough to apply globally. Falsifier: comparable full-cost evidence with maintained oracle quality.
4. Which external evidence transfers to Hima, and which does not? Maintain distinction between mechanism docs, author industrial experience, empirical finding, maintainer confirmation, and Hima verification (none).

## Inclusion / exclusion

Include original papers, official tool docs, author operational accounts, direct maintainer issue/PR records. Exclude SEO lists, star counts, unsupported reliability percentages. Human N-version work is historical analogy, not a modern LLM experiment. Current local product/test docs outrank old memory.

## Retrieval rounds

R1 discovery queries (web search):
- site.fast-check.dev model based testing commands scheduler race conditions
- site.stryker-mutator.io docs mutation testing equivalent mutants
- site.aws.amazon.com formal methods TLA+ use formal methods 2015 systems
- site.research.google mutation developers
- site.microsoft.com research unit test LLM Assured
- Use of Formal Methods at Amazon Web Services 2015 bugs
- site.martinfowler.com characterization tests legacy approval testing

Followed primary direct docs for fast-check model/scheduler; Stryker equivalent mutants; AWS Builders Library idempotent APIs; author-hosted AWS TLA PDF; Google mutation paper page; ApprovalTests and Feature Parity author's financial-service example. Search results about forums were discovery-only and excluded as technical evidence.

R2 parent-supplied delta (directly relevant empirical study): Anthropic PBT Jan14 2026 -> original arXiv 2510.09907v1 -> GitHub direct PR and issue. Also Anthropic Jan9 2026 agent evaluations. Checked 100 packages/933 modules/984 reports, sample conditioned on top80%, n50, top21, and phase1/phase2 separation. Blog alone omitted sample-frame nuance. Direct GitHub API confirms two merged patches; original dateutil maintainer comment confirms wrong property interpretation. Do not extrapolate author API-cost per candidate to cost per confirmed fix or net engineering savings.

R3 mechanism/counterexample delta:
- metamorphic testing oracle problem Chen 1998 original paper
- site.cs.virginia.edu Knight Leveson experimental evaluation assumption independence multiversion programming 1986
- site.cs.cornell.edu LLMs Cannot Self-Correct reasoning external feedback
- direct FoundationDB simulation, Temporal TypeScript testing/replay and Worker Versioning.
The 1998 MT original PDF is reachable but text extraction is badly encoded; not used as detailed sole support. Original MT empirical article search excerpt was discovery only; direct PMC open returned a challenge page, so excluded from core claims. No numeric generalization. ICLR self-correction search was considered but omitted: older reasoning-only evidence would overreach a 2026 coding review claim.

R4 Hima runner adaptation delta: parent verified custom Node runners, no assumed Jest/Vitest. Opened fast-check Quick Start, Stryker configuration including commandRunner/buildCommand/coverageAnalysis. Guessed command-runner doc URL inaccessible; actual configuration page supplies required mechanism. No adoption compatibility claimed.

## Local grounding

Read research-contract.json, model-policy, testing-strategy, product-definition, polishing-discipline, current Fabric business graph report (especially §§3/6/7). Memory quick search returned older separate Hima Phase4 repository; no memory used as present product authority. Lead should preserve current product SHA/source scope.

## Persistence / checks

Stage evidence saved under verification-raw before synthesis: 12 HTTP GET resources and retrieval-status.json with URLs/content type/HTTP/SHA256. All 12 returned 200. This is retrieval metadata checking, not software testing. Agent manually inspected high-consequence primary passages via web and parsed direct GitHub API records. No skill/candidate execution or dependency installation. Final three deliverables checked for existence/JSON parse/URL duplicates after writing; see delivery message for actual result.

## Stop reason and remaining gaps

Core rival claims now bounded: tests can encode wrong semantics (dateutil); mutation is scalable by narrowing (Google); formal models miss unspecified liveness (AWS); scheduler cannot control all I/O (fast-check); historical replay has compatibility bounds (Temporal). Enough for a risk-driven minimum. No direct controlled evidence found within these bounded queries for modern Astra multi-agent independent review effectiveness on Hima-like durable EDA systems; this is a limited search outcome, not proof of absence. Hima ROI and tool compatibility remain explicitly unverified; resolving them requires a later authorized trial, not more generic source collection.
