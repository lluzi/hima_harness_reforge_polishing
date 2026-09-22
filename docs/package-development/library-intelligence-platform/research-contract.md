# Library Intelligence Platform research contract

Date: 2026-09-22

## Research brief

| Field | Answer |
| --- | --- |
| Audience | Standard-cell Library, characterization, STA, synthesis, physical-design, DTCO, and product engineers. The reader can be assumed to understand Liberty, PVT corners, timing arcs, NLDM/CCS/LVF, and implementation reports. |
| Decision | Define the first HimaPack and product slice that uses Empyrean Liberty API as its parser/read-write boundary and can become a defensible Library insight and analysis platform, rather than a file browser or another collection of QA scripts. |
| Scope | Standard-cell Liberty analysis and cross-view/cross-corner intelligence on the `linglong` Site. Current public competitor capabilities and the repository's existing Pack, knowledge, execution, evidence, and UI seams are in scope. Characterization engine replacement, foundry sign-off certification, and automatic modification of golden libraries are excluded from the first slice. |
| Original value words | “基于这个 Lib API”“Library 数据的洞察与分析平台”“远远超过同类的竞品”. |
| Deliverable | A source-linked decision report, structured evidence ledger, product capability model, and an executable first-slice specification. Implementation begins only when the Liberty API can parse and query its vendor fixture in the supported runtime. |
| Reader-value test | A fresh senior Library engineer can explain what established products already do, which unmet decisions Hima should own, why the proposed architecture belongs in existing HimaHarness modules, what the first user-visible result is, and what evidence would stop or redirect the investment. |

## Living answer outline

1. What do current Library characterization, QA, validation, comparison, and analytics products demonstrably provide?
   - Workflow and primary users
   - Data models and supported views
   - Automation, debug, visualization, and integration surfaces
   - Claims that are vendor marketing versus measurable behavior
2. What data and reliable operations does the deployed Empyrean Liberty API actually expose?
   - Parser/read-write boundary
   - Cell, pin, timing, power, CCS/LVF, evaluator, and corner abstractions
   - Runtime prerequisites and current qualification state
3. What Library corpus is available on `linglong`, and what safe metadata can be derived without copying proprietary content into Git?
   - Library families, formats, model types, corners, sizes, and duplication
   - Foundry/custom/generated boundaries
4. Which high-value engineering decisions remain poorly served by existing products?
   - Cross-corner anomaly explanation
   - Cross-view semantic consistency and provenance
   - Design-conditioned importance and escaped-risk prioritization
   - What-if analysis, regression attribution, and evidence handoff
5. How should HimaHarness own this capability without creating a second data authority or control plane?
   - HimaPack method and tools
   - Site-local adapter and cache
   - Ledger/evidence/knowledge authority
   - Workbench projections and Campaign Agent interaction
6. What is the smallest end-to-end slice that proves differentiated human value?
   - User scenario, inputs, outputs, errors, and preservation rules
   - Positive and falsifying examples
   - Local contract tests, Site qualification, and product acceptance

## Outline changelog

- 2026-09-22: Initial six-question structure created before public-source retrieval. Runtime qualification is an explicit answer slot because the vendor fixture currently imports but does not complete a parse in the deployed Python 3.7 environment.

## Provisional theses, rivals, and decision-changing evidence

