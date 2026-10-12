# analog-bandgap test fixtures (synthetic decks only)

- `spectre-tt/`: Cadence Spectre 23.1 PSF ASCII output (`rawfmt=psfascii`). The `analog-bandgap`
  Pack's bench ran at the tt corner, 3.3 V and 27 C on the synthetic `synth180` decks of
  `../analog-pdks/` (made up, no foundry data).
  - The design is `design.json`, template `kuijk-p5t-mirror`, the method's first cut on those decks.
    `cell.spice` is its cell.
  - There is one netlist per copy of the cell: `nominal` (DC sweep, operating point, AC with the
    supply source), `loopv` and `loopi` (the loop's voltage and current injections), `off` (en low),
    and `powerUp`, `en1us`, `en50us` (the transients).
- `spectre-mc/`: Spectre `montecarlo` output for the same design, mismatch on, 30 runs, seed 1
  (`mc1-<k>_op1.dc`).
- `synth180-tables/`: ngspice 47 characterization of `synth180`: the gm/Id tables and the PNP and
  resistor tables. Values are rounded to 5 significant digits.

Produced on the EDA server on 2026-10-12 by `flow/bg_cli.py` (`run_bench`, `run_mc`). The netlists'
PDK root is replaced by `<pdkRoot>`, and their cell include by `./cell.spice`. Spectre's own logs are
left out. The same design in ngspice 47 measured the same VBG (1.1738 V), PSRR, phase margin and
start-up as Spectre; `analog-bandgap-sim.test.ts` checks the agreement.
