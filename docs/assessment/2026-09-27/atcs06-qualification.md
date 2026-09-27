# ATCS-06 changed-surface qualification

Starting main: `3c8b99a8f1b4ce65a97869f3e4cc63890ab23cf2`.
Initial Pack digest: `2049e990d132d54dca86a367d7e41199d696f51e127a996e768aa3d0cc02ee93`.
Initial flow digest: `49bfccbd16b434acb5439298ec16c79c26a742a7a6a7b7000b0ebc75b2cdfe64`.
Wrapper source template: `e346a949a4fc00424724446e1e491e5c0637fae3b7ca299ba74ce70de5aabc50`.

Read-only precheck: linglong license `selected=old old=active new=inactive`; no active
QuaLib/XTop/Innovus/PT/StarRC process. No license switch was needed. Exact qualified image available:
`localhost/edarunner@sha256:8467102dbae851e4136e998661ae3a01ad9b65d49711c82f2b0883ab8d1bbb8c`.

Before any commercial command, two deterministic ATCS-owned defects were reproduced by source
inspection and local tests: READY had a suffix rejected by the frozen Harness exact-line parser;
flow identity included generated Python import caches. The template now emits the exact READY
line, and the flow helper excludes only Python caches. CLI tests 113 run / 7 skipped PASS;
adapter tests 89/89 PASS. Harness source and #52 evidence remain unchanged.

`scripts/qualify-atcs-context.py` prepares one isolated baseline and sealed timing context using
fixed Site inputs and the current ATCS CLI. Its logs and all design bytes stay in the qualification
workspace on the Site. Subsequent gates must record identities and truthful failure/PASS boundaries.
No real-tool or Campaign PASS is claimed by this initial static checkpoint.
