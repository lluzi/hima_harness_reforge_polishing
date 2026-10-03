# Issue83 — the native executor receives the actual delivery contract

FL retained two rejected resident-delivery.json candidates: the executor mirrored advisory keys
`artifactPaths` / `requiredResultArtifactKind` / task identity, but omitted summary/stopReason. The
wrapper required exactly schema/outcome/summary/stopReason/artifacts and returned only
`invalid delivery candidate`. An operator supplied the hidden shape before actual delivery succeeded.
The successful engineering result and original failed journey remain evidence, not rewritten PASS.

Two tests added before the fix reproduced (1) no complete schema in the actual ACP initial prompt and
(2) the generic error for the observed candidate shape. The Site wrapper now shares one private
`DELIVERY_CANDIDATE_SCHEMA` between prompt_text and collect_delivery. Exact top-level/artifact keys,
string fields, outcome enum, hash pattern and artifact count are declared and checked; collection
still verifies actual confined files/hashes and exactly one result. Nonempty summary/kind and normalized
relative paths agree with the existing Host delivery consumer. No permissions or task lifecycle change.
Errors name missing/extra fields or the failing field and explain that candidate repair preserves
existing engineering artifacts. The prompt separates its instructions/schema from the candidate object.

Validation: 28/28 Python wrapper tests pass (11.522s); 20/20 public Host resident contracts pass
(49.877s,21 in-process Hosts,0 SSH/0 Electron). The unchanged Harness build from a5fd4043 was reused.
One scoped independent review found no actionable issue. Development Astra/High; review explicitly
requested Sol/High, exact reviewer runtime metadata unavailable. Logs/review are in
`.hima-tmp/issue83-delivery-contract/`. No real model or EDA was run for this local slice; actual
native-model adherence and deployed changed bytes remain unverified until the final bounded candidate
qualification. Do not borrow the old Run's engineering PASS as prompt-qualification evidence.

This slice changes only the Site wrapper and its tests. Deployment is deferred until the minimal
artifact-access/report chain is ready, with the existing rollback archive and serial ownership.
Rollback source: a5fd4043. The frozen field App, deployed wrapper and terminal Run are untouched.
