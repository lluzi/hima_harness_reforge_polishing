# Library Insight prototype: analysis evidence audit

**Audit boundary.** Read-only source audit of `/Users/lluzi/code/lib_insight` at
`8e3abdc47adcd4d2662c161e6b85f0a9d706df47` (`feat/review-revision`), performed
2026-09-29.  This worker packet inspected source and test assertions only. Root separately ran the synthetic suite on an archived copy; see [the consolidated audit](prototype-capabilities.zh-CN.md). The worker did not
read `data/`, run extraction, the server, tests, network calls, or EDA jobs.
Therefore, an assertion below means *implemented and asserted against synthetic
fixtures*, never that it has passed on a customer library or a qualified Liberty
extract.

## Result

This is a substantive **Liberty-only prototype analysis kernel**: it has a typed
Liberty fact model, deterministic metric/check logic, a limited netlist/timing
Usage Lens, and generated action text.  It is useful source material for a
Hima-side, evidence-carrying Liberty analysis slice.  It is not evidence for a
unified LibInsight product yet: no LEF reader, no pin/PORT/OBS geometry, no
routing/technology model, no pin-access probability, no Liberty--LEF identity
proof, were found in the inspected source. Real-data qualification was not assessed because proprietary data and remote extraction were outside this audit.

The README itself bounds the subject to a Kit Release whose evidence is Liberty
(with an optional netlist/timing Lens) [README.md:3-5], describes a Lib API
Liberty extraction pipeline [README.md:34-49], and says the test suite is
synthetic [README.md:54-55].  A repository search for `lef`, `pin access`,
`PORT`, `OBS`, routing, via, and placement found no LEF analysis module or LEF
fixture.  The sole matches in the application are ordinary unrelated words such
as HTTP `via` and source imports.  Do not infer physical-library support from
the README's generic "P&R" wording [README.md:9-12].

## Capability matrix

