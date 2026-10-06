# Custom-cell playbook for aes on sky130hd

Your delivery is a cell library. Cells are cheap for you to make and HimaHarness characterizes every
one, so try many ideas each round and let its characterization and the flow decide. Read
`state/lessons.json` first: every earlier round with each cell's timing against its foundry cell, whether the
flow adopted it, the matched gain and the remaining top paths. Do not repeat a failed idea without a
new reason; do repeat what worked with variations.

## Where the time goes, and what can move it (baseline report, 2026-10-06)

Measured from the stock baseline's ORFS top-path report at 3.6 ns (`runs/baseline/top-paths.txt`;
read it yourself, the same numbers come out):

- The 20 failing setup paths lie within 0.23 ns of each other (slack −0.249 … −0.020 ns). That is a
  wall, not one path: a 5 % gain over a stock-like control needs the worst slack near −0.07 ns, so
  the 11 worst paths must each gain 0.01–0.18 ns at once. Fixing one path only exposes the next.
- Each failing path's 3.4–3.7 ns data path splits into:
  - 3–7 placement and rebuffer buffers (buf_4 … buf_12), 0.57–1.17 ns in total, about a quarter of the path;
  - one xnor3 stage, 0.32–0.72 ns, on 19 of the 20 paths: the slowest single cell;
  - xor2/xnor2/mux2i stages, up to 0.6 ns;
  - flop clock-to-Q, 0.33–0.56 ns (dfxtp_2 driving a buffer);
  - about 9–10 small logic stages, 1.9–2.6 ns in total.
- Skewing small gates acts on that last bucket at a few ps per stage. It cannot reach 0.18 ns, which
  is why run-b38106d8 measured +0.22 % (SPICE) and +0.58 % (mock) with 500+ adopted skew cells.

Levers big enough to matter:

1. **Remove buffer stages.** The buffers sit after strong-fanout drivers: xnor2_4, xor2_4,
   mux2i_4, xnor3_2 and the flops. A driver strong enough for its fanout needs no buffer.
   - sky130hd stops at _4 for these functions; build the top of the ladder that it lacks: ×2 and ×3
     of the _4 cells, and xnor3 above _4.
   - Make them drop-in variants with `compareTo` = the _4 cell, so they take its footprint and
     function text and the resizer can size up into them.
   - Add fused "logic + output stage" cells.
   - Check in a trial that the buffers on the worst paths go away (count buf/rebuffer instances on
     `top-paths.txt`), not only WNS.
2. **A faster XNOR3.** It costs 0.3–0.7 ns on almost every failing path.
   - Try other topologies and per-input variants: put the latest-arriving input on the fastest leg,
     since the A, B and C arcs differ.
   - Try an xnor3 fused with its fanout buffer.
3. **Fewer stages across the whole cone.** An `orfs-abc` round lets synthesis map your single-output
   cells across the whole design. An `emap-window` replaces synthesis with a local remap and
   reached only 3–9 custom cell types in earlier rounds.

Flops are sequential, and the mock characterizes combinational cells only, so the clock-to-Q bucket
is out of scope. Judge each idea by the bucket it attacks: one trial pair per idea, comparing buffer
counts and xnor3 delays on the worst 20 paths, not only WNS.

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
- An earlier Campaign's round 1 (run-b38106d8, 2026-10-05; same aes, 3.6 ns): 227 abstract cells
  (140 drop-in skew/strength variants of xnor3, xor2, mux2i, xnor2, nand2, a21oi, o21ai, a211oi,
  nor2, o31ai; 45 fused cells in 3 drives; 42 multi-output cells) through an emap window of 381
  cells. The emap remap alone lifted the control arm from 259.79 to 268.28 MHz, which counts for
  neither arm. The custom arm reached 269.82 MHz with mock timing: +0.58 % matched (+0.22 % with
  pre-layout SPICE). The resizer adopted 548 instances of 53 types, led by XNOR2_PU3 77, NOR2_PU2A
  60, XOR2_OPU2 44, XOR2_PU3 35, XNOR2_OPU2 28, O21AI_ND3 26, NAND2_PU3 24; emap chose only 3 fused
  cells and no multi-output cell. The worst path stayed in the XOR/XNOR/MUX chains. A 5 % gain
  needs something that run did not try or did not reach.
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
2. Tools and their cost: mock characterization (`flow/toolbox/char`, `--netlist-kind mock`, the
   model HimaHarness uses) takes seconds; an ORFS trial takes 15–25 min with `NUM_CORES=8`, at
   most two at once. HimaHarness's characterize step takes seconds and its two arms about 15 min.
   More rounds or more time do not raise the gain by themselves; the ideas do.
3. Choose the clock: tighten it when the last round met timing.
4. Write findings.md, library.md (one row per new cell) and usage-guide.md, run the precheck, deliver.
