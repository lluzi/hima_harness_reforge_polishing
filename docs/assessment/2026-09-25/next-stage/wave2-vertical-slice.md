# Wave 2 — Library vertical slice and durable work

Date: 2026-09-25. Terminal result: **PASS** for Issue #49 E2–E4 and Issue #57.

## Fixed identities

- Source: `e995977664814989f3b14b56ac376064a0b7b335` on `main` for the terminal Run.
- Pack: `library-intelligence@0.3.2`.
- Method digest: `3ad1bfa503f48d9d2717350b39a7ed7d877bd003b3983bb6f1609b8b366b9246` in both source and installed copy.
- Run: `run-a1a58ed5-3776-450e-a5a3-cde6f7abe157`, purpose `test`, status `ended-goal-not-met`, current node `read-library-proposal`.
- Site: `wave2-library`; Permit SHA-256 `3529ff536bf8b6bd50b9168a0a97c137d56c595ecc4fab2c84ea56c504553f2c`.
- Environment before and after: `selected=new old=inactive new=active`; no XTop or QuaLib client remained.
- Full retained evidence: [attempt 9](wave2-library-attempt9/evidence.json).

`ended-goal-not-met` is the Run's exact graph ending, not an E2–E4 failure: this development method has a positive E1 qualification Judge but deliberately has no chooser that converts a representative same-source control into a business `goal-met` decision. The capability gates below are established by the exact Reader Observations. No Library release or value claim is inferred from the ending.

## #49 results

### E1 — retained PASS

The same Run repeated the actual Pack-to-Host qualification under `selected=new` with one exact `QuaLib-2026-new-59099` Job. Vendor fixture, SAED14 and TSMC28 source hashes remained unchanged. The qualification Reader emitted `library_qualification_ok=1`; the Judge passed. This re-confirms, rather than replaces, the Wave 1 E1 gate.

### E2 — PASS, bounded representative facts

- The graph produced separate baseline and candidate `hima-library-facts/1` records from the exact qualified TSMC28 source. Their source SHA-256 is `a07fbf556c5aed51e08cbf19d916371dbb1b631ca926e46893ac8781fcb707b5`.
- A Site-owned `hima-library-analysis-input/1` manifest, SHA-256 `3bf0be33c25c99e7b2996c2334a95c80aca399c119adddad8f4c06e406408c9a`, separately declares baseline/candidate roles, the expected source hash, family `tcbn28hpcplusbwp40p140`, corner `tt0p9v25c` and view `NLDM`.
- Each record retains Library name, native unit scales, one Cell/pin/arc, and a complete 7×7 NLDM table: two named axes with units/scales and all 49 finite values. Producer, manifest, qualification child and source identities are independently re-read by the Reader. Coverage remains explicit: 1 observed Cell of 1000 declared; `complete=false`.
- PVT, function, drive, VT, logical family, `when` and unobserved Cells remain typed unknowns. They are never zero-filled.
- The comparable control uses the exact same source as baseline and candidate. It records an explicit area delta of `0.0` and labels it `same-qualified-source-zero-delta`; this is not a revision comparison.
- Independent Readers re-open E1 receipt, source, both fact records and the delta. Self-consistent tampering of PVT unknowns, conditions, provenance, result refs or algorithm identity fails closed.

### E3 — PASS

- Observation `run-a1a58ed5-3776-450e-a5a3-cde6f7abe157#000052` retained the strict `hima-library-insight-report/1` bytes with SHA-256 `d54963f2028ac4f20a1facbec66acae9b1d974e296d456179f18d269d62480c2`.
- Host projection added immutable report ref/version/source identity and returned `evidenceClass=native-qualified` with no synthetic-warning mismatch.
- The report keeps Library severity and design relevance separate, displays units/provenance/unknowns, and states that design evidence is absent.
- Loaded filtering is a local synchronous slice. The UI has no compute callback; a recalculation must use a new controlled task and distinct report identity.
- One Catsights Desktop test rendered these exact attempt-9 report bytes, selected the loaded `tt0p9v25c` corner, displayed the native-qualified identity and design-impact unknown, and appended the exact finding reference. It launched one Electron/Host and no SSH, EDA or model request.

### E4 — PASS

- `hima-library-rule-result/1` records `no-mutation-recommended` in the private workspace.
- `hima-library-analysis-proposal/1` binds the report input SHA, rule-result output SHA, exact executed `library-stages.py` SHA, versioned rule id, applicability, input/output budget, unknowns and independent-validation recommendation.
- `writeAuthorization=none`; `mutations=[]`. The proposal cannot edit a golden/baseline/candidate Library, PDK, vendor installation, license selection, Pack, Harness or Judge rule.

Issue #49 therefore reaches **PASS** for its declared E1–E4 vertical-slice contract. It does not establish full-corpus Library analysis, a candidate revision delta, design impact, Library release approval or business value.

## #57 results

The same real Library task exercised the current carriers and the new fail-closed boundaries:

