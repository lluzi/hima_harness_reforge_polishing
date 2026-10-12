## Goal template

A Campaign of this Pack asks for a two-stage OTA that meets a spec sheet in a source PDK and, after
migration, in a target PDK. Goal parameters: `min_gain_db` (dB, default 60), `min_gbw_mhz` (MHz,
default 10), `min_pm_deg` (deg, default 60), `max_power_uw` (uW, default 200); all judged at the
worst corner of the migrated OTA. Strategy: `loadPf` (pF, default 2), `inputCmPct` (percent of the
supply, default 60), `roundRevision` (the round counter the chooser advances).

## Constraints

- Site bindings: `simulators` (`spectre=<command>,ngspice=<command>`; each PDK is measured with the
  first simulator its card lists that the Site has, Cadence Spectre first), `pdkRoot` (installed PDKs
  as the simulators see them), `sourcePdk`, `targetPdk` (card names in `flow/pdks.json`),
  `workspaceRoot`, `engineeringCapabilities`. The simulators and PDKs are read-only; Campaigns write only under `workspaceRoot`; at most three Site jobs at once.
- Topology `miller2` only; devices M1 to M8; matched pairs; sizes within the card's limits and grid.
- Every performance number comes from the Pack's simulate steps; a design file carries none.
- Reports at `reports/<node id>/r<k>/`; a resident agent's `artifactPrefix` is `reports/<its node id>`.

## Run contract

Entry `bind-inputs` -> `characterize` -> `read-tables` -> `check-tables` (`tables-valid`) ->
`size-agent` (resident; `produces` designSource, Reader `ota-design`) -> `simulate-source` (given the Goal's lines) ->
`read-source` (Reader `ota-source`) -> `check-source` (`source-meets-spec` first) ->
PASS `migrate-agent` (resident; `produces` designTarget, Reader `ota-design`) -> `simulate-target` ->
`record-round`; FAIL or UNDETERMINED at `check-source` goes straight to `record-round` -> `read-round`
(Reader `ota-round`) -> `judge-round` (`round-valid`, `target-margin`, then the per-line rules) -> `next-round` (explore,
chooser `ota-next`, revisit `size-agent`). FAIL or UNDETERMINED at `check-tables` goes to `blocked`.
Autopilot segments: bind -> check-tables (until `size-agent`), `simulate-source` -> check-source
(until `migrate-agent` or `record-round`), `simulate-target` (until `record-round`), `record-round`
-> judge-round (until `next-round`). The
owner drives both resident nodes and decides `next-round`. Budget: 2 h time box, 10 min closing
reserve, `generationLimit: 3`; `converge` on `best_margin_pct` needs three flat moves (band 0.5), which the
three-round limit never reaches, so a Campaign that does not meet the Goal ends at the limit.

## Semantics

`tables_valid`, `tables_curves` (`ota-tables`); `design_valid`, `area_um2` (`ota-design`); `gain_db`,
`gbw_mhz`, `pm_deg`, `power_uw`, `saturated`, `area_um2` at the worst corner (`ota-source` for the
source design, with `meets_spec` and `margin_pct`; `ota-round` for the migrated design); `round_valid`, `specs_met`,
`target_margin_pct`, `best_margin_pct`, `round_improved` (`ota-round`). Margin of a line = (value -
spec) / spec for at-least lines, (spec - value) / spec for at-most lines; the worst over four.

## Judge rules

A judge takes its edge from its first rule; a chooser weighs the judge's first two (constraint,
goal). The per-line rules follow for the record.

- `tables-valid`: `tables_valid` = 1.
- `source-meets-spec` (first at `check-source`): `meets_spec` = 1, stated by `simulate-source`
  from the Goal's four lines and the saturation of every device at every corner.
- `round-valid` (constraint, first at `judge-round`): `round_valid` = 1.
- `target-margin` (goal, second at `judge-round`): `target_margin_pct` >= 0, the worst normalized
  margin over the Goal's four lines.
- `devices-saturated`: `saturated` = 1. `gain-spec`, `gbw-spec`, `pm-spec`: worst-corner value >= the
  Goal parameter. `power-spec`: worst-corner power <= `max_power_uw`.

## Choosers

`ota-next` at `next-round`: constraint PASS and Goal PASS (and every required verdict PASS) -> goal
met; otherwise, including an undetermined goal, `next: {roundRevision: roundStep}`. Reads
`best_margin_pct` for convergence (the best valid round's margin, -100 before the first); changes
only the round counter.

## Endings

`ended-goal-met` (the migrated OTA meets every line in a valid round), `ended-converged` (declared for the
harness, not reachable within the three-round limit), `ended-budget-exhausted` (round limit or time box), `ended-goal-not-met`
(owner ends early); `blocked` (wait) when the simulator, a PDK or the design curves fail.

## Workshops

Two resident engineering tasks per round, one at a time: `size-agent` (source design) and
`migrate-agent` (target design), each `hima-ota-design/1`. Each reads the state it needs, uses its
playbook with `analog-flow.md`, `design-format.md` and `evidence-and-claims.md`, drafts with
`ota_cli.py draft`, simulates its own drafts with `ota_cli.py sim`, prechecks with `ota_cli.py
precheck`, and delivers one design with its analysis under `reports/<node id>/r<k>/`. A refused
delivery is repaired in the same task.

## Knowledge

- `knowledge/analog-flow.md`
- `knowledge/gmid-sizing-playbook.md`
- `knowledge/migration-playbook.md`
- `knowledge/design-format.md`
- `knowledge/evidence-and-claims.md`
