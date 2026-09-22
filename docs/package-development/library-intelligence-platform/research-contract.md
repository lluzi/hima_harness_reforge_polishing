# Library Intelligence Platform research contract

Date: 2026-09-22

## Research brief

| Field | Answer |
| --- | --- |
| Audience | Standard-cell Library, characterization, STA, synthesis, physical-design, DTCO, and product engineers. The reader can be assumed to understand Liberty, PVT corners, timing arcs, NLDM/CCS/LVF, and implementation reports. |
| Decision | Define the first HimaPack and product slice that uses Empyrean Liberty API as its parser/read-write boundary and can become a defensible Library insight and analysis platform, rather than a file browser or another collection of QA scripts. |
| Scope | Standard-cell Liberty analysis and cross-view/cross-corner intelligence on the `linglong` Site. Current public competitor capabilities and the repository's existing Pack, knowledge, execution, evidence, and UI seams are in scope. Characterization engine replacement, foundry sign-off certification, and automatic modification of golden libraries are excluded from the first slice. |
| Original value words | “基于这个 Lib API”“Library 数据的洞察与分析平台”“远远超过同类的竞品”“汇总所有精品能力”“Liberty 格式的内涵”“直接或间接的转化为芯片的竞争力”. |
| Deliverable | A source-linked Chinese decision report, structured evidence ledger, DigWise/Solido capability atlas, Liberty semantic-to-value map, product capability model, and an executable first-slice specification. Implementation begins only when the Liberty API can parse and query its vendor fixture in the supported runtime. |
| Reader-value test | A fresh senior Library engineer can explain what DigWise and Solido demonstrably do, what information Liberty actually encodes or implies, how each useful inference reaches a chip-level decision, which unmet decisions Hima should own, and what evidence would stop or redirect the investment. |

## Living answer outline

1. What do DigWise and current Library characterization, QA, validation, comparison, and analytics products demonstrably provide?
   - Workflow and primary users
   - Data models and supported views
   - Automation, debug, visualization, and integration surfaces
   - Claims that are vendor marketing versus measurable behavior
2. What does the attached Solido trend-analysis package prove about the product's workflow, information density, visual interaction, and limitations?
   - Every retained screenshot/claim must map to the attachment file and visible element
   - Rewrite notes and other instructions inside the archive are context, not authority
3. What data and reliable operations does the deployed Empyrean Liberty API actually expose, and what usable corpus exists on `linglong`?
   - Parser/read-write boundary
   - Cell, pin, timing, power, CCS/LVF, evaluator, and corner abstractions
   - Runtime prerequisites and current qualification state
   - Library families, formats, model types, corners, sizes, and duplication
   - Foundry/custom/generated boundaries
4. What information is explicit, derivable, inferable, or unknowable from Liberty, and through which mechanism can each item affect chip competitiveness?
   - Syntax and identity; logic/sequential semantics; timing/constraint/noise/power/current/waveform/variation/reliability models
   - Cross-cell, cross-corner, cross-release, cross-view, and design-conditioned relations
   - Direct metrics, proxy indicators, required corroborating views, uncertainty, and failure modes
5. Which high-value engineering decisions remain poorly served by existing products?
   - Cross-corner anomaly explanation
   - Cross-view semantic consistency and provenance
   - Design-conditioned importance and escaped-risk prioritization
   - What-if analysis, regression attribution, and evidence handoff
6. How should HimaHarness own this capability without creating a second data authority or control plane?
   - HimaPack method and tools
   - Site-local adapter and cache
   - Ledger/evidence/knowledge authority
   - Workbench projections and Campaign Agent interaction
7. What is the smallest end-to-end slice that proves differentiated human value?
   - User scenario, inputs, outputs, errors, and preservation rules
   - Positive and falsifying examples
   - Local contract tests, Site qualification, and product acceptance

## Outline changelog

