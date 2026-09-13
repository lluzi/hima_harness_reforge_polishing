## Goal template

`minimum_score` is a count in 1..10000. `algorithmRevision` is an integer count in 0..1. A live
request may set a score of 21; candidate count is never a Pack precondition.

## Constraints

Selected ids are unique and known, do not exceed sample budget, and do not reuse physical cells.

## Run contract

Engineering-authored v1. The Pack requires a Site `flowRoot` holding `sample.json`, `baseline.py`,
and `prepare.py`, plus `workspaceRoot`. It runs `prepare` as `/usr/bin/python3
${WORKSPACE}/flow/prepare.py ${WORKSPACE}`. Workshop `analyze` uses private code directory
`research/selection`, entry `entry.py`, language `python`, and argv `/usr/bin/python3 ${ENTRY}
${WORKSPACE} ${REVISION}`.

The Workshop reads the declared selection output and method knowledge. It produces
`selection.json`, exactly `{sampleSha256, selected}`. The reader rejects malformed
JSON, mismatched sample hashes, unknown or duplicate ids, over-budget selections, invalid candidate
structure, and invalid occurrence references without emitting evidence.

## Semantics

`selection_score`, `selected_count`, and `conflict_count` are reader-derived counts.

## Judge rules

Conflict is judged before the minimum-score Goal.

## Choosers

`selection-repair` binds numeric `repairRevision: 1`; only both PASS produce goalMet.

## Endings

`prepare → analyze → read-selection → judge → refine → analyze`. Judge orders conflict count first,
then score goal. The one global `blocked` wait handles structural refusal, tool failure, cancellation,
or exhausted retries. `selection-repair` chooses goalMet only on both PASS; otherwise it chooses
`algorithmRevision: 1`. `generationLimit: 2` bounds the revisit.

## Workshops

The owner writes scoped Python and requests the real Job. Revision 0 executes the reference; only
revision 1 is an algorithm-correction opportunity.

## Knowledge

`selection-method.md` defines the finite source/provenance and significance limits.

## Limits

The Pack neither writes Judge verdicts nor treats model wording or reported scores as evidence. It
does not claim V4 authored this Pack, a full AES optimization, Fmax improvement, or significance
beyond the staged finite sample.
