# PLS-23 → 08 → 09 → 25, with PLS-24

Implementation in progress from `main@f8a2a3d`. Issues remain open until their actual gates pass.
Two reference checkouts remain read-only. Initial account weekly usage: 61%; account usage is shared.

## PLS-23 admission and local method

Linglong SSH, AES RTL, foundry DB/Liberty, wrapper and relevant input files were freshly read and
hashed; see `site-inputs.json`. No active dc_shell/Innovus process appeared in the initial process
probe. This establishes presence, not a current licensed tool run. `site-staging.json` records only
the newly created isolated polishing flow directory. Old reference trees and prior Campaigns were
not changed. Real run budget: at most two synthesis trials, one concurrent Job, eight tool cores,
600-second tool deadline; a separate native model author phase launches no EDA.

V4 Flash authored INTENT/SPEC/compiled method through the installed native author workspace.
`aes-author-1/evidence.json` retains a **failed validation-driver assertion**: it required exactly
`specified` after the model had already reached `compiled`. See `author-checkpoint-audit.json` for
the original compiled observation and original method file hashes. This is not a rerun or a rewrite
of the failed result. Pre-test engineering corrections tightened period identity and corrected
unsupported universal zero-slack / guaranteed-achievable-period language. The latter originated in
the bundled knowledge and was corrected there as well as in this Pack.

`aes-host-3.tap.gz`: 5/5 local tests, 3 real in-process Hosts, 0 Electron, 0 SSH, 11.838 seconds.
Measurements in these local tests are **synthetic**, testing the real Pack/reader/Host/Job boundaries.
Earlier red/failed outputs are retained beside it. Runtime tests check explicit ownership,
Goal-met versus budget endings, failed tools producing no observation, and invalid/changed reports.
No local result claims real AES Fmax, model research contribution or complete DTCO.

PLS-23 real Site execution, test/release, desktop observation, PLS-08 handoff, PLS-09 algorithm
research and PLS-25 full mining remain pending at this checkpoint. PLS-24 is developed separately
with one Terra/Medium worker and one Sol/High independent reviewer; integration is pending review.

## First real Site trial: retained failure

`aes-execute-1/evidence.json` records the actual V4 Flash owner Run
`run-5c951580-2ca6-4821-9626-1758090cf31e`: one real DC synthesis (89.793 s), followed by
one reader Job which failed on an empty area field. No observation/Judge success was fabricated.
The X-2025.06-SP3 log explicitly reports UID-101: `area` does not exist on current_design.
The original QoR contains Cell Area 8667.161987, so the Tcl producer now extracts that unique
reported field. It also retains the precise measured slack: the failed trial's query gave
-0.000969827 ns even though the rounded QoR critical slack prints 0.00. Rounded zero is not closure.
Raw data is retained privately under `.hima-tmp/pls-frontier/first-site-artifacts`, with hashes in
that Run's remote manifest. No library files or full customer design inputs are added to the Pack.
The previous Run and its failed reader are unchanged; the corrected method needs a new test Run.

Current probe test/release, real negative measurements, same-screen inspection and executable finite analysis handoff are documented in [probe-handoff.md](probe-handoff.md). PLS-23/08 remain pending integration review at this checkpoint.