| Area | Source evidence (path:symbol/lines) | Actual behaviour and assumptions | Test evidence inspected; scope for reuse |
|---|---|---|---|
| Check catalogue E1--E25 | `libinsight/expectations/specs.py:15-75`; runners `expectations/__init__.py:13-42` | 25 fixed checks. Groups map Integrity to Error, Accuracy/Plausibility to Warning, Optimization to Opportunity. File and kit runners catch each check exception and record an `error:` status rather than raise it. | `tests/test_expectations_{kit,semantic,tables,leverage}.py` exercise each family with synthetic facts. Reuse catalogue wording, stable IDs and structured finding fields; Hima must surface a failed check as an incomplete analysis, not merely a status string. |
| Structural/semantic integrity | `expectations/kit.py:e1,e2` at 63-158; `expectations/semantic.py:e3,e4,e5,e6,e9,e10,e11,e18` at 71-458 | Checks corner structures/header thresholds; Boolean/timing sense; conditional arcs; indexes/shapes; required tables; legal signs; LVF coverage/ratio; setup+hold. E1 only compares primary-view files and skips variants with fewer than two summaries. | Assertions include missing cell/corner, header mismatch, conditional coverage, missing tables, LVF and in-domain setup/hold in `tests/test_expectations_kit.py:67-184` and `tests/test_expectations_semantic.py:8-162`. Reusable deterministic validation after the Liberty extraction schema is proven equivalent. |
| Table numerics and accuracy | `table.py:evaluate` 11-52; `numerics.py:lagrange_weights..midcell_error` 12-144; `expectations/tables.py:e7,e8,e13,e14` 35-341 | Multilinear table evaluation returns value plus in-grid flag. E7 estimates pin-limit coverage, E8 PCHIP/chord-style curvature undersampling, E13 monotonic load trends, E14 localized spikes/kinks. These are model-based checks, not tool simulations. | Synthetic tests assert curved extrapolation, interpolation findings, non-monotone load and isolated spike location (`tests/test_expectations_tables.py:7-79`; `tests/test_numerics.py`). Strong reusable numeric core, but bind units/template semantics and tolerance settings to the Hima source record. |
| Per-cell metrics and dominance | `metrics.py:arc_metrics` 115-153; `compute_library_metrics` 444-475; `dominance` 500+ | Reads delay/transition at a resolved reference point; estimates slope `R_d` with a ±10% load finite difference; `p` reads at zero load; combines internal energy with `0.5*C*V²`; marks table-domain flags. Cell metrics include area, caps, leakage, arcs and sequential constraints. | `tests/test_metrics.py` asserts synthetic reference reads, energy/domain, picks, and dominance. Reuse only with ReferenceCondition provenance and explicit `in_domain`; avoid promoting extrapolated `p` as a measured fact. |
| Classification and comparability | `classify.py:classify_cell` 187-219; `function_key` 236-246; `name_functions` 267-315; family refinement 378-453; VT twins 471+ | Classifies from Liberty flags/functions/sequential semantics; function key uses canonical Boolean truth tables (input permutation up to six inputs; wider functions preserve sorted order and add `*`). Families/swap sets use function, footprint/cap/intrinsic heuristics; VT twins use declared naming or capacitance fallback. | `tests/test_classify.py` asserts roles/classes, canonical equivalence, family splits and twin pairing against synthetic cells. Reuse semantic classification, but treat name hints/fallback topology/twin results as hypotheses until cross-file identity and characterisation provenance are established. |
| Voltage sensitivity | `voltage.py:voltage_series` 35-123; `sensitivity_all` 182-220; `factors` 252-309; `verdict` 333-377; `along_supply` 506-550 | Compares matched process/temperature voltage series and normalizes each cell's slowdown to its own variant reference inverter; default watch is 1.10. It excludes readings flagged outside the table grid and ranks variance attributed to VT/drive/flavour/class beyond a chance term. | `tests/test_voltage.py:130-378` asserts own-reference normalization, common-voltage intersections, missing data, exclusions, factor ranking and arc joins. Reusable analysis presentation; it does not establish Vmin sign-off, characterize voltage, or prove causal factor attribution. |
| Usage Lens | `lens.py:parse_netlist` 29-63; `parse_timing_report` 88-133; `UsageLens` 145-204 | A regex-oriented Verilog parser recursively counts instantiated masters from one top module. The report parser recognizes a specific textual path-row format, converts declared units, and pairs input/output rows into stages. It tracks reported-path coverage only; it does not alter Facts/Metrics/Issues. | Tests assert hierarchy flattening, setup/hold recognition, captured-path exclusion, operating points and exposure (`tests/test_lens.py:50-74`). Reuse only as a constrained adapter: it is not a general Verilog/STA report parser and needs an Hima controlled-job/evidence wrapper. |
| Actions and company policy | `actions.py:a1_dont_use` 25-69, `a2_recharacterise` 72-101; `policy.py:validate/evaluate/preview` 28-133 | A1 emits Tcl/CSV, preserving `keep_min_ladder` usable members. A2 groups selected E8/E14 findings into CSV re-characterisation rows. Company checks permit only a fixed metric set, absolute or class-median comparisons, scopes, and three severities; out-of-domain table metrics are not judged (except `p` uses delay domain). | `tests/test_actions.py:10-66` asserts ladder retention, excluded extrapolated sigma, grouped requests, and policy validation. Reuse the generation logic as a proposed-action formatter only; Hima requires policy ownership/versioning, user authorization, target tool/site identity and post-action verification. |
| Calibration/reliability | `calibrate.py:holdout_points` 46-75; `validate_e8` 110-138; `audit_sample/score/agreement` 163-344 | E8 gets held-out grid validation; other checks depend on human-labelled CSV audit rows (`defect`, `quality`, `practice`, `false`). Calibration writes local derived files and preserves prior audit history. E7/E8 are expressly skipped by the human audit. | `tests/test_calibrate.py:20-157` asserts bilinear holdout, label rejection, score/history and pattern agreement. Reusable method, but it is unqualified until a reviewed real-data sample, immutable evidence records and calibration governance exist. |

## E1--E25 coverage map

The canonical check table is source-owned in `expectations/specs.py:31-75`; the
following compact map is a transcription of its implemented intent, not an
independent correctness claim.

