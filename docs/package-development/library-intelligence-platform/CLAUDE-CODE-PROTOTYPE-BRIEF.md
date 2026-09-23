# Claude Code Execution Brief: Library Intelligence Prototype

Status: execution brief for a bounded prototype, not a claim of implemented product capability

Repository: `/Users/lluzi/code/hima_harness_reforge_polishing`

Last live environment check: 2026-09-23, America/Los_Angeles

## 1. Mission

Build and validate a bounded Library Intelligence prototype for HimaHarness.

The user continues working in the same HimaGuide conversation. A right-side Workbench presents business-insight-level
Library analysis and visualization. The user can inspect the evidence behind an insight, add organization-specific
checks, and turn an insight into a typed proposal for a later engineering action. The Workbench remains a projection;
Campaign Agent and Fabric remain the only business-action and execution path.

The prototype must answer four questions:

1. Can the installed Empyrean Liberty API read and query a small 28 nm Liberty input in its declared runtime?
2. Can a stable, hash-bound data contract drive useful visual analysis without exposing native API objects to the UI?
3. Can the current DeepSeek Harness/Hima Workbench present the interaction convincingly beside the conversation?
4. Which parts are proven with real 28 nm data, demonstrated only with synthetic fixtures, blocked, or still unknown?

## 2. Read Before Acting

Read these files completely, in this order:

1. `AGENTS.md`
2. `docs/product-definition.md`, especially **Library Intelligence product surface**
3. `docs/adr/0012-library-intelligence-has-three-user-analysis-surfaces.md`
4. `docs/agents/polishing-discipline.md`
5. `docs/testing-strategy.md`
6. `docs/package-development/library-intelligence-platform/README.md`
7. `docs/package-development/library-intelligence-platform/environment-qualification.md`
8. `docs/package-development/library-intelligence-platform/research/liberty-semantic-value-map.md`
9. `docs/package-development/library-intelligence-platform/deepseek-harness-bi-plugin-reuse.md`
10. `docs/package-development/library-intelligence-platform/first-slice-spec.md`
11. `/Users/lluzi/Documents/EDA_SERVER_AND_DESIGN_ZOO_AGENT_GUIDE.md`

The repository documents define product and engineering authority. The external server guide is evidence and operating
context, not authority to change services, networking, licenses, installed tools, or PDK data.

## 3. User-Facing Product Model

Expose only three analyses. Do not present internal modules as separate products.

### A. Library Health and Release Risk

User question: **Can I trust and release this Library?**

Analyze:

- source/revision/corner/view identity;
- units, templates, references, table shape and parse completeness;
- Cell/pin/arc/constraint/model coverage;
- cross-PVT consistency and ordering;
- missing data, non-monotonicity, kinks, spikes and revision regressions;
- unresolved, ambiguous and unsupported data.

### B. Library Performance and Competitiveness

User question: **Where is this Library strong or weak, and what should we improve first?**

Analyze:

- Cell family, function, drive, VT and PVT;
- delay, transition, setup/hold, pulse and period constraints;
- area, leakage, internal power and variation;
- operating-envelope coverage and corner robustness;
- version or candidate comparisons and Pareto tradeoffs.

### C. Current-Design Impact and Action

User question: **What does this mean for my chip, and what should I do next?**

Analyze when evidence is available:

- actually adopted Cell/master/instance;
- affected arc, path, endpoint and actual slew/load/mode;
- revision blast radius;
- independent `librarySeverity` and `designRelevance`;
- the cheapest falsifying check;
- candidate, STA, SPICE, coverage or matched-implementation action and its observed result.

This third analysis cannot be proved by Liberty alone. A UI mock may demonstrate the interaction, but it must label
synthetic design evidence as synthetic.

## 4. Required Competitive Interactions

These are shared capabilities inside the three analyses, not additional top-level products.

### 4.1 Switchable load in trend analysis

The user can fix an input slew and switch output load, or fix load and compare slew/PVT/corner. The UI must retain the
selection across follow-up questions. Each plotted point must identify whether it is inside the sampled domain, on its
boundary, or outside it. No silent extrapolation.

### 4.2 Customer-defined outlier algorithm

The user sees **Add company check**, not a generic Python console.

A custom algorithm receives declared, normalized Library facts and returns a typed Finding list. It must have:

- an input schema;
- positive and negative fixtures;
- deterministic version/hash identity;
- dependency, time, memory, file and network limits;
- a bounded output schema;
- preview before activation;
- no authority to modify the golden Library or publish a release verdict.

