# ATCS 0.4 Fabric record

## Files written

The Pack upgrades the existing resident method to five business Tasks in one `hima-flow/1` sequence.
It requires Harness 0.3.0. Runtime owns durable task execution, recovery, lifecycle and artifact
ownership. The Pack owns timing business values, schemas, evaluation and engineering package.
Historical records and active legacy methods are not converted.

`contract.yml`, `graph.yml` and `schemas/tasks.json` declare explicit Run/Goal/strategy/committed-output
and artifactRef bindings. `flow/atcs_cli.py` routes program ABI commands to
`atcs/business_tasks.py`, which aggregates unchanged binding/readiness/baseline/native/common-R1
helpers and writes each actual intermediate with `core.write_artifact`. Native auth, EDA algorithms
and task-scoped engineering wrapper stay in their existing responsibilities.

The existing resident adapter invokes the existing Pack Reader once. evaluate-timing consumes its
committed observations and explicit domain-report reference. It emits raw timing and broader
remaining/regression/UNKNOWN separately. deliver verifies retained digests and produces actual
Markdown/JSON reports plus a tar package containing selected checkpoint/support files, scripts,
ECO, raw reports, native trace and reproduction instructions. Workspace package production does
not itself prove the Host's final archive integration; that seam is tested by the root integration.

## Gaps


The private Python checks reuse admitted Reader/native fixtures and the existing native Tcl
stand-in. Preparation executes emitted common-R1 Tcl and materializes native reports and saved
checkpoint instead of prewriting baseline/common state. The stand-in retains negative timing and
save/reopen behavior; it proves wiring, not commercial XTop effectiveness. Program tests cover
Goal true with broader UNKNOWN, honest best effort, raw regression with empty model lists,
changed report/checkpoint refusal, CLI ABI and usable final package contents. Existing Reader tests
retain forged timing/hash/identity/scenario/script/checkpoint counterexamples. See TEST.md.

Public Host complete dry route and archive integration are separate integration responsibilities.
No model, commercial EDA, GUI or independent benchmark is needed for private schema/program proofs.
Live evidence from earlier Pack versions keeps its original identity and scope; it is not a new
0.4 engineering experiment or physical signoff qualification.

## Reviews

The Pack-owned Python suites passed 16 Reader, 3 context and 10 business checks. Integration findings and independent review are recorded by the U8 assessment; full Host archive acceptance remains in progress.
