# Finite AES timing-motif selection method

This Pack consumes the formal AES probe handoff described in
`docs/validation/pls-frontier/probe-handoff.md`. The Site stages its customer sample separately;
the Pack contains no customer sample, candidate ids, oracle, or expected answer.

The declared objective is a finite analysis: choose at most the sample budget of candidate ids.
For a valid selection, the independent reader derives each candidate's score as
`len(cells) * number of unique occurrence.path values`. A physical cell may appear in only one
selected candidate. The reader counts reused physical cells, so a nonzero count is an actual
constraint failure with retained evidence, not a reason to erase a result.

Revision 0 is a reference stage. Copy and execute the Site-supplied `baseline.py` unchanged using
the same arguments as this Workshop. It ranks raw unique occurrence-path frequency descending,
then id ascending. This establishes a measured reference only; it is not an AI novelty claim and
does not establish timing improvement, Fmax, silicon behavior, or complete DTCO value.

If the actual reader and Judge report a constraint failure, revision 1 must write a new
data-dependent algorithm using the declared sample and that feedback. It must emit only
`sampleSha256` and `selected`. Never use an oracle or unstaged data, report a score as authority,
lower the Goal, or claim significance beyond this finite source-linked sample. Candidate cells,
masters, occurrence paths, and sourceLine fields are provenance for this analysis; they do not
authorize extrapolation beyond the handoff scope.
