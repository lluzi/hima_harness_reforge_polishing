# Wave 1 hard-gate implementation receipt

Date: 2026-09-25. Authority: [issue-closure-plan.md](issue-closure-plan.md).

Wave 1 reached its declared completion boundary on 2026-09-25. This receipt does not turn local
tests, a started child, or a valid negative result into PASS.

## Lane A — #44 continuous DTCO commercial exit: PASS

Run `run-9bb8ec08-9014-41c4-a563-745c1ec19506`, Pack digest
`7b4a59be2a412d0052601b3384e5a2be35d2664c0ea7094206699f6e020fcbff`, completed one
continuous Fabric path through `compile -> read-compile -> foundry-synth -> read-foundry-synth`.
The immutable receipt is [verification.json](wave1-dtco-exit-attempt3/verification.json).

- Library Compiler and Design Compiler Jobs both exited 0.
- The actual DC log named by `flow/records/foundry-synth.json` contains zero
  `Error: File is not a DB file. (DB-1)` entries. A broader first verifier incorrectly counted the
  `command.log` diagnostic dictionary line `#@ DB-1`; the read-only post-verifier fixed only that
  query and did not rerun EDA.
- `read-compile` and `read-foundry-synth` observations belong to the same Run and follow their exact
  launched/finished Job identities.
- The generated netlist is 926,143 bytes, SHA-256
  `8aa6056ccf5a9096eddd1c73c52bea661fad001b36e595fd520087e37a5cf39d`.
- The Site input was a new private profile derived from the retained 40-per-generation/320-cumulative
  profile and added the exact TSMC28 `110a` CDL release label and SHA-256. The earlier profile stayed
  unchanged.

Retained negative attempts:

1. `wave1-dtco-exit-attempt1` stopped at `bind-inputs` because the old profile had a CDL path but no
   `FOUNDRY_CDL_SHA256`/release identity.
2. `wave1-dtco-exit-attempt2` reached real research but found that the shipped
   `tools/read-stage.py` lagged the byte-identical flow Reader's `generation_feedback` schema.
   Synchronizing those existing Pack copies and asserting byte identity was the smallest fix.

This PASS is the #44 commercial-exit gate only. It is not a PPA, signoff, route, or full-Campaign
claim.

## Lane B — #49 E1 actual Pack-to-Host qualification: PASS

Run `run-c700d636-f7c1-4f87-ba95-914fa228f43d`,
`library-intelligence@0.2.0`, Pack digest
`288aecf91d6bdb63068fbc27cc99979e9fecb8d25649c1f85d28c981f0774a48`, completed
`qualify-api -> read-qualification -> qualification-gate`. The machine-readable evidence and native
receipt are [evidence.json](wave1-library-e1-attempt4/evidence.json) and
[receipt.json](wave1-library-e1-attempt4/receipt.json).

- Host loaded the same Permit identity named by the Site-owned manifest, pinned Python/API/native
  libraries/current Pack worker and resolved `edarun` bytes.
- One durable Host Job held exactly `QuaLib-2026-new-59099`, exited 0, and has a matching successful
  finish record. `selected=new`; no XTop or external QuaLib client overlapped.
- Vendor fixture, SAED14 and TSMC28 each passed read/query/workspace-copy/re-read and invariant
  comparison; source hashes before and after are identical.
- Reader emitted `library_qualification_ok=1`; Judge outcome is PASS.

The first launched attempt exposed that the Pack declared a workspace-local worker argv but staged no
worker. `workspace.copy: [tools]` plus a byte-identical `flow/tools/libapi_worker.py` fixed that
existing Pack boundary. A later input-only negative attempt used `3.7.12` where the frozen manifest
contract requires `3.7`; it correctly blocked before native parsing. Neither failure was rewritten.

E1 PASS opens Wave 2. It does not claim E2 facts, E3 reports, E4 proposals, corpus coverage, Library
quality, or design impact. Issue #49 therefore remains open.

## Lane C — #56 Guide and #58 real team

### #56 Guide: PASS

[Wave 1 real-model evidence](wave1-guide-team-attempt5/evidence.json) records a real
`deepseek-official/deepseek-flash` Guide, a distinct Campaign owner, sourced Run explanation,
continued Guide responsiveness, project-scoped child inspection, and accepted human pause/continue
receipts without ownership transfer. Existing L2/L3 contracts cover stale address/late response,
cross-workspace refusal and the visible child/control surfaces.

### #58 non-Operator team gate: PASS

The same bounded local Run records six real model sessions and 23 model request steps:

- independent Coding and Researcher children with different effective tools and a guarded private
  coding root;
- an independent Reviewer that received only the exact observed child result records;
- one parent elapsed-time budget with explicit child shares;
- persisted child session events, candidate result records, scoped cancellation, and no owner change;
- a new idempotent `hima_delegate adopt` receipt by the declared Run owner. Adoption records the exact
  observed candidate; it does not manufacture a Judge verdict or Campaign fact.

API request count, tokens and spend remain unmeasured because the pinned provider surface does not
expose them. This task used no EDA or commercial licence.

### #58 production Operator delegation: PASS

The product now admits `role=operator` only when Host revalidates one exact production-qualified
interactive Run/node/execution/binding. The child receives only `hima_interactive`; raw shell,
terminal, generic file writes, recursive delegation and owner authority remain unavailable. Every
interactive call re-reads current epoch/revision, holds, single-writer state and the binding digest.

The [production Operator evidence](wave1-operator-delegation/evidence.json) records Run
`run-4c67be31-5f01-46b5-b826-3a4a229a0cbf`, Pack digest
`19207d78dc3b1e9f4fd80f6bd4c21df209f1dfffc5f83fa7afd3ac5c96fd2a92`, and real child
`hima-child-44eed1557dcc3d1d3cc89a6276e01d56`. The Host grant is production (`testOnly=false`) and binds
exactly `run-xtop-fix` execution `execution-13c8d2de-be8f-42c0-9a1e-73f3fc41fe94` to binding digest
`4e162cfa79b447b6f25a207b863046a5f1461b3f1fdc07f21121ec4fbb7a390d`.

The real DeepSeek Operator child used only `hima_interactive` and completed typed identity, setup and
hold summaries, one high-effort hold fix, candidate save and normal close. The Run owner adopted
exact result record `#000098` through adoption record `#000099`; `read-xtop` accepted observation
`#000104`. The bounded Run then cancelled at `apply-eco`: this acceptance intentionally did not
repeat the downstream commercial chain already closed by J3. The post-run rollback is retained in
[rollback.json](wave1-operator-delegation/rollback.json): `selected=new`, old inactive, new active,
zero XTop/QuaLib clients and zero retained Operator containers.

Issue #58 and Wave 1 are therefore terminal **PASS**. This is a capability/authority result, not a
new PPA, timing-cleanliness, physical-cleanliness or business-value result.

## Local verification and rollback

Focused build/typecheck and 47 Pack/delegation/interactive contracts passed with zero SSH in the test
runner. Additional Guide/session/interactive focused coverage passed 13/13, and the native Workbench
child/transcript/stale-response Desktop path passed 1/1. The live lanes are the separate L4/real-model
evidence above.

Rollback is by reverting the Wave 1 implementation commits. That removes Operator delegation,
explicit child-result adoption, the two Pack staging/Reader corrections and live-check scripts. It
does not delete retained Runs, remote workspaces, source Libraries, historical failed attempts or
user-owned `tmp/`.
