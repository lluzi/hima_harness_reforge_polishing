# MAGE scribe-line placement 0.1.0 Fabric record

## Files written

`contract.yml`, `graph.yml`, and `schemas/tasks.json` declare one `hima-flow/1` sequence containing
one `repeat`, with explicit Run/Goal/strategy/committed-output bindings. `flow/mage_placement_cli.py`
routes program-task ABI commands (`task-<name>`) and resident-facing subcommands (`snapshot`,
`lane-view`, `plan-slots`, `evaluate`, `mage-round`, `candidate`, `review`, the two batch fallbacks,
`flow-digest`) into `flow/mage_placement/` — `core`, `pla`, `rules`, `targets`, `lanes`, `snapshot`,
`planner`, `metrics`, `consumers`, `records`, `rounds`, `tasks`, and `native/session`+`native/tcl`.
`tools/read-mage.py` backs both `readers/*.yml` declarations with one fail-closed script, imported
from the Campaign's own copy of `flow/` (`workspace.source: pack`), the same shape as the ATCS
Pack's `read-atcs.py`. Four `flow/templates/*.tcl` files are this Pack's entire verified MAGE
command surface. `flow/consumer_models/{litho-pie,metrology,alignment,wat,bonding}.{yml,json}` are
customer-neutral requirement templates; `bonding` ships `enabled: false` and is never run in 0.1.0.
`knowledge/` carries four shared playbooks and six role briefs (`role-bonding.md` for a later
version only); this Task (8) wrote their content and the four Pack documents.

## Gaps

No model, no commercial EDA, and no GUI were used to produce anything in this repository. Every
MAGE round in `flow/tests/` runs against `flow/tests/standin_mage.py`, a stand-in interpreter that
reproduces the five templates' own control flow (open-build, replay, experiment/fill, the three
native checks via `MAGE_VERIFY_*` stdout markers, export with the `MAGE_ROUND_END` completion
marker) without a licensed binary — it proves the driver's wiring (one-writer enforcement,
round-exists refusal, session-log tagging, verify-file slicing from stdout, completion judged by
the marker and not the vendor launcher's unconditional exit 0), not MAGE's own effectiveness or the
D-status commands' real behaviour. Every schema-
validated document (`placement-candidate`, `consumer-review`, `round-decision`, `placement-result`,
and the four record kinds) has an admitted example fixture, a schema validator, and at least one
Reader negative (tampered PLA, untagged mutation, unanswered Request, fabricated review number,
wrong snapshot binding) under `flow/tests/`. No customer data exists in this repository; every
fixture is synthetic. `knowledge/mage-capabilities.md` separates the V-status templates (the Site's
proven native route — open/build without an Auto-Refine disable, replay, the fill stage, the three
native `frbCheck*` checks, export — confirmed by the resident kit evidence on the Oct-12 build)
from the D-status commands (documented in the vendor manual, including the old ten-way `smVerify`
family this Pack no longer runs, never qualified against a real design in this session).

The Host-level **L2 dry route** is Task 10's work and now passes:
`test/contract/support/mage-resident-durable-worker.ts` plus
`test/contract/mage-scribe-placement-durable.host.test.ts` (registered under
`test/contract-groups.json`'s `atcs-dry` group) boot the real Host in-process, with the stand-in
ACP residents (`test/fixtures/mage-resident-dry/{prepare.py,acp.py}`) standing in only for the
licensed MAGE binary and the native engineering/review agents, and run the whole `repeat` of
engineer-place -> four review-* -> decide-round to completion for both a converging
(`goalMet: true`, 2 rounds, 16 task executions) and a stalled/conflicting (`goalMet: false`, 4
rounds, 28 executions, 1 Decision Request) round sequence, with zero model calls. Getting there
surfaced and fixed two real Pack/Harness integration gaps the Pack-local single-workspace test
could not catch — a session-log delivery path outside the Engineer's own `artifactPrefix` (fixed
in `89c17979`) and `decisionRequests` silently dropped from `decide-round`'s committed output
(fixed in `b6f40829`) — plus a Site capacity correction (`parallelJobs: 2`, not 1: each resident
task's retained Job holds its slot until collecting its own result launches a second, concurrent
Reader Job). Full detail is in `packs/mage-scribe-placement/TEST.md`'s L2 section and
`.superpowers/sdd/task-10-report.md`.

The machine-local offline evaluation of the real frame-case package (Task 11, run by the planning session
outside this repository) is separate from this Fabric record and is not claimed here.

## Task 14 — ordinary/grouped drops, reference method, native DBU export, Python 3.8 proof

`metrics.drops` now splits its drop set into `ordinary` (empty `inGroup`) and `grouped`
(non-empty `inGroup`, a priority mark); the two Readers' `tools/read-mage.py` and
`readers/mage-placement-candidate.yml` emit `mage_dropped_ordinary_count`/
`mage_dropped_ordinary_length_um` right after the existing `mage_dropped_count`/
`mage_dropped_length_um`, documented in `semantics.yml`, `SPEC.md`, and
`knowledge/state-and-evidence.md`'s new "Ordinary versus grouped drops" paragraph. The ordinary
length is the comparison objective against any external baseline or the new optional manifest
`referenceMethod` field (a digest-verified `fileRef`, reusing `_load_case`'s existing
`_verify_file`/`MageError('identity-mismatch', ...)` path — one digest-mismatch error code for
every manifest file, `referenceMethod` included); `evaluate_placement`'s Q1 comparison now reports
`Q1_ordinaryLengthUm`/`Q1_groupedLengthUm` for both the best state and the incumbent alongside the
existing `Q1_dropsDelta`.

Mid-task, a verified reading of a real MAGE export on the Oct-12 build (the Site's own native
baseline PLA) found the Pack's PLA reader could not read what `-saveMark` actually writes:
`-savePlaDBU` is the saved PLA's own braced DBU-header line, not a second export command with a
path of its own, and the DBU shape uses `-box` (not `-umBox`) with Group target points still in
micrometres next to integer-DBU boxes. `flow/mage_placement/pla.py`, `flow/templates/export.tcl`,
`flow/mage_placement/native/session.py`, and `flow/tests/standin_mage.py` were corrected to match
(detail in `TEST.md`'s L1 section); this is a bug fix inside the Task 13 native-route surface, not
a new architectural surface, so it stayed in this task rather than opening a new one.

The whole suite (184 tests) was run both on this Mac's `/usr/bin/python3` (3.9.6) and, via
`rsync` + `podman run ... edarunner:alma8`, on the Linglong resident container's own Python
3.8.16 — both report `OK` with no skips. No model, no licensed MAGE binary, and no GUI ran
anything recorded in this section.

## Reviews

Per-task review is recorded in `.superpowers/sdd/task-8-report.md` and the planner's own per-task
review notes (Opus 4.8, `model-policy.md`). The final whole-branch review (Task 12, Opus 5.5 high)
has not run yet.