| IDs | Implemented check class | Boundary worth retaining |
|---|---|---|
| E1--E6 | Corner/header structural consistency; timing/function and conditional-arc semantics; index/shape; missing data | File/kit completeness checks need an explicit input manifest and extract version in Hima. |
| E7--E8 | Pin-limit range and sampling-density/curvature estimates | Both are marked `estimate=True` in the catalogue; show validation coverage, not a defect certainty. |
| E9--E12 | Legal signs, LVF coverage/consistency, cross-view NLDM-table agreement | E12 compares matching tables carried by alternate views; it is not Liberty--LEF or model-equivalence validation. |
| E13--E18 | Load monotonicity, spikes/kinks, voltage/VT trends, drive scaling, setup+hold | Trend exceptions and out-of-domain samples are deliberately special-cased; no blanket physics verdict is justified. |
| E19--E25 | Optimization readiness: rank consistency, ladder gaps, swap set, VT twins, CTS/hold cells, optimization limits | These identify opportunities from Liberty-derived metrics; they do not prove synthesis/P&R result improvement. |

## Integration boundary and concrete pitfalls

1. **LEF is a separate missing capability, not an adapter gap.** The prototype's
   data model and extraction path are Liberty facts only.  A proposed pin-access
   feature needs its own versioned LEF/technology/environment input contract,
   geometric evidence, probability assumptions, calibration record, and a
   demonstrated mapping to the Liberty cell/pin identity.  Do not join on names
   alone.
2. **Do not inherit the prototype's local execution model.** The README invokes
   a licensed external extractor and copies derived data to a local `data/`
   directory [README.md:42-49,57-61].  Hima must keep extraction as a controlled
   job with source hash, site/permit, result identity, cancellation/recovery and
   immutable evidence rather than reading a mutable output directory as truth.
3. **The runner is fail-soft.** `_run` converts an exception into a status entry
   [expectations/__init__.py:19-29].  Hima's user-visible conclusion must make
   a failed or unrun expectation non-clean and preserve the exact error.
4. **Reference-condition/domain status is essential.** `arc_metrics` can read
   derived values beyond the grid while returning domain flags
   [metrics.py:115-153]; policy omits such table-derived values from judgment
   [policy.py:16-25,69-95].  Preserve this distinction per metric and table,
   rather than reducing results to one library health score.
5. **The Lens parser has intentionally narrow evidence coverage.** It reports
   that counts cover the netlist, while operating points/slack cover only
   reported paths [lens.py:196-204].  Its regex parsers need format admission
   tests and explicit unsupported construct/report diagnostics before a user
   sees design-impact conclusions.
6. **Generated actions are proposals.** A1's output literally asks for later
   verification [actions.py:56-68], while A2 asks for E8/E14 to disappear after
   re-characterisation [actions.py:92-100].  Treat them as reviewable artifacts,
   never executable repair authority.
7. **README reliability language is aspirational without real evidence here.**
   It says every check shows a reviewed precision audit or held-out precision
   [README.md:13-15], but source establishes only a mechanism for local CSV
   labels and E8 holdout computation.  This audit found no reviewed production
   calibration artifact because proprietary `data/` was intentionally not read.

## Smallest responsible reuse seam

Keep the prototype as an **offline Liberty-analysis algorithm reference**, not a
runtime authority.  A Hima integration can adapt pure functions behind a typed
adapter from an already-qualified Liberty evidence record, carry each finding's
source address/hash/settings/reference condition/domain flag, and write results
through Hima's existing evidence/controlled-task path.  Start with the
deterministic catalogue, table/metric evaluation, classification and finding
schemas.  Defer the server, local file layout, direct extractor invocation,
free-form action delivery, LEF/pin access, and all cross-view conclusions until
their input contracts and falsifying tests exist.

## Test-status statement

No test command was executed by this worker. Root subsequently ran 274 tests successfully on the pinned archive; see [the run receipt](prototype-audit/receipt.json). The cited tests here are source-level
assertions over synthetic fixtures (as the prototype README says), so they
demonstrate intended unit/integration behaviour only.  They do not qualify the
Lib API extraction, a commercial Liberty release, an STA report dialect, a
customer netlist, LEF parsing, or pin-access predictions.
