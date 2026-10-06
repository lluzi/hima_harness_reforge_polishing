# Custom-cell playbook for aes on sky130hd

Your delivery is a cell library. Cells are cheap for you to make and HimaHarness characterizes every
one, so try many ideas each round and let its characterization and the flow decide. Read
`state/lessons.json` first: every earlier round with each cell's timing against its foundry cell, whether the
flow adopted it, the matched gain and the remaining top paths. Do not repeat a failed idea without a
new reason; do repeat what worked with variations.

## How HimaHarness judges you

- It characterizes every cell itself: abstract (mock-layout) cells get MOCK timing in seconds, an
  RC model of your sized netlist anchored to the foundry tables (see evidence-and-claims.md); real
  DRC/LVS-clean layouts would be measured with ngspice. Your own Liberty or derates never reach the
  arms.
- Two matched ORFS arms per round, same recipe and characterized library, custom cells allowed versus
  forbidden. Round gain = custom-arm Fmax / control-arm Fmax − 1; the Goal reads the best valid gain.
  Fmax = 1000 / (period − worst setup slack) at ORFS `finish`.
- The round report lists every cell: its status (mock or measured), rise, fall and input
  capacitance against the foundry cell you named in `compareTo`, and how many instances the flow
  used.

## What measurement has shown so far (linglong, 2026-10-04)

- Skew is a trade, not a free speed-up. NOR3_PU2 (every PMOS finger doubled on nor3_1's pull-down)
  measured rise 0.56–0.73× nor3_1 but fall up to 1.2× slower and input capacitance +44–74 %. Against
  the foundry nor3_2 it is a real trade-off cell: 5–11 % faster rise, 21 % less input capacitance,
  44–71 % slower fall. Cells win where their strong edge is the critical edge and their extra input
  load is cheap; the resizer decides that from the characterized tables.
- The foundry library already has strength ladders (_1/_2/_4). A useful custom cell fills a gap the
  ladder does not: a different pull-up/pull-down ratio, a per-input skew (fast input on the late
  arriving pin), a footprint-compatible variant, a fused function, or a multi-output cell.
- celluzi July: matched arms only; ORFS is σ = 0 deterministic; fused cells without drive variants
  were stranded at minimum drive (the resizer swaps only within a footprint and function), so give
  fused cells strength variants; the resizer satisfices and takes the weakest cell that fixes a path.
- LEF power pins must match the Liberty pg_pins (the factory normalizes this). Loaded ≠ adopted.
- Invalid-control trap: `DONT_USE_CELLS=X` on the make command line wipes the 36 platform
  exclusions; pass the full list in your own trials.

## Making a cell usable by the flow (measured 2026-10-04)

OpenROAD's resizer only swaps a cell for another it treats as equivalent: same pin names and
directions, the same timing-arc structure, the same `cell_footprint` (ORFS repairs with
`-match_cell_footprint`) and the same `function` **text** — OpenSTA compares function expressions
structurally, so `!(A|B|C)` and `(!A&!B&!C)` are never equivalent. A first measured NOR3_PU2 was
adopted 0 times only because of this. HimaHarness handles the drop-in case for you: when your cell
has the same pins and logic as its `compareTo` foundry cell, the characterized Liberty takes that cell's
footprint and function text verbatim. For your own families (fused or new functions), give every
member the same `footprint` value in the recipe and write the same function string for each, or the
resizer cannot size within the family. Yosys/ABC maps only from the stock and measured libraries at
synthesis; a new function enters there or through `emap`.

## Generating ideas in volume

- Start from the cells on the top paths (lessons `remainingTopPaths`, `runs/*/top-paths.txt`): for
  each slow stage, make several variants — pull-up and pull-down ratios (×1.5, ×2, ×3), per-input
  skews, and a fused version with the next stage.
- Add families, not singletons: a function in two or three strengths with one shared footprint lets
  the resizer size it.
- Multi-output cells for shared-input cones (AES is full of XOR/XNOR pairs and adder-like
  clusters): build them with `layoutFrom` (two foundry cells side by side, inputs shared); they
  enter the design only through an
  `emap-window` remap of the near-critical cone set (cover all near-critical cones, not 5 paths: a
  first 122-cell window on aes improved its own endpoints but moved the worst path outside and made
  the design 9 % slower). Equivalence check recommended.
- Keep every best-library cell byte-identical; new cells go under `cells/r<k>/`.

## Planning a round

1. Analyse the paths (minutes), then generate a large batch of specs and build them with
   `flow/toolbox/abstract` (seconds for hundreds of cells). This demo mocks layout and
   characterization; do not use the factory.
2. Optionally mock-characterize your cells yourself (`flow/toolbox/char`, `--netlist-kind mock`,
   seconds) to prune hopeless ones. An ORFS trial takes 15–25 min with `NUM_CORES=8` (at most two at
   once); in this demo deliver promptly: one trial pair at most, or none with `agentClaim: null`.
   HimaHarness's characterize step takes seconds and its two arms about 20 min.
3. Choose the clock: tighten it when the last round met timing.
4. Write findings.md, library.md (one row per new cell) and usage-guide.md, run the precheck, deliver.
