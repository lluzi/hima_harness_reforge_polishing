# MAGE script-method test-structure placement 0.1.0 Fabric record

## Files written

`contract.yml`, `graph.yml`, `semantics.yml`, and `schemas/tasks.json` declare one `hima-flow/1`
sequence containing one `repeat` with `maxIterations: 6`, explicit Run/Goal/strategy/committed-output
bindings, and the Engineer's complete brief as the `engineer-script` tool's `description` (Task 8).
`flow/mage_placement_cli.py` routes program-task ABI commands (`task-prepare-case`,
`task-measure-incumbent`, `task-decide-round`, `task-evaluate-placement`, `task-deliver`) and
resident-facing subcommands (`snapshot`, `lane-view`, `plan-slots`, `mage-stage`, `stage-report`,
`candidate`, `script-candidate` fallback, `flow-digest`) into `flow/mage_placement/` — `core`, `pla`,
`rules`, `targets`, `lanes`, `snapshot`, `planner`, `metrics`, `records`, `rounds`, `tasks`, and
`native/session` + `native/tcl` + `native/prelude.tcl` + `native/epilogue.tcl`. `tools/read-mage.py`
backs `readers/mage-script-candidate.yml` with one fail-closed script, imported from the Campaign's
own copy of `flow/` (`workspace.source: pack`), the same shape as the sibling Pack's
`read-mage.py`. Eight `rules/*.yml` files declare the delivery rules `evaluate-placement` checks.
`knowledge/` carries five files (Task 8 wrote their content): `script-method-playbook.md`,
`mage-capabilities.md`, `state-and-evidence.md`, `reference-method-guide.md`,
`role-script-engineer.md` — this Task also wrote the four Pack documents (`INTENT.md`, `SPEC.md`,
`FABRIC.md`, `TEST.md`) and `flow/tests/test_knowledge.py`.

## Gaps

No model, no commercial EDA, and no GUI were used to produce anything in this repository. No real
MAGE binary ran anything this Task touched; the knowledge content and the five markdown files are
checked only against the Pack's own real CLI subcommands/flags, the real `contract.yml` output
paths, and the real forbidden-text list in `native/session.py` — never against an actual MAGE
session. `flow/tests/test_knowledge.py` proves the knowledge set is internally consistent with the
code (every subcommand/flag named is real, every `state/...` path named is a declared output or a
round-archive path, no placeholder text remains, the word budget holds) — it does not and cannot
prove the Tcl command text itself is correct against a real MAGE session; that is the dry route
(Task 9) and the live proof procedure (Tasks 10/12/13).

What the dry route is expected to prove, once it lands: that the stand-in MAGE interpreter accepts
the exact prelude/epilogue and the round-1 baseline script verbatim from
`script-method-playbook.md` §9, that `mage-stage`/`stage-report`/`candidate` wire together end to
end across a `repeat` of resident rounds, and that a blocked round (a stage that fails after a named
boundary) still lets the Run continue to a later completed round — proving the Harness/Pack wiring,
not MAGE's own behaviour on the real build. The live proof procedure is the only thing that can
confirm the knowledge's exact Tcl command text actually runs, and whether the compaction failure
signatures this knowledge documents still hold on the licensed build at the time of that Run.

The dry route landed in Task 10 and passes 3/3 on the real Host and durable runtime with zero model
calls (`test/contract/mage-script-placement-durable.host.test.ts`, group `atcs-dry`). A stand-in ACP
Engineer (`test/fixtures/mage-script-dry/acp.py`, the `native.executable` the resident wrapper
launches) authors a real Tcl stage script and drives the deployed `mage_placement_cli.py` through
`mage-stage → stage-report → candidate` exactly as the playbook instructs, with
`flow/tests/standin_mage.py` in place of the licensed binary. It proved the wiring predicted above
across three env-selected scenarios (`converge`, `stall`, `blocked`): the `repeat` ran its expected
number of rounds (2, 3, 2), each round executed exactly `2 + rounds*2 + 2` tasks, each resident
execution carried exactly one Reader Job reading `mage_candidate_error_count == 0`
(`readerJobs == engineeringJobs == rounds`), the blocked round 1 (failing after boundary
`priority-start`) still let the Run continue to a goal-met round 2, and the final `goalMet` /
`proofLevel` / `journalEntries` matched the Pack-local route test. The proof lines are recorded in
`TEST.md`'s L2 section. This remains Harness/Pack wiring only — it does not touch MAGE's real
behaviour, which still waits on the live proof procedure.

Task 12's host-side native probes (`TEST.md` L4) then ran this Pack's own `mage-stage` driver against
the real tool on the Site: the round-1 baseline stage reproduced the native incumbent exactly (export
byte-identical to the kit's baseline PLA; 27 ordinary drops / 135,113 µm; Reader clean), and the two
compaction failure signatures the reference method hits on this build were reproduced and are
visible as boundary rows in `stage-report` (0 in-group Fits after the offset edits; Fits restored
unbound from their Groups by a plain re-source; the preplaced sort failure under converge mode).
No resident, no model and no Harness ran in those probes; the live resident Run is Task 13.

Task 13's live resident Run (`TEST.md` L4 S3, 2026-10-13) closed the gap this section opened: on the
real Host, with a real resident Engineer writing its own Tcl against the licensed MAGE on the
Site, the `repeat` ran 4 rounds / 19 stages, every stage completed or failed at a named boundary,
every round delivered a Reader-clean candidate, and the Run stopped honestly on the two-stall rule
with proof level **Improvement** (16 ordinary drops / 78,045 µm against the native baseline's
27 / 135,113 µm; the reference's 18 / 52,453 µm is beaten on count, not on length; the Goal's
movement, order and target limits are exceeded by the delivered candidate). The kit's independent
evaluator and a cold replay of the delivered stage chain both confirm the delivered export
byte-for-byte. What remains open is method, not wiring: the Engineer's journal names the ordinary
marks' lane capacity under the compacted priority geometry as the floor and a clearance-aware
packer as the next lever; the ranking key's order (drops before rule compliance) is a Goal-design
question recorded in `TEST.md`.

## Reviews

Per-task review is recorded in `.superpowers/sdd/task-8-report.md`. The final whole-branch review
(Opus 5.5 high, per `docs/agents/model-policy.md`) ran on 2026-10-13 (`.superpowers/sdd/final-review-1.md`):
NO-GO with four Important findings, all fixed in the same round (commits `36cfe5fb`, `36dbbdcd`),
GO on re-review; the remaining minors landed in `f0d280b5`.