For the prototype, implement one small, deterministic example algorithm over fixture data. A suitable example is a
local-neighborhood deviation detector that finds one injected constraint kink while leaving a valid nonlinear curve
unflagged. Do not execute arbitrary model-generated Python as the default rule path.

### 4.3 Cell filtering

Support filters by at least:

- name or pattern;
- function/class;
- VT/drive when present;
- Cell type such as combinational/sequential/memory/IO when present;
- Finding state/severity;
- changed versus unchanged;
- current-design adoption only when real design evidence exists.

The user can include/exclude Cells and save a view. Filtering large corpora occurs in the Host/data layer; do not send
all rows to the browser or model and filter there.

### 4.4 Multidimensional presentation

Support X/Y/color or row/column/color, with optional small multiples. Example:

```text
X      = Word
Y      = Byte
Color  = Delay Constraint
Facet  = Corner
```

If `Word` and `Byte` are memory-organization dimensions, use them only when a Liberty generic attribute/group, approved
manifest, or qualified adapter explicitly provides them. Do not infer missing dimensions from file names or model text.

The user asks the engineering question; the product chooses heatmap, small multiples, surface, scatter or table. Do not
make chart selection the primary workflow.

### 4.5 Third-party Library/View adapters

Present this as **Extensible Library/View Adapters**, not “the Liberty API reads every third-party model.”

- Liberty uses the Empyrean Lib API adapter.
- Milkyway and NDM require a separate Synopsys read-only adapter, legal installed tools/API, licenses and Site Permit.
- Each adapter emits versioned, hash-bound facts into the same canonical identity model.
- The original database remains authoritative.
- Ambiguous, absent, contradicted and unsupported mappings remain visible.

This prototype only inventories Milkyway/NDM collateral and designs the adapter contract. Do not implement or invoke a
Synopsys database reader unless the user separately authorizes the required tool/license work.

## 5. Architecture Boundary

Use the existing HimaHarness architecture:

```text
Liberty source bytes
  -> Site-local Python 3.7 worker / Lib API
  -> hash-bound LibraryFacts + explicit unknowns
  -> deterministic analyzers / typed rules
  -> LibraryInsightReport + Findings + action proposals
  -> Hima Host/Ledger authority
       -> conversation summary/tool receipt
       -> right-side Hima Workbench visualization
       -> versioned Rule/Insight assets
       -> Campaign Agent -> Fabric -> approved action
```

Required boundaries:

- UI code never imports `_tmlib.so` or native API objects.
- One native worker failure produces an explicit failed input record, not partial success.
- Large arrays remain in Site/Host artifacts; the model sees bounded summaries and identities.
- Any SQLite/Arrow/JSONL cache is disposable and reconstructable from source hashes.
- The right Workbench is read-only state projection plus typed action proposals, not a second executor.
- Candidate writes go only to a Campaign/prototype workspace and never overwrite a source Library.
- No customer Library body, design, log, report or debug file is uploaded by default.

## 6. Server Access and Live Paths

Re-probe every value before use. The snapshot below was observed on 2026-09-23.

### 6.1 Connect

On the home LAN from the current Mac:

```bash
client_lan_ip=$(ipconfig getifaddr en0)
ssh -b "$client_lan_ip" -o BatchMode=yes -o ConnectTimeout=8 luzi@192.168.50.41
```

Outside the LAN, use the approved Tailscale path from the server guide:

```bash
ssh luzi@100.105.1.61
```

Do not rely on `ssh linglong` if the local proxy resolves it into a fake-IP range. Do not change routes, proxy, DNS,
Tailscale or firewall settings for this task.

### 6.2 Runtime

```text
Host                         linglong
LAN                          192.168.50.41
EDA wrapper                  /usr/local/bin/edarun
Miniconda                    /data/eda/runtime/miniconda3
Python                       /data/eda/venvs/qualib-libapi-2026-py37/bin/python
Observed Python version      3.7.12
Observed conda version       26.7.1
Lib API root                 /data/eda/software/eda_tools/empyrean/libapi-2026.master.c68db94/API
Deployment note              /data/eda/software/eda_tools/empyrean/README.QUALIB_2026.md
```

The vendor documentation declares the API independent of the Empyrean FlexNet daemon. Do not start, stop, replace or
reconfigure any license service for API qualification.

Before any larger read, perform only bounded, read-only health checks:

```bash
hostname
date -Is
df -hT / /data
free -h
pgrep -af '(qualib|dc_shell|lc_shell|pt_shell|fc_shell|icc2_shell|innovus|genus)' || true
```

