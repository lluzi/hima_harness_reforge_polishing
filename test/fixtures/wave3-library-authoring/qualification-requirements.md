# Qualification requirements for the authoring subject

The input carries exactly one representative source identity and one local
authoring-qualification result. The checked values are:

- `sourceSha256`: a 64-character SHA-256 identity;
- `qualification`: the literal `authoring-qualification`;
- `reportSchema`: `hima-library-insight-report/1`;
- `provenance`: a non-empty source description; and
- `unknowns`: an explicit non-empty list.

Missing, malformed or additional opaque success values are not a qualified
measurement. They are a Reader refusal/unknown. A true checked count of one is
not permission to infer Library API, PVT, revision, design impact, quality or
customer value.

The author must preserve the distinction between a valid zero-or-greater
constraint reading and the requested success target: `library-contract-nonnegative`
checks `library_contract_ready >= 0 count`; `library-contract-goal` checks the
same value against the bound goal `1 count`. They are ordered constraint then
goal. A chooser records `goalMet` only for PASS/PASS after an explicit Explore
completion. Any FAIL or unknown stops at the declared wait/refusal path; a
running or paused Run is not TEST evidence.

The only strategy carrier is `inputFixture`: a one-option choice
`library-input.json`, defaulting to that same value and bound into the analyze
node as `INPUT_FIXTURE`. Its purpose is to make the sole declared input explicit
to the Run graph, not to permit alternative input selection or retry strategy.
