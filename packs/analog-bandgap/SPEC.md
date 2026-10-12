## Goal template

A Campaign of this Pack asks for a bandgap reference that meets a spec sheet at every process corner,
temperature and supply, in Monte Carlo and after layout. Goal parameters: `vbg_v` (V, default 1.2),
`vbg_tol_pct` (percent, 2), `max_iq_ua` (uA, 8), `max_isd_na` (nA, 2), `max_tc_ppm` (ppm/C, 100),
`min_pm_deg` (deg, 60), `max_tstart_us` (us, 100), `min_psrr_db` (dB, 40). Strategy: `mcRuns` (100),
`pex` (`c` or `rc`, default `c`), `roundRevision` (the round counter the chooser advances).

## Constraints

- Site bindings: `simulators` (`spectre=<command>,ngspice=<command>`), `pdkRoot`, `pdk` (a card in
  `flow/pdks.json`), `layoutTool` (`<tool> <netlist> <subckt> <out>`, writing `layout.json`
  `hima-cell-layout/1`), `workspaceRoot`, `engineeringCapabilities`. Simulators, PDKs and the layout
  tool are read-only; Campaigns write only under `workspaceRoot`; at most three Site jobs at once.
- Template `kuijk-p5t-mirror` only (bind fixes it); devices, resistors and capacitors exactly the
  template's; matched pairs; sizes within the card's limits and grid; resistor segments as the model's
  `s`, no `m` on resistors.
- Every performance number comes from the Pack's simulate, mc and layout steps; a design file carries none.
- Reports at `reports/<node id>/r<k>/`; the agent's `artifactPrefix` is `reports/size-agent`.

## Run contract

Entry `bind-inputs` -> `characterize` -> `read-tables` -> `check-tables` (`tables-valid`) ->
`size-agent` (resident; `produces` design, Reader `bg-design`) -> `simulate-pvt` -> `read-pvt` (`bg-pvt`)
-> `check-pvt` (`meets-spec`) -> PASS `monte-carlo` -> `read-mc` (`bg-mc`) -> `check-mc`
(`mc-in-band`) -> PASS `layout` -> `read-layout` (`bg-layout`) -> `check-layout` (`layout-clean`) ->
PASS `simulate-post` -> `read-post` (`bg-post`) -> `check-post` (`meets-spec`) -> `record-round`;
FAIL or UNDETERMINED at any check goes straight to `record-round` -> `read-round` (`bg-round`) ->
`judge-round` (`round-valid`, `signed-off`) -> `next-round` (explore, chooser `bg-next`, revisit
`size-agent`). FAIL or UNDETERMINED at `check-tables` goes to `blocked`. Autopilot segments: bind ->
check-tables (until `size-agent`) and `simulate-pvt` -> judge-round (until `next-round`). The owner
drives the resident node and decides `next-round`. Budget: 2 h time box, 10 min closing reserve,
`generationLimit: 3`; `converge` on `best_margin_pct` needs three flat moves, which the three-round
limit never reaches.

## Semantics

`tables_valid`, `tables_curves` (`bg-tables`); `design_valid` (`bg-design`); `meets_spec`,
`worst_margin_pct`, `vbg_min_v`, `vbg_max_v`, `iq_ua`, `isd_na`, `tc_ppm`, `pm_deg`, `tstart_us`,
`psrr_db` (`bg-pvt` for the schematic, `bg-post` for the extracted layout); `mc_in_band`, `mc_runs`,
`mc_mean_v`, `mc_sigma_mv`, `mc_lo3_v`, `mc_hi3_v` (`bg-mc`); `layout_clean`, `drc_errors`,
`lvs_match`, `layout_area_um2` (`bg-layout`); `round_valid`, `signed_off`, `worst_margin_pct`,
`best_margin_pct`, `round_improved` (`bg-round`). Margin of a line = (value - spec) / spec for
at-least lines, (spec - value) / spec for at-most lines, VBG against its band; the worst over the lines.

## Judge rules

A judge takes its edge from its first rule; a chooser weighs the judge's first two (constraint, goal).

- `tables-valid`: `tables_valid` = 1.
- `meets-spec` (at `check-pvt` and `check-post`): `meets_spec` = 1.
- `mc-in-band` (at `check-mc`): `mc_in_band` = 1.
- `layout-clean` (at `check-layout`): `layout_clean` = 1.
- `round-valid` (constraint, first at `judge-round`): `round_valid` = 1.
- `signed-off` (goal, second at `judge-round`): `signed_off` = 1.

## Choosers

`bg-next` at `next-round`: constraint PASS and Goal PASS -> goal met; otherwise, including an
undetermined goal, `next: {roundRevision: roundStep}`. Reads `best_margin_pct` for convergence;
changes only the round counter.

## Endings

`ended-goal-met` (a valid round signed off), `ended-converged` (declared, not reachable within the
three-round limit), `ended-budget-exhausted` (round limit or time box), `ended-goal-not-met` (owner
ends early); `blocked` (wait) when the simulator, the PDK, the layout tool or the device tables fail.

## Workshops

One resident engineering task per round: `size-agent` delivers `hima-bandgap-design/1`. It reads the
state it needs, uses `bandgap-sizing-playbook.md` with `bandgap-flow.md`, `design-format.md` and
`evidence-and-claims.md`, drafts with `bg_cli.py draft`, simulates its own drafts with `bg_cli.py sim`,
prechecks with `bg_cli.py precheck`, and delivers one design with its analysis under
`reports/size-agent/r<k>/`. A refused delivery is repaired in the same task.

## Knowledge

- `knowledge/bandgap-flow.md`
- `knowledge/bandgap-sizing-playbook.md`
- `knowledge/design-format.md`
- `knowledge/evidence-and-claims.md`
