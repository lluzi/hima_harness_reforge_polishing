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

## Reviews

Per-task review is recorded in `.superpowers/sdd/task-8-report.md`. The final whole-branch review
(Opus 5.5 high, per `docs/agents/model-policy.md`) has not run yet.
