# Issue 52 native delegated-input boundary

Scope: generic input delivery only; no ATCS work, new Runtime, scheduler or storage.
Source baseline: `f22df72ec606272690039a8c9967795b89db0dc1`.

## Reproduction and correction

The real registered `hima_delegation_input` tool was executed with a recorded native child
in an isolated local Host. A 56,153-byte retained JSON observation contained an endpoint
sentinel between two large provenance fields. Before the fix, native content was 49,999
bytes: the sentinel vanished, `material.truncated:false` survived, and a spill notice appeared.
This was not a direct Host-object-only test and used zero model, SSH, Desktop or EDA calls.

The downstream owner is DSH `spill-policy`'s `tools/post-execute`, configured by the pinned
`dsh-base` profile with `maxInlineBytes: 50000`. Its head/tail preview can preserve valid
JSON syntax while dropping middle facts. Hima's old 65,536-character payload limit did
not account for the native byte ceiling or the full serialized envelope.

`index.ts:delegationInput` now bounds the entire JSON envelope to 40,000 UTF-8 bytes.
Small complete material is delivered; JSON compacting remains available. If report material
still does not fit, it is omitted as a whole with `truncated:true`, `returnedBytes:0` and
an explicit reason, retaining typed reader values, source content SHA-256 and source bytes.
Oversized non-observation envelopes are explicitly unavailable. Source evidence is unchanged;
projection identity is not represented as the source content hash.

## Focused verification

- RED: native sentinel lost while completeness claimed; 1.79 seconds in independent run.
- GREEN: same source, 757-byte valid native JSON, honest truncation, no spill.
- Native-input/delegation/prompt tests: 5/5 PASS.
- XTop Pack subset: 7/7 PASS (includes Python contracts and old-Pack compatibility).
- Harness build, seam check and boundary check: PASS.

Commands: `node --test test/contract/delegation-input-native.host.test.ts
test/contract/delegation-run.host.test.ts test/contract/delegation-prompt.test.ts`;
`node --test test/contract/xtop-timing-closure.test.ts`.

## Limits and next gate

This changes neither retained source evidence nor result-admission rules and makes no full-report
delivery promise for oversized material. A child must acknowledge omitted material rather
than infer endpoint facts from unavailable data. A deployment lowering DSH's native ceiling
below Hima's bound needs independent qualification.

Independent native reproduction/review uses Sol/High; isolated model check is assigned to
Terra/High. Development token counts are not measured. One Flash qualification using the
current honest native projection is the next gate. Phase A binding/TEST/seal/App and GUI
acceptance are not yet claimed. Historical Attempt 4 and retained TEST Runs remain untouched.

## Current isolated qualification blocker

After the user's model update, remaining qualification work uses GPT-6 Sol / Medium.
The single allowed Flash operation consumed both inputs through current native tools and
completed one turn, but the driver had copied only the Pack task template into a manual
delegation, omitting its result-schema id. The output used `closure-hypotheses/1` instead of
`xtop-timing-research/1`, so the diagnostic correctly failed. This is a qualification-driver
context defect, not evidence that the production Pack recipe materializer or JSON gate failed.

Owning file: `scripts/qualify-xtop-researcher.ts`. The minimal correction is to derive the
explicit schema id and required fields from the current Pack member declaration. No further
model operation was launched after this failure. Fresh local Run and native child evidence
remain preserved, separate from historical source provenance and native TEST Runs.

Failure receipt:
`.hima-tmp/issue52-researcher-current-projection-sol-20260927/receipt.json`.
Child: `hima-child-523d2c6649f1a9a2b2bda1b272eedb46`.
Next minimal gate: one fresh isolated qualification with the corrected declared schema
instruction and the same honest input projection; only then continue Phase A.
No new commercial baseline, tool qualification, binding, seal, App or Claude trial is claimed.