Do not interpret defunct processes as active Jobs. Do not start commercial EDA in Stages 1–5. If later work is admitted,
re-check active processes, memory and license capacity immediately before launch and use `tmux` for long work.

### 6.3 Candidate 28 nm inputs

Start small and progress only after each gate passes:

```text
Vendor fixture
/data/eda/software/eda_tools/empyrean/libapi-2026.master.c68db94/API/demo/testParser.lib

Small custom 28 nm Liberty
/data/eda/project/tsmc28_work/xspace_forge/XS_CAND_AOI21/XS_CAND_AOI21.lib

28 nm Liberty skeleton
/data/eda/project/tsmc28_work/xspace/tsmc28_skeleton.lib

Real TSMC28 TT 0.9 V 25 C foundry Liberty
/data/eda/project/techlib/tsmc28/logic/tcbn28hpcplusbwp40p140_180b/AN61001_20180509/TSMCHOME/
digital/Front_End/timing_power_noise/NLDM/tcbn28hpcplusbwp40p140_180a/
tcbn28hpcplusbwp40p140tt0p9v25c.lib
```

The final foundry file was 87,283,165 bytes at the live check. Treat size and path as observations, not permanent
constants. The `sites/linglong-aes/site.yml` `foundryLibrary` binding is a compiled `.db`; the text Liberty path above
comes from the Site-bound `physical.json` `FOUNDRY_LIB` entry and is the appropriate Lib API candidate.

### 6.4 Third-party collateral already present

The SAED14 tree currently contains 10 directories named `milkyway` and 35 NDM bundle directories with 35
`reflib.ndm` files. This is a real future adapter corpus, not proof that the Empyrean Lib API can read them.

Synopsys product manuals are entitlement-gated through SolvNetPlus. Record this as an adapter prerequisite rather than
guessing commands from unofficial material.

## 7. Safe One-Off API Invocation

Never run demos in the vendor installation directory. Copy the selected script/input into a new prototype workspace so
logs and output files cannot modify installed payloads.

Example command shape inside `linglong`:

```bash
api_root=/data/eda/software/eda_tools/empyrean/libapi-2026.master.c68db94/API
api_python=/data/eda/venvs/qualib-libapi-2026-py37/bin/python
prototype_root=/data/eda/project/hima_harness/library-intelligence-prototypes/<RUN_ID>

mkdir -p "$prototype_root/vendor-fixture"
cp "$api_root/demo/testParser.py" "$api_root/demo/testParser.lib" "$prototype_root/vendor-fixture/"
cd "$prototype_root/vendor-fixture"

timeout 30 /usr/local/bin/edarun \
  env -u EMPYREAN_LICENSE_FILE \
  LIBERTY_API_HOME="$api_root" \
  PYTHONPATH="$api_root" \
  LD_LIBRARY_PATH="$api_root/lib" \
  "$api_python" -X faulthandler testParser.py
```

Replace `<RUN_ID>` with an explicit lowercase identifier such as `claude-libint-20260923-01`; never run this command
with the placeholder left intact.

Record:

- command and return code;
- stdout/stderr;
- source and output SHA-256;
- API/Python/runtime identity;
- parser log identity;
- start/end timestamps;
- whether output is complete, partial, absent or unreadable.

The vendor demo is only the first trigger. If it passes, write a separate bounded `qualification.py` in the prototype
workspace that reads the original fixture, queries required facts, writes a new copy, releases the first handle, reads
the copy again and compares explicit invariants. Do not edit the vendor `testParser.py` and call that a qualification.

Known retained evidence: the same fixture previously imported and returned a handle, then exited `139` at
`tmlib.py:1202` during `lib.name()`. That is a reproduced qualification failure, not a diagnosed root cause.

If it still exits `139`, preserve the evidence and stop the live Lib API branch. Continue the visualization prototype
with synthetic, checked-in fixtures conforming to the intended schema. Do not debug `_tmlib.so`, change native
libraries, preload alternate runtimes, replace the API package or activate QuaLib 2026 without separate authorization.

## 8. Ordered Execution Plan

### Stage 0: Freeze authority and workspace

Actions:

- read the required documents;
- inspect `git status`, current branch and current HEAD;
- preserve all existing changes;
- choose exact repository files and a unique server prototype workspace;
- write a short execution card with model/effort, inputs, output paths and minimum test level.

Completion criterion: no target path overlaps unexplained existing changes, and all source/output identities are explicit.

### Stage 1: Qualify the vendor fixture

Actions:

