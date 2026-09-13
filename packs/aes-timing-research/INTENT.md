## Business

This companion Pack performs a finite, source-linked AES timing-motif selection study. It is a
local research Goal (`minimum_score`), not an Fmax claim. It consumes the validated finite analysis
route from `docs/validation/pls-frontier/probe-handoff.md`; PLS-25 may later integrate this work
into the full AES business.

Each generation changes only `algorithmRevision` (0 or 1). The selection contains candidate ids
only. The reader independently verifies the sample hash, schema, candidate ids, budget, occurrence
references, score, and shared physical-cell conflicts. A conflict is constraint FAIL with retained
evidence. Goal PASS requires both zero conflicts and score at least `minimum_score`.

Revision 0 establishes the actual raw-frequency reference by copying and executing the staged
baseline unchanged. Revision 1 is reserved for agent-authored, data-dependent correction after
actual feedback. A two-generation limit bounds the work; exhausting it is not a success claim.

## Golden Flow

The Site stages `sample.json`, `baseline.py`, and `prepare.py` from the validated AES probe handoff.
They are copied into the Campaign workspace. The customer sample and independent oracle remain
outside this Pack and Git. The only required executable is `/usr/bin/python3`; no EDA licence is
required for this finite study.

## Answers

The reader is authoritative for score, cardinality, and overlap. Revision 0 is a measured reference
stage; revision 1 is the bounded correction stage after evidence.

## Ambiguities resolved

Candidate count is data, not a Pack precondition. The staged sample's budget and provenance fields
determine valid selections at runtime.

## Knowledge applied

`knowledge/selection-method.md` records the finite-sample scope and keeps customer input and oracle
outside the Pack.
