# ATCS 0.1.1 reader CLI gate

Preserved failed candidate: `fb220316`, Pack 0.1.0 digest
`339c25d773bf0755c58b6db500bcc28be9620c5057b85bba365aeb7b33bfc8b9`.
Run `run-87defa35-1520-4d73-9d28-b23f03263a7b` remains held at revision35,
`read-next-decision`, with no worker mutation. Its installed method and evidence are not replaced.

Declared reader argv is `next-decision REPORT OUT WORKSPACE`: REPORT names a JSON file;
WORKSPACE arrives as a CLI string. There is no inline-JSON source discriminator in this contract.
The retained report is a ten-field object, action `research`, string `costBasis`, array targets
and requiredArtifacts. `_load_json(REPORT)` correctly decoded it. The actual failure occurs later:
`_collect_next_decision_problems` joined the unconverted WORKSPACE string with `state/working-state.json`.
Prior direct-call tests passed `Path`, hiding the CLI-only type mismatch.

The smallest fix normalizes this declared path with `Path(workspace)` at that validator's entry,
matching the existing sibling validator. No REPORT path guesses, inline source support, exception
suppression, or weakened reference checks were added. Contract/graph version advances to 0.1.1.

Evidence:

- CLI-shaped test RED: same `TypeError: unsupported operand type(s) for /: 'str' and 'str'`;
  valid report and stale-resolvable-state counterexample failed in 0.049 seconds.
- Exact retained report bytes SHA
  `77d70f4519143d043c59e36f96c5293fc04255c78f1c27f82ffe17f4d362d5e5`
  replayed in a temporary reference-resolution fixture against old/candidate CLI:
  exit1 -> exit0, output invalid0/action2/stop0. Customer request bytes stay in ignored local evidence,
  not Git; this tests decoding/validation, not fresh EDA or authenticity of synthesized companion state.
- Reader suite 68/68 PASS, 0.288 seconds; stale stateRef still yields unknown/refusal.
- Existing ATCS Host/Pack contract file 2/2 PASS, 37.707 seconds, including its Python Pack suite;
  two in-process Hosts, zero Electron and SSH. Other contract files were not run.
- Production workspace-copy flow digest remains
  `b91195068ac13f31229547b5c613b4066e502772d67129f269a8851ff9631fb3`.
  CLI, templates, verifier, wrapper, Site and Permit are unchanged. Real worker qualification is
  reused only for those identical bytes; this reader fix is locally qualified, not a new Campaign PASS.

Development/integration and independent review: GPT-6 Sol / Medium, bounded context.
Independent scoped review found no actionable issue: REPORT remains file-only, path normalization
changes no validation predicates, and CLI success/stale-state refusal are covered.
Candidate Pack digest: `3a52984082f4b07d6615ade2a1c2b1975852f2ac6e748c015a3806c59d8485c9`.
No model upgrade, new architecture or EDA rerun. Token counts are not measured.
Rollback is the previous source commit; never roll back by overwriting the held Run's method.
Native TEST/seal/release and single-worker successor acceptance remain pending.
