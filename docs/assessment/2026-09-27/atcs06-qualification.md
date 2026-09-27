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

## Changed-surface progress and v2 refusal

Fixed static checkpoint: `be7c8a7e03890dd4700ff3c6b21e284f05d45fdf`, pushed and remote SHA verified.
Pack digest `a074819341f2cb29dbe55bb91051b3e070e9c2006f0e173d70690ad804bb14fc`;
flow digest `6cb6398adc1ec371e504ec22c2c2dfa6a44005ee6628ca773c6028a867d8bc6d`.
One isolated server root: `/data/eda/project/hima_harness/atcs-runs/qual-be7c8a7e-20260927`.

Real baseline staging and four-scenario PT observation PASS. The sealed XTop context is
`d291f761e8199d4a293d`, bound to design state `5d6827db2d165d0f0b31`. XTop
`2025.09.tmp15` loaded all four scenarios, checked physical/timing libraries without issues,
and reported 100.0% pin / 99.9% net timing annotation. These percentages are loading diagnostics,
not a timing-closure or signoff claim.

First worker query refused: the qualification selector chose a short instance name inside a child
Verilog module. Its base-master falsifier failed, so no mutation occurred. The qualification helper
now selects a non-clock buffer from the declared top module and preserves each attempt's inputs.
Both real sessions closed normally. No ops.jsonl was created and no mutation was run.

Retained remote transcripts:
- `xtop_log_1.txt`: `8814f6cadf0f0d84d3d6dfb5d0b5cf85cf4620cd816f9440a1adfa47ed7e47d5`.
- `xtop_log_2.txt`: `bc51386d27b7ed0dad217c5087c45716fa19d4bd27853ae37ddec4324c383bec`.

v2 confinement is NOT PASS. Independent read-only GPT-6 Sol / Medium review identified executable
workspace imports before hash verification, self-authenticated Tcl, path escapes and writable sibling
scope. v3 repairs these at the Site boundary: standard-library verification before imports, fresh
verified source snapshot without bytecode, exact Tcl regeneration, pinned external profile,
symlink/hardlink and base-in-slot refusal, slot-only writable mount and fresh HOME without login
profiles. All 15 local adversarial tests PASS; independent incremental review found no unresolved
defect in those boundaries. Real v3 wrapper/mount qualification remains a separate gate.
Current ATCS Host contract 2/2 PASS, 38.766 seconds, zero SSH/Electron, including the Pack Python suite.