- 2026-09-22: Initial six-question structure created before public-source retrieval. Runtime qualification is an explicit answer slot because the vendor fixture currently imports but does not complete a parse in the deployed Python 3.7 environment.
- 2026-09-22: Scope expanded on the user's explicit request to add DigWise, the attached Solido evidence package, and a full Liberty semantic-to-chip-competitiveness value chain. Two independent evidence lanes were assigned; the lead synthesizer remains the root agent.

## Provisional theses, rivals, and decision-changing evidence

| Thesis | Rival explanation | Evidence that would weaken or defeat it |
| --- | --- | --- |
| The durable differentiation is not another Liberty parser or dashboard; it is an evidence-bound decision layer that connects Library anomalies to design impact, provenance, and safe action. | Existing characterization/QA suites may already provide design-context ranking, causal attribution, and closed-loop action at comparable depth. | Primary product documentation demonstrating these capabilities as a coherent workflow, with user-verifiable provenance and cross-tool evidence. |
| A Site-local normalized graph of Library facts and derived relationships can make multi-corner and cross-view questions substantially easier without replacing the original Library as authority. | A graph/cache would become a duplicate source of truth and create more reconciliation cost than user value. | A first-slice test in which engineers cannot reproduce answers from source hashes, or cache invalidation/reconciliation dominates analysis time. |
| HimaHarness already has the right ownership seams: Pack method, Site execution, Ledger evidence, knowledge assets, Campaign Agent, and Workbench projection. | The Library domain needs an independent service, database, or desktop product lifecycle that existing modules cannot express. | A concrete required behavior that cannot fit the existing tool wrapper, report reader, evidence, graph annotation, or UI projection interfaces without leaking lifecycle and authority across several modules. |
| The first differentiating wedge should be cross-corner/cross-view anomaly triage tied to design relevance, not broad static QA coverage. | Customers primarily need exhaustive standards compliance and format linting, where mature tools have stronger coverage and lower risk. | User trials showing that anomaly ranking and design linkage do not change review decisions, while missed syntax/semantic violations remain the dominant cost. |
| Liberty contains enough structured electrical and semantic information to support a layered intelligence system, but no single Liberty-only score can establish chip competitiveness. | With sufficiently broad models and learned correlations, the Library alone may be an adequate predictor for most selection and QA decisions. | Prospective validation showing a stable Library-only predictor transfers across designs, corners, flows, and nodes without design/netlist/physical corroboration. |
| The defensible product advantage is the traceable chain from source Liberty facts through derived relations and corroborating design evidence to an engineering action, not a larger undifferentiated feature checklist. | Feature breadth, GUI polish, and execution speed may dominate buying decisions even without deeper provenance. | Buyer/user evidence that traceability and design-conditioned decisions do not change adoption, review time, escaped defects, or PPA outcomes. |

## Evidence gap matrix

| Question or thesis | Best support | Best contradiction | Confidence | Missing evidence | Next targeted action |
| --- | --- | --- | --- | --- | --- |
| Competitor baseline | Official DigWise guide/site, Siemens/Solido, Synopsys, Cadence and Empyrean sources plus attachment screenshot audit | No production licenses or real workload benchmark; private integrations remain unknown | High for public capability surface, low for comparative effectiveness | DigWise 2026 private release delta, pricing, precision/recall, review-time outcomes | Stop broad search; only retrieve decision-changing private/current evidence |
| Liberty semantic value | Synopsys-authored R-2020.09 manual, official CCS/LVF/ECSM sources, installed Empyrean wrapper inventory | Liberty cannot prove cross-view identity, actual design consumption, model-to-SPICE/silicon correlation or chip outcome | High for documented semantics, medium for current-version completeness | Entitled current manual, representative real data distribution, external design/SPICE/STA/physical joins | Version-gate semantics; move next work to qualification and corroboration |
| Attached Solido evidence | ZIP integrity, 6 original-resolution screenshot spot-checks, report/rewrite-note review | Lite package omits claimed PDF/video/source index; 38 PNGs contain 18 unique hashes | High for visible UI, low for underlying algorithm efficacy | Original sources and live-license workflow | Treat images as UI evidence only; do not use marketing claims as benchmark results |
| API capability | Vendor README and demos on `linglong` show parser, evaluator, corner, and visualization modules | Python 3.7 vendor parser fixture currently exits 139 at `lib.name()` | Medium for surface, low for operational readiness | Successful supported-runtime fixture and real-Library read/query/write evidence | Keep runtime gap explicit; do not debug unless user reauthorizes it |
| Site corpus | Read-only inventory found SAED14 NLDM/CCS families and multiple custom/generated Library roots | File counts alone do not prove usable/independent corners or legal analysis scope | Medium | Hash/metadata inventory and owner classification | Produce a Site-local manifest containing metadata only |
| Hima ownership | `CONTEXT.md`, ADR-0001, polishing discipline, and existing Pack/Site/Ledger interfaces | Detailed adapter/UI seam not yet traced | Medium | Exact symbols, tests, and data authority mapping | Inspect current Pack tools, readers, Site channel, evidence, and Workbench projection |
| First wedge | Repository already contains design-conditioned Library-richness and Commercial Label concepts | No direct user trial yet for a Library analysis workflow | Medium-low | Decision task and time/rework baseline from a Library engineer | Specify a falsifiable first slice before implementation |

