# #52 hard-frontier implementation tranche

Date: 2026-09-24. Source baseline: `dde8025a10348e5d7bb18a25eaa3ec0b5635ed27`.

This tranche advances three previously open qualification boundaries without restarting a
Desktop trial or a commercial EDA Campaign. It changes existing Pack, Fabric, Job-history and
Reader seams only. It adds no scheduler, licence daemon, memory service or second execution path.

## Library E1 Host admission

`library-intelligence@0.2.0` now has one runnable `qualify-api` node. The ordinary Fabric
`beforeLaunch` boundary verifies the exact Host-loaded Permit bytes, Site-bound Python, nested API
and source read roots, private Campaign workspace, resolved and permitted `edarun` executable
identity, and the `QuaLib-2026-new-59099` resource claim. It writes launch identity for transport to
the fixed workspace attestation path. The file is not an independent trust root: a positive Reader
result is admitted only when the same Run contains matching durable `launched` and later successful
`finished` Job records for the same node, attempt and session.

The one-Job Site rule prevents overlap in both orders for Hima-managed Library and XTop Jobs. It
does not detect an external process, and the Pack documentation says so. A retry may replace only a
same-Run/node pre-dispatch attestation with a strictly higher attempt; retained qualification output
blocks an in-place retry rather than silently reusing evidence.

Focused local evidence: Library contract 15/15, including forged Permit with zero Jobs, wrong Python
with zero Jobs, wrapper-target refusal, forged positive receipt with no durable Job, attestation
relocation/tamper, retry handling, and both managed launch orders. This is orchestration and Host
admission evidence. The remaining E1 gate is one actual Pack-to-Host run on linglong under
`selected=new` / port 59099 with no external XTop client, repeating the retained vendor-fixture,
SAED14 and TSMC28 read/query/copy/re-read checks.

## DTCO continuous-chain readiness

`custom-cell-fmax-dtco@5.2.14` now requires a release label and SHA-256 for `FOUNDRY_CDL` before it
writes `flow/inputs.json`. The Fabric and shipped authoring copies of `bind-inputs.py` are identical.
The TSMC28 L4-shaped fixture records the already demonstrated 40 new Cells per generation and
320 cumulative Cells for eight generations; 160 is rejected. The Pack-wide 50/400 reference profile
is unchanged.

The graph already contains `compile -> read-compile -> foundry-synth`. This tranche closes the
input-admission gap; it does not claim the continuous commercial chain ran. Focused evidence is
26/26 for the Pack contract and 15/15 for method assets. The remaining gate is a single Fabric Run
through those nodes with the Site-owned hash-bound CDL and 40/320 profile, checking DC exit 0,
nonempty netlist and no DB-1 diagnostics.

## XTop result adoption

The XTop closure comparator now requires every candidate DB, STA report root and file, SPEF,
physical DRC/connectivity report, and physical completion manifest to resolve under the candidate's
declared `gNNN` directory. It rejects a candidate that relabels an earlier generation's intact
evidence. It also rejects linked `flow/iterations` or generation directories before path resolution;
an independent tester demonstrated that resolving the link first would otherwise turn `g002 ->
g001` into an accepted generation-2 database.

Focused evidence is 31/31 Python closure tests and 3/3 XTop Pack contracts. The remaining S03/#55
gate is the fresh XTop -> Innovus -> StarRC -> PrimeTime chain using actual complete same-scope DRC,
connectivity, timing and constraint evidence. The retained 72,799 DRC and 3,465 connectivity counts
remain relative-baseline evidence, not clean signoff.

## Boundaries retained

- No commercial EDA or model was launched and no Empyrean licence selection changed in this tranche.
- Interactive XTop mutation remains unavailable; the production confinement gate in #50 is unchanged.
- E2-E4 Library facts and analysis, a positive matched PPA result, and customer-value J3 remain open.
- The final local regression passed 648/648, with 0 failures, 0 skips, 0 Electron launches and
  0 SSH subprocess attempts. It covered 95 local contract files in 1,107.743 seconds. Desktop and
  live-Site groups were not run. App packaging and a later human trial are delivery/qualification
  steps, not substitutes for the three remaining real-tool gates above.