- copy fixture/script to the prototype workspace;
- run the exact Python 3.7/`edarun` command with a 30-second bound;
- if the vendor script passes, run a separate qualification wrapper that performs read/query/write-copy/re-read;
- save hashes, return code and logs;
- verify installed vendor bytes are unchanged.

Completion criterion: either a complete read/query/write-copy/re-read record exists, or a precise failed gate exists.

### Stage 2: Qualify a small real 28 nm Liberty

Proceed only when Stage 1 passes.

Use `XS_CAND_AOI21.lib` first. Extract a bounded canonical record containing:

- source identity, API build and extractor version;
- Library name and units;
- operating conditions;
- Cell count and one selected Cell;
- pins, PG pins, functions and timing groups;
- template axes and bounded table values;
- explicit unknown/unsupported fields;
- write-copy path and round-trip comparison.

Completion criterion: source hash unchanged; canonical output validates; re-read candidate preserves the required
invariants; no unaccounted input or partial-success state.

### Stage 3: Qualify one real foundry corner

Proceed only when Stage 2 passes. Use the TSMC28 TT Liberty. Start with inventory and an explicitly selected bounded
Cell subset. Do not materialize the complete 87 MB Library into model context or Git.

Completion criterion: bounded source-derived aggregate/fact outputs, exact denominator, timing and memory measurements,
and an explicit statement of what was not extracted.

### Stage 4: Freeze `LibraryInsightReport/v1`

Define a strict schema before UI implementation. At minimum include:

- source/producer/query/rule identities;
- `derivationLevel`, `sourceDomain`, `evidenceStatus`;
- datasets stored by identity, not duplicated across views;
- metric, line, table and heatmap views;
- load/slew/corner selection metadata;
- Cell filter specification;
- Finding records with severity, confidence, unknowns, evidence and next check;
- typed action proposals without execution side effects;
- size/row/view/dataset limits and typed refusal states.

Completion criterion: positive and falsifying fixtures validate deterministically; unknown fields, invalid references,
non-finite numbers, domain-external interpolation and oversized reports fail closed.

### Stage 5: Build the visualization demo

Build a reviewable demo that presents the three user analyses, not a gallery of components.

Required interactions:

1. switch load/slew/corner on a trend;
2. filter Cells and save/restore one view;
3. present at least three simultaneous dimensions using heatmap/small multiples rather than gratuitous 3D;
4. click a datum to open its Finding/evidence detail;
5. send the selected semantic identity back into the conversation as an **Ask HimaGuide** draft;
6. preview one customer-defined outlier algorithm and its positive/negative fixture results;
7. show one typed next-action proposal without executing it;
8. clearly badge real, synthetic, inferred, unknown and blocked data.

Use local assets only. Do not use a chart service, CDN or arbitrary model-generated HTML/JavaScript. A static HTML/React
prototype may be used for visual review, but its data must conform to `LibraryInsightReport/v1`.

Completion criterion: a user can answer the three product questions without learning the internal component names, and
every displayed value has a source or an explicit synthetic/unknown label.

### Stage 6: Make the smallest Hima integration spike

Only after the standalone demo and schema are accepted:

- deepen the existing `@hima/harness` client and `HimaWorkbench`;
- reuse the existing DSH right-sidebar/slot/tool-view seams;
- avoid a second modal, Web app, BI server or execution controller;
- use a synthetic fixture first;
- preserve existing Campaign behavior and tests.

Completion criterion: the Hima Workbench displays one read-only Library Insight report beside the same conversation;
selecting a datum creates a draft but launches no Job; existing Campaign UI/contract tests remain green.

For a native Desktop visual test or recording, use the configured Catsights secondary display as required by the
testing strategy. If that display is unavailable, mark Desktop visual verification not run; do not fall back to the
user's primary display.

### Stage 7: Review and handoff

Deliver a status that separates:

- passed real Lib API evidence;
- passed real 28 nm evidence;
- passed synthetic visualization behavior;
- failed or blocked gates;
- unrun commercial EDA/third-party adapter work;
- recommended next bounded slice.

Completion criterion: another engineer can reproduce every passed result from documented inputs and commands and can
state exactly which product claims remain unsupported.

## 9. Visualization Content Requirements

The demo should feel like an engineering decision workspace, not a generic BI dashboard.

### Library Health and Release Risk view

- concise readiness summary with explicit denominator/unknowns;
- corner/Cell coverage matrix;
- trend anomaly view with load selector;
- filtered Finding list;
- selected Finding explanation, neighboring evidence and next check.

