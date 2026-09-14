# Validation status

Local contract tests validate the Pack shape, its Site-bound inputs, data-dependent
candidate handoff, matched-condition rejection, and the final adoption/Fmax evidence
requirements. Their fixtures are synthetic and do not establish tool behavior, Fmax,
PPA, or silicon results.

The required L4 checks remain separate: one read-only/current-tool report-format probe
for the target Site and one bounded model task that writes a different selection program
from fresh design evidence. L5 held-out-design acceptance belongs to PLS-35.
