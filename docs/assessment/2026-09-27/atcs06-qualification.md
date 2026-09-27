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

The first real v3 prelaunch check refused vendor LEF links in the copied Innovus database. These
resolve to the configured, read-only physical-library roots. v4 adds a narrow data-only exception:
database leaf links must resolve to a regular file inside the Campaign's read-only tree or approved
read roots, and never into the writable slot. Executable/control paths still reject all links. The
failed v3 installation/snapshot remains unchanged. Two additional local counterexamples cover an
unapproved target and a target inside the writable slot; all 17 verifier tests PASS. No mutation or
new commercial command was used to diagnose this prelaunch refusal.

One additional checkpoint link points to Foundation `rc_model.bin`, already inside the Site Permit's
declared read roots. A versioned `siteCapabilities-v4.json` now mirrors that approved root in the
verifier's pinned profile; the previous profile remains unchanged. Real v4 prelaunch verification
PASS. A no-EDA, no-network container probe with identical filesystem mounts refused writes to
Campaign state, administrator data and sibling w02, while allowing a synthetic marker in w01/r2.
This is a filesystem-confinement PASS, not a worker mutation or binding PASS. Current Host contract
2/2 PASS, 41.130 seconds, zero SSH/Electron.

The first fully guarded v4 startup refused reuse of an existing private baseline save; a separate
qualification revision preserves that attempt. A real typed cell query then exposed the Pack wrapper's
incorrect string-to-attribute call: direct `atcs_query_cells` returned empty, while native
`get_attribute [get_cells <same-top-instance>] ref_name` returned the expected master. No mutation
occurred. The Pack template now resolves cell collections for queries and pre-mutation master
readback. Mutation domains and admitted sizing targets reject wildcard expansion. A native-collection
local falsifier and a wildcard-domain counterexample pass (90 adapter tests, 18 workspace tests).
v5 retains v4's reviewed isolation boundary and installs a new immutable path for the new flow bytes.

## Worker changed-surface L4 PASS — frozen candidate

Method source: `eb9d323430c067ce49b71e388edb71a428bb60a6`, remote main verified.
Pack `agentic-timing-closure-system@0.1.0` digest
`339c25d773bf0755c58b6db500bcc28be9620c5057b85bba365aeb7b33bfc8b9`.
Flow `b91195068ac13f31229547b5c613b4066e502772d67129f269a8851ff9631fb3`.
Wrapper v5 `b6210b3de57312b568755f7ea63afb06bf1a5ed87eba5ed231d41f1c766239f0`.
Verifier `86321360e9fffcba3a0dcf97ee2e2c6d972e98e51bb31124169fdb8647d1d107`.
External profile `26b99daba92494810fe53a9f82ec5f7b28d1b1336af62a5b1708214450ae0415`.

The v5 worker in `workspaces/w01/r4` reached exact READY with qualified timing/placement context.
Its typed identity/falsifier query returned the expected master. Before/after each contain 95,472
instances: exactly one master changed, zero added or removed instances, and exactly one ops trace.
One route-preserving logical/physical ECO pair was exported; normal close returned exit 0.
Contribution `6baeb439fc78f1d2963e` is admissible, kind fix, one operation, base
`5d6827db2d165d0f0b31`. Capture and collect succeeded without another mutation.

Retained remote hashes:
- before dump `6e4b8e6fd0cdae73d6a469d49905c96c0771c07bb47bb33ce102b5884830b016`;
- after dump `348d50e469d335b2c1de846d256a2a2ee5d8e0c8f87e15624596e048afcb4119`;
- ops trace `c591c702ac54ef917f6847a43dea6bd7d97894ba5b75755fc4e8f3d71174d3b6`;
- logical ECO `6f8d3bfb248eab1f57b261310054ebf4260beb50789d587539211ddace8cf599`;
- physical ECO `852b8e588a1eff2470ebdae8f83db86342aa835cb938341ae43534749e354cd2`;
- transcript `d387a9d52c1894dd35b7cc4ab135087382d3230905ae11abb528e5f7d01f1910`.

A v5 zero-EDA container probe denied source-tree and /usr/bin execution-write attempts, state and
sibling writes, and allowed only a marker in the selected slot. The frozen Harness binding bridge
then verified the actual remote wrapper and current Pack/source/Permit as confinement enforced.
Binding `linglong-atcs28:xtop-operator-v5:339c25d773bf0755`, SHA
`139057998653a2933a9620a9edba8da58f7b9bcfa6cc8ae53ab0997e1135c855`; environment SHA
`bf938c79d3338b1bb620e3438f911ecb5bbdc1b962859cb445f1445f3dd83dd0`.
Both are retained under `.hima-tmp/atcs06-eb9d3234/`, outside the production write root.

The binding preflight first correctly refused a missing administrator Permit read root. The Permit
now grants only the current immutable atcs-v5 directory read access; no administrator write root
was added. The packaging helper's control-Pack-only preflight rejected ATCS and is not counted PASS.

This checkpoint satisfies the coordinator's worker changed-surface gate. Replay, one joint physical
refresh, native TEST/seal/App and the actual bounded Campaign remain pending. No QoR or signoff is
claimed; the XTop diagnostic slack values are not commercial final-STA evidence. #52's generic
Agent Team/Harness and unchanged UI/App boundaries are reused only within their demonstrated scope.
