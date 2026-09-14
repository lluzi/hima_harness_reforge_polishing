# Validation status

Local contract tests validate the Pack shape, complete flat Site-profile materialization,
late required-binding refusal before `inputs.json`, data-dependent candidate handoff,
matched-condition rejection, and the final adoption/Fmax evidence contract. Their fixtures are
synthetic: they do not establish a vendor-tool invocation, report-format compatibility, Fmax,
PPA, or silicon results.

The required L4 checks remain separate: one read-only/current-tool report-format probe
for the target Site and one bounded model task that writes a different selection program
from fresh design evidence. L5 held-out-design acceptance belongs to PLS-35.

The Pack remains in declared `development` status, so it deliberately has no `VERSION.yml`
release seal. HimaHarness creates that file only after the authoring test and release gates; a
handwritten seal here would misrepresent this validation record as a released method.