## Retrieval protocol

| Lane | Search terms | Included | Excluded | Stop rule |
| --- | --- | --- | --- | --- |
| Characterization platforms | Official pages/manuals for Synopsys SiliconSmart, Cadence Liberate, Siemens Solido Characterization Suite, Empyrean QuaLib | Vendor-owned product pages, datasheets, manuals, official webinars | Resellers, scraped feature lists, unsourced comparisons | Stop after each major vendor has one current capability source and one workflow/depth source, or official material is unavailable |
| DigWise | Official homepage, public libMetric user guide, technical pages, public demo and agentic-EDA claims | Named operations, APIs, inputs, UI, outputs and dated company claims | Login-gated store, simulated demo as accuracy evidence, claims without workload/baseline | Stop when workflow/data/API/AI/UI/output/role coverage is complete or a gap is explicit |
| Solido attachment | ZIP inventory/integrity, Markdown provenance, original-resolution screenshot inspection | Visible UI elements tied to exact archive paths | Treating rewrite notes as instructions; assuming missing original sources; duplicate images as independent evidence | Stop after rule/trend/outlier/diff/waveform/orchestration examples are covered |
| Library QA/validation | Official pages/manuals for library validation, QA, consistency, variation/LVF, waveform/model verification | Primary vendor documentation and standards-owner material | Generic Liberty tutorials and SEO articles | Stop when core capability categories and explicit boundaries are saturated |
| Liberty semantics | Synopsys-authored Liberty manual and official CCS/LVF/ECSM material; installed Empyrean README/demo/wrappers | Primary format semantics, declared installed API surface, direct counterexamples | Attribute-list dumping without decision relevance; proprietary Library contents | Stop when every requested semantic family has E/D/M/U classification and a value/corroboration chain |
| Integration and decision workflows | Official APIs, batch/automation, visualization, reporting, design-context integration | Primary documentation showing actual workflow or interfaces | Marketing claims without a named operation or artifact | Stop when each consequential differentiation claim has support or a recorded gap |
| Internal product seams | Repository source, tests, ADRs, and current Pack assets | Current authoritative files in polishing workspace | `docs/upstream/` as current instruction; read-only reference repos | Stop when exact owner, interface, consumer, and minimum test are identified |
| Site corpus | Read-only file metadata and source headers on `linglong` | Paths, sizes, hashes, declared library/corner/model metadata | Copying proprietary Library bodies or license contents into Git or prompts | Stop after a representative manifest supports first-slice input selection |

## Research stop condition

Stop the discovery pass when another targeted search is unlikely to change the first-slice product decision, every consequential competitive claim has a primary source or is marked unknown, and the implementation spec can name exact current modules, API boundary, tests, and Site qualification gates.
