# E1–E4 bounded Library Intelligence contract

## E1 qualification

`qualificationManifest` is a Site-owned JSON file with schema `hima-library-qualification-input/1`. It names `/usr/local/bin/edarun` with its resolved path and SHA-256, the Python path/version/hash, API root/build label, hashes of `tmlib.py`, `_tmlib.so`, and `lib/libparser_wrapper.so`, the worker hash, the loaded Permit path/hash, the exact QuaLib 2026 new/59099 selection, and exactly one source of each role `vendor-fixture`, `saed14`, `tsmc28` with an expected SHA-256. Paths are absolute plain files under the Host-loaded Permit read roots.

At prelaunch, the Host writes `<workspace>/hima-library-host-attestation.json`, binding the admitted Run, node, attempt and Job session. The worker requires that exact path and executes Permit/path check, runtime identity, source hash, native read/query, workspace copy, re-read/invariant comparison, and source hash after. The Reader rejects relocation, replay against another launch identity, or a receipt/attestation mismatch. Before `library_qualification_ok=1` enters an Observation, Fabric matches the receipt to a launched and successfully finished `qualify-api` Job in the same Run.

Exit 139, a signal, missing child result, identity mismatch, or copy mismatch blocks the receipt. No partial facts are emitted. One result remains for every declared input; later inputs are explicitly `not-run` after a blocker. A higher same-Run/node attempt may replace an attestation only while no qualification output exists. Retained output blocks in-place retry and requires a new Campaign workspace.

The `permitSha256` field must equal the exact Permit bytes retained by `loadSite`; a manifest claim cannot replace that identity. `apiBuild` is a Site label supported by the three API hashes, not a vendor-authenticated build proof. The tool claims `QuaLib-2026-new-59099: 1`, and the Host admits it only on a one-Job Site. The Site cap prevents overlap with Hima-managed XTop Jobs in both launch orders; external processes remain an L4 operator precheck. The actual Pack-to-Host E1 result is retained in the Wave 1 receipt. A new method version still needs its own bounded Site test.

## E2 facts and comparable control

E2 consumes only a complete passed E1 receipt and a Site-owned `hima-library-analysis-input/1` manifest. The manifest names baseline/candidate qualification roles, expected source hashes, family, corner and view; the Reader re-opens and hashes it independently. Version `0.3.1` intentionally selects the exact qualified TSMC28 source for both positions. The two records separately identify baseline/candidate position while preserving the same source role/hash and declared comparable conditions. Explicit area and one complete native NLDM table retain model, result unit/scale, variables, axis units/scales/indexes, shape and every finite value. PVT, function, drive, VT, logical family, `when` and unobserved Cells remain typed unknowns. Coverage states one observed Cell against the API-reported Cell count and never calls partial coverage complete.

The delta is admissible only when both facts records, source hash, family/corner/view fields and source-linked qualification identities match. Its area delta is an explicit finite zero. Matching the same source proves a control path, not equivalence between revisions. The Reader independently re-reads the E1 receipt, source, baseline, candidate and delta and rejects a self-consistent JSON rewrite that changes unknowns, conditions, identities or the zero control.

## E3 report

The producer document is strict `hima-library-insight-report/1` with `evidenceClass: native-qualified`. It contains one Library-health control finding, separate Library severity/design relevance, units, provenance, unknowns, ranking reason and next action. It deliberately has no report envelope: the Host adds immutable report ref/version/source record/SHA-256 from the Observation. Loaded filtering is read-only. A recalculation must run a new controlled task and publish another record identity rather than overwrite this report.

## E4 result and proposal

The selected `same-source-zero-delta-result@1` algorithm is the exact staged `library-stages.py` bytes actually invoked by the graph. It emits `hima-library-rule-result/1` in the private workspace with an explicit report input ref and no mutation. The proposal binds that report input and result output, algorithm path/hash, applicability, budget and unknowns. It requires independent matched-candidate validation and carries `writeAuthorization: none` plus an empty mutation list.

The Reader re-opens all referenced artifacts and algorithm bytes before emitting availability. The proposal is evidence for review, never release or write authority. None of E2–E4 modifies a golden/baseline/candidate Library, PDK, vendor API, license selection, released Pack, Harness code, or Judge rule.
