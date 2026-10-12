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
reproduces the four templates' own control flow (open, replay, verify, export) without a licensed
binary — it proves the driver's wiring (one-writer enforcement, round-exists refusal, session-log
tagging), not MAGE's own effectiveness or the D-status commands' real behaviour. Every schema-
validated document (`placement-candidate`, `consumer-review`, `round-decision`, `placement-result`,
and the four record kinds) has an admitted example fixture, a schema validator, and at least one
Reader negative (tampered PLA, untagged mutation, unanswered Request, fabricated review number,
wrong snapshot binding) under `flow/tests/`. No customer data exists in this repository; every
fixture is synthetic. `knowledge/mage-capabilities.md` separates the V-status templates (actually
run, here and on the real Oct-12 build replaying `pre_place_all.pla`) from the D-status commands
(documented in the vendor manual, never run against a real design in this session).

The Host-level **L2 dry route** (`test/contract/mage-scribe-placement-durable.host.test.ts` and its
stand-in ACP residents under `test/fixtures/mage-resident-dry/`) is **Task 10's** work, not yet
written. **This document will be updated by Task 10** once that route passes, recording whether the
repeat ran its expected rounds through the real Host with stand-in residents and whether both the
converge-in-round-2 and the conflict/Decision-Request scenarios committed cleanly. Until then, this
Pack's only Host-level evidence is the L0/L2 contract test below (`loadPack`/`checkPack` against a
synthetic local Site) — it proves the Pack is well-formed and checks cleanly, not that a Run through
the repeat actually converges.

The machine-local offline evaluation of the real P23 package (Task 11, run by the planning session
outside this repository) is separate from this Fabric record and is not claimed here.

## Reviews

Per-task review is recorded in `.superpowers/sdd/task-8-report.md` and the planner's own per-task
review notes (Opus 4.8, `model-policy.md`). The final whole-branch review (Task 12, Opus 5.5 high)
has not run yet.
