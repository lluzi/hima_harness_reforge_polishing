# Migration playbook: port a sized OTA to a second PDK

A migration keeps the design's intent, not its widths. The sized netlist is specific to the source
process; the gm/Id choices, the currents, the compensation and the topology carry across.

## The port

`draft migrate` makes the gm/Id-preserving port from the accepted source design:

1. **Device mapping.** Each device keeps its type (nmos/pmos) and maps to the target PDK's core
   device of that type (the PDK card names it).
2. **Inversion level.** Every group (input pair, mirror load with M6, bias mirrors) keeps its gm/Id.
3. **Lengths.** Each L moves to the target length at the same multiple of the minimum length,
   rounded to the nearest characterized length.
4. **Currents and compensation.** Pair, second-stage and bias currents, Cc and Rz stay the same,
   so gm1, gm6 and the poles start where they were.
5. **Widths.** W = Id / (Id/W) from the target's gm/Id tables, on the target's grid.

The design must cite the accepted source design (`migratedFrom` with its SHA-256); the draft fills it.

## Why the port alone often misses

- **Supply headroom.** A lower supply (1.8 V to 1.2 V) leaves less room between the input common
  mode and ground: Vds of the tail M5 = Vcm - Vgs1. A pair that was comfortable at 1.8 V can push
  the tail out of saturation at 1.2 V. Raise the input gm/Id (lower Vgs1), raise the bias mirrors'
  gm/Id (lower Vdsat), or shorten the input L.
- **Intrinsic gain.** gm/gds at the same gm/Id and relative length differs between processes and
  model families (BSIM4 vs PSP): the gain may drop a lot (GF180MCU at 3 x Lmin to IHP SG13G2 at
  3 x Lmin lost about 45 dB in a two-stage OTA). Lengthen the input pair and the current sinks, and
  raise the input and load gm/Id. Long mirror loads slow the mirror pole and the second stage
  (M6 shares the load's L), which costs phase margin: keep the load moderate in length and weakly
  inverted, buy phase margin with second-stage current, and move Rz above 1/gm6 to place a
  left-half-plane zero.
- **Speed and corners.** The target's corners spread differently; re-read every corner. GBW at the
  slow corner usually sets i1.
- **Power.** The same currents at a lower supply cost less power; the margin can buy current.

## Re-bias against the simulator

Edit the intent (start from the draft's `intent`), then
`draft migrate intent.json > design.json` and `sim ... target design.json ...` again. Write each try
in your analysis: the intent change, the worst-corner numbers, what you concluded. Deliver when every
target corner meets every line with every device saturated. If a line cannot be met in the target
PDK with this topology, deliver the best design and say which line, by how much, and why.

## Rules

- The source design is fixed for this round; do not edit `state/design-source.json`.
- Your delivery carries sizes, bias, Cc and Rz; never a performance number.
- Keep the matched pairs, the PDK's limits and grid. `precheck` holds you to this.
