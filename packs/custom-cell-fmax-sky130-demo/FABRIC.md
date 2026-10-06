## Files written

- `contract.yml`, `graph.yml`, `semantics.yml`: the round loop of SPEC.md `Run contract`, Pack 0.4.0.
- `flow/cellfmax_cli.py`: every tool step (`bind`, `baseline`, `recipe`, `precheck`, `characterize`,
  `arm`, `compare`, `finish`), the recipe validator and the round record; `flow/orfs_arm.sh` (ORFS in
  the pinned container) and `flow/top_paths.tcl` (top 20 setup paths at finish).
- `tools/read-{baseline,arm,recipe,round}.py` with `readers/*.yml`; `rules/*.yml` (six);
  `choosers/cellfmax-next.yml`.
- `flow/toolbox/abstract/`: abstract cells, the demo's mock layout (sized netlist + foundry-derived
  abstract LEF; recipe entries keep `layoutFrom` for the mock's anchors).
- `flow/toolbox/char/`: `mockcore.py`, `fit_mock.py` and `mock-fit.json` (the mock characterizer the
  demo uses for abstract cells); the ngspice characterizer with extracted and pre-layout
  calibrations (measured path, kept for a later study).
- `flow/toolbox/factory/` and `flow/toolbox/pinaccess/`: real LibreCell layouts with DRC, LVS,
  extraction and a router pin-access gate; not used by the demo.
- `flow/toolbox/emap/`: multi-output window remapping (mockturtle emap) and equivalence check.
- `flow/toolbox/celluzi/`: verbatim copies of the earlier celluzi scripts, hashed in `SOURCES.json`.
- `knowledge/cell-playbook.md`, `knowledge/toolbox.md`, `knowledge/evidence-and-claims.md`.
- Site `sites/linglong-sky130-cells/` (site.yml, permit.yml, resident capability JSON) and tests
  `test/contract/custom-cell-fmax-sky130-demo*.ts`, `test/contract/support/cellfmax_*_test.py`,
  `test/fixtures/cellfmax-dry-path/` live outside the Pack folder.

## Gaps

- Graph shape differs from the design record (`docs/superpowers/specs/2026-10-04-...-design.md`):
  `generationLimit: 4` is a plain number (not bound to a strategy); the round record is read twice
  (`check-round` for adoption/improvement, a fresh `read-round-goal` for the constraint/Goal judge
  the explore node needs); `round_improved` also requires a positive matched gain; `compare-round`
  rewrites the summary each round because an explore ending has no tool step after it.
- Abstract cells have no GDS and no internal wiring (mock layout); their timing is a MOCK, not
  measured. Against calibrated SPICE tables of 227 round-1 cells: anchored arcs p50 8–13 %, p90
  29–48 %; model-only arcs (fused and new functions) p50 13–20 %, p90 37–50 %; table-middle bias
  −5 % to +4 %. Real factory layouts passed global route after the pin-access fix but stalled in
  detailed route at about 136 violations at custom cells (2026-10-05).
- Multi-output cells reach the design only through an engineer-chosen `emap-window` round; Yosys/ABC
  maps single-output cells only.
- One corner (tt 1.8 V 25 °C), no power tables.

## Reviews

- Recipe validator, compare-round outcomes, Readers, measured/mock characterization record and
  arm staging (`GDS_ALLOW_EMPTY` for abstract cells): `cellfmax_cli_test.py`, 35 tests.
- Characterizer core, calibration gate, pre-layout parasitic estimate and calibration-kind refusals:
  `cellfmax_char_test.py`, 27 tests; pre-layout calibration on linglong PASS within 13.3 % p90.
- Mock characterizer (folded switches, foundry identity, skew direction, multi-output anchors,
  model-only fallback, load monotonicity, CLI refusals): `cellfmax_mock_test.py`, 10 tests;
  `fit_mock.py` scores in `mock-fit.json`.
- Abstract LEF composition (drop-in, widening, multi-output, null pins, refusals):
  `cellfmax_abstract_test.py`, 6 tests; 236 cells built on linglong in 3.6 s.
- Factory and pin-access: `cellfmax_factory_test.py`, 36 tests.
- Host dry path (`cellfmax-dry` group, fake podman and ORFS): abstract cells, mock characterization
  without calibration; goal-met in two rounds and converged.
