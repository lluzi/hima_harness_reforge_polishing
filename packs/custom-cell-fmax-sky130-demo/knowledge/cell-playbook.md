# Custom-cell playbook for aes on sky130hd

Measured lessons from the celluzi project (July 2026, same ORFS, same container, same design).
Read `state/lessons.json` first: it holds every earlier round of this Campaign. Do not repeat a
failed idea without a new, stated reason.

## How HimaHarness measures you

- Two matched ORFS arms per round, same recipe, same merged Liberty and LEF, same clock. They differ
  only in whether your cells may be used (control: your cells are added to the full platform
  dont-use list). Round gain = custom-arm Fmax / control-arm Fmax − 1. The Goal reads the best
  valid round gain.
- Fmax = 1000 / (period − worst setup slack) at ORFS `finish`.
- A round improves only when the comparison is valid, its gain is positive and its custom Fmax beats
  the best custom Fmax so far. Two rounds in a row without improvement end the Campaign.
- Your own trial numbers go in `agentClaim`; they are shown next to the Harness number, never used.

## What worked and what did not

- **Cross-library comparisons are invalid.** Synthesis is deterministic but library-sensitive: adding
  cells, even dont-use ones, can change the netlist. Only matched arms count.
- **ORFS is σ = 0 deterministic.** The same inputs give byte-identical results; any arm difference is
  real (given the models).
- **The one positive result: `NOR3_PU2`.** A rise-skewed nor3 with a doubled pull-up (two parallel
  PMOS fingers), real DRC/LVS-clean layout, Liberty from foundry `nor3_1` tables with rise ×0.6. The
  timing-driven resizer adopted 14 instances voluntarily, replacing every `nor3_2`; global-route WNS
  went −0.37 → −0.13 ns against a valid control identical to golden.
- **Adoption needs a real modelled advantage.** In a derate sweep the resizer started using the cell
  at about 2.5 % modelled rise improvement and never at 1.000. It satisfices: it takes the weakest
  variant that fixes each path, so a fine ladder of variants gives a weaker result than one good cell.
- **Fused cells failed (−5 % Fmax).** 188 fused instances were never upsized: each fused function was a
  singleton (nothing to swap to) and had no `cell_footprint`, while ORFS runs
  `repair_design -match_cell_footprint`. The resizer buffered around them. If you build a fused cell,
  give it drive variants that share a footprint, or expect it to be stranded at minimum drive.
- **15 real cells, 52 adopted, ~0 gain** at 3.6 ns with a commercial flow: the deficit there was
  broad and structural. Custom cells pay off only near closure on a few dominant cones.
- **Drive is load-dependent.** Foundry `_2` versus `_1` ratios show `nor2`/`nor4` rise at `_2` is
  slower than `_1` at light load. "5 % faster everywhere" is physically impossible. Every derate must
  follow the topology (a doubled pull-up speeds the rise edge, not the fall edge).
- **Area costs.** `NOR3_PU2` is 2.3× `nor3_1` (LibreCell packing plus the extra fingers). A cell that
  is much larger than the foundry cell it replaces can lose on wire and placement.
- **LEF power pins must match Liberty `pg_pin`s** (VPWR, VGND, VPB, VNB) or the cell loads but is never
  used. Use `fix_lef_sky130hd.py`. A modelled LEF without obstructions lets the router cross the
  cell interior; real LibreCell LEFs carry obstructions.
- **Loaded ≠ adopted.** Count instances in `6_final.v`, not cells in the library.
- **Invalid-control trap.** `DONT_USE_CELLS=X` on the make command line wipes the platform's 36
  lpflow/probe exclusions. The Harness arms pass the full list; do the same in your own trials.

## Multi-output cells

- Global mapping with multi-output cells mainly saves area (EPFL `emap`: −7.5 % area, −0.5 % delay).
  Use them on local windows of critical cones, not the whole design.
- sky130hd already has `fa_*`, `ha_*`, `maj3_*`. `emap` may pick those even without your cells; the
  control arm runs the same `emap` pass with your cells removed, so only your cells' effect counts.
- Measured in this Pack's dry run (2026-10-04): an `emap` delay remap of a 122-cell window around
  the 5 worst baseline paths (stock library, equivalence PASS) improved the endpoints inside the
  window (−0.25 → −0.03…−0.19 ns) but the design got worse at finish (WNS −0.249 → −0.628 ns,
  236.5 MHz): the worst path moved to a cone outside the window (`sa00_sr[5]` → `sa00_sr[6]`, a
  1.2 ns `mux2i_2` stage) and placement/repair shifted across the design. In delay mode emap chose
  no stock fa/ha. A window remap must cover the whole near-critical cone set, or it just moves the
  worst path; check the remaining top paths before spending an arm on it.
- A multi-output cell enters only through an `emap-window` round (the resizer cannot create one).
  Cut windows at flops or clearly critical nets. An equivalence check is recommended; without one the
  round is shown as "function not verified".

## Planning a round

1. Read lessons and best. Look at the remaining top paths of the best round (or the baseline).
2. Analyse before running anything long: where do the top 20 paths spend time (cell types, edges,
   fanout, wire)? Which foundry cells sit on them at minimum drive? Write your scripts down under
   `cells/r<k>/`.
3. Prefer few strong cells with a clear physical reason over many weak ones (at most 10 per round).
4. An ORFS trial of aes takes 8–20 min with `NUM_CORES=8`; run at most two at once, and leave time
   for the Harness's own two arms (same length) inside the round.
5. Keep every cell of `best.json` byte-identical in your recipe; add new cells under `cells/r<k>/`.
6. Choose the clock. When the last round met timing (positive slack), tighten the period; the
   control arm is re-measured at the new clock, so a harder clock alone is never credited to you.
7. Write `findings.md` (what you analysed, what you found and rejected and why, what the lessons
   changed), one datasheet per new cell and `usage-guide.md`.