| Thesis | Rival explanation | Evidence that would weaken or defeat it |
| --- | --- | --- |
| The durable differentiation is not another Liberty parser or dashboard; it is an evidence-bound decision layer that connects Library anomalies to design impact, provenance, and safe action. | Existing characterization/QA suites may already provide design-context ranking, causal attribution, and closed-loop action at comparable depth. | Primary product documentation demonstrating these capabilities as a coherent workflow, with user-verifiable provenance and cross-tool evidence. |
| A Site-local normalized graph of Library facts and derived relationships can make multi-corner and cross-view questions substantially easier without replacing the original Library as authority. | A graph/cache would become a duplicate source of truth and create more reconciliation cost than user value. | A first-slice test in which engineers cannot reproduce answers from source hashes, or cache invalidation/reconciliation dominates analysis time. |
| HimaHarness already has the right ownership seams: Pack method, Site execution, Ledger evidence, knowledge assets, Campaign Agent, and Workbench projection. | The Library domain needs an independent service, database, or desktop product lifecycle that existing modules cannot express. | A concrete required behavior that cannot fit the existing tool wrapper, report reader, evidence, graph annotation, or UI projection interfaces without leaking lifecycle and authority across several modules. |
| The first differentiating wedge should be cross-corner/cross-view anomaly triage tied to design relevance, not broad static QA coverage. | Customers primarily need exhaustive standards compliance and format linting, where mature tools have stronger coverage and lower risk. | User trials showing that anomaly ranking and design linkage do not change review decisions, while missed syntax/semantic violations remain the dominant cost. |

## Evidence gap matrix

| Question or thesis | Best support | Best contradiction | Confidence | Missing evidence | Next targeted action |
| --- | --- | --- | --- | --- | --- |
| Competitor baseline | Pending public primary-source retrieval | Pending | Low | Current product workflows and precise feature boundaries | Search official vendor product pages, manuals, webinars, and release material |
| API capability | Vendor README and demos on `linglong` show parser, evaluator, corner, and visualization modules | Python 3.7 vendor parser fixture currently exits 139 at `lib.name()` | Medium for surface, low for operational readiness | Successful supported-runtime fixture and real-Library read/query/write evidence | Keep runtime gap explicit; do not debug unless user reauthorizes it |
| Site corpus | Read-only inventory found SAED14 NLDM/CCS families and multiple custom/generated Library roots | File counts alone do not prove usable/independent corners or legal analysis scope | Medium | Hash/metadata inventory and owner classification | Produce a Site-local manifest containing metadata only |
| Hima ownership | `CONTEXT.md`, ADR-0001, polishing discipline, and existing Pack/Site/Ledger interfaces | Detailed adapter/UI seam not yet traced | Medium | Exact symbols, tests, and data authority mapping | Inspect current Pack tools, readers, Site channel, evidence, and Workbench projection |
| First wedge | Repository already contains design-conditioned Library-richness and Commercial Label concepts | No direct user trial yet for a Library analysis workflow | Medium-low | Decision task and time/rework baseline from a Library engineer | Specify a falsifiable first slice before implementation |

## Retrieval protocol

| Lane | Search terms | Included | Excluded | Stop rule |
| --- | --- | --- | --- | --- |
| Characterization platforms | Official pages/manuals for Synopsys SiliconSmart, Cadence Liberate, Siemens Solido Characterization Suite, Empyrean QuaLib | Vendor-owned product pages, datasheets, manuals, official webinars | Resellers, scraped feature lists, unsourced comparisons | Stop after each major vendor has one current capability source and one workflow/depth source, or official material is unavailable |
| Library QA/validation | Official pages/manuals for library validation, QA, consistency, variation/LVF, waveform/model verification | Primary vendor documentation and standards-owner material | Generic Liberty tutorials and SEO articles | Stop when core capability categories and explicit boundaries are saturated |
| Integration and decision workflows | Official APIs, batch/automation, visualization, reporting, design-context integration | Primary documentation showing actual workflow or interfaces | Marketing claims without a named operation or artifact | Stop when each consequential differentiation claim has support or a recorded gap |
| Internal product seams | Repository source, tests, ADRs, and current Pack assets | Current authoritative files in polishing workspace | `docs/upstream/` as current instruction; read-only reference repos | Stop when exact owner, interface, consumer, and minimum test are identified |
| Site corpus | Read-only file metadata and source headers on `linglong` | Paths, sizes, hashes, declared library/corner/model metadata | Copying proprietary Library bodies or license contents into Git or prompts | Stop after a representative manifest supports first-slice input selection |

## Research stop condition

Stop the discovery pass when another targeted search is unlikely to change the first-slice product decision, every consequential competitive claim has a primary source or is marked unknown, and the implementation spec can name exact current modules, API boundary, tests, and Site qualification gates.
