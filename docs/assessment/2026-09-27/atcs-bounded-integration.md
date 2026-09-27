# ATCS bounded post-route integration

Scope authorized by the coordinator after Issue #52 CLOSED — PASS at
`58a92850d2d95525110ae1537fc64726d6872295`: establish one complete worker before three-worker
optimization; local/Host tests only. Development allocation: GPT-6 Sol / Medium, one thread.

Status: `INTEGRATION_READY` for the coordinator-authorized single-worker scope. The original
three-worker milestone is not certified by this checkpoint.

ATCS-02 reuses the existing retained result/dependency/reviewed-action path. Exact Researcher
adoption precedes Reviewer materialization. The existing Workshop/Reader plan owns candidate actions;
the Researcher result remains a retained dependency. No Runtime file changed.

ATCS-03 declares `atcs-worker-01` at `operate-worker-01`. Reader admits one to three sizing candidates
inside the work package. Researcher returns hypotheses; Reviewer selects one candidate and its exact
plan hash; owner adopts both results. Host injects the reviewed typed action into Operator. One
mutation is followed by before/after dumps, export, session settlement, exact Operator adoption and
owner completion. The actual graph continues through capture-worker-01, read-worker-result-01 and
collect. w02/w03 remain parked and are not scheduled by the bounded path.
`state/workers.json.requiredSlots` names w01 for this path, so collect does not fabricate pending
work for the parked slots. Older manifests without the field retain their original three-slot semantics.

The production contract selects the new v2 wrapper. It remains an uninstalled candidate with
qualification placeholders: no production binding or commercial-tool readiness is claimed.

Evidence:

- Python: 823 tests run, 13 skipped; no expanded skip scope.
- Required six-file Host/local regression: 38/38 PASS, 294.169 seconds, 2 Host processes and
  52 in-process Hosts, zero Electron launches and zero SSH subprocess attempts.
- Delegation/control-Pack compatibility: 10/10 PASS, 9.305 seconds, six in-process Hosts.
- After the required-slot refinement: CLI subset 112 tests, seven skips, PASS; bounded Host
  path PASS again and confirms an empty pending list after its one Contribution is collected.
- Final ATCS contract file: 2/2 PASS, 58.330 seconds, two in-process Hosts, zero SSH/Electron;
  it also reruns the complete 823-test Python suite on the final Pack bytes.
- The new ATCS Host test uses the real Pack recipe, Host, Ledger, permissions, typed command
  protocol, result adoption, graph execution, Contribution sealer, Reader and collector.
- Only the external XTop process and model results are synthetic. The fixture starts at the changed
  operator seam after synthetic base/plan preparation; it is not a model-generated full Campaign.
- One duplicate mutation returns duplicate; the trace contains one effect and the collected
  Contribution contains one operation. Existing generic restart/adoption/identity tests are reused.
- Build, seams, boundary and inventory pass. Full repository typecheck has pre-existing
  `erasableSyntaxOnly` errors in channel/errors/guide/workspace source plus missing declarations in
  trial-package.test.ts. Those paths have zero diff in this slice; global typecheck is not PASS.

Untested: real model research, full baseline-to-Workshop Campaign, XTop/PT timing-data export,
v2 confinement qualification, Innovus/StarRC/PT, full-flow APR, three-worker concurrency,
no-fix/refused three-way join, GUI, TEST/seal/release/App, QoR and benchmark.

Next gate: freeze this Pack/flow/wrapper identity and perform ATCS-06 bounded real-tool qualification
only after the related Host suite passes. Do not use the placeholders as proof of a qualified binding.
Source-only rollback is the parent of the ATCS-03 commit; retain ATCS-02 and all #52 evidence.
