# Executable Workshop examples

These files are not prose descriptions — they are exact, Reader-admitted documents. Each
one is proved by `flow/tests/test_workshop_examples.py`, which loads the file, runs it
through the real Reader in `tools/read-atcs.py` (the same `read_atcs.read(<kind>, report,
workspace)` entry point the Harness itself uses), and asserts `tc_request_invalid_count
== 0`. A Workshop purpose should say "copy the shape of examples/<file>; change only the
values" rather than re-describe the schema in prose.

- `campaign-plan.json` — admitted by the `campaign-plan` Reader
  (`tools/read-atcs.py:_read_campaign_plan`). Three disjoint work packages `w01`..`w03`,
  each with every field `atcs.workspaces._REQUIRED_WORK_PACKAGE_FIELDS` requires, one
  `candidate.workPackages` object (never repeated at the envelope's top level), and a
  `baseState` that is a real, identity-verified `design-state` artifact.

- `worker-request.json` — admitted by the `worker-request` Reader
  (`tools/read-atcs.py:_read_request_envelope`, bound with `expected_task_id="w01"`).
  Same `candidate`/`baseState`/`siteCapabilities` shape as a work package, plus a
  top-level `actions` list of one to three `{instance, toMaster}` sizing candidates
  whose `instance` is a full hierarchical path resolvable in the base netlist and inside
  `candidate.editDomain.instances`. The same shape (with a different `taskId`) is what
  `research-worker-02` and `research-worker-03` write for slots `w02`/`w03`.

- `next-decision.json` — admitted by the `next-decision` Reader
  (`tools/read-atcs.py:_read_next_decision`). All ten required fields are present:
  - `stateRef` — the 20-lowercase-hex `id` of `state/working-state.json`'s own CURRENT
    working state (never a stale or superseded state, even if it still resolves).
  - `observationRef` — the 20-lowercase-hex `id` of any artifact resolvable in the
    workspace (e.g. `state/observation.json`).
  - `budgetRef` — a non-empty string naming the budget basis (never an object).
  - `action` — one of the eight codes the Reader emits as `tc_next_action`:
    `observe`=1, `research`=2, `compose`=3, `revise`=4, `implement`=5, `earlier-apr`=6,
    `wait`=7, `goal-met`=8. This example uses `observe`. `earlier-apr` additionally
    requires a top-level `stage` in `place|cts|route|postroute`; `implement` is only
    legal when a reconciled, unimplemented batch based on the current working state
    exists in workspace state files; `goal-met` is only legal when the current final
    evaluation and accepted artifact support it.

All three files use the deterministic fixture identities `flow/tests/test_readers.py`'s
`_build_design_state`/`_make_workspace` helpers always produce for their default
arguments (`baseState`/`baseStateId` id `17adadf2abdce4a6d351`, `stateRef`
`62a80a2154c907c13526`, `observationRef` `de4af36c311de90baad2`) — synthetic but
format-valid, and reproduced exactly by the workspace `test_workshop_examples.py` builds
around them.