- A pre-Job Campaign summary became stale after the one qualification Job finished. Fresh authority listed the finished Job; restart retained exactly one `qualify-api` launch.
- A refreshed summary became stale after an authenticated human hold. New work was refused while held; explicit human continue was required.
- Work Memory now binds both the record cursor and a Host-minted identity of mutable Run-row authority. A row-only status/node/budget/meter/control change cannot remain `current`.
- Native Session memory canonicalizes workspace realpaths, binds the retained transcript prefix and current surface identity, and keeps raw prefix identity through `/compact`. Reopening and restarting derives the actual compact checkpoint.
- The real `deepseek-official/deepseek-flash` child produced candidate output. `result-observed` retained bounded text/content, output SHA-256 `a7a4b680d42c265a94ddd9490dc1ace7d5430aa80e204db78c956bb3eb086aff`, exact contract reference, completed turn, unknowns and evidence without copying the complete transcript. Restart preserved both this handoff and 27 native child events.
- Experience correction `run-a1a58ed5-3776-450e-a5a3-cde6f7abe157#000081` disabled over-generalization of the exact archived experience. The original archive remains; no evidence is deleted.
- A different workspace was refused before memory access. Low-level history without authenticated project identity is explicit-review-only and never automatically adopted.
- Attempt 9 used ten product-model request steps. API requests, tokens and spend are unavailable from the provider and are marked unmeasured.

Issue #57 therefore reaches **PASS** for the bounded compact/reopen/restart/correction/child-handoff/workspace-isolation contract. Work Memory remains a derived reading aid; it never authorizes continuation.

## Non-terminal attempts retained

1. [Attempt 1](wave2-library-attempt1/failure.json) stopped before Host/model/EDA because the live script passed an absolute path where Site discovery requires a command name.
2. [Attempt 2](wave2-library-attempt2/failure.json) stopped before QuaLib after a real model turn exposed `/var` versus `/private/var` Session-workspace alias drift.
3. [Attempt 3](wave2-library-attempt3/failure.json) stopped before the first Job because the script used zero as the first-attempt allowance; inspection also exposed an unstaged E2 producer.
4. [Attempt 4](wave2-library-attempt4/failure.json) completed E1–E3, then exposed the same workspace-alias defect in cold child-result validation.
5. [Attempt 5](wave2-library-attempt5/failure.json) retained the real child handoff, then the script incorrectly asked an already completed/offline child to save new Work Memory. The product refused; the acceptance was corrected to use the durable Ledger handoff plus native transcript.
6. [Attempt 6](wave2-library-attempt6/evidence.json) passed its implemented representative-control path, but independent Sol review rejected it as terminal E2 evidence because the facts carried only `valueCount + first sample`, not the frozen axes/shape/full-values contract. It was not used to close #49. Version `0.3.1` and attempt 7 add the explicit analysis manifest and full 7×7 native table.
7. [Attempt 7](wave2-library-attempt7/evidence.json) added the explicit manifest and full 7×7 table, but independent Sol review rejected it as terminal because the Reader validated structure/hash without comparing every native value back to `queryEvidence`. Version `0.3.2` adds that comparison and a changed-value-plus-recomputed-hash refusal.
8. [Attempt 8](wave2-library-attempt8/failure.json) stopped before any QuaLib Job on a bounded DeepSeek provider timeout. Site mode and clients remained clean. Attempt 9 is the current-method terminal run.

No failed result is counted as PASS. Earlier model request counts/tokens are unmeasured. Remote failed workspaces remain read-only retained evidence; no deletion was attempted.

## Verification and cost boundary

- L0: build, typecheck, unit 14/14, seam and boundary checks passed.
- L1/L2: Library/Insight 20/20; durable memory/delegation/knowledge 28/28; dedicated Experience set 24/24.
- L3: `remaining-ui.desktop.test.ts` 1/1 on Catsights with the exact attempt-9 report; the preceding fixture failures are not passes.
- L4: attempt 9 launched 14 serial Jobs, one commercial QuaLib Job, and held its seat for 5,563 ms. Source hashes and final license/client state passed.
- L5: not run; Wave 4 owns held-out value.

Development used Terra/medium for integration, Terra/high fresh-context Pack/UI workers, and Sol/high fresh-context recovery/child-handoff audits. A final independent Sol/high review is recorded separately before closure.
That review rejected attempts 6 and 7 for progressively narrower E2 authenticity gaps, then accepted commit `e995977664814989f3b14b56ac376064a0b7b335` plus attempt 9 after the Reader bound every finite native table value back to qualification `queryEvidence`. Final finding count: no P0/P1; #49 PASS and #57 PASS.

## Release and next-wave boundary

`library-intelligence@0.3.2` remains a development Pack. It has no `VERSION.yml` and is not published as a sealed Pack release. This is intentional: Wave 3 / Issue #60 owns an independent second-author path through grill/spec/fabric/test/release, upgrade and rollback. Wave 2 does not rewrite this manually assembled development folder into that acceptance or use the current Run as a substitute for #60.
