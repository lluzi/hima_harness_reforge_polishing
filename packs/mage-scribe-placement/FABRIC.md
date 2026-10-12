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

The Host-level **L2 dry route** is Task 10's work. Task 10 built the stand-in ACP residents
(`test/fixtures/mage-resident-dry/{prepare.py,acp.py}`) and, before wiring the TypeScript Host
worker, reproduced the real two-workspace resident shape (private resident workspace vs. Campaign
workspace, `artifactPrefix`-scoped delivery) in Python and found a genuine Pack/Harness contract
mismatch: `mage_placement_cli.py`'s `mage-round`/`candidate` subcommands record the MAGE session
log at a fixed, cumulative `state/session.jsonl` path that is never under the Engineer's own
`placement/` `artifactPrefix`, so the resident delivery mechanism can never copy it into the
Campaign workspace, and the `placement-candidate` Reader (which resolves `files.sessionLog` against
the Campaign workspace, correctly per its own contract) fails every round with
`mage_candidate_error_count: 1`. `flow/tests/test_cli_tasks.py` never catches this because it
drives every program task and every resident subcommand against one shared workspace, where the
Campaign/private-workspace split (and the copy step between them) does not exist at all. Task 10's
TypeScript Host worker and `test/contract/mage-scribe-placement-durable.host.test.ts` were not
written as a result — see `packs/mage-scribe-placement/TEST.md`'s L2 section and
`.superpowers/sdd/task-10-report.md` for the full reproduction. This Pack's only Host-level evidence
remains the L0/L2 contract test below (`loadPack`/`checkPack` against a synthetic local Site) — it
proves the Pack is well-formed and checks cleanly, not that a Run through the repeat actually
converges on the real Host.

The machine-local offline evaluation of the real P23 package (Task 11, run by the planning session
outside this repository) is separate from this Fabric record and is not claimed here.

## Reviews

Per-task review is recorded in `.superpowers/sdd/task-8-report.md` and the planner's own per-task
review notes (Opus 4.8, `model-policy.md`). The final whole-branch review (Task 12, Opus 5.5 high)
has not run yet.