### Library Performance and Competitiveness view

- Cell family/drive/VT/corner comparison;
- delay or constraint surface/heatmap;
- area/leakage/delay tradeoff when data exists;
- selectable load/slew/corner;
- clear distinction between direct values and evaluator/proxy values.

### Current-Design Impact and Action view

- use real Hima design evidence only when identity can be proven;
- otherwise use a synthetic fixture with a visible badge;
- show adopted master/instance, endpoint/path, actual operating point and blast radius when available;
- retain independent Library severity and design relevance;
- show the proposed next check, required input/tool/license, expected answer, stop condition and rollback.

## 10. Deliverables

Repository deliverables:

1. `LibraryInsightReport/v1` schema and positive/falsifying fixtures;
2. deterministic schema/rule tests;
3. visualization demo source;
4. rendered demo or screenshots suitable for product review;
5. one bounded Hima integration spike if Stage 5 is accepted;
6. an English implementation report with current status, evidence, risks and next slice;
7. source registration and license/NOTICE updates for any reused MIT code.

Server evidence, retained outside Git:

1. environment and source manifest;
2. fixture qualification record;
3. small 28 nm qualification record;
4. foundry-corner trial record if admitted;
5. logs, hashes, canonical output and performance measurements;
6. any candidate copy and round-trip comparison.

Use a simple append-only layout inside the explicit prototype workspace:

```text
<RUN_ID>/
  environment.json
  source-manifest.json
  runs/
    vendor-fixture/
    small-28nm/
    foundry-tt/
  canonical/
  logs/
  reports/
```

Never reuse one run directory for a corrected command. Create a new run identity and preserve the earlier failure.

Never commit proprietary Liberty contents, customer design data, license contents, raw vendor database contents or
unreviewed server logs.

## 11. Acceptance Matrix

| Requirement | Pass | Falsifying result |
| --- | --- | --- |
| API qualification | Vendor fixture and selected input complete read/query/write-copy/re-read | crash, timeout, partial output or unaccounted input reported as success |
| Competitive value | Each UI section answers one of the three user questions and changes a review/next-action decision | component gallery or colorful charts with no engineering decision |
| Lib API grounding | Every real datum links to API fact/source identity/unit/condition/query version | value invented by model, inferred from filename, or missing source |
| Load switching | selection changes the bounded source-derived slice and retains context | redraws arbitrary/synthetic values while presented as real |
| Custom algorithm | fixture-tested, versioned, bounded Finding output | unrestricted Python decides PASS/FAIL or changes source data |
| Cell filter | Host/data-layer filtering with exact denominator | browser/model receives entire large corpus and silently drops rows |
| Multidimensional view | dimensions are declared facts; chart remains readable | nonexistent Word/Byte inferred from naming or gratuitous 3D |
| Third-party formats | adapter contract and real collateral inventory with explicit qualification gap | claim that Python/Lib API directly reads Milkyway/NDM |
| Evidence/replay | same report bytes replay without re-query or reinterpretation | refresh/model regeneration changes historical charts |
| Action boundary | typed proposal only until Agent/Fabric admits execution | UI directly runs EDA or mutates a Library |

## 12. Stop and Escalate

Stop the affected branch and report the exact blocker when any of these occurs:

- the vendor fixture still exits `139`;
- a required source, tool, license or entitlement is missing;
- the work requires changing an active license service, network, proxy, tool install or shared PDK;
- the work requires native API debugging or replacing vendor binaries;
- the repository has unexplained overlapping changes in a target file;
- the candidate would overwrite a golden Library or write outside the prototype workspace;
- proprietary data would have to enter Git, a model request or an external chart service;
- a new Runtime control plane, database authority or execution owner appears necessary;
- the product decision depends on Milkyway/NDM commands not verified from entitled documentation.

Do not count a blocked real-data branch as a failed visualization prototype, and do not count a successful synthetic UI
as real Lib API or 28 nm qualification.

## 13. Git and Completion Discipline

- Work only in the polishing repository; the prototype and legacy reference repositories remain read-only.
- Preserve unrelated working-tree changes and untracked files.
- Use the smallest reversible commits.
- After every local commit, push the corresponding branch and verify the remote SHA, as required by `AGENTS.md`.
- Report tests as passed, failed, skipped or not run; do not fold them into one green label.
- Do not call the prototype “production-ready,” “signoff,” “competitive lead,” or “QuaLib replacement.”

The task is complete only when the deliverables and acceptance matrix make the real, synthetic, blocked and unverified
parts independently visible.
